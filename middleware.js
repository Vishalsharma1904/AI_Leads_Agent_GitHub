/* One door in front of the whole demo.
 * Set DEMO_PASSWORD in the Vercel project's Environment Variables and the site
 * asks for it; leave it unset and the site is open. DEMO_USER defaults to
 * "demo". Runs on Vercel's Edge runtime, so it also works on the free plan —
 * Vercel's own Password Protection is a paid feature. */
export const config = { matcher: ['/((?!_vercel/).*)'] };

const same = (a, b) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export default function middleware(request) {
  // The production landing/sign-in page is public. Supabase and the backend
  // enforce account access; this old demo gate applies only to previews.
  if (process.env.VERCEL_ENV === 'production') return;
  const password = process.env.DEMO_PASSWORD;
  if (!password) return;                       // no password set → open site
  const user = process.env.DEMO_USER || 'demo';
  const header = request.headers.get('authorization') || '';
  if (header.startsWith('Basic ')) {
    try {
      const [u, ...rest] = atob(header.slice(6)).split(':');
      if (same(u, user) && same(rest.join(':'), password)) return;
    } catch (_) { /* malformed header → fall through to the prompt */ }
  }
  return new Response('Rudra24 AI — password required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Rudra24 AI", charset="UTF-8"',
      'Cache-Control': 'no-store',
    },
  });
}
