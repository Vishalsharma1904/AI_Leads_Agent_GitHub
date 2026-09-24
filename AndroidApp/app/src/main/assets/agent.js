/**
 * ============================================================
 *  SKYLARK LEAD AGENT v2 — Core Agent Logic
 *  BUYER-FOCUSED: Companies that NEED security/housekeeping
 *  Multi-location, Industry-aware, Token-optimized pipeline
 *  NOTE: MemoryEngine lives in memory.js (loaded before this)
 * ============================================================
 */

'use strict';

// ============================================================
//  SETTINGS ENGINE
// ============================================================
const SettingsEngine = {
  KEY: 'skylark_settings_v2',
  defaults: {
    apifyKey: '',
    locations: [],
    dedupStrategy: 'company+type',
    webhookUrl: '',
    sheetsScriptUrl: '',
    lastIndustries: [],
    lastTypes: ['Security', 'Housekeeping'],
    tokenBudget: 1000,
  },
  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      return raw ? { ...this.defaults, ...JSON.parse(raw) } : { ...this.defaults };
    } catch { return { ...this.defaults }; }
  },
  save(updates) {
    const next = { ...this.load(), ...updates };
    localStorage.setItem(this.KEY, JSON.stringify(next));
    localStorage.setItem('skylark_dedup_strategy', next.dedupStrategy);
    return next;
  },
  get(key) { return this.load()[key]; },
};

