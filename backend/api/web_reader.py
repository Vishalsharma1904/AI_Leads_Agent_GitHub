"""Read a public web page for Clavis — in the background, nothing on screen.

POST /api/v1/web/read {url, screenshot?, follow_contact?}

Fast path: plain HTTP (httpx) + a stdlib HTML parser. When the page is a
JavaScript shell (almost no text) or a screenshot is wanted, it is rendered
in a real headless browser through Scrapling's DynamicFetcher (already a
backend dependency for Maps discovery). Returns what an assistant actually
needs from a site: title, description, headings, readable text, emails,
phones, social links, fonts and colours (for "what's their theme /
typography?"), and optionally a JPEG screenshot for the voice model's eyes.

Only public http(s) hosts are fetched: loopback, private, link-local and
reserved addresses are refused, so a prompt can't point this at the
machine's own services or the LAN.
"""
from __future__ import annotations

import base64
import ipaddress
import re
import socket
from collections import Counter
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/web", tags=["web"])

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")
_MAX_HTML = 3_000_000
_MAX_CSS = 400_000
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}")
_PHONE_RE = re.compile(r"(?<!\d)(?:\+?\d[\d\s().-]{8,16}\d)(?!\d)")
_HEX_RE = re.compile(r"#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b")
_FONT_RE = re.compile(r"font-family\s*:\s*([^;}{]+)", re.I)
_GFONT_RE = re.compile(r"family=([^&:]+)")
_SOCIAL = ("linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com",
           "youtube.com", "wa.me", "whatsapp.com", "t.me", "github.com")
_GENERIC_FONTS = {"sans-serif", "serif", "monospace", "system-ui", "inherit", "initial",
                  "-apple-system", "blinkmacsystemfont", "ui-sans-serif", "ui-serif", "cursive"}
_FAKE_EMAIL = re.compile(r"\.(png|jpe?g|gif|svg|webp)$|example\.|sentry|wixpress|@2x", re.I)


