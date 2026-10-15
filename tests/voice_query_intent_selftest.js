const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const views=[];
const window={showView:view=>views.push(view),addEventListener(){}};
const context={window,document:{readyState:'loading',addEventListener(){},getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]},localStorage:{getItem:()=>null,setItem(){}},console,setTimeout:()=>0,clearTimeout(){}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('clavis-intent.js','utf8'),context);
(async()=>{
  for(const query of ['leads dikhao','leads ki list dikhao','show leads','show my saved leads','लीड्स दिखाओ']) {
    const result=await window.ClavisIntent.route(query,{source:'voice'});
    assert.equal(result.handled,true,query);
    assert.equal(views.at(-1),'leads');
  }
  assert.equal(views.length,5,'all view requests use local navigation');
  console.log('PASS saved-lead view commands: no model or sourcing request');
})().catch(error=>{console.error(error);process.exitCode=1;});
