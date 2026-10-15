'use strict';
// A source timeout with nothing saved retries once on a smaller plan; a second timeout is reported.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
async function check(secondOk){
 const bodies=[];let job=0;
 const w={SupabaseAuth:{getAccessToken:()=>'fixture',getUser:()=>({id:'a'})},SKYLARK_CONFIG:{}};
 const ctx=vm.createContext({window:w,console,AbortController,clearTimeout,Math,Date,
  setTimeout:(fn,ms)=>setTimeout(fn,ms===1000?1:ms),
  fetch:async(url,opts)=>{
   if(opts.method==='POST'){bodies.push(JSON.parse(opts.body));job++;return{ok:true,json:async()=>({job:{id:'j'+job}})};}
   const ok=job===2&&secondOk;
   return{ok:true,json:async()=>({job:{status:ok?'completed':'failed',result_count:ok?1:0,updated_at:Date.now()/1000,
     error:ok?null:'Lead sources timed out before returning contacts.'},leads:ok?[{id:'r'}]:[]})};
  }});
 vm.runInContext(fs.readFileSync('lead-jobs-client.js','utf8'),ctx);
 let rows,error;
 try{rows=await w.NexusLeadJobs.run({locations:['Gurugram'],industries:[],countPerCombo:20,sources:['sulekha','justdial','maps','apify']},{});}catch(e){error=e;}
 assert.equal(bodies.length,2,'exactly one retry');
 assert.equal(bodies[1].industries.length,3,'retry narrows to three categories');
 assert.deepEqual(bodies[1].sources,['maps','apify'],'retry skips slow directories');
 if(secondOk)assert.equal(rows.length,1);else assert.match(error.message,/timed out/);
}
(async()=>{await check(true);await check(false);console.log('Lead timeout retry: passed');})().catch(e=>{console.error(e);process.exitCode=1});
