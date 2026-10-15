/* A local, deterministic product tour. No credentials, provider calls or persistence. */
(function () {
  'use strict';
  const industries = ['Hotels & Hospitality','Hospitals & Healthcare','IT Parks & Tech','Banks & Corporate','Factories & Manufacturing','Warehouses & Logistics','Schools & Colleges','Residential Societies','Security guards','Housekeeping staff','Office staff'];
  const cities = ['Gurugram','Delhi','Noida','Mumbai','Bengaluru','Jaipur'];
  function makeRecords(values, candidate = false) {
    const count = Number(values.count);
    if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('Choose a whole number from 1 to 20.');
    if (!industries.includes(values.industry) || !cities.includes(values.city)) throw new Error('Choose an available industry and city.');
    const area = String(values.area || '').trim();
    if (!area || area.length > 100) throw new Error('Enter a locality of up to 100 characters.');
    const names = ['Oakfield','Cedar','Willow','Meadow','Brookside'];
    return Array.from({length:count}, (_,i) => ({
      name: candidate ? 'Sample candidate ' + (i+1) : names[i%names.length] + ' · Sample business ' + (i+1),
      industry: values.industry, area: area + ', ' + values.city,
      source: candidate ? 'Fictional candidate' : values.source || 'Google Maps',
      type: 'Fictional demo', stage:'New', candidate
    }));
  }
  function csv(records) {
    const cell = value => '"' + String(value).replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g,'""') + '"';
    return [['Name','Industry or role','Area','Source','Data type'],...records.map(r=>[r.name,r.industry,r.area,r.source,r.type])].map(row=>row.map(cell).join(',')).join('\r\n');
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {makeRecords,csv};
  if (typeof document === 'undefined') return;
  const all = (selector, root=document) => [...root.querySelectorAll(selector)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const initial = [
    {name:'Oakfield Suites',industry:'Hotel',area:'Delhi',source:'Fictional sample',type:'Fictional demo',stage:'New'},
    {name:'Willow Care Centre',industry:'Healthcare',area:'Noida',source:'Fictional sample',type:'Fictional demo',stage:'New'},
    {name:'Cedar Business Park',industry:'Offices',area:'Gurugram',source:'Fictional sample',type:'Fictional demo',stage:'New'}
  ];
  let records = initial.slice(), customers = [initial[0]], candidateRecords=[], tasks = [], company='Example Service Team';
  const visibleRecords = view => ({'CRM records':customers,'Candidate records':candidateRecords}[view.querySelector('[data-data-filter]').value] || records);
  function download(list) {
    const url = URL.createObjectURL(new Blob([csv(list)],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a'); a.href=url; a.download='rudra24-fictional-demo.csv';
    document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function text(tag, value, className='') {
    const el=document.createElement(tag); el.textContent=value; el.className=className; return el;
  }
  function showRecords(root, list) {
    root.replaceChildren();
    if (!list.length) { root.append(text('p','No sample records in this view yet.')); return; }
    const heading=text('p',list.length+' fictional '+(list[0].candidate?'candidates':'businesses')+' · Review each record.','demo-result-label');
    root.append(heading);
    const group=document.createElement('div'); group.className='experience-records';
    list.forEach(record => {
      const detail=document.createElement('details'); detail.className='experience-record';
      const summary=document.createElement('summary');
      summary.append(text('b',record.name),text('span',record.area),text('span','View record →'));
      detail.append(summary);
      const body=document.createElement('div');
      body.append(text('p',(record.candidate?'Role: ':'Industry: ')+record.industry),text('p','Area: '+record.area),text('p','Source: '+record.source),text('p','Stage: '+record.stage),text('p',record.candidate?'This invented candidate has no real personal details.':'Contact details are unavailable in this demo. Real contacts must be checked against a source.'));
      detail.append(body); group.append(detail);
    });
    root.append(group);
  }
  function refreshData() {
    all('[data-data-view]').forEach(view=>{
      view.querySelector('[data-total-leads]').textContent=records.length;
      view.querySelector('[data-total-crm]').textContent=customers.length;
      view.querySelector('[data-total-tasks]').textContent=tasks.length;
      showRecords(view.querySelector('[data-data-results]'),visibleRecords(view));
    });
    all('[data-demo-company]').forEach(el=>el.textContent=company);
  }
  all('[data-data-view]').forEach(view=>{
    view.querySelector('[data-data-filter]').addEventListener('change',refreshData);
    view.querySelector('[data-data-export]').addEventListener('click',()=>{
      download(visibleRecords(view));
      view.querySelector('[data-data-status]').textContent='Your fictional sample CSV is ready.';
    });
  });
  refreshData();
  all('[data-move-deal]').forEach(button=>button.addEventListener('click',()=>{
    customers[0].stage=button.closest('[data-crm-demo]').querySelector('[data-deal]').closest('[data-stage]').dataset.stage;
    refreshData();
  }));

  // Native details remain usable without JavaScript. Enhance only their content motion.
  all('[data-experience-card]').forEach(card=>{
    const summary=card.querySelector('summary'), content=card.querySelector('.feature-content');
    let animation=null, opening=false;
    const setOpen=(open, animate)=>{
      if(animation) animation.cancel();
      opening=open;
      card.open=true; content.inert=!open;
      summary.setAttribute('aria-expanded',String(open));
      summary.querySelector('.card-open').firstChild.nodeValue=open?'Close preview ':'Try this feature ';
      if(!animate || reduced.matches || !content.animate) { card.open=open; return; }
      // Reserve the final layout immediately; controls must not slide under other cards.
      animation=content.animate(open?[{opacity:0,transform:'translateY(14px)',filter:'blur(2px)'},{opacity:1,transform:'none',filter:'blur(0px)'}]:[{opacity:1},{opacity:0}],{duration:open?700:240,easing:'cubic-bezier(.16,1,.3,1)'});
      animation.onfinish=()=>{card.open=open;content.inert=!open;animation=null;};
    };
    summary.setAttribute('aria-expanded',String(card.open));
    summary.addEventListener('click',event=>{
      event.preventDefault();
      setOpen(animation?!opening:!card.open,event.detail!==0);
    });
    card.addEventListener('keydown',event=>{
      if(event.key==='Escape' && card.open) {event.stopPropagation();summary.focus();setOpen(false,false);}
    });
    reduced.addEventListener('change',()=>{if(animation){animation.cancel();animation=null;card.open=opening;content.inert=!opening;}});
  });

  all('[data-experience]').forEach(form=>{
    const kind=form.dataset.experience, result=form.querySelector('[data-experience-results]'), status=form.querySelector('[data-experience-status]');
    const fields=form.querySelector('[data-experience-fields]');
    let timer=0, returned=[], run=0;
    const exportButton=form.querySelector('[data-demo-export]'), save=form.querySelector('[data-demo-save]'), stop=form.querySelector('[data-search-stop]');
    const finish=message=>{clearTimeout(timer);timer=0;fields.disabled=false;stop.hidden=true;exportButton.hidden=!returned.length;if(save)save.hidden=!returned.length||kind==='candidates';if(returned.length){if(kind==='candidates')candidateRecords=returned.slice();else records=returned.slice();refreshData();}status.textContent=message;};
    if(stop) {
      stop.addEventListener('click',()=>{run++;finish('Search stopped. '+returned.length+' fictional results kept for review and export.');});
      exportButton.addEventListener('click',()=>download(returned));
      save.addEventListener('click',()=>{
        returned.forEach(record=>{if(!customers.some(c=>c.name===record.name && c.area===record.area))customers.push(record);});
        refreshData();status.textContent=returned.length+' samples added to this visit’s CRM records. Your source records remain available below.';
      });
    }
    form.addEventListener('submit',event=>{
      event.preventDefault(); if(!form.reportValidity())return;
      const values=Object.fromEntries(new FormData(form));
      if(stop) {
        let found;
        try {found=makeRecords(values,kind==='candidates');} catch(error){status.textContent=error.message;return;}
        const current=++run; clearTimeout(timer);returned=[];result.replaceChildren();exportButton.hidden=save.hidden=true;
        // Keep Stop outside the disabled fieldset so cancellation remains available.
        fields.disabled=true;stop.disabled=false;stop.hidden=false;
        status.textContent='Demo search started: '+values.industry+' in '+values.area+', '+values.city+'.';
        const next=()=>{
          if(current!==run)return;
          returned.push(found[returned.length]);showRecords(result,returned);
          status.textContent='Demo search · '+returned.length+' of '+found.length+' fictional results.';
          if(returned.length===found.length){if(kind!=='candidates')records=returned.slice();refreshData();finish('Complete. '+returned.length+' fictional results match your requested count.');}
          else timer=setTimeout(next,220);
        };
        timer=setTimeout(next,350);return;
      }
      result.replaceChildren();
      let output='';
      if(['email','whatsapp','sms','calling'].includes(kind)) {
        const greeting=kind==='calling' && values.language==='Hindi'?'नमस्ते':'Hello';
        output=(kind==='email'?'Subject: '+values.service+' for '+values.recipient+'\n\n':'')+greeting+',\n\nThis is '+values.company+'. We offer '+values.service+'. Could we speak with the right person at '+values.recipient+' about your current needs?'+(kind==='sms'?'':'\n\nIf useful, may we share a short company introduction and agree on a follow-up?');
        if(kind==='calling' && values.language==='Hindi')output='नमस्ते, मैं '+values.company+' से बात कर रहा हूँ। हम '+values.service+' प्रदान करते हैं। क्या '+values.recipient+' में संबंधित व्यक्ति से बात हो सकती है? अगर समय उचित हो, तो हम अपनी कंपनी का परिचय साझा करना चाहेंगे।';
      } else if(kind==='assistant') {
        output='Example plan for: '+values.request+'\n\n1. Confirm the business, location and service you want to offer.\n2. Review the lead record and check its contact source.\n3. Prepare a short introduction from '+company+'.\n4. Add a follow-up after you confirm the next step.\n\nThis is a prepared demo response, not a live AI answer.';
      } else if(kind==='voice') {
        output=values.language==='Hindi'?'आपका उद्देश्य: '+values.request+'\n\nएजेंट: नमस्ते। क्या अभी एक छोटी बातचीत के लिए समय है?\nग्राहक: जी, बताइए।\nएजेंट: हम अपनी सेवा का संक्षिप्त परिचय साझा करना चाहेंगे। क्या आप सही व्यक्ति से बात करवा सकते हैं?':'Your goal: '+values.request+'\n\nAgent: Hello. Is this a convenient time for a short conversation?\nCustomer: Yes, go ahead.\nAgent: We would like to share a short service introduction. Who would be the right person to speak with?';
      } else if(kind==='calendar') {
        tasks.push({customer:values.recipient,date:values.date,time:values.time,task:values.request});refreshData();
        output='Sample follow-up saved\n'+values.recipient+' · '+values.date+' at '+values.time+' (local time)\n'+values.request+'\n\nNo calendar event or notification has been sent.';
      } else if(kind==='contracts') {
        output='Sample client record\n'+values.recipient+'\nService: '+values.service+'\nRenewal: '+values.date+'\n\nSaved in this open preview. No contract is signed or submitted.';
      } else if(kind==='settings') {
        company=values.company;refreshData();output='Preview company: '+company+'\nServices: '+values.service+'\nLanguage: '+values.language+'\n\nYour app settings are unchanged. This context is used by the assistant demo on this page.';
      } else {
        const provider=values.provider;
        output=provider+' · Setup preview\n\n1. Open the matching account or provider settings in the app.\n2. Choose your own account and review the required permissions.\n3. Configure the workflow and check its connection status.\n4. Review the destination and confirm a small test when ready.\n\n';
        output+=/Voice|Calling|telephony/i.test(provider)?'Calling also needs a running backend, a phone or SIP connection, provider credentials and applicable usage charges.':/Lead sourcing/.test(provider)?'Live sourcing requires your configured sourcing provider. Contact availability varies.':/AI provider/.test(provider)?'AI tasks require a configured model and provider. Quotas and charges depend on your account.':'The demo does not authenticate, connect or install anything. Real setup takes place in your app.';
        if(values.request)output+='\nSelected workflow: '+values.request;
      }
      if(['email','whatsapp','sms','calling'].includes(kind)) {
        const label=document.createElement('label');label.className='editable-draft';label.append(text('span','Your draft · edit before using'));
        const area=document.createElement('textarea');area.value=output;area.rows=8;area.maxLength=2000;label.append(area);result.append(label);
      } else result.append(text('pre',output,'experience-response'));
      status.textContent=['calendar','contracts','settings'].includes(kind)?'Sample saved for this preview.':'Preview ready. Review the example below.';
    });
    fields.disabled=false;
    if(stop) fields.after(stop); // Keep cancellation enabled and above the growing results.
  });
})();
