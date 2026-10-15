/* Voice-first routing: a spoken turn opens the floating window only for
   lead scrapes, maps, photos and deep research; Chrome's live ear leads. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'jarvis_ui.js'), 'utf8');
const grab = (name) => {
  const m = src.match(new RegExp('const ' + name + ' = (/.+/[a-z]*);'));
  assert(m, name + ' missing');
  return eval(m[1]);
};
const DEEP = grab('CLAVIS_DEEP_RE');
const TOOL = grab('CLAVIS_VISUAL_TOOL_RE');
const BRIEF = grab('CLAVIS_BRIEF_RE');
for (const t of ['compare both options','explain in detail','make a table','give me a detailed brief']) assert(BRIEF.test(t), 'useful visual explanation: '+t);
for (const t of ['hello','what time is it','open google website','aaj mausam kaisa hai']) assert(!BRIEF.test(t), 'audio/navigation stays compact: '+t);

for (const t of ['EV battery market pe deep research karo', 'is topic ki detailed research chahiye', 'iska research report banao'])
  assert(DEEP.test(t), 'window expected: ' + t);
for (const t of ['aaj mausam kaisa hai', 'mujhe ek email likh do', 'leads kaise milti hain', 'kya time hua hai', 'plan batao kal ka'])
  assert(!DEEP.test(t), 'voice expected: ' + t);
for (const s of ['generate_leads', 'show_images']) assert(TOOL.test(s), 'visual tool: ' + s);
for (const s of ['search_web', 'get_lead_stats', 'remember_fact', 'list_leads', 'send_email']) assert(!TOOL.test(s), 'voice tool: ' + s);

assert(/function clavisNativeOK\(\)/.test(src) && /Electron\\\//.test(src), 'native-first ear helper');
assert(/if \(clavisUseGroq\(\) && !backgroundOnly\)/.test(src), 'Groq is the fallback, not the default');
assert(/if \(ctx\.voice\) return CLAVIS_DEEP_RE\.test\(t\) \|\| CLAVIS_BRIEF_RE\.test\(t\);/.test(src), 'spoken turns require useful visual intent');
console.log('verify-voice-routing: ok');
