"""Render the approved four-page brochure; app-local fonts, exact copy, A4 checks."""
from pathlib import Path
import sys
import json
import math
import zipfile
import argparse
import importlib.util
sys.path.insert(0, 'C:/Users/Khushi/.codex/visualizations/2026/10/06/01a11213-f3fa-7791-a144-34615189cea0/brochure-deps')
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.lib.pagesizes import A4
import pymupdf as fitz

ROOT = Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--language',choices=['en','hi','hinglish'],default='en')
parser.add_argument('--pamphlet',action='store_true')
ARGS=parser.parse_args()
LANG=ARGS.language
BASE=ROOT/'exports'/'rudra24-brochure'
OUT=BASE if LANG=='en' else BASE/('hindi' if LANG=='hi' else 'hinglish')
if ARGS.pamphlet:
    OUT=ROOT/'exports'/'rudra24-pamphlet'
    if LANG=='hi':OUT=OUT/'hindi'
    if LANG=='en':OUT=OUT/'english'
ASSETS=BASE/'assets'
HI=json.loads(Path(__file__).with_name('rudra24-brochure-'+('hinglish' if LANG=='hinglish' else 'hi')+'.json').read_text(encoding='utf-8'))
EN=json.loads(Path(__file__).with_name('rudra24-pamphlet-en.json').read_text(encoding='utf-8')) if ARGS.pamphlet and LANG=='en' else {}
if ARGS.pamphlet and LANG=='hi':
    HI.update(json.loads(Path(__file__).with_name('rudra24-pamphlet-hi.json').read_text(encoding='utf-8')))
if LANG=='hinglish':
    reference=json.loads(Path(__file__).with_name('rudra24-brochure-hi.json').read_text(encoding='utf-8'))
    assert HI.keys()==reference.keys(), 'Hinglish copy coverage must match the full Hindi brochure.'
    assert all(not any('\u0900'<=ch<='\u097f' for ch in v) for v in HI.values()), 'Hinglish must use Roman script.'
if LANG=='hi':
    spec=importlib.util.spec_from_file_location('hindi_type',Path(__file__).with_name('rudra24-hindi-type.py'))
    hindi_type=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hindi_type)
def devanagari(v):return any('\u0900'<=ch<='\u097f' for ch in v)
def tr(v):
    if LANG=='en':return EN.get(v,v)
    if ARGS.pamphlet and LANG=='hi' and v in HI:return HI[v]
    if LANG=='hinglish':return HI.get(v,v)
    if LANG=='en' or devanagari(v) or v in HI.values():return v
    if v in HI:return HI[v]
    assert v in ['Rudra24 Digital','Rudra24 Digital  /  Rudra24 AI','Rudra24securegroup@gmail.com'] or not any(ch.isalpha() for ch in v), ('Missing Hindi copy',v)
    return v
def type_size(v,size,style):return size*.82 if LANG=='hi' and devanagari(v) and style in ['serif','italic'] else size
OUT.mkdir(parents=True, exist_ok=True)
ASSETS.mkdir(exist_ok=True)
S=4
W,H=4960,7016
INK='#20392C'; OLIVE='#36583C'; MUTE='#4E5D54'; PAPER='#F7F2E6'; IVORY='#FFFEF8'
SAGE='#DCE8CC'; BLUE='#DCE9F0'; CLAY='#F0DACC'; GOLD='#EDDFAB'; BINK='#466477'; CINK='#895D46'
fonts={}
for name,src,weight in [('sans','figtree-latin-variable.woff2',400),('bold','figtree-latin-variable.woff2',600),('serif','eb-garamond-latin-variable.woff2',400),('italic','eb-garamond-latin-italic-variable.woff2',400)]:
    dest=ASSETS/(name+'.ttf')
    if not dest.exists():
        tf=TTFont(ROOT/'fonts'/src)
        tf=instantiateVariableFont(tf,{'wght':weight},inplace=True)
        tf.flavor=None
        tf.save(dest)
    fonts[name]=dest
cache={}; copy=[]; pages=[]
def font(size,style='sans'):
    key=(size,style)
    if key not in cache:cache[key]=ImageFont.truetype(str(fonts[style]),round(size*S))
    return cache[key]
def rect(box,fill,r=16,stroke=None):
    d.rounded_rectangle(tuple(round(v*S) for v in box),radius=round(r*S),fill=fill,outline=stroke,width=S)
def line(points,color=OLIVE,width=2):
    d.line([(round(x*S),round(y*S)) for x,y in points],fill=color,width=round(width*S),joint='curve')
def dot(x,y,r=4,color=OLIVE):
    d.ellipse(((x-r)*S,(y-r)*S,(x+r)*S,(y+r)*S),fill=color)
