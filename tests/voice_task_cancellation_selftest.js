'use strict';
// Runs the actual brain and skill registry, with no account, provider or sends.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  let account = 'a';
  const storage = new Map(), requests = [];
  const window = {addEventListener(){}, SupabaseAuth:{getUser:()=>({id:account})},
    ClavisDirect:{hasKey:()=>true,complete:async payload=>{requests.push(payload);return {choices:[{message:{content:'Done.'}}]};}},
    ClavisMind:{safety:{gate:async()=>({allowed:true})}}, AuthSystem:{getProfile:()=>({name:'Owner'})}};
  const ctx = vm.createContext({window,document:{readyState:'loading',addEventListener(){}},console,AbortController,
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},setTimeout,clearTimeout});
  for (const file of ['jarvis_skills.js','jarvis.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
  return {window, requests, account:value=>{account=value;}};
}
(async()=>{
  // An old turn's finally must not release a newer turn's conversation hold.
  const ui=fs.readFileSync(path.join(__dirname,'..','jarvis_ui.js'),'utf8');
  const pendingTurns=[], uiTimers=new Set();let releases=0,rests=0;
  const uiContext=vm.createContext({window:{ClavisVoiceState:{set(){},state:()=> 'PROCESSING',rest(){rests++;}}},
    clavisHoldTurn(){},clavisReleaseTurn(){releases++;},isJarvisSpeaking:false,
    clavisVoiceVerdict:()=>({accept:true}),
    clavisHandleSendCore:()=>new Promise(resolve=>pendingTurns.push(resolve)),clearTimeout:id=>uiTimers.delete(id)});
  vm.runInContext('let clavisToolsRunning=0,clavisAckTimer=null,clavisToolAcknowledged=false;\n'+ui.slice(ui.indexOf('let clavisTurnSeq ='),ui.indexOf('\nasync function clavisHandleSendCore'))+'\nthis.send=handleJarvisSend;',uiContext);
  const oldTurn=uiContext.send({source:'voice'}),newTurn=uiContext.send({source:'voice'});
  pendingTurns[0]();await oldTurn;assert.equal(releases,0);assert.equal(rests,0,'old completion cannot reset processing');
  pendingTurns[1]();await newTurn;assert.equal(releases,1);assert.equal(rests,1);
  for (const change of ['stop','account']) {
    const h=harness(), ctl=new AbortController();let approve,runs=0;
    h.window.ClavisMind.safety.gate=()=>new Promise(resolve=>{approve=resolve;});
    h.window.JarvisSkills.register('fixture',{run:()=>{runs++;return 'Done';}});
    const pending=h.window.JarvisSkills.invoke('fixture',{}, {signal:ctl.signal});await settle();
    if(change==='stop')ctl.abort();else h.account('b');
    approve({allowed:true});
    await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(runs,0,change+' while confirming never executes');
  }
  for (const change of ['stop','account']) {
    const h=harness(),ctl=new AbortController();let finish,second=0;
    h.window.ClavisDirect.complete=async()=>({choices:[{message:{content:'|||TOOL:{"skill":"first","params":{}}||| |||TOOL:{"skill":"second","params":{}}|||'}}]});
    h.window.JarvisSkills.register('first',{run:()=>new Promise(resolve=>{finish=resolve;})});
    h.window.JarvisSkills.register('second',{run:()=>{second++;return 'Done';}});
    const pending=h.window.JarvisEngine.sendMessage('Run my requested tasks',ctl.signal,null,null,{source:'voice'});await settle();
    assert.equal(typeof finish,'function');if(change==='stop')ctl.abort();else h.account('b');finish('First finished');
    await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(second,0,'no second action after '+change);
  }
  const h=harness();
  h.window.JarvisSkills.register('failed',{run:()=>({success:false,error:'Could not deliver'})});
  const failed=await h.window.JarvisSkills.invoke('failed');assert.equal(failed.success,false);assert.match(failed.error,/deliver/);
  h.window.ClavisDirect.complete=async()=>({choices:[{message:{content:'|||TOOL:{"skill":"failed","params":{}}|||'}}]});
  const failedReply=await h.window.JarvisEngine.sendMessage('Perform the requested step',new AbortController().signal,null,null,{source:'voice'});
  assert.match(failedReply.text,/Could not deliver/,'empty final narration cannot claim that a failed task finished');
  let confirm, sends=0;const ctl=new AbortController();
  h.window.clavisConfirm=()=>new Promise(resolve=>{confirm=resolve;});
  h.window.EmailCtrl={_sendOne:async()=>{sends++;return {success:true};}};
  const email=h.window.JarvisSkills.invoke('send_email',{to:'a@example.test',subject:'Test',body:'Test'}, {signal:ctl.signal});await settle();
  ctl.abort();confirm(true);await assert.rejects(email,error=>error.name==='AbortError');assert.equal(sends,0,'late approval cannot send a stopped email');
  h.window.clavisConfirm=async()=>false;
  const cancelled=await h.window.JarvisSkills.invoke('send_email',{to:'a@example.test',subject:'Test',body:'Test'});
  assert.equal(cancelled.success,false,'declined email is not successful delivery');
  console.log('Voice tasks: stop/account guards, late confirmation, honest failed outcomes PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
