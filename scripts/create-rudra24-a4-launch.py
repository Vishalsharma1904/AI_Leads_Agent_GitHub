"""Typeset the Rudra24 launch sheet on an A4 canvas, with exact marketing copy."""
from pathlib import Path
import math
import json
import argparse
import importlib.util
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'exports' / 'rudra24-launch'
OUT.mkdir(parents=True, exist_ok=True)
FONTS = Path('C:/Users/Khushi/.codex/plugins/cache/claude-cowork/anthropic-skills/1.0.0/skills/canvas-design/canvas-fonts')
parser=argparse.ArgumentParser()
parser.add_argument('--language',choices=['en','hi'],default='en')
ARGS=parser.parse_args()
LANG=ARGS.language
S = 4
W, H = 4960, 7016
DPI = 600
if LANG=='hi':
    spec=importlib.util.spec_from_file_location('hindi_type',Path(__file__).with_name('rudra24-hindi-type.py'))
    hindi_type=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hindi_type)

HI = {
'BY RUDRA24 DIGITAL':'RUDRA24 DIGITAL', 'SAAS LAUNCH':'SaaS लॉन्च',
'INTRODUCING YOUR AI SALES WORKSPACE':'आपकी सेल्स टीम का नया AI साथी',
'Turn your next sales opportunity into a conversation. Generate relevant leads, plan outreach and manage clients in one SaaS workspace.':'Rudra24 AI के साथ नए ग्राहकों तक पहुँचें। अपने क्षेत्र में लीड्स जनरेट करें, संपर्क की योजना बनाएँ और क्लाइंट मैनेजमेंट करें — एक ही SaaS प्लेटफ़ॉर्म पर।',
'Contact us on WhatsApp':'WhatsApp पर संपर्क करें', 'Ask for a live demo.':'लाइव डेमो के लिए लिखें।',
'Client AI · Lead generation':'Client AI · लीड जनरेशन', 'Sample view':'डेमो दृश्य',
'Generate 10 business leads in my selected area':'मेरे चुने हुए क्षेत्र में 10 बिज़नेस लीड्स जनरेट करें',
'Relevant leads. Ready for your next move.':'प्रासंगिक लीड्स। अगले कदम की तैयारी।',
'Hospital · Healthcare':'अस्पताल · स्वास्थ्य सेवाएँ', 'IT park · Corporate':'IT पार्क · कॉर्पोरेट',
'Selected locality  ·  High priority':'चुना हुआ क्षेत्र · उच्च प्राथमिकता',
'Selected locality  ·  Contact details':'चुना हुआ क्षेत्र · संपर्क जानकारी', 'SCORE':'स्कोर',
'COMPANY LEAD MAP':'कंपनियों का लीड मैप', 'Company details':'कंपनी विवरण',
'Pins · Details · Directions':'लोकेशन · जानकारी · रास्ता',
'ALL-INDIA LOCATION TARGETING':'पूरे भारत में लोकेशन के अनुसार लीड्स',
'Local focus. Nationwide reach.':'आपका क्षेत्र। पूरे भारत में अवसर।',
'Generate leads across India, tailored to your chosen area.':'भारत में अपने चुने हुए शहर और क्षेत्र के अनुसार लीड्स जनरेट करें।',
'City':'शहर', 'Area / locality':'क्षेत्र / इलाका', 'Company pins':'कंपनी पिन',
'FROM GENERATION TO CLIENT RELATIONSHIPS':'लीड जनरेशन से ग्राहक प्रबंधन तक',
'Generate':'जनरेट करें', 'Location + industry':'लोकेशन + उद्योग',
'Prioritise':'प्राथमिकता दें', 'Scores + lead fit':'स्कोर + प्रासंगिकता',
'Reach out':'संपर्क करें', 'Email + WhatsApp + SMS':'ईमेल + WhatsApp + SMS',
'Call':'कॉल करें', 'AI agent conversations':'AI एजेंट से बातचीत',
'Manage':'मैनेज करें', 'CRM + follow-ups':'CRM + फ़ॉलो-अप',
'EVERYTHING WORKING TOGETHER':'सभी ज़रूरी काम, एक साथ',
'One platform. A connected sales workflow.':'एक प्लेटफ़ॉर्म। सेल्स के सभी काम साथ।',
'AI Lead Generation':'AI लीड जनरेशन',
'Generate business leads by\nindustry, area and quantity.':'उद्योग, क्षेत्र और संख्या के\nअनुसार बिज़नेस लीड्स जनरेट करें।',
'Opportunity Scoring':'लीड स्कोर और प्राथमिकता',
'Need estimates, 0–100 lead scores\nand clear priority ratings.':'ज़रूरत का अनुमान, 0–100 स्कोर\nऔर स्पष्ट प्राथमिकता रेटिंग।',
'Rudra24 AI Assistant':'Rudra24 AI असिस्टेंट',
'Hindi, English & Hinglish. Voice,\nmemory, drafts and call scripts.':'हिंदी, अंग्रेज़ी और हिंग्लिश। वॉइस,\nमेमोरी, ड्राफ़्ट और कॉल स्क्रिप्ट।',
'Company Lead Map':'कंपनी लीड मैप',
'Company pins, contact details\nand directions in one view.':'कंपनियों की लोकेशन, संपर्क\nऔर पहुँचने का रास्ता एक मैप पर।',
'AI Calling Agents':'AI कॉलिंग एजेंट',
'Build agents, manage call queues,\nreview transcripts & recordings.':'AI एजेंट से कॉल की योजना बनाएँ।\nबातचीत का विवरण व रिकॉर्डिंग देखें।',
'Email Campaigns':'ईमेल कैंपेन',
'Personalised templates, previews\nand connected sender accounts.':'व्यक्तिगत टेम्पलेट और प्रीव्यू।\nअपने जुड़े अकाउंट से ईमेल भेजें।',
'WhatsApp & SMS':'WhatsApp और SMS',
'Prepare messages, track confirmed\nsends and plan SMS campaigns.':'संदेश तैयार करें, भेजने की पुष्टि\nरखें और SMS कैंपेन की योजना बनाएँ।',
'CRM & Client Pipeline':'CRM और क्लाइंट पाइपलाइन',
'Track deals, clients, contracts\nand upcoming renewals.':'डील, क्लाइंट, कॉन्ट्रैक्ट और\nआने वाले रिन्यूअल का रिकॉर्ड।',
'Follow-ups & Meetings':'फ़ॉलो-अप और मीटिंग',
'Tasks, meeting schedules,\ncalendar links and reminders.':'टास्क, मीटिंग शेड्यूल,\nकैलेंडर लिंक और रिमाइंडर।',
'Candidate Recruiter AI':'AI भर्ती सहायक',
'Role & city based searches,\nwith a candidate database.':'पद व शहर के अनुसार उम्मीदवार\nखोजें और उनका रिकॉर्ड रखें।',
'Excel & Google Sheets':'Excel और Google Sheets',
'Import & enrich lists. Export\nExcel / CSV and sync to Sheets.':'सूची अपलोड करें, विवरण जोड़ें।\nExcel / CSV और Sheets सिंक।',
'Analytics & Integrations':'एनालिटिक्स और इंटीग्रेशन',
'Dashboards, reports, connectors,\nplugins and usage visibility.':'डैशबोर्ड, रिपोर्ट, कनेक्टर,\nप्लगइन और उपयोग की जानकारी।',
'Live task progress':'काम की लाइव स्थिति', 'Stop & keep results':'काम रोकें, परिणाम सुरक्षित रखें',
'Duplicate checks':'डुप्लिकेट जाँच', 'Chat history & shortcuts':'चैट हिस्ट्री और शॉर्टकट',
'Light / dark workspace':'लाइट / डार्क वर्कस्पेस',
'ACROSS INDUSTRIES':'अलग-अलग उद्योगों के लिए',
'Built around the clients you want to win.':'आप जिन ग्राहकों तक पहुँचना चाहते हैं, उनके लिए।',
'Hotels & hospitality  ·  Hospitals & healthcare  ·  IT parks & tech companies  ·  Malls & retail':'होटल व हॉस्पिटैलिटी · अस्पताल व स्वास्थ्य सेवाएँ · IT पार्क व टेक कंपनियाँ · मॉल व रिटेल',
'Factories & manufacturing  ·  Warehouses & logistics  ·  Schools & universities  ·  Banks & offices':'फ़ैक्टरी व मैन्युफ़ैक्चरिंग · वेयरहाउस व लॉजिस्टिक्स · स्कूल व विश्वविद्यालय · बैंक व ऑफ़िस',
'Residential societies  ·  Real estate & construction  ·  Airports & aviation  ·  Restaurants & food service':'आवासीय सोसायटी · रियल एस्टेट व निर्माण · एयरपोर्ट व एविएशन · रेस्टोरेंट व फ़ूड सर्विस',
'Message us for your live demo.':'अपने लाइव डेमो के लिए संदेश भेजें।',
'PRIMARY · VISHAL SHARMA':'विशाल शर्मा · मुख्य संपर्क', 'Marketing Manager':'मार्केटिंग मैनेजर',
'ALTERNATE CONTACT':'दूसरा संपर्क नंबर', 'Demo & enquiries':'डेमो और जानकारी',
'Rudra24 Secure Group':'Rudra24 Secure Group'
}

