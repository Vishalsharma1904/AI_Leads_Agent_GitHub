// node tests/groq_cartesia_voice_selftest.js — real queue/recorder cancellation paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'jarvis_ui.js'), 'utf8');
const between = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));
const queue = between('function clavisStreamSpeaker(', '// A tool that takes');
const recorder = between('async function legacyStartGroqWhisperVoiceInput(', '\nfunction startJarvisVoiceInput(');
const controls = between('const groqCapture =', '// A batch recognizer');
const settle = () => new Promise(resolve => setImmediate(resolve));

async function queueChecks() {
  const calls = [], ctl = new AbortController();
  let release;
  const c = vm.createContext({speakJarvisText: async (text, opts) => {
    if (text === 'Theek hai sir.' && !opts.forceRepeat) return false;
    calls.push(text);
    if (text === 'Noida ki list ready hai.') await new Promise(resolve => { release = resolve; opts.signal.addEventListener('abort', resolve, {once:true}); });
    return !opts.signal.aborted;
  }});
  vm.runInContext(queue + '\nthis.make = clavisStreamSpeaker;', c);
  const q = c.make(ctl.signal);
  q.push('Theek hai sir.'); q.push('Noida ki list ready hai.');
  await settle();
  let finished = false;
  const done = q.finish().then(() => { finished = true; });
  await settle(); assert.equal(finished, false, 'turn waits for playback, not only generation');
  assert.deepEqual(calls, ['Theek hai sir.', 'Noida ki list ready hai.']);
  ctl.abort(); await done;
  q.push('Stale audio must not play.'); assert.equal(calls.length, 2);
}

async function engineChecks() {
  const requests = [], spoken = [], storage = new Map();
  const w = {addEventListener() {}, AuthSystem:{getProfile:() => ({name:'Sir',company:'Test business'})},
    ClavisRequestIntent:{classify:() => ({answerOnly:true}),capabilityAnswer:() => ''},
    ClavisDirect:{hasKey:() => true, complete:async payload => {
      requests.push(payload);
      const reply = requests.length === 1 ? 'A CRM keeps your customer records. It tracks follow-ups.' : 'It means following up with that customer.';
      if (payload.onToken) for (const delta of reply.match(/.{1,13}/g)) await payload.onToken(delta);
      return {choices:[{message:{content:reply}}],streamed:Boolean(payload.onToken)};
    }}};
  const c = vm.createContext({window:w,document:{readyState:'complete'},setTimeout:() => 0,console,
    localStorage:{getItem:key => storage.get(key) || null,setItem:(key,value) => storage.set(key,value)}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','jarvis.js'),'utf8'),c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','clavis-request-intent.js'),'utf8'),c);
  const ctl = new AbortController();
  for (const question of ['What is CRM?', 'Aur iska fayda']) {
    const parts = [];
    const reply = await w.JarvisEngine.sendMessage(question,ctl.signal,null,text => parts.push(text),{source:'voice'});
    assert.equal(parts.join(' '),reply.text,'streamed sentences must not replay the complete answer');
    spoken.push(parts.join(' '));
  }
  assert.equal(requests.length,2,'one conversational request per turn');
  assert.ok(requests.every(request => request.messages[0].content.length < 2600),'voice questions and contextual follow-ups both use a bounded prompt without the tool catalogue');
  assert.ok(requests[1].messages.some(message => message.role === 'assistant' && message.content === spoken[0]),'follow-up keeps the prior answer');
  const greeting = between('function clavisYawnIfSlept()', '\nfunction toggleJarvisHandsFree(');
  let spokenGreeting = 0;
  const greetingContext = vm.createContext({window:{ClavisIntent:{wakeLine:() => ''}},setTimeout:fn => fn(),speakJarvisText:() => spokenGreeting++});
  vm.runInContext(greeting+'\nclavisYawnIfSlept(); clavisYawnIfSlept();',greetingContext);
  assert.equal(spokenGreeting,0,'ordinary wake/restart never repeats a canned boliye greeting');
}

