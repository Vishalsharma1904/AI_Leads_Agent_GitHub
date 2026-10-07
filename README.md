# Rudra24 AI Leads Agent 🚀

Namaste! 🙏 Yeh security aur housekeeping staffing agencies ke liye ek smart B2B Lead Generation Agent hai. Yeh aapki company ke liye un buyer companies ko dhundhta hai jinhe security guards aur housekeeping staff ki zarurat hoti hai (jaise Hotels, Hospitals, IT Parks, Malls).

Built by **Rudra24 Secure Group**.

UI browser me run hoti hai, lekin provider calls aur secrets authenticated backend ke through jaate hain. API keys browser, frontend bundle, localStorage ya customer files me nahi rakhni hain.

**Connectors:** Google Workspace, Slack, GitHub, Telegram aur Meta setup ke liye [Connectors guide](docs/CONNECTORS.md) dekhein. Connectors page left sidebar me hai; provider developer apps, consent aur deployed backend ke bina koi account connected nahi hoga.

---

## 🛠️ Setup Kaise Karein (Sirf Ek Baar Ka Kaam)

Maine is system ko **portable** banaya hai taaki aap isey easily apne father ke computer par run kar sakein bina bar-bar details dale.

**Step 1: Backend secrets set karein**
1. `backend/.env.example` ko copy karke `backend/.env` banayein.
2. Provider keys, database URL, Supabase Auth configuration aur mail credentials sirf `backend/.env` ya authenticated backend vault me configure karein. Supabase ka `SUPABASE_SECRET_KEY`/service-role credential backend se bahar kabhi na le jaayein.
3. `config.js` aur Android/frontend assets me secrets paste na karein.

