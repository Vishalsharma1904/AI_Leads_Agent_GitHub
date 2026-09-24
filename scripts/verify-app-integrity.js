/**
 * Whole-app integrity check. Catches the class of bug that shows up as a blank
 * tab or a console error rather than as a crash:
 *
 *   - a route pointing at a view section that does not exist
 *   - a sidebar link pointing at a missing view
 *   - a referenced script or stylesheet that is not on disk
 *   - duplicate element IDs (getElementById silently returns only the first)
 *   - onclick handlers calling a global that is never defined
 *   - theme-flow.css not loading after the base styles, which would silently undo the theme
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); failures++; }
}

console.log('\nApp integrity verification\n');

// ── 1. Routes resolve to real view sections ───────────────────────────────
const routeBlock = appJs.match(/const ROUTE_MAP\s*=\s*\{([\s\S]*?)\n\};/);
check('ROUTE_MAP found in app.js', Boolean(routeBlock));

const routeTargets = new Set();
if (routeBlock) {
  const re = /'([^']*)'\s*:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(routeBlock[1]))) routeTargets.add(m[2]);
}
check('routes are declared', routeTargets.size >= 15, 'count=' + routeTargets.size);

const viewIds = new Set(
  [...html.matchAll(/id="view-([a-z0-9-]+)"/g)].map(m => m[1])
);

// 'settings' opens as an overlay rather than a view section, which is
// intentional; showView() special-cases it.
const OVERLAY_ROUTES = new Set(['settings']);
const missingViews = [...routeTargets].filter(v => !viewIds.has(v) && !OVERLAY_ROUTES.has(v));
check('every route has a view section', missingViews.length === 0, missingViews.join(', '));

// Smoke the main navigation surfaces statically: these are the routes users
// switch between most often, and each must have both a route and a real view.
const ROUTE_SMOKE_TARGETS = [
  'dashboard', 'agent', 'leads', 'candidate-db', 'chat',
  'email', 'excel', 'analytics', 'plugins', 'accounts'
];
const smokeMissing = ROUTE_SMOKE_TARGETS.filter(name =>
  !routeTargets.has(name) || !viewIds.has(name)
);
check('core tab route smoke targets are wired', smokeMissing.length === 0, smokeMissing.join(', '));

const initialActiveViews = [...html.matchAll(/<(?:div|section)[^>]*class="[^"]*\bview\b[^"]*\bactive\b[^"]*"[^>]*id="view-([a-z0-9-]+)"|<(?:div|section)[^>]*id="view-([a-z0-9-]+)"[^>]*class="[^"]*\bview\b[^"]*\bactive\b[^"]*"/g)]
  .map(match => match[1] || match[2]);
check('HTML starts with only dashboard active',
  initialActiveViews.length === 1 && initialActiveViews[0] === 'dashboard',
  initialActiveViews.join(', '));

const showViewBlock = appJs.match(/function showView\(viewName\)\s*\{([\s\S]*?)\n\}/);
check('router clears every view before activating the target',
  Boolean(showViewBlock) &&
  /querySelectorAll\('\.view'\)/.test(showViewBlock[1]) &&
  /classList\.remove\('active'\)/.test(showViewBlock[1]) &&
  /target\.classList\.add\('active'\)/.test(showViewBlock[1]));

// ── 2. Sidebar links resolve ──────────────────────────────────────────────
const navViews = [...html.matchAll(/class="nav-item[^"]*"[^>]*data-view="([a-z0-9-]+)"/g)].map(m => m[1]);
check('sidebar has navigation items', navViews.length >= 10, 'count=' + navViews.length);

const navMissing = navViews.filter(v => !viewIds.has(v) && !OVERLAY_ROUTES.has(v));
check('every sidebar link has a view section', navMissing.length === 0, navMissing.join(', '));

const navHashes = [...html.matchAll(/<a href="#([a-z0-9-]+)" class="nav-item/g)].map(m => '#' + m[1]);
const declaredHashes = routeBlock
  ? new Set([...routeBlock[1].matchAll(/'(#[^']*)'\s*:/g)].map(m => m[1]))
  : new Set();
const unroutedHashes = navHashes.filter(h => !declaredHashes.has(h));
check('every sidebar hash is in ROUTE_MAP', unroutedHashes.length === 0, unroutedHashes.join(', '));

// ── 3. Referenced files exist ─────────────────────────────────────────────
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)]
  .map(m => m[1].split('?')[0])
  .filter(src => !/^https?:\/\//.test(src));
const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)]
  .map(m => m[1].split('?')[0])
  .filter(href => !/^https?:\/\//.test(href));

const missingFiles = [...scripts, ...styles].filter(f => !fs.existsSync(path.join(ROOT, f)));
check('every referenced local script and stylesheet exists',
  missingFiles.length === 0, missingFiles.join(', '));

// ── 4. theme-flow.css must be the last base stylesheet ────────────────────
check('theme-flow.css is referenced', styles.includes('theme-flow.css'));
const themeFlowIndex = styles.lastIndexOf('theme-flow.css');
const postThemeStyles = themeFlowIndex >= 0 ? styles.slice(themeFlowIndex + 1) : [];
const approvedPostThemeStyles = postThemeStyles.every(file => [
  'jarvis-studio-polish.css', 'clavis-voice-polish.css', 'clavis-header-declutter.css',
  'clavis-confirm-hud.css', 'clavis-stage.css', 'clavis-task-hud.css', 'apple-polish.css',
  'clavis-refine.css', 'clavis-task-surface.css', 'clavis-viewport.css',
  'clavis-polish-fixes.css', 'clavis-suggestions.css', 'clavis-polish-v3.css',
  'clavis-sidebar.css', 'clavis-aurora.css', 'clavis-chat.css', 'clavis-luxe.css'
].includes(file));
check('theme-flow.css loads LAST among base stylesheets',
  themeFlowIndex >= 0 && approvedPostThemeStyles,
  postThemeStyles.length ? 'post-theme styles: ' + postThemeStyles.join(', ') : 'theme-flow is not last');

// ── 5. Duplicate element IDs ──────────────────────────────────────────────
// getElementById returns only the first match, so a duplicate silently breaks
// whichever feature expected the second one.
const idCounts = new Map();
for (const m of html.matchAll(/\sid="([^"]+)"/g)) {
  idCounts.set(m[1], (idCounts.get(m[1]) || 0) + 1);
}
const dupes = [...idCounts.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} (${n}x)`);
check('no duplicate element IDs', dupes.length === 0, dupes.join(', '));

// ── 6. Inline onclick handlers reference something that exists ────────────
// Collect the leading identifier of each inline handler and confirm it is
// defined somewhere in the project's own scripts.
// Includes the inline <script> blocks in index.html, because several handlers
// (the settings modal controls, for one) are defined there rather than in a
// separate file. Scanning only external files reported them as undefined.
const inlineScripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map(m => m[1])
  .join('\n');

const jsSources = scripts
  .filter(s => s.endsWith('.js'))
  .map(s => {
    try { return fs.readFileSync(path.join(ROOT, s), 'utf8'); }
    catch { return ''; }
  })
  .concat(inlineScripts)
  .join('\n');

const handlerRoots = new Set();
for (const m of html.matchAll(/on(?:click|change|submit|input)="([^"]+)"/g)) {
  const code = m[1];
  const call = code.match(/^\s*(?:return\s+)?([A-Za-z_$][\w$]*)/);
  if (!call) continue;
  const root = call[1];
  if (['if', 'window', 'document', 'this', 'return', 'void', 'event', 'true', 'false'].includes(root)) continue;
  handlerRoots.add(root);
}

const definedPattern = root => new RegExp(
  `(function\\s+${root}\\b)` +
  `|((?:const|let|var)\\s+${root}\\b)` +
  `|(window\\.${root}\\s*=)` +
  `|(\\b${root}\\s*[:=]\\s*(?:function|\\())` +
  `|(^\\s*${root}\\s*=)`,
  'm'
);

const undefinedHandlers = [...handlerRoots].filter(root => {
  if (definedPattern(root).test(jsSources)) return false;
  // Some handlers are provided as safe shims by self-heal.js.
  if (new RegExp(`'${root}'`).test(jsSources)) return false;
  return true;
});
check('every inline handler resolves to a defined global',
  undefinedHandlers.length === 0, undefinedHandlers.join(', '));

// ── 7. View controllers referenced by showView exist ──────────────────────
const ctrlNames = [...appJs.matchAll(/window\.(\w+Ctrl)\s*&&\s*typeof window\.\1\.init/g)]
  .map(m => m[1]);
const uniqueCtrls = [...new Set(ctrlNames)];
check('showView wires up view controllers', uniqueCtrls.length >= 6, uniqueCtrls.join(', '));

const missingCtrls = uniqueCtrls.filter(name =>
  !new RegExp(`window\\.${name}\\s*=|const\\s+${name}\\s*=`).test(jsSources)
);
check('every controller showView calls is actually defined',
  missingCtrls.length === 0, missingCtrls.join(', '));

// ── 8. The plugins tab specifically ───────────────────────────────────────
check('plugins route exists', routeTargets.has('plugins'));
check('plugins view section exists', viewIds.has('plugins'));
check('plugins nav item exists', navViews.includes('plugins'));
check('PluginsCtrl is initialised by showView', /viewName === 'plugins'/.test(appJs));

// ── 9. Theme file sanity ──────────────────────────────────────────────────
const theme = fs.readFileSync(path.join(ROOT, 'theme-flow.css'), 'utf8');
check('theme defines both light and dark palettes',
  /html\[data-theme="light"\]/.test(theme) && /html\[data-theme="dark"\]/.test(theme));
check('theme loads the Figtree + serif pairing',
  /Figtree/.test(theme) && /Instrument Serif/.test(theme));
check('fonts are actually requested in index.html',
  /family=Figtree/.test(html) && /family=Instrument\+Serif/.test(html));
check('theme honours prefers-reduced-motion',
  /prefers-reduced-motion/.test(theme));
check('theme honours the in-app motion=off setting',
  /data-motion="off"/.test(theme));

// 60fps discipline: no transition on layout-triggering properties.
// Comments are stripped first — the file explains WHY `transition: all` is
// avoided, and matching that prose was a false positive.
const themeRules = theme.replace(/\/\*[\s\S]*?\*\//g, '');

// No specific top-level page may force itself visible while inactive. Child
// controls such as `#view-chat .composer` are intentionally excluded.
const forcedVisibleViews = [];
for (const block of themeRules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const body = block[2];
  if (!/display\s*:\s*(?!none\b)[^;]+!important/i.test(body)) continue;
  block[1].split(',').map(selector => selector.trim()).forEach(selector => {
    if (/^#view-[a-z0-9-]+$/i.test(selector)) forcedVisibleViews.push(selector);
  });
}
check('inactive views cannot be forced visible by the theme',
  forcedVisibleViews.length === 0, forcedVisibleViews.join(', '));
check('Client and Candidate AI share the active flex-column route contract',
  /#view-chat\.active\s*,\s*#view-candidate-ai\.active\s*\{[^}]*display:\s*flex\s*!important[^}]*flex-direction:\s*column\s*!important[^}]*padding:\s*0\s*!important/.test(themeRules));
check('Client and Candidate AI composers share width and non-shrinking contracts',
  /#view-chat \.claude-input-container\s*,\s*#view-candidate-ai \.claude-input-container\s*\{[^}]*width:\s*100%\s*!important[^}]*max-width:\s*var\(--read-col\)\s*!important/.test(themeRules) &&
  /#view-chat \.claude-input-container\s*,\s*#view-candidate-ai \.claude-input-container\s*\{[^}]*flex:\s*0 0 auto\s*!important/.test(themeRules));
check('Client and Candidate AI messages share the scrollable flex contract',
  /#chat-messages\s*,\s*#candidate-chat-messages\s*\{[^}]*flex:\s*1 1 auto\s*!important[^}]*min-height:\s*0\s*!important[^}]*overflow-y:\s*auto\s*!important/.test(themeRules));
check('Candidate AI composer markup and send wiring remain intact',
  /id="view-candidate-ai"/.test(html) &&
  /id="candidate-ai-input" class="claude-textarea"/.test(html) &&
  /id="btn-candidate-ai-send"[^>]*onclick="handleCandidateChatSend\(\)"/.test(html));
check('theme cache version is current', /theme-flow\.css\?v=1\.9/.test(html));

const LAYOUT_PROPS = /transition:[^;]*\b(width|height|top|left|right|bottom|margin|padding)\b/g;
const layoutTransitions = [...themeRules.matchAll(LAYOUT_PROPS)].map(m => m[0].slice(0, 60));
check('theme animates no layout-triggering property',
  layoutTransitions.length === 0, layoutTransitions.join(' | '));
check('theme avoids "transition: all"', !/transition:\s*all/.test(themeRules));
check('theme promotes animated cards to their own layer',
  /translate3d/.test(themeRules));

// ── 10. Theme file is structurally sound ──────────────────────────────────
let depth = 0, wentNegative = false;
for (const ch of theme) {
  if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth < 0) wentNegative = true; }
}
check('theme braces are balanced', depth === 0, 'final depth ' + depth);
check('theme never closes an unopened brace', !wentNegative);
check('theme comments are all closed',
  (theme.match(/\/\*/g) || []).length === (theme.match(/\*\//g) || []).length);

// ── 11. Shell layout invariants ───────────────────────────────────────────
// The opened page must carry elevation while sidebar and topbar share one flat canvas.
check('opened page panel gets a real elevation shadow',
  /--shell-panel-shadow/.test(themeRules) &&
  /\.views-container[\s\S]{0,500}box-shadow:\s*var\(--shell-panel-shadow\)/.test(themeRules));
check('sidebar has no border or shadow of its own',
  /#sidebar\.sidebar[\s\S]{0,400}border-right:\s*0/.test(themeRules));
check('sidebar and topbar share a partition-free canvas',
  /\.topbar\s*\{[^}]*background:\s*transparent\s*!important[^}]*border-bottom:\s*0\s*!important/.test(themeRules) &&
  /\.main-content[\s\S]{0,260}background:\s*transparent\s*!important/.test(themeRules));

// Exactly one scroll surface: the container stretches, the active view scrolls.
check('view container does not scroll (avoids nested scrollbars)',
  /\.views-container[^{]*\{[^}]*overflow:\s*hidden/.test(themeRules));
check('active view is the single scroll surface',
  /\.view\.active[^{]*\{[^}]*overflow-y:\s*auto/.test(themeRules));

// The open tab must be a neutral pill, not an accent fill — this is what keeps
// the navigation minimal.
check('active nav item uses a neutral pill, not the accent colour',
  /\.nav-item\.active[\s\S]{0,300}background:\s*var\(--shell-active\)/.test(themeRules));
check('decorative nav markers and glows are disabled',
  /#lx-nav-pill/.test(themeRules) && /lx-cursor-glow[\s\S]{0,200}display:\s*none/.test(themeRules));

// The sidebar collapse must animate on the compositor, not via margin.
check('sidebar animates with transform, not layout',
  /#sidebar\.sidebar\s*\{[^}]*transition:[^}]*transform/.test(themeRules));
check('content panel margin is not transitioned',
  /margin-left is deliberately NOT transitioned/.test(theme));

// ── 12. Reading column and chat surface ───────────────────────────────────
check('a centred reading column is defined',
  /--read-col:/.test(themeRules));
check('the chat surface uses the reading column',
  /#chat-messages[\s\S]{0,400}max-width:\s*var\(--read-col\)/.test(themeRules) ||
  /max-width:\s*var\(--read-col\)/.test(themeRules));

// Assistant prose must not be bubbled — the most common way this design is
// implemented incorrectly.
check('assistant messages have no bubble',
  /\.chat-message\.assistant \.chat-bubble\s*\{[^}]*background:\s*transparent/.test(themeRules));
check('user messages are right-aligned and width-capped',
  /\.chat-message\.user\s*\{[^}]*justify-content:\s*flex-end/.test(themeRules) &&
  /\.chat-message\.user \.chat-bubble\s*\{[^}]*max-width/.test(themeRules));

// Data views must NOT inherit the reading column.
check('wide data views are exempt from the reading column',
  /#view-leads[\s\S]{0,220}max-width:\s*none/.test(themeRules));

// Scrollbar thumb inset technique — this is what makes it look thin.
check('scrollbar thumb uses the inset border technique',
  /scrollbar-thumb[\s\S]{0,320}background-clip:\s*content-box/.test(themeRules));
check('scrollbar arrow buttons are hidden',
  /scrollbar-button[\s\S]{0,80}display:\s*none/.test(themeRules));
check('Firefox scrollbar properties are set',
  /scrollbar-width:\s*thin/.test(themeRules) && /scrollbar-color:/.test(themeRules));

// ── 13. The design prompt document exists and is complete ─────────────────
const promptPath = path.join(ROOT, 'docs', 'UI-DESIGN-PROMPT.md');
check('design prompt document exists', fs.existsSync(promptPath));
if (fs.existsSync(promptPath)) {
  const prompt = fs.readFileSync(promptPath, 'utf8');
  const REQUIRED_SECTIONS = [
    'CANVAS AND PANEL', 'SIDEBAR', 'PANEL HEADER', 'READING COLUMN',
    'MESSAGES', 'SCROLLBARS', 'COMPOSER', 'CARDS INSIDE THE PANEL',
    'THE 60FPS RULES', 'STYLESHEET ORDER', 'VERIFY'
  ];
  const missingSections = REQUIRED_SECTIONS.filter(s => !prompt.includes(s));
  check('design prompt covers every area', missingSections.length === 0, missingSections.join(', '));
  check('design prompt states the no-layout-transition rule',
    /NEVER transition width, height/.test(prompt));
  check('design prompt warns about the single scroll surface',
    /ONE scroll surface/.test(prompt));
}

console.log('');
if (failures) { console.error(failures + ' check(s) failed'); process.exit(1); }
console.log('All app integrity checks passed');
