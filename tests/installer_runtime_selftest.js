'use strict';
// Exercise shipped startup dependencies outside the source checkout so its
// node_modules cannot hide a missing production dependency in the installer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const archive = path.resolve(process.argv[2] || path.join(root,'release/win-unpacked/resources/app.asar'));
const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'rudra-installer-check-'));
try {
  asar.extractAll(archive, extracted);
  for (const file of ['index.html','clavis-voice-refine.css','clavis-voice.js','clavis-elevenlabs-settings.js','jarvis.js','jarvis_ui.js','desktop-setup.html','desktop-setup.js','desktop-setup.css','electron/main.js','electron/preload.js','electron/runtime-config.js']) {
    assert.ok(fs.readFileSync(path.join(root,file)).equals(fs.readFileSync(path.join(extracted,file))), 'Archive/source mismatch: '+file);
  }
  const check = `
    const assert=require('node:assert/strict');
    const ui=require('./serve-clavis');
    const bridge=require('./clavis-bridge/bridge');
    assert.equal(typeof bridge.server.listen,'function');
    (async()=>{
      await new Promise((resolve,reject)=>{ui.server.once('error',reject);ui.server.listen(0,'127.0.0.1',resolve)});
      try {
        const base='http://127.0.0.1:'+ui.server.address().port;
        for(const route of ['/index.html','/desktop-setup.html','/desktop-setup.js','/clavis-elevenlabs-settings.js','/api/public-config']) {
          const response=await fetch(base+route,{signal:AbortSignal.timeout(5000)});
          assert.equal(response.status,200,route);
          assert.ok((await response.text()).length>0,route);
        }
      } finally {await new Promise(resolve=>ui.server.close(resolve));}
    })().catch(error=>{console.error(error);process.exitCode=1});
  `;
  execFileSync(process.execPath,['-e',check],{
    cwd:extracted, encoding:'utf8', timeout:30000, windowsHide:true,
    env:{...process.env,NODE_PATH:'',NODE_OPTIONS:'',CLAVIS_MANAGED_ACCESS:'true',CLAVIS_DESKTOP_BACKEND_URL:''}
  });
  console.log('PASS actual installer: exact final source, isolated shipped dependency startup, desktop/app assets and public configuration HTTP checks');
} finally {
  // Only this test's newly created temporary directory can be removed.
  assert.equal(path.dirname(extracted),path.resolve(os.tmpdir()));
  assert.ok(path.basename(extracted).startsWith('rudra-installer-check-'));
  fs.rmSync(extracted,{recursive:true,force:true});
}
