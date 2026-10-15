const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('clavis-ear.js','utf8');
const section=source.slice(source.indexOf('  function melBank('),source.indexOf('  function pitchOf('));
const optimized={};vm.createContext(optimized);vm.runInContext('const MEL_BANDS=24,NCEP=12;'+section,optimized);
const original={};vm.createContext(original);vm.runInContext('const MEL_BANDS=24,NCEP=12;'+section.replace('bank[b].dct[c - 1]','Math.cos(Math.PI * c * (b + 0.5) / n)'),original);
for(const rate of [16000,44100,48000]) {
  const spectrum=Array.from({length:512},(_,i)=>i%29===0?-Infinity:-60+Math.sin(i*.7)*20);
  const bank=optimized.melBank(rate,1024),before=original.mfcc(spectrum,bank),after=optimized.mfcc(spectrum,bank);
  assert.deepEqual(Array.from(after),Array.from(before),'precomputed DCT preserves acoustic features');
}
assert.ok(!optimized.mfcc.toString().includes('Math.cos'),'frame path avoids 288 repeated cosine evaluations');
console.log('PASS cached acoustic coefficients: identical features at 16/44.1/48kHz');
