// ==========================================================================
// LinkAdda Full-Screen Mobile E-Commerce App Controller
// True App Screen Router (No Drawers) & Clean 'Profile' Label
// ==========================================================================

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCD_cZXyfYd01FNg-DmRpyKKBIGR3NqeT4",
  authDomain: "linkadda-cd1da.firebaseapp.com",
  projectId: "linkadda-cd1da",
  storageBucket: "linkadda-cd1da.firebasestorage.app",
  messagingSenderId: "989651324387",
  appId: "1:989651324387:web:f6e44be3daa9f4fc0c24d6",
  measurementId: "G-PCH50PK2N7",
  databaseURL: "https://linkadda-cd1da-default-rtdb.firebaseio.com"
};

// Resilient Dynamic Firebase Auth Loader (Zero latency on page load!)
let authInstance = null;
let googleProviderInstance = null;
let signInWithPopupFn = null;
let signInWithRedirectFn = null;
let getRedirectResultFn = null;
let signOutFn = null;

export async function getFirebaseAuth() {
  if (authInstance && googleProviderInstance && signInWithPopupFn) {
    return {
      auth: authInstance,
      googleProvider: googleProviderInstance,
      signInWithPopup: signInWithPopupFn,
      signInWithRedirect: signInWithRedirectFn,
      getRedirectResult: getRedirectResultFn,
      signOut: signOutFn
    };
  }
  try {
    const fbApp = await import("https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js");
    const fbAuth = await import("https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js");
    const app = fbApp.getApps().length ? fbApp.getApp() : fbApp.initializeApp(FIREBASE_CONFIG);
    authInstance = fbAuth.getAuth(app);
    googleProviderInstance = new fbAuth.GoogleAuthProvider();
    googleProviderInstance.setCustomParameters({ prompt: 'select_account' });
    signInWithPopupFn = fbAuth.signInWithPopup;
    signInWithRedirectFn = fbAuth.signInWithRedirect;
    getRedirectResultFn = fbAuth.getRedirectResult;
    signOutFn = fbAuth.signOut;
    return {
      auth: authInstance,
      googleProvider: googleProviderInstance,
      signInWithPopup: signInWithPopupFn,
      signInWithRedirect: signInWithRedirectFn,
      getRedirectResult: getRedirectResultFn,
      signOut: signOutFn
    };
  } catch (err) {
    console.warn('Firebase Auth dynamic loader notice:', err);
    return null;
  }
}

// Background eager warmup of Firebase Auth & check redirect result
export async function checkGoogleRedirectResult() {
  try {
    const fb = await getFirebaseAuth();
    if (!fb || !fb.getRedirectResult || !fb.auth) return;
    const result = await fb.getRedirectResult(fb.auth).catch(() => null);
    if (result && result.user) {
      const u = result.user;
      const customer = await resolveUnifiedCustomer(u.email, {
        displayName: u.displayName || u.email.split('@')[0],
        provider: 'google',
      });
      closeAuthModal();
      showAppToast(`Welcome back, ${customer.displayName}! 🎉`);
      const resumed = checkAndResumePendingCheckout();
      if (!resumed) {
        showProfilePage();
      }
    }
  } catch (err) {
    console.warn('Google Redirect Result check notice:', err);
  }
}

// Immediate zero-latency warmup so popup clicks have active user gesture
if (typeof window !== 'undefined') {
  getFirebaseAuth().then(() => checkGoogleRedirectResult()).catch(() => {});
}

const SESSION_KEY = 'jaigram_customer_session';
const LEGACY_SESSION_KEY = 'linkadda_customer_session';

// State variables
let currentEmail = '';
let currentToken = '';
let countdownInterval = null;
let countdownSeconds = 60;

// ━━ 0. STRING & HTML UTILITIES ━━
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

function sanitizeSafeActionUrl(url) {
  const clean = String(url || '').trim();
  if (/^(https?:\/\/|tg:\/\/)/i.test(clean)) {
    return escapeHtml(clean);
  }
  return '#';
}

// ━━ 1. CRYPTO & IDENTITY UTILITIES ━━
async function clientSha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function getApiEndpoint(path) {
  if (typeof window === 'undefined') return path;
  const port = window.location.port;
  if ((port === '5500' || port === '5501' || port === '3000' || port === '8080' || !port) && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return `http://localhost:8899${path}`;
  }
  return path;
}

export async function getCustomerId(email) {
  const clean = String(email || '').toLowerCase().trim();
  if (!clean || !clean.includes('@')) {
    const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : (Date.now().toString(36) + Math.random().toString(36).substring(2, 10));
    return `cust_${rand}`;
  }
  const hash = await clientSha256(clean);
  return `cust_${hash.substring(0, 16)}`;
}

// ━━ 2. UNIFIED SINGLE ACCOUNT RESOLVER ━━
export async function resolveUnifiedCustomer(email, incomingData = {}) {
  const cleanEmail = String(email || '').toLowerCase().trim();
  const uid = await getCustomerId(cleanEmail);
  const fallbackName = cleanEmail.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  let existing = incomingData.existingRecord || null;

  // 1. Check local session
  const local = getCustomerSession();
  if (local && local.email && local.email.toLowerCase() === cleanEmail) {
    existing = { ...local, ...existing };
  }

  // 2. Check remote database (parallel fast lookup) - skip if Google already provided a real name or record already has saved name
  const hasRealName = (existing?.displayName && existing.displayName !== fallbackName && existing.displayName !== 'Customer') ||
                      (incomingData.provider === 'google' && incomingData.displayName && incomingData.displayName !== fallbackName);

  if (!hasRealName && !incomingData.newName && !existing?.hasSavedName) {
    try {
      const timeoutPromise = (ms) => new Promise(r => setTimeout(r, ms));
      const fetchApi = fetch(getApiEndpoint(`/api/auth/customer?email=${encodeURIComponent(cleanEmail)}`), { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null).catch(() => null);
      const fetchRtdb = fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/events/customers/${uid}.json`)
        .then(r => r.ok ? r.json() : null).catch(() => null);

      const [apiRes, rtdbRes] = await Promise.race([
        Promise.all([fetchApi, fetchRtdb]),
        timeoutPromise(1200).then(() => [null, null])
      ]);

      if (apiRes?.customer) existing = { ...existing, ...apiRes.customer };
      if (rtdbRes && !rtdbRes.error) existing = { ...existing, ...rtdbRes };
    } catch (_) {}
  }

  // 5. Smart display name determination:
  // Persistent name check across sessions (never ask again once saved!)
  const persistentSavedName = localStorage.getItem('linkadda_customer_name_' + cleanEmail);
  const isNameMarkedSaved = localStorage.getItem('linkadda_name_saved_' + cleanEmail) === 'true';

  let finalDisplayName = persistentSavedName || existing?.displayName || fallbackName;
  let hasSavedCustomName = Boolean(
    persistentSavedName || 
    isNameMarkedSaved || 
    (existing?.hasSavedName && existing.displayName) ||
    (existing?.displayName && existing.displayName !== fallbackName && existing.displayName !== 'Customer' && existing.displayName !== cleanEmail)
  );

  if (incomingData.newName && String(incomingData.newName).trim()) {
    finalDisplayName = String(incomingData.newName).trim();
    hasSavedCustomName = true;
    localStorage.setItem('linkadda_customer_name_' + cleanEmail, finalDisplayName);
    localStorage.setItem('linkadda_name_saved_' + cleanEmail, 'true');
  } else if (persistentSavedName) {
    finalDisplayName = persistentSavedName;
    hasSavedCustomName = true;
  } else if (existing?.displayName && existing.displayName !== fallbackName && existing.displayName !== 'Customer') {
    finalDisplayName = existing.displayName;
    hasSavedCustomName = true;
    localStorage.setItem('linkadda_customer_name_' + cleanEmail, finalDisplayName);
    localStorage.setItem('linkadda_name_saved_' + cleanEmail, 'true');
  } else if (existing?.hasSavedName && existing.displayName) {
    finalDisplayName = existing.displayName;
    hasSavedCustomName = true;
    localStorage.setItem('linkadda_customer_name_' + cleanEmail, finalDisplayName);
    localStorage.setItem('linkadda_name_saved_' + cleanEmail, 'true');
  } else if (incomingData.provider === 'google' && incomingData.displayName && incomingData.displayName !== fallbackName) {
    finalDisplayName = incomingData.displayName;
    hasSavedCustomName = true;
    localStorage.setItem('linkadda_customer_name_' + cleanEmail, finalDisplayName);
    localStorage.setItem('linkadda_name_saved_' + cleanEmail, 'true');
  } else if (incomingData.displayName && String(incomingData.displayName).trim()) {
    finalDisplayName = String(incomingData.displayName).trim();
  }

  // Determine whether this user needs a first-time name prompt:
  // ONLY if they have NEVER saved a name before AND it's not Google!
  const isNewUserWithNameNeeded = !hasSavedCustomName && incomingData.provider !== 'google';

  // 6. Merge providers list (supports logging in with Google or Email OTP interchangeably)
  const incomingProvider = incomingData.provider || existing?.provider || 'email_otp';
  const existingProviders = Array.isArray(existing?.providers)
    ? existing.providers
    : (existing?.provider ? [existing.provider] : []);
  const mergedProviders = Array.from(new Set([...existingProviders, incomingProvider].filter(Boolean)));

  // 7. Construct Unified Customer Profile (No Avatar Image!)
  const sessionToken = incomingData.token || incomingData.sessionToken || incomingData.existingRecord?.sessionToken || existing?.sessionToken;
  const unifiedUser = {
    uid: uid,
    email: cleanEmail,
    displayName: finalDisplayName,
    hasSavedName: hasSavedCustomName,
    sessionToken: sessionToken || undefined,
    provider: incomingProvider,
    providers: mergedProviders,
    verified: true,
    createdAt: existing?.createdAt || Date.now(),
    lastLoginAt: Date.now(),
    isNewUserWithNameNeeded: isNewUserWithNameNeeded,
  };

  localStorage.setItem(SESSION_KEY, JSON.stringify(unifiedUser));
  localStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify(unifiedUser));
  syncCustomerToDatabase(unifiedUser);

  const welcomedKey = `jaigram_welcomed_${uid}`;
  if (!localStorage.getItem(welcomedKey) && !localStorage.getItem(`linkadda_welcomed_${uid}`)) {
    addUserWelcomeNotification(uid, unifiedUser.displayName);
  }

  window.dispatchEvent(new CustomEvent('jaigram:auth-changed', { detail: unifiedUser }));
  window.dispatchEvent(new CustomEvent('linkadda:auth-changed', { detail: unifiedUser }));
  updateHeaderUserUI();

  return unifiedUser;
}

export function getCustomerSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY) || localStorage.getItem(LEGACY_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

export async function logoutCustomer() {
  try {
    const fb = await getFirebaseAuth();
    if (fb && fb.signOut && fb.auth) {
      await fb.signOut(fb.auth).catch(() => {});
    }
  } catch (_) {}
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(LEGACY_SESSION_KEY);
  sessionStorage.removeItem('jaigram_pending_destination');
  sessionStorage.removeItem('linkadda_pending_destination');
  window.dispatchEvent(new CustomEvent('jaigram:auth-changed', { detail: null }));
  window.dispatchEvent(new CustomEvent('linkadda:auth-changed', { detail: null }));
  updateHeaderUserUI();

  const path = window.location.pathname.toLowerCase();
  if (path.includes('product') || path.includes('payment') || path.includes('/user')) {
    document.documentElement.style.display = 'none';
    window.location.replace((path.includes('/user/') ? '../' : '') + 'login.html');
    return;
  }

  showProfilePage();
  showAppToast('You have been signed out.');
}

export async function syncCustomerToDatabase(user) {
  if (!user || !user.uid) return;
  const payload = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    hasSavedName: user.hasSavedName !== undefined ? user.hasSavedName : true,
    provider: user.provider,
    providers: user.providers || (user.provider ? [user.provider] : ['email_otp']),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    newName: user.newName || undefined,
  };

  const reqHeaders = { 'Content-Type': 'application/json' };
  if (user.sessionToken) {
    reqHeaders['Authorization'] = `Bearer ${user.sessionToken}`;
  }

  // 1. Backend Serverless API sync (with admin credentials, guarantees persistence!)
  try {
    fetch(getApiEndpoint('/api/auth/customer'), {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch (_) {}

  // 2. Direct RTDB sync to /events/customers/ (admin panel reads from here via realtime listener)
  try {
    const eventsUrl = `https://linkadda-cd1da-default-rtdb.firebaseio.com/events/customers/${encodeURIComponent(user.uid)}.json`;
    await fetch(eventsUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        hasSavedName: user.hasSavedName !== undefined ? user.hasSavedName : true,
        provider: user.provider,
        providers: user.providers || [user.provider],
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      }),
    });
  } catch (_) {}

  // 3. Also sync to standard /customers/ (when rules allow direct writes)
  try {
    const url = `https://linkadda-cd1da-default-rtdb.firebaseio.com/customers/${encodeURIComponent(user.uid)}.json`;
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        hasSavedName: user.hasSavedName !== undefined ? user.hasSavedName : true,
        provider: user.provider,
        providers: user.providers || [user.provider],
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      }),
    });
  } catch (_) {}
}

