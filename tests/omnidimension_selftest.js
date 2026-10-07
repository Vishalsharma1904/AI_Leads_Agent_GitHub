'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const handler = require('../api/omnidimension');
const { validate, operation, queryString, needsConfirmation, seal, unseal, clean } = handler.check;
const defaults = require('../public-auth-config.json');
process.env.OMNIDIM_SESSION_KEY = crypto.randomBytes(32).toString('hex');
const cookie = seal('private-provider-key', 'business-a');
assert.equal(unseal(cookie, 'business-a'), 'private-provider-key');
assert.equal(unseal(cookie, 'business-b'), '');
assert.equal(unseal(cookie.slice(0,-8) + 'AAAAAAAA', 'business-a'), '');
assert(!cookie.includes('private-provider-key'));
assert.deepEqual(clean({ api_key: 'private-provider-key', message: 'private-provider-key', ok: 1 }, 'private-provider-key'), { message: '[redacted]', ok: 1 });
const create = operation('POST', '/agents/create');
validate({ name: 'Test', welcome_message: 'Namaste', context_breakdown: [{ title: 'Purpose', body: 'Qualify enquiries' }], languages: ['Hindi'] }, create.schema);
assert.throws(() => validate({ name: 'Test' }, create.schema));
assert.throws(() => validate({ name: 'Test', user_id: 99 }, create.schema));
assert.throws(() => operation('GET', '//evil.example/agents'));
assert.throws(() => operation('GET', '/agents/1/../../reseller'));
assert.throws(() => operation('POST', '/reseller/credits/transfer'));
assert.throws(() => queryString({ user_id: 99 }, operation('GET', '/phone_number/list')));
assert(needsConfirmation('POST','/sessions/create',{}));
assert(needsConfirmation('POST','/calls/dispatch',{}));
assert(needsConfirmation('POST','/phone_number/purchase',{}));
assert(!needsConfirmation('POST','/calls/bulk_call/create',{save_as_draft:true}));
assert(needsConfirmation('POST','/calls/bulk_call/create',{save_as_draft:false}));
assert(needsConfirmation('PUT','/calls/bulk_call/42',{action:'resume'}));
assert(!needsConfirmation('PUT','/calls/bulk_call/42',{action:'pause'}));

async function invoke({cookie:jar='',body,method='POST',origin='https://app.example',auth='Bearer test-jwt',user='business-a',accept=true}) {
  const calls=[];
  const saved=global.fetch;
  global.fetch=async(url,opts)=>{
    calls.push({url,opts});
    if(url===defaults.supabase_url+'/auth/v1/user') return { ok: accept, json:async()=>({id:user}) };
    return {ok:true,status:200,json:async()=>({success:true,id:42,organization:{name:'Business A'},balance:{amount:10,currency:'USD'}})};
  };
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.data=v;return this;}};
  try { await handler({method,headers:{host:'app.example',origin,authorization:auth,cookie:jar,'content-type':'application/json'},body},res); } finally {global.fetch=saved;}
  return {res,calls};
}
(async()=>{
  let result=await invoke({body:{action:'connect',secret:'valid-key'}});
  assert.equal(result.res.statusCode,200);
  assert(result.res.headers['Set-Cookie'].includes('Secure; HttpOnly; SameSite=Strict'));
  assert(!JSON.stringify(result.res.data).includes('valid-key'));
  const jar=result.res.headers['Set-Cookie'].split(';')[0];
  result=await invoke({cookie:jar,user:'business-b',body:{method:'GET',path:'/agents'}});
  assert.equal(result.res.statusCode,409);assert.equal(result.calls.length,1);
  result=await invoke({cookie:jar,body:{method:'POST',path:'/calls/dispatch',body:{agent_id:42,to_number:'+919876543210'}}});
  assert.equal(result.res.statusCode,409);assert.equal(result.calls.length,1);
  result=await invoke({cookie:jar,body:{method:'POST',path:'/calls/dispatch',body:{agent_id:42,to_number:'9876543210'},confirmed:true}});
  assert.equal(result.res.statusCode,422);assert.equal(result.calls.length,1);
  result=await invoke({cookie:jar,body:{method:'GET',path:'/agents',query:{pageno:1,pagesize:20}}});
  assert.equal(result.res.statusCode,200);assert.equal(result.calls[1].url,'https://omnidim.io/api/v1/agents?pageno=1&pagesize=20');
  result=await invoke({cookie:jar,origin:'https://attacker.example',body:{method:'GET',path:'/agents'}});
  assert.equal(result.res.statusCode,403);assert.equal(result.calls.length,0);
  result=await invoke({cookie:jar,accept:false,body:{method:'GET',path:'/agents'}});
  assert.equal(result.res.statusCode,401);assert.equal(result.calls.length,1);
  console.log('OmniDimension checks passed: authenticated account boundary, encrypted cookie, fixed host, validation and charge confirmation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
