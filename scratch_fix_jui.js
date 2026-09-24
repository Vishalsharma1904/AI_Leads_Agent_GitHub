const fs = require('fs');
let jui = fs.readFileSync('jarvis_ui.js', 'utf8');

const targetSnippet = 'let wakeResultIndex = -1;\r\n    window.ClavisBargeIn?.disarm?.();';
const targetSnippetLF = 'let wakeResultIndex = -1;\n    window.ClavisBargeIn?.disarm?.();';

const replacement = `let wakeResultIndex = -1;
let clavisFinalTranscript = '';

function getClavisWakeWords() {
  try {
    const saved = JSON.parse(localStorage.getItem('clavis_wake_words') || 'null');
    if (Array.isArray(saved) && saved.length) return saved.map(String).map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 8);
  } catch (_) {}
  return ['clavis', 'hey clavis', 'hey buddy', 'hi pal'];
}

function clavisWakeMatch(text) {
  const normalized = String(text || '').toLowerCase().replace(/[^\\p{L}\\p{N}\\s]/gu, ' ').replace(/\\s+/g, ' ').trim();
  const phrase = getClavisWakeWords().sort((a, b) => b.length - a.length).find(word => normalized.includes(word));
  return phrase ? { phrase, remainder: normalized.slice(normalized.indexOf(phrase) + phrase.length).trim() } : null;
}

function clavisCommitCommand(text) {
  return String(text || '').replace(/\\b(go for it|that's it|thats it|backseat|done|over)\\.?\\s*$/i, '').trim();
}

function initClavisSoundTriggers() {
  if (clavisSoundTriggerBound || !window.ClavisAudioTrigger) return;
  clavisSoundTriggerBound = true;
  window.ClavisAudioTrigger.addEventListener('trigger', (event) => {
    const kind = event.detail?.kind === 'snap' ? 'Snap' : 'Clap';
    if (window.ClavisCognition && !window.ClavisCognition.admitSignal(kind.toLowerCase(), event.detail?.confidence)) return;
    const detectorStopped = stopClavisSoundTriggers();
    try { window.speechSynthesis?.cancel(); } catch (_) {}
    if (currentPlayingAudio) { try { currentPlayingAudio.pause(); } catch (_) {} currentPlayingAudio = null; }
    window.ClavisBargeIn?.disarm?.();`;

if (jui.includes(targetSnippet)) {
  jui = jui.replace(targetSnippet, replacement);
  fs.writeFileSync('jarvis_ui.js', jui, 'utf8');
  console.log('Restored using CRLF');
} else if (jui.includes(targetSnippetLF)) {
  jui = jui.replace(targetSnippetLF, replacement);
  fs.writeFileSync('jarvis_ui.js', jui, 'utf8');
  console.log('Restored using LF');
} else {
  console.error('Neither CRLF nor LF target matched!');
}
