"""Plain-assert tests for the lead parsers (stdlib only, no network).
Run: python3 tests/test_leads_parsing.py"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "backend"))

from services.leads.maps_scraper import coords_from_url, parse_place_html, _static_place_from_google_row  # noqa: E402
from services.leads.website_crawler import (  # noqa: E402
    authority_from_jsonld, authority_from_text, extract_contacts, merge_phones,
    normalise_indian_phone, pick_authority, pick_email,
)


def test_coords_from_url():
    url = ("https://www.google.com/maps/place/Alpha+Facility/@28.6712,77.4498,17z/data=!3m1!4b1"
           "!4m6!3m5!1s0x390cf1:0xabc!8m2!3d28.6711452!4d77.4512093!16s%2Fg%2F11abc")
    assert coords_from_url(url) == (28.6711452, 77.4512093)          # the pin, not the viewport
    assert coords_from_url("https://www.google.com/maps/@28.7322,77.2946,15z") == (28.7322, 77.2946)
    assert coords_from_url("https://www.google.com/maps/place/x/data=%213d28.5%214d77.3") == (28.5, 77.3)
    assert coords_from_url("https://www.google.com/maps/search/security+ghaziabad") is None
    assert coords_from_url("https://www.google.com/maps/@0.0,0.0,3z") is None
    assert coords_from_url("") is None


def test_static_maps_row_requires_place_identity():
    row = [None] * 20
    row[2] = ["Tower S-2", "Ghaziabad, Uttar Pradesh"]
    row[9] = [None, None, 28.64, 77.33]
    row[10] = "0x390cfb:0x885fd6"
    row[11] = "The Roseman Hotel"
    assert _static_place_from_google_row(row)["title"] == "The Roseman Hotel"
    row[10] = "INR"
    assert _static_place_from_google_row(row) is None


PLACE_HTML = """
<div role="main"><h1 class="DUwDvf lfPIob">Alpha Facility Services Pvt Ltd <span></span></h1>
<button class="CsEnBe" data-item-id="address" aria-label="Address: C-12, RDC, Raj Nagar, Ghaziabad, Uttar Pradesh 201002 ">
  <div class="Io6YTe">C-12, RDC, Raj Nagar, Ghaziabad</div></button>
<a class="CsEnBe" data-item-id="authority" href="https://alphafacility.in/" aria-label="Website: alphafacility.in"><div>alphafacility.in</div></a>
<button data-item-id="phone:tel:01204567890" aria-label="Phone: 0120 456 7890"><div class="Io6YTe">0120 456 7890</div></button>
<button data-item-id="phone:tel:+919810011111" aria-label="Phone: 098100 11111"><div><div class="Io6YTe">098100 11111</div></div></button>
<img data-item-id="photo" src="x.png">
<button data-item-id="oloc">Plus code</button></div>
"""


def test_parse_place_html():
    p = parse_place_html(PLACE_HTML)
    assert p["name"] == "Alpha Facility Services Pvt Ltd", p
    assert p["address"] == "C-12, RDC, Raj Nagar, Ghaziabad, Uttar Pradesh 201002", p
    assert p["website"] == "https://alphafacility.in/", p
    assert [x["number"] for x in p["phones"]] == ["+91 98100 11111", "+91 1204567890"], p   # mobile first
    assert [x["kind"] for x in p["phones"]] == ["mobile", "landline"]
    empty = parse_place_html("<div class='x'>no semantic ids here</div>")
    assert empty == {"name": "", "address": "", "website": "", "phones": []}, empty


def test_phone_normalisation():
    n = normalise_indian_phone
    assert n("+91 98100 11111") == {"number": "+91 98100 11111", "kind": "mobile"}
    assert n("09810011111")["number"] == "+91 98100 11111"
    assert n("0091-9810011111")["number"] == "+91 98100 11111"
    assert n("919810011111")["kind"] == "mobile"
    assert n("0120-4567890") == {"number": "+91 1204567890", "kind": "landline"}
    assert n("011 2345 6789")["kind"] == "landline"
    assert n("1800 180 1234")["kind"] == "tollfree"
    for bad in ("12345", "0000000000", "9999999999", "2021-2025", "+1 415 555 0100", ""):
        assert n(bad) is None, bad
    merged = merge_phones(["0120 4567890", "+91 98100 11111", "9810011111", {"number": "+91 99990 33333", "kind": "mobile"}])
    assert [p["number"] for p in merged] == ["+91 98100 11111", "+91 99990 33333", "+91 1204567890"], merged


def test_extract_contacts():
    text = ("Call us: +91-98100 11111, 0120-4567890 or 99990 33333. Mail info@alphafacility.in / "
            "rakesh.sharma@alphafacility.in. logo@2x.png  Established 2008-2012. GST 09AAACA1234F1Z5")
    emails, phones = extract_contacts(text)
    assert emails == ["info@alphafacility.in", "rakesh.sharma@alphafacility.in"], emails
    assert [p["number"] for p in phones] == ["+91 98100 11111", "+91 99990 33333", "+91 1204567890"], phones
    assert pick_email(["hello@gmail.com", "noreply@alpha.in", "sales@alpha.in"], "alpha.in") == "sales@alpha.in"


JSONLD = """<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Alpha Facility",
 "founder":{"@type":"Person","name":"Rakesh Sharma"},
 "employee":[{"@type":"Person","name":"Neha Jain","jobTitle":"HR Manager"},{"@type":"Person","name":"Amit Verma","jobTitle":"Sales Executive"}]}</script>
