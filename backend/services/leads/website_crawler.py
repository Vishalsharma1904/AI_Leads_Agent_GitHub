"""Bounded public business-site enrichment using Crawlee + Playwright.

Per site: the home page, then up to a few of its own contact / about / team
pages (found from the home page's links; the usual paths are guessed only
when it links none). From those pages we read what the site itself states:

  * every email address,
  * every Indian phone number, normalised to +91 and marked mobile/landline,
  * the owner / higher authority — from JSON-LD (founder, employee,
    Person + jobTitle) or plain text ("Rakesh Sharma, Managing Director",
    "Proprietor: Anil Gupta", a team card with the name above the title).

A name is taken only when the page puts it next to an authority title.
Nothing is ever guessed: a site that names no one leaves contactPerson empty.

The crawler imports are lazy on purpose. The API can still boot in a
text-only/local environment where browser binaries have not been installed;
records then keep their original provider fields and are marked as not
crawler-enriched. The parsing helpers below are pure (stdlib only) and are
covered by tests/test_leads_parsing.py.
"""
from __future__ import annotations

import json
import logging
import ipaddress
import re
from datetime import datetime, timezone, timedelta
from html import unescape
from urllib.parse import urljoin, urlparse

logger = logging.getLogger(__name__)

EMAIL_RE = re.compile(r"\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b")
# +91 / 0 prefixed or bare numbers; 10-13 digits with common separators
PHONE_CANDIDATE_RE = re.compile(r"(?<![\w/])(?:\+|00)?(?:91[\s.-]?)?\(?0?\d{2,5}\)?[\s.-]?\d{3,5}[\s.-]?\d{3,5}(?![\w/])")
GUESS_PATHS = ("/contact-us", "/contact", "/about-us")
LINK_HINT_RE = re.compile(r"contact|about|team|management|leadership|director|founder|people|who-we-are|our-company|reach", re.I)
SKIP_HOSTS = ("google.", "facebook.", "instagram.", "linkedin.", "justdial.", "sulekha.", "indiamart.", "tradeindia.")
JUNK_EMAIL_RE = re.compile(r"\.(png|jpe?g|gif|webp|svg|css|js)$|@(example\.(com|org)|sentry|wixpress\.com|domain\.com|email\.com|yoursite)", re.I)


# ── phones ────────────────────────────────────────────────────────────────
def normalise_indian_phone(raw: object) -> dict | None:
    """'098100 11111' -> {'number': '+91 98100 11111', 'kind': 'mobile'}.
    Landlines (area code + number, 10 digits without the leading 0) keep
    their digits: {'number': '+91 1204567890', 'kind': 'landline'}.
    Returns None for anything that is not a plausible Indian number."""
    digits = re.sub(r"\D", "", str(raw or ""))
    if digits.startswith("1800") or digits.startswith("1860"):
        return {"number": digits, "kind": "tollfree"} if len(digits) in (10, 11) else None
    if digits.startswith("0091"):
        digits = digits[4:]
    elif digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    if len(digits) != 10 or len(set(digits)) <= 2:
        return None
    if digits[0] in "6789":
        return {"number": f"+91 {digits[:5]} {digits[5:]}", "kind": "mobile"}
    if digits[0] in "12345":
        return {"number": f"+91 {digits}", "kind": "landline"}
    return None


def merge_phones(*lists) -> list[dict]:
    """De-duplicated, mobiles first, then landlines, then toll-free."""
    seen, out = set(), []
    for lst in lists:
        for p in lst or []:
            item = p if isinstance(p, dict) else normalise_indian_phone(p)
            if not item or not item.get("number"):
                continue
            key = re.sub(r"\D", "", item["number"])[-10:]
            if key in seen:
                continue
            seen.add(key)
            out.append({"number": item["number"], "kind": item.get("kind") or "landline"})
    order = {"mobile": 0, "landline": 1, "tollfree": 2}
    return sorted(out, key=lambda p: order.get(p["kind"], 3))


