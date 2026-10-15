const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../jarvis_ui.js'), 'utf8');
function section(from, to) { return source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from))); }
let stopped = 0, resumed = 0, released = 0, now = 1000, next = 0;
const timers = new Map();
const ctx = {Date:{now:()=>now}, CLAVIS_VS:{registerAudioCleanup(){},canProcessMic:()=>true},
  stopCommandEar(){stopped++;},stopWakeListener(){},clavisEnsureListening(){resumed++;},
  window:{LocalSpeechEngine:{releaseMicrophone(){released++;}},ClavisEar:{caption:{listening(){}}}},
  setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id)};
vm.createContext(ctx);
vm.runInContext(section('const clavisAIBackoff =', '// Scribe drops'),ctx);
ctx.clavisPauseVoiceForAI({retryAfterSeconds:12.5});
assert.equal(stopped,1); assert.equal(released,1);
assert.equal([...timers.values()][0].ms,12500);
ctx.clavisClearAIBackoff(); assert.equal(timers.size,0,'Manual retry/off cancels automatic resume');
assert.equal(ctx.clavisSTTRetryable({fallback:true,code:'STT_QUOTA_EXCEEDED'}),false);
assert.equal(ctx.clavisSTTRetryable({fallback:true,status:429}),false);
assert.equal(ctx.clavisSTTRetryable({fallback:true,code:'resource_exhausted'}),false);
assert.equal(ctx.clavisSTTRetryable({fallback:true,message:'network disconnected'}),true);
for (const code of ['insufficient_audio_activity', 'queue_overflow', 'session_time_limit_exceeded']) {
  assert.equal(ctx.clavisSTTRetryable({fallback:true,code}),true,code+' must reconnect instead of permanently muting');
}
assert.equal(ctx.clavisSTTRetryable({fallback:true,code:'session_time_limit_exceeded',status:403}),false);
let sample;
const preview = {CLAVIS_VS:{isClavisWorkspace:()=>true,getCapability:()=>true},
  localStorage:{getItem:key=>key==='clavis_tts_provider'?'elevenlabs':null},
  window:{},clavisWakeUp(){},showToast(){},setJarvisStatus(){},
  speakJarvisText:async (text,opts)=>{sample=opts;return true;}};
