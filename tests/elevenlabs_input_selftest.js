// node tests/elevenlabs_input_selftest.js — no key, microphone or paid request.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  let account = 'one', enabled = true, stopped = 0, microphone = null, resume = null;
  const sockets = [], nodes = [], requests = [], storage = new Map(), callbacks = {}, timers = [], deadlines = [], events = {}, scheduled = new Map();
  let clock = null;
  const stream = () => ({ getTracks: () => [{stop: () => stopped++}], clone: stream });
  const window = {
    addEventListener:(type,fn)=>{(events[type] ||= []).push(fn);}, localStorage: {getItem: key => storage.get(key) || null},
    btoa: str => Buffer.from(str, 'binary').toString('base64'),
    ClavisDirect: {providerConfigured: () => true},
    SupabaseAuth: {getUser: () => ({id:account}), getAccessToken: async () => 'tenant-session'},
    ClavisVoiceState: {canProcessMic: () => enabled, registerAudioCleanup() {}, mic: {
      claim(name, stop) {this.owner=name;this.stopFn=stop;return true;},
      release(name) {if(this.owner!==name)return;this.owner=null;const fn=this.stopFn;this.stopFn=null;fn?.();},
    }},
    LocalSpeechEngine: {acquireVoiceMicrophone: () => microphone ? microphone() : Promise.resolve(stream())},
    ClavisWorklet: {add: async () => {}},
    AudioContext: class {
      constructor(){this.state=resume?'suspended':'running';this.destination={};}
      resume(){return resume();}
      createMediaStreamSource(){return {connect(){},disconnect(){}};}
      async close(){this.state='closed';}
    },
    AudioWorkletNode: class {constructor(){this.port={};nodes.push(this);}connect(){}disconnect(){}},
    WebSocket: class {
      constructor(url){this.url=url;this.readyState=1;this.bufferedAmount=0;this.sent=[];sockets.push(this);}
      emit(data){this.onmessage?.({data:JSON.stringify(data)});}
      send(data){this.sent.push(JSON.parse(data));}
      close(){this.readyState=3;this.onclose?.();}
    },
  };
  const context = vm.createContext({window,navigator:{},AbortController,URLSearchParams,Float32Array,Uint8Array,DataView,console,Date:{now:()=>clock ?? Date.now()},
    setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timers.push(timer);deadlines.push(fn);scheduled.set(timer,{fn,ms});return timer;},
    clearTimeout:timer=>{scheduled.delete(timer);clearTimeout(timer);},
    fetch: async (url,options) => {requests.push({url,options});return {ok:true,status:200,json:async()=>({token:'single-use-token'})};}});
  vm.runInContext(fs.readFileSync(path.join(root,'clavis-elevenlabs-stt.js'),'utf8'),context);
  return {engine:window.ClavisElevenSTT,window,sockets,nodes,requests,storage,callbacks,
    stopCount:()=>stopped, account:value=>{account=value;}, enabled:value=>{enabled=value;}, microphone:value=>{microphone=value;},
    resume:value=>{resume=value;}, expire:()=>deadlines.at(-1)(), clearTimers:()=>timers.forEach(clearTimeout),
    clock:value=>{clock=value;}, scheduled, event:(type,detail)=>events[type]?.forEach(fn=>fn({detail}))};
}

