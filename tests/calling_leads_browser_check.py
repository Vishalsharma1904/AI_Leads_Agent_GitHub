"""Run with backend/.venv312/Scripts/python.exe; isolated browser, no real calls."""
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
engine = (root / "sarvam-calling.js").read_text(encoding="utf-8")
ui = (root / "sarvam-calling-ui.js").read_text(encoding="utf-8").split(
    "/* ============================================================\n *  VoiceProvider"
)[0]
setup = """
window.fixtureSubmissions=[];
window.UserStorage={getUserId:()=> 'fixture-owner',getJSON:()=>[
 {id:'a',company:'Hotel A',phone:'9876543210'},
 {id:'duplicate',company:'Duplicate',phone:'+91-98765-43210'},
 {id:'b',company:'Hotel B',phone:'9876543211'},
 {id:'invalid',company:'No phone',phone:''}
]};
window.VoiceProvider={current:()=> 'elevenlabs'};
window.ClavisIcons={apply(){}};
window.showToast=()=>{};
window.showView=()=>{};
window.confirm=()=>false;
window.fetch=async()=>({ok:true,json:async()=>({message:'Calling API is running'})});
window.ElevenLabsStudio={mountCalling(){},batchConfiguration:()=>({agentReady:true,phoneNumberId:'fixture-phone'}),loadBatchCalls:async()=>({batch_calls:[]}),
 submitBatch:async leads=>{fixtureSubmissions.push(leads);return {batch_id:'fixture-batch',uncertain:false}}};
"""
html = '<div id="view-calling" class="active"></div><div id="view-leads"></div>'
html += "<script>" + setup + engine + ui + "</script>"
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1366, "height": 768})
    page.route("http://calling.test/**", lambda route: route.fulfill(body=html, content_type="text/html"))
    page.goto("http://calling.test/#calling")
    page.locator("#sc-fetch-leads").click()
    page.wait_for_function("document.querySelector('#sc-queue-count').textContent === '2'")
    page.locator("#sc-fetch-leads").click()
    assert page.locator("#sc-queue-count").inner_text() == "2"
    assert page.locator("[data-select-lead]").count() == 2
    page.locator("#sc-select-all").check()
    page.locator("#sc-batch-n").fill("1")
    page.get_by_role("button", name="Review & submit").click()
    assert page.evaluate("fixtureSubmissions.length") == 0
    page.evaluate("window.confirm=()=>true")
    page.get_by_role("button", name="Review & submit").click()
    page.wait_for_function("fixtureSubmissions.length === 1")
    assert page.evaluate("fixtureSubmissions[0].length") == 1
    assert page.evaluate("fixtureSubmissions[0][0].phone") == "+919876543210"
    browser.close()
print(json.dumps({"imported": 2, "duplicates_ignored": True, "confirmation_required": True, "batch_limit": 1}))
