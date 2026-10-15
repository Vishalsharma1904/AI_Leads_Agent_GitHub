import assert from 'node:assert/strict';
import handler from '../pwa/api/proxy.js';
let calls=[];
globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});return {status:200,headers:new Headers({'content-type':'application/json'}),text:async()=>'{"jobs":[]}'};};
function response(){return {headers:{},setHeader(key,value){this.headers[key]=value;},status(code){this.code=code;return this;},json(data){this.data=data;return this;},send(data){this.data=data;return this;}};}
const req={method:'GET',query:{path:'v1/outreach-jobs',limit:'50'},headers:{authorization:'Bearer fixture'}};
delete process.env.RUDRA_BACKEND_URL;
let res=response();await handler(req,res);assert.equal(res.code,503);assert.equal(calls.length,0);
process.env.RUDRA_BACKEND_URL='http://backend.example';res=response();await handler(req,res);assert.equal(res.code,503);
process.env.RUDRA_BACKEND_URL='https://backend.example';res=response();await handler(req,res);
assert.equal(res.code,200);assert.equal(calls[0].url,'https://backend.example/api/v1/outreach-jobs?limit=50');assert.equal(calls[0].options.headers.Authorization,'Bearer fixture');assert.equal(res.headers['Cache-Control'],'no-store');
res=response();await handler({...req,query:{path:'../private'}},res);assert.equal(res.code,400);assert.equal(calls.length,1);
res=response();await handler({...req,method:'POST',body:{confirmed:true},query:{path:'v1/outreach-jobs'},headers:{...req.headers,'idempotency-key':'fixture-key'}},res);
assert.equal(calls[1].options.body,'{"confirmed":true}');assert.equal(calls[1].options.headers['Idempotency-Key'],'fixture-key');
globalThis.fetch=async()=>{throw Error('offline')};res=response();await handler(req,res);assert.equal(res.code,502);
console.log('PASS: proxy HTTPS destination, authenticated forwarding, JSON body, idempotency header, no-store, path validation, unavailable backend');
