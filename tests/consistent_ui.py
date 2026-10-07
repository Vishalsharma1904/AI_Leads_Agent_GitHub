"""Smoke check the shared visual system and actionable Peek suggestions.
Run: backend/.venv312/Scripts/python.exe tests/consistent_ui.py
"""
from playwright.sync_api import sync_playwright
from pw_harness import open_app, SHOTS

from leads_fixtures import backend, calls


with sync_playwright() as pw:
    browser, page, errors = open_app(pw, backend=backend)

    for view in ('chat', 'candidate-ai', 'jarvis'):
        page.evaluate('(v) => showView(v)', view)
        selector = {'chat': '#chat-input', 'candidate-ai': '#candidate-ai-input', 'jarvis': '#jarvis-input'}[view]
        page.locator(selector).focus()
        style = page.locator(selector).evaluate('(el) => getComputedStyle(el).outlineStyle')
        assert style == 'none', (view, style)

    page.evaluate("() => { ClavisIQ.learn('ask', {text:'Ghaziabad ki leads do'}); ClavisTaskSurface.show({user:true}); }")
    first = page.locator('#clavis-task-surface .cts-prompt-pill').all_text_contents()
    assert len(first) == 3 and any('Ghaziabad' in x for x in first), first
    page.evaluate("() => { ClavisTaskSurface.hide(); ClavisTaskSurface.show({user:true}); }")
    second = page.locator('#clavis-task-surface .cts-prompt-pill').all_text_contents()
    assert second != first, (first, second)
    page.locator('#clavis-task-surface .cts-prompt-pill').first.click()
    page.wait_for_function("() => ClavisTask.current()?.phase === 'completed'", timeout=90000)
    assert calls['maps'], 'Peek suggestion did not start a lead search'

    for view in ('dashboard', 'leads', 'agent', 'excel', 'analytics', 'email', 'whatsapp', 'accounts', 'plugins', 'candidate-db', 'voice-ai'):
        page.evaluate('(v) => showView(v)', view)
        page.wait_for_timeout(700)
        state = page.evaluate('''v => { const el=document.getElementById('view-'+v);
          const card=el.querySelector('.do-stat-card,.analytics-card,.agent-config-card,.email-sidebar-card,.gmail-compose-card');
          const c=card && getComputedStyle(card);
          return {visible:el.classList.contains('active'),overflow:el.scrollWidth-el.clientWidth,
            cardImage:c?.backgroundImage || 'none'}; }''', view)
        assert state['visible'] and state['overflow'] < 2 and state['cardImage'] == 'none', (view, state)
        if view == 'analytics':
            bars = page.locator('#view-analytics .do-bar-fill').evaluate_all(
                '(els) => els.map(el => getComputedStyle(el).backgroundColor)')
            assert bars and not any(c in ('rgb(0, 122, 255)', 'rgb(108, 92, 231)', 'rgb(255, 159, 10)') for c in bars), bars
        if view in ('excel', 'analytics'):
            page.screenshot(path=str(SHOTS / f'consistent_{view}.png'))

    assert not errors, errors
    print('PASS composer focus, changing actionable Peek prompts, 11 views, calm charts, no page errors')
    browser.close()
