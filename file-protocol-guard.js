/**
 * Clavis file:// launcher  (v2 — 2026-09-24)
 *
 * index.html ko seedha double-click karne par origin "file://" hota hai.
 * Chrome us origin ko microphone nahi deta, audio worklets load nahi hote,
 * backend CORS "null" origin mana karta hai aur Google sign-in bhi nahi
 * chalta. Isliye file:// par asli app boot nahi hota — yeh launcher use
 * http://localhost:3000 par le jata hai:
 *
 *   1) servers pehle se chal rahe hain  -> seedha khol do (~1 sec)
 *   2) servers band hain                -> clavis:// launcher khud fire hota
 *      hai (Start-Clavis.bat har run par register karta hai), Chrome ka
 *      "Open" dabate hi teeno servers chupchap start hote hain, yeh page
 *      progress dikhata hai aur ready hote hi app khol deta hai.
 *
 * Migration: file:// wali localStorage settings aur vault keys ek chhote
 * localhost page (clavis-migrate.html) ko postMessage se di jaati hain. Wo
 * sirf wahi cheezein likhta hai jo localhost par pehle se nahi hain.
 */
(function () {
  'use strict';
  if (window.location.protocol !== 'file:') return;

  var UI = 'http://localhost:3000';
  var ENGINE = 'http://localhost:8000';
  var hash = window.location.hash || '#jarvis';

  var POLL_MS = 700;          // readiness check interval
  var HINT_AFTER = 12000;     // "kuch nahi hua?" help
  var RETRY_AFTER = 6000;     // manual Start button (user gesture fallback)
  var FAIL_AFTER = 90000;     // launcher ne jawab nahi diya
  var ENGINE_GRACE = 1200;    // UI ready = app kholo; engine background me aata rehta hai (app khud sambhalta hai)

  // ── theme: app ki saved theme > system preference ──────────────────────
  var theme = 'light';
  try {
    var saved = localStorage.getItem('skylark-theme');
    if (saved === 'dark' || saved === 'light') theme = saved;
    else if (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) theme = 'dark';
  } catch (_) {}

  // Start-Clavis.bat ka poora path (help panel ke liye)
  var batPath = '';
  try {
    batPath = decodeURIComponent(location.pathname).replace(/^\/([A-Za-z]:)/, '$1')
      .replace(/\//g, '\\').replace(/[^\\]*$/, '') + 'Start-Clavis.bat';
  } catch (_) { batPath = 'Start-Clavis.bat'; }

  var CSS = [
    ':root{--ease:cubic-bezier(.16,1,.3,1);--ease-io:cubic-bezier(.65,0,.35,1)}',
    'html[data-t=light]{--bg:#F5F4EE;--ink:#1F1E1B;--mute:#6E6A62;--faint:#A7A399;--line:rgba(31,30,27,.08);--line2:rgba(31,30,27,.16);--chip:rgba(31,30,27,.045);--accent:#6B7A45;--btn:#1F1E1B;--btnInk:#F5F4EE;--warn:#B4862B;--glow:rgba(107,122,69,.16)}',
    'html[data-t=dark]{--bg:#1C1B19;--ink:#EDEBE5;--mute:#9D998F;--faint:#6B685F;--line:rgba(255,255,255,.07);--line2:rgba(255,255,255,.16);--chip:rgba(255,255,255,.05);--accent:#A9B87E;--btn:#EDEBE5;--btnInk:#1C1B19;--warn:#D9AE52;--glow:rgba(169,184,126,.10)}',
    '*{box-sizing:border-box}html,body{margin:0;height:100%}',
    'body{background:var(--bg);color:var(--ink);font:400 14px/1.5 "Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,"Inter",sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;transition:opacity .45s var(--ease),filter .45s var(--ease)}',
    'body.leaving{opacity:0;filter:blur(6px)}',
    'body::before{content:"";position:fixed;left:50%;top:42%;width:620px;height:620px;margin:-310px 0 0 -310px;border-radius:50%;background:radial-gradient(closest-side,var(--glow),transparent);pointer-events:none;animation:glow 7s ease-in-out infinite}',
    '@keyframes glow{50%{transform:scale(1.08);opacity:.7}}',
    '.stage{position:relative;width:min(340px,calc(100vw - 32px));display:flex;flex-direction:column;align-items:center;text-align:center}',
    '.in{opacity:0;transform:translateY(8px);filter:blur(4px);animation:in 1.1s var(--ease) forwards;animation-delay:calc(var(--i,0)*90ms + 60ms)}',
    '@keyframes in{to{opacity:1;transform:none;filter:none}}',

    /* orb */
    '.mark{position:relative;width:56px;height:56px}',
    '.core{position:absolute;inset:11px;border-radius:50%;background:radial-gradient(circle at 34% 28%,#EEF2DC 0%,#B3BE8E 30%,#6E7C47 68%,#414B2A 100%);box-shadow:0 10px 24px -10px rgba(65,75,42,.7),inset 0 -3px 7px rgba(0,0,0,.2);animation:breathe 3.4s ease-in-out infinite;transition:filter .8s var(--ease),transform .8s var(--ease)}',
    '@keyframes breathe{50%{transform:scale(1.07)}}',
    '.ring{position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 55%,var(--accent) 100%);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 1.6px),#000 calc(100% - 1.2px));mask:radial-gradient(farthest-side,transparent calc(100% - 1.6px),#000 calc(100% - 1.2px));animation:spin 1.6s linear infinite;transition:opacity .6s var(--ease)}',
    '.track{position:absolute;inset:0;border-radius:50%;border:1.2px solid var(--line)}',
    '@keyframes spin{to{transform:rotate(360deg)}}',
    '.ok .ring{background:var(--accent);animation-duration:6s}',
    '.bad .ring{opacity:0}.bad .core{filter:saturate(.25) brightness(.95);animation:none}',

    /* type */
    'h1{margin:22px 0 0;font:400 34px/1 "Instrument Serif","Iowan Old Style","Palatino Linotype",Georgia,serif;letter-spacing:-.01em}',
    '.status{position:relative;height:22px;width:100%;margin-top:12px;color:var(--mute);font-size:14px}',
    '.status span{position:absolute;inset:0;transition:opacity .5s var(--ease),transform .5s var(--ease),filter .5s var(--ease)}',
    '.status span.out{opacity:0;transform:translateY(-6px);filter:blur(3px)}',
    '.status span.pre{opacity:0;transform:translateY(6px);filter:blur(3px)}',

    /* bar */
    '.bar{position:relative;width:100%;height:2px;margin-top:26px;border-radius:2px;background:var(--line);overflow:hidden}',
    '.bar i{position:absolute;inset:0;background:var(--ink);transform-origin:0 50%;transform:scaleX(0);border-radius:2px}',
    '.bar b{position:absolute;top:0;bottom:0;width:30%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);animation:sheen 1.8s var(--ease-io) infinite;mix-blend-mode:overlay}',
    '@keyframes sheen{from{transform:translateX(-120%)}to{transform:translateX(420%)}}',
    '.bad .bar i{background:var(--warn)}',

    /* steps */
    '.steps{list-style:none;margin:22px 0 0;padding:0;width:100%}',
    '.steps li{display:flex;align-items:center;gap:12px;height:34px;color:var(--faint);font-size:13.5px;transition:color .6s var(--ease)}',
    '.steps li.active{color:var(--mute)}.steps li.done{color:var(--ink)}',
    '.dot{position:relative;flex:none;width:16px;height:16px;border-radius:50%;border:1.3px solid var(--line2);transition:background .5s var(--ease),border-color .5s var(--ease),transform .5s var(--ease)}',
    '.active .dot{border-color:transparent;border-top-color:var(--ink);border-right-color:var(--ink);animation:spin .9s linear infinite}',
    '.done .dot{background:var(--ink);border-color:var(--ink);transform:scale(1);animation:pop .5s var(--ease)}',
    '@keyframes pop{0%{transform:scale(.6)}100%{transform:scale(1)}}',
    '.dot svg{position:absolute;inset:0;margin:auto;width:10px;height:10px;opacity:0}',
    '.dot svg path{fill:none;stroke:var(--bg);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:14;stroke-dashoffset:14;transition:stroke-dashoffset .5s .1s var(--ease)}',
    '.done .dot svg{opacity:1}.done .dot svg path{stroke-dashoffset:0}',
    '.warn .dot{border-color:var(--warn);border-style:dashed;animation:none}.warn{color:var(--mute)}',
    '.meta{margin-left:auto;font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums}',

    /* actions + help */
    '.fold{display:grid;grid-template-rows:0fr;width:100%;transition:grid-template-rows .7s var(--ease),opacity .6s var(--ease),margin .7s var(--ease);opacity:0;margin-top:0}',
    '.fold>div{overflow:hidden;min-height:0}',
    '.fold.open{grid-template-rows:1fr;opacity:1;margin-top:18px}',
    '.row{display:flex;gap:8px;justify-content:center;padding:2px}',
    'button{font-family:inherit;font-weight:500;font-size:13.5px;line-height:1;border-radius:999px;padding:11px 18px;cursor:pointer;border:1px solid transparent;transition:transform .35s var(--ease),background .3s,opacity .3s,border-color .3s}',
    'button:active{transform:scale(.97)}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.pri{background:var(--btn);color:var(--btnInk)}.pri:hover{opacity:.9}',
    '.ghost{background:transparent;color:var(--mute);border-color:var(--line2)}.ghost:hover{color:var(--ink);border-color:var(--faint)}',
    '.help{margin-top:4px;padding:14px 14px 12px;border-radius:14px;background:var(--chip);text-align:left;font-size:13px;color:var(--mute)}',
    '.help p{margin:0 0 10px}.help b{color:var(--ink);font-weight:600}',
    '.path{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 10px;border-radius:10px;background:var(--bg);border:1px solid var(--line)}',
    '.path code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px/1.4 "Cascadia Mono",Consolas,ui-monospace,monospace;color:var(--ink)}',
    '.path button{padding:6px 10px;font-size:12px}',

    '.help-open .foot{opacity:0}.foot{position:fixed;left:0;right:0;bottom:22px;text-align:center;font-size:12px;color:var(--faint);transition:opacity .6s var(--ease)}',
    '.foot kbd{font:11px/1 inherit;padding:2px 6px;border-radius:5px;border:1px solid var(--line2)}',
    '@media (prefers-reduced-motion:reduce){*,*::before{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}'
  ].join('');

  var CHECK = '<svg viewBox="0 0 10 10"><path d="M2 5.3l2 2 4-4.6"/></svg>';
  function step(id, label, i) {
    return '<li class="in" style="--i:' + i + '" id="s-' + id + '"><span class="dot">' + CHECK +
      '</span><span>' + label + '</span><span class="meta" id="m-' + id + '"></span></li>';
  }

  var HTML =
    '<!doctype html><html lang="hi" data-t="' + theme + '"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light dark">' +
    '<title>Clavis</title>' +
        '<style>' + CSS + '</style></head><body>' +
    '<main class="stage" id="stage" role="status">' +
      '<div class="mark in" style="--i:0"><div class="track"></div><div class="ring"></div><div class="core"></div></div>' +
      '<h1 class="in" style="--i:1">Clavis</h1>' +
      '<div class="status in" style="--i:2" aria-live="polite"><span id="st">Jaag raha hoon…</span></div>' +
      '<div class="bar in" style="--i:3"><i id="bar"></i><b></b></div>' +
      '<ol class="steps">' +
        step('launch', 'Launcher', 4) +
        step('ui', 'Interface', 5) +
        step('engine', 'AI engine', 6) +
      '</ol>' +
      '<div class="fold" id="act"><div><div class="row">' +
        '<button class="pri" id="start" type="button">Start Clavis</button>' +
        '<button class="ghost" id="why" type="button">Kuch nahi hua?</button>' +
      '</div></div></div>' +
      '<div class="fold" id="help"><div><div class="help">' +
        '<p><b>Pehli baar ka setup.</b> Project folder me <b>Start-Clavis.bat</b> ek baar double-click karein — ' +
        'wo launcher register kar deta hai. Uske baad sirf index.html kholna kaafi hai.</p>' +
        '<div class="path"><code id="bat"></code><button class="ghost" id="copy" type="button">Copy</button></div>' +
        '<p style="margin:10px 0 0">Servers chalu hote hi yeh page khud aage badh jayega.</p>' +
      '</div></div></div>' +
    '</main>' +
    '<div class="foot" id="foot"></div>' +
    '</body></html>';

  // Parser ke beech me chal rahe hain: write inline hota hai, phir stop()
  // index.html ka baaki bhaari hissa (CSS, 80+ scripts) load hi nahi hone deta.
  document.open();
  document.write(HTML);
  document.close();
  try { window.stop(); } catch (_) {}
  // stop() pending loads cancel karta hai — font isliye baad me jodte hain.
  try {
    var f = document.createElement('link');
    f.rel = 'stylesheet';
    f.href = 'https://fonts.googleapis.com/css2?family=Instrument+Serif&display=optional';
    document.head.appendChild(f);
  } catch (_) {}

  var $ = function (id) { return document.getElementById(id); };
  $('bat').textContent = batPath.length > 46 ? '…' + batPath.slice(-45) : batPath;
  $('bat').title = batPath;

  // ── status text crossfade ───────────────────────────────────────────────
  var curText = 'Jaag raha hoon…';
  function say(text) {
    if (text === curText) return;
    curText = text;
    var box = $('st').parentNode, old = $('st');
    var nu = document.createElement('span');
    nu.className = 'pre'; nu.textContent = text;
    box.appendChild(nu);
    old.id = ''; old.className = 'out';
    nu.id = 'st';
    requestAnimationFrame(function () { requestAnimationFrame(function () { nu.className = ''; }); });
    setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 600);
  }
  function foot(html) { $('foot').innerHTML = html || ''; }

  function mark(id, state, meta) {
    var li = $('s-' + id);
    if (!li) return;
    li.classList.remove('active', 'done', 'warn');
    if (state) li.classList.add(state);
    if (meta != null) $('m-' + id).textContent = meta;
  }
  function secs(ms) { return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's'; }

  // ── progress: milestones + slow creep (kabhi atka hua na lage) ───────────
  var shown = 0, goal = 0.06, cap = 0.12;
  function aim(g, c) { goal = Math.max(goal, g); cap = Math.max(cap, c); }
  var last = performance.now();
  (function tick(now) {
    now = now || performance.now();
    var dt = Math.min(now - last, 250); last = now;
    var chasing = shown < goal - 0.001;
    var target = chasing ? goal : cap;
    shown += (target - shown) * (1 - Math.exp(-dt / (chasing ? 260 : 9000)));
    $('bar').style.transform = 'scaleX(' + shown.toFixed(4) + ')';
    requestAnimationFrame(tick);
  })();

  // ── probes ──────────────────────────────────────────────────────────────
  // UI: script tag (file:// se hamesha chalta hai). Engine: no-cors fetch —
  // opaque response bhi "server zinda hai" ka saboot hai.
  function probeUI() {
    return new Promise(function (resolve) {
      var done = false, s = document.createElement('script');
      function fin(ok) { if (done) return; done = true; if (s.parentNode) s.parentNode.removeChild(s); resolve(ok); }
      s.src = UI + '/config.js?probe=' + Date.now();
      s.onload = function () { fin(true); };
      s.onerror = function () { fin(false); };
      document.head.appendChild(s);
      setTimeout(function () { fin(false); }, 1500);
    });
  }
  function probeEngine() {
    if (!window.fetch) return Promise.resolve(false);
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, 1500);
    return fetch(ENGINE + '/?probe=' + Date.now(), { mode: 'no-cors', cache: 'no-store', signal: ctl && ctl.signal })
      .then(function () { return true; }, function () { return false; })
      .then(function (ok) { clearTimeout(t); return ok; });
  }

  // ── settings/keys migration (file:// -> localhost) ──────────────────────
  function collect() {
    var ls = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i), v = localStorage.getItem(k);
        if (k && v != null && v.length < 200000) ls[k] = v;
      }
    } catch (_) {}
    return new Promise(function (resolve) {
      var keys = {}, finished = false;
      function done() { if (!finished) { finished = true; resolve({ type: 'clavis-migrate', ls: ls, keys: keys }); } }
      var s = document.createElement('script');
      s.src = 'clavis-keyvault.js?migrate=1';
      s.onload = function () {
        var vault = window.ClavisKeyVault;
        if (!vault) return done();
        Promise.resolve(vault.boot()).then(function () {
          Object.keys(vault.info || {}).forEach(function (p) {
            var list = [];
            try { list = vault.all(p) || []; } catch (_) {}
            if (list.length) keys[p] = list;
          });
        }).catch(function () {}).then(done);
      };
      s.onerror = done;
      document.head.appendChild(s);
      setTimeout(done, 2500);
    });
  }
  function migrate(payload) {
    return new Promise(function (resolve) {
      var frame = document.createElement('iframe'), settled = false;
      function end() {
        if (settled) return; settled = true;
        window.removeEventListener('message', onMsg);
        if (frame.parentNode) frame.parentNode.removeChild(frame);
        resolve();
      }
      function onMsg(e) { if (e.origin === UI && e.data && e.data.type === 'clavis-migrate-ok') end(); }
      window.addEventListener('message', onMsg);
      frame.style.display = 'none';
      frame.src = UI + '/clavis-migrate.html';
      frame.onload = function () { try { frame.contentWindow.postMessage(payload, UI); } catch (_) { end(); } };
      document.body.appendChild(frame);
      setTimeout(end, 3000);
    });
  }

  // ── flow ────────────────────────────────────────────────────────────────
  var t0 = Date.now();
  var st = { ui: false, engine: false, uiAt: 0, launched: false, launchAt: 0, finishing: false, failed: false };
  var timer = 0;

  function openFold(id, on) {
    $(id).classList.toggle('open', !!on);
    if (id === 'help') document.body.classList.toggle('help-open', !!on);
  }

  function launch(byUser) {
    st.launched = true;
    st.launchAt = Date.now();
    mark('launch', 'active', '');
    say('Servers jaga raha hoon…');
    foot('Chrome <b>“Open Clavis Launcher?”</b> puchhe to <b>Open</b> dabaiye');
    aim(0.16, 0.42);
    // Start-Clavis.bat ne register kiya hua clavis:// — servers hidden start
    // karta hai, koi naya window nahi. Top-level navigation chahiye (iframe
    // se Chrome block karta hai); page yahin rehta hai.
    try { window.location.href = 'clavis://start'; } catch (_) {}
    if (byUser && st.failed) unfail();
    setTimeout(function () {
      if (st.ui || st.failed) return;
      mark('launch', 'done', 'sent');
      mark('ui', 'active', '');
      say('Interface start ho raha hai…');
    }, 900);
  }

  function unfail() {
    st.failed = false;
    t0 = Date.now() - 1;
    $('stage').classList.remove('bad');
    openFold('help', false);
    $('start').textContent = 'Start Clavis';
  }

  function fail() {
    st.failed = true;
    $('stage').classList.add('bad');
    mark('launch', 'warn', 'no reply');
    mark('ui', '', '');
    say('Launcher se jawab nahi aaya');
    foot('Background me intezaar jaari hai — servers chalte hi khud khul jayega');
    $('start').textContent = 'Dobara try karein';
    openFold('act', true);
    openFold('help', true);
  }

  function finish() {
    if (st.finishing) return;
    st.finishing = true;
    clearTimeout(timer);
    $('stage').classList.add('ok');
    $('stage').classList.remove('bad');
    openFold('act', false); openFold('help', false);
    foot('');
    say('Khol raha hoon…');
    aim(1, 1);
    collect().then(migrate).then(function () {
      document.body.classList.add('leaving');
      setTimeout(function () { window.location.replace(UI + '/index.html' + hash); }, 420);
    });
  }

  function check() {
    Promise.all([st.ui ? true : probeUI(), st.engine ? true : probeEngine()]).then(function (r) {
      if (st.finishing) return;
      var now = Date.now();

      if (r[0] && !st.ui) {
        st.ui = true; st.uiAt = now;
        if (st.failed) unfail();
        mark('launch', 'done', st.launched ? secs(now - st.launchAt) : 'ready');
        mark('ui', 'done', secs(now - t0));
        openFold('act', false); openFold('help', false);
        foot('');
        aim(0.58, 0.9);
      }
      if (r[1] && !st.engine) {
        st.engine = true;
        mark('engine', 'done', secs(now - t0));
        aim(st.ui ? 0.94 : 0.4, 0.96);
      }

      if (st.ui && st.engine) return finish();

      if (st.ui) {
        mark('engine', 'active', '');
        say('AI engine garam ho raha hai…');
        if (now - st.uiAt > ENGINE_GRACE) {
          mark('engine', '', 'background');
          return finish();   // app khud engine ka wait/offline mode sambhalta hai
        }
      } else {
        if (!st.launched) launch(false);
        var waited = now - st.launchAt;
        if (!st.failed && waited > RETRY_AFTER) openFold('act', true);
        if (!st.failed && waited > HINT_AFTER) say('Thoda aur… pehli baar thoda time lagta hai');
        if (!st.failed && waited > FAIL_AFTER) fail();
      }
      timer = setTimeout(check, st.failed ? 2000 : POLL_MS);
    });
  }

  $('start').onclick = function () { launch(true); };
  $('why').onclick = function () { openFold('help', !$('help').classList.contains('open')); };
  $('why').setAttribute('aria-controls', 'help');
  $('copy').onclick = function () {
    var btn = this;
    function ok() { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1600); }
    try {
      navigator.clipboard.writeText(batPath).then(ok, fallback);
    } catch (_) { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = batPath; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch (_) {}
      ta.parentNode.removeChild(ta);
    }
  };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !st.ui && !st.finishing && document.activeElement === document.body) launch(true);
  });

  // Ticking elapsed time on the active step — shows it's alive.
  setInterval(function () {
    if (st.finishing) return;
    var now = Date.now();
    if (!st.ui && st.launched && !st.failed) $('m-ui').textContent = secs(now - st.launchAt);
    else if (st.ui && !st.engine) $('m-engine').textContent = secs(now - st.uiAt);
  }, 250);

  check();
})();