def extract_contacts(text: str) -> tuple[list[str], list[dict]]:
    """All emails and normalised Indian phone numbers in a page's text."""
    emails = []
    for match in EMAIL_RE.findall(text or ""):
        e = match.lower().strip(".")
        if not JUNK_EMAIL_RE.search(e) and e not in emails:
            emails.append(e)
    phones = merge_phones([m.group(0) for m in PHONE_CANDIDATE_RE.finditer(text or "")])
    return emails, phones


# ── owner / authority ─────────────────────────────────────────────────────
# ORDER IS THE LOGIC: _canon_title returns the FIRST pattern that matches, so
# every specific title must sit above the generic one that would swallow it
# ("Executive Director" above bare "director", "HR Head" above "head").
#
# Ranks are seniority, and seniority here means "who signs a security or
# housekeeping contract". That is why an Admin Head or Facility Manager
# ranks above a VP: in this trade they are the ones who actually buy.
_TITLES = [
    # —— the signatory ——
    (r"chairman\s*(?:&|and|cum)?\s*managing\s+director|\bc\.?m\.?d\.?(?=[\s,)|]|$)", "Chairman & Managing Director", 0),
    (r"managing\s+director", "Managing Director", 0), (r"\bm\.?\s?d\.?(?=[\s,)|]|$)", "Managing Director", 0),
    (r"proprietor|proprietress", "Proprietor", 0), (r"\bowner\b", "Owner", 0),
    (r"managing\s+trustee", "Managing Trustee", 0),
    # —— the top table ——
    (r"co[-\s]?founder", "Co-founder", 1), (r"\bfounder\b", "Founder", 1),
    (r"chairman|chairperson|chairwoman", "Chairman", 1),
    (r"chief\s+executive\s+officer|\bc\.?e\.?o\b", "CEO", 1),
    (r"chief\s+operating\s+officer|\bc\.?o\.?o\b", "COO", 1),
    (r"executive\s+director", "Executive Director", 1),
    (r"managing\s+partner", "Managing Partner", 1),
    (r"vice[-\s]?president|\bv\.?p\.?(?=[\s,)|]|$)", "Vice President", 2),
    (r"\bpresident\b", "President", 1),
    # —— who actually buys this service ——
    (r"(?:head|director)\s*(?:[-–,:]|\s+of\s+|\s+)?\s*admin(?:istration)?\b|admin(?:istration)?\s*head", "Admin Head", 2),
    (r"(?:head|director)\s*(?:[-–,:]|\s+of\s+|\s+)?\s*(?:hr|human\s+resources?)\b|(?:hr|human\s+resources?)\s*(?:head|director)", "HR Head", 2),
    (r"(?:head|director)\s*(?:[-–,:]|\s+of\s+|\s+)?\s*operations?\b|operations?\s*head", "Operations Head", 2),
    (r"(?:head|director)\s*(?:[-–,:]|\s+of\s+|\s+)?\s*facilit(?:y|ies)\b|facilit(?:y|ies)\s*head", "Facility Head", 2),
    (r"general\s+manager|\bg\.?\s?m\.?(?=[\s,)|]|$)", "General Manager", 2),
    (r"estate\s+manager", "Estate Manager", 2),
    (r"\bsecretary\b", "Secretary", 2),
    # —— the rest ——
    (r"\bpartner\b", "Partner", 3),
    (r"director", "Director", 3), (r"principal", "Principal", 3),
    (r"(?:unit|branch|centre|center|site)\s+head", "Unit Head", 3),
    (r"administrator", "Administrator", 3),
    (r"(?:admin(?:istration)?|hr|human\s+resources?|facilit(?:y|ies)|operations?|purchase|procurement|estate)\s+manager", None, 4),
    (r"\bmanager\s*[-–,:]\s*(?:admin(?:istration)?|hr|human\s+resources?|facilit(?:y|ies)|operations?|purchase|procurement)", None, 4),
]
TITLE_RE = "(?:" + "|".join(p for p, _, _ in _TITLES) + ")"
_HONORIFIC = r"(?:(?:Mr|Mrs|Ms|Miss|Dr|Shri|Smt|Sh|Er|CA|Adv|Col|Capt|Maj|Brig|Lt|Gen|Prof)\.?\s+)?"
_NAME_WORD = r"[A-Z][a-z]{1,15}"
NAME_RE = _HONORIFIC + _NAME_WORD + r"(?:\s+[A-Z]\.)?(?:\s+" + _NAME_WORD + r"){1,3}"
_NOT_NAME = set((
    "our the about contact team services service security guard guards housekeeping facility facilities management "
    "private pvt ltd limited company group solutions home read more call email office india delhi noida gurgaon gurugram "
    "ghaziabad mumbai welcome message meet board leadership director directors managing founder chairman partner owner "
    "proprietor principal manager admin hr sales support customer care head corporate registered branch why choose us "
    "privacy policy terms quick links follow get touch request quote enquiry now best top leading trusted experience "
    "years client clients national international hotel hospital school college university mall tower towers plaza "
    "road sector nagar marg street floor building estate park phase industrial area new old").split())