async function inputChecks() {
  const h = harness(), commits = [], errors = [], partials = [];
  let speechStarts=0;
  const options = {onCommit:(text,meta)=>commits.push({text,meta}),onPartial:text=>partials.push(text),onSpeechStart:()=>speechStarts++,onError:error=>errors.push(error)};
  const first=h.engine.start(options), second=h.engine.start(options);
  assert.equal(first,second,'concurrent activation has one connection');
  await settle();
  assert.equal(h.requests.length,1);assert.equal(h.sockets.length,1);
  assert.equal(h.requests[0].options.headers.Authorization,'Bearer tenant-session');
  assert.ok(!h.requests[0].options.body.includes('language'),'output accent never forces STT language');
  const url=new URL(h.sockets[0].url);
  assert.equal(url.searchParams.get('language_code'),'hi');
  assert.equal(url.searchParams.get('secondary_languages'),'en');
  assert.equal(url.searchParams.get('token'),'single-use-token');
  assert.equal(url.searchParams.get('commit_strategy'),'vad');
  assert.equal(url.searchParams.get('audio_format'),'pcm_16000');
  assert.equal(url.searchParams.get('include_timestamps'),'false');
  assert.equal(url.searchParams.has('xi-api-key'),false,'no long-lived API key in browser connection');
  h.sockets[0].emit({message_type:'session_started',session_id:'session-one'});
  assert.equal(await first,true);assert.equal(h.engine.isActive(),true);
  const emit=data=>h.sockets[0].emit(data);
  emit({message_type:'partial_transcript',text:'हाँ'});emit({message_type:'partial_transcript',text:'हाँ'});
  emit({message_type:'committed_transcript',text:'हाँ'});emit({message_type:'committed_transcript',text:'हाँ'});
  emit({message_type:'committed_transcript_with_timestamps',text:'हाँ'});
  assert.equal(commits.length,1,'duplicate delivery and optional timestamp event are not new turns');
  emit({message_type:'partial_transcript',text:'हाँ'});emit({message_type:'committed_transcript',text:'हाँ'});
  assert.equal(commits.length,2,'an intentional repeat in a new segment remains valid');
  assert.notEqual(commits[0].meta.turnId,commits[1].meta.turnId);
  assert.equal(partials.length,2);assert.equal(speechStarts,2);
  await h.engine.start(options);assert.equal(h.requests.length,1,'turns never reacquire microphone or tokens');
  const pcm = new Float32Array(512);pcm.set([-1,0,.5,1]);
  h.nodes[0].port.onmessage({data:{type:'pcm',audio:pcm.buffer}});
  h.nodes[0].port.onmessage({data:{type:'pcm',audio:new Float32Array(512).buffer}});
  const audio=h.sockets[0].sent[0];assert.equal(audio.sample_rate,16000);
  const bytes=Buffer.from(audio.audio_base_64,'base64');
  assert.deepEqual([0,2,4,6].map(at=>bytes.readInt16LE(at)),[-32768,0,16384,32767],'PCM frames keep the resampled mono format');
  assert.equal(bytes.length,2048);
  const staleMessage=h.sockets[0].onmessage;
  h.engine.stop();staleMessage({data:JSON.stringify({message_type:'committed_transcript',text:'stale'})});
  assert.equal(commits.length,2);assert.ok(h.stopCount()>0);assert.equal(h.engine.isActive(),false);

  const next=h.engine.start(options);await settle();h.sockets[1].emit({message_type:'session_started'});await next;
  h.sockets[1].emit({message_type:'quota_exceeded',error:'Allowance used'});
  assert.equal(errors.length,1);assert.equal(errors[0].fallback,true);assert.equal(h.engine.status().state,'error');
  await settle();assert.equal(h.sockets.length,2,'provider failure cannot restart itself');
  h.storage.set('clavis_stt_provider','groq');assert.equal(h.engine.shouldUse(),false,'explicit Groq selection is respected');
  h.storage.delete('clavis_stt_provider');assert.equal(h.engine.shouldUse(),true);
}

