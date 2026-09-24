import { parentPort, workerData } from 'node:worker_threads';
import { loadConfig } from './config';
import { Store } from './database';
import { Collector } from './collector';
import { report, filter } from './reports';
import { handleHook, HookInput } from './hooks';
import { object, message } from './util';
const port=parentPort;if(!port)throw new Error('Collector worker requires a parent.');
const home=String(object(workerData).home);const config=loadConfig(home);const store=new Store(home);const collector=new Collector(store,config);
let queue=Promise.resolve();let polling=false;let stopped=false;
function schedule(action:()=>Promise<void>):void {queue=queue.then(action).catch(e=>port?.postMessage({event:'error',error:message(e)}));}
port.on('message',(raw:unknown)=>{const m=object(raw);schedule(async()=>{try{let result:unknown;
  if(m.command==='report')result=report(store,config,filter(m.payload));
  else if(m.command==='revision')result={revision:store.revision(),backend:store.backend};
  else if(m.command==='hook')result=await handleHook(store,config,m.payload as HookInput);
  else if(m.command==='sync')result=await collector.sync({deadline:Date.now()+1200});
  else if(m.command==='stop'){stopped=true;clearInterval(timer);store.close();result={stopped:true};}
  else throw new Error('Unknown collector request.');
  port?.postMessage({id:m.id,result});if(stopped)port?.close();
}catch(e){port?.postMessage({id:m.id,error:message(e)});}});});
const tick=():void=>{if(polling||stopped)return;polling=true;schedule(async()=>{try{await collector.sync({deadline:Date.now()+650});port?.postMessage({event:'revision',revision:store.revision()});}finally{polling=false;}});};
const timer=setInterval(tick,config.pollMs);port.postMessage({event:'ready',backend:store.backend});tick();