def _canon_title(raw: str) -> tuple[str, int] | None:
    t = re.sub(r"\s+", " ", raw or "").strip()
    for pattern, name, rank in _TITLES:
        if re.search(pattern, t, re.I):
            if name is None:   # "Admin Manager" / "Manager - HR" / "Purchase Manager": keep his wording
                hit = re.search(pattern, t, re.I)
                name = re.sub(r"\s+", " ", hit.group(0)).strip(" -–,:").title()
                name = name.replace("Hr", "HR").replace("Manager - ", "Manager, ")
            return name, rank
    return None


_HON_WORD = re.compile(r"(?:Mr|Mrs|Ms|Miss|Dr|Shri|Smt|Sh|Er|CA|Adv|Col|Capt|Maj|Brig|Lt|Gen|Prof)\.?")


def _clean_name(raw: str) -> str | None:
    """'Mr. Rakesh Sharma' -> 'Mr. Rakesh Sharma'; 'Welcome To Alpha Rakesh Sharma'
    -> 'Rakesh Sharma' (the longest trailing run of 2-4 name-like words)."""
    words = re.sub(r"\s+", " ", (raw or "").strip(" ,.-–—|:()")).split(" ")
    hon = words[0] if words and _HON_WORD.fullmatch(words[0]) else ""
    core = [w for w in (words[1:] if hon else words) if w]
    for k in range(min(4, len(core)), 1, -1):
        tail = core[-k:]
        if all(re.fullmatch(r"[A-Z][a-z]{1,15}|[A-Z]\.", w) for w in tail) and not any(w.lower().strip(".") in _NOT_NAME for w in tail) \
                and re.fullmatch(r"[A-Z][a-z]+", tail[-1]):
            return " ".join(([hon] if hon and k == len(core) else []) + tail)
    return None


def authority_from_jsonld(html: str) -> list[dict]:
    """founder / employee / Person+jobTitle from <script type=application/ld+json>."""
    out: list[dict] = []
    blocks = re.findall(r"<script[^>]+application/ld\+json[^>]*>(.*?)</script>", html or "", re.I | re.S)

    def person(node, default_title=None):
        if isinstance(node, str):
            node = {"name": node}
        if not isinstance(node, dict):
            return
        name = _clean_name(unescape(str(node.get("name") or "")))
        title = str(node.get("jobTitle") or node.get("roleName") or "") or default_title or ""
        canon = _canon_title(title)
        if name and canon:
            entry = {"contactPerson": name, "designation": canon[0], "rank": canon[1], "confidence": 0.9}
            # Only contact fields on this exact Person node establish ownership.
            entry["phones"] = merge_phones([node.get("telephone")])
            entry["emails"] = extract_contacts(str(node.get("email") or ""))[0]
            out.append(entry)

    def walk(node):
        if isinstance(node, list):
            for n in node:
                walk(n)
            return
        if not isinstance(node, dict):
            return
        types = node.get("@type")
        types = [types] if isinstance(types, str) else (types or [])
        if "Person" in types:
            person(node)
        for key, default in (("founder", "Founder"), ("founders", "Founder"), ("employee", None), ("employees", None), ("member", None), ("owner", "Owner")):
            val = node.get(key)
            for v in (val if isinstance(val, list) else [val] if val else []):
                person(v, default)
        for key in ("@graph", "mainEntity", "author", "publisher", "brand", "parentOrganization"):
            if key in node:
                walk(node[key])

    for raw in blocks:
        try:
            walk(json.loads(unescape(raw.strip())))
        except (ValueError, TypeError):
            continue
    return out


