"""Author the standalone static site. No build tool is needed to view its output."""
from html import escape
from pathlib import Path
from urllib.parse import quote
import shutil
import json
import re

SITE = Path(__file__).resolve().parents[1]
REPO = SITE.parents[1]

ICONS = {}

def icon(name, extra=''):
    return f'<svg class="icon {extra}" viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>'

# Reuse the app's Feather geometry, without importing its runtime or settings.
app_icons = json.loads(re.search(r'var ICONS = (\{.*?\});', (REPO/'clavis-icons.js').read_text(encoding='utf-8'), re.S)[1])
for site_name, app_name in {'assistant':'aperture','search':'briefcase','people':'users','crm':'trello','message':'message-circle','phone':'phone-call','mail':'mail','calendar':'calendar','download':'download','check':'check','clock':'clock','pin':'map-pin','chart':'bar-chart-2','file':'file-text','memory':'database','connect':'link','mic':'mic','task':'check-square','shield':'shield','menu':'menu','play':'play','arrow':'arrow-right','chevron':'chevron-down'}.items():
    ICONS[site_name] = app_icons[app_name]

CLIPS = {
    'leads': ('Find leads', 40, 'Search by industry and area. Review the business list and open a company to check its details.'),
    'calling': ('Prepare a call', 90, 'Choose the agent and review your script. Connect the calling provider before making a real call.'),
    'outreach': ('Prepare WhatsApp outreach', 112, 'Choose a reviewed contact, prepare your introduction and check the message before sending.'),
    'crm': ('Keep the next step in view', 146, 'Open the customer workspace, review the pipeline and keep the follow-up with the record.'),
    'assistant': ('Ask your assistant', 164, 'Type or speak your request. Review the response and use the relevant task or result.'),
}

def feature_film(key):
    title, _, desc = CLIPS[key]
    return f'''<section class="section rule feature-film"><div class="wrap split"><div class="reveal"><span class="eyebrow">Inside the app</span><h2>{title}.</h2><p class="subcopy">{desc}</p><p class="setup-note">A short excerpt from the launch film. This preview does not run a live task.</p></div><div class="reveal"><video controls muted playsinline preload="none" poster="assets/video/{key}-poster.jpg" width="1920" height="1080" aria-label="{title} — app demonstration"><source src="assets/video/{key}.mp4" type="video/mp4"></video></div></div></section>'''

def wa(label='Talk to us on WhatsApp', topic='', classes='button'):
    text = 'Hi, I would like to know more about Rudra24 AI' + (f' for {topic}' if topic else '') + '.'
    return f'<a class="{classes}" href="https://wa.me/919999881949?text={quote(text)}" target="_blank" rel="noopener noreferrer">{escape(label)}{icon("arrow")}</a>'

def link(label, href, classes='text-link'):
    return f'<a class="{classes}" href="{href}">{label}{icon("arrow")}</a>'

PAGES = [
    ('index', 'Home', 'Your sales team’s new AI partner.', 'Find the right leads, start better conversations and keep every customer’s next step in view with Rudra24 AI.'),
    ('product', 'Product', 'One workspace. A little less work.', 'Explore the Rudra24 AI assistant, voice tools, memory, lead research, outreach, CRM and integrations.'),
    ('lead-generation', 'Lead generation', 'Find the right businesses. Start there.', 'Research business leads by location and industry, review contacts, and export useful results with Rudra24 AI.'),
    ('crm', 'CRM & follow-ups', 'Every conversation. A clear next step.', 'Manage customer records, deals, follow-ups, meetings, reports, clients and contracts in Rudra24 AI.'),
    ('outreach', 'Outreach & calling', 'A thoughtful first hello. A better follow-up.', 'Prepare email, WhatsApp, SMS and calling workflows with Rudra24 AI. Review drafts and connect your providers.'),
    ('recruitment', 'Recruitment', 'Find people. Keep the process clear.', 'Search candidates, organise your shortlist and manage recruitment data with Rudra24 AI.'),
    ('use-cases', 'Use cases', 'Made for the way small teams work.', 'See Rudra24 AI workflows for service businesses, security and housekeeping agencies, sales and staffing teams.'),
    ('contact', 'Contact', 'Let’s make room for better work.', 'Talk to the Rudra24 team on WhatsApp about a product walkthrough, business needs and setup.'),
]

FEATURE_NAV = [('product','assistant','Product overview','Everything, in one workspace'),('lead-generation','search','Lead generation','Find and organise businesses'),('crm','crm','CRM & follow-ups','Keep the next step in view'),('outreach','message','Outreach & calling','Prepare better conversations'),('recruitment','people','Recruitment','Build a useful shortlist')]

def header(current):
    menu = ''.join(f'<a href="{slug}.html"{(" aria-current=\"page\"" if current == slug else "")}>{icon(ico)}<span><b>{label}</b><small>{desc}</small></span></a>' for slug,ico,label,desc in FEATURE_NAV)
    mobile = ''.join(f'<a class="sub" href="{slug}.html">{label}</a>' for slug,_,label,_ in FEATURE_NAV)
    return f'''<a class="skip" href="#main">Skip to content</a>
    <header class="site-header"><div class="wrap header-inner">
      <a class="brand" href="index.html" aria-label="Rudra24 AI home"><img src="assets/rudra24-icon.png" width="48" height="48" alt=""><span>Rudra24 AI</span></a>
      <nav class="desktop-nav" aria-label="Main navigation"><details class="product-menu"><summary>Product {icon('chevron','chevron')}</summary><div class="menu-panel">{menu}</div></details>
      <a href="use-cases.html"{(' aria-current="page"' if current=='use-cases' else '')}>Use cases</a><a href="contact.html"{(' aria-current="page"' if current=='contact' else '')}>Contact</a>{wa('Let’s talk',classes='button small')}</nav>
      <details class="mobile-menu"><summary>Menu {icon('menu')}</summary><nav aria-label="Mobile navigation"><a href="product.html">Explore the product</a>{mobile}<a href="use-cases.html">Use cases</a><a href="contact.html">Contact</a>{wa()}</nav></details>
    </div></header>'''

def footer():
    products = ''.join(f'<a href="{slug}.html">{label}</a>' for slug,_,label,_ in FEATURE_NAV)
    return f'''<footer class="footer"><div class="wrap"><div class="footer-main">
    <div class="footer-brand"><a class="brand" href="index.html"><img src="assets/rudra24-icon.png" width="48" height="48" alt=""><span>Rudra24 AI</span></a><p>Your AI partner for finding leads, starting conversations and keeping business moving.</p></div>
    <div class="footer-links"><h3>Explore</h3>{products}</div><div class="footer-links"><h3>Stay in touch</h3><a href="use-cases.html">Use cases</a><a href="contact.html">Talk to the team</a><a href="https://wa.me/919999881949" target="_blank" rel="noopener noreferrer">WhatsApp</a><a href="mailto:Rudra24securegroup@gmail.com">Email us</a></div></div>
    <div class="footer-bottom"><span>© 2026 Rudra24 Digital</span><span>Built for small teams. Designed for everyday work.</span></div></div></footer>'''

def closing(topic='your business'):
    return f'''<section class="closing"><div class="wrap reveal"><span class="eyebrow" style="justify-content:center">Your next step</span><h2>Less to juggle.<br><em>More room to grow.</em></h2><p>Tell us how your team works. We’ll walk you through the parts of Rudra24 AI that fit.</p><div class="actions">{wa(topic=topic)}{link('Meet the workspace','product.html','button secondary')}</div></div></section>'''

