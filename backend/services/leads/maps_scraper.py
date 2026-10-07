"""Keyless Google Maps business discovery using Scrapling's DynamicFetcher —
a real, automated browser (Playwright under the hood), no Apify, no API key.

Two passes per search query, same as what a paid Maps-scraper actor does
internally:
  1. Open the Maps search results feed, scroll it to load enough cards, and
     collect each result's own place-page URL + visible name.
  2. Visit each place's own page (bounded concurrency) and read the fields a
     lead actually needs: address, phone, website, rating, review count.

Google's Maps markup is not versioned and these selectors WILL drift
eventually — that is true of every Maps scraper, paid or free (Apify's own
actor needs the same kind of maintenance). Kept in one place so a future fix
is a one-spot edit, not a rewrite. Never fabricates a field: a place with no
readable name is dropped rather than guessed.
"""
from __future__ import annotations

import asyncio
import html
import json
import logging
import re
from html.parser import HTMLParser
from urllib.parse import parse_qs, quote_plus, unquote, urljoin, urlparse

from services.leads.website_crawler import merge_phones

logger = logging.getLogger(__name__)

_FEED_SCROLL_ROUNDS = 6
_FEED_CONTAINER_SELECTOR = 'div[role="feed"]'
_FEED_LINK_SELECTOR = "a.hfpxzc"

# Place-detail-page selectors. Primary: Google's semantic data-item-id
# attributes (address / phone:tel:<number> / authority = website), which
# have outlived several class-name reshuffles. The class selectors below
# are the fallback (Google Maps, late 2026).
_NAME_SEL = "h1.DUwDvf.lfPIob"
_ADDRESS_SEL = ".RcCsl:nth-child(3) .Io6YTe"
_PHONE_SEL = ".RcCsl:nth-child(5) .Io6YTe"
_WEBSITE_SEL = ".RcCsl:nth-child(4) a.CsEnBe"
_CATEGORY_SEL = "button.DkEaL, .DkEaL, button[jsaction*='category']"
_RATING_SEL = ".ceNzKf"
_REVIEWS_SEL = ".F7nice"

_RATING_RE = re.compile(r"(\d(?:\.\d)?)")
_REVIEWS_RE = re.compile(r"([\d,]{1,7})\s*review", re.I)
_MAPS_DATA_LINK_RE = re.compile(r'href="(/search\?tbm=map[^"]+)"')
_URL_Q_RE = re.compile(r'/url\?q=(https?://[^&" ]+)', re.I)


_PIN_RE = re.compile(r"!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)")
_AT_RE = re.compile(r"@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)")


def coords_from_url(url: str) -> tuple[float, float] | None:
    """The place's own pin (!3d<lat>!4d<lng>) from a Maps place URL, else the
    @lat,lng the page centres on. None when the URL carries neither."""
    text = unquote(str(url or ""))
    pins = _PIN_RE.findall(text)
    match = pins[-1] if pins else None   # the last !3d!4d pair is the place itself
    if not match:
        at = _AT_RE.search(text)
        match = at.groups() if at else None
    if not match:
        return None
    lat, lng = float(match[0]), float(match[1])
    if not (-90 <= lat <= 90 and -180 <= lng <= 180) or (lat == 0 and lng == 0):
        return None
    return lat, lng