def authority_from_text(text: str) -> list[dict]:
    """'Rakesh Sharma, Managing Director', 'Proprietor: Anil Gupta',
    'Founded by Neha Jain', or a team card: a name line, then its title line."""
    out: list[dict] = []
    t = text or ""

    def add(name, title, conf):
        n, c = _clean_name(name), _canon_title(title)
        if n and c:
            out.append({"contactPerson": n, "designation": c[0], "rank": c[1], "confidence": conf})

    for m in re.finditer(rf"({NAME_RE})\s*(?:,|\(|–|—|-|\|)\s*(?:the\s+)?((?i:{TITLE_RE}))", t):
        add(m.group(1), m.group(2), 0.75)
    for m in re.finditer(rf"((?i:{TITLE_RE}))\s*(?::|–|—|-)\s*({NAME_RE})", t):
        add(m.group(2), m.group(1), 0.75)
    for m in re.finditer(rf"\b((?i:{TITLE_RE}))[ \t]+({NAME_RE})", t):   # "Our Director Mr. Rakesh Sharma"
        add(m.group(2), m.group(1), 0.65)
    for m in re.finditer(rf"(?i:founded\s+by)\s+({NAME_RE})", t):
        add(m.group(1), "Founder", 0.7)
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
    title_line = re.compile(rf"^(?:the\s+)?{TITLE_RE}(?:\s*(?:&|and|/)\s*{TITLE_RE})?(?:\s*,\s*.{{0,40}})?$", re.I)
    for a, b in zip(lines, lines[1:]):
        if re.fullmatch(NAME_RE, a) and title_line.match(b):
            add(a, b, 0.6)
    return out


def pick_authority(candidates: list[dict], source_url: str = "") -> dict | None:
    """Most senior, most confident candidate: {contactPerson, designation, source_url, confidence}."""
    best = None
    for c in candidates:
        key = (c.get("rank", 9), -c.get("confidence", 0))
        if best is None or key < best[0]:
            best = (key, c)
    if not best:
        return None
    c = best[1]
    result = {"contactPerson": c["contactPerson"], "designation": c["designation"],
              "source_url": c.get("source_url") or source_url, "confidence": c["confidence"]}
    for key in ("phones", "emails"):
        if c.get(key): result[key] = c[key]
    return result


# ── crawl ─────────────────────────────────────────────────────────────────
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
    if parsed.username or parsed.password or host.endswith((".localhost", ".local")):
        return ""
    try:
        if not ipaddress.ip_address(host).is_global:
            return ""
    except ValueError:
        pass
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


def pick_email(emails: list[str], domain: str) -> str:
    """Prefer an address on the company's own domain, then a named mailbox over info@/noreply@."""
    if not emails:
        return ""
    own = [e for e in emails if domain and (e.split("@", 1)[1].lower() == domain or e.split("@", 1)[1].lower().endswith("." + domain))]
    pool = own or emails
    pool = [e for e in pool if not re.match(r"(no-?reply|donotreply)@", e)] or pool
    return pool[0]


