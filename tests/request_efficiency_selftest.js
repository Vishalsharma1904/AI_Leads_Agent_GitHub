'use strict';
const { strict: assert } = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const source = fs.readFileSync(process.env.CLAVIS_DIRECT_TEST_SOURCE || path.join(__dirname, '../clavis-direct.js'), 'utf8');
const storage = () => { const m = new Map(); return { getItem: k => m.get(k) || null, setItem: (k,v) => m.set(k,String(v)), removeItem:k=>m.delete(k) }; };
function client(fetch, vault) {
  const localStorage = storage();
  localStorage.setItem('clavis_provider_keys', JSON.stringify({gemini:'test-key-not-real'}));
  const w = { addEventListener(){}, dispatchEvent(){}, SKYLARK_CONFIG:{}, ClavisWake:{allowBackground:()=>true}, ClavisKeyVault:vault };
  vm.runInNewContext(source, {window:w, localStorage, sessionStorage:storage(), location:{protocol:'http:',origin:'http://localhost'}, fetch, AbortController, TextDecoder, Uint8Array, setTimeout, clearTimeout, console, CustomEvent:class {}});
  return w.ClavisDirect;
}
const ok = () => ({ok:true,json:async()=>({candidates:[{content:{parts:[{text:'answer'}]}}]})});
async function main() {
  let failed=0;
  async function check(name, fn) { try { await fn(); console.log('PASS '+name); } catch(e){ failed++; console.error('FAIL '+name+': '+e.message); } }
  await check('failed default skipped on following turn', async()=>{
    const calls=[]; const c=client(async url=>{calls.push(url); return url.includes('flash-lite')?{ok:false,status:404,json:async()=>({error:{message:'model not found'}})}:ok();});
    await c.complete({messages:[{role:'user',content:'one'}]});
    const before=calls.length;
    await c.complete({messages:[{role:'user',content:'two'}]});
    assert.equal(calls.length-before,1);
  });
  await check('concurrent model discovery shares one request', async()=>{
    let calls=0; const c=client(async()=>{calls++; await new Promise(r=>setTimeout(r,20)); return {ok:true,json:async()=>({models:[{name:'models/gemini-3.8-flash',supportedGenerationMethods:['generateContent']}]})};});
    await Promise.all(Array.from({length:5},()=>c.discoverModels('gemini','fake',false)));
    assert.equal(calls,1);
  });
  await check('already cancelled request sends no network call', async()=>{
    let calls=0; const c=client(async()=>{calls++; return ok();}); const a=new AbortController();a.abort();
    await assert.rejects(c.complete({messages:[]},a.signal),e=>e.name==='AbortError');assert.equal(calls,0);
  });
  await check('stream failure never replays through another model', async()=>{
    let calls=0, reads=0;const spoken=[];
    const c=client(async()=>{calls++;return {ok:true,body:{getReader:()=>({read:async()=>{if(reads++===0)return {value:new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"First sentence."}]}}]}\n\n')};throw Object.assign(new Error('stream lost'),{status:503});},cancel:async()=>{},releaseLock(){}})}};});
    await assert.rejects(c.complete({messages:[],onToken:t=>spoken.push(t)}));assert.equal(calls,1);assert.deepEqual(spoken,['First sentence.']);
  });
  await check('SSE provider errors and empty streams are failures', async()=>{
    for (const frame of ['event: error\ndata: {"message":"Invalid request","code":400}\n\n', 'data: [DONE]\n\n']) {
      let calls=0, read=false;
      const c=client(async()=>{calls++;return {ok:true,body:{getReader:()=>({read:async()=>read?{done:true}:(read=true,{value:new TextEncoder().encode(frame),done:false}),cancel:async()=>{},releaseLock(){}})}};});
      await assert.rejects(c.complete({messages:[],onToken:()=>{}}));
      assert.ok(calls>=1);
      assert.equal(c.requestDiagnostics().providerErrors,calls);
    }
  });
  await check('identical background suggestions deduplicate and briefly cache',async()=>{
    let calls=0;const c=client(async()=>{calls++;await new Promise(r=>setTimeout(r,20));return ok();});
    const p={messages:[{role:'user',content:'suggest'}],purpose:'suggest',background:true};
    await Promise.all([c.complete(p),c.complete(p),c.complete(p)]);await c.complete(p);assert.equal(calls,1);
    await c.complete({...p,messages:[{role:'user',content:'different'}]});assert.equal(calls,2);
  });
  await check('replacing and removing a vaulted key uses the current key',async()=>{
    let removed=false;
    const vault={use:()=>removed?'':'old-key',add:()=>new Promise(()=>{}),remove:()=>{removed=true;}};
    const c=client(async()=>ok(),vault);
    c.setKey('gemini','new-key');assert.equal(c.keyFor('gemini'),'new-key');
    c.removeKey('gemini');assert.equal(removed,true);assert.notEqual(c.keyFor('gemini'),'new-key');
  });
  await check('new OpenRouter key is tried before stale vaulted keys',async()=>{
    const used=[];
    const vault={use:()=>'',all:()=>['old-key'],add:()=>new Promise(()=>{})};
    const c=client(async(_url,req)=>{used.push(req.headers.Authorization);return {ok:true,json:async()=>({choices:[{message:{content:'answer'}}]})};},vault);
    c.setKey('openrouter','new-key');
    await c.complete({messages:[{role:'user',content:'hello'}]});
    assert.equal(used[0],'Bearer new-key');
  });
  await check('explicit Groq brain wins over configured Gemini and records timings', async()=>{
    const requests=[];
    const c=client(async(url, req)=>{
      requests.push({url, body:JSON.parse(req.body)});
      return {ok:true,json:async()=>({model:'openai/gpt-oss-20b',choices:[{message:{content:'answer'}}]})};
    });
    c.setKey('groq','test-groq-key');
    const result=await c.complete({model:'groq/openai/gpt-oss-20b',messages:[{role:'user',content:'hello'}]});
    assert.equal(requests.length,1);
    assert.ok(requests[0].url.includes('api.groq.com'));
    assert.equal(requests[0].body.model,'openai/gpt-oss-20b');
    assert.equal(requests[0].body.reasoning_effort,'low');
    assert.equal(result.model,'openai/gpt-oss-20b');
    assert.equal(c.requestDiagnostics().timings[0].provider,'groq');
    assert.ok(c.requestDiagnostics().timings[0].totalMs >= 0);
  });
  await check('cancelling Groq stops its fetch without falling through to Gemini', async()=>{
    let calls=0;
    const c=client((_url, req)=>new Promise((_resolve,reject)=>{
      calls++;
      req.signal.addEventListener('abort',()=>reject(Object.assign(new Error('Aborted'),{name:'AbortError'})),{once:true});
    }));
    c.setKey('groq','test-groq-key');
    const controller=new AbortController();
    const pending=c.complete({model:'groq/openai/gpt-oss-20b',messages:[]},controller.signal);
    controller.abort();
    await assert.rejects(pending,e=>e.name==='AbortError');
    assert.equal(calls,1);
  });
  await check('server stream reads ahead of a slow UI callback without reordering text', async()=>{
    let reads=0, release;
    const blocked=new Promise(resolve=>{release=resolve;});
    const frames=['data: {"text":"one"}\n\n','data: {"text":"two"}\n\ndata: [DONE]\n\n'];
    const w={SupabaseAuth:{getAccessToken:()=> 'test-token'},SKYLARK_CONFIG:{}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../ai-chat-client.js'),'utf8'),{
      window:w,AbortController,TextDecoder,Uint8Array,setTimeout,clearTimeout,
      fetch:async()=>({ok:true,headers:{get:()=> 'text/event-stream'},body:{getReader:()=>({
        read:async()=>reads<frames.length?{value:new TextEncoder().encode(frames[reads++]),done:false}:{done:true},
        cancel:async()=>{},releaseLock(){}
      })}})
    });
    const seen=[];
    const pending=w.NexusAIChat.complete({model:'groq/openai/gpt-oss-20b',messages:[]},null,async text=>{
      seen.push(text); if(text==='one') await blocked;
    });
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(reads,2);
    assert.deepEqual(seen,['one']);
    release();
    const result=await pending;
    assert.deepEqual(seen,['one','two']);
    assert.equal(result.choices[0].message.content,'onetwo');
  });
  await check('long conversation and tool rounds stay within backend message limits', async()=>{
    const source=fs.readFileSync(path.join(__dirname,'../jarvis.js'),'utf8');
    const historyStart=source.indexOf('  const HISTORY_TURNS =');
    const historyEnd=source.indexOf('\n  /**',historyStart);
    const history=Array.from({length:45},(_,i)=>({role:i%2?'assistant':'user',content:i===44?'Current question': 'x'.repeat(3000)}));
    const recent=vm.runInNewContext(source.slice(historyStart,historyEnd)+'\nrecentHistory()', {conversationHistory:history});
    assert.ok(recent.length<=16);
    assert.equal(recent.at(-1).content,'Current question');
    assert.ok(recent.slice(0,-1).reduce((sum,m)=>sum+m.content.length,0)<=6000);
    const start=source.indexOf('  async function callLLM(');
    const end=source.indexOf('    // 2) Fallback:',start);
    let submitted;
    const context={window:{ClavisDirect:{hasKey:()=>true,complete:async payload=>{
      submitted=payload.messages;return {choices:[{message:{content:'answer'}}]};
    }}}};
    const call=vm.runInNewContext(source.slice(start,end)+'\n}\ncallLLM', context);
    await call([{role:'system',content:'Instruction'},...history]);
    assert.equal(submitted.length,20);
    assert.equal(submitted[0].content,'Instruction');
    assert.equal(submitted.at(-1).content,'Current question');
  });
  if(failed)process.exitCode=1;
}
main();
