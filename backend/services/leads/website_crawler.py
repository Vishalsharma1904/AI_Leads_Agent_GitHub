"""Bounded public business-site enrichment using Crawlee + Playwright.

The imports are lazy on purpose. The API can still boot in a text-only/local
environment where browser binaries have not been installed; records then keep
their original provider fields and are marked as not crawler-enriched.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

logger = logging.getLogger(__name__)

EMAIL_RE = re.compile(r"\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b")
PHONE_RE = re.compile(r"(?<!\d)(?:\+?91[\s.-]?)?[6-9]\d{9}(?!\d)")
LANDLINE_RE = re.compile(r"(?<!\d)(?:0\d{2,4}[\s.-]?\d{6,8}|\+?91[\s.-]?\d{2,4}[\s.-]?\d{6,8})(?!\d)")
CONTACT_PATHS = ("/contact", "/contact-us", "/about", "/about-us")
SKIP_HOSTS = ("google.", "facebook.", "instagram.", "linkedin.", "justdial.", "indiamart.")


def _clean_url(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if not raw.startswith(("http://", "https://")):
        raw = "https://" + raw
    try:
        parsed = urlparse(raw)
    except ValueError:
        return ""
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return ""
    host = parsed.hostname.lower()
    if host == "localhost" or host.startswith(("127.", "10.", "192.168.")):
        return ""
    if any(part in host for part in SKIP_HOSTS):
        return ""
    return raw


def _domain(value: str) -> str:
    try:
        return (urlparse(value).hostname or "").lower().removeprefix("www.")
    except ValueError:
        return ""


def _extract(text: str) -> tuple[list[str], list[str]]:
    emails = sorted({match.lower() for match in EMAIL_RE.findall(text or "") if not match.lower().endswith(("@example.com", "@example.org"))})
    phones = []
    for raw in PHONE_RE.findall(text or ""):
        digits = re.sub(r"\D", "", raw)
        if digits.startswith("91") and len(digits) == 12:
            digits = digits[2:]
        if len(digits) == 10 and digits not in phones:
            phones.append(digits)
    for raw in LANDLINE_RE.findall(text or ""):
        digits = re.sub(r"\D", "", raw)
        if digits.startswith("91") and len(digits) > 10:
            digits = digits[2:]
        if 8 <= len(digits) <= 11 and digits not in phones:
            phones.append(digits)
    return emails, phones


async def enrich_public_websites(
    records: list[dict],
    *,
    max_pages_per_site: int = 3,
    max_concurrency: int = 3,
) -> list[dict]:
    """Read bounded public pages and merge only observed contact fields.

    This function never fabricates a value and never treats a missing field as
    a successful verification. It is intentionally best-effort: provider data
    remains usable when Crawlee/Playwright is unavailable or a site blocks the
    request.
    """
    try:
        from crawlee import ConcurrencySettings
        from crawlee.crawlers import PlaywrightCrawler, PlaywrightCrawlingContext
    except ImportError:
        logger.warning("Crawlee/Playwright is not installed; website enrichment skipped")
        return records

    prepared: dict[str, dict] = {}
    start_urls: list[str] = []
    for record in records:
        website = _clean_url(record.get("website") or record.get("url") or "")
        if not website:
            record.setdefault("crawler_enriched", False)
            record.setdefault("contact_verification", "not_attempted")
            continue
        record["website"] = website
        key = _domain(website)
        if not key:
            continue
        prepared.setdefault(key, record)
        start_urls.append(website)
        parsed = urlparse(website)
        root = f"{parsed.scheme}://{parsed.netloc}"
        for path in CONTACT_PATHS[: max(0, max_pages_per_site - 1)]:
            start_urls.append(urljoin(root + "/", path.lstrip("/")))

    if not start_urls:
        return records

    findings: dict[str, dict[str, set[str]]] = {}
    try:
        crawler = PlaywrightCrawler(
            max_requests_per_crawl=max(1, len(start_urls)),
            concurrency_settings=ConcurrencySettings(
                max_concurrency=max(1, min(int(max_concurrency), 8)),
                desired_concurrency=max(1, min(int(max_concurrency), 8)),
            ),
            headless=True,
            max_request_retries=1,
            respect_robots_txt_file=True,
        )

        @crawler.router.default_handler
        async def handle_page(context: PlaywrightCrawlingContext) -> None:
            url = str(context.request.url)
            domain = _domain(url)
            record = prepared.get(domain)
            if not record:
                return
            try:
                text = await context.page.locator("body").inner_text(timeout=10000)
            except Exception:
                text = ""
            try:
                hrefs = await context.page.locator("a").evaluate_all("els => els.map(a => a.href || '')")
            except Exception:
                hrefs = []
            link_text = " ".join(str(href) for href in hrefs if href)
            emails, phones = _extract("\n".join((text, link_text)))
            bucket = findings.setdefault(domain, {"emails": set(), "phones": set(), "urls": set()})
            bucket["emails"].update(emails)
            bucket["phones"].update(phones)
            bucket["urls"].add(url)

        await crawler.run(list(dict.fromkeys(start_urls)))
    except Exception as exc:
        logger.warning("Public website enrichment stopped: %s", exc)

    stamp = datetime.now(timezone.utc).isoformat()
    for domain, record in prepared.items():
        found = findings.get(domain, {"emails": set(), "phones": set(), "urls": set()})
        emails = sorted(found["emails"])
        phones = sorted(found["phones"])
        if emails and not record.get("email"):
            record["email"] = emails[0]
            record["contact_email_source"] = sorted(found["urls"])[0] if found["urls"] else record["website"]
        if phones and not record.get("phone"):
            record["phone"] = phones[0]
            record["contact_phone_source"] = sorted(found["urls"])[0] if found["urls"] else record["website"]
        record["crawler_enriched"] = bool(found["urls"])
        record["contact_verification"] = "public_page_observed" if (emails or phones) else "no_public_contact_found"
        record["contact_verified_at"] = stamp

    return records
