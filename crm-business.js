/** Business queues share the authenticated CRM ledger; no separate browser database. */
(() => {
  'use strict';
  const labels = { no_answer: 'Not answered', not_interested: 'Not interested', interested: 'Interested', hot: 'Hot leads', meeting: 'Meetings', connected: 'Connected', review_required: 'Needs review' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = s => s ? new Date(s).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST' : 'Time needs review';
  const request = (path, options) => window.CRMBridge.request('/automation' + path, options);
  let category = '', owner = '', epoch = 0, polling = false, seen = new Set();
  const account = () => window.SupabaseAuth?.getUser?.()?.id || '';
  function reset() {
    if (owner === account()) return;
    owner = account(); epoch++; category = ''; seen.clear();
  }
  async function load(offset = 0, search = '', from = '', to = '') {
    reset();
    const [overview, settings, notices] = await Promise.all([request('/overview?' + new URLSearchParams({ category, offset, search, from, to })), request('/settings'), request('/notices')]);
    return { ...overview, ...settings, ...notices };
  }
  function render(data) {
    const config = data.settings;
    return `<section class="crm-business"><p class="crm-muted">One latest outcome per lead. Sending a message is a contact attempt; conversion requires a Won contract.</p><div class="crm-business-queues" aria-label="Business outcome queues"><button type="button" data-business-queue="" aria-pressed="${!category}">All outcomes <strong>${Object.values(data.counts).reduce((a,b)=>a+b,0)}</strong></button>${Object.entries(labels).map(([key,label])=>`<button type="button" data-business-queue="${key}" aria-pressed="${category===key}">${label}<strong>${data.counts[key] || 0}</strong></button>`).join('')}</div><section class="crm-section"><h2>${labels[category] || 'Latest outcomes'}</h2>${data.records.length ? `<ul class="crm-tasks">${data.records.map(row=>`<li><div><span class="crm-tag">${labels[row.businessOutcome]} · ${esc(row.channel)}</span><h3>${esc(row.profile.company || row.profile.contactPerson || 'Lead')}</h3><p>${esc(row.summary)}</p><time>${date(row.outcomeAt)}</time></div><button type="button" class="crm-secondary" data-business-record="${esc(row.id)}">Review / log outcome</button></li>`).join('')}</ul>` : '<p class="crm-muted">No recorded outcomes match this queue.</p>'}<p>${data.total} matching leads</p></section><section class="crm-section"><h2>Meetings & Calendar</h2><p class="crm-muted">30 minutes before + at the exact start. Calendar notifications reach your phone when Calendar sync and notifications are enabled.</p>${data.meetings.length ? `<ul class="crm-tasks">${data.meetings.map(task=>`<li><div><h3>${esc(task.title)}</h3><time>${date(task.dueAt)}</time><p>${esc(task.notes)}</p><span class="crm-tag">Calendar: ${esc(task.calendarStatus.replace(/_/g,' '))}</span>${task.syncError ? `<p class="crm-error">${esc(task.syncError)}</p>` : ''}</div><div class="crm-task-actions"><button type="button" data-business-record="${esc(task.recordId)}">Open lead</button>${['failed','not_queued'].includes(task.calendarStatus) ? `<button type="button" data-business-sync="${esc(task.id)}">Sync Calendar</button>` : ''}${/^https:\/\/(?:www\.)?google\.com\/calendar\//.test(task.calendarUrl || '') || /^https:\/\/calendar\.google\.com\//.test(task.calendarUrl || '') ? `<a href="${esc(task.calendarUrl)}" target="_blank" rel="noopener">Open Calendar</a>` : ''}</div></li>`).join('')}</ul>` : '<p class="crm-muted">Log a confirmed meeting with an exact date and time. Ambiguous appointments stay in Needs review.</p>'}</section><details class="crm-section crm-business-settings" data-business-section="settings"><summary>Business automation & Google connection</summary><p>${data.googleAccount ? `Notifications account: <strong>${esc(data.googleAccount)}</strong>` : 'Connect Google to send reminders and your daily digest to your own account.'}</p><p class="crm-muted">Calendar ${data.calendarConnected ? 'connected' : 'permission needed'} · Email ${data.emailConnected ? 'connected' : 'permission needed'} · Gmail replies ${data.repliesConnected ? 'connected' : 'read permission needed'}</p><button type="button" data-business-connect>${data.googleAccount ? 'Reconnect / choose another Google account' : 'Connect Google'}</button><form data-business-form="settings" class="crm-form">${[['enabled','Enable automation'],['calendar','Sync meetings to Calendar'],['meetingEmail','Email meeting summaries'],['digest','Daily business digest']].map(([key,label])=>`<label class="crm-business-check"><input type="checkbox" name="${key}" ${config[key]?'checked':''}>${label}</label>`).join('')}<label>Timezone<input name="timezone" value="${esc(config.timezone)}" required maxlength="64"></label><label>Daily digest hour (0–23)<input type="number" name="digestHour" min="0" max="23" value="${config.digestHour}" required></label><label>Calendar ID<input name="calendarId" value="${esc(config.calendarId)}" required maxlength="256"></label><p class="crm-muted">Default: India time, 7 PM daily. Automated email replies are checked about every five minutes; unrecognized replies need review. WhatsApp/SMS replies must be logged or pasted below because those current connectors do not receive verified replies. The backend must stay online for background processing.</p><button type="submit">Save preferences</button><span data-business-status role="status"></span></form></details><details class="crm-section" data-business-section="notices"><summary>Notification inbox · ${data.unreadCount ?? data.notices.filter(n=>!n.read).length} unread</summary>${data.notices.map(n=>`<article class="crm-business-notice"><h3>${esc(n.title)}</h3><time>${date(n.createdAt)}</time><p>${esc(n.message)}</p>${n.recordId ? `<button type="button" data-business-record="${esc(n.recordId)}">Open lead</button>`:''}${!n.read ? `<button type="button" data-business-read="${esc(n.id)}">Mark read</button>`:''}</article>`).join('') || '<p>No business notifications yet.</p>'}</details><details class="crm-section" data-business-section="deliveries"><summary>Recent delivery status</summary>${data.jobs.map(j=>`<p><strong>${esc(j.subject)}</strong> · ${esc(j.status)}${j.error?' · '+esc(j.error):''}</p>`).join('') || '<p>No Calendar/email jobs yet.</p>'}</details></section>`;
  }
  function form(record) {
    return `<details class="crm-business-editor" open><summary>Log a business outcome</summary><form class="crm-form" data-business-form="outcome" data-record="${esc(record.id)}" data-version="${record.version}" data-key="${crypto.randomUUID()}"><fieldset><legend>Client outcome</legend><div class="crm-business-choices">${Object.entries(labels).map(([key,label])=>`<label><input type="radio" name="category" value="${key}" ${key==='connected'?'checked':''}>${label}</label>`).join('')}</div></fieldset><fieldset><legend>Channel</legend><div class="crm-business-choices">${['call','email','whatsapp','sms','meeting'].map((key,i)=>`<label><input type="radio" name="channel" value="${key}" ${!i?'checked':''}>${key==='call'?'Call':key.toUpperCase()}</label>`).join('')}</div></fieldset><label>Client reply / factual outcome<textarea name="summary" required maxlength="12000" placeholder="Paste only the client's words or describe what actually happened."></textarea></label><button type="button" data-business-analyze>Suggest outcome from reply</button><p class="crm-muted" data-business-preview aria-live="polite">You review the suggestion before saving.</p><div data-business-meeting hidden><label>Confirmed meeting date & time<input type="datetime-local" name="meetingAt"></label><label>Timezone<input name="timezone" value="Asia/Kolkata" required maxlength="64"></label><label>Duration in minutes<input type="number" name="duration" value="30" min="5" max="480"></label><p class="crm-muted">Leave time blank if unconfirmed. It will go to Needs review; no Calendar event will be guessed.</p></div><button type="submit">Save outcome</button><span data-business-status role="status"></span></form></details>`;
  }
  function meetingFields(form) { form.querySelector('[data-business-meeting]').hidden = form.elements.category.value !== 'meeting'; }
  document.addEventListener('change', e => { const f=e.target.closest('[data-business-form="outcome"]'); if(f && e.target.name==='category') meetingFields(f); });
  document.addEventListener('submit', async e => {
    const f=e.target.closest('[data-business-form]'); if(!f)return;
    e.preventDefault(); reset(); const ticket=epoch, out=f.querySelector('[data-business-status]');
    const values=Object.fromEntries(new FormData(f)), buttons=[...f.querySelectorAll('button')]; buttons.forEach(b=>b.disabled=true);
    try {
      if(f.dataset.businessForm==='settings') {
        ['enabled','calendar','meetingEmail','digest'].forEach(k=>values[k]=!!values[k]); values.digestHour=Number(values.digestHour);
        await request('/settings',{method:'PUT',body:JSON.stringify(values)});
        if(ticket===epoch)window.showToast?.({type:'success',title:'Business automation',message:'Preferences saved.'});
      } else {
        values.recordId=f.dataset.record; values.version=Number(f.dataset.version); values.idempotencyKey=f.dataset.key; values.duration=Number(values.duration);
        values.meetingAt=values.category==='meeting' && values.meetingAt ? values.meetingAt : null;
        await request('/outcomes',{method:'POST',body:JSON.stringify(values)});
        if(ticket!==epoch)return;
        await window.CRMCtrl.openRecord(values.recordId,true);
      }
      if(ticket!==epoch)return; out.textContent='Saved.'; window.CRMCtrl.refresh(); poll();
    } catch(err) { if(ticket===epoch)out.textContent=err.message; }
    finally { buttons.forEach(b=>b.disabled=false); }
  });
  document.addEventListener('click', async e => {
    const b=e.target.closest('[data-business-queue],[data-business-record],[data-business-sync],[data-business-read],[data-business-connect],[data-business-analyze]'); if(!b)return;
    reset(); const ticket=epoch;
    if(b.hasAttribute('data-business-queue')) { category=b.dataset.businessQueue; window.CRMCtrl.businessQueueChanged(); return; }
    if(b.dataset.businessRecord) { await window.CRMCtrl.openRecord(b.dataset.businessRecord); document.getElementById('crm-tab-activity')?.click(); return; }
    b.disabled=true;
    const f=b.closest('form'), out=f?.querySelector('[data-business-status]');
    // Open synchronously so browser popup blockers do not swallow OAuth.
    const popup=b.hasAttribute('data-business-connect') ? window.open('about:blank','rudra-business-google','popup,width=540,height=720') : null;
    try {
      if(b.dataset.businessSync) await request(`/meetings/${encodeURIComponent(b.dataset.businessSync)}/sync`,{method:'POST'});
      else if(b.dataset.businessRead) await request(`/notices/${encodeURIComponent(b.dataset.businessRead)}/read`,{method:'POST'});
      else if(b.hasAttribute('data-business-analyze')) {
        const result=await request('/analyze',{method:'POST',body:JSON.stringify({recordId:f.dataset.record,text:f.elements.summary.value})});
        if(ticket!==epoch)return;
        f.elements.category.value=result.category; meetingFields(f);
        f.querySelector('[data-business-preview]').textContent=`Suggestion: ${labels[result.category]}. ${result.meetingAt?'Confirmed date found: '+date(result.meetingAt):'Review the words and appointment time before saving.'}`;
        if(result.meetingAt) {
          const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(result.meetingAt));
          const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));f.elements.meetingAt.value=`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
        }
        return;
      } else if(popup) {
        const current=await request('/settings'); await request('/settings',{method:'PUT',body:JSON.stringify(current.settings)});
        const token=window.SupabaseAuth.getAccessToken(), base=String(window.SKYLARK_CONFIG?.BACKEND_URL||'http://localhost:8000').replace(/\/+$/,'');
        const response=await fetch(base+'/api/v1/connectors/oauth/google_workspace/start?purpose=automation',{method:'POST',headers:{Authorization:'Bearer '+token}});
        const data=await response.json(); if(!response.ok)throw new Error(data.detail||'Google connection unavailable');
        if(ticket!==epoch){popup.close();return;}
        const url=new URL(data.authorization_url);if(url.protocol!=='https:'||url.hostname!=='accounts.google.com')throw new Error('Unexpected Google authorization address');
        popup.location.href=url.href;
      } else if(b.hasAttribute('data-business-connect')) throw new Error('Allow the Google sign-in popup and try again.');
      if(ticket===epoch)window.CRMCtrl.refresh();
    } catch(err) { popup?.close(); if(ticket===epoch){if(out)out.textContent=err.message;else window.showToast?.({type:'error',title:'Business automation',message:err.message});} }
    finally { b.disabled=false; }
  });
  async function poll() {
    reset(); if(!owner||polling||document.hidden||!navigator.onLine)return;
    polling=true; const ticket=epoch;
    try {
      const data=await request('/notices'); if(ticket!==epoch)return;
      const fresh=data.notices.filter(n=>!n.read&&!seen.has(n.id)).slice(0,3).reverse();
      for(const n of fresh) {
        const actions=[{label:'Open lead',run:()=>{if(ticket!==epoch)return; location.hash='#crm-pipeline';setTimeout(()=>{if(ticket===epoch)window.CRMCtrl.openRecord(n.recordId);},100);}},
          {label:'Mark read',run:()=>{if(ticket===epoch)return request(`/notices/${encodeURIComponent(n.id)}/read`,{method:'POST'});}}].filter(a=>a.label!=='Open lead'||n.recordId);
        if(window.ClavisAhead){document.dispatchEvent(new CustomEvent('crm:notice',{detail:{...n,actions}}));seen.add(n.id);}
        else {const id=window.showToast?.({id:'business-'+n.id,eventKey:n.id,type:'task',title:n.title,message:n.message,timeoutMs:12000,actions});if(id)seen.add(n.id);}
      }
    } catch(_) { /* Existing CRM shows connection state; do not turn outages into repeated toasts. */ }
    finally { polling=false; }
  }
  window.addEventListener('rudra:auth-state',()=>{reset();poll();});
  window.addEventListener('clavis:workspace-change',reset);
  window.addEventListener('online',poll);window.addEventListener('focus',poll);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
  document.addEventListener('DOMContentLoaded',poll);setInterval(poll,15000);
  window.CRMBusiness={load,render,form};
})();
