'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
async function check(mode){
 let owner='owner-a',polls=0,posts=0,cancels=0; const progress=[];
 const w={SupabaseAuth:{getAccessToken:()=> 'fixture',getUser:()=>({id:owner})},SKYLARK_CONFIG:{}};
 const context=vm.createContext({window:w,console,AbortController,clearTimeout,Math,Date,
  setTimeout:(fn,ms)=>setTimeout(fn,ms===1000?1:ms),
  fetch:async(url,opts)=>{
   if(url.endsWith('/cancel')){cancels++;return{ok:true,json:async()=>({})};}
   if(opts.method==='POST'){posts++;return{ok:true,json:async()=>({job:{id:'fixture-job'}})};}
   polls++;
   if(mode==='disconnected'&&polls>1)throw new Error('connection lost');
   const state=mode==='failed'&&polls>1?'failed':'running';
   return{ok:true,json:async()=>({job:{status:state,stage:'Company 1/2: fixture',result_count:1,
    updated_at:Date.now()/1000-(mode==='stale'?200:0),error:state==='failed'?'provider failed':null},leads:[{id:'fixture-row',title:'Fixture'}]})};
  }});
 vm.runInContext(fs.readFileSync('lead-jobs-client.js','utf8'),context);
 let rows,error;
 try{rows=await w.NexusLeadJobs.run({locations:['Delhi'],industries:['Hotels'],countPerCombo:2},{onProgressDetails:d=>{progress.push(d);if(mode==='switch')owner='owner-b';}});}catch(e){error=e;}
 assert.equal(posts,1,'poll reconnects never duplicate sourcing POSTs');
 if(mode==='switch'){assert.match(error.message,/Account changed/);assert.equal(cancels,0,'account B cannot cancel account A job');}
 else{assert.equal(rows.length,1,'failure/stale/connection loss preserves saved contacts');}
 if(mode==='stale')assert.equal(cancels,1,'stale job is explicitly stopped');
 if(mode==='disconnected')assert.ok(progress.some(d=>d.status==='reconnecting'));
}
(async()=>{for(const mode of ['failed','stale','disconnected','switch'])await check(mode);console.log('Lead polling failure, stale-worker recovery, reconnect, account switch: passed');})().catch(e=>{console.error(e);process.exitCode=1});
