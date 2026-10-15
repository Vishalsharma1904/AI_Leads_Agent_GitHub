'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');

function fixture({ rows = [], complete, history } = {}) {
  let owner = 'owner-a';
  const storage = new Map([['skylark_jarvis_current_conv:owner-a', 'active']]);
  const requests = [], invoked = [], saved = [], listeners = new Map();
  const window = {
    addEventListener: (name, fn) => listeners.set(name, fn), dispatchEvent() {},
    SupabaseAuth: { getUser: () => ({ id: owner }), getAccessToken: () => 'fixture-token' },
    MemoryEngine: {
      getJarvisHistory: history || (async () => rows), getAllJarvisMessages: async () => rows,
      getAllJarvisFacts: async () => [], addJarvisMessage: async message => saved.push([owner, message]),
    },
    JarvisSkills: {
      list: () => [{ name: 'get_lead_stats', description: 'Read saved lead counts', params: {} },
        { name: 'generate_leads', description: 'Start a new search', params: { cities: 'Array of city names' } }],
      describeForPrompt: () => '- get_lead_stats(): Read saved lead counts\n- generate_leads(cities): Start a new search',
      invoke: async (name, params) => { invoked.push([name, params]); return { success: true, result: { total: 4 } }; },
    },
    NexusAIChat: { complete: async (payload, signal, onToken) => {
      requests.push(payload);
      return complete ? complete(payload, signal, onToken, requests.length) : { choices: [{ message: { content: 'A clear answer.' } }] };
    } },
    ClavisRequestIntent: { classify: text => ({ answerOnly: /saved leads|question/.test(text) }), capabilityAnswer: () => '' },
  };
  const context = vm.createContext({ window, console, Date, AbortController, CustomEvent: class {},
    document: { readyState: 'loading', addEventListener() {} }, setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } });
  vm.runInContext(fs.readFileSync('jarvis.js', 'utf8'), context);
  return { window, requests, invoked, saved, storage,
    ask: (text, delta, extra = {}) => window.JarvisEngine.sendMessage(text, null, () => {}, delta, { source: 'voice', ...extra }),
    switchOwner: value => { owner = value; listeners.get('rudra:auth-state')?.(); },
  };
}
const tool = (name, args = '{}', id = 'call-1') => ({ id, type: 'function', function: { name, arguments: args } });
const message = (content, tool_calls) => ({ choices: [{ message: { content, ...(tool_calls ? { tool_calls } : {}) } }] });
const tests = [
  ['reload restores only the selected conversation before the model call', async () => {
    const h = fixture({ rows: [
      { role: 'user', text: 'My active plan is solar clients in Noida.', conv: 'active', timestamp: 1 },
      { role: 'assistant', text: 'We will focus on solar clients.', conv: 'active', timestamp: 2 },
      { role: 'user', text: 'Other conversation secret.', conv: 'other', timestamp: 3 },
    ] });
    await h.ask('Continue that plan.');
    const body = JSON.stringify(h.requests[0].messages);
    assert.match(body, /solar clients in Noida/);
    assert.ok(!body.includes('Other conversation secret'));
    assert.equal(h.window.JarvisEngine.getCurrentConvId(), 'active');
    await h.window.JarvisEngine.startNewConversation();
    await h.ask('Start something new.');
    assert.ok(!JSON.stringify(h.requests.at(-1).messages).includes('solar clients in Noida'));
  }],
  ['native tool calls execute once and return the standard tool result envelope', async () => {
    const h = fixture({ complete: (payload, signal, delta, turn) => turn === 1
      ? message('|||TOOL:{"skill":"get_lead_stats","params":{}}|||', [tool('get_lead_stats')])
      : message('You have four saved leads.') });
    const response = await h.ask('How many saved leads do I have?');
    assert.equal(h.invoked.length, 1);
    assert.equal(h.invoked[0][0], 'get_lead_stats');
    assert.equal(response.text, 'You have four saved leads.');
    assert.equal(h.requests[0].tools[0].function.name, 'get_lead_stats');
    assert.equal(h.requests[0].tools.length, 1, 'information turns expose only read-only registered tools');
    const result = h.requests[1].messages.find(row => row.role === 'tool');
    assert.equal(result.tool_call_id, 'call-1');
    assert.equal(JSON.parse(result.content).result.total, 4);
    assert.equal(h.requests[1].messages.find(row => row.tool_calls)?.tool_calls[0].id, 'call-1');
  }],
  ['native mutating calls remain forbidden in question mode', async () => {
    const h = fixture({ complete: (payload, signal, delta, turn) => turn === 1
      ? message('', [tool('generate_leads', '{"cities":["Noida"]}')]) : message('That is an information question.') });
    await h.ask('A question about finding clients.');
    assert.equal(h.invoked.length, 0);
    assert.equal(JSON.parse(h.requests[1].messages.find(row => row.role === 'tool').content).success, false);
  }],
  ['malformed native arguments never become an empty-parameter paid action', async () => {
    const h = fixture({ complete: () => message('', [tool('generate_leads', '{broken')]) });
    await assert.rejects(h.ask('Find new leads.'), error => error.code === 'AI_INVALID_RESPONSE');
    assert.equal(h.invoked.length, 0);
    assert.equal(h.requests.length, 1, 'malformed action is not blindly retried');
  }],
  ['duplicate native call IDs are rejected before any action runs', async () => {
    const h = fixture({ complete: () => message('', [
      tool('generate_leads', '{"cities":["Noida"]}'), tool('generate_leads', '{"cities":["Noida"]}'),
    ]) });
    await assert.rejects(h.ask('Find new leads.'), error => error.code === 'AI_INVALID_RESPONSE');
    assert.equal(h.invoked.length, 0, 'a malformed batch cannot start its first paid operation');
  }],
  ['a nonarray native tool envelope is rejected as a provider response error', async () => {
    const h = fixture({ complete: () => message('', { length: 1, 0: tool('generate_leads') }) });
    await assert.rejects(h.ask('Find new leads.'), error => error.code === 'AI_INVALID_RESPONSE');
    assert.equal(h.invoked.length, 0);
  }],
  ['native PC schemas preserve boolean flags and optional argument lists', async () => {
    const h = fixture();
    h.window.JarvisSkills.list = () => [
      { name: 'pc_click', params: { double: 'true for double-click (optional)' } },
      { name: 'pc_run_python_script', params: { args: 'optional list of command-line arguments' } },
    ];
    await h.ask('Single click the requested button.');
    const tools = h.requests[0].tools.map(item => item.function);
    assert.equal(tools.find(item => item.name === 'pc_click').parameters.properties.double.type, 'boolean');
    assert.equal(tools.find(item => item.name === 'pc_run_python_script').parameters.properties.args.type, 'array');
  }],
  ['late history from a prior account cannot enter the new account context', async () => {
    let release;
    const h = fixture({ history: () => new Promise(resolve => { release = resolve; }) });
    const pending = h.ask('Continue my private plan.');
    await Promise.resolve(); await Promise.resolve();
    h.switchOwner('owner-b');
    release([{ role: 'user', text: 'Private owner A plan', conv: 'active' }]);
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.equal(h.requests.length, 0);
    assert.equal(h.saved.length, 0);
  }],
  ['saved-statistics voice answers stream the first sentence before completion', async () => {
    const spoken = [];
    const h = fixture({ complete: async (payload, signal, delta) => {
      assert.equal(typeof delta, 'function');
      await delta('There are four saved leads. ');
      assert.equal(spoken[0].trim(), 'There are four saved leads.');
      await delta('Two are in Noida.');
      return { ...message('There are four saved leads. Two are in Noida.'), streamed: true };
    } });
    const result = await h.ask('How many saved leads do I have?', text => spoken.push(text));
    assert.equal(spoken.join('').trim(), result.text);
    assert.match(h.requests[0].messages[0].content, /no markdown/i);
  }],
];
(async () => {
  let failures = 0;
  for (const [name, run] of tests) try { await run(); console.log('PASS ' + name); }
  catch (error) { failures++; console.error('FAIL ' + name + '\n' + error.stack); }
  if (failures) process.exitCode = 1;
})();