def tr(value):
    return HI.get(value,value) if LANG=='hi' else value

def devanagari(value):
    return any('\u0900'<=c<='\u097f' for c in value)

def measure(value,size,style='sans'):
    if LANG=='hi' and devanagari(value):
        return hindi_type.shaped(value,round(size*S),style in ['bold','serif','italic'])[2]/S
    return draw.textlength(value,font=font(size,style))/S
INK = '#213927'
OLIVE = '#365A3A'
GREEN = '#507654'
MUTE = '#535F53'
BEIGE = '#F6F1E4'
WHITE = '#FFFDF6'
PALE = '#E8EDE0'
LINE = '#DFE1D3'
GOLD = '#BB9C59'
BLUE = '#526D7A'
CLAY = '#9B674E'
OCHRE = '#89723E'
ACCENTS = [(OLIVE, '#D1DFC5'), (BLUE, '#CDDFE7'), (CLAY, '#EACBBA'), (OCHRE, '#E9DAAC')]

font_cache = {}
checks = []

def font(size, style='sans'):
    names = {'sans': 'InstrumentSans-Regular.ttf', 'bold': 'InstrumentSans-Bold.ttf',
             'serif': 'InstrumentSerif-Regular.ttf', 'italic': 'InstrumentSerif-Italic.ttf'}
    key = (size, style)
    if key not in font_cache:
        font_cache[key] = ImageFont.truetype(str(FONTS / names[style]), round(size*S))
    return font_cache[key]

