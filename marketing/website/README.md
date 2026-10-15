# Rudra24 AI product website

Eight standalone HTML pages with local fonts, the actual app logo and the supplied launch film. No app/backend APIs, credentials, third-party player or provider calls are needed at runtime. Publish this folder, not the repository root.

## Local preview

From the repository root:

`py -3.12 marketing/website/tools/serve_site.py --port 4178`

Open `http://127.0.0.1:4178/index.html`. This optional localhost-only static server supports byte ranges for native MP4 seeking. Plain Python `http.server` lacks the needed range behaviour. Production static hosting should return `Accept-Ranges: bytes` and support `206 Partial Content` for MP4 files.

## Edit

- `site.css`: baseline responsive layout, local fonts and animation.
- `refinement.css`: warm-white palette, flat rounded cards, prominent capitalised brand and film treatment.
- `site.js`: sample interactions, menus, reveal animation and local enquiry preparation.
- `experience.js`: expandable feature cards, validated local searches, sample CRM/candidate data, editable drafts and CSV exports.
- `media.js`: muted autoplay, hover sound with policy fallback, pause control and one shared feature-hover preview.
- `tools/build_site.py`: shared markup and all eight page bodies. Run `py -3.12 marketing/website/tools/build_site.py` after editing; it rewrites the generated HTML pages.

Font licences are in `assets/fonts`. Figtree and EB Garamond match the app's Flow pairing. Preview surfaces use its Flow green preset: sidebar #034F46, canvas #FFFFEB. The original square app PNG is proportionally resized to 128px, preserving the mark. Essential descriptions and native navigation remain available without JavaScript.

## Included film

The supplied film is 211.7 seconds, 1920x1080 at 60fps, H.264 with stereo AAC audio. `assets/video/launch-film.mp4` is a lossless container remux with front-loaded metadata. Video/audio were not re-encoded and the original desktop file was not edited. `launch-poster.jpg` is a frame from the film.

The film sits directly on the page, with only its own corners rounded. It loops muted in its original 16:9 ratio. Pointer hover attempts sound; pointer leave or scroll mutes it without stopping playback. No separate sound-enabling control is shown. A trusted click/tap on the video (or Enter/Space) toggles sound when the browser requires a gesture. Hover alone cannot bypass browser autoplay rules. Expand film moves the same player into an accessible full-size dialog; Escape restores it without a second audio stream. An outside pause button remains available to keyboard and pointer users. Reduced-motion mode starts with a still poster; visitors can choose playback. Static HTML retains native controls without JavaScript. The film contains English on-screen captions; the feature overview is a readable product summary.

Five silent ten-second excerpts retain 1920x1080 at 60fps with CRF 18 encoding. Full-resolution posters replace smaller stills. The clips cover leads, calling, WhatsApp, CRM and the assistant. Feature cards share one pointer-following video preview, loaded on hover and paused on leave, scroll, resize, Escape or page hiding. Corresponding feature pages have native players and simple instructions, available to touch and keyboard users. The main film continues during ordinary scrolling and pauses in a hidden browser tab. Failed loads expose a direct MP4 link.

To replace the film, replace the media at the same paths or update `film_player()` and regenerate. Update posters, excerpts and readable descriptions to match. `tools/revise_media.py` prepares the current excerpts with ffmpeg, without modifying the source film.

## Contact and demo behaviour

Primary contact: +91 99998 81949 (Vishal Sharma). WhatsApp links open an enquiry for visitor review and sending. The Contact form prepares a link locally and requires a separate open action. Nothing is stored or submitted to this website. Fields are disabled by default to prevent accidental submission without JavaScript.

Twenty expandable product cards cover the app tabs. Native details provide descriptions without JavaScript; forms default to disabled. Lead and candidate forms validate role/industry, city, locality and count (1–20), stream deterministic fictional records, allow Stop with partial retention, and export safe CSV. The Data Hub and report totals reflect searches, saved CRM samples and planned follow-ups during this page visit. Drafts are editable. Assistant, voice and provider setup use prepared demonstrations. No live AI, real lead sourcing or new backend is connected; the user accepted a simulated experience, so the site remains standalone. Reloading clears demo state.

Lead, CRM, outreach and candidate previews use fictional records. Export produces a labelled fictional CSV. The website makes no calls, sends no messages and adds no analytics/cookies.

## Checks

`py -3.12 marketing/website/tools/check_site.py`

`py -3.12 marketing/website/tools/test_preview_server.py`

`node --check marketing/website/site.js`

`node --check marketing/website/media.js`

`node marketing/website/tools/check_experience.js`

Current evidence: `qa/verification-interactive.md`; desktop/mobile captures are in `qa/`. Earlier verification documents describe earlier designs. Static checks do not prove live app/provider behaviour.
