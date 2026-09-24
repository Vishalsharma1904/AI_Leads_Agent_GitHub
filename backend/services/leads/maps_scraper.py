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
from urllib.parse import parse_qs, quote_plus, unquote, urljoin, urlparse

logger = logging.getLogger(__name__)

_FEED_SCROLL_ROUNDS = 6
_FEED_CONTAINER_SELECTOR = 'div[role="feed"]'
_FEED_LINK_SELECTOR = "a.hfpxzc"

# Place-detail-page selectors (Google Maps, current as of late 2026).
_NAME_SEL = "h1.DUwDvf.lfPIob"
_ADDRESS_SEL = ".RcCsl:nth-child(3) .Io6YTe"
_PHONE_SEL = ".RcCsl:nth-child(5) .Io6YTe"
_WEBSITE_SEL = ".RcCsl:nth-child(4) a.CsEnBe"
_RATING_SEL = ".ceNzKf"
_REVIEWS_SEL = ".F7nice"

_RATING_RE = re.compile(r"(\d(?:\.\d)?)")
_REVIEWS_RE = re.compile(r"([\d,]{1,7})\s*review", re.I)
_MAPS_DATA_LINK_RE = re.compile(r'href="(/search\?tbm=map[^"]+)"')
_URL_Q_RE = re.compile(r'/url\?q=(https?://[^&" ]+)', re.I)


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
            _maps_search_url(query), headless=True, network_idle=True,
            page_action=scroll_feed, timeout=25000,
        )
    except Exception as exc:
        logger.warning("Maps search page failed for %r: %s", query, exc)
        return []

    return [{"name": name, "url": url} for url, name in list(found.items())[:limit]]


async def _fetch_place_details(fetcher_cls, place: dict) -> dict | None:
    """Visit one place's own Maps page, read address/phone/website/rating."""
    try:
        page_obj = await fetcher_cls.async_fetch(place["url"], headless=True, network_idle=True, timeout=20000)
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

    name = text_of(_NAME_SEL) or place.get("name") or ""
    if not name:
        return None  # nothing usable — never invent a record

    rating_text = text_of(_RATING_SEL)
    rating_match = _RATING_RE.search(rating_text) if rating_text else None
    reviews_text = text_of(_REVIEWS_SEL)
    reviews_match = _REVIEWS_RE.search(reviews_text) if reviews_text else None

    return {
        "title": name,
        "address": text_of(_ADDRESS_SEL),
        "phone": text_of(_PHONE_SEL),
        "website": attr_of(_WEBSITE_SEL, "href"),
        "totalScore": rating_match.group(1) if rating_match else None,
        "reviewsCount": reviews_match.group(1).replace(",", "") if reviews_match else None,
        "url": place["url"],
        "categoryName": "",
        "countryCode": "IN",
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
    address_lines = next(
        (
            [str(part).strip() for part in value if isinstance(part, str) and part.strip()]
            for value in row
            if isinstance(value, list)
            and sum(isinstance(part, str) and bool(part.strip()) for part in value) >= 2
            and not any(isinstance(part, str) and "/url?q=" in part for part in value)
        ),
        [],
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