def box(rect):
    return tuple(round(v*S) for v in rect)

def rr(rect, fill, radius=16, stroke=None, width=1, target=None):
    d = ImageDraw.Draw(target) if target is not None else draw
    d.rounded_rectangle(box(rect), radius=round(radius*S), fill=fill,
                        outline=stroke, width=round(width*S))

def line(points, color=LINE, width=1, target=None):
    d = ImageDraw.Draw(target) if target is not None else draw
    d.line([(round(x*S),round(y*S)) for x,y in points], fill=color,
           width=max(1,round(width*S)), joint='curve')

def ellipse(rect, fill=None, stroke=None, width=1, target=None):
    d = ImageDraw.Draw(target) if target is not None else draw
    d.ellipse(box(rect), fill=fill, outline=stroke, width=max(1,round(width*S)))

def text(x, y, value, size=18, style='sans', color=INK, max_w=None):
    value=tr(value)
    f = font(size,style)
    width = measure(value,size,style)
    if max_w is not None:
        assert width <= max_w+0.5, f'Text too wide: {value} ({width:.1f} > {max_w})'
    assert x >= 0 and x+width < W/S+1, f'Text outside page: {value}'
    if LANG=='hi' and devanagari(value):
        mask,x_offset,_=hindi_type.shaped(value,round(size*S),style in ['bold','serif','italic'])
        canvas.paste(color,(round(x*S+x_offset),round(y*S)),mask)
    else:
        draw.text((round(x*S),round(y*S)),value,font=f,fill=color,anchor='lt')
    checks.append({'text':value,'x':x,'y':y,'width':round(width,2),'size':size})
    return width

def tracked(x, y, value, size=11, spacing=1.4, color=OLIVE):
    if LANG=='hi':
        return x+text(x,y,tr(value),size+1.3,'bold',color)
    for char in value:
        w = text(x,y,char,size,'bold',color)
        x += w+spacing
    return x