// ━━ 3. LUXURY EMAIL HTML TEMPLATE (BREVO) ━━
function getLuxuryEmailTemplate(otp, userEmail) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your JaiGram Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #07060c; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #07060c; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 520px; background: linear-gradient(165deg, #161226 0%, #0d0b17 100%); border-radius: 24px; border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 25px 60px rgba(0,0,0,0.7), 0 0 40px rgba(255, 42, 141, 0.15); overflow: hidden;">
          <tr>
            <td style="padding: 36px 32px 24px; text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08); background: rgba(255, 255, 255, 0.02);">
              <div style="font-size: 26px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff;">
                JaiGram <span style="color: #ff2a8d; font-size: 26px; margin: 0 4px;">&#9819;</span> <span style="background: linear-gradient(135deg, #ff2a8d 0%, #ff7bb0 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Shop</span>
              </div>
              <div style="margin-top: 6px; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #94a3b8; font-weight: 700;">
                Authentic Premium Marketplace
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 32px 30px; text-align: center;">
              <div style="display: inline-block; padding: 6px 16px; border-radius: 9999px; background: rgba(255, 42, 141, 0.12); border: 1px solid rgba(255, 42, 141, 0.3); color: #ff65a3; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 18px;">
                &#128274; One-Time Verification Code
              </div>
              <h1 style="margin: 0 0 12px; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.3px;">
                Sign in to your account
              </h1>
              <p style="margin: 0 0 28px; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
                Use this single-use 6-digit code to securely authenticate for <strong style="color: #ffffff;">${userEmail}</strong>.
              </p>
              <!-- Prominent Copy-Ready OTP Box -->
              <div style="margin: 10px auto 20px; max-width: 340px; padding: 22px 24px; background: linear-gradient(135deg, rgba(255, 42, 133, 0.16) 0%, rgba(139, 92, 246, 0.12) 100%); border: 2px solid #ff2a85; border-radius: 18px; box-shadow: 0 10px 35px rgba(255, 42, 133, 0.35); text-align: center;">
                <span style="font-size: 42px; font-weight: 900; letter-spacing: 10px; color: #ffffff; font-family: 'SF Mono', Consolas, 'Courier New', monospace; display: block; user-select: all; -webkit-user-select: all; -moz-user-select: all; cursor: pointer; text-shadow: 0 0 16px rgba(255, 42, 133, 0.6);">${otp}</span>
                <div style="margin-top: 10px; display: inline-block; padding: 4px 12px; background: rgba(255, 255, 255, 0.08); border-radius: 6px; font-size: 11px; font-weight: 700; color: #ff65a3; letter-spacing: 0.5px;">
                  &#128203; Tap or click code to copy
                </div>
              </div>

              <!-- Direct CTA Action Button -->
              <div style="margin-bottom: 22px;">
                <a href="https://jaigram.shop/login.html" target="_blank" style="display: inline-block; padding: 13px 32px; background: linear-gradient(135deg, #ff2a85 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-weight: 800; font-size: 13.5px; border-radius: 12px; box-shadow: 0 6px 20px rgba(255, 42, 133, 0.45); text-transform: uppercase; letter-spacing: 0.6px;">
                  Open JaiGram Shop &rarr;
                </a>
              </div>

              <p style="margin: 0; font-size: 13px; color: #fb7185; font-weight: 600;">
                &#9201; Code expires in <strong>5 minutes</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 32px; background: rgba(255, 255, 255, 0.03); border-top: 1px solid rgba(255, 255, 255, 0.06); text-align: left;">
              <p style="margin: 0; font-size: 12px; line-height: 1.6; color: #94a3b8;">
                <strong style="color: #cbd5e1;">Security Notice:</strong> JaiGram will never ask you for this code. If you didn't request this, please ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 32px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.04);">
              <p style="margin: 0; font-size: 12px; color: #64748b;">
                &copy; ${new Date().getFullYear()} JaiGram Shop &bull; <a href="https://jaigram.shop" style="color: #ff2a8d; text-decoration: none; font-weight: 600;">jaigram.shop</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

// ━━ 4. UI HEADER UPDATER (STRICTLY 'PROFILE' - NO EMAIL!) ━━
export function updateHeaderUserUI() {
  const user = getCustomerSession();
  const headerBtn = document.getElementById('headerUserBtn');
  const mobBtn = document.getElementById('mobUserBtn');
  const appbarBtn = document.getElementById('appbarAccountBtn');

  // Desktop Header Button: strictly 'Profile' or 'Login' (NEVER EMAIL!)
  if (headerBtn) {
    if (user) {
      headerBtn.innerHTML = `
        <i class="fa-solid fa-circle-user" style="color: #ff2a8d; font-size: 1.05rem;"></i>
        <span class="fk-user-btn-text" id="headerUserBtnText">Profile</span>
      `;
    } else {
      headerBtn.innerHTML = `
        <i class="fa-solid fa-user"></i>
        <span class="fk-user-btn-text" id="headerUserBtnText">Login</span>
      `;
    }
  }

  // Mobile Drawer Button
  if (mobBtn) {
    const mobText = document.getElementById('mobUserBtnText');
    if (mobText) {
      mobText.textContent = user ? 'My Profile' : 'Sign In / Account';
    }
  }

  // Mobile Bottom App Bar Account Tab
  if (appbarBtn) {
    if (user) {
      appbarBtn.innerHTML = `
        <i class="fa-solid fa-circle-user" style="color: #ff2a8d;"></i>
        <span id="appbarAccountLabel">Profile</span>
      `;
    } else {
      appbarBtn.innerHTML = `
        <i class="fa-solid fa-circle-user"></i>
        <span id="appbarAccountLabel">Account</span>
      `;
    }
  }
}

export function updateProfileAvatarUI(user) {
  const avatarInitialsEl = document.getElementById('profileAvatarInitials');
  const avatarStatusEl = document.getElementById('profileAvatarStatus');
  if (!avatarInitialsEl) return;

  if (user && user.displayName) {
    const rawName = user.displayName.trim();
    const parts = rawName.split(/\s+/).filter(Boolean);
    const initials = parts.length > 1 
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : (parts[0] ? parts[0].slice(0, 2).toUpperCase() : 'LA');
    avatarInitialsEl.textContent = initials;
    if (avatarStatusEl) {
      avatarStatusEl.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
      avatarStatusEl.style.display = 'flex';
      avatarStatusEl.title = 'Verified Customer';
    }
  } else if (user) {
    avatarInitialsEl.innerHTML = '<i class="fa-solid fa-user-check"></i>';
    if (avatarStatusEl) {
      avatarStatusEl.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
      avatarStatusEl.style.display = 'flex';
      avatarStatusEl.title = 'Verified Customer';
    }
  } else {
    avatarInitialsEl.innerHTML = '<i class="fa-solid fa-crown"></i>';
    if (avatarStatusEl) {
      avatarStatusEl.style.display = 'none';
    }
  }
}

export function copyProfileAccountId() {
  const idEl = document.getElementById('profileDisplayId');
  const rawId = (idEl ? idEl.textContent : '').trim() || '#LA-STORE';

  const finishCopy = () => {
    const btn = document.getElementById('btnCopyProfileId');
    if (btn) {
      const origHtml = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> <span class="copy-id-label">Copied!</span>';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerHTML = origHtml;
        btn.classList.remove('copied');
      }, 2200);
    }
    if (typeof showAppToast === 'function') {
      showAppToast(`Account ID ${rawId} copied to clipboard!`);
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(rawId).then(finishCopy).catch(() => {
      fallbackCopy(rawId);
      finishCopy();
    });
  } else {
    fallbackCopy(rawId);
    finishCopy();
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (_) {}
  }
}
window.copyProfileAccountId = copyProfileAccountId;
window.updateProfileAvatarUI = updateProfileAvatarUI;