def faq(items, title='A few good<br><em>questions.</em>'):
    rows = ''.join(f'<details><summary>{q}</summary><p>{a}</p></details>' for q,a in items)
    return f'<section class="section rule"><div class="wrap faq-layout"><div class="reveal"><span class="eyebrow">Good to know</span><h2>{title}</h2></div><div class="faq-list reveal">{rows}</div></div></section>'

def page_hero(eyebrow, title, desc, topic='', center=False):
    return f'''<section class="page-hero {'center' if center else ''}"><div class="wrap"><span class="eyebrow hero-title">{eyebrow}</span><h1 class="hero-title">{title}</h1><p class="subcopy hero-copy">{desc}</p><div class="actions hero-copy">{wa(topic=topic)}{link('See how it works','#walkthrough','button secondary')}</div></div></section>'''

def frame(body, label='Product preview', sidebar=False):
    side = f'''<aside class="demo-sidebar" aria-label="Example workspace"><div class="workspace-label">Your workspace</div><div class="side-item">{icon('assistant')}AI assistant</div><div class="side-item">{icon('search')}Leads</div><div class="side-item">{icon('crm')}CRM</div><div class="side-item">{icon('message')}Outreach</div><div class="side-item">{icon('people')}Candidates</div><div class="side-bottom">{icon('connect')}Connected tools</div></aside>''' if sidebar else ''
    return f'''<div class="demo-frame"><div class="demo-bar"><div class="demo-bar-label"><span class="window-dots" aria-hidden="true"><i></i><i></i><i></i></span><img src="assets/rudra24-icon.png" width="18" height="18" alt="">Rudra24 AI <span aria-hidden="true">/</span> {label}</div><span class="sample-label">Fictional demo data</span></div><div class="{'demo-shell' if sidebar else ''}">{side}{body}</div></div>'''

def lead_pane():
    companies = [('O','Oakfield Suites','Hotel','Delhi','Oakfield Suites · Hotel · Delhi. Sample contact record selected. Review the contact source before outreach.'),('W','Willow Care Centre','Healthcare','Noida','Willow Care Centre · Healthcare · Noida. Sample contact record selected. No real contact details are used in this preview.'),('C','Cedar Business Park','Offices','Gurugram','Cedar Business Park · Offices · Gurugram. Sample contact record selected. Save the record to keep its next step in view.')]
    rows = ''.join(f'<tr><td><div class="company"><span class="initial">{initial}</span><span><b>{name}</b><small>{kind}</small></span></div></td><td>{area}</td><td><button class="lead-open" type="button" data-js-control data-lead-open="{detail}" aria-label="View {name}" aria-pressed="false">View {icon("arrow")}</button></td></tr>' for initial,name,kind,area,detail in companies)
    return f'''<div data-lead-demo><div class="prompt">{icon('assistant')}Find 3 business leads in Delhi NCR<span class="prompt-arrow" aria-hidden="true">{icon('arrow')}</span></div><div class="sample-meta"><span>3 sample businesses</span><span>Review before outreach</span></div><table class="lead-table"><caption class="sr-only">Fictional business leads for the product preview</caption><thead><tr><th scope="col">Business</th><th scope="col">Area</th><th scope="col"><span class="sr-only">Details</span></th></tr></thead><tbody>{rows}</tbody></table><div class="lead-detail">{icon('pin')}<span data-lead-detail aria-live="polite">Choose a sample business to see its details. Real searches can include company information, contact sources and map locations.</span></div><div class="demo-bottom"><p>Sample data. No live search runs here.</p><button class="tiny-button" type="button" data-js-control data-export-sample>{icon('download')}Export sample CSV</button></div></div>'''

def draft_pane():
    return f'''<div data-draft-demo><div class="channel-select" aria-label="Sample draft channel" data-js-control><button type="button" data-channel="email" aria-pressed="true">Email</button><button type="button" data-channel="whatsapp" aria-pressed="false">WhatsApp</button><button type="button" data-channel="call" aria-pressed="false">Call script</button></div><div class="draft"><div class="draft-meta" data-draft-meta>Email draft · Review before sending</div><div class="draft-copy" data-draft-copy>Subject: Housekeeping support for Oakfield Suites

Hello,

We provide housekeeping support for hospitality teams. I would like to understand whether Oakfield Suites is reviewing its staffing needs.

Would a short conversation next week be useful?

Thank you,
Your team</div></div><div class="demo-bottom"><p>Preparation only. Nothing is sent.</p><span class="sample-label">You review the next step</span></div></div>'''

def crm_pane():
    columns = ''
    for i,stage in enumerate(['New','Contacted','Follow-up']):
        card = '<article class="deal" data-deal><b>Oakfield Suites</b><p>Housekeeping enquiry</p><span class="tag">Ready to review</span></article>' if i==0 else ''
        columns += f'<div class="kanban-column" data-stage="{stage}"><h4>{stage}<span data-count>{1 if i==0 else 0}</span></h4>{card}</div>'
    return f'<div data-crm-demo><div class="kanban">{columns}</div><div class="demo-bottom"><p data-crm-status aria-live="polite">One sample enquiry, ready to review.</p><button class="tiny-button" type="button" data-js-control data-move-deal>Move to Contacted</button></div><div class="lead-detail">{icon("check")}<span>The next step stays with the record, alongside your notes and activity.</span></div></div>'

def followup_pane():
    return f'''<div class="followup-grid"><div class="note-card">{icon('calendar')}<h4>A time to<br>follow up.</h4><p>Oakfield Suites<br>Review the housekeeping enquiry.</p><small>Example reminder · Tuesday, 11:00</small></div><div class="note-card">{icon('file')}<h4>The details,<br>still together.</h4><p>Company introduction, conversation notes and the next step, attached to one record.</p><small>Meeting time confirmed by you</small></div></div><div class="lead-detail">{icon('clock')}<span>Calendar actions depend on your connected account and confirmed meeting details.</span></div>'''

def workspace():
    labels = [('leads','Find leads',lead_pane()),('draft','Prepare outreach',draft_pane()),('crm','Track in CRM',crm_pane()),('followup','Follow up',followup_pane())]
    tabs = ''.join(f'<button id="workflow-tab-{key}" type="button" data-tab="{key}" aria-selected="{str(i==0).lower()}">{label}</button>' for i,(key,label,_) in enumerate(labels))
    panels = ''.join(f'<div id="workflow-panel-{key}" class="demo-pane" data-panel="{key}"{(" hidden" if i else "")}>{body}</div>' for i,(key,_,body) in enumerate(labels))
    body = f'<div class="demo-body" data-tabs><div class="demo-heading"><div><h3>From a lead to a next step.</h3><p>A small tour of your everyday workspace.</p></div>{icon("assistant")}</div><div class="demo-tabs" data-tablist aria-label="Business workflow">{tabs}</div>{panels}<span class="sr-only" data-tab-status aria-live="polite"></span></div>'
    return frame(body,'Your workspace',True)

def standalone_preview(title, desc, pane, label):
    return frame(f'<div class="demo-body"><div class="demo-heading"><div><h3>{title}</h3><p>{desc}</p></div>{icon("assistant")}</div>{pane}</div>',label)

