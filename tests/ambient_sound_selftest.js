const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const s=fs.readFileSync('luxury-sound.js','utf8'),a=s.indexOf('  function uiTick(zone) {'),b=s.indexOf('\n  // Settings:',a),partials=[],noises=[];
vm.runInNewContext(s.slice(a,b)+'\nuiTick("ui");uiTick("sidebar");',{getTheme:()=> 'ambient',partial:(zone,p)=>partials.push({zone,...p}),noise:(zone,p)=>noises.push(p)});
assert.equal(partials.length,4);assert.ok(partials.every(p=>!p.bend&&p.attack>=.018&&p.gain<=.085));assert.ok(noises.every(p=>p.from===p.to&&p.gain<=.012));
console.log('Ambient clicks: fixed harmonics, soft attack, low gain and no water-drop pitch sweep.');