// ━━ 5. FULL-PAGE NATIVE PROFILE SCREEN ROUTER ━━
export function showProfilePage() {
  const user = getCustomerSession();
  const storefrontView = document.getElementById('appStorefrontView');
  const accountView = document.getElementById('appAccountView');
  const searchView = document.getElementById('appSearchView');
  const notifsView = document.getElementById('appNotificationsView');
  const ordersView = document.getElementById('appOrdersView');
  if (!accountView) return;

  // 1. Switch View in normal document flow (100% native scrolling!)
  if (storefrontView) storefrontView.style.display = 'none';
  if (searchView) searchView.style.display = 'none';
  if (notifsView) notifsView.style.display = 'none';
  if (ordersView) ordersView.style.display = 'none';
  accountView.style.display = 'block';
  document.body.style.overflow = '';
  window.scrollTo(0, 0);

  // Responsive device view: on desktop (laptop/PC > 991px), keep main store header & floating cart active
  // On mobile/tablet (<= 991px), hide them to provide pure distraction-free native app screen
  const isDesktop = window.innerWidth > 991;
  const fkHeader = document.getElementById('fkHeader');
  const fkHeaderSpacer = document.getElementById('fkHeaderSpacer');
  const marqueeWrap = document.querySelector('.marquee-wrap');
  const floatingCart = document.getElementById('leftFloatingCart');
  if (fkHeader) fkHeader.style.display = isDesktop ? '' : 'none';
  if (fkHeaderSpacer) fkHeaderSpacer.style.display = isDesktop ? '' : 'none';
  if (marqueeWrap) marqueeWrap.style.display = 'none';
  if (floatingCart) floatingCart.style.display = 'none';

  // 2. Populate Customer Info / Guest State (Strictly Verified Member - No VIP!)
  const greetingEl = document.getElementById('profileGreetingName');
  const subtitleEl = document.getElementById('profileDisplaySubtitle');
  const emailEl = document.getElementById('profileDisplayEmail');
  const idEl = document.getElementById('profileDisplayId');
  const verifiedBadgeEl = document.getElementById('profileVerifiedBadge') || document.getElementById('profileVipBadge');
  const nameInput = document.getElementById('profileEditNameInput');
  const logoutWrap = document.getElementById('profileLogoutWrap');
  const guestCtaWrap = document.getElementById('profileGuestCtaWrap');
  const personalCard = document.getElementById('profilePersonalDetailsCard');

  updateProfileAvatarUI(user);

  if (user) {
    if (greetingEl) greetingEl.textContent = user.displayName || 'Customer';
    // HIDE redundant subtitle completely so "Verified Member" is NEVER shown twice!
    if (subtitleEl) {
      subtitleEl.style.display = 'none';
    }
    if (emailEl) emailEl.style.display = 'none'; // NEVER display raw email
    if (idEl) idEl.textContent = `#LA-${(user.uid || '').slice(-6).toUpperCase()}`;
    
    // Show single verified member badge
    if (verifiedBadgeEl) {
      verifiedBadgeEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>Verified Member</span>`;
      verifiedBadgeEl.style.display = 'inline-flex';
    }
    if (nameInput) nameInput.value = user.displayName || '';

    // Format Joined Date (Single instance only - e.g. "September 16, 2026")
    const joinedTextEl = document.getElementById('profileJoinedDateText');
    const joinedRowEl = document.getElementById('profileJoinedText');
    const joinedBadgeEl = document.getElementById('profileJoinedBadge');
    const joinedTimestamp = user.createdAt || Date.now();
    const joinedFormatted = new Date(joinedTimestamp).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

    if (joinedTextEl) joinedTextEl.textContent = joinedFormatted;
    if (joinedRowEl) joinedRowEl.style.display = 'flex';
    // HIDE duplicate pink pill completely so "Joined" is NEVER shown twice!
    if (joinedBadgeEl) joinedBadgeEl.style.display = 'none';

    if (logoutWrap) logoutWrap.style.display = 'flex';
    if (guestCtaWrap) guestCtaWrap.style.display = 'none';
    if (personalCard) personalCard.style.display = 'none';
  } else {
    if (greetingEl) greetingEl.textContent = 'Guest';
    if (subtitleEl) {
      subtitleEl.textContent = 'Sign in to access your orders, downloads & member perks';
      subtitleEl.style.display = 'block';
    }
    if (emailEl) emailEl.style.display = 'none';
    if (idEl) idEl.textContent = '#LA-GUEST';
    if (verifiedBadgeEl) verifiedBadgeEl.style.display = 'none';
    if (nameInput) nameInput.value = '';

    const joinedBadgeEl = document.getElementById('profileJoinedBadge');
    const joinedRowEl = document.getElementById('profileJoinedText');
    if (joinedBadgeEl) joinedBadgeEl.style.display = 'none';
    if (joinedRowEl) joinedRowEl.style.display = 'none';

    if (logoutWrap) logoutWrap.style.display = 'none';
    if (guestCtaWrap) guestCtaWrap.style.display = 'block';
    if (personalCard) personalCard.style.display = 'none';
  }

  // 3. Render Orders List in Place (Native App Style)
  renderAccountOrders();

  // 4. Update live Wishlist & Cart counts
  const likesCountEl = document.getElementById('profileLikedCount');
  if (likesCountEl) {
    try {
      const rawLikes = localStorage.getItem('jaigram_wishlist') || localStorage.getItem('la_wishlist') || localStorage.getItem('linkadda_wishlist') || '[]';
      likesCountEl.textContent = `${JSON.parse(rawLikes).length || 0} Saved`;
    } catch (_) {
      likesCountEl.textContent = '0 Saved';
    }
  }

  const cartCountEl = document.getElementById('profileCartCount');
  if (cartCountEl) {
    try {
      const rawCart = localStorage.getItem('jaigram_cart_v1') || localStorage.getItem('linkadda_cart_v1') || '[]';
      const cartList = JSON.parse(rawCart);
      let totalQty = 0;
      if (Array.isArray(cartList)) cartList.forEach(item => totalQty += (item.qty || 1));
      cartCountEl.textContent = `${totalQty} Items`;
    } catch (_) {
      cartCountEl.textContent = '0 Items';
    }
  }

  // Live Cart count badges sync (Top App Bar & Header)
  if (typeof window.updateCartBadges === 'function') {
    window.updateCartBadges();
  }

  // 5. Sync Theme Switch state
  const themeSwitch = document.getElementById('profileThemeSwitch');
  if (themeSwitch) {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    themeSwitch.checked = (currentTheme === 'dark');
  }

  // 5.5 Sync Creator & Seller Hub Card state (Protected: Only shown for logged-in members!)
  const sellerSection = document.getElementById('profileSellerSection');
  const sellerTitleEl = document.getElementById('profileSellerTitle');
  const sellerDescEl = document.getElementById('profileSellerDesc');
  const sellerBtnEl = document.getElementById('profileSellerActionBtn');
  const sellerBtnTextEl = document.getElementById('profileSellerBtnText');
  const sellerIndicatorEl = document.getElementById('profileSellerStatusIndicator');
  const sellerLoginLinkEl = document.getElementById('profileSellerLoginLink');

  if (sellerSection) {
    if (!user) {
      // STRICT REQUIREMENT: Guest/Unauthenticated users NEVER see become seller card!
      sellerSection.style.display = 'none';
    } else {
      sellerSection.style.display = 'block';

      let isApprovedSeller = false;
      let isPendingApp = false;

      // Check seller session
      try {
        const sellerRaw = localStorage.getItem('jaigram_seller_session') || localStorage.getItem('linkadda_seller_session');
        if (sellerRaw) {
          const sellerSess = JSON.parse(sellerRaw);
          if (sellerSess && sellerSess.token && sellerSess.seller) {
            isApprovedSeller = true;
          }
        }
      } catch (_) {}

      // Check seller application status
      if (!isApprovedSeller) {
        try {
          const appRaw = localStorage.getItem('jaigram_seller_app_status') || localStorage.getItem('linkadda_seller_app_status');
          if (appRaw) {
            const appData = JSON.parse(appRaw);
            if (appData && appData.status === 'pending') {
              isPendingApp = true;
            }
          }
        } catch (_) {}
      }

      if (sellerTitleEl && sellerBtnEl) {
        if (isApprovedSeller) {
          sellerTitleEl.textContent = 'Your Seller Hub is Live!';
          sellerDescEl.textContent = 'You are an official JaiGram verified seller. Manage your packs, monitor live customer orders, and view sales earnings.';
          sellerBtnEl.href = './seller/dashboard.html';
          if (sellerBtnTextEl) sellerBtnTextEl.textContent = 'Go to Seller Dashboard';
          if (sellerIndicatorEl) {
            sellerIndicatorEl.innerHTML = '<span class="badge-seller-active">✓ Active Seller</span>';
            sellerIndicatorEl.style.display = 'inline-block';
          }
          if (sellerLoginLinkEl) sellerLoginLinkEl.style.display = 'none';
        } else if (isPendingApp) {
          sellerTitleEl.textContent = 'Seller Application Under Review';
          sellerDescEl.textContent = 'Your application has been received. JaiGram Admin is verifying your store details. Your login credentials will be emailed to you upon approval.';
          sellerBtnEl.href = './seller/apply.html';
          if (sellerBtnTextEl) sellerBtnTextEl.textContent = 'View Application Info';
          if (sellerIndicatorEl) {
            sellerIndicatorEl.innerHTML = '<span class="badge-seller-pending">⏳ Under Review</span>';
            sellerIndicatorEl.style.display = 'inline-block';
          }
          if (sellerLoginLinkEl) {
            sellerLoginLinkEl.href = './seller/login.html';
            sellerLoginLinkEl.style.display = 'inline-block';
          }
        } else {
          sellerTitleEl.textContent = 'Become a JaiGram Seller';
          sellerDescEl.textContent = 'Monetize your exclusive Mega & Google Drive collections, viral Telegram packs, and private vaults. Earn 100% creator share settled within 7 days of verified customer purchase.';
          sellerBtnEl.href = './seller/index.html';
          if (sellerBtnTextEl) sellerBtnTextEl.textContent = 'Become a Seller';
          if (sellerIndicatorEl) sellerIndicatorEl.style.display = 'none';
          if (sellerLoginLinkEl) {
            sellerLoginLinkEl.href = './seller/login.html';
            sellerLoginLinkEl.style.display = 'inline-block';
          }
        }
      }
    }
  }

  // 6. Highlight bottom appbar Profile/Account tab
  document.querySelectorAll('.fk-appbar-item').forEach(el => el.classList.remove('active'));
  const appbarAccountBtn = document.getElementById('appbarAccountBtn');
  if (appbarAccountBtn) appbarAccountBtn.classList.add('active');

  // 7. Update History Hash & Notifications UI
  updateNotificationsUI();
  if (window.location.hash !== '#profile') {
    window.history.pushState({ screen: 'profile' }, '', '#profile');
  }
}

export function hideProfilePage(preventHistoryBack = false) {
  const storefrontView = document.getElementById('appStorefrontView');
  const accountView = document.getElementById('appAccountView');
  const ordersView = document.getElementById('appOrdersView');

  if (accountView) accountView.style.display = 'none';
  if (ordersView) ordersView.style.display = 'none';
  if (storefrontView) storefrontView.style.display = 'block';
  document.body.style.overflow = '';

  // Restore storefront header, marquee review ticker, and floating cart
  const fkHeader = document.getElementById('fkHeader');
  const fkHeaderSpacer = document.getElementById('fkHeaderSpacer');
  const marqueeWrap = document.querySelector('.marquee-wrap');
  const floatingCart = document.getElementById('leftFloatingCart');
  if (fkHeader) fkHeader.style.display = '';
  if (fkHeaderSpacer) fkHeaderSpacer.style.display = '';
  if (marqueeWrap) marqueeWrap.style.display = '';
  if (floatingCart) floatingCart.style.display = '';

  // Restore Home tab highlight
  document.querySelectorAll('.fk-appbar-item').forEach(el => el.classList.remove('active'));
  const homeTab = document.getElementById('appbarHomeTab');
  if (homeTab) homeTab.classList.add('active');

  if (!preventHistoryBack && window.location.hash === '#profile') {
    try {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (_) {
      window.location.hash = '';
    }
  }
}

export function renderAccountOrders() {
  const countEl = document.getElementById('profileOrdersCount');
  const pillEl = document.getElementById('profileOrdersPill');
  const user = getCustomerSession();

  if (!user) {
    if (countEl) countEl.textContent = '0 Orders';
    if (pillEl) pillEl.textContent = '0 Orders';
    return;
  }

  // Trigger realtime order status sync from Firebase RTDB
  if (typeof syncUserOrdersWithFirebase === 'function') {
    syncUserOrdersWithFirebase().catch(() => {});
  }

  const orders = getUserOrders();
  const count = orders.length;

  if (countEl) countEl.textContent = `${count} ${count === 1 ? 'Order' : 'Orders'}`;
  if (pillEl) pillEl.textContent = `${count} ${count === 1 ? 'Order' : 'Orders'}`;

  const listEl = document.getElementById('accountOrdersList');
  if (listEl) {
    if (!count) {
      listEl.innerHTML = `
        <div class="orders-empty-state">
          <div class="orders-empty-icon"><i class="fa-solid fa-bag-shopping"></i></div>
          <h4 class="orders-empty-title">You haven't placed any orders yet</h4>
          <p class="orders-empty-sub">Your purchased creator collections, discrete download links, and receipts will appear here automatically.</p>
          <button type="button" class="btn-explore-orders" onclick="window.hideProfilePage && window.hideProfilePage();">
            <i class="fa-solid fa-bolt"></i> Explore Trending Packs
          </button>
        </div>
      `;
    } else {
      listEl.innerHTML = orders.map(ord => formatOrderCardHtml(ord)).join('');
    }
  }
}

// ━━ 6. INTERACTIVE NAME SAVING & EDITING ━━
export async function saveCustomerName(newName) {
  const trimmed = String(newName || '').trim();
  if (!trimmed) {
    showAppToast('Please enter your full name.');
    return;
  }

  let user = getCustomerSession();
  if (!user || !user.email) {
    const emailInput = document.getElementById('authEmailInput');
    const fallbackEmail = currentEmail || (emailInput ? emailInput.value.trim() : '') || 'customer@jaigram.shop';
    const computedUid = await getCustomerId(fallbackEmail);
    user = {
      uid: computedUid,
      email: fallbackEmail.toLowerCase().trim(),
      displayName: trimmed,
      hasSavedName: true,
      isNewUserWithNameNeeded: false,
      provider: 'email_otp',
      providers: ['email_otp'],
      verified: true,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
    };
  } else {
    user.displayName = trimmed;
    user.hasSavedName = true;
    user.isNewUserWithNameNeeded = false;
  }

  const cleanUserEmail = user.email.toLowerCase().trim();
  localStorage.setItem('jaigram_customer_name_' + cleanUserEmail, trimmed);
  localStorage.setItem('linkadda_customer_name_' + cleanUserEmail, trimmed);
  localStorage.setItem('jaigram_name_saved_' + cleanUserEmail, 'true');
  localStorage.setItem('linkadda_name_saved_' + cleanUserEmail, 'true');

  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  try { localStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify(user)); } catch (_) {}
  syncCustomerToDatabase({ ...user, newName: trimmed, hasSavedName: true });

  const greetingEl = document.getElementById('profileGreetingName');
  if (greetingEl) greetingEl.textContent = trimmed;
  updateProfileAvatarUI(user);

  const nameInput = document.getElementById('profileEditNameInput');
  if (nameInput) nameInput.value = trimmed;

  // Visual button feedback
  const btnSave = document.getElementById('btnSaveProfileName');
  if (btnSave) {
    const origHtml = btnSave.innerHTML;
    btnSave.innerHTML = `<i class="fa-solid fa-circle-check"></i> Saved!`;
    btnSave.classList.add('saved');
    setTimeout(() => {
      btnSave.innerHTML = origHtml;
      btnSave.classList.remove('saved');
    }, 2200);
  }

  // Inline feedback banner
  const feedbackEl = document.getElementById('profileNameFeedback');
  if (feedbackEl) {
    feedbackEl.classList.add('visible');
    setTimeout(() => feedbackEl.classList.remove('visible'), 3200);
  }

  updateHeaderUserUI();
  addUserWelcomeNotification(user.uid, trimmed);
  showAppToast(`Name saved: "${trimmed}"!`);
}

// ━━ 6B. FULL EDIT PROFILE CONTROLLER (NAME + EMAIL) ━━
export function openEditProfileModal() {
  const user = getCustomerSession();
  if (!user) {
    openAuthModal('input');
    return;
  }
  const modal = document.getElementById('appEditProfileModal');
  const nameInput = document.getElementById('editProfileNameInput');
  const emailInput = document.getElementById('editProfileEmailInput');
  const dateInfo = document.getElementById('editProfileJoinedDate');
  const feedback = document.getElementById('editProfileFeedback');

  if (nameInput) nameInput.value = user.displayName || '';
  if (emailInput) emailInput.value = user.email || '';
  if (dateInfo) {
    const d = new Date(user.createdAt || Date.now());
    dateInfo.textContent = d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  if (feedback) {
    feedback.className = 'edit-profile-feedback';
    feedback.style.display = 'none';
  }

  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      if (nameInput) nameInput.focus();
    }, 150);
  }
}

export function closeEditProfileModal() {
  const modal = document.getElementById('appEditProfileModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

export async function saveCustomerProfile() {
  const user = getCustomerSession();
  if (!user) return;

  const nameInput = document.getElementById('editProfileNameInput');
  const emailInput = document.getElementById('editProfileEmailInput');
  const btnSave = document.getElementById('btnSaveFullProfile');
  const feedback = document.getElementById('editProfileFeedback');

  const newName = (nameInput ? nameInput.value : '').trim();
  const newEmail = (emailInput ? emailInput.value : '').trim().toLowerCase();

  if (!newName) {
    if (feedback) {
      feedback.className = 'edit-profile-feedback error';
      feedback.textContent = 'Please enter your full name.';
      feedback.style.display = 'block';
    }
    return;
  }

  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    if (feedback) {
      feedback.className = 'edit-profile-feedback error';
      feedback.textContent = 'Please enter a valid email address.';
      feedback.style.display = 'block';
    }
    return;
  }

  if (btnSave) {
    btnSave.disabled = true;
    btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
  }

  try {
    const res = await fetch('/api/auth/customer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oldEmail: user.email,
        oldUid: user.uid,
        email: newEmail,
        newName: newName,
        provider: user.provider || 'email_otp',
      }),
    });

    let updatedUser = null;
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.customer) {
        updatedUser = data.customer;
      }
    }

    if (!updatedUser) {
      // Fallback local update if offline
      const newUid = await getCustomerId(newEmail);
      updatedUser = {
        ...user,
        uid: newUid,
        email: newEmail,
        displayName: newName,
        updatedAt: Date.now(),
      };
      syncCustomerToDatabase(updatedUser);
    }

    localStorage.setItem(SESSION_KEY, JSON.stringify(updatedUser));
    try { localStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify(updatedUser)); } catch (_) {}
    window.dispatchEvent(new CustomEvent('jaigram:auth-changed', { detail: updatedUser }));
    window.dispatchEvent(new CustomEvent('linkadda:auth-changed', { detail: updatedUser }));

    // Always sync to /events/customers/ for admin panel real-time visibility
    syncCustomerToDatabase(updatedUser);

    updateHeaderUserUI();
    showProfilePage();
    closeEditProfileModal();
    showAppToast(`Profile updated: Name & Email saved!`);
  } catch (err) {
    console.error('Profile update error:', err);
    if (feedback) {
      feedback.className = 'edit-profile-feedback error';
      feedback.textContent = err.message || 'Error updating profile.';
      feedback.style.display = 'block';
    }
  } finally {
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> <span>Save Changes</span>`;
    }
  }
}

// ━━ 7. AUTH MODAL CONTROLLERS ━━
export function openAuthModal(step = 'input') {
  if (document.getElementById('appAccountView') && typeof hideProfilePage === 'function') {
    hideProfilePage(true);
  }
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.style.visibility = 'visible';
  modal.style.opacity = '1';
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  if (step === 'input') {
    showInputView();
  } else if (step === 'name') {
    showNameSetupView();
  } else {
    showOtpView();
  }
}