async def enrich_public_websites(
    records: list[dict],
    *,
    max_pages_per_site: int = 4,
    max_concurrency: int = 3,
    on_progress=None,
) -> list[dict]:
    """Read bounded public pages and merge only observed contact fields.

    Never fabricates a value and never treats a missing field as a successful
    verification. Best-effort: provider data stays usable when
    Crawlee/Playwright is unavailable or a site blocks the request.
    """
    for record in records:
        record.setdefault("crawler_enriched", False)
        record.setdefault("contact_verification", "not_attempted")
    try:
        from crawlee import ConcurrencySettings, Request
        from crawlee.crawlers import PlaywrightCrawler, PlaywrightCrawlingContext
    except ImportError:
        logger.warning(
            "Crawlee is not installed; website enrichment skipped — leads will have "
            "no e-mail. Run once in the backend folder: "
            "pip install -r requirements.txt && python -m playwright install chromium")
        return records

    # The package being importable is not the same as the browser existing.
    import asyncio as _asyncio
    from .browser_runtime import ensure_browser
    if not await _asyncio.to_thread(ensure_browser):
        logger.warning(
            "Website enrichment skipped: the Playwright browser is not installed. "
            "Run: python -m playwright install chromium")
        return records

    budget = max(1, int(max_pages_per_site))
    prepared: dict[str, list[dict]] = {}
    start_urls: list[str] = []
    for record in records:
        website = _clean_url(record.get("website") or "")
        if not website:
            record.setdefault("crawler_enriched", False)
            record.setdefault("contact_verification", "not_attempted")
            continue
        record["website"] = website
        key = _domain(website)
        if not key:
            record.setdefault("crawler_enriched", False)
            record.setdefault("contact_verification", "not_attempted")
            continue
        # One crawl per domain, but EVERY record on that domain gets the
        # result. Keeping only the first left sibling listings permanently
        # blank — and marked as already-read, so no retry ever fixed them.
        if key in prepared:
            prepared[key].append(record)
            continue
        prepared[key] = [record]
        start_urls.append(website)

    if not start_urls:
        return records

    findings: dict[str, dict] = {}
    async def report(domain, phase):
        if not on_progress:
            return
        siblings = prepared[domain]
        record = siblings[0]
        index = start_urls.index(record['website']) + 1
        company = str(record.get('company') or record.get('title') or record.get('name') or domain)[:120]
        result = on_progress({'type': 'page', 'phase': 'websites', 'company': company,
                              'companyIndex': index, 'companyTotal': len(start_urls),
                              'label': f'Company {index}/{len(start_urls)} · {company} · {phase}',
                              'records': siblings})
        if hasattr(result, '__await__'):
            await result
    try:
        crawler = PlaywrightCrawler(
            max_requests_per_crawl=max(1, len(start_urls) * budget),
            concurrency_settings=ConcurrencySettings(
                max_concurrency=max(1, min(int(max_concurrency), 8)),
                desired_concurrency=max(1, min(int(max_concurrency), 8)),
            ),
            headless=True,
            max_request_retries=0,
            navigation_timeout=timedelta(seconds=12),
            respect_robots_txt_file=True,
        )

        @crawler.router.default_handler
        async def handle_page(context: PlaywrightCrawlingContext) -> None:
            url = str(context.request.url)
            domain = _domain(url)
            if domain not in prepared:
                return
            await report(domain, 'reading public website')
            bucket = findings.setdefault(domain, {"emails": [], "phones": [], "people": [], "urls": [], "queued": 1})
            try:
                text = await context.page.locator("body").inner_text(timeout=10000)
            except Exception:
                text = ""
            try:
                html = await context.page.content()
            except Exception:
                html = ""
            try:
                links = await context.page.locator("a").evaluate_all("els => els.map(a => [a.href || '', (a.innerText || '').trim().slice(0, 60)])")
            except Exception:
                links = []
            hrefs = " ".join(str(h) for h, _ in links if h)
            emails, phones = extract_contacts("\n".join((text, hrefs)))
            bucket["emails"] += [e for e in emails if e not in bucket["emails"]]
            bucket["phones"] = merge_phones(bucket["phones"], phones)
            for person in authority_from_jsonld(html) + authority_from_text(text):
                person["source_url"] = url
                bucket["people"].append(person)
            bucket["urls"].append(url)
            stamp = datetime.now(timezone.utc).isoformat()
            for record in prepared[domain]:
                _apply_findings(record, domain, bucket, bucket['emails'], bucket['phones'], url, stamp)
            await report(domain, f"{len(bucket['urls'])} public page(s) checked")
            # From the first page: follow the site's own contact/about/team links (bounded).
            if bucket["queued"] < budget and len(bucket["urls"]) == 1:
                own = []
                for h, label in links:
                    if _domain(h) == domain and (LINK_HINT_RE.search(urlparse(h).path) or LINK_HINT_RE.search(label or "")):
                        h = h.split("#", 1)[0]
                        if h and h.rstrip("/") != url.rstrip("/") and h not in own:
                            own.append(h)
                if not own:
                    root = f"{urlparse(url).scheme}://{urlparse(url).netloc}/"
                    own = [urljoin(root, p.lstrip("/")) for p in GUESS_PATHS]
                # Spend the small page budget on contact pages first.
                own.sort(key=lambda h: 0 if re.search(r"contact|reach", urlparse(h).path, re.I) else 1)
                own = own[: budget - bucket["queued"]]
                bucket["queued"] += len(own)
                if own:
                    await context.add_requests([Request.from_url(u) for u in own])

        await crawler.run(list(dict.fromkeys(start_urls)))
    except Exception as exc:
        logger.warning("Public website enrichment stopped: %s", exc)
    finally:
        # Keep contacts already observed even when the caller's time budget expires.
        stamp = datetime.now(timezone.utc).isoformat()
        for domain, siblings in prepared.items():
            found = findings.get(domain) or {"emails": [], "phones": [], "people": [], "urls": []}
            emails, phones = found["emails"], found["phones"]
            for record in siblings:
                src = found["urls"][0] if found["urls"] else record["website"]
                _apply_findings(record, domain, found, emails, phones, src, stamp)

    return records