async function committedSpeakerEvidenceCheck() {
  const h=harness(), captures=[], partials=[], commits=[];
  let current={since:1200,until:1400,frames:6,verdict:'unknown'}, consumed=0;
  h.clock(1600);
  h.window.ClavisEar={tap:{start:async()=>true,stop(){},consume:()=>consumed++},voiceId:{
    required:()=>true,
    capture:since=>{const evidence=Object.freeze({...current});captures.push({since,evidence});return evidence;},
    check:meta=>({verdict:meta.voiceEvidence.verdict}),
  }};
  const pending=h.engine.start({
    onPartial:(text,meta)=>partials.push({text,meta}),
    onCommit:(text,meta)=>{if(h.window.ClavisEar.voiceId.check(meta).verdict==='owner')commits.push({text,meta});},
  });
  await settle();const socket=h.sockets[0];socket.emit({message_type:'session_started'});await pending;
  socket.emit({message_type:'partial_transcript',text:'पहला सवाल'});
  const shortPartial=partials.at(-1).meta.voiceEvidence;
  current={since:1200,until:1950,frames:24,verdict:'owner'};
  socket.emit({message_type:'committed_transcript',text:'पहला सवाल बताओ'});
  assert.equal(commits.length,1,'a short partial gains complete owner evidence on commit');
  assert.notEqual(commits[0].meta.voiceEvidence,shortPartial,'commit obtains a fresh snapshot');
  assert.equal(captures.at(-1).since,1200,'the commit covers the actual partial onset');
  assert.equal(commits[0].meta.voiceEvidence.frames,24);
  assert.equal(commits[0].meta.until,1950);

  current={since:2300,until:2700,frames:15,verdict:'owner'};
  socket.emit({message_type:'partial_transcript',text:'रुद्र रोक'});
  current={since:2300,until:3400,frames:35,verdict:'other'};
  socket.emit({message_type:'committed_transcript',text:'रुद्र रोक दो'});
  assert.equal(commits.length,1,'an owner partial cannot authorize a changed speaker at commit');
  assert.equal(captures.at(-1).since,2300);
  assert.equal(consumed,3,'session setup and both final segments consume prior evidence');
  h.engine.stop();h.clearTimers();
}

async function cancelledAcquisitionCheck() {
  const h=harness();let release;
  h.microphone(()=>new Promise(resolve=>{release=resolve;}));
  const pending=h.engine.start();await settle();
  h.engine.stop();h.enabled(false);
  let settled=false;pending.then(()=>{settled=true;});await settle();
  assert.equal(settled,true,'mute settles startup without waiting for the browser permission dialog');
  release({clone:()=>({getTracks:()=>[{stop:()=>h.callbacks.lateStopped=true}]}),getTracks:()=>[]});
  assert.equal(await pending,false);await settle();assert.equal(h.callbacks.lateStopped,true,'late permission grant releases its stream');
  assert.equal(h.sockets.length,0,'mute during startup never creates a socket');
  const other=harness(), accepted=[];
  const usage=[];other.clock(1000);
  other.window.ClavisVoiceBudget={allowSTT:()=>true,noteSTT:(seconds,owner)=>usage.push({seconds,owner})};
  const start=other.engine.start({onCommit:text=>accepted.push(text)});await settle();other.sockets[0].emit({message_type:'session_started'});await start;
  other.clock(3500);
  other.account('two');other.sockets[0].emit({message_type:'committed_transcript',text:'old account'});
  assert.equal(accepted.length,0);assert.equal(other.engine.isActive(),false);
  assert.deepEqual(usage,[{seconds:2.5,owner:'one'}],'Auth switch cleanup charges the original listening account');
}

async function recoverableProviderEventsCheck() {
  const h = harness(), errors = [];
  for (const code of ['insufficient_audio_activity', 'queue_overflow', 'session_time_limit_exceeded']) {
    const pending = h.engine.start({onError:error=>errors.push(error)});
    await settle();const socket = h.sockets.at(-1);
    socket.emit({message_type:'session_started'});assert.equal(await pending,true);
    socket.emit({message_type:code});
    assert.equal(errors.at(-1).code,code);assert.equal(errors.at(-1).fallback,true);
    assert.equal(h.engine.isActive(),false,'failed socket is disposed before reconnect');
  }
  h.clearTimers();
}

async function cancelledResumeCheck() {
  const h=harness();let release;
  h.resume(()=>new Promise(resolve=>{release=resolve;}));
  const pending=h.engine.start();await settle();
  assert.equal(typeof release,'function');
  h.engine.stop('muted');h.enabled(false);release();await settle();
  try {
    assert.equal(h.sockets.length,0,'mute during AudioContext.resume never opens a stale socket');
    assert.equal(await pending,false,'cancelled startup always settles');
  } finally {h.clearTimers();}
}