vm.createContext(preview);
vm.runInContext(section('function testJarvisVoice(', '// Exports'), preview);
async function checkStreamQueue() {
  const pending = new Map(), said = [];
  let serial = 0, stopped = 0;
  const sandbox = { setTimeout:(fn,ms)=>{pending.set(++serial,{fn,ms});return serial;},
    clearTimeout:id=>pending.delete(id), stopJarvisSpeech(){stopped++;},
    speakJarvisText:async text=>{said.push(text);return true;} };
  vm.createContext(sandbox);
  vm.runInContext(section('function clavisStreamSpeaker(', '// A tool that takes'),sandbox);
  const ctl = new AbortController(), queue = sandbox.clavisStreamSpeaker(ctl.signal);
  queue.push('First sentence. '); queue.push('Second sentence.');
  assert.equal(said.length,0,'First chunks wait briefly to coalesce');
  assert.equal([...pending.values()][0].ms,200);
  await queue.finish();
  assert.deepEqual(said,['First sentence. Second sentence.']);
  assert.equal(pending.size,0,'finish flushes immediately and cancels timer');
  const aborted = new AbortController(), canceled = sandbox.clavisStreamSpeaker(aborted.signal);
  canceled.push('Must never play.'); aborted.abort(); await canceled.finish();
  assert.equal(said.length,1); assert.equal(stopped,1); assert.equal(pending.size,0);
  const empty = sandbox.clavisStreamSpeaker(); empty.push(' '); await empty.finish();
  assert.equal(said.length,1,'Empty synchronous pump settles');
}
async function checkOwnerDispatchGate() {
  let woke = 0, offered = 0, dispatched = 0, accepted = false;
  const sandbox = {localStorage:{getItem:()=>null},window:{addEventListener(){},ClavisEar:{judge:()=>({accept:accepted,reason:'not-owner'}),caption:{clear(){}},voiceId:{capture:()=>({})}},
    ClavisWake:{continuous:()=>true}}, document:{getElementById:()=>null},
    clearTimeout(){}, jarvisVoiceCommitTimer:null, jarvisVoiceFinalTranscript:'',
    clavisCommitCommand:t=>t, clavisIsAwake:()=>true, clavisSpeakingNow:()=>false, clavisOpenMic:()=>false,
    clavisWakeMatch:t=>t==='Rudra'?{remainder:'',before:''}:null,
    clavisWakeUp(){woke++;}, clavisGate:{pending:true}, clavisGateOffer(){offered++;return true;},
    CLAVIS_VS:{rest(){},parseStop:()=>null}, console, playWakeChime(){}, clavisYawnIfSlept(){},
    setJarvisStatus(){},clavisEnsureListening(){dispatched++;}};
  sandbox.window.ClavisEar.caption.listening=()=>{};
  vm.createContext(sandbox);
  vm.runInContext(section('function clavisWordCount(', 'let wakeResultIndex'),sandbox);
  // Execute only the gate path; background words must have no wake/confirmation effects.
  await sandbox.commitJarvisVoiceInput('Rudra'); await sandbox.commitJarvisVoiceInput('haan');
  await sandbox.commitJarvisVoiceInput('Куда-то, может быть, call logs');
  assert.equal(woke,0); assert.equal(offered,0); assert.equal(dispatched,0);
  accepted=true; await sandbox.commitJarvisVoiceInput('Rudra');
  assert.equal(woke,1,'Verified owner can wake');
  await sandbox.commitJarvisVoiceInput('haan'); assert.equal(offered,1);
  let enrollmentChecks=0, preservedCommand='';
  sandbox.window.ClavisEar.voiceId={mode:()=> 'session',status:()=>({enrolled:enrollmentChecks>=2}),capture:()=>({}),establish:()=>++enrollmentChecks>=2};
  sandbox.clavisGateOffer=text=>{preservedCommand=text;return true;};
  await sandbox.commitJarvisVoiceInput('leads dikhao',{turnId:'first'});
  await sandbox.commitJarvisVoiceInput('ab main aur bol raha hoon',{turnId:'setup'});
  assert.equal(preservedCommand,'leads dikhao','setup speech never changes the preserved command');
  let answered = 0, prompted = 0, executed = 0;
  sandbox.clavisGate.pending = null;
  sandbox.window.ClavisEar.voiceId = {mode:()=> 'session',status:()=>({enrolled:true}),capture:()=>({})};
  sandbox.window.ClavisEar.judge = () => ({accept:false,voice:{verdict:'other'}});
  sandbox.window.ClavisEar.named = text => text.startsWith('Rudra ');
  sandbox.clavisWakeMatch = text => ({remainder:text.slice(6)});
  sandbox.window.ClavisRequestIntent = {classify:text=>({kind:text.startsWith('what')?'question':'action'})};
  sandbox.handleJarvisSend = options => { if(options.answerOnly) answered++; else executed++; };
  sandbox.clavisAskBeforeActing = (_,run) => {prompted++;sandbox.ownerApproval=run;};
  await sandbox.commitJarvisVoiceInput('Rudra what time is it?');
  assert.equal(answered,1);assert.equal(executed,0);
  await sandbox.commitJarvisVoiceInput('Rudra open website');
  assert.equal(prompted,1);assert.equal(executed,0,'guest action waits for owner');
  sandbox.ownerApproval();assert.equal(executed,1);
  await sandbox.commitJarvisVoiceInput('background open website');
  assert.equal(prompted,1,'unaddressed room speech cannot request actions');
}
(async()=>{assert.equal(await preview.testJarvisVoice(),true);assert.equal(sample.engine,'elevenlabs');assert.equal(sample.forceRepeat,true);
  await checkStreamQueue(); await checkOwnerDispatchGate();
  console.log('PASS voice UI: transient AI pause, explicit retry, exhausted STT guard and selected-provider preview');
})().catch(error=>{console.error(error);process.exitCode=1;});
