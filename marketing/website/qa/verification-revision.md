# Film and Claude-inspired design revision — 9 October 2026

## Content and references

Inspected the supplied film through frame sheets across its full 211.7-second timeline. It presents the workspace, lead search, company details/maps, voice calling, WhatsApp, CRM, assistant and data hub. Used its sales-team/AI-partner story in the hero and feature cards. No sample metrics or delivery guarantees became website traction claims.

Visited https://claude.com/ live; it redirected to sign-in in this browser. Inspected its visible public https://claude.com/product/overview page instead: warm-white rgb(250,249,245), serif display typography and rounded video treatments. Used the user's Claude article-card screenshot for flat warm-neutral surfaces, restrained borders and hierarchy.

Visited https://www.pinterest.com/pin/minimalist-typography-for-editorial-landing-page--702913454372533688/ . Public title/description were available; a login overlay limited image inspection. No login or copying of third-party assets occurred.

## Verified

- Brand text exactly Rudra24 AI on all eight pages. Rendered logos 48px desktop, 40px narrow mobile; 128px source.
- Background #FAF9F5, white surfaces, dark ink, restrained olive details and flat rounded cards. No gradient declaration remains in either stylesheet; live computed-style scan found zero gradient backgrounds.
- All eight pages checked at exact 1440, 768, 390 and 360 CSS pixels: 32 checks, no horizontal overflow.
- Workflow/keyboard tabs, outreach variants, CRM moves, candidate filters, use-case tabs, menu/Escape/focus and local WhatsApp enquiry preparation pass after redesign.
- Real video playback: duration 211.7, readyState 4, no decode error; native pause works. Cold-start chapter seeks to 142 seconds, later jump to 90 seconds.
- Fixed the old preview server's missing ranges, which produced seekable [0,0] and reset jumps to zero. New website-only localhost server returns 206 for prefix/suffix requests and 416 for invalid ranges; actual-response tests pass.
- Flat idle play button works. Native controls appear on playback/rejection and remain in static no-JS HTML.
- Intentionally blocked media requests to exercise load failure. Controls, external MP4 link and clear error text appear. Blocking/cache emulation were removed and page reloaded afterward.
- Source errors are handled separately because they do not bubble to the video. Obsolete aborted play requests do not overwrite current playback state.
- No-JS: native controls available, enhancement overlay hidden, essential explanations visible.
- Reduced motion: hero animation none, reveal opacity 1, native auto scrolling. Existing keyboard/form fallbacks remain.
- Static asset/link/fragment/brand/gradient/film checks and JS syntax pass. Independent source review identified cold-play, fallback-link and rejected-play cases; addressed and retested.

## Boundaries

Desktop original preserved. Site copy remuxed without re-encoding, with moov before mdat. Supplied captions and visual styling remain intact; CSS rounds the frame without cropping the film.

Film approximately 28MB; no autoplay and preload=none with a local poster. Intentional failed-request console messages are test artifacts. No deployment, live scraping, paid call or message delivery occurred. Demonstrations do not prove a customer's live provider setup.
