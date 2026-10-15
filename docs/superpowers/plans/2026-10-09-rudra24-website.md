# Rudra24 AI Website Implementation Plan

> **For agentic workers:** Execute inline using the approved design; independent review at completion. Steps use checkbox syntax for tracking.

**Goal:** Deliver a polished eight-page, standalone product website with working sample interactions and WhatsApp enquiries.

**Architecture:** Build-time Python authoring script emits static HTML with semantic navigation and all essential copy. Shared stylesheet and progressive-enhancement JavaScript implement responsive layouts and sample previews. Only the website's local assets are used at runtime.

**Tech Stack:** HTML, CSS, Vanilla JavaScript; Python standard library for repeatable authoring and static validation.

**Spec:** `docs/superpowers/specs/2026-10-09-rudra24-website-design.md`

## Global constraints
- Isolate deliverables in `marketing/website`; no app/backend/root deployment changes.
- Reuse approved palette, local licensed fonts and app logo.
- WhatsApp +91 99998 81949; open prepared enquiry only, never send.
- Fictional labelled sample data, no provider calls and no fabricated marketing proof.
- English, eight pages, video supplied later, native scroll and reduced motion.

## Review focus
- Direct/file navigation and JavaScript-disabled content remain usable.
- Narrow screens and enlarged text do not clip meaningful content.
- Rapid tab selections show only the newest selected panel.
- Escape/outside click close navigation and keyboard focus remains visible.
- Outreach/calling examples clearly distinguish preparation, setup and actual delivery.

## Tasks
1. [x] Build standalone foundation: `site.css`, licensed local assets, shared static navigation/footer and generator `tools/build_site.py`.
2. [x] Author all eight HTML pages, sample product panes, feature demonstrations and use-case walkthroughs; verify real source coverage.
3. [x] Implement `site.js`: native menu behaviour, accessible sample tabs, lead-detail selection, CRM moves, sample draft variants, contact enquiry and paused/reduced motion.
4. [x] Add `tools/check_site.py`, README and future-video instructions. Run static link/asset/content checks and JavaScript syntax check.
5. [x] Serve only the website locally. Inspect all pages at desktop/tablet/360/390 widths; exercise controls, keyboard, reduced motion, zoom-equivalent reflow and no-JS. Capture preview evidence; independent review and fix material findings. See `marketing/website/qa/verification.md` for evidence and tool limits.

## Execution rulings
- The user explicitly requested implementing this approved plan; no additional design or execution approval is needed.
- Work in the existing checkout because the deliverable is a new isolated folder and the app's current working files are the source of truth. Preserve unrelated uncommitted changes; do not commit or deploy them.
- Static Python authoring is development tooling only: the delivered site requires no Python/Node/backend to operate.
- Native browser zoom shortcuts were unavailable in the browser tool; use a documented 200%-equivalent viewport/DPR reflow test instead. Direct file browsing was policy-blocked; verify HTTP and relative assets without circumvention.
