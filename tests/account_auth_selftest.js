'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const location = {
    protocol: 'http:',
    hostname: 'localhost',
    port: '3000',
    origin: 'http://localhost:3000'
  };
  const calls = [];
  let configAttempts = 0;
  const session = { access_token: 'test-token', user: { id: 'verified-user-id', email: 'owner@example.com' } };
  const client = {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session } }),
      signInWithPassword: async credentials => {
        calls.push(['signIn', credentials]);
        return { data: { session }, error: null };
      },
      signUp: async credentials => {
        calls.push(['signUp', credentials]);
        return { data: { session: null }, error: null };
      },
      signOut: async () => ({ error: null })
    }
  };
  const window = {
    location,
    SKYLARK_CONFIG: { BACKEND_URL: 'http://localhost:8000' },
    supabase: { createClient: (_url, _key, options) => {
      assert.equal(options.auth.persistSession, true);
      assert.equal(options.auth.autoRefreshToken, true);
      calls.push(['createClient']);
      return client;
    } },
    AntigravityAuth: { handleSupabaseSession: next => calls.push(['session', next?.user?.id || null]) }
  };
  const authContext = {
    window, location, console,
    setTimeout: resolve => resolve(),
    fetch: async () => {
      configAttempts += 1;
      if (configAttempts < 3) throw new Error('backend starting');
      return { ok: true, json: async () => ({
        supabase_url: 'https://example.supabase.co',
        supabase_publishable_key: 'public-test-key'
      }) };
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'supabase-auth.js'), 'utf8'), authContext);
  const [ready, simultaneous] = await Promise.all([window.SupabaseAuth.init(), window.SupabaseAuth.init()]);
  assert.equal(ready.user.id, 'verified-user-id', 'localhost must restore a verified session');
  assert.equal(simultaneous.success, true);
  assert.equal(configAttempts, 3, 'auth should wait for a starting backend without duplicate clients');
  assert.equal(calls.filter(([name]) => name === 'createClient').length, 1);
  assert.equal((await window.SupabaseAuth.signInWithPassword('owner@example.com', 'password123')).success, true);
  assert.equal(calls.find(([name]) => name === 'signIn')[1].email, 'owner@example.com');
  assert.equal((await window.SupabaseAuth.signUp('new@example.com', 'password123')).needsVerification, true);
  client.auth.signInWithPassword = async () => { throw new Error('Failed to fetch'); };
  const offlineSignIn = await window.SupabaseAuth.signInWithPassword('owner@example.com', 'password123');
  assert.equal(offlineSignIn.success, false);
  assert.match(offlineSignIn.error, /Supabase project/i);

  const storage = new Map([['skylark_active_email', 'attacker@example.com']]);
  const writes = [];
  let failWrites = false;
  let reads = 0;
  window.SupabaseAuth.getClient = () => ({ from: () => ({
    upsert: async row => { writes.push(row); return { error: failWrites ? new Error('offline') : null }; },
    select: () => { reads += 1; return { eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }; }
  }) });
  window.MemoryEngine = {
    getAllLeads: async () => [{ id: 'lead-1' }],
    getAllCandidates: async () => [],
    getAllJarvisFacts: async () => []
  };
  window.UserProfileManager = { getProfile: () => ({ email: 'owner@example.com' }) };
  window.addEventListener = () => {};
  const cloudContext = {
    window, location, console,
    document: { querySelectorAll: () => [] },
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    setInterval: () => 1,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'cloud-sync.js'), 'utf8'), cloudContext);
  assert.equal(window.CloudSyncManager.getActiveEmail(), 'owner@example.com');
  assert.equal(window.CloudSyncManager.setActiveEmail('attacker@example.com'), '');
  assert.equal(await window.CloudSyncManager.pushNow(), true);
  assert.equal(writes[0].user_id, 'verified-user-id', 'cloud row must belong to verified user ID');
  assert.equal(writes[0].payload.leads[0].id, 'lead-1');
  failWrites = true;
  assert.equal(await window.CloudSyncManager.pushNow(), false);
  assert.equal(storage.get('skylark_pending_cloud_owner@example.com'), '1');
  await window.CloudSyncManager.pullLatest();
  assert.equal(reads, 0, 'failed cloud save must not overwrite unsaved local data');
  console.log('Account auth self-test passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
