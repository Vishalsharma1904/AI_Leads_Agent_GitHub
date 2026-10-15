'use strict';
// Actual app HTML/styles; no authentication, microphone or paid provider calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/Khushi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'tests/artifacts/voice-preview');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace('<head>', '<head><base href="http://rudra.fixture/">');
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const [width, height] of [[1366, 768], [1024, 600], [768, 500], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'rudra.fixture') return route.abort();
        if (!/\.(css|woff2?|ttf|svg|png|webp|jpe?g|ico)$/i.test(url.pathname)) return route.abort();
        const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
        return route.fulfill({ path: file });
      });
      await page.setContent(html, { waitUntil: 'networkidle' });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.classList.add('clavis-stage-v2');
          document.getElementById('auth-screen')?.remove();
          const shell = document.getElementById('app-shell'); if (shell) shell.style.display = 'flex';
          for (const view of document.querySelectorAll('.view')) view.classList.remove('active');
          const view = document.getElementById('view-jarvis'); view.classList.add('active', 'has-messages');
          const caption = document.getElementById('clavis-ai-speech-caption');
          caption.textContent = 'नमस्ते। आपकी सेव की हुई leads तैयार हैं। अब आप उनका विवरण देख सकते हैं और अगला कदम तय कर सकते हैं। '.repeat(8);
          caption.classList.add('is-visible');
        }, theme);
        await page.waitForTimeout(750);
        const bounds = await page.evaluate(() => {
          const caption = document.getElementById('clavis-ai-speech-caption');
          const r = caption.getBoundingClientRect(), style = getComputedStyle(caption);
          const clips = [];
          for (let parent = caption.parentElement; parent; parent = parent.parentElement) {
            const s = getComputedStyle(parent), p = parent.getBoundingClientRect();
            if (/(hidden|clip|auto|scroll)/.test(s.overflowY) && (r.top < p.top - 2 || r.bottom > p.bottom + 2)) clips.push(parent.id || parent.className);
          }
          return { width: r.width, height: r.height, top: r.top, bottom: r.bottom, pointer: style.pointerEvents,
            overflow: style.overflowY, scroll: caption.scrollHeight, client: caption.clientHeight,
            viewportHeight: innerHeight, clips };
        });
        await page.screenshot({ path: path.join(output, `${width}-${theme}.png`) });
        assert.ok(bounds.width > 150 && bounds.height >= 40, JSON.stringify(bounds));
        assert.equal(bounds.pointer, 'auto', 'The spoken preview must be scrollable with mouse/touch');
        assert.deepEqual(bounds.clips, [], 'A compact orb rail must not clip the speech preview: ' + JSON.stringify(bounds));
        assert.ok(bounds.top >= 0 && bounds.bottom <= height, JSON.stringify(bounds));
        assert.ok(['auto', 'scroll'].includes(bounds.overflow));
        await page.locator('#clavis-ai-speech-caption').focus();
        await page.keyboard.press('End');
        await page.waitForFunction(() => {
          const el = document.getElementById('clavis-ai-speech-caption');
          return el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
        });
        assert.ok(await page.locator('#clavis-ai-speech-caption').evaluate(el => el.scrollTop > 0), `Keyboard can reach the final lines at ${width}px/${theme}`);
      }
      await page.close();
    }
    console.log('PASS actual voice preview: full app styles, 4 viewports, both themes, no clipped ancestor, mouse/touch and keyboard reading');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
