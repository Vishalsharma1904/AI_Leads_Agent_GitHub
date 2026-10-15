// Mobile capability refresh uses the same authenticated control plane as desktop.
export function mobileControl({api, userId, logout, status}) {
  const sessionId=crypto.randomUUID();let deviceId;try{deviceId=localStorage.getItem('rudra-mobile-device-id')||crypto.randomUUID();localStorage.setItem('rudra-mobile-device-id',deviceId);}catch(_){deviceId=crypto.randomUUID();}
  let current = '', epoch = 0, policy = null, dialog;
  const change = () => { const next=userId();if(next===current)return;current=next;epoch++;policy=null;dialog?.remove();dialog=null;document.getElementById('mobile-access-policy')?.remove(); };
  function disclosure(value,generation) {
    if(value.disclosure.accepted||dialog)return;
    dialog=document.createElement('dialog');dialog.className='control-disclosure';
    const title=document.createElement('h2');title.textContent='Your workspace & support';
    const text=document.createElement('p');text.textContent='The Rudra24 owner can review your account, devices, usage, synced chats/leads/tasks and available call transcripts/recordings to manage service and support. Passwords and provider keys are not displayed. Offline changes appear after sync.';
    const message=document.createElement('p');message.setAttribute('role','status');
    const accept=document.createElement('button');accept.textContent='I understand — continue';accept.onclick=async()=>{accept.disabled=true;try{await api('/api/control/disclosure',{version:value.disclosure.version,accepted:true});if(generation!==epoch)return;dialog?.close();dialog?.remove();dialog=null;await refresh();}catch(error){message.textContent=error.message;}finally{accept.disabled=false;}};
    const exit=document.createElement('button');exit.className='secondary';exit.textContent='Sign out';exit.onclick=()=>{logout();change();};
    dialog.addEventListener('cancel',event=>event.preventDefault());dialog.append(title,text,message,accept,exit);document.body.append(dialog);dialog.showModal();
  }
  async function refresh() {
    change();if(!current||!navigator.onLine||document.hidden)return;
    const generation=epoch,value=await api('/api/control/me');if(generation!==epoch)return;policy=value;
    let banner=document.getElementById('mobile-access-policy');if(!banner){banner=document.createElement('p');banner.id='mobile-access-policy';banner.setAttribute('role','status');document.body.append(banner);}
    const manual=['active','trial'].includes(value.status)&&(!value.expires_at||value.expires_at>Date.now()/1000);
    banner.hidden=value.status!=='blocked'&&(value.owner||value.subscription.active||manual);
    banner.textContent=value.status==='blocked'?'Access paused. Contact the workspace owner.':'Sign in complete. Subscribe or contact the workspace owner to activate services.';
    disclosure(value,generation);
    await api('/api/insights/heartbeat',{session_id:sessionId,device_id:deviceId,device_label:'Mobile browser',platform:/Android/i.test(navigator.userAgent)?'Android':/iPhone|iPad/i.test(navigator.userAgent)?'iOS':'Browser',region:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',active:true}).catch(()=>{});
  }
  const timer=setInterval(()=>{if(userId()&&navigator.onLine&&!document.hidden)refresh().catch(error=>status(error.message));else change();},30000);
  window.addEventListener('online',()=>refresh().catch(error=>status(error.message)));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh().catch(()=>{});});
  return {refresh,reset:change,snapshot:()=>policy,destroy:()=>{clearInterval(timer);dialog?.remove();}};
}
