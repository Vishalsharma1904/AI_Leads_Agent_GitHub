/**
 * auth.js
 * Bridges Legacy Auth Calls with Antigravity Luxury Auth & Profile Manager
 */
function safeLocalStorageGet(key, defaultValue = null) {
  try {
    const val = localStorage.getItem(key);
    return val !== null ? val : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

const AuthSystem = (() => {
  function init() {
    if (window.AntigravityAuth && window.AntigravityAuth.init) {
      window.AntigravityAuth.init();
    }
  }

  function handleSignup(event) {
    if (window.AntigravityAuth && window.AntigravityAuth.handleSubmit) {
      window.AntigravityAuth.handleSubmit();
    }
  }

  function handleLogin(event) {
    if (window.AntigravityAuth && window.AntigravityAuth.handleSubmit) {
      window.AntigravityAuth.handleSubmit();
    }
  }

  function developerBypass() {
    if (window.AntigravityAuth && window.AntigravityAuth.devBypass) {
      window.AntigravityAuth.devBypass();
    }
  }

  function togglePassword(inputId, btn) {
    if (window.AntigravityAuth && window.AntigravityAuth.togglePasswordVisibility) {
      window.AntigravityAuth.togglePasswordVisibility(inputId, btn);
    }
  }

  function getProfile() {
    if (window.UserProfileManager && window.UserProfileManager.getProfile) {
      return window.UserProfileManager.getProfile();
    }
    return { name: 'Admin', company: 'DevCorp Inc.' };
  }

  function updateBranding() {
    if (window.UserProfileManager && window.UserProfileManager.syncUI) {
      window.UserProfileManager.syncUI();
    }
  }

  return {
    init,
    handleSignup,
    handleLogin,
    developerBypass,
    togglePassword,
    getProfile,
    updateBranding
  };
})();

window.AuthSystem = AuthSystem;