class _ItemIdParser(HTMLParser):
    """Collects every element carrying data-item-id (its attributes + inner
    text) and the first <h1> text from a place page's HTML."""
    VOID = {"img", "br", "hr", "input", "meta", "link", "source", "wbr", "area", "col", "embed", "param", "track"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items: list[dict] = []
        self.open: list[dict] = []
        self.h1: str | None = None
        self._in_h1 = False

    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        for it in self.open:
            if it["tag"] == tag:
                it["depth"] += 1
        if tag == "h1" and self.h1 is None:
            self._in_h1, self.h1 = True, ""
        if a.get("data-item-id") and tag not in self.VOID:
            it = {"tag": tag, "depth": 1, "id": a["data-item-id"], "aria": a.get("aria-label", ""), "href": a.get("href", ""), "text": ""}
            self.items.append(it)
            self.open.append(it)

    def handle_endtag(self, tag):
        if tag == "h1":
            self._in_h1 = False
        for it in list(self.open):
            if it["tag"] == tag:
                it["depth"] -= 1
                if it["depth"] == 0:
                    self.open.remove(it)

    def handle_data(self, data):
        for it in self.open:
            it["text"] += data
        if self._in_h1:
            self.h1 += data


def parse_place_html(page_html: str) -> dict:
    """Name, address, phones and website from a Maps place page, via data-item-id."""
    p = _ItemIdParser()
    try:
        p.feed(page_html or "")
    except Exception:  # malformed markup: keep whatever was read
        pass
    squash = lambda s: re.sub(r"\s+", " ", s or "").strip()
    address, website, phones = "", "", []
    for it in p.items:
        iid = it["id"]
        if iid == "address" and not address:
            address = squash(re.sub(r"^\s*Address:\s*", "", it["aria"])) or squash(it["text"])
        elif iid.startswith("phone:tel:"):
            phones.append(iid[len("phone:tel:"):] or it["aria"] or it["text"])
        elif iid == "authority" and not website:
            website = it["href"]
    return {"name": squash(p.h1 or ""), "address": address, "website": website, "phones": merge_phones(phones)}


def _maps_search_url(query: str) -> str:
    return f"https://www.google.com/maps/search/{quote_plus(query)}?hl=en"


async def _collect_place_links(fetcher_cls, query: str, limit: int) -> list[dict]:
    """Open the search feed, scroll it, return [{name, url}, ...] up to `limit`."""
    found: dict[str, str] = {}  # place url -> visible name, de-duped as we scroll

    async def scroll_feed(page):
        try:
            await page.wait_for_selector(_FEED_CONTAINER_SELECTOR, timeout=8000)
        except Exception:
            return  # blocked, or a genuinely empty search — caller treats [] honestly
        for _ in range(_FEED_SCROLL_ROUNDS):
            cards = await page.query_selector_all(_FEED_LINK_SELECTOR)
            for card in cards:
                href = await card.get_attribute("href")
                name = (await card.get_attribute("aria-label") or "").strip()
                if href and name:
                    found[href] = name
            if len(found) >= limit:
                break
            await page.evaluate(
                "(sel) => { const feed = document.querySelector(sel); "
                "if (feed) feed.scrollTop += feed.scrollHeight; }",
                _FEED_CONTAINER_SELECTOR,
            )
            await page.wait_for_timeout(900)

    try:
        await fetcher_cls.async_fetch(
            _maps_search_url(query), headless=True, network_idle=False, disable_resources=True,
            page_action=scroll_feed, timeout=25000,
        )
    except Exception as exc:
        logger.warning("Maps search page failed for %r: %s", query, exc)
        return []

    return [{"name": name, "url": url} for url, name in list(found.items())[:limit]]


async def _fetch_place_details(fetcher_cls, place: dict) -> dict | None:
    """Visit one place's own Maps page, read address/phone/website/rating."""
    try:
        page_obj = await fetcher_cls.async_fetch(place["url"], headless=True, network_idle=False,
                                                 disable_resources=True, timeout=20000)
    except Exception as exc:
        logger.warning("Maps place fetch failed for %s: %s", place["url"], exc)
        return None

    def text_of(sel: str) -> str:
        try:
            return (page_obj.css(f"{sel}::text").get() or "").strip()
        except Exception:
            return ""

    def attr_of(sel: str, attr: str) -> str:
        try:
            return (page_obj.css(f"{sel}::attr({attr})").get() or "").strip()
        except Exception:
            return ""

    page_html = ""
    for attr in ("html_content", "body", "text"):
        try:
            value = getattr(page_obj, attr, "")
            value = value.decode("utf-8", "ignore") if isinstance(value, bytes) else value
            if isinstance(value, str) and "<" in value:
                page_html = value
                break
        except Exception:
            continue
    parsed = parse_place_html(page_html)

    name = parsed["name"] or text_of(_NAME_SEL) or place.get("name") or ""
    if not name:
        return None  # nothing usable — never invent a record
    phones = parsed["phones"] or merge_phones([text_of(_PHONE_SEL)])
    coords = coords_from_url(place["url"]) or coords_from_url(str(getattr(page_obj, "url", "") or ""))

    rating_text = text_of(_RATING_SEL)
    rating_match = _RATING_RE.search(rating_text) if rating_text else None
    reviews_text = text_of(_REVIEWS_SEL)
    reviews_match = _REVIEWS_RE.search(reviews_text) if reviews_text else None

    return {
        "title": name,
        "address": parsed["address"] or text_of(_ADDRESS_SEL),
        "phone": phones[0]["number"] if phones else "",
        "phones": phones,
        "website": parsed["website"] or attr_of(_WEBSITE_SEL, "href"),
        "totalScore": rating_match.group(1) if rating_match else None,
        "reviewsCount": reviews_match.group(1).replace(",", "") if reviews_match else None,
        "url": place["url"],
        "categoryName": text_of(_CATEGORY_SEL),
        "countryCode": "IN",
        "latitude": coords[0] if coords else None,
        "longitude": coords[1] if coords else None,
    }


def _walk_lists(value):
    """Yield nested lists without depending on Google's shifting array indexes."""
    if isinstance(value, list):
        yield value
        for child in value:
            yield from _walk_lists(child)


def _number_between(value, lower: float, upper: float) -> float | None:
    if isinstance(value, (int, float)) and lower <= value <= upper:
        return float(value)
    if isinstance(value, list):
        for child in value:
            found = _number_between(child, lower, upper)
            if found is not None:
                return found
    return None


def _static_place_from_google_row(row: list) -> dict | None:
    """Decode one observed Google map-data row into the app's lead shape.

    Google changes the surrounding arrays frequently, so this intentionally
    anchors on the stable combination of address lines, website redirect,
    coordinates and title instead of hard-coding one absolute array path.
    """
    # A Maps response also contains locale, currency and viewport arrays with
    # plausible coordinates. Require the place's CID beside its own pin.
    address_lines = (
        [part.strip() for part in row[2] if isinstance(part, str) and part.strip()]
        if len(row) > 12 and isinstance(row[2], list) else []
    )
    if len(address_lines) < 2:
        return None
    website = ""
    for child in _walk_lists(row):
        for value in child:
            if isinstance(value, str):
                match = _URL_Q_RE.search(value)
                if match:
                    website = unquote(match.group(1))
                    break
        if website:
            break
    if not website:
        for child in _walk_lists(row):
            for value in child:
                if not isinstance(value, str) or not value.startswith(("http://", "https://")):
                    continue
                hostname = urlparse(value).hostname or ""
                if hostname and not any(
                    blocked in hostname.lower()
                    for blocked in ("google.", "gstatic.", "googleusercontent.", "ggpht.")
                ):
                    website = value.split("&", 1)[0]
                    break
            if website:
                break
    coordinate_index = next(
        (
            index
            for index, value in enumerate(row)
            if isinstance(value, list)
            and len(value) >= 4
            and all(isinstance(value[i], (int, float)) for i in (2, 3))
            and -90 <= value[2] <= 90
            and -180 <= value[3] <= 180
        ),
        -1,
    )
    coordinates = row[coordinate_index] if coordinate_index >= 0 else []
    if len(coordinates) < 4 or not all(isinstance(coordinates[i], (int, float)) for i in (2, 3)):
        return None
    if coordinate_index + 2 >= len(row) or not isinstance(row[coordinate_index + 1], str) or not re.fullmatch(
        r"0x[0-9a-f]+:0x[0-9a-f]+", row[coordinate_index + 1], re.I
    ) or not isinstance(row[coordinate_index + 2], str) or not row[coordinate_index + 2].strip():
        return None
    latitude, longitude = coordinates[2], coordinates[3]
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None
    title = next(
        (
            value.strip()
            for value in row[coordinate_index + 1 :]
            if isinstance(value, str)
            and value.strip()
            and not value.startswith("0x")
            and not value.startswith("0ah")
            and not value.startswith("2ah")
            and not value.startswith("http")
        ),
        "",
    )
    if not title:
        return None
    rating = _number_between(row[:coordinate_index], 0.0, 5.0)
    place_id = row[coordinate_index + 1] if coordinate_index + 1 < len(row) and isinstance(row[coordinate_index + 1], str) else ""
    category_values = next(
        (
            [value.strip() for value in value_list if isinstance(value, str) and value.strip()]
            for value_list in row[coordinate_index + 1 :]
            if isinstance(value_list, list)
            and any(isinstance(value, str) and value.strip() for value in value_list)
        ),
        [],
    )
    address = ", ".join(dict.fromkeys(address_lines))
    maps_url = f"https://www.google.com/maps/search/?api=1&query={quote_plus(title)}"
    if place_id:
        maps_url += f"&query_place_id={quote_plus(place_id)}"
    return {
        "title": title,
        "address": address,
        "phone": "",
        "phones": [],
        "website": website,
        "totalScore": str(rating) if rating is not None else None,
        "reviewsCount": None,
        "url": maps_url,
        "categoryName": ", ".join(dict.fromkeys(category_values[:5])),
        "countryCode": "IN",
        "latitude": latitude,
        "longitude": longitude,
    }


async def _static_google_maps_search(query: str, limit: int) -> list[dict]:
    """Fallback for Maps' client-rendered feed when its DOM selectors drift."""
    try:
        import httpx
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(25.0),
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"},
        ) as client:
            shell = await client.get(_maps_search_url(query))
            shell.raise_for_status()
            match = _MAPS_DATA_LINK_RE.search(shell.text)
            if not match:
                logger.warning("Google Maps data link was not found for %r", query)
                return []
            data_url = urljoin(str(shell.url), html.unescape(match.group(1)))
            response = await client.get(data_url)
            response.raise_for_status()
            payload = response.text
        payload = payload[payload.find("\n") + 1:] if "\n" in payload else payload
        decoded = json.loads(payload)
    except Exception as exc:
        logger.warning("Static Google Maps fallback failed for %r: %s", query, exc)
        return []

    results: list[dict] = []
    seen: set[str] = set()
    for row in _walk_lists(decoded):
        item = _static_place_from_google_row(row)
        if not item:
            continue
        key = f"{item['title'].casefold()}|{item['address'].casefold()}"
        if key in seen:
            continue
        seen.add(key)
        results.append(item)
        if len(results) >= limit:
            break
    logger.info("Static Google Maps fallback returned %d records for %r", len(results), query)
    return results


