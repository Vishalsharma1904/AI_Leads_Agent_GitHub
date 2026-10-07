/* Authenticated client for the backend lead-job lifecycle. */
(function () {
  'use strict';
  const apiBase = () => `${window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000'}/api/v1`;
  const headers = () => {
    const token = window.SupabaseAuth?.getAccessToken?.() || '';
    if (!token) throw new Error('Sign in before running the lead engine');
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let activeJobId = null;
  let stopRequested = false;
  let activeOwner = null;
  async function requestJSON(url, options, timeoutMs=12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {...options, signal:controller.signal});
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || `Lead service HTTP ${response.status}`);
      return body;
    } finally { clearTimeout(timer); }
  }

  function cancel() {
    stopRequested = true;
    if (!activeJobId) return;
    if (activeOwner && window.SupabaseAuth?.getUser?.()?.id !== activeOwner) return;
    fetch(`${apiBase()}/lead-jobs/${encodeURIComponent(activeJobId)}/cancel`, {
      method: 'POST', headers: headers()
    }).catch(() => {});
  }

  async function run(request, callbacks = {}) {
    activeJobId = null;
    stopRequested = false;
    activeOwner = window.SupabaseAuth?.getUser?.()?.id || null;
    const created = await requestJSON(`${apiBase()}/lead-jobs`, {
      method: 'POST', headers: { ...headers(), 'Idempotency-Key': `lead-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      body: JSON.stringify({ cities: request.locations || [], industries: request.industries || [], service_type: request.types || [], sources: request.sources || ['sulekha','justdial','maps','apify'], count: Math.max(1, Math.min(100, request.countPerCombo || 20)) })
    }, 20000);
    const jobId = created.job?.id;
    if (!jobId) throw new Error('Lead service returned no job ID');
    activeJobId = jobId;
    if (stopRequested) cancel();
    callbacks.onLog?.('info', `Lead job ${jobId} queued on the server`);

    let lastPhase = '';
    let stopPolls = 0;
    let lastLeads = [], errors = 0;
    const startedAt = Date.now();
    try { for (let attempt = 0; attempt < 420; attempt++) {
      await sleep(1000);
      if (activeOwner && window.SupabaseAuth?.getUser?.()?.id !== activeOwner) throw new Error('Account changed; reopen this search from its original account');
      let status;
      try { status = await requestJSON(`${apiBase()}/lead-jobs/${encodeURIComponent(jobId)}`, {headers:headers()}); errors = 0; }
      catch (error) {
        callbacks.onProgressDetails?.({jobId,status:'reconnecting',label:'Lead service connection interrupted · reconnecting',leads:lastLeads,count:lastLeads.length});
        if (++errors < 3 && !stopRequested) continue;
        if (lastLeads.length) return lastLeads;
        throw error;
      }
      const state = status.job?.status;
      const phaseLabel = status.job?.stage || (state === 'queued'
        ? 'Queueing the source plan'
        : state === 'running'
          ? 'Searching public businesses and enriching contacts'
          : state === 'completed' || state === 'partial'
            ? 'Preparing sourced results'
            : state === 'failed' ? 'Provider returned an error' : 'Updating the lead job');
      if (phaseLabel !== lastPhase) callbacks.onLog?.('info', phaseLabel);
      lastPhase = phaseLabel;
      const count = status.job?.result_count || 0;
      lastLeads = status.leads || lastLeads;
      const elapsedSeconds = Math.floor((Date.now()-startedAt)/1000);
      const waiting = state === 'running' && elapsedSeconds >= 5 ? ` · ${elapsedSeconds}s elapsed` : '';
      callbacks.onProgressDetails?.({ ...status.job?.progress, jobId, status: state, label: phaseLabel + waiting, count, leads:lastLeads, elapsedSeconds });
      if (stopRequested) {
        if (!status.leads?.length && ++stopPolls < 30) continue;
        activeJobId = null;
        return status.leads || [];
      }
      if (status.job?.status === 'completed' || status.job?.status === 'partial') {
        activeJobId = null;
        return status.leads || [];
      }
      if (status.job?.status === 'failed') { if (lastLeads.length) return lastLeads; throw new Error(status.job.error || 'Lead provider failed'); }
      if (status.job?.status === 'cancelled') { activeJobId = null; return status.leads || []; }
      if ((Date.now()/1000 - status.job?.updated_at > 180) || Date.now()-startedAt > 420000) {
        cancel();
        if (lastLeads.length) return lastLeads;
        throw new Error('Lead worker stopped updating. Saved contacts are safe; retry the search after checking the backend.');
      }
    }
    cancel();
    if (lastLeads.length) return lastLeads;
    throw new Error('Lead job timed out while waiting for the provider');
    } finally { activeJobId = null; activeOwner = null; }
  }

  window.NexusLeadJobs = { run, cancel };
})();
