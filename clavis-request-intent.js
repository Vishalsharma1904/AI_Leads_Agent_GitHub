/* Asking about an action does not authorize it. Quoted examples are data. */
(function(global){
'use strict';
function classify(value){
 const t=String(value||'').normalize('NFKC').trim().toLowerCase();
 if(global.ClavisAppMap?.guide?.isQuestion(t)) return {kind:'question',answerOnly:true,appGuidance:true,reason:'app-information-request'};
 const p=t.replace(/"[^"\n]*"|“[^”]*”|`[^`]*`/g,' ');
 const no=/\b(?:do not|don't|dont|never|without)\s+(?:actually\s+)?(?:generate|find|scrape|send|run|execute)|\b(?:mat|nahi|nahin)\s+(?:karo|bhejo|nikalo|nikaalo|chalao)|(?:मत|नहीं)\s*(?:करो|भेजो|निकालो|चलाओ)/i.test(p);
 const explain=/^(?:please\s+)?(?:explain|describe|tell me about|what|why|how|when|where|which|who|elaborate)\b|\b(?:kaise|kyun|kyu|kya hota|kya hai|samjhao|samjha do|possible|can we|can i|could we|is it possible|what can|how can)\b|(?:कैसे|क्यों|क्या है|क्या होता|समझाओ|क्या हम|क्या मैं)/i.test(p);
 const capability=/\b(?:kya\s+(?:ham|hum|mai|main|mera|hamara)|kar\s+sakte\s+(?:hain|hai|h|hen)|what\s+(?:can|does)\s+(?:you|the|my|our))\b|(?:क्या.*(?:कर सकता|कर सकती|कर सकते)|हर.*इंडस्ट्री)/i.test(p);
 const execute=/^(?:please\s+|ab\s+|now\s+|mujhe\s+|mere liye\s+)*(?:find|generate|search|scrape|send|export|download|open|run|create|schedule|enrich|delete|update|show|list)\b|\b(?:nikalo|nikaalo|nikal do|nikaal do|generate karo|bhejo|bhej do|kholo|chalao|chahiye|chahie|leads do|leads dikhao|leads lao)\b|(?:निकालो|निकाल दो|भेजो|भेज दो|खोलो|चलाओ|चाहिए|जनरेट करो)/i.test(p);
 const polite=/^(?:please\s+)?(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:find|generate|search|scrape|send|export|download|open|run|create|schedule|enrich|show|list)\b|\bkya\s+(?:tum|aap)\b.*(?:nikal|nikaal|bhej|generate).*sakte|(?:क्या (?:तुम|आप).*(?:निकाल|भेज|जनरेट))/i.test(p);
 const compound=/(?:[;.!?]\s*|\b(?:then|and then|if yes|toh|phir)\s+)(?:please\s+)?(?:find|generate|scrape|send|run|nikalo|nikaalo|bhejo)\b/i.test(p);
 const broadCapability = /^(?:can|could|would) you (?:please )?(?:generate|find|scrape|search)\b/.test(p) && !/\d|\b(?:in|near|from|now|today|for me|mere liye)\b/.test(p);
 const reflective = /\b(?:whether|wonder|capable|capabilities|can my|can our|can this|can the ai|what you can|kya kar sakta|kya kar sakti)\b|क्या.*(?:कर सकता|कर सकती)/.test(p);
 const conversational = /^(?:hi|hello|hey|namaste|thanks|thank you|shukriya|kaise ho)[.! ]*$|\b(?:aur|and|also)\b.*\b(?:fayda|faida|benefits?|meaning|matlab|explain|batao|samjhao)\b|^(?:tell me more|go on|elaborate more)\b|(?:और.*(?:फायदा|लाभ|मतलब|बताओ|समझाओ)|नमस्ते|धन्यवाद)/i.test(p);
 const kind=no||broadCapability?'question':compound||polite||(execute&&!explain&&!capability)?'action':explain||capability||reflective||conversational||/[?？]$/.test(p)?'question':'ambiguous';
 return {kind,answerOnly:kind==='question',reason:no?'explicit-no-action':kind==='question'?'information-request':kind==='action'?'execution-request':'context-required'};
}
function capabilityAnswer(value, elaborate){
 const t=String(value||'').toLowerCase();
 if (!/leads?|लीड/.test(t) || !/my ai|our ai|this ai|using.*ai|can we|can i|har ek industry|every industry|all industries|kya (?:ham|hum)|क्या हम|हर.*इंडस्ट्री/.test(t)) return '';
 if (!/\bcan\b.*\b(?:generate|find|source|search|do)\b|kar\s+sakte|kr\s+sakte|every industry|all industries|har ek industry|(?:क्या.*सकते)/.test(t)) return '';
 const hinglish=/\b(?:kya|ham|hum|har|liye|sakte|hai|hain)\b/.test(t);
 if (/[\u0900-\u097f]/.test(t)) return elaborate
   ? '**हाँ, कई industries में public business leads खोज सकते हैं।**\n\nIndustry, exact location और required count के अनुसार search होती है। Public listings और official websites से उपलब्ध जानकारी मिलती है; private या unavailable contacts की guarantee नहीं है।\n\nएक request में 1–100 leads माँग सकते हैं। जितने verified results मिलें, वही दिखेंगे; कम results मिलने पर partial progress दिखेगी। नए और पुराने account-owned records CRM में जुड़े रहते हैं, जहाँ remarks, deals और follow-ups manage कर सकते हैं।\n\nयह केवल capability का जवाब है; अभी कोई search या message send नहीं हुआ।'
   : '**हाँ—कई industries में public business leads खोज सकते हैं।**\n- Industry, exact location और required count के अनुसार search होती है।\n- Verified contacts और पूरा count public data तथा connected providers पर निर्भर हैं; हर industry में guarantee नहीं है।';
 if (hinglish) return elaborate
   ? '**Haan, kai industries mein public business leads dhoondh sakte hain.**\n\nIndustry, exact location aur required count dekar focused search hoti hai. Public listings aur official websites se available details milti hain; private ya unavailable contacts ki guarantee nahi hai.\n\nEk request mein 1–100 leads maang sakte hain. Jitne verified results milen, wahi dikhenge; kam results par partial progress milegi. Account ki past aur new leads CRM mein judti hain, jahan remarks, deals aur follow-ups manage kar sakte hain.\n\nYeh capability ka explanation hai; abhi koi search ya message send nahi hua.'
   : '**Haan—kai industries mein public business leads dhoondh sakte hain.**\n- Industry, exact location aur required count ke hisaab se search hoti hai.\n- Verified contacts aur poora count public data aur connected providers par depend karte hain; har industry mein guarantee nahi hai.';
 return elaborate
   ? '**Many industries are supported, subject to public data availability.**\n\nSpecify the industry, exact location and requested quantity. The app searches public business listings and official websites; private or unavailable contact details cannot be guaranteed.\n\nA request accepts 1–100 leads. Only verified results are shown, with partial progress when fewer are available. Account-owned past and new leads connect to the CRM for remarks, deals and follow-ups.\n\nThis explains the capability; it does not launch a search or send a message.'
   : '**Yes—many industries can be searched using public business data.**\n- Specify an industry, exact location and requested quantity.\n- Verified contacts and the full count depend on public data and connected providers; coverage of every industry cannot be guaranteed.';
}
global.ClavisRequestIntent={classify,capabilityAnswer};
})(typeof window!=='undefined'?window:globalThis);