def assistant_preview():
    return frame(f'''<div class="assistant-preview"><div class="assistant-symbol" aria-hidden="true"><img src="assets/rudra24-icon.png" width="96" height="96" alt=""></div><div><div class="assistant-bubble request"><span>Your request</span>Find hotel leads in Delhi and help me prepare a company introduction.</div><div class="assistant-bubble"><span>Rudra24 AI · Example response</span>Let’s start with the location and the number of leads you need. Then we can review the results and prepare an introduction.</div><div class="assistant-status">{icon('mic')}Type or speak in Hindi and English.</div></div></div>''','AI assistant')

def cards(items):
    html = ''
    categories = {'search':'Lead generation','crm':'CRM & follow-ups','phone':'Voice calling','message':'Outreach','people':'Your workspace'}
    for i,(ico,title,desc,href,label) in enumerate(items):
        clip = ['leads','crm','calling','outreach','assistant'][i]
        key = ['leads','crm','calling','outreach','assistant'][i]
        html += experience_card(key, ico, title, desc, href, i, clip, categories.get(ico,'Product'))
    return '<div class="feature-grid">'+html+'</div>'

def demo_field(label, name, options=None, value='', kind='text'):
    if options:
        control = '<select name="'+name+'">'+''.join(f'<option>{escape(item)}</option>' for item in options)+'</select>'
    elif kind == 'textarea':
        control = f'<textarea name="{name}" required maxlength="600" rows="3">{escape(value)}</textarea>'
    else:
        bounds = ' min="1" max="20" step="1"' if kind=='number' else ' maxlength="100"'
        control = f'<input type="{kind}" name="{name}" value="{escape(value)}" required{bounds}>'
    return f'<label><span>{label}</span>{control}</label>'

def experience_pane(key):
    if key=='crm': return crm_pane()
    if key=='outreach': return draft_pane()
    if key in ['leads','client','candidates']:
        candidate = key=='candidates'
        fields = demo_field('Your request · review the search settings below','request',value='Find 3 hotel leads in Sector 29, Gurugram.',kind='textarea') if key=='client' else ''
        fields += demo_field('Role' if candidate else 'Industry','industry', ['Security guards','Housekeeping staff','Office staff'] if candidate else ['Hotels & Hospitality','Hospitals & Healthcare','IT Parks & Tech','Banks & Corporate','Factories & Manufacturing','Warehouses & Logistics','Schools & Colleges','Residential Societies'])
        fields += demo_field('City','city',['Gurugram','Delhi','Noida','Mumbai','Bengaluru','Jaipur'])+demo_field('Locality','area',value='Sector 29')+demo_field('Requested count · 1–20 in this demo','count',value='3',kind='number')
        if not candidate: fields += demo_field('Source','source',['Google Maps','Google Jobs','LinkedIn Jobs'])
        action = 'Find sample candidates' if candidate else 'Generate sample leads'
        intro = '<div class="demo-request">Start with your request, then confirm the search settings.<br><small>This sample search uses the settings you choose below.</small></div>' if key=='client' else ''
        return intro+f'<form data-experience="{key}" class="experience-form"><fieldset disabled data-experience-fields><div class="experience-fields">{fields}</div><div class="actions"><button class="button" type="submit">{action}{icon("arrow")}</button><button class="button secondary" type="button" data-search-stop hidden>Stop search</button></div></fieldset><p role="status" data-experience-status>Choose your search. All results here are fictional.</p><div data-experience-results></div><button type="button" class="button secondary" data-demo-export hidden>Export these samples</button><button type="button" class="button secondary" data-demo-save hidden>Add samples to CRM</button></form>'
    if key in ['data','dashboard','reports']:
        return f'<div data-data-view="{key}"><div class="experience-metrics"><div><b data-total-leads>3</b><span>Sample leads</span></div><div><b data-total-crm>1</b><span>CRM records</span></div><div><b data-total-tasks>0</b><span>Planned follow-ups</span></div></div><p>Run a sample search or save a follow-up in another card. Your demo overview updates here.</p><label class="experience-filter">View records<select data-data-filter><option>All records</option><option>CRM records</option><option>Candidate records</option></select></label><div data-data-results></div><button class="button secondary" type="button" data-data-export>Export visible samples</button><p data-data-status role="status">Fictional records, kept only for this visit.</p></div>'
    definitions = {
        'assistant': ('Prepare a plan', [demo_field('What do you need help with?','request',value='Help me introduce our housekeeping services to a hotel.',kind='textarea')]),
        'voice': ('Preview a conversation', [demo_field('Language','language',['English','Hindi']),demo_field('Conversation goal','request',value='Introduce our housekeeping services',kind='textarea')]),
        'calling': ('Prepare a call script', [demo_field('Company name','company',value='Example Service Team'),demo_field('Business to contact','recipient',value='Oakfield Suites'),demo_field('Service','service',value='Housekeeping support'),demo_field('Language','language',['English','Hindi'])]),
        'email': ('Prepare email draft', [demo_field('From business','company',value='Example Service Team'),demo_field('Recipient business','recipient',value='Oakfield Suites'),demo_field('Service','service',value='Housekeeping support')]),
        'whatsapp': ('Prepare WhatsApp draft', [demo_field('From business','company',value='Example Service Team'),demo_field('Recipient business','recipient',value='Oakfield Suites'),demo_field('Service','service',value='Security staffing')]),
        'sms': ('Prepare SMS draft', [demo_field('From business','company',value='Example Service Team'),demo_field('Recipient business','recipient',value='Oakfield Suites'),demo_field('Service','service',value='Housekeeping support')]),
        'calendar': ('Save sample follow-up', [demo_field('Customer','recipient',value='Oakfield Suites'),demo_field('Date','date',value='2026-10-20',kind='date'),demo_field('Time','time',value='11:00',kind='time'),demo_field('Next step','request',value='Review the company introduction',kind='textarea')]),
        'contracts': ('Save sample contract', [demo_field('Client','recipient',value='Oakfield Suites'),demo_field('Service','service',value='Housekeeping support'),demo_field('Renewal date','date',value='2027-01-20',kind='date')]),
        'settings': ('Apply to this preview', [demo_field('Company name','company',value='Example Service Team'),demo_field('Services','service',value='Security and housekeeping'),demo_field('Language','language',['English','Hindi'])]),
        'accounts': ('Preview account setup', [demo_field('Account','provider',['Gmail','Google Sheets','Google Calendar','WhatsApp']),demo_field('Workflow','request',['Email drafts','Spreadsheet exports','Meeting reminders','WhatsApp preparation'])]),
        'connectors': ('Preview connection checklist', [demo_field('Connection','provider',['Google Workspace','WhatsApp','Voice provider','AI provider'])]),
        'plugins': ('Preview workflow setup', [demo_field('Workflow','provider',['Google Sheets sync','Email automation','Calling integration'])]),
        'keys': ('Show provider requirements', [demo_field('Provider type','provider',['AI provider','Lead sourcing','Voice and telephony'])]),
    }
    action, fields = definitions[key]
    return f'<form class="experience-form" data-experience="{key}"><fieldset disabled data-experience-fields><div class="experience-fields">{"".join(fields)}</div><button class="button" type="submit">{action}{icon("arrow")}</button></fieldset><p data-experience-status role="status">Try the form. This preview does not send messages, connect accounts or make calls.</p><div data-experience-results></div></form>'

