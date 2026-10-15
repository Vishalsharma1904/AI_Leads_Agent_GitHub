// Fake DOM + fetch: ek batch me 3 leads, 1 WhatsApp par nahi -> 2 sent, 1 skip, sab markSent.
const els = {}; const el = id => els[id] ||= { id, hidden:false, disabled:false, textContent:'', value:'', checked:false, src:'', listeners:{}, addEventListener(t,f){this.listeners[t]=f;}, dispatchEvent(){} };
global.document = { getElementById: el, addEventListener(t,f){ if(t==='DOMContentLoaded') global.__init=f; } };
global.window = { addEventListener(){}, showToast:(...a)=>console.log('toast',a.join(' | ')) };
global.location = { hash:'' }; global.confirm = () => true;
global.setTimeout = (f) => (Promise.resolve().then(f), 0); global.clearTimeout = () => {};
const sent = [], marked = [];
window.WhatsAppCtrl = { queue: [{company:'A',phone:'9876543210'},{company:'B',phone:'9000000000'},{company:'C',phone:'+44 7700 900123'}],
  refreshQueue(){}, renderMessage: l => `Hi ${l.company}`, async markSent(l){ marked.push(l.company); } };
global.fetch = async (url, opt={}) => {
  const ok = d => ({ ok:true, json: async()=>d });
  if (url.includes('sessions?name=')) return ok([{ id:'S1', status:'ready', phone:'919999999999' }]);
  if (url.includes('/contacts/check/')) { const n = url.split('/').pop(); return ok({ exists: n !== '919000000000', whatsappId: n + '@c.us' }); }
  if (url.includes('send-text')) { sent.push(JSON.parse(opt.body)); return ok({ messageId:'m' }); }
  throw new Error('unexpected ' + url);
};
require(require('path').join(__dirname, '..', 'openwa.js')); __init();
setImmediate(async () => {
  await new Promise(r => setTimeout(r)); await new Promise(r=>setImmediate(r));
  el('wa-openwa-body').value = 'Hi {Company}'; el('wa-openwa-consent').checked = true; el('wa-openwa-size').value = '10';
  await el('wa-openwa-send').listeners.click();
  const assert = require('assert');
  assert.deepStrictEqual(sent.map(s => s.chatId), ['919876543210@c.us', '447700900123@c.us']);
  assert.deepStrictEqual(marked, ['A', 'C']);
  assert.match(el('wa-openwa-progress').textContent, /2 bheje, 1 skip/);
  console.log('PASS', el('wa-openwa-progress').textContent, '|', el('wa-openwa-status').textContent);
});
