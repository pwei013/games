"""Optional actual-browser QA. Requires Python 3, playwright, and Chromium.

    python3 -m pip install playwright
    python3 -m playwright install chromium
    python3 tests/browser-qa.py

Set CHROMIUM_PATH to use an existing browser. Artifacts are excluded from Git.
Uses file:// for the user-facing launch and local HTTP for the regression harness.
"""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import os
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'artifacts'
OUT.mkdir(exist_ok=True)
handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT))
server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
errors = []
try:
    with sync_playwright() as p:
        options = {'headless': True}
        if os.environ.get('CHROMIUM_PATH'):
            options['executable_path'] = os.environ['CHROMIUM_PATH']
        browser = p.chromium.launch(**options)
        page = browser.new_page(viewport={'width': 1440, 'height': 1080})
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto((ROOT / 'index.html').as_uri())
        assert page.evaluate('StellarCourier.snapshot().mode') == 'ready'
        page.screenshot(path=str(OUT / 'desktop-ready.png'), full_page=True)
        page.click('#start-button')
        page.keyboard.down('ArrowRight')
        page.wait_for_timeout(180)
        page.keyboard.up('ArrowRight')
        page.screenshot(path=str(OUT / 'desktop-playing.png'), full_page=True)
        page.keyboard.press('p')
        assert page.evaluate('StellarCourier.snapshot().mode') == 'paused'
        page.goto(f'http://127.0.0.1:{server.server_port}/tests/browser-harness.html')
        page.click('#run')
        page.wait_for_function("document.querySelector('#summary').textContent.includes('失败')", timeout=15000)
        summary = page.locator('#summary').inner_text()
        assert '0 失败' in summary, page.locator('#results').inner_text()
        print(summary)
        mobile = browser.new_context(viewport={'width': 375, 'height': 667}, is_mobile=True, has_touch=True)
        phone = mobile.new_page()
        phone.on('pageerror', lambda error: errors.append(str(error)))
        phone.goto((ROOT / 'index.html').as_uri())
        phone.screenshot(path=str(OUT / 'mobile-ready.png'), full_page=True)
        assert phone.evaluate('document.documentElement.scrollWidth <= innerWidth')
        phone.click('#start-button')
        phone.screenshot(path=str(OUT / 'mobile-playing.png'), full_page=True)
        assert phone.locator('#boost-button').bounding_box()['y'] < 667
        phone.set_viewport_size({'width': 844, 'height': 390})
        assert phone.evaluate('document.documentElement.scrollWidth <= innerWidth')
        phone.screenshot(path=str(OUT / 'mobile-landscape.png'), full_page=True)
        browser.close()
    assert not errors, errors
    print('PASS: file:// launch, desktop UI, browser regressions, mobile layout, no JavaScript errors.')
finally:
    server.shutdown()
    server.server_close()
