// tests/realtime_voice_pipeline_test.js — Comprehensive verification of the real-time voice & interaction pipeline
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

let totalTests = 0;
let passedTests = 0;

function it(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    throw err;
  }
}

async function itAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    throw err;
  }
}

// ── Environment Setup ──
const store = { clavis_wake_sources: 'snap,clap,tap,typed,touch,word,button' };
const sessionStore = {};
const listeners = {};
let mockWinOpenProxy = null;
let mockWinOpenCalls = 0;

const doc = {
  readyState: 'complete',
  documentElement: {
    setAttribute() {},
    getAttribute() { return null; }
  },
  addEventListener(event, fn) {
    listeners[event] = listeners[event] || [];
    listeners[event].push(fn);
  },
  removeEventListener(event, fn) {
    if (listeners[event]) {
      listeners[event] = listeners[event].filter(f => f !== fn);
    }
  },
  getElementById() { return null; },
  querySelectorAll() { return []; },
  querySelector(sel) {
    if (sel && sel.includes('topbar')) {
      return {
        getBoundingClientRect() {
          return { top: 0, bottom: 60, left: 1000, right: 1900, width: 900, height: 60 };
        }
      };
    }
    return null;
  },
  createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      dataset: {},
      style: {},
      classList: {
        add() {},
        remove() {},
        toggle() {},
        contains() { return false; }
      },
      children: [],
      appendChild(c) { this.children.push(c); },
      setAttribute() {},
      getAttribute() { return null; },
      addEventListener() {},
      removeEventListener() {},
      remove() {},
      getAnimations() { return []; },
      querySelector(sel) {
        if (sel && sel.includes('ce-line')) {
          return this._line || (this._line = doc.createElement('p'));
        }
        return null;
      },
      getBoundingClientRect() {
        return { top: 0, bottom: 60, left: 1000, right: 1900, width: 900, height: 60 };
      }
    };
    return el;
  },
  createDocumentFragment() {
    return {
      children: [],
      appendChild(node) { this.children.push(node); }
    };
  },
  createTextNode(t) { return { textContent: t, nodeType: 3 }; }
};

doc.body = {
  appendChild() {},
  contains() { return true; },
  removeChild() {},
  style: {}
};

const makeNode = () => ({ connect: (d) => d || makeNode(), disconnect() {} });
const mockTrack = { stop() {}, enabled: true, readyState: 'live', addEventListener() {}, removeEventListener() {} };

const win = {
  sessionStorage: {
    getItem: k => sessionStore[k] || null,
    setItem: (k, v) => { sessionStore[k] = String(v); },
    removeItem: k => { delete sessionStore[k]; }
  },
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  },
  document: doc,
  addEventListener(event, fn) {
    listeners[event] = listeners[event] || [];
    listeners[event].push(fn);
  },
  removeEventListener(event, fn) {
    if (listeners[event]) {
      listeners[event] = listeners[event].filter(f => f !== fn);
    }
  },
  dispatchEvent(ev) {},
  CustomEvent: function (type, detail) {
    this.type = type;
    this.detail = detail;
  },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame: (cb) => setTimeout(cb, 16),
  cancelAnimationFrame: (id) => clearTimeout(id),
  console,
  innerWidth: 1920,
  innerHeight: 1080,
  open: (...args) => {
    mockWinOpenCalls++;
    return typeof mockWinOpenProxy === 'function' ? mockWinOpenProxy(...args) : mockWinOpenProxy;
  },
  speechSynthesis: {
    speak() {},
    cancel() {},
    speaking: false,
    getVoices() { return []; }
  },
  WebSocket: function () {
    this.close = () => {};
    this.send = () => {};
  },
  AudioContext: function () {
    return {
      state: 'running',
      sampleRate: 16000,
      destination: makeNode(),
      audioWorklet: { addModule: async () => {} },
      createAnalyser: () => Object.assign(makeNode(), {
        fftSize: 512,
        frequencyBinCount: 256,
        getFloatTimeDomainData() {},
        getFloatFrequencyData() {}
      }),
      createGain: () => Object.assign(makeNode(), { gain: { value: 1 } }),
      createMediaStreamSource: () => makeNode(),
      resume: async () => {},
      close: async () => {}
    };
  },
  AudioWorkletNode: function () {
    return Object.assign(makeNode(), {
      port: { onmessage: null, postMessage() {} }
    });
  },
  navigator: {
    mediaDevices: {
      getUserMedia: async () => ({
        getTracks: () => [mockTrack],
        getAudioTracks: () => [mockTrack]
      })
    },
    clipboard: { readText: async () => '' }
  },
  fetch: (url) => Promise.resolve(String(url).includes('/gemini-live-token')
    ? { ok: true, json: async () => ({ token: 'auth_tokens/test-only' }) } : { ok: false }),
  SupabaseAuth: { getAccessToken: () => 'test-session-not-real' },
  ClavisWorklet: { add: async () => {} },
  ClavisDirect: {
    providerConfigured: (p) => p === 'gemini',
    keyFor: (p) => (p === 'gemini' ? 'AIzaSyDummyKeyForGeminiTestOnly12345' : '')
  }
};
win.window = win;
win.globalThis = win;