def nav_icon(kind,x,y,color):
    def ln(points):line([(x+a,y+b) for a,b in points],color,2)
    if kind=='chat':
        ln([(0,1),(25,1),(25,19),(10,19),(3,26),(3,19),(0,19),(0,1)])
    elif kind=='table':
        ln([(0,0),(25,0),(25,25),(0,25),(0,0)])
        ln([(0,8),(25,8)]);ln([(8,0),(8,25)])
    elif kind=='pin':
        d.ellipse(((x+3)*S,y*S,(x+23)*S,(y+20)*S),outline=color,width=2*S)
        ln([(5,17),(13,29),(21,17)]);dot(x+13,y+10,3,color)
    elif kind=='phone':
        ln([(6,0),(0,6),(3,15),(12,24),(22,27),(28,21),(21,14),(17,19),(10,12),(13,7),(6,0)])
    elif kind=='whatsapp':
        d.ellipse((x*S,(y-1)*S,(x+27)*S,(y+26)*S),outline=color,width=2*S)
        ln([(5,21),(2,28),(10,25)])
        line([(x+8,y+6),(x+6,y+9),(x+9,y+16),(x+15,y+20),(x+19,y+20),(x+21,y+17),(x+17,y+14),(x+14,y+16),(x+10,y+12),(x+12,y+9),(x+8,y+6)],color,2)
    else:
        ln([(0,3),(27,3),(27,22),(0,22),(0,3)])
        ln([(0,5),(13,15),(27,5)])
def measure(v,size,style='sans'):
    v=tr(v);size=type_size(v,size,style)
    if LANG=='hi' and devanagari(v):return hindi_type.shaped(v,round(size*S),style!='sans')[2]/S
    return d.textlength(v,font=font(size,style))/S
def text(x,y,v,size=23,style='sans',color=INK,width=None):
    v=tr(v)
    tw=measure(v,size,style)
    assert x>=0 and x+tw<=1240, (v,'page edge')
    assert y>=0 and y+size*1.25<=1754, (v,'page bottom')
    if width is not None:assert tw<=width+.5,(v,tw,width)
    size=type_size(v,size,style)
    if LANG=='hi' and devanagari(v):
        mask,xoff,_=hindi_type.shaped(v,round(size*S),style!='sans')
        c.paste(color,(round(x*S+xoff),round(y*S)),mask)
    else:d.text((round(x*S),round(y*S)),v,font=font(size,style),fill=color,anchor='lt')
    copy.append(v)
def wrap(x,y,v,width,size=23,style='sans',color=MUTE,leading=None,max_lines=8):
    v=tr(v)
    leading=leading or size*1.42
    rows=[]
    for para in v.split('\n'):
        row=''
        for word in para.split():
            c=(row+' '+word).strip()
            if row and measure(c,size,style)>width:rows.append(row);row=word
            else:row=c
        rows.append(row)
    assert len(rows)<=max_lines,(v,rows)
    for i,v in enumerate(rows):text(x,y+i*leading,v,size,style,color,width)
    return y+len(rows)*leading
def label(x,y,v,color=OLIVE):text(x,y,v,19,'bold',color)
def pill(x,y,v,fill=SAGE,color=OLIVE,size=20):
    v=tr(v)
    w=measure(v,size,'bold')+32
    rect((x,y,x+w,y+38),fill,19)
    text(x+16,y+8,v,size,'bold',color)
    return w
def bullet(x,y,v,width,color=OLIVE):
    dot(x+4,y+10,4,color)
    return wrap(x+22,y,v,width-22,23,color=INK,max_lines=2)+13
def explain(x,y,kicker,heading,body,bullets,width=510,color=OLIVE):
    label(x,y,kicker,color)
    yy=wrap(x,y+38,heading,width,42,'serif',INK,45,max_lines=3)
    yy=wrap(x,yy+18,body,width,23,max_lines=5)+20
    for b in bullets:yy=bullet(x,yy,b,width,color)
    return yy
def logo(x,y,w=96):
    global d
    im=Image.open(ROOT/'assets'/'rudra24-icon.png').convert('RGBA')
    im.thumbnail((w*S,w*S),Image.Resampling.LANCZOS)
    c.paste(im,(round(x*S),round(y*S)),im)
    d=ImageDraw.Draw(c)
def start(page,title):
    global c,d
    c=Image.new('RGB',(W,H),PAPER);d=ImageDraw.Draw(c)
    if ARGS.pamphlet and LANG=='en':
        logo(70,44,128)
        text(224,57,'Rudra24 Digital',54,'bold')
        unit='A Unit of Rudra24 Secure Services PVT LTD'
        brand_width=measure('Rudra24 Digital',54,'bold')
        text(224,123,unit,17,'bold',OLIVE,width=brand_width)
    else:
        logo(70,50,108 if page==1 else 86)
        text(200 if page==1 else 174,57,'Rudra24 Digital',48 if page==1 else 39,'bold')
    if ARGS.pamphlet and LANG!='en':
        text(202,113,'A.I. unit of Rudra24secure Services Private Limited',19,'bold',OLIVE,width=968)
        text(202,143,'Rudra24 AI /',21,color=MUTE)
    elif not ARGS.pamphlet:
        text(202 if page==1 else 176,116 if page==1 else 107,'Rudra24 AI  /  SaaS sales workspace',22,color=MUTE)
    line([(70,188 if ARGS.pamphlet else 172),(1170,188 if ARGS.pamphlet else 172)],'#DADFD0',1)
    if page>1:label(70,206,title)
    pages.append({'page':page,'title':title})
