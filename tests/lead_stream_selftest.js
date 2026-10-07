'use strict';
const assert=require('node:assert/strict'), fs=require('fs'), vm=require('vm');
const memory=new Map(), statuses=[];
let requests=0, stopOnCompany=false, fallbackTest=false, fallbackCalls=0, scraper;
const places=[
 {title:'Fixture Company A',address:'Delhi',city:'Delhi',website:'https://a.example.test',phone:'9811100042'},
 {title:'Fixture Company B',address:'Delhi',city:'Delhi',website:'https://b.example.test'}
];
const w={AppSettings:{get:()=>false,rounds:()=>1},ApifyLeads:{hasToken:()=>true,search:async()=>places},
 SupabaseAuth:{getAccessToken:()=> 'fixture'},addEventListener(){},dispatchEvent(){}};
const context=vm.createContext({window:w,console,crypto,URL,AbortController,setTimeout,clearTimeout,TextDecoder,
localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},
fetch:async(url,opts)=>{
 if(url.endsWith('/health')) return {ok:fallbackTest,json:async()=>({status:'healthy'})};
 if(url.endsWith('/leads/maps-search')&&fallbackTest){fallbackCalls++;return {ok:true,json:async()=>({items:[{...places[1],phone:'9811100043'}]})};}
 requests++; assert.match(url,/enrich-websites\/stream$/);
 const rows=JSON.parse(opts.body).records;
 assert.equal(rows[0].company,'Fixture Company A','send profile identity with website');
 const enriched={...rows[1],phone:'9811100043',email:'observed@b.example.test',crawler_enriched:true};
 const stream=new ReadableStream({start(controller){
  opts.signal.addEventListener('abort',()=>controller.error(new Error('aborted')));
  const enc=new TextEncoder();
  controller.enqueue(enc.encode(JSON.stringify({type:'page',phase:'websites',company:'Fixture Company B',companyIndex:2,companyTotal:2,label:'Company 2/2 · Fixture Company B · reading public website',records:[enriched]})+'\n'));
  if(!stopOnCompany) {
   // A UTF-8 company name split across chunks must decode correctly.
   const chunk=enc.encode(JSON.stringify({type:'result',records:[rows[0],enriched]})+'\n');
   controller.enqueue(chunk.slice(0,9));controller.enqueue(chunk.slice(9));controller.close();
  }
 }});
 return {ok:true,body:stream};
}});
vm.runInContext(fs.readFileSync('real-scraper.js','utf8'),context); scraper=w.RealScraper;
scraper.setCallbacks({onStatus:d=>{statuses.push(d);if(stopOnCompany&&d.companyIndex===2)scraper.abort();}});
(async()=>{
 const opts={industries:['Hotels'],locations:['Delhi'],targetCount:2,autoExcel:false,saveToDb:false};
 const result=await scraper.run(opts);
 assert.equal(result.length,2); assert.ok(result.some(l=>l.email==='observed@b.example.test'));
 assert.ok(statuses.some(d=>d.companyIndex===2&&d.companyTotal===2),'company-specific work reaches the UI');
 memory.clear(); stopOnCompany=true;
 let completion; scraper.setCallbacks({onComplete:s=>completion=s});
 const start=Date.now(); const stopped=await scraper.run(opts);
 assert.ok(Date.now()-start<1000,'Stop cancels a pending website stream promptly');
 assert.equal(stopped.length,2,'contacts observed before Stop survive'); assert.equal(completion.stopped,true);
 assert.equal(requests,2,'no automatic paid discovery retry');
 memory.clear(); stopOnCompany=false; fallbackTest=true; let paidRuns=0;
 w.ApifyLeads.search=async()=>{paidRuns++;return places.slice(0,1);};
 const recovered=await scraper.run(opts);
 assert.equal(recovered.length,2,'keyless fallback fills the short paid result');
 assert.equal(fallbackCalls,1);assert.equal(paidRuns,1,'fallback never starts a second paid actor');
 console.log('Streamed company updates, incremental contacts, Stop cancellation: passed');
})().catch(e=>{console.error(e);process.exitCode=1});