const ctx = vm.createContext(
  Object.assign(win, {
    Date, Math, Number, String, JSON, Set, Map, Array, Object, RegExp, Error, Infinity, Promise, AbortController, AbortSignal, URL, atob, btoa,
    Float32Array, Int16Array, Uint8Array
  })
);

// Load required scripts in sequence
const scripts = [
  'clavis-wake.js',
  'clavis-voice-state.js',
  'clavis-browser.js',
  'clavis-pc.js',
  'clavis-intent.js',
  'clavis-voice.js',
  'clavis-ear.js',
  'clavis-barge-in.js',
  'clavis-live.js'
];

for (const f of scripts) {
  let source = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (f === 'clavis-live.js') source = source.replace('window.ClavisLive = {',
    'window.__liveTest = { S, buildSetup, runTool, onToolCall, handleMessage, onPcm }; window.ClavisLive = {');
  vm.runInContext(source, ctx, { filename: f });
}

const VS = win.ClavisVoiceState;
const Wake = win.ClavisWake;
const Browser = win.BrowserActionManager;
const PC = win.ClavisPC;
const Intent = win.ClavisIntent;
const Voice = win.ClavisVoice;
const Ear = win.ClavisEar;
const BargeIn = win.ClavisBargeIn;
const Live = win.ClavisLive;

// Injectable clock for deterministic time testing
let mockTime = 1000000000;
VS._setClock(() => mockTime);
Wake._setClock(() => mockTime);

