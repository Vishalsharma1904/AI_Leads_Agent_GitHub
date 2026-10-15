'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..');
const policy={user_id:'member',owner:false,status:'trial',expires_at:0,features:{ai:true,leads:true,voice:true,calls:true,whatsapp:true},monthly_limits:{},revision:1,disclosure:{version:'2026-10-13',accepted:false},limits:{meters:{ai:{used:2,limit:300},leads:{used:1,limit:50},calls:{used:0,limit:25},whatsapp:{used:0,limit:20}}},subscription:{plan_label:'Owner access',active:true},note:'',providers:[{provider:'groq',mode:'shared',configured:true}],email:'member@example.com',name:'<img src=x onerror=alert(1)>',phone:'',company:'Acme',devices:[]};
const calls=[];
Object.assign(policy.limits.meters,{tts_characters:{used:0,limit:50000},voice_seconds:{used:0,limit:3600},voice_sessions:{used:0,limit:100}});
(async()=>{
const browser=await chromium.launch({headless:true,channel:"chrome"});try{
const context=await browser.newContext({viewport:{width:1280,height:900}});
await context.route('**/*',async route=>{
 const request=route.request(),url=request.url();
 if(url.includes('/api/control/')){
  const target=url.split('/api/control')[1].split('?')[0],method=request.method();calls.push({target,method,body:request.postDataJSON()});
  if(target==='/events')return route.fulfill({status:503,body:'{}',contentType:'application/json'});
  let data;
  if(target==='/me'||target==='/users/member')data=policy;
  else if(target==='/disclosure'){policy.disclosure.accepted=true;data={accepted:true};}
  else if(target==='/users')data={items:[{id:'member',name:policy.name,email:policy.email,status:'trial'}],total:1,offset:0,limit:30};
  else if(target==='/users/member/usage')data={items:[{meter:'ai',amount:2,basis:'provider_reported',state:'succeeded'}],total:1};
  else if(target==='/providers')data={items:[{provider:'groq',configured:true,enabled:true,monthly_requests:50,used_requests:2,monthly_spend_inr:100,max_request_cost_inr:2}]};
  else if(target==='/releases')data={items:[]};else data={ok:true};
  return route.fulfill({body:JSON.stringify(data),contentType:'application/json'});
 }
 const asset=new URL(url).pathname.slice(1);
 if(asset==='index.html')return route.fulfill({contentType:'text/html',body:'<html><head><meta charset="utf-8"><link rel="stylesheet" href="developer-control.css"></head><body><main><div class="di-shell"></div></main><script src="developer-control.js"></script><script src="account-control.js"></script><script src="clavis-perf.js"></script></body></html>'});
 if(fs.existsSync(path.join(root,asset)))return route.fulfill({path:path.join(root,asset),contentType:asset.endsWith('.js')?'application/javascript':asset.endsWith('.css')?'text/css':'application/octet-stream'});return route.abort();
});
await context.addInitScript("window.SKYLARK_CONFIG={BACKEND_URL:'http://localhost:3025'};window.identity='member';window.SupabaseAuth={getAccessToken:()=>window.identity?'fixture-'+window.identity:'',getUser:()=>window.identity?{id:window.identity}:null,signOut:async()=>{window.identity='';window.dispatchEvent(new CustomEvent('rudra:auth-state'));}};");
const page=await context.newPage(),errors=[];page.on('console',m=>{if(m.type()==='error')console.error('BROWSER',m.text());});page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',e.message);});
await page.goto('http://localhost:3025/index.html#developer');
await page.getByRole('button',{name:'I understand — continue'}).click({timeout:10000});await page.locator('.rudra-disclosure').waitFor({state:'detached'});
await page.getByRole('button',{name:'Open workspace'}).click();await page.getByRole('heading',{name:'Access & subscription'}).waitFor();
assert.equal(await page.locator('#developer-control img').count(),0);
await page.getByLabel('ai per day',{exact:true}).fill('42');
await page.getByLabel('Speech output characters per day',{exact:true}).fill('1000');
await page.getByLabel('Uploaded audio seconds (rounded up) per month (blank = no extra cap)',{exact:true}).fill('7200');
await page.getByLabel('Realtime session tokens per day',{exact:true}).fill('12');
await page.getByRole('button',{name:'Save access & limits'}).click();
await page.waitForFunction(()=>!!document.querySelector('#developer-control h3'));assert.equal(calls.filter(c=>c.target==='/users/member'&&c.method==='PATCH').at(-1).body.daily_limits.ai,42);
const saved=calls.filter(c=>c.target==='/users/member'&&c.method==='PATCH').at(-1).body;
assert.equal(saved.daily_limits.tts_characters,1000);assert.equal(saved.daily_limits.voice_sessions,12);assert.equal(saved.monthly_limits.voice_seconds,7200);
await page.getByRole('button',{name:'usage',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#dc-body')?.textContent.includes('provider_reported'));
await page.getByRole('button',{name:'Shared providers',exact:true}).click();await page.getByRole('heading',{name:'Shared provider vault'}).waitFor();
await page.getByRole('button',{name:'Releases',exact:true}).click();await page.getByRole('heading',{name:'Controlled updates'}).waitFor();
await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
await page.evaluate(()=>{window.identity='';window.dispatchEvent(new CustomEvent('rudra:auth-state'));});await page.waitForTimeout(100);assert.equal(await page.locator('#dc-body').innerText(),'');assert.deepEqual(errors,[]);
console.log('PASS developer control browser: disclosure, safe rendering, limits, usage, provider/release views, mobile width, logout cleanup');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

