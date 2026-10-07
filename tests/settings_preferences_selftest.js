const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const values = new Map(), inputs = new Map(), industries = new Set();
let accentCalls = 0;
const context = {
  document: { getElementById: id => inputs.get(id) || null, documentElement: { getAttribute: () => 'light' } },
  localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) },
  safeLocalStorageGet: key => values.get(key) ?? null,
  safeLocalStorageSet: (key, value) => values.set(key, String(value)),
  SettingsEngine: { load: () => ({ lastIndustries: ['hotels'] }), save: () => {} },
  selectedIndustries: industries,
  toggleIndustry: key => industries.has(key) ? industries.delete(key) : industries.add(key),
  applyAccentColor: () => accentCalls++, window: {}, showToast: () => {}, setTimeout, clearTimeout,
  location: { hash: '' }, ROUTE_MAP: {}, showView: view => { context.lastView = view; }
};
context.window.location = context.location;
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const SETTINGS_PREFERENCE_KEYS'), source.indexOf('function applyAccentColor')), context);
const keys = vm.runInContext('SETTINGS_PREFERENCE_KEYS', context);
for (const id of Object.keys(keys)) inputs.set(id, { type: 'checkbox', checked: true, value: 'on' });
inputs.set('sm-home-page', { type: 'select-one', value: 'chat', options: [{ value: 'chat' }, { value: 'dashboard' }] });
inputs.set('sm-tts-model', { type: 'select-one', value: 'fish_audio', options: [{ value: 'fish_audio' }, { value: 'gemini' }] });

(async () => {
  for (const checked of [false, true]) {
    for (const input of inputs.values()) if (input.type === 'checkbox') input.checked = checked;
    await context.saveSettings();
    for (const [id, key] of Object.entries(keys)) {
      if (inputs.get(id).type === 'checkbox') assert.equal(values.get(key), String(checked), id);
    }
    for (const input of inputs.values()) if (input.type === 'checkbox') input.checked = !checked;
    inputs.get('sm-home-page').value = 'dashboard';
    inputs.get('sm-tts-model').value = 'gemini';
    context.loadSettingsToUI(); context.loadSettingsToUI();
    for (const [id, input] of inputs) if (input.type === 'checkbox') assert.equal(input.checked, checked, id);
    assert.equal(inputs.get('sm-home-page').value, 'chat');
    assert.equal(inputs.get('sm-tts-model').value, 'fish_audio', 'Opening Settings must not switch the selected voice provider');
    assert.ok(industries.has('hotels'), 'Opening Settings twice must not deselect industries');
  }
  values.set(keys['sm-toasts'], 'on'); inputs.get('sm-toasts').checked = false;
  values.set(keys['sm-home-page'], 'unknown-route');
  context.loadSettingsToUI();
  assert.equal(inputs.get('sm-toasts').checked, false, 'Unknown legacy state must retain its default');
  assert.equal(inputs.get('sm-home-page').value, 'chat', 'Invalid options must not blank a dropdown');
  assert.equal(accentCalls, 0, 'Saving without the old accent control must preserve the active palette');
  vm.runInContext(source.slice(source.indexOf('function saveVoiceSettings()'), source.indexOf('function saveJarvisSettings()')), context);
  context.saveVoiceSettings();
  assert.equal(values.get('skylark-tts-engine'), 'fish_audio', 'Voice Save must preserve the chosen engine');
  vm.runInContext(source.slice(source.indexOf('function handleHashChange()'), source.indexOf('function bindNavigation()')), context);
  values.set('skylark-home-page', 'chat'); context.handleHashChange(); assert.equal(context.lastView, 'chat');
  context.location.hash = '#leads'; context.handleHashChange(); assert.equal(context.lastView, 'leads');
  context.location.hash = ''; values.set('skylark-home-page', 'unknown'); context.handleHashChange(); assert.equal(context.lastView, 'dashboard');
  let feedback;
  context.showToast = (...args) => { feedback = args; };
  context.window.ClavisKeyVault = { refresh: async () => true, status: () => ({ connected: ['groq'], providers: { groq: { label: 'Groq' } } }) };
  const button = { textContent: 'Check saved keys', disabled: false };
  await context.checkSettingsKeySetup(button);
  assert.equal(feedback[2], 'Groq'); assert.equal(button.disabled, false); assert.equal(button.textContent, 'Check saved keys');
  context.window.ClavisKeyVault.refresh = async () => false;
  await context.checkSettingsKeySetup(button);
  assert.equal(feedback[0], 'error', 'A failed backend check must not report provider success');
  assert.equal(button.disabled, false);
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  vm.runInContext(html.slice(html.indexOf('function settingsAllowed()'), html.indexOf('let settingsReturnFocus')), context);
  context.window.SupabaseAuth = { getSession: () => null, isRecoveryMode: () => false };
  assert.equal(context.settingsAllowed(), false, 'A missing verified session must keep Settings closed');
  context.window.SupabaseAuth.getSession = () => ({ user: { id: 'verified' } });
  assert.equal(context.settingsAllowed(), true);
  context.window.SupabaseAuth.isRecoveryMode = () => true;
  assert.equal(context.settingsAllowed(), false, 'Password recovery must not grant Settings access');
  console.log('Settings preference round trips, repeated open, palette/default route and honest provider setup checks: passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
