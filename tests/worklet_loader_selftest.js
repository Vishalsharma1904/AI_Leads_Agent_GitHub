/* The boot race this loader exists for. Run: node tests/worklet_loader_selftest.js */
const assert = require('assert');
global.window = global;
require('../clavis-worklet.js');

function ctx(addModule) { return { audioWorklet: { addModule } }; }
const URL1 = 'clavis-pcm-player-worklet.js?v=3';

(async () => {
  // 1. The static server is not listening yet, then comes up: must recover.
  let fetches = 0;
  global.fetch = async () => {
    fetches++;
    if (fetches < 3) throw new Error('Failed to fetch');
    return { ok: true, headers: { get: () => 'application/javascript' } };
  };
  let added = 0;
  const c1 = ctx(async () => { added++; });
  assert.strictEqual(await window.ClavisWorklet.add(c1, URL1), true, 'should recover after the server starts');
  assert.strictEqual(added, 1);

  // 2. Same context, same module twice -> added once.
  await window.ClavisWorklet.add(c1, URL1);
  assert.strictEqual(added, 1, 'module re-added to the same context');

  // 3. A genuinely missing file fails with the status in the message.
  global.fetch = async () => ({ ok: false, status: 404, headers: { get: () => null } });
  const c2 = ctx(async () => { throw new Error('should not be reached'); });
  await assert.rejects(() => window.ClavisWorklet.add(c2, 'missing.js', 1), /404/, 'must name the HTTP status');

  // 4. Wrong MIME (nosniff makes the browser refuse it) is named too.
  global.fetch = async () => ({ ok: true, headers: { get: () => 'text/html' } });
  await assert.rejects(() => window.ClavisWorklet.add(ctx(async () => {}), URL1, 1), /Content-Type/);

  console.log('PASS — 4 checks');
})();