export function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.style.display = 'none';
  modal.style.visibility = 'hidden';
  modal.style.opacity = '0';
  document.body.style.overflow = '';
  clearStatus();
  if (countdownInterval) clearInterval(countdownInterval);

  // If user is authenticated and was attempting a purchase, automatically resume checkout
  if (typeof getCustomerSession === 'function' && getCustomerSession()) {
    if (typeof checkAndResumePendingCheckout === 'function') {
      checkAndResumePendingCheckout();
    }
  }
}

function showInputView() {
  const inputView = document.getElementById('authInputView');
  const otpView = document.getElementById('authOtpView');
  const nameView = document.getElementById('authNameView');
  if (inputView) inputView.style.display = 'block';
  if (otpView) otpView.style.display = 'none';
  if (nameView) nameView.style.display = 'none';
  clearStatus();
  setTimeout(() => {
    const emailInput = document.getElementById('authEmailInput');
    if (emailInput) emailInput.focus();
  }, 150);
}

function syncOtpCellsUI(code = '') {
  const clean = (code || '').replace(/\D/g, '').slice(0, 6);
  const cells = document.querySelectorAll('.otp-cell-segment');
  cells.forEach((cell, idx) => {
    const numEl = cell.querySelector('.cell-number');
    const hasChar = idx < clean.length;
    if (numEl) numEl.textContent = hasChar ? clean[idx] : '';
    if (hasChar) {
      cell.classList.add('filled');
    } else {
      cell.classList.remove('filled');
    }
    if (idx === clean.length) {
      cell.classList.add('active');
    } else {
      cell.classList.remove('active');
    }
  });

  const boxes = document.querySelectorAll('.otp-digit-box');
  boxes.forEach((b, i) => {
    b.value = clean[i] || '';
  });
}

function showOtpView() {
  const inputView = document.getElementById('authInputView');
  const otpView = document.getElementById('authOtpView');
  const nameView = document.getElementById('authNameView');
  if (inputView) inputView.style.display = 'none';
  if (otpView) otpView.style.display = 'block';
  if (nameView) nameView.style.display = 'none';
  clearStatus();

  const targetEmailEl = document.getElementById('otpTargetEmail');
  if (targetEmailEl) targetEmailEl.textContent = currentEmail;

  const masterInput = document.getElementById('otpMasterInput');
  if (masterInput) {
    masterInput.value = '';
    syncOtpCellsUI('');
    setTimeout(() => masterInput.focus(), 120);
  }

  const boxes = document.querySelectorAll('.otp-digit-box');
  boxes.forEach(b => b.value = '');
  if (boxes[0] && !masterInput) {
    setTimeout(() => boxes[0].focus(), 120);
  }

  startCountdown();
}

function showNameSetupView() {
  const inputView = document.getElementById('authInputView');
  const otpView = document.getElementById('authOtpView');
  const nameView = document.getElementById('authNameView');
  if (inputView) inputView.style.display = 'none';
  if (otpView) otpView.style.display = 'none';
  if (nameView) nameView.style.display = 'block';
  clearStatus();

  const user = getCustomerSession();
  const setupInput = document.getElementById('authSetupNameInput');
  if (setupInput && user) {
    setupInput.value = user.displayName || '';
    setTimeout(() => setupInput.focus(), 150);
  }
}

function showStatus(message, type = 'error') {
  const banner = document.getElementById('authMsgBanner');
  if (!banner) return;
  banner.className = `auth-status-alert auth-msg-banner active ${type}`;
  banner.style.display = 'block';
  banner.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-check'}" style="margin-right: 6px;"></i> <span>${message}</span>`;
}

function clearStatus() {
  const banner = document.getElementById('authMsgBanner');
  if (!banner) return;
  banner.className = 'auth-status-alert auth-msg-banner';
  banner.style.display = 'none';
  banner.innerHTML = '';
}

function showAuthToast(message) {
  showAppToast(message);
}

export function showAppToast(message) {
  let toast = document.getElementById('laAppToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'laAppToast';
    toast.className = 'la-app-toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #ff2a8d;"></i> <span>${message}</span>`;
  toast.classList.add('visible');
  setTimeout(() => {
    toast.classList.remove('visible');
  }, 2600);
}

function startCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownSeconds = 60;
  const resendBtn = document.getElementById('btnResendOtp');
  if (!resendBtn) return;

  resendBtn.classList.remove('can-resend');
  resendBtn.disabled = true;
  resendBtn.textContent = `Resend in ${countdownSeconds}s`;

  countdownInterval = setInterval(() => {
    countdownSeconds--;
    if (countdownSeconds <= 0) {
      clearInterval(countdownInterval);
      resendBtn.classList.add('can-resend');
      resendBtn.disabled = false;
      resendBtn.textContent = 'Resend Code';
    } else {
      resendBtn.textContent = `Resend in ${countdownSeconds}s`;
    }
  }, 1000);
}

// ━━ 8. AUTH ACTIONS (GOOGLE & EMAIL OTP) ━━
async function handleGoogleSignIn() {
  clearStatus();
  const termsCheckbox = document.getElementById('authTermsCheckbox');
  if (termsCheckbox && !termsCheckbox.checked) {
    showStatus('Please accept the Terms & Privacy Policy to continue.', 'error');
    return;
  }

  const googleBtn = document.getElementById('btnGoogleAuth');
  if (googleBtn) {
    googleBtn.disabled = true;
    googleBtn.style.opacity = '0.7';
    googleBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="margin-right: 8px;"></i> Connecting with Google...`;
  }

  try {
    const fb = await getFirebaseAuth();
    if (!fb) {
      showStatus('Google sign-in is currently unavailable. Please check your internet connection or use Email OTP.', 'error');
      return;
    }

    let result = null;
    try {
      result = await fb.signInWithPopup(fb.auth, fb.googleProvider);
    } catch (popupErr) {
      console.warn('Firebase signInWithPopup error:', popupErr);
      if (popupErr.code === 'auth/popup-blocked') {
        showStatus(`
          <div style="padding: 4px 0; text-align: center;">
            <div style="font-weight: 700; color: #f59e0b; margin-bottom: 6px;">
              <i class="fa-solid fa-triangle-exclamation"></i> Browser blocked the popup window
            </div>
            <div style="font-size: 13px; color: #cbd5e1; margin-bottom: 10px;">
              Continuing in this window...
            </div>
            <button type="button" id="btnFallbackRedirectGoogle" style="background: linear-gradient(135deg, #ff2a8d 0%, #ff65a3 100%); color: #fff; border: none; padding: 9px 20px; border-radius: 9999px; font-weight: 700; font-size: 13px; cursor: pointer; box-shadow: 0 4px 14px rgba(255,42,141,0.4);">
              <i class="fa-brands fa-google" style="margin-right: 6px;"></i> Continue with Google
            </button>
          </div>
        `, 'warning');

        const fallbackBtn = document.getElementById('btnFallbackRedirectGoogle');
        if (fallbackBtn && fb.signInWithRedirect) {
          fallbackBtn.addEventListener('click', () => {
            fb.signInWithRedirect(fb.auth, fb.googleProvider);
          });
        }
        if (fb.signInWithRedirect) {
          setTimeout(() => {
            fb.signInWithRedirect(fb.auth, fb.googleProvider).catch(() => {});
          }, 800);
        }
        return;
      }
      throw popupErr;
    }

    const u = result.user;
    const customerUser = await resolveUnifiedCustomer(u.email, {
      displayName: u.displayName || u.email.split('@')[0],
      provider: 'google',
    });

    if (customerUser && customerUser.isNewUserWithNameNeeded) {
      showNameSetupView();
      showAuthToast(`Logged in with Google! Please enter your name.`);
    } else {
      // Existing user or Google user with resolved name: NEVER show name setup view!
      closeAuthModal();
      showAppToast(`Welcome, ${customerUser.displayName}! 🎉`);
      const resumed = checkAndResumePendingCheckout();
      if (!resumed) {
        showProfilePage();
      }
    }
  } catch (err) {
    console.error('Google Sign-In Error:', err);
    if (err.code === 'auth/unauthorized-domain') {
      const localhostUrl = `http://localhost:${window.location.port || '5501'}${window.location.pathname}${window.location.search}`;
      showStatus(`
        <div style="text-align: left; padding: 4px 0;">
          <div style="color: #ef4444; font-weight: 700; margin-bottom: 4px;">
            <i class="fa-solid fa-triangle-exclamation"></i> Google Auth Domain Notice
          </div>
          <div style="font-size: 12.5px; color: #cbd5e1; margin-bottom: 8px;">
            Firebase requires <strong>localhost</strong> instead of 127.0.0.1 for Google Sign-In.
          </div>
          <a href="${localhostUrl}" style="display: inline-flex; align-items: center; gap: 6px; padding: 7px 16px; background: #ff2a8d; color: #fff; border-radius: 9999px; text-decoration: none; font-weight: 700; font-size: 12px; margin-bottom: 8px;">
            <i class="fa-solid fa-arrow-right"></i> Open on localhost:${window.location.port || '5501'}
          </a>
          <div style="font-size: 11.5px; color: #94a3b8;">
            Or simply enter your email below for instant sign-in via 6-digit code!
          </div>
        </div>
      `, 'error');
    } else if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
      showStatus(err.message || 'Google sign-in could not be completed.', 'error');
    }
  } finally {
    if (googleBtn) {
      googleBtn.disabled = false;
      googleBtn.style.opacity = '1';
      googleBtn.innerHTML = `
        <svg class="google-icon-svg" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
        </svg>
        <span>Continue with Google</span>
      `;
    }
  }
}

async function handleSendOtp() {
  clearStatus();
  const termsCheckbox = document.getElementById('authTermsCheckbox');
  if (termsCheckbox && !termsCheckbox.checked) {
    showStatus('Please accept the Terms & Privacy Policy to continue.', 'error');
    return;
  }

  const emailInput = document.getElementById('authEmailInput');
  const sendBtn = document.getElementById('btnSendOtp');
  const resendBtn = document.getElementById('btnResendOtp');
  const email = ((emailInput ? emailInput.value : '') || currentEmail || '').trim().toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showStatus('Please enter a valid email address.', 'error');
    if (emailInput) emailInput.focus();
    return;
  }

  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending code...`;
  }
  if (resendBtn) {
    resendBtn.disabled = true;
    resendBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending...`;
  }

  try {
    const res = await fetch(getApiEndpoint('/api/auth/send-otp'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch (_) {}

    if (!res.ok || !data.success || !data.token) {
      throw new Error(data.error || 'Failed to dispatch verification code. Please check your email.');
    }

    currentEmail = email;
    currentToken = data.token;
    showOtpView();
    showStatus(`A 6-digit code has been sent to ${email}. Please check your inbox.`, 'success');
    startCountdown();
  } catch (err) {
    console.error('Send OTP Error:', err);
    showStatus(err.message || 'Error sending code. Please try again.', 'error');
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = `<span>Send Verification Code</span> <i class="fa-solid fa-arrow-right"></i>`;
    }
  }
}

