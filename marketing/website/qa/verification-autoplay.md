# Autoplay, app theme and feature hover revision

## Implemented

- Bare right-side hero video, original 16:9 ratio, rounded video edges, no outer player card, border or CSS shadow.
- Muted looping autoplay. Hover attempts audio; leave and scroll mute while playback continues. A browser-policy rejection restores muted playback and exposes “Enable hover sound”. Touch and keyboard can explicitly enable sound. Pause remains available.
- Five silent, ten-second, 1280×720/30fps excerpts; 2.25MB combined. One shared hover player loads a clip on demand and pauses on leave, scroll, Escape, resize or hidden tab. Native feature-page players provide a touch/keyboard alternative.
- App Flow preset copied from `clavis-appearance.js`: #034F46 sidebar/button, #FFFFEB canvas, Figtree + EB Garamond. Actual app icon paths copied from `clavis-icons.js`. Square source logo resized proportionally to 128px; original brand source preserved.
- Reveal animation combines small directional movement, 3px-to-zero blur and opacity. Reduced motion shows content immediately and starts the hero with a poster. Animation overflow is clipped at the main boundary; ordinary native scrolling remains.
- Footer hover/focus dims peer links. Dimmed text #706D63 remains readable against the page. White/forest button contrast is 9.50:1.

## Verification

Static checks pass for all eight pages, assets, links/fragments, IDs, explicit button types, brand case, palette, gradient absence, fictional demo disclosure and API isolation. Both JavaScript files pass `node --check`.

Browser checks covered all eight pages at 360px, 390px, approximately 768px and 1440px. A transient reveal overflow on the outreach page was contained; the final narrow layouts do not overflow. Video display ratio remains 1.778.

Observed: main film plays muted automatically; a first hover was rejected by the browser, restored muted playback and showed the sound fallback. After a trusted enable click, hover yielded muted=false/paused=false; pointer leave yielded muted=true/paused=false. After scroll, time advanced from 45.98s to 48.45s with muted=true/paused=false. Pause and resume worked. Trusted Enter activation also enabled audio.

Lead hover displayed the correct muted excerpt, inside the viewport. Pointer leave hid it and paused the decoder. CRM sample moved to Contacted. Dropdown Escape closed and restored focus. Mobile menu Escape worked. Footer peers changed color while the hovered link remained strong.

Reduced-motion: hero paused, autoplay disabled, all reveal opacity=1/filter=none. JavaScript disabled: native film controls and readable feature copy remain; contact inputs are disabled. Enquiry form with fictional QA details prepared the expected WhatsApp URL locally; it was not opened or sent.

Tested a 720px CSS layout at 2x pixel density as a zoom-equivalent reflow check; no horizontal overflow. This is not a measurement of actual browser zoom. Deliberate failed-media loading exposed the direct MP4 link and a useful status message. All temporary network blocking, script disabling and media/viewport emulation were restored.

## Boundaries

Current in-app Chromium browser verified; real Safari/iOS/Android devices were not exercised. Browser sound policy cannot be bypassed by pointer hover, so the first-click fallback is intentional. Main video pauses in hidden tabs to conserve resources, but continues through ordinary scrolling. The film's baked-in artwork remains untouched; CSS removes only the website's external wrapper/shadow.

No production deployment, live search, call or message delivery was performed. Website changes are isolated in `marketing/website`. Earlier verification files document earlier designs.
