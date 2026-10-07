/* The live caption — what sir sees while he is talking.
 *
 * Two things had gone wrong and both were invisible to every other check:
 *
 *   1. clavis-ear.js's render() had been reduced to `line.textContent = text`.
 *      clavis-enterprise.css still carried the whole design — .ce-w glide,
 *      .ce-gliding motion blur, .ce-c typewriter — styling elements that
 *      nothing created any more. The caption worked; it just had no animation
 *      at all, which is what "bekar animation hai" was.
 *
 *   2. The line wrapped. In a flex-end column, the overflow of a wrapped line
 *      goes out through the TOP, where overflow:hidden eats it — so on a long
 *      command the opening words were clipped away: "first word nahi dikhata".
 *
 * These are contract checks between the script and the two stylesheets. The
 * behaviour itself is checked in a real browser by _claude_tmp/caption-check.html.
 */
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let failures = 0;
const check = (l, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}`); if (!ok) failures++; };

const js = read('clavis-ear.js');
const css = read('clavis-ear.css');
const ent = read('clavis-enterprise.css');

// ── the renderer actually builds what the stylesheets style ──────────────
check('the caption builds word elements, not a text node',
  /className = 'ce-w'/.test(js) && !/cap\.line\.textContent = tidy\(text\)/.test(js));
check('…and character elements for the typewriter',
  /className = 'ce-c'/.test(js) && /animationDelay/.test(js));
check('the live word is marked so it can carry the ink',
  /classList\.toggle\('ce-now'/.test(js));
check('the motion blur is switched on only while something moves',
  /classList\.add\('ce-gliding'\)/.test(js) && /classList\.remove\('ce-gliding'\)/.test(js));
check('the glide is a FLIP measured from the screen, not from layout offsets',
  /getBoundingClientRect\(\)\.left/.test(js) && /\.animate\(/.test(js));
check('the arriving word rides the same belt as the words it displaces',
  /if \(!first\.has\(el\)\) move\.push/.test(js));
check('only the FLIP transforms are cancelled, never the CSS transitions',
  /a instanceof CSSTransition/.test(js));
check('the line is capped so layout cost cannot grow with the sentence',
  /CE_MAXW/.test(js) && /while \(els\.length > CE_MAXW\)/.test(js));
check('Devanagari is not split into inline-blocks per code point',
  /CE_DEVA\.test\(word\) \? \[word\] : Array\.from\(word\)/.test(js));
check('a repeated partial is a no-op, so nothing re-animates',
  /if \(t === cap\.text\)/.test(js));

// ── the first word has to be allowed through ─────────────────────────────
check('a one-word partial is no longer judged as an echo',
  /e\.n >= 2 && e\.score >= 0\.55/.test(js) && !/e\.n >= 2 \? e\.score >= 0\.55 : e\.score >= 1/.test(js));
check('the caption is positioned before it enters the document',
  /measurePlace\(\);[\s\S]{0,140}document\.body\.appendChild\(el\)/.test(js));

// ── the stylesheet side of the contract ──────────────────────────────────
check('the line never wraps',
  /#clavis-ear-caption \.ce-line \{[^}]*white-space: nowrap;[^}]*\}/.test(css));
check('…and nothing writes text-wrap-mode back after it',
  !/white-space: nowrap;[^}]*text-wrap:/.test(css));
check('words leaving to the left dissolve instead of being cut',
  /mask-image: linear-gradient\(to right, transparent/.test(css));
check('the clip shrinks to the gutter rather than to the sentence',
  /#clavis-ear-caption \.ce-clip \{[^}]*min-width: 0;/.test(css));
check('the caption has a definite width, so the fade ramps over empty gutter',
  /#clavis-ear-caption \{[\s\S]*?\n  width: min\(400px/.test(css));
check('the live word has room for the character overshoot',
  /padding-right: 0\.34em/.test(css));
check('word spacing is a margin, so trimming the left end cannot leave one behind',
  /\.ce-w \{[^}]*margin-left: 0\.28em/.test(css) && /\.ce-w:first-child \{ margin-left: 0; \}/.test(css));
check('the box arrives quickly even though the words are slow',
  /opacity   200ms var\(--cx-ease\)/.test(ent));
check('the glide duration in the script matches --ce-shift',
  /const CE_SHIFT = 900;/.test(js) && /--ce-shift: 900ms/.test(ent));
check('reduced motion still gets the words, without the movement',
  /prefers-reduced-motion/.test(css) && /function ceStill/.test(js) && /if \(still\) return;/.test(js));

console.log(failures ? `\n  ${failures} caption check(s) failed` : '\n  caption: all checks passed');
process.exit(failures ? 1 : 0);