class _Page(HTMLParser):
    """Single pass over the HTML: text, headings, links, metas, styles."""

    _SKIP = {"script", "style", "noscript", "svg", "template", "iframe"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.meta: dict[str, str] = {}
        self.headings: list[str] = []
        self.links: list[tuple[str, str]] = []
        self.stylesheets: list[str] = []
        self.styles: list[str] = []
        self.text: list[str] = []
        self._skip = 0
        self._in_title = False
        self._heading: list[str] | None = None
        self._link: list | None = None
        self._in_style = False

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag in self._SKIP:
            self._skip += 1
            self._in_style = tag == "style"
        if a.get("style"):
            self.styles.append(a["style"])
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            key = (a.get("name") or a.get("property") or "").lower()
            if key and a.get("content"):
                self.meta[key] = a["content"]
        elif tag == "link" and "stylesheet" in a.get("rel", "").lower() and a.get("href"):
            self.stylesheets.append(a["href"])
        elif tag in ("h1", "h2", "h3"):
            self._heading = []
        elif tag == "a" and a.get("href"):
            self._link = [a["href"], []]

    def handle_endtag(self, tag):
        if tag in self._SKIP and self._skip:
            self._skip -= 1
            self._in_style = False
        if tag == "title":
            self._in_title = False
        elif tag in ("h1", "h2", "h3") and self._heading is not None:
            h = " ".join("".join(self._heading).split())
            if h:
                self.headings.append(h[:160])
            self._heading = None
        elif tag == "a" and self._link is not None:
            self.links.append((self._link[0], " ".join("".join(self._link[1]).split())[:80]))
            self._link = None

    def handle_data(self, data):
        if self._in_style:
            self.styles.append(data)
            return
        if self._skip:
            return
        if self._in_title:
            self.title += data
            return
        if self._heading is not None:
            self._heading.append(data)
        if self._link is not None:
            self._link[1].append(data)
        chunk = data.strip()
        if chunk:
            self.text.append(chunk)


def _check_public(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Only public http(s) web pages can be read.")
    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror as exc:
        raise HTTPException(status_code=400, detail=f"That website address could not be found ({parsed.hostname}).") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise HTTPException(status_code=400, detail="Local or private network addresses are not read.")
    return url


async def _get(client: httpx.AsyncClient, url: str, limit: int) -> tuple[str, str]:
    _check_public(url)
    async with client.stream("GET", url) as res:
        res.raise_for_status()
        body = b""
        async for chunk in res.aiter_bytes():
            body += chunk
            if len(body) > limit:
                break
        return str(res.url), body.decode(res.encoding or "utf-8", errors="replace")


async def _render(url: str, want_shot: bool) -> tuple[str, str | None]:
    """Real headless browser (Scrapling DynamicFetcher -> Playwright page)."""
    try:
        from scrapling.fetchers import DynamicFetcher
    except ImportError:
        return "", None
    out: dict = {}

    async def grab(page):
        try:
            out["html"] = await page.content()
            if want_shot:
                out["shot"] = await page.screenshot(type="jpeg", quality=62, full_page=False)
        except Exception:  # a page that fights automation still gives us whatever we got
            pass

    try:
        await DynamicFetcher.async_fetch(url, headless=True, network_idle=True, page_action=grab, timeout=25000)
    except Exception:
        pass
    shot = base64.b64encode(out["shot"]).decode() if out.get("shot") else None
    return out.get("html", ""), shot


def _analyse(base_url: str, html: str, css: str) -> dict:
    p = _Page()
    try:
        p.feed(html)
    except Exception:
        pass
    text = " ".join(" ".join(p.text).split())
    host = urlparse(base_url).hostname or ""
    blob = html + " " + text
    emails = sorted({e.lower() for e in _EMAIL_RE.findall(blob) if not _FAKE_EMAIL.search(e)})
    phones = []
    for raw in _PHONE_RE.findall(text):
        digits = re.sub(r"\D", "", raw)
        if 10 <= len(digits) <= 13 and raw.strip() not in phones:
            phones.append(raw.strip())
    social, internal = [], []
    for href, label in p.links:
        full = urljoin(base_url, href)
        h = urlparse(full).hostname or ""
        if href.startswith("mailto:"):
            addr = href[7:].split("?")[0].lower()
            if addr and addr not in emails:
                emails.append(addr)
        elif any(s in h for s in _SOCIAL):
            if full not in social:
                social.append(full)
        elif h.endswith(host) and label and len(internal) < 40:
            internal.append({"text": label, "url": full})
    styles = css + " " + " ".join(p.styles)
    fonts = Counter()
    for decl in _FONT_RE.findall(styles):
        first = decl.split(",")[0].replace("\\", "").strip().strip("'\"").strip()
        if first and first.lower() not in _GENERIC_FONTS and not first.startswith("var("):
            fonts[first] += 1
    for sheet in p.stylesheets:
        if "fonts.googleapis.com" in sheet:
            for fam in _GFONT_RE.findall(sheet):
                fonts[fam.replace("+", " ")] += 3
    colors = Counter(c.lower() for c in _HEX_RE.findall(styles))
    return {
        "url": base_url,
        "title": " ".join(p.title.split())[:200],
        "description": (p.meta.get("description") or p.meta.get("og:description") or "")[:400],
        "headings": p.headings[:20],
        "text": text[:12000],
        "emails": emails[:25],
        "phones": phones[:15],
        "social": social[:15],
        "links": internal,
        "fonts": [f for f, _ in fonts.most_common(8)],
        "colors": [c for c, _ in colors.most_common(10)],
        "theme_color": p.meta.get("theme-color", ""),
        "_stylesheets": [urljoin(base_url, s) for s in p.stylesheets[:4]],
    }


class ReadRequest(BaseModel):
    url: str = Field(min_length=4, max_length=2000)
    screenshot: bool = False
    follow_contact: bool = False


@router.post("/read")
async def read_page(req: ReadRequest):
    url = req.url.strip()
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    _check_public(url)
    html, final_url, rendered, shot = "", url, False, None
    async def _no_private_redirects(request: httpx.Request) -> None:
        _check_public(str(request.url))   # every hop, not just the first URL

    async with httpx.AsyncClient(follow_redirects=True, timeout=15, headers={"User-Agent": _UA},
                                 event_hooks={"request": [_no_private_redirects]}) as client:
        try:
            final_url, html = await _get(client, url, _MAX_HTML)
        except HTTPException:
            raise
        except Exception:
            html = ""
        data = _analyse(final_url, html, "")
        # A JS-only shell, a blocked plain fetch, or a request to see it: use a real browser.
        if len(data["text"]) < 400 or req.screenshot:
            r_html, shot = await _render(final_url, req.screenshot)
            if r_html and len(r_html) > len(html) // 2:
                html, rendered = r_html, True
                data = _analyse(final_url, html, "")
        css_parts = []
        for sheet in data.pop("_stylesheets"):
            try:
                css_parts.append((await _get(client, sheet, _MAX_CSS))[1])
            except Exception:
                continue
        if css_parts:
            styled = _analyse(final_url, html, " ".join(css_parts))
            data["fonts"], data["colors"] = styled["fonts"], styled["colors"]
            styled.pop("_stylesheets", None)
        if req.follow_contact:
            extra = [l["url"] for l in data["links"] if re.search(r"contact|about|reach|support", l["url"] + l["text"], re.I)][:2]
            for link in extra:
                try:
                    sub = _analyse(link, (await _get(client, link, _MAX_HTML))[1], "")
                except Exception:
                    continue
                sub.pop("_stylesheets", None)
                data["emails"] = sorted(set(data["emails"]) | set(sub["emails"]))[:25]
                data["phones"] = (data["phones"] + [p for p in sub["phones"] if p not in data["phones"]])[:15]
    if not data["text"] and not data["title"]:
        raise HTTPException(status_code=502, detail="The page returned nothing readable (it may block automated readers).")
    data["rendered"] = rendered
    data["screenshot"] = shot
    return data


_VQD_RE = re.compile(r"vqd=['\"]?([\d-]+)")


async def _ddg_images(client: httpx.AsyncClient, q: str, n: int) -> list[dict]:
    """DuckDuckGo's image search (unofficial: the same JSON its own page uses).
    Can change without notice; callers fall back to Wikimedia Commons."""
    page = await client.get("https://duckduckgo.com/", params={"q": q, "iax": "images", "ia": "images"})
    m = _VQD_RE.search(page.text)
    if not m:
        return []
    res = await client.get("https://duckduckgo.com/i.js", params={"l": "wt-wt", "o": "json", "q": q, "vqd": m.group(1), "f": ",,,,,", "p": "1"},
                           headers={"Referer": "https://duckduckgo.com/", "Accept": "application/json"})
    res.raise_for_status()
    out = []
    for r in (res.json().get("results") or [])[: n * 2]:
        full, thumb = r.get("image"), r.get("thumbnail") or r.get("image")
        if not full or not thumb:
            continue
        out.append({"thumb": thumb, "full": full, "title": (r.get("title") or q)[:140],
                    "source": r.get("source") or urlparse(r.get("url") or full).hostname or "web", "page": r.get("url") or full})
    return out[:n]


async def _commons_images(client: httpx.AsyncClient, q: str, n: int) -> list[dict]:
    res = await client.get("https://commons.wikimedia.org/w/api.php", params={
        "action": "query", "format": "json", "generator": "search", "gsrnamespace": "6", "gsrlimit": str(n + 6),
        "gsrsearch": q, "prop": "imageinfo", "iiprop": "url|mime", "iiurlwidth": "720"})
    pages = sorted((res.json().get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 0))
    out = []
    for p in pages:
        ii = (p.get("imageinfo") or [{}])[0]
        if not re.match(r"image/(jpeg|png|webp)", ii.get("mime", "")):
            continue
        out.append({"thumb": ii.get("thumburl") or ii.get("url"), "full": ii.get("url"),
                    "title": re.sub(r"\.[a-z]+$", "", str(p.get("title", "")).replace("File:", ""), flags=re.I),
                    "source": "Wikimedia Commons", "page": ii.get("descriptionurl")})
    return out[:n]


@router.get("/images")
async def image_search(q: str, n: int = 9):
    """Pictures for Clavis's display: web image search, Wikimedia as backup."""
    q = q.strip()[:200]
    if not q:
        raise HTTPException(status_code=400, detail="Empty image query.")
    n = max(1, min(12, n))
    async with httpx.AsyncClient(follow_redirects=True, timeout=10, headers={"User-Agent": _UA}) as client:
        items: list[dict] = []
        try:
            items = await _ddg_images(client, q, n)
        except Exception:
            items = []
        if len(items) < 3:
            try:
                items += await _commons_images(client, q, n - len(items))
            except Exception:
                pass
    return {"query": q, "items": items[:n]}


def _demo() -> None:
    """Runnable check for the parser: python -m api.web_reader"""
    html = """<html><head><title> Acme Security </title><meta name="description" content="Guards for offices">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400">
      <style>body{font-family:'Inter Tight',sans-serif;color:#1a1a1a} a{color:#4F583B}</style></head>
      <body><h1>Trusted guards</h1><script>var x='no@script.com'</script>
      <p>Call +91 98765 43210 or write to sales@acme.in</p>
      <a href="mailto:hr@acme.in">HR</a><a href="https://www.linkedin.com/company/acme">in</a>
      <a href="/contact">Contact us</a></body></html>"""
    d = _analyse("https://acme.in/", html, "")
    assert d["title"] == "Acme Security", d["title"]
    assert "sales@acme.in" in d["emails"] and "hr@acme.in" in d["emails"], d["emails"]
    assert d["phones"] == ["+91 98765 43210"], d["phones"]
    assert d["social"] == ["https://www.linkedin.com/company/acme"], d["social"]
    assert d["fonts"][0] == "Inter Tight", d["fonts"]
    assert "#4f583b" in d["colors"], d["colors"]
    assert d["headings"] == ["Trusted guards"], d["headings"]
    assert "no@script.com" not in d["text"]
    assert d["links"] == [{"text": "Contact us", "url": "https://acme.in/contact"}], d["links"]
    for bad in ("http://127.0.0.1:8000/x", "http://192.168.1.5/", "file:///etc/passwd"):
        try:
            _check_public(bad)
            raise AssertionError(f"should refuse {bad}")
        except HTTPException:
            pass
    print("web_reader demo: all checks passed")


if __name__ == "__main__":
    _demo()
