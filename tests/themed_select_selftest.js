const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('src/rudra-motion-ui.jsx','utf8');
const body=source.slice(source.indexOf('function enhanceSelect('),source.indexOf('function enhanceDialog('));
let writes=0,observer;
class Element {
  constructor(){this.attrs={};this.events={};this.children=[];this.isConnected=true;this.style={};this.classList={add(){}};this.tabIndex=0;this.hidden=false;this.disabled=false;this.title='';}
  getAttribute(k){return this.attrs[k]??null;} setAttribute(k,v){writes++;this.attrs[k]=v;}
  removeAttribute(k){delete this.attrs[k];} addEventListener(k,fn){this.events[k]=fn;}
  closest(){return null;} focus(){this.focused=true;}
  appendChild(node){this.children.push(node);}
  set textContent(v){writes++;this.text=v;} get textContent(){return this.children.length?this.children.map(n=>n.textContent).join(''):this.text;}
}
class Select extends Element {
  constructor(){super();this.options=[{text:'One',value:'1'},{text:'Two',value:'2'}];this.index=0;this.labels=[];this.size=1;this.name='Stage';}
  get selectedIndex(){return this.index;} set selectedIndex(v){this.index=v;}
  get value(){return this.options[this.index]?.value;} set value(v){this.index=this.options.findIndex(o=>o.value===v);}
  get selectedOptions(){return [this.options[this.index]].filter(Boolean);}
  insertAdjacentElement(_,el){this.trigger=el;}
}
const ctx={document:{createElement:()=>new Element()},HTMLSelectElement:Select,MutationObserver:class{constructor(fn){observer=fn;}observe(){}},setTimeout:fn=>fn(),openMenu(){}};
vm.createContext(ctx);vm.runInContext(body,ctx);
const select=new Select();select.form=new Element();ctx.enhanceSelect(select);
assert.equal(select.trigger.textContent,'One');
const stable=writes;observer();observer();assert.equal(writes,stable,'unchanged sync must not mutate the DOM');
select.value='2';assert.equal(select.trigger.textContent,'Two');
select.disabled=true;observer();assert.equal(select.trigger.disabled,true);assert.equal(select.trigger.tabIndex,-1);
select.disabled=false;select.hidden=true;observer();assert.equal(select.trigger.hidden,true);
select.hidden=false;select.index=0;select.form.events.reset();assert.equal(select.trigger.textContent,'One');
const trigger=select.trigger;ctx.enhanceSelect(select);assert.equal(select.trigger,trigger,'initialization is idempotent');
console.log('Themed select: stable DOM, programmatic updates, disabled/hidden state, reset and idempotent initialization pass.');
let collapsed=false,peek=false,callback,animationCount=0,stopped=0;
const rail={classList:{contains:n=>n==='collapsed'?collapsed:peek},style:{setProperty(k,v){this[k]=v;}}};
const side={document:{getElementById:()=>rail},motionOff:()=>false,MutationObserver:class{constructor(fn){callback=fn;}observe(){}disconnect(){}}};
vm.createContext(side);vm.runInContext(source.slice(source.indexOf('function animateSidebarSections('),source.indexOf('function enhanceDialog(')),side);
side.animateSidebarSections((element,values)=>{animationCount++;element.style.setProperty('--rudra-section-open',values['--rudra-section-open']);return{stop(){stopped++;}};});
assert.equal(rail.style['--rudra-section-open'],'1');collapsed=true;callback();assert.equal(rail.style['--rudra-section-open'],0);callback();assert.equal(animationCount,1);
peek=true;callback();assert.equal(rail.style['--rudra-section-open'],1);peek=false;callback();assert.equal(stopped,2,'reversing motion cancels the previous animation');
console.log('Sidebar React motion: collapsed spacing, hover expansion, reversal and unchanged-state guards pass.');
