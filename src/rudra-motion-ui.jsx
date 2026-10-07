import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, LazyMotion, domAnimation, m, useAnimate, useReducedMotion } from 'motion/react';

const springs = { type: 'spring', duration: .76, bounce: .12 };
const listeners = new Set();
let island = null, menu = null, animateSurface;
const update = () => listeners.forEach(fn => fn());
const motionOff = () => document.documentElement.dataset.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;
function App() {
  const [, redraw] = useState(0), [custom, setCustom] = useState(false), [instruction, setInstruction] = useState('');
  const reduced = useReducedMotion(), [scope, animate] = useAnimate();
  useEffect(() => { const fn = () => redraw(n => n + 1); listeners.add(fn); animateSurface = animate; const cleanup = animateSidebarSections(); return () => { listeners.delete(fn); cleanup(); }; }, [animate]);
  useEffect(() => { setCustom(false); setInstruction(''); }, [island?.id]);
  const short = reduced || motionOff();
  const transition = short ? { duration: .12 } : springs;
  function choose(index) {
    if (!menu) return;
    const selected = menu.select, option = selected.options[index];
    if (!option || option.disabled || option.closest('optgroup')?.disabled) return;
    selected.selectedIndex = index; selected.dispatchEvent(new Event('input', { bubbles: true })); selected.dispatchEvent(new Event('change', { bubbles: true }));
    closeMenu();
  }
  function keyMenu(e) {
    if (!menu) return;
    const available = [...menu.select.options].map((o,i) => !o.disabled && !o.closest('optgroup')?.disabled ? i : -1).filter(i => i >= 0);
    let next = menu.active;
    if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
      e.preventDefault();
      const at = available.indexOf(next);
      next = e.key === 'Home' ? available[0] : e.key === 'End' ? available.at(-1) : available[(at + (e.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length];
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(next); return; }
    else if (e.key === 'Escape' || e.key === 'Tab') { if(e.key === 'Escape') e.preventDefault(); closeMenu(); return; }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      next = available.find(i => menu.select.options[i].text.toLocaleLowerCase().startsWith(e.key.toLocaleLowerCase())) ?? next;
    } else return;
    menu = { ...menu, active: next }; update();
    requestAnimationFrame(() => document.getElementById('rudra-option-' + next)?.scrollIntoView({ block: 'nearest' }));
  }
  return <LazyMotion features={domAnimation}><div ref={scope}>
    <AnimatePresence>
      {island && <m.section key={island.id} className="rudra-island" aria-label="Suggested next step" initial={{ opacity: 0, y: short ? 0 : -60, scaleX: short ? 1 : .16, scaleY: short ? 1 : .22, borderRadius: 42 }} animate={{ opacity: 1, y: 0, scaleX: 1, scaleY: 1, borderRadius: 22 }} exit={{ opacity: 0, y: short ? 0 : -52, scaleX: short ? 1 : .2, scaleY: short ? 1 : .18 }} transition={transition}>
        <header><svg className="rudra-island-mark" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4-5.7-3-5.7 3 1.1-6.4-4.6-4.5 6.4-.9Z"/></svg><span>{island.source || 'Rudra · Next step'}</span><button type="button" aria-label="Dismiss suggestion" onClick={() => window.ClavisAhead.clear('dismissed')}>×</button></header>
        <div className="rudra-island-copy" role="status"><h2>{island.label}</h2>{island.description && <p>{island.description}</p>}</div>
        <div className="rudra-island-actions">{(island.actions || [{ label: island.cta || 'Continue' }]).map((action,i) => <m.button key={action.label} type="button" whileTap={short ? {} : { scale: .975 }} onClick={() => window.ClavisAhead.run(i)}>{action.label}</m.button>)}<button type="button" aria-expanded={custom} onClick={() => setCustom(!custom)}>Suggest a different step</button><button type="button" onClick={() => window.ClavisAhead.snooze()}>Later</button></div>
        <AnimatePresence>{custom && <m.form className="rudra-island-form" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={transition} onSubmit={e => { e.preventDefault(); if(instruction.trim()) window.ClavisAhead.respond(instruction.trim()); }}><label htmlFor="rudra-island-instruction">What would you prefer?</label><textarea id="rudra-island-instruction" rows="2" autoFocus value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="Tell Rudra what to change, ask why, or choose another next step…" maxLength="2000"/><button type="submit" disabled={!instruction.trim()}>Send my instruction</button></m.form>}</AnimatePresence>
      </m.section>}
      {menu && <m.div key="select" ref={node=>{if(node?.showPopover && !node.matches(':popover-open'))node.showPopover();}} popover="manual" className="rudra-select-menu" role="listbox" aria-label={menu.label} tabIndex="-1" id="rudra-select-menu" aria-activedescendant={'rudra-option-' + menu.active} style={menu.rect} initial={{ opacity: 0, y: short ? 0 : -7, scale: short ? 1 : .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={short ? { duration: .1 } : { type: 'spring', duration: .42, bounce: 0 }} onKeyDown={keyMenu}>
        {[...menu.select.options].map((option,index) => <button key={index} id={'rudra-option-' + index} type="button" role="option" tabIndex="-1" aria-selected={index === menu.select.selectedIndex} disabled={option.disabled || option.closest('optgroup')?.disabled} className={menu.active === index ? 'is-active' : ''} onPointerMove={() => { if(menu.active !== index) {menu = {...menu, active:index}; update();} }} onClick={() => choose(index)}>{option.text}<span aria-hidden="true">{index === menu.select.selectedIndex ? '✓' : ''}</span></button>)}
      </m.div>}
    </AnimatePresence>
  </div></LazyMotion>;
}

function closeMenu() { if(!menu) return; const select=menu.select; menu=null; select.__rudraTrigger?.setAttribute('aria-expanded','false'); update(); if(mount.parentElement!==document.body)document.body.appendChild(mount);select.__rudraTrigger?.focus({preventScroll:true}); }
function openMenu(select) {
  if(select.disabled) return;
  if(menu?.select === select) { closeMenu(); return; }
  closeMenu();
  const trigger=select.__rudraTrigger, box=trigger.getBoundingClientRect(), height=Math.min(280,select.options.length*38+12), below=innerHeight-box.bottom-12;
  const dialog=select.closest('dialog[open],[role="dialog"][aria-modal="true"],#settings-overlay.open,#cx-setup-root.is-open');
  // Native modal top layers must contain the React portal too.
  mount.parentElement !== (dialog || document.body) && (dialog || document.body).appendChild(mount);
  menu={select,label:trigger.getAttribute('aria-label'),active:select.selectedIndex,rect:{position:'fixed',left:Math.max(8,Math.min(box.left,innerWidth-Math.min(Math.max(box.width,180),innerWidth-16)-8)),top:below>=Math.min(height,150)?box.bottom+6:Math.max(8,box.top-height-6),width:Math.min(Math.max(box.width,180),innerWidth-16),maxHeight:Math.min(height,below>=150?below:box.top-14)}};
  trigger.setAttribute('aria-expanded','true'); update(); requestAnimationFrame(()=>document.getElementById('rudra-select-menu')?.focus({preventScroll:true}));
}
function enhanceSelect(select) {
  if(select.multiple || select.size > 1 || select.__rudraTrigger || select.closest('[data-rudra-native-select]')) return;
  const trigger=document.createElement('button'); trigger.type='button';trigger.className='rudra-select-trigger';
  const valueLabel=document.createElement('span');valueLabel.className='rudra-select-value';trigger.appendChild(valueLabel);
  const labelText=select.getAttribute('aria-label') || [...(select.labels||[])].map(label=>{const copy=label.cloneNode(true);copy.querySelectorAll('select,button,input').forEach(n=>n.remove());return copy.textContent.trim();}).join(' ') || select.closest('.smodal-field,.cx-ap-row')?.querySelector('.smodal-label,label')?.textContent.trim() || select.name || 'Choose an option';
  trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-controls','rudra-select-menu');trigger.setAttribute('aria-expanded','false');
  select.insertAdjacentElement('afterend',trigger); select.__rudraTrigger=trigger;select.classList.add('rudra-native-select');
  const oldTab=select.tabIndex;select.tabIndex=-1;select.setAttribute('aria-hidden','true');
  function sync() {
    if(!trigger.isConnected)return;
    const text=select.selectedOptions[0]?.text || 'Choose',hidden=select.hidden || select.style.display==='none',tab=select.disabled?-1:Math.max(0,oldTab),label=select.getAttribute('aria-label')||labelText;
    if(valueLabel.textContent!==text)valueLabel.textContent=text;
    if(trigger.disabled!==select.disabled)trigger.disabled=select.disabled;
    if(trigger.hidden!==hidden)trigger.hidden=hidden;
    if(trigger.getAttribute('aria-label')!==label)trigger.setAttribute('aria-label',label);
    if(trigger.title!==select.title)trigger.title=select.title;
    if(trigger.tabIndex!==tab)trigger.tabIndex=tab;
  }
  trigger.addEventListener('click',e=>{e.preventDefault();sync();openMenu(select);});trigger.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','Enter',' '].includes(e.key)){e.preventDefault();openMenu(select);}});
  select.addEventListener('change',()=>{trigger.removeAttribute('aria-invalid');sync();});select.addEventListener('rudra:select-sync',sync);select.addEventListener('invalid',e=>{e.preventDefault();trigger.focus();trigger.setAttribute('aria-invalid','true');trigger.title=select.validationMessage;});
  for(const property of ['value','selectedIndex']){const descriptor=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,property);if(descriptor?.get&&descriptor?.set)Object.defineProperty(select,property,{configurable:true,get(){return descriptor.get.call(this);},set(value){descriptor.set.call(this,value);sync();}});}
  new MutationObserver(sync).observe(select,{attributes:true,childList:true,subtree:true,characterData:true});
  select.form?.addEventListener('reset',()=>setTimeout(sync,0));
  sync();
}
const RAIL_MIN = 64;
const desktopRail = () => matchMedia('(min-width: 769px)').matches;
const railTarget = (open) =>
  open ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-expanded')) || 220) : RAIL_MIN;

function animateSidebarSections() {
  const rail = document.getElementById('sidebar'); if (!rail) return () => {};
  const collapsed = () => rail.classList.contains('collapsed') && !rail.classList.contains('au-peek');

  /* Write the destination once. Native transitions own interpolation and
     reversal; the old JS spring wrote geometry every frame and notified
     the app's style observers throughout the animation. */
  const paint = (w) => {
    const px = w.toFixed(2) + 'px';
    rail.style.setProperty('width', px, 'important');
    rail.style.setProperty('min-width', px, 'important');
    rail.style.setProperty('max-width', px, 'important');
    const sheet = document.getElementById('main-content');
    if (sheet) {
      sheet.style.setProperty('margin-left', px, 'important');
      sheet.style.setProperty('width', 'calc(100% - ' + px + ')', 'important');
    }
  };
  const clear = () => {
    ['width','min-width','max-width'].forEach(k => rail.style.removeProperty(k));
    const sheet = document.getElementById('main-content');
    if (sheet) { sheet.style.removeProperty('margin-left'); sheet.style.removeProperty('width'); }
  };

  let previous = collapsed(), current = railTarget(!previous);
  const setSections = (v) => rail.style.setProperty('--rudra-section-open', String(v));
  setSections(previous ? 0 : 1);
  if (desktopRail()) paint(current);

  const observer = new MutationObserver(() => {
    const next = collapsed(); if (next === previous) return;
    previous = next;
    setSections(next ? 0 : 1);
    if (!desktopRail()) { clear(); return; }      // mobile drawer keeps its CSS
    current = railTarget(!next); paint(current);
  });
  observer.observe(rail, { attributes: true, attributeFilter: ['class'] });

  /* The resizer writes --sidebar-expanded live while dragging; the inline
     width has to follow it or the rail freezes at the old number. */
  const follow = new MutationObserver(() => {
    if (collapsed() || !desktopRail()) return;
    const w = railTarget(true); if (w === current) return;
    current = w; paint(w);
  });
  follow.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

  const mq = matchMedia('(min-width: 769px)');
  const onMq = () => { if (!mq.matches) clear(); else { current = railTarget(!collapsed()); paint(current); } };
  mq.addEventListener?.('change', onMq);
  return () => { observer.disconnect(); follow.disconnect(); mq.removeEventListener?.('change', onMq); };
}
function enhanceDialog(dialog){
  if(dialog.__rudraMotion)return;dialog.__rudraMotion=true;
  const show=dialog.showModal.bind(dialog),close=dialog.close.bind(dialog);let animation=null,closing=false,generation=0;
  dialog.showModal=function(){generation++;animation?.cancel();closing=false;show();animation=window.RudraMotionUI?.surface(dialog,true,.72);};
  dialog.close=function(value){if(!dialog.open||closing)return;closing=true;const ticket=++generation;animation?.cancel();const finish=()=>{if(ticket!==generation)return;closing=false;close(value);if(mount.parentElement===dialog)document.body.appendChild(mount);};animation=window.RudraMotionUI?.surface(dialog,false,.48);if(animation)animation.finished.then(finish,finish);else finish();};
  dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close();});
}
function scan(root) { if(root.matches?.('select'))enhanceSelect(root);if(root.matches?.('dialog'))enhanceDialog(root);root.querySelectorAll?.('select').forEach(enhanceSelect);root.querySelectorAll?.('dialog').forEach(enhanceDialog); }
const mount=document.createElement('div');mount.id='rudra-motion-root';mount.dataset.rudraI18nIgnore='';document.body.appendChild(mount);createRoot(mount).render(<App/>);
scan(document);
new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1 && !node.closest('#rudra-motion-root'))scan(node);}))).observe(document.body,{childList:true,subtree:true});
document.addEventListener('pointerdown',e=>{if(menu && !e.target.closest('.rudra-select-menu,.rudra-select-trigger'))closeMenu();},true);
document.addEventListener('scroll',e=>{if(menu && !e.target.closest?.('.rudra-select-menu'))closeMenu();},true);
window.addEventListener('resize',closeMenu);window.addEventListener('hashchange',closeMenu);
document.addEventListener('clavis:workspace-change',closeMenu);
document.addEventListener('keydown',e=>{if(!e.defaultPrevented&&e.key==='Escape' && island && !menu && !e.target.closest('[role="dialog"],dialog'))window.ClavisAhead.clear('dismissed');});