**Step 2: Start Kaise Karein?**
1. Apne computer par [Node.js](https://nodejs.org/) install karein agar nahi hai.
2. PowerShell mein project folder par jaakar run karein:
   `cd "C:\Users\Khushi\Desktop\A.I. Leads Agent (2)\A.I. Leads Agent (6)\A.I. Leads Agent"`
3. Type karein: `npm install; npm run dev`
4. Browser mein `http://localhost:3000` kholein. Shortcut ke liye project folder ka `Start-Clavis.ps1` run kar sakte hain.

**Important:** Voice, Hands-Free wake words, Clap / Snap activation, Google sign-in, and backend AI require the app to be served from `http://localhost:3000`. `index.html` ko `file://` se double-click karke kholne par browser microphone permissions, authentication origin, aur backend CORS reliable nahi hote; us mode ko sirf static UI preview samjhein.

### Naya update kaise chalayein (Rudra24 AI voice ke saath)

1. Project folder me: `git checkout main` aur phir `git pull`
2. `npm install` (sirf pehli baar, ya jab packages badlein)
3. `npm run frontend` chalayein aur browser me `http://localhost:3000` kholein (ya `Start-Clavis.bat` / `Clavis.exe`). Server har file par cache check karta hai, isliye pull ke baad naya code apne aap aata hai — shak ho to ek baar Ctrl+Shift+R.
4. **Settings → Voice AI → Google AI Studio key** me apni key daalein aur **Save & test** dabayein. Isi se Rudra24 AI Live chalta hai: aapki baat poori sunta hai, mic chalu rehta hai, emotions ke saath bolta hai.
5. Bolkar try karein: "Rudra24 AI…", "thodi der chup ho jao" (phir naam / chutki / taali se jagayein), "caption band karo", "tum kya kya kar sakti ho".

### Google sign-in (Supabase Auth)

Google OAuth is handled entirely by Supabase Auth. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_REDIRECT_URL=http://localhost:3000/` in `backend/.env`. The browser receives only the URL and publishable key from `/api/public-config`; Supabase owns session persistence and refresh. The FastAPI backend verifies the Supabase access token server-side and derives the user identity from its verified `sub` claim. Do not add Google client secrets, Supabase secret keys, or manual token storage to frontend files.

### UI changes kahan karne hain

Desktop shortcut aur `Launch_App.bat` root wali static UI ko load karte hain. Screenshot wali UI ke changes in files me karein:

- `index.html` — page structure and inline dashboard markup
- `styles.css`, `theme-flow.css`, `design-overhaul.css` — visual styling
- `page-dashboard.js` aur `page-*.js` — page behavior/content

`frontend/src/` ek alag React prototype hai; usme kiye changes desktop app me tab tak nahi dikhenge jab tak us React app ko alag se Vite se run na kiya jaye.

---

## 💡 System Ke Main Features

### 1. Smart Chat AI (Groq API)
Aap natural language (Hinglish ya English) mein type karke leads nikal sakte hain.
- **Example 1:** "Mujhe Gurgaon me 10 hotel leads chahiye security ke liye"
- **Example 2:** "Find 5 hospital leads in Delhi for housekeeping"
- **Example 3:** "Export to excel"

*Agar Groq API Key nahi bhi hai, to iska **Smart Local Parser** keywords ko samajh kar kaam karega!*

### 2. Multi-API Auto-Rotation (Quota Protection)
`config.js` file me aap 2-3 Groq ya Apify keys daal sakte hain. Agar kabhi ek key ka daily limit/quota khatam ho gaya (Error 429), toh yeh agent automatically bina ruke next key par switch kar lega. User ko pata bhi nahi chalega aur kaam nahi rukega!

### 3. File Upload & Auto-Enrichment (New)
Chat box ke andar ab ek "Upload CSV" ka button hai. Agar aapke paas kuch companies ke names (text ya CSV format mein) hain, to bas file upload karein. AI automatically un companies ka data padhega, unke contact numbers (phone), emails aur websites search karke nikal dega.

### 4. One-Click "Export to Excel" (.xlsx)
Dashboard par "All Leads" section mein jaakar "Export Excel" par click karein. Yeh saari filtered ya saved leads ko directly asli `.xlsx` file mein convert karke download kar dega. Data perfect rows aur columns mein aayega bina kisi mistake ke! CSV format ka option bhi available hai.

### 5. Live Token Dashboard & Multi-API Support
Chat mein "API Status" button dabayein ya settings se Token Dashboard kholein. Yaha aap:
- Live token counting dekh sakte hain.
- Konsi API key kitni use ho chuki hai (status bar).
- Agar quota khatam ho gaya, to nayi API key seedhe browser mein paste karke save kar sakte hain (file open kiye bina).

### 6. Direct Google Sheets Sync
Agar Excel ke alawa data Google Sheets par chahiye:
1. `config.js` me Apna `script.google.com` wala Web App URL daalein.
2. Dashboard par "Sync to Sheets" button dabayein, aur leads seedhe cloud sheet par chali jayengi!

---

## ⚙️ Advance Options Aur Tips

- **Duplicate Protection:** Agent automatically check karta hai ki aapne koi lead pehle se toh nahi nikali. Issey aapka API token aur time dono bachta hai!
- **Data Analytics:** "Analytics" tab mein jaakar aap funnel, timeline, aur industry charts dekh sakte hain.
- **Filters:** Kisi specific city ya industry ki leads check karni ho to table ke upar search bar aur dropdown filter ka use karein.

Agar koi dikkat aaye, toh aap sab kuch "Settings" page par jaakar "Clear Memory" button se reset kar sakte hain.

Dhanyawad aur Best of Luck! 🎉

---

## 🧠 Rudra24 AI — Aapka Personal Business Assistant (New)

Sidebar me sabse upar ab "Rudra24 AI" naam ka ek naya section hai — yeh Chat AI (lead-gen wala) se alag hai. Rudra24 AI ek general-purpose personal assistant hai jo:

- **Aap se baat karta hai** — business planning, ideas, drafts, general questions — Hindi/English/Hinglish, jaisa aap bolte ho.
- **Yaad rakhta hai** — jo bhi aap "yaad rakho" ya "remember that" bolke bataoge, wo permanently save ho jayega (side panel me dikhega, aur "🧠 Memory" button se manage kar sakte ho).
- **Call scripts banata hai** — "📞 Call Script Banao" button dabao, client ka naam/business/purpose daalo, aur Rudra24 AI ek ready-to-use call script generate kar dega.
- **Voice se baat kar sakte ho** — Google Gemini se (ek hi `GEMINI_API_KEY`, backend/.env me), Hindi/English/Hinglish auto-detect ke saath, hands-free, clap/snap wake, aur local barge-in ke saath. Browser voice fallback use nahi hota; Gemini key set na ho to Rudra24 AI text mode me clear recovery state dikhata hai. (Phone par outbound calling — niche "Live Client Calling" — abhi bhi apna alag, local Kokoro/faster-whisper based pipeline use karta hai; wo is se independent hai.)

### Rudra24 AI ka LLM Kaise Setup Karein
Rudra24 AI primarily **OpenRouter** use karta hai — bilkul free hai, koi credit card nahi chahiye:
1. [openrouter.ai/keys](https://openrouter.ai/keys) par jaake free account banao aur ek API key generate karo.
2. Rudra24 AI tab me pehli baar microphone permission allow karein. Successful permission ke baad **Hands-Free** aur **Clap / Snap** automatically restore ho jaate hain; visible mic status se current state check kar sakte hain. Sound activation app ke visible/open rehne tak kaam karti hai.
3. Settings se OpenRouter key authenticated backend vault mein connect karein. Raw key browser storage mein nahi rakhi jaati. General AI reasoning ke liye real provider credential zaruri hai; credential ke bina Rudra24 AI transparent local mode mein time, date, identity, help, aur status requests ka jawab dega—fake AI response nahi banayega.

### Live Client Calling (Backend)
Real phone calls ke liye `backend/` folder me alag se voice-calling server hai (Exotel + OpenRouter powered). Yeh abhi separately setup karna padta hai — dekho `backend/.env.example` file, aur Exotel account chahiye hoga (India ke liye best telephony provider — DLT-compliant, INR billing). Iske bina bhi Rudra24 AI chat/voice-input mode me poori tarah kaam karta hai, sirf real outbound calls ke liye backend chalu karna hoga.

### Local speech runtime

Windows production setup ke liye `scripts/setup-clavis-runtime.ps1` Python 3.12 environment banata hai. `npm run test:speech` local speech contracts ko run karta hai. Speech models lazy-load hote hain, isliye first Kokoro/Whisper use par warm-up time lag sakta hai. Production onedir staging ke liye `installer/build-clavis-bundle.ps1` run karein; `installer/Rudra24 AI.iss` se Inno Setup `Rudra24 AI-Setup.exe` banata hai.

Speech contracts: `GET /api/speech/health`, `POST /api/speech/transcribe`, `POST /api/tts`, `WS /ws/speech/input`, aur `WS /ws/speech/output`. AudioWorklet PCM capture/playback, generation IDs, bounded streaming queue, cancellation, and local-only voice policy runtime ka hissa hain.

---

## Calling Agent (Sarvam AI) — setup

Sidebar me **Calling Agent** page hai. Ek baar setup karlo, phir har lead ko AI khud call karega.

### 1. Sarvam se 5 cheezein
[dashboard.sarvam.ai](https://dashboard.sarvam.ai/admin) par agent banao aur ek phone number par deploy karo. Phir:

| Field | Kahan se |
|---|---|
| API key | Dashboard → API keys → Key Vault me "Sarvam AI" ke neeche daalo |
| Organisation ID / Workspace ID | Dashboard URL me dikhte hain |
| Agent (app) ID + version | **Agent setup → Fetch agents** dabao, apne aap bhar jaate hain |
| Connection ID | Deployment / telephony connection se |
| Agent ka number | Wahi number jisse call jaayegi |

### 2. Apni details bharo
**Agent setup** me company ka naam, kya bechte ho, USP, agent ki personality, kya puchhna hai,
objection ka jawab, meeting slots, aapka naam/number/email, call window aur email signature.
Neeche jo **agent prompt** banta hai use copy karke Sarvam dashboard me agent ke instructions me
paste kar do — tabhi agent bilkul aapke hisaab se bolega.

### 3. Chalao
- Leads page → **Send to Calling Agent**, ya Rudra24 AI se boliye "ye leads calling agent ko de do".
- Leads nikalte hi Rudra24 AI khud poochhta hai — "sir, calling agent ko de doon?" Haan par hi jaate hain.
- Right side me "kitni calls" (10, 20…) daalo → **Calling shuru**. Ek ke baad ek jaati hain.

### Call ke baad
- **App me koi awaaz nahi bajti** — call phone par jaati hai. Aap chaho to recording sun lo.
- Har contact ki apni chat: customer right, agent left.
- Interested nikle to email ka draft khud ban jaata hai — padho, edit karo, **Gmail me kholo**.
  Bhejte aap khud ho.
- Meeting fix hui to Google Calendar link aur `.ics` mil jaata hai.

Note: agar browser Sarvam ko direct na khol paaye (CORS), to app `serve-clavis.js` ka
`/sarvam-api` proxy use karta hai — isliye app hamesha **Start-Clavis.bat** se kholo,
`index.html` par double-click karke nahi.
