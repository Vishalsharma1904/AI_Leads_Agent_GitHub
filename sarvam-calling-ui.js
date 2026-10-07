/**
 * ============================================================
 *  SARVAM CALLING — UI (sarvam-calling-ui.js)
 *
 *  Teen column: left = queue + call threads, center = call ki chat
 *  (customer right, agent left), right = batch control + preview,
 *  ya khuli call ka outcome / meeting / email draft.
 *
 *  Look clavis-claude.css ke --cc-* tokens se aata hai, icons Feather.
 *  Engine sarvam-calling.js me hai — yeh file sirf dikhati hai.
 *
 *  API: window.SarvamCallingUI, window.sendLeadsToCallingAgent(leads)
 * ============================================================
 */
'use strict';

(() => {
  if (window.SarvamCallingUI) return;
  const S = () => window.SarvamCalling;

  const ui = { tab: 'queue', openThreadId: null, threads: [], queue: [], running: false, mounted: false };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const $ = (sel, root) => (root || document).querySelector(sel);
  const icon = (n) => `<i data-fi="${n}" aria-hidden="true"></i>`;
  const root = () => document.getElementById('view-calling');

  function toast(type, title, msg) {
    try { window.showToast?.(type, title, msg); }
    catch (_) { console.log(`[calling] ${title}: ${msg || ''}`); }
  }

  const TONE = {
    pending: 'wait', dialing: 'live', ringing: 'live', connected: 'live',
    done: 'good', no_answer: 'dim', busy: 'dim', failed: 'bad', skipped: 'dim',
  };
  const OUTCOME_LABEL = {
    interested: 'Interested', meeting_booked: 'Meeting fix', callback: 'Callback maanga',
    not_interested: 'Interested nahi', wrong_number: 'Galat number', no_decision: 'Decision nahi',
  };

  const mins = (sec) => {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const when = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const today = new Date().toDateString() === d.toDateString();
    return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { day: '2-digit', month: 'short' });
  };

  /* ── shell ───────────────────────────────────────────────── */

  function shell() {
    return `
    <div class="view-header">
      <div>
        <h1 class="view-title">Voice Calling Setup</h1>
        <div class="view-subtitle">Sarvam AI aapke leads ko ek-ek karke call karta hai. Awaaz phone par jaati hai — app me nahi.</div>
      </div>
      <div class="view-header-actions">
        <button class="sc-btn" type="button" onclick="SarvamCallingUI.openSetup()">${icon('sliders')} Agent setup</button>
        <button class="sc-btn sc-btn-primary" type="button" onclick="SarvamCallingUI.pullLeads()">${icon('download')} Leads laao</button>
      </div>
    </div>
    <div class="sc-banner" id="sc-banner" hidden></div>
    <div class="sc-grid">
      <aside class="sc-rail" aria-label="Queue and calls">
        <div class="sc-tabs" role="tablist">
          <button class="sc-tab" data-tab="queue" role="tab" onclick="SarvamCallingUI.setTab('queue')">Queue <span class="sc-count" id="sc-queue-count">0</span></button>
          <button class="sc-tab" data-tab="calls" role="tab" onclick="SarvamCallingUI.setTab('calls')">Calls <span class="sc-count" id="sc-calls-count">0</span></button>
        </div>
        <div class="sc-rail-body" id="sc-rail-body"></div>
      </aside>
      <section class="sc-main" id="sc-main" aria-live="polite"></section>
      <aside class="sc-side" id="sc-side" aria-label="Call controls"></aside>
    </div>
    <div class="sc-sheet" id="sc-setup" hidden role="dialog" aria-modal="true" aria-label="Calling agent setup">
      <div class="sc-sheet-scrim" onclick="SarvamCallingUI.closeSetup()"></div>
      <div class="sc-sheet-panel" id="sc-setup-panel"></div>
    </div>`;
  }

  function mount() {
    const el = root();
    if (!el || ui.mounted) return;
    el.innerHTML = shell();
    ui.mounted = true;
    refreshIcons();
    reloadThreads();
    renderAll();
  }

  function refreshIcons() {
    try { window.ClavisIcons?.apply?.(root()); } catch (_) {}
  }

  /* ── render: rail ────────────────────────────────────────── */

  function renderRail() {
    const body = $('#sc-rail-body');
    if (!body) return;
    const qc = $('#sc-queue-count'); if (qc) qc.textContent = String(ui.queue.length);
    const cc = $('#sc-calls-count'); if (cc) cc.textContent = String(ui.threads.length);
    root().querySelectorAll('.sc-tab').forEach((t) => {
      t.classList.toggle('is-on', t.dataset.tab === ui.tab);
      t.setAttribute('aria-selected', String(t.dataset.tab === ui.tab));
    });

    body.innerHTML = ui.tab === 'queue' ? queueList() : callsList();
    refreshIcons();
  }

  function queueList() {
    if (!ui.queue.length) {
      return `<div class="sc-empty">${icon('list')}<p>Queue khaali hai.</p>
        <p class="sc-dim">Leads page se "Send to Voice Calling" dabaiye, ya Rudra24 AI se boliye "leads calling agent ko de do".</p></div>`;
    }
    return ui.queue.map((i) => `
      <div class="sc-row ${i.status !== 'pending' ? 'is-' + (TONE[i.status] || 'dim') : ''}">
        <div class="sc-row-main">
          <div class="sc-row-title">${esc(i.lead.company || i.lead.name || 'Unknown')}</div>
          <div class="sc-row-sub">${esc(i.lead.phone)}${i.lead.city ? ' · ' + esc(i.lead.city) : ''}</div>
          ${i.error ? `<div class="sc-row-err">${esc(i.error)}</div>` : ''}
        </div>
        <div class="sc-row-right">
          <span class="sc-chip sc-chip-${TONE[i.status] || 'dim'}">${esc(i.statusLabel || i.status)}</span>
          ${i.status === 'pending' && !ui.running
            ? `<button class="sc-icon-btn" title="Hatao" onclick="SarvamCallingUI.drop('${esc(i.id)}')">${icon('x')}</button>` : ''}
        </div>
      </div>`).join('');
  }

  function callsList() {
    if (!ui.threads.length) {
      return `<div class="sc-empty">${icon('phone')}<p>Abhi koi call nahi hui.</p>
        <p class="sc-dim">Har call yahan apni alag chat banati hai.</p></div>`;
    }
    return ui.threads.map((t) => `
      <button class="sc-row sc-row-btn ${t.id === ui.openThreadId ? 'is-open' : ''}" onclick="SarvamCallingUI.open('${esc(t.id)}')">
        <div class="sc-row-main">
          <div class="sc-row-title">${esc(t.company)}</div>
          <div class="sc-row-sub">${esc(t.phone)} · ${when(t.startedAt)}${t.durationSec ? ' · ' + mins(t.durationSec) : ''}</div>
        </div>
        <div class="sc-row-right">
          <span class="sc-chip sc-chip-${TONE[t.status] || 'dim'}">${esc(S().STATUS[t.status] || t.status)}</span>
          ${t.outcome ? `<span class="sc-tag">${esc(OUTCOME_LABEL[t.outcome] || t.outcome)}</span>` : ''}
        </div>
      </button>`).join('');
  }

  /* ── render: center (chat) ───────────────────────────────── */

  function renderMain() {
    const main = $('#sc-main');
    if (!main) return;
    const t = ui.threads.find((x) => x.id === ui.openThreadId);
    main.innerHTML = t ? threadView(t) : mainEmpty();
    refreshIcons();
    const log = $('#sc-log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  function mainEmpty() {
    const live = ui.queue.find((i) => ['dialing', 'ringing', 'connected'].includes(i.status));
    if (live) {
      return `<div class="sc-stage">
        <div class="sc-pulse">${icon('phone-call')}</div>
        <h2>${esc(live.lead.company || live.lead.name)}</h2>
        <p class="sc-dim">${esc(live.statusLabel)} · ${esc(live.lead.phone)}</p>
        <p class="sc-dim sc-note">Awaaz phone par ja rahi hai. Call khatam hote hi poori baat yahan text me aa jayegi.</p>
      </div>`;
    }
    return `<div class="sc-stage">
      <div class="sc-stage-icon">${icon('message-square')}</div>
      <h2>Koi call kholiye</h2>
      <p class="sc-dim">Left se kisi call par click kijiye — poori baat-cheet yahan chat ki tarah khulegi.</p>
    </div>`;
  }

  function threadView(t) {
    const live = ['dialing', 'ringing', 'connected'].includes(t.status);
    return `
      <header class="sc-thread-head">
        <div>
          <h2>${esc(t.company)}</h2>
          <div class="sc-dim">${esc(t.phone)}${t.contactName ? ' · ' + esc(t.contactName) : ''}
            ${t.durationSec ? ' · ' + mins(t.durationSec) : ''} · ${when(t.startedAt)}</div>
        </div>
        <span class="sc-chip sc-chip-${TONE[t.status] || 'dim'}">${esc(S().STATUS[t.status] || t.status)}</span>
      </header>

      ${t.recordingUrl ? `<div class="sc-player">
        ${icon('headphones')}
        <audio controls preload="none" src="${esc(t.recordingUrl)}"></audio>
        <a class="sc-link" href="${esc(t.recordingUrl)}" download target="_blank" rel="noopener">Download</a>
      </div>` : ''}

      ${t.summary ? `<div class="sc-summary">${icon('file-text')}<p>${esc(t.summary)}</p></div>` : ''}

      <div class="sc-log" id="sc-log">
        ${t.transcript?.length ? t.transcript.map(bubble).join('')
          : `<div class="sc-empty sc-empty-inline">
              ${live ? icon('loader') : icon('mic-off')}
              <p>${live ? 'Call chal rahi hai — transcript call ke baad aayega.'
                        : (t.failureReason ? esc(t.failureReason) : 'Is call ka transcript nahi mila.')}</p>
            </div>`}
      </div>`;
  }

  /* Customer right, AI left — jaisa owner ne maanga tha. */
  function bubble(m) {
    const me = m.role === 'user';
    return `<div class="sc-msg ${me ? 'sc-msg-user' : 'sc-msg-agent'}">
      <div class="sc-bubble">${esc(m.text)}</div>
      <div class="sc-who">${me ? 'Customer' : (S().getConfig().agentName || 'Agent')}</div>
    </div>`;
  }

  /* ── render: right side ──────────────────────────────────── */

  function renderSide() {
    const side = $('#sc-side');
    if (!side) return;
    const t = ui.threads.find((x) => x.id === ui.openThreadId);
    side.innerHTML = batchCard() + (t ? outcomeCard(t) + meetingCard(t) + emailCard(t) : previewCard());
    refreshIcons();
  }

  function batchCard() {
    const pending = ui.queue.filter((i) => i.status === 'pending').length;
    const cfg = S().getConfig();
    return `<div class="sc-card">
      <div class="sc-card-head">${icon('phone-outgoing')}<h3>Batch</h3></div>
      <label class="sc-field">
        <span>Kitni calls karni hain?</span>
        <input id="sc-batch-n" type="number" min="1" max="200" value="${Math.min(pending || cfg.batchSize, cfg.batchSize)}" ${ui.running ? 'disabled' : ''}>
      </label>
      <div class="sc-dim sc-small">${pending} queue me · har call ke beech ${cfg.gapSeconds}s gap</div>
      <div class="sc-card-actions">
        ${ui.running
          ? `<button class="sc-btn sc-btn-danger" onclick="SarvamCallingUI.stop()">${icon('square')} Rok do</button>`
          : `<button class="sc-btn sc-btn-primary" ${pending ? '' : 'disabled'} onclick="SarvamCallingUI.start()">${icon('play')} Calling shuru</button>`}
        ${!ui.running && ui.queue.length ? `<button class="sc-btn" onclick="SarvamCallingUI.clear()">Queue khaali</button>` : ''}
      </div>
    </div>`;
  }

  /* Owner ne yahi maanga: number, company, aur ek-do column. */
  function previewCard() {
    const rows = ui.queue.slice(0, 40);
    if (!rows.length) return '';
    return `<div class="sc-card">
      <div class="sc-card-head">${icon('users')}<h3>Preview</h3><span class="sc-count">${ui.queue.length}</span></div>
      <table class="sc-preview">
        <thead><tr><th>Number</th><th>Company</th><th>City</th></tr></thead>
        <tbody>${rows.map((i) => `<tr>
          <td class="sc-mono">${esc(i.lead.phone)}</td>
          <td>${esc(i.lead.company || i.lead.name || '—')}</td>
          <td class="sc-dim">${esc(i.lead.city || '—')}</td>
        </tr>`).join('')}</tbody>
      </table>
      ${ui.queue.length > rows.length ? `<div class="sc-dim sc-small">+${ui.queue.length - rows.length} aur</div>` : ''}
    </div>`;
  }

  function outcomeCard(t) {
    if (!t.outcome && !t.failureReason) return '';
    return `<div class="sc-card">
      <div class="sc-card-head">${icon('target')}<h3>Nateeja</h3></div>
      ${t.outcome ? `<div class="sc-outcome sc-outcome-${esc(t.outcome)}">${esc(OUTCOME_LABEL[t.outcome] || t.outcome)}</div>` : ''}
      ${t.failureReason ? `<div class="sc-dim sc-small">${esc(t.failureReason)}</div>` : ''}
    </div>`;
  }

  function meetingCard(t) {
    if (!t.meeting?.date_iso) return '';
    const link = S().calendarLink(t);
    return `<div class="sc-card">
      <div class="sc-card-head">${icon('calendar')}<h3>Meeting</h3></div>
      <div class="sc-meet">${esc(t.meeting.date_iso)} · ${esc(t.meeting.time_24h || '')}</div>
      ${t.meeting.note ? `<div class="sc-dim sc-small">${esc(t.meeting.note)}</div>` : ''}
      <div class="sc-card-actions">
        <a class="sc-btn sc-btn-primary" href="${esc(link)}" target="_blank" rel="noopener">${icon('calendar')} Google Calendar</a>
        <button class="sc-btn" onclick="SarvamCallingUI.downloadIcs('${esc(t.id)}')">${icon('download')} .ics</button>
      </div>
    </div>`;
  }

  /* Draft ready hota hai, bhejta owner khud hai — supervision. */
  function emailCard(t) {
    const d = t.emailDraft;
    if (!d) {
      return t.transcript?.length ? `<div class="sc-card">
        <div class="sc-card-head">${icon('mail')}<h3>Email</h3></div>
        <div class="sc-dim sc-small">Draft nahi bana. AI key connect hai to dobara try kijiye.</div>
        <div class="sc-card-actions"><button class="sc-btn" onclick="SarvamCallingUI.redraft('${esc(t.id)}')">${icon('refresh-cw')} Draft banao</button></div>
      </div>` : '';
    }
    return `<div class="sc-card">
      <div class="sc-card-head">${icon('mail')}<h3>Email draft</h3>${d.sentAt ? '<span class="sc-tag">Bheja</span>' : ''}</div>
      <label class="sc-field"><span>To</span>
        <input id="sc-mail-to" type="email" value="${esc(d.to)}" placeholder="unki email id"></label>
      <label class="sc-field"><span>Subject</span>
        <input id="sc-mail-sub" type="text" value="${esc(d.subject)}"></label>
      <label class="sc-field"><span>Body</span>
        <textarea id="sc-mail-body" rows="9">${esc(d.body)}</textarea></label>
      <div class="sc-dim sc-small">Aap padhkar edit kijiye — bhejne ka button aapke haath me hai.</div>
      <div class="sc-card-actions">
        <button class="sc-btn sc-btn-primary" onclick="SarvamCallingUI.openMail('${esc(t.id)}')">${icon('send')} Gmail me kholo</button>
        <button class="sc-btn" onclick="SarvamCallingUI.saveMail('${esc(t.id)}')">${icon('save')} Save</button>
        <button class="sc-btn" onclick="SarvamCallingUI.copyMail('${esc(t.id)}')">${icon('copy')} Copy</button>
      </div>
    </div>`;
  }

  /* ── setup sheet (master calling agent) ──────────────────── */

  /* Har company yahi bharkar agent ko apna bana leti hai. Isi liye
     har field ka naam config key hai — save loop ek hi jagah. */
  const FIELDS = [
    ['Sarvam connection', 'link-2', 'Ye 4 cheezein Sarvam dashboard se aati hain. "Fetch" dabaiye to zyadatar apne aap bhar jaati hain.', [
      ['orgId', 'Organisation ID', 'text', 'org_…'],
      ['workspaceId', 'Workspace ID', 'text', 'ws_…'],
      ['appId', 'Agent (app) ID', 'text', 'my-sales-agent'],
      ['appVersion', 'Agent version', 'number', '1'],
      ['connectionId', 'Connection ID', 'text', 'conn_…'],
      ['agentPhoneNumber', 'Agent ka number (caller ID)', 'tel', '+918047…'],
    ]],
    ['Aapka business', 'briefcase', 'Yahi agent ki pehchaan ban jaata hai.', [
      ['businessName', 'Company ka naam', 'text', 'Acme Facility Services'],
      ['businessWhatWeSell', 'Aap kya bechte hain', 'text', 'security guards aur housekeeping staff'],
      ['businessCity', 'Kaunse sheher / ilaake me', 'text', 'Gurugram, Delhi NCR'],
      ['businessWebsite', 'Website', 'text', 'acmefacility.in'],
      ['businessUsp', 'Aapki khaasiyat (USP)', 'textarea', 'PSARA licensed, 24x7 replacement, police verified staff'],
      ['businessPricingLine', 'Pricing ke baare me kya bole', 'text', 'rate requirement dekhkar batate hain'],
    ]],
    ['Agent ki personality', 'user', 'Call par kaun bol raha hai aur kaise.', [
      ['agentName', 'Agent ka naam', 'text', 'Priya'],
      ['agentRole', 'Agent ka role', 'text', 'Business development executive'],
      ['language', 'Language', 'select', ['hi-IN', 'en-IN', 'mr-IN', 'ta-IN', 'te-IN', 'bn-IN', 'gu-IN', 'kn-IN', 'ml-IN', 'pa-IN']],
      ['tone', 'Tone', 'text', 'warm, respectful, seedha point par'],
      ['callGoal', 'Call ka maqsad', 'select', ['meeting', 'qualify', 'pitch']],
      ['openingLine', 'Pehli line', 'textarea', 'Namaste, main {{agent_name}} bol rahi hoon…'],
      ['doNotSay', 'Yeh kabhi mat bolna', 'textarea', 'discount, guarantee, competitor ka naam'],
    ]],
    ['Script', 'help-circle', 'Har line alag rakhiye.', [
      ['qualifyingQuestions', 'Kya puchhna hai', 'textarea', 'Abhi kitne guards hain?\nContract kab renew hota hai?\nDecision kaun leta hai?'],
      ['objectionNotes', 'Objection aaye to kya kahe', 'textarea', '"Pehle se vendor hai" -> comparison quote offer karo\n"Mehenga hai" -> per-shift cost samjhao'],
    ]],
    ['Meeting', 'calendar', 'Agent inhi slots me meeting offer karega.', [
      ['meetingSlots', 'Available slots', 'text', 'Mon-Fri 11:00-17:00'],
      ['meetingDurationMin', 'Meeting kitni der', 'number', '30'],
      ['timezone', 'Timezone', 'text', 'Asia/Kolkata'],
    ]],
    ['Aap (handoff)', 'user-check', 'Meeting aur email inhi details se jaayenge.', [
      ['ownerName', 'Aapka naam', 'text', ''],
      ['ownerPhone', 'Aapka number', 'tel', ''],
      ['ownerEmail', 'Aapki email', 'email', ''],
    ]],
    ['Calling rules', 'shield', 'Compliance aur pacing. India me TRAI/DLT ke liye consent line zaroori hai.', [
      ['consentLine', 'Consent line', 'textarea', 'Yeh ek business call hai…'],
      ['callWindowStart', 'Call window shuru', 'time', '10:00'],
      ['callWindowEnd', 'Call window khatam', 'time', '19:00'],
      ['maxCallSeconds', 'Ek call max (seconds)', 'number', '300'],
      ['batchSize', 'Default batch size', 'number', '10'],
      ['gapSeconds', 'Calls ke beech gap (seconds)', 'number', '20'],
      ['recordCalls', 'Calls record karein', 'checkbox', ''],
    ]],
    ['Email', 'mail', 'Call ke baad draft isi hisaab se banta hai. Bhejte aap khud hain.', [
      ['emailTone', 'Email ka tone', 'text', 'short, polite, professional'],
      ['emailSignature', 'Signature', 'textarea', 'Regards,\nVishal\nAcme Facility Services'],
    ]],
  ];

  function fieldHtml([key, label, type, extra], cfg, missing) {
    const bad = missing.includes(key) ? ' is-missing' : '';
    const v = cfg[key];
    if (type === 'checkbox') {
      return `<label class="sc-field sc-field-check${bad}">
        <input type="checkbox" data-cfg="${key}" ${v ? 'checked' : ''}><span>${esc(label)}</span></label>`;
    }
    if (type === 'select') {
      return `<label class="sc-field${bad}"><span>${esc(label)}</span>
        <select data-cfg="${key}">${extra.map((o) =>
          `<option value="${esc(o)}" ${String(v) === String(o) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    }
    if (type === 'textarea') {
      return `<label class="sc-field sc-field-wide${bad}"><span>${esc(label)}</span>
        <textarea data-cfg="${key}" rows="4" placeholder="${esc(extra)}">${esc(v)}</textarea></label>`;
    }
    return `<label class="sc-field${bad}"><span>${esc(label)}</span>
      <input type="${type}" data-cfg="${key}" value="${esc(v)}" placeholder="${esc(extra)}"></label>`;
  }

  function setupHtml() {
    const cfg = S().getConfig();
    const missing = S().missingFields().map((m) => m.key);
    return `
      <header class="sc-sheet-head">
        <div><h2>Calling agent setup</h2>
          <div class="sc-dim">Ye settings sirf is browser me rehti hain. API key Key Vault me encrypted hai.</div></div>
        <button class="sc-icon-btn" onclick="SarvamCallingUI.closeSetup()" aria-label="Band karo">${icon('x')}</button>
      </header>
      <div class="sc-sheet-body">
        <div class="sc-card sc-card-flat">
          <div class="sc-card-head">${icon('key')}<h3>Sarvam API key</h3><span class="sc-tag" id="sc-key-state">…</span></div>
          <div class="sc-dim sc-small">Key Key Vault me jaati hai — encrypted, source code me kabhi nahi.</div>
          <div class="sc-card-actions">
            <button class="sc-btn" onclick="SarvamCallingUI.openVault()">${icon('lock')} Key Vault kholo</button>
            <a class="sc-btn" href="https://dashboard.sarvam.ai/admin" target="_blank" rel="noopener">${icon('external-link')} Sarvam dashboard</a>
            <button class="sc-btn" onclick="SarvamCallingUI.fetchDeployments()">${icon('refresh-cw')} Fetch agents</button>
          </div>
          <div id="sc-deployments"></div>
        </div>
        ${FIELDS.map(([title, ic, note, list]) => `
          <section class="sc-group">
            <div class="sc-group-head">${icon(ic)}<h3>${esc(title)}</h3></div>
            <p class="sc-dim sc-small">${esc(note)}</p>
            <div class="sc-fields">${list.map((f) => fieldHtml(f, cfg, missing)).join('')}</div>
          </section>`).join('')}
        <section class="sc-group">
          <div class="sc-group-head">${icon('file-text')}<h3>Sarvam agent prompt</h3></div>
          <p class="sc-dim sc-small">Upar ki settings se bana hua prompt. Isse copy karke Sarvam dashboard me apne agent ke instructions me paste kar dijiye — tabhi agent bilkul aapke hisaab se bolega.</p>
          <textarea id="sc-prompt" class="sc-prompt" rows="14" readonly></textarea>
          <div class="sc-card-actions">
            <button class="sc-btn" onclick="SarvamCallingUI.copyPrompt()">${icon('copy')} Copy prompt</button>
          </div>
        </section>
      </div>
      <footer class="sc-sheet-foot">
        <span class="sc-dim sc-small" id="sc-setup-note"></span>
        <div><button class="sc-btn" onclick="SarvamCallingUI.closeSetup()">Band karo</button>
        <button class="sc-btn sc-btn-primary" onclick="SarvamCallingUI.saveSetup()">${icon('check')} Save</button></div>
      </footer>`;
  }

  /* ── actions ─────────────────────────────────────────────── */

  function setTab(tab) { ui.tab = tab; renderRail(); }

  function open(id) {
    ui.openThreadId = id;
    ui.tab = 'calls';
    renderAll();
  }

  function drop(id) { S().removeFromQueue(id); }

  function clear() {
    if (!S().clearQueue()) toast('warning', 'Calling chal rahi hai', 'Pehle rok dijiye.');
  }

  async function start() {
    const n = Number($('#sc-batch-n')?.value) || S().getConfig().batchSize;
    const res = await S().start({ limit: n });
    if (res.ok) return;
    if (res.reason === 'config') {
      banner(`Setup adhoora: ${res.missing.map((m) => m.label).join(', ')}.`, 'Setup kholo', openSetup);
      openSetup();
    } else if (res.reason === 'no-key') {
      banner('Sarvam API key nahi mili.', 'Key Vault', openVault);
    } else if (res.reason === 'window') {
      banner(`Abhi call window ke bahar hain (${res.window}). Setup me badal sakte hain.`, 'Setup kholo', openSetup);
    } else if (res.reason === 'already-running') {
      toast('info', 'Pehle se chal rahi hai', '');
    }
  }

  function stop() { S().stop(); toast('info', 'Rok rahe hain', 'Jo call chal rahi hai wo poori hogi.'); }

  function banner(text, actionLabel, onClick) {
    const el = $('#sc-banner');
    if (!el) { toast('warning', text, ''); return; }
    el.hidden = false;
    el.innerHTML = `${icon('alert-circle')}<span>${esc(text)}</span>`;
    if (actionLabel) {
      const b = document.createElement('button');
      b.className = 'sc-btn sc-btn-small';
      b.textContent = actionLabel;
      b.onclick = onClick;
      el.appendChild(b);
    }
    refreshIcons();
  }

  /** Leads page se jo abhi filter me dikh rahe hain, wo utha lo. */
  function pullLeads() {
    const leads = (window.filteredLeads?.length ? window.filteredLeads : window.allLeads) || [];
    if (!leads.length) { toast('warning', 'Koi lead nahi', 'Pehle agent chalakar leads nikaliye.'); return; }
    sendLeads(leads, { silent: false });
  }

  /** Public entry — leads page ka button aur Rudra24 AI dono yahi bulate hain. */
  function sendLeads(leads, { silent = false } = {}) {
    const res = S().enqueue(leads);
    ui.tab = 'queue';
    if (!silent) {
      toast('success', `${res.added} leads calling agent ko mil gaye`,
        res.skipped ? `${res.skipped} ke paas valid number nahi tha.` : '');
    }
    goToPage();
    return res;
  }

  function goToPage() {
    try { window.showView?.('calling'); } catch (_) {}
    mount();
    renderAll();
  }

  /* Rudra24 AI leads nikaalne ke baad khud poochhta hai — blocking confirm
     nahi, ek chhota card jo bolta bhi hai. */
  function offerLeads(leads, opts = {}) {
    const all = leads || [];
    const list = all.filter((l) => S().normalizePhone(l?.phone || l?.mobile));
    if (!list.length) return false;
    document.getElementById('sc-offer')?.remove();

    const noNum = all.length - list.length;
    const line = opts.line
      || `Sir, ${list.length} leads mili hain jinke number hain. Kya main inhe calling agent ko de doon?`;
    const preview = list.slice(0, 3);
    const batch = Math.min(list.length, S().getConfig().batchSize || 10);

    const card = document.createElement('div');
    card.id = 'sc-offer';
    card.className = 'sc-offer';
    card.setAttribute('role', 'dialog');
    card.innerHTML = `
      <div class="sc-offer-body">${icon('phone-outgoing')}<p>${esc(line)}</p></div>
      <table class="sc-preview sc-offer-preview">
        <tbody>${preview.map((l) => `<tr>
          <td>${esc(l.company || l.name || '—')}</td>
          <td class="sc-mono sc-dim">${esc(S().normalizePhone(l.phone || l.mobile))}</td>
        </tr>`).join('')}</tbody>
      </table>
      <div class="sc-dim sc-small">${list.length} callable${noNum ? ` · ${noNum} ke number nahi` : ''}</div>
      <label class="sc-field sc-offer-count"><span>Ek baar me kitni calls?</span>
        <input id="sc-offer-n" type="number" min="1" max="${list.length}" value="${batch}"></label>
      <div class="sc-offer-actions">
        <button class="sc-btn" data-xls title="Excel download">${icon('download')} Excel</button>
        <button class="sc-btn" data-no>Abhi nahi</button>
        <button class="sc-btn sc-btn-primary" data-yes>Haan, de do</button>
      </div>`;
    document.body.appendChild(card);
    refreshIcons();
    try { window.ClavisIcons?.apply?.(card); } catch (_) {}
    try { window.ClavisVoice?.speak?.(line); } catch (_) {}

    const close = () => card.remove();
    card.querySelector('[data-no]').onclick = close;
    card.querySelector('[data-xls]').onclick = () => {
      try { window.RealScraper?.exportExcel?.(all, `leads-${all.length}`); }
      catch (_) { toast('error', 'Excel nahi ban paayi', ''); }
    };
    card.querySelector('[data-yes]').onclick = () => {
      const n = Number(card.querySelector('#sc-offer-n')?.value);
      if (n > 0) S().setConfig({ batchSize: Math.min(200, n) });
      close();
      sendLeads(list);
    };
    // Auto-dismiss, but not while he is typing a number into it.
    let bye = setTimeout(close, 60000);
    card.addEventListener('input', () => { clearTimeout(bye); bye = setTimeout(close, 120000); });
    return true;
  }

  /* ── setup actions ───────────────────────────────────────── */

  function openSetup() {
    mount();
    const sheet = $('#sc-setup');
    const panel = $('#sc-setup-panel');
    if (!sheet || !panel) return;
    panel.innerHTML = setupHtml();
    sheet.hidden = false;
    refreshIcons();
    refreshPrompt();
    S().hasKey().then((has) => {
      const el = $('#sc-key-state');
      if (el) { el.textContent = has ? 'Connected' : 'Missing'; el.className = 'sc-tag ' + (has ? 'sc-tag-good' : 'sc-tag-bad'); }
    });
    panel.querySelectorAll('[data-cfg]').forEach((el) => {
      el.addEventListener('input', () => { readSetup(); refreshPrompt(); }, { passive: true });
    });
  }

  function closeSetup() { const s = $('#sc-setup'); if (s) s.hidden = true; }

  function readSetup() {
    const panel = $('#sc-setup-panel');
    if (!panel) return null;
    const patch = {};
    panel.querySelectorAll('[data-cfg]').forEach((el) => {
      const k = el.dataset.cfg;
      patch[k] = el.type === 'checkbox' ? el.checked
        : el.type === 'number' ? Number(el.value) || 0
        : el.value;
    });
    return S().setConfig(patch);
  }

  function refreshPrompt() {
    const box = $('#sc-prompt');
    if (box) box.value = S().buildAgentPrompt();
  }

  function saveSetup() {
    readSetup();
    const missing = S().missingFields();
    const note = $('#sc-setup-note');
    if (note) {
      note.textContent = missing.length
        ? `Abhi bhi chahiye: ${missing.map((m) => m.label).join(', ')}`
        : 'Sab set hai.';
    }
    toast(missing.length ? 'warning' : 'success', 'Setup save ho gaya',
      missing.length ? `${missing.length} field abhi baaki hain.` : 'Calling ke liye tayyar.');
    renderAll();
  }

  function openVault() {
    try {
      if (window.ClavisKeyVaultUI?.open) return window.ClavisKeyVaultUI.open('sarvam');
      if (window.openKeyVault) return window.openKeyVault('sarvam');
    } catch (_) {}
    toast('info', 'Key Vault', 'Settings → Key Vault me "Sarvam AI" key add kijiye.');
  }

  async function fetchDeployments() {
    const box = $('#sc-deployments');
    if (box) box.innerHTML = '<div class="sc-dim sc-small">Sarvam se pooch rahe hain…</div>';
    readSetup();
    try {
      const items = await S().listDeployments();
      if (!items.length) {
        if (box) box.innerHTML = '<div class="sc-dim sc-small">Koi deployment nahi mila. Sarvam dashboard me agent deploy kijiye.</div>';
        return;
      }
      if (box) {
        box.innerHTML = `<div class="sc-deps">${items.map((d, i) => `
          <button class="sc-dep" data-i="${i}">
            <strong>${esc(d.name || d.app_id)}</strong>
            <span class="sc-dim">${esc(d.app_id)} · v${esc(d.app_version)} · ${esc((d.phone_numbers || [])[0] || 'no number')}</span>
          </button>`).join('')}</div>`;
        box.querySelectorAll('.sc-dep').forEach((b) => {
          b.onclick = () => {
            S().adoptDeployment(items[Number(b.dataset.i)]);
            openSetup();
            toast('success', 'Agent set ho gaya', 'Connection ID check kar lijiye.');
          };
        });
      }
    } catch (e) {
      if (box) box.innerHTML = `<div class="sc-row-err">${esc(e.message)}</div>`;
    }
  }

  function copyPrompt() {
    const box = $('#sc-prompt');
    if (!box) return;
    navigator.clipboard?.writeText(box.value)
      .then(() => toast('success', 'Copy ho gaya', 'Sarvam dashboard me paste kar dijiye.'))
      .catch(() => { box.select(); document.execCommand('copy'); });
  }

  /* ── thread actions ──────────────────────────────────────── */

  function threadById(id) { return ui.threads.find((t) => t.id === id); }

  function draftFromForm() {
    return {
      to: $('#sc-mail-to')?.value || '',
      subject: $('#sc-mail-sub')?.value || '',
      body: $('#sc-mail-body')?.value || '',
    };
  }

  async function saveMail(id) {
    await S().saveEmailDraft(id, draftFromForm());
    await reloadThreads();
    toast('success', 'Draft save', '');
  }

  async function openMail(id) {
    const patch = draftFromForm();
    if (!patch.to.trim()) { toast('warning', 'Email id chahiye', 'Upar "To" bhariye.'); return; }
    const t = await S().saveEmailDraft(id, { ...patch, approved: true, sentAt: Date.now() });
    await reloadThreads();
    window.open(S().mailLink(t), '_blank', 'noopener');
    renderSide();
  }

  function copyMail(id) {
    const d = draftFromForm();
    navigator.clipboard?.writeText(`${d.subject}\n\n${d.body}`)
      .then(() => toast('success', 'Copy ho gaya', ''));
  }

  async function redraft(id) {
    const t = threadById(id);
    if (!t) return;
    toast('info', 'Draft bana rahe hain', '');
    await S().summarizeThread(t);
    await reloadThreads();
    renderAll();
  }

  function downloadIcs(id) {
    const t = threadById(id);
    const ics = t && S().icsFor(t);
    if (!ics) return;
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${t.company.replace(/[^\w]+/g, '-')}-meeting.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ── state + events ──────────────────────────────────────── */

  async function reloadThreads() {
    ui.threads = await S().allThreads();
    return ui.threads;
  }

  function renderAll() {
    if (!ui.mounted) return;
    renderRail();
    renderMain();
    renderSide();
  }

  /* Sirf tab render jab kuch badla ho — clavis-claude.css ke 60fps
     rules: same-value DOM write bhi full recalc karwa deta hai. */
  let pending = false;
  function schedule() {
    if (pending || !ui.mounted) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; renderAll(); });
  }

  window.addEventListener('sarvam:queue', (e) => { ui.queue = e.detail.items || []; schedule(); });
  window.addEventListener('sarvam:run', (e) => { ui.running = Boolean(e.detail.running); schedule(); });
  window.addEventListener('sarvam:thread', async (e) => {
    const t = e.detail.thread;
    if (!t) return;
    const i = ui.threads.findIndex((x) => x.id === t.id);
    if (i >= 0) ui.threads[i] = t; else ui.threads.unshift(t);
    if (!ui.openThreadId || ui.openThreadId === t.id) ui.openThreadId = t.id;
    schedule();
  });
  window.addEventListener('sarvam:config', schedule);

  /* Rudra24 AI jab leads nikaalta hai (clavis-task-controller.js -> RealScraper)
     to woh yeh event chhodta hai. Yahi wo jagah hai jahan Rudra24 AI khud se
     poochhta hai "sir, calling agent ko de doon?" — bina poocha kuch nahi hota. */
  document.addEventListener('nexus:scrapedone', (e) => {
    const d = e.detail || {};
    if (!d.ok || !Array.isArray(d.leads) || !d.leads.length) return;
    setTimeout(() => offerLeads(d.leads), 1200);
  });

  window.addEventListener('hashchange', () => {
    if (location.hash === '#calling') { mount(); schedule(); }
  });

  /* ── Rudra24 AI skills ───────────────────────────────────────── */

  function registerSkills() {
    const K = window.JarvisSkills;
    if (!K?.register) return false;
    const reg = (name, def) => { if (!K.has?.(name)) K.register(name, def); };

    reg('send_leads_to_calling_agent', {
      description: 'Jo leads abhi nikle hain unhe voice calling agent ki queue me daal do. '
        + 'IMPORTANT: lead search ke turant baad khud se user se poochho "kya main ye leads calling agent ko de doon?" '
        + 'aur haan kehne par hi yeh chalao.',
      params: { count: 'optional: kitne top leads bhejne hain (default: sab jinke number hain)' },
      run: async ({ count }) => {
        const all = (window.filteredLeads?.length ? window.filteredLeads : window.allLeads) || [];
        const list = count ? all.slice(0, Number(count) || 10) : all;
        if (!list.length) return 'Abhi koi lead nahi hai. Pehle leads nikaalni padengi.';
        const r = sendLeads(list);
        return `${r.added} leads calling agent ki queue me daal diye${r.skipped ? `, ${r.skipped} ke number nahi the` : ''}. `
          + 'Ab "calling shuru karo" boliye.';
      },
    });

    reg('start_calling', {
      description: 'Calling agent se queue ke leads ko ek-ek karke call karwao. Awaaz phone par jaati hai, app me nahi.',
      params: { how_many: 'kitni calls karni hain, jaise 10 ya 20' },
      run: async ({ how_many }) => {
        const n = Number(how_many) || S().getConfig().batchSize;
        goToPage();
        const res = await S().start({ limit: n });
        if (res.ok) return `${res.completed} calls ho gayi. Har call ki baat Voice Calling Setup page par chat me hai.`;
        if (res.reason === 'config') { openSetup(); return `Setup adhoora hai: ${res.missing.map((m) => m.label).join(', ')}. Maine setup khol diya hai.`; }
        if (res.reason === 'no-key') { openVault(); return 'Sarvam API key nahi mili. Key Vault khol diya hai.'; }
        if (res.reason === 'window') return `Abhi call window ke bahar hain (${res.window}).`;
        return 'Calling pehle se chal rahi hai.';
      },
    });

    reg('calling_status', {
      description: 'Calling agent ka abhi ka haal: kitni calls hui, kaun interested nikla, kiski meeting lagi.',
      params: {},
      run: async () => {
        const threads = await reloadThreads();
        if (!threads.length) return 'Abhi tak koi call nahi hui.';
        const today = threads.filter((t) => Date.now() - (t.startedAt || 0) < 86400e3);
        const interested = today.filter((t) => ['interested', 'meeting_booked'].includes(t.outcome));
        const meetings = today.filter((t) => t.meeting?.date_iso);
        return `Aaj ${today.length} calls hui. ${interested.length} interested. ${meetings.length} meeting fix. `
          + (interested.length ? 'Interested: ' + interested.slice(0, 5).map((t) => t.company).join(', ') : '');
      },
    });
    return true;
  }

  /* ── boot ────────────────────────────────────────────────── */

  function boot() {
    if (!registerSkills()) setTimeout(registerSkills, 2000);
    ui.queue = S().queueSnapshot();
    if (document.getElementById('view-calling')?.classList.contains('active') || location.hash === '#calling') {
      mount();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else { boot(); }

  window.SarvamCallingUI = {
    mount, goToPage, setTab, open, drop, clear, start, stop, pullLeads,
    sendLeads, offerLeads,
    openSetup, closeSetup, saveSetup, copyPrompt, fetchDeployments, openVault,
    saveMail, openMail, copyMail, redraft, downloadIcs,
    reloadThreads, render: renderAll,
  };

  /** Leads page ka button aur baaki app isi ko bulate hain. */
  window.sendLeadsToCallingAgent = (leads) => sendLeads(leads);
  window.offerLeadsToCallingAgent = (leads, opts) => offerLeads(leads, opts);
})();

/* ============================================================
 *  VoiceProvider — which calling service this workspace uses.
 * ------------------------------------------------------------
 *  Tough Tongue and Sarvam are different products, not two skins
 *  of one. Tough Tongue builds a scenario and calls out of it;
 *  Sarvam runs an agent you deployed in Sarvam and we feed it a
 *  queue of leads. So the picker swaps the surface rather than
 *  forcing both into one form that would lie about half its
 *  fields.
 *
 *  The Sarvam half is deliberately one field. Paste the key and
 *  "Find my agents & number" reads the rest back from Sarvam —
 *  app id, version, connection, the agent's own number — and
 *  saves it against THIS company on the server. A company that
 *  pays never opens a config file.
 * ============================================================ */
window.VoiceProvider = (() => {
  'use strict';
  const LS = 'clavis_voice_provider';
  const $ = (id) => document.getElementById(id);

  const backend = () =>
    (location.port === '8000' ? '' : (window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, ''));
  const token = () => { try { return window.SupabaseAuth?.getAccessToken?.() || ''; } catch (_) { return ''; } };

  async function api(path, opts = {}) {
    const t = token();
    if (!t) throw new Error('Sign in first — Sarvam keys are stored per company on the server.');
    const res = await fetch(backend() + path, {
      method: opts.method || 'GET',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : null,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // The server answers with {code, message, console} for credential
      // problems. Throwing "Request failed (422)" threw that away, which is
      // why a rejected key never said where to get a new one.
      const d = data.detail;
      const err = new Error(
        typeof d === 'string' ? d : (d && d.message) || data.message || `Request failed (${res.status})`);
      if (d && typeof d === 'object') { err.code = d.code; err.console = d.console; }
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function say(msg, bad) {
    const el = $('vp-sarvam-status');
    if (!el) return;
    el.textContent = msg;
    el.dataset.error = String(!!bad);
  }

  function current() {
    try { return localStorage.getItem(LS) || 'toughtongue'; } catch (_) { return 'toughtongue'; }
  }

  function select(which) {
    if (!['toughtongue', 'sarvam', 'omnidimension', 'grok'].includes(which)) which = 'toughtongue';
    const sarvam = which === 'sarvam';
    const omni = which === 'omnidimension';
    const grok = which === 'grok';
    if (!grok) window.GrokStudio?.stop?.();
    if (!omni) window.OmniStudio?.stop?.();
    try { localStorage.setItem(LS, which); } catch (_) {}
    const picker = $('vp-provider');
    if (picker) picker.value = which;

    const panel = $('vp-sarvam');
    if (panel) panel.hidden = !sarvam;
    const omniPanel = $('vp-omnidimension');
    if (omniPanel) omniPanel.hidden = !omni;
    if ($('vp-grok')) $('vp-grok').hidden = !grok;
    // The Tough Tongue surface and its header buttons step aside together.
    const tt = document.querySelector('#view-voice-ai .tt-grid');
    if (tt) tt.hidden = sarvam || omni || grok;
    const ttStatus = document.querySelector('#view-voice-ai #tt-status');
    if (ttStatus) ttStatus.hidden = sarvam || omni || grok;
    document.querySelectorAll('#view-voice-ai [data-vp-tt]').forEach((b) => { b.hidden = sarvam || omni || grok; });
    const label = document.querySelector('#view-voice-ai [data-voice-ai-status]');
    if (label) label.textContent = grok ? 'Grok · xAI' : omni ? 'OmniDimension' : sarvam ? 'Sarvam AI' : 'Tough Tongue AI';

    if (sarvam) { refresh(); loadPlan(); }
    if (omni) window.OmniStudio?.refresh?.();
    if (grok) window.GrokStudio?.refresh?.();
    return which;
  }

  /** What the server already knows about this company's Sarvam setup. */
  async function refresh() {
    if (!token()) { say('Sign in to connect Sarvam for your company.', true); return null; }
    let st;
    try { st = await api('/api/v1/sarvam/status'); }
    catch (e) { say(e.message, true); return null; }
    if ($('vp-sarvam-org') && st.settings) $('vp-sarvam-org').value = st.settings.org_id || '';
    if ($('vp-sarvam-ws') && st.settings) $('vp-sarvam-ws').value = st.settings.workspace_id || '';
    if (!st.connected) say('No Sarvam key yet — paste one above.');
    else if (st.ready) say(`Ready. Calls will go out from ${st.settings.agent_phone_number}.`);
    else say('Key connected. Still needed: ' + st.missing.join(', '));
    return st;
  }

  async function connectSarvam() {
    const key = String($('vp-sarvam-key')?.value || '').trim();
    if (!key) { say('Paste your Sarvam subscription key first.', true); return; }
    say('Checking the key with Sarvam…');
    try {
      const res = await api('/api/credentials', { method: 'PUT', body: { provider: 'sarvam', secret: key } });
      if ($('vp-sarvam-key')) $('vp-sarvam-key').value = '';
      await saveIds();
      // Saved and proved, or saved and not proved — both are progress, and the
      // difference is worth telling the truth about.
      say(res && res.verified
        ? 'Sarvam accepted the key. Now press "Find my agents & number".'
        : ((res && res.note ? res.note + ' ' : 'Key saved. ') + 'Press "Find my agents & number" to try it for real.'));
    } catch (e) {
      say(e.message + (e.console ? ' Get a fresh key: ' + e.console : ''), true);
    }
  }

  async function saveIds() {
    const org = String($('vp-sarvam-org')?.value || '').trim();
    const ws = String($('vp-sarvam-ws')?.value || '').trim();
    if (!org && !ws) return null;
    return api('/api/v1/sarvam/settings', { method: 'PUT', body: { org_id: org, workspace_id: ws } });
  }

  /** Read the tenant's own deployments back from Sarvam and offer them. */
  async function discover() {
    const box = $('vp-sarvam-deployments');
    if (box) box.innerHTML = '';
    say('Asking Sarvam what you have deployed…');
    try {
      await saveIds();
      const { items } = await api('/api/v1/sarvam/deployments');
      if (!items.length) {
        say('Sarvam returned no deployments. Deploy an agent and rent a number in Sarvam first, then press this again.', true);
        return;
      }
      say(`Found ${items.length} deployed agent${items.length > 1 ? 's' : ''}. Pick the one to call with.`);
      if (!box) return;
      box.innerHTML = items.map((d, i) => {
        const phone = (Array.isArray(d.phone_numbers) ? d.phone_numbers[0] : d.phone_number) || '—';
        const name = d.name || d.app_name || d.app_id || 'Agent';
        return `<button type="button" class="vp-dep" data-i="${i}">
            <strong>${esc(name)}</strong>
            <span>v${esc(String(d.app_version ?? 1))} · ${esc(phone)}</span>
          </button>`;
      }).join('');
      box.querySelectorAll('.vp-dep').forEach((btn) => {
        btn.addEventListener('click', () => adopt(items[Number(btn.dataset.i)]));
      });
    } catch (e) { say(e.message, true); }
  }

  async function adopt(dep) {
    say('Saving that agent for your company…');
    try {
      const out = await api('/api/v1/sarvam/adopt', { method: 'POST', body: dep });
      // Keep the calling page's own config in step, so it is ready immediately.
      try {
        window.SarvamCalling?.setConfig?.({
          orgId: out.settings.org_id, workspaceId: out.settings.workspace_id,
          appId: out.settings.app_id, appVersion: out.settings.app_version,
          connectionId: out.settings.connection_id,
          agentPhoneNumber: out.settings.agent_phone_number,
        });
      } catch (_) {}
      if (out.missing.length) say('Saved. Still needed: ' + out.missing.join(', '), true);
      else say(`Ready. Calls will go out from ${out.settings.agent_phone_number}. Open Voice Calling Setup to load leads.`);
    } catch (e) { say(e.message, true); }
  }

  function esc(v) {
    return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── plan + checkout ───────────────────────────────────────
     Razorpay because the customers are Indian companies: UPI, INR and
     GST out of the box. The browser never decides what was paid for —
     it opens checkout and hands the signed result back; the server
     recomputes the signature and reads the plan from Razorpay's own
     order notes.                                                     */

  let razorpayLoading = null;
  function razorpay() {
    if (window.Razorpay) return Promise.resolve(window.Razorpay);
    if (razorpayLoading) return razorpayLoading;
    razorpayLoading = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'https://checkout.razorpay.com/v1/checkout.js';
      sc.onload = () => resolve(window.Razorpay);
      sc.onerror = () => reject(new Error('Razorpay checkout load nahi hua — internet check kijiye.'));
      document.head.appendChild(sc);
    });
    return razorpayLoading;
  }

  function planLine(msg, bad) {
    const el = $('vp-plan-line');
    if (!el) return;
    el.textContent = msg;
    el.dataset.error = String(!!bad);
  }

  async function loadPlan() {
    if (!$('vp-plan-line')) return null;
    if (!token()) { planLine('Sign in to see your plan.'); return null; }
    let st;
    try { st = await api('/api/v1/billing/status'); }
    catch (e) { planLine(e.message, true); return null; }

    const used = st.calls_used || 0;
    const quota = st.call_quota || 0;
    planLine(st.active
      ? `${st.plan_label} · ${st.calls_left} of ${quota} calls left this month.`
      : `Free trial · ${st.calls_left} of ${quota} calls left. Pick a plan to keep calling.`);

    const meter = $('vp-plan-meter');
    if (meter) {
      meter.hidden = !quota;
      const bar = meter.firstElementChild;
      if (bar) bar.style.width = Math.min(100, Math.round((used / Math.max(1, quota)) * 100)) + '%';
      meter.dataset.low = String(st.calls_left <= Math.max(1, Math.round(quota * 0.1)));
    }

    const box = $('vp-plans');
    if (box) {
      if (!st.payments_ready) {
        box.innerHTML = '<p class="vp-hint">Payments are not switched on for this server yet ' +
          '(RAZORPAY_KEY_ID missing in backend/.env).</p>';
      } else {
        try {
          const { plans } = await api('/api/v1/billing/plans');
          box.innerHTML = plans.map((p) => `<button type="button" class="vp-dep" data-plan="${esc(p.id)}">
              <strong>${esc(p.label)} — ₹${esc(String(p.price_inr))}/month</strong>
              <span>${esc(String(p.call_quota))} calls${st.plan === p.id ? ' · current plan' : ''}</span>
            </button>`).join('');
          box.querySelectorAll('[data-plan]').forEach((b) =>
            b.addEventListener('click', () => buy(b.dataset.plan)));
        } catch (e) { box.innerHTML = ''; planLine(e.message, true); }
      }
    }
    return st;
  }

  async function buy(plan) {
    planLine('Opening checkout…');
    let order, Checkout;
    try {
      [order, Checkout] = await Promise.all([
        api('/api/v1/billing/order', { method: 'POST', body: { plan } }),
        razorpay(),
      ]);
    } catch (e) { planLine(e.message, true); return; }

    const rz = new Checkout({
      key: order.key_id,
      order_id: order.order_id,
      amount: order.amount,
      currency: order.currency,
      name: 'Rudra24 AI',
      description: `${order.plan_label} plan`,
      handler: async (resp) => {
        planLine('Payment ho gayi — activate kar raha hoon…');
        try {
          await api('/api/v1/billing/verify', { method: 'POST', body: {
            razorpay_order_id: resp.razorpay_order_id,
            razorpay_payment_id: resp.razorpay_payment_id,
            razorpay_signature: resp.razorpay_signature,
          } });
          await loadPlan();
        } catch (e) {
          // The webhook is the backstop: it activates even if this call failed.
          planLine(e.message + ' — payment mil gayi hai, plan ek minute me active ho jayega.', true);
        }
      },
      modal: { ondismiss: () => loadPlan() },
      theme: { color: '#5a6b2f' },
    });
    rz.on('payment.failed', (e) => planLine(e?.error?.description || 'Payment fail ho gayi.', true));
    rz.open();
  }

  function boot() { if ($('vp-provider')) select(current()); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  return { select, current, refresh, connectSarvam, discover, saveIds, loadPlan, buy };
})();
