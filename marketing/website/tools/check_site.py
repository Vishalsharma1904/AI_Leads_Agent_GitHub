"""Validate the actual static deliverable, local links, fragments and asset isolation."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import re

SITE = Path(__file__).resolve().parents[1]
EXPECTED = ['index','product','lead-generation','crm','outreach','recruitment','use-cases','contact']

class Page(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.ids=[]; self.links=[]; self.h1=0; self.main=0; self.title=False; self.description=False
        self.buttons=[]; self.image_missing=[]; self.text=[]
        self.feed(source)
    def handle_starttag(self, tag, attrs):
        attrs=dict(attrs)
        if 'id' in attrs: self.ids.append(attrs['id'])
        if tag=='h1': self.h1+=1
        if tag=='main': self.main+=1
        if tag=='title': self.title=True
        if tag=='meta' and attrs.get('name')=='description': self.description=bool(attrs.get('content'))
        for key in ['href','src','poster']:
            if key in attrs: self.links.append(attrs[key])
        if tag=='button': self.buttons.append(attrs)
        if tag=='img' and not all(key in attrs for key in ['alt','width','height']): self.image_missing.append(attrs)
    def handle_data(self, value): self.text.append(value)

def check():
    failures=[]; parsed={}
    for name in EXPECTED:
        path=SITE/f'{name}.html'
        if not path.exists(): failures.append(f'Missing page: {name}'); continue
        parsed[name+'.html']=Page(path.read_text(encoding='utf-8'))
    for name,page in parsed.items():
        if page.h1!=1 or page.main!=1: failures.append(f'{name}: needs exactly one h1/main')
        if not page.title or not page.description: failures.append(f'{name}: missing metadata')
        if len(page.ids)!=len(set(page.ids)): failures.append(f'{name}: duplicate IDs')
        if page.image_missing: failures.append(f'{name}: image lacks alt/dimensions')
        for button in page.buttons:
            if button.get('type') not in ['button','submit']: failures.append(f'{name}: button missing explicit type')
        for value in page.links:
            url=urlsplit(value)
            if url.scheme:
                if url.scheme not in ['https','mailto','tel']: failures.append(f'{name}: unexpected link scheme {value}')
                if url.hostname=='wa.me' and url.path!='/919999881949': failures.append(f'{name}: wrong WhatsApp recipient')
                continue
            target=(SITE/unquote(url.path or name)).resolve()
            if not target.is_relative_to(SITE): failures.append(f'{name}: escapes standalone site: {value}')
            if not target.exists(): failures.append(f'{name}: broken asset/link {value}'); continue
            if url.fragment and target.suffix=='.html':
                target_page=parsed.get(target.name)
                if target_page and url.fragment not in target_page.ids: failures.append(f'{name}: broken fragment {value}')
        if 'Fictional' not in ''.join(page.text) and name not in ['use-cases.html','contact.html']:
            failures.append(f'{name}: missing demo-data disclosure')
        if name=='contact.html':
            source=(SITE/name).read_text(encoding='utf-8')
            if not re.search(r'<fieldset\s+data-contact-fields\s+disabled>',source):
                failures.append('Contact form must disable inputs in static HTML to prevent no-JS submission')
    css=(SITE/'site.css').read_text(encoding='utf-8') + (SITE/'refinement.css').read_text(encoding='utf-8')
    for asset in re.findall(r"url\(['\"]?([^)'\"]+)",css):
        if not (SITE/asset).exists(): failures.append(f'CSS: missing {asset}')
    for token in ['#FAF9F5','#FFFFFF','#034F46','#FFFFEB','#191918','prefers-reduced-motion']:
        if token not in css: failures.append(f'CSS missing required token {token}')
    js=''.join((SITE/name).read_text(encoding='utf-8') for name in ['site.js','media.js','experience.js'])
    if re.search(r'\b(fetch|XMLHttpRequest|WebSocket)\s*\(',js): failures.append('Demo makes a network request')
    if re.search(r'(linear|radial|conic)-gradient\(',css): failures.append('Website styling must not contain gradients')
    if re.search(r'\.feature-card a:after\{[^}]*inset:0',css): failures.append('A stretched card link would cover interactive controls')
    for name in EXPECTED:
        source=(SITE/f'{name}.html').read_text(encoding='utf-8')
        if '>rudra24<' in source: failures.append(f'{name}: lowercase brand wordmark')
        if 'refinement.css' not in source: failures.append(f'{name}: missing shared refinement stylesheet')
    home=(SITE/'index.html').read_text(encoding='utf-8')
    if '<video id="launch-film" tabindex="0" autoplay muted loop controls playsinline preload="metadata"' not in home:
        failures.append('Launch film needs muted looping autoplay and native no-JS controls')
    if 'film-card' in home or 'film-screen' in home or 'Play the film' in home:
        failures.append('The hero film must sit directly on the page without an outer player card')
    if 'data-film-toggle' not in home: failures.append('Autoplay needs an accessible pause control')
    if 'data-film-sound' in home or 'Enable hover sound' in js: failures.append('Separate sound enable button must be removed')
    if 'data-film-expand' not in home: failures.append('Film needs a larger original-resolution view')
    product=(SITE/'product.html').read_text(encoding='utf-8')
    for key in ['client','voice','calling','candidates','crm','calendar','contracts','reports','dashboard','data','leads','email','whatsapp','sms','assistant','accounts','connectors','plugins','keys','settings']:
        if f'data-experience-card="{key}"' not in product: failures.append(f'Missing expandable app tab: {key}')
    for name in EXPECTED:
        source=(SITE/f'{name}.html').read_text(encoding='utf-8')
        if 'experience.js' not in source: failures.append(f'{name}: missing demo interactions')
        if len(re.findall('data-experience-fields',source)) != len(re.findall('<fieldset disabled data-experience-fields>',source)):
            failures.append(f'{name}: demo forms must default to disabled without JS')
    for key in ['leads','calling','outreach','crm','assistant']:
        if not (SITE/f'assets/video/{key}.mp4').exists(): failures.append(f'Missing feature excerpt {key}')
    if 'data-film-fallback hidden' not in home: failures.append('Missing accessible film error fallback')
    if failures:
        print('\n'.join('FAIL '+item for item in failures))
        raise SystemExit(1)
    print(f'PASS: {len(parsed)} pages, metadata, IDs, buttons, local links/fragments, assets, approved palette and demo isolation.')

if __name__=='__main__': check()
