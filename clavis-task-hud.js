/**
 * CLAVIS TASK HUD (clavis-task-hud.js)
 * ==============================================================
 * Turns the Clavis page into a voice-first surface:
 *
 *   - adds .clavis-stage-v2 to <html>, which is what every rule in
 *     clavis-stage.css hangs off (so removing the class, or setting
 *     localStorage.clavis_stage_v2 = 'off', restores the old page
 *     exactly -- nothing here edits the original markup or CSS);
 *   - builds a floating Task HUD and drives it from the assistant's
 *     real state, so a task shows its pipeline while it runs and its
 *     output when it lands;
 *   - injects a "Transcript" item into the existing More menu so the
 *     hidden chat log is always one click away.
 *
 * HOW IT HOOKS IN, AND WHY THIS WAY
 * ---------------------------------
 * jarvis_ui.js is a 126 KB classic script whose top-level function
 * declarations are therefore global object properties. Reassigning
 * window.<name> changes what the *unqualified* calls inside that file
 * resolve to as well, so wrapping the five functions below captures
 * every path -- typed chat, voice, the agentic loop and Dev Mode --
 * without editing that file at all. The original is always called
 * first, in a try/finally, so a bug in this file can never stop the
 * app from doing what it already did.
 *
 * STALENESS
 * ---------
 * Every user turn bumps taskId. Anything async compares the id it
 * captured against the current one, so the answer to a question you
 * have already replaced never paints over the new one.
 */
'use strict';

