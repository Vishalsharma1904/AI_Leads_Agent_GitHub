'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
let owner = 'one'; const store = new Map(), events = new Map();
const window = {SupabaseAuth:{getUser:()=>({id:owner})},ClavisVoiceState:{canProcessMic:()=>true,isClavisWorkspace:()=>true},
  ClavisWake:{match:text=>{const m=/^rudra(?:\s+(.*))?$/i.exec(text);return m?{rest:m[1]||''}:null;},named:text=>/^rudra(?:\s|$)/i.test(text)},
  addEventListener:(name,fn)=>events.set(name,fn),dispatchEvent(){}};
const document = {readyState:'loading',addEventListener(){},getElementById:()=>null,documentElement:{setAttribute(){}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../clavis-ear.js'),'utf8'), {window,document,navigator:{mediaDevices:{addEventListener:(name,fn)=>events.set(name,fn)}},
  localStorage:{getItem:key=>store.get(key)??null,setItem:(key,v)=>store.set(key,v),removeItem:key=>store.delete(key)},
  setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},AbortController,console});
const {voiceId,tap}=window.ClavisEar;
const vector = offset=>Array.from({length:13},(_,i)=>offset+i*.01);
function evidence(count,offset=0){tap.owner=owner;tap.device='mic-one';tap.frames=Array.from({length:count},(_,i)=>({t:Date.now()-count*32+i*32,v:vector(offset)}));return voiceId.capture(tap.frames[0]?.t,Date.now());}
assert.equal(voiceId.mode(),'session');
assert.equal(voiceId.establish(evidence(60)),false,'passive audio cannot claim main speaker');
const wake=window.ClavisEar.judge('Rudra');
assert.equal(wake.accept,true,'an uncalibrated session can hear its wake phrase');
assert.equal(wake.wakeOnly,true,'wake phrase wakes listening without bypassing command verification');
voiceId.beginSession();
const firstSample=evidence(30);
assert.equal(voiceId.establish(firstSample),false);
assert.equal(voiceId.establish(firstSample),false,'repeated evidence cannot complete enrollment');
assert.equal(voiceId.establish(evidence(30)),true,'short final utterances complete temporary reference');
assert.equal(voiceId.check({voiceEvidence:evidence(20)}).verdict,'owner');
assert.equal(voiceId.check({voiceEvidence:evidence(20,4)}).verdict,'other');
const profile=voiceId.profile();
voiceId.check({voiceEvidence:evidence(20,.1)});
assert.equal(voiceId.profile(),profile,'checking never adapts reference');
assert.equal(voiceId.check({voiceEvidence:evidence(2)}).reason,'too-short');
events.get('clavis:wake-change')({detail:{awake:false}});
assert.equal(voiceId.status().enrolled,false,'sleep clears reference');
voiceId.beginSession();voiceId.establish(evidence(60));owner='two';
events.get('rudra:auth-state')();assert.equal(voiceId.status().enrolled,false);
voiceId.beginSession();voiceId.establish(evidence(60));events.get('devicechange')();
assert.equal(voiceId.status().enrolled,false);
voiceId.beginSession();voiceId.establish(evidence(60));events.get('clavis:capability-change')({detail:{capability:'micEnabled',value:false}});
assert.equal(voiceId.status().enrolled,false,'mute clears reference');
store.set('clavis_voiceprint_v2:two','saved-profile-sentinel');
voiceId.setMode('registered');assert.equal(voiceId.mode(),'registered');
voiceId.setMode('session');assert.equal(store.get('clavis_voiceprint_v2:two'),'saved-profile-sentinel');
console.log('PASS session speaker: deliberate activation, 60-frame reference, owner/guest/unknown, immutable reference, sleep/account/device reset, saved-profile preservation');