<script type="application/ld+json">{"@graph":[{"@type":"Person","name":"Sunil Kapoor","jobTitle":"Managing Director"}]}</script>
<script type="application/ld+json">{ broken json </script>
</head></html>"""


def test_authority_jsonld():
    people = authority_from_jsonld(JSONLD)
    names = {(p["contactPerson"], p["designation"]) for p in people}
    assert ("Rakesh Sharma", "Founder") in names, people
    assert ("Neha Jain", "HR Manager") in names, people
    assert ("Sunil Kapoor", "Managing Director") in names, people
    assert not any(p["contactPerson"] == "Amit Verma" for p in people), people   # not an authority title
    best = pick_authority(people, "https://alpha.in/about")
    assert best == {"contactPerson": "Sunil Kapoor", "designation": "Managing Director", "source_url": "https://alpha.in/about", "confidence": 0.9}, best
    # negatives
    assert authority_from_jsonld('<script type="application/ld+json">{"@type":"Organization","name":"Alpha Security Services"}</script>') == []
    assert authority_from_jsonld('<script type="application/ld+json">{"@type":"Person","name":"Our Team","jobTitle":"Director"}</script>') == []


def test_authority_text():
    def top(text):
        best = pick_authority(authority_from_text(text), "u")
        return best and (best["contactPerson"], best["designation"])

    assert top("Welcome.\nRakesh Sharma, Managing Director\nWe provide guards.") == ("Rakesh Sharma", "Managing Director")
    assert top("Proprietor: Anil Kumar Gupta") == ("Anil Kumar Gupta", "Proprietor")
    assert top("Our Team\nMr. Vikas Malhotra\nDirector\nPriya Singh\nFacility Manager") == ("Mr. Vikas Malhotra", "Director")
    assert top("The company was founded by Neha Jain in 2004.") == ("Neha Jain", "Founder")
    assert top("Sanjay Mehta (CEO) and Ritu Mehta (Co-founder)") == ("Sanjay Mehta", "CEO")
    assert top("Contact Admin Manager: Deepak Rawat for site visits") == ("Deepak Rawat", "Admin Manager")
    assert top("Message from our Director Mr. Rajiv Bansal") == ("Mr. Rajiv Bansal", "Director")
    # negatives: never guess a person
    for text in (
        "Contact our HR Manager for openings.",
        "Our Directors have 20 years of experience in security services.",
        "Managing Director's Message\nWe are committed to quality.",
        "Alpha Security Services, Director of Operations",
        "Sales Executive: Amit Verma",
        "Owner-operated since 1998. Call 9810011111.",
        "",
    ):
        assert top(text) is None, (text, authority_from_text(text))


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print("PASS", t.__name__)
        except AssertionError as e:
            failed += 1
            print("FAIL", t.__name__, e)
    print(f"{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