// ============================================================
//  INDUSTRY KNOWLEDGE BASE
//  Maps industry → buyer companies that NEED security/HK
//  These are CLIENTS, not service providers!
// ============================================================
const IndustryDB = (() => {

  const INDUSTRIES = {
    'Hotels & Hospitality': {
      icon: '🏨', color: '#f59e0b', bg: '#fffbeb',
      desc: 'Hotels, resorts, banquet halls needing security + housekeeping',
      companies: [
        { name: 'Marriott Hotels India', city: null },
        { name: 'Oberoi Hotels & Resorts', city: null },
        { name: 'ITC Hotels', city: null },
        { name: 'Taj Hotels & Palaces', city: null },
        { name: 'Hyatt Regency India', city: null },
        { name: 'Radisson Blu Hotels', city: null },
        { name: 'The Leela Hotels', city: null },
        { name: 'Novotel Hotels India', city: null },
        { name: 'Hilton Hotels India', city: null },
        { name: 'Holiday Inn Express', city: null },
        { name: 'Crowne Plaza India', city: null },
        { name: 'Sheraton Grand', city: null },
        { name: 'OYO Townhouse', city: null },
        { name: 'Lemon Tree Hotels', city: null },
        { name: 'Sarovar Hotels', city: null },
        { name: 'Fortune Hotels (ITC)', city: null },
        { name: 'WelcomHotel', city: null },
        { name: 'Park Hotels India', city: null },
        { name: 'Vivanta Hotels', city: null },
        { name: 'Trident Hotels', city: null },
      ],
      securityJobs: ['Security Guard for Hotel Premises', 'Banquet Hall Security Incharge', 'Night Security Supervisor - Hotel', 'Hotel Security Manager', 'Front Gate Security Staff'],
      hkJobs: ['Housekeeping Attendant - Hotel', 'Room Boy / Room Attendant', 'Floor Supervisor - Housekeeping', 'Laundry Incharge', 'Executive Housekeeper'],
    },

    'Hospitals & Healthcare': {
      icon: '🏥', color: '#ef4444', bg: '#fef2f2',
      desc: 'Hospitals, clinics, pharma companies needing security + sanitation',
      companies: [
        { name: 'Apollo Hospitals', city: null },
        { name: 'Fortis Healthcare', city: null },
        { name: 'Max Healthcare', city: null },
        { name: 'Manipal Hospitals', city: null },
        { name: 'Narayana Health', city: null },
        { name: 'Aster Hospitals', city: null },
        { name: 'Medanta Hospital', city: null },
        { name: 'AIIMS Associated Hospitals', city: null },
        { name: 'Columbia Asia Hospital', city: null },
        { name: 'Kokilaben Hospital', city: null },
        { name: 'Wockhardt Hospitals', city: null },
        { name: 'Sahyadri Hospitals', city: null },
        { name: 'Global Hospitals', city: null },
        { name: 'KIMS Hospital', city: null },
        { name: 'Care Hospitals', city: null },
        { name: 'NH (Narayana Hrudayalaya)', city: null },
        { name: 'Rainbow Children Hospital', city: null },
        { name: 'Cloudnine Hospitals', city: null },
        { name: 'Sir Ganga Ram Hospital', city: null },
        { name: 'Hinduja Hospital', city: null },
      ],
      securityJobs: ['Security Guard for Hospital', 'Patient Safety Officer', 'Hospital Premises Security', 'Visitor Management Guard', 'Emergency Ward Security'],
      hkJobs: ['Hospital Housekeeping Staff', 'Sanitation & Hygiene Staff', 'Ward Boy / Ayah', 'Bio-Medical Waste Handler', 'OT Housekeeping Attendant'],
    },

    'IT Parks & Tech Companies': {
      icon: '💻', color: '#6366f1', bg: '#eef2ff',
      desc: 'Software companies, IT parks, tech campuses needing facility management',
      companies: [
        { name: 'Tata Consultancy Services (TCS)', city: null },
        { name: 'Infosys Ltd', city: null },
        { name: 'Wipro Technologies', city: null },
        { name: 'HCL Technologies', city: null },
        { name: 'Cognizant Technology Solutions', city: null },
        { name: 'Tech Mahindra', city: null },
        { name: 'L&T Infotech', city: null },
        { name: 'Mphasis Limited', city: null },
        { name: 'Hexaware Technologies', city: null },
        { name: 'NIIT Technologies', city: null },
        { name: 'Embassy TechVillage', city: null },
        { name: 'Mindspace Business Parks', city: null },
        { name: 'RMZ Infinity', city: null },
        { name: 'DLF Cybercity', city: null },
        { name: 'Prestige Tech Park', city: null },
        { name: 'Manyata Tech Park', city: null },
        { name: 'HITEC City Properties', city: null },
        { name: 'Electronic City Phase 2', city: null },
        { name: 'Bagmane Tech Park', city: null },
        { name: 'SP Infocity', city: null },
      ],
      securityJobs: ['Campus Security Officer', 'IT Park Access Control Guard', 'Night Shift Security Supervisor', 'CCTV Monitoring Operator', 'Corporate Security Executive'],
      hkJobs: ['Facility Management Executive', 'Office Housekeeping Supervisor', 'Pantry Boy / Canteen Staff', 'Cleaning Staff for Tech Park', 'Soft Services Manager'],
    },

    'Shopping Malls & Retail': {
      icon: '🛍️', color: '#ec4899', bg: '#fdf2f8',
      desc: 'Malls, retail chains, supermarkets requiring security and cleaning staff',
      companies: [
        { name: 'Phoenix Palladium Mall', city: null },
        { name: 'Nexus Mall (Ahmedabad)', city: null },
        { name: 'Lulu Mall', city: null },
        { name: 'InOrbit Mall', city: null },
        { name: 'Ambience Mall', city: null },
        { name: 'Select Citywalk Mall', city: null },
        { name: 'Viviana Mall', city: null },
        { name: 'Seawoods Grand Central Mall', city: null },
        { name: 'Pacific Mall', city: null },
        { name: 'Saket District Centre', city: null },
        { name: 'D-Mart (Avenue Supermarts)', city: null },
        { name: 'Big Bazaar (Future Retail)', city: null },
        { name: 'Reliance Retail', city: null },
        { name: "Spencer's Retail", city: null },
        { name: 'Star Bazaar', city: null },
        { name: 'More Retail', city: null },
        { name: 'V-Mart Retail', city: null },
        { name: 'Easyday (Bharti Retail)', city: null },
        { name: 'Spar India', city: null },
        { name: 'Vishal Mega Mart', city: null },
      ],
      securityJobs: ['Mall Security Guard', 'Retail Store Security Incharge', 'Shoplifting Prevention Officer', 'Entry Gate Security Staff', 'Mall Security Supervisor'],
      hkJobs: ['Mall Housekeeping Supervisor', 'Cleaning Staff for Retail', 'Janitor / Sweeper Mall', 'Washroom Attendant', 'Common Area Maintenance Staff'],
    },

    'Banks & Financial Institutions': {
      icon: '🏦', color: '#3b82f6', bg: '#eff6ff',
      desc: 'Banks, NBFCs, insurance companies needing security staff',
      companies: [
        { name: 'HDFC Bank Ltd', city: null },
        { name: 'ICICI Bank', city: null },
        { name: 'State Bank of India (SBI)', city: null },
        { name: 'Axis Bank', city: null },
        { name: 'Kotak Mahindra Bank', city: null },
        { name: 'Yes Bank', city: null },
        { name: 'Punjab National Bank', city: null },
        { name: 'Bank of Baroda', city: null },
        { name: 'Canara Bank', city: null },
        { name: 'Bank of India', city: null },
        { name: 'LIC Housing Finance', city: null },
        { name: 'Bajaj Finserv', city: null },
        { name: 'Muthoot Finance', city: null },
        { name: 'Manappuram Finance', city: null },
        { name: 'Mahindra Finance', city: null },
        { name: 'IIFL Finance', city: null },
        { name: 'Shriram Finance', city: null },
        { name: 'HDFC Life Insurance', city: null },
        { name: 'Max Life Insurance', city: null },
        { name: 'ICICI Prudential', city: null },
      ],
      securityJobs: ['Bank Security Guard', 'ATM Guard / Cash Van Escort', 'Armed Security for Bank', 'Branch Security Supervisor', 'Vault Security Officer'],
      hkJobs: ['Bank Office Housekeeping', 'Branch Cleaning Staff', 'Washroom Maintenance Attendant', 'Office Pantry Staff', 'Facility Coordinator - Bank'],
    },

    'Corporate Offices': {
      icon: '🏢', color: '#8b5cf6', bg: '#f5f3ff',
      desc: 'Large corporates, MNCs, head offices requiring facility services',
      companies: [
        { name: 'Reliance Industries Ltd', city: null },
        { name: 'Tata Group HQ', city: null },
        { name: 'Mahindra & Mahindra', city: null },
        { name: 'Godrej Industries', city: null },
        { name: 'Larsen & Toubro (L&T)', city: null },
        { name: 'Aditya Birla Group', city: null },
        { name: 'Hindustan Unilever (HUL)', city: null },
        { name: 'ITC Limited', city: null },
        { name: 'Bajaj Auto Ltd', city: null },
        { name: 'Maruti Suzuki India', city: null },
        { name: 'Asian Paints Ltd', city: null },
        { name: 'Pidilite Industries', city: null },
        { name: 'Havells India', city: null },
        { name: 'Titan Company', city: null },
        { name: 'Dabur India', city: null },
        { name: 'Emami Ltd', city: null },
        { name: 'Marico Limited', city: null },
        { name: 'Colgate-Palmolive India', city: null },
        { name: 'Nestlé India', city: null },
        { name: 'Abbott India', city: null },
      ],
      securityJobs: ['Corporate Security Officer', 'Visitor Management Executive', 'HQ Security Supervisor', 'Reception Security Guard', 'Night Security Incharge'],
      hkJobs: ['Corporate Housekeeper', 'Office Pantry Incharge', 'Facility Management Staff', 'Cleaning Supervisor', 'Office Boy / Peon'],
    },

    'Factories & Warehouses': {
      icon: '🏭', color: '#10b981', bg: '#ecfdf5',
      desc: 'Manufacturing plants, warehouses, logistics hubs',
      companies: [
        { name: 'Amazon Fulfillment Centre', city: null },
        { name: 'Flipkart Logistics Hub', city: null },
        { name: 'Blue Dart Express', city: null },
        { name: 'Delhivery Ltd', city: null },
        { name: 'Eicher Motors Plant', city: null },
        { name: 'Hero MotoCorp Factory', city: null },
        { name: 'TVS Motor Company', city: null },
        { name: 'Bajaj Auto Plant', city: null },
        { name: 'Tata Motors Assembly', city: null },
        { name: 'Hyundai Motor India', city: null },
        { name: 'Sun Pharma Manufacturing', city: null },
        { name: 'Cipla Manufacturing', city: null },
        { name: "Dr. Reddy's Labs Plant", city: null },
        { name: 'Lupin Pharma Factory', city: null },
        { name: 'Amara Raja Batteries', city: null },
        { name: 'Vedanta Limited', city: null },
        { name: 'JSW Steel Plant', city: null },
        { name: 'Tata Steel Works', city: null },
        { name: 'Hindalco Industries', city: null },
        { name: 'Bharat Forge', city: null },
      ],
      securityJobs: ['Factory Gate Security', 'Warehouse Security Guard', 'Patrol Security Officer', 'Industrial Security Supervisor', 'Night Watchman - Factory'],
      hkJobs: ['Factory Housekeeping Staff', 'Warehouse Cleaning Supervisor', 'Canteen / Kitchen Staff', 'Industrial Cleaner', 'Washroom Attendant - Factory'],
    },

    'Airports & Aviation': {
      icon: '✈️', color: '#0ea5e9', bg: '#f0f9ff',
      desc: 'Airports, airline offices, cargo terminals',
      companies: [
        { name: 'Delhi International Airport (DIAL)', city: null },
        { name: 'Mumbai Airport (CSIA)', city: null },
        { name: 'Bangalore Kempegowda Airport', city: null },
        { name: 'Hyderabad GMR Airport', city: null },
        { name: 'Chennai International Airport', city: null },
        { name: 'Pune Airport Authority', city: null },
        { name: 'Cochin International Airport', city: null },
        { name: 'IndiGo Airlines', city: null },
        { name: 'Air India Ground Services', city: null },
        { name: 'SpiceJet Airlines', city: null },
        { name: 'Go First Airlines', city: null },
        { name: 'Vistara Airlines', city: null },
        { name: 'Air Asia India', city: null },
        { name: 'Blue Dart Aviation', city: null },
        { name: 'KIAL Airport', city: null },
      ],
      securityJobs: ['Airport Security Guard', 'Aviation Security Officer', 'Terminal Access Control', 'Cargo Security Supervisor', 'Perimeter Patrol Guard'],
      hkJobs: ['Airport Terminal Housekeeper', 'Washroom Attendant - Airport', 'Cleaning Staff for Lounge', 'Facility Coordinator Airport', 'Trolley Assistant'],
    },

    'Real Estate & Housing': {
      icon: '🏗️', color: '#f97316', bg: '#fff7ed',
      desc: 'Housing societies, commercial complexes, builders',
      companies: [
        { name: 'DLF Residential', city: null },
        { name: 'Godrej Properties', city: null },
        { name: 'Prestige Group', city: null },
        { name: 'Brigade Enterprises', city: null },
        { name: 'Lodha Group (Macrotech)', city: null },
        { name: 'Rustomjee Builders', city: null },
        { name: 'Sobha Realty', city: null },
        { name: 'Puravankara Ltd', city: null },
        { name: 'Mahindra Lifespaces', city: null },
        { name: 'Kolte-Patil Developers', city: null },
        { name: 'Indiabulls Real Estate', city: null },
        { name: 'Omaxe Ltd', city: null },
        { name: 'Supertech Ltd', city: null },
        { name: 'Embassy Office Parks', city: null },
        { name: 'Brookfield Properties', city: null },
        { name: 'K Raheja Corp', city: null },
        { name: 'Sunteck Realty', city: null },
        { name: 'Emaar Properties India', city: null },
        { name: 'Oberoi Realty', city: null },
        { name: 'Raymond Realty', city: null },
      ],
      securityJobs: ['Society Security Guard', 'Gated Community Security', 'Residential Complex Guard', 'Building Security Supervisor', 'CCTV Security Operator'],
      hkJobs: ['Society Housekeeping Staff', 'Apartment Complex Cleaner', 'Garden / Landscape Staff', 'Lift Operator / Helper', 'Common Area Maintenance'],
    },

    'Schools & Educational Institutes': {
      icon: '🏫', color: '#84cc16', bg: '#f7fee7',
      desc: 'Schools, colleges, universities needing security & sanitation',
      companies: [
        { name: 'DPS (Delhi Public School Group)', city: null },
        { name: 'Ryan International Schools', city: null },
        { name: 'Kendriya Vidyalaya Group', city: null },
        { name: 'Amity International School', city: null },
        { name: 'The Shri Ram School', city: null },
        { name: 'Podar International School', city: null },
        { name: 'Euro School India', city: null },
        { name: 'Jain Group of Institutions', city: null },
        { name: 'Manipal University', city: null },
        { name: 'Symbiosis International', city: null },
        { name: 'Lovely Professional University', city: null },
        { name: 'MIT Pune', city: null },
        { name: 'SRM University', city: null },
        { name: 'VIT University', city: null },
        { name: 'Christ University', city: null },
      ],
      securityJobs: ['School Security Guard', 'Campus Security Supervisor', 'Gate Keeper for School', 'University Security Officer', "Women's Hostel Security"],
      hkJobs: ['School Housekeeping Staff', 'Toilet / Sanitation Cleaner', 'Campus Maintenance Helper', 'Canteen Cook / Helper', 'Laboratory Assistant / Cleaner'],
    },

    'Logistics & E-Commerce': {
      icon: '📦', color: '#14b8a6', bg: '#f0fdfa',
      desc: 'Courier companies, delivery hubs, e-commerce warehouses',
      companies: [
        { name: 'Amazon India Logistics', city: null },
        { name: 'Flipkart Supply Chain', city: null },
        { name: 'Meesho Fulfillment', city: null },
        { name: 'Blue Dart Express', city: null },
        { name: 'DTDC Courier', city: null },
        { name: 'Ecom Express', city: null },
        { name: 'Shadowfax Technologies', city: null },
        { name: 'Xpressbees Courier', city: null },
        { name: 'Delhivery Ltd', city: null },
        { name: 'Gati Kintetsu Express', city: null },
        { name: 'Mahindra Logistics', city: null },
        { name: 'TCI Express', city: null },
        { name: 'TVS Supply Chain Solutions', city: null },
        { name: 'Allcargo Logistics', city: null },
        { name: 'Snowman Logistics', city: null },
      ],
      securityJobs: ['Warehouse Security Guard', 'Logistics Hub Security', 'Delivery Hub Gate Guard', 'Night Duty Security Supervisor', 'Access Control Executive'],
      hkJobs: ['Warehouse Housekeeping', 'Sorting Centre Cleaner', 'Fulfilment Hub Sanitation Staff', 'Office Cleaning Supervisor', 'Pantry Boy - Logistics'],
    },
  };

  function getAll() { return INDUSTRIES; }
  function getByKey(key) { return INDUSTRIES[key] || null; }
  function getNames() { return Object.keys(INDUSTRIES); }

  function getCompaniesForIndustry(industryKey, city) {
    const ind = INDUSTRIES[industryKey];
    if (!ind) return [];
    return ind.companies.map(c => ({
      ...c,
      city: city || c.city || 'India',
      industry: industryKey,
    }));
  }

  function getJobTitles(industryKey, type) {
    const ind = INDUSTRIES[industryKey];
    if (!ind) return [];
    if (type === 'Security') return ind.securityJobs;
    if (type === 'Housekeeping') return ind.hkJobs;
    return [...ind.securityJobs, ...ind.hkJobs];
  }

  return { getAll, getByKey, getNames, getCompaniesForIndustry, getJobTitles };
})();