def _apply_findings(record, domain, found, emails, phones, src, stamp):
    """Write one domain's crawl result onto one record, never overwriting
    a contact the source already gave us."""
    if emails:
        record["emails"] = list(dict.fromkeys((record.get("emails") or []) + emails))
        chosen = pick_email(record["emails"], domain)
        if not record.get("email") or chosen.split('@')[-1] == domain:
            record["email"] = chosen
            record["contact_email_source"] = src
    if phones:
        record["phones"] = merge_phones(record.get("phones"), [record.get("phone")] if record.get("phone") else [], phones)
        if not record.get("phone"):
            record["phone"] = phones[0]["number"]
            record["contact_phone_source"] = src
    authority = pick_authority(found["people"])
    if authority and not record.get("contactPerson"):
        record["authority"] = authority
        record["contactPerson"] = authority["contactPerson"]
        record["designation"] = authority["designation"]
        record["contactPersonSource"] = authority["source_url"]
        record["personPhones"] = authority.get("phones", [])
        record["personEmails"] = authority.get("emails", [])
    if phones:
        record["companyPhones"] = phones
    record["phoneOwnership"] = "company_contact" if phones else "listing_contact_unconfirmed"
    record["crawler_enriched"] = bool(found["urls"])
    record["contact_verification"] = "public_page_observed" if (emails or phones) else "no_public_contact_found"
    if emails or phones:
        record["contact_verified_at"] = stamp


# ── who runs it, when the site never says ─────────────────────────────────
# Plenty of small Indian firms have a website that names nobody. The name is
# usually still public — in a directory listing, a tender document, a news
# line, an MCA extract. This asks the open web and reuses the SAME rule as
# the website path: a name counts only when an authority title is sitting
# next to it. So this cannot invent a person either, it can only find one
# somewhere other than the company's own pages.
#
# DuckDuckGo's HTML endpoint, no key, same as the image search already here.

# Two shapes of the same free endpoint. `lite` returns a plain table and
# survives markup churn better, so it is the fallback when the rich page
# either fails or parses to nothing.
_DDG_ENDPOINTS = ("https://html.duckduckgo.com/html/", "https://lite.duckduckgo.com/lite/")
_SEARCH_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _strip_html(fragment: str) -> str:
    text = _TAG_RE.sub(" ", fragment or "")
    for entity, char in (("&amp;", "&"), ("&#x27;", "'"), ("&quot;", '"'),
                         ("&lt;", "<"), ("&gt;", ">"), ("&nbsp;", " "), ("&#39;", "'")):
        text = text.replace(entity, char)
    return _WS_RE.sub(" ", text).strip()