def wrap(x,y,value,width,size=18,style='sans',color=MUTE,leading=25,max_lines=4):
    value=tr(value)
    f=font(size,style)
    rows=[]
    for para in value.split('\n'):
        row=''
        for word in para.split():
            candidate=(row+' '+word).strip()
            if measure(candidate,size,style) > width and row:
                rows.append(row); row=word
            else:
                row=candidate
        rows.append(row)
    assert len(rows)<=max_lines, f'Too many lines: {value}: {rows}'
    for i,row in enumerate(rows):
        text(x,y+i*leading,row,size,style,color,max_w=width)
    return len(rows)*leading

def shadow(rect,radius=20,blur=13,offset=8,opacity=32):
    global draw
    x1,y1,x2,y2=rect
    pad=math.ceil(blur*3+abs(offset)+2)
    layer=Image.new('RGBA',(round((x2-x1+pad*2)*S),round((y2-y1+pad*2)*S)),(0,0,0,0))
    rr((pad,pad+offset,pad+x2-x1,pad+y2-y1+offset),(35,57,38,opacity),radius,target=layer)
    layer=layer.filter(ImageFilter.GaussianBlur(blur*S))
    canvas.alpha_composite(layer,(round((x1-pad)*S),round((y1-pad)*S)))
    draw=ImageDraw.Draw(canvas)

def pill(x,y,label,size=12,fill=PALE,color=OLIVE,h=29,pad=12,style='bold',stroke=None):
    label=tr(label)
    width=measure(label,size,style)+2*pad
    rr((x,y,x+width,y+h),fill,h/2,stroke)
    text(x+pad,y+(h-size)/2-1,label,size,style,color)
    return width

def icon(kind,x,y,size=25,color=OLIVE,width=1.6):
    def pts(values):return [(x+u*size,y+v*size) for u,v in values]
    def ln(values): line(pts(values),color,width)
    def el(a,b,c,d):ellipse((x+a*size,y+b*size,x+c*size,y+d*size),stroke=color,width=width)
    def re(a,b,c,d,r=.12):rr((x+a*size,y+b*size,x+c*size,y+d*size),None,r*size,color,width)
    if kind=='spark':
        ln([(.5,.02),(.64,.36),(.98,.5),(.64,.64),(.5,.98),(.36,.64),(.02,.5),(.36,.36),(.5,.02)])
    elif kind=='pin':
        el(.22,.05,.78,.62); ln([(.25,.47),(.5,.95),(.75,.47)]);el(.42,.22,.58,.38)
    elif kind=='chart':
        ln([(.12,.12),(.12,.88),(.93,.88)]); ln([(.25,.67),(.45,.47),(.6,.6),(.88,.22)]);ln([(.66,.22),(.88,.22),(.88,.45)])
    elif kind=='mic':
        re(.34,.05,.66,.63,.16);ln([(.17,.4),(.17,.56),(.28,.76),(.5,.83),(.72,.76),(.83,.56),(.83,.4)]);ln([(.5,.83),(.5,.99)]);ln([(.31,.99),(.69,.99)])
    elif kind=='phone':
        ln([(.25,.07),(.07,.24),(.14,.46),(.32,.7),(.55,.88),(.78,.94),(.94,.77),(.73,.56),(.58,.69),(.4,.57),(.3,.39),(.42,.25),(.25,.07)])
    elif kind=='mail':
        re(.04,.15,.96,.85,.08);ln([(.05,.23),(.5,.55),(.95,.23)])
    elif kind=='chat':
        re(.04,.06,.96,.74,.16);ln([(.15,.73),(.1,.96),(.42,.74)]);el(.27,.35,.31,.39);el(.49,.35,.53,.39);el(.71,.35,.75,.39)
    elif kind=='crm':
        re(.06,.07,.94,.95,.1);ln([(.36,.24),(.36,.78)]);ln([(.66,.24),(.66,.6)]);ln([(.15,.28),(.25,.28)]);ln([(.45,.28),(.56,.28)]);ln([(.74,.28),(.85,.28)])
    elif kind=='calendar':
        re(.05,.17,.95,.95,.1);ln([(.05,.39),(.95,.39)]);ln([(.28,.05),(.28,.28)]);ln([(.72,.05),(.72,.28)]);ln([(.29,.65),(.45,.8),(.75,.5)])
    elif kind=='person':
        el(.3,.04,.7,.45);ln([(.07,.97),(.1,.76),(.24,.6),(.5,.54),(.76,.6),(.9,.76),(.93,.97)])
    elif kind=='table':
        re(.05,.05,.95,.95,.1);ln([(.05,.35),(.95,.35)]);ln([(.05,.64),(.95,.64)]);ln([(.37,.05),(.37,.95)])
    elif kind=='link':
        ln([(.5,.3),(.68,.11),(.82,.11),(.94,.23),(.94,.37),(.66,.66)]);ln([(.5,.7),(.32,.89),(.18,.89),(.06,.77),(.06,.63),(.34,.34)]);ln([(.34,.66),(.66,.34)])
    elif kind=='shield':
        ln([(.5,.03),(.93,.19),(.88,.65),(.73,.86),(.5,.98),(.27,.86),(.12,.65),(.07,.19),(.5,.03)]);ln([(.28,.49),(.44,.66),(.72,.35)])
    elif kind=='arrow':
        ln([(.1,.5),(.9,.5)]);ln([(.65,.25),(.9,.5),(.65,.75)])
    elif kind=='check':
        ln([(.16,.5),(.39,.73),(.87,.22)])
    elif kind=='building':
        re(.15,.08,.85,.95,.04);ln([(.4,.95),(.4,.74),(.6,.74),(.6,.95)])
        for u in [.3,.6]:
            for v in [.28,.48]:re(u,v,u+.09,v+.07,.01)

