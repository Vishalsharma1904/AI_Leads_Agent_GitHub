/* Private capability notifications, disclosure and authenticated account cleanup. */
(() => {
  'use strict';
  let unauth = 0, identity = '', generation = 0, controller = null, snapshot = null, notice, disclosure;
  const auth = () => window.SupabaseAuth;
  const base = () => (window.SKYLARK_CONFIG?.BACKEND_URL || '').replace(/\/+$/, '');
  const userId = () => auth()?.getUser?.()?.id || '';
  const node = (tag,text) => {const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const dispatch = () => window.dispatchEvent(new CustomEvent('rudra:capabilities',{detail:snapshot}));
  // 401 = access token stale. Refresh once (Supabase keeps a refresh token);
  // sign out only if that fails too. Signing out on the first 401 sent the
  // user back to the login page again and again.
  async function reauth(){try{const r=await auth()?.getClient?.()?.auth?.refreshSession?.();if(r?.data?.session)return true;}catch(_){}await auth()?.signOut?.();return false;}
  async function request(path,method='GET',body,signal=controller?.signal,retried=false) {
    const token=auth()?.getAccessToken?.();if(!token)throw Error('Sign in first');
    const response=await fetch(base()+'/api/control'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal});
    if(response.status===401){if(!retried&&await reauth())return request(path,method,body,signal,true);if(retried)await auth()?.signOut?.();throw Error('Session revoked. Sign in again.');}
    const result=await response.json().catch(()=>({}));if(!response.ok)throw Error(typeof result.detail==='string'?result.detail:'Account control unavailable');return result;
  }
  function render(value) {
    if(!notice){notice=node('div');notice.className='rudra-access-note';notice.setAttribute('role','status');document.body.append(notice);}
    const manual=['active','trial'].includes(value.status)&&(!value.expires_at||value.expires_at>Date.now()/1000);
    const usable=value.testing||value.owner||value.subscription?.active||manual;
    notice.hidden=usable&&value.status!=='blocked';notice.textContent=value.status==='blocked'?'Your access is paused. Contact support.':'Sign in is complete. Subscribe or contact support to activate services.';
    const seenKey='rudra_disclosure_'+value.disclosure.version+'_'+userId();
    let seen=false;try{seen=localStorage.getItem(seenKey)==='1';}catch(_){}
    if(seen&&!value.disclosure.accepted)request('/disclosure','POST',{version:value.disclosure.version,accepted:true}).catch(()=>{});
    // Testing phase (server not in managed mode): no pop-ups at all.
    if(value.testing&&disclosure){disclosure.remove();disclosure=null;}
    if(!value.testing&&!value.disclosure.accepted&&!disclosure&&!seen){
      disclosure=node('div');disclosure.className='rudra-disclosure';const panel=node('section');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','rudra-disclosure-title');const title=node('h2','Your workspace & support');title.id='rudra-disclosure-title';
      const text=node('p','Rudra24 stores your account and synced app work in the cloud. The app owner can review your email, subscription, device activity, usage, synced chats, leads, tasks and available call transcripts/recordings to manage services and support. Offline changes appear after they sync. Passwords and provider API keys are not shown in the panel.');
      const accept=node('button','I understand — continue');accept.className='di-button';const state=node('p');state.setAttribute('role','status');accept.addEventListener('click',()=>{try{localStorage.setItem(seenKey,'1');}catch(_){}disclosure?.remove();disclosure=null;request('/disclosure','POST',{version:value.disclosure.version,accepted:true}).catch(()=>{});});
      const logout=node('button','Sign out');logout.className='di-button';logout.addEventListener('click',()=>auth()?.signOut?.());panel.append(title,text,state,accept,logout);disclosure.append(panel);disclosure.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();return;}if(event.key!=='Tab')return;const targets=[...panel.querySelectorAll('button:not(:disabled)')];const first=targets[0],last=targets.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}});document.body.append(disclosure);accept.focus();
    }
  }
  async function refresh(epoch) {const value=await request('/me');if(epoch!==generation)return;snapshot=value;render(value);dispatch();window.ClavisKeyVault?.refresh?.().catch?.(()=>{});}
  async function connect(epoch) {
    let delay=1000;
    while(epoch===generation&&identity){
      try{
        if(document.hidden||!navigator.onLine){await new Promise(r=>setTimeout(r,1000));continue;}
        const response=await fetch(base()+'/api/control/events',{headers:{Authorization:'Bearer '+auth().getAccessToken()},signal:controller.signal});
        if(response.status===401){if(++unauth>2||!(await reauth())){if(unauth>2)await auth()?.signOut?.();break;}await new Promise(r=>setTimeout(r,2000));continue;}unauth=0;if(!response.ok||!response.body)throw Error('Notifications unavailable');
        const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
        try{while(epoch===generation){const{value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});if(buffer.length>16384)throw Error('Invalid notification');let split;while((split=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,split);buffer=buffer.slice(split+2);if(frame.startsWith('event: revoked')){await auth().signOut();return;}if(frame.startsWith('data: ')){JSON.parse(frame.slice(6));await refresh(epoch);delay=1000;}}}}
        finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      }catch(error){if(epoch!==generation||error.name==='AbortError')return;window.dispatchEvent(new CustomEvent('rudra:control-offline'));}
      if(epoch!==generation)return;
      await new Promise(r=>setTimeout(r,delay));delay=Math.min(30000,delay*2);
      try{await refresh(epoch);}catch(_){/* Keep last known display; backend still enforces every request. */}
    }
  }
  function identityChanged() {
    const next=userId();if(next===identity)return;
    identity=next;generation++;controller?.abort();controller=new AbortController();snapshot=null;notice?.remove();notice=null;disclosure?.remove();disclosure=null;
    document.querySelectorAll('#developer-control #dc-body').forEach(n=>n.replaceChildren());
    window.dispatchEvent(new CustomEvent('rudra:account-changed',{detail:{user_id:next}}));
    if(next){const epoch=generation;refresh(epoch).catch(()=>{});connect(epoch);}
  }
  function signalActivity(kind,state=''){if(!identity||document.hidden)return Promise.resolve(false);return request('/activity','POST',{kind,page:(location.hash||'#dashboard').split('?')[0],state}).catch(()=>false);}
  window.addEventListener('rudra:auth-state',identityChanged);
  window.addEventListener('hashchange',()=>signalActivity('route'));
  window.addEventListener('online',()=>{if(identity)refresh(generation).catch(()=>{});});
  window.addEventListener('visibilitychange',()=>{if(!document.hidden&&identity)refresh(generation).catch(()=>{});});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',identityChanged,{once:true});else identityChanged();
  window.RudraAccountControl={snapshot:()=>snapshot,refresh:()=>refresh(generation),activity:signalActivity};
})();
