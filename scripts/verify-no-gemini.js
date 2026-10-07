/* AI Studio must stay off.
 *
 * Billing became mandatory, so every Gemini call failed: the Live socket
 * 403'd, Gemini TTS errored per sentence, and the mic tap nagged for a key
 * that was deliberately not wanted. It is switched off at ONE place —
 * providerConfigured() in clavis-direct.js — and these checks exist because
 * each of the leaks below looked fine on screen while still firing requests.
 */
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; };

const direct = read('clavis-direct.js');
const live = read('clavis-live.js');
const vault = read('clavis-keyvault.js');

check('providerConfigured refuses gemini unless explicitly re-enabled',
  /provider === 'gemini' && !geminiAllowed\(\)/.test(direct) && /function geminiAllowed/.test(direct));
check('gemini is out of the brain preference list',
  /const PREFERENCE = \[[^\]]*\]/.test(direct) && !/const PREFERENCE = \[[^\]]*'gemini'/.test(direct));
check('groq leads the brain preference list',
  /const PREFERENCE = \['groq'/.test(direct));
check("gemini is out of the vault's fallback chain",
  /var CHAIN = \[[^\]]*\]/.test(vault) && !/var CHAIN = \[[^\]]*'gemini'/.test(vault));
check('groq leads the vault chain',
  /var CHAIN = \['groq'/.test(vault));

// the Live socket is the thing that actually 403'd
check('Live reports no gemini keys while AI Studio is off',
  /function geminiOn\(\)/.test(live) && /if \(!geminiOn\(\)\) return \[\];/.test(live));
check('the mic tap no longer asks for an AI Studio key',
  /function promptKey\(\)[\s\S]{0,400}?if \(!geminiOn\(\)\) return false;/.test(live));

// a stale hint that sent people to a key which could never work
check('the vision error names a provider that actually has a vision model',
  /OpenRouter key/.test(direct) && !/Add a Groq or AI Studio key/.test(direct));

// DNS warmups for a host we never call again
['clavis-ahead.js', 'jarvis_ui.js'].forEach((f) => {
  const src = read(f);
  check(`${f} no longer preconnects to AI Studio`,
    !/preconnect[\s\S]{0,200}generativelanguage/.test(src) &&
    !/\['https:\/\/generativelanguage/.test(src));
});

if (failures) {
  console.error(`\n${failures} AI-Studio-off check(s) failed.`);
  process.exit(1);
}
console.log('\nAI Studio is off everywhere it used to fire.');
