import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { loadConfig, Config } from './config';
import { object, readJson, writeJson, safeEqual, message } from './util';
export interface Runtime { pid:number; port:number; startedAt:string }
export function runtime(home:string):Runtime|null {try{const r=object(readJson(path.join(home,'runtime.json')));if(Number.isInteger(r.port)&&Number(r.port)>0&&Number(r.port)<65536)return r as unknown as Runtime;}catch{}return null;}
export async function rpc(home:string,route:string,payload?:unknown,timeout=3000):Promise<unknown>{
  const r=runtime(home);if(!r)throw new Error('Dashboard collector is not running.');const c=loadConfig(home);
  return new Promise((resolve,reject)=>{const body=payload===undefined?null:JSON.stringify(payload);const req=http.request({host:'127.0.0.1',port:r.port,path:route,method:body?'POST':'GET',headers:{Authorization:`Bearer ${c.token}`,...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{})}},res=>{const chunks:Buffer[]=[];let count=0;res.on('data',(b:Buffer)=>{count+=b.length;if(count>32*1024*1024){req.destroy(new Error('Response exceeds bound.'));return;}chunks.push(b);});res.on('end',()=>{try{const o:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(res.statusCode!==200)reject(new Error(String(object(o).error??'Local request failed.')));else resolve(o);}catch(e){reject(e);}});});req.on('error',reject);req.setTimeout(timeout,()=>req.destroy(new Error('Local collector timed out.')));if(body)req.write(body);req.end();});
}
export async function openBrowser(url:string):Promise<void>{
  const cmd=process.platform==='win32'?'powershell.exe':process.platform==='darwin'?'open':'xdg-open';
  const args=process.platform==='win32'?['-NoProfile','-NonInteractive','-Command',`Start-Process '${url.replace(/'/g,"''")}'`]:[url];
  await new Promise<void>((resolve,reject)=>{const child=spawn(cmd,args,{stdio:'ignore',windowsHide:true,detached:process.platform!=='win32'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
}
async function body(req:http.IncomingMessage):Promise<unknown>{const chunks:Buffer[]=[];let n=0;for await(const item of req){const b=Buffer.isBuffer(item)?item:Buffer.from(item as string);n+=b.length;if(n>1024*1024)throw new Error('Request too large.');chunks.push(b);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
export interface Service { url:string; close:()=>Promise<void> }
export async function startService(home:string,open=false):Promise<Service>{
  const config=loadConfig(home);const worker=new Worker(path.join(__dirname,'worker.js'),{workerData:{home}});
  let sequence=0;const pending=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
  let readyResolve:()=>void=()=>{};let readyReject:(e:Error)=>void=()=>{};
  const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const rejectAll=(e:Error):void=>{readyReject(e);for(const p of pending.values()){clearTimeout(p.timer);p.reject(e);}pending.clear();};
  worker.on('error',rejectAll);worker.on('exit',code=>{if(code!==0)rejectAll(new Error('Collector worker stopped unexpectedly.'));});
  worker.on('message',(raw:unknown)=>{const m=object(raw);if(m.event==='ready'){readyResolve();return;}const id=Number(m.id);const p=pending.get(id);if(p){pending.delete(id);clearTimeout(p.timer);if(m.error)p.reject(new Error(String(m.error)));else p.resolve(m.result);}});
  const call=(command:string,payload?:unknown):Promise<unknown>=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Collector is busy; retry after reconciliation.'));},command==='hook'?2000:15000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,command,payload});});
  await ready;
  const sessions=new Set<string>();let localPort=config.port;
  const json=(res:http.ServerResponse,status:number,value:unknown):void=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  let shutdown: (()=>Promise<void>)|null=null;
  const server=http.createServer((req,res)=>{void(async()=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const hosts=[`127.0.0.1:${localPort}`,`localhost:${localPort}`];if(!hosts.includes(req.headers.host??'')){json(res,403,{error:'Invalid host.'});return;}
    if(req.headers.origin&&!hosts.map(h=>`http://${h}`).includes(req.headers.origin)){json(res,403,{error:'Invalid origin.'});return;}
    const url=new URL(req.url??'/',`http://127.0.0.1:${localPort}`);
    const bearer=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'';
    const internal=safeEqual(bearer,config.token);const cookie=(req.headers.cookie??'').split(';').map(v=>v.trim()).find(v=>v.startsWith('codex_report_session='))?.split('=')[1];
    const authorized=internal||Boolean(cookie&&sessions.has(cookie));
    if(url.pathname==='/api/session'&&req.method==='POST'){
      const input=object(await body(req));if(typeof input.token!=='string'||!safeEqual(input.token,config.token)){json(res,403,{error:'Invalid access token.'});return;}
      if(sessions.size>16)sessions.clear();const id=crypto.randomBytes(32).toString('hex');sessions.add(id);res.setHeader('Set-Cookie',`codex_report_session=${id}; HttpOnly; SameSite=Strict; Path=/`);json(res,200,{ok:true});return;}
    if(url.pathname.startsWith('/api/')){
      if(!authorized){json(res,401,{error:'Open the tokenized dashboard address printed by codex-report start.'});return;}
      if(req.method==='GET'&&url.pathname==='/api/report'){json(res,200,await call('report',Object.fromEntries(url.searchParams)));return;}
      if(req.method==='GET'&&url.pathname==='/api/status'){json(res,200,{...object(await call('revision')),startedAt:started,version:'0.0.1-dev',accounts:['all',...new Set(config.sources.map(s=>s.account)),...Object.keys(config.accounts)],pollMs:config.pollMs});return;}
      if(internal&&req.method==='POST'&&url.pathname==='/api/hook'){json(res,200,await call('hook',await body(req)));return;}
      if(internal&&req.method==='POST'&&url.pathname==='/api/sync'){json(res,200,await call('sync'));return;}
      if(internal&&req.method==='POST'&&url.pathname==='/api/stop'){json(res,200,{stopping:true});setImmediate(()=>{void shutdown?.();});return;}
      json(res,404,{error:'No such route.'});return;
    }
    if(req.method!=='GET'){json(res,405,{error:'Read-only dashboard.'});return;}
    const assets:Record<string,[string,string]>={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
    const asset=assets[url.pathname];if(!asset){json(res,404,{error:'Not found.'});return;}
    res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8','Cache-Control':'no-cache'});res.end(fs.readFileSync(path.resolve(__dirname,'../public',asset[0])));
  })().catch(e=>{if(!res.headersSent)json(res,500,{error:message(e)});else res.destroy();});});
  server.requestTimeout=5000;server.headersTimeout=5000;const started=new Date().toISOString();
  try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'127.0.0.1',resolve);});}
  catch(e){await worker.terminate();throw e;}
  const address=server.address();if(!address||typeof address==='string')throw new Error('No listener address.');localPort=address.port;
  writeJson(path.join(home,'runtime.json'),{pid:process.pid,port:localPort,startedAt:started});
  const url=`http://127.0.0.1:${localPort}/#token=${config.token}`;
  if(open)try{await openBrowser(url);}catch{process.stderr.write('Browser could not be opened automatically; use the printed address.\n');}
  let closing=false;
  shutdown=async()=>{if(closing)return;closing=true;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));try{await call('stop');}catch{}await worker.terminate();const r=runtime(home);if(r?.pid===process.pid)fs.rmSync(path.join(home,'runtime.json'),{force:true});};
  return {url,close:shutdown};
}
export function publicConfig(c:Config):Record<string,unknown> {return{...c,token:'[redacted]'};}
