# Website verification — 9 October 2026

## Passed

- Eight emitted pages, one main/h1 each, unique IDs, titles/descriptions, explicit button types, image alt/dimensions, all local asset links and fragments. `py -3.12 marketing/website/tools/check_site.py` passes.
- `node --check` passes for `site.js` and `video-config.js`.
- All eight pages inspected in the real Codex browser at 1440px desktop, approximately 768px tablet, exact 390px and exact 360px. No horizontal document overflow. Additional 324px checks also passed.
- 200% equivalent reflow: 720 CSS pixels at device scale factor 2 for a 1440px viewport; no heading clipping or document overflow on any page. Browser shortcut zoom did not change this tool's viewport, so this is a reflow simulation rather than a claim of a native browser zoom test.
- Main product tabs, Arrow/Home/End navigation, rapid selections, selected lead details, all three outreach drafts, CRM move/reset cycle, candidate role filters, use-case tabs, native FAQ and desktop/mobile navigation tested.
- Escape closes mobile navigation and returns focus to its summary. Clicking outside closes the menu. Feature navigation and browser Back return to the right pages.
- Export produces `rudra24-fictional-sample.csv` with three rows, all labelled Fictional demo. No provider request occurs.
- Contact form prepared the correct URL-encoded WhatsApp enquiry from fictional test fields, kept the page URL unchanged, and required a separate link action. No message was sent and no external WhatsApp link was opened in testing.
- With script execution disabled, Home retains essential explanations and native navigation. Contact inputs are disabled/hidden and a direct WhatsApp fallback remains. Static validation protects the disabled-fieldset default.
- With reduced motion emulated, hero/orb animation names are `none`, reveal opacity is `1`, and scrolling is `auto`; product tab interactions still work.
- No browser console warnings/errors were observed during the exercised flows.
- Normal text contrast: ink/paper 16.44:1, secondary text/paper 5.51:1, primary button 8.75:1, olive/sage 7.46:1. Contact input boundaries 3.63:1.
- Self-hosted licensed fonts and unchanged embedded app icon. Runtime source/assets approximately 316KB, excluding tools and QA captures.
- Independent source review found one material issue (implicit contact submission without JavaScript), fixed with disabled-by-default fields enabled only after the submit handler attaches. Final reviewer found no remaining material issues.

## Limits and deliberate boundaries

- Direct `file://` browser navigation was blocked by the browser tool's HTTP/HTTPS-only policy. Relative local assets and classic scripts were statically checked; HTTP rendering and interaction were verified. No browser-policy workaround was attempted.
- No production deployment, low-end physical-device performance guarantee, live scraping, actual provider call, message delivery or account integration was tested or claimed.
- The user is producing the film separately. The local video configuration remains null; no empty player is displayed. Instructions for MP4/poster/captions are in README.
- QA screenshots capture real local website rendering. Demo records are fictional.

## Source references

Product feature map: current `index.html`, `clavis-app-map.js`, CRM modules, `docs/elevenlabs-verification.md` and `docs/meta-whatsapp-setup.md`. Brand colors: `clavis-cream.css` and `clavis-olive.css`. Contact: existing Rudra24 showcase, with primary number explicitly confirmed by the user.

Design reference sites inspected during planning: https://claude.com/ and https://wisprflow.ai/. Their layout principles informed this design; no customer claims, branding or proprietary assets were copied.
