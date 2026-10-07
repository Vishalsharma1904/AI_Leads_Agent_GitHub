/* Rudra UI language switcher. Only interface copy is translated; account data,
   lead records, prompts and conversations are deliberately left untouched. */
(() => {
  'use strict';

  const LANGUAGE_KEY = 'rudra_ui_language_v1';
  const LANGUAGES = [
    ['en', 'English'], ['hi', 'हिन्दी'], ['hinglish', 'Hinglish'],
    ['bn', 'বাংলা'], ['ta', 'தமிழ்'], ['te', 'తెలుగు'], ['mr', 'मराठी'],
    ['gu', 'ગુજરાતી'], ['pa', 'ਪੰਜਾਬੀ'], ['ur', 'اردو'], ['kn', 'ಕನ್ನಡ'],
    ['ml', 'മലയാളം'], ['or', 'ଓଡ଼ିଆ'], ['as', 'অসমীয়া'], ['ne', 'नेपाली'],
    ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'],
    ['ar', 'العربية'], ['ru', 'Русский'], ['zh', '中文'], ['ja', '日本語'],
    ['ko', '한국어'], ['id', 'Bahasa Indonesia'], ['tr', 'Türkçe'],
    ['vi', 'Tiếng Việt']
  ];
  const BUILTIN = {
    hi: {
      'Welcome back, User': 'वापसी पर स्वागत है',
      'Good morning': 'सुप्रभात', 'Good afternoon': 'शुभ दोपहर', 'Good evening': 'शुभ संध्या',
      'Enter your email and password to sync all your data': 'अपना डेटा सिंक करने के लिए ईमेल और पासवर्ड दर्ज करें',
      'Continue with Google': 'Google से जारी रखें',
      'Sign in with Google': 'Google से साइन इन करें',
      'or continue with email': 'या ईमेल से जारी रखें',
      'OR CONTINUE WITH EMAIL': 'या ईमेल से जारी रखें',
      'Create Account': 'खाता बनाएँ', 'Create Account & Sync': 'खाता बनाएँ और सिंक करें',
      'Sign In': 'साइन इन करें', 'Sign in': 'साइन इन करें',
      'Full Name': 'पूरा नाम', 'Company / Agency': 'कंपनी / एजेंसी',
      'Email Address': 'ईमेल पता', 'Mobile / WhatsApp': 'मोबाइल / व्हाट्सऐप',
      'Password': 'पासवर्ड', 'Password (min. 8 chars)': 'पासवर्ड (कम से कम 8 अक्षर)',
      'Forgot password / Unlock device': 'पासवर्ड भूल गए / डिवाइस अनलॉक करें',
      'Account-protected workspace': 'सुरक्षित कार्यक्षेत्र',
      'Sign in required': 'साइन इन ज़रूरी है', 'Account required': 'खाता ज़रूरी है',
      'Agency / Firm Name': 'एजेंसी / फर्म का नाम', 'Answer': 'उत्तर',
      'Security Check': 'सुरक्षा जाँच', '(Optional)': '(वैकल्पिक)',
      'Welcome': 'स्वागत है', 'Set up your profile': 'अपनी प्रोफ़ाइल बनाएँ',
      'Profile & Company': 'प्रोफ़ाइल और कंपनी', 'Toggle Theme': 'थीम बदलें',
      'Sign Out / Switch': 'साइन आउट / खाता बदलें',
      'Dashboard': 'डैशबोर्ड', 'Dashboard Overview': 'डैशबोर्ड का सारांश',
      'Client AI (Chat)': 'क्लाइंट AI (चैट)',
      'Ask for leads by city, industry or role — Rudra24 AI searches live sources and returns verified rows.': 'शहर, उद्योग या भूमिका के आधार पर लीड माँगें — Rudra24 AI लाइव स्रोत खोजकर सत्यापित नतीजे देता है।',
      'Find companies needing cooks, nurses, drivers...': 'ऐसी कंपनियाँ खोजें जिन्हें रसोइए, नर्स, ड्राइवर चाहिए...',
      'Find companies needing cooks, nurses, drivers…': 'ऐसी कंपनियाँ खोजें जिन्हें रसोइए, नर्स और ड्राइवर चाहिए…',
      'Sources': 'स्रोत', 'Hotels (Gurugram)': 'होटल (गुरुग्राम)',
      'Hospitals (Delhi)': 'अस्पताल (दिल्ली)', 'Pantry (Gurugram)': 'पैंट्री (गुरुग्राम)',
      'Export Excel': 'Excel निर्यात करें',
      'All Leads': 'सभी लीड', 'All Leads Database': 'सभी लीड का डेटाबेस',
      'Candidate DB': 'उम्मीदवार डेटाबेस', 'Candidate Database': 'उम्मीदवार डेटाबेस',
      'Candidate AI': 'उम्मीदवार AI', 'Candidate AI Recruiter': 'उम्मीदवार AI रिक्रूटर',
      'Client AI (Chat)': 'क्लाइंट AI (चैट)', 'Voice Calling AI': 'वॉइस कॉलिंग AI',
      'Voice Calling': 'वॉइस कॉलिंग', 'Calling Agent': 'कॉलिंग एजेंट',
      'Lead & data hub': 'लीड और डेटा केंद्र', 'Data Hub': 'डेटा केंद्र',
      'AI assistant': 'AI सहायक', 'Automation': 'ऑटोमेशन', 'System': 'सिस्टम',
      'Run Agent': 'एजेंट चलाएँ', 'Run AI Agent': 'AI एजेंट चलाएँ',
      'Email Auto': 'ईमेल ऑटो', 'WhatsApp Auto': 'व्हाट्सऐप ऑटो',
      'Excel Manager': 'एक्सेल प्रबंधक', 'Analytics': 'विश्लेषण',
      'Analytics & Reports': 'विश्लेषण और रिपोर्ट', 'Accounts': 'खाते',
      'Connected Accounts': 'जुड़े हुए खाते', 'Plugins': 'प्लगइन',
      'API Keys': 'API कुंजियाँ', 'API Keys Dashboard': 'API कुंजी डैशबोर्ड',
      'Settings': 'सेटिंग', 'System Settings': 'सिस्टम सेटिंग',
      'Developer': 'डेवलपर', 'Product insights': 'उत्पाद की जानकारी',
      'History': 'इतिहास', 'Shortcuts': 'शॉर्टकट', 'Peek Tasks': 'कार्य देखें',
      'Connect Sheets': 'शीट जोड़ें', 'Lead Credits': 'लीड क्रेडिट',
      'New Chat': 'नई चैट', 'Send message': 'संदेश भेजें',
      'Start a fresh lead search': 'नई लीड खोज शुरू करें',
      'Search': 'खोजें', 'Save': 'सहेजें', 'Cancel': 'रद्द करें',
      'Close': 'बंद करें', 'Delete': 'हटाएँ', 'Edit': 'बदलें',
      'Retry': 'फिर कोशिश करें', 'Continue': 'जारी रखें',
      'Back': 'वापस', 'Next': 'आगे', 'Done': 'पूरा हुआ',
      'Language': 'भाषा', 'Search languages': 'भाषाएँ खोजें', 'India': 'भारत', 'Global': 'वैश्विक',
      'Open navigation': 'नेविगेशन खोलें'
    },
    hinglish: {
      'Welcome back, User': 'Wapas welcome hai',
      'Good morning': 'Good morning', 'Good afternoon': 'Good afternoon', 'Good evening': 'Good evening',
      'Enter your email and password to sync all your data': 'Data sync karne ke liye email aur password daalein',
      'Continue with Google': 'Google se continue karein',
      'Sign in with Google': 'Google se sign in karein',
      'or continue with email': 'ya email se continue karein',
      'OR CONTINUE WITH EMAIL': 'ya email se continue karein',
      'Create Account': 'Account banayein', 'Create Account & Sync': 'Account banayein aur sync karein',
      'Sign In': 'Sign in karein', 'Sign in': 'Sign in karein',
      'Full Name': 'Poora naam', 'Company / Agency': 'Company / Agency',
      'Email Address': 'Email address', 'Mobile / WhatsApp': 'Mobile / WhatsApp',
      'Password': 'Password', 'Password (min. 8 chars)': 'Password (kam se kam 8 characters)',
      'Forgot password / Unlock device': 'Password bhool gaye / device unlock karein',
      'Account-protected workspace': 'Secure workspace',
      'Sign in required': 'Sign in zaroori hai', 'Account required': 'Account zaroori hai',
      'Welcome': 'Welcome', 'Set up your profile': 'Apni profile set karein',
      'Profile & Company': 'Profile aur company', 'Toggle Theme': 'Theme badlein',
      'Sign Out / Switch': 'Sign out / account badlein',
      'Dashboard Overview': 'Dashboard ka overview',
      'Client AI (Chat)': 'Client AI (Chat)',
      'Ask for leads by city, industry or role — Rudra24 AI searches live sources and returns verified rows.': 'City, industry ya role ke hisaab se leads maangein — Rudra24 AI live sources se verified rows laata hai.',
      'Find companies needing cooks, nurses, drivers...': 'Aisi companies dhoondein jinhe cooks, nurses, drivers chahiye...',
      'Find companies needing cooks, nurses, drivers…': 'Aisi companies dhoondein jinhe cooks, nurses aur drivers chahiye…',
      'Sources': 'Sources', 'Hotels (Gurugram)': 'Hotels (Gurugram)',
      'Hospitals (Delhi)': 'Hospitals (Delhi)', 'Pantry (Gurugram)': 'Pantry (Gurugram)',
      'Export Excel': 'Excel export karein',
      'All Leads': 'Saari leads', 'All Leads Database': 'Saari leads ka database',
      'Lead & data hub': 'Lead aur data hub', 'AI assistant': 'AI assistant',
      'Run Agent': 'Agent chalayein', 'Run AI Agent': 'AI agent chalayein',
      'Connected Accounts': 'Connected accounts', 'System Settings': 'System settings',
      'History': 'History', 'Shortcuts': 'Shortcuts', 'Peek Tasks': 'Tasks dekhein',
      'Connect Sheets': 'Sheets connect karein', 'New Chat': 'Nayi chat',
      'Send message': 'Message bhejein', 'Start a fresh lead search': 'Nayi lead search shuru karein',
      'Search': 'Search karein', 'Save': 'Save karein', 'Cancel': 'Cancel karein',
      'Close': 'Band karein', 'Delete': 'Delete karein', 'Edit': 'Edit karein',
      'Retry': 'Dobara koshish karein', 'Continue': 'Continue karein',
      'Back': 'Peechhe', 'Next': 'Aage', 'Done': 'Ho gaya',
      'Language': 'Bhasha', 'Search languages': 'Language search karein',
      'India': 'India', 'Global': 'Global', 'Open navigation': 'Navigation kholein'
    }
  };
  Object.assign(BUILTIN, window.RUDRA_LOCALES || {});
  Object.assign(BUILTIN.hi || (BUILTIN.hi = {}), {
    'Set up Rudra24 AI': 'Rudra24 AI सेटअप करें',
    'AI and lead sourcing keys in one place.': 'AI और लीड खोज की कुंजियाँ एक जगह सेट करें।',
    'All set for conversation and lead sourcing.': 'बातचीत और लीड खोज के लिए सब तैयार है।',
    'Conversation is ready. An Apify token speeds up lead search.': 'बातचीत तैयार है। Apify टोकन से लीड खोज तेज होगी।',
    'Natural voice and live conversations.': 'स्वाभाविक आवाज़ और लाइव बातचीत।',
    'Fast replies and voice transcription.': 'तेज़ जवाब और वॉइस टाइपिंग।',
    'Backup models if another key reaches its limit.': 'एक कुंजी की सीमा पूरी होने पर दूसरे मॉडल।',
    'Faster Maps leads. Public search works without a token.': 'Maps की तेज़ लीड खोज। बिना टोकन के भी सार्वजनिक खोज चलेगी।',
    'Voice key for the calling agent.': 'कॉलिंग एजेंट की वॉइस कुंजी।',
    'Save the account key in the secure vault.': 'खाते की कुंजी सुरक्षित वॉल्ट में सहेजें।',
    'Google AI Studio key': 'Google AI Studio कुंजी',
    'Apify lead sourcing key': 'Apify लीड खोज कुंजी',
    'Groq key': 'Groq कुंजी',
    'OpenRouter key': 'OpenRouter कुंजी',
    'Microphone access': 'माइक्रोफ़ोन की अनुमति',
    'Talk to Rudra24 AI using your voice.': 'Rudra24 AI से बोलकर बात करें।',
    'Allow microphone': 'माइक्रोफ़ोन चालू करें',
    'Check microphone again': 'माइक्रोफ़ोन फिर जाँचें',
    'Check permission again': 'अनुमति फिर जाँचें',
    'More AI providers': 'और AI प्रदाता',
    'Recommended': 'सुझाया गया',
    'Optional': 'वैकल्पिक',
    'Faster sourcing': 'तेज़ लीड खोज',
    'Calling': 'कॉलिंग',
    'Not set': 'सेट नहीं है',
    'Connected': 'जुड़ा हुआ',
    'Allowed': 'अनुमति मिली',
    'Blocked': 'अनुमति नहीं मिली',
    'Limit reached': 'सीमा पूरी हुई',
    'Create a free key': 'मुफ़्त कुंजी बनाएँ',
    'Create an Apify token': 'Apify टोकन बनाएँ',
    'Create a Groq key': 'Groq कुंजी बनाएँ',
    'Create an OpenRouter key': 'OpenRouter कुंजी बनाएँ',
    'Check & Save': 'जाँचें और सहेजें',
    'Later': 'बाद में',
    'Remove old device keys': 'पुरानी डिवाइस कुंजियाँ हटाएँ',
    'Say “Rudra”, “Hey Buddy” or “Hey Clay” to start talking.': 'बात शुरू करने के लिए “Rudra”, “Hey Buddy” या “Hey Clay” बोलें।'
  });
  Object.assign(BUILTIN.es || {}, {
    'Forgot password / Unlock device': '¿Olvidaste tu contraseña? / Desbloquear dispositivo',
    'Account-protected workspace': 'Espacio de trabajo protegido',
    'Sign in required': 'Se requiere iniciar sesión'
  });
  const BRAND_DESCRIPTION = 'Lead Generation · Business Support · Business Analysis';
  const BRAND_DESCRIPTIONS = {
    hi: 'लीड जनरेशन · बिज़नेस सहायता · बिज़नेस विश्लेषण',
    hinglish: 'Lead generation · business support · business analysis',
    bn: 'লিড জেনারেশন · ব্যবসায়িক সহায়তা · ব্যবসায়িক বিশ্লেষণ',
    ta: 'லீட் உருவாக்கம் · வணிக ஆதரவு · வணிக பகுப்பாய்வு',
    te: 'లీడ్ జనరేషన్ · వ్యాపార సహాయం · వ్యాపార విశ్లేషణ',
    mr: 'लीड जनरेशन · व्यवसाय सहाय्य · व्यवसाय विश्लेषण',
    gu: 'લીડ જનરેશન · વ્યવસાય સહાય · વ્યવસાય વિશ્લેષણ',
    pa: 'ਲੀਡ ਜਨਰੇਸ਼ਨ · ਕਾਰੋਬਾਰੀ ਸਹਾਇਤਾ · ਕਾਰੋਬਾਰੀ ਵਿਸ਼ਲੇਸ਼ਣ',
    ur: 'لیڈ جنریشن · کاروباری معاونت · کاروباری تجزیہ',
    kn: 'ಲೀಡ್ ಜನರೇಷನ್ · ವ್ಯವಹಾರ ಬೆಂಬಲ · ವ್ಯವಹಾರ ವಿಶ್ಲೇಷಣೆ',
    ml: 'ലീഡ് ജനറേഷൻ · ബിസിനസ് പിന്തുണ · ബിസിനസ് വിശകലനം',
    or: 'ଲିଡ୍ ଜେନେରେସନ୍ · ବ୍ୟବସାୟ ସହାୟତା · ବ୍ୟବସାୟ ବିଶ୍ଳେଷଣ',
    as: 'লিড জেনেৰেচন · ব্যৱসায়িক সহায়তা · ব্যৱসায়িক বিশ্লেষণ',
    ne: 'लिड जेनेरेसन · व्यवसाय सहयोग · व्यवसाय विश्लेषण',
    es: 'Generación de leads · Asistencia empresarial · Análisis de negocio',
    fr: 'Génération de prospects · Assistance aux entreprises · Analyse d’activité',
    de: 'Leadgenerierung · Unternehmenssupport · Unternehmensanalyse',
    pt: 'Geração de leads · Suporte empresarial · Análise de negócios',
    ar: 'توليد العملاء المحتملين · دعم الأعمال · تحليل الأعمال',
    ru: 'Генерация лидов · поддержка бизнеса · бизнес-анализ',
    zh: '潜在客户开发 · 商业支持 · 业务分析',
    ja: 'リード獲得 · ビジネスサポート · ビジネス分析',
    ko: '리드 생성 · 비즈니스 지원 · 비즈니스 분석',
    id: 'Pembuatan prospek · Dukungan bisnis · Analisis bisnis',
    tr: 'Potansiyel müşteri oluşturma · İş desteği · İş analizi',
    vi: 'Tạo khách hàng tiềm năng · Hỗ trợ kinh doanh · Phân tích kinh doanh'
  };

  const SKIP = 'script,style,noscript,svg,canvas,code,pre,[contenteditable],'
    + '[data-rudra-i18n-ignore],#chat-messages,#candidate-chat-messages,'
    + '#jarvis-chat-scroll,#ch-detail,#jarvis-status-text,#clavis-live-transcript,'
    + '#topbar-user-badge,#desktop-notification-container,#toast-container,#ag-auth-toast,#chat-input,#candidate-ai-input,'
    + '.lead-card,.candidate-card,.chat-message,.jarvis-message,.chat-bubble,'
    + '.toast,.notification,.lead-row,.candidate-row,.data-table tbody';
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const originals = new WeakMap();
  const attributeOriginals = new WeakMap();
  const pending = new Set();
  const savedLanguage = localStorage.getItem(LANGUAGE_KEY);
  let language = LANGUAGES.some(([code]) => code === savedLanguage) ? savedLanguage : 'en';
  let cache = {};
  let observer;
  let flushTimer;
  let saveTimer;
  let translating = false;
  let aiTranslationUnavailable = false;
  let generation = 0;

  function brand(value) {
    return value.replace(/\bclavis\b/gi, word => word === word.toUpperCase() ? 'RUDRA' : 'Rudra');
  }

  function loadCache() {
    try { cache = JSON.parse(localStorage.getItem(`rudra_i18n_cache_v1_${language}`) || '{}') || {}; }
    catch (_) { cache = {}; }
  }

  function saveCacheSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(`rudra_i18n_cache_v1_${language}`, JSON.stringify(cache)); }
      catch (_) { /* Translation still works for this session. */ }
    }, 500);
  }

  function textIsUi(value) {
    const text = value.trim();
    return text.length > 0 && text.length <= 180 && /\p{L}/u.test(text)
      && !/@|https?:\/\/|\b(?:sk-|AIza)[A-Za-z0-9_-]+/i.test(text);
  }

  function excluded(element) {
    return !element || Boolean(element.closest(SKIP));
  }

  function visible(element) {
    if (element.closest('.view:not(.active),[hidden],[aria-hidden="true"]')) return false;
    // Visibility here means UI ownership, not pixel geometry. Reading client
    // rects for every label forced a page layout inside mutation microtasks.
    if (element.closest('#settings-overlay:not(.open),.modal-overlay:not(.open)')) return false;
    return true;
  }

  function translate(source) {
    const branded = brand(source);
    if (language === 'en') return branded;
    if (/^Rudra24\s+AI$/i.test(branded)) return 'Rudra24 AI';
    const greeting = branded.match(/^(Good (?:morning|afternoon|evening)),\s*(.+)$/i);
    if (greeting) {
      const greetingText = BUILTIN[language]?.[greeting[1]] || cache[greeting[1]];
      if (!greetingText) {
        pending.add(greeting[1]);
        scheduleFlush();
      }
      return `${greetingText || greeting[1]}, ${greeting[2]}`;
    }
    const direct = BUILTIN[language]?.[branded]
      || (branded === BRAND_DESCRIPTION && BRAND_DESCRIPTIONS[language]) || cache[branded];
    if (direct) return direct;
    pending.add(branded);
    scheduleFlush();
    return branded;
  }

  function applyText(node) {
    const raw = node.nodeValue || '';
    const known = originals.get(node);
    if (language === 'en' && !known && !/\bclavis\b/i.test(raw)) return;
    const parent = node.parentElement;
    if (excluded(parent) || !visible(parent)) return;
    if (!textIsUi(raw)) return;
    let record = originals.get(node);
    if (!record || raw !== record.applied) {
      record = { source: brand(raw.trim().replace(/\s+/g, ' ')), prefix: raw.match(/^\s*/)?.[0] || '',
        suffix: raw.match(/\s*$/)?.[0] || '', applied: raw };
      originals.set(node, record);
    }
    const result = record.prefix + translate(record.source) + record.suffix;
    if (raw !== result) { record.applied = result; node.nodeValue = result; }
  }

  function applyAttributes(element) {
    if (language === 'en' && !attributeOriginals.has(element)
        && !ATTRS.some(attr => /\bclavis\b/i.test(element.getAttribute(attr) || ''))) return;
    if (excluded(element) || !visible(element)) return;
    let records = attributeOriginals.get(element);
    if (!records) { records = {}; attributeOriginals.set(element, records); }
    for (const attr of ATTRS) {
      const value = element.getAttribute(attr);
      if (!value || !textIsUi(value)) continue;
      if (!records[attr] || value !== records[attr].applied) {
        records[attr] = { source: brand(value.trim().replace(/\s+/g, ' ')), applied: value };
      }
      const result = translate(records[attr].source);
      if (value !== result) {
        records[attr].applied = result;
        element.setAttribute(attr, result);
      }
    }
  }

  function scan(root) {
    if (root.nodeType === Node.TEXT_NODE) { applyText(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE || excluded(root)) return;
    if (root.matches('.view:not(.active)') || !visible(root)) return;
    applyAttributes(root);
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (excluded(node) || node.matches('.view:not(.active)') || !visible(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walk.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) applyText(node);
      else applyAttributes(node);
    }
  }

  function render() {
    document.documentElement.lang = language === 'hinglish' ? 'hi-Latn' : language;
    document.documentElement.dir = ['ar', 'ur'].includes(language) ? 'rtl' : 'ltr';
    const languageName = LANGUAGES.find(([code]) => code === language)?.[1] || 'English';
    document.querySelectorAll('.rudra-language-trigger').forEach(trigger => {
      trigger.textContent = languageName;
      trigger.setAttribute('aria-label', `${BUILTIN[language]?.Language || 'Language'}: ${languageName}`);
    });
    document.querySelectorAll('.rudra-language-option').forEach(option => {
      option.setAttribute('aria-pressed', String(option.dataset.languageCode === language));
    });
    document.querySelectorAll('.rudra-language-search').forEach(search => {
      search.placeholder = translate('Search languages');
      search.setAttribute('aria-label', search.placeholder);
    });
    document.querySelectorAll('.rudra-language-group').forEach(heading => {
      heading.textContent = translate(heading.dataset.languageGroup);
    });
    document.querySelectorAll('.rudra-language-picker > span').forEach(label => {
      label.textContent = BUILTIN[language]?.Language || 'Language';
    });
    scan(document.body);
  }

  function status(message) {
    if (message === 'Language') message = BUILTIN[language]?.Language || message;
    document.querySelectorAll('.rudra-language-trigger').forEach(trigger => {
      trigger.title = message;
    });
  }

  function scheduleFlush() {
    if (language === 'en' || language === 'hinglish' || flushTimer || translating) return;
    flushTimer = setTimeout(() => { flushTimer = null; flush().catch(() => {}); }, 300);
  }

  function parseTranslationResponse(response, batch) {
    const content = response.choices?.[0]?.message?.content || '';
    const json = content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    const translated = JSON.parse(json);
    if (!Array.isArray(translated) || translated.length !== batch.length || translated.some(item => typeof item !== 'string' || !item.trim())) {
      throw new Error('Invalid translation batch');
    }
    return translated.map(item => item.trim());
  }

  function decodeTranslation(value) {
    return value.replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => {
      const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : _;
    }).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&#39;/g, "'");
  }

  async function translateWithMyMemory(batchLanguage, batch) {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', batch.join('\n'));
    url.searchParams.set('langpair', `en|${batchLanguage}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8500);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Translation service HTTP ${response.status}`);
      const data = await response.json();
      if (data.quotaFinished || data.responseStatus !== 200 || typeof data.responseData?.translatedText !== 'string') {
        throw new Error('Translation service is unavailable');
      }
      const translated = decodeTranslation(data.responseData.translatedText).split(/\r?\n/).map(text => text.trim());
      if (translated.length !== batch.length || translated.some(text => !text || /mymemory warning/i.test(text))) {
        throw new Error('Translation service returned an incomplete result');
      }
      return translated;
    } finally { clearTimeout(timeout); }
  }

  async function translateBatch(batchLanguage, batch) {
    const protectedBatch = batch.map(source => source.replace(/Rudra24\s+AI/gi, 'RUDRA24AITOKEN'));
    const restoreBrand = value => value.replace(/RUDRA24AITOKEN/gi, 'Rudra24 AI');
    if (!aiTranslationUnavailable && window.SupabaseAuth?.getAccessToken?.() && window.NexusAIChat?.complete) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await window.NexusAIChat.complete({
          model: 'gemini/gemini-2.5-flash', temperature: 0, max_tokens: 4096,
          messages: [
            { role: 'system', content: 'Translate software interface strings. Return ONLY a JSON array of strings in the original order and same length. Preserve Rudra, Rudra24 AI, company names, model names, numbers, placeholders, and keyboard shortcuts. Do not add explanations.' },
            { role: 'user', content: JSON.stringify({ language: batchLanguage, strings: protectedBatch }) }
          ]
        }, controller.signal);
        return parseTranslationResponse(response, protectedBatch).map(restoreBrand);
      } catch (_) {
        aiTranslationUnavailable = true;
      } finally { clearTimeout(timeout); }
    }
    return (await translateWithMyMemory(batchLanguage, protectedBatch)).map(restoreBrand);
  }

  async function flush() {
    if (translating || !pending.size) return;
    translating = true;
    const batchLanguage = language;
    const batchGeneration = generation;
    const batch = [];
    let batchSize = 0;
    for (const source of pending) {
      if (batch.length >= 30 || batchSize + source.length + 1 > 450) break;
      batch.push(source);
      batchSize += source.length + 1;
    }
    batch.forEach(text => pending.delete(text));
    status('Translating interface…');
    try {
      const translated = await translateBatch(batchLanguage, batch);
      if (batchGeneration === generation && batchLanguage === language) {
        batch.forEach((source, index) => { cache[source] = translated[index].trim(); });
        saveCacheSoon();
        render();
        status('Language');
        window.dispatchEvent(new CustomEvent('rudra-translations-ready', { detail: { language: batchLanguage } }));
      }
    } catch (error) {
      if (batchGeneration === generation) status('Translation unavailable. Check your connection and retry.');
      console.warn('[Rudra i18n] UI translation unavailable:', error?.code || error?.message || 'unknown');
    } finally {
      translating = false;
      if (batchGeneration === generation && pending.size) scheduleFlush();
    }
  }

  function changeLanguage(next) {
    if (!LANGUAGES.some(([code]) => code === next)) return;
    language = next;
    generation++;
    pending.clear();
    clearTimeout(flushTimer);
    flushTimer = null;
    localStorage.setItem(LANGUAGE_KEY, next);
    loadCache();
    render();
    status('Language');
    window.dispatchEvent(new CustomEvent('rudra-language-change', { detail: { language: next } }));
  }

  function translateText(source) { return translate(brand(String(source || ''))); }

  function picker(id) {
    const wrap = document.createElement('div');
    wrap.className = 'rudra-language-picker';
    wrap.dataset.rudraI18nIgnore = '';
    const label = document.createElement('span');
    label.textContent = 'Language';
    const trigger = document.createElement('button');
    trigger.id = id;
    trigger.type = 'button';
    trigger.className = 'rudra-language-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', `${id}-menu`);
    const menu = document.createElement('div');
    menu.id = `${id}-menu`;
    menu.className = 'rudra-language-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Choose language');
    menu.setAttribute('popover', 'manual');
    menu.tabIndex = -1;
    menu.dataset.rudraI18nIgnore = '';
    menu.hidden = true;
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'rudra-language-search';
    search.placeholder = 'Search languages';
    search.setAttribute('aria-label', 'Search languages');
    const list = document.createElement('div');
    list.className = 'rudra-language-options';
    const options = [];
    for (const [index, [code, name]] of LANGUAGES.entries()) {
      if (index === 0 || index === 15) {
        const heading = document.createElement('span');
        heading.className = 'rudra-language-group';
        heading.dataset.languageGroup = index === 0 ? 'India' : 'Global';
        list.append(heading);
      }
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'rudra-language-option';
      option.dataset.languageCode = code;
      option.dataset.languageName = name.toLocaleLowerCase();
      option.textContent = name;
      option.addEventListener('click', () => {
        changeLanguage(code);
        setOpen(false, true);
      });
      options.push(option);
      list.append(option);
    }
    search.addEventListener('input', () => {
      const query = search.value.trim().toLocaleLowerCase();
      options.forEach(option => {
        option.hidden = Boolean(query) && !`${option.dataset.languageName} ${option.dataset.languageCode}`.includes(query);
      });
      list.querySelectorAll('.rudra-language-group').forEach(heading => {
        let next = heading.nextElementSibling;
        let hasVisible = false;
        while (next && !next.classList.contains('rudra-language-group')) {
          if (!next.hidden) hasVisible = true;
          next = next.nextElementSibling;
        }
        heading.hidden = !hasVisible;
      });
    });
    menu.append(search, list);
    wrap.append(label, trigger, menu);

    let isOpen = false;
    let popoverOpen = false;
    let menuAnimation = null;
    const motionAllowed = () => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const visibleOptions = () => options.filter(option => !option.hidden);
    const placeMenu = () => {
      const rect = trigger.getBoundingClientRect();
      const margin = 12;
      const width = Math.min(232, Math.max(120, window.innerWidth - margin * 2));
      const below = Math.max(0, window.innerHeight - rect.bottom - margin);
      const above = Math.max(0, rect.top - margin);
      const roomAbove = below < Math.min(330, window.innerHeight - margin * 2) && above > below;
      const available = roomAbove ? above : below;
      const maxHeight = Math.max(88, Math.min(360, window.innerHeight - margin * 2, available));
      const preferredLeft = document.documentElement.dir === 'rtl' ? rect.right - width : rect.left;
      const left = Math.max(margin, Math.min(preferredLeft, window.innerWidth - width - margin));
      const top = roomAbove ? Math.max(margin, rect.top - maxHeight - 8) : Math.min(rect.bottom + 8, window.innerHeight - maxHeight - margin);

      menu.style.width = width + 'px';
      menu.style.maxHeight = maxHeight + 'px';
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
      list.style.maxHeight = Math.max(40, maxHeight - 68) + 'px';
      menu.style.setProperty('--rudra-menu-origin', roomAbove ? 'bottom left' : 'top left');
    };
    const updatePlacement = () => { if (isOpen) placeMenu(); };
    const hideMenu = () => {
      if (popoverOpen && typeof menu.hidePopover === 'function') {
        try { menu.hidePopover(); } catch (_) { /* Fallback visibility still closes it. */ }
      }
      popoverOpen = false;
      menu.hidden = true;
    };
    const setOpen = (next, restoreFocus = false) => {
      if (isOpen === next) return;
      isOpen = next;
      wrap.classList.toggle('is-open', next);
      trigger.setAttribute('aria-expanded', String(next));

      if (menuAnimation) {
        menuAnimation.cancel();
        menuAnimation = null;
      }

      if (next) {
        menu.hidden = false;
        placeMenu();
        if (typeof menu.showPopover === 'function') {
          try { menu.showPopover(); popoverOpen = true; }
          catch (_) { popoverOpen = false; }
        }
        window.addEventListener('resize', updatePlacement, { passive: true });
        window.addEventListener('scroll', updatePlacement, { capture: true, passive: true });
        search.value = '';
        search.dispatchEvent(new Event('input'));
        if (motionAllowed() && typeof menu.animate === 'function') {
          menuAnimation = menu.animate(
            [{ opacity: 0, transform: 'translateY(-7px) scale(.985)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }],
            { duration: 190, easing: 'cubic-bezier(.16, 1, .3, 1)' }
          );
          menuAnimation.onfinish = () => { menuAnimation = null; };
        }
        search.focus({ preventScroll: true });
        return;
      }

      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
      if (!motionAllowed() || typeof menu.animate !== 'function' || menu.hidden) {
        hideMenu();
      } else {
        const closingAnimation = menu.animate(
          [{ opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(-4px) scale(.99)' }],
          { duration: 130, easing: 'cubic-bezier(.5, 0, .75, 0)' }
        );
        menuAnimation = closingAnimation;
        closingAnimation.onfinish = () => {
          if (menuAnimation === closingAnimation) menuAnimation = null;
          if (!isOpen) hideMenu();
        };
      }
      if (restoreFocus) trigger.focus();
    };

    trigger.addEventListener('click', () => setOpen(!isOpen));
    trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!isOpen) setOpen(true);
        const available = visibleOptions();
        const target = event.key === 'ArrowDown' ? available[0] : available[available.length - 1];
        requestAnimationFrame(() => target?.focus({ preventScroll: true }));
      }
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false, true);
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const available = visibleOptions();
      if (!available.length) return;
      event.preventDefault();
      const current = available.indexOf(document.activeElement);
      let nextIndex = current;
      if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = available.length - 1;
      else if (event.key === 'ArrowDown') nextIndex = current < 0 ? 0 : (current + 1) % available.length;
      else nextIndex = current < 0 ? available.length - 1 : (current - 1 + available.length) % available.length;
      available[nextIndex].focus();
    });
    document.addEventListener('pointerdown', event => {
      const path = event.composedPath ? event.composedPath() : [];
      if (!wrap.contains(event.target) && !menu.contains(event.target) && !path.includes(menu)) setOpen(false);
    }, true);
    return wrap;
  }

  function install() {
    if (document.getElementById('rudra-topbar-language')) return;
    const topbar = document.querySelector('.topbar-right');
    const auth = document.getElementById('auth-screen');
    if (!topbar || !auth) return;
    const style = document.createElement('style');
    style.textContent = `.rudra-language-picker{position:relative;display:flex;align-items:center;gap:7px;min-width:0;font:600 11px/1.2 Inter,system-ui,sans-serif;color:var(--cc-mute,#6B6A64)}
      .rudra-language-trigger{height:32px;min-width:106px;max-width:144px;border:1px solid var(--cc-line,rgba(20,20,19,.12));border-radius:9px;padding:0 28px 0 10px;background:var(--cc-sheet,#FBF8F0);color:var(--cc-ink,#20241F);font:550 12px/1 Inter,system-ui,sans-serif;text-align:left;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;cursor:pointer;position:relative;transition:background-color 160ms cubic-bezier(.16,1,.3,1),border-color 160ms cubic-bezier(.16,1,.3,1),color 160ms cubic-bezier(.16,1,.3,1),transform 200ms cubic-bezier(.16,1,.3,1)}
      .rudra-language-trigger:after{content:'';position:absolute;right:11px;top:11px;width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);transform-origin:65% 65%;transition:transform 180ms cubic-bezier(.16,1,.3,1)}
      .rudra-language-picker.is-open .rudra-language-trigger:after{transform:rotate(225deg)}
      .rudra-language-trigger:hover{background:var(--cc-hover,#F0EEE6);border-color:rgba(47,82,51,.2);transform:translateY(-1px)}
      .rudra-language-picker.is-open .rudra-language-trigger{background:var(--cc-surface,#fff);border-color:rgba(47,82,51,.24)}
      .rudra-language-trigger:focus-visible,.rudra-language-menu input:focus-visible,.rudra-language-option:focus-visible{outline:2px solid rgba(47,82,51,.42);outline-offset:2px}
      .rudra-language-menu{position:fixed;inset:auto;margin:0;z-index:2147483647;pointer-events:auto;box-sizing:border-box;width:232px;max-height:min(360px,calc(100vh - 24px));padding:7px;background:var(--cc-surface,#fffdf9);border:1px solid var(--cc-line,rgba(20,20,19,.1));border-radius:12px;box-shadow:var(--cc-sh-pop,0 8px 28px rgba(24,31,26,.16));color:var(--cc-ink,#222);font-family:var(--cc-sans,Inter,system-ui,sans-serif);transform-origin:var(--rudra-menu-origin,top left);overscroll-behavior:contain}
      .rudra-language-menu[hidden]{display:none}
      .rudra-language-menu input{display:block;box-sizing:border-box;width:100%;height:36px;margin:0 0 5px;padding:0 10px;border:1px solid var(--cc-line,rgba(20,20,19,.12));border-radius:8px;background:var(--cc-sheet,#FBF8F0);color:inherit;font:500 12px var(--cc-sans,Inter,system-ui,sans-serif)}
      .rudra-language-menu input::placeholder{color:var(--cc-faint,#96938B)}
      .rudra-language-options{max-height:302px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--cc-line,#e6e2d9) transparent}
      .rudra-language-group{display:block;padding:9px 9px 4px;color:var(--cc-faint,#8C8A82);font-size:10px;font-weight:650;letter-spacing:.055em;text-transform:uppercase}
      .rudra-language-group[hidden],.rudra-language-option[hidden]{display:none}
      .rudra-language-option{display:block;width:100%;min-height:34px;padding:7px 9px;border:0;border-radius:7px;background:transparent;color:var(--cc-ink-2,#3D3D3A);font:500 13px/1.35 var(--cc-sans,Inter,system-ui,sans-serif);text-align:left;cursor:pointer;transition:background-color 140ms cubic-bezier(.16,1,.3,1),color 140ms cubic-bezier(.16,1,.3,1),transform 170ms cubic-bezier(.16,1,.3,1)}
      .rudra-language-option:hover{background:var(--cc-hover,#F0EEE6);color:var(--cc-ink,#20241F);transform:translateX(2px)}
      .rudra-language-option[aria-pressed="true"]{background:var(--cc-accent-soft,rgba(47,82,51,.09));color:var(--cc-accent-ink,#2F5233);font-weight:650}
      html[data-theme="dark"] .rudra-language-menu,body.dark .rudra-language-menu{background:#20201D;border-color:rgba(255,255,255,.1);color:#F1EEE6;box-shadow:0 2px 6px rgba(0,0,0,.28),0 18px 42px -12px rgba(0,0,0,.62)}
      html[data-theme="dark"] .rudra-language-menu input,body.dark .rudra-language-menu input{background:#191917;border-color:rgba(255,255,255,.12);color:#F1EEE6}
      html[data-theme="dark"] .rudra-language-option,body.dark .rudra-language-option{color:#E7E4DC}
      html[data-theme="dark"] .rudra-language-option:hover,body.dark .rudra-language-option:hover{background:rgba(255,255,255,.07);color:#fff}
      html[data-theme="dark"] .rudra-language-option[aria-pressed="true"],body.dark .rudra-language-option[aria-pressed="true"]{background:rgba(133,163,127,.16);color:#B8D2B3}
      html[dir="rtl"] #ag-input-email,html[dir="rtl"] #ag-input-password,html[dir="rtl"] #ag-input-phone{direction:ltr;text-align:left}
      @media(max-width:1050px){.topbar-right #rudra-topbar-language{gap:0}.topbar-right #rudra-topbar-language span{display:none}.topbar-right #rudra-topbar-language .rudra-language-trigger{max-width:110px;min-width:80px}}
      @media(max-width:700px){.topbar-right #rudra-topbar-language .rudra-language-trigger{max-width:90px;min-width:70px}}
      @media(prefers-reduced-motion:reduce){.rudra-language-trigger,.rudra-language-trigger:after,.rudra-language-option{transition:none!important}.rudra-language-trigger:hover{transform:none}}
      `;
    document.head.append(style);
    const topPicker = picker('rudra-topbar-language');
    topbar.prepend(topPicker);
    document.body.append(document.getElementById('rudra-topbar-language-menu'));
    const authPicker = picker('rudra-auth-language');
    auth.prepend(authPicker);
    document.body.append(document.getElementById('rudra-auth-language-menu'));
    loadCache();
    render();
    const changedRoots = new Set();
    const visibilityKeys = new WeakMap();
    let scanQueued = false;
    function queueScan(root) {
      if (!root || (root.nodeType === Node.ELEMENT_NODE && excluded(root))) return;
      changedRoots.add(root);
      if (scanQueued) return;
      scanQueued = true;
      requestAnimationFrame(() => {
        scanQueued = false;
        const batch = [...changedRoots]; changedRoots.clear();
        batch.filter(root => !batch.some(other => other !== root && other.contains?.(root)))
          .forEach(root => { if (root.isConnected) scan(root); });
      });
    }
    observer = new MutationObserver(changes => {
      for (const change of changes) {
        if (change.type === 'characterData') {
          if (originals.get(change.target)?.applied !== change.target.nodeValue) queueScan(change.target);
        } else if (change.type === 'childList') change.addedNodes.forEach(queueScan);
        else if (change.attributeName === 'class' || change.attributeName === 'hidden' || change.attributeName === 'aria-hidden') {
          const el = change.target;
          if (el.matches('.view,#app-shell,#auth-screen,#settings-overlay,.modal-overlay,#cx-setup-root')) {
            const key = [el.classList.contains('active'),el.classList.contains('open'),el.hidden,el.getAttribute('aria-hidden')].join(':');
            if (visibilityKeys.get(el) !== key) { visibilityKeys.set(el,key); queueScan(el); }
          }
        } else queueScan(change.target);
      }
      if (pending.size) scheduleFlush();
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['class', 'hidden', 'aria-hidden', ...ATTRS] });
  }

  window.RudraI18n = { changeLanguage, currentLanguage: () => language, translateText, refresh: render };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