async function disconnectedMicrophoneCheck() {
  const h=harness(),errors=[];let ended,removed=0;
  const track={readyState:'live',stop(){},addEventListener(type,fn){if(type==='ended')ended=fn;},removeEventListener(type,fn){if(type==='ended'&&fn===ended)removed++;}};
  h.microphone(async()=>({clone:()=>({getTracks:()=>[track]})}));
  const pending=h.engine.start({onError:error=>errors.push(error)});await settle();
  h.sockets[0].emit({message_type:'session_started'});assert.equal(await pending,true);
  assert.equal(typeof ended,'function','physical device loss has a handler');
  track.readyState='ended';ended();
  assert.equal(h.engine.isActive(),false,'a lost microphone cannot remain falsely listening');
  assert.equal(errors[0].code,'STT_MIC_ENDED');assert.equal(errors[0].fallback,false);
  assert.equal(removed,1,'cleanup detaches the ended handler');
  ended();assert.equal(errors.length,1,'stale device events cannot fail another session');h.clearTimers();
}

async function boundedSetupCheck() {
  for (const phase of ['auth', 'microphone', 'featuretap', 'worklet']) {
    const h=harness(), errors=[];
    const never=()=>new Promise(()=>{});
    if(phase==='auth')h.window.SupabaseAuth.getAccessToken=never;
    else if(phase==='microphone')h.microphone(never);
    else if(phase==='featuretap')h.window.ClavisEar={tap:{start:never,stop(){}}};
    else h.window.ClavisWorklet.add=never;
    const pending=h.engine.start({onError:error=>errors.push(error)});await settle();
    assert.equal(h.scheduled.size,1,phase+' owns an active setup deadline');
    h.expire();assert.equal(await pending,false,phase+' cannot leave live input stuck connecting');
    assert.equal(errors.length,1);assert.equal(errors[0].code,phase==='microphone'?'STT_MIC_TIMEOUT':'STT_NETWORK');assert.equal(errors[0].fallback,phase!=='microphone');
    assert.equal(h.engine.isActive(),false);assert.equal(h.sockets.length,0);h.clearTimers();
  }
}

async function activeBudgetCheck() {
  const h=harness(), errors=[], usage=[];
  let remaining=5;
  h.clock(1000);
  h.window.ClavisVoiceBudget={allowSTT:()=>remaining>0,remainingSTT:()=>remaining,reason:()=>'',noteSTT:seconds=>{usage.push(seconds);remaining-=seconds;}};
  const first=h.engine.start({onError:error=>errors.push(error)});await settle();
  h.sockets[0].emit({message_type:'session_started'});assert.equal(await first,true);
  assert.equal(h.scheduled.size,1,'active Scribe owns a listening-cap deadline');
  assert.equal([...h.scheduled.values()][0].ms,5000);
  h.clock(3000);remaining=10;h.event('clavis:voice-settings-changed',{kind:'budget'});
  assert.equal(h.scheduled.size,1,'raising the cap replaces the previous deadline');
  assert.equal([...h.scheduled.values()][0].ms,8000,'elapsed current-session audio counts toward the new cap');
  remaining=3;h.event('clavis:voice-settings-changed',{kind:'budget'});
  const deadline=[...h.scheduled.values()][0];assert.equal(deadline.ms,1000);
  h.clock(4000);deadline.fn();
  assert.equal(h.engine.isActive(),false,'the active socket closes at the remaining listening cap');
  assert.equal(errors.length,1);assert.equal(errors[0].code,'STT_BUDGET');assert.equal(errors[0].fallback,true);
  assert.deepEqual(usage,[3]);assert.equal(h.scheduled.size,0,'stopped sessions retain no budget deadline');
  await settle();assert.equal(h.sockets.length,1,'budget exhaustion cannot open another paid socket');
  const refused=await h.engine.start({onError:error=>errors.push(error)});assert.equal(refused,false);assert.equal(h.sockets.length,1);
  remaining=5;h.clock(5000);const next=h.engine.start({onError:error=>errors.push(error)});await settle();
  h.sockets[1].emit({message_type:'session_started'});assert.equal(await next,true);
  deadline.fn();assert.equal(h.engine.isActive(),true,'a stale cap deadline cannot stop a fresh session');
  remaining=0;h.event('clavis:voice-settings-changed',{kind:'budget'});
  assert.equal(h.engine.isActive(),false,'setting the listening cap to zero stops an active session immediately');
  assert.equal(errors.at(-1).code,'STT_BUDGET');
  remaining=5;h.clock(10000);const last=h.engine.start({onError:error=>errors.push(error)});await settle();
  h.sockets[2].emit({message_type:'session_started'});assert.equal(await last,true);h.clock(15000);
  for(let i=0;i<2;i++)h.nodes[2].port.onmessage({data:{type:'pcm',audio:new Float32Array(512).buffer}});
  assert.equal(h.engine.isActive(),false,'outgoing audio enforces the cap when a browser delays its timer');
  assert.equal(h.sockets[2].sent.length,0,'no paid audio is queued beyond the listening cap');
  assert.equal(errors.at(-1).code,'STT_BUDGET');h.clearTimers();
}

