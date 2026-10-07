/**
 * auth-antigravity.js
 * Antigravity Warm Cream Luxury Auth & Reactive Profile Engine
 * Benchmarked against Claude, Linear, Antigravity 2.0 & Apple Sequoia
 */
'use strict';

const RUDRA_APP_NAME = 'Rudra24 AI';
const RUDRA_APP_DESCRIPTION = 'Your business workspace. Sign in to continue.';

// ──────────────────────────────────────────────
//  0. USER-SCOPED STORAGE ENGINE (Multi-Tenant / Multi-User Silo)
// ──────────────────────────────────────────────
window.UserStorage = {
  emailToUserId(email) {
    if (!email) return 'usr_default';
    const clean = String(email).trim().toLowerCase();
    const safe = clean.replace(/[^a-z0-9]/g, '_');
    return `usr_${safe}`;
  },

  getUserId() {
    const verifiedEmail = window.SupabaseAuth?.getUser?.()?.email;
    if (verifiedEmail) return this.emailToUserId(verifiedEmail);
    return 'usr_default';
  },

  key(k) {
    const uid = this.getUserId();
    return `skylark_${uid}_${k}`;
  },

  getItem(k, fallback = null) {
    const userK = this.key(k);
    const val = localStorage.getItem(userK);
    if (val !== null) return val;
    // Graceful fallback for initial primary user account migration
    const legacyVal = localStorage.getItem(k);
    if (legacyVal !== null && this.getUserId() === 'usr_default') {
      return legacyVal;
    }
    return fallback;
  },

  setItem(k, val) {
    const userK = this.key(k);
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    localStorage.setItem(userK, str);
  },

  removeItem(k) {
    localStorage.removeItem(this.key(k));
  },

  getJSON(k, fallback = null) {
    const raw = this.getItem(k);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  },

  setJSON(k, val) {
    this.setItem(k, JSON.stringify(val));
  }
};

