/**
 * test_ai_intelligence.js
 * Verification suite for the elevated intelligence, proactivity, and domain expertise
 * across Client AI, Candidate AI, and Clavis AI Studio.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('\n--- Running AI Intelligence & Proactivity Verification Suite ---\n');

// Mock browser environment for testing
global.window = {
  UserProfileManager: {
    getHonorificName: () => 'Sir',
    getProfile: () => ({ company: 'Apex Security & Facilities' })
  },
  SKYLARK_CONFIG: {
    DEFAULT_CITY: 'Gurugram'
  },
  IndustryDB: {
    getNames: () => ['Hotels & Hospitality', 'Hospitals & Healthcare', 'IT Parks & Tech Companies']
  },
  allLeads: [
    { id: 1, name: 'Lead 1', status: 'New', industry: 'Hotels & Hospitality', city: 'Gurugram' }
  ]
};
global.localStorage = {
  getItem: (k) => null,
  setItem: (k, v) => {}
};
global.document = {
  getElementById: (id) => null
};

// 1. Test Client AI (chat.js)
console.log('1. Testing Client AI (chat.js)...');
const chatCode = fs.readFileSync(path.join(__dirname, 'chat.js'), 'utf8');

// Evaluate ChatEngine in mock context
const chatFn = new Function('window', 'localStorage', 'document', `${chatCode}; return ChatEngine;`);
const ChatEngine = chatFn(global.window, global.localStorage, global.document);

// Test system prompt
// We can test the system prompt by extracting getSystemPrompt or checking chatCode
assert(chatCode.includes('Senior B2B Revenue & Growth Architect'), 'Client AI prompt must define Senior B2B Revenue & Growth Architect persona');
assert(chatCode.includes('Decision-Maker Mapping'), 'Client AI prompt must contain Decision-Maker Mapping');
assert(chatCode.includes('PROACTIVE VALUE-ADD'), 'Client AI prompt must contain Proactive Value-Add');

// Test localParse via ChatEngine or regex extraction
const localParseMatch = chatCode.match(/function localParse\(message\) \{([\s\S]*?)\n  \}/);
assert(localParseMatch, 'localParse function must exist');
const localParseFn = new Function('message', 'window', `${localParseMatch[0]}; return localParse(message);`);

// 1.1 Greeting test
const greetingRes = localParseFn('hello', global.window);
assert.strictEqual(greetingRes.action, null, 'Greeting must not emit an action');
assert(greetingRes.text.includes('B2B Growth & Revenue Architect'), 'Greeting must reflect executive persona');
console.log('  PASS: Client AI greeting is warm, executive, and action-free');

// 1.2 Hospital pitch test
const hospitalRes = localParseFn('hospital clients ko pitch kaise kare', global.window);
assert.strictEqual(hospitalRes.action, null, 'Pitch query must not emit lead scraping action');
assert(hospitalRes.text.includes('Medical Superintendent'), 'Hospital pitch must map decision makers');
assert(hospitalRes.text.includes('Proactive Suggestion'), 'Hospital pitch must proactively offer next steps');
console.log('  PASS: Client AI hospital pitch provides decision makers, pain points, and proactive suggestion');

// 1.3 Corporate IT pitch test
const itRes = localParseFn('how to pitch to corporate it companies', global.window);
assert.strictEqual(itRes.action, null, 'Corporate pitch must not emit scraping action');
assert(itRes.text.includes('Statutory Compliance'), 'Corporate pitch must emphasize compliance');
console.log('  PASS: Client AI IT Park pitch emphasizes compliance and corporate priorities');

// 1.4 "Already have vendor" objection test
const objectionRes = localParseFn('agar client kahe already vendor hai', global.window);
assert.strictEqual(objectionRes.action, null, 'Objection handling must not emit action');
assert(objectionRes.text.includes('Backup / Renewal positioning'), 'Objection handler must teach backup positioning');
console.log('  PASS: Client AI objection handling teaches strategic backup positioning');

// 1.5 Explicit lead search still works!
const leadRes = localParseFn('find 20 hotel leads in Mumbai for security', global.window);
assert(leadRes.action, 'Explicit lead search must emit action');
assert.strictEqual(leadRes.action.type, 'generate', 'Action type must be generate');
assert(leadRes.action.cities.includes('Mumbai'), 'Action must contain Mumbai');
console.log('  PASS: Client AI explicit lead search triggers clean generate action');

// 2. Test Candidate AI (page-candidates.js)
console.log('\n2. Testing Candidate AI (page-candidates.js)...');
const candCode = fs.readFileSync(path.join(__dirname, 'page-candidates.js'), 'utf8');

assert(candCode.includes('Senior Talent Acquisition & Workforce Strategist'), 'Candidate AI must define Senior Talent Acquisition Strategist persona');
assert(candCode.includes('getLocalRecruitmentAdvice'), 'page-candidates.js must have getLocalRecruitmentAdvice');

const getLocalAdviceMatch = candCode.match(/getLocalRecruitmentAdvice\(query\) \{([\s\S]*?)\n  \},/);
assert(getLocalAdviceMatch, 'getLocalRecruitmentAdvice method must exist');
const getLocalAdviceFn = new Function('query', 'window', `function ${getLocalAdviceMatch[0].replace(/,$/, '')}; return getLocalRecruitmentAdvice(query);`);

// 2.1 Candidate AI Greeting
const candGreeting = getLocalAdviceFn('hello', global.window);
assert(candGreeting.includes('Talent Acquisition'), 'Greeting must reflect recruitment persona');
console.log('  PASS: Candidate AI greeting reflects Talent Acquisition persona');

// 2.2 Salary benchmarks
const salaryRes = getLocalAdviceFn('security guard ki salary kya hoti hai', global.window);
assert(salaryRes.includes('8-hr shift') && salaryRes.includes('12-hr shift'), 'Salary response must differentiate shifts');
assert(salaryRes.includes('PF/ESIC'), 'Salary response must mention statutory benefits');
console.log('  PASS: Candidate AI provides 8-hr vs 12-hr wage benchmarks with compliance tips');

// 2.3 Screening checklist
const screenRes = getLocalAdviceFn('interview me kya puchhe', global.window);
assert(screenRes.includes('Telephonic Screening Checklist'), 'Screening response must give checklist');
assert(screenRes.includes('Documentation Check'), 'Checklist must include documentation check');
console.log('  PASS: Candidate AI provides 5-point screening checklist');

// 2.4 Attrition reduction
const attritionRes = getLocalAdviceFn('guard log chhod ke kyu bhagte hai', global.window);
assert(attritionRes.includes('Reduce Staff Attrition'), 'Attrition response must give actionable strategies');
console.log('  PASS: Candidate AI provides actionable staff retention strategies');

// 3. Test Clavis AI Studio / Jarvis (jarvis.js)
console.log('\n3. Testing Clavis AI Studio (jarvis.js)...');
const jarvisCode = fs.readFileSync(path.join(__dirname, 'jarvis.js'), 'utf8');

assert(jarvisCode.includes('AI Executive Partner and Chief of Staff'), 'Jarvis must define Executive Partner & Chief of Staff persona');
assert(jarvisCode.includes('SECOND-ORDER THINKING'), 'Jarvis must include second-order thinking');
assert(jarvisCode.includes('ANTI-ROBOTIC LIFE & VARIETY'), 'Jarvis must include anti-robotic variety instructions');
console.log('  PASS: Clavis AI Studio prompt has Chief of Staff depth, second-order cognition, and anti-robotic variety');

console.log('\n✅ ALL AI INTELLIGENCE & PROACTIVITY TESTS PASSED!\n');