// ============================================================
//  REAL LEAD EXTRACTOR (Apify Based)
// ============================================================
const RealLeadExtractor = (() => {
  async function fetchRealLeads({ industries, locations, types, sources, countPerCombo, onLog, onPhaseUpdate }) {
    // Defensive defaults — guarantee callbacks always exist so the pipeline
    // never throws "onPhaseUpdate is not defined" regardless of how this
    // function is called.
    if (typeof onLog !== 'function')         onLog         = () => {};
    if (typeof onPhaseUpdate !== 'function') onPhaseUpdate = () => {};

    let apifyKey = '';
    let activeApifyIdx = 0;
    if (window.MemoryEngine) {
      const best = window.MemoryEngine.getBestApifyKey();
      apifyKey = best.key;
      activeApifyIdx = best.index;
    } else if (window.SKYLARK_CONFIG) {
      const keys = window.SKYLARK_CONFIG.APIFY_API_KEYS || window.SKYLARK_CONFIG.APIFY_KEYS || [];
      apifyKey = keys[0];
    }
    if (!apifyKey) {
      if (onLog) onLog('error', '  ✕ Apify API Key missing. Please configure it in Settings.');
      return [];
    }

    const leads = [];
    let batchIdx = 0;

    // Generate all queries
    const queries = [];
    for (const industryKey of industries) {
      for (const city of locations) {
        queries.push({ industryKey, city, query: `${industryKey} in ${city}` });
      }
    }

    const batchSize = 6; // Group 6 search queries per Apify run to prevent HTTP timeout
    const totalQueries = queries.length;
    const totalBatches = Math.ceil(totalQueries / batchSize);

    for (let b = 0; b < totalBatches; b++) {
      const startIdx = b * batchSize;
      const batchQueries = queries.slice(startIdx, startIdx + batchSize);
      const searchStrings = batchQueries.map(q => q.query);

      if (onLog) onLog('info', `⚡ Running Google Maps scan batch ${b + 1} of ${totalBatches}...`);
      
      const requestBody = {
        searchStringsArray: searchStrings,
        maxCrawledPlacesPerSearch: countPerCombo || 10,
        language: 'en'
      };

      try {
        const res = await fetch(`https://api.apify.com/v2/acts/compass~crawler-google-places/run-sync-get-dataset-items?token=${apifyKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });
        
        if (!res.ok) {
          let errMsg = `Status ${res.status}`;
          try {
            const errJson = await res.json();
            if (errJson.error?.message) errMsg = errJson.error.message;
          } catch(e) {}
          console.error(`Apify Google Maps Scraper batch call failed with status: ${res.status}`);
          if (onLog) onLog('error', `  ✕ Apify Error for batch ${b + 1}: ${errMsg}`);
          continue;
        }
        
        const results = await res.json();
        const items = Array.isArray(results) ? results : (results.items || []);
        
        if (onLog) onLog('success', `  ✓ Batch ${b + 1} completed: Found ${items.length} raw places`);

        const assignedType = types[0] || 'Security';
        
        // Log key usage in real-time
        if (window.MemoryEngine && items.length > 0) {
          window.MemoryEngine.addKeyUsage('apify', activeApifyIdx, items.length);
          if (typeof window.updateRealtimeTokenCounters === 'function') {
            window.updateRealtimeTokenCounters();
          }
        }

        for (const item of items) {
          const companyName = (item.name || item.title || '').split(/[\-\|]/)[0].trim();
          if (!companyName) continue;
          
          let phone = item.phone || item.phoneNumber || item.unformattedPhone || '';
          let email = item.email || item.contactEmail || '';
          const website = item.website || item.url || '';
          const address = item.address || item.streetAddress || '';

          // Parse industry and city from item.searchString if available
          let itemIndustry = batchQueries[0].industryKey;
          let itemCity = batchQueries[0].city;
          if (item.searchString) {
            const parts = item.searchString.split(' in ');
            if (parts.length === 2) {
              itemIndustry = parts[0];
              itemCity = parts[1];
            }
          }

          const ind = IndustryDB.getByKey(itemIndustry);
          const jobTitles = IndustryDB.getJobTitles(itemIndustry, assignedType);
          const jobTitle = jobTitles && jobTitles.length > 0 ? jobTitles[0] : 'Staff Required';

          leads.push({
            id: `lead_${Date.now()}_${Math.random().toString(36).slice(2,8)}_${batchIdx++}`,
            company: companyName,
            industry: itemIndustry,
            industryIcon: ind ? ind.icon : '💼',
            sector: itemIndustry,
            jobTitle: jobTitle,
            type: assignedType,
            source: 'Google Maps',
            phone: phone,
            email: email,
            website: website,
            address: address || itemCity,
            city: itemCity,
            timestamp: Date.now(),
            status: 'New',
            requirement: jobTitle,
            positions: 1,
            description: item.description || item.title || '',
            enrichedByMaps: true,
            enrichedByCrawler: false,
            syncedToSheets: false,
          });
        }
      } catch(e) {
        console.error(`Error in scan batch ${b + 1}`, e);
        if (onLog) onLog('error', `  ✕ Batch ${b + 1} failed: ${e.message}`);
      }

      // Update Phase 1 progress
      const pct = Math.round(((b + 1) / totalBatches) * 100);
      onPhaseUpdate(1, 'active', pct);
    }

    onPhaseUpdate(1, 'done', 100);
    onLog('success', `✓ Phase 1: ${leads.length} raw leads collected`);
    return leads;
  }

  return { fetchRealLeads };
})();

// ============================================================
//  PIPELINE ENGINE v2 — Token-optimized, Multi-location
// ============================================================
const PipelineEngine = (() => {
  let isRunning = false;
  let abortController = null;
  let tokenUsed = 0;

  let onLog         = () => {};
  let onPhaseUpdate = () => {};
  let onLeadFound   = () => {};
  let onComplete    = () => {};
  let onError       = () => {};
  let onTokenUpdate = () => {};

  function setCallbacks(cbs) {
    if (cbs.onLog)         onLog         = cbs.onLog;
    if (cbs.onPhaseUpdate) onPhaseUpdate = cbs.onPhaseUpdate;
    if (cbs.onLeadFound)   onLeadFound   = cbs.onLeadFound;
    if (cbs.onComplete)    onComplete    = cbs.onComplete;
    if (cbs.onError)       onError       = cbs.onError;
    if (cbs.onTokenUpdate) onTokenUpdate = cbs.onTokenUpdate;
  }

  function sleep(ms) {
    return new Promise((resolve, reject) => {
      const id = setTimeout(resolve, ms);
      if (abortController) {
        abortController.signal.addEventListener('abort', () => {
          clearTimeout(id);
          reject(new Error('Pipeline aborted'));
        });
      }
    });
  }

  function useTokens(n) {
    tokenUsed += n;
    // Persist cumulative total across sessions via localStorage
    const total = window.MemoryEngine ? window.MemoryEngine.addTokensUsed(n) : tokenUsed;
    onTokenUpdate(total);
  }

  // PHASE 1: Smart Job Board Scan
  async function phase1_SmartScan({ industries, locations, types, sources, countPerCombo }) {
    onLog('phase', '▶ PHASE 1 — Real Apify Data Extraction (Buyer Companies)');
    onPhaseUpdate(1, 'active', 0);
    onLog('info', `📍 Locations: ${locations.join(', ')}`);
    onLog('info', `🏭 Industries: ${industries.length} selected`);
    onLog('info', `⚡ Contacting Apify API for Real Data...`);
    
    useTokens(2);
    
    const allRawLeads = await window.RealLeadExtractor.fetchRealLeads({ industries, locations, types, sources, countPerCombo, onLog, onPhaseUpdate });
    
    allRawLeads.forEach(l => {
        onLog('info', `    ✦ Found: ${l.company}`);
    });
    
    onPhaseUpdate(1, 'done', 100);
    onLog('success', `✓ Phase 1: ${allRawLeads.length} real leads collected`);
    return allRawLeads;
  }

  // PHASE 2: Pre-flight Deduplication
  async function phase2_PreflightDedup(leads) {
    onLog('phase', '▶ PHASE 2 — Pre-flight Deduplication (token optimization)');
    onPhaseUpdate(2, 'active', 0);

    const results  = await MemoryEngine.batchDedupCheck(leads);
    const newLeads = results.filter(r => !r.isDuplicate).map(r => r.lead);
    const dupCount = leads.length - newLeads.length;

    onPhaseUpdate(2, 'done', 100);
    onLog('success', `✓ Dedup: ${newLeads.length} new | ${dupCount} already in memory (tokens saved!)`);
    return { newLeads, dupCount };
  }

  // PHASE 3: Maps Enrichment
  async function phase3_MapsEnrichment(leads) {
    onLog('phase', '▶ PHASE 3 — Google Maps Enrichment (Disabled to maintain authenticity)');
    onPhaseUpdate(3, 'done', 100);
    return leads;
  }

  // PHASE 4: Web Crawler — email and phone extraction
  async function phase4_WebCrawler(leads) {
    onLog('phase', '▶ PHASE 4 — Web Crawler (Email & Phone extraction from websites)');
    onPhaseUpdate(4, 'active', 0);
    
    let crawledCount = 0;
    const total = leads.length;
    if (total === 0) {
      onPhaseUpdate(4, 'done', 100);
      return leads;
    }

    onLog('info', `⚡ Starting website crawl for ${total} unique leads...`);
    
    // Batch size of 5 for parallel website requests
    const batchSize = 5;
    for (let i = 0; i < leads.length; i += batchSize) {
      const batch = leads.slice(i, i + batchSize);
      await Promise.all(batch.map(async (lead) => {
        if (lead.website && window.extractContactFromWebsite) {
          onLog('info', ` Crawling website: ${lead.website} for ${lead.company}...`);
          try {
            const realContact = await window.extractContactFromWebsite(lead.website);
            if (realContact) {
              let updated = [];
              if (realContact.phone) {
                lead.phone = realContact.phone;
                updated.push('phone');
              }
              if (realContact.email) {
                lead.email = realContact.email;
                updated.push('email');
              }
              if (updated.length > 0) {
                lead.enrichedByCrawler = true;
                onLog('success', `   ✓ Found ${updated.join(' & ')} for ${lead.company}`);
              } else {
                onLog('info', `   No new contact info found on website for ${lead.company}`);
              }
            }
          } catch (e) {
            console.error(`Error crawling ${lead.website}`, e);
          }
        }
        crawledCount++;
        const pct = Math.min(100, Math.round((crawledCount / total) * 100));
        onPhaseUpdate(4, 'active', pct);
      }));
      // Small pause between crawl batches to avoid rate limit/blocking
      await sleep(300);
    }

    onPhaseUpdate(4, 'done', 100);
    onLog('success', `✓ Web Crawler complete. Crawled websites of all ${total} leads.`);
    return leads;
  }

  // MAIN ORCHESTRATOR
  async function run({ industries, locations, types, sources, countPerCombo, enableMaps, enableCrawler, totalTarget }) {
    if (isRunning) { onError('Pipeline already running'); return; }
    isRunning = true;
    tokenUsed = 0;
    abortController = new AbortController();

    try {
      onLog('info', '══════════════════════════════════════');
      onLog('info', '  SKYLARK AI AGENT v2 — PIPELINE START');
      onLog('info', `  ${new Date().toLocaleString('en-IN')}`);
      onLog('info', '══════════════════════════════════════');

      const startTime = Date.now();

      let leads = await phase1_SmartScan({ industries, locations, types, sources, countPerCombo, totalTarget });
      await sleep(300);

      const { newLeads, dupCount } = await phase2_PreflightDedup(leads);
      leads = newLeads;
      await sleep(200);

      if (leads.length === 0) {
        onLog('warn', '⊘ All leads already exist in memory. Try new industries/locations.');
        onComplete({ added: 0, dupes: dupCount, total: 0, elapsed: '0.0', tokenUsed: 0 });
        return;
      }

      if (enableMaps) {
        leads = await phase3_MapsEnrichment(leads);
        await sleep(200);
      } else {
        onPhaseUpdate(3, 'done', 100);
        onLog('warn', '⊘ Maps enrichment disabled');
      }

      if (enableCrawler) {
        leads = await phase4_WebCrawler(leads);
        await sleep(100);
      } else {
        onPhaseUpdate(4, 'done', 100);
        onLog('warn', '⊘ Web crawler disabled');
      }

      // Final storage
      onLog('phase', '▶ FINAL — Storing to Memory...');
      let added = 0, storeDupes = 0;

      for (const lead of leads) {
        try {
          const res = await MemoryEngine.addLead(lead);
          if (res.success) { added++; onLeadFound(lead); }
          else { storeDupes++; }
        } catch (err) {
          onLog('error', `  ✕ Store failed: ${lead.company}`);
        }
      }

      await MemoryEngine.incrementMeta('sessions_run');
      await MemoryEngine.setMeta('total_leads', (await MemoryEngine.getMeta('total_leads') || 0) + added);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      onLog('success', '══════════════════════════════════════');
      onLog('success', `  ✓ Done in ${elapsed}s | ${added} leads added | ${dupCount + storeDupes} dupes blocked`);
      onLog('success', `  Tokens used this session: ~${tokenUsed}`);
      onLog('success', '══════════════════════════════════════');

      onComplete({ added, dupes: dupCount + storeDupes, total: leads.length, elapsed, tokenUsed });

    } catch (err) {
      if (err.message === 'Pipeline aborted') {
        onLog('warn', '⊘ Pipeline stopped by user');
      } else {
        onLog('error', `✕ Error: ${err.message}`);
        onError(err.message);
      }
    } finally {
      isRunning = false;
      abortController = null;
    }
  }

  function abort() {
    if (abortController) abortController.abort();
    isRunning = false;
  }

  function getIsRunning() { return isRunning; }

  return { run, abort, setCallbacks, getIsRunning };
})();

// ─── Exports ─────────────────────────────────────────────────
// MemoryEngine is defined in memory.js and already on window
window.SettingsEngine       = SettingsEngine;
window.IndustryDB           = IndustryDB;
window.RealLeadExtractor   = RealLeadExtractor;
window.PipelineEngine       = PipelineEngine;
