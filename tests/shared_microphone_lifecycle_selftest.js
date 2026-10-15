'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../clavis-local-speech.js'), 'utf8');
const helpers = source.slice(source.indexOf('  class LocalSpeechEngine'), source.indexOf('\n  window.LocalSpeechEngine ='));
let enabled = true, owner = 'account-a', stopped = 0;
const pending = [], constraints = [];
const stream = () => { const track = {readyState:'live', stop() { stopped++; this.readyState = 'ended'; }}; return {getTracks:()=>[track]}; };
const context = vm.createContext({ window:{ClavisVoiceState:{canProcessMic:()=>enabled},SupabaseAuth:{getUser:()=>({id:owner})},dispatchEvent(){}},
  navigator:{mediaDevices:{getUserMedia:options=>{constraints.push(options);return new Promise(resolve=>pending.push(resolve));}}}, localStorage:{setItem(){}},
  document:{documentElement:{dataset:{}}}, CustomEvent:class{}, SHARED_STREAM_KEY:'test', microphoneStatus(){} });
vm.runInContext(helpers + '\nthis.Engine = LocalSpeechEngine;',context);
async function earTapChecks() {
  const ear = fs.readFileSync(require('node:path').join(__dirname, '../clavis-ear.js'), 'utf8');
  const tapSource = ear.slice(ear.indexOf('  const tap = {'), ear.indexOf('\n  function melBank('));
  const waiting = [], contexts = [];
  let originalStops = 0, cloneStops = 0, canListen = true, intervals = 0;
  const original = {getTracks:()=>[{stop:()=>originalStops++}], clone:()=>({getTracks:()=>[{stop:()=>cloneStops++}]})};
  const w = {ClavisVoiceState:{canProcessMic:()=>canListen}, LocalSpeechEngine:{acquireVoiceMicrophone:()=>new Promise(resolve=>waiting.push(resolve))},
    AudioContext:class {
      constructor(){this.state='running';this.sampleRate=48000;contexts.push(this);}
      createMediaStreamSource(){return {connect(){},disconnect(){}};}
      createAnalyser(){return {frequencyBinCount:512,fftSize:1024};}
      close(){this.state='closed';return Promise.resolve();}
    }};
  const c = vm.createContext({window:w,navigator:{},Float32Array,lsGet:()=> 'true',melBank:()=>[],
    setInterval:()=>++intervals,clearInterval:()=>intervals--,FRAME_MS:32,KEEP_MS:20000,now:Date.now,
    account:()=> 'account-a',microphoneDevice:()=> 'mic-a',resetEvidence(){},abortEnrollment(){}});
  vm.runInContext(tapSource+'\nthis.tap=tap;',c);
  const cancelled = c.tap.start('elevenlabs');
  c.tap.releaseAll();canListen=false;waiting[0](original);
  assert.equal(await cancelled,false,'cleanup invalidates an in-flight feature tap');
  assert.equal(contexts.length,0,'late microphone permission cannot open an analyser after mute');
  assert.equal(intervals,0);
  canListen=true;
  const next=c.tap.start('elevenlabs');waiting[1](original);assert.equal(await next,true);
  c.tap.frames.push({t:1,v:[1]});c.tap.floor=.1;c.tap.lastRms=.1;
  c.tap.stop('elevenlabs');
  assert.equal(c.tap.frames.length,0,'release removes preceding speaker samples');
  assert.equal(c.tap.floor,.006);assert.equal(c.tap.lastRms,0);
  assert.equal(originalStops,0,'feature tap never stops the microphone borrowed by STT');
  assert.ok(cloneStops>0,'the feature tap releases its own cloned tracks');
  assert.equal(contexts.at(-1).state,'closed','the last listener releases its audio context');
  const old=c.tap.start('elevenlabs');c.tap.releaseAll();
  const fresh=c.tap.start('elevenlabs');
  assert.equal(waiting.length,4,'a fresh tap starts without waiting for a cancelled acquisition');
  waiting[2](original);assert.equal(await old,false);
  assert.equal(c.tap.users.has('elevenlabs'),true,'old startup cannot remove the new listener tag');
  waiting[3](original);assert.equal(await fresh,true);c.tap.releaseAll();
  w.LocalSpeechEngine.acquireVoiceMicrophone=()=>{throw new Error('Device temporarily unavailable');};
  assert.equal(await c.tap.start('elevenlabs'),false);
  w.LocalSpeechEngine.acquireVoiceMicrophone=()=>Promise.resolve(original);
  assert.equal(await c.tap.start('elevenlabs'),true,'a synchronous microphone failure permits a later explicit retry');
  c.tap.releaseAll();
}
async function ownerPolicyChecks() {
  const ear = fs.readFileSync(require('node:path').join(__dirname, '../clavis-ear.js'), 'utf8');
  const prefix = ear.slice(ear.indexOf('  const now ='),ear.indexOf('\n  /* ── 1.'));
  const classifier = ear.slice(ear.indexOf('  function stats('),ear.indexOf('  function createDoubleTalk(',ear.indexOf('  function stats(')));
  let currentOwner='a', time=10000, canListen=true, pulse;
  const store=new Map(), tap={frames:[],device:'mic-a',owner:'a',consumedAt:0,
    start:async()=>{tap.an={};return true;},stop:()=>{tap.an=null;tap.frames=[];},since:(a,b=time)=>tap.frames.filter(f=>f.t>=a&&f.t<=b).map(f=>f.v)};
  const c=vm.createContext({window:{SupabaseAuth:{getUser:()=>({id:currentOwner})},ClavisVoiceState:{canProcessMic:()=>canListen}},
    localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},Date:{now:()=>time},
    tap,NCEP:12,AbortController,setInterval:fn=>{pulse=fn;return 1;},clearInterval(){},console});
  vm.runInContext(prefix+classifier+'\nthis.id=voiceId;',c);
  const id=c.id,key='clavis_voiceprint_v2:a';
  store.set('clavis_speaker_mode:a','registered');
  const profile=()=>({v:2,owner:currentOwner,device:tap.device,at:1,n:150,mu:Array(13).fill(0),sd:Array(13).fill(1),thr:1});
  assert.equal(id.required(),true,'policy does not disappear when calibration is missing');
  assert.equal(id.check().verdict,'unknown');
  store.set(key,JSON.stringify(profile()));
  const frames=value=>{tap.frames=Array.from({length:15},(_,i)=>({t:time-500+i*32,v:Array(13).fill(value)}));};
  frames(0);const matched=id.capture();assert.equal(id.check({voiceEvidence:matched}).verdict,'owner');
  assert.equal(Object.isFrozen(matched),true);assert.equal(id.check({voiceEvidence:{...matched}}).verdict,'unknown','forged evidence is refused');
  const unchanged=store.get(key);id.check({voiceEvidence:matched});assert.equal(store.get(key),unchanged,'checking cannot silently adapt the profile');
  tap.frames=[];assert.equal(id.check({voiceEvidence:matched}).verdict,'owner','issued evidence survives normal clone release during transcription');
  frames(4);assert.equal(id.check().verdict,'other');frames(1.2);assert.equal(id.check().verdict,'unsure');
  tap.frames= tap.frames.slice(0,4);assert.equal(id.check().verdict,'unknown','short clips fail closed');
  frames(0);tap.consumedAt=time;assert.equal(id.capture().frames,0,'consumed owner speech cannot prove a later guest utterance');tap.consumedAt=0;
  tap.device='mic-b';assert.equal(id.check({voiceEvidence:matched}).verdict,'unknown','another microphone requires calibration');tap.device='mic-a';
  currentOwner='b';store.set('clavis_voiceprint_v2:b',JSON.stringify(profile()));assert.equal(id.check({voiceEvidence:matched}).verdict,'unknown','another account cannot reuse evidence');currentOwner='a';
  canListen=false;assert.equal(id.check({voiceEvidence:matched}).verdict,'unknown','mute/route gate rejects pending samples');canListen=true;
  time+=31000;assert.equal(id.check({voiceEvidence:matched}).verdict,'unknown','provider-late evidence expires');
  store.set(key,JSON.stringify({...profile(),sd:[0]}));assert.equal(id.profile(),null,'invalid calibration is rejected');
  store.set(key,JSON.stringify(profile()));id.setEnabled(false);assert.equal(id.required(),false);id.setEnabled(true);assert.equal(id.required(),true);
  const enrolling=id.enroll();await new Promise(resolve=>setImmediate(resolve));
  tap.frames=Array.from({length:150},(_,i)=>({t:time+i*32,v:Array(13).fill(0)}));time+=5000;pulse();await enrolling;
  assert.equal(id.profile().owner,'a');assert.equal(id.profile().device,'mic-a');assert.equal(id.profile().n,150,'samples are saved before capture cleanup clears them');
  const saved=store.get(key),cancelled=id.enroll();await new Promise(resolve=>setImmediate(resolve));id.cancelEnrollment();
  await assert.rejects(cancelled,e=>e.name==='AbortError');assert.equal(store.get(key),saved,'cancelled calibration cannot overwrite the saved profile');
  const switched=id.enroll();await new Promise(resolve=>setImmediate(resolve));currentOwner='b';pulse();await assert.rejects(switched,e=>e.name==='AbortError');
  assert.equal(store.get(key),saved,'account changes cannot save a late enrollment');
}
async function localInputLifecycleChecks() {
  const sockets=[], captures=[], stopTags=[];let add=async()=>{}, micAllowed=true, currentOwner='a';
  const w={ClavisVoiceState:{canProcessMic:()=>micAllowed},SupabaseAuth:{getUser:()=>({id:currentOwner}),getAccessToken:()=> 'session'},
    ClavisWorklet:{add:(...args)=>add(...args)},ClavisEar:{tap:{start:async()=>true,stop:tag=>stopTags.push(tag),consume(){}},
      voiceId:{required:()=>true,capture:since=>{captures.push(since);return {since:since??1000,until:2000,verdict:'owner'};},check:meta=>({verdict:meta.voiceEvidence.verdict})}}};
  const WebSocket=class {
    static OPEN=1;
    constructor(){this.readyState=1;sockets.push(this);} send(){} close(){this.readyState=3;this.onclose?.();}
    emit(payload){this.onmessage?.({data:JSON.stringify({...payload,generation_id:this._generationId})});}
  };
  const audio={destination:{},createMediaStreamSource:()=>({connect(){return this;},disconnect(){}}),createGain:()=>({gain:{},connect(){return this;}})};
  const c=vm.createContext({window:w,WebSocket,Date,Math,websocketUrl:()=> 'ws://test',WS_INPUT_PATH:'input',SHARED_STREAM_KEY:'test',
    localStorage:{getItem:()=>null},document:{getElementById:()=>null,querySelectorAll:()=>[]},microphoneStatus(){},localStatus(){},
    AudioWorkletNode:class {constructor(){this.port={};}connect(){return this;}disconnect(){}}});
  vm.runInContext(helpers+'\nthis.Engine=LocalSpeechEngine;',c);
  const engine=new c.Engine();engine.ensureAudioContext=async()=>{engine.audioContext=audio;};engine.acquireVoiceMicrophone=async()=>({});
  let release;add=()=>new Promise(resolve=>{release=resolve;});
  const workletPending=engine.startInput();await new Promise(resolve=>setImmediate(resolve));
  engine.stopInput();release();assert.equal(await workletPending,false);
  assert.equal(sockets.length,0,'stop during worklet startup cannot create a later speech socket');
  add=async()=>{};
  const readyPending=engine.startInput();await new Promise(resolve=>setImmediate(resolve));
  engine.stopInput();assert.equal(await readyPending,false,'stop settles a pending server readiness');
  assert.equal(engine.captureNode,null);
  const partials=[],finals=[],active=engine.startInput({persistent:true,onPartial:(text,meta)=>partials.push(meta),onFinal:(text,meta)=>finals.push(meta)});
  await new Promise(resolve=>setImmediate(resolve));const socket=sockets.at(-1);socket.emit({type:'ready'});assert.equal(await active,true);
  socket.emit({type:'partial',text:'question'});socket.emit({type:'final',text:'complete question'});
  assert.equal(captures.at(-1),1000,'local final verifies the same acoustic segment as its partial');
  assert.equal(finals.length,1);assert.ok(finals[0].voiceEvidence);
  currentOwner='b';socket.emit({type:'final',text:'previous account'});assert.equal(finals.length,1);
  engine.stopInput();assert.ok(stopTags.includes('local'));
}
(async () => {
  const engine = new context.Engine(); engine.stopInput = () => {};
  const one = engine.acquireVoiceMicrophone(), two = engine.acquireVoiceMicrophone();
  assert.equal(pending.length,1,'concurrent callers share one permission request');
  assert.equal(constraints[0].audio.autoGainControl,false,'processed voice capture never requests automatic gain');
  const first = stream(); pending[0](first);
  assert.equal(await one,first); assert.equal(await two,first); engine.releaseMicrophone(); assert.equal(stopped,1);
  const stale = engine.acquireVoiceMicrophone(); const rejects = assert.rejects(stale,e=>e.name==='AbortError');
  engine.releaseMicrophone(); const fresh = engine.acquireVoiceMicrophone(); const freshPending = engine._voiceStreamPending;
  pending[1](stream()); await rejects; assert.equal(stopped,2,'release rejects and stops late permission');
  assert.equal(engine._voiceStreamPending,freshPending,'old cleanup cannot erase a newer request');
  const current = stream(); pending[2](current); assert.equal(await fresh,current);
  assert.equal(await engine.acquireVoiceMicrophone(),current,'live stream is reused'); assert.equal(pending.length,3);
  engine.releaseMicrophone();
  const raw = engine.acquireSharedMicrophone(); const blocked = assert.rejects(raw,e=>e.name==='AbortError');
  enabled=false; pending[3](stream()); await blocked; assert.equal(engine.sharedStream,null,'mute cannot retain a late raw stream');
  enabled=true; const switched=engine.acquireVoiceMicrophone(); const different=assert.rejects(switched,e=>e.name==='AbortError');
  owner='account-b'; pending[4](stream()); await different; assert.equal(engine.voiceStream,null,'account switch cannot retain prior mic');
  await earTapChecks();
  await ownerPolicyChecks();
  await localInputLifecycleChecks();
  console.log('Shared microphone + owner policy, interval evidence and enrollment cancellation: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
