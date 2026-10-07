/* ============================================================
 * clavis-worklet.js · one way to load an AudioWorklet
 * ------------------------------------------------------------
 * "Unable to load a worklet's module" is Chrome's text for every
 * failure of audioWorklet.addModule(), and it never says which one:
 * the file 404'd, the server was not listening yet, the MIME type was
 * wrong, or the module threw while evaluating. Six call sites across
 * four files each did a bare addModule() with no retry and no message,
 * so a single bad moment during boot killed voice for the whole
 * session with one unexplained line.
 *
 * The boot race is the one that actually bites here: Electron loads the
 * page from http://localhost:3210, and the voice layer can reach
 * addModule() before that static server has finished listening. The
 * fetch fails once, nothing retries, and voice is dead until restart.
 *
 * So: fetch first (that gives a real status), retry a few times with a
 * short backoff, cache per context so the same module is never added
 * twice, and throw an error that names the URL and the reason.
 * ============================================================ */
(function (global) {
  'use strict';
  if (global.ClavisWorklet) return;

  const loaded = new WeakMap();      // AudioContext -> Set(url)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastError = '';

  async function probe(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const type = (res.headers.get('content-type') || '').toLowerCase();
    // nosniff is on, so a wrong type makes the browser refuse the module.
    if (type && !/javascript|ecmascript|^text\/plain/.test(type)) {
      throw new Error(`wrong Content-Type "${type}" for ${url}`);
    }
  }

  /** addModule with a real error message and a retry for the boot race. */
  async function add(ctx, url, tries) {
    if (!ctx || !ctx.audioWorklet) throw new Error('AudioWorklet is not available in this browser');
    let set = loaded.get(ctx);
    if (!set) { set = new Set(); loaded.set(ctx, set); }
    if (set.has(url)) return true;       // same context, already registered

    const attempts = Math.max(1, tries || 4);
    let last;
    for (let i = 0; i < attempts; i++) {
      try {
        await probe(url);                 // says WHY, where addModule would not
        await ctx.audioWorklet.addModule(url);
        set.add(url);
        lastError = '';
        return true;
      } catch (err) {
        last = err;
        // 240ms, 480ms, 960ms — covers a static server still coming up
        // without making a genuinely missing file take seconds to fail.
        if (i < attempts - 1) await sleep(240 * Math.pow(2, i));
      }
    }
    lastError = (last && last.message) || String(last);
    console.error('[ClavisWorklet] could not load', url, '-', lastError);
    throw new Error('Worklet load failed: ' + lastError);
  }

  global.ClavisWorklet = { add, lastError: () => lastError };
})(typeof window !== 'undefined' ? window : globalThis);