def logo(x,y,size=60):
    global draw
    shadow((x,y,x+size,y+size),14,6,3,22)
    rr((x,y,x+size,y+size),WHITE,14,LINE)
    img=Image.open(ROOT/'assets'/'rudra24-icon.png').convert('RGBA')
    img.thumbnail((round((size-9)*S),round((size-9)*S)),Image.Resampling.LANCZOS)
    canvas.alpha_composite(img,(round((x+(size-img.width/S)/2)*S),round((y+(size-img.height/S)/2)*S)))
    draw=ImageDraw.Draw(canvas)

# Solid parchment stock, with flat editorial accents. No gradient fills.
canvas=Image.new('RGBA',(W,H),BEIGE)
draw=ImageDraw.Draw(canvas)
line([(64,128),(1176,128)],LINE,1)

# Header.
logo(64,44,76)
text(159,44,'Rudra24 AI',46,'bold')
tracked(160,100,'BY RUDRA24 DIGITAL',15,1.35)
pill(968,68,'SAAS LAUNCH',12,h=31,pad=18,stroke='#D9E2CF')

# Opening promise.
tracked(64,162,'INTRODUCING YOUR AI SALES WORKSPACE',10.5,1.1)
if LANG=='en':
    text(62,202,'Generate leads.',70,'serif')
    text(62,278,'Grow your',76,'serif')
    text(62,352,'business.',82,'italic',OLIVE)
else:
    text(62,212,'लीड्स जनरेट करें।',50,'bold',max_w=505)
    text(62,286,'नए ग्राहक जोड़ें।',50,'bold',max_w=505)
    text(62,360,'बिज़नेस बढ़ाएँ।',54,'bold',OLIVE,max_w=505)
wrap(64,451,'Turn your next sales opportunity into a conversation. Generate relevant leads, plan outreach and manage clients in one SaaS workspace.',490,20,leading=28,max_lines=4)
shadow((64,559,393,605),23,6,3,22)
rr((64,559,393,605),OLIVE,23)
text(86,572,'Contact us on WhatsApp',18,'bold',WHITE,max_w=257)
icon('arrow',354,572,19,WHITE)
text(408,574,'Ask for a live demo.',14,color=MUTE)

# Editorial workspace illustration. It is clearly labelled as a sample.
x,y,r,b=584,165,1176,589
shadow((x,y,r,b),21,16,13,44)
rr((x,y,r,b),WHITE,21,LINE)
rr((x,y,r,y+38),'#F8F8F0',21)
draw.rectangle(box((x,y+22,r,y+38)),fill='#F8F8F0')
line([(x,y+38),(r,y+38)],LINE)
for dx,c in [(21,'#CB7B66'),(35,'#C9AD66'),(49,'#86A574')]:ellipse((x+dx,y+15,x+dx+7,y+22),fill=c)
text(x+72,y+12,'Client AI · Lead generation',12,'bold',MUTE)
pill(r-120,y+8,'Sample view',10,h=22,pad=10)

