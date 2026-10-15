"""Real service-worker install/offline shell; no accounts or provider calls."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]/'pwa'
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch()
        context=browser.new_context(viewport={'width':390,'height':844})
        page=context.new_page()
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.wait_for_function("navigator.serviceWorker.controller !== null",timeout=30000)
        keys=page.evaluate("caches.keys()")
        assert 'rudra24-mobile-v3' in keys
        cached=page.evaluate("caches.open('rudra24-mobile-v3').then(c=>c.keys()).then(keys=>keys.map(x=>x.url))")
        assert not any('/api/' in key for key in cached)
        assert any('icon-192.png' in key for key in cached)
        context.set_offline(True)
        page.reload()
        page.get_by_role('heading',name='Welcome to Rudra24').wait_for()
        assert page.get_by_role('button',name='Continue with Google').is_visible()
        browser.close()
finally:
    server.shutdown();server.server_close()
print('PASS: service worker installed, offline shell works, install icons cached, API data excluded')
