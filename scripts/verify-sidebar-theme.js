/** Small runtime check for the shared sidebar and theme controllers. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(rootDir, name), 'utf8');

function element(classes = []) {
  const names = new Set(classes);
  const attrs = new Map();
  const styles = new Map();
  const listeners = new Map();
  return {
    dataset: {}, checked: false,
    style: {
      setProperty: (key, value) => styles.set(key, value),
      getPropertyValue: key => styles.get(key) || '',
      removeProperty: key => styles.delete(key)
    },
    classList: {
      add: name => names.add(name), remove: name => names.delete(name),
      contains: name => names.has(name),
      toggle(name, force) {
        const on = force === undefined ? !names.has(name) : !!force;
        if (on) names.add(name); else names.delete(name);
        return on;
      }
    },
    setAttribute: (key, value) => attrs.set(key, String(value)),
    getAttribute: key => attrs.get(key) || null,
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    fire(name, event = {}) { (listeners.get(name) || []).forEach(fn => fn(event)); }
  };
}

const root = element();
root.setAttribute('data-theme', 'light');
const sidebar = element(['sidebar']);
const main = element();
const toggle = element();
const collapse = element();
const expand = element();
const mobile = element();
const theme = element();
const darkSetting = element();
const autoSetting = element();
const body = element();
const storage = new Map([['lx-sidebar-collapsed', 'true'], ['do-sidebar-width', '215'], ['skylark-theme-auto', 'true']]);
const localStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value))
};
const byId = {
  sidebar, 'main-content': main, 'mark-bennett-theme-btn': theme,
  'sm-darkmode': darkSetting, 'sm-auto-theme': autoSetting
};
const bySelector = {
  '.mac-close': toggle, '.mac-minimize': collapse, '.mac-maximize': expand,
  '[aria-label="Toggle sidebar"]': toggle,
  '[aria-label="Collapse sidebar"]': collapse,
  '[aria-label="Expand sidebar"]': expand,
  '[aria-label="Open navigation"]': mobile,
  '.mobile-sidebar-trigger': mobile
};
const document = {
  documentElement: root, body, readyState: 'complete',
  getElementById: id => byId[id] || null,
  querySelector: selector => bySelector[selector] || null,
  querySelectorAll: () => [],
  addEventListener: body.addEventListener,
  dispatchEvent: event => body.fire(event.type, event)
};
const desktop = { matches: true, addEventListener() {} };
const window = { innerWidth: 1000 };
const context = vm.createContext({
  document, window, localStorage, matchMedia: () => desktop,
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  setTimeout: () => 1, clearTimeout() {}, console
});

const luxury = read('luxury-ui.js');
const luxuryEnd = luxury.indexOf('// ══════════════════════════════════════════════════════════════');
assert(luxuryEnd > 0);
vm.runInContext(luxury.slice(0, luxuryEnd), context);
const appSidebar = read('app.js').match(/function bindSidebarToggle\(\) \{[\s\S]*?\r?\n\}\r?\n/);
assert(appSidebar);
vm.runInContext(appSidebar[0] + '\nbindSidebarToggle();', context);

assert(sidebar.classList.contains('collapsed'));
toggle.fire('click');
assert(!sidebar.classList.contains('collapsed'), 'one click must open once');
toggle.fire('click');
assert(sidebar.classList.contains('collapsed'), 'second click must close once');
expand.fire('click');
assert(!sidebar.classList.contains('collapsed'));
collapse.fire('click');
assert(sidebar.classList.contains('collapsed'));
window.SidebarController.setWidth(228);
assert.strictEqual(root.style.getPropertyValue('--sidebar-expanded'), '228px');
expand.fire('click');
assert.strictEqual(root.style.getPropertyValue('--main-left'), '228px');
assert.strictEqual(localStorage.getItem('lx-sidebar-collapsed'), 'false');
toggle.fire('click'); toggle.fire('click');
assert(!sidebar.classList.contains('collapsed'), 'rapid reversal must end expanded');
assert(!read('clavis-aurora.js').includes('closeRailAtBoot'), 'boot must not overwrite the saved state');
desktop.matches = false; window.innerWidth = 600;
window.SidebarController.collapse();
mobile.fire('click');
assert(sidebar.classList.contains('mobile-open'), 'mobile control opens rail');
assert.strictEqual(mobile.getAttribute('aria-expanded'), 'true');
mobile.fire('click');
assert(!sidebar.classList.contains('mobile-open'), 'mobile control closes rail');
assert.strictEqual(mobile.getAttribute('aria-expanded'), 'false');

vm.runInContext(read('design-overhaul.js'), context);
const autoSource = read('nexus-experience.js');
const autoStart = autoSource.indexOf('(function NexusAutoTheme()');
const autoEnd = autoSource.indexOf('})();', autoStart) + 5;
assert(autoStart >= 0 && autoEnd > autoStart);
vm.runInContext(autoSource.slice(autoStart, autoEnd), context);
window.ThemeController.set('dark', { animate: false, manual: true });
assert.strictEqual(root.getAttribute('data-theme'), 'dark');
assert.strictEqual(theme.getAttribute('aria-checked'), 'true');
assert.strictEqual(localStorage.getItem('skylark-theme-auto'), 'false');
assert.strictEqual(autoSetting.checked, false);
window.ThemeController.set('light', { animate: true, manual: true });
assert.strictEqual(root.getAttribute('data-theme'), 'light');
assert.strictEqual(theme.getAttribute('aria-checked'), 'false');
assert(root.classList.contains('theme-transitioning'));
window.toggleDayNightTheme();
assert.strictEqual(root.getAttribute('data-theme'), 'dark');

console.log('Sidebar/theme runtime checks passed');