# Olive application sidebar.
rr((x,y+38,x+49,b),OLIVE,21)
draw.rectangle(box((x+25,y+38,x+49,b)),fill=OLIVE)
logo(x+10,y+51,29)
for i,kind in enumerate(['chat','table','pin','phone','mail','chart']):
    if i==2:rr((x+8,y+175,x+40,y+207),'#F1F2E7',9)
    icon(kind,x+16,y+96+i*40,16,OLIVE if i==2 else '#E6EBDD',1.35)

pill(x+81,y+53,'Generate 10 business leads in my selected area',12,fill=OLIVE,color=WHITE,h=32,pad=17,style='sans')
icon('spark',x+81,y+100,17)
text(x+106,y+99,'Relevant leads. Ready for your next move.',13,'bold',INK)

for i,(label,sub,score) in enumerate([
    ('Hospital · Healthcare','Selected locality  ·  High priority','94'),
    ('IT park · Corporate','Selected locality  ·  Contact details','89')]):
    top=y+128+i*64
    rr((x+75,top,r-21,top+54),'#FFFFFC',11,'#E2E7D9')
    rr((x+87,top+10,x+121,top+44),PALE,9)
    icon('building',x+95,top+18,18)
    text(x+133,top+11,label,14,'bold',INK)
    text(x+133,top+32,sub,11.5,color=MUTE)
    text(r-63,top+10,score,20,'bold',OLIVE)
    text(r-65,top+33,'SCORE',8.5,'bold',MUTE)

# Highlight the map as a product surface, with schematic roads and company pins.
mx,my,mr,mb=x+75,y+269,r-21,b-21
rr((mx,my,mr,mb),'#EDF0E3',11,'#DEE3D3')
map_layer=Image.new('RGBA',(W,H),(0,0,0,0))
map_mask=Image.new('L',(W,H),0)
ImageDraw.Draw(map_mask).rounded_rectangle(box((mx,my,mr,mb)),radius=11*S,fill=255)
mp=ImageDraw.Draw(map_layer)
for rect,colour in [((mx+38,my+34,mx+143,my+80),'#DAE3CC'),
                    ((mx+232,my+20,mx+319,my+83),'#DDE5E5'),
                    ((mx+368,my+90,mr+9,mb+10),'#E9DFCA')]:
    rr(rect,colour,9,target=map_layer)
roads=[[(mx-12,my+113),(mx+113,my+88),(mx+249,my+105),(mr+18,my+56)],
       [(mx+150,my-12),(mx+184,my+51),(mx+148,mb+9)],
       [(mx+365,my-14),(mx+339,my+53),(mx+365,mb+8)]]
for road in roads:
    line(road,'#D8DECC',13,target=map_layer)
    line(road,'#FFFEF8',10,target=map_layer)
line([(mx-8,my+73),(mx+80,my+56),(mx+115,my-8)],'#FBFCF5',7,target=map_layer)
map_layer.putalpha(Image.composite(map_layer.getchannel('A'),Image.new('L',(W,H),0),map_mask))
canvas.alpha_composite(map_layer)
draw=ImageDraw.Draw(canvas)
pill(mx+12,my+11,'COMPANY LEAD MAP',9.5,fill=WHITE,h=25,pad=10)
for (px,py),(pin_colour,pin_tint) in zip([(mx+153,my+73),(mx+266,my+69),(mx+343,my+110),(mx+80,my+116)],ACCENTS):
    ellipse((px-15,py-12,px+15,py+14),fill=pin_tint)
    draw.polygon([((px-7)*S,(py+2)*S),((px+7)*S,(py+2)*S),(px*S,(py+15)*S)],fill=pin_colour)
    ellipse((px-10,py-15,px+10,py+5),fill=pin_colour,stroke=WHITE,width=1.5)
    ellipse((px-3,py-8,px+3,py-2),fill=WHITE)
rr((mx+184,my+94,mx+302,my+128),WHITE,8,LINE)
text(mx+195,my+103,'Company details',10.5,'bold',INK)
text(mr-123,mb-20,'Pins · Details · Directions',9,color=MUTE)

