/* Outcome-driven next steps. One account, one offer, no idle backup nudges. */
(function(global){
  'use strict';
  if(global.ClavisAhead)return;
  const doc=document, TTL=300000, GAP=90000;
  let owner='',step=null,expires=0,last=0,timer=0,snoozed=0,running=false;
  const seen=new Set(),queue=[],history=[];
  const identity=()=>global.SupabaseAuth?.getUser?.()?.id || global.AntigravityAuth?.currentUser?.id || '';
  const route=view=>{global.location.hash='#'+view;global.showView?.(view);};
  function reset(){const next=identity();if(next===owner)return;owner=next;clear();queue.length=0;seen.clear();history.length=0;snoozed=last=0;}
  function record(type,detail){reset();history.push({type,at:Date.now(),...detail});if(history.length>12)history.shift();}
  function typing(){const active=doc.activeElement;return active && /INPUT|TEXTAREA/.test(active.tagName) && !!active.value?.trim();}
  function clear(why){step=null;expires=0;clearTimeout(timer);global.RudraMotionUI?.hide();if(why)scheduleDrain();}
  function display(next){step=next;expires=Date.now()+TTL;last=Date.now();global.RudraMotionUI?.show(next);clearTimeout(timer);timer=setTimeout(()=>{clear();drain();},TTL);global.dispatchEvent(new CustomEvent('clavis:ahead',{detail:{id:next.id,label:next.label}}));}
  function offer(next,options={}){
    if(!options.force && global.localStorage?.getItem('clavis_proactive_enabled')==='false')return false;
    reset();if(!owner||!next||typeof next.run!=='function'&& !next.actions?.some(a=>typeof a.run==='function'))return false;
    const key=next.key||next.id;if(seen.has(key))return false;
    seen.add(key);if(seen.size>100)seen.delete(seen.values().next().value);
    next={...next,owner,createdAt:Date.now()};
    if(step||running||doc.hidden||typing()||Date.now()<snoozed||!options.force && Date.now()-last<GAP){queue.push(next);if(queue.length>3)queue.shift();scheduleDrain();return true;}
    display(next);return true;
  }
  function scheduleDrain(){if(step)return;clearTimeout(timer);timer=setTimeout(drain,Math.max(2000,snoozed-Date.now(),GAP-(Date.now()-last)));}
  function drain(){reset();while(queue.length && Date.now()-queue[0].createdAt>TTL)queue.shift();if(!queue.length)return;if(step||running||doc.hidden||typing()||Date.now()<snoozed){scheduleDrain();return;}const next=queue.shift();if(next.owner===owner)display(next);}
  function current(){reset();if(step&&Date.now()>expires)clear();return step?{id:step.id,label:step.label,cta:step.cta,source:step.source,description:step.description}:null;}
  async function run(index=0){reset();const selected=step;if(!current()||running)return false;const action=selected.actions?.[index]||{run:selected.run};if(typeof action.run!=='function')return false;clear();running=true;try{const result=await action.run();record('action',{id:selected.id,result:result===false?'not_completed':'completed'});return result!==false;}catch(error){record('action',{id:selected.id,result:'failed',error:String(error.message||error).slice(0,160)});offer({id:'action-error:'+selected.id,key:selected.id+':failed:'+Date.now(),source:'Rudra · Needs attention',label:'That step could not finish',description:String(error.message||error).slice(0,180),actions:[{label:'Review current task',run:()=>route('jarvis')} ]},{force:true});return false;}finally{running=false;scheduleDrain();}}
  function snooze(){clear();snoozed=Date.now()+30*60000;scheduleDrain();}
  function respond(text){const selected=step;if(!current()||!text?.trim())return false;const input=doc.getElementById('jarvis-input');if(!input)return false;if(input.value.trim()){global.showToast?.({type:'info',title:'Your draft is still there',message:'Send or clear the composer draft before sending a different next step.'});return false;}clear();route('jarvis');input.value=`${text.trim()}\n\nContext: ${selected.source||'Current task'} — ${selected.label}. ${selected.description||''}`;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();global.handleJarvisSend?.();return true;}
  function context(){reset();return {view:global.location.hash,pending:current(),recent:history.slice(-6)};}
  function tryConfirm(text){if(!current())return null;const t=String(text||'').trim().replace(/[.!?,]+$/,'');if(/^(haan|han|yes|okay|ok|kar do|karo|go ahead|do it|chalo|bilkul)$/i.test(t)){run();return {handled:true,silent:true,spoken:''};}if(/^(nahi|no|later|cancel|rehne do|abhi nahi)$/i.test(t)){snooze();return {handled:true,silent:true,spoken:''};}return null;}
  function wrap(){const intent=global.ClavisIntent;if(!intent?.route||intent.__aheadWrapped)return;const original=intent.route;intent.route=async function(text,opts){return tryConfirm(text)||original.call(this,text,opts);};intent.__aheadWrapped=true;}
  async function leadsDone(detail){
    record('leads',{taskId:detail.taskId,count:detail.leads?.length||detail.total||0,requested:detail.requested,stopped:!!detail.stopped,exported:!!detail.exported});
    const ticket=owner,leads=Array.isArray(detail.leads)?detail.leads:[],key='leads:'+String(detail.taskId||leads.map(l=>l.id||l.company).join('|'));
    if(!detail.ok||!leads.length){offer({id:'search-needs-review',key,source:'Lead agent · Needs attention',label:detail.stopped?'Search stopped before any results arrived':'This search needs a review',description:detail.error?String(detail.error).slice(0,160):'No matching contactable records were returned. Review your current location, industry and provider status before retrying.',actions:[{label:'Review search',run:()=>route('agent')},{label:'Provider settings',run:()=>route('tokens')} ]},{force:true});return;}
    // Export only this task's rows, once. Never download the entire saved database.
    if(!detail.exported && !seen.has(key+':export')){seen.add(key+':export');try{detail.exported=!!global.RealScraper?.exportExcel?.(leads,`leads-${leads.length}`);}catch(_){detail.exported=false;}}
    if(ticket!==identity())return;
    record('lead-export',{taskId:detail.taskId,count:leads.length,requested:!!detail.exported});
    const emails=leads.filter(l=>l.email).length,phones=leads.filter(l=>l.phone||l.mobile).length;
    const actions=[{label:'Review '+leads.length+' leads',run:()=>route('leads')}];
    if(emails && global.EmailCtrl?.setLeadAudience)actions.push({label:'Prepare email · '+emails,run:()=>{global.EmailCtrl.setLeadAudience(leads.filter(l=>l.email));route('email');}});
    if(phones && typeof global.sendLeadsToCallingAgent==='function')actions.push({label:'Review call queue · '+phones,run:()=>{global.sendLeadsToCallingAgent(leads.filter(l=>l.phone||l.mobile));route('calling');}});
    actions.push({label:detail.exported?'Download Excel again':'Download Excel',run:()=>global.RealScraper?.exportExcel?.(leads,`leads-${leads.length}`)});
    offer({id:'lead-result',key,source:'Lead agent · '+(detail.stopped?'Partial result':'Ready'),label:`${leads.length}${detail.requested&&leads.length<detail.requested?' of '+detail.requested:''} leads ready`,description:`${detail.exported?'Excel export requested automatically. ':'Excel export needs attention. '}${emails} with email · ${phones} with phone. Review recipients and sender before any outreach.`,actions},{force:true});
  }
  doc.addEventListener('nexus:scrapedone',e=>leadsDone(e.detail||{}));
  doc.addEventListener('nexus:candidatesdone',e=>{if(e.detail?.ok===false)return;record('candidates',{count:e.detail?.total||e.detail?.added});offer({id:'candidate-result',key:'candidates:'+String(e.detail?.taskId||Date.now()),source:'Candidate agent · Ready',label:'Your candidate results are ready',description:'Review profiles and contact permissions before the next step.',actions:[{label:'Review candidates',run:()=>route('candidate-db')}]},{force:true});});
  doc.addEventListener('crm:insights',e=>{record('crm',e.detail);const d=e.detail;if(!d?.due&&!d?.expired)return;offer({id:'crm-renewals',key:`renewals:${d.asOf}:${d.due}:${d.expired}`,source:'CRM · Contract review',label:`${d.due||0} ${d.due===1?"client has a renewal":"clients have renewals"} within 30 days`,description:`${d.expired||0} ${d.expired===1?"client has":"clients have"} a past contract end date. Review agreements and prepare follow-ups; Won status remains unchanged.`,actions:[{label:'Review contracts',run:()=>route('crm-clients')},{label:'Review follow-ups',run:()=>route('crm-activity')} ]});});
  doc.addEventListener('crm:notice',e=>{const n=e.detail;record('crm-notice',{id:n.id,title:n.title});offer({id:'crm-notice',key:'notice:'+n.id,source:'CRM · '+(n.kind||'Update'),label:n.title,description:n.message,actions:n.actions},{force:true});});
  doc.addEventListener('calling:outcome',e=>{const d=e.detail;record('calling',{id:d.id,status:d.status});offer({id:'calling-outcome',key:`call:${d.id}:${d.status}`,source:'Calling agent · '+d.status,label:d.label||'A call needs your review',description:d.description,actions:[{label:'Review call outcome',run:()=>route('calling')},{label:'Review CRM activity',run:()=>route('crm-activity')}]});});
  global.addEventListener('sarvam:thread',e=>{if(!e.detail?.final)return;const t=e.detail.thread||{};doc.dispatchEvent(new CustomEvent('calling:outcome',{detail:{id:t.id,status:t.status||'completed',label:'Call finished · review its recorded outcome',description:'Review the transcript, disposition and any follow-up draft before updating the client or sending outreach.'}}));});
  global.addEventListener('sarvam:run',e=>record('calling-run',{running:!!e.detail?.running,completed:e.detail?.completed,quota:!!e.detail?.quota}));
  doc.addEventListener('connector:result',e=>{const d=e.detail;record('connector',{id:d.id,status:d.status,provider:d.provider});if(d.status!=='failed')return;offer({id:'connector-failed',key:`connector:${d.id}:failed`,source:'Connectors · Needs attention',label:`${d.provider} action could not complete`,description:d.error||'Check its connection and recorded status before retrying.',actions:[{label:'Review action',run:()=>route('connectors')}]});});
  doc.addEventListener('rudra:motion-ready',()=>{if(step)global.RudraMotionUI?.show(step);});
  doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)drain();});
  doc.addEventListener('focusout',()=>{if(queue.length)scheduleDrain();});
  global.addEventListener('rudra:auth-state',reset);global.addEventListener('clavis:workspace-change',reset);
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',wrap,{once:true});else wrap();
  setTimeout(wrap,2500);
  global.ClavisAhead={offer,current,run,clear,tryConfirm,snooze,respond,context};
  global.ClavisProactive?.stop?.();
})(window);
