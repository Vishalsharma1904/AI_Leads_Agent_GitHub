/* Local catalogue; no API key or request to a location provider is needed. */
(function (global) {
  'use strict';
  let catalogue = null, loading = null, mode = 'cities', state = '', limit = 60, active = -1;
  const esc = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fold = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function load() {
    if (!loading) loading = fetch('assets/india-locations.json').then(r => {
      if (!r.ok) throw new Error('Location catalogue unavailable');
      return r.json();
    }).then(data => { catalogue = data; global.IndiaLocations = data; return data; }).catch(error => { loading = null; throw error; });
    return loading;
  }
  function init() {
    const root = document.getElementById('location-picker'), input = document.getElementById('location-input'), browse = document.getElementById('location-browse');
    if (!root || !input || !browse || root.dataset.ready) return;
    root.dataset.ready = '1'; root.hidden = false; root.setAttribute('popover', 'auto'); root.setAttribute('aria-label', 'Choose search locations');
    root.innerHTML = '<header><strong>Search locations</strong><button type="button" data-close aria-label="Close location picker">×</button></header><div class="location-modes" role="group" aria-label="Location type"><button type="button" data-mode="cities">Cities & towns</button><button type="button" data-mode="states">States & UTs</button></div><label class="location-search"><span class="sr-only">Search locations</span><input type="search" id="india-place-search" placeholder="Search a city, town or state…" role="combobox" aria-autocomplete="list" aria-controls="india-place-options" aria-expanded="true"></label><details class="location-state-filter"><summary>All states</summary><div></div></details><p class="location-result-count" role="status"></p><div id="india-place-options" role="listbox" aria-label="Locations" aria-multiselectable="true"></div><footer><span data-selection-count></span><button type="button" data-close>Done</button></footer><a class="location-source" href="https://github.com/dr5hn/countries-states-cities-database" target="_blank" rel="noopener">Location data · CSC / ODbL</a>';
    const search = root.querySelector('input'), options = root.querySelector('#india-place-options');
    function place() {
      const box = document.getElementById('location-tag-wrapper').getBoundingClientRect();
      root.style.width = Math.min(520, innerWidth - 24) + 'px';
      root.style.left = Math.max(12, Math.min(box.left, innerWidth - Math.min(520, innerWidth - 24) - 12)) + 'px';
      const height = Math.min(470, innerHeight - 32);
      root.style.maxHeight = height + 'px';
      root.style.top = Math.max(16, Math.min(box.bottom + 8, innerHeight - height - 16)) + 'px';
    }
    async function open(value = '') {
      search.value = value; limit = 60; active = -1; place(); root.showPopover(); browse.setAttribute('aria-expanded', 'true');
      root.querySelector('.location-result-count').textContent = 'Loading the India catalogue…';
      try { await load(); render(); } catch (_) { root.querySelector('.location-result-count').textContent = 'Catalogue unavailable. You can still type any locality and press Enter.'; }
      if (root.matches(':popover-open')) search.focus({preventScroll:true});
    }
    function close() { root.hidePopover(); browse.focus({preventScroll:true}); }
    function render() {
      if (!catalogue) return;
      const q = fold(search.value.trim());
      root.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
      const filter = root.querySelector('.location-state-filter'); filter.hidden = mode !== 'cities';
      filter.querySelector('summary').textContent = state || 'All states';
      filter.querySelector('div').innerHTML = [''].concat(catalogue.states.map(s => s.name)).map(name => `<button type="button" data-state="${esc(name)}" aria-pressed="${state === name}">${esc(name || 'All states')}</button>`).join('');
      const entries = mode === 'states' ? catalogue.states.map(s => ({value:s.name,label:s.name,detail:'Search this state / union territory'})) : [{value:'Delhi NCR',label:'Delhi NCR',detail:'Your 12 priority cities'}].concat(catalogue.states.filter(s => !state || s.name === state).flatMap(s => s.cities.map(city => ({value:city + ', ' + s.name,label:city,detail:s.name}))));
      const found = entries.filter(e => fold(e.label + ' ' + e.detail).includes(q));
      const rows = found.slice(0, limit);
      // A locality absent from the catalogue remains an explicit user choice.
      if (q && !entries.some(e => fold(e.label) === q)) rows.push({value:search.value.trim(),label:search.value.trim(),detail:'Use this custom locality'});
      options.innerHTML = rows.map((entry, i) => `<button type="button" role="option" id="india-place-${i}" data-place="${esc(entry.value)}" aria-selected="${global.AgentCtrl.selectedLocations.includes(entry.value)}"><span><strong>${esc(entry.label)}</strong><small>${esc(entry.detail)}</small></span><span aria-hidden="true">${global.AgentCtrl.selectedLocations.includes(entry.value) ? '✓' : '+'}</span></button>`).join('') + (found.length > limit ? '<button type="button" data-more>Show more locations</button>' : '');
      root.querySelector('.location-result-count').textContent = `${found.length.toLocaleString()} matching ${mode === 'cities' ? 'locations' : 'states / UTs'}`;
      root.querySelector('[data-selection-count]').textContent = global.AgentCtrl.selectedLocations.length + ' selected · saved for AI';
      active = -1; search.removeAttribute('aria-activedescendant');
    }
    browse.addEventListener('click', () => root.matches(':popover-open') ? close() : open());
    root.addEventListener('toggle', () => { browse.setAttribute('aria-expanded', String(root.matches(':popover-open'))); });
    search.addEventListener('input', () => { limit = 60; render(); });
    root.addEventListener('click', e => {
      const button = e.target.closest('button'); if (!button) return;
      if (button.hasAttribute('data-close')) return close();
      if (button.dataset.mode) { mode = button.dataset.mode; search.value = ''; limit = 60; render(); search.focus(); }
      if (button.hasAttribute('data-state')) { state = button.dataset.state; filterClose(); limit = 60; render(); search.focus(); }
      if (button.hasAttribute('data-more')) { limit += 60; render(); }
      if (button.dataset.place) {
        const idx = global.AgentCtrl.selectedLocations.indexOf(button.dataset.place);
        if (idx >= 0) global.AgentCtrl.removeLocation(idx); else global.AgentCtrl.addLocation(button.dataset.place);
        render(); search.focus({preventScroll:true});
      }
    });
    function filterClose() { root.querySelector('details').open = false; }
    search.addEventListener('keydown', e => {
      const rows = [...options.querySelectorAll('[data-place]')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); active = Math.max(0, Math.min(rows.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
        rows.forEach((row, i) => row.classList.toggle('key-active', i === active));
        if (rows[active]) { search.setAttribute('aria-activedescendant', rows[active].id); rows[active].scrollIntoView({block:'nearest'}); }
      }
      if (e.key === 'Enter' && rows.length) { e.preventDefault(); rows[Math.max(0, active)].click(); }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    input.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); open(input.value); } });
    window.addEventListener('resize', () => { if (root.matches(':popover-open')) place(); });
    window.addEventListener('rudra:auth-state', () => { root.hidePopover(); global.AgentCtrl.loadDefaults(); global.AgentCtrl.renderLocationChips(); global.AgentCtrl.renderIndustryGrid(); });
    load().catch(() => {});
  }
  document.addEventListener('DOMContentLoaded', init);
})(window);
