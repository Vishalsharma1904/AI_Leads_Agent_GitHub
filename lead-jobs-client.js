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

  async function run(request, callbacks = {}) {
    const response = await fetch(`${apiBase()}/lead-jobs`, {
      method: 'POST', headers: { ...headers(), 'Idempotency-Key': `lead-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      body: JSON.stringify({ cities: request.locations || [], industries: request.industries || [], service_type: request.types || [], count: Math.max(1, Math.min(100, request.countPerCombo || 20)) })
    });
    const created = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(created.detail || 'Lead job could not be created');
    const jobId = created.job?.id;
    if (!jobId) throw new Error('Lead service returned no job ID');
    callbacks.onLog?.('info', `Lead job ${jobId} queued on the server`);

    for (let attempt = 0; attempt < 120; attempt++) {
      await sleep(1000);
      const statusResponse = await fetch(`${apiBase()}/lead-jobs/${encodeURIComponent(jobId)}`, { headers: headers() });
      const status = await statusResponse.json().catch(() => ({}));
      if (!statusResponse.ok) throw new Error(status.detail || 'Lead job status could not be read');
      const state = status.job?.status;
      const phaseLabel = state === 'queued'
        ? 'Queueing the source plan'
        : state === 'running'
          ? 'Searching public businesses and enriching contacts'
          : state === 'completed' || state === 'partial'
            ? 'Preparing sourced results'
            : state === 'failed' ? 'Provider returned an error' : 'Updating the lead job';
      callbacks.onLog?.('info', phaseLabel);
      callbacks.onProgressDetails?.({ jobId, status: state, label: phaseLabel, count: status.job?.result_count || 0 });
      if (status.job?.status === 'completed' || status.job?.status === 'partial') return status.leads || [];
      if (status.job?.status === 'failed') throw new Error(status.job.error || 'Lead provider failed');
      if (status.job?.status === 'cancelled') throw new Error('Lead job was cancelled');
    }
    throw new Error('Lead job timed out while waiting for the provider');
  }

  window.NexusLeadJobs = { run };
})();
