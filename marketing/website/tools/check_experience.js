'use strict';
const assert = require('node:assert/strict');
const {makeRecords,csv} = require('../experience.js');
const values={industry:'Hotels & Hospitality',city:'Gurugram',area:'Sector 29',count:'3',source:'Google Maps'};
for(const count of [1,3,20]) {
  const rows=makeRecords({...values,count});
  assert.equal(rows.length,count);
  assert(rows.every(row=>row.area==='Sector 29, Gurugram' && row.type==='Fictional demo'));
  assert.equal(new Set(rows.map(row=>row.name)).size,count);
}
for(const count of [0,21,2.5,'bad'])assert.throws(()=>makeRecords({...values,count}));
for(const override of [{city:'Unknown'},{industry:'Unknown'},{area:' '},{area:'x'.repeat(101)}])assert.throws(()=>makeRecords({...values,...override}));
assert(makeRecords({...values,industry:'Security guards'},true).every(row=>row.candidate && !('phone' in row)));
assert(csv(makeRecords({...values,area:'=1+2'})).includes("\"'=1+2, Gurugram\""));
assert(csv(makeRecords({...values,area:'A "quoted" place'})).includes('A ""quoted"" place'));
console.log('PASS: exact counts, location scope, validation, fictional candidates and CSV quoting/formula safety.');