def footer(page):
    line([(70,1694),(1170,1694)],'#DADFD0',1)
    text(70,1712,'Rudra24 Digital  /  Rudra24 AI',18,'bold',OLIVE)
    text(1060,1712,f'0{page} / 04',18,color=MUTE)
def app(x,y,w,h,title,fill=IVORY):
    rect((x,y,x+w,y+h),fill,20,'#D5DDCF')
    rect((x,y,x+w,y+50),'#EEF0E6',20)
    d.rectangle((x*S,(y+25)*S,(x+w)*S,(y+50)*S),fill='#EEF0E6')
    for i,col in enumerate(['#BA7D61','#B9A15F','#80A073']):dot(x+22+i*16,y+24,4,col)
    text(x+82,y+15,title,20,'bold',INK,width=w-104)
def leadview(x,y,w=530,h=440):
    app(x,y,w,h,'Lead generation')
    text(x+24,y+73,'Generate 10 business leads in Gurugram',18 if LANG=='hinglish' else 20,'bold',OLIVE,width=w-48)
    text(x+24,y+112,'Industry + location + requested count',20,color=MUTE)
    for i,(name,sector,priority) in enumerate([('Hotel lead','Hospitality','High'),('Hospital lead','Healthcare','Medium'),('Office lead','Corporate','High')]):
        yy=y+158+i*78
        rect((x+20,yy,x+w-20,yy+66),['#E6EEDC','#E4EDF1','#F2E4D7'][i],12)
        text(x+35,yy+12,name,22,'bold')
        text(x+35,yy+38,sector+' / contact profile',19,color=MUTE)
        text(x+w-(158 if LANG in ['hi','hinglish'] else 115),yy+20,priority,16 if LANG in ['hi','hinglish'] else 19,'bold',OLIVE)
    text(x+24,y+h-31,'Illustrative product view',18,color=MUTE)
def pin(x,y,color=OLIVE):
    d.polygon([(x*S,(y+21)*S),((x-10)*S,y*S),((x+10)*S,y*S)],fill=color)
    dot(x,y,14,color);dot(x,y,5,IVORY)
def mapview(x,y,w=540,h=390):
    app(x,y,w,h,'Company lead map',BLUE)
    for coords in [[(x+7,y+150),(x+130,y+210),(x+300,y+155),(x+w-7,y+220)],[(x+170,y+56),(x+190,y+160),(x+140,y+h-7)],[(x+420,y+56),(x+355,y+195),(x+400,y+h-7)]]:
        line(coords,'#C3D3CD',17);line(coords,IVORY,11)
    rect((x+22,y+70,x+128,y+125),SAGE,12)
    rect((x+235,y+75,x+340,y+120),GOLD,12)
    for xx,yy,col in [(x+140,y+165,OLIVE),(x+296,y+220,BINK),(x+413,y+130,CINK),(x+75,y+286,'#927C40')]:pin(xx,yy,col)
    rect((x+215,y+252,x+w-22,y+h-48),IVORY,13)
    text(x+231,y+269,'Company profile',22,'bold')
    text(x+231,y+304,'Contacts + directions',20,color=MUTE)
    text(x+22,y+h-30,'Illustrative product view',18,color=MUTE)
def callview(x,y,w=520,h=554):
    app(x,y,w,h,'AI calling workspace')
    pill(x+22,y+70,'Agent preview',CLAY,CINK,19)
    text(x+24,y+131,'Client outreach agent',24 if LANG=='hi' else 29,'bold',width=w-48)
    text(x+24,y+176,'Instructions  /  Voice  /  Call records',21,color=MUTE)
    rect((x+24,y+219,x+w-24,y+304),SAGE,14)
    for i in range(38):
        hh=8+abs(math.sin(i*.8))*43
        line([(x+45+i*8,y+261-hh/2),(x+45+i*8,y+261+hh/2)],OLIVE,3)
    text(x+365,y+248,'Voice',21,'bold',OLIVE)
    rect((x+24,y+326,x+w-24,y+438),BLUE,14)
    text(x+41,y+344,'Opening script',22,'bold',BINK)
    wrap(x+41,y+382,'Hello, may I speak with the person managing your business services?',w-82,22,leading=29,max_lines=2)
    text(x+24,y+463,'Call queue',22,'bold')
    text(x+210,y+465,'Lead  /  next action',20,color=MUTE)
    text(x+22,y+h-29,'Illustrative product view',18,color=MUTE)