async function handleVerifyOtp() {
  clearStatus();
  const masterInput = document.getElementById('otpMasterInput');
  let otp = masterInput ? masterInput.value.replace(/\D/g, '').slice(0, 6) : '';
  if (!otp) {
    const boxes = document.querySelectorAll('.otp-digit-box');
    boxes.forEach(b => otp += (b.value || '').trim());
  }

  if (otp.length !== 6 || !/^\d{6}$/.test(otp)) {
    showStatus('Please enter the complete 6-digit verification code.', 'error');
    const cluster = document.getElementById('otpCellsCluster');
    if (cluster) {
      cluster.classList.add('shake-error');
      setTimeout(() => cluster.classList.remove('shake-error'), 500);
    }
    return;
  }

  const verifyBtn = document.getElementById('btnVerifyOtp');
  if (verifyBtn) {
    verifyBtn.disabled = true;
    verifyBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying code...`;
  }

  try {
    const res = await fetch(getApiEndpoint('/api/auth/verify-otp'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: currentEmail,
        otp: otp,
        token: currentToken,
      }),
    });

    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch (_) {}

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Incorrect code. Please double-check and try again.');
    }

    const customer = await resolveUnifiedCustomer(currentEmail, {
      provider: 'email_otp',
      existingRecord: data.user,
      token: data.token,
      isNew: data.isNew,
    });

    if (customer && customer.isNewUserWithNameNeeded) {
      // First-time new user ONLY: show name setup view
      showNameSetupView();
      showAuthToast(`Account verified! Enter your name to complete setup.`);
    } else {
      // Existing user: NEVER show name setup view! Direct to dashboard!
      closeAuthModal();
      showAppToast(`Welcome back, ${customer.displayName}! 🎉`);
      const resumed = checkAndResumePendingCheckout();
      if (!resumed) {
        sessionStorage.removeItem('jaigram_pending_destination');
        sessionStorage.removeItem('linkadda_pending_destination');
        if (window.location.pathname.includes('login') || window.location.pathname.endsWith('login.html')) {
          window.location.href = 'user/index.html';
        } else {
          showProfilePage();
        }
      }
    }
  } catch (err) {
    console.error('Verify OTP Error:', err);
    showStatus(err.message || 'Verification failed. Please try again.', 'error');
  } finally {
    if (verifyBtn) {
      verifyBtn.disabled = false;
      verifyBtn.innerHTML = `<span>Verify & Continue</span> <i class="fa-solid fa-check"></i>`;
    }
  }
}

// ━━ 9. EVENT LISTENERS INITIALIZATION ━━
function initAuthModalEvents() {
  // Modal Close triggers
  const closeBtn = document.getElementById('authModalCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeAuthModal);

  const modal = document.getElementById('authModal');
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target === modal) closeAuthModal();
    });
  }

  // Full-Screen Profile Screen: Back Button
  const btnBackProfile = document.getElementById('btnBackFromProfile');
  if (btnBackProfile) {
    btnBackProfile.addEventListener('click', () => hideProfilePage());
  }

  // Browser / Mobile back button listener (popstate)
  window.addEventListener('popstate', e => {
    const searchView = document.getElementById('appSearchView');
    if (searchView && searchView.style.display !== 'none') {
      if (window.location.hash !== '#search') {
        if (typeof window.hideSearchPage === 'function') {
          window.hideSearchPage(true);
        }
      }
      return;
    }
    const ordersView = document.getElementById('appOrdersView');
    if (ordersView && ordersView.style.display !== 'none') {
      if (window.location.hash !== '#orders') {
        hideOrdersPage(true);
      }
      return;
    }
    const notifsView = document.getElementById('appNotificationsView');
    if (notifsView && notifsView.style.display !== 'none') {
      if (window.location.hash !== '#notifications') {
        hideNotificationsPage(true);
      }
      return;
    }
    const accountView = document.getElementById('appAccountView');
    if (accountView && accountView.style.display !== 'none') {
      if (window.location.hash !== '#profile') {
        hideProfilePage(true);
      }
    }
  });

  // Check URL hash on page load
  if (window.location.hash === '#notifications') {
    showNotificationsPage('store');
  } else if (window.location.hash === '#orders') {
    showOrdersPage('store');
  } else if (window.location.hash === '#profile') {
    showProfilePage();
  } else if (window.location.hash === '#search') {
    if (typeof window.showSearchPage === 'function') {
      window.showSearchPage();
    }
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (modal && modal.classList.contains('open')) closeAuthModal();
      const searchView = document.getElementById('appSearchView');
      if (searchView && searchView.style.display !== 'none') {
        if (typeof window.hideSearchPage === 'function') window.hideSearchPage();
      }
      const ordersView = document.getElementById('appOrdersView');
      if (ordersView && ordersView.style.display !== 'none') hideOrdersPage();
      const notifsView = document.getElementById('appNotificationsView');
      if (notifsView && notifsView.style.display !== 'none') hideNotificationsPage();
      const accountView = document.getElementById('appAccountView');
      if (accountView && accountView.style.display !== 'none') hideProfilePage();
    }
  });

  // Header User button: navigates to Full-Screen Profile Screen
  const headerBtn = document.getElementById('headerUserBtn');
  if (headerBtn) {
    headerBtn.addEventListener('click', e => {
      e.stopPropagation();
      showProfilePage();
    });
  }

  // Mobile Drawer User button
  const mobBtn = document.getElementById('mobUserBtn');
  if (mobBtn) {
    mobBtn.addEventListener('click', () => {
      const mobNav = document.getElementById('mobileNav');
      if (mobNav) mobNav.classList.remove('active');
      showProfilePage();
    });
  }

  // Mobile Bottom App Bar Account Tab click
  const appbarAccountBtn = document.getElementById('appbarAccountBtn');
  if (appbarAccountBtn) {
    appbarAccountBtn.addEventListener('click', () => {
      showProfilePage();
    });
  }

  // Mobile Bottom App Bar Home Tab click
  const appbarHomeTab = document.getElementById('appbarHomeTab');
  if (appbarHomeTab) {
    appbarHomeTab.addEventListener('click', () => {
      hideProfilePage();
      closeUserOrdersModal();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Mobile Bottom App Bar Categories Tab click
  const appbarCategoriesTab = document.getElementById('appbarCategoriesTab');
  if (appbarCategoriesTab) {
    appbarCategoriesTab.addEventListener('click', () => {
      hideProfilePage();
      closeUserOrdersModal();
      const sec = document.getElementById('services');
      if (sec) sec.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Mobile Bottom App Bar Liked Tab click
  const appbarWishlistBtn = document.getElementById('fkAppbarWishlistBtn');
  if (appbarWishlistBtn) {
    appbarWishlistBtn.addEventListener('click', () => {
      hideProfilePage();
      closeUserOrdersModal();
    });
  }

  // Mobile Bottom App Bar Cart Tab click
  const appbarCartBtn = document.getElementById('fkAppbarCartBtn');
  if (appbarCartBtn) {
    appbarCartBtn.addEventListener('click', () => {
      hideProfilePage();
      closeUserOrdersModal();
    });
  }

  // Google Sign In
  const googleBtn = document.getElementById('btnGoogleAuth');
  if (googleBtn) googleBtn.addEventListener('click', handleGoogleSignIn);

  // Send OTP
  const sendBtn = document.getElementById('btnSendOtp');
  if (sendBtn) sendBtn.addEventListener('click', handleSendOtp);

  const emailInput = document.getElementById('authEmailInput');
  if (emailInput) {
    emailInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSendOtp();
      }
    });
  }

  // Master Segmented OTP Controller
  const masterInput = document.getElementById('otpMasterInput');
  const segmentBox = document.getElementById('otpSegmentBox');
  const cluster = document.getElementById('otpCellsCluster');

  if (segmentBox && masterInput) {
    segmentBox.addEventListener('click', () => {
      masterInput.focus();
    });
  }

  if (masterInput) {
    masterInput.addEventListener('input', () => {
      const val = masterInput.value.replace(/\D/g, '').slice(0, 6);
      masterInput.value = val;
      syncOtpCellsUI(val);
      if (val.length === 6) {
        handleVerifyOtp();
      }
    });

    masterInput.addEventListener('focus', () => {
      syncOtpCellsUI(masterInput.value);
      if (cluster) cluster.classList.add('is-focused');
    });

    masterInput.addEventListener('blur', () => {
      if (cluster) cluster.classList.remove('is-focused');
      const cells = document.querySelectorAll('.otp-cell-segment');
      cells.forEach(c => c.classList.remove('active'));
    });

    masterInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleVerifyOtp();
      }
    });

    masterInput.addEventListener('paste', e => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
      if (text) {
        masterInput.value = text;
        syncOtpCellsUI(text);
        if (text.length === 6) {
          handleVerifyOtp();
        }
      }
    });
  }

  // Quick 1-Click Paste OTP Button Listener
  const btnPasteOtp = document.getElementById('btnPasteOtp');
  if (btnPasteOtp) {
    btnPasteOtp.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        const clean = (text || '').replace(/\D/g, '').slice(0, 6);
        if (clean) {
          if (masterInput) {
            masterInput.value = clean;
            syncOtpCellsUI(clean);
            if (clean.length === 6) {
              handleVerifyOtp();
            }
          } else {
            const boxes = document.querySelectorAll('.otp-digit-box');
            if (boxes && boxes.length) {
              clean.split('').forEach((ch, i) => { if (boxes[i]) boxes[i].value = ch; });
              if (clean.length === 6) handleVerifyOtp();
            }
          }
        }
      } catch (_) {}
    });
  }

  // OTP Digit Boxes behavior (legacy fallback)
  const otpBoxes = document.querySelectorAll('.otp-digit-box');
  otpBoxes.forEach((box, idx) => {
    box.addEventListener('input', e => {
      const val = e.target.value.replace(/\D/g, '');
      box.value = val ? val.slice(-1) : '';
      if (val && idx < otpBoxes.length - 1) {
        otpBoxes[idx + 1].focus();
      }
      const fullCode = Array.from(otpBoxes).map(b => b.value).join('');
      if (fullCode.length === 6) handleVerifyOtp();
    });

    box.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !box.value && idx > 0) {
        otpBoxes[idx - 1].focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleVerifyOtp();
      }
    });

    box.addEventListener('paste', e => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
      if (text) {
        text.split('').forEach((char, i) => {
          if (otpBoxes[i]) otpBoxes[i].value = char;
        });
        const nextIdx = Math.min(text.length, otpBoxes.length - 1);
        if (otpBoxes[nextIdx]) otpBoxes[nextIdx].focus();
        if (text.length === 6) handleVerifyOtp();
      }
    });
  });

  // Edit Email Button
  const editEmailBtn = document.getElementById('btnEditEmail');
  if (editEmailBtn) editEmailBtn.addEventListener('click', showInputView);

  // Resend OTP Button
  const resendBtn = document.getElementById('btnResendOtp');
  if (resendBtn) {
    resendBtn.addEventListener('click', () => {
      if (resendBtn.classList.contains('can-resend')) handleSendOtp();
    });
  }

  // Verify OTP button
  const verifyBtn = document.getElementById('btnVerifyOtp');
  if (verifyBtn) verifyBtn.addEventListener('click', handleVerifyOtp);

  // Save Setup Name in Login Modal
  const btnSaveSetupName = document.getElementById('btnSaveSetupName');
  const setupNameInput = document.getElementById('authSetupNameInput');
  if (btnSaveSetupName && setupNameInput) {
    btnSaveSetupName.addEventListener('click', async () => {
      const val = setupNameInput.value.trim();
      if (val) {
        await saveCustomerName(val);
      }
      closeAuthModal();

      const resumed = checkAndResumePendingCheckout();
      if (!resumed) {
        showProfilePage();
      }
      if (val) {
        showAppToast(`Welcome to JaiGram, ${val}! 🎉`);
      }
    });

    setupNameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        btnSaveSetupName.click();
      }
    });
  }

  // Profile Screen: Save Name button
  const btnSaveProfileName = document.getElementById('btnSaveProfileName');
  const profileEditNameInput = document.getElementById('profileEditNameInput');
  if (btnSaveProfileName && profileEditNameInput) {
    btnSaveProfileName.addEventListener('click', () => {
      saveCustomerName(profileEditNameInput.value);
    });

    profileEditNameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveCustomerName(profileEditNameInput.value);
      }
    });
  }

  // Profile Screen: Edit Profile Modal buttons & Enter key
  const btnEditProfileName = document.getElementById('btnEditProfileName');
  if (btnEditProfileName) {
    btnEditProfileName.addEventListener('click', () => openEditProfileModal());
  }

  const btnSaveFullProfile = document.getElementById('btnSaveFullProfile');
  if (btnSaveFullProfile) {
    btnSaveFullProfile.addEventListener('click', () => saveCustomerProfile());
  }

  const editProfileNameInput = document.getElementById('editProfileNameInput');
  const editProfileEmailInput = document.getElementById('editProfileEmailInput');
  [editProfileNameInput, editProfileEmailInput].forEach(inp => {
    if (inp) {
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveCustomerProfile();
        }
      });
    }
  });

  // Profile Screen: Theme Toggle Switch
  const themeSwitch = document.getElementById('profileThemeSwitch');
  if (themeSwitch) {
    themeSwitch.addEventListener('change', e => {
      if (typeof window.toggleStoreTheme === 'function') {
        window.toggleStoreTheme(e);
      }
    });
  }

  // Profile Screen: Liked Packs Shortcut
  const likedCard = document.getElementById('profileLikedCard');
  if (likedCard) {
    likedCard.addEventListener('click', () => {
      if (typeof window.openWishlistDrawer === 'function') {
        window.openWishlistDrawer();
      }
    });
  }

  // Profile Screen: My Cart Shortcut
  const cartCard = document.getElementById('profileCartCard');
  if (cartCard) {
    cartCard.addEventListener('click', () => {
      if (typeof window.openCartDrawer === 'function') {
        window.openCartDrawer();
      }
    });
  }

  // Profile Screen: Currency Toggle Info
  const mobCurrencyToggle = document.getElementById('mobCurrencyToggle');
  if (mobCurrencyToggle) {
    mobCurrencyToggle.addEventListener('click', () => {
      showAppToast('Simultaneous Dual Pricing: ₹ INR & $ USD are both active storewide.');
    });
  }

  // Profile Screen: My Orders Shortcut
  const ordersCard = document.getElementById('profileOrdersCard');
  if (ordersCard) {
    ordersCard.addEventListener('click', () => {
      openUserOrdersModal();
    });
  }

  // Profile Screen: Logout Button
  const logoutBtn = document.getElementById('profileLogoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', openLogoutModal);

  // Initial UI Render
  updateHeaderUserUI();
}

// ━━ 10. USER ORDERS CONTROLLER & REALTIME APPROVAL SYNC ━━
export function getUserOrders() {
  try {
    const raw = localStorage.getItem('jaigram_user_orders') || localStorage.getItem('linkadda_user_orders') || '[]';
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}

export function copyOrderLink(url, btn) {
  if (!url) return;
  const copyText = () => {
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> <span>Copied!</span>';
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }
    if (typeof showAppToast === 'function') {
      showAppToast('Link copied to clipboard! 📋');
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(copyText).catch(() => fallback());
  } else {
    fallback();
  }

  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); copyText(); } catch (_) {}
    document.body.removeChild(ta);
  }
}
window.copyOrderLink = copyOrderLink;

export function formatOrderCardHtml(ord) {
  if (!ord) return '';
  const isConfirmed = ord.status === 'confirmed' || ord.status === 'completed' || ord.status === 'paid' || ord.status === 'approved';
  const orderId = String(ord.orderId || 'LA-ORDER').slice(-10).toUpperCase();
  const safeTitle = escapeHtml(ord.productName || 'Exclusive Creator Collection');
  const safePrice = escapeHtml(ord.amountDisplay || '₹399');
  const safeDate = escapeHtml(ord.date || 'Recent');
  const accessLink = ord.downloadLink || ord.fileUrl || ord.orderLink || '';

  const tgMsg = `Hi Admin, I have placed order #${orderId} (${ord.productName || 'VIP Content Pack'}). Please verify and approve my payment.`;
  const tgUrl = `https://t.me/TRUSTED_BROTHER1234?text=${encodeURIComponent(tgMsg)}`;

  let noteHtml = '';
  let actionHtml = '';

  if (isConfirmed) {
    if (accessLink) {
      noteHtml = `
        <div class="user-order-note confirmed" style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; border-radius: 8px; padding: 6px 10px; display: flex; align-items: center; gap: 6px; font-size: 12px; margin-top: 4px;">
          <i class="fa-solid fa-circle-check"></i>
          <span>Order Approved! Digital content link unlocked.</span>
        </div>
      `;
      actionHtml = `
        <div class="user-order-actions" style="display: flex; gap: 8px; margin-top: 8px; align-items: stretch;">
          <a href="${escapeHtml(accessLink)}" target="_blank" rel="noopener" class="btn-order-access confirmed" style="flex: 1; text-align: center; text-decoration: none; justify-content: center; display: inline-flex; align-items: center; gap: 8px; font-weight: 700; padding: 10px 14px; border-radius: 12px; background: linear-gradient(135deg, #10b981, #059669); color: #ffffff;">
            <i class="fa-brands fa-telegram"></i>
            <span>Open Telegram VIP Link</span>
          </a>
          <button type="button" class="btn-order-copy" onclick="window.copyOrderLink && window.copyOrderLink('${escapeHtml(accessLink)}', this)" title="Copy Link" style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); color: #10b981; padding: 0 14px; border-radius: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13px; transition: all 0.2s ease;">
            <i class="fa-regular fa-clone"></i>
            <span>Copy</span>
          </button>
        </div>
      `;
    } else {
      noteHtml = `
        <div class="user-order-note confirmed" style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; border-radius: 8px; padding: 6px 10px; display: flex; align-items: center; gap: 6px; font-size: 12px; margin-top: 4px;">
          <i class="fa-solid fa-circle-check"></i>
          <span>Order Approved! Link syncing...</span>
        </div>
      `;
      actionHtml = `
        <div class="user-order-actions" style="display: flex; gap: 8px; margin-top: 8px;">
          <a href="https://t.me/TRUSTED_BROTHER1234?text=${encodeURIComponent(`Hi Admin, my order #${orderId} is approved. Please provide my Telegram access link.`)}" target="_blank" rel="noopener" class="btn-order-access confirmed" style="flex: 1; text-align: center; text-decoration: none; justify-content: center; padding: 10px 14px; border-radius: 12px;">
            <i class="fa-solid fa-headset"></i>
            <span>Contact Support for Telegram Link</span>
          </a>
        </div>
      `;
    }
  } else {
    noteHtml = `
      <div class="user-order-note pending">
        <i class="fa-solid fa-hourglass-half"></i>
        <span>Order pending hai. Admin approval ke baad link yahan automatic unlock ho jayega.</span>
      </div>
    `;
    actionHtml = `
      <a href="${tgUrl}" target="_blank" rel="noopener" class="btn-order-access pending">
        <i class="fa-brands fa-telegram"></i>
        <span>Order Pending · Send Payment Proof</span>
      </a>
    `;
  }

  return `
    <div class="user-order-item ${isConfirmed ? 'is-confirmed' : 'is-pending'}" id="user-order-${escapeHtml(ord.orderId || orderId)}">
      <div class="user-order-top">
        <span class="user-order-id">#${escapeHtml(orderId)}</span>
        <span class="user-order-status ${isConfirmed ? 'confirmed' : 'pending'}">
          <i class="fa-solid ${isConfirmed ? 'fa-circle-check' : 'fa-clock'}"></i>
          ${isConfirmed ? 'Confirmed' : 'Pending Approval'}
        </span>
      </div>
      <div class="user-order-title">${safeTitle}</div>
      <div class="user-order-meta">
        <span class="user-order-price">${safePrice}</span>
        <span><i class="fa-regular fa-clock"></i> ${safeDate}</span>
      </div>
      ${noteHtml}
      ${actionHtml}
    </div>
  `;
}

let syncOrdersInProgress = false;
export async function syncUserOrdersWithFirebase() {
  if (syncOrdersInProgress) return;
  const orders = getUserOrders();
  if (!orders || !orders.length) return;

  syncOrdersInProgress = true;
  let hasUpdates = false;

  try {
    for (const ord of orders) {
      if (!ord || !ord.orderId) continue;
      // Skip only if already confirmed AND link is resolved
      if ((ord.status === 'confirmed' || ord.status === 'completed') && (ord.downloadLink || ord.fileUrl || ord.orderLink)) continue;

      try {
        let remoteOrder = null;
        let isApproved = false;
        let link = '';

        const res = await fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/orders/${encodeURIComponent(ord.orderId)}.json`);
        if (res.ok) {
          remoteOrder = await res.json();
        }

        // Fallback check to order_approvals node for instantaneous sync
        if (!remoteOrder || (!remoteOrder.status && !remoteOrder.orderStatus)) {
          try {
            const appRes = await fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/order_approvals/${encodeURIComponent(ord.orderId)}.json`);
            if (appRes.ok) {
              const appData = await appRes.json();
              if (appData && (appData.status === 'approved' || appData.verified)) {
                remoteOrder = appData;
                isApproved = true;
                link = appData.telegramLink || appData.channelLink || appData.downloadLink || appData.orderLink || '';
              }
            }
          } catch (_) {}
        }

        if (remoteOrder) {
          if (!isApproved) {
            isApproved = 
              remoteOrder.status === 'paid' || 
              remoteOrder.status === 'approved' || 
              remoteOrder.status === 'confirmed' || 
              remoteOrder.status === 'completed' ||
              remoteOrder.orderStatus === 'approved' ||
              remoteOrder.orderStatus === 'completed' ||
              remoteOrder.paymentStatus === 'paid' ||
              remoteOrder.paymentStatus === 'approved';
          }

          if (isApproved) {
            const wasPending = ord.status !== 'confirmed' && ord.status !== 'completed';
            ord.status = 'confirmed';
            if (!link) {
              link = remoteOrder.telegramLink || remoteOrder.channelLink || remoteOrder.groupLink || remoteOrder.downloadLink || remoteOrder.fileUrl || remoteOrder.orderLink || ord.telegramLink || ord.channelLink || ord.downloadLink || ord.fileUrl || ord.orderLink || '';
            }

            // If order doesn't have link, fetch from original product in RTDB
            if (!link && (remoteOrder.productId || ord.productId)) {
              try {
                const pId = remoteOrder.productId || ord.productId;
                const pRes = await fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/products/${encodeURIComponent(pId)}.json`);
                if (pRes.ok) {
                  const prodData = await pRes.json();
                  if (prodData) {
                    link = prodData.telegramLink || prodData.channelLink || prodData.downloadLink || prodData.fileUrl || prodData.orderLink || '';
                  }
                }
              } catch (_) {}
            }

            if (!link) {
              link = 'https://t.me/TRUSTED_BROTHER1234';
            }

            ord.downloadLink = link;
            ord.fileUrl = link;
            ord.orderLink = link;
            ord.telegramLink = link;
            ord.channelLink = link;

            hasUpdates = true;
            if (wasPending) {
              addOrderConfirmedNotification(ord);
            }
          }
        }
      } catch (e) {
        console.warn('Order sync check notice:', e);
      }
    }

    if (hasUpdates) {
      localStorage.setItem('jaigram_user_orders', JSON.stringify(orders));
      localStorage.setItem('linkadda_user_orders', JSON.stringify(orders));
      const listEl = document.getElementById('accountOrdersList');
      if (listEl) {
        listEl.innerHTML = orders.map(ord => formatOrderCardHtml(ord)).join('');
      }
      const appOrdersList = document.getElementById('appOrdersList');
      if (appOrdersList) {
        appOrdersList.innerHTML = orders.map(ord => formatOrderCardHtml(ord)).join('');
      }
      const appOrdersPageList = document.getElementById('appOrdersPageList');
      if (appOrdersPageList) {
        appOrdersPageList.innerHTML = orders.map(ord => formatOrderCardHtml(ord)).join('');
      }
      const ordersPill = document.getElementById('ordersPageCountPill');
      if (ordersPill) {
        ordersPill.textContent = `${orders.length} ${orders.length === 1 ? 'Order' : 'Orders'}`;
      }
      if (typeof window.renderOrdersDrawer === 'function') {
        window.renderOrdersDrawer();
      }
      if (typeof window.updateOrdersBadge === 'function') {
        window.updateOrdersBadge();
      }
    }
  } finally {
    syncOrdersInProgress = false;
  }
}

