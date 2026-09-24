/* clavis-nano.js · the keyless, offline last resort for Clavis's brain.
   Chrome 148+ ships Gemini Nano on-device behind the Prompt API
   (LanguageModel). When no AI key is connected — or every key is out of
   quota — Clavis can still hold a real conversation through it instead
   of falling back to canned lines. Limits, stated honestly: no tools, no
   web, officially English output only (Hinglish in Latin script works
   reasonably), and it needs a capable PC (Chrome's own requirement:
   ~22 GB free disk, a GPU with >4 GB VRAM or 16 GB RAM).

   The one-time model download needs a click, so it starts on the first
   click only when there is no AI key at all — the only case where this
   is the difference between thinking and not. */
(function () {
  'use strict';
  if (window.ClavisNano) return;

  const LM = () => self.LanguageModel;
  const OUT = [{ type: 'text', languages: ['en'] }];
  let state = 'unknown';

  async function check() {
    try { state = LM() ? await LM().availability({ expectedOutputs: OUT }) : 'unavailable'; }
    catch (_) { state = 'unavailable'; }
    return state;
  }
  check();

  window.addEventListener('pointerdown', () => {
    if (state !== 'downloadable' || window.ClavisDirect?.hasKey?.()) return;
    try {
      window.showToast?.({ type: 'info', title: "Setting up Clavis's offline brain", message: "Chrome is downloading its on-device AI once (a few GB). Clavis can think without any key after this." });
    } catch (_) {}
    state = 'downloading';
    LM().create({
      expectedOutputs: OUT,
      monitor(m) { m.addEventListener('downloadprogress', (e) => { if (e.loaded >= 1) state = 'available'; }); },
    }).then((s) => { s.destroy(); state = 'available'; }).catch(() => { check(); });
  }, { once: true, passive: true });

  function persona() {
    return 'You are Clavis, the calm, warm, quietly witty personal AI of the owner, whom you call "sir". '
      + 'He runs a security and housekeeping staffing company in India. Speak like a trusted right hand: short, natural sentences, no lists. '
      + 'Reply in English, or in Hinglish written in Latin script if he writes Hinglish. '
      + 'You are running offline on this PC with no tools and no internet right now: never invent facts, leads, numbers or contacts, '
      + 'and if he asks for leads, web lookups or app actions, tell him politely that needs an AI key reconnected.';
  }

  async function complete(messages, signal) {
    const turns = (messages || [])
      .filter((m) => m && m.role !== 'system' && typeof m.content === 'string' && m.content.trim())
      .slice(-8)
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content.slice(0, 2000) }));
    const last = turns.pop();
    if (!last) return '';
    const session = await LM().create({ initialPrompts: [{ role: 'system', content: persona() }, ...turns], expectedOutputs: OUT, signal });
    try { return String(await session.prompt(last.content, { signal }) || '').trim(); }
    finally { try { session.destroy(); } catch (_) {} }
  }

  window.ClavisNano = { isReady: () => state === 'available', status: () => state, check, complete };
})();