function earChecks() {
  const source=fs.readFileSync(path.join(root,'clavis-ear.js'),'utf8');
  const start=source.indexOf('  function judge('),end=source.indexOf('\n  /* ── 2.',start);
  let speaking=false,gap=100,voiceId=false,recognized='unknown',score=0;
  const c=vm.createContext({now:()=>10000,named:()=>false,isSpeaking:()=>speaking,msSinceSpoke:()=>gap,
    echo:()=>({n:3,score,fresh:3}),STOP_RE:/stop/,ASK_NOW_RE:/show me/,
    looksLikeRequest:text=>/why|what|explain|kya/i.test(text),
    voiceId:{required:()=>voiceId,enabled:()=>voiceId,check:()=>({verdict:recognized})}});
  vm.runInContext(source.slice(start,end)+'\nthis.judge=judge;',c);
  assert.equal(c.judge('yes',{session:true,openMic:true}).accept,true,'plain reply immediately after TTS works');
  score=.9;assert.equal(c.judge('same three words',{session:true}).reason,'echo','continuous mode still rejects self echo');score=0;
  speaking=true;assert.equal(c.judge('random room speech',{session:true}).accept,false,'caption alone never interrupts');
  assert.equal(c.judge('what does that mean',{session:true}).barge,true,'ordinary questions interrupt in a deliberate conversation');
  score=.9;assert.equal(c.judge('what does that mean',{session:true}).reason,'echo','a question-shaped echo still cannot interrupt');score=0;speaking=false;
  for (const text of ['why?', 'haan', 'aur Noida mein?']) assert.equal(c.judge(text,{session:true,openMic:true}).accept,true,'immediate contextual follow-up: '+text);
  voiceId=true;assert.equal(c.judge('yes',{session:true,openMic:true}).accept,false,'enrolled owner requirement remains');
  recognized='owner';assert.equal(c.judge('yes',{session:true,openMic:true}).accept,true);
  gap=5000;recognized='unknown';assert.equal(c.judge('yes',{session:true,openMic:true}).accept,false);
  for (const text of ['stop', 'show me four completely new things', 'what does that mean']) {
    speaking=true;
    assert.equal(c.judge(text,{session:true,openMic:false}).accept,false,'speaker policy precedes all interruption shortcuts: '+text);
  }
}

