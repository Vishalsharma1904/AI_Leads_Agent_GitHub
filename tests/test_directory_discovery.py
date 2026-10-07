"""Run: backend/.venv312/Scripts/python.exe tests/test_directory_discovery.py"""
import asyncio
import json
import pathlib
import sys
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
from services.leads import directory_discovery as discovery
from services.leads.website_crawler import _apply_findings, pick_email, _clean_url

body = '''<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.sulekha.com%2Falpha-hospital-delhi-contact-address">Alpha Hospital in Delhi | Sulekha</a>
<a class="result__a" href="https://www.sulekha.com/hospitals/delhi">Top 10 Hospitals in Delhi</a>
<a class="result__a" href="https://sulekha.com.evil.test/x">Wrong Host in Delhi</a>'''
rows = discovery.indexed_candidates(body, "sulekha", "Delhi")
assert len(rows) == 1 and rows[0]["name"] == "Alpha Hospital"
assert discovery.same_company("Alpha Hospital Pvt. Ltd.", "Alpha Hospital")
assert not discovery.same_company("Alpha Hospital", "Alpha Hospital Branch Two")
assert pick_email(["wrong@notalpha.in", "info@alpha.in"], "alpha.in") == "info@alpha.in"
assert not _clean_url("https://www.sulekha.com/alpha")
assert not _clean_url("https://[::1]/")

record = {"email": "old@other.in", "phone": "+91 98100 11111"}
_apply_findings(record, "alpha.in", {"people": [], "urls": ["https://alpha.in/contact"]},
                ["info@alpha.in", "hr@alpha.in"], [{"number": "+91 98100 22222", "kind": "mobile"}],
                "https://alpha.in/contact", "fixture-time")
assert record["email"] == "info@alpha.in" and len(record["emails"]) == 2
assert record["phoneOwnership"] == "company_contact" and not record.get("contactPerson")
result = discovery.public_lead({**record, "discoveryEvidence": rows, "source": "Sulekha",
                                "authorityCandidate": {"source_url": "https://justdial.com/x"}})
assert "sulekha" not in json.dumps(result).lower() and "justdial" not in json.dumps(result).lower()

class Client:
    def __init__(self, **kwargs): pass
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    async def post(self, *args, **kwargs):
        class Response:
            text = body
            def raise_for_status(self): pass
        return Response()

async def check():
    existing = [{"title": "Alpha Hospital", "address": "Delhi", "phone": "+91 98100 11111"}]
    async def no_lookup(*args, **kwargs): raise AssertionError("Existing matching identity needs no paid/browser lookup")
    with patch.object(discovery.httpx, "AsyncClient", Client):
        extra = await discovery.discover_indexed_businesses(["Hospitals in Delhi"], ["sulekha"],
                    existing=existing, discover=no_lookup, matches_city=lambda city, place: city in place)
        assert not extra and existing[0]["discoveryEvidence"][0]["provider"] == "sulekha"
        async def unrelated(*args, **kwargs): return [{"title": "Other Hospital", "address": "Delhi", "phone": "9999999999"}]
        extra = await discovery.discover_indexed_businesses(["Hospitals in Delhi"], ["sulekha"],
                    existing=[], discover=unrelated, matches_city=lambda city, place: city in place)
        assert not extra, "An unrelated company cannot inherit directory evidence"
        assert not await discovery.discover_indexed_businesses(["Hospitals in Delhi"], ["sulekha"],
                    existing=[], discover=no_lookup, matches_city=lambda *args: True, cancelled=lambda: True)

    class WebsiteClient(Client):
        async def post(self, *args, **kwargs):
            class Response:
                text = '<a class="result__a" href="https://alpha.in/">Alpha Hospital</a>'
            return Response()
    async def page(*args):
        return "https://alpha.in/", '<title>Alpha Hospital</title><p>Find us in Delhi</p>'
    import api.web_reader as reader
    records = [{"title": "Alpha Hospital", "city": "Delhi"}, {"title": "Other Hospital", "city": "Delhi"}]
    with patch.object(discovery.httpx, "AsyncClient", WebsiteClient), patch.object(reader, "_get", page):
        await discovery.recover_company_websites(records, lambda city, text: city in text)
    assert records[0]["website"] == "https://alpha.in/" and not records[1].get("website")

asyncio.run(check())
print("Directory identity, bounded discovery, source privacy, contact quality: passed")
