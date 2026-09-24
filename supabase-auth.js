/**
 * Clavis Supabase Auth adapter.
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

  function notifyAuthState(nextSession) {
    session = nextSession || null;
    user = session?.user || null;
    accessToken = session?.access_token || '';
    if (window.AntigravityAuth && typeof window.AntigravityAuth.handleSupabaseSession === 'function') {
      window.AntigravityAuth.handleSupabaseSession(session);
    }
  }

  async function init() {
    if (initialized) return { success: true, client, session, user };
    if (window.CLAVIS_LOCAL_MODE || location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      initialized = true;
      notifyAuthState(null);
      return { success: true, client: null, session: null, user: null, localMode: true };
    }
    if (!window.supabase?.createClient) {
      return { success: false, error: 'Supabase client could not load.' };
    }
    try {
      const response = await fetch(`${API_BASE}/public-config`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Public auth configuration unavailable');
      config = await response.json();
      if (!config.supabase_url || !config.supabase_publishable_key) {
        return { success: false, error: 'Supabase Auth is not configured on the backend.' };
      }
      client = window.supabase.createClient(config.supabase_url, config.supabase_publishable_key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      authSubscription = client.auth.onAuthStateChange((_event, nextSession) => {
        notifyAuthState(nextSession);
      });
      const result = await client.auth.getSession();
      notifyAuthState(result?.data?.session || null);
      initialized = true;
      return { success: true, client, session, user };
    } catch (err) {
      if (!isHttpOrigin) {
        return {
          success: false,
          error: 'Clavis was opened as a local file. Close this tab and start it with Start-Clavis.bat (http://localhost:3000).'
        };
      }
      const detail = (err && err.message) || 'network error';
      return {
        success: false,
        error: `Auth service unreachable at ${API_BASE} (${detail}). Is the Clavis backend running on port 8000?`
      };
    }
  }

  async function signInWithGoogle() {
    const ready = await init();
    if (!ready.success || !client) return ready;
    const redirectTo = config.supabase_redirect_url || `${window.location.origin}/`;
    const result = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    });
    if (result.error) return { success: false, error: result.error.message || 'Google sign-in failed.' };
    return { success: true };
  }

  async function signOut() {
    if (!client) return { success: true };
    const result = await client.auth.signOut();
    if (result.error) return { success: false, error: result.error.message || 'Sign out failed.' };
    notifyAuthState(null);
    return { success: true };
  }

  return {
    init,
    signInWithGoogle,
    signOut,
    getSession: () => session,
    getUser: () => user,
    getAccessToken: () => accessToken,
    isInitialized: () => initialized,
    dispose: () => authSubscription?.data?.subscription?.unsubscribe?.()
  };
})();