export function addOrderConfirmedNotification(ord) {
  try {
    const user = getCustomerSession();
    const uid = user ? user.uid : 'guest';
    const notifsKey = `jaigram_notifs_${uid}`;
    const legacyNotifsKey = `linkadda_notifs_${uid}`;
    let list = [];
    try {
      const raw = localStorage.getItem(notifsKey) || localStorage.getItem(legacyNotifsKey);
      if (raw) list = JSON.parse(raw);
    } catch (_) {}

    const rawId = String(ord.orderId || '');
    const orderId = rawId.slice(-10).toUpperCase();
    const notifId = `notif_order_${rawId}_confirmed`;

    // Deduplicate
    if (list.some(n => n.id === notifId)) return;

    const accessLink = ord.telegramLink || ord.channelLink || ord.downloadLink || ord.fileUrl || ord.orderLink || 'https://t.me/TRUSTED_BROTHER1234';
    const productName = ord.productName || ord.name || ord.title || 'VIP Content Pack';
    const eventTime = ord.reviewedAt || ord.approvedAt || ord.timestamp || Date.now();

    const notifItem = {
      id: notifId,
      type: 'order_confirmed',
      orderId: rawId,
      productName: productName,
      title: `Order #${orderId} Approved! 🎉`,
      desc: `Your order #${orderId} is approved! VIP Telegram Group / Channel access link is unlocked. Tap to join.`,
      timestamp: eventTime,
      time: formatRelativeTime(eventTime),
      actionUrl: accessLink,
      actionText: 'Join Telegram VIP Channel / Group',
      unread: true,
      icon: 'fa-circle-check',
      theme: 'success'
    };

    list.unshift(notifItem);
    localStorage.setItem(notifsKey, JSON.stringify(list));
    localStorage.setItem(legacyNotifsKey, JSON.stringify(list));
    localStorage.removeItem(NOTIFS_READ_KEY); // Re-trigger unread badge indicator
    localStorage.removeItem(LEGACY_NOTIFS_READ_KEY);

    updateNotificationsUI();
    renderNotificationsPage();

    showAppToast(`🎉 Order #${orderId} approve ho gaya! VIP Telegram Link taiyar hai.`);
  } catch (err) {
    console.warn('Order confirmed notification notice:', err);
  }
}

export function checkAndResumePendingCheckout() {
  try {
    const pendingUrl = sessionStorage.getItem('pending_checkout_url');
    const pendingAction = sessionStorage.getItem('pending_checkout_action');

    if (pendingUrl) {
      sessionStorage.removeItem('pending_checkout_url');
      showAppToast('Resuming your checkout...');
      setTimeout(() => {
        window.location.href = pendingUrl;
      }, 300);
      return true;
    }

    if (pendingAction === 'cart') {
      sessionStorage.removeItem('pending_checkout_action');
      showAppToast('Resuming cart checkout...');
      setTimeout(() => {
        if (typeof window.openCartDrawer === 'function') {
          window.openCartDrawer();
        }
        const checkoutBtn = document.getElementById('cartCheckoutBtn');
        if (checkoutBtn) checkoutBtn.click();
      }, 400);
      return true;
    }
  } catch (err) {
    console.warn('Resume checkout notice:', err);
  }
  return false;
}

export function openUserOrdersModal() {
  const modal = document.getElementById('appOrdersModal');
  const listEl = document.getElementById('appOrdersList');
  const badgeEl = document.getElementById('appOrdersCountBadge');
  if (!modal || !listEl) return;

  syncUserOrdersWithFirebase().catch(() => {});

  const orders = getUserOrders();
  if (badgeEl) badgeEl.textContent = orders.length;

  if (!orders.length) {
    listEl.innerHTML = `
      <div class="orders-empty-state">
        <div class="orders-empty-icon"><i class="fa-solid fa-receipt"></i></div>
        <h4 class="orders-empty-title">No Orders Placed Yet</h4>
        <p class="orders-empty-sub">Your orders and instant download access links will appear here immediately after checkout.</p>
        <button type="button" class="btn-explore-orders" onclick="window.closeUserOrdersModal && window.closeUserOrdersModal(); window.hideProfilePage && window.hideProfilePage();">
          <i class="fa-solid fa-bolt"></i> Explore Best Deals
        </button>
      </div>
    `;
  } else {
    listEl.innerHTML = orders.map(ord => formatOrderCardHtml(ord)).join('');
  }

  modal.classList.add('open');
}

export function closeUserOrdersModal() {
  const modal = document.getElementById('appOrdersModal');
  if (modal) modal.classList.remove('open');
}

// ━━ 11. FULL-PAGE NOTIFICATIONS SYSTEM CONTROLLER (NATIVE PAGE TYPE) ━━

const NOTIFS_READ_KEY = 'jaigram_notifs_read_v1';
const LEGACY_NOTIFS_READ_KEY = 'linkadda_notifs_read_v1';
let notifsPreviousScreen = 'profile';

export function addUserWelcomeNotification(uid, name) {
  try {
    const cleanUid = uid || 'guest';
    const welcomedKey = `jaigram_welcomed_${cleanUid}`;
    const legacyWelcomedKey = `linkadda_welcomed_${cleanUid}`;
    const notifsKey = `jaigram_notifs_${cleanUid}`;
    const legacyNotifsKey = `linkadda_notifs_${cleanUid}`;
    let list = [];
    try {
      const raw = localStorage.getItem(notifsKey) || localStorage.getItem(legacyNotifsKey);
      if (raw) list = JSON.parse(raw);
    } catch (_) {}

    const cleanName = name || 'Customer';
    const welcomeItem = {
      id: `welcome_${cleanUid}`,
      type: 'welcome',
      title: `Welcome to JaiGram, ${cleanName}! 🎉`,
      desc: `Your verified customer account has been created successfully. All purchases, discrete receipts, and 24/7 Telegram download links are now active.`,
      time: 'Just now',
      unread: true,
      icon: 'fa-gift',
      theme: 'welcome'
    };

    list = list.filter(n => n.type !== 'welcome');
    list.unshift(welcomeItem);
    localStorage.setItem(notifsKey, JSON.stringify(list));
    localStorage.setItem(legacyNotifsKey, JSON.stringify(list));
    localStorage.setItem(welcomedKey, 'true');
    localStorage.setItem(legacyWelcomedKey, 'true');
    updateNotificationsUI();
    renderNotificationsPage();
  } catch (err) {
    console.warn('Welcome notif error:', err);
  }
}

