'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const text=fs.readFileSync('app.js','utf8');const start=text.indexOf('function runScrapeFromChat('),end=text.indexOf('// Exposed so the desk pet',start);
let picker,launches=[];
const task={id:'client-fixture',phase:'working',mode:'leads'};
const w={RealScraper:{isRunning:()=>false},ClavisTask:{current:()=>task,event(){},requestLeadScope:(id,action,query,runner)=>{picker={id,action,runner};}},
 AgentCtrl:{runFromChat:p=>launches.push(p)},SKYLARK_CONFIG:{DEFAULT_CITY:'Gurugram'}};
const context=vm.createContext({window:w,document:new EventTarget(),setTimeout:fn=>fn(),addChatMessage(){},console,escHtml:s=>s,chatSuggestionHtml:()=>''});
vm.runInContext(text.slice(start,end),context);
context.runScrapeFromChat({cities:['Delhi'],industries:['ALL'],count:20});
assert.ok(picker,'Client AI uses the same floating scope picker');assert.equal(launches.length,0,'first prompt does not dispatch');
picker.runner(picker.id,{...picker.action,industries:['Hotels','Hospitals']});
assert.equal(launches.length,1);assert.deepEqual(Array.from(launches[0].industries),['Hotels','Hospitals']);
launches=[];picker.runner(picker.id,{...picker.action,industries:['ALL']});
assert.equal(launches.length,1,'All confirmation launches once without asking again');
assert.deepEqual(Array.from(launches[0].industries),['ALL']);
console.log('Client AI scope picker, multi-industry and All forwarding: passed');
