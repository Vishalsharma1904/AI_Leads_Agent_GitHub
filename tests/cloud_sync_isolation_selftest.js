'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function harness(){
  let user={id:'a',email:'a@example.com'};const writes=[],restores=[],events={},storage=new Map();
  const window={SKYLARK_CONFIG:{BACKEND_URL:'https://trusted.example.com',DEFAULT_CITY:'Delhi'},
    SupabaseAuth:{getUser:()=>user,getClient:()=>({from:()=>({upsert:async row=>{writes.push(row);return{};},select:()=>({eq:()=>({maybeSingle:async()=>({data:null})})})})})},
    MemoryEngine:{getAllLeads:async()=>[],saveAllLeads:async rows=>restores.push({user:user.id,rows})},
    addEventListener:(name,fn)=>events[name]=fn};
  vm.runInNewContext(fs.readFileSync('cloud-sync.js','utf8'),{window,console,document:{querySelectorAll:()=>[]},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setTimeout,clearTimeout,setInterval:()=>1});
  return{window,writes,restores,storage,switch(){user={id:'b',email:'b@example.com'};events['rudra:auth-state']?.();}};
}
(async()=>{
  const push=harness(),pending=deferred();push.window.MemoryEngine.getAllLeads=()=>pending.promise;
  const saving=push.window.CloudSyncManager.pushNow();push.switch();pending.resolve([{id:'b-private'}]);
  assert.equal(await saving,false);assert.equal(push.writes.length,0,'changed account must not upload mixed records');
  const pull=harness(),response=deferred();
  pull.window.SupabaseAuth.getClient=()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:()=>response.promise})})})});
  const loading=pull.window.CloudSyncManager.pullLatest();pull.switch();response.resolve({data:{payload:{leads:[{id:'a-private'}]}}});
  assert.equal(await loading,null);assert.equal(pull.restores.length,0,'late A response must not enter B cache');
  const edited=harness(),old=deferred();
  edited.window.SupabaseAuth.getClient=()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:()=>old.promise})})})});
  const reading=edited.window.CloudSyncManager.pullLatest();edited.window.CloudSyncManager.schedulePush(60000);
  old.resolve({data:{payload:{leads:[{id:'old-cloud'}]}}});await reading;
  assert.equal(edited.restores.length,0,'in-flight cloud read must preserve newly edited local work');edited.switch();
  const settings=harness();await settings.window.CloudSyncManager.restoreCloudBundle({settings:{BACKEND_URL:'https://wrong.example.com',DEFAULT_CITY:'Mumbai'}});
  assert.equal(settings.window.SKYLARK_CONFIG.BACKEND_URL,'https://trusted.example.com');
  assert.equal(settings.window.SKYLARK_CONFIG.DEFAULT_CITY,'Mumbai');
  const activity=[];settings.window.RudraAccountControl={activity:(kind,state)=>activity.push([kind,state])};
  settings.window.CloudSyncManager.updateStatusUI('offline');settings.window.CloudSyncManager.updateStatusUI('synced');
  assert.equal(JSON.stringify(activity),JSON.stringify([['sync','offline'],['sync','synced']]));
  console.log('PASS cloud sync: delayed upload/read isolation and device connection preservation');
})().catch(error=>{console.error(error);process.exitCode=1;});