export function formatRelativeTime(ts) {
  if (!ts) return 'Just now';
  let time = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (isNaN(time)) {
    if (typeof ts === 'string') return ts;
    return 'Just now';
  }
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - time) / 1000));
  if (diffSec < 60) return 'Just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) {
    const d = new Date(time);
    return `Yesterday, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (days < 7) return `${days}d ago`;
  const d = new Date(time);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function getUserNotifications() {
  const user = getCustomerSession();
  const uid = user ? user.uid : 'guest';
  const key = `jaigram_notifs_${uid}`;
  const legacyKey = `linkadda_notifs_${uid}`;
  
  let list = [];
  try {
    const raw = localStorage.getItem(key) || localStorage.getItem(legacyKey);
    if (raw) list = JSON.parse(raw);
  } catch (_) {}

  // Auto-migrate legacy cached items: remove any "download" wording and ensure timestamps exist
  let listModified = false;
  list = list.map(item => {
    if (!item.timestamp && item.time) {
      item.timestamp = Date.now() - 180000;
      listModified = true;
    }
    if (item.desc && (item.desc.includes('download') || item.desc.includes('Download'))) {
      item.desc = item.desc
        .replace(/VIP content aur download link ke liye Telegram par message karein\.?/gi, 'VIP Telegram Channel / Group access link is unlocked. Tap to view message and join.')
        .replace(/download link/gi, 'Telegram VIP link')
        .replace(/download/gi, 'access');
      listModified = true;
    }
    if (item.actionText && (item.actionText.includes('Download') || item.actionText.includes('Content Link'))) {
      item.actionText = 'Join Telegram VIP Channel / Group';
      listModified = true;
    }
    return item;
  });
  if (listModified) {
    try {
      localStorage.setItem(key, JSON.stringify(list));
      localStorage.setItem(legacyKey, JSON.stringify(list));
    } catch (_) {}
  }

  // If user is logged in, ensure Welcome Notification exists
  if (user) {
    const welcomedKey = `jaigram_welcomed_${user.uid}`;
    const legacyWelcomedKey = `linkadda_welcomed_${user.uid}`;
    const hasWelcomed = localStorage.getItem(welcomedKey) || localStorage.getItem(legacyWelcomedKey);
    const hasWelcomeInList = list.some(n => n.type === 'welcome');
    if (!hasWelcomed || !hasWelcomeInList) {
      const welcomeItem = {
        id: `welcome_${user.uid}`,
        type: 'welcome',
        title: `Welcome to JaiGram, ${user.displayName || 'Customer'}! 🎉`,
        desc: `Your verified customer account has been created. Instant Telegram delivery and discrete order receipts are active 24/7.`,
        timestamp: Date.now(),
        time: 'Just now',
        unread: true,
        icon: 'fa-gift',
        theme: 'welcome'
      };
      list.unshift(welcomeItem);
      localStorage.setItem(welcomedKey, 'true');
      try {
        localStorage.setItem(key, JSON.stringify(list));
      } catch (_) {}
    }
  }

  // Ensure default announcements exist
  const hasSystemInstant = list.some(n => n.id === 'notif_instant');
  const hasSystemDrops = list.some(n => n.id === 'notif_drops');
  if (!hasSystemInstant) {
    list.push({
      id: 'notif_instant',
      type: 'system',
      title: 'Instant Telegram Delivery Online 24/7',
      desc: 'Automated delivery bot is operating at full speed. All purchased video collections deliver direct Telegram VIP Channel links instantly with zero delay.',
      timestamp: Date.now() - 3600000,
      time: '1h ago',
      unread: false,
      icon: 'fa-bolt',
      theme: 'instant'
    });
  }
  if (!hasSystemDrops) {
    list.push({
      id: 'notif_drops',
      type: 'system',
      title: 'Daily 4K Creator Drops',
      desc: 'Exclusive ultra-HD creator collections added today. Browse trending categories to claim limited-time offer bundles.',
      timestamp: Date.now() - 7200000,
      time: '2h ago',
      unread: false,
      icon: 'fa-fire',
      theme: 'drop'
    });
  }

  return list;
}

export function updateNotificationsUI() {
  const notifs = getUserNotifications();
  const unreadCount = notifs.filter(n => n.unread).length;
  
  const topDot = document.getElementById('appbarNotifDot');
  const headerDot = document.getElementById('headerNotifDot');
  const hubBadge = document.getElementById('profileNotifCount');
  const optionBadge = document.getElementById('profileOptionNotifBadge');
  const pageUnreadBadge = document.getElementById('notifPageUnreadCount');
  const markReadBtn = document.getElementById('btnTopMarkNotifsRead');

  if (topDot) topDot.style.display = unreadCount > 0 ? 'block' : 'none';
  if (headerDot) headerDot.style.display = unreadCount > 0 ? 'block' : 'none';

  if (hubBadge) {
    hubBadge.textContent = unreadCount > 0 ? `${unreadCount} New` : '0 New';
    hubBadge.style.opacity = unreadCount > 0 ? '1' : '0.6';
  }

  if (optionBadge) {
    optionBadge.textContent = unreadCount > 0 ? `${unreadCount} New` : '0 New';
    optionBadge.style.opacity = unreadCount > 0 ? '1' : '0.6';
  }

  if (pageUnreadBadge) {
    pageUnreadBadge.textContent = unreadCount > 0 ? `${unreadCount} Unread` : 'All Caught Up';
    pageUnreadBadge.className = unreadCount > 0 ? 'notif-page-unread-pill has-unread' : 'notif-page-unread-pill';
  }

  if (markReadBtn) {
    if (unreadCount === 0) {
      markReadBtn.innerHTML = `<i class="fa-solid fa-check-double"></i> <span>All Read</span>`;
      markReadBtn.classList.add('all-read');
    } else {
      markReadBtn.innerHTML = `<i class="fa-solid fa-check-double"></i> <span>Mark all</span>`;
      markReadBtn.classList.remove('all-read');
    }
  }
}

export function renderNotificationsPage() {
  const listEl = document.getElementById('notifPageList');
  if (!listEl) return;

  const notifs = getUserNotifications();
  if (!notifs.length) {
    listEl.innerHTML = `
      <div class="notif-empty-state">
        <div class="notif-empty-icon"><i class="fa-regular fa-bell-slash"></i></div>
        <h4 class="notif-empty-title">No notifications yet</h4>
        <p class="notif-empty-sub">When you receive order updates, delivery links, or deals, they will appear here.</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = notifs.map(n => {
    const timeDisplay = formatRelativeTime(n.timestamp || n.time);
    return `
      <div class="notif-page-card clickable ${n.unread ? 'unread' : ''}" id="notif-item-${escapeHtml(n.id)}" onclick="window.handleNotificationCardClick && window.handleNotificationCardClick('${escapeHtml(n.id)}', event)" role="button" tabindex="0">
        <div class="notif-page-card-icon ${escapeHtml(n.theme || 'default')}">
          <i class="fa-solid ${escapeHtml(n.icon || 'fa-bell')}"></i>
        </div>
        <div class="notif-page-card-body">
          <div class="notif-page-card-head">
            <h4 class="notif-page-card-title">
              ${escapeHtml(n.title)}
              ${n.unread ? '<span class="notif-unread-dot" title="Unread"></span>' : ''}
            </h4>
            <span class="notif-page-card-time">${escapeHtml(timeDisplay)}</span>
          </div>
          <p class="notif-page-card-desc">${escapeHtml(n.desc)}</p>
          <div class="notif-card-footer">
            <span class="notif-tap-hint">
              <i class="fa-solid ${n.type === 'order_confirmed' ? 'fa-brands fa-telegram' : 'fa-envelope-open-text'}"></i>
              ${n.type === 'order_confirmed' ? 'VIP Channel Link Inside • Tap to Read' : 'Tap to Read Message'}
            </span>
            <span class="notif-chevron"><i class="fa-solid fa-angle-right"></i></span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

export function handleNotificationCardClick(notifId, event) {
  if (event) event.stopPropagation();
  const user = getCustomerSession();
  const uid = user ? user.uid : 'guest';
  const key = `jaigram_notifs_${uid}`;
  const legacyKey = `linkadda_notifs_${uid}`;
  
  let list = getUserNotifications();
  const target = list.find(n => n.id === notifId);
  if (!target) return;

  // 1. Mark as read immediately
  if (target.unread) {
    target.unread = false;
    try {
      localStorage.setItem(key, JSON.stringify(list));
      localStorage.setItem(legacyKey, JSON.stringify(list));
    } catch (_) {}
    updateNotificationsUI();
    const cardEl = document.getElementById(`notif-item-${notifId}`);
    if (cardEl) {
      cardEl.classList.remove('unread');
      const dot = cardEl.querySelector('.notif-unread-dot');
      if (dot) dot.remove();
    }
  }

  // 2. Open rich detail modal
  openNotificationDetailModal(target);
}

export function openNotificationDetailModal(notif) {
  const modal = document.getElementById('notifDetailModal');
  if (!modal) return;

  const titleEl = document.getElementById('notifDetailTitle');
  const timeEl = document.getElementById('notifDetailTime');
  const iconEl = document.getElementById('notifDetailIcon');
  const msgEl = document.getElementById('notifDetailMessageText');
  const orderBox = document.getElementById('notifDetailOrderBox');
  const itemNameEl = document.getElementById('notifDetailItemName');
  const orderIdEl = document.getElementById('notifDetailOrderId');
  const actionWrap = document.getElementById('notifDetailActionContainer');
  const ctaBtn = document.getElementById('notifDetailVipLinkBtn');
  const ctaBtnLabel = document.getElementById('notifDetailVipBtnLabel');
  const statusPill = document.getElementById('notifDetailStatusPill');
  const statusText = document.getElementById('notifDetailStatusText');

  if (titleEl) titleEl.textContent = notif.title || 'Notification Message';
  
  // Format exact date & time
  let exactTimeText = notif.time || 'Just now';
  if (notif.timestamp) {
    const d = new Date(notif.timestamp);
    exactTimeText = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  if (timeEl) timeEl.textContent = exactTimeText;

  if (iconEl) {
    iconEl.className = `notif-detail-icon-wrap ${notif.theme || 'default'}`;
    iconEl.innerHTML = `<i class="fa-solid ${escapeHtml(notif.icon || 'fa-bell')}"></i>`;
  }

  if (msgEl) {
    msgEl.textContent = notif.desc || '';
  }

  if (notif.type === 'order_confirmed') {
    if (statusPill) statusPill.style.display = 'inline-flex';
    if (statusText) statusText.textContent = 'Order Verified & Approved';
    if (orderBox) orderBox.style.display = 'flex';
    if (itemNameEl) itemNameEl.textContent = notif.productName || 'VIP Content Pack';
    if (orderIdEl) orderIdEl.textContent = '#' + String(notif.orderId || '').slice(-10).toUpperCase();

    const link = notif.actionUrl || notif.telegramLink || notif.channelLink || 'https://t.me/TRUSTED_BROTHER1234';
    if (actionWrap) actionWrap.style.display = 'flex';
    if (ctaBtn) {
      ctaBtn.href = link;
      ctaBtn.dataset.url = link;
    }
    if (ctaBtnLabel) {
      ctaBtnLabel.textContent = 'Join Telegram VIP Channel / Group';
    }
  } else if (notif.actionUrl) {
    if (statusPill) statusPill.style.display = 'none';
    if (orderBox) orderBox.style.display = 'none';
    if (actionWrap) actionWrap.style.display = 'flex';
    if (ctaBtn) {
      ctaBtn.href = notif.actionUrl;
      ctaBtn.dataset.url = notif.actionUrl;
    }
    if (ctaBtnLabel) {
      ctaBtnLabel.textContent = notif.actionText || 'Open Telegram Link';
    }
  } else {
    if (statusPill) statusPill.style.display = 'none';
    if (orderBox) orderBox.style.display = 'none';
    if (actionWrap) actionWrap.style.display = 'none';
  }

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

export function closeNotificationDetailModal() {
  const modal = document.getElementById('notifDetailModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

export async function copyNotifVipLink(btnEl) {
  const ctaBtn = document.getElementById('notifDetailVipLinkBtn');
  const url = ctaBtn ? (ctaBtn.dataset.url || ctaBtn.href) : '';
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    if (btnEl) {
      const orig = btnEl.innerHTML;
      btnEl.innerHTML = '<i class="fa-solid fa-check" style="color:#10b981;"></i> <span>Copied VIP Link!</span>';
      setTimeout(() => { btnEl.innerHTML = orig; }, 2000);
    }
    showAppToast('✅ Telegram VIP Link copied to clipboard!');
  } catch (_) {
    showAppToast('VIP Link: ' + url);
  }
}

export function showNotificationsPage(fromScreen = 'profile') {
  notifsPreviousScreen = fromScreen;
  const storefrontView = document.getElementById('appStorefrontView');
  const accountView = document.getElementById('appAccountView');
  const notifsView = document.getElementById('appNotificationsView');
  const ordersView = document.getElementById('appOrdersView');
  const searchView = document.getElementById('appSearchView');
  if (!notifsView) return;

  if (storefrontView) storefrontView.style.display = 'none';
  if (accountView) accountView.style.display = 'none';
  if (ordersView) ordersView.style.display = 'none';
  if (searchView) searchView.style.display = 'none';
  notifsView.style.display = 'block';

  // Responsive device view: on desktop (laptop/PC > 991px), keep main store header active
  const isDesktop = window.innerWidth > 991;
  const fkHeader = document.getElementById('fkHeader');
  const fkHeaderSpacer = document.getElementById('fkHeaderSpacer');
  const marqueeWrap = document.querySelector('.marquee-wrap');
  const floatingCart = document.getElementById('leftFloatingCart');
  if (fkHeader) fkHeader.style.display = isDesktop ? '' : 'none';
  if (fkHeaderSpacer) fkHeaderSpacer.style.display = isDesktop ? '' : 'none';
  if (marqueeWrap) marqueeWrap.style.display = 'none';
  if (floatingCart) floatingCart.style.display = isDesktop ? '' : 'none';

  document.body.style.overflow = '';
  window.scrollTo(0, 0);

  const backLabel = document.getElementById('notifsBackBtnLabel');
  if (backLabel) {
    backLabel.textContent = fromScreen === 'store' ? 'Store' : fromScreen === 'orders' ? 'Orders' : 'Profile';
  }

  // Instant order sync when notifications page is opened
  syncUserOrdersWithFirebase().catch(() => {});

  renderNotificationsPage();
  updateNotificationsUI();

  if (window.location.hash !== '#notifications') {
    window.history.pushState({ screen: 'notifications', from: fromScreen }, '', '#notifications');
  }
}

export function hideNotificationsPage(preventHistoryBack = false) {
  const notifsView = document.getElementById('appNotificationsView');
  if (notifsView) notifsView.style.display = 'none';

  if (notifsPreviousScreen === 'orders') {
    showOrdersPage();
  } else if (notifsPreviousScreen === 'profile') {
    showProfilePage();
  } else {
    hideProfilePage();
  }

  if (!preventHistoryBack && window.location.hash === '#notifications') {
    window.history.back();
  }
}

// ━━ 12. DEDICATED FULL-PAGE ORDERS SCREEN CONTROLLER (NATIVE PAGE TYPE) ━━
let ordersPreviousScreen = 'profile';

export function showOrdersPage(fromScreen = 'profile') {
  ordersPreviousScreen = fromScreen;
  const storefrontView = document.getElementById('appStorefrontView');
  const accountView = document.getElementById('appAccountView');
  const notifsView = document.getElementById('appNotificationsView');
  const searchView = document.getElementById('appSearchView');
  const ordersView = document.getElementById('appOrdersView');
  if (!ordersView) return;

  if (storefrontView) storefrontView.style.display = 'none';
  if (accountView) accountView.style.display = 'none';
  if (notifsView) notifsView.style.display = 'none';
  if (searchView) searchView.style.display = 'none';
  ordersView.style.display = 'block';

  // Responsive device view: on desktop (laptop/PC > 991px), keep main store header & floating cart active
  const isDesktop = window.innerWidth > 991;
  const fkHeader = document.getElementById('fkHeader');
  const fkHeaderSpacer = document.getElementById('fkHeaderSpacer');
  const marqueeWrap = document.querySelector('.marquee-wrap');
  const floatingCart = document.getElementById('leftFloatingCart');
  if (fkHeader) fkHeader.style.display = isDesktop ? '' : 'none';
  if (fkHeaderSpacer) fkHeaderSpacer.style.display = isDesktop ? '' : 'none';
  if (marqueeWrap) marqueeWrap.style.display = 'none';
  if (floatingCart) floatingCart.style.display = isDesktop ? '' : 'none';

  document.body.style.overflow = '';
  window.scrollTo(0, 0);

  const backLabel = document.getElementById('ordersBackBtnLabel');
  if (backLabel) {
    backLabel.textContent = fromScreen === 'store' ? 'Store' : 'Profile';
  }

  // Update cart badges
  if (typeof window.updateCartBadges === 'function') {
    window.updateCartBadges();
  }

  // Instant order sync with Firebase RTDB
  if (typeof syncUserOrdersWithFirebase === 'function') {
    syncUserOrdersWithFirebase().catch(() => {});
  }

  renderOrdersPage();

  if (window.location.hash !== '#orders') {
    window.history.pushState({ screen: 'orders', from: fromScreen }, '', '#orders');
  }
}

export function hideOrdersPage(preventHistoryBack = false) {
  const ordersView = document.getElementById('appOrdersView');
  if (ordersView) ordersView.style.display = 'none';

  if (ordersPreviousScreen === 'profile') {
    showProfilePage();
  } else {
    hideProfilePage();
  }

  if (!preventHistoryBack && window.location.hash === '#orders') {
    window.history.back();
  }
}

export function renderOrdersPage(filterQuery = '') {
  const listEl = document.getElementById('appOrdersPageList');
  const countPill = document.getElementById('ordersPageCountPill');
  if (!listEl) return;

  const user = getCustomerSession();
  if (!user) {
    if (countPill) countPill.textContent = '0 Orders';
    listEl.innerHTML = `
      <div class="orders-empty-state">
        <div class="orders-empty-icon"><i class="fa-solid fa-lock" style="color: #ff2a8d;"></i></div>
        <h4 class="orders-empty-title">Sign in to view your orders</h4>
        <p class="orders-empty-sub">Sign in with your email or Google account to view your purchased packs, instant telegram access links, and receipts.</p>
        <button type="button" class="btn-explore-orders" onclick="window.openAuthModal && window.openAuthModal('input');" style="background: linear-gradient(135deg, #ff2a8d, #8b5cf6); margin-top: 12px;">
          <i class="fa-solid fa-arrow-right-to-bracket"></i> Sign In / Register
        </button>
      </div>
    `;
    return;
  }

  const allOrders = getUserOrders();
  let orders = allOrders;

  if (filterQuery && filterQuery.trim()) {
    const q = filterQuery.trim().toLowerCase();
    orders = allOrders.filter(o => 
      (o.orderId && String(o.orderId).toLowerCase().includes(q)) ||
      (o.productName && String(o.productName).toLowerCase().includes(q)) ||
      (o.status && String(o.status).toLowerCase().includes(q)) ||
      (o.date && String(o.date).toLowerCase().includes(q))
    );
  }

  if (countPill) {
    countPill.textContent = `${allOrders.length} ${allOrders.length === 1 ? 'Order' : 'Orders'}`;
  }

  // Also sync profile count pills
  const countEl = document.getElementById('profileOrdersCount');
  const pillEl = document.getElementById('profileOrdersPill');
  if (countEl) countEl.textContent = `${allOrders.length} ${allOrders.length === 1 ? 'Order' : 'Orders'}`;
  if (pillEl) pillEl.textContent = `${allOrders.length} ${allOrders.length === 1 ? 'Order' : 'Orders'}`;

  if (!orders.length) {
    if (filterQuery) {
      listEl.innerHTML = `
        <div class="orders-empty-state">
          <div class="orders-empty-icon"><i class="fa-solid fa-magnifying-glass"></i></div>
          <h4 class="orders-empty-title">No matching orders found</h4>
          <p class="orders-empty-sub">No purchases match "${escapeHtml(filterQuery)}". Try another search keyword.</p>
        </div>
      `;
    } else {
      listEl.innerHTML = `
        <div class="orders-empty-state">
          <div class="orders-empty-icon"><i class="fa-solid fa-bag-shopping"></i></div>
          <h4 class="orders-empty-title">You haven't placed any orders yet</h4>
          <p class="orders-empty-sub">Your purchased creator collections, discrete download links, and receipts will appear here automatically.</p>
          <button type="button" class="btn-explore-orders" onclick="window.hideOrdersPage && window.hideOrdersPage();">
            <i class="fa-solid fa-bolt"></i> Explore Trending Packs
          </button>
        </div>
      `;
    }
  } else {
    listEl.innerHTML = orders.map(ord => formatOrderCardHtml(ord)).join('');
  }
}

export function filterOrdersList(q) {
  renderOrdersPage(q);
}

export async function refreshUserOrders() {
  const btn = document.querySelector('.btn-refresh-orders i');
  if (btn) btn.classList.add('fa-spin');
  try {
    if (typeof syncUserOrdersWithFirebase === 'function') {
      await syncUserOrdersWithFirebase();
    }
  } catch (_) {}
  setTimeout(() => {
    if (btn) btn.classList.remove('fa-spin');
    renderOrdersPage();
    if (typeof showAppToast === 'function') {
      showAppToast('Orders refreshed.');
    }
  }, 600);
}

export function markNotificationsAsRead() {
  const user = getCustomerSession();
  const uid = user ? user.uid : 'guest';
  const key = `jaigram_notifs_${uid}`;
  const legacyKey = `linkadda_notifs_${uid}`;
  
  const list = getUserNotifications().map(n => ({ ...n, unread: false }));
  try {
    localStorage.setItem(key, JSON.stringify(list));
    localStorage.setItem(legacyKey, JSON.stringify(list));
    localStorage.setItem(NOTIFS_READ_KEY, 'true');
    localStorage.setItem(LEGACY_NOTIFS_READ_KEY, 'true');
  } catch (_) {}
  
  updateNotificationsUI();
  renderNotificationsPage();
  showAppToast('All notifications marked as read.');
}

export function openNameModal() {
  openAuthModal('name');
}

// Global exposure
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.openNameModal = openEditProfileModal; // upgraded from simple name modal to full profile edit!
window.openEditProfileModal = openEditProfileModal;
window.closeEditProfileModal = closeEditProfileModal;
window.saveCustomerProfile = saveCustomerProfile;
window.showProfilePage = showProfilePage;
window.hideProfilePage = hideProfilePage;
window.showNotificationsPage = showNotificationsPage;
window.hideNotificationsPage = hideNotificationsPage;
window.showOrdersPage = showOrdersPage;
window.hideOrdersPage = hideOrdersPage;
window.renderOrdersPage = renderOrdersPage;
window.filterOrdersList = filterOrdersList;
window.refreshUserOrders = refreshUserOrders;
window.openNotificationsModal = showNotificationsPage; // backward compatibility
window.closeNotificationsModal = hideNotificationsPage; // backward compatibility
window.markNotificationsAsRead = markNotificationsAsRead;
window.renderNotificationsPage = renderNotificationsPage;
window.getUserNotifications = getUserNotifications;
window.addUserWelcomeNotification = addUserWelcomeNotification;
window.updateNotificationsUI = updateNotificationsUI;
window.saveCustomerName = saveCustomerName;
window.getCustomerSession = getCustomerSession;
window.logoutCustomer = logoutCustomer;

// ━━ LOGOUT CONFIRMATION MODAL CONTROLLER ━━
export function openLogoutModal() {
  const modal = document.getElementById('logoutConfirmModal');
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    // Add entrance animation
    const card = modal.querySelector('.logout-confirm-card');
    if (card) {
      card.style.animation = 'none';
      card.offsetHeight; // force reflow
      card.style.animation = '';
    }
  }
}

export function closeLogoutModal() {
  const modal = document.getElementById('logoutConfirmModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

export function confirmLogout() {
  closeLogoutModal();
  logoutCustomer();
}

window.openLogoutModal = openLogoutModal;
window.closeLogoutModal = closeLogoutModal;
window.confirmLogout = confirmLogout;
window.openUserOrdersModal = openUserOrdersModal;
window.closeUserOrdersModal = closeUserOrdersModal;
window.getUserOrders = getUserOrders;
window.formatOrderCardHtml = formatOrderCardHtml;
window.syncUserOrdersWithFirebase = syncUserOrdersWithFirebase;
window.addOrderConfirmedNotification = addOrderConfirmedNotification;
window.checkAndResumePendingCheckout = checkAndResumePendingCheckout;
window.renderAccountOrders = renderAccountOrders;
window.showAppToast = showAppToast;
window.formatRelativeTime = formatRelativeTime;
window.handleNotificationCardClick = handleNotificationCardClick;
window.openNotificationDetailModal = openNotificationDetailModal;
window.closeNotificationDetailModal = closeNotificationDetailModal;
window.copyNotifVipLink = copyNotifVipLink;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initAuthModalEvents();
    updateNotificationsUI();
    syncUserOrdersWithFirebase().catch(() => {});
  });
} else {
  initAuthModalEvents();
  updateNotificationsUI();
  syncUserOrdersWithFirebase().catch(() => {});
}

// Background auto-sync for order approval every 8 seconds (fast response)
if (typeof window !== 'undefined') {
  setInterval(() => {
    syncUserOrdersWithFirebase().catch(() => {});
  }, 8000);

  window.addEventListener('focus', () => {
    syncUserOrdersWithFirebase().catch(() => {});
  });

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        syncUserOrdersWithFirebase().catch(() => {});
      }
    });
  }
}

// Window resize listener to sync header visibility between desktop & mobile states
window.addEventListener('resize', () => {
  const accountView = document.getElementById('appAccountView');
  const notifsView = document.getElementById('appNotificationsView');
  const searchView = document.getElementById('appSearchView');
  const fkHeader = document.getElementById('fkHeader');
  const fkHeaderSpacer = document.getElementById('fkHeaderSpacer');
  const floatingCart = document.getElementById('leftFloatingCart');
  const isScreenActive = (accountView && accountView.style.display === 'block') ||
                         (notifsView && notifsView.style.display === 'block') ||
                         (searchView && searchView.style.display === 'block');
  if (isScreenActive && fkHeader) {
    const isDesktop = window.innerWidth > 991;
    fkHeader.style.display = isDesktop ? '' : 'none';
    if (fkHeaderSpacer) fkHeaderSpacer.style.display = isDesktop ? '' : 'none';
    if (floatingCart) floatingCart.style.display = isDesktop ? '' : 'none';
  }
}, { passive: true });