def cover_workspace():
    x,y=70,677
    app(x,y,1100,660,'Rudra24 AI / sales workspace')
    rect((x,y+50,x+83,y+660),OLIVE,20)
    d.rectangle(((x+40)*S,(y+50)*S,(x+83)*S,(y+660)*S),fill=OLIVE)
    logo(x+16,y+70,51)
    for i,kind in enumerate(['chat','table','pin','phone','mail']):
        yy=y+162+i*78
        if i==0:rect((x+19,yy-9,x+65,yy+37),IVORY,11)
        col=OLIVE if i==0 else '#E3EBD7'
        nav_icon(kind,x+29,yy,col)
    text(180,y+77,'Your market. One workspace.',31,'bold')
    pill(917,y+70,'Demo view',BLUE,BINK,19)
    rect((180,y+142,631,y+524),IVORY,16,'#D5DDCF')
    pill(200,y+161,'Generate business leads',SAGE,OLIVE,20)
    text(200,y+220,'Gurugram / selected industries',22,'bold',width=415)
    for i,(name,sector,col) in enumerate([('Hotel lead','Hospitality',SAGE),('Hospital lead','Healthcare',BLUE),('Office lead','Corporate',CLAY)]):
        yy=y+269+i*70
        rect((200,yy,611,yy+58),col,11)
        text(216,yy+10,name,22,'bold')
        text(216,yy+36,sector+' / contact profile',18,color=MUTE)
        dot(582,yy+27,9,OLIVE)
    mapview(657,y+142,487,382)
    rect((180,y+548,759,y+618),SAGE,14)
    text(201,y+564,'AI calling',24,'bold')
    for i in range(26):
        hh=6+abs(math.sin(i*.8))*28
        line([(365+i*8,y+583-hh/2),(365+i*8,y+583+hh/2)],OLIVE,3)
    text(598,y+571,'Agent preview',20,'bold',OLIVE)
    rect((780,y+548,1144,y+618),CLAY,14)
    text(800,y+560,'CRM + follow-ups',24,'bold')
    text(800,y+591,'Keep the next step in view',18,color=MUTE)
    text(180,y+633,'Illustrative product view',18,color=MUTE)
def emailview(x,y,w=510,h=345):
    app(x,y,w,h,'Email campaign preview')
    label(x+24,y+76,'PERSONALISED OUTREACH',BINK)
    text(x+24,y+118,'Subject: A proposal for your team',21,'bold',width=w-48)
    wrap(x+24,y+164,'Hello,\nHere is a service proposal tailored to your business. May we arrange a short conversation?',w-48,22,leading=32,max_lines=4)
    pill(x+24,y+h-82,'Review before sending',BLUE,BINK,19)
    text(x+24,y+h-30,'Illustrative product view',18,color=MUTE)
def crmview(x,y,w=1100,h=290):
    app(x,y,w,h,'CRM / client pipeline')
    cw=(w-64)/3
    for i,(name,sub,col) in enumerate([('New opportunity','Lead profile + next action',SAGE),('Follow-up','Conversation + meeting',BLUE),('Client relationship','Contract + renewal',CLAY)]):
        xx=x+20+i*(cw+12)
        rect((xx,y+70,xx+cw,y+h-50),col,14)
        text(xx+18,y+90,name,25,'bold',width=cw-36)
        wrap(xx+18,y+139,sub,cw-36,22,max_lines=2)
        rect((xx+18,y+h-103,xx+cw-18,y+h-67),IVORY,8)
        text(xx+31,y+h-94,'Owner  /  next step',20,color=MUTE)
    text(x+24,y+h-30,'Illustrative product view',18,color=MUTE)
def aiview(x,y,w=490,h=300):
    app(x,y,w,h,'Rudra24 AI assistant',SAGE)
    wrap(x+24,y+78,'Draft a follow-up for my next client meeting.',w-48,24,'bold',INK,33,max_lines=2)
    rect((x+24,y+170,x+w-24,y+239),IVORY,13)
    text(x+40,y+186,'Follow up on your proposal and',21,'bold',width=w-80)
    text(x+40,y+215,'suggest a convenient meeting time.',21,color=MUTE,width=w-80)
    text(x+24,y+h-31,'Illustrative product view',18,color=MUTE)
def save(page):
    path=OUT/f'Rudra24-Digital-Brochure-{page:02}.jpg'
    c.save(path,quality=100,subsampling=0,dpi=(600,600),optimize=True)
    c.save(path.with_suffix('.png'),dpi=(600,600),optimize=True)
    c.resize((1240,1754),Image.Resampling.LANCZOS).save(OUT/f'preview-{page:02}.png')
    with Image.open(path) as chk:
        assert chk.size==(W,H) and chk.info['dpi']==(600,600)
        chk.verify()