async function transcriptionChecks() {
  const direct = fs.readFileSync(path.join(__dirname,'..','clavis-direct.js'),'utf8');
  const start = direct.indexOf('  async function transcribeWithGroq(');
  const end = direct.indexOf('\n  }',start)+4;
  let request;
  const c = vm.createContext({window:{SupabaseAuth:{getAccessToken:async () => 'test-only'}},
    FormData:class {append() {}}, localStorage:{getItem:() => 'en-GB'},
    fetch:async (url,options) => {request={url,options}; return {ok:true,json:async () => ({text:'दिल्ली'})};}});
  vm.runInContext(direct.slice(start,end)+'\nthis.transcribe=transcribeWithGroq;',c);
  const signal = new AbortController().signal;
  assert.equal(await c.transcribe({type:'audio/webm'},signal),'दिल्ली');
  assert.equal(request.url,'http://localhost:8000/api/speech/transcribe?provider=groq','output accent must not force English transcription');
  assert.equal(request.options.signal,signal);
  c.fetch=async()=>({ok:true,json:async()=>({text:'',reason:'unclear_audio'})});
  await assert.rejects(c.transcribe({type:'audio/webm'},signal),error=>error.code==='SPEECH_UNCLEAR');
  c.window.ClavisVoiceState={state:()=> 'LISTENING'};
  vm.runInContext(direct.slice(direct.indexOf('  function complete(payload ='),direct.indexOf('  function serverOnlyAI('))+'\nthis.complete=complete;',c);
  c.isBackground=()=>true;
  await assert.rejects(c.complete({background:true,purpose:'mind'}),error=>error.background===true,'idle helper calls do not compete with voice conversation');
}

function muteChecks() {
  const stored = new Map([['jarvis_speech_enabled','false'],['clavis_voice_muted','0']]);
  let output = false;
  const c = vm.createContext({jarvisSpeechEnabled:false,CLAVIS_VS:{setVoiceOutputEnabled:value => {output=value;}},
    localStorage:{setItem:(key,value) => stored.set(key,value)},stopJarvisSpeech() {},updateJarvisSpeechIcon() {},showToast() {}});
  vm.runInContext(between('function toggleJarvisSpeech(', '\nfunction updateJarvisSpeechIcon(')+'\nthis.toggle=toggleJarvisSpeech;',c);
  c.toggle(true);
  assert.equal(output,true,'unmuting enables the shared voice capability');
  assert.equal(c.jarvisSpeechEnabled,true);
  assert.equal(stored.get('clavis_voice_muted'),'0');
  assert.equal(stored.get('jarvis_speech_enabled'),'true');
  c.toggle(false);
  assert.equal(output,false); assert.equal(stored.get('clavis_voice_muted'),'1');
}

async function audioReadyChecks() {
  const voice = fs.readFileSync(path.join(__dirname,'..','clavis-voice.js'),'utf8');
  const init = voice.slice(voice.indexOf('  async function wake()'),voice.indexOf('  // The worklet fetch'));
  let release, loads = 0, contexts = 0;
  const S = {};
  const c = vm.createContext({S,Float32Array,setTimeout,
    window:{ClavisWorklet:{add:() => {loads++; return new Promise(resolve => {release=resolve;});}}},
    AudioContext:class {constructor(){contexts++;this.state='running';this.destination={};}createAnalyser(){return {connect:()=>this.destination};}async close(){this.state='closed';}},
    AudioWorkletNode:class {constructor(){this.port={};}connect(node){return node;}}});
  vm.runInContext(init+'\nthis.ensure=ensureAudio;',c);
  let ready = false;
  const first = c.ensure(); const second = c.ensure().then(() => {ready=true;});
  await settle(); assert.equal(ready,false,'concurrent playback must wait for the player, not only the context');
  assert.equal(loads,1); assert.equal(contexts,1);
  release(); await Promise.all([first,second]); assert.ok(S.player);
  S.ctx.state='closed'; c.window.ClavisWorklet.add=async () => {throw new Error('load failed');};
  await assert.rejects(c.ensure(),/load failed/); assert.equal(S.ctx,null);
  c.window.ClavisWorklet.add=async () => {};
  await c.ensure(); assert.ok(S.player,'failed prewarm cannot leave every subsequent reply silent');
}