HOW = {
    'leads':'Choose the industry, city, locality, source and number of leads. Run the search, open a result, then export it or add it to the sample CRM. Stop keeps the results already returned.',
    'client':'Start with a plain-language request. Review the industry and area, choose the count, and run the sample search. The real Client AI uses your configured AI and sourcing providers.',
    'crm':'Move the enquiry from New to Contacted to Follow-up. In the app, add customer notes, record what actually happened and plan the next activity.',
    'outreach':'Switch between email, WhatsApp and a call script. Review the introduction before using it. The app needs a configured sender or calling provider for delivery.',
    'assistant':'Describe the task in your own words. Review the suggested steps and keep useful company context, memory and tasks together. This demo uses prepared responses.',
    'voice':'Choose a language and a goal to read an example conversation. In the app, voice requires a provider and microphone permission. This website does not record audio.',
    'calling':'Enter your company, the customer and your service. Prepare a script and review the opening. Real calling also needs a backend, credentials and a telephony connection.',
    'candidates':'Choose the role and location, then run the sample search. Open a candidate to review the fictional record. Real recruitment results need review and a sourcing setup.',
    'data':'Review your sample leads and CRM records. Filter the list and export a CSV. In the app, the Data Hub also includes the candidate database and Excel manager.',
    'dashboard':'Use the overview to see your lead and follow-up totals. Choose a record view to inspect the data behind the numbers.',
    'reports':'Review recorded work, then inspect the records behind a total. These demo totals come from your actions here; they are not business performance claims.',
    'email':'Enter the business and service, then prepare an editable email draft. Review it before sending through your configured email account in the app.',
    'whatsapp':'Prepare an introduction for a reviewed contact. Edit the draft and check the details. The website prepares text only; real sending needs the app’s account setup.',
    'sms':'Prepare a short service introduction. Review the text and recipient in the app before sending through a configured messaging provider.',
    'calendar':'Choose the customer, date, time and next step. Save a sample reminder. The app can use a connected calendar after the meeting details are confirmed.',
    'contracts':'Keep a confirmed client’s service and renewal date together. Save a sample record here. This preview does not create a legal agreement.',
    'settings':'Set the company context used by this preview. In the app, review company details, language, appearance and provider settings in Settings.',
    'accounts':'Select an account and the work it supports. Review the setup steps. Real accounts are connected inside the app; this demo does not ask for sign-in.',
    'connectors':'Choose a connection to see what it needs and what it supports. Review permissions before connecting an account in the app.',
    'plugins':'Choose a workflow to see its setup requirements. Use the app’s configured integration; this website does not install anything.',
    'keys':'Choose a provider type to understand the setup. API credentials belong in the app’s authenticated settings. Do not enter any secret on this demo website.',
}

def experience_card(key, ico, title, desc, href, index, clip='', category='Product'):
    hover = f' data-feature-clip="{clip}"' if clip else ''
    return f'''<details class="feature-card experience-card reveal" data-experience-card="{key}"><summary{hover}><span class="card-top"><span class="card-category">{icon(ico)}{category}</span><span class="card-index">{index+1:02}</span></span><span class="card-title">{title}</span><span class="card-description">{desc}</span><span class="card-open">Try this feature {icon('chevron')}</span></summary><div class="feature-content"><div class="feature-instructions"><span class="eyebrow">How to use it</span><h3>See the next step.</h3><p>{HOW[key]}</p>{link('Read the full feature guide',href)}<p class="setup-note">Interactive demo · Fictional data. Nothing is sent or called.</p></div><div class="experience-shell"><div class="experience-rail">{icon(ico)}<span>{category}</span><span>Rudra24 AI</span></div><div class="experience-workspace"><h4>{category}</h4>{experience_pane(key)}</div></div></div></details>'''

def experience_directory():
    entries = [
        ('client','message','Client AI (Chat)','Turn your request into a focused lead search.','lead-generation.html','leads'),
        ('voice','mic','Voice Calling AI','Preview a Hindi or English conversation.','outreach.html#calling','calling'),
        ('calling','phone','Voice Calling','Prepare a script and understand calling setup.','outreach.html#calling','calling'),
        ('candidates','people','Candidate AI','Research a role and build a sample shortlist.','recruitment.html',''),
        ('crm','crm','CRM & pipeline','Move a record and keep its next step visible.','crm.html','crm'),
        ('calendar','calendar','Follow-ups & meetings','Save a customer reminder with a date and time.','crm.html',''),
        ('contracts','file','Clients & contracts','Keep the service and renewal date together.','crm.html#contracts',''),
        ('reports','chart','Reports','See the records behind your demo totals.','crm.html#reports',''),
        ('dashboard','chart','Dashboard','Review leads, CRM records and planned follow-ups.','product.html',''),
        ('data','memory','Data Hub & exports','Filter records and download your sample CSV.','lead-generation.html#exports',''),
        ('leads','search','Run Agent','Choose industry, area, source and exact count.','lead-generation.html','leads'),
        ('email','mail','Email Auto','Prepare and edit a business introduction.','outreach.html','outreach'),
        ('whatsapp','message','WhatsApp Auto','Prepare a short message for a reviewed contact.','outreach.html','outreach'),
        ('sms','message','Text messages','Prepare a concise service introduction.','outreach.html',''),
        ('assistant','assistant','AI assistant & memory','Describe a task and review a prepared plan.','product.html#assistant','assistant'),
        ('accounts','connect','Accounts','Understand the account setup for your workflow.','product.html#integrations',''),
        ('connectors','connect','Connectors','See connection requirements before you start.','product.html#integrations',''),
        ('plugins','connect','Plugins','Explore how integrations support your work.','product.html#integrations',''),
        ('keys','shield','API keys & providers','Understand the providers your setup needs.','product.html#integrations',''),
        ('settings','task','Settings & company','Set the context used in this visit’s demo.','product.html',''),
    ]
    return '<div class="feature-grid experience-directory">'+''.join(experience_card(key,ico,title,desc,href,i,clip,title) for i,(key,ico,title,desc,href,clip) in enumerate(entries))+'</div>'

def benefits(items):
    return '<div class="wrap benefit-strip">'+''.join(f'<div>{icon(ico)}<h3>{title}</h3><p>{desc}</p></div>' for ico,title,desc in items)+'</div>'

def detail_section(kicker,title,desc,items,anchor=''):
    blocks = ''.join(f'<article>{icon(ico)}<h3>{heading}</h3><p>{copy}</p></article>' for ico,heading,copy in items)
    return f'<section class="section"{(" id=\""+anchor+"\"" if anchor else "")}><div class="wrap detail-grid"><div class="reveal"><span class="eyebrow">{kicker}</span><h2>{title}</h2><p class="subcopy">{desc}</p></div><div class="detail-blocks reveal">{blocks}</div></div></section>'

def related(items):
    content = ''.join(f'<a href="{href}"><h3>{title}</h3><p>{desc}</p>{icon("arrow")}</a>' for href,title,desc in items)
    return f'<section class="section rule"><div class="wrap"><div class="section-head reveal"><h2>Keep it<br><em>connected.</em></h2><p>Explore the next part of the workflow.</p></div><div class="related-links reveal">{content}</div></div></section>'

def steps_section(items, title='A clear path.<br><em>One step at a time.</em>'):
    content = ''.join(f'<article class="step reveal"><span>0{i+1}</span><h3>{title_}</h3><p>{desc}</p></article>' for i,(title_,desc) in enumerate(items))
    return f'<section class="section rule" id="walkthrough"><div class="wrap"><div class="section-head reveal"><h2>{title}</h2><p>The app brings the work together. You decide what happens next.</p></div><div class="steps">{content}</div></div></section>'

