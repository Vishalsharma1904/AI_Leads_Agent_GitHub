const vm=require('vm'),fs=require('fs'),assert=require('node:assert/strict');
let polls=0;const events=[];
const w={SKYLARK_CONFIG:{APIFY_API_KEYS:['fixture']}};
const c=vm.createContext({window:w,console,AbortController,setTimeout:(fn,ms)=>setTimeout(fn,ms<10000?1:ms),clearTimeout,
 localStorage:{getItem:()=>null},fetch:async url=>{
 let json;if(url.includes('/acts/'))json={data:{id:'fixture-run',defaultDatasetId:'fixture-data'}};
 else if(url.includes('/actor-runs/')){polls++;json={data:{status:polls<3?'RUNNING':'SUCCEEDED',statusMessage:'Waiting for public listing results'}};}
 else json=[];
 return {ok:true,text:async()=>JSON.stringify(json)};
 }});
vm.runInContext(fs.readFileSync('apify-leads.js','utf8'),c);
w.ApifyLeads.search({queries:['Hotels in Delhi'],maxPerQuery:2,onProgress:e=>events.push(e)}).then(()=>{
 assert.ok(events.length>=2,'unchanged dataset count still reports real provider status');
 assert.ok(events.some(e=>e.text.includes('Waiting for public listing results')));
 console.log('Apify progress heartbeat with unchanged dataset: passed');
}).catch(e=>{console.error(e);process.exitCode=1});
