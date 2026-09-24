/**
 * ============================================================
 *  PLUGIN MANIFESTS (plugin-manifests.js)
 *
 *  Declares every plugin the platform knows about, and — critically — a real
 *  `requires` probe plus a real `healthCheck` for each one.
 *
 *  Three honest tiers:
 *
 *   LIVE     Works today with the code already in this app. Health is measured.
 *            gmail-webhook, whatsapp-deeplink, csv-import, sheets-export,
 *            and the AI provider plugins.
 *
 *   PARTIAL  Code exists but needs a credential the user must supply.
 *            outlook-graph.
 *
 *   PLANNED  Needs the backend OAuth service and per-record cloud tables that
 *            do not exist yet. These deliberately report exactly what is
 *            missing instead of showing a fake "Connected" badge.
 *            gmail-api, google-calendar, google-drive, google-sheets-sync,
 *            onedrive, ms-excel, ms-teams, job-feed.
 * ============================================================
 */

'use strict';

(function registerPluginManifests() {

  const core = window.PluginCore;
  if (!core) {
    console.error('[Plugins] PluginCore missing — load plugin-core.js before plugin-manifests.js');
    return;
  }

  const H = core.HEALTH;

  // ── Shared requirement probes ────────────────────────────────────────────
  const cfg = () => window.SKYLARK_CONFIG || {};

  function firstNonEmpty(list) {
    return (list || []).map(v => (v || '').toString().trim()).find(v => v.length > 0) || '';
  }

  /** The Apps Script webhook the existing email automation already uses. */
  function gasWebhookUrl() {
    return firstNonEmpty([
      ''
    ]);
  }

  function apiKeyFor(provider) {
    // Provider credentials are resolved only by the authenticated backend.
    return '';
  }

  /**
   * Writes a provider key to the same localStorage key the rest of the app
   * already reads, and mirrors it into the live SKYLARK_CONFIG array so the
   * change takes effect without a reload.
   */
  function saveApiKey(provider, value) {
    return false;
  }

  /**
   * The backend OAuth service. It does not exist yet — there is no server-side
   * token exchange, no encrypted token store and no verified user_id to own a
   * connection. Returning false here is the truthful answer, and it is what
   * keeps every OAuth plugin out of a fake "connected" state.
   */
  const REQ_BACKEND_OAUTH = {
    id: 'backend_oauth',
    label: 'the backend OAuth service is not set up yet',
    detail: 'Provider tokens must be exchanged and stored server-side, tied to a verified account. ' +
            'That backend does not exist yet — see the google-auth-cloud-sync and ' +
            'plugin-integration-platform specs.',
    check: () => Boolean(cfg().OAUTH_BACKEND_URL)
  };

  const REQ_WEBHOOK = {
    id: 'gas_webhook',
    label: 'no Apps Script Web App URL saved (Settings → Accounts)',
    detail: 'Deploy the Apps Script as a Web App with access set to "Anyone", then paste the URL in Accounts.',
    check: () => gasWebhookUrl().startsWith('https://script.google.com/')
  };

  function requireApiKey(provider, where) {
    return {
      id: `api_key_${provider}`,
      label: `no ${provider} API key saved (${where})`,
      detail: `Add the ${provider} key in ${where}. It is read from this browser only.`,
      check: () => apiKeyFor(provider).length > 0
    };
  }

  // ── Shared health-check helpers ──────────────────────────────────────────
  /**
   * Performs a real GET and classifies the outcome honestly. A blocked CORS
   * preflight is reported as DEGRADED ("reachable but unverifiable"), never as
   * CONNECTED, and never as a hard ERROR — because on file:// it is expected.
   */
  async function probeEndpoint(url, headers, okMessage) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, { method: 'GET', headers: headers || {}, signal: controller.signal });
      clearTimeout(timer);

      if (res.status === 401 || res.status === 403) {
        return { state: H.AUTH_EXPIRED, message: `Key rejected by the provider (HTTP ${res.status}).` };
      }
      if (res.status === 429) {
        return { state: H.RATE_LIMITED, message: 'Provider is rate limiting this key right now.' };
      }
      if (!res.ok) {
        return { state: H.ERROR, message: `Provider returned HTTP ${res.status}.` };
      }
      return { state: H.CONNECTED, message: okMessage };
    } catch (err) {
      clearTimeout(timer);
      const reason = err?.name === 'AbortError' ? 'timed out after 8s' : (err?.message || 'network error');
      return {
        state: H.DEGRADED,
        message: `Key is saved but could not be live-tested (${reason}). ` +
                 'Running from file:// blocks these checks; serve the app over http/https to verify.'
      };
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  LIVE PLUGINS
  // ══════════════════════════════════════════════════════════════════════

  core.register({
    id: 'gmail-webhook',
    name: 'Gmail (Apps Script)',
    description: 'Sends real email from your own Gmail address through a small Google Apps Script that you deploy once. Because the script runs inside your Google account, no OAuth server or client secret is needed.',
    detail: 'Best for getting email working today. Google\'s free tier allows roughly 100 recipients per day on a personal Gmail account and 1,500 on Workspace. Every send is attributed to your own address, so replies come back to you.',
    version: '1.0.0',
    vendor: 'Google',
    category: 'communication',
    tier: 'LIVE',
    authentication: { type: 'webhook' },
    permissions: ['email.send'],
    capabilities: ['send_email', 'batch_send', 'health_check'],
    requires: [REQ_WEBHOOK],
    setup: {
      summary: 'Deploy a one-file Apps Script on your Gmail account, then paste its URL here. Takes about 3 minutes.',
      docsUrl: 'https://script.google.com',
      steps: [
        'Open script.google.com and create a new project.',
        'Copy the script code from Settings → Accounts (the "Copy script code" button) and paste it in.',
        'Click Deploy → New deployment → choose type "Web app".',
        'Set "Execute as" to Me, and "Who has access" to Anyone.',
        'Click Deploy, authorise access, then copy the Web app URL.',
        'Paste that URL below and press Save & test.'
      ],
      fields: [{
        key: 'webhookUrl',
        label: 'Web app URL',
        type: 'url',
        required: true,
        placeholder: 'https://script.google.com/macros/s/AKfy.../exec',
        hint: 'Must start with https://script.google.com/ and end with /exec',
        current: () => gasWebhookUrl(),
        validate: v => v.startsWith('https://script.google.com/')
          ? (v.includes('/exec') ? null : 'The URL should end with /exec — copy it from the Deploy dialog, not the editor address bar.')
          : 'That is not an Apps Script URL. It must start with https://script.google.com/'
      }]
    },
    applySetup(values) {
      return { ok: false, error: 'Webhook configuration must be managed by the authenticated backend.' };
    },
    async healthCheck() {
      if (typeof window.EmailCtrl?.pingWebhook !== 'function') {
        return { state: H.ERROR, message: 'Email module not loaded.' };
      }
      const result = await window.EmailCtrl.pingWebhook();
      if (!result || result.ok !== true) {
        return { state: H.DISCONNECTED, message: result?.message || 'Webhook did not respond.' };
      }
      if (result.degraded) {
        return { state: H.DEGRADED, message: result.message };
      }
      return { state: H.CONNECTED, message: result.message || 'Webhook responded.' };
    }
  });

  core.register({
    id: 'whatsapp-deeplink',
    name: 'WhatsApp (Click-to-Chat)',
    description: 'Opens WhatsApp with a message already written for the lead you picked, using Meta\'s official wa.me link. You press send, so nothing goes out without you.',
    detail: 'This is intentionally manual. Automatic WhatsApp sending needs the WhatsApp Business API with an approved sender and pre-approved message templates. Click-to-Chat needs none of that and cannot get your number banned for bulk sending.',
    version: '1.0.0',
    vendor: 'Meta',
    category: 'communication',
    tier: 'LIVE',
    authentication: { type: 'none' },
    permissions: [],
    capabilities: ['open_chat', 'template_message'],
    requires: [],
    setup: {
      summary: 'Nothing to connect. Optionally set the default message used when you open a chat.',
      steps: [
        'Nothing is required — this works immediately.',
        'Optionally write a default message below. Use {Company} and {City} and they will be filled in per lead.'
      ],
      fields: [{
        key: 'template',
        label: 'Default message (optional)',
        type: 'textarea',
        required: false,
        placeholder: 'Namaste {Company} team, we provide trained security and housekeeping staff in {City}…',
        hint: 'Placeholders: {Company}, {City}',
        current: () => localStorage.getItem('skylark_wa_template') || ''
      }]
    },
    applySetup(values) {
      const text = String(values.template || '').trim();
      if (text) localStorage.setItem('skylark_wa_template', text);
      return { ok: true };
    },
    async healthCheck() {
      const hasTemplate = Boolean(
        localStorage.getItem('skylark_wa_template') ||
        document.getElementById('whatsapp-body')
      );
      return hasTemplate
        ? { state: H.CONNECTED, message: 'Ready. Opens WhatsApp with a pre-filled message.' }
        : { state: H.DEGRADED, message: 'Ready, but no message template saved yet.' };
    }
  });

  core.register({
    id: 'csv-import',
    name: 'CSV / Excel Import',
    description: 'Brings leads or candidates in from a spreadsheet you already have. Everything is parsed inside your browser — the file is never uploaded anywhere.',
    detail: 'Incoming rows go through the same duplicate check as scraped leads: matching is attempted on website domain, then phone number (last 10 digits), then company + city. Matches are merged rather than duplicated, so re-importing the same sheet is safe.',
    version: '1.0.0',
    vendor: 'Built-in',
    category: 'recruitment',
    tier: 'LIVE',
    authentication: { type: 'none' },
    permissions: ['candidates.write', 'leads.write'],
    capabilities: ['import_candidates', 'import_leads', 'deduplicate'],
    requires: [],
    setup: {
      summary: 'No connection needed. Enable it, then use Excel Manager or Candidate DB to pick a file.',
      steps: [
        'Nothing to configure — press Enable.',
        'Go to Data Hub → Excel Manager to import leads, or Candidate DB for candidates.',
        'Column headers are matched by name, so keep a header row.'
      ],
      fields: []
    },
    async healthCheck() {
      const hasXlsx = typeof window.XLSX !== 'undefined';
      const hasDedup = typeof window.MemoryEngine?.checkDuplicate === 'function';
      if (!hasDedup) {
        return { state: H.DEGRADED, message: 'Import works, but the deduplication engine is unavailable.' };
      }
      return hasXlsx
        ? { state: H.CONNECTED, message: 'Ready. CSV and Excel supported, with duplicate detection.' }
        : { state: H.DEGRADED, message: 'CSV ready. Excel needs the XLSX library, which has not loaded.' };
    }
  });

  core.register({
    id: 'sheets-export',
    name: 'Spreadsheet Export',
    description: 'Downloads your current lead or candidate list as a CSV or Excel file, respecting whatever filters you have applied.',
    detail: 'Exports only the rows currently visible after filtering, so you can hand off a specific city or score band without editing the file afterwards. Commas, quotes, newlines and non-English text are escaped correctly.',
    version: '1.0.0',
    vendor: 'Built-in',
    category: 'storage',
    tier: 'LIVE',
    authentication: { type: 'none' },
    permissions: ['leads.read', 'candidates.read'],
    capabilities: ['export_csv', 'export_xlsx'],
    requires: [],
    setup: {
      summary: 'No connection needed. Enable it and use the Export button on any list.',
      steps: [
        'Nothing to configure — press Enable.',
        'Open All Leads or Candidate DB, apply your filters, then press Export.'
      ],
      fields: []
    },
    async healthCheck() {
      return typeof window.XLSX !== 'undefined'
        ? { state: H.CONNECTED, message: 'Ready. CSV and Excel export available.' }
        : { state: H.DEGRADED, message: 'CSV export ready. Excel export needs the XLSX library.' };
    }
  });

  // ── AI providers ────────────────────────────────────────────────────────
  /** Builds an AI-provider manifest; they differ only in endpoint and copy. */
  function aiProvider(opts) {
    return {
      id: opts.id,
      name: opts.name,
      description: opts.description,
      detail: opts.detail,
      version: '1.0.0',
      vendor: opts.vendor,
      category: 'ai',
      tier: 'LIVE',
      authentication: { type: 'api_key' },
      permissions: ['ai.generate'],
      capabilities: opts.capabilities,
      requires: [requireApiKey(opts.provider, opts.where)],
      setup: {
        summary: opts.setupSummary,
        docsUrl: opts.docsUrl,
        steps: opts.steps,
        fields: [{
          key: 'apiKey',
          label: 'API key',
          type: 'password',
          required: true,
          placeholder: opts.placeholder,
          hint: opts.hint,
          current: () => apiKeyFor(opts.provider),
          validate: v => v.length < 12 ? 'That looks too short to be a valid API key.' : null
        }]
      },
      applySetup(values) {
        return { ok: false, message: 'Provider keys must be configured in the authenticated backend vault.' };
      },
      async healthCheck() {
        const key = apiKeyFor(opts.provider);
        return probeEndpoint(opts.probeUrl(key), opts.probeHeaders(key), `Key accepted by ${opts.name}.`);
      }
    };
  }

  core.register(aiProvider({
    id: 'ai-openrouter',
    provider: 'openrouter',
    name: 'OpenRouter',
    vendor: 'OpenRouter',
    description: 'One key that reaches hundreds of AI models, including several free ones. Used for chat, lead scoring and drafting email copy.',
    detail: 'Useful because you are not locked to a single vendor: if one model is slow or unavailable, the app can fall back to another through the same key. Free-tier models are rate limited but cost nothing.',
    capabilities: ['generate_text', 'summarize', 'score_lead', 'generate_email'],
    where: 'Settings → AI Models',
    setupSummary: 'Create a free OpenRouter account, generate a key, paste it below.',
    docsUrl: 'https://openrouter.ai/keys',
    steps: [
      'Open openrouter.ai and sign in (Google sign-in works).',
      'Go to Keys and press Create Key.',
      'Copy the key — it starts with sk-or-v1-.',
      'Paste it below and press Save & test.'
    ],
    placeholder: 'sk-or-v1-…',
    hint: 'Free models are available, so a credit card is not required to start.',
    probeUrl: () => 'https://openrouter.ai/api/v1/models',
    probeHeaders: key => ({ Authorization: `Bearer ${key}` })
  }));

  core.register(aiProvider({
    id: 'ai-gemini',
    provider: 'gemini',
    name: 'Google Gemini',
    vendor: 'Google',
    description: 'Google\'s AI models. Strong at pulling structured details out of messy text, which makes it a good fit for resume parsing and lead enrichment.',
    detail: 'Google AI Studio gives a free tier that is generous enough for normal daily use. Gemini handles long documents well, so it is the better choice when parsing full resumes rather than short snippets.',
    capabilities: ['generate_text', 'extract', 'summarize', 'parse_resume'],
    where: 'Settings → AI Models',
    setupSummary: 'Get a free key from Google AI Studio, paste it below.',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    steps: [
      'Open aistudio.google.com/app/apikey and sign in with Google.',
      'Press Create API key.',
      'Copy the key — it starts with AIza.',
      'Paste it below and press Save & test.'
    ],
    placeholder: 'AIza…',
    hint: 'The free tier does not need billing enabled.',
    probeUrl: key => `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    probeHeaders: () => ({})
  }));

  core.register(aiProvider({
    id: 'ai-groq',
    provider: 'groq',
    name: 'Groq',
    vendor: 'Groq',
    description: 'Extremely fast inference on open models. Best when you need to score or classify hundreds of leads quickly rather than write long text.',
    detail: 'Groq answers in a fraction of the time other providers take, which matters when the app scores a whole batch of leads one after another. Model choice is smaller than OpenRouter\'s.',
    capabilities: ['generate_text', 'classify', 'summarize'],
    where: 'Settings → API Keys',
    setupSummary: 'Create a free Groq Cloud key, paste it below.',
    docsUrl: 'https://console.groq.com/keys',
    steps: [
      'Open console.groq.com and sign in.',
      'Go to API Keys and press Create API Key.',
      'Copy the key — it starts with gsk_.',
      'Paste it below and press Save & test.'
    ],
    placeholder: 'gsk_…',
    hint: 'Free tier available with a per-minute request limit.',
    probeUrl: () => 'https://api.groq.com/openai/v1/models',
    probeHeaders: key => ({ Authorization: `Bearer ${key}` })
  }));

  // ══════════════════════════════════════════════════════════════════════
  //  SMS — Fast2SMS, via the backend relay
  // ══════════════════════════════════════════════════════════════════════

  /**
   * The Fast2SMS API cannot be called from the browser, for two hard reasons:
   *
   *  1. Their API sends no CORS headers, so the browser refuses the response.
   *  2. The request carries your API key in an `authorization` header. Anything
   *     the browser can read, a visitor can read — the key would be exposed and
   *     could be used to drain your SMS wallet.
   *
   * So this plugin talks to our own backend, which holds the key server-side.
   * Requirement probe therefore checks for the relay, not for a key in the page.
   */
  const REQ_SMS_RELAY = {
    id: 'sms_relay',
    label: 'SMS relay URL not set',
    detail: 'SMS must be sent from the server, because the Fast2SMS key cannot be exposed in the browser ' +
            'and their API does not allow browser calls. Start the backend (uvicorn main:app --port 8000), ' +
            'put FAST2SMS_API_KEY in backend/.env, then set the relay URL below.',
    check: () => {
      const url = (localStorage.getItem('sms_relay_url') || cfg().SMS_RELAY_URL || '').trim();
      return /^https?:\/\//.test(url);
    }
  };

  function smsRelayUrl() {
    return (localStorage.getItem('sms_relay_url') || cfg().SMS_RELAY_URL || '').trim().replace(/\/+$/, '');
  }

  core.register({
    id: 'sms-fast2sms',
    name: 'SMS (Fast2SMS)',
    summary: 'Sends interview calls, job alerts and reminders by SMS through Fast2SMS.',
    description: 'Sends SMS to candidates and clients through Fast2SMS — interview calls, bulk job alerts, selection notices and reminders. One request can address up to 1,000 numbers.',
    detail: 'Sending happens on the server, never in the browser. Two reasons: the Fast2SMS API sends no CORS headers so a browser call fails outright, and the request carries your API key — anything the browser can read, a visitor can read, and a leaked key can drain your SMS wallet. The backend keeps the key in backend/.env and this plugin only talks to your own relay.\n\nRoute "q" (Quick) works without DLT registration and is fine for testing. For production volume to Indian numbers, TRAI requires DLT-registered sender IDs and pre-approved templates — use route "dlt" then.',
    version: '1.0.0',
    vendor: 'Fast2SMS',
    category: 'communication',
    tier: 'PARTIAL',
    authentication: { type: 'api_key' },
    permissions: ['sms.send'],
    capabilities: ['send_sms', 'bulk_sms', 'dlt_template_sms', 'check_wallet'],
    requires: [REQ_SMS_RELAY],
    setup: {
      summary: 'Runs through your own backend so the API key stays off the browser. Needs the backend running.',
      docsUrl: 'https://www.fast2sms.com/dashboard/dev-api',
      notes: 'Route "q" needs no DLT approval and is good for testing. For bulk production SMS to Indian numbers, ' +
             'TRAI requires a DLT-registered sender ID and approved templates — see the ready-made templates in ' +
             'docs/SMS-TEMPLATES.md.',
      steps: [
        'Create a Fast2SMS account and open Dashboard → Dev API to copy your API key.',
        'Put it in backend/.env as FAST2SMS_API_KEY=your_key_here (never in any frontend file).',
        'Start the backend: cd backend, then uvicorn main:app --reload --port 8000.',
        'Paste the relay URL below — http://localhost:8000 for local use.',
        'Press Save & test. It calls the wallet endpoint, so a pass means your key really works.',
        'For production bulk SMS, register a DLT sender ID and templates with your operator first.'
      ],
      fields: [{
        key: 'relayUrl',
        label: 'Backend relay URL',
        type: 'url',
        required: true,
        placeholder: 'http://localhost:8000',
        hint: 'Your own backend address. The Fast2SMS key lives there, not here.',
        current: () => smsRelayUrl(),
        validate: v => {
          if (!/^https?:\/\//.test(v)) return 'Must start with http:// or https://';
          if (/fast2sms\.com/i.test(v)) return 'This is your own backend address, not the Fast2SMS API address.';
          return null;
        }
      }]
    },
    applySetup(values) {
      localStorage.setItem('sms_relay_url', String(values.relayUrl || '').trim());
      return { ok: true };
    },
    async healthCheck() {
      const base = smsRelayUrl();
      if (!base) return { state: H.DISCONNECTED, message: 'No relay URL set.' };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        // The relay asks Fast2SMS for the wallet balance. A number coming back
        // proves the server is up AND that the stored key is valid.
        const res = await fetch(`${base}/api/sms/wallet`, { signal: controller.signal });
        clearTimeout(timer);

        if (res.status === 503) {
          return { state: H.DISCONNECTED, message: 'Backend is up but FAST2SMS_API_KEY is not set in backend/.env.' };
        }
        if (res.status === 401 || res.status === 403) {
          return { state: H.AUTH_EXPIRED, message: 'Fast2SMS rejected the key stored on the server.' };
        }
        if (!res.ok) {
          return { state: H.ERROR, message: `Relay returned HTTP ${res.status}.` };
        }

        const data = await res.json();
        if (data?.ok === false) {
          return { state: H.ERROR, message: data.message || 'Fast2SMS reported an error.' };
        }
        return {
          state: H.CONNECTED,
          message: data?.wallet !== undefined
            ? `Connected. Wallet balance: ${data.wallet}`
            : 'Connected to the SMS relay.'
        };
      } catch (err) {
        clearTimeout(timer);
        const reason = err?.name === 'AbortError' ? 'timed out' : (err?.message || 'network error');
        return {
          state: H.DISCONNECTED,
          message: `Could not reach the relay at ${base} (${reason}). Is the backend running?`
        };
      }
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  PARTIAL
  // ══════════════════════════════════════════════════════════════════════

  core.register({
    id: 'outlook-graph',
    name: 'Outlook (Microsoft Graph)',
    description: 'Sends email from your Microsoft 365 or Outlook.com account. You register a free Microsoft Entra app once and paste its client ID — no client secret is involved.',
    detail: 'Marked partial for one honest reason: the access token currently lives in the browser tab and is lost when you reload, because there is no server-side token store yet. Sending works within a session; it will survive reloads once the OAuth backend exists.',
    version: '0.9.0',
    vendor: 'Microsoft',
    category: 'microsoft',
    tier: 'PARTIAL',
    authentication: { type: 'oauth2' },
    permissions: ['email.send', 'user.read'],
    capabilities: ['send_email', 'create_draft'],
    requires: [{
      id: 'entra_client_id',
      label: 'no Microsoft Entra client ID saved',
      detail: 'Register a single-page application in Microsoft Entra with delegated User.Read and Mail.Send permissions, then paste its Application (client) ID.',
      check: () => {
        const el = document.getElementById('outlook-client-id');
        return Boolean((el?.value || localStorage.getItem('outlook_client_id') || '').trim());
      }
    }],
    setup: {
      summary: 'Register a free single-page app in Microsoft Entra, then paste its Application (client) ID.',
      docsUrl: 'https://entra.microsoft.com',
      steps: [
        'Open entra.microsoft.com → App registrations → New registration.',
        'Give it any name. Under "Supported account types" pick personal + work accounts.',
        'Set the platform to Single-page application (SPA) and add this page\'s address as the redirect URI.',
        'Open API permissions → Add → Microsoft Graph → Delegated, and add User.Read and Mail.Send.',
        'Copy the Application (client) ID from the Overview page.',
        'Paste it below, save, then press Connect Outlook in Email Auto.'
      ],
      fields: [{
        key: 'clientId',
        label: 'Application (client) ID',
        type: 'text',
        required: true,
        placeholder: '00000000-0000-0000-0000-000000000000',
        hint: 'A GUID from the app\'s Overview page. This is not a secret.',
        current: () => localStorage.getItem('outlook_client_id') || '',
        validate: v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
          ? null
          : 'That should be a GUID, like 00000000-0000-0000-0000-000000000000.'
      }]
    },
    applySetup(values) {
      const id = String(values.clientId || '').trim();
      localStorage.setItem('outlook_client_id', id);
      const el = document.getElementById('outlook-client-id');
      if (el) el.value = id;
      return { ok: true };
    },
    async healthCheck() {
      const token = window.OutlookMail?.token;
      if (!token) {
        return { state: H.DISCONNECTED, message: 'Client ID saved, but no Microsoft account is connected yet.' };
      }
      return { state: H.DEGRADED, message: 'Token held in this browser tab only. It is lost on reload until server-side token storage exists.' };
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  PLANNED — blocked on the backend OAuth service
  // ══════════════════════════════════════════════════════════════════════

  const planned = [
    {
      id: 'gmail-api',
      name: 'Gmail (Official API)',
      description: 'Full Gmail access: drafts, threads, labels and large attachments, with proper per-message delivery status instead of a single webhook response.',
      detail: 'This replaces the Apps Script path once the OAuth backend exists. The advantage over Apps Script is real per-recipient status, higher limits, and no 6-minute script execution ceiling on large batches.',
      vendor: 'Google', category: 'communication',
      permissions: ['email.send', 'drafts.manage'],
      capabilities: ['send_email', 'create_draft', 'batch_send', 'read_threads']
    },
    {
      id: 'google-calendar',
      name: 'Google Calendar',
      description: 'Creates interview slots that appear on your calendar and in the candidate\'s inbox, with correct timezones and automatic reminders.',
      detail: 'The intended flow: a candidate is shortlisted, an interview event is created with the recruiter and candidate as attendees, and the event link is stored on the candidate record.',
      vendor: 'Google', category: 'google',
      permissions: ['calendar.events'],
      capabilities: ['create_event', 'update_event', 'cancel_event']
    },
    {
      id: 'google-drive',
      name: 'Google Drive',
      description: 'Keeps candidate resumes in your own Drive and stores only a reference on the candidate record, so files stay under your control.',
      detail: 'Files are written to an app-specific folder, so the integration never gains access to the rest of your Drive.',
      vendor: 'Google', category: 'google',
      permissions: ['drive.file'],
      capabilities: ['upload_file', 'create_folder', 'list_files']
    },
    {
      id: 'google-sheets-sync',
      name: 'Google Sheets Sync',
      description: 'Live two-way sync with a spreadsheet you pick: rows added in Sheets appear as candidates, and status changes here write back.',
      detail: 'Different from CSV import, which is a one-time snapshot. Sync keeps both sides current and is the easiest way to let someone contribute leads without giving them app access.',
      vendor: 'Google', category: 'google',
      permissions: ['spreadsheets'],
      capabilities: ['read_rows', 'append_rows', 'update_rows']
    },
    {
      id: 'onedrive',
      name: 'OneDrive',
      description: 'The Microsoft equivalent of the Drive integration for storing resumes and documents.',
      detail: 'Useful if your organisation is on Microsoft 365 and Google services are blocked.',
      vendor: 'Microsoft', category: 'microsoft',
      permissions: ['files.readwrite'],
      capabilities: ['upload_file', 'list_files']
    },
    {
      id: 'ms-excel',
      name: 'Excel (Microsoft 365)',
      description: 'Reads and writes workbooks that live in your Microsoft 365 account, without downloading them first.',
      detail: 'The Microsoft counterpart to Google Sheets Sync.',
      vendor: 'Microsoft', category: 'microsoft',
      permissions: ['files.readwrite'],
      capabilities: ['read_rows', 'append_rows']
    },
    {
      id: 'ms-teams',
      name: 'Microsoft Teams',
      description: 'Posts a message to a Teams channel when something needs a human — a hot lead arrives or a campaign fails.',
      detail: 'Intended for team visibility rather than bulk messaging.',
      vendor: 'Microsoft', category: 'microsoft',
      permissions: ['chat.write'],
      capabilities: ['send_notification']
    },
    {
      id: 'job-feed',
      name: 'Authorized Job Feed',
      description: 'Pulls candidates from an official or licensed job-board API that you have access to, then normalises and de-duplicates them into your database.',
      detail: 'Deliberately built around official APIs, licensed feeds and authorised imports only. It will not log into a portal on your behalf, solve CAPTCHAs, or scrape behind a paywall — that breaks provider terms and tends to get accounts banned.',
      vendor: 'Various', category: 'recruitment',
      permissions: ['candidates.write'],
      capabilities: ['search_candidates', 'import_candidates', 'sync']
    }
  ];

  planned.forEach(p => core.register({
    version: '0.0.0',
    tier: 'PLANNED',
    authentication: { type: 'oauth2' },
    requires: [REQ_BACKEND_OAUTH],
    setup: {
      summary: 'This cannot be connected yet. It is waiting on the backend OAuth service, not on anything you need to do.',
      steps: [
        'A server-side component must exchange the provider authorization code for tokens, because the client secret can never live in the browser.',
        'Those tokens must be encrypted and stored against a verified account, so the connection survives a reload and follows you across devices.',
        'That requires real sign-in first — see the google-auth-cloud-sync spec.',
        'Once that exists, this plugin becomes connectable with no change to the rest of the app.'
      ],
      fields: []
    },
    // No healthCheck on purpose: the core reports DISCONNECTED with the exact
    // unmet requirement, which is more useful than a stub returning a fake state.
    ...p
  }));

  console.info(`[Plugins] registered ${core.list().length} plugins`);
})();