def film_player():
    return '''<video id="launch-film" tabindex="0" autoplay muted loop controls playsinline preload="metadata" poster="assets/video/launch-poster.jpg" width="1920" height="1080" aria-label="Rudra24 AI launch film. Click or press Enter to toggle sound." aria-describedby="film-hint"><source src="assets/video/launch-film.mp4" type="video/mp4"><p>Your browser cannot play this film. <a href="assets/video/launch-film.mp4">Open the MP4</a>.</p></video><div class="film-caption"><span id="film-hint">The workspace in action · Hover for sound</span><div class="film-actions"><button type="button" data-film-expand data-js-control>Expand film</button><button type="button" data-film-toggle data-js-control>Pause video</button></div></div><dialog class="film-dialog" aria-label="Full-size launch film"><button type="button" data-film-close class="button secondary">Close full-size view</button><div data-film-slot></div><p>Original 1080p film · Hover for sound. Click the video if your browser needs a gesture.</p></dialog><p class="film-status" data-film-status role="status" hidden></p><a href="assets/video/launch-film.mp4" class="film-error-link" target="_blank" rel="noopener noreferrer" data-film-fallback hidden>Open the launch film directly</a>'''

def home():
    features = [('search','Your next client starts with the right lead.','Choose an industry and location. Review company profiles, available contacts and maps before taking the next step.','lead-generation.html','Explore lead generation'),('crm','Keep clients close.','Customer records, conversations and follow-ups belong together. Give every relationship a clear next step.','crm.html','Explore the CRM'),('phone','Less busywork. More conversations.','Prepare scripts and configure your calling agent. Review the conversation and record the outcome.','outreach.html#calling','Explore voice calling'),('message','Personal messages, reviewed by you.','Prepare a relevant introduction. Bring email and WhatsApp into the same workflow, with your sender and account setup.','outreach.html','Explore outreach'),('people','People and opportunities, together.','Ask your assistant a question, research candidates and keep useful records organised in your data hub.','product.html','Explore the workspace')]
    return f'''<section class="hero launch-hero"><div class="wrap launch-grid"><div class="launch-copy"><span class="eyebrow hero-title">Rudra24 AI · Your business workspace</span><h1 class="hero-title">Your sales team’s<br><span>new AI partner.</span></h1><p class="subcopy hero-copy">Find the right leads. Start better conversations. Keep every customer’s next step in view. All in one workspace.</p><div class="actions hero-copy">{wa('Talk to our team')}{link('Explore the workspace','#workspace','button secondary')}</div><p class="hero-note hero-copy">For small businesses, service teams and growing agencies.</p></div><div class="launch-media hero-preview" id="film">{film_player()}</div></div></section>
    <div class="wrap intro-line"><span>{icon('search')}Lead generation</span><span>{icon('phone')}Voice & outreach</span><span>{icon('crm')}CRM & follow-ups</span><span>{icon('mic')}Hindi & English</span></div>
    <section class="section" id="film-summary"><div class="wrap"><div class="section-head reveal"><div><span class="eyebrow">A closer look</span><h2>Every tool.<br>One connected workspace.</h2></div><p>Open a card to try the workflow. Fill in a search, review a sample result or prepare your next conversation.</p></div>{cards(features)}<div class="actions">{link('Try every app tab','product.html#walkthrough','button secondary')}</div></div></section>
    <section class="section workspace-tour" id="workspace"><div class="wrap"><div class="section-head reveal"><div><span class="eyebrow">Try the workspace</span><h2>From a first lead<br>to a clear next step.</h2></div><p>Select a business, prepare a draft and move a record through the pipeline. This interactive tour uses fictional sample data.</p></div><div class="reveal">{workspace()}<div class="below-demo"><span>{icon('check')}Choose a tab to explore each step.</span><span>Fictional demo data. No messages or calls.</span></div></div></div></section>
    <section class="section assistant-story"><div class="wrap split"><div class="reveal"><span class="eyebrow">Your AI assistant</span><h2>Ask once.<br>Find a place to start.</h2><p class="subcopy">Type a request or speak in Hindi and English. Prepare a message, find business information or start a task with the context of your workspace.</p><ul class="quiet-list"><li>{icon('mic')}Hindi and English conversations</li><li>{icon('memory')}Useful business context, kept close</li><li>{icon('task')}Tasks, results and next steps</li></ul><div class="actions">{link('Meet your assistant','product.html#assistant','button secondary')}</div></div><div class="reveal">{assistant_preview()}</div></div></section>
    {steps_section([('Tell it what you need.','Choose the industry, location and task. Start with a plain-language request.'),('Review the useful details.','Look through company records, candidate results or prepared drafts. Keep what fits.'),('Choose the next step.','Prepare outreach, add a follow-up or export the results. You stay in control.')])}
    <section class="section rule"><div class="wrap"><div class="section-head reveal"><h2>Built around<br>your working day.</h2>{link('See all use cases','use-cases.html')}</div><article class="usecase-row reveal"><div><h3>For service businesses.</h3><p>Your next customer and your next conversation, connected.</p></div><div><p>Find businesses in your area, prepare a relevant introduction and keep the follow-up with the customer record.</p><div class="workflow"><span>Find a lead</span>{icon('arrow')}<span>Prepare outreach</span>{icon('arrow')}<span>Track the next step</span></div></div></article><article class="usecase-row reveal"><div><h3>For agencies and staffing teams.</h3><p>Keep client opportunities and candidate research organised.</p></div><div><p>Research hotels, hospitals and offices, organise potential client conversations and build a candidate shortlist.</p><div class="workflow"><span>Research clients</span>{icon('arrow')}<span>Shortlist people</span>{icon('arrow')}<span>Keep work organised</span></div></div></article></div></section>
    {faq([('What does Rudra24 AI bring together?','Lead research, your AI assistant, recruitment, CRM, exports and outreach preparation. Connected accounts and providers enable additional workflows.'),('Can I use Hindi and English?','The assistant includes Hindi and English voice workflows. Voice availability depends on the selected provider, microphone permissions and account setup.'),('Does this website make calls or send messages?','No. The interactive previews use fictional examples. Real calling and messaging happen in the app after the required provider and account setup.'),('How do I see what fits my business?','Talk to us on WhatsApp. Tell us your industry and the work you want to simplify, and ask for a walkthrough of the relevant features.')])}{closing()}'''

def product():
    grid = experience_directory()
    return f'''{page_hero('The product','One workspace.<br><em>A little less work.</em>','The assistant, the customer record and the next follow-up, all close at hand. Rudra24 AI brings the working day together.',center=True)}
    <div class="wrap page-preview hero-preview compact-demo">{workspace()}<p class="preview-caption">Explore a sample workflow. All records shown here are fictional.</p></div>
    {benefits([('assistant','Ask in plain language','Start with the work, not a complicated menu.'),('connect','Bring useful tools together','Connect the accounts your workflow needs.'),('task','Keep context close','Research, drafts and next steps stay easier to find.')])}
    <section class="section" id="assistant"><div class="wrap split"><div class="reveal"><span class="eyebrow">Your everyday assistant</span><h2>Talk it through.<br><em>Put it to work.</em></h2><p class="subcopy">Ask a business question, prepare a message, or start lead research. The assistant gives your request a clear place to begin.</p><ul class="quiet-list"><li>{icon('mic')}Hindi-English voice and text conversations</li><li>{icon('memory')}Saved business context and conversation history</li><li>{icon('task')}Task progress, results and next steps</li></ul><p class="setup-note">Voice needs a configured provider and microphone permission. Saved memory can be reviewed and managed in the app.</p></div><div class="reveal">{assistant_preview()}</div></div></section>
    <section class="section rule" id="walkthrough"><div class="wrap"><div class="section-head reveal"><h2>The whole picture.<br><em>Without the clutter.</em></h2><p>Open a card to try its form, review a sample result and see how that part of the app works.</p></div>{grid}</div></section>
    <section class="section soft-section" id="integrations"><div class="wrap split"><div class="reveal"><span class="eyebrow">Connected tools</span><h2>Your tools.<br><em>In the same conversation.</em></h2><p class="subcopy">Bring account-based workflows into the app. Your email, spreadsheet, calendar and communication setup determines what you can use.</p></div><div class="reveal"><h3>Connections that support the work.</h3><div class="integration-list"><span>Google Gmail</span><span>Google Sheets</span><span>Google Calendar</span><span>WhatsApp</span><span>Voice providers</span><span>AI providers</span></div><p class="setup-note">Some connections require sign-in, provider credentials, approvals or paid usage. Ask us to walk you through your setup. Phone calls need a configured backend and telephony connection.</p></div></div></section>{closing()}'''

