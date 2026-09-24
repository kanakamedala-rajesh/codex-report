import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Config } from './config';
import { Store } from './database';
import { Collector } from './collector';
import { report, receipt } from './reports';
import { Turn } from './types';
import { clean, object, readJson, writeJson, privateDir, hash } from './util';
const EVENTS=['Stop','Interrupt','SubagentStop','SessionStart'] as const;
export interface HookInput { event:string; thread:string; turn:string; transcript:string; account:string }
export function projectHook(raw:unknown):HookInput {
  const p=object(raw);return{event:clean(p.hook_event_name),thread:clean(p.session_id,240),turn:clean(p.turn_id,240),transcript:typeof p.agent_transcript_path==='string'?p.agent_transcript_path:typeof p.transcript_path==='string'?p.transcript_path:'',account:clean(process.env.CODEX_REPORT_ACCOUNT)||'unattributed'};
}
function quote(v:string):string {return "'"+v.replace(/'/g,"'\\''")+"'";}
export function hookCommand(home:string,windows=process.platform==='win32'):string {
  const executable=process.execPath;const entry=path.resolve(__dirname,'cli.js');
  if(windows){const q=(s:string)=>"'"+s.replace(/'/g,"''")+"'";
    // Read stdin as bytes in Node; PowerShell only invokes the selected executable.
    const command=`& ${q(executable)} ${q(entry)} --home ${q(home)} hook; exit $LASTEXITCODE`;
    return 'powershell.exe -NoProfile -NonInteractive -EncodedCommand '+Buffer.from(command,'utf16le').toString('base64');}
  return [executable,entry,'--home',home,'hook'].map(quote).join(' ');
}
export function configureHooks(home:string,codexHome:string,remove=false):Record<string,unknown> {
  const file=path.join(codexHome,'hooks.json');const manifestFile=path.join(home,'managed-hooks.json');
  const manifest=fs.existsSync(manifestFile)?object(readJson(manifestFile)):{};
  const root=fs.existsSync(file)?object(readJson(file)):{};const hooks=object(root.hooks);
  const previous=object(manifest[file]);const command=hookCommand(home);
  let changed=false;
  for(const event of EVENTS){const original=hooks[event];if(original!==undefined&&!Array.isArray(original))throw new Error(`Invalid ${event} hooks configuration.`);
    const groups=(Array.isArray(original)?original:[]).map(value=>object(value));
    const kept:Record<string,unknown>[]=[];
    for(const group of groups){if(!Array.isArray(group.hooks))throw new Error('Invalid hook group.');
      const entries=group.hooks.filter((entry:unknown)=>JSON.stringify(entry)!==JSON.stringify(previous[event]));
      if(entries.length)kept.push({...group,hooks:entries});}
    if(!remove){const entry={type:'command',command,timeout:event==='Interrupt'?3:5,statusMessage:`Codex Report: ${event==='Stop'?'turn report':event==='Interrupt'?'interruption report':'collect usage'}`};kept.push({hooks:[entry]});previous[event]=entry;}
    if(JSON.stringify(kept)!==JSON.stringify(groups))changed=true;
    if(kept.length)hooks[event]=kept;else delete hooks[event];
  }
  if(changed){privateDir(codexHome);if(fs.existsSync(file)){const backups=path.join(home,'backups');privateDir(backups);fs.copyFileSync(file,path.join(backups,`hooks-${crypto.randomUUID()}.json`));}
    writeJson(file,{...root,hooks});}
  if(remove)delete manifest[file];else manifest[file]=previous;writeJson(manifestFile,manifest);
  return{file,changed,removed:remove,trust:'Review changed handlers using /hooks in Codex. Trust is never bypassed.'};
}
export function inspectHooks(home:string):Record<string,unknown>[] {
  const file=path.join(home,'managed-hooks.json');if(!fs.existsSync(file))return[];
  const result:Record<string,unknown>[]=[];
  for(const [target,defs] of Object.entries(object(readJson(file)))){
    let hooks:Record<string,unknown>={};try{hooks=object(object(readJson(target)).hooks);}catch{}
    for(const [event,expected] of Object.entries(object(defs))){const groups=hooks[event];const found=Array.isArray(groups)&&groups.some(g=>Array.isArray(object(g).hooks)&&(object(g).hooks as unknown[]).some(h=>JSON.stringify(h)===JSON.stringify(expected)));
      result.push({file:target,event,present:found});}
  }
  return result;
}
export async function handleHook(store:Store,config:Config,input:HookInput):Promise<Record<string,string>> {
  if(!EVENTS.includes(input.event as typeof EVENTS[number]))return{};
  const collector=new Collector(store,config);const deadline=Date.now()+(input.event==='Interrupt'?1200:2600);
  if(!input.transcript||!collector.allowed(input.transcript))return{};
  const source=config.sources.find(s=>input.transcript.startsWith(s.path+path.sep));
  try{await collector.file(input.transcript,'unattributed',deadline,{turn:input.turn,account:input.account==='unattributed'?(source?.account??'unattributed'):input.account});}
  catch{store.addIssue(input.thread||'hook','hook_collection_pending');}
  if(!['Stop','Interrupt'].includes(input.event)||!input.thread||!input.turn)return{};
  const t=store.db.prepare('SELECT * FROM turns WHERE thread=? AND id=?').get(input.thread,input.turn) as unknown as Turn|undefined;
  if(t){const status=input.event==='Interrupt'?'interrupted':'stopping';const at=new Date().toISOString();store.putTurn({...t,status,ended:input.event==='Interrupt'?at:t.ended,durationMs:Date.parse(at)-Date.parse(t.started)});store.bump();}
  if(config.display==='quiet')return{};
  const r=report(store,config,{scope:'task',thread:input.thread,turn:input.turn,account:config.reportAccount});const task=r.tasks[0];
  if(!task)return{systemMessage:'Codex Report: no attributable usage recorded yet. Start the dashboard collector to reconcile this turn.'};
  const cycle=report(store,config,{scope:'cycle'});const text=receipt(task,cycle,input.event==='Interrupt'?'interrupted':undefined);
  const key=input.thread+':'+input.turn+':'+input.event;const fingerprint=hash(text);
  if(store.db.prepare('SELECT fingerprint FROM emissions WHERE key=?').get(key)?.fingerprint===fingerprint)return{};
  store.db.prepare('INSERT INTO emissions VALUES(?,?) ON CONFLICT(key) DO UPDATE SET fingerprint=excluded.fingerprint').run(key,fingerprint);
  return{systemMessage:text};
}