async function brainChecks() {
  const storage=new Map(),requests=[],spoken=[];let release,slow=false;
  const w={addEventListener(){},AuthSystem:{getProfile:()=>({name:'Owner',company:'Business'})},
    SupabaseAuth:{getUser:()=>({id:'one'})},ClavisRequestIntent:{classify:()=>({answerOnly:true}),capabilityAnswer:()=>''},
    ClavisDirect:{hasKey:()=>true,complete:async payload=>{
      requests.push(payload);
      if(slow)await new Promise(resolve=>{release=resolve;});
      const text='<think>Private reasoning. Never read this.</think>It means following up with the customer.';
      if(payload.onToken)for(const chunk of text.match(/.{1,7}/g))await payload.onToken(chunk);
      return {choices:[{message:{content:text}}],streamed:Boolean(payload.onToken)};
    }}};
  const c=vm.createContext({window:w,document:{readyState:'complete'},setTimeout:()=>0,console,
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});
  vm.runInContext(fs.readFileSync(path.join(root,'jarvis.js'),'utf8'),c);
  const reply=await w.JarvisEngine.sendMessage('What is a follow-up?',new AbortController().signal,null,text=>spoken.push(text),{source:'voice'});
  assert.equal(reply.text,'It means following up with the customer.');
  assert.equal(spoken.join('').trim(),reply.text,'streamed private reasoning never reaches speech');
  assert.equal(requests[0].max_tokens,1200,'voice reasoning retains a visible-answer budget');
  assert.equal(requests[0].model,'groq/openai/gpt-oss-20b','ordinary turns use the fast Groq reasoning model');
  await w.JarvisEngine.sendMessage('Think deeply about this plan.',new AbortController().signal,null,null,{source:'voice'});
  assert.equal(requests[1].model,'groq/openai/gpt-oss-120b','explicit deeper analysis uses the stronger Groq model');
  slow=true;const controller=new AbortController();
  const cancelled=w.JarvisEngine.sendMessage('A cancelled question must not repeat.',controller.signal,null,null,{source:'voice'});
  await settle();controller.abort();release();
  await assert.rejects(cancelled,error=>error.name==='AbortError');
  slow=false;await w.JarvisEngine.sendMessage('What should I do next?',new AbortController().signal,null,null,{source:'voice'});
  assert.ok(!requests.at(-1).messages.some(message=>message.content==='A cancelled question must not repeat.'),'aborted turn is removed from follow-up history');
  assert.ok(requests.every(request=>request.messages[0].content.length<3500),'ordinary voice prompt stays bounded');
}