def leads():
    return f'''{page_hero('Lead generation','Find the right businesses.<br><em>Start there.</em>','Research leads by industry and location. Review the details, keep useful records and give your next conversation a better starting point.',topic='lead generation')}
    <div class="wrap page-preview compact-demo hero-preview">{standalone_preview('A useful place to begin.','Choose your search and try the process.', '<div class="experience-workspace">'+experience_pane('leads')+'</div>','Run Agent')}<p class="preview-caption">Fictional companies and sample areas. This is a preview, not a live search.</p></div>
    {benefits([('pin','Keep the location precise','Research the area you actually want to cover.'),('search','Choose the scope','Specify your industry and requested lead count.'),('download','Use the results','Save, organise or export the useful records.')])}
    {detail_section('From a request to a record','A clearer search.<br><em>A more useful result.</em>','Start with what your business needs. The app keeps the request and the results connected.',[('search','Industry and area','Look for hotels, hospitals, offices and other business categories in your selected location.'),('people','The count you asked for','Set how many leads you want. When fewer are available, review the actual returned results.'),('file','Company and contact context','Review business details and contact sources. Website enrichment can help fill gaps when information is available.'),('pin','Company information on maps','Keep the location in view while reviewing a business and planning your coverage.')])}
    {steps_section([('Make a focused request.','For example: find hotel leads in Delhi for a housekeeping introduction.'),('Review the returned records.','Check the company, location and available contact details. Keep useful results and review missing information.'),('Take the work forward.','Save records, prepare outreach, add CRM follow-ups or export your list.')])}
    <section class="section soft-section" id="exports"><div class="wrap split"><div class="reveal"><span class="eyebrow">Your data, ready to use</span><h2>Keep it in the app.<br><em>Or take it with you.</em></h2><p class="subcopy">Use the lead database to organise your records. Export to Excel or CSV, or use Google Sheets with a configured connection.</p><ul class="quiet-list"><li>{icon('download')}Excel and CSV exports</li><li>{icon('connect')}Google Sheets sync with account setup</li><li>{icon('task')}Partial results remain useful when a search stops</li></ul></div><div class="reveal"><div class="note-card">{icon('file')}<h4>From research<br>to your next task.</h4><p>Company · Category · Area · Contact source<br>A list that your team can review and work with.</p><small>Contact availability varies by source.</small></div></div></div></section>
    {faq([('Will every business have a phone number?','No. Public contact availability varies. Review the source and use website enrichment where available; a missing contact should stay missing until there is a real source.'),('What happens if I stop a search?','The app can retain returned partial results for preview and export. The number available depends on what the search returned before it stopped.'),('Can I move a lead into the CRM?','Yes. The CRM keeps lead records, activities and next steps together. Review the record and choose the workflow you want to start.')])}
    {related([('outreach.html','Prepare the introduction','Put relevant company information into a clear first message.'),('crm.html','Keep the follow-up','Give the useful lead a record and a next step.'),('use-cases.html','See a working example','Explore a client-research workflow for your business.')])}{closing('lead research')}'''

def crm():
    return f'''{page_hero('CRM & follow-ups','Every conversation.<br><em>A clear next step.</em>','Customer records, notes, deal stages and reminders, kept together. Spend less time remembering where the conversation left off.',topic='CRM and follow-ups')}
    <div class="wrap page-preview compact-demo hero-preview">{standalone_preview('A pipeline you can follow.','Move the sample enquiry through its next steps.',crm_pane(),'CRM pipeline')}<p class="preview-caption">A fictional enquiry. Moving a sample card does not contact anyone.</p></div>
    {benefits([('crm','A place for each record','Customer details and deal stages stay together.'),('clock','A visible next step','Keep notes, activities and follow-ups with the lead.'),('chart','Review what happened','Reports draw on the records and activities you enter.')])}
    {detail_section('Customer context','The details matter.<br><em>Keep them close.</em>','A pipeline is useful when the story behind each record is easy to find.',[('people','Customer records','Keep company details, conversation notes and recorded outcomes with the customer.'),('crm','Deal stages','Move an enquiry through your pipeline as its status changes. Record what actually happened.'),('task','Activities and follow-ups','Track attempts, replies and the next action. Give the follow-up a clear owner and place.'),('calendar','Meetings and calendars','Save confirmed meeting details. Calendar and meeting-email actions need connected accounts.')])}
    {steps_section([('Bring in the record.','Start from a useful lead or a customer record you want to organise.'),('Record the conversation.','Add the channel, notes and actual outcome. Review suggestions before saving them.'),('Choose the next action.','Set a follow-up, confirm a meeting or update the pipeline when the status changes.')])}
    <section class="section soft-section" id="contracts"><div class="wrap split"><div class="reveal"><span class="eyebrow">Clients & contracts</span><h2>After the first yes.<br><em>Keep the work in view.</em></h2><p class="subcopy">Keep confirmed clients, contract details and renewal dates organised. A won deal becomes a relationship worth keeping track of.</p></div><div class="reveal"><div class="note-card">{icon('file')}<h4>A client record.<br>A contract. A renewal.</h4><p>Keep the dates and details your team enters in a dedicated client and contract workspace.</p><small>Confirmed outcomes, recorded by your team.</small></div></div></div></section>
    {detail_section('Reports & overview','See the progress.<br><em>Understand the context.</em>','Review pipeline and activity data without separating the numbers from the records behind them.',[('chart','Interactive reports','Open the records behind supported report views and explore the period you need.'),('file','Business outcomes','Review confirmed clients, contract information and recorded outcomes.'),('task','Activity history','Keep the trail of follow-ups and updates available for your team.'),('clock','Renewal states','Review contract dates and renewals using the information entered in the app.')],anchor='reports')}
    {related([('lead-generation.html','Start with useful leads','Bring new business opportunities into the workspace.'),('outreach.html','Continue the conversation','Prepare outreach with the customer context nearby.'),('use-cases.html','See the complete workflow','Explore a small-team sales workflow.')])}{closing('CRM and customer follow-ups')}'''