def _ddg_parse(body: str) -> str:
    """Titles + snippets out of either DDG shape, as one blob of plain text."""
    parts: list[str] = []
    # rich page: <a class="result__a">title</a> … <a class="result__snippet">…</a>
    for m in re.finditer(r'class="result__(?:a|snippet)"[^>]*>(.*?)</a>', body, re.S):
        chunk = _strip_html(m.group(1))
        if chunk:
            parts.append(chunk)
    if not parts:
        # lite page: snippets sit in <td class="result-snippet"> and titles in
        # <a class="result-link">
        for m in re.finditer(r'class="result-(?:link|snippet)"[^>]*>(.*?)</(?:a|td)>', body, re.S):
            chunk = _strip_html(m.group(1))
            if chunk:
                parts.append(chunk)
    return "  \u00b7  ".join(parts[:24])


async def _ddg_text(client, query: str, timeout: float = 12.0) -> str:
    """Result titles + snippets as one blob of plain text."""
    last = ""
    for url in _DDG_ENDPOINTS:
        try:
            res = await client.post(url, data={"q": query},
                                    headers={"User-Agent": _SEARCH_UA,
                                             "Accept": "text/html",
                                             "Content-Type": "application/x-www-form-urlencoded"},
                                    timeout=timeout)
            res.raise_for_status()
            last = _ddg_parse(res.text)
            if last:
                return last
        except Exception:
            continue
    return last


async def authority_from_search(company: str, city: str = "", timeout: float = 12.0) -> dict | None:
    """Best public name+designation for a company, or None. Never raises."""
    name = _WS_RE.sub(" ", str(company or "")).strip()
    if len(name) < 3:
        return None
    try:
        import httpx
    except ImportError:
        return None
    where = _WS_RE.sub(" ", str(city or "")).strip()
    # Two passes: the owner-shaped query first, then the people-page one. The
    # second is only worth a call when the first found nothing.
    queries = [
        f'"{name}" {where} (proprietor OR "managing director" OR owner OR founder OR director)'.strip(),
        f'"{name}" {where} (-"HR head" OR "admin head" OR "general manager" OR contact person)'.strip(),
    ]
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            for query in queries:
                try:
                    blob = await _ddg_text(client, query, timeout)
                except Exception:
                    continue
                if not blob:
                    continue
                people = authority_from_text(blob)
                if people:
                    picked = pick_authority(people, source_url="Web search")
                    if picked:
                        # a web snippet is weaker evidence than the company's
                        # own page, and the score downstream should know that
                        picked["confidence"] = round(min(picked.get("confidence", 0.6), 0.55), 2)
                        return picked
    except Exception as error:          # network down, DDG shape changed, …
        logger.debug("authority search failed for %s: %s", name, error)
    return None


async def enrich_authority_via_search(records: list[dict], *, max_lookups: int = 25,
                                      max_concurrency: int = 3) -> list[dict]:
    """Retain search-only authority candidates for review, not confirmed people.

    Runs after enrich_public_websites, never instead of it: the company's own
    page is better evidence and is also cheaper. Bounded so a 100-lead run
    cannot turn into 100 searches.
    """
    import asyncio
    todo = [r for r in records
            if isinstance(r, dict)
            and not str(r.get("contactPerson") or "").strip()
            and str(r.get("company") or r.get("name") or r.get("title") or "").strip()][:max_lookups]
    if not todo:
        return records
    sem = asyncio.Semaphore(max(1, max_concurrency))

    async def one(record):
        async with sem:
            company = str(record.get("company") or record.get("title") or record.get("name") or "")
            city = str(record.get("city") or record.get("location") or "")
            found = await authority_from_search(company, city)
            if not found:
                return
            # A snippet isn't proof of company affiliation or phone ownership.
            # Retain it for review; only company-page evidence fills the person.
            record["authorityCandidate"] = found

    await asyncio.gather(*(one(r) for r in todo), return_exceptions=True)
    return records