if ARGS.pamphlet:
    start(1,'Autopilot / Attraction Pamphlet')
    label(70,207,'BUSINESS GROWTH / SMART SALES AUTOMATION')
    if LANG=='en':
        text(68,247,'Ready to put your',72,'serif',width=720)
        text(68,327,'business on',80,'serif',width=720)
        text(68,411,'autopilot?',88,'italic',OLIVE,width=720)
        manager=Image.open(ASSETS/'ai-manager.png').convert('RGBA')
        assert manager.getextrema()[-1][0]==0, 'Manager asset must retain transparency.'
        manager.thumbnail((350*S,233*S),Image.Resampling.LANCZOS)
        c.paste(manager,(round((820+(350-manager.width/S)/2)*S),235*S),manager)
        d=ImageDraw.Draw(c)
        text(836,479,'YOUR AI SALES MANAGER',17,'bold',OLIVE,width=334)
    else:
        text(68,247,'Kya aap apne business ko',62,'serif',width=945)
        text(68,316,'autopilot par chalana',80,'italic',OLIVE,width=945)
        text(68,386 if LANG=='hi' else 406,'chahte hain',72,'serif',width=850)
        text(1000,241,'?',238,'serif',CINK,width=170)
    text(70,512,'Meet Rudra24 AI.',34,'bold')
    wrap(70,552,'Aapke business ke liye ek game-changer ho sakta hai.',700,28,'serif',OLIVE,leading=34,max_lines=1)
    wrap(70,594,'Rudra24 Digital laaya hai aapka smart AI marketing manager - leads, outreach aur client management ko ek saath automate karne ke liye.',700,21,leading=29,max_lines=3)
    rect((820,508,1170,682),BLUE,20)
    text(844,527,'MONTHLY LEAD OFFERING',19 if LANG=='en' else 17,'bold',BINK,width=300)
    text(842,563,'500 - 2,000',47,'bold',INK,width=307)
    text(845,613,'LEADS / MONTH',19,'bold',BINK)
    text(845,641,'Lead volume depends on your package.',13,'bold',BINK,width=304)
    text(845,659,'Terms and conditions apply.',13,color=BINK,width=304)

    # A representative app workspace, not a testimonial or live-run claim.
    app(70,694,1100,409,'Rudra24 AI / Sales Automation Workspace')
    text(94,763,'Generate leads in my selected area',22,'bold',OLIVE,width=535)
    for i,(name,sector,col) in enumerate([('Hotel Lead','Hospitality',SAGE),('Hospital Lead','Healthcare',BLUE),('Office Lead','Corporate',CLAY)]):
        yy=806+i*64
        rect((94,yy,632,yy+53),col,12)
        text(111,yy+10,name,22,'bold')
        text(111,yy+33,sector+' / Contact Details',17,color=MUTE)
        text(470 if LANG=='hi' else 490,yy+19,'Lead Profile',17 if LANG=='hi' else 18,'bold',OLIVE,width=146 if LANG=='hi' else 125)
    rect((676,761,1145,990),BLUE,16)
    text(695,777,'Company Lead Map',22,'bold',BINK)
    for road in [[(687,884),(808,863),(945,905),(1134,863)],[(825,823),(860,878),(843,979)],[(1040,823),(1008,911),(1050,979)]]:
        line(road,'#C3D3CD',14);line(road,IVORY,9)
    for px,py,col in [(785,864,OLIVE),(868,845,CINK),(954,883,BINK),(1083,888,OLIVE)]:pin(px,py,col)
    rect((851,916,1132,980),IVORY,9)
    text(864,920,'Selected company',15,'bold',INK,width=253)
    text(864,939,'Gurugram / Facilities',14,color=MUTE,width=253)
    text(864,957,'Contact details / Directions',13,'bold',BINK,width=253)
    rect((94,1006,632,1062),SAGE,13)
    nav_icon('phone',111,1020,OLIVE)
    text(156,1023,'AI Calling Agent',23,'bold')
    for i in range(25):
        hh=6+abs(math.sin(i*.8))*27
        line([(407+i*7,1035-hh/2),(407+i*7,1035+hh/2)],OLIVE,3)
    rect((676,1006,1145,1062),CLAY,13)
    text(696,1013 if LANG in ['hi','en'] else 1017,'Voice-command Control',21 if LANG in ['hi','en'] else 23,'bold',CINK,width=429)
    text(696,1040 if LANG in ['hi','en'] else 1045,'Boliye. Sales tasks shuru karein.',16 if LANG in ['hi','en'] else 17,color=MUTE,width=429)
    text(94,1076,'Illustrative Product View / Aapke control mein',17,color=MUTE)

    features=[
        ('chat','Auto Lead Generation','Quality-focused leads, aapke market ke liye.',SAGE,OLIVE),
        ('phone','AI Auto Calling','Call scripts, queues aur conversation records.',CLAY,CINK),
        ('mail','Email Automation','Personalised emails aur authorised sending.',BLUE,BINK),
        ('chat','WhatsApp Automation*','Message drafts, follow-ups aur SMS campaigns.',GOLD,OLIVE),
        ('table','CRM & Client Pipeline','Deals, clients, contracts aur renewals ka track.',SAGE,OLIVE),
        ('pin','Company Info on Maps','Company details, location pins aur directions.',BLUE,BINK)
    ]
    for i,(kind,title,body,fill,col) in enumerate(features):
        x=70+(i%2)*562;y=1132+(i//2)*105
        rect((x,y,x+538,y+94),fill,15)
        nav_icon(kind,x+20,y+22,col)
        text(x+64,y+17,title,22 if LANG=='en' and i==3 else 24,'bold',INK,width=455)
        wrap(x+64,y+52,body,454,20,leading=25,max_lines=2)
    line([(70,1511),(1170,1511)],'#B7C4AC',1)
    text(70,1530,'Apna live demo book karein.',30,'bold',OLIVE)
    text(720,1537,'WhatsApp par contact karein',25,'bold',OLIVE,width=450)
    nav_icon('whatsapp',722,1577,OLIVE)
    text(757,1579,'9999881949',22,'bold',INK,width=160)
    nav_icon('whatsapp',922,1577,OLIVE)
    text(957,1579,'9625729177',22,'bold',INK,width=160)
    nav_icon('mail',722,1617,BINK)
    text(757,1616,'Rudra24securegroup@gmail.com',21,'bold',INK,width=400)
    text(70,1583,'Vishal Sharma / Marketing Manager',21,'bold',INK,width=625)
    wrap(70,1661,'*Calling and SMS require setup. WhatsApp messages are sent after your confirmation.',1100,16,leading=22,max_lines=1)

    stem='Rudra24-Digital-Autopilot-Pamphlet'+('-Hindi' if LANG=='hi' else '-English' if LANG=='en' else '')
    jpg=OUT/(stem+'.jpg');png=OUT/(stem+'.png');pdfpath=OUT/(stem+'.pdf')
    c.save(jpg,quality=100,subsampling=0,dpi=(600,600),optimize=True)
    c.save(png,dpi=(600,600),optimize=True)
    c.resize((1240,1754),Image.Resampling.LANCZOS).save(OUT/'Pamphlet-preview.png')
    pdf=pdfcanvas.Canvas(str(pdfpath),pagesize=A4,pageCompression=1)
    pdf.setTitle('Rudra24 Digital | Smart Sales Automation')
    pdf.setAuthor('Rudra24 Digital')
    pdf.drawImage(str(jpg),0,0,width=A4[0],height=A4[1])
    for number,x in [('9999881949',757),('9625729177',957)]:
        x2=x+measure(number,22,'bold')
        pdf.linkURL('https://wa.me/91'+number,(x/1240*A4[0],(1754-1610)/1754*A4[1],x2/1240*A4[0],(1754-1573)/1754*A4[1]),relative=0)
    pdf.showPage();pdf.save()
    doc=fitz.open(pdfpath)
    assert len(doc)==1 and len(doc[0].get_links())==2
    assert abs(doc[0].rect.width-A4[0])<.01 and abs(doc[0].rect.height-A4[1])<.01
    doc[0].get_pixmap(dpi=150).save(str(OUT/'pdf-review.png'))
    with Image.open(jpg) as check:
        assert check.size==(W,H) and check.info['dpi']==(600,600)
        check.verify()
    with Image.open(png) as check:
        assert check.size==(W,H)
        check.verify()
    assert len(features)==6 and all(any(k in row for row in copy) for k in ['500 - 2,000','9999881949','9625729177','Rudra24securegroup@gmail.com'])
    if LANG=='en':
        assert any('Lead volume depends on your package.' == row for row in copy)
        assert any('Terms and conditions apply.' == row for row in copy)
        assert any('A potential game-changer for your business growth.' == row for row in copy)
    if LANG=='hi':
        assert any(devanagari(row) for row in copy)
    else:
        assert all(row.isascii() for row in copy)
    if LANG=='en':
        assert 'autopilot?' in copy and '?' not in copy
        assert 'Rudra24 AI /' not in copy
        assert copy.count('A Unit of Rudra24 Secure Services PVT LTD')==1
        assert any('Auto Text Messages' in row for row in copy)
        assert set(link['uri'] for link in doc[0].get_links())=={'https://wa.me/919999881949','https://wa.me/919625729177'}
    else:
        assert 'Rudra24 AI /' in copy
        assert copy.count('A.I. unit of Rudra24secure Services Private Limited')==1
    assert not any('SaaS' in row for row in copy)
    (OUT/'approved-copy.txt').write_text('\n'.join(copy),encoding='utf-8')
    (OUT/'verification.json').write_text(json.dumps({'pages':1,'language':'English' if LANG=='en' else 'Easy Hindi with English technical terms' if LANG=='hi' else 'Professional Roman Hinglish','pixels':[W,H],'dpi':600,'lead_offering':'500 - 2,000 monthly; package-dependent (user-provided offer)','features':6,'voice_control':True,'whatsapp_numbers':'Side by side with icon; both linked in PDF','email':'Mail icon beside email','map':'Illustrative pins with selected-company area/contact/directions card','pdf_contact_links':2,'attribution':'Under company name, once; width bounded to brand name','subtitle':'Removed' if LANG=='en' else 'Rudra24 AI /','ai_manager_illustration':LANG=='en','growth_chart_on_laptop':LANG=='en','auto_text_messages':LANG=='en'},indent=2),encoding='utf-8')
    print(jpg)
    print('PASS: A4 pamphlet, 600 DPI, offering, contacts and PDF verified.')
    sys.exit(0)

# Page 1: a product-led cover with an integrated app workspace.
start(1,'Introducing Rudra24 AI')
label(70,216,'SALES AUTOMATION, WITH YOU IN CONTROL')
text(68,257,'Automate your sales.',78,'serif',width=1102)
text(68,340,'With Rudra24 AI.',78,'serif',width=1102)
text(68,423,'Focus on growth.',78,'italic',OLIVE,width=1102)
wrap(70,528,'Generate leads, prepare outreach and organise follow-ups in one AI-powered workspace. Spend less time on routine tasks and more time on client relationships.',1070,25,leading=36,max_lines=3)
cover_workspace()
label(70,1380,'MORE TIME FOR CLIENTS. LESS TIME ON ROUTINE TASKS.')
wrap(70,1416,'Generate. Connect. Follow up. Manage - in one workspace.',1090,29,'serif',INK,max_lines=1)
rect((70,1490,1170,1648),OLIVE,22)
text(99,1520,'See Rudra24 AI in action. Book your live demo.',35,'serif',IVORY,width=1040)
text(100,1581,'Contact us on WhatsApp',26,'bold',IVORY)
text(730,1581,'9999881949  |  9625729177',29,'bold',GOLD,width=410)
footer(1);save(1)

# Page 2: alternating lead-generation and map modules.
start(2,'01  /  LEAD GENERATION & LOCATION INTELLIGENCE')
text(68,253,'Your next client',66,'serif')
text(68,324,'starts with the right lead.',66,'italic',OLIVE)
wrap(70,410,'Choose your industry and area. Build a focused lead list, then see where the opportunities are.',1080,24,leading=34,max_lines=2)
leadview(70,512,530,430)
end=explain(649,512,'AI LEAD GENERATION','Get leads that fit.','Focus your search on businesses that match your market, rather than working through an unfocused list.',[
    'Choose an industry, city or locality.',
    'Set the number of leads you need.',
    'Review contact profiles and lead scores.'
],width=520)
assert end<965,end
end=explain(70,1004,'COMPANY LEAD MAP','Put opportunity on the map.','Turn a lead list into a clearer view of your territory. Explore saved companies on a map and plan your next conversation.',[
    'View company pins in your chosen area.',
    'Open available contact information.',
    'Use directions to plan local visits.'
],width=500,color=BINK)
assert end<1440,end
mapview(630,1004,540,400)
rect((70,1460,1170,1654),BLUE,20)
label(94,1481,'ALL-INDIA REACH / A RANGE OF INDUSTRIES',BINK)
wrap(94,1520,'Hotels, healthcare, IT parks, retail, manufacturing, logistics, education, offices, residential societies, real estate, aviation and food service.',1050,23,leading=32,max_lines=3)
text(94,1624,'Available contact details and scoring support your review.',22,color=MUTE,width=1050)
footer(2);save(2)

# Page 3: detailed calling UI, mirrored email module and a messaging band.
start(3,'02  /  CALLING & OUTREACH')
text(68,253,'Less busywork.',70,'serif')
text(68,329,'More client conversations.',70,'italic',OLIVE)
callview(70,451,520,554)
end=explain(650,451,'AI CALLING AGENTS','Let AI start the conversation.','Create an AI calling agent around your business context, then organise outreach and review the conversation.',[
    'Configure agent instructions and scripts.',
    'Manage outbound call queues.',
    'Review supported transcripts and recordings.'
],width=520,color=CINK)
assert end<985,end
wrap(650,941,'Calling requires a configured provider and account.',520,22,color=MUTE,max_lines=2)
end=explain(70,1060,'EMAIL AUTOMATION','Personal emails. Less effort.','Prepare relevant messages for each lead and keep your sending workflow organised.',[
    'Create personalised campaign templates.',
    'Preview content before sending.',
    'Send through a connected, authorised account.'
],width=510,color=BINK)
assert end<1440,end
emailview(650,1060,520,345)
rect((70,1473,1170,1666),SAGE,20)
label(94,1493,'WHATSAPP & SMS / KEEP THE CONVERSATION GOING')
wrap(94,1530,'Prepare lead-specific messages, open WhatsApp chats and organise SMS campaigns. Keep follow-up clear and intentional.',1050,23,leading=32,max_lines=2)
text(94,1603,'Prepare messages  /  confirm WhatsApp sends  /  queue SMS',23,'bold',OLIVE,width=1050)
text(94,1639,'WhatsApp sending is user-confirmed; SMS needs a configured connection.',22,color=MUTE,width=1050)
footer(3);save(3)

# Page 4: wide pipeline, compact explanation, mirrored assistant and contact finale.
start(4,'03  /  CLIENT MANAGEMENT & AI ASSISTANCE')
text(68,253,'Keep clients close.',67,'serif')
text(68,324,'Keep sales organised.',76,'italic',OLIVE)
crmview(70,435,1100,280)
label(70,753,'CRM & CLIENT MANAGEMENT')
wrap(70,790,'Every client. Every next step. In one place.',1090,37,'serif',INK,max_lines=1)
for i,(heading,body) in enumerate([('Track the next step','Organise deals, client records and follow-up activity.'),('Manage the relationship','Keep contracts and upcoming renewals in view.'),('Plan the conversation','Coordinate tasks, meetings and reminders.')]):
    xx=70+i*375
    text(xx,851,heading,24,'bold',width=350)
    wrap(xx,890,body,335,23,leading=32,max_lines=3)
aiview(70,1030,490,295)
end=explain(605,1030,'RUDRA24 AI ASSISTANT','Your AI partner for everyday sales.','Support the everyday work around your sales conversations.',[
    'Chat in Hindi, English or Hinglish.',
    'Prepare drafts and call scripts.',
    'Use voice and persistent context.'
],width=565)
assert end<1402,end
rect((70,1398,1170,1471),GOLD,16)
text(91,1410,'Recruitment AI  /  Excel & CSV  /  Google Sheets  /  Analytics',22,'bold',INK,width=1060)
text(91,1441,'Find candidates, manage lists, sync data and review reports.',22,color=MUTE,width=1060)
line([(70,1500),(1170,1500)],'#A9BAA0',1)
label(70,1517,'ABOUT US')
text(228,1513,'Rudra24 Digital',29,'bold',INK)
text(720,1515,'Contact us on WhatsApp',25,'bold',OLIVE,width=450)
text(70,1557,'AI tools for lead generation and client management.',23,color=MUTE,width=640)
text(720,1557,'Vishal Sharma / Marketing Manager',22,'bold',INK,width=450)
text(70,1601,'9999881949  |  9625729177',39,'bold',INK,width=625)
text(720,1609,'Rudra24securegroup@gmail.com',23,'bold',INK,width=450)
text(70,1654,'Message us to arrange your live demo.',23,color=OLIVE)
text(70,1707,'A.I. unit of Rudra24secure Services Private Limited',20,'bold',OLIVE,width=1040)
text(1060,1710,'04 / 04',18,color=MUTE)
save(4)

# Deliver an A4 PDF with working contact links, plus the four JPGs as a ZIP.
pdfpath=OUT/'Rudra24-Digital-Brochure.pdf'
pdf=pdfcanvas.Canvas(str(pdfpath),pagesize=A4,pageCompression=1)
pdf.setTitle('Rudra24 Digital | Rudra24 AI')
pdf.setAuthor('Rudra24 Digital')
for n in range(1,5):
    pdf.drawImage(str(OUT/f'Rudra24-Digital-Brochure-{n:02}.jpg'),0,0,width=A4[0],height=A4[1])
    if n==4:
        for number,prefix in [('9999881949',''),('9625729177','9999881949  |  ')]:
            x1=70+measure(prefix,39,'bold');x2=x1+measure(number,39,'bold')
            pdf.linkURL('https://wa.me/91'+number,(x1/1240*A4[0],(1754-1646)/1754*A4[1],x2/1240*A4[0],(1754-1600)/1754*A4[1]),relative=0)
    pdf.showPage()
pdf.save()
doc=fitz.open(pdfpath)
assert len(doc)==4
for n,p in enumerate(doc,1):
    assert abs(p.rect.width-A4[0])<.01 and abs(p.rect.height-A4[1])<.01
    p.get_pixmap(dpi=100).save(str(OUT/f'pdf-review-{n:02}.png'))
assert len(doc[3].get_links())==2
doc.close()
contact=Image.new('RGB',(1040,1508),'#E8E4D8')
for n in range(1,5):
    thumb=Image.open(OUT/f'preview-{n:02}.png').resize((500,707),Image.Resampling.LANCZOS)
    contact.paste(thumb,(10+((n-1)%2)*520,10+((n-1)//2)*754))
contact.save(OUT/'Brochure-preview.png')
with zipfile.ZipFile(OUT/'Rudra24-Digital-JPGs.zip','w',zipfile.ZIP_STORED) as z:
    for n in range(1,5):
        p=OUT/f'Rudra24-Digital-Brochure-{n:02}.jpg';z.write(p,p.name)
assert not any('generate companies' in s.lower() or 'guaranteed' in s.lower() for s in copy)
assert all(any(s in row for row in copy) for s in ['9999881949','9625729177','Rudra24securegroup@gmail.com'])
assert '9999881949  |  9625729177' in copy
(OUT/'verification.json').write_text(json.dumps({'language':LANG,'pages':pages,'pixels':[W,H],'dpi':600,'pdf_pages':4,'contact_links':2,'fonts':['Figtree','EB Garamond'] if LANG!='hi' else ['Nirmala UI (HarfBuzz shaped)','Figtree (brand / numbers)'],'text_elements':len(copy),'contact_layout':'One line, unboxed numbers','visuals':'App-inspired illustrative UI only; no people photographs'},indent=2),encoding='utf-8')
(OUT/'approved-copy.txt').write_text('\n'.join(copy),encoding='utf-8')
print(pdfpath)
print('PASS: four A4 pages, all JPGs decoded, contacts checked, PDF pages and links verified.')
