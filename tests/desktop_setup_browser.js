'use strict';
// The real setup page, with only the narrow Electron bridge simulated.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/Khushi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const output = path.join(root, 'tests/artifacts/desktop-setup');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const width of [1366, 640, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://rudra.fixture') return route.abort();
        const file = path.resolve(root, '.' + url.pathname);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.abort();
        return route.fulfill({ path: file });
      });
      await page.addInitScript(() => {
        window.calls = { automatic: 0, opened: 0, manual: [] };
        window.RudraDesktop = {
          configuration: async () => ({ backendUrl: new URL(location.href).searchParams.has('saved') ? 'https://api.example.org' : '' }),
          autoConnect: async () => { if (++calls.automatic === 1) throw Error('Failed to fetch'); return {ok:true}; },
          openWorkspace: async () => { calls.opened++; },
          connect: async url => { calls.manual.push(url); return calls.manual.length === 1 ? {ok:false,error:'This server is not ready yet.'} : {ok:true}; }
        };
      });
      await page.goto('http://rudra.fixture/desktop-setup.html');
      await page.getByRole('status').filter({hasText:'temporarily unavailable'}).waitFor();
      assert.equal(await page.locator('#connection-advanced').getAttribute('open'), null);
      assert.equal(await page.locator('#backend-url').isVisible(), false);
      assert.equal(await page.locator('#retry').isEnabled(), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
      await page.screenshot({path:path.join(output, `${width}-retry.png`), fullPage:true});
      await page.getByRole('button', {name:'Try again'}).click();
      await page.waitForFunction(() => calls.opened === 1);
      assert.equal(await page.evaluate(() => calls.automatic), 2);
      await page.locator('summary').click();
      await page.getByLabel('Workspace server').fill('https://api.example.org');
      await page.getByRole('button', {name:'Save connection'}).click();
      await page.getByRole('status').filter({hasText:'not ready yet'}).waitFor();
      assert.equal(await page.locator('#backend-url').isEditable(), true, 'Failed check leaves settings editable');
      await page.getByRole('button', {name:'Save connection'}).click();
      await page.waitForFunction(() => calls.opened === 2);
      await page.goto('http://rudra.fixture/desktop-setup.html?saved=1');
      await page.getByRole('button', {name:'Open workspace'}).click();
      assert.deepEqual(await page.evaluate(() => ({automatic:calls.automatic,opened:calls.opened})), {automatic:0,opened:1});
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS real desktop setup: automatic retry, friendly error, closed advanced settings, manual recovery, saved/offline opening, 3 viewport widths');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
