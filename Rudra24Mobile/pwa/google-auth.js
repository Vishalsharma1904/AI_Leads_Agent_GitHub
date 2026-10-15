// Supabase Auth uses PKCE. Only public project configuration belongs in this app.
const PENDING = 'rudra-mobile-google-pkce';
const MAX_AGE = 10 * 60 * 1000;
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');

export function clearGoogleLogin(storage = localStorage) { storage.removeItem(PENDING); }

export async function googleLoginURL(config, currentURL, storage = localStorage) {
  const current = new URL(currentURL);
  if (current.protocol !== 'https:' && !(current.protocol === 'http:' && ['localhost','127.0.0.1'].includes(current.hostname))) {
    throw Error('Google sign-in ke liye app ka HTTPS link kholiye.');
  }
  const redirect = current.origin + current.pathname;
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const url = new URL('/auth/v1/authorize', config.supabase_url);
  url.search = new URLSearchParams({provider:'google',redirect_to:redirect,code_challenge:challenge,code_challenge_method:'s256',prompt:'select_account'});
  storage.setItem(PENDING, JSON.stringify({verifier,redirect,project:config.supabase_url,created:Date.now()}));
  return url.href;
}

export async function finishGoogleLogin(config, currentURL, auth, storage = localStorage) {
  const current = new URL(currentURL);
  const params = current.searchParams;
  const fragment = new URLSearchParams(current.hash.slice(1));
  if (params.has('error') || fragment.has('error')) {
    clearGoogleLogin(storage);
    throw Error('Google sign-in complete nahi hua. Dobara Continue with Google dabaiye.');
  }
  if (!params.has('code')) return null;
  let pending;
  try { pending = JSON.parse(storage.getItem(PENDING)); } catch { /* invalid storage */ }
  clearGoogleLogin(storage); // one attempt; stale or replayed callbacks cannot restore an account
  if (!pending || pending.project !== config.supabase_url || pending.redirect !== current.origin + current.pathname ||
      typeof pending.verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pending.verifier) ||
      !Number.isFinite(pending.created) || Date.now() - pending.created > MAX_AGE || pending.created > Date.now()) {
    throw Error('Google sign-in expired ya doosre browser mein khula. Isi app se dobara sign in kijiye.');
  }
  const session = await auth('token?grant_type=pkce',{auth_code:params.get('code'),code_verifier:pending.verifier});
  if (!session.access_token || !session.refresh_token || !session.user?.id) throw Error('Google session unavailable. Dobara sign in kijiye.');
  // Drop provider tokens: mobile only needs the Supabase session, not Google API access.
  return {access_token:session.access_token,refresh_token:session.refresh_token,expires_in:session.expires_in,user:session.user};
}

export function cleanAuthURL(currentURL) {
  const current = new URL(currentURL);
  ['code','error','error_code','error_description'].forEach(key=>current.searchParams.delete(key));
  if (/access_token=|refresh_token=|error=/.test(current.hash)) current.hash = '';
  return current.pathname + current.search + current.hash;
}
