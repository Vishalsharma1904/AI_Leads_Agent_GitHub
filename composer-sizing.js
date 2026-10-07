/* One sizing owner for every composer. Measurements never collapse the live input. */
(function (global) {
  'use strict';
  if (global.ClavisComposerSizing) return;
  var states = new WeakMap(), pending = new Set(), raf = 0;
  var properties = ['font-family','font-size','font-weight','font-style','line-height','letter-spacing','word-spacing','padding-top','padding-right','padding-bottom','padding-left','border-top-width','border-bottom-width','box-sizing','text-indent','tab-size','font-feature-settings','font-variation-settings','font-kerning','font-optical-sizing'];
  function schedule(input) {
    if (!input) return;
    if (!states.has(input)) attach(input);
    pending.add(input);
    if (!raf && !document.hidden) raf = requestAnimationFrame(flush);
  }
  function refreshMetrics(state) {
    // ResizeObserver, theme/font events and navigation invalidate this cache.
    // Reading geometry after every keystroke was forcing an unrelated layout.
    if (state.width && !state.dirty) return true;
    var input = state.input, width = input.getBoundingClientRect().width;
    if (!width) return false;
    if (state.width === width && !state.dirty) return true;
    state.width = width; state.dirty = false;
    var css = getComputedStyle(input), mirror = state.mirror;
    properties.forEach(function (p) { mirror.style.setProperty(p, css.getPropertyValue(p), 'important'); });
    mirror.style.setProperty('width', width + 'px', 'important');
    state.border = (parseFloat(css.borderTopWidth) || 0) + (parseFloat(css.borderBottomWidth) || 0);
    return true;
  }
  function measure(state) {
    var input = state.input;
    if (!input.isConnected || input.closest('.view:not(.active),[hidden]')) return;
    if (!refreshMetrics(state)) return;
    var value = input.value || '';
    if (state.value === value && state.measuredWidth === state.width) return;
    state.value = value; state.measuredWidth = state.width;
    state.mirror.value = value;
    var raw = value.trim() ? state.mirror.scrollHeight + state.border : state.min;
    var height = Math.max(state.min, Math.min(state.max, raw));
    var prev = state.height == null ? (parseFloat(input.style.height) || state.min) : state.height;
    state.height = height;
    // Preserve the existing growth easing and immediate shrink. No layout flush.
    if (height !== prev || !input.style.height) {
      input.classList.toggle('au-shrinking', height <= prev);
      input.style.setProperty('height', height + 'px', 'important');
      input.style.setProperty('--lx-ta-h', height + 'px');
      input.dispatchEvent(new CustomEvent('composer:size', { detail: { height: height, previous: prev } }));
    }
    input.classList.remove('au-measuring');
    var overflow = raw > state.max ? 'auto' : 'hidden';
    if (input.style.overflowY !== overflow) input.style.overflowY = overflow;
    input.classList.toggle('lx-grow-scroll', raw > state.max);
    var grow = raw >= state.max ? 'full' : 'fit';
    if (input.dataset.grow !== grow) input.dataset.grow = grow;
    var host = input.closest('.chat-container,.jarvis-input-container,.claude-input-container,.candidate-composer');
    if (host && host.dataset.emptyInput !== (value.trim() ? '0' : '1')) host.dataset.emptyInput = value.trim() ? '0' : '1';
    if (state.onSize) state.onSize(height, prev);
  }
  function flush() {
    raf = 0;
    if (document.hidden) return;
    var batch = Array.from(pending); pending.clear();
    batch.forEach(function (input) { measure(states.get(input)); });
  }
  function attach(input, options) {
    if (!input) return;
    options = options || {};
    var existing = states.get(input);
    if (existing) { if (options.onSize) existing.onSize = options.onSize; return existing; }
    var peek = input.matches('.cts-composer-input'), mirror = document.createElement('textarea');
    mirror.className = 'composer-measure'; mirror.tabIndex = -1; mirror.setAttribute('aria-hidden','true');
    mirror.setAttribute('data-rudra-i18n-ignore',''); mirror.setAttribute('inert','');
    mirror.style.cssText = 'position:fixed!important;left:-10000px!important;top:0!important;height:0!important;min-height:0!important;max-height:none!important;visibility:hidden!important;pointer-events:none!important;overflow:hidden!important;transition:none!important;contain:layout style!important;white-space:pre-wrap!important;overflow-wrap:break-word!important;resize:none!important;';
    document.body.appendChild(mirror);
    var state = { input:input, mirror:mirror, min:options.min || (peek ? 20 : 28), max:options.max || (peek ? 124 : 208), dirty:true, width:0, height:null, onSize:options.onSize };
    states.set(input,state);
    if (input.rows !== 1) input.rows = 1;
    ['input','focus','compositionend'].forEach(function (event) { input.addEventListener(event,function(){ schedule(input); }); });
    if (global.ResizeObserver) {
      var lastWidth = -1;
      new ResizeObserver(function(entries){var w=entries[0].contentRect.width;if(w!==lastWidth){lastWidth=w;state.dirty=true;schedule(input);}}).observe(input);
    }
    schedule(input); return state;
  }
  function invalidate() {
    document.querySelectorAll('#jarvis-input,#chat-input,#candidate-ai-input,.cts-composer-input').forEach(function(input){var s=states.get(input);if(s){s.dirty=true;s.value=null;}schedule(input);});
  }
  function install() {
    document.querySelectorAll('#jarvis-input,#chat-input,#candidate-ai-input').forEach(function(el){attach(el);});
    new MutationObserver(invalidate).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-ui-font','data-rudra-flow']});
    document.addEventListener('visibilitychange',function(){if(document.hidden){cancelAnimationFrame(raf);raf=0;}else invalidate();});
    global.addEventListener('hashchange',invalidate);
    global.addEventListener('clavis:workspace-change',invalidate);
    global.addEventListener('resize',invalidate,{passive:true});
    document.addEventListener('nexus:settingschange',invalidate);
    if(document.fonts){document.fonts.ready.then(invalidate);document.fonts.addEventListener?.('loadingdone',invalidate);}
  }
  global.ClavisComposerSizing = { attach:attach, request:schedule, invalidate:invalidate };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