window.RudraMotionUI={
  show(step){island=step;update();}, hide(){island=null;update();},
  surface(element,opening=true,duration=.76){
    if(!animateSurface || motionOff())return null;
    if(opening){element.style.opacity='0';element.style.transform='translateY(-16px) scale(.96)';}
    const control=animateSurface(element,{opacity:opening?[0,1]:0,y:opening?[-16,0]:-16,scale:opening?[.96,1]:.96},{type:'spring',duration,bounce:.07});
    const result={finished:control.then(()=>{element.style.opacity='';element.style.transform='';result.onfinish?.();}),cancel:()=>control.stop(),onfinish:null};return result;
  },
  flip(element,from,to,duration=.8){
    if(!animateSurface || motionOff())return null;
    element.style.transformOrigin='0 0';element.style.transform=`translate(${from.left-to.left}px,${from.top-to.top}px) scale(${from.width/to.width},${from.height/to.height})`;
    const control=animateSurface(element,{x:[from.left-to.left,0],y:[from.top-to.top,0],scaleX:[from.width/to.width,1],scaleY:[from.height/to.height,1]},{type:'spring',duration,bounce:.06});
    const result={finished:control.then(()=>{element.style.transform='';element.style.transformOrigin='';result.onfinish?.();}),cancel:()=>control.stop(),onfinish:null};return result;
  },
  refreshSelects:()=>document.querySelectorAll('select').forEach(s=>s.dispatchEvent(new Event('rudra:select-sync')))
};
document.dispatchEvent(new CustomEvent('rudra:motion-ready'));