def outreach():
    return f'''{page_hero('Outreach & calling','A thoughtful first hello.<br><em>A better follow-up.</em>','Prepare an introduction that makes sense for the business you are contacting. Keep the message, the conversation and the next step connected.',topic='outreach and calling')}
    <div class="wrap page-preview compact-demo hero-preview">{standalone_preview('Make it relevant.','Try a sample email, WhatsApp draft or call script.',draft_pane(),'Outreach preparation')}<p class="preview-caption">Example drafts only. No message is sent and no call is made.</p></div>
    {benefits([('file','Prepare with context','Use the company information you have reviewed.'),('message','Choose the channel','Email, WhatsApp, SMS and calling have their own setup.'),('check','Review the next action','Keep message preparation separate from delivery.')])}
    {detail_section('A message with a purpose','The right words.<br><em>A clear reason to reach out.</em>','From a short introduction to a follow-up, start with the customer and the conversation you want to have.',[('mail','Email workflows','Prepare messages and work with connected email accounts. Account authorisation is required for sending.'),('message','WhatsApp tools','Prepare messages and use configured WhatsApp workflows. Cloud messaging needs an authorised business sender and the required Meta setup.'),('phone','Text messages','Prepare SMS communication and use the configured provider. Provider access and sending charges can apply.'),('file','Pitch documents','Keep company introductions and pitch documents close to your outreach workflow.')])}
    <section class="section soft-section" id="calling"><div class="wrap split"><div class="reveal"><span class="eyebrow">Voice & calling</span><h2>Prepare the conversation.<br><em>Then connect the setup.</em></h2><p class="subcopy">Use calling tools to configure an agent, organise its knowledge and prepare a script. Review supported recordings, transcripts and outcomes after a conversation.</p><p class="setup-note">Real calls require a configured backend, provider credentials and an active phone or SIP connection. An API key alone is not a working phone line. Provider availability and call charges vary.</p></div><div class="reveal"><div class="note-card">{icon('phone')}<h4>A better-prepared<br>conversation.</h4><p>Agent setup → Script and knowledge → Authorised calling connection → Conversation review</p><small>Calling features depend on your provider setup.</small></div></div></div></section>
    {steps_section([('Start from a reviewed record.','Use the business details that are relevant to your introduction.'),('Prepare and review the message.','Choose a channel, edit the draft and confirm the sender and account setup.'),('Record the actual outcome.','Keep the reply, call review or follow-up with the CRM record. Opening a chat does not prove delivery.')])}
    {faq([('Will the app send a message just because I drafted it?','Drafting and delivery are different steps. Review your message and use the authorised account workflow. Manual WhatsApp sharing still needs you to send and confirm the message.'),('What do I need for real calling?','A working backend, supported voice and telephony providers, credentials and a provisioned phone/SIP connection. We can walk you through the setup requirements.'),('Are provider calls and messages included for free?','Provider plans, quotas and usage charges vary. Ask for the current setup and costs before using paid calling or messaging.')])}
    {related([('crm.html','Keep the outcome','Save conversation notes and agree on a follow-up.'),('lead-generation.html','Find a relevant starting point','Research the businesses you want to reach.'),('contact.html','Discuss your setup','Talk through the channels your team needs.')])}{closing('outreach and calling setup')}'''

def candidates():
    people = [('A','A. Mehta','Security','Delhi','security'),('R','R. Shah','Housekeeping','Noida','housekeeping'),('S','S. Kumar','Supervisor','Gurugram','supervisor')]
    cards_ = ''.join(f'<article class="candidate-card" data-candidate-role="{role}"><span class="initial">{initial}</span><h4>{name}</h4><p>{title} · {area}</p><span class="candidate-tag">Sample candidate</span></article>' for initial,name,title,area,role in people)
    return f'<div data-candidate-demo><div class="channel-select" aria-label="Sample candidate role" data-js-control><button type="button" data-candidate-filter="all" aria-pressed="true">All roles</button><button type="button" data-candidate-filter="security" aria-pressed="false">Security</button><button type="button" data-candidate-filter="housekeeping" aria-pressed="false">Housekeeping</button></div><div class="candidate-list">{cards_}</div><div class="demo-bottom"><p data-candidate-status aria-live="polite">3 fictional candidates shown.</p><span class="sample-label">Review before contact</span></div></div>'

def recruitment():
    return f'''{page_hero('Recruitment','Find people.<br><em>Keep the process clear.</em>','Candidate research, a useful shortlist and organised records. Bring staffing work into the same workspace as your client opportunities.',topic='candidate research and recruitment')}
    <div class="wrap page-preview compact-demo hero-preview">{standalone_preview('A shortlist with a purpose.','Choose a role and try the search.', '<div class="experience-workspace">'+experience_pane('candidates')+'</div>','Candidate AI')}<p class="preview-caption">Invented records for demonstration. No personal candidate data is used.</p></div>
    {benefits([('search','Start with a focused request','Describe the role and location you need.'),('people','Review the candidates','Look through the returned records before contact.'),('download','Keep a usable shortlist','Organise candidate data and supported exports.')])}
    {detail_section('Staffing workflows','The right context.<br><em>For the next conversation.</em>','Keep candidate research clear and separate from a hiring decision.',[('assistant','Recruiter assistant','Start a candidate-research task with the role and location your agency needs.'),('people','Candidate database','Keep returned candidate records in a dedicated place for review.'),('search','Useful filters','Search and organise the available records to work through your shortlist.'),('download','Data exports','Use supported spreadsheet exports to keep recruitment records useful for your team.')])}
    {steps_section([('Describe your staffing need.','Specify the role, location and scope of the candidate search.'),('Review the available records.','Check the returned information. Research results are a starting point, not a hiring recommendation.'),('Build your next step.','Organise a shortlist and prepare the questions your team wants to ask.')])}
    {related([('lead-generation.html','Find client opportunities','Research the businesses your staffing team serves.'),('use-cases.html','See the agency workflow','Explore client and candidate research together.'),('contact.html','Discuss recruitment needs','Tell us the roles and locations your team covers.')])}{closing('staffing and recruitment')}'''

CASES = [
    ('services','Service businesses','Find the next customer. Keep the next step.','For teams offering business services, a useful lead is only the beginning. Keep the research, introduction and follow-up in one workflow.','A reviewed business list and a clear follow-up, ready for your team.', [('Research your area.','Choose the industry, location and lead count that fit your service.'),('Prepare a relevant introduction.','Use reviewed company details to explain why you are reaching out.'),('Keep the next step.','Add notes and follow-ups to the CRM rather than leaving them in separate lists.')]),
    ('agencies','Security & housekeeping','New client conversations. Less scattered work.','Research hotels, hospitals, offices and other businesses that may be relevant to your services. Keep a company introduction and client records nearby.','A focused client-research and follow-up workflow.', [('Choose your territory.','Research the business categories and precise locations your agency covers.'),('Prepare your pitch.','Draft a service introduction or call script and keep your company document ready.'),('Track the relationship.','Record the actual reply, confirmed meeting or next follow-up in the CRM.')]),
    ('sales','Sales teams','Keep the conversation moving.','Small sales teams need a clear view of which records are new, which conversations happened and which follow-ups are due.','A pipeline with context behind each next action.', [('Start with the record.','Bring a useful lead into the customer workspace.'),('Record what happened.','Keep notes and factual outcomes with the deal.'),('Plan the follow-up.','Review activities and confirmed meeting details, then choose the next step.')]),
    ('staffing','Staffing teams','People and opportunities. In the same picture.','Bring client research and candidate research into one working day, while keeping the two kinds of records clearly organised.','A candidate shortlist and client opportunities your team can review.', [('Understand the requirement.','Describe the role and location your staffing team needs to research.'),('Review a candidate list.','Organise the available records and prepare your own interview questions.'),('Keep client work connected.','Research prospective clients and track the relevant conversations separately in CRM.')]),
]