async function bargeCaptureChecks() {
  let level = 0, enabled = true, stopped = 0, captured, releaseMic, acquisitions = 0;
  const recorders = [];
  const makeStream = () => ({getTracks:() => [{stop:() => stopped++}],clone:makeStream});
  const w = {ClavisVoiceState:{canProcessMic:() => enabled,registerAudioCleanup() {}},
    ClavisDirect:{providerConfigured:() => true},SupabaseAuth:{getUser:() => ({id:'owner-a'})},
    LocalSpeechEngine:{acquireVoiceMicrophone:async () => makeStream()}};
  class Recorder {
    static isTypeSupported() {return true;}
    constructor(){this.state='inactive';this.mimeType='audio/webm';recorders.push(this);}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['x'.repeat(1500)])});this.done=this.onstop?.();}
  }
  class Context {
    constructor(){this.state='running';this.sampleRate=48000;}
    createMediaStreamSource(){return {connect() {}};}
    createAnalyser(){return {getFloatTimeDomainData:buf => {for(let i=0;i<buf.length;i++) buf[i]=level*Math.sin(2*Math.PI*200*i/48000);}};}
    close(){this.state='closed';}
  }
  w.AudioContext=Context;
  const c = vm.createContext({window:w,AudioContext:Context,MediaRecorder:Recorder,Blob,Float32Array,console,Date,
    localStorage:{getItem:() => null},setInterval:() => 1,clearInterval() {}});
  const code = fs.readFileSync(path.join(__dirname,'..','clavis-barge-in.js'),'utf8').replace('return { arm,','return { _tick:tick, arm,');
  vm.runInContext(code,c);
  const barge = w.ClavisBargeIn;
  await barge.arm(capture => {captured=capture;});
  for(let i=0;i<6;i++) barge._tick();
  level=.12; barge._tick();
  assert.equal(recorders.length,1,'first voiced frame starts capture before interruption confirmation');
  recorders[0].ondataavailable({data:new Blob(['first words'])});
  for(let i=0;i<6;i++) barge._tick();
  assert.ok(captured); assert.equal(captured.recorder.state,'recording');
  assert.equal(await captured.chunks[0].text(),'first words');
  const h = captureHarness(); await h.ctx.start({capture:captured});
  captured.recorder.stop(); await settle();
  assert.ok((await h.uploads[0].blob.text()).startsWith('first words'),'Groq upload preserves early interruption audio');
  h.resolve('New question'); await captured.recorder.done; assert.deepEqual(h.sent,['New question']);

  barge.cleanup(); level=0;
  w.LocalSpeechEngine.acquireVoiceMicrophone=() => {acquisitions++;return new Promise(resolve => {releaseMic=resolve;});};
  const pending=barge.arm(() => {}); barge.cleanup(); enabled=false;
  const before=stopped; releaseMic(makeStream());
  assert.equal(await pending,false); assert.ok(stopped>before,'late mic acquisition is released after disabling');
  assert.equal(barge._isArmed(),false);
  enabled=true; acquisitions=0;
  const old=barge.arm(() => {}), newest=barge.arm(() => {});
  assert.equal(acquisitions,1,'concurrent arms share one microphone acquisition');
  releaseMic(makeStream()); assert.equal(await old,false); assert.equal(await newest,true);
  barge.cleanup();
}

function handoffEndpointChecks() {
  let clock=1000, tick, ended=0;
  const c=vm.createContext({window:{AudioContext:class {
    createAnalyser(){return {fftSize:1024,getFloatTimeDomainData:buf => buf.fill(0)};}
    createMediaStreamSource(){return {connect() {}};}
    close() {}
  }},Float32Array,Date:{now:() => clock},CLAVIS_VS:{mark() {}},
    setInterval:fn => {tick=fn;return 1;},clearInterval() {}});
  vm.runInContext(between('function clavisSilenceWatch(', '\nasync function legacyStartGroqWhisperVoiceInput(')+'\nthis.watch=clavisSilenceWatch;',c);
  const stop=c.watch({},() => ended++,850,true);
  tick(); clock+=851; tick(); assert.equal(ended,1,'a short utterance already captured by barge-in endpoints on silence');
  assert.equal(stop.heard(),true);
}

function noiseAndRomanChecks() {
  const voice=fs.readFileSync(path.join(__dirname,'..','clavis-voice.js'),'utf8');
  const c=vm.createContext({});
  vm.runInContext(voice.slice(voice.indexOf('  const WORDS ='),voice.indexOf('  const VOW ='))+'\nthis.roman=toHinglish;',c);
  assert.equal(c.roman('मैं दिल्ली में हूँ।',true),'Main delhi mein hoon.');
  assert.equal(c.roman('Hello. Hello.',true),'Hello. Hello.','spoken repetitions and English words stay intact');
  assert.equal(c.roman('हाँ। हाँ।',true),'Haan. Haan.');
  let clock=1000,tick,level=0,ended=0,resumed=0,running=false;
  const barge=fs.readFileSync(path.join(__dirname,'..','clavis-barge-in.js'),'utf8');
  vm.runInContext(barge.slice(barge.indexOf('  function voiced('),barge.indexOf('  function outputLevel('))+'\nthis.pitch=voiced;',c);
  assert.equal(c.pitch(new Float32Array(1024).fill(.03),48000),false,'DC offset is not a pitched voice');
  c.window={ClavisBargeIn:{hasPitch:c.pitch},AudioContext:class {
    constructor(){this.state='suspended';this.sampleRate=48000;}
    async resume(){resumed++;this.state='running';}
    createAnalyser(){return {fftSize:1024,getFloatTimeDomainData:buf => {for(let i=0;i<buf.length;i++)buf[i]=level*Math.sin(2*Math.PI*180*i/48000);}};}
    createMediaStreamSource(){return {connect() {}};} close() {}
  }};
  c.Date={now:()=>clock};c.CLAVIS_VS={mark() {}};
  c.setInterval=fn=>{running=true;tick=()=>{if(running)fn();};return 1;};c.clearInterval=()=>{running=false;};
  vm.runInContext(between('function clavisSilenceWatch(', '\nasync function legacyStartGroqWhisperVoiceInput(')+'\nthis.watch=clavisSilenceWatch;',c);
  const stop=c.watch({},()=>ended++,850);
  level=.06;tick();level=0;for(let i=0;i<25;i++){clock+=50;tick();}
  assert.equal(stop.heard(),false,'one click cannot upload audio');assert.equal(ended,0);
  level=.06;for(let i=0;i<4;i++){clock+=50;tick();}
  assert.equal(stop.heard(),true);level=0;for(let i=0;i<25;i++){clock+=50;tick();}
  assert.equal(ended,1,'sustained voice endpoints after silence');assert.equal(resumed,1);
}

