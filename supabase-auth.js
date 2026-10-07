/**
 * Rudra24 AI Supabase Auth adapter.
 *
 * The static frontend receives only public Supabase configuration from the
 * FastAPI public-config endpoint. Supabase owns session persistence and token
 * refresh; this module never writes access or refresh tokens to storage.
 */
'use strict';

window.SupabaseAuth = (() => {
  const BACKEND_URL = (window.SKYLARK_CONFIG && window.SKYLARK_CONFIG.BACKEND_URL) || 'http://localhost:8000';
  const isHttpOrigin = window.location.protocol === 'http:' || window.location.protocol === 'https:';
  const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  // Same-origin /api only when the backend itself is serving this page. Static server on :3000,
  // or any non-http origin (file://), must call the backend on its own URL.
  const servedByBackend = isHttpOrigin && (!isLocalDev || window.location.port === '8000');
  const API_BASE = servedByBackend ? '/api' : `${BACKEND_URL.replace(/\/+$/, '')}/api`;
  let client = null;
  let session = null;
  let user = null;
  let accessToken = '';
  let initialized = false;
  let authSubscription = null;
  let config = null;
  let recoveryMode = false;
  let initPromise = null;

  function notifyAuthState(nextSession) {
    const previousIdentity = user?.id || '';
    session = nextSession || null;
    user = session?.user || null;
    accessToken = session?.access_token || '';
    if (previousIdentity !== (user?.id || '')) window.dispatchEvent(new CustomEvent('rudra:auth-state', {
      detail: { signedIn: !!accessToken, userId: user?.id || '' }
    }));
    if (!recoveryMode && window.AntigravityAuth && typeof window.AntigravityAuth.handleSupabaseSession === 'function') {
      window.AntigravityAuth.handleSupabaseSession(session);
    }
  }

  async function initialize() {
    if (initialized && client) return { success: true, client, session, user };
    if (!isHttpOrigin) {
      return { success: false, error: 'Open Rudra24 AI through its installed app to sign in securely.' };
    }
    if (!window.supabase?.createClient) {
      return { success: false, error: 'Supabase client could not load.' };
    }
    if (!config) {
      for (let attempt = 0; attempt < 15 && !config; attempt++) {
        try {
          const response = await fetch(`${API_BASE}/public-config`, { headers: { Accept: 'application/json' } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          config = await response.json();
        } catch (_) {
          if (attempt < 14) await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      if (!config) {
        // "Check your internet connection" was a guess, and usually the wrong
        // one: by far the commonest cause is that the backend simply is not
        // running. Name the address we actually tried and what to do about it,
        // so this costs nobody fifteen minutes.
        const target = API_BASE.replace(/\/api$/, '') || window.location.origin;
        const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$|\/)/i.test(target);
        return {
          success: false,
          error: isLocal
            ? `Backend ${target} par chal nahi raha, isliye sign-in nahi ho sakta. `
              + 'App folder me "npm run backend" chalaiye (ya Start-Clavis), phir Retry dabaiye.'
            : `Rudra24 AI service (${target}) se baat nahi ho paayi. `
              + 'Internet check kijiye — agar internet theek hai to service abhi down hai.',
          code: 'BACKEND_UNREACHABLE',
          target
        };
      }
    }
    if (!config.supabase_url || !config.supabase_publishable_key) {
      return { success: false, error: 'Supabase Auth is not configured on the backend.' };
    }
    try {
      if (!client) {
        client = window.supabase.createClient(config.supabase_url, config.supabase_publishable_key, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
        });
        authSubscription = client.auth.onAuthStateChange((event, nextSession) => {
          if (event === 'PASSWORD_RECOVERY') recoveryMode = true;
          if (event === 'SIGNED_OUT') recoveryMode = false;
          notifyAuthState(nextSession);
          if (event === 'PASSWORD_RECOVERY') window.AntigravityAuth?.showPasswordRecovery?.();
        });
      }
      const result = await client.auth.getSession();
      if (result.error) throw result.error;
      notifyAuthState(result?.data?.session || null);
      initialized = true;
      return { success: true, client, session, user };
    } catch (err) {
      return {
        success: false,
        error: `Supabase sign-in is unavailable (${err?.message || 'network error'}). Check that the configured Supabase project is active.`
      };
    }
  }

  function init() {
    if (initialized && client) return Promise.resolve({ success: true, client, session, user });
    if (!initPromise) initPromise = initialize().finally(() => { initPromise = null; });
    return initPromise;
  }

  function authFailure(error, fallback) {
    const message = error?.message || fallback;
    return {
      success: false,
      error: /failed to fetch|fetch failed|network/i.test(message)
        ? 'Cannot reach the configured Supabase project. Check that it is active in the Supabase dashboard.'
        : message
    };
  }

  async function signInWithGoogle() {
    const ready = await init();
    if (!ready.success || !client) return ready;
    const redirectTo = config?.supabase_redirect_url || `${window.location.origin}/`;
    try {
      const result = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo }
      });
      return result.error ? authFailure(result.error, 'Google sign-in failed.') : { success: true };
    } catch (error) { return authFailure(error, 'Google sign-in failed.'); }
  }

  async function signOut() {
    if (!client) return { success: true };
    const result = await client.auth.signOut();
    if (result.error) return { success: false, error: result.error.message || 'Sign out failed.' };
    notifyAuthState(null);
    return { success: true };
  }

  async function signInWithPassword(email, password) {
    const ready = await init();
    if (!ready.success) return ready;
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      return error ? authFailure(error, 'Sign-in failed.') : { success: true, session: data.session };
    } catch (error) { return authFailure(error, 'Sign-in failed.'); }
  }

  async function signUp(email, password, profile = {}) {
    const ready = await init();
    if (!ready.success) return ready;
    const redirectTo = `${window.location.origin}/`;
    try {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo, data: profile }
      });
      return error ? authFailure(error, 'Sign-up failed.') : {
        success: true,
        needsVerification: !data.session,
        session: data.session
      };
    } catch (error) { return authFailure(error, 'Sign-up failed.'); }
  }

  async function resetPassword(email) {
    const ready = await init();
    if (!ready.success) return ready;
    const redirectTo = `${window.location.origin}/`;
    try {
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      return error ? authFailure(error, 'Password reset failed.') : { success: true };
    } catch (error) { return authFailure(error, 'Password reset failed.'); }
  }

  async function updatePassword(password) {
    if (!client) return { success: false, error: 'Sign-in service is unavailable.' };
    const { error } = await client.auth.updateUser({ password });
    if (error) return { success: false, error: error.message };
    await client.auth.signOut();
    recoveryMode = false;
    notifyAuthState(null);
    return { success: true };
  }

  return {
    init,
    signInWithGoogle,
    signInWithPassword,
    signUp,
    resetPassword,
    updatePassword,
    signOut,
    getClient: () => client,
    getSession: () => session,
    getUser: () => user,
    getAccessToken: () => accessToken,
    isRecoveryMode: () => recoveryMode,
    isInitialized: () => initialized,
    dispose: () => authSubscription?.data?.subscription?.unsubscribe?.()
  };
})();