# All-India positioning has its own spacious band.
shadow((64,640,1176,751),19,7,3,16)
rr((64,640,1176,751),'#DDE9EE',19,'#C5D7DE')
icon('pin',90,661,29)
tracked(137,662,'ALL-INDIA LOCATION TARGETING',10,1)
text(137,687,'Local focus. Nationwide reach.',30 if LANG=='hi' else 36,'serif',INK,max_w=525)
text(137,727,'Generate leads across India, tailored to your chosen area.',15.5,color=MUTE)
for dx,label in [(699,'City'),(837,'Area / locality'),(1022,'Company pins')]:
    icon('pin',dx+19,663,20,OLIVE)
    text(dx,702,label,14,'bold',OLIVE)
line([(812,678),(824,678)],'#B4C2A8',1.5)
line([(989,678),(1001,678)],'#B4C2A8',1.5)

# Workflow.
tracked(64,785,'FROM GENERATION TO CLIENT RELATIONSHIPS',10,1.2)
steps=[('Generate','Location + industry','spark'),('Prioritise','Scores + lead fit','chart'),
       ('Reach out','Email + WhatsApp + SMS','mail'),('Call','AI agent conversations','phone'),('Manage','CRM + follow-ups','crm')]
for i,(title,desc,kind) in enumerate(steps):
    sx=64+i*231
    step_ink,step_tint=ACCENTS[i%4]
    rr((sx,816,sx+35,851),step_tint,11)
    icon(kind,sx+8,824,19,step_ink)
    text(sx+45,818,title,18,'bold')
    text(sx+45,840,desc,12.5,color=MUTE)
    if i<4:icon('arrow',sx+203,825,16,'#97AF8D',1.3)

