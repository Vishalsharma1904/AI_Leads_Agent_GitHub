# Clavis Lead + Candidate Agent Plan

## Product decision

Clavis should be a provider-agnostic sourcing assistant. The user's requested
role/service is an input, not a fixed security-industry enum. If the user says
“get me leads in Gurugram” without naming an industry, Clavis searches all
configured industries and reports the interpretation in the task window. It
must never invent a phone number, email, website, rating, or company.

## Request lifecycle

1. Parse the utterance into a typed plan: workstream (`leads` or `candidates`),
   locations, industries, role/service terms, count, and source policy.
2. Run discovery in the backend. The browser only receives phase events and
   authenticated, tenant-scoped results.
3. Deduplicate by stable business identity (domain, normalized phone, or
   source ID), then enrich only from public pages.
4. Attach field-level provenance and confidence. “Not found” is a valid value;
   it is never replaced with a generated placeholder.
5. Show the actual phase in Peek Tasks and offer `Open results` and `Download
   Excel`. Export contains source URLs and verification timestamps.

## Crawler recommendation

Use Crawlee's `PlaywrightCrawler` for official-site enrichment. Playwright is
the browser runtime for JavaScript-heavy sites; Crawlee owns request queues,
retries, concurrency and datasets. Google/Maps discovery remains behind a
provider adapter because search/Maps access, quotas and terms vary by account.

The crawler should be limited to public business pages, same-domain contact or
about pages, robots/terms-aware requests, bounded depth, bounded concurrency,
and an explicit timeout. It should not bypass CAPTCHAs, paywalls, login walls,
or collect private/personal data unrelated to the business contact channel.

## Candidate workstream

Candidate sourcing remains separate from buyer-lead sourcing: role, city,
portal/source, experience and contactability are candidate fields; company,
industry and buyer signals are lead fields. They can share the task surface and
export contract, but must not be merged into one table by accident.

## Current implementation in this pass

- Added deterministic open-ended request planning in
  `lead-candidate-domain.js`.
- Removed the path that fabricated domains for static fallback companies.
- Routed live scrape events into Peek Tasks and added lead/candidate result
  renderers plus Excel actions.
- Kept the current Apify/Maps discovery adapter behind the authenticated backend
  and added an optional bounded Crawlee + Playwright official-site enrichment
  seam. The live crawl still needs a working Python environment and provider
  credentials before it can be marked production-verified.

## Decisions needed before production crawler rollout

1. Which discovery provider is approved for production: existing Apify Maps,
   Google Places/Search API, or a user-supplied provider adapter?
2. Should the default provider profile search all manpower requirements, or only
   the service lines configured by each workspace owner?
3. What is the acceptable per-run limit and whether a partial verified export is
   allowed when some businesses have no public email or phone?

## Acceptance tests

- “Gurugram me leads nikalo” does not default to security-only and does not
  fabricate an industry.
- “Mumbai me 25 nurses ke candidates” routes to Candidate AI, not Lead Hub.
- A running task says whether it is searching Maps, reading a page, enriching,
  deduplicating, or exporting; no fake percentage is shown when unavailable.
- A failed/partial provider response does not auto-export fabricated rows.
- Excel rows contain source URL, source timestamp and blank missing fields.
