const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const events = new Map(), windowEvents = new Map(), shown = [], downloads = [];
let owner = 'a', now = 1e6, id = 0, input = { value:'', tagName:'TEXTAREA', dispatchEvent(){}, focus(){} }, sends = 0;
const timers = new Map();
const document = { hidden:false, readyState:'complete', activeElement:null, addEventListener:(n,f)=>events.set(n,f), getElementById:()=>input, dispatchEvent(e){events.get(e.type)?.(e);} };
const window = { document, SupabaseAuth:{getUser:()=>({id:owner})}, location:{hash:'#jarvis'}, RudraMotionUI:{show:s=>shown.push(s),hide(){}}, RealScraper:{exportExcel:rows=>{downloads.push(rows);return true;}}, EmailCtrl:{setLeadAudience:rows=>window.audience=rows}, sendLeadsToCallingAgent:rows=>window.calls=rows, handleJarvisSend:()=>sends++, ClavisIntent:{route:async()=>({handled:false})}, addEventListener:(n,f)=>windowEvents.set(n,f), dispatchEvent(e){windowEvents.get(e.type)?.(e);} };
class CustomEvent{constructor(type,{detail}){this.type=type;this.detail=detail;}}
class Event{constructor(type){this.type=type;}}
vm.runInNewContext(fs.readFileSync('clavis-ahead.js','utf8'),{window,document,CustomEvent,Event,Date:{now:()=>now},setTimeout:(f,delay)=>{timers.set(++id,{f,delay});return id;},clearTimeout:id=>timers.delete(id)});
const emit=(type,detail)=>events.get(type)?.({detail});
(async()=>{
const rows=[{id:'1',company:'A',email:'a@example.test',phone:'123'},{id:'2',company:'B'}];
emit('nexus:scrapedone',{ok:true,taskId:'t1',leads:rows,requested:5,exported:false});
assert.equal(downloads.length,1);assert.equal(downloads[0],rows);assert.equal(shown.length,1);assert.match(shown[0].label,/2 of 5/);assert.doesNotMatch(shown[0].label,/backup/);assert.ok(shown[0].actions.length>=3);
emit('nexus:scrapedone',{ok:true,taskId:'t1',leads:rows,exported:false});assert.equal(downloads.length,1);assert.equal(shown.length,1);
await window.ClavisAhead.run(1);assert.equal(window.audience.length,1);assert.equal(window.location.hash,'#email');assert.equal(window.calls,undefined);
owner='b';windowEvents.get('rudra:auth-state')();assert.equal(window.ClavisAhead.current(),null);assert.equal(window.ClavisAhead.context().recent.length,0);
emit('nexus:scrapedone',{ok:true,taskId:'t2',leads:rows,exported:true});assert.equal(downloads.length,1);
input.value='existing draft';assert.equal(window.ClavisAhead.respond('explain'),false);assert.equal(input.value,'existing draft');assert.equal(sends,0);
input.value='';assert.equal(window.ClavisAhead.respond('Explain the next move'),true);assert.equal(sends,1);assert.match(input.value,/Context: Lead agent/);
now+=100000;document.activeElement=input;input.value='typing';emit('nexus:scrapedone',{ok:false,taskId:'failed',error:'Provider unavailable'});assert.equal(window.ClavisAhead.current(),null);assert.equal(shown.length,2);
owner='c';windowEvents.get('rudra:auth-state')();document.activeElement=null;emit('calling:outcome',{id:'call-1',status:'failed',description:'Review required'});assert.equal(window.ClavisAhead.current().id,'calling-outcome');assert.equal(window.ClavisAhead.tryConfirm('yes but not that'),null);
assert.equal(window.ClavisAhead.tryConfirm('later').handled,true);assert.equal(window.ClavisAhead.current(),null);
console.log('Ahead: task-only auto-export, dedup, multi-actions, no silent calling, owner isolation, draft preservation, typing protection and exact confirmation passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