async function groundedAndEmptyReplyChecks() {
  const requests=[],saved=[],spoken=[],timers=new Map();let nextTimer=0,mode='answer',pendingSignal;
  const w={addEventListener(){},AuthSystem:{getProfile:()=>({name:'Owner',company:'Business'})},
    SupabaseAuth:{getUser:()=>({id:'one'})},MemoryEngine:{addJarvisMessage:message=>saved.push(message),getAllJarvisFacts:async()=>[]},
    ClavisEmotionalEngine:{shouldRewrite:()=>true},ClavisNano:{isReady:()=>true,complete:()=>{throw new Error('Current facts cannot use Nano');}},
    ClavisDirect:{hasKey:()=>true,complete:async(payload,signal)=>{
      requests.push(payload);pendingSignal=signal;
      if(mode.startsWith('AI_'))throw Object.assign(new Error('Provider status'),{code:mode});
      if(mode==='wait')return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true}));
      if(mode==='empty-once'){mode='answer';return {choices:[{message:{content:''}}]};}
      if(mode==='silent')return {choices:[{message:{content:'[[silent]]'}}]};
      return {model:'openai/gpt-oss-20b',choices:[{message:{content:payload.tools?'Delhi is 28°C today. 〖1†L1-L2〗 [Weather](https://weather.test/current)':'A clear answer to your question.',
        executed_tools:[{type:'browser_search',browser_results:[{url:'https://weather.test/current',title:'Current observation',published_at:'2026-10-11'},
          ...Array.from({length:8},(_,i)=>({url:'https://weather.test/source-'+i,title:'Evidence '+i,content:'untrusted page text'}))]}],
        annotations:[{type:'function_citation',function_citation:{tool_call_id:'search-1',start_index:0,end_index:19}}]}}]};
    }}};
  const c=vm.createContext({window:w,document:{readyState:'complete'},AbortController,console,
    setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    localStorage:{getItem:()=>null,setItem(){}}});
  vm.runInContext(fs.readFileSync(path.join(root,'jarvis.js'),'utf8'),c);
  vm.runInContext(fs.readFileSync(path.join(root,'clavis-request-intent.js'),'utf8'),c);
  const ask=(question,signal=new AbortController().signal,voice=true)=>w.JarvisEngine.sendMessage(question,signal,null,text=>spoken.push(text),{source:voice?'voice':'text'});
  const weather=await ask('Delhi ka mausam aaj kaisa hai?');
  assert.equal(requests.length,1,'current facts use one answer request, without search/rewrite rounds');
  assert.equal(requests[0].tool_choice,'required');assert.equal(requests[0].tools[0].type,'browser_search');
  assert.equal(requests[0].onToken,undefined,'grounded content is validated before speech');
  assert.equal(weather.grounding.sources[0].url,'https://weather.test/current');
  assert.equal(weather.grounding.sources[0].date,'2026-10-11');assert.ok(weather.grounding.fetchedAt);
  assert.equal(weather.grounding.sources.length,5,'official browser_results are preserved with a five-source bound');
  assert.equal(weather.grounding.annotations[0].id,'search-1','official citation annotations remain internal');
  assert.ok(weather.grounding.sources.every(source=>!source.content),'raw page text is not promoted into stored instructions');
  assert.ok(saved.some(message=>message.grounding),'history retains evidence metadata');
  assert.equal(spoken.join(''),weather.text);assert.doesNotMatch(weather.text,/https|〖|†/,'citations and links are never spoken');
  await ask('Aur Noida mein?');assert.equal(requests[1].tool_choice,'required','location follow-up retains grounded facts');
  await ask('Delhi ka mausam aaj kaisa hai?');assert.equal(requests.length,3,'repeated live questions get fresh requests');
  await ask('Why does rain happen?');assert.equal(requests.at(-1).tools,undefined,'stable explanations stay conversational');
  const beforeEmpty=requests.length;mode='empty-once';spoken.length=0;
  const recovered=await ask('What is a follow-up?');assert.equal(requests.length,beforeEmpty+2,'empty spoken replies recover once');
  assert.equal(recovered.text,'A clear answer to your question.');assert.equal(spoken.join(''),recovered.text);
  mode='silent';spoken.length=0;const silent=await ask('Unfinished side talk');assert.equal(silent.silent,true);assert.equal(spoken.length,0);
  mode='wait';spoken.length=0;
  const timeout=ask('Latest news today?');await settle();
  Array.from(timers.values()).find(timer=>timer.ms===5000).fn();
  const timed=await timeout;assert.equal(pendingSignal.aborted,true,'deadline cancels the actual provider request');
  assert.equal(timed.modelUsed,'current-facts-unavailable');assert.equal(spoken.join(''),timed.text);
  const count=requests.length,controller=new AbortController();spoken.length=0;
  const stopped=ask('Weather now in Mumbai?',controller.signal);await settle();controller.abort();
  await assert.rejects(stopped,error=>error.name==='AbortError');assert.equal(pendingSignal.aborted,true);
  assert.equal(requests.length,count+1,'Stop cannot start an ungrounded fallback');assert.equal(spoken.length,0);
  assert.ok(!Array.from(timers.values()).some(timer=>timer.ms===5000),'deadline resources are cleaned up');
  mode='answer';
  for(const question of ['What is the weather in Delhi?','Who is the president of India?','Who is CEO of Microsoft?']) {
    const before=requests.length;await ask(question);
    assert.equal(requests.length,before+1);assert.equal(requests.at(-1).tool_choice,'required','implicit current fact is grounded: '+question);
  }
  for(const question of ['What is weather?','What is temperature?','Why does rain happen?']) {
    await ask(question);assert.equal(requests.at(-1).tools,undefined,'a stable definition remains conversational: '+question);
  }
  for(const [code,description] of [['AI_AUTH_REQUIRED','sign in'],['AI_CREDENTIAL_MISSING','connect Groq'],['AI_RATE_LIMITED','limit'],['AI_QUOTA_EXCEEDED','limit'],['AI_BACKEND_UNAVAILABLE','unavailable']]) {
    mode=code;spoken.length=0;const before=requests.length;
    const failed=await ask('Latest news today?');
    assert.equal(requests.length,before+1,'provider status cannot cause an ungrounded rewrite');
    assert.ok(failed.text.toLowerCase().includes(description.toLowerCase()),'honest status for '+code);
    assert.equal(spoken.join(''),failed.text);
  }
  // Start a new engine without any remembered city or conversation context.
  mode='answer';vm.runInContext(fs.readFileSync(path.join(root,'jarvis.js'),'utf8'),vm.createContext({...c}));
  const beforeClarify=requests.length;spoken.length=0;
  const clarification=await ask('Aaj ka mausam?');
  assert.equal(clarification.modelUsed,'weather-location-clarification');assert.equal(requests.length,beforeClarify,'missing city is clarified before a paid search');
  assert.equal(spoken.join(''),clarification.text);
  await ask('Delhi');assert.equal(requests.length,beforeClarify+1,'the city answer continues the original grounded weather question');
  assert.equal(requests.at(-1).tool_choice,'required');
}

