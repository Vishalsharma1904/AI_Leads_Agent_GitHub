/**
 * ============================================================
 *  CLAVIS PROMPT MASTER AGENT (clavis-prompt-master.js)
 *  Autonomous prompt engineering & orchestration agent.
 * 
 *  User Flow:
 *    "page ka screenshot lo and chatgpt/claude/gemini par daalo and prompt likhdo"
 * 
 *  Execution:
 *    1. Captures full OS screenshot via ClavisPC native bridge (or browser fallback).
 *    2. Reads active window title, process, and context.
 *    3. Employs vision/AI analysis to understand what the user is working on,
 *       the errors, code, UI, or document on screen.
 *    4. Crafts an optimal, context-aware prompt specifically tailored for the target AI.
 *    5. Copies the crafted prompt to clipboard.
 *    6. Opens ChatGPT, Claude, or Gemini instantly.
 *    7. Reports concisely in Jarvis male persona with interactive UI cards.
 * ============================================================
 */
'use strict';

(() => {
  const TARGET_URLS = {
    chatgpt: 'https://chatgpt.com',
    claude: 'https://claude.ai',
    gemini: 'https://gemini.google.com',
    perplexity: 'https://www.perplexity.ai'
  };

  const TARGET_NAMES = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    gemini: 'Gemini',
    perplexity: 'Perplexity'
  };

  function parseTargetAI(text) {
    const t = String(text || '').toLowerCase();
    if (/\bclaude\b/.test(t)) return 'claude';
    if (/\bgemini|bard\b/.test(t)) return 'gemini';
    if (/\bperplexity\b/.test(t)) return 'perplexity';
    return 'chatgpt';
  }

  function extractUserIntent(text) {
    let clean = String(text || '')
      .replace(/\b(page ka|screen ka|ek)?\s*(screenshot|screen shot|snap)\s*(lo|le lo|lena)?\b/gi, '')
      .replace(/\b(aur|and|phir|then)?\s*(chatgpt|claude|gemini|bard|perplexity)\s*(par|pe|pr|ko|mein|me|into)?\s*(daalo|daal do|bhejo|bhej do|open karo|kholo)?\b/gi, '')
      .replace(/\b(aur|and)?\s*prompt\s*(likh(?:o| do|na)?|bana(?:o| do|na)?|craft karo)?\b/gi, '')
      .replace(/\b(context (?:ko )?samjh(?:o| kar)?|solve kar(?:o| do)?)\b/gi, '')
      .trim();
    return clean || 'Please analyze this situation, troubleshoot any issues or errors visible, and provide the best solution step-by-step.';
  }

  async function craftPromptWithAI({ activeWindow, userIntent, dataUrl, targetAI }) {
    const targetName = TARGET_NAMES[targetAI] || 'ChatGPT';
    const appTitle = activeWindow?.title || 'Active Window';
    const appProcess = activeWindow?.process || 'Application';

    // If AI Direct with vision is available, get real visual comprehension
    if (window.ClavisDirect?.hasKey?.() && window.ClavisDirect?.complete) {
      try {
        const sys = [
          `You are an expert prompt engineer creating a prompt to be sent directly to ${targetName}.`,
          `The user is currently using "${appProcess}" (Window: "${appTitle}").`,
          `The user's goal is: "${userIntent}".`,
          `Analyze the screenshot and craft an EXCELLENT, comprehensive prompt that the user can immediately submit to ${targetName}.`,
          `The crafted prompt should include:`,
          `- Context: What application/code/page the user is on.`,
          `- Exact Problem/Goal: Specific error messages, code bugs, UI elements, or requirements visible.`,
          `- Expected Resolution: Clear, direct request for actionable steps, code fixes, or analysis.`,
          `Output ONLY the final prompt text to be sent to ${targetName}. Do NOT include pleasantries, quotes, or markdown wrappers.`
        ].join(' ');

        const messages = [
          { role: 'system', content: sys },
          { role: 'user', content: `Here is the user's screen context:\nProcess: ${appProcess}\nWindow: ${appTitle}\nUser request: ${userIntent}\n\nPlease generate the optimal prompt for ${targetName}.` }
        ];

        const reqOptions = { messages, max_tokens: 600 };
        if (dataUrl && window.ClavisDirect.supportsVision?.()) {
          reqOptions.images = [dataUrl];
        }

        const res = await window.ClavisDirect.complete(reqOptions);
        const prompt = res?.choices?.[0]?.message?.content?.trim();
        if (prompt) return prompt;
      } catch (err) {
        console.warn('[PromptMaster] AI generation fallback:', err);
      }
    }

    // Heuristic fallback prompt if no direct LLM key is configured
    return [
      `I am working in ${appProcess} (${appTitle}).`,
      `Goal: ${userIntent}`,
      `Please help me solve this step-by-step, review the code or context, and provide the exact solution with clean code or instructions.`
    ].join('\n\n');
  }

  async function handlePromptMasterCommand(userQuery) {
    const targetAI = parseTargetAI(userQuery);
    const targetName = TARGET_NAMES[targetAI] || 'ChatGPT';
    const userIntent = extractUserIntent(userQuery);

    window.setJarvisStatus?.('thinking', `Analyzing screen & crafting ${targetName} prompt...`);

    let screenshotDataUrl = null;
    let windowInfo = null;

    try {
      if (window.ClavisPC) {
        // 1. Grab screen & active window info
        const [shotRes, active] = await Promise.all([
          window.ClavisPC.screenshot().catch(() => null),
          window.ClavisPC.activeWindow().catch(() => null)
        ]);
        screenshotDataUrl = shotRes?.dataUrl || null;
        windowInfo = active;
      }

      // 2. Craft high-level prompt
      const generatedPrompt = await craftPromptWithAI({
        activeWindow: windowInfo,
        userIntent,
        dataUrl: screenshotDataUrl,
        targetAI
      });

      // 3. Copy prompt text to clipboard
      let copied = false;
      try {
        if (window.ClavisPC?.copyText) {
          copied = await window.ClavisPC.copyText(generatedPrompt);
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(generatedPrompt);
          copied = true;
        }
      } catch (_) {
        copied = false;
      }

      // 4. Open the target platform
      const targetUrl = TARGET_URLS[targetAI] || TARGET_URLS.chatgpt;
      try {
        if (window.ClavisPC?.open) {
          await window.ClavisPC.open(targetUrl);
        } else {
          window.open(targetUrl, '_blank', 'noopener');
        }
      } catch (err) {
        window.open(targetUrl, '_blank', 'noopener');
      }

      // 5. Build rich interactive card for Jarvis bubble
      const promptEscaped = generatedPrompt
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

      const bubbleHtml = `
        <div class="prompt-master-card" style="margin-top:8px; padding:12px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14); border-radius:12px; font-family:inherit;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-weight:600; font-size:13px; color:#60a5fa; display:flex; align-items:center; gap:6px;">
              ⚡ Prompt Master ➔ ${targetName}
            </span>
            <span style="font-size:11px; padding:2px 8px; border-radius:6px; background:rgba(34,197,94,0.18); color:#4ade80; border:1px solid rgba(34,197,94,0.3);">
              ${copied ? '✓ Copied to Clipboard' : 'Ready'}
            </span>
          </div>
          <div style="font-size:12px; color:rgba(255,255,255,0.85); background:rgba(0,0,0,0.25); padding:10px; border-radius:8px; max-height:140px; overflow-y:auto; white-space:pre-wrap; line-height:1.45; border:1px solid rgba(255,255,255,0.08);">
${promptEscaped}
          </div>
          <div style="display:flex; gap:8px; margin-top:10px;">
            <button type="button" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(generatedPrompt)}')); this.textContent='✓ Copied!';" style="flex:1; padding:6px 12px; background:#2563eb; color:#fff; border:none; border-radius:6px; font-size:12px; font-weight:500; cursor:pointer;">
              📋 Copy Prompt
            </button>
            <a href="${targetUrl}" target="_blank" rel="noopener" style="flex:1; text-align:center; padding:6px 12px; background:rgba(255,255,255,0.1); color:#fff; text-decoration:none; border-radius:6px; font-size:12px; font-weight:500; border:1px solid rgba(255,255,255,0.15);">
              🚀 Open ${targetName}
            </a>
          </div>
        </div>
      `;

      const spoken = `Sir, maine page ka screenshot aur context analyze karke ${targetName} ke liye prompt compose kar diya hai aur clipboard me copy kar diya hai. ${targetName} khol diya hai — aap bas Ctrl+V dabakar bhejiye!`;

      return {
        handled: true,
        spoken,
        bubbleHtml,
        generatedPrompt,
        targetAI
      };
    } catch (err) {
      console.error('[PromptMaster] Failed:', err);
      return {
        handled: true,
        spoken: `Sir, screenshot lekar prompt banane me dikkat aayi: ${err?.message || 'Unknown error'}.`
      };
    }
  }

  // Check if text matches the Prompt Master pattern
  function isPromptMasterIntent(text) {
    const t = String(text || '').toLowerCase();
    const hasScreenshot = /\b(screenshot|screen shot|screen|page ka)\b/.test(t);
    const hasTargetAI = /\b(chatgpt|claude|gemini|bard|perplexity)\b/.test(t);
    const hasPromptOrAction = /\b(prompt|likh|daalo|daal do|bhejo|bhej do|khol|banao|craft)\b/.test(t);

    return (hasScreenshot && hasTargetAI) || (hasTargetAI && hasPromptOrAction) || (hasScreenshot && /\bprompt\b/.test(t));
  }

  window.ClavisPromptMaster = {
    execute: handlePromptMasterCommand,
    isMatch: isPromptMasterIntent,
    parseTargetAI
  };
})();
