
import re
with open('agent.js', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Replace SmartLeadGenerator with RealLeadExtractor
real_extractor = '''
// ============================================================
//  REAL LEAD EXTRACTOR (Apify Based)
// ============================================================
const RealLeadExtractor = (() => {
  async function fetchRealLeads({ industries, locations, types, sources, countPerCombo }) {
    if (typeof window === \\'undefined\\' || !window.SKYLARK_CONFIG || !window.SKYLARK_CONFIG.APIFY_KEYS) return [];
    const keys = window.SKYLARK_CONFIG.APIFY_KEYS;
    const activeApifyIdx = window.MemoryEngine ? window.MemoryEngine.getActiveApifyIdx() : 0;
    const currentApifyKey = keys[activeApifyIdx];
    if (!currentApifyKey) return [];

    const leads = [];
    let batchIdx = 0;
    const phoneRegex = /(?:(?:\+|0{0,2})91[\s\-]?)?[6789]\d{9}/;
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/;

    for (const industryKey of industries) {
      for (const city of locations) {
        const query = ${industryKey} companies in ;
        const requestBody = {
          queries: query,
          maxPagesPerQuery: 1,
          resultsPerPage: countPerCombo || 10,
          countryCode: \\'in\\',
        };

        try {
          const res = await fetch(https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=, {
            method: \\'POST\\',
            headers: { \\'Content-Type\\': \\'application/json\\' },
            body: JSON.stringify(requestBody)
          });
          
          if (!res.ok) continue;
          
          const results = await res.json();
          const items = Array.isArray(results) ? results : (results.items || []);
          
          const assignedType = types[0] || \\'Security\\';
          const ind = IndustryDB.getByKey(industryKey);
          const jobTitles = IndustryDB.getJobTitles(industryKey, assignedType);
          const jobTitle = jobTitles && jobTitles.length > 0 ? jobTitles[0] : \\'Staff Required\\';
          
          for (const item of items) {
            if (!item.title) continue;
            const snippet = item.description || \\'\\';
            const phoneMatch = snippet.match(phoneRegex);
            const emailMatch = snippet.match(emailRegex);
            
            leads.push({
              id: lead___,
              company: item.title.split(/[\\-\\|]/)[0].trim(),
              industry: industryKey,
              industryIcon: ind ? ind.icon : \\'??\\',
              sector: industryKey,
              jobTitle: jobTitle,
              type: assignedType,
              source: \\'Google Search\\',
              phone: phoneMatch ? phoneMatch[0] : \\'\\',
              email: emailMatch ? emailMatch[0] : \\'\\',
              website: item.url || \\'\\',
              address: city,
              city: city,
              timestamp: Date.now(),
              status: \\'New\\',
              requirement: jobTitle,
              positions: 1,
              description: snippet,
              enrichedByMaps: false,
              enrichedByCrawler: false,
              syncedToSheets: false,
            });
          }
        } catch(e) {
            console.error(\\'Error fetching Apify leads\\', e);
        }
      }
    }
    return leads;
  }
  return { fetchRealLeads };
})();
'''

code = re.sub(
    r'const SmartLeadGenerator = \(\(\) => \{.*?\n  return \{ generateSmartBatch \};\n\}\)\(\);',
    real_extractor.strip(),
    code,
    flags=re.DOTALL
)

# 2. Update phase1_SmartScan
phase1_new = '''
  // PHASE 1: Smart Job Board Scan
  async function phase1_SmartScan({ industries, locations, types, sources, countPerCombo }) {
    onLog(\\'phase\\', \\'? PHASE 1 — Real Apify Data Extraction (Buyer Companies)\\');
    onPhaseUpdate(1, \\'active\\', 0);
    onLog(\\'info\\', ?? Locations: );
    onLog(\\'info\\', ?? Industries:  selected);
    onLog(\\'info\\', ? Contacting Apify API for Real Data...);
    
    useTokens(2);
    
    const allRawLeads = await window.RealLeadExtractor.fetchRealLeads({ industries, locations, types, sources, countPerCombo });
    
    allRawLeads.forEach(l => {
        onLog(\\'info\\',     ? Found: );
    });
    
    onPhaseUpdate(1, \\'done\\', 100);
    onLog(\\'success\\', ? Phase 1:  real leads collected);
    return allRawLeads;
  }
'''

code = re.sub(
    r'// PHASE 1: Smart Job Board Scan.*?return allRawLeads;\n  \}',
    phase1_new.strip(),
    code,
    flags=re.DOTALL
)

# 3. Update phase3_MapsEnrichment to avoid randomizing
phase3_new = '''
  // PHASE 3: Maps Enrichment (Stubbed out to avoid random data)
  async function phase3_MapsEnrichment(leads) {
    onLog(\\'phase\\', \\'? PHASE 3 — Google Maps Enrichment (Disabled to maintain authenticity)\\');
    onPhaseUpdate(3, \\'done\\', 100);
    return leads;
  }
'''

code = re.sub(
    r'// PHASE 3: Maps Enrichment.*?return leads;\n  \}',
    phase3_new.strip(),
    code,
    flags=re.DOTALL
)

# 4. Update phase4_WebCrawler to avoid randomizing
phase4_new = '''
  // PHASE 4: Web Crawler — email extraction (Stubbed out to avoid random data)
  async function phase4_WebCrawler(leads) {
    onLog(\\'phase\\', \\'? PHASE 4 — Web Crawler (Disabled to maintain authenticity)\\');
    onPhaseUpdate(4, \\'done\\', 100);
    return leads;
  }
'''

code = re.sub(
    r'// PHASE 4: Web Crawler — email extraction.*?return leads;\n  \}',
    phase4_new.strip(),
    code,
    flags=re.DOTALL
)

# Replace window.SmartLeadGenerator with window.RealLeadExtractor
code = code.replace('window.SmartLeadGenerator   = SmartLeadGenerator;', 'window.RealLeadExtractor   = RealLeadExtractor;')
code = code.replace('SmartLeadGenerator', 'RealLeadExtractor')

with open('agent.js', 'w', encoding='utf-8') as f:
    f.write(code)
print('Patched successfully!')