(function ClavisTaskHUD() {

  var LS_STAGE = 'clavis_stage_v2';
  var LS_TRANSCRIPT = 'clavis_transcript_on';

  var SUBTITLES = {
    listening: 'Listening',
    thinking: 'Working on it',
    executing: 'Running task',
    speaking: 'Speaking',
    success: 'Done',
    error: 'Could not finish that',
  };

  var hud = null, card, bodyEl, stepsEl, resultEl, subEl, stopBtn, footEl, copyBtn;
  var taskId = 0;
  var openedForTask = -1;
  var hideTimer = null;
  var heightTimer = null;

  function reduced() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) { return false; }
  }

  /* Guarded rAF. If this ever threw, show() would bail before adding
     .is-open and the card would sit there with hidden=false but fully
     transparent -- an invisible HUD is worse than no HUD. */
  function raf(fn) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
    else setTimeout(fn, 16);
  }

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  /* ---------------------------------------------------------- *
   * DOM
   * ---------------------------------------------------------- */

  function build() {
    if (document.getElementById('clavis-task-hud')) {
      hud = document.getElementById('clavis-task-hud');
    } else {
      hud = document.createElement('div');
      hud.id = 'clavis-task-hud';
      hud.setAttribute('role', 'status');
      hud.setAttribute('aria-live', 'polite');
      hud.hidden = true;
      hud.innerHTML = [
        '<div class="ctk-card">',
        '  <div class="ctk-head">',
        '    <span class="ctk-glyph" aria-hidden="true"></span>',
        '    <div class="ctk-titles">',
        '      <div class="ctk-title">Clavis</div>',
        '      <div class="ctk-sub"></div>',
        '    </div>',
        '    <button type="button" class="ctk-headbtn ctk-stop">Stop</button>',
        '  </div>',
        '  <div class="ctk-body"><div class="ctk-inner">',
        '    <ol class="ctk-steps"></ol>',
        '    <div class="ctk-result"></div>',
        '  </div></div>',
        '  <div class="ctk-foot" hidden>',
        '    <button type="button" class="ctk-act ctk-copy">Copy</button>',
        '    <button type="button" class="ctk-act ctk-act--primary ctk-close">Close</button>',
        '  </div>',
        '</div>',
      ].join('\n');
      document.body.appendChild(hud);
    }

    card = hud.querySelector('.ctk-card');
    bodyEl = hud.querySelector('.ctk-body');
    stepsEl = hud.querySelector('.ctk-steps');
    resultEl = hud.querySelector('.ctk-result');
    subEl = hud.querySelector('.ctk-sub');
    stopBtn = hud.querySelector('.ctk-stop');
    footEl = hud.querySelector('.ctk-foot');
    copyBtn = hud.querySelector('.ctk-copy');

    stopBtn.addEventListener('click', function () {
      try { window.stopJarvisGeneration && window.stopJarvisGeneration(); } catch (_) {}
      setState('idle', 'Stopped');
      scheduleHide(260);
    });
    hud.querySelector('.ctk-close').addEventListener('click', function () { hide(); });
    copyBtn.addEventListener('click', function () {
      var text = (resultEl.textContent || '').trim();
      if (!text) return;
      try {
        navigator.clipboard.writeText(text);
        copyBtn.textContent = 'Copied';
        setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1600);
      } catch (_) {}
    });

    window.addEventListener('resize', place);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && hud && !hud.hidden) hide();
    });
  }

  /* The Clavis stage is overflow:hidden + contain:layout, so the card
     lives on <body> and is positioned against the stage's measured box
     instead of being nested inside it (where it would be clipped). */
  function place() {
    if (!hud) return;
    var stage = document.querySelector('#view-jarvis .jarvis-hero-stage')
      || document.getElementById('view-jarvis');
    var rect = stage && stage.getBoundingClientRect();
    if (!rect || !rect.width) {
      hud.style.setProperty('--ctk-x', '50%');
      hud.style.setProperty('--ctk-y', '112px');
      hud.style.setProperty('--ctk-w', 'min(560px, calc(100vw - 48px))');
      return;
    }
    hud.style.setProperty('--ctk-x', (rect.left + rect.width / 2) + 'px');
    hud.style.setProperty('--ctk-y', Math.max(14, rect.top + 66) + 'px');
    hud.style.setProperty('--ctk-w', Math.max(280, Math.min(560, rect.width - 48)) + 'px');
  }

  /* ---------------------------------------------------------- *
   * Height animation -- the card grows into its content
   * ---------------------------------------------------------- */

  function animateHeight(mutate) {
    if (!bodyEl) { mutate(); return; }
    if (reduced()) { mutate(); bodyEl.style.height = 'auto'; return; }

    var from = bodyEl.getBoundingClientRect().height;
    bodyEl.style.height = 'auto';
    mutate();
    var to = bodyEl.getBoundingClientRect().height;

    if (Math.abs(to - from) < 1) { bodyEl.style.height = 'auto'; return; }

    bodyEl.style.transition = 'none';
    bodyEl.style.height = from + 'px';
    void bodyEl.offsetHeight;
    bodyEl.style.transition = 'height 560ms cubic-bezier(0.22, 1, 0.36, 1)';
    bodyEl.style.height = to + 'px';

    clearTimeout(heightTimer);
    heightTimer = setTimeout(function () {
      bodyEl.style.height = 'auto';
      bodyEl.style.transition = '';
    }, 600);
  }

  /* ---------------------------------------------------------- *
   * State
   * ---------------------------------------------------------- */

  function isOpen() { return !!(hud && !hud.hidden); }

  function setState(state, sub) {
    if (!hud) return;
    var key = String(state || '').toLowerCase();
    hud.setAttribute('data-state', key);
    if (subEl) subEl.textContent = sub || SUBTITLES[key] || '';
    var busy = key === 'thinking' || key === 'executing' || key === 'listening' || key === 'speaking';
    if (stopBtn) stopBtn.hidden = !busy;
  }

  function show(state, sub) {
    if (!hud) return;
    clearTimeout(hideTimer);
    place();
    setState(state || 'thinking', sub);
    if (hud.hidden) {
      hud.hidden = false;
      raf(function () { hud.classList.add('is-open'); });
    }
    openedForTask = taskId;
  }

  function hide() {
    if (!hud || hud.hidden) return;
    clearTimeout(hideTimer);
    hud.classList.remove('is-open');
    hideTimer = setTimeout(function () {
      hud.hidden = true;
      clear();
    }, 240);
  }

  function scheduleHide(ms) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, ms);
  }

  function clear() {
    if (!stepsEl) return;
    stepsEl.innerHTML = '';
    resultEl.innerHTML = '';
    if (footEl) footEl.hidden = true;
    bodyEl.style.height = 'auto';
  }

  function newTask() {
    taskId++;
    clearTimeout(hideTimer);
    if (isOpen()) {
      // A new request replaces whatever the last one left on screen --
      // stale output must never sit under a fresh question.
      animateHeight(clear);
      setState('thinking');
    } else {
      clear();
    }
  }

  /* ---------------------------------------------------------- *
   * Pipeline steps
   * ---------------------------------------------------------- */

  function prettyLabel(raw) {
    return String(raw == null ? '' : raw)
      .replace(/^[^A-Za-z0-9ऀ-ॿ]+/, '')
      .replace(/_/g, ' ')
      .trim();
  }

  function stepClass(state) {
    var s = String(state || '').toLowerCase();
    if (s === 'done' || s === 'ok' || s === 'success') return 'done';
    if (s === 'error' || s === 'failed' || s === 'fail') return 'failed';
    return 'running';
  }

  function addStep(label, state) {
    if (!stepsEl) return;
    var mine = taskId;
    animateHeight(function () {
      if (mine !== taskId) return;
      var li = document.createElement('li');
      li.className = 'ctk-step ' + stepClass(state);
      var dot = document.createElement('span');
      dot.className = 'ctk-dot';
      var text = document.createElement('span');
      text.className = 'ctk-steptext';
      text.textContent = prettyLabel(label);
      li.appendChild(dot);
      li.appendChild(text);
      stepsEl.appendChild(li);
    });
  }

  function updateStep(label, state) {
    if (!stepsEl) return;
    var running = stepsEl.querySelectorAll('.ctk-step.running');
    var last = running[running.length - 1] || stepsEl.lastElementChild;
    if (!last) { addStep(label, state); return; }
    last.className = 'ctk-step ' + stepClass(state);
    var text = last.querySelector('.ctk-steptext');
    if (text) text.textContent = prettyLabel(label);
  }

  function markStepsSettled() {
    if (!stepsEl) return;
    var running = stepsEl.querySelectorAll('.ctk-step.running');
    for (var i = 0; i < running.length; i++) running[i].className = 'ctk-step done';
  }

  /* ---------------------------------------------------------- *
   * Result
   * ---------------------------------------------------------- */

  function revealWords(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [], node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.trim()) nodes.push(node);
    }
    var index = 0;
    for (var n = 0; n < nodes.length; n++) {
      var target = nodes[n];
      if (!target.parentNode) continue;
      var frag = document.createDocumentFragment();
      var parts = target.nodeValue.split(/(\s+)/);
      for (var p = 0; p < parts.length; p++) {
        var part = parts[p];
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(part));
          continue;
        }
        var span = document.createElement('span');
        span.className = 'ctk-w';
        // Past a few hundred words the stagger stops being charming and
        // starts being a wait, so the tail simply appears.
        span.style.setProperty('--i', String(index < 240 ? index : 0));
        span.textContent = part;
        frag.appendChild(span);
        index++;
      }
      target.parentNode.replaceChild(frag, target);
    }
  }

  function setResult(html) {
    if (!resultEl) return;
    var mine = taskId;
    var hadSteps = stepsEl && stepsEl.children.length > 0;

    animateHeight(function () {
      if (mine !== taskId) return;
      markStepsSettled();
      resultEl.innerHTML = '';
      var holder = document.createElement('div');
      holder.innerHTML = String(html == null ? '' : html);
      var strip = holder.querySelectorAll('script, style, iframe, object, embed');
      for (var i = 0; i < strip.length; i++) strip[i].remove();
      resultEl.appendChild(holder);
      if (!reduced()) revealWords(resultEl);
    });

    if (mine !== taskId) return;
    setState('success');
    if (footEl) footEl.hidden = false;

    // A one-line acknowledgement should not need dismissing; a real
    // answer should stay until you are finished reading it.
    var text = (resultEl.textContent || '').trim();
    if (!hadSteps && text.length < 70) scheduleHide(7000);
  }

  /* ---------------------------------------------------------- *
   * Transcript toggle (injected into the existing More menu)
   * ---------------------------------------------------------- */

  function applyTranscript(on) {
    document.documentElement.classList.toggle('clavis-transcript-on', !!on);
    lsSet(LS_TRANSCRIPT, on ? 'on' : 'off');
    var btn = document.getElementById('clavis-transcript-toggle');
    if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function injectTranscriptToggle() {
    var panel = document.getElementById('jarvis-more-panel');
    if (!panel || document.getElementById('clavis-transcript-toggle')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'jarvis-more-item';
    btn.id = 'clavis-transcript-toggle';
    btn.title = 'Show or hide the full conversation log on this page';
    btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>Transcript';
    btn.setAttribute('aria-pressed', lsGet(LS_TRANSCRIPT) === 'on' ? 'true' : 'false');
    btn.addEventListener('click', function () {
      applyTranscript(!document.documentElement.classList.contains('clavis-transcript-on'));
      try { window.toggleJarvisMoreMenu && window.toggleJarvisMoreMenu(false); } catch (_) {}
    });
    var firstItem = panel.querySelector('.jarvis-more-sep') || null;
    if (firstItem) panel.insertBefore(btn, firstItem);
    else panel.appendChild(btn);
  }

  /* ---------------------------------------------------------- *
   * Wiring
   * ---------------------------------------------------------- */

  /* Runs the original first, always, then our side effect in its own
     try/catch -- the HUD can never break the behaviour it observes. */
  function wrap(name, after) {
    var original = window[name];
    if (typeof original !== 'function') return false;
    if (original.__clavisHudWrapped) return true;
    var wrapped = function () {
      var out;
      try {
        out = original.apply(this, arguments);
      } finally {
        try { after.apply(null, arguments); } catch (err) {
          if (window.console) console.warn('[ClavisHUD] hook failed for ' + name, err);
        }
      }
      return out;
    };
    wrapped.__clavisHudWrapped = true;
    wrapped.__clavisHudOriginal = original;
    window[name] = wrapped;
    return true;
  }

  function install() {
    wrap('setJarvisStatus', function (state) {
      var key = String(state || '').toLowerCase();
      document.documentElement.setAttribute('data-clavis-state', key);
      if (key === 'thinking') {
        show('thinking');
      } else if (key === 'speaking') {
        if (isOpen()) setState('speaking');
      } else if (key === 'error' || key === 'unavailable') {
        if (isOpen()) setState('error');
      }
    });

    wrap('showJarvisTyping', function () { show('thinking'); });

    wrap('appendJarvisToolChip', function (label, state) {
      show('executing');
      addStep(label, state);
    });

    wrap('updateLastToolChip', function (label, state) { updateStep(label, state); });

    wrap('appendJarvisBubble', function (role, html) {
      if (role === 'user') { newTask(); return; }
      if (role !== 'assistant') return;
      show('thinking');
      setResult(html);
    });

    wrap('stopJarvisGeneration', function () {
      document.documentElement.setAttribute('data-clavis-state', 'idle');
      if (isOpen() && !(resultEl && resultEl.textContent.trim())) scheduleHide(200);
    });

    wrap('newJarvisChat', function () { newTask(); hide(); });

    injectTranscriptToggle();
  }

  /* ---------------------------------------------------------- *
   * Boot
   * ---------------------------------------------------------- */

  function boot() {
    if (lsGet(LS_STAGE) === 'off') return;

    document.documentElement.classList.add('clavis-stage-v2');
    document.documentElement.setAttribute('data-clavis-state', 'idle');
    applyTranscript(lsGet(LS_TRANSCRIPT) === 'on');

    build();
    install();
    place();

    window.ClavisHUD = {
      show: show,
      hide: hide,
      setState: setState,
      step: addStep,
      updateStep: updateStep,
      result: setResult,
      newTask: newTask,
      place: place,
      transcript: applyTranscript,
      /** Runnable check: ClavisHUD._selfTest() in the console. */
      _selfTest: function () {
        var fails = [], total = 0;
        function check(label, ok) { total++; if (!ok) fails.push(label); }
        check('hud element exists', !!document.getElementById('clavis-task-hud'));
        check('stage class applied', document.documentElement.classList.contains('clavis-stage-v2'));
        check('setJarvisStatus wrapped', !!(window.setJarvisStatus && window.setJarvisStatus.__clavisHudWrapped));
        check('appendJarvisBubble wrapped', !!(window.appendJarvisBubble && window.appendJarvisBubble.__clavisHudWrapped));
        check('label prettifier strips emoji', prettyLabel('⚙️ Running: pc_list_windows') === 'Running: pc list windows');
        var before = taskId; newTask();
        check('new turn bumps task id', taskId === before + 1);
        (window.console[fails.length ? 'error' : 'log'])(
          'ClavisHUD self-test: ' + (total - fails.length) + '/' + total + ' passed'
          + (fails.length ? ' -- failed: ' + fails.join(', ') : ''));
        return fails.length === 0;
      },
    };
  }

  // Every script here is deferred, so DOMContentLoaded is the first
  // moment jarvis_ui.js's globals are guaranteed to exist.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