# Feature matrix: short, specific copy grouped by buyer outcomes.
tracked(64,900,'EVERYTHING WORKING TOGETHER',10,1.3)
text(64,925,'One platform. A connected sales workflow.',38 if LANG=='hi' else 44,'serif')
features=[
('spark','AI Lead Generation','Generate business leads by\nindustry, area and quantity.'),
('chart','Opportunity Scoring','Need estimates, 0–100 lead scores\nand clear priority ratings.'),
('mic','Rudra24 AI Assistant','Hindi, English & Hinglish. Voice,\nmemory, drafts and call scripts.'),
('pin','Company Lead Map','Company pins, contact details\nand directions in one view.'),
('phone','AI Calling Agents','Build agents, manage call queues,\nreview transcripts & recordings.'),
('mail','Email Campaigns','Personalised templates, previews\nand connected sender accounts.'),
('chat','WhatsApp & SMS','Prepare messages, track confirmed\nsends and plan SMS campaigns.'),
('crm','CRM & Client Pipeline','Track deals, clients, contracts\nand upcoming renewals.'),
('calendar','Follow-ups & Meetings','Tasks, meeting schedules,\ncalendar links and reminders.'),
('person','Candidate Recruiter AI','Role & city based searches,\nwith a candidate database.'),
('table','Excel & Google Sheets','Import & enrich lists. Export\nExcel / CSV and sync to Sheets.'),
('link','Analytics & Integrations','Dashboards, reports, connectors,\nplugins and usage visibility.')
]
cw=(1112-2*14)/3
for i,(kind,title,desc) in enumerate(features):
    cx=64+(i%3)*(cw+14); cy=990+(i//3)*104
    accent,tint=ACCENTS[(i+(i//3))%4]
    card_fill=['#E5EEDB','#E1ECF1','#F3E1D5','#F0E7C9'][(i+(i//3))%4]
    shadow((cx,cy,cx+cw,cy+94),15,5,3,14)
    rr((cx,cy,cx+cw,cy+94),card_fill,15,'#D6DCCF')
    rr((cx+15,cy+12,cx+52,cy+15),accent,1.5)
    rr((cx+15,cy+18,cx+52,cy+55),tint,11)
    icon(kind,cx+24,cy+27,19,accent)
    text(cx+64,cy+18,title,16 if LANG=='hi' else 17,'bold',INK,max_w=cw-76)
    wrap(cx+64,cy+44,desc,cw-77,14.5,color=MUTE,leading=20,max_lines=2)

# Small product benefits use one shared row to reduce decorative clutter.
text(65,1418,'Live task progress',12.5,'bold',OLIVE)
text(229,1418,'·',12.5,color='#AAB79F')
text(246,1418,'Stop & keep results',11 if LANG=='hi' else 12.5,'bold',OLIVE)
text(428,1418,'·',12.5,color='#AAB79F')
text(445,1418,'Duplicate checks',12.5,'bold',OLIVE)
text(600,1418,'·',12.5,color='#AAB79F')
text(617,1418,'Chat history & shortcuts',12.5,'bold',OLIVE)
text(836,1418,'·',12.5,color='#AAB79F')
text(853,1418,'Light / dark workspace',12.5,'bold',OLIVE)

# Full industry reach, with additional supported categories rather than only four examples.
line([(64,1447),(1176,1447)],LINE,1)
tracked(64,1464,'ACROSS INDUSTRIES',10,1.2)
text(277,1460,'Built around the clients you want to win.',20 if LANG=='hi' else 25,'serif')
industry_rows=[
    'Hotels & hospitality  ·  Hospitals & healthcare  ·  IT parks & tech companies  ·  Malls & retail',
    'Factories & manufacturing  ·  Warehouses & logistics  ·  Schools & universities  ·  Banks & offices',
    'Residential societies  ·  Real estate & construction  ·  Airports & aviation  ·  Restaurants & food service'
]
for i,row in enumerate(industry_rows):text(64,1502+i*23,row,14.5,color=MUTE,max_w=1112)

# Two high-contrast contact plates in the requested order.
shadow((64,1590,1176,1699),22,10,5,24)
rr((64,1590,1176,1699),OLIVE,22)
text(90,1614,'Contact us on WhatsApp',27 if LANG=='hi' else 31,'bold',WHITE,max_w=450)
text(92,1662,'Message us for your live demo.',16,color='#E0E8D8')
line([(556,1609),(556,1681)],'#526A4E',1)
tracked(582,1609,'PRIMARY · VISHAL SHARMA',9,.45,'#F3F4E8')
text(582,1630,'Marketing Manager',12,color='#D8E3CE')
tracked(886,1609,'ALTERNATE CONTACT',9,.8,'#F3F4E8')
text(886,1630,'Demo & enquiries',12,color='#D8E3CE')
for tx,number,plate in [(582,'9999881949','#EFE0AB'),(886,'9625729177','#DDEAF0')]:
    rr((tx-12,1650,tx+254,1688),plate,9)
    icon('chat',tx,1659,19,OLIVE)
    text(tx+33,1658,number,29,'bold',INK,max_w=218)
icon('mail',65,1719,17,OLIVE,1.3)
text(91,1718,'Rudra24securegroup@gmail.com',15,'bold',INK)
text(832,1717,'Rudra24 Secure Group',20,'bold',INK,max_w=344)

# Print-sized primary and lossless master.
assert not any('Generate companies' in c['text'] or 'कंपनियाँ जनरेट' in c['text'] for c in checks)
assert any(c['text']=='9999881949' for c in checks)
assert any(c['text']=='9625729177' for c in checks)
rgb=canvas.convert('RGB')
suffix='English' if LANG=='en' else 'Hindi'
jpg=OUT/f'Rudra24-AI-Launch-A4-{suffix}.jpg'
png=OUT/f'Rudra24-AI-Launch-A4-{suffix}.png'
rgb.save(jpg,'JPEG',quality=100,subsampling=0,dpi=(DPI,DPI),optimize=True)
rgb.save(png,'PNG',dpi=(DPI,DPI),optimize=True)
preview=rgb.resize((1240,1754),Image.Resampling.LANCZOS)
preview.save(OUT/f'Rudra24-AI-Launch-preview-{suffix}.png')
validation={'language':LANG,'pixels':[W,H],'dpi':[DPI,DPI],'page_mm':[round(W/DPI*25.4,2),round(H/DPI*25.4,2)],
            'feature_groups':len(features),'primary_contact':'Vishal Sharma, Marketing Manager, 9999881949',
            'secondary_phone':'9625729177',
            'email':'Rudra24securegroup@gmail.com','text_elements':len(checks),
            'jpeg_bytes':jpg.stat().st_size,'png_bytes':png.stat().st_size}
(OUT/f'render-verification-{suffix}.json').write_text(json.dumps(validation,indent=2),encoding='utf-8')
print(json.dumps(validation,indent=2))
print(jpg)