function routingChecks() {
  const source=fs.readFileSync(path.join(root,'jarvis_ui.js'),'utf8');
  const between=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
  let active=true,allowed=true,groqStarts=0,elevenStarts=0,stops=0;
  const window={ClavisElevenSTT:{isActive:()=>active},ClavisWake:{state:()=>({source:'tap'})},ClavisEar:{caption:{}},ClavisDirect:{}};
  const VS={isClavisWorkspace:()=>true,canProcessMic:()=>allowed,setMicEnabled:value=>{allowed=value;}};
  window.ClavisVoiceState=VS;
  const c=vm.createContext({window,localStorage:{getItem:()=>null},document:{getElementById:()=>null,querySelectorAll:()=>[]},
    CLAVIS_VS:VS,clavisRealtimeInput:{fallback:false,blocked:false},clavisAIBackoff:{until:0},clavisElevenReady:()=>true,clavisGroqReady:()=>true,
    clavisEar:{},clavisIsAwake:()=>true,clavisMicAlive:()=>active,clavisShouldListen:()=>true,
    clavisSpeakingNow:()=>true,jarvisController:{signal:{aborted:false}},groqCapture:{starting:false},isGroqRecording:false,
    startClavisElevenInput:()=>elevenStarts++,legacyStartGroqWhisperVoiceInput:()=>groqStarts++,
    stopCommandEar:()=>{active=false;stops++;},stopWakeListener(){},stopClavisSoundTriggers(){},clavisPrewarm(){},clavisWakeUp(){},
    clavisEarConsumeAll(){},setJarvisStatus(){},wakeRecognition:null,clearTimeout(){},jarvisHandsFree:true});
  vm.runInContext(between('function clavisEnsureListening(', '\nwindow.clavisEnsureListening =')+'\nthis.ensure=clavisEnsureListening;',c);
  c.ensure();c.ensure();assert.equal(groqStarts,0);assert.equal(elevenStarts,0,'active Scribe input survives generation/playback watchdog checks');
  vm.runInContext(between('function startJarvisVoiceInput(', '\n// ── The command ear')+'\nthis.start=startJarvisVoiceInput;',c);
  c.start();assert.equal(allowed,false);assert.equal(active,false);assert.ok(stops>0,'manual mic press really shuts the persistent engine off');
  c.ensure();assert.equal(elevenStarts,0,'watchdog cannot undo a manual mute');
}

(async()=>{await inputChecks();await committedSpeakerEvidenceCheck();await recoverableProviderEventsCheck();await cancelledAcquisitionCheck();await cancelledResumeCheck();await disconnectedMicrophoneCheck();await boundedSetupCheck();await activeBudgetCheck();earChecks();await brainChecks();await groundedAndEmptyReplyChecks();routingChecks();console.log('ElevenLabs persistent input + continuous follow-up: PASS');})()
  .catch(error=>{console.error(error);process.exitCode=1;});
