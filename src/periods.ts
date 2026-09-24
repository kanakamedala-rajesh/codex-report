import { Account } from './config';
export interface Period { from:string|null; to:string|null; label:string; timezone:string }
function parts(ms:number,zone:string):number[] {
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(ms);
  return ['year','month','day','hour','minute','second'].map(k=>Number(p.find(e=>e.type===k)?.value??0));
}
function utc(p:number[]):number {return Date.UTC(p[0]??2000,(p[1]??1)-1,p[2]??1,p[3]??0,p[4]??0,p[5]??0);}
export function wallInstant(p:number[],zone:string):number {
  const wall=utc(p); const offsets=new Set<number>();
  for(const step of [-172800000,-86400000,0,86400000,172800000]) {const t=wall+step;offsets.add(utc(parts(t,zone))-t);}
  const candidates=[...offsets].map(o=>wall-o).sort((a,b)=>a-b);
  const exact=candidates.filter(t=>utc(parts(t,zone))===wall);
  if(exact.length)return exact[0]??wall;
  // A nonexistent wall time moves forward across the DST gap, not backward.
  return candidates.filter(t=>utc(parts(t,zone))>wall).sort((a,b)=>utc(parts(a,zone))-utc(parts(b,zone)))[0]??wall;
}
export function period(scope:string,zone:string,account:Account={},now=Date.now(),from?:string,to?:string):Period {
  zone=account.timezone??zone;
  if(from||to) { const f=from?new Date(from).toISOString():null,t=to?new Date(to).toISOString():null;if(f&&t&&f>=t)throw new Error('from must be earlier than to.');return{from:f,to:t,label:'custom',timezone:zone}; }
  if(scope==='lifetime'||scope==='thread'||scope==='task')return{from:null,to:null,label:scope,timezone:zone};
  if(scope==='5h')return{from:new Date(now-18000000).toISOString(),to:new Date(now).toISOString(),label:'last five hours',timezone:zone};
  const p=parts(now,zone);let y=p[0]??2000,m=p[1]??1,d=p[2]??1;
  let start:number,end:number;
  if(scope==='day'||scope==='week'){
    const wallDay=new Date(Date.UTC(y,m-1,d));
    if(scope==='week')wallDay.setUTCDate(wallDay.getUTCDate()-((wallDay.getUTCDay()+6)%7));
    start=wallInstant([wallDay.getUTCFullYear(),wallDay.getUTCMonth()+1,wallDay.getUTCDate(),0,0,0],zone);
    wallDay.setUTCDate(wallDay.getUTCDate()+(scope==='week'?7:1));end=wallInstant([wallDay.getUTCFullYear(),wallDay.getUTCMonth()+1,wallDay.getUTCDate(),0,0,0],zone);
  }else if(scope==='cycle'||scope==='month'){
    const anchor=scope==='cycle'?(account.billingDay??1):1;
    const [hh=0,mm=0]=(account.billingTime??'00:00').split(':').map(Number);
    const boundary=(year:number,month:number):number=>{const dt=new Date(Date.UTC(year,month-1,1));year=dt.getUTCFullYear();month=dt.getUTCMonth()+1;
      const day=Math.min(anchor,new Date(Date.UTC(year,month,0)).getUTCDate());return wallInstant([year,month,day,hh,mm,0],zone);};
    start=boundary(y,m);if(start>now){m--;if(m===0){m=12;y--;}start=boundary(y,m);}end=boundary(y,m+1);
  }else throw new Error('Unknown report period.');
  return{from:new Date(start).toISOString(),to:new Date(end).toISOString(),label:scope==='cycle'?(account.billingDay?'billing cycle':'calendar month'):scope,timezone:zone};
}
