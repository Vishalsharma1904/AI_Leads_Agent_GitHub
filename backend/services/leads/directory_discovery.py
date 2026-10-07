"""Directory discovery through public search indexes, not directory scraping.

No login, CAPTCHA, phone-reveal or relay-number extraction. A directory hit
is only a company candidate; an independently matching business listing must
confirm its identity/location before any contact enters the lead pipeline.
"""
import asyncio
import re
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlparse

import httpx

from .website_crawler import _DDG_ENDPOINTS, _SEARCH_UA, _clean_url

DIRECTORIES = {"sulekha": "sulekha.com", "justdial": "justdial.com"}


class IndexResults(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows, self.current = [], None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and set((attrs.get("class") or "").split()) & {"result__a", "result-link"}:
            self.current = {"url": attrs.get("href", ""), "title": ""}

    def handle_data(self, data):
        if self.current is not None:
            self.current["title"] += data

    def handle_endtag(self, tag):
        if tag == "a" and self.current is not None:
            self.rows.append(self.current)
            self.current = None


def indexed_candidates(body, provider, city):
    parser = IndexResults()
    parser.feed(body)
    result, seen = [], set()
    domain = DIRECTORIES[provider]
    for row in parser.rows:
        url = row["url"]
        if url.startswith("//"):
            url = "https:" + url
        url = parse_qs(urlparse(url).query).get("uddg", [url])[0]
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme not in {"http", "https"} or not (host == domain or host.endswith("." + domain)):
            continue
        title = re.sub(r"\s+", " ", row["title"]).strip()
        # Only individually named listing titles; category/top-N pages are not companies.
        title = re.split(r"\s+[|–—]\s+|\s+-\s+(?:Justdial|Sulekha)", title, maxsplit=1, flags=re.I)[0]
        name = re.split(r"\s+(?:in|at)\s+", title, maxsplit=1, flags=re.I)[0].strip(" ,-")
        if not 3 <= len(name) <= 120 or re.match(r"^(top\b|best\b|\d+\b|list\b|search\b)", name, re.I):
            continue
        if name.casefold() in seen:
            continue
        seen.add(name.casefold())
        result.append({"name": name, "city": city, "url": url, "provider": provider})
    return result


def same_company(candidate, listing):
    # ponytail: strict normalized identity; aliases need explicit evidence, not fuzzy merges.
    def key(value):
        text = re.sub(r"\b(?:private|pvt|limited|ltd)\b", "", str(value).casefold())
        return re.sub(r"[^a-z0-9]+", "", text)
    return bool(key(candidate)) and key(candidate) == key(listing)


async def discover_indexed_businesses(queries, providers, *, existing, discover, matches_city,
                                     on_progress=None, cancelled=lambda: False):
    """At most six index searches and six additional company lookups per job.

    Existing results can acquire internal evidence without a second browser
    lookup. Search blocking/empty indexes are honest, optional source failures.
    """
    additions, seen = [], set()
    budget = 6
    async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
        for query in queries[:3]:
            topic, _, city = query.rpartition(" in ")
            if not city:
                continue
            for provider in providers:
                if cancelled():
                    return additions
                if on_progress:
                    await on_progress({"label": "Checking additional public business candidates"})
                rows = []
                for endpoint in _DDG_ENDPOINTS:
                    try:
                        response = await client.post(endpoint, data={"q": f"site:{DIRECTORIES[provider]} {topic} {city}"},
                                                     headers={"User-Agent": _SEARCH_UA})
                        response.raise_for_status()
                        rows = indexed_candidates(response.text, provider, city)
                        if rows:
                            break
                    except httpx.HTTPError:
                        continue
                for candidate in rows[:4]:
                    if cancelled():
                        return additions
                    identity = (candidate["name"].casefold(), city.casefold())
                    if identity in seen:
                        continue
                    seen.add(identity)
                    matches = [item for item in existing + additions
                               if same_company(candidate["name"], item.get("title") or item.get("name"))
                               and matches_city(city, str(item.get("address") or item.get("city") or ""))]
                    if not matches and budget:
                        budget -= 1
                        try:
                            hits = await asyncio.wait_for(discover(f'{candidate["name"]} in {city}', 2, concurrency=2), 25)
                        except (asyncio.TimeoutError, RuntimeError):
                            hits = []
                        matches = [item for item in hits if same_company(candidate["name"], item.get("title"))
                                   and matches_city(city, str(item.get("address") or item.get("city") or ""))]
                        for item in matches[:1]:
                            item["searchString"] = query
                            additions.append(item)
                    for item in matches:
                        item.setdefault("discoveryEvidence", []).append(candidate)
    return additions


def public_lead(item):
    """Keep discovery provenance in server records, not customer UI/CRM/exports."""
    result = {key: value for key, value in item.items()
              if key not in {"discoveryEvidence", "source", "provider", "sourceUrl", "placeUrl", "contactPersonSource", "authorityCandidate"}}
    if isinstance(result.get("authority"), dict):
        result["authority"] = {key: value for key, value in result["authority"].items() if key != "source_url"}
    result["source"] = "Public business contact"
    # Maps URLs remain usable for location/directions; they aren't company websites.
    return result


async def recover_company_websites(records, matches_city, max_lookups=6):
    """Fill a missing website only after its own page names company + location."""
    from api.web_reader import _get, _Page
    async with httpx.AsyncClient(follow_redirects=False, timeout=8) as client:
        todo = [item for item in records if not _clean_url(item.get("website"))][:max_lookups]
        for item in todo:
            name = str(item.get("title") or item.get("company") or item.get("name") or "").strip()
            city = str(item.get("city") or str(item.get("searchString", "")).rpartition(" in ")[2]).strip()
            if len(name) < 3 or not city:
                continue
            try:
                response = await client.post(_DDG_ENDPOINTS[0], data={"q": f'"{name}" "{city}" official website'},
                                             headers={"User-Agent": _SEARCH_UA})
                parser = IndexResults(); parser.feed(response.text)
                for row in parser.rows[:3]:
                    url = row["url"]
                    if url.startswith("//"): url = "https:" + url
                    url = parse_qs(urlparse(url).query).get("uddg", [url])[0]
                    url = _clean_url(url)
                    if not url: continue
                    final_url, content = await _get(client, url, 250000)
                    page = _Page(); page.feed(content)
                    # Full name and requested location, not a domain-name guess.
                    text = " ".join(page.text)
                    heading = " ".join([page.title, *page.headings]).casefold()
                    if name.casefold() in heading and matches_city(city, text):
                        item["website"] = final_url
                        item["website_verification"] = "company_and_location_observed"
                        break
            except (httpx.HTTPError, ValueError, RuntimeError):
                continue
