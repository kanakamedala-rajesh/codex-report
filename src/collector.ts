import fs from 'node:fs';
import path from 'node:path';
import { Store } from './database';
import { Config, Source } from './config';
import { initialState, ParseState } from './types';
import { parseRecord } from './parser';
import { loadPrices, priceSample } from './pricing';
import { compressedBytes } from './compression';
import { within, hash } from './util';
export interface ImportResult { files: number; added: number; partial: number; failed: number; missing: number; pending: boolean; at: string }
export function sourceRoots(config: Config): string[] { return config.sources.flatMap(s=> s.kind === 'codex-home' ? [path.join(s.path,'sessions'),path.join(s.path,'archived_sessions')] : [s.path]); }
export function discover(root: string, cap = 20000): string[] {
  const found: string[]=[];
  if (!fs.existsSync(root)) return found;
  const queue=[root];
  while(queue.length && found.length<cap) {
    const dir=queue.pop(); if(!dir)break;
    if(fs.lstatSync(dir).isSymbolicLink())continue;
    if(fs.statSync(dir).isFile()){ if(/\.jsonl(\.gz|\.zst)?$/.test(dir))found.push(dir);continue; }
    for(const d of fs.readdirSync(dir,{withFileTypes:true})) {
      if(d.isSymbolicLink())continue;
      const p=path.join(dir,d.name);
      if(d.isDirectory())queue.push(p);
      else if(d.isFile()&&/\.jsonl(\.gz|\.zst)?$/.test(d.name))found.push(p);
    }
  }
  return found;
}
interface Cursor { size:number; mtime:number; offset:number; state:string; health:string }
interface SavedState { parser:ParseState; prefix:string; prefixLength:number }
export class Collector {
  constructor(readonly store:Store, readonly config:Config) {}
  async file(file:string,account='unattributed',deadline=Infinity,live?:{turn:string;account:string}):Promise<{added:number;partial:boolean}> {
    file=fs.realpathSync(file);
    const stat=fs.statSync(file); const limit=this.config.maxFileMb*1024*1024;
    const compressed=/\.(gz|zst)$/.test(file);
    const old=this.store.db.prepare('SELECT * FROM cursors WHERE path=?').get(file) as unknown as Cursor|undefined;
    if(old && old.size===stat.size && old.mtime===stat.mtimeMs && old.health==='current')return{added:0,partial:false};
    let state=initialState(),offset=0,prefix='',prefixLength=0;
    if(!compressed && old) {
      try { const saved=JSON.parse(old.state) as SavedState; const fd=fs.openSync(file,'r');
        const buf=Buffer.alloc(saved.prefixLength);fs.readSync(fd,buf,0,buf.length,0);fs.closeSync(fd);
        if(stat.size>=old.offset && hash(buf)===saved.prefix) {state=saved.parser;offset=old.offset;prefix=saved.prefix;prefixLength=saved.prefixLength;}
      }catch{ this.store.addIssue(file,'cursor_rebuild'); }
    }
    if(stat.size>limit && !old)throw new Error('Source exceeds configured file bound.');
    let bytes:Buffer;
    if(compressed) {bytes=await compressedBytes(file,limit,Math.min(20000,Math.max(50,deadline-Date.now())));offset=0;}
    else { const count=Math.min(stat.size-offset,limit); const fd=fs.openSync(file,'r'); try{bytes=Buffer.alloc(count);const n=fs.readSync(fd,bytes,0,count,offset);bytes=bytes.subarray(0,n);}finally{fs.closeSync(fd);} }
    if(!prefixLength && !compressed) {prefixLength=Math.min(stat.size,256);const fd=fs.openSync(file,'r');const b=Buffer.alloc(prefixLength);try{fs.readSync(fd,b,0,b.length,0);}finally{fs.closeSync(fd);}prefix=hash(b);}
    const prices=loadPrices(this.store.home);let index=0,added=0,partial=false,processed=0;
    // Commit usage and parser position together; never checkpoint an incomplete line.
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
    while(index<bytes.length) {
      if(Date.now()>=deadline) {partial=true;break;}
      const stop=bytes.indexOf(10,index);if(stop<0){partial=true;break;}
      if(stop-index>8*1024*1024)throw new Error('A source record exceeds 8 MiB.');
      const text=bytes.subarray(index,stop).toString('utf8').replace(/^\uFEFF/,'');
      let parsed:unknown;
      try {parsed=text.trim()?JSON.parse(text):null;}catch{this.store.addIssue(state.owner?.id??file,'malformed_record');index=stop+1;continue;}
      const b=parseRecord(parsed,state,account,this.config.deviceId);
      if(live) for(const s of b.samples) if(s.turn===live.turn)s.account=live.account;
      b.samples=b.samples.map(s=>priceSample(s,prices,this.config.priceBasis));
      added+=this.store.writeBatch(b); index=stop+1;processed++;
      if(processed%250===0)await new Promise<void>(resolve=>setImmediate(resolve));
    }
    const next=compressed?index:offset+index;
    if(!compressed && next<stat.size)partial=true;
    const saved:SavedState={parser:state,prefix,prefixLength};
    this.store.db.prepare('INSERT INTO cursors VALUES(?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET size=excluded.size,mtime=excluded.mtime,offset=excluded.offset,state=excluded.state,health=excluded.health,at=excluded.at').run(file,stat.size,stat.mtimeMs,next,JSON.stringify(saved),partial?'pending':'current',new Date().toISOString());
    this.store.db.exec('COMMIT');
    return{added,partial};
    } catch(error) { this.store.db.exec('ROLLBACK'); throw error; }
  }
  async sync(options:{deadline?:number;paths?:string[];account?:string}={}):Promise<ImportResult> {
    const result:ImportResult={files:0,added:0,partial:0,failed:0,missing:0,pending:false,at:new Date().toISOString()};
    const deadline=options.deadline??Infinity;
    const sources:Source[]=options.paths?options.paths.map((p,i)=>({name:`explicit-${i}`,path:path.resolve(p),kind:'rollouts',account:options.account??'unattributed'})):this.config.sources;
    const candidates:{p:string;account:string;mtime:number}[]=[];
    for(const s of sources)for(const root of s.kind==='codex-home'?[path.join(s.path,'sessions'),path.join(s.path,'archived_sessions')]:[s.path]) {
      if(!fs.existsSync(root)){result.missing++;continue;}
      for(const p of discover(root)) { if(p.endsWith('.zst')&&fs.existsSync(p.slice(0,-4)))continue;
        try{candidates.push({p,account:s.account,mtime:fs.statSync(p).mtimeMs});}catch{result.failed++;} }
    }
    candidates.sort((a,b)=>b.mtime-a.mtime);
    for(const {p,account} of candidates) {
      if(Date.now()>=deadline){result.pending=true;break;}
      try{const r=await this.file(p,account,deadline);result.files++;result.added+=r.added;if(r.partial)result.partial++;}
      catch{result.failed++;this.store.addIssue(p,'source_read_or_decode_failed');}
    }
    this.store.db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('collection',JSON.stringify(result));
    return result;
  }
  allowed(file:string):boolean {return within(file,sourceRoots(this.config));}
}
