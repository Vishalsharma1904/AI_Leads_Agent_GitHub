/* ============================================================
 * clavis-claude.js · Claude-style hover cards on the sidebar
 * ------------------------------------------------------------
 * On claude.com, resting the pointer on a tile opens a small
 * white card that says what it is. Same here: rest on a rail
 * item and a card eases in beside it (blur → clear, a soft
 * scale), then glides from item to item while you move. Leaves
 * quickly. Pure presentation — clicks go straight through.
 * Styles live in clavis-claude.css (.cc-card).
 * ============================================================ */
(function () {
  'use strict';
  if (window.ClavisHoverCards) return;

  var CARDS = {
    'jarvis':       ['Clavis AI', 'Aapki personal assistant. Bolo ya likho — leads, calls, emails sab yahin se.'],
    'chat':         ['Client AI', 'Shehar, industry ya role batao — Clavis live sources se verified clients dhoondhti hai.'],
    'voice-ai':     ['Voice Calling AI', 'Clavis aapki taraf se client ko call karke baat karti hai.'],
    'candidate-ai': ['Candidate AI', 'Guards aur housekeeping staff ke liye sahi candidates dhoondho.'],
    'dashboard':    ['Dashboard', 'Aaj ki leads, pipeline aur progress — ek nazar me.'],
    'leads':        ['All Leads', 'Har buyer company ek jagah — search, filter, export.'],
    'candidate-db': ['Candidate DB', 'Saved candidates, unke documents aur status.'],
    'excel':        ['Excel Manager', 'Sheets import karo, saaf karo, wapas export karo.'],
    'analytics':    ['Analytics', 'Kaunsa source aur kaunsa shehar sabse zyada kaam aa raha hai.'],
    'agent':        ['Run Agent', 'Scraping agent chalao — naye clients seedha aapki list me.'],
    'email':        ['Email Auto', 'Follow-ups aur campaigns, apne aap.'],
    'whatsapp':     ['WhatsApp Auto', 'Templates aur bulk messages, bina spam ke.'],
    'accounts':     ['Accounts', 'Gmail, Sheets aur baaki connected accounts.'],
    'plugins':      ['Plugins', 'Naye tools jodo — SMS, CRM aur bhi.'],
    'tokens':       ['API Keys', 'Keys aur unka usage, sab ek jagah.'],
    'settings':     ['Settings', 'Appearance, voice, notifications aur security.']
  };
  var HEADER_CARD = ['Lead & Data Hub', 'Leads, candidates, Excel aur reports — ek jagah.'];

  var FIRST_DELAY = 450;     // wait for intent before the first card
  var WARM_DELAY = 60;       // once one is open, neighbours answer at once
  var WARM_FOR = 700;        // …for this long after the last card closed
  var GAP = 12;

  var card = null, titleEl = null, textEl = null;
  var target = null, timer = 0, visible = false, lastHide = -1e9, raf = 0;
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}

  function build() {
    card = document.createElement('div');
    card.className = 'cc-card';
    card.setAttribute('aria-hidden', 'true');
    card.innerHTML =
      '<p class="cc-card-title"></p>' +
      '<p class="cc-card-text"></p>' +
      '<span class="cc-card-foot">Open' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' +
      '</span>';
    document.body.appendChild(card);
    titleEl = card.querySelector('.cc-card-title');
    textEl = card.querySelector('.cc-card-text');
  }

  function contentFor(el) {
    var view = el.getAttribute('data-view') || '';
    if (el.classList.contains('main-cat-header')) return HEADER_CARD;
    return CARDS[view] || null;
  }

  function place() {
    if (!target || !target.isConnected) return;
    var r = target.getBoundingClientRect();
    var rail = document.getElementById('sidebar');
    var rr = rail ? rail.getBoundingClientRect() : r;
    var x = Math.max(r.right, rr.right) + GAP;
    var h = card.offsetHeight || 110;
    var y = r.top + r.height / 2 - 22;
    y = Math.min(Math.max(8, y), window.innerHeight - h - 8);
    card.style.left = Math.round(x) + 'px';
    card.style.top = Math.round(y) + 'px';
  }

  /* the rail animates its width on peek — follow it for a moment */
  function follow(until) {
    cancelAnimationFrame(raf);
    (function tick() {
      place();
      if (visible && performance.now() < until) raf = requestAnimationFrame(tick);
    })();
  }

  function show(el) {
    var c = contentFor(el);
    if (!c || !el.isConnected) return;
    if (!card) build();
    var moving = visible;
    titleEl.textContent = c[0];
    textEl.textContent = c[1];
    target = el;
    card.classList.toggle('is-move', moving);
    if (!moving) {
      card.classList.remove('is-in');
      place();
      void card.offsetWidth;          // start from the resting state
    }
    visible = true;
    requestAnimationFrame(function () { if (visible) card.classList.add('is-in'); });
    follow(performance.now() + 520);
  }

  function hide() {
    clearTimeout(timer);
    if (visible) lastHide = performance.now();
    visible = false;
    target = null;
    cancelAnimationFrame(raf);
    if (card) card.classList.remove('is-in', 'is-move');
  }

  function candidate(node) {
    return node && node.closest ? node.closest('#sidebar :is(.nav-item, .nav-sub-item)[data-view]') : null;
  }

  function onOver(e) {
    if (e.pointerType === 'touch' || reduced) return;
    var el = candidate(e.target);
    if (el === target && visible) return;
    clearTimeout(timer);
    if (!el || !contentFor(el)) { if (visible) hide(); return; }
    var warm = visible || performance.now() - lastHide < WARM_FOR;
    var pending = el;
    timer = setTimeout(function () { if (pending.matches(':hover')) show(pending); }, warm ? WARM_DELAY : FIRST_DELAY);
  }

  function onOut(e) {
    var from = candidate(e.target);
    if (!from) return;
    var to = e.relatedTarget;
    if (to && candidate(to)) return;   // moving to a neighbour — keep the card
    clearTimeout(timer);
    hide();
  }

  function install() {
    if (install.done || !document.body) return;
    install.done = true;
    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('blur', hide);
    window.addEventListener('scroll', function () { if (visible) place(); }, true);
    window.addEventListener('resize', hide);
  }

  /* When the rail is pinned open/closed the sheet's margin changes. It used
     to transition margin-left + width — a full-page re-layout per frame.
     Now it lays out once and slides into place with a transform (FLIP). */
  function flipSheet() {
    var main = document.getElementById('main-content');
    var rail = document.getElementById('sidebar');
    if (!main || !rail || !main.animate) return;
    var last = main.getBoundingClientRect().left;
    function check() {
      var now = main.getBoundingClientRect().left;
      var dx = last - now;
      last = now;
      if (Math.abs(dx) < 2 || reduced || document.documentElement.classList.contains('sidebar-resizing')) return;
      main.animate([{ transform: 'translateX(' + dx + 'px)' }, { transform: 'none' }],
        { duration: 420, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
    }
    var mo = new MutationObserver(function () { requestAnimationFrame(check); });
    mo.observe(rail, { attributes: true, attributeFilter: ['class', 'style'] });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  }

  /* Voice settings lived inside the orb stage, which animates `transform`
     forever — that turns position:fixed into "relative to the orb" and the
     panel showed up as an empty sliver. Give it to the view instead. */
  function freeVoicePanel() {
    var p = document.getElementById('jarvisVoicePanel');
    var v = document.getElementById('view-jarvis');
    if (p && v && p.parentElement !== v) v.appendChild(p);
  }

  /* The Clavis Live bar sits at the bottom of the window, exactly where the
     composers are. Lift it to just above whichever composer is on screen. */
  function placeHud() {
    var hud = document.getElementById('clavis-live-hud');
    if (!hud) return;
    /* The voice bar lives at the TOP of the page now (under the Clavis
       header), centred on the sheet — the composer and the floating
       windows below never share its space. */
    var head = document.querySelector('.view.active .jarvis-hero-header, .view.active .view-header');
    var hr = head ? head.getBoundingClientRect() : null;
    var bar = document.querySelector('.topbar');
    var br = bar ? bar.getBoundingClientRect() : null;
    var top = hr && hr.height ? hr.bottom + 10 : (br ? br.bottom + 12 : 72);
    var main = document.getElementById('main-content');
    var mr = main ? main.getBoundingClientRect() : null;
    var cx = mr && mr.width ? mr.left + mr.width / 2 : window.innerWidth / 2;
    if (!hud.classList.contains('clh-top')) hud.classList.add('clh-top');
    var t = Math.round(top) + 'px', l = Math.round(cx) + 'px';
    if (hud.style.top !== t) hud.style.top = t;
    if (hud.style.left !== l) hud.style.left = l;
    if (hud.style.bottom !== 'auto') hud.style.bottom = 'auto';
  }
  function watchHud() {
    var hudObs = null;
    function hook() {
      var hud = document.getElementById('clavis-live-hud');
      if (!hud || hud.__ccHooked) return;
      hud.__ccHooked = true;
      hudObs = new MutationObserver(function () { requestAnimationFrame(placeHud); });
      hudObs.observe(hud, { attributes: true, attributeFilter: ['class'] });
      placeHud();
    }
    new MutationObserver(hook).observe(document.body, { childList: true });
    window.addEventListener('resize', function () { requestAnimationFrame(placeHud); });
    window.addEventListener('hashchange', function () { setTimeout(placeHud, 120); });
    var rail = document.getElementById('sidebar');
    if (rail) rail.addEventListener('transitionend', function (e) { if (e.target === rail) placeHud(); });
    hook();
  }

  function boot() { install(); /* flipSheet: off — rail + page share one CSS clock (clavis-manual.css §9) */ freeVoicePanel(); watchHud(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  window.ClavisHoverCards = { hide: hide, cards: CARDS };
})();
