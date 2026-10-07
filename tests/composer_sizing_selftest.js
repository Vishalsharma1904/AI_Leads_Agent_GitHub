const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let reads=0,width=600,frameId=0,resize;
const frames=new Map();
function style(){return {setProperty(k,v){this[k]=v;},getPropertyValue(k){return this[k]||'';}};}
const input={isConnected:true,value:'',rows:1,style:style(),dataset:{},classList:{toggle(){},remove(){}},matches:()=>false,closest:()=>null,
  events:{},addEventListener(k,f){(this.events[k]||=[]).push(f);},dispatchEvent(){},getBoundingClientRect(){reads++;return {width};}};
const document={readyState:'complete',hidden:false,documentElement:{},body:{appendChild(){}},addEventListener(){},querySelectorAll:()=>[input],
  createElement(){return {style:style(),setAttribute(){},value:'',get scrollHeight(){return 28*Math.ceil(Math.max(1,this.value.length)/(parseFloat(this.style.width)/8));}};}};
const context={document,ResizeObserver:class{constructor(f){resize=f;}observe(){resize([{contentRect:{width}}]);}},MutationObserver:class{observe(){}},
  getComputedStyle:()=>({getPropertyValue:()=>'',borderTopWidth:0,borderBottomWidth:0}),CustomEvent:class{},
  requestAnimationFrame(f){frames.set(++frameId,f);return frameId;},cancelAnimationFrame:id=>frames.delete(id),addEventListener(){}};
context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync('composer-sizing.js','utf8'),context);
function flush(){const batch=[...frames.values()];frames.clear();batch.forEach(f=>f());}
flush();assert.equal(reads,1);assert.equal(input.style.height,'28px');
for(let i=0;i<40;i++){input.value+='a';input.events.input.forEach(f=>f());input.events.input.forEach(f=>f());assert.equal(frames.size,1);flush();}
assert.equal(reads,1,'typing reuses geometry instead of forcing forty layouts');
width=160;resize([{contentRect:{width}}]);flush();assert.equal(reads,2);assert.equal(input.style.height,'56px');
input.value='a'.repeat(500);input.events.input.forEach(f=>f());flush();assert.equal(input.style.height,'208px');assert.equal(input.style.overflowY,'auto');
input.value='';input.events.input.forEach(f=>f());flush();assert.equal(input.style.height,'28px');assert.equal(input.style.overflowY,'hidden');
context.ClavisComposerSizing.invalidate();flush();assert.equal(reads,3,'font/theme invalidation remeasures even without a width change');
assert.equal(context.ClavisComposerSizing.attach(input).input,input);
console.log('Shared composer: one sizing frame, no repeated geometry reads, resize/font invalidation, multiline cap and empty reset pass.');