async function runAllTests() {
  console.log('\n--- Running Real-time Voice & Interaction Pipeline Verification Suite ---\n');

  // 1. Hard Gate & Audio Cleanups
  it('Scenario 1: Hard Gate - setMicEnabled(false) halts all cleanups and cancels active ops', () => {
    let cleanupRun = false;
    const unregister = VS.registerAudioCleanup(() => { cleanupRun = true; });

    const op = VS.createOperation('test_turn', { step: 1 });
    assert.strictEqual(VS.isOperationCurrent(op.id), true, 'operation should be active');
    assert.strictEqual(op.signal.aborted, false, 'signal should not be aborted');

    // Claim mic with fake recognizer
    let recognizerStopped = false;
    const claimed = VS.mic.claim('test_rec', () => { recognizerStopped = true; });
    assert.strictEqual(claimed, true, 'mic should be claimed');
    assert.strictEqual(VS.mic.owner, 'test_rec');

    // Action: Hard OFF
    VS.setMicEnabled(false, 'test disable');

    assert.strictEqual(VS.canProcessMic(), false, 'canProcessMic must be false');
    assert.strictEqual(VS.getCapability('micEnabled'), false, 'micEnabled capability must be false');
    assert.strictEqual(VS.state(), 'STOPPED', 'state must be STOPPED');
    assert.strictEqual(cleanupRun, true, 'registered audio cleanup must have been called');
    assert.strictEqual(recognizerStopped, true, 'recognizer stopFn must have been called');
    assert.strictEqual(VS.mic.owner, null, 'mic owner must be released');
    assert.strictEqual(op.signal.aborted, true, 'active operation must be aborted');
    assert.strictEqual(VS.isOperationCurrent(op.id), false, 'operation should no longer be current');

    // Attempting to claim mic while disabled must fail immediately
    let lateStopCalled = false;
    const lateClaim = VS.mic.claim('groq', () => { lateStopCalled = true; });
    assert.strictEqual(lateClaim, false, 'cannot claim mic while disabled');
    assert.strictEqual(lateStopCalled, true, 'stopFn invoked immediately on rejected claim');

    // Restore mic
    unregister();
    VS.setMicEnabled(true, 'test restore');
    assert.strictEqual(VS.canProcessMic(), true);
  });

  // 2. Watchdog Gate
  it('Scenario 2: Watchdog - hard-blocks revival when micEnabled: false', () => {
    let revivedCount = 0;
    VS.configure({
      shouldListen: () => true,
      alive: () => false,
      revive: () => { revivedCount++; }
    });

    // First tick registers dead mic timestamp (W.deadSince = now())
    VS._tick();
    assert.strictEqual(revivedCount, 0, 'grace period before revive');

    // Advance clock past 1500ms grace period
    mockTime += 1600;
    VS._tick();
    assert.strictEqual(revivedCount, 1, 'should revive when mic is enabled after grace period');

    // Turn mic OFF
    VS.setMicEnabled(false, 'test off');
    mockTime += 5000;
    VS._tick();
    assert.strictEqual(revivedCount, 1, 'revive must NEVER be called when micEnabled is false');
    assert.strictEqual(VS.state(), 'STOPPED', 'state remains STOPPED');

    // Turn mic ON again
    VS.setMicEnabled(true, 'test on');
    VS._tick(); // sets deadSince
    mockTime += 1600;
    VS._tick();
    assert.strictEqual(revivedCount, 2, 'revive resumes once mic is re-enabled');
  });

  // 3. Deterministic Routing: Exact Rudra24 Secure in <50ms
  await itAsync('Scenario 3: Deterministic Routing - "Open the Rudra24 Secure website" resolves in <50ms', async () => {
    mockWinOpenProxy = { focus() {}, closed: false };
    const t0 = Date.now();
    const res = await Intent.route('Open the Rudra24 Secure website', { source: 'voice' });
    const elapsed = Date.now() - t0;

    assert.strictEqual(res.handled, true, 'must be handled deterministically');
    assert.strictEqual(res.intent, 'OPEN_WEBSITE');
    assert.strictEqual(res.target, 'https://rudra24secure.com');
    assert.strictEqual(res.success, true);
    assert.ok(elapsed < 50, `must resolve in <50ms (took ${elapsed}ms)`);

    // Variations
    const res2 = await Intent.route('Rudra24 Secure website kholo');
    assert.strictEqual(res2.handled, true);
    assert.strictEqual(res2.target, 'https://rudra24secure.com');

    const res3 = await Intent.route('visit rudra24secure');
    assert.strictEqual(res3.handled, true);
    assert.strictEqual(res3.target, 'https://rudra24secure.com');
  });

  // 4. Entity Resolution & Brand Preservation
  it('Scenario 4: Entity Resolution - Exact brand name preserved, never "Rudra24 Security"', () => {
    const r1 = Browser.resolve('Rudra24 Secure');
    assert.strictEqual(r1.resolved, true);
    assert.strictEqual(r1.url, 'https://rudra24secure.com');

    const r2 = Browser.resolve('the rudra24 secure website');
    assert.strictEqual(r2.resolved, true);
    assert.strictEqual(r2.url, 'https://rudra24secure.com');

    const r3 = Browser.resolve('rudra 24 secure');
    assert.strictEqual(r3.resolved, true);
    assert.strictEqual(r3.url, 'https://rudra24secure.com');

    // Never substitute brand name
    assert.notStrictEqual(r1.entity, 'Rudra24 Security');
    assert.notStrictEqual(r1.entity, 'Rudra24 Secure Services');
  });

  // 5. Rudra24 Jobs Resolution
  await itAsync('Scenario 5: Rudra24 Jobs - Resolves to https://rudra24jobs.com', async () => {
    mockWinOpenProxy = { focus() {}, closed: false };
    const res = await Intent.route('Open Rudra24 Jobs');
    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.intent, 'OPEN_WEBSITE');
    assert.strictEqual(res.target, 'https://rudra24jobs.com');
    assert.strictEqual(res.entity, 'Rudra24 Jobs');

    const res2 = await Intent.route('rudra 24 jobs kholo');
    assert.strictEqual(res2.handled, true);
    assert.strictEqual(res2.target, 'https://rudra24jobs.com');
  });

  // 6. Deterministic Apps & Websites
  await itAsync('Scenario 6: Deterministic App & Website Routing - YouTube, Gmail, Notepad, Calculator', async () => {
    mockWinOpenProxy = { focus() {}, closed: false };

    const yt = await Intent.route('Open YouTube');
    assert.strictEqual(yt.handled, true);
    assert.strictEqual(yt.target, 'https://youtube.com');

    const gm = await Intent.route('Open Gmail');
    assert.strictEqual(gm.handled, true);
    assert.strictEqual(gm.target, 'https://mail.google.com');

    const np = await Intent.route('Open Notepad');
    assert.strictEqual(np.handled, true);
    assert.strictEqual(np.intent, 'OPEN_APPLICATION');
    assert.strictEqual(np.entity, 'notepad');

    const paint = await Intent.route('Open Paint');
    assert.strictEqual(paint.handled, true);
    assert.strictEqual(paint.intent, 'OPEN_APPLICATION');
    assert.strictEqual(paint.entity, 'paint');

    const calc = await Intent.route('Open Calculator');
    assert.strictEqual(calc.handled, true);
    assert.strictEqual(calc.intent, 'OPEN_WEBSITE');
    assert.strictEqual(calc.target, 'https://www.google.com/search?q=calculator');
  });

  // 7. System Control Voice Intents (Microphone Controls)
  await itAsync('Scenario 7: System Control - "Turn off microphone" / "Mic band karo" / "Mic chalu karo"', async () => {
    VS.setMicEnabled(true);
    assert.strictEqual(VS.canProcessMic(), true);

    // Mute via English
    const off1 = await Intent.route('Turn off microphone');
    assert.strictEqual(off1.handled, true);
    assert.strictEqual(off1.intent, 'SYSTEM_CONTROL');
    assert.strictEqual(off1.action, 'MIC_OFF');
    assert.strictEqual(VS.canProcessMic(), false);

    // Unmute via Hindi
    const on1 = await Intent.route('Mic chalu karo');
    assert.strictEqual(on1.handled, true);
    assert.strictEqual(on1.intent, 'SYSTEM_CONTROL');
    assert.strictEqual(on1.action, 'MIC_ON');
    assert.strictEqual(VS.canProcessMic(), true);

    // Mute via Hindi
    const off2 = await Intent.route('Mic band karo');
    assert.strictEqual(off2.handled, true);
    assert.strictEqual(off2.action, 'MIC_OFF');
    assert.strictEqual(VS.canProcessMic(), false);

    // Restore
    VS.setMicEnabled(true);
  });

  // 8. BrowserActionManager: Verification & Popup Blocker Handling
  await itAsync('Scenario 8: BrowserActionManager - Honest error when popup blocked', async () => {
    Browser.clearRegistry();
    // Simulate popup blocker (window.open returns null)
    mockWinOpenProxy = null;

    const res = await Browser.openWebsite('https://example.com');
    assert.strictEqual(Browser.lifecycle, 'FAILED');
    assert.strictEqual(res.verified, true);
    assert.strictEqual(res.success, false);
    assert.ok(res.error && res.error.includes('Popup blocker'), 'must honestly report popup blocker');

    // Intent routing surfaces honest error rather than hallucinating success
    const intentRes = await Intent.route('Open YouTube');
    assert.strictEqual(intentRes.handled, true);
    assert.strictEqual(intentRes.success, false);
    assert.ok(intentRes.spoken && intentRes.spoken.includes('Popup blocker'));
  });

  // 9. BrowserActionManager: Tab Reuse
  await itAsync('Scenario 9: BrowserActionManager - Reuses existing open tab instead of duplicate tabs', async () => {
    Browser.clearRegistry();
    let focusCalled = false;
    const fakeTab = {
      closed: false,
      focus: () => { focusCalled = true; }
    };
    mockWinOpenProxy = fakeTab;
    mockWinOpenCalls = 0;

    // First open -> creates new tab
    const res1 = await Browser.openWebsite('https://rudra24secure.com');
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.tabReused, false);
    assert.strictEqual(mockWinOpenCalls, 1);
    assert.strictEqual(focusCalled, false);

    // Second open -> reuses existing tab and focuses it
    const res2 = await Browser.openWebsite('https://rudra24secure.com');
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.tabReused, true);
    assert.strictEqual(mockWinOpenCalls, 1, 'must NOT call window.open again for reused tab');
    assert.strictEqual(focusCalled, true, 'must focus existing window');

    // Closed tab handling: if closed, opens a new tab
    fakeTab.closed = true;
    focusCalled = false;
    const res3 = await Browser.openWebsite('https://rudra24secure.com');
    assert.strictEqual(res3.success, true);
    assert.strictEqual(res3.tabReused, false);
    assert.strictEqual(mockWinOpenCalls, 2, 'calls window.open after previous tab was closed');
  });

  // 10. Voice Output Gate & Silent Mode
  await itAsync('Scenario 10: Voice Output Gate - canSpeak() blocks output when disabled or silent', async () => {
    VS.setVoiceOutputEnabled(false);
    assert.strictEqual(VS.canSpeak(), false);

    const spokenWhileDisabled = await Voice.speak('Testing voice gate');
    assert.strictEqual(spokenWhileDisabled, false, 'speak() must immediately return false when voiceOutputEnabled: false');

    VS.setVoiceOutputEnabled(true);
    assert.strictEqual(VS.canSpeak(), true);

    // Silent mode
    VS.silence(60000);
    assert.strictEqual(VS.isSilent(), true);
    assert.strictEqual(VS.canSpeak(), false);

    const spokenWhileSilent = await Voice.speak('Testing silent mode');
    assert.strictEqual(spokenWhileSilent, false, 'speak() must immediately return false during silent mode');

    VS.unsilence();
    assert.strictEqual(VS.isSilent(), false);
    assert.strictEqual(VS.canSpeak(), true);
  });

  // 11. Layout Throttle in clavis-ear.js
  it('Scenario 11: Layout Throttle - place() respects 500ms measurement cache', () => {
    let queryCalls = 0;
    const origQuery = doc.querySelectorAll;
    doc.querySelectorAll = function (...args) {
      queryCalls++;
      return origQuery.apply(this, args);
    };

    // Caption live updates
    Ear.caption.live('testing partial one');
    const firstCalls = queryCalls;

    // Rapid successive partial updates within 100ms
    Ear.caption.live('testing partial one two');
    Ear.caption.live('testing partial one two three');
    Ear.caption.live('testing partial one two three four');

    assert.strictEqual(queryCalls, firstCalls, 'DOM queries must not run on every partial token within 500ms cache window');
    doc.querySelectorAll = origQuery;
  });

  // 12. Gemini Live Lifecycle & Stop Reason
  await itAsync('Scenario 12: Gemini Live - stop({ reason: "user" }) does not resume legacy listener', async () => {
    // When mic is disabled, start() returns false immediately
    VS.setMicEnabled(false);
    Wake.wake('button');
    const blockedStart = await Live.start({ trigger: 'button' });
    assert.strictEqual(blockedStart, false, 'Live.start must return false when canProcessMic is false');

    // This scenario explicitly selects Gemini; the production default is off.
    store.clavis_gemini_off = '0';
    // When mic is enabled and key exists, starts connecting
    VS.setMicEnabled(true);
    Wake.wake('button');
    assert.strictEqual(Wake.isAwake(), true);
    const started = await Live.start({ trigger: 'button' });
    assert.strictEqual(started, true, 'Live.start should succeed');
    assert.strictEqual(Live.status().phase, 'connecting');

    // Stop with 'user' -> ClavisWake put to sleep, phase off, does NOT resume legacy
    Live.stop({ reason: 'user' });
    assert.strictEqual(Wake.isAwake(), false, 'ClavisWake must be asleep after user stop');
    assert.strictEqual(Live.status().phase, 'off', 'Live phase must be off');
  });

  // Edge Cases
  await itAsync('Scenario 13: Edge Cases - Empty strings, nulls, whitespace, punctuation', async () => {
    const empty1 = await Intent.route('');
    assert.strictEqual(empty1.handled, false);

    const empty2 = await Intent.route('   ');
    assert.strictEqual(empty2.handled, false);

    const empty3 = await Intent.route(null);
    assert.strictEqual(empty3.handled, false);

    const bRes = Browser.resolve('');
    assert.strictEqual(bRes.resolved, false);
    assert.strictEqual(bRes.url, null);

    const trailingPunct = await Intent.route('Open the Rudra24 Secure website!?!   ');
    assert.strictEqual(trailingPunct.handled, true);
    assert.strictEqual(trailingPunct.target, 'https://rudra24secure.com');
  });

  // 14. STOP / CANCEL Intent and Operation Cancellation
  await itAsync('Scenario 14: STOP / CANCEL - Deterministic routing and active operation cancellation', async () => {
    const op = VS.createOperation('turn_test');
    assert.strictEqual(VS.isOperationCurrent(op.id), true);

    const rStop = await Intent.route('Stop.', { source: 'voice' });
    assert.strictEqual(rStop.handled, true);
    assert.strictEqual(rStop.intent, 'STOP');
    assert.strictEqual(VS.isOperationCurrent(op.id), false, 'STOP must abort active operations');
    assert.strictEqual(VS.state(), 'STOPPED');

    const op2 = VS.createOperation('turn_test2');
    const rCancel = await Intent.route('Cancel.', { source: 'voice' });
    assert.strictEqual(rCancel.handled, true);
    assert.strictEqual(rCancel.intent, 'CANCEL');
    assert.strictEqual(VS.isOperationCurrent(op2.id), false, 'CANCEL must abort active operations');

    // Variations
    const rHush = await Intent.route('chup ho jao', { source: 'voice' });
    assert.strictEqual(rHush.handled, true);
    assert.strictEqual(rHush.intent, 'STOP');

    const rRuko = await Intent.route('ruko ruko', { source: 'voice' });
    assert.strictEqual(rRuko.handled, true);
    assert.strictEqual(rRuko.intent, 'STOP');

    // Reset state
    VS.setMicEnabled(true);
    VS.rest('test reset');
  });

  // 15. Web Search Intent
  await itAsync('Scenario 15: Web Search - Deterministic routing for Google search', async () => {
    mockWinOpenProxy = { focus() {}, closed: false };
    const rSearch = await Intent.route('Search google for best housekeeping agency in gurugram', { source: 'voice' });
    assert.strictEqual(rSearch.handled, true);
    assert.strictEqual(rSearch.intent, 'SEARCH_WEB');
    assert.strictEqual(rSearch.target.includes('google.com/search?q='), true);
    assert.strictEqual(rSearch.target.includes('best+housekeeping+agency+in+gurugram') || rSearch.target.includes('best%20housekeeping%20agency%20in%20gurugram'), true);
  });

  // 16. Barge-in & Audio Cleanup Gating
  await itAsync('Scenario 16: Barge-In - Gated on canProcessMic and registered with audioCleanups', async () => {
    VS.setMicEnabled(false, 'test gate');
    assert.strictEqual(VS.canProcessMic(), false);

    let barged = false;
    const armedWhileOff = await BargeIn.arm(() => { barged = true; });
    assert.strictEqual(armedWhileOff, false, 'arm() must return false immediately when mic is disabled');
    assert.strictEqual(BargeIn._isArmed(), false);

    // Re-enable mic and arm
    VS.setMicEnabled(true, 'test enable');
    assert.strictEqual(VS.canProcessMic(), true);
    const armedWhileOn = await BargeIn.arm(() => { barged = true; });
    assert.strictEqual(armedWhileOn, true, 'arm() should succeed when mic is enabled');
    assert.strictEqual(BargeIn._isArmed(), true);

    // Triggering setMicEnabled(false) must invoke registered audio cleanups, disarming and cleaning up BargeIn
    VS.setMicEnabled(false, 'test cleanup');
    assert.strictEqual(BargeIn._isArmed(), false, 'BargeIn must be disarmed on mic disable');

    VS.setMicEnabled(true);
  });

  // 17. Rapid Mic Toggling (ON -> OFF -> ON -> OFF)
  it('Scenario 17: Rapid Mic Toggling - Stability under repeated ON/OFF switching', () => {
    Wake.wake('button');
    for (let i = 0; i < 20; i++) {
      VS.setMicEnabled(false, `toggle off ${i}`);
      assert.strictEqual(VS.canProcessMic(), false);
      assert.strictEqual(VS.state(), 'STOPPED');

      VS.setMicEnabled(true, `toggle on ${i}`);
      assert.strictEqual(VS.canProcessMic(), true);
      assert.strictEqual(VS.state(), 'LISTENING');
    }
  });

  // 18. Race Condition / Superseded Turn Protection (Command A vs Command B)
  it('Scenario 18: Race Condition Protection - Operation B supersedes and aborts Operation A', () => {
    const opA = VS.createOperation('turn_A', { query: 'slow command' });
    assert.strictEqual(VS.isOperationCurrent(opA.id), true);
    assert.strictEqual(opA.signal.aborted, false);

    // Immediately create Operation B
    const opB = VS.createOperation('turn_B', { query: 'fast command' });
    assert.strictEqual(opA.signal.aborted, true, 'opA must be aborted when opB is created');
    assert.strictEqual(VS.isOperationCurrent(opA.id), false, 'opA is no longer current');
    assert.strictEqual(VS.isOperationCurrent(opB.id), true, 'opB is currently active');
    assert.strictEqual(opB.signal.aborted, false);
  });

  // 19. Spoken Feedback Past Tense Verification
  await itAsync('Scenario 19: Honest Feedback - Past-tense confirmed status on successful actions', async () => {
    mockWinOpenProxy = { focus() {}, closed: false };
    const r1 = await Intent.route('Open Rudra24 Secure website', { source: 'voice' });
    assert.strictEqual(r1.handled, true);
    assert.strictEqual(r1.spoken, 'Opened Rudra24 Secure.');

    const r2 = await Intent.route('Open Rudra24 Jobs website', { source: 'voice' });
    assert.strictEqual(r2.handled, true);
    assert.strictEqual(r2.spoken, 'Opened Rudra24 Jobs.');
  });

  await itAsync('Hybrid voice uses Groq once, preserves recent context and accepts cancellation', async () => {
    const hooks = win.__liveTest;
    const oldDirect = win.ClavisDirect;
    let calls = 0;
    win.ClavisDirect = {providerConfigured:()=> true, keyFor:()=> '', complete:async(payload, signal)=>{
      calls++;
      assert.strictEqual(payload.model, 'groq/openai/gpt-oss-20b');
      assert.strictEqual(payload.messages.length, 3);
      assert.ok(signal instanceof AbortSignal || signal.aborted === false);
      payload.onToken('answer');
      return {choices:[{message:{content:'A concise answer'}}],model:'openai/gpt-oss-20b'};
    }};
    hooks.S.brainHistory = [{role:'assistant', content:'previous topic'}];
    const setup = hooks.buildSetup('gemini-3.8-live').setup;
    assert.strictEqual(setup.contextWindowCompression.triggerTokens, 24000);
    assert.ok(setup.tools.some(t=>t.functionDeclarations?.some(d=>d.name==='consult_brain')));
    const out = await hooks.runTool('consult_brain', {question:'Explain this'}, new AbortController().signal);
    assert.strictEqual(out.answer, 'A concise answer');
    assert.strictEqual(calls, 1);
    const controller = new AbortController();
    hooks.S.toolRequests.set('cancel-me',controller);
    hooks.handleMessage({toolCallCancellation:{ids:['cancel-me']}});
    assert.strictEqual(controller.signal.aborted,true);
    hooks.S.toolRequests.clear();
    win.ClavisDirect = oldDirect;
    assert.strictEqual(Live._selfTest(),true);
  });

  console.log(`\nAll ${passedTests}/${totalTests} pipeline tests PASSED successfully!\n`);
  process.exit(0);
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
