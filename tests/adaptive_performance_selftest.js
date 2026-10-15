'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('clavis-perf.js','utf8');
async function context(memory,cores,hardware){
 let time=100000,raf=[],nodes=new Map(),attributes={};
 const document={hidden:false,readyState:'complete',head:{appendChild:n=>nodes.set(n.id,n)},documentElement:{classList:{toggle(){}},setAttribute:(k,v)=>attributes[k]=v,getAttribute:k=>attributes[k]},getElementById:id=>nodes.get(id)||null,createElement:()=>({style:{},textContent:''}),addEventListener(){}};
 const storage=new Map(),window={RudraDesktop:hardware?{hardware:async()=>hardware}:null,dispatchEvent(){}};
 const env={window,document,navigator:{deviceMemory:memory,hardwareConcurrency:cores},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},Date:{now:()=>time},Number,Set,CustomEvent:class{},setTimeout(){},requestAnimationFrame:fn=>raf.push(fn)};
 vm.runInNewContext(source,env);await Promise.resolve();await Promise.resolve();
 return {api:window.ClavisPerf,attributes,nodes,frames(ms){time+=31000;window.ClavisPerf.sample();for(let i=1;i<=91&&raf.length;i++){const batch=raf;raf=[];batch.forEach(f=>f(i*ms));}}};
}
(async()=>{
 const unknown=await context(undefined,undefined);assert.equal(unknown.api.tier(),'lite');
 const low=await context(4,8);assert.equal(low.api.tier(),'lite');assert(low.nodes.get('cx-perf-style').textContent.includes('backdrop-filter: none'));
 const full=await context(8,8);assert.equal(full.api.tier(),'full');full.frames(45);assert.equal(full.api.tier(),'lite');full.frames(16);assert.equal(full.api.tier(),'lite');full.frames(16);assert.equal(full.api.tier(),'full');
 const desktop=await context(undefined,undefined,{memoryGB:16,cores:8});assert.equal(desktop.api.tier(),'full');
 low.api.set('full');assert.equal(low.api.tier(),'full');low.api.set('auto');assert.equal(low.api.tier(),'lite');
 console.log('PASS adaptive graphics: unknown memory, 4GB lite, native hints, slow frame downgrade, recovery hysteresis and manual override');
})().catch(e=>{console.error(e);process.exitCode=1;});
