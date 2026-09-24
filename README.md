# Clavis AI Leads Agent 🚀

Namaste! 🙏 Yeh security aur housekeeping staffing agencies ke liye ek smart B2B Lead Generation Agent hai. Yeh aapki company ke liye un buyer companies ko dhundhta hai jinhe security guards aur housekeeping staff ki zarurat hoti hai (jaise Hotels, Hospitals, IT Parks, Malls).

Built by **Rudra24 Secure Group**.

UI browser me run hoti hai, lekin provider calls aur secrets authenticated backend ke through jaate hain. API keys browser, frontend bundle, localStorage ya customer files me nahi rakhni hain.

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

## 🧠 Clavis AI — Aapka Personal Business Assistant (New)

Sidebar me sabse upar ab "Clavis AI" naam ka ek naya section hai — yeh Chat AI (lead-gen wala) se alag hai. Clavis ek general-purpose personal assistant hai jo:

- **Aap se baat karta hai** — business planning, ideas, drafts, general questions — Hindi/English/Hinglish, jaisa aap bolte ho.
- **Yaad rakhta hai** — jo bhi aap "yaad rakho" ya "remember that" bolke bataoge, wo permanently save ho jayega (side panel me dikhega, aur "🧠 Memory" button se manage kar sakte ho).
- **Call scripts banata hai** — "📞 Call Script Banao" button dabao, client ka naam/business/purpose daalo, aur Clavis ek ready-to-use call script generate kar dega.
- **Voice se baat kar sakte ho** — Google Gemini se (ek hi `GEMINI_API_KEY`, backend/.env me), Hindi/English/Hinglish auto-detect ke saath, hands-free, clap/snap wake, aur local barge-in ke saath. Browser voice fallback use nahi hota; Gemini key set na ho to Clavis text mode me clear recovery state dikhata hai. (Phone par outbound calling — niche "Live Client Calling" — abhi bhi apna alag, local Kokoro/faster-whisper based pipeline use karta hai; wo is se independent hai.)

### Clavis ka LLM Kaise Setup Karein
Clavis primarily **OpenRouter** use karta hai — bilkul free hai, koi credit card nahi chahiye:
1. [openrouter.ai/keys](https://openrouter.ai/keys) par jaake free account banao aur ek API key generate karo.
2. Clavis tab me pehli baar microphone permission allow karein. Successful permission ke baad **Hands-Free** aur **Clap / Snap** automatically restore ho jaate hain; visible mic status se current state check kar sakte hain. Sound activation app ke visible/open rehne tak kaam karti hai.
3. Settings se OpenRouter key authenticated backend vault mein connect karein. Raw key browser storage mein nahi rakhi jaati. General AI reasoning ke liye real provider credential zaruri hai; credential ke bina Clavis transparent local mode mein time, date, identity, help, aur status requests ka jawab dega—fake AI response nahi banayega.

### Live Client Calling (Backend)
Real phone calls ke liye `backend/` folder me alag se voice-calling server hai (Exotel + OpenRouter powered). Yeh abhi separately setup karna padta hai — dekho `backend/.env.example` file, aur Exotel account chahiye hoga (India ke liye best telephony provider — DLT-compliant, INR billing). Iske bina bhi Clavis chat/voice-input mode me poori tarah kaam karta hai, sirf real outbound calls ke liye backend chalu karna hoga.

### Local speech runtime

Windows production setup ke liye `scripts/setup-clavis-runtime.ps1` Python 3.12 environment banata hai. `npm run test:speech` local speech contracts ko run karta hai. Speech models lazy-load hote hain, isliye first Kokoro/Whisper use par warm-up time lag sakta hai. Production onedir staging ke liye `installer/build-clavis-bundle.ps1` run karein; `installer/Clavis.iss` se Inno Setup `Clavis-Setup.exe` banata hai.

Speech contracts: `GET /api/speech/health`, `POST /api/speech/transcribe`, `POST /api/tts`, `WS /ws/speech/input`, aur `WS /ws/speech/output`. AudioWorklet PCM capture/playback, generation IDs, bounded streaming queue, cancellation, and local-only voice policy runtime ka hissa hain.