def usecases():
    tabs = ''.join(f'<button id="case-tab-{key}" type="button" data-tab="{key}" aria-selected="{str(i==0).lower()}">{label}</button>' for i,(key,label,*_) in enumerate(CASES))
    panels = ''
    for i,(key,label,title,desc,result,steps_) in enumerate(CASES):
        content = ''.join(f'<article class="story-step"><span>0{j+1}</span><div><h3>{heading}</h3><p>{copy}</p></div></article>' for j,(heading,copy) in enumerate(steps_))
        panels += f'<section id="case-panel-{key}" class="case-panel demo-pane" data-panel="{key}"{(" hidden" if i else "")}><div><h3>{title}</h3><p class="subcopy">{desc}</p><p class="result">{result}</p><div class="actions">{wa("Discuss this workflow",label)}</div></div><div>{content}</div></section>'
    static = ''.join(f'<article class="usecase-row reveal"><div><h3>{label}</h3><p>{title}</p></div><div><p>{desc}</p><div class="workflow">'+''.join(f'<span>{heading}</span>' for heading,_ in steps_)+'</div></div></article>' for _,label,title,desc,_,steps_ in CASES)
    return f'''{page_hero('Use cases','Made for the way<br><em>small teams work.</em>','Different businesses. Familiar busywork. Find a workflow that gives your team a clearer place to start.',topic='a business workflow',center=True)}
    <section class="section rule" id="walkthrough"><div class="wrap" data-tabs><div class="demo-tabs usecase-tabs" data-tablist aria-label="Business use cases">{tabs}</div>{panels}<span class="sr-only" data-tab-status aria-live="polite"></span></div></section>
    <section class="section soft-section"><div class="wrap"><div class="section-head reveal"><h2>Find your starting point.<br><em>Build from there.</em></h2><p>Each workflow uses the same connected product, with a different task at the centre.</p></div>{static}</div></section>
    {related([('product.html','Explore the whole product','See the tools behind these workflows.'),('crm.html','Connect the next step','Keep the customer record and activity together.'),('contact.html','Walk through your own case','Tell us what your team is trying to simplify.')])}{closing('your team’s workflow')}'''

def contact():
    return f'''<section class="page-hero"><div class="wrap"><span class="eyebrow hero-title">Talk to the team</span><h1 class="hero-title">Let’s make room<br><em>for better work.</em></h1><p class="subcopy hero-copy">Tell us about your business and the tasks you want to simplify. We’ll start with a conversation.</p></div></section>
    <section class="wrap contact-layout" id="walkthrough"><div class="contact-info reveal"><p>Ask for a product walkthrough, discuss your workflow, or understand the accounts and providers your setup needs.</p><div class="contact-person"><span class="eyebrow">Your first point of contact</span><h3>Vishal Sharma</h3><p>Marketing contact · Rudra24</p><a href="tel:+919999881949">+91 99998 81949</a><div class="actions">{wa()}</div></div><div class="contact-person"><h3>Prefer email?</h3><p>For a written introduction or product enquiry.</p><a style="font-size:14px;overflow-wrap:anywhere" href="mailto:Rudra24securegroup@gmail.com">Rudra24securegroup@gmail.com</a></div></div>
    <form class="contact-form reveal" data-contact-form><h3>A little context helps.</h3><p>Prepare an enquiry, then review and send it in WhatsApp. No information is submitted to this website.</p><fieldset data-contact-fields disabled><legend class="sr-only">Prepare a WhatsApp enquiry</legend><label class="form-field">Your name <span class="optional">(optional)</span><input name="name" autocomplete="name" maxlength="100" placeholder="How should we address you?"></label><label class="form-field">Business name <span class="optional">(optional)</span><input name="business" autocomplete="organization" maxlength="150" placeholder="Your business or team"></label><label class="form-field">What would you like to explore?<select name="interest"><option value="a product walkthrough">A product walkthrough</option><option value="lead generation">Lead generation</option><option value="CRM and follow-ups">CRM and follow-ups</option><option value="outreach and calling">Outreach and calling</option><option value="recruitment">Recruitment</option><option value="provider and account setup">Provider and account setup</option></select></label><label class="form-field">Anything else? <span class="optional">(optional)</span><textarea name="message" maxlength="1200" placeholder="Tell us what your team needs."></textarea></label><button class="button" type="submit" data-js-control>Prepare my enquiry {icon('arrow')}</button></fieldset><p class="form-note">Your details stay in this page until you choose to open WhatsApp.</p><p class="thanks-note" data-enquiry-status aria-live="polite"></p><a class="button" href="https://wa.me/919999881949" target="_blank" rel="noopener noreferrer" data-prepared-enquiry hidden>Open my enquiry in WhatsApp {icon('arrow')}</a><noscript><p class="form-note">JavaScript is off. You can still contact the team directly:</p>{wa()}</noscript></form></section>
    {faq([('Can I see the app before deciding?','Ask for a product walkthrough on WhatsApp. Tell us your business type and the features you want to see.'),('What should I share about my business?','Your industry, the locations you cover and the tasks your team wants to simplify are a useful starting point. Do not send passwords or API keys.'),('How does pricing work?','Contact the team for the current product offer. Third-party AI, calling and messaging providers may have separate plans or usage charges.'),('What is needed for calling and account integrations?','It depends on the workflow. Calling needs backend and telephony setup; email, calendar, Sheets and WhatsApp need their respective authorised accounts or provider configuration.')])}'''

def write_page(slug, label, title, desc, body):
    html = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>{escape(label)} — Rudra24 AI</title><meta name="description" content="{escape(desc,quote=True)}"><meta name="theme-color" content="#FAF9F5"><meta property="og:type" content="website"><meta property="og:title" content="{escape(title,quote=True)}"><meta property="og:description" content="{escape(desc,quote=True)}"><meta property="og:site_name" content="Rudra24 AI"><link rel="icon" type="image/png" href="assets/rudra24-icon.png"><link rel="preload" href="assets/fonts/figtree-latin-variable.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="assets/fonts/eb-garamond-latin-variable.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="site.css"><link rel="stylesheet" href="refinement.css"><script src="media.js" defer></script><script src="site.js" defer></script><script src="experience.js" defer></script></head>
<body data-page="{slug}">{header(slug)}<main id="main">{body}</main>{footer()}</body></html>'''
    (SITE / f'{slug}.html').write_text(html,encoding='utf-8')

def main():
    fonts = SITE / 'assets/fonts'
    fonts.mkdir(parents=True,exist_ok=True)
    for name in ['figtree-latin-variable.woff2','geist-latin-wght-normal.woff2','eb-garamond-latin-variable.woff2','eb-garamond-latin-italic-variable.woff2','LICENSE-figtree.txt','LICENSE-ebgaramond.txt','LICENSE-Geist.txt']:
        shutil.copy2(REPO/'fonts'/name,fonts/name)
    # The square app PNG is resized once for the site; the ICO contains a wider mark.
    builders = [home,product,leads,crm,outreach,recruitment,usecases,contact]
    for page,builder in zip(PAGES,builders):
        body = builder()
        clips = {'product':['assistant'],'lead-generation':['leads'],'crm':['crm'],'outreach':['calling','outreach']}.get(page[0], [])
        if clips:
            body = body.replace(closing(), ''.join(feature_film(key) for key in clips) + closing()) if page[0]=='product' else body
            if page[0]!='product':
                pos = body.rfind('<section class="closing">')
                body = body[:pos] + ''.join(feature_film(key) for key in clips) + body[pos:]
        write_page(*page,body)
        print(f'Built {page[0]}.html')

if __name__=='__main__':
    main()




