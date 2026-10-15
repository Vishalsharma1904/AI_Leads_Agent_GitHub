# Interactive website verification — 9 October 2026

Scope: marketing/website only; existing application/backend files were not edited in this revision.

## Checks that passed

- Static generator and validator: eight pages; metadata, IDs, local links/fragments, asset paths, approved palette, no gradients, and no live network/provider calls in demo code.
- Node syntax checks for site.js, media.js and experience.js.
- check_experience.js: exact counts 1/3/20, precise locality preservation, input bounds and invalid selections, fictional candidate records, CSV quoting and spreadsheet formula protection.
- Preview server: real MP4 range/suffix requests return 206; invalid ranges 416; homepage 200.
- Browser: all eight pages at 360, 390, 768 and 1440 CSS px had no document horizontal overflow. Home lead and Product Client AI cards were expanded during these checks.
- Inline homepage search accepted Cyber City / Gurugram / five results and stayed on the homepage. Record details disclosed unavailable contact information.
- Client AI accepted an editable request and reviewed settings for two hospital samples in Connaught Place, Delhi. A 2x device-density/reflow check on the email form had no horizontal overflow; this is not a claim of testing the browser zoom control.
- Run Agent search returned requested counts; Stop preserved three of twenty fictional results and re-enabled inputs. A four-result search saved to the demo CRM and reports showed four leads, five CRM records, one planned follow-up.
- Recruitment form returned two fictional housekeeping candidates. CRM stage movement updated the Data Hub record to Contacted. Data Hub filters worked; Export downloaded rudra24-fictional-demo.csv to the browser Downloads folder.
- Calling, voice, email, WhatsApp, SMS, assistant, calendar, contracts, settings, accounts, connectors, plugins and provider cards produced prepared outputs. Message/script drafts are editable textareas. No actual calls, messages, sign-ins, AI requests or provider scraping ran.
- Native details support Enter; Escape closes a preview and returns focus to its summary. The expanded form controls no longer sit beneath the old stretched-link pseudo-element.
- Film: muted autoplay, 1920x1080 source, no separate sound-enable control; first-hover audio was blocked by browser policy and playback continued muted. A trusted video click enabled audio; later hover unmuted, pointer leave and scroll muted without pausing. Expand moved the same player into a dialog; Escape restored it and playback continued.
- Reduced motion: film paused and no reveal content remained invisible. JavaScript disabled: descriptions/native card disclosure remained available, input was disabled, and video retained native controls.
- Regenerated excerpt inspected with ffmpeg: H.264, 1920x1080, 60 fps, ten seconds. Posters use source resolution. Original full film was not re-encoded.

## Boundaries

This is a functional local simulation, not a production lead-scraping backend or live AI connection. Demo state is limited to the current page visit. The original 1080p film cannot preserve tiny raster text at every display size or unlimited zoom; scalable HTML previews and an enlarged original-resolution player address readability. Hover alone cannot override browser audio autoplay restrictions.

## Visual proof

- home-interactive-desktop.png: desktop landing page.
- feature-card-interactive.png: expanded feature explanation and actual HTML form.
- interactive-leads-desktop.png and interactive-leads-mobile.png: completed fictional lead search.

The browser screenshot wrapper became unavailable during this run; captures use the documented CDP screenshot capability and were visually inspected.
