/**
 * ============================================================
 *  CLAVIS COMMANDS (clavis-commands.js)
 *  Bilingual (Hindi/English/Hinglish) intent router. Handles device
 *  commands locally — BEFORE hitting the LLM — so they're instant and
 *  work even without an AI key:
 *    - stop talking:  "chup", "shut up", "bas", "ruk ja", "band karo"
 *    - screenshot:    "screenshot le", "screen shot", "capture screen"
 *    - read screen:   "screen pe kya hai", "isme kya likha hai", "extract"
 *    - give to app:   "ise chatgpt/claude/gemini ko do"
 *    - open:          "youtube khol do", "open notepad", "launch spotify"
 *    - save note:     "notepad me likho ...", "save this text ..."
 *
 *  route(text) → { handled, spoken?, silent? }. The caller renders/speaks
 *  `spoken` (unless `silent`). Screen powers use window.ClavisPC; screen
 *  understanding uses window.ClavisDirect (a vision-capable key).
 * ============================================================
 */
'use strict';

(() => {
  const norm = (s) => String(s || '').toLowerCase().replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ').trim();

  const STOP_RE = /\b(shut up|be quiet|stop talking|stop|quiet|chup|chup ho ?jao?|chup ho ja|bas karo?|bas|ruk ja(?:o)?|ruko|band karo?|shaant ho ?ja)\b/i;

  const state = { lastShot: null, muted: false };

  function isStop(text) { return STOP_RE.test(norm(text)); }

  function cancelSpeech() {
    try { window.speechSynthesis?.cancel(); } catch (_) {}
    try { if (window.currentPlayingAudio) { window.currentPlayingAudio.pause(); window.currentPlayingAudio = null; } } catch (_) {}
    try { window.ClavisBargeIn?.disarm?.(); } catch (_) {}
    if (typeof window.isJarvisSpeaking !== 'undefined') window.isJarvisSpeaking = false;
  }

  async function grabShot() {
    if (state.lastShot && Date.now() - state.lastShot.at < 60000) return state.lastShot.dataUrl;
    const { dataUrl } = await window.ClavisPC.screenshot();
    state.lastShot = { dataUrl, at: Date.now(), native: true };
    return dataUrl;
  }

  async function analyzeScreen(question) {
    if (!window.ClavisDirect?.hasKey?.()) {
      return 'Screen padhne ke liye ek AI key chahiye. Neeche key connect karein, phir dobara boliye.';
    }
    if (!window.ClavisDirect.supportsVision?.()) {
      return 'Aapki key text ke liye hai — screen dekhne ke liye OpenRouter, Gemini ya OpenAI ki vision key connect karein.';
    }
    window.setJarvisStatus?.('thinking', 'Screen dekh raha hoon…');
    const dataUrl = await grabShot();
    const sys = 'You are Clavis. The user shared a screenshot of their computer screen. Answer their request about it precisely and briefly, in the same language they used (Hinglish/Hindi/English). Read text exactly as shown. Do not invent anything not visible.';
    const data = await window.ClavisDirect.complete({
      messages: [{ role: 'system', content: sys }, { role: 'user', content: question || 'Screen par kya hai? Batao.' }],
      images: [dataUrl], max_tokens: 900,
    });
    return data.choices?.[0]?.message?.content?.trim() || 'Mujhe screen par kuch clear nahi mila.';
  }

  // ── target extraction for open/give ──
  const GIVE_RE = /\b(chatgpt|chat gpt|claude|gemini|bard|copilot|perplexity)\b/i;
  function extractOpenTarget(t) {
    let m = t.match(/^(?:open|launch|start|khol(?:o| do| de| do na)?|chalu karo?|chalao)\s+(.+)$/i);
    if (m) return m[1].replace(/\b(kar do|karo|kholo|please|jara|zara|na)\b/gi, '').trim();
    m = t.match(/^(.+?)\s+(?:khol(?:o| do| de| do na)?|open karo?|chalu karo?|chalao|launch karo?)\s*$/i);
    if (m) return m[1].trim();
    return '';
  }
  function extractNoteText(t, raw) {
    let m = raw.match(/(?:notepad(?: me| par| pe)?(?: likho| likh do| save karo| save)?|save this(?: text)?(?: as a note| to notepad)?|note (?:bana(?:o| do)?|likh(?:o| do)?)|likh (?:lo|do))\s*[:\-]?\s*([\s\S]+)$/i);
    if (m && m[1].trim()) return m[1].trim();
    return '';
  }

  async function route(text) {
    const raw = String(text || '').trim();
    const t = norm(raw);
    if (!t) return { handled: false };

    // 0) IN-APP NAVIGATION & VERBAL CONTROL (instant, no LLM)
    if (window.ClavisVoiceNav) {
      const navResult = window.ClavisVoiceNav.route(raw);
      if (navResult && navResult.handled) return navResult;
    }

    // 1) STOP — silence Clavis immediately, no LLM, no spoken reply.
    if (STOP_RE.test(t) && t.split(' ').length <= 4) {
      cancelSpeech();
      state.muted = true;
      window.setJarvisStatus?.('online', 'Chup — bolo jab chahiye');
      return { handled: true, spoken: '', silent: true };
    }

    // 2) PROMPT MASTER AGENT (screenshot + analyze context + compose prompt + copy + open AI)
    if (window.ClavisPromptMaster?.isMatch?.(raw)) {
      try {
        const pmResult = await window.ClavisPromptMaster.execute(raw);
        if (pmResult && pmResult.handled) return pmResult;
      } catch (err) {
        console.warn('[ClavisCommands] PromptMaster error:', err);
      }
    }

    // 2b) GIVE screenshot to another AI app (copy image to clipboard + open the app)
    if (/\b(is(?:e|ko)?|ye|this|screenshot)\b/.test(t) && GIVE_RE.test(t) && /\b(do|de do|bhej|give|send|paste|par|pe|ko)\b/.test(t)) {
      const appMatch = t.match(GIVE_RE)[1].replace(/\s+/g, '');
      try {
        const dataUrl = await grabShot();
        const copied = await window.ClavisPC.copyImage(dataUrl);
        await window.ClavisPC.open(appMatch === 'chatgpt' ? 'chatgpt' : appMatch);
        return { handled: true, spoken: copied
          ? `Screenshot clipboard me copy karke ${appMatch} khol diya — wahan Ctrl+V dabakar paste karein.`
          : `${appMatch} khol diya. Screenshot download folder me hai — wahan attach kar dein. (Clipboard copy browser me block tha.)` };
      } catch (err) {
        // Keep it handled so it never leaks to the LLM as a chat message.
        return { handled: true, spoken: `Screenshot nahi le paya (${err.message}). PC bridge on karein to bina permission ke chalega.` };
      }
    }

    // 3) SCREENSHOT (optionally "…aur batao" = capture then analyze)
    if (/\b(screenshot|screen shot|screen ?grab|snap le|capture (?:the )?screen|screen (?:ka )?photo)\b/.test(t)) {
      try {
        // Clipboard only — never downloaded, never written to disk.
        const { dataUrl, native, clipboard } = await window.ClavisPC.screenshot();
        state.lastShot = { dataUrl, at: Date.now(), native };
        if (/\b(batao?|kya hai|analyse|analyze|padho|read|explain|extract|samjhao)\b/.test(t)) {
          const answer = await analyzeScreen(raw);
          return { handled: true, spoken: `Screenshot le liya. ${answer}` };
        }
        return { handled: true, spoken: clipboard
          ? `Screenshot clipboard me copy kar diya sir${native ? '' : ' (browser mode)'} — kahin Ctrl+V dabaiye. "Ise ChatGPT ko do" ya "isme kya hai" bhi bol sakte hain.`
          : `Screenshot le liya sir, par clipboard copy block ho gaya. PC bridge on karein to pakka clipboard me jayega.` };
      } catch (err) {
        return { handled: true, spoken: `Screenshot nahi le paya: ${err.message}` };
      }
    }

    // 4) READ / EXTRACT the screen
    if (/\b(screen (?:par|pe|me|pr) kya|isme kya (?:hai|likha)|is screen|read (?:the |this )?screen|screen ?read|extract|kya likha hai|padh(?:o| ke batao)|screen samjhao)\b/.test(t)) {
      try { return { handled: true, spoken: await analyzeScreen(raw) }; }
      catch (err) { return { handled: true, spoken: `Screen nahi padh paya: ${err.message}` }; }
    }

    // 5) OPEN app / site — checked before "save note" so "open notepad" opens
    //    Notepad instead of matching the bare "notepad" save keyword.
    if (/\b(open|launch|khol(?:o| do| de)?|chalu karo?|chalao)\b/.test(t)) {
      const target = extractOpenTarget(t);
      if (target) {
        try {
          const r = await window.ClavisPC.open(target);
          return { handled: true, spoken: r.native ? `${target} khol diya.` : `${target} browser me khol diya.` };
        } catch (err) { return { handled: true, spoken: err.message }; }
      }
    }

    // 6) SAVE NOTE / Notepad
    if (/\b(notepad|note (?:bana|likh)|save this(?: text)?|likh (?:lo|do))\b/.test(t)) {
      let body = extractNoteText(t, raw);
      if (!body) {
        const last = document.querySelector('#jarvis-messages .jarvis-bubble.assistant:last-of-type p');
        body = last?.textContent?.trim() || '';
      }
      if (!body) return { handled: true, spoken: 'Kya likhun? Text boliye — jaise "notepad me likho: kal 5 baje meeting".' };
      try {
        const r = await window.ClavisPC.saveNote(body);
        return { handled: true, spoken: r.native ? `Notepad me save kar diya${r.path ? ' → ' + r.path : ''}.` : 'Text file download kar di (bridge band tha, isliye Notepad nahi khula).' };
      } catch (err) { return { handled: true, spoken: `Save nahi hua: ${err.message}` }; }
    }

    return { handled: false };
  }

  window.ClavisCommands = { route, isStop, cancelSpeech, _state: state };
})();
