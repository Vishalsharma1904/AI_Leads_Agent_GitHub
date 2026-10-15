/* OpenWA: apna WhatsApp number QR se link karke leads ko auto-message.
   Calls serve-clavis.js se jaati hain (/openwa-api -> localhost:2785/api); API key server par rehti hai. */
'use strict';
window.OpenWA = (() => {
  const NAME = 'rudra24';
  const $ = id => document.getElementById(`wa-openwa-${id}`);
  const W = () => window.WhatsAppCtrl;
  const BUSY = ['initializing', 'qr_ready', 'authenticating'];
  const LABEL = {
    created: 'Number link nahi hai. "Connect number" dabaiye.',
    initializing: 'WhatsApp start ho raha hai… (30–60 sec)',
    qr_ready: 'Phone me WhatsApp → Settings → Linked devices → Link a device, phir yeh QR scan kariye.',
    authenticating: 'Scan ho gaya, login ho raha hai…',
    disconnected: 'Number disconnect hai. "Connect number" dabaiye.',
    action_required: 'WhatsApp me action chahiye — OpenWA dashboard dekhiye.',
    failed: 'Session fail hua. "Connect number" dobara dabaiye.',
  };
  let session = null, poll = null, running = false, wake = null;

  async function api(path, method = 'GET', body) {
    const r = await fetch(`/openwa-api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await r.json().catch(() => ({}));
    if (r.ok) return data;
    const msg = data.detail || (Array.isArray(data.message) ? data.message.join(', ') : data.message);
    throw new Error(msg || (r.status === 404 ? 'OpenWA yahan available nahi — desktop app me Start-OpenWA.bat chalaiye.' : `OpenWA error ${r.status}`));
  }

  function counts() {
    const q = W()?.queue || [];
    $('count').textContent = q.length;
    $('preview').textContent = q[0] ? W().renderMessage(q[0]) : '';
  }

  function render(error) {
    const ready = session?.status === 'ready';
    $('status').textContent = error || (ready
      ? `Connected: +${session.phone || ''}${session.pushName ? ' · ' + session.pushName : ''}`
      : (LABEL[session?.status] || session?.status || LABEL.created) + (session?.lastError ? ` (${String(session.lastError).split('\n')[0]})` : ''));
    $('connect').hidden = ready || Boolean(error) || BUSY.includes(session?.status);
    $('logout').hidden = !ready;
    $('send').disabled = !ready || running || !$('consent').checked;
    $('stop').hidden = !running;
    counts();
  }

  async function refresh() {
    clearTimeout(poll);
    try { [session] = await api(`sessions?name=${NAME}`); }
    catch (e) { session = null; $('qr').hidden = true; return render(e.message); }
    render();
    if (session?.status === 'qr_ready') {
      try { $('qr').src = (await api(`sessions/${session.id}/qr`)).qrCode; $('qr').hidden = false; } catch (_) {}
    } else $('qr').hidden = true;
    if (BUSY.includes(session?.status)) poll = setTimeout(refresh, 3000);
  }

  async function connect() {
    $('connect').disabled = true;
    try {
      if (!session) session = await api('sessions', 'POST', { name: NAME });
      await api(`sessions/${session.id}/start`, 'POST');
    } catch (e) { window.showToast?.('warning', 'OpenWA', e.message); }
    $('connect').disabled = false;
    refresh();
  }

  async function logout() {
    if (!session || !confirm('Is PC se WhatsApp number unlink karein?')) return;
    try { await api(`sessions/${session.id}/logout`, 'POST'); } catch (e) { window.showToast?.('warning', 'OpenWA', e.message); }
    refresh();
  }

  const sleep = ms => new Promise(r => { wake = r; setTimeout(r, ms); });

  async function start() {
    if (running || session?.status !== 'ready') return;
    W()?.refreshQueue?.();
    const size = Math.max(1, Math.min(50, Number($('size').value) || 10));
    const batch = (W()?.queue || []).slice(0, size);
    if (!batch.length) return window.showToast?.('warning', 'Leads nahi mile', 'Phone number wale naye (abhi tak message nahi kiye) leads chahiye.');
    if (!$('body').value.trim()) return window.showToast?.('warning', 'Message khali hai', 'Pehle message likhiye.');
    running = true; render();
    let sent = 0, skipped = 0;
    for (let i = 0; i < batch.length && running; i++) {
      const lead = batch[i];
      const digits = String(lead.phone || '').replace(/\D/g, '');
      const number = digits.length === 10 ? `91${digits}` : digits;
      $('progress').textContent = `${i + 1}/${batch.length}: ${lead.company || lead.name || number} ko bhej rahe hain…`;
      let wait = 3000;
      try {
        const check = await api(`sessions/${session.id}/contacts/check/${number}`);
        if (!check.exists) { skipped++; continue; }
        await api(`sessions/${session.id}/messages/send-text`, 'POST', { chatId: check.whatsappId, text: W().renderMessage(lead) });
        sent++;
        await W().markSent(lead, 'openwa');
        wait = 25000 + Math.random() * 35000; // ponytail: fixed random gap; per-hour cap if numbers start getting flagged
      } catch (e) {
        skipped++;
        window.showToast?.('warning', 'Message nahi gaya', `${lead.company || number}: ${e.message}`);
        await refresh();
        if (session?.status !== 'ready') break;
      } finally {
        if (running && i < batch.length - 1) {
          $('progress').textContent = `${sent} bheje, ${skipped} skip · agla message ${Math.round(wait / 1000)} sec me…`;
          await sleep(wait);
        }
      }
    }
    running = false;
    $('progress').textContent = `Batch khatam: ${sent} bheje, ${skipped} skip (WhatsApp par nahi / error).`;
    window.CRMBridge?.notifyLeads?.();
    W()?.refreshQueue?.();
    render();
  }

  function stop() { running = false; wake?.(); render(); }

  function init() {
    if (!$('status')) return;
    const main = document.getElementById('whatsapp-body');
    $('body').value = main?.value || '';
    $('body').addEventListener('input', () => {
      if (main) { main.value = $('body').value; main.dispatchEvent(new Event('input')); }
      counts();
    });
    $('consent').addEventListener('change', () => render());
    $('connect').addEventListener('click', connect);
    $('refresh').addEventListener('click', refresh);
    $('logout').addEventListener('click', logout);
    $('send').addEventListener('click', start);
    $('stop').addEventListener('click', stop);
    document.addEventListener('nexus:leadsupdated', counts);
    window.addEventListener('hashchange', () => { if (location.hash === '#whatsapp') refresh(); });
    refresh();
  }

  document.addEventListener('DOMContentLoaded', init);
  return { refresh };
})();