async def discover_businesses(query: str, target_count: int, concurrency: int = 2) -> list[dict]:
    """Search Google Maps for `query` (e.g. "IT Companies in Gurugram") and
    return up to `target_count` real business records, shaped exactly like
    the app's old Apify records — so the existing normalise()/scoreAndTrim()
    pipeline in real-scraper.js needs no changes at all."""
    try:
        from scrapling.fetchers import DynamicFetcher
    except ImportError as exc:
        raise RuntimeError(
            'Scrapling is not installed on the backend yet. Run once in the backend '
            'folder: pip install "scrapling[fetchers]" && scrapling install'
        ) from exc

    # Without the Chromium binary every DynamicFetcher call fails and we fall
    # through to the static parser, whose records carry no phone number — the
    # "leads come back empty" symptom. Put it there once, off the event loop.
    from .browser_runtime import ensure_browser
    if not await asyncio.to_thread(ensure_browser):
        logger.warning(
            "Maps search for %r is running without a browser — static fallback only "
            "(no phone numbers). Run: python -m playwright install chromium", query)

    places = await _collect_place_links(DynamicFetcher, query, target_count)
    if not places:
        static_items = await _static_google_maps_search(query, target_count)
        if static_items:
            return static_items
        logger.warning("Maps search returned nothing for %r — blocked, or the page layout changed", query)
        return []

    sem = asyncio.Semaphore(max(1, concurrency))

    async def guarded(place):
        async with sem:
            return await _fetch_place_details(DynamicFetcher, place)

    fetched = [item for item in await asyncio.gather(*(guarded(p) for p in places)) if item]
    if fetched:
        return fetched
    return await _static_google_maps_search(query, target_count)