// ──────────────────────────────────────────────
//  1. UNIFIED USER PROFILE MANAGER
// ──────────────────────────────────────────────
window.UserProfileManager = {
  DEFAULT_PROFILE: {
    id: '',
    name: 'User',
    firstName: 'User',
    honorificName: 'Sir',
    company: 'Enterprise',
    email: '',
    phone: '',
    role: 'Owner',
    avatar: 'U',
    theme: 'dark'
  },

  // Common Indian and global surnames for intelligent word splitting
  SURNAMES: [
    'sharma', 'singh', 'kumar', 'verma', 'gupta', 'patel', 'yadav', 'khan',
    'reddy', 'mehta', 'jain', 'agarwal', 'mishra', 'joshi', 'shah', 'nair',
    'rao', 'das', 'roy', 'malhotra', 'bhatia', 'kapoor', 'arora', 'saxena',
    'tiwari', 'tripathi', 'pandey', 'chaudhary', 'choudhary', 'shukla', 'dubey',
    'bose', 'sen', 'ghosh', 'mukherjee', 'banerjee', 'chatterjee', 'dutta'
  ],

  getCurrentUserId() {
    return window.UserStorage.getUserId();
  },

  /**
   * Cleans raw input, removes trailing numbers (e.g. 190405), splits compound names,
   * and properly capitalizes names.
   */
  cleanRawName(input) {
    if (!input) return '';
    let str = String(input).trim();
    if (str.includes('@')) str = str.split('@')[0];

    // Replace separators with space
    str = str.replace(/[._\-+]/g, ' ');
    // Remove numbers and digits
    str = str.replace(/[0-9]/g, '');
    str = str.trim();
    if (!str) return 'User';

    // Check compound joined words like "vishalsharma"
    let words = str.split(/\s+/).filter(Boolean);
    if (words.length === 1) {
      const lower = words[0].toLowerCase();
      for (const sn of this.SURNAMES) {
        if (lower.endsWith(sn) && lower.length > sn.length) {
          const first = lower.slice(0, -sn.length);
          words = [first, sn];
          break;
        }
      }
    }

    // Capitalize each word properly
    words = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    return words.join(' ');
  },

  /**
   * Extracts clean first name (e.g. "Vishal")
   */
  getFirstName(optionalName) {
    let name = optionalName;
    if (!name) {
      try {
        const raw = localStorage.getItem('skylark_user_profile') || localStorage.getItem('skylark_user');
        if (raw) {
          const parsed = JSON.parse(raw);
          name = parsed.name || parsed.email;
        }
      } catch (_) {}
    }
    if (!name) {
      name = localStorage.getItem('skylark_active_email') || 'User';
    }
    const clean = this.cleanRawName(name);
    const first = clean.split(/\s+/)[0] || 'User';
    return first;
  },

  /**
   * Returns gender-aware honorific name.
   * Female → "Priya Ma'am", Male/other → "Vishal Sir"
   * @param {string} [optionalName]
   * @param {string} [optionalGender] - 'male' | 'female' | 'other'
   */
  getHonorificName(optionalName, optionalGender) {
    const fn = this.getFirstName(optionalName);
    if (!fn || /^(user|guest|demo|admin)$/i.test(fn)) {
      // Fall back to stored gender
      const gender = optionalGender || this._getStoredGender();
      return gender === 'female' ? "Ma'am" : 'Sir';
    }
    if (/(\s+sir|\s+ma'am)$/i.test(fn)) return fn;
    const gender = optionalGender || this._getStoredGender();
    const suffix = gender === 'female' ? "Ma'am" : 'Sir';
    return `${fn} ${suffix}`;
  },

  _getStoredGender() {
    try {
      const raw = localStorage.getItem('skylark_user_profile') || localStorage.getItem('skylark_user');
      if (raw) { const p = JSON.parse(raw); return p.gender || 'other'; }
    } catch (_) {}
    return 'other';
  },

  getProfile() {
    try {
      const activeEmail = localStorage.getItem('skylark_active_email') || '';
      const raw = localStorage.getItem('skylark_user_profile') || localStorage.getItem('skylark_user');
      let base = {};
      if (raw) {
        try { base = JSON.parse(raw); } catch (_) { base = {}; }
      }

      const email = (base.email || activeEmail || '').trim().toLowerCase();
      let rawName = (base.name || (email ? email.split('@')[0] : '')).trim();

      // Clean up the name
      const cleanName = this.cleanRawName(rawName || 'User');
      const firstName = this.getFirstName(cleanName);
      const honorificName = this.getHonorificName(cleanName);

      // Clean avatar: 2 letter initials
      const parts = cleanName.split(/\s+/).filter(Boolean);
      const avatar = parts.length > 1
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : (cleanName.substring(0, Math.min(2, cleanName.length)) || 'U').toUpperCase();

      const profile = {
        ...this.DEFAULT_PROFILE,
        ...base,
        id: base.id || (email && window.UserStorage ? window.UserStorage.emailToUserId(email) : 'usr_default'),
        email,
        name: cleanName,
        firstName,
        honorificName,
        avatar,
        company: (base.company && base.company !== 'Google Workspace' && base.company !== 'Enterprise')
          ? base.company
          : 'Workspace'
      };

      return profile;
    } catch (e) {
      return { ...this.DEFAULT_PROFILE, firstName: 'User', honorificName: 'Sir' };
    }
  },

  saveProfile(updates) {
    try {
      const current = this.getProfile();
      const updated = { ...current, ...updates };

      if (updated.email && updated.email.includes('@')) {
        const clean = updated.email.trim().toLowerCase();
        updated.email = clean;
        if (!updated.id) {
          updated.id = window.UserStorage ? window.UserStorage.emailToUserId(clean) : 'usr_' + clean;
        }
        localStorage.setItem('skylark_active_email', clean);
      }

      if (updated.name) {
        updated.name = this.cleanRawName(updated.name);
      }
      updated.firstName = this.getFirstName(updated.name);
      updated.honorificName = this.getHonorificName(updated.name);

      // Calculate 2-letter avatar initials
      const parts = (updated.name || '').trim().split(/\s+/).filter(Boolean);
      updated.avatar = parts.length > 1
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : (updated.name ? updated.name.substring(0, Math.min(2, updated.name.length)).toUpperCase() : 'U');

      localStorage.setItem('skylark_user_profile', JSON.stringify(updated));
      localStorage.setItem('skylark_user', JSON.stringify(updated));
      localStorage.setItem('skylark_logged_in', 'true');

      // Live sync UI across all pages
      this.syncUI();
      return updated;
    } catch (e) {
      console.error('Error saving profile:', e);
      return null;
    }
  },

  syncUI() {
    const profile = this.getProfile();
    const honorificName = profile.honorificName || 'Vishal Sir';
    const firstName = profile.firstName || 'Vishal';

    // 1. Dashboard Greeting
    const greetingTitle = document.getElementById('do-greeting-title');
    if (greetingTitle) {
      const h = new Date().getHours();
      const greet = h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
      greetingTitle.textContent = `${greet}, ${honorificName}`;
    }

    // 2. Topbar Profile Badge (UI right side)
    const topbarName = document.getElementById('topbar-user-name');
    const topbarCompany = document.getElementById('topbar-user-company');
    const topbarAvatar = document.getElementById('topbar-avatar');
    if (topbarName) {
      topbarName.textContent = honorificName; // e.g. "Vishal Sir"
      topbarName.title = `${profile.name} (${profile.email || 'Workspace'})`;
    }
    if (topbarCompany) topbarCompany.textContent = profile.company || 'Workspace';
    if (topbarAvatar) topbarAvatar.textContent = profile.avatar || 'VS';

    // 3. Chat Greeting (Client AI Hero)
    const welcomeGreeting = document.getElementById('welcome-greeting');
    if (welcomeGreeting) {
      const h = new Date().getHours();
      const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
      welcomeGreeting.innerHTML = `${greet}, <span class="lx-greet-name">${honorificName}</span>`;
    }

    // 3b. Candidate AI Hero — same identity, its own purpose-specific line.
    const candidateGreeting = document.getElementById('candidate-welcome-greeting');
    if (candidateGreeting) {
      candidateGreeting.innerHTML = `Find real candidates, <span class="lx-greet-name">instantly</span>`;
    }

    // 4. Rudra24 AI Greeting
    const jarvisGreet = document.getElementById('jarvis-welcome-text');
    if (jarvisGreet) {
      jarvisGreet.textContent = `Namaste ${honorificName}! Main Rudra hoon.`;
    }

    // 5. Sidebar Branding
    const brandText = document.getElementById('logo-brand-text');
    if (brandText) brandText.textContent = 'Rudra24 AI';
    const sidebarSub = document.querySelector('#sidebar .logo-sub');
    if (sidebarSub) sidebarSub.textContent = 'Rudra24 AI';

    // Legacy selectors
    const brandSub = document.querySelector('.sidebar-brand-sub');
    if (brandSub) brandSub.textContent = 'Rudra24 AI';
    const brandName = document.querySelector('.sidebar-brand-name');
    if (brandName) brandName.textContent = 'Rudra24 AI';

    // 6. Settings Form Inputs (both settings modal and config)
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || '';
    };
    setVal('settings-profile-name', profile.name);
    setVal('settings-profile-company', profile.company);
    setVal('settings-profile-email', profile.email);
    setVal('settings-profile-phone', profile.phone);
    setVal('cfg-profile-name', profile.name);
    setVal('cfg-profile-company', profile.company);
    setVal('cfg-profile-email', profile.email);
    setVal('cfg-profile-phone', profile.phone);
    setVal('cfg-profile-role', profile.role);

    // Gender radio
    const gender = profile.gender || 'other';
    const genderRadio = document.getElementById(`settings-gender-${gender}`);
    if (genderRadio) genderRadio.checked = true;

    // App name setting
    const appName = localStorage.getItem('skylark-app-name') || RUDRA_APP_NAME;
    setVal('settings-app-name', appName);

    // 7. Account/Email signature update
    const sigEl = document.getElementById('email-signature-rich');
    if (sigEl && profile.name) {
      sigEl.innerHTML = `Best regards,<br><b>${profile.name}</b><br><span style="color:#5f6368;font-size:12px;">${profile.company || 'Workspace'} • ${profile.phone || ''}</span>`;
    }

    // Dispatch global event for all listeners
    try {
      document.dispatchEvent(new CustomEvent('nexus:profilechange', { detail: profile }));
    } catch (_) {}
  },

  loadIntoSettings() {
    this.syncUI();
  },

  saveFromSettings() {
    const name     = (document.getElementById('settings-profile-name')?.value  || document.getElementById('cfg-profile-name')?.value    || '').trim();
    const company  = (document.getElementById('settings-profile-company')?.value || document.getElementById('cfg-profile-company')?.value || '').trim();
    const email    = (document.getElementById('settings-profile-email')?.value  || document.getElementById('cfg-profile-email')?.value   || '').trim();
    const phone    = (document.getElementById('settings-profile-phone')?.value  || document.getElementById('cfg-profile-phone')?.value   || '').trim();
    const appName  = (document.getElementById('settings-app-name')?.value || '').trim();

    // Read gender radio
    const genderRadio = document.querySelector('input[name="settings-gender"]:checked');
    const gender = genderRadio ? genderRadio.value : 'other';

    if (!name) {
      if (window.AntigravityAuth && window.AntigravityAuth.showToast) {
        window.AntigravityAuth.showToast('Please enter your full name', 'error');
      } else {
        alert('Please enter your full name');
      }
      return;
    }

    this.saveProfile({
      name,
      company:  company  || 'Enterprise',
      email:    email    || '',
      phone:    phone    || '',
      gender:   gender
    });

    // Save and sync app name
    if (appName) {
      localStorage.setItem('skylark-app-name', appName);
    }

    const honorific = this.getHonorificName(name, gender);
    if (window.AntigravityAuth && window.AntigravityAuth.showToast) {
      window.AntigravityAuth.showToast(`✓ Profile saved! You will be addressed as: ${honorific}`, 'success');
    } else if (typeof window.showToast === 'function') {
      window.showToast('success', 'Profile Updated', `You will now be addressed as: ${honorific}`);
    }
  }
};

// ──────────────────────────────────────────────
//  2. 3D MOUSE PHYSICS & AMBIENT SPOTLIGHT
// ──────────────────────────────────────────────
window.AntigravityAuth = {
  currentTab: 'signup', // 'signup' or 'login'
  captchaAnswer: null,
  mouse: { x: 0, y: 0, targetX: 0, targetY: 0 },
  rafId: null,
  _transitioningUserId: '',

  init() {
    this.bindMouseEffects();
    this.generateCaptcha();
    this.bindFormEvents();
    this.checkInitialSession();
  },

  async checkInitialSession() {
    const feedback = document.getElementById('ag-auth-feedback');
    if (feedback) feedback.hidden = true;
    // Keep sign-in hidden while the persisted Supabase session is restored. Showing
    // it first causes a login flash on every refresh for returning users.
    const authScreen = document.getElementById('auth-screen');
    const appShell = document.getElementById('app-shell');
    if (authScreen) {
      authScreen.style.display = 'none';
      authScreen.classList.add('ag-hidden');
    }
    if (appShell) appShell.style.display = 'none';
    const form = document.getElementById('ag-auth-form');
    const tabs = document.getElementById('ag-segmented-tabs');
    const subtitle = document.getElementById('ag-card-sub');
    const title = document.getElementById('ag-card-title');
    if (form) form.style.display = '';
    if (tabs) tabs.style.display = '';
    if (title) title.textContent = RUDRA_APP_NAME;
    if (subtitle) subtitle.textContent = RUDRA_APP_DESCRIPTION;
    const googleText = document.getElementById('ag-google-btn-text');
    if (googleText) googleText.textContent = 'Continue with Google';
    this.switchTab('login');
    const ready = await window.SupabaseAuth?.init?.();
    if (!ready?.success) {
      if (authScreen) {
        authScreen.style.display = '';
        authScreen.classList.remove('ag-hidden');
        authScreen.classList.add('ag-auth-screen');
      }
      if (feedback) {
        feedback.hidden = false;
        const message = feedback.querySelector('[data-auth-message]');
        if (message) message.textContent = ready?.error || 'Sign-in is temporarily unavailable.';
      }
    }
    return;
  },

  bindMouseEffects() {
    const screen = document.getElementById('auth-screen');
    const stage = document.getElementById('ag-auth-stage');
    const spotlight = document.getElementById('ag-cursor-spotlight');
    if (!screen || !stage) return;

    // Track mouse on auth screen — only for subtle spotlight, NO 3D tilt (causes text blur)
    screen.addEventListener('mousemove', (e) => {
      // Move Cursor Spotlight only (no 3D rotation)
      if (spotlight) {
        spotlight.style.left = `${e.clientX}px`;
        spotlight.style.top = `${e.clientY}px`;
        spotlight.style.opacity = '1';
      }
      // Subtle card shine only (no blur-causing rotation)
      const cardRect = stage.getBoundingClientRect();
      const shineX = ((e.clientX - cardRect.left) / cardRect.width) * 100;
      const shineY = ((e.clientY - cardRect.top) / cardRect.height) * 100;
      stage.style.setProperty('--shine-x', `${shineX}%`);
      stage.style.setProperty('--shine-y', `${shineY}%`);
    });

    screen.addEventListener('mouseleave', () => {
      if (spotlight) spotlight.style.opacity = '0';
    });
  },

  // ── Tab Switching ──
  switchTab(tab) {
    this.currentTab = tab;
    const tabContainer = document.getElementById('ag-segmented-tabs');
    const signupBtn = document.getElementById('ag-tab-signup');
    const loginBtn = document.getElementById('ag-tab-login');
    const signupFields = document.querySelectorAll('.ag-signup-only');
    const submitBtn = document.getElementById('ag-submit-btn');
    const cardTitle = document.getElementById('ag-card-title');
    const cardSub = document.getElementById('ag-card-sub');
    const emailInput = document.getElementById('ag-input-email');
    const forgotRow = document.getElementById('ag-forgot-row');
    const formGrid = document.getElementById('ag-form-grid');

    // Check if this is a known device (password-only mode)
    const isKnownDevice = false; // Passwords are verified by Supabase on every sign-in.

    if (tabContainer) tabContainer.setAttribute('data-tab', tab);
    if (formGrid) formGrid.setAttribute('data-tab', tab);

    if (tab === 'signup') {
      if (signupBtn) signupBtn.classList.add('active');
      if (loginBtn) loginBtn.classList.remove('active');
      signupFields.forEach(el => el.style.display = '');
      if (forgotRow) forgotRow.style.display = 'none';
      if (submitBtn) {
        submitBtn.innerHTML = `<span>Create Account &amp; Sync</span> <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>`;
      }
      if (cardTitle) cardTitle.textContent = RUDRA_APP_NAME;
      if (cardSub) cardSub.textContent = RUDRA_APP_DESCRIPTION;
    } else {
      if (loginBtn) loginBtn.classList.add('active');
      if (signupBtn) signupBtn.classList.remove('active');
      signupFields.forEach(el => el.style.display = 'none');
      if (forgotRow) forgotRow.style.display = 'flex';
      if (submitBtn) {
        submitBtn.innerHTML = `<span>Sign In</span> <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>`;
      }

      if (isKnownDevice) {
        // KNOWN DEVICE: Password-only mode — personalized greeting, hide email
        const deviceProfile = window.DeviceAccount.getProfile();
        const firstName = (deviceProfile && deviceProfile.name) ? deviceProfile.name.split(/\s+/)[0] : '';
        const savedEmail = (deviceProfile && deviceProfile.email) ? deviceProfile.email : '';

        if (cardTitle) cardTitle.textContent = RUDRA_APP_NAME;
        if (cardSub) cardSub.textContent = savedEmail
          ? `Enter your password to continue${firstName ? `, ${firstName}` : ''}`
          : 'Enter your password to unlock the app';

        // Hide email field — not needed on known device
        if (emailInput) {
          const emailParent = emailInput.closest('.ag-form-row') || emailInput.closest('.ag-input-group') || emailInput.parentElement;
          if (emailParent) emailParent.style.display = 'none';
        }
        // Hide captcha on login
        const captchaInput = document.getElementById('ag-input-captcha');
        if (captchaInput) {
          const captchaParent = captchaInput.closest('.ag-form-row') || captchaInput.closest('.ag-input-group') || captchaInput.parentElement;
          if (captchaParent) captchaParent.style.display = 'none';
        }
      } else {
        // NEW DEVICE: show email field for cross-device sync
        const existingEmail = window.CloudSyncManager?.getActiveEmail?.() || window.UserProfileManager?.getProfile?.()?.email || '';
        if (emailInput && !emailInput.value && existingEmail) {
          emailInput.value = existingEmail;
        }
        if (cardTitle) cardTitle.textContent = RUDRA_APP_NAME;
        if (cardSub) cardSub.textContent = RUDRA_APP_DESCRIPTION;
      }
    }

    const pw = document.getElementById('ag-input-password');
    if (pw) pw.setAttribute('autocomplete', tab === 'signup' ? 'new-password' : 'current-password');
  },

  /**
   * Pre-fills active user email if available (only real emails, not placeholders)
   */
  applyDeviceMode() {
    const FAKE_EMAILS = ['default@aileads.ai', 'demo@aileads.ai', ''];
    const existingEmail = window.CloudSyncManager?.getActiveEmail?.() || window.UserProfileManager?.getProfile?.()?.email || '';
    const emailInput = document.getElementById('ag-input-email');
    // Only pre-fill REAL emails — never pre-fill fake/demo/default emails
    if (emailInput && !emailInput.value && existingEmail && !FAKE_EMAILS.includes(existingEmail.trim().toLowerCase())) {
      emailInput.value = existingEmail;
    }
  },

  /**
   * One-Click Google Account Sign In & Cloud Data Sync
   * Opens the authentic Google Identity Services Account Picker Modal
   */
  /**
   * One-Click Google Account Sign In & Cloud Data Sync
   * Opens the authentic Google Identity Services flow
   */
  handleGoogleLogin() {
    const button = document.getElementById('ag-google-sync-btn');
    const label = document.getElementById('ag-google-btn-text');
    if (button) button.disabled = true;
    if (label) label.textContent = 'Connecting to Google…';
    window.SupabaseAuth?.signInWithGoogle?.().then((result) => {
      if (!result?.success) {
        if (button) button.disabled = false;
        if (label) label.textContent = 'Continue with Google';
        this.showToast(result?.error || 'Google sign-in failed.', 'error');
      }
    }).catch(() => {
      if (button) button.disabled = false;
      if (label) label.textContent = 'Continue with Google';
      this.showToast('Google sign-in failed. Please retry.', 'error');
    });
  },

  async handleSupabaseSession(nextSession) {
    const authScreen = document.getElementById('auth-screen');
    const appShell = document.getElementById('app-shell');
    if (!nextSession?.user) {
      this._transitioningUserId = '';
      localStorage.setItem('skylark_logged_in', 'false');
      localStorage.removeItem('skylark_active_email');
      localStorage.removeItem('skylark_user_profile');
      localStorage.removeItem('skylark_user');
      window.allLeads = [];
      window.all_candidates = [];
      if (appShell) appShell.style.display = 'none';
      if (authScreen) {
        authScreen.style.display = '';
        authScreen.classList.remove('ag-hidden');
        authScreen.classList.add('ag-auth-screen');
      }
      window.dispatchEvent(new Event('clavis:workspace-change'));
      return;
    }
    const authUser = nextSession.user;
    if (this._transitioningUserId === authUser.id ||
        (authScreen?.classList.contains('ag-hidden') && appShell?.style.display === 'flex')) return;
    this._transitioningUserId = authUser.id;
    const metadata = authUser.user_metadata || {};
    const email = String(authUser.email || '').trim().toLowerCase();
    if (!email) { this._transitioningUserId = ''; return; }
    const previousEmail = localStorage.getItem('skylark_active_email') || '';
    if (previousEmail && previousEmail !== email) {
      window.allLeads = [];
      window.all_candidates = [];
    }
    const name = String(metadata.full_name || metadata.name || email.split('@')[0] || 'User').trim();
    const profile = window.UserProfileManager.saveProfile({
      id: authUser.id,
      name,
      company: metadata.company || 'Workspace',
      email,
      phone: metadata.phone || '',
      role: 'Owner',
      avatar: metadata.avatar_url || metadata.picture || ''
    });
    if (email) localStorage.setItem('skylark_active_email', email);
    localStorage.setItem('skylark_logged_in', 'true');
    if (profile && window.DeviceAccount?.clear) {
      try { Promise.resolve(window.DeviceAccount.clear()).catch(() => {}); } catch (_) {}
    }
    this.showToast(`Welcome, ${profile?.firstName || name.split(/\s+/)[0]}!`, 'success');
    this.transitionToApp();
    this._transitioningUserId = '';
  },

  renderGoogleButton(clientId) {
    const container = document.getElementById('ag-google-id-button');
    if (!container) return;
    const render = () => {
      if (!window.google?.accounts?.id) return false;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => this.handleGoogleCredential(response),
        auto_select: false,
        cancel_on_tap_outside: true,
        ux_mode: 'popup'
      });
      container.replaceChildren();
      window.google.accounts.id.renderButton(container, {
        type: 'standard', theme: 'outline', size: 'large', text: 'signin_with',
        shape: 'rectangular', logo_alignment: 'left', width: 280
      });
      return true;
    };
    if (render()) return;
    setTimeout(() => {
      if (!render()) this.showToast('Google sign-in could not load. Check your internet connection.', 'error');
    }, 1200);
  },

  async handleGoogleCredential(response) {
    const credential = String(response?.credential || '').trim();
    if (credential.length < 20) {
      this.showToast('Google verification was not completed.', 'error');
      return;
    }
    await this.finishGoogleLogin('', '', '', credential);
  },

  /**
   * Discovers genuine Google and workspace emails available on this laptop/device.
   * Never fabricates mock/placeholder emails.
   */
  getLaptopAccounts() {
    const map = new Map();
    const MOCK_EMAILS = new Set([
      'khushi.leads@gmail.com',
      'khushi.workspace@gmail.com',
      'demo@aileads.ai',
      'default@aileads.ai'
    ]);
    
    // 1. Saved laptop accounts registry
    try {
      const saved = JSON.parse(localStorage.getItem('skylark_laptop_accounts') || '[]');
      if (Array.isArray(saved)) {
        saved.forEach(acc => {
          if (acc && acc.email && acc.email.includes('@')) {
            const clean = acc.email.trim().toLowerCase();
            if (MOCK_EMAILS.has(clean)) return; // Ignore legacy fake placeholders
            map.set(clean, {
              email: clean,
              name: acc.name || clean.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
              avatarColor: acc.avatarColor || 'ag-g-avatar--blue',
              badge: acc.badge || 'Google Account',
              lastUsed: acc.lastUsed || 0,
              removable: true
            });
          }
        });
      }
    } catch (_) {}

    // 2. Active session email (if genuine)
    try {
      const active = window.CloudSyncManager?.getActiveEmail?.() || localStorage.getItem('skylark_active_email');
      const prof = window.UserProfileManager?.getProfile?.() || {};
      if (active && active.includes('@')) {
        const clean = active.trim().toLowerCase();
        if (!MOCK_EMAILS.has(clean)) {
          map.set(clean, {
            email: clean,
            name: prof.name || clean.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            avatarColor: 'ag-g-avatar--emerald',
            badge: 'Signed in',
            lastUsed: Date.now(),
            removable: true
          });
        }
      }
    } catch (_) {}

    // 3. User profile manager email (if genuine)
    try {
      const prof = window.UserProfileManager?.getProfile?.();
      if (prof && prof.email && prof.email.includes('@')) {
        const clean = prof.email.trim().toLowerCase();
        if (!MOCK_EMAILS.has(clean) && !map.has(clean)) {
          map.set(clean, {
            email: clean,
            name: prof.name || clean.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            avatarColor: 'ag-g-avatar--warm',
            badge: 'Saved Profile',
            lastUsed: Date.now() - 1000,
            removable: true
          });
        }
      }
    } catch (_) {}

    const accounts = Array.from(map.values());
    accounts.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
    return accounts;
  },

  /**
   * Saves a genuine account into laptop remembered list
   */
  rememberLaptopAccount(email, name = '', badge = 'Google Account') {
    if (!email || !email.includes('@')) return;
    const clean = email.trim().toLowerCase();
    if (clean === 'demo@aileads.ai' || clean === 'default@aileads.ai') return;
    const cleanName = name || clean.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    try {
      let list = JSON.parse(localStorage.getItem('skylark_laptop_accounts') || '[]');
      if (!Array.isArray(list)) list = [];
      list = list.filter(item => item && item.email && item.email.toLowerCase() !== clean);
      list.unshift({
        email: clean,
        name: cleanName,
        avatarColor: 'ag-g-avatar--blue',
        badge: badge,
        lastUsed: Date.now()
      });
      localStorage.setItem('skylark_laptop_accounts', JSON.stringify(list.slice(0, 15)));
    } catch (_) {}
  },

  /**
   * Removes an account from laptop list
   */
  removeLaptopAccount(email, event) {
    if (event) event.stopPropagation();
    try {
      let list = JSON.parse(localStorage.getItem('skylark_laptop_accounts') || '[]');
      if (Array.isArray(list)) {
        list = list.filter(item => item.email !== email.toLowerCase());
        localStorage.setItem('skylark_laptop_accounts', JSON.stringify(list));
      }
    } catch (_) {}
    this.openGoogleModal(); // Re-render list immediately
  },

  /**
   * Populates browser datalists so typing shows genuine laptop emails natively
   */
  populateLaptopDatalist() {
    const datalist = document.getElementById('ag-g-laptop-emails-datalist');
    if (!datalist) return;
    datalist.innerHTML = '';

    const accounts = this.getLaptopAccounts();
    accounts.forEach(acc => {
      const opt = document.createElement('option');
      opt.value = acc.email;
      opt.label = `${acc.name} (${acc.badge || 'Google'})`;
      datalist.appendChild(opt);
    });
  },

  /**
   * Opens the Google Sign-In Modal (Google Identity Services Style)
   * If genuine accounts exist on this laptop, shows chooser; otherwise opens direct sign-in input.
   */
  openGoogleModal() {
    const modal = document.getElementById('ag-google-modal');
    if (!modal) return;

    const accounts = this.getLaptopAccounts();

    // If we have saved accounts on this device, show chooser screen.
    // If no accounts yet, directly open the authentic Google Sign-In input screen!
    // Never authenticate from a remembered email; only a fresh Google token
    // from GIS can establish identity.
    if (false && accounts.length > 0) {
      this.showGoogleChooserScreen();
      this.populateLaptopDatalist();

      const accountList = document.getElementById('ag-g-account-list');
      if (accountList) {
        accountList.innerHTML = '';
        accounts.forEach(acc => {
          const initial = (acc.name || acc.email || 'G').charAt(0).toUpperCase();
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'ag-g-account-row';
          row.onclick = () => this.selectGoogleAccount(acc.email, acc.name);

          const badgeHtml = acc.badge === 'Signed in'
            ? '<span class="ag-g-signed-in-badge">Signed in</span>'
            : `<span class="ag-g-acc-badge">${acc.badge || 'Google'}</span>`;

          const removeBtnHtml = `<span class="ag-g-remove-acc" title="Remove from this laptop" onclick="AntigravityAuth.removeLaptopAccount('${acc.email}', event)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></span>`;

          row.innerHTML = `
            <div class="ag-g-avatar ${acc.avatarColor}">${initial}</div>
            <div class="ag-g-account-info">
              <div class="ag-g-account-name">
                <span>${acc.name}</span>
              </div>
              <div class="ag-g-account-email">${acc.email}</div>
            </div>
            ${badgeHtml}
            ${removeBtnHtml}
          `;
          accountList.appendChild(row);
        });
      }
    } else {
      // First time on this laptop: Directly show Google Account input screen
      this.showGoogleInputScreen();
    }

    modal.style.display = 'flex';
    requestAnimationFrame(() => {
      modal.classList.add('active');
      modal.setAttribute('aria-hidden', 'false');
    });

    // Keyboard navigation (Escape closes modal)
    this._googleKeyHandler = (e) => {
      if (e.key === 'Escape') this.closeGoogleModal();
    };
    window.addEventListener('keydown', this._googleKeyHandler);
  },

  /**
   * Switches to Google Account Chooser Screen
   */
  showGoogleChooserScreen() {
    const accounts = this.getLaptopAccounts();
    if (accounts.length === 0) {
      this.showGoogleInputScreen();
      return;
    }

    const chooser = document.getElementById('ag-g-screen-chooser');
    const input = document.getElementById('ag-g-screen-input');
    const loading = document.getElementById('ag-g-screen-loading');
    const pwScreen = document.getElementById('ag-g-screen-password');
    const loaderLine = document.getElementById('ag-g-loader-line');

    if (chooser) chooser.style.display = 'flex';
    if (input) input.style.display = 'none';
    if (pwScreen) pwScreen.style.display = 'none';
    if (loading) loading.style.display = 'none';
    if (loaderLine) loaderLine.style.display = 'none';
  },

  /**
   * Switches to Custom Google Email Entry Screen
   */
  showGoogleInputScreen() {
    const chooser = document.getElementById('ag-g-screen-chooser');
    const input = document.getElementById('ag-g-screen-input');
    const loading = document.getElementById('ag-g-screen-loading');
    const pwScreen = document.getElementById('ag-g-screen-password');
    const loaderLine = document.getElementById('ag-g-loader-line');

    if (chooser) chooser.style.display = 'none';
    if (input) input.style.display = 'flex';
    if (pwScreen) pwScreen.style.display = 'none';
    if (loading) loading.style.display = 'none';
    if (loaderLine) loaderLine.style.display = 'none';

    input?.querySelector('.ag-g-field-wrap')?.style.setProperty('display', 'none');
    input?.querySelector('.ag-g-forgot-email')?.style.setProperty('display', 'none');
    input?.querySelector('.ag-g-input-actions')?.style.setProperty('display', 'none');


    // Set Back button text or behavior based on whether accounts exist
    const backBtn = input?.querySelector('.ag-g-btn-text');
    if (backBtn) {
      const accounts = this.getLaptopAccounts();
      if (accounts.length > 0) {
        backBtn.textContent = '← Back';
        backBtn.onclick = () => this.showGoogleChooserScreen();
      } else {
        backBtn.textContent = 'Cancel';
        backBtn.onclick = () => this.closeGoogleModal();
      }
    }

    setTimeout(() => {
      const emailInput = document.getElementById('ag-g-input-email');
      if (emailInput) {
        emailInput.value = '';
        emailInput.style.borderColor = '';
        emailInput.focus();
      }
    }, 50);
  },

  /**
   * Submits custom Google email entered by user
   */
  submitCustomGoogleEmail() {
    this.showToast('Use the official Google sign-in button so your account can be verified.', 'error');
  },

  /**
   * Selects Google Account and performs cloud synchronization
   */
  pendingGoogleUser: null,

  /**
   * Selects Google Account and performs cloud synchronization
   */
  async selectGoogleAccount(email, name, avatar = '') {
    const cleanEmail = email.trim().toLowerCase();
    const rawName = name || cleanEmail.split('@')[0];
    const cleanName = window.UserProfileManager ? window.UserProfileManager.cleanRawName(rawName) : rawName;

    this.pendingGoogleUser = { email: cleanEmail, name: cleanName, avatar };

    const hasDeviceAccount = !!(window.DeviceAccount && window.DeviceAccount.exists());
    const formPassword = document.getElementById('ag-input-password')?.value.trim();

    if (!hasDeviceAccount) {
      if (formPassword && formPassword.length >= 4) {
        // Auto-use password entered in signup form input if present
        const userId = window.UserStorage ? window.UserStorage.emailToUserId(cleanEmail) : 'usr_' + cleanEmail.replace(/[^a-z0-9]/g, '_');
        if (window.DeviceAccount) {
          await window.DeviceAccount.create(formPassword, { id: userId, name: cleanName, email: cleanEmail });
        }
        await this.finishGoogleLogin(cleanEmail, cleanName, avatar);
      } else {
        // Show Password Setup screen in Google Modal!
        this.showGooglePasswordScreen(cleanName, cleanEmail);
      }
    } else {
      // Device account already exists -> finish Google Sign In immediately!
      await this.finishGoogleLogin(cleanEmail, cleanName, avatar);
    }
  },

  showGooglePasswordScreen(name, email) {
    const chooser = document.getElementById('ag-g-screen-chooser');
    const input = document.getElementById('ag-g-screen-input');
    const loading = document.getElementById('ag-g-screen-loading');
    const pwScreen = document.getElementById('ag-g-screen-password');

    if (chooser) chooser.style.display = 'none';
    if (input) input.style.display = 'none';
    if (loading) loading.style.display = 'none';

    if (pwScreen) {
      pwScreen.style.display = 'flex';
      const title = document.getElementById('ag-g-pw-title');
      const sub = document.getElementById('ag-g-pw-sub');
      if (title) title.textContent = `Set Password for ${name}`;
      if (sub) sub.textContent = `Create an unlock password for your workspace (${email}) on this device`;
      setTimeout(() => {
        const inputPw = document.getElementById('ag-g-input-password');
        if (inputPw) { inputPw.value = ''; inputPw.focus(); }
      }, 80);
    } else {
      // Fallback prompt
      const pw = prompt(`Welcome, ${name}!\nCreate a workspace unlock password for this device (min 8 chars):`);
      if (pw && pw.trim().length >= 8) {
        const userId = window.UserStorage ? window.UserStorage.emailToUserId(email) : 'usr_' + email.replace(/[^a-z0-9]/g, '_');
        window.DeviceAccount.create(pw.trim(), { id: userId, name, email }).then(() => {
          this.finishGoogleLogin(email, name);
        });
      } else {
        alert('Password must be at least 8 characters');
      }
    }
  },

  async submitGooglePasswordSetup() {
    const pwInput = document.getElementById('ag-g-input-password');
    const password = pwInput?.value.trim();

    if (!password || password.length < 8) {
      if (pwInput) pwInput.style.borderColor = '#d93025';
      this.showToast('Password must be at least 8 characters', 'error');
      return;
    }

    const { email, name, avatar } = this.pendingGoogleUser || {};
    if (!email) {
      this.showToast('Google account session expired. Please retry.', 'error');
      this.showGoogleChooserScreen();
      return;
    }

    const userId = window.UserStorage ? window.UserStorage.emailToUserId(email) : 'usr_' + email.replace(/[^a-z0-9]/g, '_');
    if (window.DeviceAccount) {
      await window.DeviceAccount.create(password, { id: userId, name, email });
    }

    await this.finishGoogleLogin(email, name, avatar);
  },

  async finishGoogleLogin(cleanEmail, cleanName, avatar = '', credential = '') {
    if (!credential) {
      this.showToast('Google verification is required before signing in.', 'error');
      return;
    }
    // Remember this account on the laptop
    this.rememberLaptopAccount(cleanEmail, cleanName, 'Laptop Account');

    const chooser = document.getElementById('ag-g-screen-chooser');
    const input = document.getElementById('ag-g-screen-input');
    const pwScreen = document.getElementById('ag-g-screen-password');
    const loading = document.getElementById('ag-g-screen-loading');
    const loaderLine = document.getElementById('ag-g-loader-line');
    const loadingTitle = document.getElementById('ag-g-loading-title');
    const loadingSub = document.getElementById('ag-g-loading-sub');

    if (chooser) chooser.style.display = 'none';
    if (input) input.style.display = 'none';
    if (pwScreen) pwScreen.style.display = 'none';
    if (loading) loading.style.display = 'flex';
    if (loaderLine) loaderLine.style.display = 'block';

    if (loadingTitle) loadingTitle.textContent = `Signing in as ${cleanName}…`;
    if (loadingSub) loadingSub.textContent = `Connecting ${cleanEmail} to cloud sync…`;

    try {
      if (window.CloudSyncManager && typeof window.CloudSyncManager.googleLogin === 'function') {
        const res = await window.CloudSyncManager.googleLogin({ credential });

        if (res && res.success) {
          this.showToast(`✅ Synced with Google (${res.user?.email || 'your account'})!`, 'success');
          setTimeout(() => {
            this.closeGoogleModal();
            this.transitionToApp();
          }, 600);
          return;
        }
      }

      this.showToast('Google sign-in failed. No local fallback was used.', 'error');
    } catch (err) {
      console.error('Google login error:', err);
      this.showToast('Google sign-in failed. Please retry.', 'error');
    }
  },


  /**
   * Closes the Google Sign-In Modal
   */
  closeGoogleModal() {
    const modal = document.getElementById('ag-google-modal');
    if (!modal) return;

    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      modal.style.display = 'none';
    }, 240);

    if (this._googleKeyHandler) {
      window.removeEventListener('keydown', this._googleKeyHandler);
      this._googleKeyHandler = null;
    }
  },

  /** Send a verified password-reset link through Supabase Auth. */
  handleForgot() {
    const email = document.getElementById('ag-input-email')?.value.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      this.showToast('Enter your account email to reset your password.', 'error');
      return;
    }
    window.SupabaseAuth.resetPassword(email).then(result => {
      this.showToast(result.success ? 'If that account exists, a reset link is on its way.' : (result.error || 'Reset failed.'), result.success ? 'success' : 'error');
    });
  },

  showPasswordRecovery() {
    this.currentTab = 'reset';
    const screen = document.getElementById('auth-screen');
    const shell = document.getElementById('app-shell');
    const email = document.getElementById('ag-input-email');
    const form = document.getElementById('ag-auth-form');
    const tabs = document.getElementById('ag-segmented-tabs');
    if (shell) shell.style.display = 'none';
    if (screen) { screen.style.display = ''; screen.classList.remove('ag-hidden'); }
    if (email) { email.value = window.SupabaseAuth?.getUser?.()?.email || ''; email.required = false; }
    if (form) form.style.display = '';
    if (tabs) tabs.style.display = 'none';
    document.querySelectorAll('.ag-signup-only').forEach(el => { el.style.display = 'none'; });
    const title = document.getElementById('ag-card-title');
    const subtitle = document.getElementById('ag-card-sub');
    const submit = document.getElementById('ag-submit-btn');
    if (title) title.textContent = RUDRA_APP_NAME;
    if (subtitle) subtitle.textContent = 'Choose a password for your Rudra24 AI account';
    if (submit) submit.textContent = 'Save new password';
  },

  // ── Security Captcha ──
  generateCaptcha() {
    const num1 = Math.floor(Math.random() * 8) + 2;
    const num2 = Math.floor(Math.random() * 7) + 1;
    this.captchaAnswer = num1 + num2;
    const label = document.getElementById('ag-captcha-text');
    if (label) {
      label.textContent = `Security Check: ${num1} + ${num2} = ?`;
    }
  },

  // ── Password Visibility Toggle ──
  togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clip-rule="evenodd"/><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/></svg>`;
    } else {
      input.type = 'password';
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>`;
    }
  },

  // ── Form Submissions ──
  bindFormEvents() {
    const form = document.getElementById('ag-auth-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSubmit();
    });
  },

  async handleSubmit() {
    const email = document.getElementById('ag-input-email')?.value.trim().toLowerCase();
    const password = document.getElementById('ag-input-password')?.value || '';
    const submitBtn = document.getElementById('ag-submit-btn');
    const wasReset = this.currentTab === 'reset';
    if (!wasReset && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      this.showToast('Enter a valid email address.', 'error');
      return;
    }
    if (password.length < 8) {
      this.showToast('Password must be at least 8 characters.', 'error');
      return;
    }
    if (submitBtn) submitBtn.disabled = true;
    try {
      let result;
      if (this.currentTab === 'signup') {
        const name = document.getElementById('ag-input-name')?.value.trim();
        const company = document.getElementById('ag-input-company')?.value.trim();
        const phone = document.getElementById('ag-input-phone')?.value.trim();
        if (!name) { this.showToast('Enter your name.', 'error'); return; }
        result = await window.SupabaseAuth.signUp(email, password, { full_name: name, company, phone });
      } else if (wasReset) {
        result = await window.SupabaseAuth.updatePassword(password);
        if (result.success) {
          const tabs = document.getElementById('ag-segmented-tabs');
          if (tabs) tabs.style.display = '';
          this.switchTab('login');
        }
      } else {
        result = await window.SupabaseAuth.signInWithPassword(email, password);
      }
      if (!result?.success) this.showToast(result?.error || 'Sign-in failed.', 'error');
      else if (result.needsVerification) this.showToast('Check your email to verify your account, then sign in.', 'success');
      else if (wasReset) this.showToast('Password updated. Sign in to continue.', 'success');
    } catch (err) {
      this.showToast(err?.message || 'Sign-in failed.', 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
    return;
  },

  // ── Dev / Fast Demo Bypass ──
  devBypass() {
    // Never manufacture an authenticated browser session. A localStorage flag
    // is user-controlled and is not proof of identity. Keep an explicit,
    // opt-in localhost hook for development only; production has no bypass.
    if (!(location.hostname === 'localhost' && window.__CLAVIS_DEV_AUTH_BYPASS__ === true)) {
      this.showToast('Demo access is disabled. Please sign in.', 'error');
      return;
    }
    this.showToast('Development bypass enabled on localhost only.', 'info');
  },

  // ── Quick Access bypass ──
  quickAccess() {
    this.devBypass();
  },

  // ── BULLETPROOF Transition to App ──────────────────────────
  // Simple, reliable, no complex dependencies.
  // Works regardless of overlay presence or CSS issues.
  transitionToApp() {
    if (!window.SupabaseAuth?.getSession?.() || window.SupabaseAuth?.isRecoveryMode?.()) return;
    // Step 1: Mark as logged in (belt AND suspenders)
    localStorage.setItem('skylark_logged_in', 'true');

    const authScreen = document.getElementById('auth-screen');
    const appShell   = document.getElementById('app-shell');

    // Step 2: Start a restrained handoff. The old implementation immediately
    // hid auth and then launched a canvas particle burst, which looked like a
    // fireworks effect and could make the page feel blurry or blocked.
    if (authScreen) {
      authScreen.classList.remove('ag-hidden');
      authScreen.classList.add('ag-exit-soft');
      authScreen.style.pointerEvents = 'none';
    }

    // Step 3: Reveal the app shell IMMEDIATELY and visibly.
    // Previously this set opacity:0 and only restored it inside a nested
    // requestAnimationFrame chain. Browsers pause/throttle rAF under heavy load
    // or in a background tab, so the shell could stay invisible AND the auth
    // screen never got hidden — leaving the user stuck on the login page with
    // every button appearing to "do nothing". Visibility must never depend on
    // rAF firing, so we set the end-state synchronously; the fade is cosmetic.
    if (appShell) {
      appShell.removeAttribute('style');       // remove style="display:none"
      appShell.style.display = 'flex';
      appShell.classList.add('ag-app-enter-soft'); // cosmetic fade-in only
    }

    // Step 4: Hide the auth screen IMMEDIATELY (was stranded inside the rAF chain).
    if (authScreen) {
      authScreen.classList.add('ag-hidden');
      authScreen.classList.remove('ag-auth-screen', 'ag-exit-soft');
      authScreen.style.pointerEvents = '';
    }
    window.dispatchEvent(new Event('clavis:workspace-change'));

    // Step 5: Sync identity into the UI.
    try { window.UserProfileManager.syncUI(); } catch(e) {}

    // Step 6: Boot page controllers + restore account data. Deferred so the first
    // paint lands, but NOT gated on requestAnimationFrame.
    setTimeout(async () => {
      try {
        const uid = window.UserProfileManager.getCurrentUserId();
        if (window.MemoryEngine && window.MemoryEngine.switchUser) await window.MemoryEngine.switchUser(uid);
      } catch(e) {}

      // Restore this account's data now that the unlock has succeeded. Data is
      // keyed to skylark_active_email, which checkInitialSession preserves.
      try {
        const activeEmail = window.CloudSyncManager?.getActiveEmail?.();
        if (activeEmail && window.CloudSyncManager?.pullLatest) {
          await window.CloudSyncManager.pullLatest(activeEmail);
        }
      } catch (e) {
        console.warn('[Auth] Cloud pull failed, falling back to local vault:', e);
      }

      try { if (typeof AccountsCtrl !== 'undefined' && AccountsCtrl.init) AccountsCtrl.init(); } catch(e) {}
      try { if (typeof EmailCtrl !== 'undefined' && EmailCtrl.init) EmailCtrl.init(); } catch(e) {}
      try { if (typeof LeadsCtrl !== 'undefined' && LeadsCtrl.init) LeadsCtrl.init(); } catch(e) {}
      try { if (typeof CandidatesCtrl !== 'undefined' && CandidatesCtrl.init) CandidatesCtrl.init(); } catch(e) {}
      try { if (typeof DashboardCtrl !== 'undefined' && DashboardCtrl.init) DashboardCtrl.init(); } catch(e) {}
      try { if (typeof updateAllUI === 'function') updateAllUI(); } catch(e) {}
    }, 60);
  },

  // ── Sign Out ──
  async signOut() {
    const result = await window.SupabaseAuth?.signOut?.();
    if (result && !result.success) {
      this.showToast(result.error || 'Sign out failed.', 'error');
      return;
    }
    localStorage.removeItem('skylark_logged_in');
    const authScreen = document.getElementById('auth-screen');
    const appShell = document.getElementById('app-shell');

    if (appShell) appShell.style.display = 'none';
    if (authScreen) {
      authScreen.classList.remove('ag-hidden');
      authScreen.classList.add('ag-auth-screen');
      authScreen.style.display = '';  // let CSS flex !important take over
    }
    window.dispatchEvent(new Event('clavis:workspace-change'));
    this.switchTab('login');
    this.generateCaptcha();
    this.showToast('Signed out successfully', 'info');
  },

  // ── Toast Notifications ──
  showToast(message, type = 'info') {
    const existing = document.getElementById('ag-auth-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'ag-auth-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: ${type === 'error' ? '#EF4444' : type === 'success' ? '#10B981' : '#231F1C'};
      color: #FFFFFF;
      padding: 10px 18px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      font-family: 'Inter', sans-serif;
      box-shadow: 0 10px 30px rgba(0,0,0,0.25);
      z-index: 100000;
      opacity: 0;
      transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
      display: flex;
      align-items: center;
      gap: 8px;
      pointer-events: none;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
};

// ──────────────────────────────────────────────
//  3. TOPBAR PROFILE MENU CONTROLLER
// ──────────────────────────────────────────────
window.TopbarProfile = {
  toggleMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('topbar-profile-menu');
    if (!menu) return;
    menu.classList.toggle('open');
  },

  closeMenu() {
    const menu = document.getElementById('topbar-profile-menu');
    if (menu) menu.classList.remove('open');
  },

  openSettings() {
    this.closeMenu();
    if (typeof openSettingsModal === 'function') {
      openSettingsModal();
      // Switch to profile tab
      setTimeout(() => {
        const profileTabBtn = document.getElementById('settings-nav-profile');
        if (profileTabBtn) profileTabBtn.click();
      }, 100);
    } else if (typeof showView === 'function') {
      showView('settings');
    }
  },

  saveProfileFromSettings() {
    const name = document.getElementById('cfg-profile-name')?.value.trim();
    const company = document.getElementById('cfg-profile-company')?.value.trim();
    const email = document.getElementById('cfg-profile-email')?.value.trim();
    const phone = document.getElementById('cfg-profile-phone')?.value.trim();
    const role = document.getElementById('cfg-profile-role')?.value.trim();

    if (!name) {
      alert('Please enter your full name');
      return;
    }

    if (email && !email.includes('@')) {
      alert('Please enter a valid email address');
      return;
    }

    window.UserProfileManager.saveProfile({
      name,
      company: company || 'Enterprise',
      email: email || '',
      phone: phone || '',
      role: role || 'Managing Director'
    });

    if (email && email.includes('@')) {
      const clean = email.trim().toLowerCase();
      if (window.CloudSyncManager && typeof window.CloudSyncManager.setActiveEmail === 'function') {
        window.CloudSyncManager.setActiveEmail(clean);
      }
      const uid = window.UserStorage ? window.UserStorage.emailToUserId(clean) : 'usr_' + clean.replace(/[^a-z0-9]/g, '_');
      if (window.MemoryEngine && typeof window.MemoryEngine.switchUser === 'function') {
        window.MemoryEngine.switchUser(uid);
      }
      if (window.CloudSyncManager && typeof window.CloudSyncManager.pullCloudData === 'function') {
        window.CloudSyncManager.pullCloudData();
      }
    }

    // Visual feedback
    const btn = document.getElementById('btn-save-profile-settings');
    if (btn) {
      const origText = btn.innerHTML;
      btn.innerHTML = '✓ Saved &amp; Synced!';
      btn.style.background = '#10B981';
      setTimeout(() => {
        btn.innerHTML = origText;
        btn.style.background = '';
      }, 2000);
    }

    if (typeof showToast === 'function') {
      showToast(email ? 'Profile & Email Cloud Sync updated!' : 'Profile updated across all views!');
    }
  }

};

// Close topbar menu when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.topbar-user-badge')) {
    window.TopbarProfile.closeMenu();
  }
});

