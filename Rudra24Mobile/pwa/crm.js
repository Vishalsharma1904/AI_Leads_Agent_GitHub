import {escapeHTML as e} from './contract.js';
export function crmDetails(row){
 if(!row)return '<h2>CRM details</h2><p>Lead par Details tap kijiye.</p>';
 const p=row.profile,stages=['new','attempted','connected','follow_up','qualified','not_interested','review_required'];
 if(row.stage==='client')stages.push('client');
 return `<h2>${e(p.company)}</h2><p>${e(p.contactPerson)}<br>${e(p.address)}</p>
 <form id="crm-contact"><label for="crm-stage">Stage</label><select id="crm-stage">${stages.map(stage=>`<option value="${stage}" ${stage===row.stage?'selected':''}>${e(stage.replaceAll('_',' '))}</option>`).join('')}</select><label for="crm-phone">Phone with country code</label><input id="crm-phone" value="${e(p.phone||p.mobile)}"><label for="crm-email">Email</label><input id="crm-email" type="email" value="${e(p.email)}"><div class="actions"><button>Save contact & stage</button></div></form>
 <form id="crm-note"><label for="crm-note-text">CRM note</label><textarea id="crm-note-text" required maxlength="12000"></textarea><div class="actions"><button>Save note</button></div></form>
 <h3 style="margin-top:24px">Follow-ups</h3>${(row.tasks||[]).map(task=>`<div class="job"><strong>${e(task.title)}</strong><p>${e(task.status)} · ${e(task.dueAt||'No due date')}</p>${task.status==='open'?`<button class="secondary" data-complete-task="${e(task.id)}" data-version="${e(task.version)}">Mark completed</button>`:''}</div>`).join('')||'<p>No follow-up yet.</p>'}
 <form id="crm-task"><label for="crm-task-title">New follow-up</label><input id="crm-task-title" maxlength="200" required><label for="crm-task-date">Due date (optional)</label><input id="crm-task-date" type="date"><div class="actions"><button>Add follow-up</button></div><p class="note">Save timeout ho to retry se pehle history refresh kijiye.</p></form>
 <h3 style="margin-top:24px">Activity & call history</h3>${(row.activities||[]).map(activity=>`<div class="job"><strong>${e(activity.kind?.replaceAll('_',' ')||'Activity')}</strong><p class="note">${e(activity.occurredAt||'')}</p><p style="white-space:pre-wrap">${e(activity.note||activity.outcome||'')}</p></div>`).join('')||'<p>No history yet.</p>'}
 <div class="actions"><button data-detail="${e(row.id)}" class="secondary">Refresh history</button></div>`;
}