function captureHarness() {
  const uploads = [], sent = [], timers = [];
  let resolveSTT, currentOwner = 'owner-a', enabled = true, trackStops = 0;
  const VS = {canProcessMic: () => enabled, registerAudioCleanup() {}, mark() {}, setMicEnabled: v => { enabled = v; }, mic: {
    claim(_owner, fn) { this.stopFn = fn; }, release() { const fn = this.stopFn; this.stopFn = null; fn?.(); },
  }};
  const ctx = {
    window: {addEventListener() {}, SupabaseAuth:{getUser: () => ({id:currentOwner})}, ClavisDirect:{providerConfigured: () => true,
      transcribeWithGroq: (blob, signal) => { uploads.push({blob,signal}); return new Promise(resolve => { resolveSTT = resolve; }); }}, ClavisEar:{caption:{listening(){}}}},
    navigator:{mediaDevices:{getUserMedia:async () => ({getTracks: () => [{stop: () => trackStops++}]})}},
    document:{getElementById: () => null}, localStorage:{setItem() {},getItem:() => null},
    MediaRecorder:class {
      static isTypeSupported() { return true; }
      constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable({data:new Blob(['x'.repeat(1500)])}); this.done = this.onstop(); }
    },
    AbortController, Blob, console, CLAVIS_VS:VS, isGroqRecording:false, groqMediaRecorder:null,
    setTimeout: fn => {timers.push(fn); return timers.length;}, clearTimeout() {},
    clavisSpeakingNow: () => false, clavisIsAwake: () => true,
    clavisSilenceWatch: () => Object.assign(() => {}, {heard:() => true}), setJarvisStatus() {},
    clavisShowVoicePreview() {}, commitJarvisVoiceInput:async text => {sent.push(text);}, scheduleHandsFreeRelisten() {},
  };
  vm.createContext(ctx); vm.runInContext(controls + recorder + '\nthis.start = legacyStartGroqWhisperVoiceInput; this.cancel = stopGroqCapture;',ctx);
  return {ctx,uploads,sent,timers, resolve:text => resolveSTT(text), owner:value => {currentOwner = value;}, stops:() => trackStops};
}

(async () => {
  await queueChecks();
  await engineChecks();
  await transcriptionChecks();
  muteChecks();
  await audioReadyChecks();
  await bargeCaptureChecks();
  handoffEndpointChecks();
  noiseAndRomanChecks();
  const h = captureHarness(); await h.ctx.start();
  const first = h.ctx.groqMediaRecorder;
  first.stop(); await settle();
  assert.equal(h.uploads.length,1);
  await h.ctx.start(); assert.equal(h.uploads.length,1,'no second capture during transcription');
  h.resolve('Explain the CRM'); await first.done; assert.deepEqual(h.sent,['Explain the CRM']);
  await h.ctx.start(); const second = h.ctx.groqMediaRecorder;
  h.timers[0](); assert.equal(second.state,'recording','old capture timer cannot stop new recorder');
  second.stop(); await settle(); h.ctx.cancel();
  assert.equal(h.uploads[1].signal.aborted,true); h.resolve('Late transcript'); await second.done;
  assert.equal(h.sent.length,1,'cancelled transcript cannot launch a new turn');
  await h.ctx.start(); const third = h.ctx.groqMediaRecorder;
  third.stop(); await settle(); h.owner('owner-b'); h.resolve('Another account transcript'); await third.done;
  assert.equal(h.sent.length,1,'account switch blocks pending transcript');
  assert.ok(h.stops() >= 3);
  console.log('Groq capture + Cartesia reply ownership: PASS');
})().catch(error => {console.error(error); process.exitCode=1;});