// Auto-initialize on load
window.addEventListener('DOMContentLoaded', () => {
  window.AntigravityAuth.init();
  window.UserProfileManager.syncUI();

  // Load saved app name into auth card title
  const savedAppName = localStorage.getItem('skylark-app-name');

  // Sync transition overlay app name
  const transText = document.querySelector('.ag-trans-app-name');
  if (transText) transText.textContent = savedAppName && savedAppName !== 'Neural Lead Intelligence' ? savedAppName : RUDRA_APP_NAME;
});

// ══════════════════════════════════════════════════════════════
//  CINEMATIC TRANSITION CANVAS — Particle burst + radial wipe
// ══════════════════════════════════════════════════════════════
let _transCanvas = null;
let _transCtx    = null;
let _transRaf    = null;
let _transStart  = 0;
const _transParticles = [];

function startTransitionCanvas() {
  const canvas = document.getElementById('ag-trans-canvas');
  if (!canvas) return;
  _transCanvas = canvas;
  _transCtx    = canvas.getContext('2d');

  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  _transParticles.length = 0;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const COLORS = ['#6C5CE7','#a78bfa','#7C3AED','#3b82f6','#0ea5e9','#ffffff'];

  // Generate burst particles
  for (let i = 0; i < 100; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 6;
    _transParticles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      decay: 0.008 + Math.random() * 0.012,
      size: 1.5 + Math.random() * 3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    });
  }

  _transStart = performance.now();
  _transRaf = requestAnimationFrame(drawTransFrame);
}

