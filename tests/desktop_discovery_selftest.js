const assert = require('node:assert/strict');
const {serviceConfigURL, discoverWorkspace} = require('../electron/runtime-config');
(async () => {
  const url = 'https://app.example.org/rudra24-service.json';
  assert.equal(serviceConfigURL(url), url);
  for (const value of ['http://app.example.org/config.json','https://127.0.0.1/config.json','https://app.example.org/config.json?key=secret','https://user:pass@app.example.org/config.json','https://app.example.org/app.js']) assert.throws(() => serviceConfigURL(value));
  const fake = body => async (_url, options) => {
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.ok(!options.headers.Authorization);
    return new Response(body, {headers:{'content-type':'application/json'}});
  };
  assert.equal(await discoverWorkspace(url, fake('{"schema":1,"backendUrl":"https://api.example.org/"}')), 'https://api.example.org');
  for (const value of ['{}','<html>website</html>','{"schema":2,"backendUrl":"https://api.example.org"}','{"schema":1,"backendUrl":"http://localhost:8000"}','x'.repeat(16385)]) await assert.rejects(discoverWorkspace(url, fake(value)));
  await assert.rejects(discoverWorkspace(url, async () => new Response('',{status:404})));
  console.log('PASS desktop discovery: trusted HTTPS file, no credentials, bounded response, bad config rejection');
})().catch(error => {console.error(error);process.exitCode=1;});
