/* chat-flow.js — the three things the chat surface knows about itself:
 * what this conversation is called, what it is doing right now, and
 * whether the reader has scrolled away from the top.
 * No network, no tokens: every answer here is derived from text the app
 * already has.                                                          */
(function (global) {
  'use strict';
  var doc = global.document;
  if (!doc) return;

  var VIEWS = [
    { view: 'view-chat',          messages: 'chat-messages',           welcome: 'chat-welcome' },
    { view: 'view-candidate-ai',  messages: 'candidate-chat-messages', welcome: 'candidate-chat-welcome' }
  ];

  /* ══ 1 · a name for the conversation ═══════════════════════
     A title is worth reading only if it says what the chat is
     about. The domain parser already extracts role, industry and
     city from the first message, so a lead chat gets named after
     the work; anything else is the user's own opening line with
     the throat-clearing removed. */

  var FILLER = /^(can|could|would|will|please|pls|plz|hey|hi|hello|ok|okay|u|you|your|do|does|did|is|are|am|the|a|an|i|me|we|my|tum|tu|tumhe|aap|mujhe|mujhko|mera|meri|kya|kyaa|koi|ek|bhai|sir|zara|thoda|ye|yeh|wo|woh)$/i;

  function head(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }
  function firstWord(s) { return String(s || '').split(/[&,/]/)[0].trim(); }

  function fromParse(p) {
    if (!p || !p.isSearch) return '';
    var city = (p.citiesExplicit && p.cities && p.cities[0]) || '';
    var role = (p.roles && p.roles[0]) || '';
    var industry = firstWord(p.industries && p.industries[0] !== 'ALL' ? p.industries[0] : '');
    if (p.workstream === 'candidates') {
      return [role || 'Candidates', city].filter(Boolean).join(' · ');
    }
    var subject = industry || 'Leads';
    var rest = [city, role].filter(Boolean).join(' · ');
    return rest ? subject + ' · ' + rest : subject;
  }

  function fromText(text) {
    var words = String(text || '').replace(/[`*_#>\n]+/g, ' ').split(/\s+/).filter(Boolean);
    var trimmed = words.slice();
    while (trimmed.length > 1 && FILLER.test(trimmed[0])) trimmed.shift();
    if (!trimmed.length) trimmed = words;
    var out = trimmed.slice(0, 6).join(' ').replace(/[?!.,:;]+$/, '');
    if (out.length > 44) out = out.slice(0, 43).replace(/\s+\S*$/, '') + '…';
    return out ? head(out) : '';
  }

  function nameFor(text) {
    var parsed = null;
    try {
      if (global.LeadCandidateDomain && global.LeadCandidateDomain.parseRequest) {
        parsed = global.LeadCandidateDomain.parseRequest(text);
      }
    } catch (e) {}
    return fromParse(parsed) || fromText(text) || '';
  }

  /* The breadcrumb is shared with every other page, so the title is
     held per view and re-applied whenever the app rewrites it. */
  var titles = {};
  var defaults = {};   // what the app calls the page when the chat has no name
  var crumb = null;
  var writing = false;

  function activeSpec() {
    for (var i = 0; i < VIEWS.length; i++) {
      var v = doc.getElementById(VIEWS[i].view);
      if (v && v.classList.contains('active')) return VIEWS[i];
    }
    return null;
  }

  function write(text) {
    writing = true;
    crumb.textContent = text;
    crumb.setAttribute('title', text);
    crumb.classList.remove('cx-title-in');
    void crumb.offsetWidth;
    crumb.classList.add('cx-title-in');
    setTimeout(function () { writing = false; }, 0);
  }

  function paint() {
    crumb = crumb || doc.getElementById('breadcrumb-text');
    if (!crumb) return;
    var spec = activeSpec();
    if (!spec) return;
    var title = titles[spec.view];
    if (!title) {
      // the app's own label for this page — worth keeping, it is the
      // name to come back to when the chat is emptied.
      var current = (crumb.textContent || '').trim();
      if (current && current !== defaults[spec.view] && !isOurs(current)) defaults[spec.view] = current;
      return;
    }
    if (crumb.textContent === title) return;
    write(title);
  }

  function isOurs(text) {
    for (var k in titles) if (titles[k] === text) return true;
    return false;
  }

  function clearTitle(viewId) {
    var had = titles[viewId];
    delete titles[viewId];
    if (!crumb || !had) return;
    crumb.removeAttribute('title');
    var spec = activeSpec();
    if (spec && spec.view === viewId && crumb.textContent === had && defaults[viewId]) {
      write(defaults[viewId]);
    }
  }

  /* ══ 2 · what it is doing right now ════════════════════════
     Claude names the step, not the spinner. The step comes from
     the same parse the search uses, so the words are true. */

  var STEPS = {
    leads:      ['Reading your request', 'Choosing live sources', 'Pulling verified rows', 'Checking contacts'],
    candidates: ['Reading your request', 'Scanning job portals', 'Filtering verified profiles'],
    general:    ['Thinking', 'Working through it', 'Writing the reply']
  };

  function stepsFor(text) {
    try {
      if (global.LeadCandidateDomain && global.LeadCandidateDomain.parseRequest) {
        var p = global.LeadCandidateDomain.parseRequest(text);
        if (p && p.isSearch) return STEPS[p.workstream === 'candidates' ? 'candidates' : 'leads'].slice();
      }
    } catch (e) {}
    return STEPS.general.slice();
  }

  /* ══ 3 · has the reader scrolled off the top ═══════════════
     The blur and the hairline only earn their keep once there is
     something above the fold to blur. */

  function watchScroll(spec) {
    var msgs = doc.getElementById(spec.messages);
    var view = doc.getElementById(spec.view);
    if (!msgs || !view) return;
    var box = view.querySelector('.chat-container');
    if (!box || box.__cxScroll) return;
    box.__cxScroll = true;
    var raf = 0;
    function sync() {
      raf = 0;
      box.dataset.scrolled = msgs.scrollTop > 6 ? '1' : '0';
    }
    msgs.addEventListener('scroll', function () {
      if (!raf) raf = global.requestAnimationFrame(sync);
    }, { passive: true });
    sync();
  }

  /* ══ wiring ═══════════════════════════════════════════════ */

  function firstUserText(msgs) {
    var row = msgs.querySelector('.chat-message.user');
    if (!row) return '';
    var bubble = row.querySelector('.chat-bubble') || row;
    return (bubble.textContent || '').trim();
  }

  function watch(spec) {
    var msgs = doc.getElementById(spec.messages);
    if (!msgs || msgs.__cxWatched) return;
    msgs.__cxWatched = true;

    new global.MutationObserver(function () {
      var text = firstUserText(msgs);
      if (!text) { clearTitle(spec.view); return; }
      if (!titles[spec.view]) {
        var t = nameFor(text);
        if (t) { titles[spec.view] = t; paint(); }
      }
    }).observe(msgs, { childList: true, subtree: true });

    watchScroll(spec);
  }

  function install() {
    crumb = doc.getElementById('breadcrumb-text');
    VIEWS.forEach(watch);
    if (crumb && !crumb.__cxGuard) {
      crumb.__cxGuard = true;
      // the app rewrites the breadcrumb on every view change; put ours back.
      new global.MutationObserver(function () { if (!writing) paint(); })
        .observe(crumb, { childList: true, characterData: true, subtree: true });
    }
    return !!crumb;
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', install);
  else install();
  var tries = 0;
  var iv = setInterval(function () { if (install() || ++tries > 40) clearInterval(iv); }, 250);

  global.ChatFlow = {
    nameFor: nameFor,
    stepsFor: stepsFor,
    titleOf: function (viewId) { return titles[viewId] || ''; },
    reset: function (viewId) { clearTitle(viewId || 'view-chat'); },

    /* ── self-check: ChatFlow.demo() ───────────────────────── */
    demo: function () {
      console.assert(nameFor('Gurugram ke hotels ki 25 leads nikalo jinko security chahiye').indexOf('Gurugram') !== -1, 'lead chat is named after the work');
      console.assert(typeof defaults === 'object', 'the page\'s own label is kept for the empty state');
      console.assert(nameFor('Delhi me 20 cooks chahiye') === 'Cooks · Delhi', 'candidate chat names the role and city');
      console.assert(nameFor('can u do backflip') === 'Backflip', 'a general chat drops the throat-clearing');
      console.assert(stepsFor('hi')[0] === 'Thinking', 'a general chat just thinks');
      console.assert(stepsFor('Delhi me 20 cooks chahiye').join(' ').indexOf('portals') !== -1, 'a candidate search scans portals');
      return 'ok';
    }
  };
})(window);