function drawTransFrame(now) {
  if (!_transCtx || !_transCanvas) return;
  const elapsed = (now - _transStart) / 1000; // seconds
  const W = _transCanvas.width, H = _transCanvas.height;

  // Fade trail
  _transCtx.fillStyle = 'rgba(10, 10, 15, 0.18)';
  _transCtx.fillRect(0, 0, W, H);

  // Radial gradient wipe expanding from center
  const maxR = Math.hypot(W, H) * 0.6;
  // requestAnimationFrame can deliver a timestamp slightly before the
  // transition start on the first frame. Canvas rejects a negative r1.
  const r    = Math.max(0, Math.min(elapsed * 280, maxR));
  const grad = _transCtx.createRadialGradient(W/2, H/2, 0, W/2, H/2, r);
  grad.addColorStop(0,   'rgba(108,92,231,0.12)');
  grad.addColorStop(0.5, 'rgba(60,40,140,0.06)');
  grad.addColorStop(1,   'rgba(0,0,0,0)');
  _transCtx.fillStyle = grad;
  _transCtx.beginPath();
  _transCtx.arc(W/2, H/2, r, 0, Math.PI * 2);
  _transCtx.fill();

  // Draw + update particles
  for (const p of _transParticles) {
    if (p.life <= 0) continue;
    _transCtx.globalAlpha = p.life * 0.85;
    _transCtx.fillStyle = p.color;
    _transCtx.beginPath();
    _transCtx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    _transCtx.fill();

    p.x    += p.vx;
    p.y    += p.vy;
    p.vx   *= 0.97;
    p.vy   *= 0.97;
    p.life -= p.decay;
  }

  _transCtx.globalAlpha = 1;
  _transRaf = requestAnimationFrame(drawTransFrame);
}

function stopTransitionCanvas() {
  if (_transRaf) { cancelAnimationFrame(_transRaf); _transRaf = null; }
  if (_transCtx && _transCanvas) {
    _transCtx.clearRect(0, 0, _transCanvas.width, _transCanvas.height);
  }
  _transCanvas = null;
  _transCtx    = null;
  _transParticles.length = 0;
}

window.startTransitionCanvas = startTransitionCanvas;
window.stopTransitionCanvas  = stopTransitionCanvas;
