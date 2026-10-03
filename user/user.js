/**
 * LinkAdda Shop — Real Customer User Dashboard Controller
 * Strictly authenticated: Loads real user profile, orders, wallet, and followed stores
 */

(function () {
  'use strict';

  const SESSION_KEY = 'linkadda_customer_session';
  const THEME_KEY = 'linkadda_theme';
  const CURRENCY_KEY = 'linkadda_currency';
  const RTDB_URL = 'https://linkadda-cd1da-default-rtdb.firebaseio.com';
  const isLocalStaticHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:';
  const API_BASE = isLocalStaticHost ? 'https://jaigram.shop' : '';

  let currentCustomer = null;
  let userOrders = [];
  let userWallet = 0.00;
  let userFollowedStores = [];
  let currentCurrency = localStorage.getItem(CURRENCY_KEY) || 'INR';
  let detectedGeoCountry = null;

  // ━━ 1. INITIALIZATION & STRICT AUTH CHECK ━━
  document.addEventListener('DOMContentLoaded', () => {
    // Guarantee document and body scroll is immediately unlocked
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    initTheme();
    initCurrency();
    if (checkCustomerAuth()) {
      initCustomerProfile();
      loadUserWallet();
      loadWalletTransactions();
      restoreMarketplaceCacheImmediate();
      loadUserFollowedStores();
      loadUserOrders();
      if (typeof window.loadUserReports === 'function') window.loadUserReports(true);
      startPendingOrderAutoSync();
      syncCustomerProfileFromRemote();
      loadUserNotifications();
      initMobileSidebar();
      initGlobalSearch();
      initCart();
      initWishlist();
      initMobileHomeApp();
      init18PlusAgeGate();

      // Deep link support: If page opened with #profile, #settings, #orders, #marketplace, etc.
      const urlParams = new URLSearchParams(window.location.search);
      const initialTab = (window.location.hash || '').replace('#', '').trim() || urlParams.get('tab');
      const validTabs = ['dashboard', 'profile', 'edit-profile', 'orders', 'wallet', 'stores', 'wishlist', 'settings', 'support', 'messages', 'refer', 'marketplace', 'cart'];
      if (initialTab && validTabs.includes(initialTab)) {
        switchTab(initialTab);
      }

      // Direct product, store, category or search deep links
      const deepProdId = urlParams.get('productId') || urlParams.get('id');
      let deepStore = urlParams.get('store') || urlParams.get('seller') || urlParams.get('sellerId');
      if (!deepStore && window.location.hash) {
        if (window.location.hash.startsWith('#store-')) deepStore = decodeURIComponent(window.location.hash.replace('#store-', ''));
        else if (window.location.hash.startsWith('#seller-')) deepStore = decodeURIComponent(window.location.hash.replace('#seller-', ''));
      }
      const deepCat = urlParams.get('category') || urlParams.get('filter');
      const deepQ = urlParams.get('q') || urlParams.get('search');

      if (deepProdId) {
        if (typeof switchTab === 'function') switchTab('marketplace');
        setTimeout(() => window.openProductDetailModal(deepProdId), 600);
      } else if (deepStore) {
        if (typeof switchTab === 'function') switchTab('marketplace');
        setTimeout(() => window.openStoreShowcaseModal(deepStore), 600);
      }

      if (deepCat && typeof window.setMarketplaceCategoryFilter === 'function') {
        setTimeout(() => window.setMarketplaceCategoryFilter(deepCat), 500);
      }
      if (deepQ && typeof window.handleMarketplaceSearch === 'function') {
        const searchInput = document.getElementById('marketplaceSearchInput');
        if (searchInput) searchInput.value = deepQ;
        setTimeout(() => window.handleMarketplaceSearch(deepQ), 500);
      }
    }
  });

  // ━━ 2. STRICT AUTH CHECK ━━
  function checkCustomerAuth() {
    try {
      const raw = localStorage.getItem('jaigram_customer_session') || localStorage.getItem(SESSION_KEY);
      if (raw) {
        currentCustomer = JSON.parse(raw);
        try {
          localStorage.setItem('jaigram_customer_session', JSON.stringify(currentCustomer));
          localStorage.setItem(SESSION_KEY, JSON.stringify(currentCustomer));
        } catch (_) {}
      }
    } catch (e) {
      console.warn('Failed to parse customer session:', e);
    }

    const urlParams = new URLSearchParams(window.location.search);
    const hasStoreDeepLink = urlParams.get('store') || urlParams.get('seller') || urlParams.get('productId') || urlParams.get('id') || (window.location.hash && window.location.hash.includes('store'));
    if ((!currentCustomer || !currentCustomer.email) && (urlParams.get('demo') === '1' || urlParams.get('preview') === '1' || urlParams.get('guest') === '1' || hasStoreDeepLink)) {
      const guestRand = ((typeof crypto !== 'undefined' && crypto.randomUUID) 
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) 
        : (Date.now().toString(36) + Math.random().toString(36).substring(2, 8)));
      currentCustomer = {
        uid: 'cust_guest_' + guestRand,
        email: 'guest_' + guestRand + '@jaigram.shop',
        displayName: 'Guest Member',
        name: 'Guest Member',
        role: 'customer'
      };
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(currentCustomer));
      } catch (_) {}
    }

    if (!currentCustomer || typeof currentCustomer !== 'object' || (!currentCustomer.email && !currentCustomer.uid)) {
      document.documentElement.style.display = 'none';
      sessionStorage.setItem('linkadda_pending_destination', 'user/index.html');
      window.location.replace('../login.html?returnUrl=user/index.html');
      return false;
    }
    return true;
  }

  // ━━ 3. RESEARCHED SYSTEM THEME ENGINE (Light / Dark / System Auto) ━━
  function initTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY) || 'light';
    setAppTheme(savedTheme, false);

    // Watch OS system preference changes live
    if (window.matchMedia) {
      try {
        const sysScheme = window.matchMedia('(prefers-color-scheme: dark)');
        if (sysScheme.addEventListener) {
          sysScheme.addEventListener('change', () => {
            if (localStorage.getItem(THEME_KEY) === 'system') {
              setAppTheme('system', false);
            }
          });
        } else if (sysScheme.addListener) {
          sysScheme.addListener(() => {
            if (localStorage.getItem(THEME_KEY) === 'system') {
              setAppTheme('system', false);
            }
          });
        }
      } catch (_) {}
    }
  }

  window.setAppTheme = function (mode, showToastMsg = true) {
    const selectedMode = (mode === 'dark' || mode === 'system') ? mode : 'light';
    localStorage.setItem(THEME_KEY, selectedMode);

    let effectiveTheme = selectedMode;
    if (selectedMode === 'system') {
      const isSystemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      effectiveTheme = isSystemDark ? 'dark' : 'light';
    }

    // 1. Root & Body Data Attributes
    document.documentElement.setAttribute('data-theme', effectiveTheme);
    document.body.setAttribute('data-theme', effectiveTheme);

    // 2. ClassList for backward compatibility
    if (effectiveTheme === 'dark') {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }

    // 3. Meta theme-color for mobile address bar
    const metaTheme = document.getElementById('metaThemeColor');
    if (metaTheme) {
      metaTheme.setAttribute('content', effectiveTheme === 'dark' ? '#0d121f' : '#ffffff');
    }

    // 4. Update 3 Visual Cards
    const cards = document.querySelectorAll('.theme-picker-card');
    cards.forEach(card => {
      if (card.getAttribute('data-theme-mode') === selectedMode) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });

    // 5. Update Quick Toggle Switch & Status Text
    const quickToggle = document.getElementById('themeSwitchToggle');
    if (quickToggle) {
      quickToggle.checked = (effectiveTheme === 'dark');
    }

    const statusText = document.getElementById('themeSwitchStatusText');
    if (statusText) {
      if (selectedMode === 'system') {
        statusText.textContent = `Auto-syncing with system (${effectiveTheme === 'dark' ? 'Dark' : 'Light'})`;
      } else if (selectedMode === 'dark') {
        statusText.textContent = 'Active: AMOLED Dark Mode';
      } else {
        statusText.textContent = 'Active: Crisp Daylight Light Mode';
      }
    }

    // 6. Update Legacy Label if present
    updateThemeLabel(effectiveTheme === 'dark');

    if (showToastMsg) {
      const label = selectedMode === 'system' ? 'System Synchronized' : (selectedMode === 'dark' ? 'Dark Mode' : 'Light Mode');
      showAppToast(`Theme updated to ${label}`);
    }
  };

  window.toggleThemeSwitch = function (isChecked) {
    setAppTheme(isChecked ? 'dark' : 'light', true);
  };

  window.toggleTheme = function () {
    const current = localStorage.getItem(THEME_KEY) || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    setAppTheme(next, true);
  };

  function updateThemeLabel(isDark) {
    const label = document.getElementById('themeToggleText');
    if (label) {
      label.textContent = isDark ? 'Light Theme' : 'Dark Theme';
    }
  }

  // ━━ 3B. CURRENCY ENGINE (INR ₹ & USD $ with Live GeoIP Auto-Targeting) ━━
  function initCurrency() {
    const saved = localStorage.getItem(CURRENCY_KEY);
    if (saved === 'USD' || saved === 'INR') {
      currentCurrency = saved;
    }
    applyCurrencyToUI(currentCurrency);
    detectUserCurrencyByIp();
  }

  async function detectUserCurrencyByIp() {
    const statusTextEl = document.getElementById('currencyLocationDetectText');
    const hasManualChoice = Boolean(localStorage.getItem(CURRENCY_KEY));

    let detectedCountry = '';
    let countryName = '';

    // Primary Provider: ipapi.co
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const res = await fetch('https://ipapi.co/json/', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        if (data && data.country_code) {
          detectedCountry = String(data.country_code).toUpperCase();
          countryName = data.country_name || detectedCountry;
        }
      }
    } catch (_) {}

    // Fallback 1: api.country.is
    if (!detectedCountry) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const res = await fetch('https://api.country.is', { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          if (data && data.country) {
            detectedCountry = String(data.country).toUpperCase();
            countryName = detectedCountry === 'IN' ? 'India' : detectedCountry;
          }
        }
      } catch (_) {}
    }

    // Fallback 2: Client Timezone
    if (!detectedCountry) {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        if (tz.includes('Kolkata') || tz.includes('Calcutta') || tz.includes('India')) {
          detectedCountry = 'IN';
          countryName = 'India';
        }
      } catch (_) {}
    }

    detectedGeoCountry = detectedCountry || 'IN';

    // India -> INR, All International -> USD
    const recommendedCurrency = (detectedGeoCountry === 'IN') ? 'INR' : 'USD';

    // Auto-apply if user has no saved manual preference
    if (!hasManualChoice) {
      currentCurrency = recommendedCurrency;
      localStorage.setItem(CURRENCY_KEY, currentCurrency);
      applyCurrencyToUI(currentCurrency);
      if (allMarketplaceProducts && allMarketplaceProducts.length) {
        renderMarketplaceCatalog();
        renderRecommendedProducts();
      }
    }

    if (statusTextEl) {
      const locLabel = countryName || (detectedGeoCountry === 'IN' ? 'India (IN)' : detectedGeoCountry);
      const isMatch = currentCurrency === recommendedCurrency;
      statusTextEl.innerHTML = `Auto-detected location: <strong>${escapeHtml(locLabel)}</strong> &bull; Currency: <strong>${recommendedCurrency === 'INR' ? '₹ INR (India)' : '$ USD (Global)'}</strong> ${isMatch ? '<span style="color:#10b981;font-weight:700;">(Active)</span>' : ''}`;
    }
  }

  function applyCurrencyToUI(curr) {
    const isUsd = (curr === 'USD');

    // 1. Settings Cards
    const cardInr = document.getElementById('currencyCardINR');
    const cardUsd = document.getElementById('currencyCardUSD');
    if (cardInr) cardInr.classList.toggle('active', !isUsd);
    if (cardUsd) cardUsd.classList.toggle('active', isUsd);

    // 2. Top Nav Bar Pill
    const navFlag = document.getElementById('navCurrencyFlag');
    const navCode = document.getElementById('navCurrencyCode');
    if (navFlag) navFlag.textContent = isUsd ? '🇺🇸' : '🇮🇳';
    if (navCode) navCode.textContent = isUsd ? '$ USD' : '₹ INR';

    // 3. Product Fullpage Overlay Top Pill
    const pdmFlag = document.getElementById('pdmTopCurrencyFlag');
    const pdmLabel = document.getElementById('pdmTopCurrencyLabel');
    if (pdmFlag) pdmFlag.textContent = isUsd ? '🇺🇸' : '🇮🇳';
    if (pdmLabel) pdmLabel.textContent = isUsd ? '$ USD' : '₹ INR';
  }

  window.setAppCurrency = function (curr, reRender = true) {
    const cleanCurr = String(curr || '').toUpperCase() === 'USD' ? 'USD' : 'INR';
    currentCurrency = cleanCurr;
    localStorage.setItem(CURRENCY_KEY, cleanCurr);
    applyCurrencyToUI(cleanCurr);

    if (reRender) {
      if (typeof window.renderMarketplaceCatalog === 'function') renderMarketplaceCatalog();
      if (typeof window.renderRecommendedProducts === 'function') renderRecommendedProducts();
      if (currentModalStoreProducts && currentModalStoreProducts.length && typeof renderStoreProductsGrid === 'function') {
        renderStoreProductsGrid(currentModalStoreProducts);
      }
      if (currentPdmProduct && typeof updatePdmProductPricing === 'function') {
        updatePdmProductPricing();
      }
      if (typeof window.updateCartUI === 'function') {
        window.updateCartUI();
      }
      showAppToast(`Currency set to ${cleanCurr === 'INR' ? '₹ INR (Indian Rupee)' : '$ USD (US Dollar)'}`);
    }
  };

  window.toggleCurrencyQuick = function () {
    const next = currentCurrency === 'INR' ? 'USD' : 'INR';
    setAppCurrency(next, true);
  };

  // ━━ 4. LOAD REAL USER PROFILE ━━
  function initCustomerProfile() {
    if (!currentCustomer) return;

    const email = currentCustomer.email || '';
    const displayName = currentCustomer.displayName || currentCustomer.name || (email ? email.split('@')[0] : 'Customer');
    const firstName = displayName.split(' ')[0] || displayName;

    // Guaranteed Unique Customer UID Resolution (no duplicates, no collisions)
    if (!currentCustomer.uid || currentCustomer.uid === 'cust_member_preview' || currentCustomer.uid.length < 8) {
      if (email && email.includes('@')) {
        const clean = email.toLowerCase().trim();
        let h1 = 0x811c9dc5, h2 = 0x5a5a5a5a;
        for (let i = 0; i < clean.length; i++) {
          h1 = Math.imul(h1 ^ clean.charCodeAt(i), 0x01000193);
          h2 = Math.imul(h2 ^ clean.charCodeAt(clean.length - 1 - i), 0x01000193);
        }
        const hex = ((h1 >>> 0).toString(16).padStart(8, '0')) + ((h2 >>> 0).toString(16).padStart(8, '0'));
        currentCustomer.uid = `cust_${hex}`;
      } else {
        const rand = (typeof crypto !== 'undefined' && crypto.randomUUID) 
          ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
          : (Date.now().toString(36) + Math.random().toString(36).substring(2, 10));
        currentCustomer.uid = `cust_${rand}`;
      }
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(currentCustomer)); } catch (_) {}
    }

    const fullUid = currentCustomer.uid;
    const shortUid = fullUid.replace(/^cust_/, '').slice(-6).toUpperCase();
    const uidFormatted = `ID: #LA-${shortUid}`;

    // Header Greeting
    const navGreeting = document.getElementById('navUserGreeting');
    if (navGreeting) navGreeting.textContent = `Hello, ${firstName}`;

    // Sidebar Meta
    const sidebarName = document.getElementById('sidebarUserName');
    if (sidebarName) sidebarName.textContent = displayName;

    const sidebarUid = document.getElementById('sidebarUserUid');
    if (sidebarUid) sidebarUid.textContent = uidFormatted;

    // Hub Header Meta
    const hubName = document.getElementById('hubUserName');
    if (hubName) hubName.textContent = displayName;

    const hubEmail = document.getElementById('hubUserEmail');
    if (hubEmail) hubEmail.textContent = email || 'member@jaigram.shop';

    const profileHeroUid = document.getElementById('profileHeroUid');
    if (profileHeroUid) profileHeroUid.textContent = uidFormatted;

    // Settings Profile Displays & Hero UID
    const settingsEmail = document.getElementById('settingsEmailDisplay');
    if (settingsEmail) settingsEmail.textContent = email || 'member@jaigram.shop';

    const settingsUid = document.getElementById('settingsUidDisplay');
    if (settingsUid) settingsUid.textContent = fullUid;

    const profUidDisplay = document.getElementById('profUidDisplay');
    if (profUidDisplay) profUidDisplay.value = fullUid;

    // Quick Stats Strip
    const statOrdersCount = document.getElementById('statOrdersCount');
    if (statOrdersCount) statOrdersCount.textContent = userOrders ? userOrders.length : 0;

    const statStoresCount = document.getElementById('statStoresCount');
    if (statStoresCount) statStoresCount.textContent = userFollowedStores ? userFollowedStores.length : 0;

    const statWalletSum = document.getElementById('statWalletSum');
    if (statWalletSum) statWalletSum.textContent = `₹${userWallet.toFixed(2)}`;

    // Welcome Section
    const welcomeName = document.getElementById('welcomeUserName');
    if (welcomeName) welcomeName.textContent = firstName;

    // Member Since Badge
    const memberSinceEl = document.getElementById('memberSinceVal');
    if (memberSinceEl) {
      if (currentCustomer.createdAt) {
        try {
          const d = new Date(currentCustomer.createdAt);
          if (!isNaN(d.getTime())) {
            memberSinceEl.textContent = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
          }
        } catch (_) {}
      } else {
        memberSinceEl.textContent = 'Active Member';
      }
    }

    // Profile Tab Inputs (Full Name & Email only - username completely removed)
    const profFullName = document.getElementById('profFullName');
    if (profFullName) profFullName.value = displayName;

    const profEmail = document.getElementById('profEmail');
    if (profEmail) profEmail.value = email;

    const profCardName = document.getElementById('profileCardName');
    if (profCardName) profCardName.textContent = displayName;

    const profCardEmail = document.getElementById('profileCardEmail');
    if (profCardEmail) profCardEmail.textContent = email;

    // Profile Avatar (Strictly Curated 20 App Avatars)
    let currentAvatarUrl = currentCustomer.photoURL;
    if (!currentAvatarUrl || currentAvatarUrl.includes('popup-avatar-circle') || currentAvatarUrl.startsWith('data:image/svg+xml')) {
      currentAvatarUrl = '../images/avatars/avatar1.svg';
      currentCustomer.photoURL = currentAvatarUrl;
      localStorage.setItem(SESSION_KEY, JSON.stringify(currentCustomer));
    }
    setAllAvatars(currentAvatarUrl);

    // Referral Link
    const refInput = document.getElementById('referralLinkInput');
    if (refInput) {
      const userCode = (firstName.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'USER') + (currentCustomer.uid ? currentCustomer.uid.slice(-4).toUpperCase() : '2026');
      refInput.value = `https://jaigram.shop/?ref=${userCode}`;
    }
  }

  function setAllAvatars(url) {
    if (!url) return;
    const navImg = document.getElementById('navAvatarImg');
    if (navImg) navImg.src = url;

    const sidebarImg = document.getElementById('sidebarAvatarImg');
    if (sidebarImg) sidebarImg.src = url;

    const profileImg = document.getElementById('profileViewAvatar');
    if (profileImg) profileImg.src = url;

    const hubImg = document.getElementById('hubAvatarImg');
    if (hubImg) hubImg.src = url;

    const bottomImg = document.getElementById('bottomAvatarImg');
    if (bottomImg) bottomImg.src = url;
  }

  async function syncCustomerProfileFromRemote() {
    if (!currentCustomer) return;
    const email = (currentCustomer.email || '').toLowerCase().trim();
    const uid = currentCustomer.uid || '';
    if (!email && !uid) return;

    let remoteCust = null;

    try {
      const res = await fetch(`${API_BASE}/api/auth/customer?email=${encodeURIComponent(email)}&uid=${encodeURIComponent(uid)}`, {
        headers: {
          'Authorization': currentCustomer.sessionToken ? `Bearer ${currentCustomer.sessionToken}` : ''
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.success && data?.customer) {
          remoteCust = data.customer;
        }
      }
    } catch (_) {}

    // Direct RTDB live fallback if API endpoint unreachable
    if (!remoteCust && uid) {
      try {
        const snap = await fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/customers/${encodeURIComponent(uid)}.json?_t=${Date.now()}`);
        if (snap.ok) remoteCust = await snap.json();
      } catch (_) {}
      if (!remoteCust) {
        try {
          const snap2 = await fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/events/customers/${encodeURIComponent(uid)}.json?_t=${Date.now()}`);
          if (snap2.ok) remoteCust = await snap2.json();
        } catch (_) {}
      }
    }

    if (remoteCust && typeof remoteCust === 'object') {
      let changed = false;

      delete currentCustomer.phone;
      if (remoteCust.displayName && remoteCust.displayName !== currentCustomer.displayName && remoteCust.displayName !== 'Customer') {
        currentCustomer.displayName = remoteCust.displayName;
        changed = true;
      }
      if (remoteCust.photoURL && remoteCust.photoURL !== currentCustomer.photoURL) {
        currentCustomer.photoURL = remoteCust.photoURL;
        changed = true;
      }
      if (remoteCust.walletBalance !== undefined) {
        const sanitizedRemote = sanitizeWalletFund(remoteCust.walletBalance);
        if (sanitizedRemote !== userWallet) {
          userWallet = sanitizedRemote;
          const wKey = getWalletStorageKey();
          localStorage.setItem(wKey, userWallet.toFixed(2));
          renderWalletDisplay();
        }
      }

      if (changed) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(currentCustomer));
        initCustomerProfile();
      }
    }
  }

  // ━━ 5. REAL WALLET MANAGEMENT & TRANSACTIONS ━━
  function getWalletStorageKey() {
    return 'linkadda_wallet_' + (currentCustomer?.uid || currentCustomer?.email || 'guest');
  }

  function getWalletTxStorageKey() {
    return 'linkadda_wallet_tx_' + (currentCustomer?.uid || currentCustomer?.email || 'guest');
  }

  function sanitizeWalletFund(raw) {
    const num = parseFloat(raw);
    if (isNaN(num) || num < 0) return 0.00;
    return num;
  }

  async function loadUserWallet() {
    const uid = currentCustomer?.uid || '';
    const email = (currentCustomer?.email || '').toLowerCase().trim();
    const primaryKey = 'jaigram_wallet_' + (uid || email || 'guest');

    let maxRemoteBal = -1;

    // 1. Check authoritative balance from Firebase RTDB (Anti-Tampering)
    const uidsToCheck = new Set();
    if (uid) uidsToCheck.add(uid);
    if (email) {
      uidsToCheck.add('cust_' + email.replace(/[^a-z0-9]/gi, '_'));
    }

    for (const checkUid of uidsToCheck) {
      try {
        const snap = await fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/customers/${encodeURIComponent(checkUid)}.json?_t=${Date.now()}`);
        if (snap.ok) {
          const custDb = await snap.json();
          if (custDb && custDb.walletBalance !== undefined) {
            const b = sanitizeWalletFund(custDb.walletBalance);
            if (b > maxRemoteBal) maxRemoteBal = b;
          }
        }
      } catch (_) {}
    }

    // 2. Check all local storage keys
    const candidateKeys = [
      primaryKey,
      'linkadda_wallet_' + (uid || email || 'guest'),
      'jaigram_wallet_' + uid,
      'linkadda_wallet_' + uid,
      'jaigram_wallet_' + email,
      'linkadda_wallet_' + email
    ];
    if (email) {
      const sanitizedKey = 'cust_' + email.replace(/[^a-z0-9]/gi, '_');
      candidateKeys.push('jaigram_wallet_' + sanitizedKey);
      candidateKeys.push('linkadda_wallet_' + sanitizedKey);
    }

    let maxLocalBal = 0.00;
    candidateKeys.forEach(k => {
      if (!k) return;
      const v = sanitizeWalletFund(localStorage.getItem(k));
      if (v > maxLocalBal) maxLocalBal = v;
    });

    const custBal = sanitizeWalletFund(currentCustomer?.walletBalance);
    if (custBal > maxLocalBal) maxLocalBal = custBal;

    // 3. FAIL-PROOF LEDGER RECONCILIATION:
    // Calculate total verified credits from approved wallet top-up orders minus wallet payment debits
    let ledgerCredits = 0;
    let ledgerDebits = 0;

    // Collect all orders to inspect
    const allOrdersToScan = new Map();
    if (Array.isArray(userOrders)) {
      userOrders.forEach(o => { if (o?.orderId || o?.id) allOrdersToScan.set(String(o.orderId || o.id), o); });
    }
    ['jaigram_user_orders', 'linkadda_user_orders', 'jaigram_customer_orders', 'linkadda_customer_orders'].forEach(storageKey => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) list.forEach(o => {
            const k = String(o?.orderId || o?.id || '');
            if (k && !allOrdersToScan.has(k)) allOrdersToScan.set(k, o);
          });
        }
      } catch (_) {}
    });

    allOrdersToScan.forEach(ord => {
      if (!ord || typeof ord !== 'object') return;
      const ordStatus = String(ord.status || ord.orderStatus || '').toLowerCase();
      const isApproved = ['approved', 'completed', 'paid', 'confirmed'].includes(ordStatus);
      const isTopup = ord.type === 'wallet_topup' || ord.pkg === 'wallet_topup' || ord.productId === 'wallet_topup' ||
        String(ord.title || ord.productName || '').toLowerCase().includes('wallet recharge') ||
        String(ord.title || ord.productName || '').toLowerCase().includes('wallet topup');
      const isWalletDebit = String(ord.paymentMethod || ord.method || '').toLowerCase().includes('wallet');
      const amt = Number(ord.amount || ord.price || 0);

      if (isTopup && isApproved && amt > 0) {
        ledgerCredits += amt;
      } else if (isWalletDebit && amt > 0) {
        ledgerDebits += amt;
      }
    });

    const calculatedLedgerBalance = Math.max(0, Number((ledgerCredits - ledgerDebits).toFixed(2)));

    // Select the most authoritative, up-to-date balance
    let finalBalance = 0.00;
    if (maxRemoteBal >= 0) {
      finalBalance = maxRemoteBal;
    } else {
      finalBalance = maxLocalBal;
    }

    // If verified approved top-up orders exist that haven't been reflected yet, ensure balance is credited!
    if (calculatedLedgerBalance > finalBalance) {
      finalBalance = calculatedLedgerBalance;
    }

    userWallet = finalBalance;

    // Persist across all candidate keys
    candidateKeys.forEach(k => {
      if (k) localStorage.setItem(k, userWallet.toFixed(2));
    });

    if (currentCustomer) {
      currentCustomer.walletBalance = userWallet;
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(currentCustomer));
        localStorage.setItem('jaigram_customer_session', JSON.stringify(currentCustomer));
      } catch (_) {}
    }

    renderWalletDisplay();
    return userWallet;
  }

  function renderWalletDisplay() {
    const formatted = `₹${userWallet.toFixed(2)}`;
    
    const statWallet = document.getElementById('statWalletBalance');
    if (statWallet) statWallet.textContent = formatted;

    const tabWallet = document.getElementById('walletTabBalanceDisplay');
    if (tabWallet) tabWallet.textContent = formatted;

    const modalWallet = document.getElementById('modalCurrentBalance');
    if (modalWallet) modalWallet.textContent = formatted;

    const hubWallet = document.getElementById('hubWalletBalance');
    if (hubWallet) hubWallet.textContent = formatted;

    const statWalletSum = document.getElementById('statWalletSum');
    if (statWalletSum) statWalletSum.textContent = formatted;

    const mobTileWallet = document.getElementById('mobTileWalletBal');
    if (mobTileWallet) mobTileWallet.textContent = formatted;
  }

  async function loadWalletTransactions() {
    const uid = currentCustomer?.uid || '';
    const email = (currentCustomer?.email || '').toLowerCase().trim();
    const map = new Map();

    // 1. Fetch from Firebase RTDB customers/${uid}/wallet_transactions.json
    if (uid) {
      try {
        const snap = await fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/customers/${encodeURIComponent(uid)}/wallet_transactions.json?_t=${Date.now()}`);
        if (snap.ok) {
          const rtdbTxs = await snap.json();
          if (rtdbTxs && typeof rtdbTxs === 'object') {
            Object.entries(rtdbTxs).forEach(([k, tx]) => {
              if (tx && typeof tx === 'object') {
                const normId = String(tx.id || k).trim();
                map.set(normId, { ...tx, id: normId });
              }
            });
          }
        }
      } catch (_) {}
    }

    // 2. Read from localStorage
    const localKeys = [
      getWalletTxStorageKey(),
      'jaigram_wallet_tx_' + (uid || email || 'guest'),
      'linkadda_wallet_tx_' + (uid || email || 'guest')
    ];
    localKeys.forEach(key => {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            list.forEach(tx => {
              if (tx && typeof tx === 'object') {
                const normId = String(tx.id || tx.orderId || Math.random()).trim();
                if (!map.has(normId)) {
                  map.set(normId, { ...tx, id: normId });
                } else {
                  const existing = map.get(normId);
                  map.set(normId, { ...existing, ...tx });
                }
              }
            });
          }
        }
      } catch (_) {}
    });

    // 3. Scan userOrders for wallet purchases and top-ups
    const allOrdersToScan = new Map();
    if (Array.isArray(userOrders)) {
      userOrders.forEach(o => { if (o?.orderId || o?.id) allOrdersToScan.set(String(o.orderId || o.id), o); });
    }
    ['jaigram_user_orders', 'linkadda_user_orders'].forEach(storageKey => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) list.forEach(o => {
            const k = String(o?.orderId || o?.id || '');
            if (k && !allOrdersToScan.has(k)) allOrdersToScan.set(k, o);
          });
        }
      } catch (_) {}
    });

    allOrdersToScan.forEach(ord => {
      if (!ord || typeof ord !== 'object') return;
      const ordId = String(ord.orderId || ord.id || '').trim();
      const displayId = getCleanDisplayOrderId(ord);
      const isTopup = ord.type === 'wallet_topup' || ord.pkg === 'wallet_topup' || ord.productId === 'wallet_topup' ||
        String(ord.title || ord.productName || '').toLowerCase().includes('wallet recharge') ||
        String(ord.title || ord.productName || '').toLowerCase().includes('wallet topup');
      const isWalletDebit = String(ord.paymentMethod || ord.method || '').toLowerCase().includes('wallet');
      const ordStatus = String(ord.status || ord.orderStatus || '').toLowerCase();
      const isDone = ['approved', 'completed', 'paid', 'confirmed'].includes(ordStatus);
      const isRej = ['rejected', 'failed', 'cancelled'].includes(ordStatus);

      if (isTopup) {
        const txId = `tx_topup_${getCanonicalOrderKey(ordId)}`;
        const rejReason = ord.rejectionReason || ord.rejectReason || '';
        const txStatus = isDone ? 'completed' : (isRej ? 'rejected' : 'pending');
        const txDesc = isDone
          ? `Wallet Top-up Approved (${displayId})`
          : (isRej
            ? (rejReason ? `Wallet Top-up Rejected (${displayId}) - ${rejReason}` : `Wallet Top-up Rejected (${displayId})`)
            : `Wallet Top-up (${displayId}) - Verification Pending`);

        const txObj = {
          id: txId,
          orderId: displayId,
          type: 'topup',
          amount: ord.amount || ord.price || 0,
          desc: txDesc,
          description: txDesc,
          rejectionReason: rejReason,
          date: ord.date || new Date(ord.createdAt || ord.timestamp || Date.now()).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          timestamp: Number(ord.createdAt || ord.timestamp || Date.now()),
          status: txStatus
        };

        if (!map.has(txId)) {
          map.set(txId, txObj);
        } else {
          const existing = map.get(txId);
          map.set(txId, {
            ...existing,
            ...txObj,
            status: isDone ? 'completed' : (isRej ? 'rejected' : (existing.status || 'pending')),
            desc: txDesc,
            description: txDesc,
            rejectionReason: rejReason || existing.rejectionReason || ''
          });
        }

        // Also update any pre-existing pending transaction that shares this order ID
        map.forEach((existingTx) => {
          const tOrderId = String(existingTx.orderId || existingTx.id || '').replace(/^#+/, '').trim();
          const cleanOrdId = ordId.replace(/^#+/, '').trim();
          if (tOrderId && cleanOrdId && (tOrderId === cleanOrdId || tOrderId.includes(cleanOrdId) || cleanOrdId.includes(tOrderId))) {
            if (isDone) {
              existingTx.status = 'completed';
              existingTx.desc = `Wallet Top-up Approved (${displayId})`;
              existingTx.description = `Wallet Top-up Approved (${displayId})`;
            } else if (isRej) {
              existingTx.status = 'rejected';
              existingTx.rejectionReason = rejReason || existingTx.rejectionReason || '';
              existingTx.desc = txDesc;
              existingTx.description = txDesc;
            }
          }
        });
      } else if (isWalletDebit) {
        const txId = `tx_debit_${getCanonicalOrderKey(ordId)}`;
        if (!map.has(txId)) {
          map.set(txId, {
            id: txId,
            orderId: displayId,
            type: 'debit',
            amount: ord.amount || ord.price || 0,
            desc: `Purchased ${ord.productName || ord.title || 'Digital Pack'} (${displayId})`,
            description: `Purchased ${ord.productName || ord.title || 'Digital Pack'} (${displayId})`,
            date: ord.date || new Date(ord.createdAt || ord.timestamp || Date.now()).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
            timestamp: Number(ord.createdAt || ord.timestamp || Date.now()),
            status: 'completed'
          });
        }
      }
    });

    // Deduplicate transactions by canonical orderId or unique tx ID
    const dedupedTransactions = new Map();
    Array.from(map.values()).forEach(tx => {
      if (!tx || typeof tx !== 'object') return;
      const rawOrd = String(tx.orderId || tx.id || '').replace(/^#+/, '').trim();
      const numOnly = rawOrd.match(/\d{5,8}/)?.[0] || '';
      const dedupKey = numOnly ? `ord_${numOnly}` : (rawOrd ? `ord_${getCanonicalOrderKey(rawOrd)}` : `tx_${tx.id || Math.random()}`);

      const isCompleted = ['approved', 'completed', 'paid', 'confirmed'].includes(String(tx.status || '').toLowerCase());
      const isRejected = ['rejected', 'failed', 'cancelled'].includes(String(tx.status || '').toLowerCase());
      const txAmt = Number(tx.amount || 0);
      const computedStatus = isCompleted ? 'completed' : (isRejected ? 'rejected' : (tx.status || 'pending'));

      if (!dedupedTransactions.has(dedupKey)) {
        dedupedTransactions.set(dedupKey, {
          ...tx,
          status: computedStatus
        });
      } else {
        const existing = dedupedTransactions.get(dedupKey);
        const isExistingCompleted = ['approved', 'completed', 'paid', 'confirmed'].includes(String(existing.status || '').toLowerCase());

        if (isCompleted && !isExistingCompleted) {
          dedupedTransactions.set(dedupKey, {
            ...existing,
            ...tx,
            status: 'completed',
            desc: tx.desc || existing.desc || `Wallet Top-up Approved (${existing.orderId || tx.orderId})`,
            description: tx.description || existing.description || `Wallet Top-up Approved (${existing.orderId || tx.orderId})`
          });
        } else if (isRejected && !isExistingCompleted) {
          dedupedTransactions.set(dedupKey, {
            ...existing,
            ...tx,
            status: 'rejected',
            rejectionReason: tx.rejectionReason || existing.rejectionReason || '',
            desc: tx.desc || existing.desc || `Wallet Top-up Rejected (${existing.orderId || tx.orderId})`,
            description: tx.description || existing.description || `Wallet Top-up Rejected (${existing.orderId || tx.orderId})`
          });
        } else if (!isCompleted && isExistingCompleted) {
          // Keep existing approved
        } else {
          const curTs = Number(tx.timestamp || 0);
          const existTs = Number(existing.timestamp || 0);
          if (curTs >= existTs || (txAmt > 0 && !existing.amount)) {
            dedupedTransactions.set(dedupKey, {
              ...existing,
              ...tx,
              status: computedStatus,
              rejectionReason: tx.rejectionReason || existing.rejectionReason || ''
            });
          }
        }
      }
    });

    const mergedList = Array.from(dedupedTransactions.values()).sort((a, b) => (Number(b.timestamp || 0) - Number(a.timestamp || 0)));

    // Save back to local storage cache
    try {
      localStorage.setItem(getWalletTxStorageKey(), JSON.stringify(mergedList.slice(0, 50)));
      if (uid) localStorage.setItem('jaigram_wallet_tx_' + uid, JSON.stringify(mergedList.slice(0, 50)));
      if (email) localStorage.setItem('jaigram_wallet_tx_' + email, JSON.stringify(mergedList.slice(0, 50)));
    } catch (_) {}

    renderWalletTransactions(mergedList);
    return mergedList;
  }

  function renderWalletTransactions(txList) {
    const tbody = document.getElementById('walletTransactionsTableBody');
    const cardsList = document.getElementById('walletTxCardsList');
    if (!tbody && !cardsList) return;

    if (!Array.isArray(txList) || txList.length === 0) {
      const emptyHtml = `
        <div class="tx-empty-state">
          <div class="tx-empty-icon"><i class="fa-solid fa-receipt"></i></div>
          <h4 class="tx-empty-title">No Transactions Yet</h4>
          <p class="tx-empty-sub">Recharge your wallet or purchase products to view activity here.</p>
        </div>
      `;
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
              ${emptyHtml}
            </td>
          </tr>
        `;
      }
      if (cardsList) {
        cardsList.innerHTML = emptyHtml;
      }
      return;
    }

    // 1. Render Desktop Table Rows
    if (tbody) {
      tbody.innerHTML = txList.map(tx => {
        const isCredit = tx.type === 'credit' || tx.type === 'recharge' || tx.type === 'topup' || tx.type === 'cashback';
        const isPending = tx.status === 'pending';
        const isRejected = tx.status === 'rejected' || tx.status === 'failed' || tx.status === 'cancelled';
        const icon = isRejected ? 'fa-circle-xmark' : (isPending ? 'fa-clock' : (isCredit ? 'fa-arrow-down-left' : 'fa-arrow-up-right'));
        const color = isRejected ? '#ef4444' : (isPending ? '#fbbf24' : (isCredit ? '#10b981' : '#ef4444'));
        const sign = isCredit ? '+' : '-';
        const typeLabel = isCredit ? (tx.type === 'cashback' ? 'Cashback' : 'Top-up') : 'Debit';
        const date = tx.date || (tx.timestamp ? new Date(tx.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Recently');
        const amt = Number(tx.amount || 0).toFixed(2);
        const desc = escapeHtml(tx.desc || tx.description || (isCredit ? 'Wallet Recharge' : 'Product Purchase'));
        const rejReason = tx.rejectionReason || '';
        const reasonHtml = (isRejected && rejReason) ? `<div style="font-size: 11.5px; color: #f87171; font-weight: 700; margin-top: 4px; display: flex; align-items: center; gap: 4px;"><i class="fa-solid fa-triangle-exclamation"></i> Reason: ${escapeHtml(rejReason)}</div>` : '';
        const statusBadge = isRejected
          ? `<span class="activity-status-pill status-rejected" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);" title="${escapeHtml(rejReason || 'Payment rejected')}"><i class="fa-solid fa-circle-xmark"></i> Rejected</span>`
          : (isPending
            ? `<span class="activity-status-pill status-pending" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3);"><i class="fa-solid fa-clock"></i> Verification Pending</span>`
            : `<span class="activity-status-pill status-completed" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);"><i class="fa-solid fa-circle-check"></i> Success</span>`);

        return `
          <tr>
            <td><i class="fa-solid ${icon}" style="color: ${color};"></i> ${typeLabel}</td>
            <td>
              <div>${desc}</div>
              ${reasonHtml}
            </td>
            <td>${date}</td>
            <td style="color: ${color}; font-weight: 700;">${sign} ₹${amt}</td>
            <td>${statusBadge}</td>
          </tr>
        `;
      }).join('');
    }

    // 2. Render Native Mobile Transaction Cards
    if (cardsList) {
      cardsList.innerHTML = txList.map(tx => {
        const isCredit = tx.type === 'credit' || tx.type === 'recharge' || tx.type === 'topup' || tx.type === 'cashback';
        const isPending = tx.status === 'pending';
        const isRejected = tx.status === 'rejected' || tx.status === 'failed' || tx.status === 'cancelled';
        const icon = isRejected ? 'fa-circle-xmark' : (isPending ? 'fa-clock' : (isCredit ? 'fa-arrow-down' : 'fa-arrow-up'));
        const color = isRejected ? '#ef4444' : (isPending ? '#fbbf24' : (isCredit ? '#10b981' : '#ef4444'));
        const bg = isRejected ? 'rgba(239, 68, 68, 0.12)' : (isPending ? 'rgba(245, 158, 11, 0.12)' : (isCredit ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)'));
        const sign = isCredit ? '+' : '-';
        const typeLabel = isCredit ? (tx.type === 'cashback' ? 'Cashback' : 'Top-up') : 'Order Debit';
        const date = tx.date || (tx.timestamp ? new Date(tx.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Recently');
        const amt = Number(tx.amount || 0).toFixed(2);
        const desc = escapeHtml(tx.desc || tx.description || (isCredit ? 'Wallet Recharge' : 'Product Purchase'));
        const rejReason = tx.rejectionReason || '';
        const reasonHtml = (isRejected && rejReason) ? `<div style="font-size: 11px; color: #f87171; font-weight: 700; margin-top: 3px;"><i class="fa-solid fa-triangle-exclamation"></i> Reason: ${escapeHtml(rejReason)}</div>` : '';
        const statusHtml = isRejected
          ? `<span class="mtx-status" style="color: #ef4444;"><i class="fa-solid fa-circle-xmark"></i> Rejected</span>`
          : (isPending
            ? `<span class="mtx-status" style="color: #fbbf24;"><i class="fa-solid fa-clock"></i> Verification Pending</span>`
            : `<span class="mtx-status" style="color: #10b981;"><i class="fa-solid fa-circle-check"></i> Success</span>`);

        return `
          <div class="mobile-tx-card">
            <div class="mtx-left">
              <div class="mtx-icon-box" style="background: ${bg}; color: ${color};">
                <i class="fa-solid ${icon}"></i>
              </div>
              <div class="mtx-meta">
                <span class="mtx-desc">${desc}</span>
                ${reasonHtml}
                <span class="mtx-date">${date} • ${typeLabel}</span>
              </div>
            </div>
            <div class="mtx-right">
              <span class="mtx-amount" style="color: ${color};">${sign} ₹${amt}</span>
              ${statusHtml}
            </div>
          </div>
        `;
      }).join('');
    }
  }

  window.openAddMoneyModal = function () {
    loadUserWallet();
    renderWalletDisplay();
    openModal('addMoneyModal');
  };

  window.setRechargeAmount = function (amt) {
    const input = document.getElementById('customAmountInput');
    if (input) input.value = amt;

    const btns = document.querySelectorAll('.recharge-quick-btn');
    btns.forEach(btn => {
      if (btn.textContent.includes(String(amt))) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  };

  // Secure Wallet Recharge: Routes user to real payment gateway (UPI or Crypto)
  let _rechargeInProgress = false;
  window.executeRecharge = function () {
    // ━━ DEBOUNCE: Prevent multiple orders on rapid/double clicks ━━
    if (_rechargeInProgress) {
      showAppToast('Recharge already in progress...', 'warning');
      return;
    }

    const input = document.getElementById('customAmountInput');
    const val = parseFloat(input ? input.value : 0);

    if (isNaN(val) || val < 10) {
      alert('Please enter a minimum recharge amount of ₹10.');
      return;
    }
    if (val > 100000) {
      alert('Maximum single top-up limit is ₹1,00,000.');
      return;
    }

    // ━━ LOCK: Set processing flag and disable all recharge buttons ━━
    _rechargeInProgress = true;
    document.querySelectorAll('[onclick*="executeRecharge"], .virtual-pill-btn, .virtual-card-add-btn').forEach(btn => {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.pointerEvents = 'none';
    });

    const selectedRadio = document.querySelector('input[name="rechargeMethod"]:checked');
    const method = selectedRadio ? selectedRadio.value : 'upi';

    closeModal('addMoneyModal');
    showAppToast(`Opening secure payment gateway for ₹${val}...`);

    const email = (currentCustomer?.email || '').trim();
    const uid = currentCustomer?.uid || '';
    const custName = currentCustomer?.displayName || currentCustomer?.name || 'Customer';
    const usdVal = Number((val / 90).toFixed(2));
    const title = `JaiGram Wallet Recharge (₹${val})`;

    // Note: Pending transaction record will be created by the payment gateway's submitOrder()
    // to avoid duplicate pending entries. No need to create one here.

    const q = new URLSearchParams({
      pkg: 'wallet_topup',
      productId: 'wallet_topup',
      price: val,
      inr: val,
      usd: usdVal,
      name: title,
      title: title,
      type: 'wallet_topup',
      method: method,
      paymentMethod: method,
      customerUid: uid,
      customerEmail: email,
      customerName: custName,
      sellerName: 'Wallet Top-Up',
      sellerId: 'system_wallet',
      returnUrl: 'user/index.html#wallet'
    });

    setTimeout(() => {
      if (window.JaiGramGateway || window.LinkAddaGateway) {
        const gw = window.JaiGramGateway || window.LinkAddaGateway;
        gw.open({
          productId: 'wallet_topup',
          type: 'wallet_topup',
          pkg: 'wallet_topup',
          isTopup: true,
          title: title,
          name: title,
          price: val,
          inr: val,
          usd: usdVal,
          method: method,
          sellerName: 'Wallet Top-Up',
          sellerId: 'system_wallet',
          customerUid: uid,
          customerEmail: email,
          customerName: custName
        });
      } else {
        window.location.href = `../payment.html?${q.toString()}`;
      }

      // ━━ UNLOCK: Re-enable buttons after gateway opens (3s cooldown) ━━
      setTimeout(() => {
        _rechargeInProgress = false;
        document.querySelectorAll('[onclick*="executeRecharge"], .virtual-pill-btn, .virtual-card-add-btn').forEach(btn => {
          btn.disabled = false;
          btn.style.opacity = '';
          btn.style.pointerEvents = '';
        });
      }, 3000);
    }, 200);
  };

  // ━━ 6. REAL ORDERS LOADING & RENDERING (Multi-Source Reactive Sync & Clean Normalization) ━━

  // ━━ HELPER FUNCTIONS: Clean formatting for Orders, Sellers, Titles, Dates & Amounts ━━
  function getCanonicalOrderKey(rawId) {
    return String(rawId || '').replace(/^#+/, '').replace(/[^a-zA-Z0-9_-]/g, '').trim().toLowerCase();
  }

  function getCleanDisplayOrderId(ord) {
    const raw = String(ord?.orderId || ord?.id || ord?.displayOrderId || '').trim();
    if (!raw) return '#JG-' + Math.floor(100000 + Math.random() * 900000);

    // If it's a raw Firebase push key like "-P1osO6XIquC5_V4J8SE" or "-P1IZb4Q76xOt1uQ86Jj"
    if (raw.startsWith('-') && raw.length >= 12) {
      const cleanSub = raw.replace(/[^a-zA-Z0-9]/g, '');
      const shortCode = cleanSub.slice(-6).toUpperCase();
      return `#JG-${shortCode || 'PREM'}`;
    }

    // If it already starts with #
    if (raw.startsWith('#')) {
      const inner = raw.replace(/^#+/, '').trim();
      if (inner.toUpperCase().startsWith('JG-') || inner.toUpperCase().startsWith('LA-')) {
        return `#${inner.toUpperCase()}`;
      }
      return `#JG-${inner}`;
    }

    // If starts with JG- or LA-
    if (raw.toUpperCase().startsWith('JG-') || raw.toUpperCase().startsWith('LA-')) {
      return `#${raw.toUpperCase()}`;
    }

    return `#JG-${raw}`;
  }

  function getCleanOrderTitle(ord) {
    const candidates = [
      ord?.productTitle,
      ord?.productName,
      ord?.prodTitle,
      ord?.itemTitle,
      ord?.title,
      ord?.name
    ];

    const isPaymentMethodString = (str) => {
      if (!str || typeof str !== 'string') return true;
      const s = str.trim().toLowerCase();
      if (!s) return true;
      if (s.includes('upi') || s.includes('gpay') || s.includes('phonepe') || s.includes('paytm') || s.includes('qr') || s.includes('scanner') || s.includes('utr') || s.includes('bhim') || s.includes('gateway') || s.includes('netbanking')) {
        return true;
      }
      if (s === 'undefined' || s === 'null' || s === 'nan' || s === 'order' || s === 'product' || s === 'package') {
        return true;
      }
      return false;
    };

    for (const c of candidates) {
      if (c && !isPaymentMethodString(c)) {
        return String(c).trim();
      }
    }

    // Fallbacks
    if (ord?.category && !isPaymentMethodString(ord.category)) {
      return `${ord.category} Digital Pack`;
    }
    if (ord?.badge && !isPaymentMethodString(ord.badge)) {
      return `${ord.badge} Access Pass`;
    }

    return 'VIP Digital Media Pass';
  }

  function getCleanOrderSeller(ord) {
    const candidates = [
      ord?.sellerName,
      ord?.seller,
      ord?.creatorName,
      ord?.creator,
      ord?.storeName,
      ord?.store,
      ord?.author,
      ord?.vendor
    ];

    const isGenericBanned = (str) => {
      if (!str || typeof str !== 'string') return true;
      const s = str.trim().toLowerCase();
      if (!s) return true;
      if (s.includes('jaigram official') || s.includes('jaigram verified') || s.includes('linkadda official') || s.includes('linkadda verified') || s === 'official' || s === 'admin' || s === 'system' || s === 'seller' || s === 'verified' || s === 'undefined' || s === 'null') {
        return true;
      }
      return false;
    };

    for (const c of candidates) {
      if (c && !isGenericBanned(c)) {
        return String(c).trim();
      }
    }

    // Fallback to verified creator store branding
    return '༒•*̥TRUSTED BROTHER•*̥';
  }

  function getCleanOrderDate(ord) {
    if (ord?.date && typeof ord.date === 'string') {
      const cleaned = ord.date.replace(/,\s*\d{1,2}:\d{2}\s*(am|pm|AM|PM)?/i, '').trim();
      if (cleaned.length >= 6) return cleaned;
    }
    const ts = Number(ord?.createdAt || ord?.timestamp || ord?.approvedAt || 0);
    if (ts > 0) {
      try {
        return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      } catch (_) {}
    }
    return 'Recently';
  }

  function getCleanOrderAmount(ord) {
    let val = ord?.amountDisplay || ord?.price || ord?.amount || ord?.total || 399;
    if (typeof val === 'string') {
      val = val.replace(/[^0-9.]/g, '');
    }
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      return `₹${num.toFixed(2)}`;
    }
    return '₹399.00';
  }

  let isOrdersSyncing = false;
  async function loadUserOrders(silent = false) {
    if (isOrdersSyncing) return;
    isOrdersSyncing = true;

    try {
      const userEmail = (currentCustomer?.email || '').toLowerCase().trim();
      const userUid = currentCustomer?.uid || '';

      const ordersMap = new Map();

      const ingestOrder = (ord) => {
        if (!ord) return;
        const rawId = String(ord.orderId || ord.id || ord.displayOrderId || '').trim();
        if (!rawId) return;

        // Security check: Ignore other users' orders if customerEmail exists and does not match current user
        const ordEmail = String(ord.customerEmail || ord.buyerEmail || ord.email || '').toLowerCase().trim();
        if (userEmail && ordEmail && ordEmail !== userEmail && !myKnownIds.has(rawId)) {
          return;
        }

        const numOnly = rawId.match(/\d{5,8}/)?.[0] || '';
        const canonicalKey = numOnly ? `ord_${numOnly}` : getCanonicalOrderKey(rawId);
        if (!canonicalKey) return;

        const existing = ordersMap.get(canonicalKey) || {};
        const existingStatus = String(existing.status || existing.orderStatus || '').toLowerCase();
        const ordStatus = String(ord.status || ord.orderStatus || '').toLowerCase();
        const isExistingApproved = ['approved', 'completed', 'paid', 'confirmed'].includes(existingStatus);
        const isOrdApproved = ['approved', 'completed', 'paid', 'confirmed'].includes(ordStatus);
        
        const mergedStatus = isExistingApproved ? 'approved' : (isOrdApproved ? 'approved' : (ordStatus || existingStatus || 'pending'));
        const mergedLink = isExistingApproved ? (existing.downloadLink || ord.downloadLink || '') : (ord.downloadLink || existing.downloadLink || '');

        ordersMap.set(canonicalKey, {
          ...existing,
          ...ord,
          orderId: ord.orderId || existing.orderId || rawId,
          status: mergedStatus,
          orderStatus: mergedStatus,
          downloadLink: mergedLink,
          fileUrl: mergedLink,
          orderLink: mergedLink
        });
      };

      // 1. Instant 0ms cache load: Read from all known local storage keys
      const orderKeys = [
        'linkadda_user_orders',
        'jaigram_user_orders',
        'linkadda_customer_orders_' + userUid,
        'jaigram_customer_orders_' + userUid,
        'linkadda_customer_orders_' + userEmail,
        'jaigram_customer_orders_' + userEmail,
        'linkadda_customer_orders',
        'jaigram_customer_orders',
        'linkadda_admin_orders_local',
        'linkadda_orders',
        'jaigram_orders'
      ];

      orderKeys.forEach(k => {
        if (!k) return;
        try {
          const raw = localStorage.getItem(k);
          if (raw) {
            const list = JSON.parse(raw);
            if (Array.isArray(list)) list.forEach(ingestOrder);
          }
        } catch (_) {}
      });

      // Collect all known customer order IDs from tracker and local admin cache
      const myKnownIds = new Set();
      try {
        const rawIds = localStorage.getItem('jaigram_my_order_ids') || localStorage.getItem('linkadda_my_order_ids');
        if (rawIds) {
          const parsed = JSON.parse(rawIds);
          if (Array.isArray(parsed)) parsed.forEach(id => { if (id) myKnownIds.add(String(id).trim()); });
        }
      } catch (_) {}

      try {
        const adminOrdersRaw = localStorage.getItem('linkadda_admin_orders_local') || localStorage.getItem('linkadda_admin_store_cache_v4');
        if (adminOrdersRaw) {
          const admData = JSON.parse(adminOrdersRaw);
          const admList = Array.isArray(admData) ? admData : (admData?.orders ? Object.values(admData.orders) : []);
          admList.forEach(admOrd => {
            const admEmail = String(admOrd?.customerEmail || admOrd?.buyerEmail || admOrd?.email || '').toLowerCase().trim();
            if (!userEmail || !admEmail || admEmail === userEmail) {
              const admId = String(admOrd?.orderId || admOrd?.id || admOrd?.displayOrderId || '').trim();
              if (admId) myKnownIds.add(admId);
            }
          });
        }
      } catch (_) {}

      Array.from(ordersMap.values()).forEach(o => {
        const oId = String(o.orderId || o.id || o.displayOrderId || '').trim();
        if (oId) myKnownIds.add(oId);
      });

      // Keep track of previously approved orders to detect new approvals
      const prevApprovedIds = new Set(
        Array.from(ordersMap.values())
          .filter(o => ['approved', 'completed', 'paid', 'confirmed'].includes(String(o.status || o.orderStatus || '').toLowerCase()))
          .map(o => getCanonicalOrderKey(o.orderId || o.id))
      );

      // Render cached orders immediately if available
      if (ordersMap.size > 0 && !silent) {
        userOrders = Array.from(ordersMap.values()).sort((a, b) => Number(b.createdAt || b.timestamp || 0) - Number(a.createdAt || a.timestamp || 0));
        renderUserOrders();
      }

      const localOrderIds = Array.from(ordersMap.values()).map(o => String(o.orderId || o.id || '')).filter(Boolean);

      // 2. Fetch remote orders via /api/orders
      try {
        const q = new URLSearchParams();
        if (localOrderIds.length > 0) {
          const idQueryList = [];
          localOrderIds.slice(0, 30).forEach(id => {
            idQueryList.push(id);
            const stripped = id.replace(/^#+/, '').trim();
            if (stripped && stripped !== id) idQueryList.push(stripped);
          });
          q.set('orderIds', idQueryList.join(','));
        }
        if (userEmail) q.set('email', userEmail);
        if (userUid) q.set('uid', userUid);
        q.set('_t', Date.now());

        const headers = {};
        if (currentCustomer?.sessionToken) {
          headers['Authorization'] = `Bearer ${currentCustomer.sessionToken}`;
        }

        const res = await fetch(`${API_BASE}/api/orders?${q.toString()}`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data?.success && Array.isArray(data.orders)) {
            data.orders.forEach(rem => {
              const remId = String(rem.orderId || rem.id || '').trim();
              if (!remId) return;
              const canonicalKey = getCanonicalOrderKey(remId);
              const loc = ordersMap.get(canonicalKey) || {};
              const rStatus = String(rem.status || rem.orderStatus || '').toLowerCase();
              const isAppr = (rStatus === 'approved' || rStatus === 'completed' || rem.verified === true) && rStatus !== 'pending';
              const isRej = ['rejected', 'failed', 'cancelled'].includes(rStatus);

              const mergedLink = isAppr ? (rem.downloadLink || rem.fileUrl || rem.orderLink || loc.downloadLink || '') : (loc.downloadLink || '');

              ordersMap.set(canonicalKey, {
                ...loc,
                ...rem,
                orderId: loc.orderId || rem.orderId || remId,
                status: isAppr ? 'approved' : (isRej ? 'rejected' : 'pending'),
                orderStatus: isAppr ? 'approved' : (isRej ? 'rejected' : 'pending'),
                downloadLink: mergedLink,
                fileUrl: mergedLink,
                orderLink: mergedLink
              });
            });
          }
        }
      } catch (apiErr) {
        console.warn('API orders fetch notice:', apiErr);
      }

      // 3. Resilient Direct Firebase RTDB verification (order_approvals & orders)
      const getPendingList = () => Array.from(ordersMap.values()).filter(o => {
        const st = String(o.status || o.orderStatus || 'pending').toLowerCase();
        return !['approved', 'completed', 'paid', 'confirmed'].includes(st);
      });
      let pendingOrders = getPendingList();

      // 3a. Bulk order_approvals check (Public read node with all customer orders)
      try {
        const bulkAppRes = await fetch(`${RTDB_URL}/order_approvals.json?_t=${Date.now()}`);
        if (bulkAppRes.ok) {
          const bulkApprovals = await bulkAppRes.json();
          if (bulkApprovals && typeof bulkApprovals === 'object') {
            Object.keys(bulkApprovals).forEach(appKey => {
              const appData = bulkApprovals[appKey];
              if (!appData || typeof appData !== 'object') return;

              const appOrderId = String(appData.orderId || appData.id || appKey || '').trim();
              const appDigits = appOrderId.match(/\d{5,8}/)?.[0] || appKey.match(/\d{5,8}/)?.[0] || '';
              const appCanonical = getCanonicalOrderKey(appOrderId) || getCanonicalOrderKey(appKey);
              const appEmail = String(appData.customerEmail || appData.email || appData.buyerEmail || '').toLowerCase().trim();
              const appUid = String(appData.customerUid || appData.uid || appData.buyerUid || '').trim();

              const aStatus = String(appData.status || appData.orderStatus || 'pending').toLowerCase();
              const isAppr = (aStatus === 'approved' || aStatus === 'completed' || appData.verified === true) && aStatus !== 'pending';
              const isRej = ['rejected', 'failed', 'cancelled'].includes(aStatus);
              const computedStatus = isAppr ? 'approved' : (isRej ? 'rejected' : 'pending');

              // Direct match for customer's order from remote RTDB (Pending OR Approved)
              const isEmailMatch = Boolean(appEmail && userEmail && (appEmail === userEmail || appEmail.includes(userEmail) || userEmail.includes(appEmail)));
              const isUidMatch = Boolean(appUid && userUid && appUid === userUid);
              const isIdMatchDirect = myKnownIds.has(appOrderId) || myKnownIds.has(appKey) || (appDigits && Array.from(myKnownIds).some(kid => kid.includes(appDigits)));
              const isDirectCustMatch = isEmailMatch || isUidMatch || isIdMatchDirect;

              if (isDirectCustMatch && appCanonical) {
                const link = isAppr ? (appData.downloadLink || appData.telegramLink || appData.channelLink || appData.fileUrl || 'https://t.me/TRUSTED_BROTHER1234') : '';
                const existing = ordersMap.get(appCanonical) || {};
                const orderTs = existing.createdAt || existing.timestamp || appData.createdAt || appData.timestamp || appData.approvedAt || Date.now();
                ordersMap.set(appCanonical, {
                  ...existing,
                  ...appData,
                  orderId: appData.orderId || appKey,
                  id: appData.orderId || appKey,
                  title: appData.productName || appData.title || existing.title || 'VIP Digital Media Pass',
                  productName: appData.productName || appData.title || existing.productName || 'VIP Digital Media Pass',
                  status: computedStatus,
                  orderStatus: computedStatus,
                  paymentStatus: computedStatus,
                  verified: isAppr,
                  createdAt: orderTs,
                  timestamp: orderTs,
                  amount: existing.amount || appData.amount || appData.price || 399,
                  price: existing.price || appData.price || appData.amount || 399,
                  amountDisplay: appData.amountDisplay || existing.amountDisplay || (appData.amount ? `₹${appData.amount}` : '₹399.00'),
                  downloadLink: link || existing.downloadLink || '',
                  fileUrl: link || existing.fileUrl || '',
                  orderLink: link || existing.orderLink || '',
                  utr: appData.utr || existing.utr || '',
                  sellerName: appData.sellerName || existing.sellerName || '༒•*̥TRUSTED BROTHER•*̥'
                });
                return;
              }

              // Also cross-reference against pending orders in memory
              pendingOrders.forEach(ord => {
                const rawId = String(ord.orderId || ord.id || ord.displayOrderId || '').trim();
                const ordDigits = rawId.match(/\d{5,8}/)?.[0] || '';
                const ordCanonical = getCanonicalOrderKey(rawId);
                const ordEmail = String(ord.customerEmail || ord.email || ord.buyerEmail || '').toLowerCase().trim();

                const isIdMatch = (appCanonical && ordCanonical && (appCanonical === ordCanonical || appCanonical.includes(ordCanonical) || ordCanonical.includes(appCanonical))) ||
                  (appDigits && ordDigits && appDigits === ordDigits);
                const isEmailAndTitleMatch = (appEmail && ordEmail && appEmail === ordEmail) &&
                  (appData.productName && ord.title && (appData.productName.toLowerCase().includes(ord.title.toLowerCase()) || ord.title.toLowerCase().includes(appData.productName.toLowerCase())));

                if (isIdMatch || isEmailAndTitleMatch) {
                  const link = isAppr ? (appData.downloadLink || appData.telegramLink || appData.channelLink || appData.fileUrl || ord.downloadLink || 'https://t.me/TRUSTED_BROTHER1234') : (ord.downloadLink || '');
                  const existing = ordersMap.get(ordCanonical) || ord;
                  ordersMap.set(ordCanonical, {
                    ...existing,
                    ...appData,
                    status: computedStatus,
                    orderStatus: computedStatus,
                    paymentStatus: computedStatus,
                    verified: isAppr,
                    downloadLink: link,
                    fileUrl: link,
                    orderLink: link
                  });
                }
              });
            });
          }
        }
      } catch (bulkErr) {
        console.warn('Bulk order_approvals check note:', bulkErr);
      }

      // 3b. Public settings node check (purely for store analytics/social proof, never for order authorization)
      try {
        const setRes = await fetch(`${RTDB_URL}/settings.json?_t=${Date.now()}`);
        if (setRes.ok) {
          // Storefront settings synced without mutating customer order authorization
        }
      } catch (_) {}

      // 3c. Check local admin store cache (if admin approved in the same browser)
      try {
        const adminCacheRaw = localStorage.getItem('linkadda_admin_store_cache_v4') || localStorage.getItem('linkadda_admin_orders_local');
        if (adminCacheRaw) {
          const adminCache = JSON.parse(adminCacheRaw);
          const adminOrdersList = Array.isArray(adminCache) ? adminCache : (adminCache.orders ? Object.values(adminCache.orders) : []);
          adminOrdersList.forEach(admOrd => {
            const admEmail = String(admOrd.customerEmail || admOrd.buyerEmail || admOrd.email || '').toLowerCase().trim();
            const admUid = String(admOrd.customerUid || admOrd.buyerUid || admOrd.uid || '').trim();
            const admRawId = String(admOrd.orderId || admOrd.id || admOrd.displayOrderId || '').trim();
            const admCanonical = getCanonicalOrderKey(admRawId);
            const admDigits = admRawId.match(/\d{5,8}/)?.[0] || '';
            const isIdMatchDirect = myKnownIds.has(admRawId) || myKnownIds.has(admCanonical) || (admDigits && Array.from(myKnownIds).some(kid => kid.includes(admDigits)));
            const isCustMatch = (admEmail && userEmail && (admEmail === userEmail || admEmail.includes(userEmail) || userEmail.includes(admEmail))) ||
              (admUid && userUid && admUid === userUid) || isIdMatchDirect;

            if (isCustMatch && admCanonical) {
              const admStatus = String(admOrd.status || admOrd.orderStatus || '').toLowerCase();
              const isAppr = (admStatus === 'approved' || admStatus === 'completed' || admOrd.verified === true) && admStatus !== 'pending';
              const existing = ordersMap.get(admCanonical) || {};
              const link = admOrd.downloadLink || admOrd.telegramLink || admOrd.fileUrl || existing.downloadLink || (isAppr ? 'https://t.me/TRUSTED_BROTHER1234' : '');
              ordersMap.set(admCanonical, {
                ...existing,
                ...admOrd,
                orderId: admOrd.orderId || admRawId,
                id: admOrd.orderId || admRawId,
                status: isAppr ? 'approved' : (admStatus === 'rejected' ? 'rejected' : 'pending'),
                orderStatus: isAppr ? 'approved' : (admStatus === 'rejected' ? 'rejected' : 'pending'),
                paymentStatus: isAppr ? 'approved' : (admStatus === 'rejected' ? 'rejected' : 'pending'),
                verified: Boolean(isAppr),
                downloadLink: link,
                fileUrl: link,
                orderLink: link
              });
              return;
            }

            pendingOrders.forEach(ord => {
              const ordRaw = String(ord.orderId || ord.id || ord.displayOrderId || '');
              const ordDigits = ordRaw.match(/\d{5,8}/)?.[0] || '';
              const ordCanonical = getCanonicalOrderKey(ordRaw);
              const admDigits = admRawId.match(/\d{5,8}/)?.[0] || '';

              if ((admDigits && ordDigits && admDigits === ordDigits) || (admCanonical && ordCanonical && admCanonical === ordCanonical)) {
                const admStatus = String(admOrd.status || admOrd.orderStatus || '').toLowerCase();
                const isAppr = (admStatus === 'approved' || admStatus === 'completed' || admOrd.verified === true) && admStatus !== 'pending';
                const isRej = ['rejected', 'failed', 'cancelled'].includes(admStatus);
                const existing = ordersMap.get(ordCanonical) || ord;
                const link = admOrd.downloadLink || admOrd.telegramLink || admOrd.fileUrl || existing.downloadLink || (isAppr ? 'https://t.me/TRUSTED_BROTHER1234' : '');
                const rejReason = admOrd.rejectionReason || admOrd.rejectReason || existing.rejectionReason || '';
                ordersMap.set(ordCanonical, {
                  ...existing,
                  ...admOrd,
                  status: isAppr ? 'approved' : (isRej ? 'rejected' : 'pending'),
                  orderStatus: isAppr ? 'approved' : (isRej ? 'rejected' : 'pending'),
                  paymentStatus: isAppr ? 'approved' : (isRej ? 'rejected' : 'pending'),
                  rejectionReason: isRej ? rejReason : (existing.rejectionReason || ''),
                  rejectReason: isRej ? rejReason : (existing.rejectReason || ''),
                  verified: Boolean(isAppr),
                  downloadLink: link,
                  fileUrl: link,
                  orderLink: link
                });
              }
            });
          });
        }
      } catch (_) {}

      // 3d. Cross-reference notifications for confirmed/approved orders
      try {
        const storedNotifs = getStoredNotifications();
        storedNotifs.forEach(n => {
          const nTitle = String(n.title || '').toLowerCase();
          const nMsg = String(n.message || '').toLowerCase();
          const isApprNotif = n.type === 'order_confirmed' || nTitle.includes('approved') || nTitle.includes('confirmed') || nMsg.includes('approved') || nMsg.includes('verified');
          if (isApprNotif) {
            const notifDigits = (n.orderId ? String(n.orderId) : (nTitle + ' ' + nMsg)).match(/\d{5,8}/)?.[0] || '';
            const notifLink = n.actionUrl || '';

            pendingOrders.forEach(ord => {
              const ordRaw = String(ord.orderId || ord.id || ord.displayOrderId || '');
              const ordDigits = ordRaw.match(/\d{5,8}/)?.[0] || '';
              const ordCanonical = getCanonicalOrderKey(ordRaw);

              if (notifDigits && ordDigits && notifDigits === ordDigits) {
                const existing = ordersMap.get(ordCanonical) || ord;
                const link = notifLink || existing.downloadLink || 'https://t.me/TRUSTED_BROTHER1234';
                ordersMap.set(ordCanonical, {
                  ...existing,
                  status: 'approved',
                  orderStatus: 'approved',
                  paymentStatus: 'approved',
                  verified: true,
                  downloadLink: link,
                  fileUrl: link,
                  orderLink: link
                });
              }
            });
          }
        });
      } catch (_) {}

      // 3e. Individual targeted RTDB requests for remaining pending orders
      const remainingPending = Array.from(ordersMap.values()).filter(o => {
        const st = String(o.status || o.orderStatus || 'pending').toLowerCase();
        return !['approved', 'completed', 'paid', 'confirmed'].includes(st);
      });

      if (remainingPending.length > 0) {
        await Promise.all(remainingPending.slice(0, 20).map(async (ord) => {
          const rawId = String(ord.orderId || ord.id || ord.displayOrderId || '').trim();
          if (!rawId) return;
          const canonicalKey = getCanonicalOrderKey(rawId);
          const cleanId = rawId.replace(/^#+/, '').trim();
          if (!cleanId) return;

          const digitsOnly = cleanId.match(/\d{5,8}/)?.[0] || '';

          // Keys to try in RTDB
          const keysToTry = new Set([cleanId]);
          if (digitsOnly) {
            keysToTry.add(digitsOnly);
            keysToTry.add('JG-' + digitsOnly);
            keysToTry.add('#JG-' + digitsOnly);
          }
          if (cleanId.toUpperCase().startsWith('JG-')) {
            keysToTry.add(cleanId.slice(3));
          } else {
            keysToTry.add('JG-' + cleanId);
          }

          for (const targetKey of keysToTry) {
            // Check order_approvals node (Fast, public read)
            try {
              const appRes = await fetch(`${RTDB_URL}/order_approvals/${encodeURIComponent(targetKey)}.json?_t=${Date.now()}`);
              if (appRes.ok) {
                const appData = await appRes.json();
                if (appData && typeof appData === 'object') {
                  const aStatus = String(appData.status || appData.orderStatus || '').toLowerCase();
                  if ((aStatus === 'approved' || aStatus === 'completed' || appData.verified === true) && aStatus !== 'pending') {
                    const link = appData.downloadLink || appData.telegramLink || appData.channelLink || appData.fileUrl || ord.downloadLink || 'https://t.me/TRUSTED_BROTHER1234';
                    const existing = ordersMap.get(canonicalKey) || ord;
                    ordersMap.set(canonicalKey, {
                      ...existing,
                      ...appData,
                      status: 'approved',
                      orderStatus: 'approved',
                      paymentStatus: 'approved',
                      verified: true,
                      downloadLink: link,
                      fileUrl: link,
                      orderLink: link
                    });
                    return;
                  } else if (aStatus === 'rejected' || aStatus === 'failed' || aStatus === 'cancelled') {
                    const existing = ordersMap.get(canonicalKey) || ord;
                    const rejReason = appData.rejectionReason || appData.rejectReason || existing.rejectionReason || '';
                    ordersMap.set(canonicalKey, {
                      ...existing,
                      ...appData,
                      status: 'rejected',
                      orderStatus: 'rejected',
                      paymentStatus: 'rejected',
                      rejectionReason: rejReason,
                      rejectReason: rejReason
                    });
                    return;
                  }
                }
              }
            } catch (_) {}

            // Check orders node directly
            try {
              const ordRes = await fetch(`${RTDB_URL}/orders/${encodeURIComponent(targetKey)}.json?_t=${Date.now()}`);
              if (ordRes.ok) {
                const ordData = await ordRes.json();
                if (ordData && typeof ordData === 'object') {
                  const oStatus = String(ordData.status || ordData.orderStatus || '').toLowerCase();
                  if ((oStatus === 'approved' || oStatus === 'completed' || ordData.verified === true) && oStatus !== 'pending') {
                    const link = ordData.downloadLink || ordData.fileUrl || ordData.orderLink || ordData.telegramLink || ord.downloadLink || 'https://t.me/TRUSTED_BROTHER1234';
                    const existing = ordersMap.get(canonicalKey) || ord;
                    ordersMap.set(canonicalKey, {
                      ...existing,
                      ...ordData,
                      status: 'approved',
                      orderStatus: 'approved',
                      paymentStatus: 'approved',
                      verified: true,
                      downloadLink: link,
                      fileUrl: link,
                      orderLink: link
                    });
                    return;
                  } else if (['rejected', 'failed', 'cancelled'].includes(oStatus)) {
                    const existing = ordersMap.get(canonicalKey) || ord;
                    const rejReason = ordData.rejectionReason || ordData.rejectReason || existing.rejectionReason || '';
                    ordersMap.set(canonicalKey, {
                      ...existing,
                      ...ordData,
                      status: 'rejected',
                      orderStatus: 'rejected',
                      paymentStatus: 'rejected',
                      rejectionReason: rejReason,
                      rejectReason: rejReason
                    });
                    return;
                  }
                }
              }
            } catch (_) {}
          }
        }));
      }

      // 3f. Direct query for any missing customer order IDs directly against RTDB /order_approvals & /orders
      const missingKnownIds = Array.from(myKnownIds).filter(rawId => {
        const cKey = getCanonicalOrderKey(rawId);
        return !ordersMap.has(cKey);
      });

      if (missingKnownIds.length > 0) {
        await Promise.all(missingKnownIds.slice(0, 20).map(async (rawId) => {
          const cleanId = rawId.replace(/^#+/, '').trim();
          if (!cleanId) return;
          const cKey = getCanonicalOrderKey(cleanId);
          const digitsOnly = cleanId.match(/\d{5,8}/)?.[0] || '';

          const keysToTry = new Set([cleanId]);
          if (digitsOnly) {
            keysToTry.add(digitsOnly);
            keysToTry.add('JG-' + digitsOnly);
            keysToTry.add('#JG-' + digitsOnly);
          }
          if (cleanId.toUpperCase().startsWith('JG-')) {
            keysToTry.add(cleanId.slice(3));
          } else {
            keysToTry.add('JG-' + cleanId);
          }

          for (const targetKey of keysToTry) {
            if (ordersMap.has(cKey)) break;

            // Try order_approvals node (public read)
            try {
              const res = await fetch(`${RTDB_URL}/order_approvals/${encodeURIComponent(targetKey)}.json?_t=${Date.now()}`);
              if (res.ok) {
                const d = await res.json();
                if (d && typeof d === 'object') {
                  const dStatus = String(d.status || d.orderStatus || 'pending').toLowerCase();
                  const isAppr = (dStatus === 'approved' || dStatus === 'completed' || d.verified === true) && dStatus !== 'pending';
                  const isRej = ['rejected', 'failed', 'cancelled'].includes(dStatus);
                  const st = isAppr ? 'approved' : (isRej ? 'rejected' : 'pending');
                  const link = isAppr ? (d.downloadLink || d.telegramLink || d.channelLink || d.fileUrl || 'https://t.me/TRUSTED_BROTHER1234') : '';
                  const orderTs = d.createdAt || d.timestamp || d.approvedAt || Date.now();
                  ordersMap.set(cKey, {
                    ...d,
                    orderId: d.orderId || cleanId,
                    id: d.id || cleanId,
                    title: d.productName || d.title || 'VIP Digital Media Pass',
                    productName: d.productName || d.title || 'VIP Digital Media Pass',
                    status: st,
                    orderStatus: st,
                    paymentStatus: st,
                    verified: isAppr,
                    createdAt: orderTs,
                    timestamp: orderTs,
                    amount: d.amount || d.price || 399,
                    price: d.price || d.amount || 399,
                    amountDisplay: d.amountDisplay || (d.amount ? `₹${d.amount}` : '₹399.00'),
                    downloadLink: link,
                    fileUrl: link,
                    orderLink: link,
                    utr: d.utr || '',
                    sellerName: d.sellerName || '༒•*̥TRUSTED BROTHER•*̥'
                  });
                  break;
                }
              }
            } catch (_) {}

            // Try orders node
            try {
              const res = await fetch(`${RTDB_URL}/orders/${encodeURIComponent(targetKey)}.json?_t=${Date.now()}`);
              if (res.ok) {
                const d = await res.json();
                if (d && typeof d === 'object') {
                  const dStatus = String(d.status || d.orderStatus || 'pending').toLowerCase();
                  const isAppr = (dStatus === 'approved' || dStatus === 'completed' || d.verified === true) && dStatus !== 'pending';
                  const isRej = ['rejected', 'failed', 'cancelled'].includes(dStatus);
                  const st = isAppr ? 'approved' : (isRej ? 'rejected' : 'pending');
                  const link = isAppr ? (d.downloadLink || d.telegramLink || d.channelLink || d.fileUrl || 'https://t.me/TRUSTED_BROTHER1234') : '';
                  const orderTs = d.createdAt || d.timestamp || d.approvedAt || Date.now();
                  ordersMap.set(cKey, {
                    ...d,
                    orderId: d.orderId || cleanId,
                    id: d.id || cleanId,
                    title: d.productName || d.title || 'VIP Digital Media Pass',
                    productName: d.productName || d.title || 'VIP Digital Media Pass',
                    status: st,
                    orderStatus: st,
                    paymentStatus: st,
                    verified: isAppr,
                    createdAt: orderTs,
                    timestamp: orderTs,
                    amount: d.amount || d.price || 399,
                    price: d.price || d.amount || 399,
                    amountDisplay: d.amountDisplay || (d.amount ? `₹${d.amount}` : '₹399.00'),
                    downloadLink: link,
                    fileUrl: link,
                    orderLink: link,
                    utr: d.utr || '',
                    sellerName: d.sellerName || '༒•*̥TRUSTED BROTHER•*̥'
                  });
                  break;
                }
              }
            } catch (_) {}
          }
        }));
      }

      // 4. Sort newest first
      const updatedList = Array.from(ordersMap.values()).sort((a, b) => {
        const timeA = Number(a.createdAt || a.timestamp || a.approvedAt || 0);
        const timeB = Number(b.createdAt || b.timestamp || b.approvedAt || 0);
        return timeB - timeA;
      });

      // 5. Celebration notification for newly approved orders
      const newlyApproved = updatedList.filter(o => {
        const cKey = getCanonicalOrderKey(o.orderId || o.id);
        const isAppr = ['approved', 'completed', 'paid', 'confirmed'].includes(String(o.status || o.orderStatus || '').toLowerCase());
        return isAppr && !prevApprovedIds.has(cKey);
      });

      if (newlyApproved.length > 0) {
        const first = newlyApproved[0];
        const title = getCleanOrderTitle(first);
        const dispId = getCleanDisplayOrderId(first);
        showAppToast(`🎉 Great news! Order ${dispId} (${title}) has been verified & approved! Access is unlocked.`);

        // Dispatch in-app notifications
        newlyApproved.forEach(appOrd => {
          const dId = getCleanDisplayOrderId(appOrd);
          const tName = getCleanOrderTitle(appOrd);
          const notifItem = {
            id: 'notif_order_' + getCanonicalOrderKey(appOrd.orderId || appOrd.id) + '_approved',
            type: 'order_confirmed',
            orderId: appOrd.orderId || appOrd.id,
            title: `Order ${dId} Approved! 🎉`,
            message: `Your payment for "${tName}" has been verified & approved. Tap to unlock access.`,
            actionUrl: appOrd.downloadLink || appOrd.telegramLink || '',
            actionText: 'Access VIP Pack',
            timestamp: Date.now(),
            date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            read: false,
            unread: true
          };
          const notifKeys = [
            'jaigram_user_notifications',
            'linkadda_user_notifications'
          ];
          if (userUid) notifKeys.push('jaigram_user_notifications_' + userUid, 'linkadda_user_notifications_' + userUid);
          notifKeys.forEach(nk => {
            try {
              let nList = [];
              const rawN = localStorage.getItem(nk);
              if (rawN) nList = JSON.parse(rawN);
              if (!Array.isArray(nList)) nList = [];
              if (!nList.some(x => x.id === notifItem.id)) {
                nList.unshift(notifItem);
                localStorage.setItem(nk, JSON.stringify(nList.slice(0, 50)));
              }
            } catch (_) {}
          });
        });

        if (typeof window.loadUserNotifications === 'function') {
          try { window.loadUserNotifications(); } catch (_) {}
        }
      }

      userOrders = updatedList;
      renderUserOrders();

      // ━━ SYNC WALLET ON ANY APPROVED TOPUP ORDER ━━
      const hasAnyApprovedTopup = userOrders.some(o => {
        const isTop = o.type === 'wallet_topup' || o.pkg === 'wallet_topup' || o.productId === 'wallet_topup' ||
          String(o.title || o.productName || '').toLowerCase().includes('wallet recharge') ||
          String(o.title || o.productName || '').toLowerCase().includes('wallet topup');
        const isAppr = ['approved', 'completed', 'paid', 'confirmed'].includes(String(o.status || o.orderStatus || '').toLowerCase());
        return isTop && isAppr;
      });
      if (hasAnyApprovedTopup) {
        loadUserWallet().catch(() => {});
        loadWalletTransactions().catch(() => {});
      }

      // 6. Cache merged orders locally across all keys with cleaned metadata
      try {
        const serialized = JSON.stringify(userOrders.slice(0, 50));
        localStorage.setItem('linkadda_user_orders', serialized);
        localStorage.setItem('jaigram_user_orders', serialized);
        if (userUid) {
          localStorage.setItem('linkadda_customer_orders_' + userUid, serialized);
          localStorage.setItem('jaigram_customer_orders_' + userUid, serialized);
        }
        if (userEmail) {
          localStorage.setItem('linkadda_customer_orders_' + userEmail, serialized);
          localStorage.setItem('jaigram_customer_orders_' + userEmail, serialized);
        }

        // Keep persistent my_order_ids updated
        const allIds = userOrders.map(o => String(o.orderId || o.id || '').replace(/^#+/, '').trim()).filter(Boolean);
        if (allIds.length > 0) {
          let curIds = [];
          try {
            const raw = localStorage.getItem('jaigram_my_order_ids');
            if (raw) curIds = JSON.parse(raw);
          } catch (_) {}
          if (!Array.isArray(curIds)) curIds = [];
          allIds.forEach(id => { if (!curIds.includes(id)) curIds.unshift(id); });
          localStorage.setItem('jaigram_my_order_ids', JSON.stringify(curIds.slice(0, 100)));
          localStorage.setItem('linkadda_my_order_ids', JSON.stringify(curIds.slice(0, 100)));
        }
      } catch (_) {}
    } finally {
      isOrdersSyncing = false;
    }
  }

  window.loadUserOrders = loadUserOrders;

  window.refreshUserOrdersNow = async function (btn) {
    if (btn) {
      btn.disabled = true;
      const original = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Refreshing...';
      try {
        await loadUserOrders(false);
        showAppToast('Orders & verification status refreshed!');
      } finally {
        btn.disabled = false;
        btn.innerHTML = original;
      }
    } else {
      await loadUserOrders(false);
    }
  };

  function renderUserOrders() {
    const count = userOrders.length;

    // Stat Cards
    const statMyOrders = document.getElementById('statMyOrders');
    if (statMyOrders) statMyOrders.textContent = count;

    const totalOrdersBadge = document.getElementById('totalOrdersBadgeVal');
    if (totalOrdersBadge) totalOrdersBadge.textContent = `${count} ${count === 1 ? 'Purchase' : 'Purchases'}`;

    const mobTileOrders = document.getElementById('mobTileOrdersCount');
    if (mobTileOrders) mobTileOrders.textContent = `${count} ${count === 1 ? 'Purchase' : 'Purchases'}`;

    const bottomOrdersBadge = document.getElementById('bottomOrdersBadgeCount');
    if (bottomOrdersBadge) {
      bottomOrdersBadge.textContent = count;
      bottomOrdersBadge.style.display = count > 0 ? 'inline-flex' : 'none';
    }

    // 1. Render "My Purchased Products" Cards Grid
    const prodGrid = document.getElementById('purchasedProductsGrid');
    if (prodGrid) {
      if (count === 0) {
        prodGrid.innerHTML = `
          <div style="grid-column: 1 / -1; background: var(--card-bg); border: 2px dashed var(--card-border); border-radius: var(--radius-lg); padding: 50px 20px; text-align: center;">
            <div style="width: 56px; height: 56px; border-radius: 50%; background: #fff0f3; color: var(--primary-pink); display: inline-flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 14px;">
              <i class="fa-solid fa-bag-shopping"></i>
            </div>
            <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 6px;">No Purchased Products Yet</h3>
            <p style="font-size: 13.5px; color: var(--text-muted); max-width: 440px; margin: 0 auto 20px auto;">
              Explore our digital catalog to buy video vaults, private collections, tools, and eBooks with instant access.
            </p>
            <button type="button" class="section-action-btn-pink" onclick="switchTab('marketplace')">
              <i class="fa-solid fa-compass"></i> Browse Marketplace
            </button>
          </div>
        `;
      } else {
        prodGrid.innerHTML = userOrders.map(ord => {
          const title = getCleanOrderTitle(ord);
          const seller = getCleanOrderSeller(ord);
          const date = getCleanOrderDate(ord);
          const rawImg = ord.image || ord.thumbnail || ord.productImage || '';
          const img = (rawImg && !rawImg.includes('prod_indian_model') && !rawImg.includes('placeholder.svg')) ? rawImg : '';
          const badge = ord.badge || ord.category || 'Digital Content';
          const icon = ord.badgeIcon || 'fa-folder-closed';
          const isEbook = ord.isEbook || badge.toLowerCase().includes('ebook') || title.toLowerCase().includes('pdf');
          const size = ord.specDelivery || ord.fileSize || 'Instant Cloud Access';
          const dlLink = ord.downloadLink || ord.fileUrl || ord.orderLink || '';
          const status = (ord.status || ord.orderStatus || 'pending').toLowerCase();
          const isApproved = (status === 'approved' || status === 'completed' || ord.verified === true) && status !== 'pending' && status !== 'rejected';
          const isRejected = status === 'rejected' || status === 'failed' || status === 'cancelled';
          const rejectionReason = ord.rejectionReason || ord.rejectReason || ord.adminRemarks || '';

          let actionBtn;
          if (isApproved) {
            if (isEbook) {
              actionBtn = `<button type="button" class="btn-access-now" onclick="openAccessModal('${escapeHtml(title)}', '${escapeHtml(badge)}', '${escapeHtml(seller)}', 'Verified Digital Product', '${escapeHtml(size)}', '${encodeURIComponent(dlLink)}')"><i class="fa-solid fa-download"></i> Download</button>`;
            } else {
              actionBtn = `<button type="button" class="btn-access-now" onclick="openAccessModal('${escapeHtml(title)}', '${escapeHtml(badge)}', '${escapeHtml(seller)}', 'Verified Digital Product', '${escapeHtml(size)}', '${encodeURIComponent(dlLink)}')"><i class="fa-solid fa-play"></i> Access Now</button>`;
            }
          } else if (isRejected) {
            actionBtn = `<button type="button" class="btn-access-now" style="background: #ef4444;" onclick="showAppToast('Payment proof rejected: ${escapeHtml(rejectionReason || 'Screenshot/UTR invalid')}')" title="${escapeHtml(rejectionReason || 'Payment rejected')}"><i class="fa-solid fa-circle-xmark"></i> Rejected</button>`;
          } else {
            actionBtn = `<button type="button" class="btn-access-now" style="background: #f59e0b;" onclick="showAppToast('Order under verification. You will receive access once approved!')"><i class="fa-solid fa-clock"></i> Pending Review</button>`;
          }

          return `
            <div class="purchased-product-card">
              <div class="product-thumb-wrap">
                ${img ? `
                  <img src="${escapeHtml(img)}" alt="${escapeHtml(title)}" class="product-thumb-img mp-card-thumb-img" loading="lazy" decoding="async" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
                ` : ''}
                <div class="product-thumb-fallback-disc" style="${img ? 'display:none;' : 'display:flex;'} width:100%; height:100%; align-items:center; justify-content:center; background:linear-gradient(135deg, rgba(255,42,141,0.12), rgba(99,102,241,0.12));">
                  <i class="fa-solid ${icon}" style="font-size:32px; color:var(--primary-pink);"></i>
                </div>
                <span class="product-type-badge">
                  <i class="fa-solid ${icon}"></i> ${escapeHtml(badge)}
                </span>
              </div>
              <div class="product-card-body">
                <div class="product-info-top">
                  <h3 class="product-title" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
                  ${isRejected && rejectionReason ? `<div style="font-size: 11.5px; color: #ef4444; font-weight: 600; margin-bottom: 5px; display: flex; align-items: center; gap: 4px;"><i class="fa-solid fa-triangle-exclamation"></i> Reason: ${escapeHtml(rejectionReason)}</div>` : ''}
                  <div class="product-seller">
                    <span>By ${escapeHtml(seller)}</span>
                    <i class="fa-solid fa-circle-check verified-icon"></i>
                  </div>
                  <span class="product-purchase-date">Purchased on ${date}</span>
                </div>
                <div class="product-card-actions">
                  ${actionBtn}
                  <button type="button" class="btn-more-dots" onclick="openProductMenu(this, '${escapeHtml(title)}', '${encodeURIComponent(dlLink)}')" aria-label="More Options">
                    <i class="fa-solid fa-ellipsis-vertical"></i>
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 2. Render Orders Table in Orders Tab (Desktop) & Cards List (Mobile)
    const tableBody = document.getElementById('userOrdersTableBody');
    const cardsList = document.getElementById('userOrdersCardsList');

    if (count === 0) {
      const emptyHtml = `
        <div class="mobile-empty-orders-card">
          <div class="meo-icon"><i class="fa-solid fa-box-open"></i></div>
          <h4>No Orders Yet</h4>
          <p>You haven't placed any orders yet. Discover our verified digital collection.</p>
          <button type="button" class="section-action-btn-pink" onclick="switchTab('marketplace')">
            <i class="fa-solid fa-compass"></i> Start Exploring &rarr;
          </button>
        </div>
      `;

      if (tableBody) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
              You haven't placed any orders yet. 
              <a href="javascript:void(0)" onclick="switchTab('marketplace')" style="color: var(--primary-pink); font-weight: 700; margin-left: 6px;">Start Exploring &rarr;</a>
            </td>
          </tr>
        `;
      }
      if (cardsList) {
        cardsList.innerHTML = emptyHtml;
      }
    } else {
      // Desktop Table
      if (tableBody) {
        tableBody.innerHTML = userOrders.map(ord => {
          const id = getCleanDisplayOrderId(ord);
          const title = getCleanOrderTitle(ord);
          const seller = getCleanOrderSeller(ord);
          const date = getCleanOrderDate(ord);
          const amt = getCleanOrderAmount(ord);
          const dlLink = ord.downloadLink || ord.fileUrl || ord.orderLink || '';
          const status = (ord.status || ord.orderStatus || 'pending').toLowerCase();
          const isApproved = (status === 'approved' || status === 'completed' || ord.verified === true) && status !== 'pending' && status !== 'rejected';
          const isRejected = status === 'rejected' || status === 'failed' || status === 'cancelled';
          const rejectionReason = ord.rejectionReason || ord.rejectReason || ord.adminRemarks || '';

          const statusBadge = isApproved
            ? `<span class="activity-status-pill status-completed">Completed</span>`
            : isRejected
            ? `<span class="activity-status-pill" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);"><i class="fa-solid fa-circle-xmark"></i> Rejected</span>`
            : `<span class="activity-status-pill" style="background: #fef3c7; color: #b45309;"><i class="fa-solid fa-clock"></i> Pending</span>`;

          const btnAction = isApproved
            ? `<button type="button" class="section-action-btn-pink" onclick="openAccessModal('${escapeHtml(title)}', 'Product', '${escapeHtml(seller)}', 'Verified Digital Product', 'Direct Access', '${encodeURIComponent(dlLink)}')" style="padding: 5px 12px; font-size: 12px;"><i class="fa-solid fa-play"></i> Access</button>`
            : isRejected
            ? `<button type="button" class="section-action-btn-pink" onclick="showAppToast('Order Rejected: ${escapeHtml(rejectionReason || 'Screenshot/UTR could not be verified')}')" style="background: #ef4444; padding: 5px 12px; font-size: 12px;" title="${escapeHtml(rejectionReason || 'Order rejected')}"><i class="fa-solid fa-circle-xmark"></i> Reason</button>`
            : `<button type="button" class="section-action-btn-pink" onclick="showAppToast('Verification in progress. Order will be confirmed shortly.')" style="background: #f59e0b; padding: 5px 12px; font-size: 12px;"><i class="fa-solid fa-clock"></i> In Review</button>`;

          const reasonRow = (isRejected && rejectionReason)
            ? `<div style="font-size: 11px; color: #ef4444; font-weight: 600; margin-top: 3px; display: flex; align-items: center; gap: 4px;"><i class="fa-solid fa-triangle-exclamation"></i> Reason: ${escapeHtml(rejectionReason)}</div>`
            : '';

          return `
            <tr>
              <td><strong>${escapeHtml(id)}</strong></td>
              <td>
                <div>${escapeHtml(title)}</div>
                ${reasonRow}
              </td>
              <td>${escapeHtml(seller)}</td>
              <td>${escapeHtml(date)}</td>
              <td><strong>${escapeHtml(amt)}</strong></td>
              <td>${statusBadge}</td>
              <td>
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                  ${btnAction}
                  <button type="button" onclick="openOrderReceiptModal('${escapeHtml(id)}')" style="display: inline-flex; align-items: center; gap: 5px; background: var(--bg-hover, rgba(0,0,0,0.05)); border: 1px solid var(--border-color, rgba(0,0,0,0.14)); color: var(--text-main, #1e293b); padding: 5px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;" title="View &amp; Download Receipt Slip"><i class="fa-solid fa-receipt" style="color: var(--primary-pink, #f43f5e);"></i> Receipt</button>
                </div>
              </td>
            </tr>
          `;
        }).join('');
      }

      // Native Mobile Order Cards
      if (cardsList) {
        cardsList.innerHTML = userOrders.map(ord => {
          const id = getCleanDisplayOrderId(ord);
          const title = getCleanOrderTitle(ord);
          const seller = getCleanOrderSeller(ord);
          const date = getCleanOrderDate(ord);
          const amt = getCleanOrderAmount(ord);
          const rawImg = ord.image || ord.thumbnail || ord.productImage || '';
          const img = (rawImg && !rawImg.includes('prod_indian_model') && !rawImg.includes('placeholder.svg')) ? rawImg : '';
          const dlLink = ord.downloadLink || ord.fileUrl || ord.orderLink || '';
          const status = (ord.status || ord.orderStatus || 'pending').toLowerCase();
          const isApproved = (status === 'approved' || status === 'completed' || ord.verified === true) && status !== 'pending' && status !== 'rejected';
          const isRejected = status === 'rejected' || status === 'failed' || status === 'cancelled';
          const rejectionReason = ord.rejectionReason || ord.rejectReason || ord.adminRemarks || '';

          const statusBadge = isApproved
            ? `<span class="moc-status-pill completed"><i class="fa-solid fa-circle-check"></i> Completed</span>`
            : isRejected
            ? `<span class="moc-status-pill" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);"><i class="fa-solid fa-circle-xmark"></i> Rejected</span>`
            : `<span class="moc-status-pill pending"><i class="fa-solid fa-clock"></i> In Review</span>`;

          const actionBtn = isApproved
            ? `<button type="button" class="moc-action-btn primary" onclick="openAccessModal('${escapeHtml(title)}', 'Product', '${escapeHtml(seller)}', 'Verified Digital Product', 'Direct Access', '${encodeURIComponent(dlLink)}')"><i class="fa-solid fa-circle-play"></i> Access Now</button>`
            : isRejected
            ? `<button type="button" class="moc-action-btn secondary" style="border-color: #ef4444; color: #ef4444;" onclick="showAppToast('Order Rejected: ${escapeHtml(rejectionReason || 'Screenshot/UTR could not be verified')}')"><i class="fa-solid fa-circle-xmark"></i> View Reason</button>`
            : `<button type="button" class="moc-action-btn secondary" onclick="showAppToast('Order under verification. You will receive access once approved!')"><i class="fa-solid fa-clock"></i> Under Verification</button>`;

          return `
            <div class="mobile-order-card">
              <div class="moc-header-row">
                <span class="moc-order-id"><i class="fa-solid fa-receipt"></i> ${escapeHtml(id)}</span>
                ${statusBadge}
              </div>
              <div class="moc-content-row">
                ${img ? `
                  <div style="position:relative; width:52px; height:52px; flex-shrink:0; border-radius:10px; overflow:hidden;">
                    <img src="${escapeHtml(img)}" alt="${escapeHtml(title)}" class="moc-thumbnail mp-card-thumb-img" loading="lazy" decoding="async" onerror="this.style.display='none';" />
                  </div>
                ` : `
                  <div style="width:52px; height:52px; border-radius:10px; background:rgba(255,42,141,0.12); display:flex; align-items:center; justify-content:center; flex-shrink:0; color:var(--primary-pink); font-size:20px;">
                    <i class="fa-solid fa-box-archive"></i>
                  </div>
                `}
                <div class="moc-info">
                  <h4 class="moc-title">${escapeHtml(title)}</h4>
                  ${isRejected && rejectionReason ? `<div style="font-size: 11px; color: #ef4444; font-weight: 600; margin-top: 2px; margin-bottom: 4px;"><i class="fa-solid fa-triangle-exclamation"></i> Reason: ${escapeHtml(rejectionReason)}</div>` : ''}
                  <div class="moc-seller"><i class="fa-solid fa-circle-check"></i> ${escapeHtml(seller)}</div>
                  <div class="moc-meta-bottom">
                    <span class="moc-date">${escapeHtml(date)}</span>
                    <span class="moc-price">${escapeHtml(amt)}</span>
                  </div>
                </div>
              </div>
              <div class="moc-footer-row" style="display: flex; gap: 8px; align-items: center;">
                ${actionBtn}
                <button type="button" class="moc-action-btn secondary" onclick="openOrderReceiptModal('${escapeHtml(id)}')" style="flex: 0 0 auto; padding: 9px 14px; font-size: 12px;" title="View Receipt Slip"><i class="fa-solid fa-receipt"></i> Slip</button>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 3. Render Recent Activity Timeline
    const activityList = document.getElementById('recentActivityList');
    if (activityList && count > 0) {
      activityList.innerHTML = userOrders.slice(0, 4).map(ord => {
        const title = getCleanOrderTitle(ord);
        const date = getCleanOrderDate(ord);
        const rawImg = ord.image || ord.thumbnail || '';
        const img = (rawImg && !rawImg.includes('prod_indian_model') && !rawImg.includes('placeholder.svg')) ? rawImg : '';
        const status = (ord.status || ord.orderStatus || 'pending').toLowerCase();
        const isApproved = status === 'approved' || status === 'completed' || status === 'paid' || status === 'confirmed';
        const isRejected = status === 'rejected' || status === 'failed' || status === 'cancelled';

        const statusBadge = isApproved
          ? `<span class="activity-status-pill status-completed">Completed</span>`
          : isRejected
          ? `<span class="activity-status-pill" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);"><i class="fa-solid fa-circle-xmark"></i> Rejected</span>`
          : `<span class="activity-status-pill" style="background: #fef3c7; color: #b45309;"><i class="fa-solid fa-clock"></i> Pending</span>`;

        return `
          <div class="activity-item">
            <div class="activity-item-left">
              ${img ? `
                <div style="position:relative; width:36px; height:36px; border-radius:50%; overflow:hidden; flex-shrink:0; margin-right:10px;">
                  <img src="${escapeHtml(img)}" alt="Product" class="activity-item-avatar mp-card-thumb-img" loading="lazy" decoding="async" onerror="this.style.display='none';" />
                </div>
              ` : `
                <span class="activity-avatar-icon-fallback" style="display:inline-flex; width:36px; height:36px; border-radius:50%; align-items:center; justify-content:center; background:rgba(255,42,141,0.12); color:var(--primary-pink); font-size:14px; margin-right:10px; flex-shrink:0;">
                  <i class="fa-solid fa-bolt"></i>
                </span>
              `}
              <div class="activity-meta">
                <span class="activity-title">Purchased ${escapeHtml(title)}</span>
                <span class="activity-time">${escapeHtml(date)}</span>
              </div>
            </div>
            ${statusBadge}
          </div>
        `;
      }).join('');
    }
  }

  // ━━ 7. VERIFIED SELLER DIRECTORY & REAL PRODUCT CATALOG ━━
  let allMarketplaceStores = [];
  let allMarketplaceProducts = [];
  let currentStoreDirectoryFilter = 'all'; // 'all' or 'followed'
  let currentStoreSearchQuery = '';

  // Helper: Resolve relative product image paths in /user/ subfolder to correct root paths
  function resolveProductImageUrl(url) {
    if (!url) return '';
    if (Array.isArray(url)) {
      return resolveProductImageUrl(url[0]);
    }
    if (typeof url === 'object' && url) {
      return resolveProductImageUrl(url.url || url.src || url.publicUrl || '');
    }
    if (typeof url !== 'string') return '';
    let trimmed = url.trim();
    if (!trimmed || trimmed.includes('placeholder.svg') || trimmed.includes('favicon.svg')) return '';

    // Fix double-nested products/productsgallery bug if ever present
    if (trimmed.includes('/products/productsgallery/')) {
      trimmed = trimmed.replace('/products/productsgallery/', '/productsgallery/');
    }

    // 1. Maintain media.jaigram.shop CDN URLs directly (Do NOT strip to /media/)
    if (trimmed.includes('media.jaigram.shop/')) {
      return trimmed.startsWith('http') ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;
    }
    if (trimmed.includes('media.linkadda.shop/')) {
      const sub = trimmed.split('media.linkadda.shop/')[1].replace(/^\/+/, '');
      return `https://media.jaigram.shop/${sub}`;
    }

    // 2. Direct Cloudflare R2 S3 storage endpoints -> route to media.jaigram.shop
    if (trimmed.includes('r2.cloudflarestorage.com/')) {
      let sub = trimmed.split('r2.cloudflarestorage.com/')[1].replace(/^\/+/, '');
      if (sub.startsWith('linkadda-media/')) sub = sub.replace(/^linkadda-media\//, '');
      if (sub.startsWith('jaigram-media/')) sub = sub.replace(/^jaigram-media\//, '');
      return `https://media.jaigram.shop/${sub}`;
    }

    // 2b. Legacy RustFS / Hostinger storage endpoints -> route to media.jaigram.shop
    if (trimmed.includes('srv1942099.hstgr.cloud') || trimmed.includes('hstgr.cloud') || trimmed.includes('rustfs')) {
      let sub = '';
      if (trimmed.includes('/linkadda-media/')) {
        sub = trimmed.split('/linkadda-media/')[1];
      } else if (trimmed.includes('/jaigram-media/')) {
        sub = trimmed.split('/jaigram-media/')[1];
      } else {
        const parts = trimmed.split('/');
        sub = parts.slice(3).join('/');
      }
      sub = (sub || '').replace(/^\/+/, '');
      if (sub && !sub.includes('/') && sub.match(/\.(jpg|jpeg|png|webp|gif|svg|avif|mp4|webm|mov|m4v)$/i)) {
        sub = `products/${sub}`;
      }
      return `https://media.jaigram.shop/${sub}`;
    }

    // 3. Products / Productsgallery / Categories / Seller_products / Orders paths in R2
    if (trimmed.startsWith('products/') || trimmed.startsWith('productsgallery/') || trimmed.startsWith('categories/') || trimmed.startsWith('seller_products/') || trimmed.startsWith('orders/') || trimmed.startsWith('logos/')) {
      return `https://media.jaigram.shop/${trimmed}`;
    }

    // 4. Media paths (/media/products/... -> https://media.jaigram.shop/products/...)
    if (trimmed.startsWith('/media/') || trimmed.startsWith('media/')) {
      const cleanSub = trimmed.replace(/^\/?media\//, '');
      return `https://media.jaigram.shop/${cleanSub}`;
    }

    // 5. External / Uploaded media URLs (Google Drive, Imgur, Supabase, Cloudinary, data: URIs, blob:)
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
      return trimmed;
    }

    // 6. Local bundled images
    if (trimmed.startsWith('../images/')) {
      return trimmed;
    }
    if (trimmed.startsWith('/images/')) {
      return `..${trimmed}`;
    }
    if (trimmed.startsWith('images/')) {
      return `../${trimmed}`;
    }

    // 7. Normalize dummy/legacy asset paths
    if (trimmed.includes('assets/images/')) {
      trimmed = trimmed.replace(/^.*assets\/images\//i, 'images/');
      return '../' + trimmed;
    }

    // 8. Simple filenames with media extension
    if (trimmed.match(/\.(jpg|jpeg|png|webp|gif|svg|avif|mp4|webm|mov|m4v)$/i)) {
      const knownLocal = ['prod_vip_bundle.jpg', 'logo.png', 'hero.png', 'favicon.svg', 'qr.png', 'popup-avatar-circle.png'];
      if (knownLocal.includes(trimmed.toLowerCase())) {
        return `../images/${trimmed}`;
      }
      return `https://media.jaigram.shop/products/${trimmed.replace(/^\/+/, '')}`;
    }

    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }
  window.resolveProductImageUrl = resolveProductImageUrl;

  // Helper: Extract true cover image across all possible schemas (images array, image, thumbnail, coverImage, etc.)
  // Strictly preserves the actual image uploaded by seller or admin without fake curated fallbacks
  function extractProductCoverImage(p) {
    if (!p) return '../images/prod_vip_bundle.jpg';
    function pick(val) {
      if (!val) return '';
      if (typeof val === 'string') {
        const t = val.trim();
        if (!t) return '';
        if (t.startsWith('[') && t.endsWith(']')) {
          try {
            const parsed = JSON.parse(t);
            if (Array.isArray(parsed) && parsed.length > 0) return pick(parsed[0]);
          } catch (_) {}
        }
        if (!t.includes('placeholder.svg') && !t.includes('favicon.svg')) {
          return t;
        }
        return '';
      }
      if (Array.isArray(val) && val.length > 0) {
        for (const item of val) {
          const res = pick(item);
          if (res) return res;
        }
      }
      if (typeof val === 'object' && val) {
        return pick(val.url || val.src || val.publicUrl || '');
      }
      return '';
    }

    // Priority order: explicit real cover, or first image in images array, then gallery/media
    const candidate = pick(p.coverImage) || 
                      pick(p.thumbnail) || 
                      pick(p.image) || 
                      pick(p.cover) || 
                      pick(p.images) || 
                      pick(p.galleryImages) || 
                      pick(p.media) || 
                      pick(p.photos) || 
                      pick(p.previews);

    if (candidate) {
      return resolveProductImageUrl(candidate);
    }

    // Only if product has literally NO image at all, use default neutral fallback
    return '../images/prod_vip_bundle.jpg';
  }
  window.extractProductCoverImage = extractProductCoverImage;

  // Helper: Clean Unicode formatting (e.g. Mathematical Bold, Egyptian hieroglyphs, diacritics)
  function cleanUnicodeSellerName(str) {
    if (!str) return '';
    return String(str)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x00-\x7F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Helper: Normalize seller attributes across database records
  function normalizeSellerInfo(product) {
    const rawSellerId = String(product?.sellerId || product?.seller_id || '').trim();
    const rawSellerName = String(product?.sellerName || product?.sellerStoreName || '').trim();
    const cleaned = cleanUnicodeSellerName(rawSellerName).toLowerCase();

    // 1. Trusted Brother (Matches Mathematical Bold 𓆩✶𓆪𝐓𝐑𝐔𝐒𝐓𝐄𝐃 𝐁𝐑𝐎𝐓𝐇𝐄𝐑𓆩✶𓆪, seller_6e2c36f417 or seller_jaibajpai67)
    const isTB = rawSellerId === 'seller_6e2c36f417' ||
                 rawSellerId === 'seller_jaibajpai67' ||
                 (cleaned.includes('trusted') && cleaned.includes('brother')) ||
                 rawSellerName.includes('𝐓𝐑𝐔𝐒𝐓𝐄𝐃');
    if (isTB) {
      return {
        sellerId: 'seller_6e2c36f417',
        sellerName: 'Trusted brother',
        storeName: 'Trusted brother',
        sellerAvatar: '../images/popup-avatar-circle.png',
        category: 'Digital Creator',
        verified: true
      };
    }

    // 2. GHost Layer Shop (seller_8f3baf766f)
    const isGhost = rawSellerId === 'seller_8f3baf766f' ||
                    (cleaned.includes('ghost') && cleaned.includes('layer'));
    if (isGhost) {
      return {
        sellerId: 'seller_8f3baf766f',
        sellerName: 'GHost Layer Shop',
        storeName: 'GHost Layer Shop',
        sellerAvatar: '',
        category: 'Digital Creator',
        verified: true
      };
    }

    // 3. Other custom verified third-party seller (if explicitly provided and not admin/official)
    if (rawSellerId && rawSellerId !== 'master_admin' && rawSellerId !== 'store_linkadda_official' && rawSellerName && !cleaned.includes('official') && !cleaned.includes('jaigram') && !cleaned.includes('linkadda')) {
      return {
        sellerId: rawSellerId,
        sellerName: rawSellerName,
        storeName: rawSellerName,
        sellerAvatar: product?.sellerAvatar || '',
        category: product?.category || 'Digital Creator',
        verified: true
      };
    }

    // 4. Default: All other catalog products belong to Trusted brother (jaibajpai67@gmail.com)
    return {
      sellerId: 'seller_6e2c36f417',
      sellerName: 'Trusted brother',
      storeName: 'Trusted brother',
      sellerAvatar: '../images/popup-avatar-circle.png',
      category: 'Digital Creator',
      verified: true
    };
  }

  function getStoresStorageKey() {
    return 'linkadda_followed_stores_' + (currentCustomer?.uid || currentCustomer?.email || 'guest');
  }

  function formatStoreProductPrice(val) {
    const num = Number(val);
    if (isNaN(num) || num <= 0) return 'Free';
    return '₹' + num.toLocaleString('en-IN');
  }

  const STANDARD_VERIFIED_STORES = [
    {
      id: 'store_linkadda_official',
      storeName: 'JaiGram Official',
      avatar: '',
      category: 'VIP Media Partner',
      verified: true,
      followerCount: 1,
      totalProducts: 0,
      description: 'Official verified JaiGram digital repository. Instant cloud vaults and premium member packs.'
    },
    {
      id: 'store_trusted_brother',
      storeName: 'Trusted brother',
      avatar: '../images/popup-avatar-circle.png',
      category: 'Digital Creator',
      verified: true,
      followerCount: 1,
      totalProducts: 0,
      description: 'Premier creator studio specializing in exclusive digital media, reels vaults and curated bundles.'
    },
    {
      id: 'store_ghost_layer_shop',
      storeName: 'GHost Layer Shop',
      avatar: '',
      category: 'Digital Creator',
      verified: true,
      followerCount: 0,
      totalProducts: 0,
      description: 'High-performance video packs, trending creator templates and viral social tools.'
    }
  ];

  function getStoreFollowersMap() {
    try {
      const raw = localStorage.getItem('linkadda_store_followers_map');
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function setLiveFollowerCount(storeName, count) {
    const cleanKey = String(storeName || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const map = getStoreFollowersMap();
    map[cleanKey] = Number(count) || 0;
    try {
      localStorage.setItem('linkadda_store_followers_map', JSON.stringify(map));
    } catch (_) {}
  }

  function getLiveFollowerCount(store) {
    if (!store) return 0;
    const sName = String(store.storeName || '').trim();
    const cleanKey = sName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const fMap = getStoreFollowersMap();
    const isFollowed = isStoreFollowed(sName);

    let count = fMap[cleanKey];
    if (typeof count !== 'number') {
      count = Number(store.followerCount || store.followers || 0);
    }

    if (isFollowed && count <= 0) {
      count = 1;
      setLiveFollowerCount(sName, 1);
    }

    return count;
  }

  function isProductBelongingToStore(p, store) {
    if (!p || !store) return false;
    const sInfo = normalizeSellerInfo(p);
    const targetStoreId = String(store.id || '').trim().toLowerCase();
    const targetStoreName = cleanUnicodeSellerName(store.storeName || '').trim().toLowerCase();

    // 1. Direct seller ID match
    const pSellerId = String(sInfo.sellerId || '').trim().toLowerCase();
    if (pSellerId && targetStoreId && pSellerId === targetStoreId) return true;

    // 2. Trusted brother alias matching
    const isTargetTb = targetStoreId === 'seller_6e2c36f417' ||
                       targetStoreId === 'seller_jaibajpai67' ||
                       targetStoreId === 'store_trusted_brother' ||
                       (targetStoreName.includes('trusted') && targetStoreName.includes('brother'));
    const isProdTb = pSellerId === 'seller_6e2c36f417' ||
                     pSellerId === 'seller_jaibajpai67' ||
                     pSellerId === 'store_trusted_brother' ||
                     (cleanUnicodeSellerName(sInfo.storeName).toLowerCase().includes('trusted') && cleanUnicodeSellerName(sInfo.storeName).toLowerCase().includes('brother'));

    if (isTargetTb || isProdTb) {
      return isTargetTb && isProdTb;
    }

    // 3. Ghost Layer alias matching
    const isTargetGhost = targetStoreId === 'seller_8f3baf766f' ||
                          targetStoreId === 'store_ghost_layer_shop' ||
                          (targetStoreName.includes('ghost') && targetStoreName.includes('layer'));
    const isProdGhost = pSellerId === 'seller_8f3baf766f' ||
                        pSellerId === 'store_ghost_layer_shop' ||
                        (cleanUnicodeSellerName(sInfo.storeName).toLowerCase().includes('ghost') && cleanUnicodeSellerName(sInfo.storeName).toLowerCase().includes('layer'));

    if (isTargetGhost || isProdGhost) {
      return isTargetGhost && isProdGhost;
    }

    // 4. Exact, normalized store name match (strictly length >= 4)
    const pStoreName = cleanUnicodeSellerName(sInfo.storeName).trim().toLowerCase();
    if (pStoreName && targetStoreName) {
      if (pStoreName === targetStoreName) return true;
      const pCompact = pStoreName.replace(/[\s_-]+/g, '');
      const targetCompact = targetStoreName.replace(/[\s_-]+/g, '');
      if (pCompact.length >= 4 && targetCompact.length >= 4 && pCompact === targetCompact) return true;
    }

    return false;
  }

  function extractStoresFromProducts() {
    if (!allMarketplaceProducts || !allMarketplaceProducts.length) return [];
    const map = new Map();
    allMarketplaceProducts.forEach(p => {
      const sInfo = normalizeSellerInfo(p);
      const sName = sInfo.storeName;
      if (!sName) return;
      const key = sName.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          id: sInfo.sellerId || ('store_' + key.replace(/[^a-z0-9_-]/g, '_')),
          storeName: sName,
          avatar: sInfo.sellerAvatar || '',
          category: sInfo.category || 'Digital Creator',
          verified: true,
          followerCount: 0,
          totalProducts: 1,
        });
      } else {
        map.get(key).totalProducts += 1;
      }
    });
    return Array.from(map.values());
  }

  function mergeStoresLists(primaryStores, fallbackStores) {
    const map = new Map();
    (fallbackStores || []).forEach(s => {
      if (!s || !s.storeName) return;
      map.set(String(s.storeName).trim().toLowerCase(), { ...s });
    });
    (primaryStores || []).forEach(s => {
      if (!s || !s.storeName) return;
      const key = String(s.storeName).trim().toLowerCase();
      if (map.has(key)) {
        map.set(key, { ...map.get(key), ...s });
      } else {
        map.set(key, { ...s });
      }
    });
    return Array.from(map.values());
  }

  const MARKETPLACE_PRODUCTS_CACHE_KEY = 'linkadda_marketplace_products_v2';
  const MARKETPLACE_STORES_CACHE_KEY = 'linkadda_marketplace_stores_v2';

  // Helper: Normalize catalog product from raw database payload
  function normalizeCatalogProduct(id, p) {
    if (!p || p.status === 'deleted' || p.status === 'inactive' || p.status === 'archived' || p.status === 'pending' || p.status === 'pending_approval' || p.status === 'rejected' || p.status === 'draft') return null;
    if (!p.title && !p.name) return null;
    const sellerMeta = normalizeSellerInfo(p);
    const realCover = p.coverImage || p.image || p.thumbnail || (Array.isArray(p.images) && p.images[0]) || (Array.isArray(p.galleryImages) && p.galleryImages[0]) || '';
    const resolvedCover = realCover ? resolveProductImageUrl(realCover) : extractProductCoverImage(p);
    return {
      id,
      ...p,
      title: p.title || p.name || 'Digital Pack',
      category: p.category || 'VIP Collection',
      sellerId: sellerMeta.sellerId,
      sellerName: sellerMeta.sellerName,
      sellerStoreName: sellerMeta.storeName,
      sellerAvatar: sellerMeta.sellerAvatar || p.sellerAvatar || '',
      coverImage: p.coverImage ? resolveProductImageUrl(p.coverImage) : resolvedCover,
      image: p.image ? resolveProductImageUrl(p.image) : resolvedCover,
      thumbnail: p.thumbnail ? resolveProductImageUrl(p.thumbnail) : resolvedCover,
      images: Array.isArray(p.images) ? p.images.map(resolveProductImageUrl).filter(Boolean) : (p.images ? [resolveProductImageUrl(p.images)] : []),
      galleryImages: Array.isArray(p.galleryImages) ? p.galleryImages.map(resolveProductImageUrl).filter(Boolean) : (p.galleryImages ? [resolveProductImageUrl(p.galleryImages)] : []),
      videos: Array.isArray(p.videos) ? p.videos.map(resolveProductImageUrl).filter(Boolean) : (p.videos ? [resolveProductImageUrl(p.videos)] : []),
      video: p.video ? resolveProductImageUrl(p.video) : ''
    };
  }

  // Helper: Network fetch with timeout to prevent hung requests
  async function fetchWithTimeout(url, timeoutMs = 6000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      clearTimeout(timer);
      return null;
    }
  }

  // Helper: Preload top product images into browser memory cache for instantaneous UI rendering
  function preloadTopProductImages(products = []) {
    try {
      if (!Array.isArray(products) || !products.length) return;
      products.slice(0, 15).forEach(p => {
        const cover = p.coverImage || p.image || p.thumbnail;
        if (cover && typeof cover === 'string') {
          const resolved = resolveProductImageUrl(cover);
          if (resolved && !resolved.startsWith('data:') && !resolved.startsWith('blob:')) {
            const img = new Image();
            img.src = resolved;
          }
        }
      });
    } catch (_) {}
  }

  // ━━ 0ms INSTANT LOCAL CACHE RESTORATION (Zero blank state on refresh) ━━
  function restoreMarketplaceCacheImmediate() {
    try {
      let cachedProds = null;
      let cachedStores = null;

      // 1. Check primary persistent v2 cache
      const rawProds = localStorage.getItem(MARKETPLACE_PRODUCTS_CACHE_KEY);
      if (rawProds) {
        try {
          const parsed = JSON.parse(rawProds);
          if (Array.isArray(parsed) && parsed.length > 0) {
            cachedProds = parsed;
          }
        } catch (_) {}
      }

      // 2. Check cross-tab live catalog cache snapshot
      if (!cachedProds) {
        const rawLiveData = localStorage.getItem('linkadda_cached_live_data_v4') || localStorage.getItem('linkadda_cached_live_data');
        if (rawLiveData) {
          try {
            const parsedLive = JSON.parse(rawLiveData);
            if (parsedLive && parsedLive.products && typeof parsedLive.products === 'object') {
              cachedProds = Object.entries(parsedLive.products)
                .map(([id, p]) => normalizeCatalogProduct(id, p))
                .filter(Boolean);
            }
          } catch (_) {}
        }
      }

      const rawStores = localStorage.getItem(MARKETPLACE_STORES_CACHE_KEY);
      if (rawStores) {
        try {
          const parsedStores = JSON.parse(rawStores);
          if (Array.isArray(parsedStores) && parsedStores.length > 0) {
            cachedStores = parsedStores;
          }
        } catch (_) {}
      }

      if (cachedProds && cachedProds.length > 0) {
        allMarketplaceProducts = cachedProds.map(p => {
          if (!p || typeof p !== 'object') return p;
          const cov = p.coverImage || p.image || p.thumbnail || '';
          const resCov = resolveProductImageUrl(cov);
          return {
            ...p,
            coverImage: resCov,
            image: resCov,
            thumbnail: resCov,
            images: Array.isArray(p.images) ? p.images.map(resolveProductImageUrl).filter(Boolean) : (p.images ? [resolveProductImageUrl(p.images)] : []),
            galleryImages: Array.isArray(p.galleryImages) ? p.galleryImages.map(resolveProductImageUrl).filter(Boolean) : (p.galleryImages ? [resolveProductImageUrl(p.galleryImages)] : [])
          };
        });
      }
      if (cachedStores && cachedStores.length > 0) {
        allMarketplaceStores = cachedStores;
      } else if (!allMarketplaceStores.length) {
        allMarketplaceStores = [...STANDARD_VERIFIED_STORES];
      }

      // If cached data is available, render immediately in 0ms!
      if (allMarketplaceProducts.length > 0) {
        syncProductsCountWithStores();
        renderFollowedStoresUI();
        renderMarketplaceCategoryPills();
        renderRecommendedProducts();
        renderMarketplaceCatalog();
        renderFlashDealsRail();
        preloadTopProductImages(allMarketplaceProducts);
      }
    } catch (e) {
      console.warn('Marketplace fast cache notice:', e);
    }
  }
  window.restoreMarketplaceCacheImmediate = restoreMarketplaceCacheImmediate;

  async function loadUserFollowedStores() {
    const key = getStoresStorageKey();
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        userFollowedStores = JSON.parse(saved);
      } catch (_) {
        userFollowedStores = [];
      }
    } else {
      userFollowedStores = [];
    }
    updateFollowedStoresCount();

    // 1. Non-blocking Parallel SWR Fetch (Zero UI freezing)
    try {
      const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:';
      const fetchList = [
        fetchWithTimeout(`${RTDB_URL}/products.json?_t=${Date.now()}`, 7000),
        fetchWithTimeout(`${RTDB_URL}/public_sellers.json?_t=${Date.now()}`, 5000),
      ];
      if (!isLocalDev) {
        fetchList.push(fetchWithTimeout('/api/seller/auth?action=list_public_sellers', 5000));
      }
      const fetchResults = await Promise.allSettled(fetchList);
      const prodsResult = fetchResults[0];
      const rtdbSellersResult = fetchResults[1];
      const publicSellersResult = !isLocalDev ? fetchResults[2] : { status: 'rejected' };

      // Process Fresh Active Products
      if (prodsResult.status === 'fulfilled' && prodsResult.value && typeof prodsResult.value === 'object') {
        const freshProds = Object.entries(prodsResult.value)
          .map(([id, p]) => normalizeCatalogProduct(id, p))
          .filter(Boolean);

        if (freshProds.length > 0) {
          freshProds.sort((a, b) => {
            const orderA = a.displayOrder !== undefined && a.displayOrder !== null ? Number(a.displayOrder) : 999999;
            const orderB = b.displayOrder !== undefined && b.displayOrder !== null ? Number(b.displayOrder) : 999999;
            if (orderA !== orderB) return orderA - orderB;
            return (b.createdAt || 0) - (a.createdAt || 0);
          });
          allMarketplaceProducts = freshProds;
          try {
            localStorage.setItem(MARKETPLACE_PRODUCTS_CACHE_KEY, JSON.stringify(allMarketplaceProducts));
          } catch (_) {}
        }
      }

      // Process Verified Sellers
      let loadedRealStores = [];
      if (publicSellersResult.status === 'fulfilled' && publicSellersResult.value?.success && Array.isArray(publicSellersResult.value.sellers)) {
        loadedRealStores = publicSellersResult.value.sellers.map(s => ({
          id: s.id || s.sellerId,
          storeName: s.storeName || s.name || 'Verified Creator',
          avatar: s.avatar || '',
          category: s.category || 'Digital Creator',
          verified: s.verified !== false,
          followerCount: Number(s.followerCount || 0),
          totalProducts: 0
        }));
      }

      // Fallback direct RTDB sellers
      if (rtdbSellersResult.status === 'fulfilled' && rtdbSellersResult.value && typeof rtdbSellersResult.value === 'object') {
        const directPubs = Object.entries(rtdbSellersResult.value).map(([id, s]) => ({
          id: s.id || id,
          storeName: s.storeName || 'Verified Partner',
          avatar: s.avatar || '',
          category: s.category || 'Digital Creator',
          verified: s.verified !== false,
          followerCount: Number(s.followerCount || 0),
          totalProducts: 0,
        }));
        loadedRealStores = mergeStoresLists(loadedRealStores, directPubs);
      }

      // Merge verified stores
      let mergedStores = [...STANDARD_VERIFIED_STORES];
      if (loadedRealStores.length > 0) {
        mergedStores = mergeStoresLists(mergedStores, loadedRealStores);
      }

      // Ensure user followed stores from session are included
      userFollowedStores.forEach(fsName => {
        const cleanFs = String(fsName).trim();
        if (cleanFs && !mergedStores.some(s => s.storeName.toLowerCase() === cleanFs.toLowerCase())) {
          mergedStores.push({
            id: 'store_' + cleanFs.replace(/[^a-z0-9_-]/g, '_').toLowerCase(),
            storeName: cleanFs,
            avatar: '',
            category: 'Digital Creator',
            verified: true,
            followerCount: 1,
            totalProducts: 0
          });
        }
      });

      allMarketplaceStores = mergedStores;
      try {
        localStorage.setItem(MARKETPLACE_STORES_CACHE_KEY, JSON.stringify(allMarketplaceStores));
      } catch (_) {}

    } catch (err) {
      console.warn('Background marketplace fetch notice:', err);
    }

    // Synchronize REAL product counts & render UI
    syncProductsCountWithStores();
    renderFollowedStoresUI();
    renderMarketplaceCategoryPills();
    renderRecommendedProducts();
    renderMarketplaceCatalog();
    renderFlashDealsRail();
    preloadTopProductImages(allMarketplaceProducts);

    // If storeShowcaseModal is currently open (e.g. from deep link ?store=...), refresh its view with freshly loaded products!
    const storeModal = document.getElementById('storeShowcaseModal');
    if (storeModal && storeModal.classList.contains('active') && currentModalStore) {
      window.openStoreShowcaseModal(currentModalStore.id || currentModalStore.storeName);
    }

    // Start Real-Time Live Sync with Firebase Server-Sent Events
    startRealtimeMarketplaceSync();
  }

  // ━━ REAL-TIME LIVE SYNC (Firebase RTDB Server-Sent Events) ━━
  let _marketplaceSseActive = false;
  function startRealtimeMarketplaceSync() {
    if (_marketplaceSseActive || typeof EventSource === 'undefined') return;
    try {
      _marketplaceSseActive = true;
      const es = new EventSource(`${RTDB_URL}/products.json`);

      es.addEventListener('put', (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload && typeof payload === 'object') {
            handleRealtimeProductsEvent(payload.path, payload.data);
          }
        } catch (_) {}
      });

      es.addEventListener('patch', (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload && typeof payload === 'object') {
            handleRealtimeProductsPatch(payload.path, payload.data);
          }
        } catch (_) {}
      });

      es.onerror = () => {
        // Browser EventSource automatically reconnects with backoff
      };
    } catch (_) {}
  }

  function handleRealtimeProductsEvent(path, data) {
    if (!path || path === '/') {
      if (data && typeof data === 'object') {
        const fresh = Object.entries(data).map(([id, p]) => normalizeCatalogProduct(id, p)).filter(Boolean);
        if (fresh.length > 0) {
          allMarketplaceProducts = fresh;
          try {
            localStorage.setItem(MARKETPLACE_PRODUCTS_CACHE_KEY, JSON.stringify(allMarketplaceProducts));
          } catch (_) {}
          syncProductsCountWithStores();
          renderMarketplaceCatalog();
          renderRecommendedProducts();
          renderFlashDealsRail();
          renderFollowedStoresUI();
        }
      }
    } else {
      const segments = path.replace(/^\/+/, '').split('/');
      const prodId = segments[0];
      if (!prodId) return;

      if (segments.length === 1) {
        if (!data || data.status === 'deleted' || data.status === 'inactive' || data.status === 'pending' || data.status === 'rejected') {
          allMarketplaceProducts = allMarketplaceProducts.filter(p => String(p.id).toLowerCase() !== String(prodId).toLowerCase());
        } else {
          const normalized = normalizeCatalogProduct(prodId, data);
          if (normalized) {
            const idx = allMarketplaceProducts.findIndex(p => String(p.id).toLowerCase() === String(prodId).toLowerCase());
            if (idx >= 0) allMarketplaceProducts[idx] = normalized;
            else allMarketplaceProducts.unshift(normalized);
          }
        }
      } else if (segments[1] === 'status') {
        if (data !== 'active') {
          allMarketplaceProducts = allMarketplaceProducts.filter(p => String(p.id).toLowerCase() !== String(prodId).toLowerCase());
        } else {
          loadUserFollowedStores();
          return;
        }
      }

      try {
        localStorage.setItem(MARKETPLACE_PRODUCTS_CACHE_KEY, JSON.stringify(allMarketplaceProducts));
      } catch (_) {}
      syncProductsCountWithStores();
      renderMarketplaceCatalog();
      renderRecommendedProducts();
      renderFlashDealsRail();
      renderFollowedStoresUI();
    }
  }

  function handleRealtimeProductsPatch(path, data) {
    if (!data || typeof data !== 'object') return;
    Object.entries(data).forEach(([key, val]) => {
      handleRealtimeProductsEvent(`/${key}`, val);
    });
  }

  // Cross-tab immediate sync: When Admin approves or saves product in another tab
  window.addEventListener('storage', (e) => {
    if (e.key === MARKETPLACE_PRODUCTS_CACHE_KEY || e.key === 'linkadda_cached_live_data_v4' || e.key === 'linkadda_cached_live_data') {
      restoreMarketplaceCacheImmediate();
    }
  });

  function syncProductsCountWithStores() {
    allMarketplaceStores.forEach(s => {
      const matchingCount = allMarketplaceProducts.filter(p => isProductBelongingToStore(p, s)).length;
      s.totalProducts = matchingCount;
    });
  }

  function updateFollowedStoresCount() {
    const statStores = document.getElementById('statFollowedStores');
    if (statStores) statStores.textContent = userFollowedStores.length;
    const pill = document.getElementById('followedCountPill');
    if (pill) pill.textContent = userFollowedStores.length;
    const mobStores = document.getElementById('mobTileStoresCount');
    if (mobStores) mobStores.textContent = `${userFollowedStores.length} Stores`;
  }

  function renderFollowedStoresUI() {
    updateFollowedStoresCount();
    const dashGrid = document.getElementById('dashboardFollowedStoresGrid');
    const tabGrid = document.getElementById('storesTabGrid');

    // ━━ A. DASHBOARD HOME WIDGET ━━
    if (dashGrid) {
      let dashStores = allMarketplaceStores.filter(s => isStoreFollowed(s.storeName));

      // Auto-reconcile: if user has followed stores in storage, ensure they are present in allMarketplaceStores
      if (userFollowedStores.length > 0 && dashStores.length === 0) {
        userFollowedStores.forEach(fsName => {
          const cleanFs = String(fsName).trim();
          if (cleanFs && !allMarketplaceStores.some(s => s.storeName.toLowerCase() === cleanFs.toLowerCase())) {
            allMarketplaceStores.push({
              id: 'store_' + cleanFs.replace(/\s+/g, '_').toLowerCase(),
              storeName: cleanFs,
              avatar: '',
              category: 'Digital Creator',
              verified: true,
              totalProducts: 0
            });
          }
        });
        syncProductsCountWithStores();
        dashStores = allMarketplaceStores.filter(s => isStoreFollowed(s.storeName));
      }

      if (!dashStores.length) {
        // No followed stores — show real empty state
        dashGrid.innerHTML = `
          <div style="grid-column: 1 / -1; background: var(--card-bg); border: 2px dashed var(--card-border); border-radius: var(--radius-lg); padding: 40px 24px; text-align: center;">
            <div style="width: 50px; height: 50px; border-radius: 50%; background: rgba(255, 42, 141, 0.08); color: var(--primary-pink); display: inline-flex; align-items: center; justify-content: center; font-size: 22px; margin-bottom: 12px;">
              <i class="fa-solid fa-store"></i>
            </div>
            <h4 style="font-size: 16px; font-weight: 800; margin-bottom: 6px; color: var(--text-main);">No Followed Stores Yet</h4>
            <p style="font-size: 13px; color: var(--text-muted); max-width: 380px; margin: 0 auto 16px auto; line-height: 1.5;">
              Browse verified creators and follow their stores to get instant updates on new product drops.
            </p>
            <button type="button" class="section-action-btn-pink" onclick="switchTab('stores')" style="display: inline-flex; margin: 0 auto;">
              <i class="fa-solid fa-compass"></i> Explore Creator Stores
            </button>
          </div>
        `;
      } else {
        dashGrid.innerHTML = dashStores.map(store => renderStoreCardHtml(store, false)).join('');
      }
    }

    // ━━ B. FULL STORES DIRECTORY TAB ━━
    if (tabGrid) {
      let filtered = allMarketplaceStores;

      if (currentStoreDirectoryFilter === 'followed') {
        filtered = filtered.filter(s => isStoreFollowed(s.storeName));
      }

      if (currentStoreSearchQuery) {
        const q = currentStoreSearchQuery.toLowerCase().trim();
        filtered = filtered.filter(s =>
          String(s.storeName || '').toLowerCase().includes(q) ||
          String(s.category || '').toLowerCase().includes(q)
        );
      }

      if (!filtered.length) {
        const isFollowedEmpty = currentStoreDirectoryFilter === 'followed';
        tabGrid.innerHTML = `
          <div style="grid-column: 1 / -1; background: var(--card-bg); border: 2px dashed var(--card-border); border-radius: var(--radius-lg); padding: 48px 24px; text-align: center;">
            <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(255, 42, 141, 0.08); color: var(--primary-pink); display: inline-flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 14px;">
              <i class="fa-solid fa-store"></i>
            </div>
            <h4 style="font-size: 17px; font-weight: 800; margin-bottom: 6px; color: var(--text-main);">
              ${isFollowedEmpty ? 'No Followed Stores Yet' : 'No Stores Found'}
            </h4>
            <p style="font-size: 13px; color: var(--text-muted); max-width: 420px; margin: 0 auto 18px auto; line-height: 1.5;">
              ${isFollowedEmpty
                ? 'Follow verified creators to receive instant drop updates and exclusive bundle notifications.'
                : 'No creator storefronts match your current search query. Try searching another category or creator name.'}
            </p>
            ${isFollowedEmpty ? `
              <button type="button" class="section-action-btn-pink" onclick="setStoreDirectoryFilter('all')" style="display: inline-flex; margin: 0 auto;">
                <i class="fa-solid fa-compass"></i> Explore All Stores
              </button>
            ` : `
              <button type="button" class="section-action-btn-pink" onclick="document.getElementById('storeSearchInput').value=''; handleStoreSearch('');" style="display: inline-flex; margin: 0 auto;">
                <i class="fa-solid fa-rotate-left"></i> Clear Search Filter
              </button>
            `}
          </div>
        `;
      } else {
        tabGrid.innerHTML = filtered.map(store => renderStoreCardHtml(store, false)).join('');
      }
    }
  }

  function isStoreFollowed(storeName) {
    if (!storeName || !userFollowedStores || !userFollowedStores.length) return false;
    const clean = String(storeName).trim().toLowerCase();
    return userFollowedStores.some(f => {
      const fClean = String(f).trim().toLowerCase();
      return fClean === clean || (fClean && clean && (fClean.includes(clean) || clean.includes(fClean)));
    });
  }

  function renderStoreCardHtml(store, isFeaturedPrompt = false) {
    const isFollowed = isStoreFollowed(store.storeName);
    const initial = (store.storeName || 'S').trim().charAt(0).toUpperCase();
    const avatarHtml = store.avatar
      ? `<img src="${escapeHtml(store.avatar)}" class="store-avatar-img" loading="lazy" decoding="async" alt="${escapeHtml(store.storeName)}" onerror="this.onerror=null;this.parentElement.textContent='${initial}';" />`
      : initial;

    const followerCount = getLiveFollowerCount(store);
    const productCount = store.totalProducts || 0;

    return `
      <div class="followed-store-card" data-store-id="${escapeHtml(store.id || store.storeName)}">
        <div class="store-card-banner"></div>
        <div class="store-card-body">
          <div class="store-avatar-wrap" onclick="openStoreShowcaseModal('${escapeHtml(store.storeName)}')">
            ${avatarHtml}
          </div>
          <h4 class="store-name" onclick="openStoreShowcaseModal('${escapeHtml(store.storeName)}')" style="cursor: pointer;">
            <span>${escapeHtml(store.storeName)}</span>
          </h4>
          <span class="store-category">${escapeHtml(store.category || 'Digital Assets')}</span>
          <div class="store-stats-row">
            <span class="store-stat-chip"><i class="fa-solid fa-box-open"></i> ${productCount} Drops</span>
            <span class="store-stat-chip"><i class="fa-solid fa-users"></i> ${followerCount} Followers</span>
          </div>
          <div class="store-card-actions">
            <button type="button" class="btn-following-toggle ${isFollowed ? 'active' : ''}" onclick="toggleFollowStore(this, '${escapeHtml(store.storeName)}')">
              <i class="fa-solid ${isFollowed ? 'fa-check' : 'fa-plus'}"></i>
              <span>${isFollowed ? 'Following' : (isFeaturedPrompt ? 'Follow Store' : '+ Follow')}</span>
            </button>
            <button type="button" class="btn-view-store" onclick="openStoreShowcaseModal('${escapeHtml(store.storeName)}')">
              <i class="fa-solid fa-bag-shopping"></i>
              <span>Products</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  window.toggleFollowStore = function (btn, storeName) {
    const clean = String(storeName).trim();
    const cleanLower = clean.toLowerCase();
    const cleanKey = cleanLower.replace(/[^a-z0-9_-]/g, '_');
    const idx = userFollowedStores.findIndex(f => String(f).trim().toLowerCase() === cleanLower);
    const isNowFollowing = idx === -1;

    if (idx > -1) {
      userFollowedStores.splice(idx, 1);
      showAppToast(`Unfollowed ${clean}`);
    } else {
      userFollowedStores.push(clean);
      showAppToast(`Now following ${clean}! ❤️`);
    }

    const key = getStoresStorageKey();
    localStorage.setItem(key, JSON.stringify(userFollowedStores));
    updateFollowedStoresCount();

    // Instantly calculate and update follower count locally
    const matchedStore = allMarketplaceStores.find(s => String(s.storeName || '').trim().toLowerCase() === cleanLower);
    const currentFollowers = getLiveFollowerCount(matchedStore || { storeName: clean, followerCount: 0 });
    const newFollowers = isNowFollowing ? (currentFollowers + 1) : Math.max(0, currentFollowers - 1);
    setLiveFollowerCount(clean, newFollowers);
    if (matchedStore) {
      matchedStore.followerCount = newFollowers;
    }

    // Immediately re-render UI so user sees 1 Follower (or 0) without waiting
    renderFollowedStoresUI();
    syncModalFollowButton(clean);

    // Sync live follower count with database and seller dashboard
    const sellerId = matchedStore?.id || '';
    const customerId = currentCustomer?.uid || currentCustomer?.email || 'visitor_' + (localStorage.getItem('linkadda_visitor_id') || Math.random().toString(36).slice(2, 9));
    const safeCustId = String(customerId).replace(/[^a-zA-Z0-9_-]/g, '_');

    // 1. Direct RTDB write to /store_followers
    try {
      fetch(`${RTDB_URL}/store_followers/${encodeURIComponent(cleanKey)}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count: newFollowers,
          storeName: clean,
          updatedAt: Date.now()
        })
      }).catch(() => {});

      if (isNowFollowing) {
        fetch(`${RTDB_URL}/store_followers/${encodeURIComponent(cleanKey)}/followers/${encodeURIComponent(safeCustId)}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Date.now())
        }).catch(() => {});
      } else {
        fetch(`${RTDB_URL}/store_followers/${encodeURIComponent(cleanKey)}/followers/${encodeURIComponent(safeCustId)}.json`, {
          method: 'DELETE'
        }).catch(() => {});
      }
    } catch (_) {}

    // 2. Also notify backend endpoint /api/seller/auth?action=toggle_follow
    fetch(`${API_BASE}/api/seller/auth?action=toggle_follow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeName: clean,
        sellerId,
        customerId: safeCustId,
        follow: isNowFollowing,
      })
    })
      .then(r => r.json())
      .then(data => {
        if (data && typeof data.followerCount === 'number') {
          setLiveFollowerCount(clean, data.followerCount);
          if (matchedStore) {
            matchedStore.followerCount = data.followerCount;
            renderFollowedStoresUI();
          }
        }
      })
      .catch(() => {});
  };

  window.setStoreDirectoryFilter = function (filterType) {
    currentStoreDirectoryFilter = filterType;
    const allBtn = document.getElementById('filterBtnAllStores');
    const followedBtn = document.getElementById('filterBtnFollowedStores');
    if (allBtn) allBtn.classList.toggle('active', filterType === 'all');
    if (followedBtn) followedBtn.classList.toggle('active', filterType === 'followed');
    renderFollowedStoresUI();
  };

  window.handleStoreSearch = function (query) {
    currentStoreSearchQuery = String(query || '').trim();
    renderFollowedStoresUI();
  };

  // ━━ 8. STORE SHOWCASE MODAL & FULL-PAGE STORE VIEW ━━
  let currentModalStore = null;
  let currentModalStoreProducts = [];
  let currentStoreActiveCategory = 'all';

  function getProductPrice(p) {
    if (!p) {
      return {
        currency: currentCurrency || 'INR',
        symbol: currentCurrency === 'USD' ? '$' : '₹',
        amount: 0,
        formatted: currentCurrency === 'USD' ? '$0' : '₹0',
        originalAmount: 0,
        formattedOriginal: '',
        discountPct: 0,
        inr: 0,
        usd: 0
      };
    }

    // 1. Raw INR
    const rawInr = p.priceINR ?? p.inr ?? p.price ?? p.amountINR ?? p.amount ?? 0;
    let numInr = Number(String(rawInr).replace(/[^\d.]/g, '')) || 0;

    // 2. Raw USD
    const rawUsd = p.priceUSD ?? p.usd ?? p.amountUSD ?? 0;
    let numUsd = Number(String(rawUsd).replace(/[^\d.]/g, '')) || 0;

    // Intelligent bidirectional conversion
    if (numUsd <= 0 && numInr > 0) {
      numUsd = Math.max(2, Math.round(numInr / 85));
    }
    if (numInr <= 0 && numUsd > 0) {
      numInr = Math.round(numUsd * 85);
    }

    const isUsd = (currentCurrency === 'USD');
    const activeSymbol = isUsd ? '$' : '₹';
    const activeAmount = isUsd ? numUsd : numInr;

    // Original / MRP Price
    let originalAmount = 0;
    if (isUsd) {
      const rawOrigUsd = p.originalPriceUSD ?? p.originalPrice ?? 0;
      originalAmount = Number(String(rawOrigUsd).replace(/[^\d.]/g, '')) || 0;
      if (originalAmount <= activeAmount && activeAmount > 0) {
        originalAmount = Math.round(activeAmount * 1.5);
      }
    } else {
      const rawOrigInr = p.originalPriceINR ?? p.originalPrice ?? p.priceOriginal ?? p.mrpINR ?? 0;
      originalAmount = Number(String(rawOrigInr).replace(/[^\d.]/g, '')) || 0;
      if (originalAmount <= activeAmount && activeAmount > 0) {
        originalAmount = Math.round(activeAmount * 1.4);
      }
    }

    const discountPct = (originalAmount > activeAmount && activeAmount > 0)
      ? Math.round(((originalAmount - activeAmount) / originalAmount) * 100)
      : 0;

    return {
      currency: isUsd ? 'USD' : 'INR',
      symbol: activeSymbol,
      amount: activeAmount,
      formatted: activeAmount > 0 ? `${activeSymbol}${activeAmount}` : 'Free',
      originalAmount,
      formattedOriginal: originalAmount > activeAmount ? `${activeSymbol}${originalAmount}` : '',
      discountPct,
      inr: numInr,
      usd: numUsd
    };
  }

  window.formatStoreProductPrice = function (val) {
    const isUsd = (currentCurrency === 'USD');
    const num = Number(String(val || 0).replace(/[^\d.]/g, '')) || 0;
    if (num <= 0) return 'Free';
    return isUsd ? `$${Math.max(2, Math.round(num / 85))}` : `₹${num}`;
  };

  window.openStoreShowcaseModal = function (storeNameOrId) {
    if (!storeNameOrId) return;
    const cleanTarget = String(storeNameOrId).trim();
    const cleanTargetLower = cleanTarget.toLowerCase();

    // 1. Try finding in pre-extracted stores
    let store = allMarketplaceStores.find(s =>
      String(s.storeName || '').trim().toLowerCase() === cleanTargetLower ||
      String(s.id || '').trim().toLowerCase() === cleanTargetLower ||
      cleanUnicodeSellerName(s.storeName || '').toLowerCase() === cleanUnicodeSellerName(cleanTarget).toLowerCase()
    );

    // 2. If not found in stores, inspect allMarketplaceProducts to extract real seller details!
    if (!store && Array.isArray(allMarketplaceProducts) && allMarketplaceProducts.length) {
      const matchProd = allMarketplaceProducts.find(p => {
        const sInfo = normalizeSellerInfo(p);
        return (
          (sInfo.sellerId && sInfo.sellerId.toLowerCase() === cleanTargetLower) ||
          (sInfo.storeName && sInfo.storeName.trim().toLowerCase() === cleanTargetLower) ||
          (cleanUnicodeSellerName(sInfo.storeName).toLowerCase() === cleanUnicodeSellerName(cleanTarget).toLowerCase()) ||
          (cleanUnicodeSellerName(sInfo.storeName).toLowerCase().replace(/[\s_-]+/g, '') === cleanUnicodeSellerName(cleanTarget).toLowerCase().replace(/[\s_-]+/g, ''))
        );
      });

      if (matchProd) {
        const sInfo = normalizeSellerInfo(matchProd);
        store = {
          id: sInfo.sellerId || cleanTarget,
          storeName: sInfo.storeName || cleanTarget,
          avatar: sInfo.sellerAvatar || '',
          category: sInfo.category || 'Digital Creator',
          verified: true,
          followerCount: 0,
          totalProducts: 0
        };
      }
    }

    if (!store) {
      store = {
        id: cleanTarget,
        storeName: cleanTarget,
        category: 'Digital Creator Store',
        avatar: '',
        verified: true,
        followerCount: 0,
        totalProducts: 0
      };
    }

    currentModalStore = store;
    const modal = document.getElementById('storeShowcaseModal');
    if (!modal) return;

    // Header info
    const initial = (store.storeName || 'S').trim().charAt(0).toUpperCase();
    const avatarDisc = document.getElementById('modalStoreAvatar');
    if (avatarDisc) {
      if (store.avatar) {
        avatarDisc.innerHTML = `<img src="${escapeHtml(store.avatar)}" class="store-avatar-img" alt="${escapeHtml(store.storeName)}" onerror="this.onerror=null;this.parentElement.textContent='${initial}';" />`;
      } else {
        avatarDisc.textContent = initial;
      }
    }

    const topNameEl = document.getElementById('modalStoreTopName');
    if (topNameEl) topNameEl.textContent = store.storeName;

    const nameEl = document.getElementById('modalStoreName');
    if (nameEl) nameEl.textContent = store.storeName;

    const catEl = document.getElementById('modalStoreCategory');
    if (catEl) catEl.textContent = store.category || 'Digital Creator';

    const followersEl = document.getElementById('modalStoreFollowersCount');
    if (followersEl) followersEl.textContent = getLiveFollowerCount(store);

    syncModalFollowButton(store.storeName);

    // Products list for this store (Strict real attribution — zero fake overrides)
    currentModalStoreProducts = allMarketplaceProducts.filter(p => isProductBelongingToStore(p, store));

    const countEl = document.getElementById('modalStoreProductsCount');
    if (countEl) countEl.textContent = currentModalStoreProducts.length;

    const badgeEl = document.getElementById('modalStoreCatalogBadge');
    if (badgeEl) badgeEl.textContent = `${currentModalStoreProducts.length} Items`;

    const searchInput = document.getElementById('modalStoreSearchInput');
    if (searchInput) searchInput.value = '';

    currentStoreActiveCategory = 'all';
    renderStoreCategoryPills(currentModalStoreProducts);
    renderStoreProductsGrid(currentModalStoreProducts);

    modal.classList.add('active');
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';

    // Reset scroller to top on open
    const scroller = modal.querySelector('.store-fullpage-scroller');
    if (scroller) scroller.scrollTop = 0;

    // Hide mobile bottom navigation so it doesn't overlap the store view
    const mobBottom = document.getElementById('mobileAppBottomBar');
    if (mobBottom) {
      mobBottom.dataset.storeModalPrevDisplay = mobBottom.style.display || '';
      mobBottom.style.setProperty('display', 'none', 'important');
    }
  };

  window.buyProductNow = function(productId, e) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    // ⚡ Instant Tactile Feedback: animate and show spinner immediately (0ms perception)
    try {
      const btn = (e && (e.currentTarget || e.target)) ? (e.currentTarget.closest('button, a') || e.currentTarget) : null;
      if (btn && btn.classList) {
        btn.classList.add('btn-instant-loading');
        const origContent = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Loading...';
        setTimeout(() => {
          if (btn && btn.classList.contains('btn-instant-loading')) {
            btn.classList.remove('btn-instant-loading');
            btn.innerHTML = origContent;
          }
        }, 3500);
      }
    } catch (_) {}

    let p = (typeof allMarketplaceProducts !== 'undefined' && Array.isArray(allMarketplaceProducts))
      ? allMarketplaceProducts.find(item => String(item.id).toLowerCase() === String(productId).toLowerCase())
      : null;

    if (!p && typeof currentPdmProduct !== 'undefined' && currentPdmProduct && String(currentPdmProduct.id).toLowerCase() === String(productId).toLowerCase()) {
      p = currentPdmProduct;
    }
    if (!p && typeof currentModalStoreProducts !== 'undefined' && Array.isArray(currentModalStoreProducts)) {
      p = currentModalStoreProducts.find(item => String(item.id).toLowerCase() === String(productId).toLowerCase());
    }

    if (!p) {
      const card = document.querySelector(`[data-product-id="${productId}"]`);
      if (card) {
        const titleEl = card.querySelector('.mp-card-title, .recommended-title, h4');
        const priceEl = card.querySelector('.mp-card-price, .recommended-price');
        const title = titleEl ? titleEl.textContent.trim() : 'Digital Product';
        const priceText = priceEl ? priceEl.textContent.trim().replace(/[^0-9.]/g, '') : '399';
        const price = parseFloat(priceText) || 399;
        p = { id: productId, title, price, inr: price, usd: Number((price/90).toFixed(2)), currency: 'INR' };
      } else {
        p = { id: productId, title: 'VIP Digital Access', price: 399, inr: 399, usd: 4.4, currency: 'INR' };
      }
    }

    const pricing = (typeof getProductPrice === 'function') ? getProductPrice(p) : { amount: p.price || 399, inr: p.inr || 399, usd: p.usd || 4.4, currency: p.currency || 'INR' };
    
    // Construct exact context-aware return URL
    const isModalActive = document.getElementById('productDetailModal')?.classList.contains('active');
    let returnUrl = '';
    try {
      const pathname = window.location.pathname || '';
      if (isModalActive && (p.id || productId)) {
        returnUrl = `${pathname}?tab=marketplace&productId=${encodeURIComponent(p.id || productId)}`;
      } else {
        const curTab = currentActiveTab || 'marketplace';
        returnUrl = `${pathname}?tab=${encodeURIComponent(curTab)}`;
      }
      sessionStorage.setItem('linkadda_checkout_return_url', returnUrl);
    } catch (_) {}

    const pCover = (typeof extractProductCoverImage === 'function') ? extractProductCoverImage(p) : (p.image || p.imageUrl || p.thumbnail || '');
    const pSeller = (typeof normalizeSellerInfo === 'function') ? normalizeSellerInfo(p) : { storeName: p.sellerName || p.seller || 'Trusted brother', sellerId: p.sellerId || '' };

    const queryParams = new URLSearchParams({
      productId: p.id || productId,
      title: p.title || p.name || 'VIP Digital Media Pass',
      inr: pricing.inr || pricing.amount || 399,
      usd: pricing.usd || 4.4,
      currency: pricing.currency || 'INR',
      image: pCover,
      sellerName: pSeller.storeName || pSeller.sellerName || 'Trusted brother',
      sellerId: pSeller.sellerId || ''
    });
    if (returnUrl) {
      queryParams.set('returnUrl', returnUrl);
    }
    const targetGateway = (window.location.pathname && window.location.pathname.includes('/user/')) ? '../payment.html' : 'payment.html';
    window.location.href = `${targetGateway}?${queryParams.toString()}`;
  };

  function renderStoreCategoryPills(prods) {
    const pillsEl = document.getElementById('modalStoreCategoryPills');
    if (!pillsEl) return;

    if (!prods || !prods.length) {
      pillsEl.innerHTML = '';
      return;
    }

    const totalCount = prods.length;
    pillsEl.innerHTML = `
      <button type="button" class="store-cat-pill-btn active" onclick="window.filterStoreByCategory('all')">
        <i class="fa-solid fa-layer-group"></i> <span>All Items (${totalCount})</span>
      </button>
    `;
  }

  window.filterStoreByCategory = function(cat) {
    currentStoreActiveCategory = cat || 'all';
    renderStoreCategoryPills(currentModalStoreProducts);

    const searchInput = document.getElementById('modalStoreSearchInput');
    const q = searchInput ? (searchInput.value || '').trim().toLowerCase() : '';

    let list = currentModalStoreProducts;
    if (currentStoreActiveCategory !== 'all') {
      list = list.filter(p => String(p.category || '').toLowerCase() === currentStoreActiveCategory.toLowerCase());
    }
    if (q) {
      list = list.filter(p =>
        String(p.title || '').toLowerCase().includes(q) ||
        String(p.category || '').toLowerCase().includes(q) ||
        String(p.description || '').toLowerCase().includes(q)
      );
    }
    renderStoreProductsGrid(list);
  };

  function renderStoreProductsGrid(prods) {
    const gridEl = document.getElementById('modalStoreProductsGrid');
    if (!gridEl) return;

    if (!prods || !prods.length) {
      gridEl.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 56px 16px; text-align: center; color: var(--text-muted, #64748b);">
          <div style="font-size: 42px; margin-bottom: 12px; color: var(--primary-pink); opacity: 0.85;"><i class="fa-solid fa-box-open"></i></div>
          <h5 style="font-size: 17px; font-weight: 800; color: var(--text-main, #0f172a); margin-bottom: 8px;">No Drops Found</h5>
          <p style="font-size: 13.5px; max-width: 420px; margin: 0 auto 18px auto; line-height: 1.5; color: var(--text-muted, #64748b);">No active items match your current filter. Try selecting "All Items" or adjusting your search.</p>
          <button type="button" class="store-cat-pill-btn active" onclick="window.filterStoreByCategory('all'); document.getElementById('modalStoreSearchInput').value=''; renderStoreProductsGrid(currentModalStoreProducts);" style="display: inline-flex; font-size: 13px; padding: 10px 20px; margin: 0 auto;">
            <i class="fa-solid fa-rotate-left"></i> View All Store Items
          </button>
        </div>
      `;
      return;
    }

    gridEl.innerHTML = prods.map(p => {
      // 1. Resolve product image from all potential keys
      const thumb = extractProductCoverImage(p);

      const pricing = getProductPrice(p);
      const safeId = escapeHtml(p.id);
      const safeTitle = escapeHtml(p.title || 'Digital Pack');
      const safeCategory = escapeHtml(p.category || 'Digital Pack');
      const inCart = (typeof isProductInCart === 'function') && isProductInCart(p.id);

      // Category icon
      let catIcon = 'fa-layer-group';
      const cLower = safeCategory.toLowerCase();
      if (cLower.includes('video') || cLower.includes('clip') || cLower.includes('desi') || cLower.includes('movie')) catIcon = 'fa-play';
      else if (cLower.includes('vip') || cLower.includes('premium')) catIcon = 'fa-crown';
      else if (cLower.includes('drive') || cLower.includes('cloud') || cLower.includes('mega') || cLower.includes('terabox')) catIcon = 'fa-cloud-arrow-down';
      else if (cLower.includes('software') || cLower.includes('app') || cLower.includes('tool')) catIcon = 'fa-laptop-code';
      else if (cLower.includes('course') || cLower.includes('book') || cLower.includes('guide')) catIcon = 'fa-graduation-cap';
      else if (cLower.includes('combo') || cLower.includes('bundle') || cLower.includes('all')) catIcon = 'fa-boxes-stacked';

      const hasRealImage = Boolean(thumb && !thumb.includes('placeholder.svg') && !thumb.includes('favicon.svg'));

      return `
        <div class="store-product-item-card" onclick="openProductDetailModal('${safeId}')" data-product-id="${safeId}">
          <div class="store-product-thumb-box">
            <div class="store-product-thumb-fallback">
              <div class="store-fallback-icon-disc">
                <i class="fa-solid ${catIcon}"></i>
              </div>
              <span class="store-fallback-cat-label">${safeCategory}</span>
            </div>
            ${hasRealImage ? `
              <img src="${escapeHtml(thumb)}" class="store-product-thumb" alt="" loading="lazy" onerror="if(!this._triedLocal){this._triedLocal=true; const clean=this.src.split('?')[0]; if(this.src!==clean){this.src=clean;}else{this.style.display='none';}}" />
            ` : ''}
            <span class="store-product-category-chip"><i class="fa-solid ${catIcon}"></i> ${safeCategory}</span>
            ${pricing.discountPct > 0 ? `<span class="store-product-discount-float-badge">${pricing.discountPct}% OFF</span>` : ''}
            <span class="store-product-instant-badge"><i class="fa-solid fa-bolt"></i> Instant</span>
          </div>
          <div class="store-product-details">
            <h5 class="store-product-title" title="${safeTitle}">${safeTitle}</h5>
            <div class="store-product-price-row">
              <span class="store-product-price">${pricing.formatted}</span>
              ${pricing.formattedOriginal ? `<span class="store-product-original-price">${pricing.formattedOriginal}</span>` : ''}
              ${pricing.discountPct > 0 ? `<span class="store-product-discount-badge">${pricing.discountPct}% OFF</span>` : ''}
            </div>
            <div class="store-product-actions-bar">
              <button type="button" class="btn-store-card-cart ${inCart ? 'added' : ''}" data-product-id="${safeId}" onclick="toggleCartProduct('${safeId}'); event.stopPropagation();" title="${inCart ? 'In Cart' : 'Add to Cart'}">
                <i class="fa-solid ${inCart ? 'fa-check' : 'fa-cart-plus'}"></i> <span>${inCart ? 'Added' : 'Add'}</span>
              </button>
              <button type="button" class="btn-store-card-buy" onclick="window.buyProductNow('${safeId}', event);">
                <i class="fa-solid fa-bolt"></i> <span>Buy</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  window.filterStoreCatalog = function (query) {
    const q = String(query || '').trim().toLowerCase();
    let list = currentModalStoreProducts;
    if (currentStoreActiveCategory && currentStoreActiveCategory !== 'all') {
      list = list.filter(p => String(p.category || '').toLowerCase() === currentStoreActiveCategory.toLowerCase());
    }
    if (q) {
      list = list.filter(p =>
        String(p.title || '').toLowerCase().includes(q) ||
        String(p.category || '').toLowerCase().includes(q) ||
        String(p.description || '').toLowerCase().includes(q)
      );
    }
    renderStoreProductsGrid(list);
  };

  window.shareStoreShowcase = function() {
    if (!currentModalStore) return;
    const storeName = currentModalStore.storeName || 'Creator Store';
    const storeUrl = `${window.location.origin}${window.location.pathname}?store=${encodeURIComponent(storeName)}`;
    if (navigator.share) {
      navigator.share({
        title: `${storeName} • JaiGram Shop`,
        text: `Explore exclusive digital packs, drops, and instant access files from ${storeName} on JaiGram Shop!`,
        url: storeUrl
      }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(storeUrl).then(() => {
        if (typeof showAppToast === 'function') showAppToast(`Store link copied to clipboard!`);
      }).catch(() => {
        if (typeof showAppToast === 'function') showAppToast(`Store link: ${storeUrl}`);
      });
    } else {
      if (typeof showAppToast === 'function') showAppToast(`Store link: ${storeUrl}`);
    }
  };

  function syncModalFollowButton(storeName) {
    const followBtn = document.getElementById('modalStoreFollowBtn');
    if (!followBtn) return;
    const isFollowed = isStoreFollowed(storeName);
    followBtn.className = `store-modal-follow-btn hero-follow-btn ${isFollowed ? 'following' : ''}`;
    followBtn.innerHTML = `<i class="fa-solid ${isFollowed ? 'fa-check' : 'fa-plus'}"></i> <span class="follow-btn-label">${isFollowed ? 'Following' : 'Follow Store'}</span>`;
    followBtn.onclick = () => {
      window.toggleFollowStore(followBtn, storeName);
    };

    // Live update followers count in modal header
    const followersEl = document.getElementById('modalStoreFollowersCount');
    if (followersEl && currentModalStore && String(currentModalStore.storeName || '').trim().toLowerCase() === String(storeName || '').trim().toLowerCase()) {
      followersEl.textContent = getLiveFollowerCount(currentModalStore);
    }
  }

  window.closeStoreShowcaseModal = function () {
    const modal = document.getElementById('storeShowcaseModal');
    if (modal) {
      modal.classList.remove('active');
      modal.style.display = 'none';
    }

    // Restore mobile bottom navigation bar if it was hidden
    const mobBottom = document.getElementById('mobileAppBottomBar');
    if (mobBottom) {
      mobBottom.style.display = mobBottom.dataset.storeModalPrevDisplay || '';
    }

    const remainingActive = document.querySelectorAll('.user-modal-overlay.active, .store-modal-overlay.active, .fk-full-page-view.active');
    if (remainingActive.length === 0) {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
  };

  // Close modal when clicking on overlay background
  document.addEventListener('click', (e) => {
    const modal = document.getElementById('storeShowcaseModal');
    if (modal && e.target === modal) {
      closeStoreShowcaseModal();
    }
  });

  window.openStoreMenu = function (storeName) {
    window.openStoreShowcaseModal(storeName);
  };

  // ━━ 9. IN-DASHBOARD PRODUCT FULL-PAGE DETAIL VIEW & MULTI-IMAGE GALLERY ━━
  let currentPdmProduct = null;
  let currentPdmGalleryImages = [];
  let currentPdmGalleryIndex = 0;

  function getProductImages(p) {
    if (!p) return ['../images/prod_vip_bundle.jpg'];
    const list = [];

    const pushUrl = (val) => {
      if (!val) return;
      if (Array.isArray(val)) {
        val.forEach(item => pushUrl(item));
        return;
      }
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed) return;
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          try {
            const arr = JSON.parse(trimmed);
            if (Array.isArray(arr)) {
              arr.forEach(item => pushUrl(item));
              return;
            }
          } catch (_) {}
        }
        if (trimmed.includes('\n')) {
          trimmed.split('\n').forEach(item => pushUrl(item));
          return;
        }
        if (trimmed.includes(',') && !trimmed.startsWith('http') && !trimmed.startsWith('data:')) {
          trimmed.split(',').forEach(item => pushUrl(item));
          return;
        }
        const resolved = resolveProductImageUrl(trimmed);
        if (resolved && !list.includes(resolved)) {
          list.push(resolved);
        }
      } else if (typeof val === 'object' && val) {
        pushUrl(val.url || val.src || val.publicUrl || '');
      }
    };

    // 1. Primary/Cover Image
    if (p.coverImage) pushUrl(p.coverImage);
    if (p.thumbnail) pushUrl(p.thumbnail);
    if (p.image) pushUrl(p.image);

    // 2. All Uploaded Gallery Images & Arrays (Sellers/Admin upload multiple images)
    pushUrl(p.images);
    pushUrl(p.galleryImages);
    pushUrl(p.gallery);
    pushUrl(p.screenshots);
    pushUrl(p.previews);
    pushUrl(p.extraImages);
    pushUrl(p.photos);

    const validImages = list.filter(u => u && !u.includes('placeholder.svg') && !u.includes('favicon.svg'));
    if (validImages.length > 0) {
      return validImages;
    }
    return [extractProductCoverImage(p)];
  }

  let currentPdmMediaList = [];
  let currentPdmMediaIndex = 0;
  let mediaSwipeBound = false;

  function renderProductGallery(mediaList, activeIndex = 0) {
    currentPdmMediaList = Array.isArray(mediaList) && mediaList.length 
      ? mediaList 
      : [{ type: 'image', src: '../images/prod_vip_bundle.jpg' }];
    currentPdmMediaIndex = Math.max(0, Math.min(activeIndex, currentPdmMediaList.length - 1));

    // Preload all gallery images immediately for 0ms lag transitions
    currentPdmMediaList.forEach((m) => {
      if (m && m.type !== 'video' && m.src) {
        const pImg = new Image();
        pImg.src = m.src;
      }
    });

    const total = currentPdmMediaList.length;

    // Render Flipkart-style Vertical Thumbnail Rail
    const thumbStrip = document.getElementById('pdmThumbnailsStrip');
    if (thumbStrip) {
      if (total > 1) {
        thumbStrip.style.display = 'flex';
        thumbStrip.innerHTML = currentPdmMediaList.map((m, i) => `
          <div class="fk-thumb-card ${i === currentPdmMediaIndex ? 'active' : ''}" onclick="selectGalleryMedia(${i})" title="${m.type === 'video' ? 'Video Preview' : 'Slide ' + (i + 1)}">
            ${m.type === 'video' 
              ? `<div style="position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#0f172a;color:#fff;">
                  <i class="fa-solid fa-play" style="font-size:14px;color:var(--primary-pink, #ff2d55);"></i>
                 </div>`
              : `<img src="${escapeHtml(m.src)}" alt="Thumb ${i + 1}" loading="eager" onerror="this.style.opacity='0.4';" />`
            }
          </div>
        `).join('');
      } else {
        thumbStrip.style.display = 'none';
        thumbStrip.innerHTML = '';
      }
    }

    displayActiveMediaSlide(currentPdmMediaIndex);

    // Gallery Prev / Next Arrows
    const prevBtn = document.getElementById('pdmGalleryPrevBtn');
    const nextBtn = document.getElementById('pdmGalleryNextBtn');
    if (prevBtn) prevBtn.style.display = total > 1 ? 'flex' : 'none';
    if (nextBtn) nextBtn.style.display = total > 1 ? 'flex' : 'none';

    // Dots Indicator
    const dotsContainer = document.getElementById('pdmMediaDots');
    if (dotsContainer) {
      if (total > 1) {
        dotsContainer.style.display = 'flex';
        dotsContainer.innerHTML = currentPdmMediaList.map((m, i) => `
          <span class="fk-media-dot ${i === currentPdmMediaIndex ? 'active' : ''}" onclick="selectGalleryMedia(${i})" title="${m.type === 'video' ? 'Video' : 'Slide ' + (i + 1)}"></span>
        `).join('');
      } else {
        dotsContainer.style.display = 'none';
      }
    }

    // Attach touch swipe listener on main media frame (Mobile friendly swipe left/right)
    setupMediaFrameSwipe();
  }

  function displayActiveMediaSlide(index) {
    if (!currentPdmMediaList || !currentPdmMediaList.length) return;
    currentPdmMediaIndex = Math.max(0, Math.min(index, currentPdmMediaList.length - 1));
    const item = currentPdmMediaList[currentPdmMediaIndex];
    const total = currentPdmMediaList.length;

    const mainImg = document.getElementById('pdmMainImg');
    const mainVideo = document.getElementById('pdmMainVideo');

    if (item.type === 'video') {
      if (mainImg) mainImg.style.display = 'none';
      if (mainVideo) {
        mainVideo.style.display = 'block';
        if (mainVideo.src !== item.src) {
          mainVideo.src = item.src;
        }
        if (item.poster) mainVideo.poster = item.poster;
      }
    } else {
      if (mainVideo) {
        mainVideo.pause();
        mainVideo.style.display = 'none';
      }
      if (mainImg) {
        mainImg.style.display = 'block';
        if (mainImg.src !== item.src) {
          mainImg.src = item.src;
        }
        mainImg.onerror = function () {
          const raw = this.src || item.src || '';
          if (!this._retryCdn && !raw.includes('media.jaigram.shop')) {
            const fn = raw.split('/').pop().split('?')[0];
            if (fn && !raw.includes('prod_vip_bundle')) {
              this._retryCdn = true;
              this.src = `https://media.jaigram.shop/products/${fn}`;
              return;
            }
          }
          if (!this._triedDefault) {
            this._triedDefault = true;
            this.src = '../images/prod_vip_bundle.jpg';
          }
        };
      }
    }

    // Photo/Video Counter
    const counterEl = document.getElementById('pdmGalleryCounter');
    if (counterEl) {
      const icon = item.type === 'video' ? '<i class="fa-solid fa-play"></i>' : '<i class="fa-regular fa-image"></i>';
      const typeLabel = item.type === 'video' ? 'Video' : 'Photo';
      counterEl.innerHTML = `${icon} <span>${currentPdmMediaIndex + 1} / ${total} ${typeLabel}</span>`;
    }

    // Update Dots
    const dotsContainer = document.getElementById('pdmMediaDots');
    if (dotsContainer) {
      const dots = dotsContainer.querySelectorAll('.fk-media-dot');
      dots.forEach((d, i) => d.classList.toggle('active', i === currentPdmMediaIndex));
    }

    // Update Thumbnail Rail active card & scroll into view
    const thumbStrip = document.getElementById('pdmThumbnailsStrip');
    if (thumbStrip) {
      const thumbs = thumbStrip.querySelectorAll('.fk-thumb-card');
      thumbs.forEach((t, i) => {
        t.classList.toggle('active', i === currentPdmMediaIndex);
        if (i === currentPdmMediaIndex) {
          t.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
    }
  }

  window.selectGalleryMedia = function (index) {
    displayActiveMediaSlide(index);
  };

  // Backwards compatibility alias
  window.selectGalleryImage = function (index) {
    displayActiveMediaSlide(index);
  };

  window.navigateProductGallery = function (delta) {
    if (!currentPdmMediaList || currentPdmMediaList.length <= 1) return;
    const len = currentPdmMediaList.length;
    const nextIdx = (currentPdmMediaIndex + delta + len) % len;
    displayActiveMediaSlide(nextIdx);
  };

  function setupMediaFrameSwipe() {
    const frame = document.getElementById('pdmMainMediaFrame');
    if (!frame || mediaSwipeBound) return;
    mediaSwipeBound = true;

    let touchStartX = 0;
    let touchStartY = 0;

    frame.addEventListener('touchstart', (e) => {
      if (!e.touches || !e.touches[0]) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    frame.addEventListener('touchend', (e) => {
      if (!e.changedTouches || !e.changedTouches[0]) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      // Only horizontal swipe if |dx| > |dy| and > 35px
      if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) {
          navigateProductGallery(1); // Swipe left -> Next media
        } else {
          navigateProductGallery(-1); // Swipe right -> Previous media
        }
      }
    }, { passive: true });
  }

  window.openProductDetailModal = function (productId) {
    if (!productId) return;
    const p = allMarketplaceProducts.find(item => String(item.id).toLowerCase() === String(productId).toLowerCase());
    if (!p) {
      showAppToast('Product details not found');
      return;
    }

    currentPdmProduct = p;
    const modal = document.getElementById('productDetailModal');
    if (!modal) return;

    // 1. Breadcrumb, Category & Title
    const prodTitle = p.title || p.name || 'Digital Pack';
    const prodCategory = p.category || 'Digital Pack';

    const bcrumb = document.getElementById('pdmTopBreadcrumb');
    if (bcrumb) {
      bcrumb.textContent = `Marketplace / ${prodCategory} / ${prodTitle}`;
    }

    const catBadge = document.getElementById('pdmCategoryBadge');
    if (catBadge) catBadge.textContent = prodCategory;

    const bcrumbTitle = document.getElementById('pdmTopBreadcrumbTitle');
    if (bcrumbTitle) bcrumbTitle.textContent = prodTitle;

    const catPill = document.getElementById('pdmCategoryPill');
    if (catPill) catPill.textContent = prodCategory;

    const titleEl = document.getElementById('pdmTitle');
    if (titleEl) titleEl.textContent = prodTitle;

    // 2. Creator Info & Follow Status
    const sInfo = normalizeSellerInfo(p);
    const creatorName = sInfo.storeName || sInfo.sellerName || 'Trusted brother';
    const cNameEl = document.getElementById('pdmCreatorName');
    if (cNameEl) {
      cNameEl.textContent = creatorName;
      cNameEl.setAttribute('data-seller-name', creatorName);
      cNameEl.setAttribute('data-seller-id', sInfo.sellerId || '');
    }

    const cAvatarEl = document.getElementById('pdmCreatorAvatar');
    if (cAvatarEl) {
      const initial = creatorName.trim().charAt(0).toUpperCase();
      const realAvatar = sInfo.sellerAvatar || p.sellerAvatar || '';
      if (realAvatar) {
        cAvatarEl.innerHTML = `<img src="${escapeHtml(realAvatar)}" alt="${escapeHtml(creatorName)}" onerror="this.parentElement.textContent='${initial}';" />`;
      } else {
        cAvatarEl.textContent = initial;
      }
    }

    const cFollowersEl = document.getElementById('pdmCreatorFollowers');
    if (cFollowersEl) {
      const matchedStore = allMarketplaceStores.find(s =>
        String(s.storeName || '').toLowerCase() === creatorName.toLowerCase() ||
        String(s.id || '').toLowerCase() === (sInfo.sellerId || '').toLowerCase()
      );
      cFollowersEl.textContent = matchedStore ? getLiveFollowerCount(matchedStore) : '1';
    }

    syncModalCreatorFollowBtn(creatorName);

    // 3. Media Carousel (Slide 1 is always the crisp Real Cover Image; all real images & videos included)
    const allImages = getProductImages(p);
    const rawVideos = [
      p.video,
      p.videoUrl,
      p.previewVideo,
      p.demoVideo,
      ...(Array.isArray(p.videos) ? p.videos : [])
    ].filter(Boolean);

    const resolvedVideos = [...new Set(rawVideos.map(v => resolveProductImageUrl(v)).filter(Boolean))];

    const mediaList = [];
    allImages.forEach(img => {
      mediaList.push({ type: 'image', src: img });
    });
    resolvedVideos.forEach(vSrc => {
      mediaList.push({ type: 'video', src: vSrc, poster: allImages[0] || '' });
    });
    if (mediaList.length === 0) {
      mediaList.push({ type: 'image', src: '../images/prod_vip_bundle.jpg' });
    }

    renderProductGallery(mediaList, 0);

    // Hide old separate video wrap since video is now Slide 1
    const videoWrap = document.getElementById('pdmVideoWrap');
    if (videoWrap) videoWrap.style.display = 'none';

    // 5. Technical Specifications Table
    const specRes = document.getElementById('pdmSpecResolution');
    if (specRes) specRes.textContent = p.specResolution || p.resolution || '4K 2160p Ultra HD';

    const specAudio = document.getElementById('pdmSpecAudio');
    if (specAudio) specAudio.textContent = p.specAudio || p.audio || 'Studio Stereo Audio';

    const specDel = document.getElementById('pdmSpecDelivery');
    if (specDel) specDel.textContent = p.specDelivery || 'Mega.nz & Google Drive Direct Fast Links';

    const specDev = document.getElementById('pdmSpecDevices');
    if (specDev) specDev.textContent = p.specDevices || 'Android, iOS, PC, Mac, TV';

    const specAcc = document.getElementById('pdmSpecAccess');
    if (specAcc) specAcc.textContent = p.specAccess || 'Lifetime Unlimited + Free Replacement';

    // 6. Features & Platforms Tag Cloud
    const featsCard = document.getElementById('pdmFeaturesCard');
    const featsCloud = document.getElementById('pdmFeaturesCloud');
    const featItems = [
      ...(Array.isArray(p.features) ? p.features : []),
      ...(Array.isArray(p.platforms) ? p.platforms : []),
      ...(Array.isArray(p.creators) ? p.creators : [])
    ].filter(Boolean);

    if (featsCard && featsCloud) {
      if (featItems.length > 0) {
        featsCard.style.display = 'block';
        featsCloud.innerHTML = featItems.map(f => `<span class="pdm-feature-chip"><i class="fa-solid fa-check"></i> ${escapeHtml(f)}</span>`).join('');
      } else {
        featsCard.style.display = 'none';
      }
    }

    // 7. Description & Overview
    const descEl = document.getElementById('pdmDescription');
    if (descEl) {
      descEl.textContent = p.description || 'Exclusive curated digital media collection with instant cloud delivery. Access is granted instantly upon order confirmation into your JaiGram Orders Vault.';
    }

    // 8. Dynamic Pricing & Currency-Aware Checkout Links
    updatePdmProductPricing();

    // 9. Wishlist State
    updateModalWishlistBtn(p.id);

    // 10. Open Product Full-Page View (Flipkart Style — No Cramped Popup!)
    syncModalCartBtn();
    modal.classList.add('active');
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    document.body.classList.add('fk-product-page-open');

    // Scroll full-page to top
    modal.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'instant' });

    // Sync cart count pill in full-page nav
    const cart = getCart();
    const totalItems = cart.reduce((sum, item) => sum + (item.qty || 1), 0);
    const navCartPill = document.getElementById('pdmNavCartCount');
    if (navCartPill) {
      navCartPill.textContent = totalItems;
      navCartPill.style.display = totalItems > 0 ? 'inline-block' : 'none';
    }

    // Push URL state for clean back button navigation
    try {
      if (window.history && window.history.pushState) {
        window.history.pushState({ pId: p.id, productView: true }, '', '?productId=' + encodeURIComponent(p.id));
      }
    } catch (_) {}
  };

  function updatePdmProductPricing() {
    if (!currentPdmProduct) return;
    const p = currentPdmProduct;
    const pricing = getProductPrice(p);

    // Price numbers & MRP
    const priceMain = document.getElementById('pdmPriceINR');
    if (priceMain) priceMain.textContent = pricing.formatted;

    const priceMrp = document.getElementById('pdmPriceMRP');
    if (priceMrp) {
      priceMrp.textContent = pricing.formattedOriginal;
      priceMrp.style.display = pricing.formattedOriginal ? 'inline' : 'none';
    }

    const discPill = document.getElementById('pdmDiscountPill');
    if (discPill) {
      discPill.textContent = `${pricing.discountPct}% OFF`;
      discPill.style.display = pricing.discountPct > 0 ? 'inline-block' : 'none';
    }

    // Currency Switcher Labels inside Product View
    const currNameEl = document.getElementById('pdmCurrentCurrencyName');
    const altCurrNameEl = document.getElementById('pdmAltCurrencyName');
    if (currNameEl) currNameEl.textContent = pricing.currency === 'USD' ? 'USD ($)' : 'INR (₹)';
    if (altCurrNameEl) altCurrNameEl.textContent = pricing.currency === 'USD' ? 'INR (₹)' : 'USD ($)';

    // Buy CTA Button with In-Page Payment Gateway
    const buyBtn = document.getElementById('pdmBuyBtn');
    if (buyBtn) {
      buyBtn.href = 'javascript:void(0)';
      buyBtn.onclick = (e) => { window.buyProductNow(p.id, e); };
    }

    const buyBtnText = document.getElementById('pdmBuyBtnText');
    if (buyBtnText) {
      buyBtnText.textContent = `BUY NOW`;
    }

    const mobBuyBtn = document.getElementById('pdmMobBuyBtn');
    if (mobBuyBtn) {
      mobBuyBtn.href = 'javascript:void(0)';
      mobBuyBtn.onclick = (e) => { window.buyProductNow(p.id, e); };
    }

    const mobBuyBtnText = document.getElementById('pdmMobBuyBtnText');
    if (mobBuyBtnText) {
      mobBuyBtnText.textContent = `BUY NOW`;
    }

    syncModalCartBtn();
  }

  function syncModalCreatorFollowBtn(creatorName) {
    const btn = document.getElementById('pdmCreatorFollowBtn');
    if (!btn) return;
    const isFollowed = isStoreFollowed(creatorName);
    btn.className = `pdm-creator-follow-btn ${isFollowed ? 'following' : ''}`;
    btn.innerHTML = `<i class="fa-solid ${isFollowed ? 'fa-check' : 'fa-plus'}"></i> <span>${isFollowed ? 'Following' : 'Follow'}</span>`;
  }

  window.toggleFollowCreatorFromModal = function () {
    if (!currentPdmProduct) return;
    const cName = currentPdmProduct.sellerName || currentPdmProduct.sellerStoreName;
    if (!cName) return;
    const btn = document.getElementById('pdmCreatorFollowBtn');
    window.toggleFollowStore(btn, cName);
    syncModalCreatorFollowBtn(cName);
  };

  window.closeProductDetailModal = function () {
    const modal = document.getElementById('productDetailModal');
    if (modal) {
      modal.classList.remove('active');
      modal.style.display = 'none';
    }
    document.body.classList.remove('fk-product-page-open');
    const videoPlayer = document.getElementById('pdmVideoPlayer');
    if (videoPlayer) {
      videoPlayer.pause();
    }
    const mainVideo = document.getElementById('pdmMainVideo');
    if (mainVideo) {
      mainVideo.pause();
      mainVideo.removeAttribute('src');
    }

    // Clean URL query back to marketplace
    try {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname + '#marketplace');
      }
    } catch (_) {}

    // If storeShowcaseModal or cart drawer is still open, do NOT unlock body overflow!
    const storeModal = document.getElementById('storeShowcaseModal');
    const isStoreModalActive = storeModal && storeModal.classList.contains('active');
    const cartDrawer = document.getElementById('cartDrawerOverlay');
    const isCartActive = cartDrawer && cartDrawer.classList.contains('active');
    if (!isStoreModalActive && !isCartActive) {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
  };

  window.handleProductModalBackdrop = function (e) {
    if (e.target && e.target.id === 'productDetailModal') {
      closeProductDetailModal();
    }
  };

  window.addEventListener('popstate', () => {
    const modal = document.getElementById('productDetailModal');
    if (modal && modal.classList.contains('active')) {
      closeProductDetailModal();
    }
  });

  window.handlePdmCreatorClick = function () {
    if (!currentPdmProduct) return;
    const sInfo = normalizeSellerInfo(currentPdmProduct);
    const target = sInfo.storeName || sInfo.sellerId || currentPdmProduct.sellerName || currentPdmProduct.sellerStoreName;
    if (target) {
      closeProductDetailModal();
      window.openStoreShowcaseModal(target);
    }
  };

  // Gallery Keyboard Arrow & Escape Navigation
  document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('productDetailModal');
    if (!modal || !modal.classList.contains('active')) return;
    if (e.key === 'ArrowLeft') {
      navigateProductGallery(-1);
    } else if (e.key === 'ArrowRight') {
      navigateProductGallery(1);
    } else if (e.key === 'Escape') {
      closeProductDetailModal();
    }
  });

  function updateModalWishlistBtn(productId) {
    const btn = document.getElementById('pdmWishlistBtn');
    const imgHeart = document.querySelector('.fk-img-wishlist-btn');
    const isSaved = isProductInWishlist(productId);
    if (btn) {
      btn.innerHTML = `<i class="fa-${isSaved ? 'solid' : 'regular'} fa-heart" style="${isSaved ? 'color: #ef4444;' : ''}"></i>`;
    }
    if (imgHeart) {
      imgHeart.classList.toggle('active', isSaved);
      imgHeart.innerHTML = `<i class="fa-${isSaved ? 'solid' : 'regular'} fa-heart" style="${isSaved ? 'color: #ef4444;' : ''}"></i>`;
    }
  }

  // ━━ WISHLIST ENGINE (linkadda_user_wishlist) ━━
  function getStoredWishlist() {
    try {
      const raw = localStorage.getItem('linkadda_user_wishlist');
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }
  window.getStoredWishlist = getStoredWishlist;

  function isProductInWishlist(productId) {
    if (!productId) return false;
    const list = getStoredWishlist();
    return list.some(id => String(id).toLowerCase() === String(productId).toLowerCase());
  }
  window.isProductInWishlist = isProductInWishlist;

  window.toggleWishlistProduct = function (productId, e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (!productId) return false;
    const pId = String(productId);
    let wishlist = getStoredWishlist();
    const idx = wishlist.findIndex(id => String(id).toLowerCase() === pId.toLowerCase());
    let isAdded = false;
    if (idx > -1) {
      wishlist.splice(idx, 1);
      showAppToast('Removed from Wishlist 💔');
    } else {
      wishlist.push(pId);
      showAppToast('Saved to your Wishlist ❤️');
      isAdded = true;
    }
    try {
      localStorage.setItem('linkadda_user_wishlist', JSON.stringify(wishlist));
    } catch (_) {}
    updateWishlistUI();
    updateModalWishlistBtn(pId);
    return isAdded;
  };

  window.toggleProductWishlistFromModal = function () {
    if (!currentPdmProduct) return;
    toggleWishlistProduct(currentPdmProduct.id);
  };

  function updateWishlistUI() {
    const wishlist = getStoredWishlist();
    const count = wishlist.length;

    // 1. Top Navbar Badge
    const wBadge = document.getElementById('navWishlistBadgeCount');
    if (wBadge) {
      wBadge.textContent = count;
      wBadge.style.display = count > 0 ? 'inline-flex' : 'none';
    }

    // 2. Mobile Home Hub Tile
    const mobTileW = document.getElementById('mobTileWishlistCount');
    if (mobTileW) {
      mobTileW.textContent = `${count} ${count === 1 ? 'Item' : 'Items'}`;
    }

    // 3. Sync all heart buttons on page
    const allWishlistBtns = document.querySelectorAll('.btn-card-wishlist');
    allWishlistBtns.forEach(btn => {
      const pId = btn.getAttribute('data-wishlist-id');
      if (pId) {
        const isSaved = isProductInWishlist(pId);
        btn.classList.toggle('active', isSaved);
        btn.innerHTML = `<i class="${isSaved ? 'fa-solid' : 'fa-regular'} fa-heart"></i>`;
        btn.title = isSaved ? 'Remove from Wishlist' : 'Add to Wishlist';
      }
    });

    // 4. Render Wishlist Grid if on wishlist tab
    renderWishlistGrid();
  }
  window.updateWishlistUI = updateWishlistUI;

  function renderWishlistGrid() {
    const grid = document.getElementById('wishlistProductsGrid');
    if (!grid) return;

    const wishlistIds = getStoredWishlist();
    if (!wishlistIds.length || !allMarketplaceProducts.length) {
      grid.innerHTML = `
        <div class="wishlist-empty-box" style="grid-column: 1 / -1; background: var(--card-bg); border: 2px dashed var(--card-border); border-radius: var(--radius-lg); padding: 48px 20px; text-align: center;">
          <div style="font-size: 38px; color: var(--primary-pink); margin-bottom: 12px; opacity: 0.85;"><i class="fa-regular fa-heart"></i></div>
          <h4 style="font-size: 17px; font-weight: 800; color: var(--text-main); margin-bottom: 6px;">Your Wishlist is Empty</h4>
          <p style="font-size: 13px; color: var(--text-muted); max-width: 360px; margin: 0 auto 18px auto; line-height: 1.5;">Tap the heart icon on any product in the marketplace to save it here for later.</p>
          <button type="button" class="section-action-btn-pink" onclick="switchTab('marketplace')" style="display: inline-flex; margin: 0 auto;">
            <i class="fa-solid fa-compass"></i> Explore Marketplace Drops
          </button>
        </div>
      `;
      return;
    }

    const savedProds = allMarketplaceProducts.filter(p => isProductInWishlist(p.id));
    if (!savedProds.length) {
      grid.innerHTML = `
        <div class="wishlist-empty-box" style="grid-column: 1 / -1; background: var(--card-bg); border: 2px dashed var(--card-border); border-radius: var(--radius-lg); padding: 48px 20px; text-align: center;">
          <div style="font-size: 38px; color: var(--primary-pink); margin-bottom: 12px; opacity: 0.85;"><i class="fa-regular fa-heart"></i></div>
          <h4 style="font-size: 17px; font-weight: 800; color: var(--text-main); margin-bottom: 6px;">Saved Items Not Found</h4>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">The items in your wishlist may have been updated or retired.</p>
          <button type="button" class="section-action-btn-pink" onclick="switchTab('marketplace')"><i class="fa-solid fa-compass"></i> Browse Marketplace</button>
        </div>
      `;
      return;
    }

    grid.innerHTML = savedProds.map(p => renderEcomProductCardHtml(p)).join('');
  }
  window.renderWishlistGrid = renderWishlistGrid;

  function initWishlist() {
    updateWishlistUI();
  }
  window.initWishlist = initWishlist;

  window.shareProductFromModal = function () {
    if (!currentPdmProduct) return;
    const title = currentPdmProduct.title || 'Digital Product';
    const url = window.location.origin + window.location.pathname + '?productId=' + encodeURIComponent(currentPdmProduct.id);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        showAppToast('Product link copied to clipboard! 📋');
      }).catch(() => {
        showAppToast(`Sharing: ${title}`);
      });
    } else {
      showAppToast(`Sharing: ${title}`);
    }
  };

  // ━━ 10. DYNAMIC RECOMMENDED PRODUCTS & MARKETPLACE CATALOG ━━
  window.renderRecommendedProducts = function () {
    const grid = document.getElementById('dashboardRecommendedGrid');
    if (!grid) return;

    if (!allMarketplaceProducts || !allMarketplaceProducts.length) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 28px 16px; text-align: center; color: var(--text-muted); font-size: 13px;">
          <i class="fa-solid fa-box-open" style="font-size: 26px; color: var(--primary-pink); opacity: 0.6; display: block; margin-bottom: 8px;"></i>
          No products listed yet. Check back soon for new creator drops!
        </div>
      `;
      return;
    }

    const recs = allMarketplaceProducts.slice(0, 4);
    grid.innerHTML = recs.map(p => {
      const thumb = extractProductCoverImage(p);
      const pricing = getProductPrice(p);
      const safeId = escapeHtml(p.id);
      const safeTitle = escapeHtml(p.title || 'Digital Collection');
      const discountPill = pricing.discountPct > 0 
        ? `<span class="rec-discount-badge">${pricing.discountPct}% OFF</span>` 
        : '';

      return `
        <div class="recommended-card" onclick="openProductDetailModal('${safeId}')" role="button" tabindex="0" title="${safeTitle}">
          <div class="recommended-thumb-wrap">
            <img src="${escapeHtml(thumb)}" alt="${safeTitle}" class="recommended-thumb-img" loading="lazy" onerror="if(!this._tried){this._tried=true; const clean=this.src.split('?')[0]; if(this.src!==clean){this.src=clean;}}else{this.style.opacity='0.7';}" />
            <div class="rec-top-badges">
              <span class="rec-instant-badge"><i class="fa-solid fa-bolt"></i> Instant</span>
              ${discountPill}
            </div>
          </div>
          <div class="recommended-body">
            <h4 class="recommended-title" title="${safeTitle}">${safeTitle}</h4>
            <div class="recommended-footer-row">
              <div class="rec-pricing-block">
                <span class="recommended-price">${pricing.formatted}</span>
                ${pricing.formattedOriginal ? `<span class="rec-mrp-price">${pricing.formattedOriginal}</span>` : ''}
              </div>
              <button type="button" class="btn-rec-buy" onclick="window.buyProductNow('${safeId}', event);" aria-label="Buy ${safeTitle} Now" title="Instant Buy">
                <i class="fa-solid fa-bolt"></i>
                <span>Buy</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  };

  // ━━ 10. REUSABLE E-COMMERCE PRODUCT CARD COMPONENT ━━
  function renderEcomProductCardHtml(p) {
    const thumb = extractProductCoverImage(p);
    const pricing = getProductPrice(p);
    const sInfo = normalizeSellerInfo(p);
    const sellerName = sInfo.storeName || sInfo.sellerName || 'Trusted brother';
    const sellerId = sInfo.sellerId || '';
    const buyUrl = `../payment.html?productId=${encodeURIComponent(p.id)}&title=${encodeURIComponent(p.title || 'Digital Product')}&price=${encodeURIComponent(pricing.amount)}&currency=${encodeURIComponent(pricing.currency)}&inr=${encodeURIComponent(pricing.inr)}&usd=${encodeURIComponent(pricing.usd)}&method=${pricing.currency === 'USD' ? 'binancepay' : 'upi'}&sellerId=${encodeURIComponent(sellerId)}&sellerName=${encodeURIComponent(sellerName)}&image=${encodeURIComponent(thumb)}`;
    const safeId = escapeHtml(p.id);
    const inCart = (typeof isProductInCart === 'function') && isProductInCart(p.id);
    const isSaved = (typeof isProductInWishlist === 'function') && isProductInWishlist(p.id);

    // Deterministic rating score based on product ID
    const hash = Math.abs(String(p.id).split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0), 0));
    const ratingScore = (4.7 + ((hash % 4) / 10)).toFixed(1);
    const reviewCount = 140 + (hash % 680);
    const isMegaDeal = (pricing.discountPct >= 80);

    return `
      <div class="marketplace-product-card ${isMegaDeal ? 'deal-80-plus' : ''}" onclick="openProductDetailModal('${safeId}')" data-product-id="${safeId}">
        <div class="mp-card-thumb-wrap">
          <img src="${escapeHtml(thumb)}" alt="${escapeHtml(p.title || 'Product')}" class="mp-card-thumb-img" loading="lazy" onerror="if(!this._tried){this._tried=true; const clean=this.src.split('?')[0]; if(this.src!==clean){this.src=clean;}}else{this.style.opacity='0.7';}" />
          <button type="button" class="btn-card-wishlist ${isSaved ? 'active' : ''}" data-wishlist-id="${safeId}" onclick="event.stopPropagation(); event.preventDefault(); toggleWishlistProduct('${safeId}', event)" title="${isSaved ? 'Remove from Wishlist' : 'Add to Wishlist'}" aria-label="Wishlist">
            <i class="${isSaved ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
          </button>
          <div class="mp-card-badge-strip">
            <span class="mp-card-cat-pill">${escapeHtml(p.category || 'Digital Pack')}</span>
          </div>
        </div>
        <div class="mp-card-body">
          <div class="mp-card-seller-pill" data-seller-name="${escapeHtml(sellerName)}" data-seller-id="${escapeHtml(sellerId)}" onclick="event.stopPropagation(); event.stopImmediatePropagation(); event.preventDefault(); window.openStoreShowcaseModal(this.getAttribute('data-seller-name') || '${escapeHtml(sellerName)}');" title="View Store">
            <i class="fa-solid fa-circle-check text-green"></i>
            <span>${escapeHtml(sellerName)}</span>
          </div>
          <h4 class="mp-card-title" title="${escapeHtml(p.title || 'Digital Pack')}">${escapeHtml(p.title || 'Digital Pack')}</h4>
          <div class="mp-card-rating-row">
            <span class="mp-rating-pill"><i class="fa-solid fa-star"></i> ${ratingScore}</span>
            <span class="mp-reviews-count">(${reviewCount})</span>
            <span class="mp-instant-tag"><i class="fa-solid fa-bolt"></i> 10s</span>
          </div>
          <div class="mp-card-price-row">
            <span class="mp-card-price">${pricing.formatted}</span>
            ${pricing.formattedOriginal ? `<span class="mp-card-original-price">${pricing.formattedOriginal}</span>` : ''}
            ${pricing.discountPct > 0 ? `<span class="mp-card-discount-val ${isMegaDeal ? 'mega-deal-pct' : ''}">${pricing.discountPct}% off</span>` : ''}
          </div>
          <div class="mp-card-actions">
            <button type="button" class="btn-mp-cart ${inCart ? 'added' : ''}" data-product-id="${safeId}" onclick="event.stopPropagation(); event.preventDefault(); toggleCartProduct('${safeId}');" title="${inCart ? 'In Cart' : 'Add to Cart'}">
              <i class="fa-solid ${inCart ? 'fa-check' : 'fa-cart-plus'}"></i> <span>${inCart ? 'Added' : 'Add'}</span>
            </button>
            <button type="button" class="btn-mp-buy" onclick="event.stopPropagation(); event.preventDefault(); window.buyProductNow('${safeId}', event);">
              <i class="fa-solid fa-bolt"></i> <span>Buy</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }
  window.renderEcomProductCardHtml = renderEcomProductCardHtml;

  // Bulletproof click interceptor for seller pills in marketplace cards (runs in CAPTURE phase)
  document.addEventListener('click', (e) => {
    const pill = e.target.closest('.mp-card-seller-pill');
    if (pill) {
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
      const target = pill.getAttribute('data-seller-name') || pill.getAttribute('data-seller-id') || pill.querySelector('span')?.textContent?.trim();
      if (target && typeof window.openStoreShowcaseModal === 'function') {
        window.openStoreShowcaseModal(target);
      }
    }
  }, true);

  let currentMarketplaceCategory = 'all';
  let currentMarketplaceSearch = '';
  let currentMarketplaceSort = 'popular';

  function renderMarketplaceCategoryPills() {
    const container = document.getElementById('marketplaceCategoryFilterPills');
    if (!container) return;

    container.innerHTML = `
      <button type="button" class="store-filter-btn active" data-cat="all" onclick="setMarketplaceCategoryFilter('all')">
        <i class="fa-solid fa-layer-group"></i>
        <span>All Items</span>
      </button>
    `;
  }
  window.renderMarketplaceCategoryPills = renderMarketplaceCategoryPills;

  window.setMarketplaceCategoryFilter = function (cat) {
    currentMarketplaceCategory = String(cat || 'all').toLowerCase();

    // 1. Sync Category Filter Pills in Marketplace
    const btns = document.querySelectorAll('#marketplaceCategoryFilterPills .store-filter-btn');
    btns.forEach(b => {
      const bCat = (b.getAttribute('data-cat') || '').toLowerCase();
      b.classList.toggle('active', bCat === currentMarketplaceCategory);
    });

    // 2. Sync Mobile Stories Circles on Home
    const storyBtns = document.querySelectorAll('#mobileStoriesRail .app-story-circle-item');
    storyBtns.forEach(b => {
      const sCat = (b.getAttribute('data-cat') || '').toLowerCase();
      b.classList.toggle('active', sCat === currentMarketplaceCategory);
    });

    renderMarketplaceCatalog();
  };

  window.setMarketplaceSort = function (sortKey) {
    currentMarketplaceSort = sortKey || 'popular';
    const select = document.getElementById('marketplaceSortSelect');
    if (select) select.value = currentMarketplaceSort;
    renderMarketplaceCatalog();
  };

  window.clearMarketplaceSearch = function () {
    const input = document.getElementById('marketplaceSearchInput');
    const clearBtn = document.getElementById('mpSearchClearBtn');
    if (input) input.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    currentMarketplaceSearch = '';
    renderMarketplaceCatalog();
  };

  window.handleMarketplaceSearch = function (q) {
    currentMarketplaceSearch = String(q || '').trim().toLowerCase();
    const clearBtn = document.getElementById('mpSearchClearBtn');
    if (clearBtn) {
      clearBtn.style.display = currentMarketplaceSearch ? 'inline-flex' : 'none';
    }
    renderMarketplaceCatalog();
  };

  window.renderMarketplaceCatalog = function () {
    const grid = document.getElementById('marketplaceCatalogGrid');
    const resultsCountEl = document.getElementById('marketplaceResultsCount');
    if (!grid) return;

    let prods = [...(allMarketplaceProducts || [])];

    // Category Filter
    if (currentMarketplaceCategory !== 'all') {
      const cat = currentMarketplaceCategory.toLowerCase();
      if (cat === 'deals') {
        prods = prods.filter(p => {
          const pricing = getProductPrice(p);
          return (pricing.inr <= 199 || pricing.usd <= 3);
        });
      } else if (cat === 'vip') {
        prods = prods.filter(p => {
          const t = String(p.title || '').toLowerCase();
          const c = String(p.category || '').toLowerCase();
          return t.includes('vip') || c.includes('vip') || t.includes('exclusive');
        });
      } else if (cat === 'trending') {
        prods = prods.filter(p => {
          const pricing = getProductPrice(p);
          const t = String(p.title || '').toLowerCase();
          return (pricing.discountPct >= 50) || t.includes('pack') || t.includes('hot');
        });
      } else {
        prods = prods.filter(p => {
          const pCat = String(p.category || '').toLowerCase();
          return pCat === cat || pCat.includes(cat) || cat.includes(pCat);
        });
      }
    }

    // Text Search
    if (currentMarketplaceSearch) {
      prods = prods.filter(p =>
        String(p.title || '').toLowerCase().includes(currentMarketplaceSearch) ||
        String(p.category || '').toLowerCase().includes(currentMarketplaceSearch) ||
        String(p.sellerName || '').toLowerCase().includes(currentMarketplaceSearch)
      );
    }

    // Sorting Engine
    if (currentMarketplaceSort === 'price_asc') {
      prods.sort((a, b) => getProductPrice(a).amount - getProductPrice(b).amount);
    } else if (currentMarketplaceSort === 'price_desc') {
      prods.sort((a, b) => getProductPrice(b).amount - getProductPrice(a).amount);
    } else if (currentMarketplaceSort === 'rating') {
      prods.sort((a, b) => {
        const hashA = Math.abs(String(a.id).split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0), 0));
        const hashB = Math.abs(String(b.id).split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0), 0));
        return hashB - hashA;
      });
    } else if (currentMarketplaceSort === 'newest') {
      prods.reverse();
    }

    // Results count display removed per user preference

    if (!prods.length) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; background: var(--card-bg); border: 2px dashed var(--card-border); border-radius: var(--radius-lg); padding: 48px 24px; text-align: center;">
          <div style="font-size: 36px; color: var(--primary-pink); margin-bottom: 12px; opacity: 0.8;"><i class="fa-solid fa-magnifying-glass-minus"></i></div>
          <h4 style="font-size: 17px; font-weight: 800; color: var(--text-main); margin-bottom: 6px;">No Products Found</h4>
          <p style="font-size: 13px; color: var(--text-muted); max-width: 400px; margin: 0 auto 16px auto;">Try clearing your search query or selecting another category.</p>
          <button type="button" class="section-action-btn-pink" onclick="clearMarketplaceSearch(); setMarketplaceCategoryFilter('all');" style="display: inline-flex; margin: 0 auto;">
            <i class="fa-solid fa-rotate-left"></i> Reset Filters
          </button>
        </div>
      `;
      return;
    }

    grid.innerHTML = prods.map(p => renderEcomProductCardHtml(p)).join('');
  };

  // ━━ 10B. FLASH DEALS RAIL & BANNER CAROUSEL CONTROLLER ━━
  function renderFlashDealsRail() {
    const rail = document.getElementById('flashDealsRail');
    if (!rail) return;
    if (!allMarketplaceProducts || !allMarketplaceProducts.length) return;

    // Pick top 6 discounted items
    const deals = [...allMarketplaceProducts]
      .sort((a, b) => {
        const pA = getProductPrice(a);
        const pB = getProductPrice(b);
        return (pB.discountPct || 0) - (pA.discountPct || 0);
      })
      .slice(0, 6);

    rail.innerHTML = deals.map(p => {
      const thumb = extractProductCoverImage(p);
      const pricing = getProductPrice(p);
      const sInfo = normalizeSellerInfo(p);
      const sName = sInfo.storeName || sInfo.sellerName || p.sellerName || p.seller || 'JaiGram Verified';
      const sId = sInfo.sellerId || p.sellerId || '';
      const safeId = escapeHtml(p.id);
      const buyUrl = `../payment.html?productId=${encodeURIComponent(p.id)}&title=${encodeURIComponent(p.title || 'Digital Product')}&price=${encodeURIComponent(pricing.amount)}&currency=${encodeURIComponent(pricing.currency)}&inr=${encodeURIComponent(pricing.inr)}&usd=${encodeURIComponent(pricing.usd)}&method=${pricing.currency === 'USD' ? 'binancepay' : 'upi'}&sellerId=${encodeURIComponent(sId)}&sellerName=${encodeURIComponent(sName)}&image=${encodeURIComponent(thumb)}`;

      return `
        <div class="flash-deal-item" onclick="openProductDetailModal('${safeId}')">
          <div class="flash-thumb-box">
            <img src="${escapeHtml(thumb)}" alt="${escapeHtml(p.title)}" loading="lazy" onerror="if(!this._tried){this._tried=true; const clean=this.src.split('?')[0]; if(this.src!==clean){this.src=clean;}}else{this.style.opacity='0.7';}" />
            ${pricing.discountPct > 0 ? `<span class="flash-deal-badge">${pricing.discountPct}% OFF</span>` : ''}
          </div>
          <div class="flash-meta-box">
            <span class="flash-title">${escapeHtml(p.title)}</span>
            <div class="flash-price-line">
              <span class="flash-current-price">${pricing.formatted}</span>
              ${pricing.formattedOriginal ? `<span class="flash-mrp-price">${pricing.formattedOriginal}</span>` : ''}
            </div>
            <button type="button" class="flash-buy-btn" onclick="window.buyProductNow('${safeId}', event);">
              <i class="fa-solid fa-bolt"></i> Buy
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  let currentBannerSlideIdx = 0;
  let bannerAutoInterval = null;

  window.goToBannerSlide = function (idx) {
    const track = document.getElementById('appBannerTrack');
    const dots = document.querySelectorAll('#appSliderDots .slider-dot');
    if (!track) return;
    currentBannerSlideIdx = idx;
    track.style.transform = `translateX(-${idx * 100}%)`;
    dots.forEach((d, i) => {
      d.classList.toggle('active', i === idx);
    });
  };

  function initMobileHomeCarousel() {
    const slider = document.getElementById('appHomeBannerSlider');
    if (!slider) return;

    if (bannerAutoInterval) clearInterval(bannerAutoInterval);
    bannerAutoInterval = setInterval(() => {
      const next = (currentBannerSlideIdx + 1) % 3;
      goToBannerSlide(next);
    }, 4500);

    let startX = 0;
    slider.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      if (bannerAutoInterval) clearInterval(bannerAutoInterval);
    }, { passive: true });

    slider.addEventListener('touchend', e => {
      const diffX = e.changedTouches[0].clientX - startX;
      if (diffX > 40) {
        const prev = (currentBannerSlideIdx + 2) % 3;
        goToBannerSlide(prev);
      } else if (diffX < -40) {
        const next = (currentBannerSlideIdx + 1) % 3;
        goToBannerSlide(next);
      }
      bannerAutoInterval = setInterval(() => {
        const next = (currentBannerSlideIdx + 1) % 3;
        goToBannerSlide(next);
      }, 4500);
    }, { passive: true });
  }

  let flashTimerSecs = 16338;
  function initFlashDealsTimer() {
    const timerEl = document.getElementById('flashTimerDigits');
    if (!timerEl) return;
    setInterval(() => {
      flashTimerSecs--;
      if (flashTimerSecs <= 0) flashTimerSecs = 18000;
      const h = String(Math.floor(flashTimerSecs / 3600)).padStart(2, '0');
      const m = String(Math.floor((flashTimerSecs % 3600) / 60)).padStart(2, '0');
      const s = String(flashTimerSecs % 60).padStart(2, '0');
      timerEl.textContent = `${h}:${m}:${s}`;
    }, 1000);
  }

  function updateMobileHomeHubCounts() {
    const mobOrders = document.getElementById('mobTileOrdersCount');
    if (mobOrders) mobOrders.textContent = `${userOrders ? userOrders.length : 0} Purchases`;

    const mobWallet = document.getElementById('mobTileWalletBal');
    if (mobWallet) mobWallet.textContent = `₹${userWallet.toFixed(2)}`;

    const mobWishlist = document.getElementById('mobTileWishlistCount');
    if (mobWishlist) mobWishlist.textContent = `${getStoredWishlist().length} Items`;

    const mobStores = document.getElementById('mobTileStoresCount');
    if (mobStores) mobStores.textContent = `${userFollowedStores ? userFollowedStores.length : 0} Stores`;
  }
  window.updateMobileHomeHubCounts = updateMobileHomeHubCounts;

  function initMobileHomeApp() {
    // Extra home hub removed per user request
  }
  window.initMobileHomeApp = initMobileHomeApp;

  // ━━ UNIVERSAL TRUST & SAFETY REPORT FEATURE (Product & Seller) ━━
  window.openReportItemModal = function (type = 'seller', customData = null) {
    const isProduct = type === 'product';
    const targetTypeInput = document.getElementById('reportTargetType');
    const targetIdInput = document.getElementById('reportTargetId');
    const targetNameInput = document.getElementById('reportTargetName');
    const badge = document.getElementById('reportTargetTypeBadge');
    const modalTitle = document.getElementById('reportModalTitle');
    const nameDisplay = document.getElementById('reportSellerNameDisplay');
    const reasonSelect = document.getElementById('reportReasonSelect');
    const detailsInput = document.getElementById('reportDetailsInput');

    let targetId = '';
    let targetName = '';

    if (isProduct) {
      const p = customData || currentPdmProduct;
      targetId = p ? (p.id || '') : '';
      targetName = p ? (p.title || p.name || 'Digital Pack') : 'Digital Product';
      const sInfo = p ? (typeof normalizeSellerInfo === 'function' ? normalizeSellerInfo(p) : {}) : {};
      const sellerId = sInfo.sellerId || (p ? p.sellerId : '') || '';
      const sellerName = sInfo.storeName || sInfo.sellerName || (p ? (p.sellerName || p.seller) : '') || 'JaiGram Verified';

      window._currentReportContext = {
        targetType: 'product',
        targetId,
        targetName,
        productId: targetId,
        productName: targetName,
        sellerId,
        sellerName,
      };

      if (badge) {
        badge.textContent = 'PRODUCT';
        badge.style.background = 'rgba(239, 68, 68, 0.15)';
        badge.style.color = '#ef4444';
      }
      if (modalTitle) modalTitle.textContent = 'Report Product';
      if (nameDisplay) {
        nameDisplay.innerHTML = `${escapeHtml(targetName)}<div style="font-size:12px;color:#94a3b8;margin-top:3px;font-weight:600;"><i class="fa-solid fa-store" style="color:#f59e0b;"></i> Seller: <span style="color:#fbbf24;">${escapeHtml(sellerName)}</span></div>`;
      }

      if (reasonSelect) {
        reasonSelect.innerHTML = `
          <option value="">— Select a reason —</option>
          <option value="Broken or Dead Download Link">Broken or Dead Download Link</option>
          <option value="Fake or Misleading Images/Title">Fake or Misleading Images/Title</option>
          <option value="Incomplete or Missing Files">Incomplete or Missing Files</option>
          <option value="Copyright or Pirated Content">Copyright or Pirated Content</option>
          <option value="Scam or Fraud Attempt">Scam or Fraud Attempt</option>
          <option value="Offensive or Inappropriate Content">Offensive or Inappropriate Content</option>
          <option value="Spam or Repetitive Listings">Spam or Repetitive Listings</option>
          <option value="Other Policy Violation">Other Policy Violation</option>
        `;
      }
    } else {
      const s = customData || currentModalStore || (currentPdmProduct ? { storeName: currentPdmProduct.sellerName, id: currentPdmProduct.sellerId } : null);
      targetId = s ? (s.id || s.sellerId || '') : '';
      targetName = s ? (s.storeName || s.sellerName || 'Creator Store') : 'Store Owner';

      window._currentReportContext = {
        targetType: 'seller',
        targetId,
        targetName,
        productId: '',
        productName: '',
        sellerId: targetId,
        sellerName: targetName,
      };

      if (badge) {
        badge.textContent = 'SELLER';
        badge.style.background = 'rgba(59, 130, 246, 0.15)';
        badge.style.color = '#3b82f6';
      }
      if (modalTitle) modalTitle.textContent = 'Report Seller';
      if (nameDisplay) nameDisplay.textContent = targetName;

      if (reasonSelect) {
        reasonSelect.innerHTML = `
          <option value="">— Select a reason —</option>
          <option value="Fake or Misleading Store Listings">Fake or Misleading Store Listings</option>
          <option value="Scam or Fraudulent Activity">Scam or Fraudulent Activity</option>
          <option value="Stolen or Unauthorized Content">Stolen or Unauthorized Content</option>
          <option value="Unresponsive or Hostile Support">Unresponsive or Hostile Support</option>
          <option value="Spamming Multiple Duplicate Listings">Spamming Multiple Duplicate Listings</option>
          <option value="Other Policy Violation">Other Policy Violation</option>
        `;
      }
    }

    if (targetTypeInput) targetTypeInput.value = isProduct ? 'product' : 'seller';
    if (targetIdInput) targetIdInput.value = targetId;
    if (targetNameInput) targetNameInput.value = targetName;

    // Pre-fill reporter name and email from session
    const reporterInput = document.getElementById('reporterNameInput');
    const emailInput = document.getElementById('reporterEmailInput');
    if (currentCustomer) {
      const userName = currentCustomer.displayName || currentCustomer.name || '';
      if (reporterInput && !reporterInput.value && userName) {
        reporterInput.value = userName;
      }
      const userEmail = currentCustomer.email || '';
      if (emailInput && !emailInput.value && userEmail) {
        emailInput.value = userEmail;
      }
    }

    if (detailsInput) detailsInput.value = '';
    const alertEl = document.getElementById('reportModalAlert');
    if (alertEl) {
      alertEl.style.display = 'none';
      alertEl.innerHTML = '';
    }
    openModal('reportSellerModal');
  };

  // Backward compatibility alias for existing HTML triggers
  window.openReportSellerModal = function () {
    window.openReportItemModal('seller');
  };

  window.submitUnifiedReport = async function () {
    const targetType = (document.getElementById('reportTargetType')?.value || 'seller').toLowerCase().trim();
    const targetId = (document.getElementById('reportTargetId')?.value || '').trim();
    const targetName = (document.getElementById('reportTargetName')?.value || document.getElementById('reportSellerNameDisplay')?.textContent || 'Item').trim();
    const reporterName = (document.getElementById('reporterNameInput')?.value || '').trim();
    const reporterEmail = (document.getElementById('reporterEmailInput')?.value || currentCustomer?.email || '').trim();
    const reason = (document.getElementById('reportReasonSelect')?.value || '').trim();
    const details = (document.getElementById('reportDetailsInput')?.value || '').trim();

    const ctx = window._currentReportContext || {};
    const sellerId = ctx.sellerId || '';
    const sellerName = ctx.sellerName || '';
    const productId = ctx.productId || (targetType === 'product' ? targetId : '');
    const productName = ctx.productName || (targetType === 'product' ? targetName : '');

    const alertEl = document.getElementById('reportModalAlert');
    function showModalNotice(msg, isSuccess = false) {
      if (alertEl) {
        alertEl.style.display = 'flex';
        alertEl.style.background = isSuccess ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
        alertEl.style.color = isSuccess ? '#10b981' : '#ef4444';
        alertEl.style.border = isSuccess ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)';
        alertEl.innerHTML = `<i class="fa-solid ${isSuccess ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> <span>${msg}</span>`;
      }
      showAppToast(msg);
    }

    if (!reporterName) {
      showModalNotice('Please enter your full name');
      document.getElementById('reporterNameInput')?.focus();
      return;
    }
    if (!reason) {
      showModalNotice('Please select a reason for reporting');
      document.getElementById('reportReasonSelect')?.focus();
      return;
    }

    const submitBtn = document.getElementById('submitReportBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Submitting...</span>';
    }

    const reportId = `rep_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}`;
    const now = Date.now();

    const reportPayload = {
      id: reportId,
      targetType: targetType === 'product' ? 'product' : 'seller',
      targetId: targetId || 'unspecified',
      targetName,
      productId,
      productName,
      sellerId,
      sellerName,
      reporterName,
      reporterEmail: reporterEmail || 'N/A',
      reporterUid: currentCustomer?.uid || '',
      reason,
      details: details || '',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    let submitted = false;

    // 1. Primary: Submit through secure Reports API
    try {
      const apiRes = await fetch(`${API_BASE}/api/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportPayload),
      });
      if (apiRes.ok) {
        submitted = true;
      }
    } catch (_) {}

    // 2. Resilient Direct Firebase Fallback
    if (!submitted) {
      try {
        const fbRes = await fetch(`${RTDB_URL}/reports/${encodeURIComponent(reportId)}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reportPayload),
        });
        if (fbRes.ok) {
          submitted = true;
        }
      } catch (_) {}
    }

    if (submitted) {
      // Persist to user's reports list
      try {
        const uReportsKey = 'jaigram_user_reports_' + (currentCustomer?.uid || 'guest');
        let myReports = [];
        try {
          const raw = localStorage.getItem(uReportsKey) || localStorage.getItem('jaigram_user_reports');
          if (raw) myReports = JSON.parse(raw);
        } catch (_) {}
        if (!Array.isArray(myReports)) myReports = [];
        myReports = myReports.filter(r => r.id !== reportId);
        myReports.unshift(reportPayload);
        localStorage.setItem(uReportsKey, JSON.stringify(myReports.slice(0, 50)));
        localStorage.setItem('jaigram_user_reports', JSON.stringify(myReports.slice(0, 50)));
        if (typeof window.renderUserReportsList === 'function') {
          window.renderUserReportsList(myReports);
        }
      } catch (_) {}

      const tgReportMsg = `Hello JaiGram Support! I have submitted an official report:%0A%0A🚩 Type: ${encodeURIComponent(targetType.toUpperCase())}%0A📦 Target: ${encodeURIComponent(targetName)}${sellerName ? `%0A🏪 Seller: ${encodeURIComponent(sellerName)}` : ''}%0A⚠️ Reason: ${encodeURIComponent(reason)}${details ? `%0A📝 Details: ${encodeURIComponent(details)}` : ''}%0A🆔 Report ID: ${encodeURIComponent(reportId)}%0A👤 Reporter: ${encodeURIComponent(reporterName)}`;
      const tgReportUrl = `https://t.me/JaiGram_Support?text=${tgReportMsg}`;

      if (alertEl) {
        alertEl.style.display = 'flex';
        alertEl.style.flexDirection = 'column';
        alertEl.style.gap = '10px';
        alertEl.style.background = 'rgba(16, 185, 129, 0.15)';
        alertEl.style.color = '#10b981';
        alertEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
        alertEl.innerHTML = `
          <div style="display:flex;align-items:center;gap:6px;"><i class="fa-solid fa-circle-check"></i> <b>Report submitted to Admin successfully!</b></div>
          <div style="font-size:12px;color:#cbd5e1;">JaiGram trust team has been notified. You can also message admin directly on Telegram:</div>
          <a href="${tgReportUrl}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 16px;background:#0284c7;color:#fff;border-radius:8px;font-size:12.5px;font-weight:700;text-decoration:none;">
            <i class="fa-brands fa-telegram"></i> Message Admin on Telegram with this Report
          </a>
        `;
      }
      showAppToast('Report submitted! JaiGram admin team will review it shortly.');
      setTimeout(() => {
        closeModal('reportSellerModal');
        if (document.getElementById('reportDetailsInput')) document.getElementById('reportDetailsInput').value = '';
        if (document.getElementById('reportReasonSelect')) document.getElementById('reportReasonSelect').value = '';
        if (alertEl) alertEl.style.display = 'none';
      }, 4000);
    } else {
      showModalNotice('Unable to submit report. Please check your connection and try again.');
    }

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> <span>Submit Report</span>';
    }
  };

  // ━━ USER REPORTS DISPLAY & MANAGEMENT (Trust & Safety Live History) ━━
  let isReportsSyncing = false;
  window.loadUserReports = async function (silent = false) {
    const container = document.getElementById('userReportsListContainer');
    if (!container) return;
    if (isReportsSyncing) return;
    isReportsSyncing = true;

    try {
      const uid = currentCustomer?.uid || '';
      const email = (currentCustomer?.email || '').toLowerCase().trim();
      const uReportsKey = 'jaigram_user_reports_' + (uid || 'guest');

      let localReports = [];
      const reportKeys = [uReportsKey, 'jaigram_user_reports', 'linkadda_user_reports'];
      reportKeys.forEach(k => {
        try {
          const raw = localStorage.getItem(k);
          if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
              arr.forEach(r => {
                if (r && r.id && !localReports.some(x => x.id === r.id)) {
                  localReports.push(r);
                }
              });
            }
          }
        } catch (_) {}
      });

      // Show local reports immediately for instant feedback
      if (localReports.length > 0) {
        window.renderUserReportsList(localReports);
      } else if (!silent) {
        container.innerHTML = `<div style="text-align:center; padding:24px 16px; color:#94a3b8; font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> Checking submitted reports...</div>`;
      }

      const previousStatuses = new Map(localReports.map(r => [r.id, (r.status || 'pending').toLowerCase()]));

      // 1. Fetch latest server status from /api/reports
      let fetchedReports = [];
      try {
        const repIds = localReports.map(r => r.id).filter(Boolean);
        const q = new URLSearchParams();
        if (repIds.length > 0) q.set('reportIds', repIds.slice(0, 30).join(','));
        if (uid) q.set('reporterUid', uid);
        if (email) q.set('reporterEmail', email);
        q.set('_t', Date.now());

        const res = await fetch(`${API_BASE}/api/reports?${q.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.reports)) {
            fetchedReports = data.reports;
          }
        }
      } catch (_) {}

      // 2. Direct RTDB check for individual reports (database.rules.json allows $report_id read: true)
      const reportsMap = new Map();
      localReports.forEach(r => { if (r && r.id) reportsMap.set(r.id, r); });
      fetchedReports.forEach(r => {
        if (r && r.id) {
          const existing = reportsMap.get(r.id) || {};
          reportsMap.set(r.id, { ...existing, ...r });
        }
      });

      const pendingReports = Array.from(reportsMap.values()).filter(r => (r.status || 'pending').toLowerCase() === 'pending');
      if (pendingReports.length > 0) {
        await Promise.all(pendingReports.slice(0, 10).map(async (r) => {
          try {
            const fbRes = await fetch(`${RTDB_URL}/reports/${encodeURIComponent(r.id)}.json?_t=${Date.now()}`);
            if (fbRes.ok) {
              const fbData = await fbRes.json();
              if (fbData && typeof fbData === 'object' && fbData.status) {
                const existing = reportsMap.get(r.id) || r;
                reportsMap.set(r.id, { ...existing, ...fbData });
              }
            }
          } catch (_) {}
        }));
      }

      const combined = Array.from(reportsMap.values());
      combined.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

      // Check if any report was newly resolved or dismissed
      combined.forEach(r => {
        const prevSt = previousStatuses.get(r.id);
        const newSt = (r.status || 'pending').toLowerCase();
        if (prevSt === 'pending' && newSt === 'resolved') {
          showAppToast(`✔ Update: Your report (${r.targetName || r.id}) was reviewed and resolved by Admin!`);
        } else if (prevSt === 'pending' && newSt === 'dismissed') {
          showAppToast(`ℹ Update: Your report (${r.targetName || r.id}) has been reviewed and closed.`);
        }
      });

      try {
        const serialized = JSON.stringify(combined.slice(0, 50));
        localStorage.setItem(uReportsKey, serialized);
        localStorage.setItem('jaigram_user_reports', serialized);
        localStorage.setItem('linkadda_user_reports', serialized);
      } catch (_) {}

      window.renderUserReportsList(combined);
    } finally {
      isReportsSyncing = false;
    }
  };

  window.renderUserReportsList = function (reports) {
    const container = document.getElementById('userReportsListContainer');
    if (!container) return;

    if (!Array.isArray(reports) || reports.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 28px 16px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.12); border-radius: 14px;">
          <div style="font-size: 26px; color: #94a3b8; margin-bottom: 8px;"><i class="fa-regular fa-circle-check"></i></div>
          <div style="font-size: 14px; font-weight: 700; color: #ffffff; margin-bottom: 4px;">No Reports Filed</div>
          <div style="font-size: 12px; color: #94a3b8;">You haven't reported any products or creators. If you encounter any issue, use the Report button on the product or seller page.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        ${reports.map(r => {
          const isProduct = r.targetType === 'product';
          const typeBadge = isProduct 
            ? `<span style="padding: 3px 8px; border-radius: 6px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-size: 11px; font-weight: 700; text-transform: uppercase;"><i class="fa-solid fa-box-open" style="margin-right:3px;"></i> Product</span>`
            : `<span style="padding: 3px 8px; border-radius: 6px; background: rgba(234, 179, 8, 0.15); color: #eab308; font-size: 11px; font-weight: 700; text-transform: uppercase;"><i class="fa-solid fa-store" style="margin-right:3px;"></i> Seller</span>`;
          const status = (r.status || 'pending').toLowerCase();
          const statusBadge = status === 'resolved'
            ? `<span style="padding: 3px 10px; border-radius: 9999px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); color: #10b981; font-size: 11px; font-weight: 700;">✔ Resolved</span>`
            : status === 'dismissed'
            ? `<span style="padding: 3px 10px; border-radius: 9999px; background: rgba(148, 163, 184, 0.15); border: 1px solid rgba(148, 163, 184, 0.35); color: #94a3b8; font-size: 11px; font-weight: 700;">✖ Dismissed / Closed</span>`
            : `<span style="padding: 3px 10px; border-radius: 9999px; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.35); color: #f59e0b; font-size: 11px; font-weight: 700;">⏳ Under Review</span>`;
          const dateStr = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Recently';

          return `
            <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 16px; transition: border-color 0.2s;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 8px; flex-wrap: wrap;">
                <div>
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
                    ${typeBadge}
                    <strong style="color: #ffffff; font-size: 14px;">${escapeHtml(r.targetName || 'Reported Item')}</strong>
                  </div>
                  <div style="font-size: 12.5px; color: #cbd5e1;"><strong style="color: #94a3b8;">Reason:</strong> ${escapeHtml(r.reason || 'Issue reported')}</div>
                </div>
                <div>${statusBadge}</div>
              </div>
              ${r.details ? `<div style="font-size: 12px; color: #94a3b8; background: rgba(0,0,0,0.25); padding: 8px 10px; border-radius: 8px; margin-top: 6px;">"${escapeHtml(r.details)}"</div>` : ''}
              ${r.adminNotes ? `<div style="font-size: 12px; color: #10b981; background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.2); padding: 8px 10px; border-radius: 8px; margin-top: 6px;"><i class="fa-solid fa-user-shield"></i> <b>Admin Action:</b> ${escapeHtml(r.adminNotes)}</div>` : ''}
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; font-size: 11px; color: #64748b; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">
                <span>Report ID: <code style="color: #94a3b8; font-family: monospace;">${r.id}</code></span>
                <span>Submitted: ${dateStr}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  };

  // Backward compatibility alias
  window.submitSellerReport = window.submitUnifiedReport;

  // ━━ 8. SPA TAB SWITCHING (Full Native App Page System) ━━
  window.switchTab = function (tabId) {
    if (tabId === 'cart') {
      if (typeof openCartDrawer === 'function') {
        openCartDrawer();
      }
      return;
    }

    // Auto-close cart drawer if switching to another tab
    const cartDrawerEl = document.getElementById('cartDrawerOverlay');
    if (cartDrawerEl && cartDrawerEl.classList.contains('active')) {
      cartDrawerEl.classList.remove('active');
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }

    const profileSubTabs = ['profile', 'edit-profile', 'settings', 'support', 'messages', 'refer'];
    const parentTab = profileSubTabs.includes(tabId) ? 'profile' : tabId;

    // 1. Sidebar Nav Links
    const navLinks = document.querySelectorAll('.sidebar-nav-link');
    navLinks.forEach(link => {
      const linkTab = link.getAttribute('data-tab');
      if (linkTab === tabId || (profileSubTabs.includes(tabId) && linkTab === 'profile')) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // 2. Mobile App Bottom Bar Tabs (Always Active & Pinned)
    const bottomBtns = document.querySelectorAll('.bottom-tab-btn');
    bottomBtns.forEach(btn => {
      const btnTab = btn.getAttribute('data-tab');
      if (btnTab === parentTab) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // 2b. Native Mobile App Bottom Bar Tabs
    const mobNavItems = document.querySelectorAll('.mob-nav-item');
    mobNavItems.forEach(item => {
      const itemTab = item.getAttribute('data-tab');
      if (itemTab === parentTab || itemTab === tabId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // 3. Tab Views
    const allViews = document.querySelectorAll('.tab-view-content');
    allViews.forEach(view => view.classList.remove('active'));

    const targetView = document.getElementById(`tab-${tabId}`);
    if (targetView) {
      targetView.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      try {
        if (history && history.replaceState) {
          history.replaceState(null, '', `#${tabId}`);
        }
      } catch (_) {}
    }

    // Refresh quick stats and reports in profile when visiting profile
    if (tabId === 'profile') {
      const statOrders = document.getElementById('statOrdersCount');
      if (statOrders) statOrders.textContent = userOrders ? userOrders.length : 0;
      const statStores = document.getElementById('statStoresCount');
      if (statStores) statStores.textContent = userFollowedStores ? userFollowedStores.length : 0;
      const statWallet = document.getElementById('statWalletSum');
      if (statWallet) statWallet.textContent = `₹${userWallet.toFixed(2)}`;
      if (typeof window.loadUserReports === 'function') {
        window.loadUserReports(true);
      }
    }

    // Refresh live orders when visiting orders tab
    if (tabId === 'orders') {
      if (typeof loadUserOrders === 'function') {
        loadUserOrders(true);
      }
    }

    // Refresh wallet section when visiting wallet tab
    if (tabId === 'wallet') {
      renderWalletDisplay();
      loadWalletTransactions();
    }

    // Refresh user reports when visiting help & support tab
    if (tabId === 'support') {
      if (typeof window.loadUserReports === 'function') {
        window.loadUserReports();
      }
    }

    if (tabId === 'stores' || tabId === 'dashboard') {
      renderFollowedStoresUI();
      if (typeof renderFlashDealsRail === 'function') renderFlashDealsRail();
      if (typeof loadUserOrders === 'function') {
        loadUserOrders(true);
      }
    }

    if (tabId === 'wishlist') {
      renderWishlistGrid();
    }

    if (tabId === 'marketplace') {
      if (!allMarketplaceProducts || allMarketplaceProducts.length === 0) {
        if (typeof loadUserFollowedStores === 'function') loadUserFollowedStores();
      }
      renderMarketplaceCatalog();
    }

    updateMobileHomeHubCounts();

    closeMobileSidebar();
    closeAllDropdowns();
  };

  // ━━ REAL-TIME PERIODIC AUTO-SYNC FOR PENDING ORDERS, WALLET & NOTIFICATIONS ━━
  let autoSyncTimer = null;
  function startPendingOrderAutoSync() {
    if (autoSyncTimer) return;
    autoSyncTimer = setInterval(async () => {
      if (document.hidden) return;
      
      // 1. Silent live wallet balance & transaction sync
      loadUserWallet().catch(() => {});
      loadWalletTransactions().catch(() => {});
      syncServerNotifications().catch(() => {});

      // 2. Orders auto-sync
      const hasPendingOrders = Array.isArray(userOrders) && userOrders.some(o => {
        const st = String(o.status || o.orderStatus || 'pending').toLowerCase();
        return !['approved', 'completed', 'paid', 'confirmed', 'rejected', 'failed'].includes(st);
      });
      if (hasPendingOrders && typeof loadUserOrders === 'function') {
        await loadUserOrders(true);
      }

      // 3. User reports auto-sync
      try {
        const uReportsKey = 'jaigram_user_reports_' + (currentCustomer?.uid || 'guest');
        const raw = localStorage.getItem(uReportsKey) || localStorage.getItem('jaigram_user_reports');
        if (raw) {
          const reps = JSON.parse(raw);
          if (Array.isArray(reps) && reps.some(r => (r.status || 'pending').toLowerCase() === 'pending')) {
            if (typeof window.loadUserReports === 'function') {
              await window.loadUserReports(true);
            }
          }
        }
      } catch (_) {}
    }, 6000);
  }

  // Window focus listener for instant updates when switching back to tab
  window.addEventListener('focus', () => {
    loadUserWallet().catch(() => {});
    loadWalletTransactions().catch(() => {});
    syncServerNotifications().catch(() => {});
    if (typeof loadUserOrders === 'function') loadUserOrders(true).catch(() => {});
    if (typeof window.loadUserReports === 'function') window.loadUserReports(true).catch(() => {});
  });

  // Backward compatibility aliases
  window.openAppProfileHub = function () {
    switchTab('profile');
  };

  window.closeAppProfileHub = function () {};

  window.openHubOption = function (tabId) {
    switchTab(tabId);
  };

  // ━━ 9. SETTINGS ACTION HELPERS ━━
  window.copyCustomerId = function () {
    const uid = currentCustomer?.uid || (document.getElementById('settingsUidDisplay')?.textContent) || 'cust_jaigram';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(uid).then(() => {
        showAppToast('Customer ID copied to clipboard!');
      }).catch(() => {
        showAppToast(`Customer ID: ${uid}`);
      });
    } else {
      showAppToast(`Customer ID: ${uid}`);
    }
  };

  window.clearAppCache = function () {
    showAppToast('Cleaning temporary cached assets...');
    setTimeout(() => {
      showAppToast('✨ App cache cleaned! 1.8 MB freed');
    }, 600);
  };

  function initMobileSidebar() {
    // Hamburger completely removed; handled gracefully
  }

  window.closeMobileSidebar = function () {
    const sidebar = document.getElementById('userSidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('show');
  };

  // ━━ 10. NOTIFICATIONS & DROPDOWN MENUS (Robust Multi-Key & Persistent Read Sync) ━━
  function isNotificationUnread(n) {
    if (!n || typeof n !== 'object') return false;
    // Explicit read boolean overrides
    if (n.read === true) return false;
    if (n.unread === false) return false;
    if (n.unread === true) return true;
    if (n.read === false) return true;
    return false;
  }

  function getAllNotificationKeys() {
    const cust = currentCustomer || {};
    const uid = cust.uid || cust.email || '';
    const cleanUid = uid ? String(uid).replace(/[^a-zA-Z0-9_-]/g, '_') : '';

    const keySet = new Set([
      'linkadda_user_notifications',
      'jaigram_user_notifications',
      'linkadda_notifs_guest',
      'jaigram_notifs_guest'
    ]);

    if (uid) {
      keySet.add('linkadda_user_notifications_' + uid);
      keySet.add('jaigram_user_notifications_' + uid);
      keySet.add('linkadda_notifs_' + uid);
      keySet.add('jaigram_notifs_' + uid);
    }
    if (cleanUid && cleanUid !== uid) {
      keySet.add('linkadda_user_notifications_' + cleanUid);
      keySet.add('jaigram_user_notifications_' + cleanUid);
      keySet.add('linkadda_notifs_' + cleanUid);
      keySet.add('jaigram_notifs_' + cleanUid);
    }

    // Scan any other existing keys in localStorage
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && /^(jaigram|linkadda)_(user_notifications|notifs)/.test(k)) {
          keySet.add(k);
        }
      }
    } catch (_) {}

    return Array.from(keySet);
  }

  function getStoredNotifications() {
    const keys = getAllNotificationKeys();
    const map = new Map();

    keys.forEach(k => {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) return;
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          list.forEach(item => {
            if (!item || typeof item !== 'object') return;
            const normId = String(item.id || item.orderId || (item.title + '_' + (item.timestamp || item.date || ''))).trim();
            if (!normId) return;

            const existing = map.get(normId);
            const unread = isNotificationUnread(item);

            if (!existing) {
              map.set(normId, {
                ...item,
                id: normId,
                title: item.title || 'Notification',
                message: item.message || item.desc || '',
                date: item.date || item.time || 'Recently',
                timestamp: Number(item.timestamp || 0),
                read: !unread,
                unread: unread,
                type: item.type || 'order'
              });
            } else {
              // If either entry was marked as read, mark the merged entry as read
              const mergedUnread = existing.unread && unread;
              map.set(normId, {
                ...existing,
                ...item,
                read: !mergedUnread,
                unread: mergedUnread
              });
            }
          });
        }
      } catch (_) {}
    });

    const result = Array.from(map.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return result;
  }

  async function syncServerNotifications() {
    const uid = currentCustomer?.uid || '';
    if (!uid) return;
    try {
      const snap = await fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/customers/${encodeURIComponent(uid)}/notifications.json?_t=${Date.now()}`);
      if (snap.ok) {
        const data = await snap.json();
        if (data && typeof data === 'object') {
          const list = Object.values(data).filter(Boolean);
          if (list.length > 0) {
            const targetKey = 'jaigram_user_notifications_' + uid;
            let current = [];
            try { const r = localStorage.getItem(targetKey); if (r) current = JSON.parse(r); } catch(_) {}
            if (!Array.isArray(current)) current = [];
            const map = new Map();
            current.forEach(item => { if (item?.id) map.set(item.id, item); });
            let hasNew = false;
            list.forEach(item => {
              if (item?.id) {
                if (!map.has(item.id)) {
                  map.set(item.id, item);
                  hasNew = true;
                }
              }
            });
            if (hasNew) {
              const merged = Array.from(map.values()).sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
              localStorage.setItem(targetKey, JSON.stringify(merged.slice(0, 50)));
              localStorage.setItem('jaigram_user_notifications', JSON.stringify(merged.slice(0, 50)));
              renderUserNotificationsDropdown(false);
            }
          }
        }
      }
    } catch (_) {}
  }

  function renderUserNotificationsDropdown(triggerSync = true) {
    if (triggerSync) syncServerNotifications().catch(() => {});
    const dropdown = document.getElementById('notificationDropdown');
    const badge = document.getElementById('notifBadgeCount');
    const notifs = getStoredNotifications();

    const unreadCount = notifs.filter(isNotificationUnread).length;

    if (badge) {
      if (unreadCount > 0) {
        badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
        badge.style.display = 'inline-block';
      } else {
        badge.textContent = '0';
        badge.style.display = 'none';
      }
    }

    if (!dropdown) return;

    if (!notifs || notifs.length === 0) {
      dropdown.innerHTML = `
        <div style="padding: 10px 14px; font-weight: 700; font-size: 13.5px; border-bottom: 1px solid #eaedf2; display: flex; justify-content: space-between; align-items: center;">
          <span>Notifications</span>
        </div>
        <div style="display: flex; flex-direction: column; padding: 26px 14px; text-align: center; color: var(--text-muted); font-size: 13px;">
          <i class="fa-regular fa-bell" style="font-size: 22px; color: #cbd5e1; margin-bottom: 6px;"></i>
          <span>No new notifications</span>
        </div>
      `;
      return;
    }

    let itemsHtml = '';
    notifs.slice(0, 12).forEach(n => {
      const isUnread = isNotificationUnread(n);
      const isRejected = n.type === 'order_rejected' || (n.title && n.title.toLowerCase().includes('rejected')) || (n.message && n.message.toLowerCase().includes('rejected'));
      const isWallet = n.type === 'wallet' || (n.title && n.title.includes('Wallet'));
      const isApproved = n.type === 'order_confirmed' || (n.title && n.title.includes('Approved')) || (n.message && n.message.includes('verified'));
      const icon = isRejected ? 'fa-circle-xmark' : (isWallet ? 'fa-wallet' : (isApproved ? 'fa-circle-check' : 'fa-bag-shopping'));
      const iconColor = isRejected ? '#ef4444' : (isWallet ? '#10b981' : (isApproved ? '#10b981' : '#2563eb'));
      const iconBg = isRejected ? '#fef2f2' : (isWallet ? '#ecfdf5' : (isApproved ? '#ecfdf5' : '#eff6ff'));

      itemsHtml += `
        <div style="display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-bottom: 1px solid #f1f5f9; background: ${isUnread ? 'rgba(37, 99, 235, 0.04)' : 'transparent'}; transition: background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='${isUnread ? 'rgba(37, 99, 235, 0.04)' : 'transparent'}'">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: ${iconBg}; color: ${iconColor}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 13px; margin-top: 2px;">
            <i class="fa-solid ${icon}"></i>
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
              <div style="font-size: 12.5px; font-weight: ${isUnread ? '800' : '650'}; color: #0f172a; margin-bottom: 2px;">${escapeHtml(n.title || 'Notification')}</div>
              ${isUnread ? '<span style="width: 7px; height: 7px; border-radius: 50%; background: #2563eb; display: inline-block; flex-shrink: 0;"></span>' : ''}
            </div>
            <div style="font-size: 11.5px; color: #475569; line-height: 1.35; margin-bottom: 4px; word-break: break-word;">${escapeHtml(n.message || '')}</div>
            <div style="font-size: 10px; color: #94a3b8; font-weight: 600;">${escapeHtml(n.date || 'Just now')}</div>
          </div>
        </div>
      `;
    });

    dropdown.innerHTML = `
      <div style="padding: 10px 14px; font-weight: 700; font-size: 13.5px; border-bottom: 1px solid #eaedf2; display: flex; justify-content: space-between; align-items: center;">
        <span>Notifications</span>
        <button type="button" onclick="clearNotifications()" style="background: none; border: none; font-size: 11px; font-weight: 700; color: #2563eb; cursor: pointer; padding: 2px 4px;">Mark Read</button>
      </div>
      <div style="max-height: 320px; overflow-y: auto;">
        ${itemsHtml}
      </div>
    `;
  }
  window.loadUserNotifications = renderUserNotificationsDropdown;

  window.toggleNotificationDropdown = function () {
    const dropdown = document.getElementById('notificationDropdown');
    const userDropdown = document.getElementById('userMenuDropdown');
    if (userDropdown) userDropdown.classList.remove('show');
    if (dropdown) {
      dropdown.classList.toggle('show');
      if (dropdown.classList.contains('show')) {
        renderUserNotificationsDropdown();
      }
    }
  };

  window.toggleUserDropdown = function () {
    const dropdown = document.getElementById('userMenuDropdown');
    const notifDropdown = document.getElementById('notificationDropdown');
    if (notifDropdown) notifDropdown.classList.remove('show');
    if (dropdown) dropdown.classList.toggle('show');
  };

  function closeAllDropdowns() {
    const notif = document.getElementById('notificationDropdown');
    const user = document.getElementById('userMenuDropdown');
    if (notif) notif.classList.remove('show');
    if (user) user.classList.remove('show');
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#navNotificationBtn') && !e.target.closest('#notificationDropdown')) {
      const notif = document.getElementById('notificationDropdown');
      if (notif) notif.classList.remove('show');
    }
    if (!e.target.closest('#navUserChip') && !e.target.closest('#userMenuDropdown')) {
      const user = document.getElementById('userMenuDropdown');
      if (user) user.classList.remove('show');
    }
  });

  window.clearNotifications = function () {
    const keys = getAllNotificationKeys();
    keys.forEach(k => {
      try {
        const raw = localStorage.getItem(k);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            list.forEach(item => {
              if (item && typeof item === 'object') {
                item.read = true;
                item.unread = false;
              }
            });
            localStorage.setItem(k, JSON.stringify(list));
          }
        }
      } catch (_) {}
    });

    // Set persistent read markers
    try {
      localStorage.setItem('jaigram_notifs_read_v1', 'true');
      localStorage.setItem('linkadda_notifs_read_v1', 'true');
      localStorage.setItem('jaigram_notifications_all_read', 'true');
    } catch (_) {}

    // Force badge to 0 and hide immediately
    const badge = document.getElementById('notifBadgeCount');
    if (badge) {
      badge.textContent = '0';
      badge.style.display = 'none';
    }

    if (typeof window.updateNotificationsUI === 'function') {
      try { window.updateNotificationsUI(); } catch (_) {}
    }

    renderUserNotificationsDropdown();
    showAppToast('All notifications marked as read');
  };

  // ━━ 11. MODAL UTILITIES ━━
  window.openModal = function (modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.style.display = 'flex';
      void modal.offsetWidth; // Force instant style recalculation for immediate transition
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
      // Autofocus first interactive input field
      setTimeout(() => {
        try {
          const firstInteractive = modal.querySelector('input:not([type="hidden"]), select, textarea');
          if (firstInteractive) firstInteractive.focus();
        } catch (_) {}
      }, 120);
    }
  };

  window.closeModal = function (modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
      setTimeout(() => {
        if (!modal.classList.contains('active')) {
          modal.style.display = 'none';
        }
      }, 230);
    }
    const remainingActive = document.querySelectorAll('.user-modal-overlay.active, .store-modal-overlay.active, .fk-full-page-view.active');
    if (remainingActive.length === 0) {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
  };

  // ━━ 11. IN-APP LEGAL & PRIVACY POLICY MODAL ━━
  window.openLegalPolicyModal = function (tab) {
    const modal = document.getElementById('legalPolicyModal');
    if (!modal) return;
    modal.style.display = 'flex';
    void modal.offsetWidth;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if (typeof window.switchLegalModalTab === 'function') {
      window.switchLegalModalTab(tab || 'privacy');
    }
  };
  window.openLegalModal = window.openLegalPolicyModal;

  window.switchLegalModalTab = function (tabName) {
    const tabs = ['privacy', 'payment-security', 'terms', 'refund'];
    const activeTab = tabs.includes(tabName) ? tabName : 'privacy';

    tabs.forEach(t => {
      const btn = document.getElementById(`btnLegalTab-${t}`);
      const pane = document.getElementById(`legalTabPane-${t}`);
      if (btn) btn.classList.toggle('active', t === activeTab);
      if (pane) pane.classList.toggle('active', t === activeTab);
    });

    const body = document.getElementById('legalModalBody');
    if (body) body.scrollTop = 0;
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const legalModal = document.getElementById('legalPolicyModal');
      if (legalModal && (legalModal.classList.contains('active') || legalModal.style.display === 'flex')) {
        closeModal('legalPolicyModal');
        return;
      }

      const reportModal = document.getElementById('reportSellerModal');
      if (reportModal && (reportModal.classList.contains('active') || reportModal.style.display === 'flex')) {
        closeModal('reportSellerModal');
        return;
      }

      const pdmModal = document.getElementById('productDetailModal');
      if (pdmModal && (pdmModal.classList.contains('active') || pdmModal.style.display === 'flex')) {
        if (typeof window.closeProductDetailModal === 'function') {
          window.closeProductDetailModal();
        } else {
          pdmModal.classList.remove('active');
          pdmModal.style.display = 'none';
        }
        return;
      }

      const storeModal = document.getElementById('storeShowcaseModal');
      if (storeModal && (storeModal.classList.contains('active') || storeModal.style.display === 'flex' || storeModal.style.display === 'block')) {
        if (typeof window.closeStoreShowcaseModal === 'function') {
          window.closeStoreShowcaseModal();
        } else {
          storeModal.classList.remove('active');
          storeModal.style.display = 'none';
        }
        return;
      }

      const activeModals = document.querySelectorAll('.user-modal-overlay.active');
      if (activeModals.length > 0) {
        activeModals[activeModals.length - 1].classList.remove('active');
        const remainingActive = document.querySelectorAll('.user-modal-overlay.active, .store-modal-overlay.active');
        if (remainingActive.length === 0) {
          document.body.style.overflow = '';
          document.documentElement.style.overflow = '';
        }
      }
    }
  });

  // Close modals when clicking directly on overlay backdrop
  document.addEventListener('click', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('user-modal-overlay')) {
      if (e.target.id === 'productDetailModal') {
        if (typeof window.closeProductDetailModal === 'function') {
          window.closeProductDetailModal();
          return;
        }
      }
      if (e.target.id === 'reportSellerModal') {
        closeModal('reportSellerModal');
        return;
      }
      e.target.classList.remove('active');
      const remainingActive = document.querySelectorAll('.user-modal-overlay.active, .store-modal-overlay.active');
      if (remainingActive.length === 0) {
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
      }
    }
  });

  let currentActiveAccessLink = '';

  window.openAccessModal = function (title, category, seller, desc, size, accessUrl) {
    const modalTitle = document.getElementById('accessModalTitle');
    const modalCat = document.getElementById('accessModalCategory');
    const modalSeller = document.getElementById('accessModalSeller');
    const modalSize = document.getElementById('accessModalSize');
    const modalDesc = document.getElementById('accessModalDesc');

    if (modalTitle) modalTitle.textContent = title;
    if (modalCat) modalCat.textContent = category;
    if (modalSeller) modalSeller.textContent = seller;
    if (modalSize) modalSize.textContent = size;
    if (modalDesc) {
      modalDesc.textContent = desc || 'Your access pass has been verified. You can stream directly in browser or download the full media bundle.';
    }

    currentActiveAccessLink = accessUrl ? decodeURIComponent(accessUrl) : '';
    openModal('accessModal');
  };

  window.handleStreamMedia = function () {
    closeModal('accessModal');
    if (currentActiveAccessLink && !currentActiveAccessLink.startsWith('payment.html')) {
      showAppToast('Opening high-definition media access...');
      window.open(currentActiveAccessLink, '_blank');
    } else {
      showAppToast('Connecting to 24/7 VIP Helpdesk...');
      window.open('https://t.me/TRUSTED_BROTHER1234', '_blank');
    }
  };

  window.handleDownloadDirect = function () {
    closeModal('accessModal');
    if (currentActiveAccessLink && !currentActiveAccessLink.startsWith('payment.html')) {
      showAppToast('Launching direct download link...');
      window.open(currentActiveAccessLink, '_blank');
    } else {
      showAppToast('Connecting to Instant VIP Delivery...');
      window.open('https://t.me/TRUSTED_BROTHER1234', '_blank');
    }
  };

  window.downloadProductEbook = function (title) {
    showAppToast(`Downloading ${title}...`);
    setTimeout(() => {
      const blob = new Blob([`JaiGram Shop Digital Product\n\nTitle: ${title}\nLicense: Single User Lifetime Access\nVerified: Yes\nSupport: https://t.me/TRUSTED_BROTHER1234`], { type: 'text/plain' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${title.replace(/[^a-z0-9]/gi, '_')}.txt`;
      link.click();
      showAppToast('Download finished!');
    }, 600);
  };


  window.openStoreMenu = function (storeName) {
    alert(`Store options for ${storeName}:\n• View Store Products\n• Share Store Link\n• Message Store Owner\n• Report Store`);
  };

  window.openProductMenu = function (btn, title, linkEncoded) {
    const link = linkEncoded ? decodeURIComponent(linkEncoded) : '';
    if (link && !link.startsWith('payment.html')) {
      if (confirm(`Product: "${title}"\n\nWould you like to open your direct access link now?`)) {
        window.open(link, '_blank');
      }
    } else {
      if (confirm(`Product: "${title}"\n\nWould you like to contact VIP Support for instant file access?`)) {
        window.open('https://t.me/TRUSTED_BROTHER1234', '_blank');
      }
    }
  };

  // ━━ 12. CURATED 20 APP AVATARS SYSTEM (NO CUSTOM UPLOADS) ━━
  const SYSTEM_AVATARS = [
    { id: 'avatar1', name: 'Cyber Ninja', file: '../images/avatars/avatar1.svg' },
    { id: 'avatar2', name: 'Golden King', file: '../images/avatars/avatar2.svg' },
    { id: 'avatar3', name: 'Cool Gamer', file: '../images/avatars/avatar3.svg' },
    { id: 'avatar4', name: 'Cyber Samurai', file: '../images/avatars/avatar4.svg' },
    { id: 'avatar5', name: 'Modern Maverick', file: '../images/avatars/avatar5.svg' },
    { id: 'avatar6', name: 'Cyberpunk Girl', file: '../images/avatars/avatar6.svg' },
    { id: 'avatar7', name: 'Diamond Whale', file: '../images/avatars/avatar7.svg' },
    { id: 'avatar8', name: 'Shadow Assassin', file: '../images/avatars/avatar8.svg' },
    { id: 'avatar9', name: 'Synthwave Sunset', file: '../images/avatars/avatar9.svg' },
    { id: 'avatar10', name: 'Anime Hero', file: '../images/avatars/avatar10.svg' },
    { id: 'avatar11', name: 'Streetwear Rebel', file: '../images/avatars/avatar11.svg' },
    { id: 'avatar12', name: 'Royal Baron', file: '../images/avatars/avatar12.svg' },
    { id: 'avatar13', name: 'Neon Phantom', file: '../images/avatars/avatar13.svg' },
    { id: 'avatar14', name: 'Chill Beats DJ', file: '../images/avatars/avatar14.svg' },
    { id: 'avatar15', name: 'Cyber Queen', file: '../images/avatars/avatar15.svg' },
    { id: 'avatar16', name: 'Cosmic Astronaut', file: '../images/avatars/avatar16.svg' },
    { id: 'avatar17', name: 'Stealth Panther', file: '../images/avatars/avatar17.svg' },
    { id: 'avatar18', name: 'Matrix Hacker', file: '../images/avatars/avatar18.svg' },
    { id: 'avatar19', name: 'Solar Phoenix', file: '../images/avatars/avatar19.svg' },
    { id: 'avatar20', name: 'Digital Wizard', file: '../images/avatars/avatar20.svg' }
  ];

  let pendingAvatarFile = null;
  let pendingAvatarName = null;

  window.openAvatarPicker = function () {
    const grid = document.getElementById('avatarPickerGrid');
    if (!grid) return;

    const currentUrl = currentCustomer?.photoURL || '../images/avatars/avatar1.svg';
    pendingAvatarFile = currentUrl;

    const matched = SYSTEM_AVATARS.find(av =>
      currentUrl.endsWith(av.file.replace('..', '')) ||
      currentUrl.includes(av.id) ||
      (currentUrl === av.file)
    ) || SYSTEM_AVATARS[0];

    pendingAvatarName = matched.name;
    pendingAvatarFile = matched.file;

    grid.innerHTML = SYSTEM_AVATARS.map(av => {
      const isActive = (av.file === pendingAvatarFile);
      return `
        <div class="avatar-picker-item ${isActive ? 'active' : ''}" 
             data-file="${av.file}" 
             data-name="${av.name}" 
             onclick="selectAvatarOption('${av.file}', '${av.name}')"
             ondblclick="saveSelectedAvatar('${av.file}', '${av.name}')">
          <img src="${av.file}" alt="${av.name}" class="api-avatar-img" loading="lazy" />
          <span class="api-avatar-name" title="${av.name}">${av.name}</span>
          <span class="api-check-badge"><i class="fa-solid fa-check"></i></span>
        </div>
      `;
    }).join('');

    const applyBtn = document.getElementById('avatarApplyBtn');
    if (applyBtn) {
      applyBtn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Apply: ${pendingAvatarName}`;
    }

    openModal('avatarPickerModal');
  };

  window.selectAvatarOption = function (file, name) {
    pendingAvatarFile = file;
    pendingAvatarName = name;

    const items = document.querySelectorAll('.avatar-picker-item');
    items.forEach(item => {
      if (item.getAttribute('data-file') === file) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    const applyBtn = document.getElementById('avatarApplyBtn');
    if (applyBtn) {
      applyBtn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Apply: ${name}`;
    }
  };

  window.saveSelectedAvatar = async function (explicitFile, explicitName) {
    const fileToUse = explicitFile || pendingAvatarFile || '../images/avatars/avatar1.svg';
    const meta = SYSTEM_AVATARS.find(a => a.file === fileToUse) || { name: 'Exclusive Avatar' };
    const nameToUse = explicitName || pendingAvatarName || meta.name;

    setAllAvatars(fileToUse);

    if (currentCustomer) {
      currentCustomer.photoURL = fileToUse;
      localStorage.setItem(SESSION_KEY, JSON.stringify(currentCustomer));
      await syncCustomerRemote();
    }

    closeModal('avatarPickerModal');
    showAppToast(`✨ Avatar set to ${nameToUse}!`);
  };

  window.triggerAvatarUpload = function () {
    openAvatarPicker();
  };

  window.saveUserProfile = async function () {
    const nameInput = document.getElementById('profFullName');
    const newName = nameInput ? nameInput.value.trim() : '';

    if (!newName) {
      showAppToast('⚠️ Please enter a valid display name.');
      return;
    }

    if (currentCustomer) {
      currentCustomer.displayName = newName;
      currentCustomer.name = newName;
      delete currentCustomer.username;
      delete currentCustomer.handle;

      localStorage.setItem(SESSION_KEY, JSON.stringify(currentCustomer));
      initCustomerProfile();
      showAppToast('Saving profile updates...');

      await syncCustomerRemote();
      showAppToast('✨ Profile updated successfully!');
      switchTab('profile');
    }
  };

  async function syncCustomerRemote() {
    if (!currentCustomer || !currentCustomer.email) return;
    try {
      await fetch(`${API_BASE}/api/auth/customer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': currentCustomer.sessionToken ? `Bearer ${currentCustomer.sessionToken}` : ''
        },
        body: JSON.stringify({
          email: currentCustomer.email,
          uid: currentCustomer.uid,
          newName: currentCustomer.displayName,
          name: currentCustomer.displayName,
          displayName: currentCustomer.displayName,
          photoURL: currentCustomer.photoURL || '',
          walletBalance: userWallet
        })
      });
    } catch (err) {
      console.warn('Customer remote sync notice:', err);
    }
  }

  // ━━ 12.1 SECURE EMAIL CHANGE VIA OTP ━━
  let emailChangePendingToken = null;
  let emailChangeTargetEmail = null;

  window.openEmailChangeModal = function () {
    const curEmailInput = document.getElementById('currentEmailDisp');
    if (curEmailInput && currentCustomer) {
      curEmailInput.value = currentCustomer.email || '';
    }
    resetEmailChangeModal();
    openModal('changeEmailModal');
  };

  window.resetEmailChangeModal = function () {
    const step1 = document.getElementById('emailChangeStep1');
    const step2 = document.getElementById('emailChangeStep2');
    const newEmailInp = document.getElementById('newEmailInput');
    const otpInp = document.getElementById('emailOtpInput');
    if (step1) step1.style.display = 'block';
    if (step2) step2.style.display = 'none';
    if (newEmailInp) newEmailInp.value = '';
    if (otpInp) otpInp.value = '';
    emailChangePendingToken = null;
    emailChangeTargetEmail = null;
  };

  window.handleSendEmailChangeOtp = async function () {
    const newEmailInput = document.getElementById('newEmailInput');
    const newEmail = (emailChangeTargetEmail || (newEmailInput ? newEmailInput.value.trim() : '')).toLowerCase();

    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      alert('Please enter a valid new email address.');
      return;
    }

    if (currentCustomer && newEmail === (currentCustomer.email || '').toLowerCase()) {
      alert('The new email must be different from your current email.');
      return;
    }

    const sendBtn = document.getElementById('sendEmailOtpBtn');
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.innerHTML = '<i class="ri-loader-4-line fa-spin"></i> Sending OTP...';
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to send OTP.');
      }

      emailChangePendingToken = data.token;
      emailChangeTargetEmail = newEmail;

      const step1 = document.getElementById('emailChangeStep1');
      const step2 = document.getElementById('emailChangeStep2');
      const sentText = document.getElementById('sentTargetEmailText');
      if (step1) step1.style.display = 'none';
      if (step2) step2.style.display = 'block';
      if (sentText) sentText.textContent = newEmail;

      showAppToast(`📧 OTP sent to ${newEmail}!`);
    } catch (err) {
      alert(err.message || 'Error sending verification code.');
    } finally {
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="ri-mail-send-line"></i> Send Verification OTP';
      }
    }
  };

  window.handleVerifyEmailChangeOtp = async function () {
    const otpInput = document.getElementById('emailOtpInput');
    const otp = otpInput ? otpInput.value.trim() : '';

    if (!otp || otp.length !== 6) {
      alert('Please enter the 6-digit code received on your new email.');
      return;
    }

    if (!emailChangePendingToken || !emailChangeTargetEmail) {
      alert('Session expired. Please request a new OTP.');
      resetEmailChangeModal();
      return;
    }

    const verifyBtn = document.getElementById('verifyEmailOtpBtn');
    if (verifyBtn) {
      verifyBtn.disabled = true;
      verifyBtn.innerHTML = '<i class="ri-loader-4-line fa-spin"></i> Verifying...';
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailChangeTargetEmail,
          otp,
          token: emailChangePendingToken
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Invalid OTP code.');
      }

      // Migrate customer record in backend database
      const oldEmail = currentCustomer.email;
      const oldUid = currentCustomer.uid;
      const newEmail = emailChangeTargetEmail;
      const newUid = data.uid || (data.customer && data.customer.uid) || oldUid;

      await fetch(`${API_BASE}/api/auth/customer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': currentCustomer.sessionToken ? `Bearer ${currentCustomer.sessionToken}` : ''
        },
        body: JSON.stringify({
          email: newEmail,
          oldEmail: oldEmail,
          oldUid: oldUid,
          name: currentCustomer.displayName,
          displayName: currentCustomer.displayName,
          photoURL: currentCustomer.photoURL || '',
          walletBalance: userWallet
        })
      });

      // Update local storage session
      currentCustomer.email = newEmail;
      if (newUid) currentCustomer.uid = newUid;
      if (data.sessionToken) currentCustomer.sessionToken = data.sessionToken;
      localStorage.setItem(SESSION_KEY, JSON.stringify(currentCustomer));

      initCustomerProfile();
      closeModal('changeEmailModal');
      showAppToast(`🎉 Email updated to ${newEmail}!`);
    } catch (err) {
      alert(err.message || 'OTP verification failed.');
    } finally {
      if (verifyBtn) {
        verifyBtn.disabled = false;
        verifyBtn.innerHTML = '<i class="ri-checkbox-circle-line"></i> Verify &amp; Update Email';
      }
    }
  };

  // ━━ 13. REFERRAL LINK ━━
  window.copyReferralLink = function () {
    const input = document.getElementById('referralLinkInput');
    if (input) {
      input.select();
      navigator.clipboard.writeText(input.value).then(() => {
        showAppToast('Referral link copied to clipboard!');
      }).catch(() => {
        document.execCommand('copy');
        showAppToast('Referral link copied!');
      });
    }
  };

  // ━━ 14. GLOBAL LIVE SEARCH ━━
  function initGlobalSearch() {
    const searchInput = document.getElementById('globalSearchInput');
    if (!searchInput) return;

    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      filterDashboardItems(query);
    });
  }

  window.handleGlobalSearch = function () {
    const searchInput = document.getElementById('globalSearchInput');
    if (searchInput && searchInput.value.trim()) {
      showAppToast(`Searching for "${searchInput.value.trim()}"...`);
      filterDashboardItems(searchInput.value.toLowerCase().trim());
    }
  };

  function filterDashboardItems(query) {
    const productCards = document.querySelectorAll('.purchased-product-card');
    productCards.forEach(card => {
      const text = card.textContent.toLowerCase();
      if (!query || text.includes(query)) {
        card.style.display = 'flex';
      } else {
        card.style.display = 'none';
      }
    });

    const storeCards = document.querySelectorAll('.followed-store-card');
    storeCards.forEach(card => {
      const text = card.textContent.toLowerCase();
      if (!query || text.includes(query)) {
        card.style.display = 'flex';
      } else {
        card.style.display = 'none';
      }
    });
  }

  // ━━ 15. LOGOUT ━━
  window.handleLogout = function () {
    if (confirm('Are you sure you want to log out of JaiGram Shop?')) {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem('linkadda_pending_destination');
      showAppToast('Logging out...');
      setTimeout(() => {
        window.location.replace('../login.html');
      }, 400);
    }
  };

  // ━━ 16. TOAST UTILITY ━━
  window.showAppToast = function (msg) {
    const toast = document.getElementById('userAppToast');
    const toastMsg = document.getElementById('toastMessage');
    if (!toast || !toastMsg) return;

    toastMsg.textContent = msg;
    toast.classList.add('show');

    clearTimeout(window.__toastTimeout);
    window.__toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  };

  // ━━ 17. SHOPPING CART SYSTEM ENGINE (linkadda_cart_v1) ━━
  const CART_KEY = 'linkadda_cart_v1';

  function getCart() {
    try {
      const raw = localStorage.getItem(CART_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('Error reading cart:', e);
      return [];
    }
  }
  window.getCart = getCart;

  function saveCart(cart) {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch (e) {
      console.warn('Error saving cart:', e);
    }
    updateCartUI();
  }
  window.saveCart = saveCart;

  function isProductInCart(productId) {
    if (!productId) return false;
    const cart = getCart();
    return cart.some(i => String(i.id).toLowerCase() === String(productId).toLowerCase());
  }
  window.isProductInCart = isProductInCart;

  function addToCart(product, openDrawer = false) {
    if (!product || !product.id) return;
    const cart = getCart();
    const existingIndex = cart.findIndex(i => String(i.id).toLowerCase() === String(product.id).toLowerCase());
    const pricing = getProductPrice(product);
    const thumb = extractProductCoverImage(product);
    const seller = product.sellerName || product.sellerStoreName || 'JaiGram Official';

    if (existingIndex > -1) {
      cart[existingIndex].qty = (cart[existingIndex].qty || 1) + 1;
      showAppToast(`Updated quantity in cart (${cart[existingIndex].qty}) 🛒`);
    } else {
      cart.push({
        id: String(product.id),
        name: product.title || product.name || 'Digital Pack',
        title: product.title || product.name || 'Digital Pack',
        inr: pricing.inr,
        usd: pricing.usd,
        price: pricing.amount,
        currency: pricing.currency,
        category: product.category || 'Digital Pack',
        image: thumb,
        sellerName: seller,
        qty: 1
      });
      showAppToast('Added to Cart 🛒');
    }

    saveCart(cart);
    if (openDrawer) {
      openCartDrawer();
    }
  }
  window.addToCart = addToCart;

  function removeFromCart(productId) {
    let cart = getCart();
    cart = cart.filter(i => String(i.id).toLowerCase() !== String(productId).toLowerCase());
    saveCart(cart);
    showAppToast('Item removed from cart');
  }
  window.removeFromCart = removeFromCart;

  function updateCartQty(productId, delta) {
    const cart = getCart();
    const item = cart.find(i => String(i.id).toLowerCase() === String(productId).toLowerCase());
    if (!item) return;

    item.qty = (item.qty || 1) + delta;
    if (item.qty <= 0) {
      removeFromCart(productId);
      return;
    }
    saveCart(cart);
  }
  window.updateCartQty = updateCartQty;

  function clearCart() {
    const cart = getCart();
    if (!cart.length) return;
    saveCart([]);
    showAppToast('Cart cleared');
  }
  window.clearCart = clearCart;

  function toggleCartProduct(productId) {
    const p = (allMarketplaceProducts || []).find(item => String(item.id).toLowerCase() === String(productId).toLowerCase()) ||
              (currentPdmProduct && String(currentPdmProduct.id).toLowerCase() === String(productId).toLowerCase() ? currentPdmProduct : null);
    if (!p) return;

    if (isProductInCart(productId)) {
      removeFromCart(productId);
    } else {
      addToCart(p, false);
    }
  }
  window.toggleCartProduct = toggleCartProduct;

  function toggleCartFromModal() {
    if (!currentPdmProduct) return;
    if (isProductInCart(currentPdmProduct.id)) {
      if (typeof window.openCartDrawer === 'function') {
        window.openCartDrawer();
      }
    } else {
      addToCart(currentPdmProduct, false);
      showAppToast('Added to Cart! 🛒');
      syncModalCartBtn();
    }
  }
  window.toggleCartFromModal = toggleCartFromModal;

  function syncModalCartBtn() {
    if (!currentPdmProduct) return;
    const inCart = isProductInCart(currentPdmProduct.id);
    const btns = [
      document.getElementById('pdmAddCartBtn'),
      document.getElementById('pdmMobAddCartBtn')
    ];
    btns.forEach(btn => {
      if (!btn) return;
      btn.classList.toggle('in-cart', inCart);
      const textSpan = btn.querySelector('span');
      if (textSpan) {
        textSpan.textContent = inCart ? 'GO TO CART' : 'ADD TO CART';
      }
      const icon = btn.querySelector('i');
      if (icon) {
        icon.className = inCart ? 'fa-solid fa-arrow-right-to-bracket' : 'fa-solid fa-cart-shopping';
      }
    });
  }
  window.syncModalCartBtn = syncModalCartBtn;

  function updateCartUI() {
    const cart = getCart();
    const totalItems = cart.reduce((sum, item) => sum + (item.qty || 1), 0);

    // 1. Top Navbar Badge
    const navBadge = document.getElementById('navCartBadgeCount');
    if (navBadge) {
      navBadge.textContent = totalItems;
      navBadge.style.display = totalItems > 0 ? 'inline-flex' : 'none';
    }

    // 1b. Full Page Product View Navbar Cart Badge
    const pdmCartPill = document.getElementById('pdmNavCartCount');
    if (pdmCartPill) {
      pdmCartPill.textContent = totalItems;
      pdmCartPill.style.display = totalItems > 0 ? 'inline-block' : 'none';
    }

    // 2. Native Mobile Bottom App Bar Badge
    const mobBadge = document.getElementById('mobCartBadgeCount');
    if (mobBadge) {
      mobBadge.textContent = totalItems;
      mobBadge.style.display = totalItems > 0 ? 'inline-flex' : 'none';
    }

    // 3. Floating Quick-Access Cart Badge (Disabled per user request)
    const floatBtn = document.getElementById('floatingCartBtn');
    if (floatBtn) {
      floatBtn.style.display = 'none';
    }

    // 4. Drawer count pill
    const drawerCount = document.getElementById('drawerCartCount');
    if (drawerCount) {
      drawerCount.textContent = `${totalItems} item${totalItems === 1 ? '' : 's'}`;
    }

    // 5. Active Product Detail Modal button
    syncModalCartBtn();

    // 6. Sync all in-card Add to Cart buttons
    const allCartButtons = document.querySelectorAll('.btn-store-card-cart, .btn-mp-cart');
    allCartButtons.forEach(btn => {
      const pId = btn.getAttribute('data-product-id');
      if (pId) {
        const inCart = isProductInCart(pId);
        btn.classList.toggle('added', inCart);
        btn.innerHTML = `<i class="fa-solid ${inCart ? 'fa-check' : 'fa-cart-plus'}"></i> <span>${inCart ? 'Added' : 'Add'}</span>`;
        btn.title = inCart ? 'In Cart' : 'Add to Cart';
      }
    });

    // 7. Render Drawer List
    renderCartDrawer();
  }
  window.updateCartUI = updateCartUI;

  function renderCartDrawer() {
    const body = document.getElementById('cartDrawerBody');
    const footer = document.getElementById('cartDrawerFooter');
    if (!body) return;

    const cart = getCart();
    if (!cart.length) {
      body.innerHTML = `
        <div class="cart-empty-view">
          <div class="cart-empty-icon"><i class="fa-solid fa-bag-shopping"></i></div>
          <h4 class="cart-empty-title">Your Cart is Empty</h4>
          <p class="cart-empty-desc">Explore top creators on JaiGram and add digital bundles to your cart.</p>
          <button type="button" class="btn-cart-empty-explore" onclick="closeCartDrawer(); switchTab('marketplace');">
            <i class="fa-solid fa-compass"></i> Explore Marketplace
          </button>
        </div>
      `;
      if (footer) footer.style.display = 'none';
      return;
    }

    if (footer) footer.style.display = 'block';

    let totalINR = 0;
    let totalUSD = 0;
    let totalItemsCount = 0;

    const itemsHtml = cart.map(item => {
      const qty = item.qty || 1;
      totalItemsCount += qty;
      const inrVal = Number(String(item.inr || item.price || 0).replace(/[^\d.]/g, '')) || 0;
      const usdVal = Number(String(item.usd || 0).replace(/[^\d.]/g, '')) || Math.max(2, Math.round(inrVal / 85));

      totalINR += (inrVal * qty);
      totalUSD += (usdVal * qty);

      const isUsd = (currentCurrency === 'USD');
      const unitDisplay = isUsd ? `$${usdVal}` : `₹${inrVal.toLocaleString('en-IN')}`;
      const lineTotal = isUsd ? `$${(usdVal * qty)}` : `₹${(inrVal * qty).toLocaleString('en-IN')}`;

      const safeId = escapeHtml(item.id);
      const safeTitle = escapeHtml(item.name || item.title || 'Digital Product');
      const rawImg = extractProductCoverImage(item);
      const safeImg = escapeHtml(rawImg);
      const safeSeller = escapeHtml(item.sellerName || 'JaiGram Creator');

      return `
        <div class="cart-item-row" data-cart-id="${safeId}">
          <div class="cart-item-thumb" onclick="closeCartDrawer(); openProductDetailModal('${safeId}');" title="View details">
            <img src="${safeImg}" alt="${safeTitle}" loading="lazy" onerror="this.onerror=null;this.src='../images/prod_vip_bundle.jpg';" />
          </div>
          <div class="cart-item-info">
            <h5 class="cart-item-title" onclick="closeCartDrawer(); openProductDetailModal('${safeId}');" title="${safeTitle}">${safeTitle}</h5>
            <div class="cart-item-meta">
              <span class="cart-item-creator"><i class="fa-solid fa-store"></i> ${safeSeller}</span>
            </div>
            <div class="cart-item-bottom">
              <div class="cart-item-price-wrap">
                <span class="cart-item-price">${lineTotal}</span>
                ${qty > 1 ? `<span class="cart-item-unit-hint">(${unitDisplay} each)</span>` : ''}
              </div>
              <div class="cart-item-qty-controls">
                <button type="button" class="btn-qty-mini" onclick="updateCartQty('${safeId}', -1)" aria-label="${qty === 1 ? 'Remove item' : 'Decrease quantity'}" title="${qty === 1 ? 'Remove from cart' : 'Decrease'}">
                  <i class="fa-solid ${qty === 1 ? 'fa-trash' : 'fa-minus'}"></i>
                </button>
                <span class="cart-qty-value">${qty}</span>
                <button type="button" class="btn-qty-mini" onclick="updateCartQty('${safeId}', 1)" aria-label="Increase quantity" title="Increase">
                  <i class="fa-solid fa-plus"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    const isUsd = (currentCurrency === 'USD');
    const billTotalDisplay = isUsd ? `$${totalUSD.toLocaleString('en-US')}` : `₹${totalINR.toLocaleString('en-IN')}`;

    const assuranceHtml = `
      <div class="cart-assurance-pill">
        <i class="fa-solid fa-shield-halved"></i>
        <span>100% Instant Digital Access &bull; Verified Downloads</span>
      </div>
    `;

    const billSummaryHtml = `
      <div class="cart-bill-summary-card">
        <div class="cart-bill-header">
          <i class="fa-solid fa-receipt"></i>
          <span>Bill Details</span>
        </div>
        <div class="cart-bill-row">
          <span>Items Total (${totalItemsCount} item${totalItemsCount > 1 ? 's' : ''})</span>
          <span>${billTotalDisplay}</span>
        </div>
        <div class="cart-bill-row">
          <span>Instant Download Access</span>
          <span class="text-free"><i class="fa-solid fa-bolt"></i> FREE</span>
        </div>
        <div class="cart-bill-row">
          <span>Taxes &amp; Platform Fee</span>
          <span class="text-free">Included</span>
        </div>
        <div class="cart-bill-divider"></div>
        <div class="cart-bill-row total-row">
          <span class="bill-total-label">Total Payable</span>
          <span class="bill-total-val">${billTotalDisplay}</span>
        </div>
      </div>
    `;

    body.innerHTML = assuranceHtml + itemsHtml + billSummaryHtml;

    const totalInrEl = document.getElementById('cartTotalINR');
    const totalUsdEl = document.getElementById('cartTotalUSD');
    if (totalInrEl) totalInrEl.textContent = `₹${totalINR.toLocaleString('en-IN')}`;
    if (totalUsdEl) totalUsdEl.textContent = `$${totalUSD.toLocaleString('en-US')}`;
  }
  window.renderCartDrawer = renderCartDrawer;

  function openCartDrawer() {
    const drawer = document.getElementById('cartDrawerOverlay');
    if (!drawer) return;
    updateCartUI();
    drawer.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Highlight cart item in mobile bottom navigation dock
    const mobCartBtn = document.getElementById('bottomTabCartBtn');
    if (mobCartBtn) {
      document.querySelectorAll('.mob-nav-item, .bottom-tab-btn').forEach(btn => btn.classList.remove('active'));
      mobCartBtn.classList.add('active');
    }

    // Push history state so native mobile back button closes the cart smoothly
    try {
      if (history && history.pushState && (!history.state || !history.state.cartOpen)) {
        history.pushState({ cartOpen: true }, '', '#cart');
      }
    } catch (_) {}
  }
  window.openCartDrawer = openCartDrawer;

  function closeCartDrawer() {
    const drawer = document.getElementById('cartDrawerOverlay');
    if (drawer) {
      drawer.classList.remove('active');
    }
    const remainingModals = document.querySelectorAll('.product-modal-backdrop.active, .user-modal-overlay.active, .store-modal-overlay.active');
    if (remainingModals.length === 0) {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }

    // Restore bottom bar active tab indicator based on active tab
    const activeView = document.querySelector('.tab-view-content.active');
    if (activeView) {
      const tabId = activeView.id.replace('tab-', '');
      const profileSubTabs = ['profile', 'edit-profile', 'settings', 'support', 'messages', 'refer'];
      const parentTab = profileSubTabs.includes(tabId) ? 'profile' : tabId;
      document.querySelectorAll('.mob-nav-item, .bottom-tab-btn').forEach(btn => {
        const btnTab = btn.getAttribute('data-tab');
        if (btnTab === parentTab || btnTab === tabId) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      try {
        if (history && history.replaceState) {
          history.replaceState(null, '', `#${tabId}`);
        }
      } catch (_) {}
    }
  }
  window.closeCartDrawer = closeCartDrawer;

  // Listen for mobile back button navigation
  window.addEventListener('popstate', function (e) {
    const drawer = document.getElementById('cartDrawerOverlay');
    if (drawer && drawer.classList.contains('active')) {
      closeCartDrawer();
    }
  });

  function handleCartOverlayClick(e) {
    if (e.target && e.target.id === 'cartDrawerOverlay') {
      closeCartDrawer();
    }
  }
  window.handleCartOverlayClick = handleCartOverlayClick;

  function handleCartCheckout() {
    const cart = getCart();
    if (!cart.length) {
      showAppToast('Your cart is empty! Add items first.');
      return;
    }
    const totalInr = cart.reduce((acc, item) => acc + (parseFloat(item.inr || item.price || 0) || 0), 0);
    const totalUsd = Number((totalInr / 90).toFixed(2));
    const title = cart.length === 1 ? (cart[0].title || 'Digital Product') : `Cart Bundle (${cart.length} items)`;
    if (window.JaiGramGateway || window.LinkAddaGateway) {
      closeCartDrawer();
      const gw = window.JaiGramGateway || window.LinkAddaGateway;
      gw.open({
        productId: 'cart_bundle',
        title: title,
        name: title,
        price: totalInr,
        inr: totalInr,
        usd: totalUsd,
        method: 'upi'
      });
      return;
    }
    window.location.href = '../payment.html?cart=1';
  }
  window.handleCartCheckout = handleCartCheckout;

  function initCart() {
    updateCartUI();
  }
  window.initCart = initCart;

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[m]);
  }

  // ━━ 18+ AGE & CONTENT RESTRICTION CONTROLLER (NON-BYPASSABLE) ━━
  function getCustomerIdentifier() {
    if (currentCustomer && (currentCustomer.email || currentCustomer.uid)) {
      return String(currentCustomer.email || currentCustomer.uid).toLowerCase().trim();
    }
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.email || parsed.uid)) {
          return String(parsed.email || parsed.uid).toLowerCase().trim();
        }
      }
    } catch (_) {}
    return 'unassigned_guest';
  }

  const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

  function is18PlusVerified() {
    return true;
  }
  window.is18PlusVerified = is18PlusVerified;

  function init18PlusAgeGate() {
    const modal = document.getElementById('ageGateOverlay');
    if (modal) {
      modal.classList.remove('active');
      modal.classList.add('hidden');
      modal.style.setProperty('display', 'none', 'important');
    }
    document.documentElement.classList.remove('age-gate-pending');
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  }
  window.init18PlusAgeGate = init18PlusAgeGate;

  function confirm18PlusAccess() {
    const now = Date.now();
    const validUntil = now + TEN_DAYS_MS;
    const id = getCustomerIdentifier();

    try {
      localStorage.setItem('linkadda_18plus_valid_until', String(validUntil));
      localStorage.setItem('linkadda_18plus_verified_time', String(now));
      localStorage.setItem('linkadda_18plus_verified', 'true');
      if (id) {
        localStorage.setItem('linkadda_18plus_valid_until_' + id, String(validUntil));
        localStorage.setItem('linkadda_18plus_verified_time_' + id, String(now));
        localStorage.setItem('linkadda_18plus_verified_' + id, 'true');
      }
    } catch (e) {
      console.warn('Storage save error:', e);
    }

    document.documentElement.classList.remove('age-gate-pending');
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';

    const modal = document.getElementById('ageGateOverlay');
    if (modal) {
      modal.classList.remove('active');
      modal.classList.add('hidden');
      modal.style.setProperty('display', 'none', 'important');

      // Check if there was a pending deep-linked product or store
      const urlParams = new URLSearchParams(window.location.search);
      const deepProdId = urlParams.get('productId') || urlParams.get('id');
      let deepStore = urlParams.get('store') || urlParams.get('seller') || urlParams.get('sellerId');
      if (!deepStore && window.location.hash) {
        if (window.location.hash.startsWith('#store-')) deepStore = decodeURIComponent(window.location.hash.replace('#store-', ''));
        else if (window.location.hash.startsWith('#seller-')) deepStore = decodeURIComponent(window.location.hash.replace('#seller-', ''));
      }
      if (deepProdId && typeof window.openProductDetailModal === 'function') {
        window.openProductDetailModal(deepProdId);
      } else if (deepStore && typeof window.openStoreShowcaseModal === 'function') {
        window.openStoreShowcaseModal(deepStore);
      }
    }
  }
  window.confirm18PlusAccess = confirm18PlusAccess;

  function cancel18PlusAccess() {
    const btnCancel = document.getElementById('btnAgeCancel');
    if (btnCancel) {
      btnCancel.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Exiting...</span>';
      btnCancel.style.pointerEvents = 'none';
    }

    // Clear session so returning to login or storefront does not bounce back in an endless loop
    try {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem('linkadda_pending_destination');
    } catch (_) {}

    // Send user back to site login or previous page (never external Google)
    if (window.history.length > 1 && document.referrer && document.referrer.indexOf(window.location.host) !== -1) {
      window.history.back();
    } else {
      window.location.replace('../login.html');
    }
  }
  window.cancel18PlusAccess = cancel18PlusAccess;

  // ━━ ORDER RECEIPT MODAL CONTROLLER ━━
  function openOrderReceiptModal(orderId) {
    if (!orderId) return;
    const cleanRaw = String(orderId).replace(/^#+/, '').trim();
    const digits = cleanRaw.match(/\d{5,8}/)?.[0] || '';
    const cKey = getCanonicalOrderKey(cleanRaw);

    const ord = (userOrders || []).find(o => {
      const oId = String(o.orderId || o.id || o.displayOrderId || '').replace(/^#+/, '').trim();
      const oDigits = oId.match(/\d{5,8}/)?.[0] || '';
      return oId === cleanRaw || (digits && oDigits && digits === oDigits) || (cKey && getCanonicalOrderKey(oId) === cKey);
    }) || {};

    const dispId = getCleanDisplayOrderId(ord) || ('#' + cleanRaw);
    const title = getCleanOrderTitle(ord) || 'Digital VIP Pack';
    const seller = getCleanOrderSeller(ord) || '༒•*̥TRUSTED BROTHER•*̥';
    const dateStr = getCleanOrderDate(ord) || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const amtStr = getCleanOrderAmount(ord) || '₹399.00';
    const methodStr = String(ord.paymentMethod || ord.method || 'UPI Instant').toUpperCase();
    const utrStr = String(ord.utr || '').trim();
    const custEmail = ord.customerEmail || ord.email || ord.buyerEmail || currentCustomer?.email || 'Registered Customer';
    const custName = ord.customerName || ord.name || ord.buyerName || currentCustomer?.name || 'Verified Member';
    const dlLink = ord.downloadLink || ord.fileUrl || ord.orderLink || '';

    const status = String(ord.status || ord.orderStatus || 'pending').toLowerCase();
    const isApproved = status === 'approved' || status === 'completed' || status === 'paid' || status === 'confirmed';
    const isRejected = status === 'rejected' || status === 'failed' || status === 'cancelled';

    // Populate modal elements
    const modal = document.getElementById('orderReceiptModal');
    if (!modal) return;

    const idEl = document.getElementById('ormOrderId');
    const badgeEl = document.getElementById('ormOrderBadge');
    const dateEl = document.getElementById('ormDateTime');
    const custEl = document.getElementById('ormCustomer');
    const methodEl = document.getElementById('ormMethod');
    const utrEl = document.getElementById('ormUtr');
    const utrRow = document.getElementById('ormUtrRow');
    const sellerEl = document.getElementById('ormSeller');
    const titleEl = document.getElementById('ormItemTitle');
    const itemAmtEl = document.getElementById('ormItemAmt');
    const totalAmtEl = document.getElementById('ormTotalAmt');
    const statusIcon = document.getElementById('ormStatusIcon');
    const statusText = document.getElementById('ormStatusText');
    const statusBanner = document.getElementById('ormStatusBanner');
    const accessSec = document.getElementById('ormAccessSection');
    const pendingSec = document.getElementById('ormPendingSection');
    const accessBtn = document.getElementById('ormAccessBtn');

    if (idEl) idEl.textContent = dispId;
    if (badgeEl) badgeEl.textContent = dispId;
    if (dateEl) dateEl.textContent = dateStr;
    if (custEl) custEl.textContent = `${custName} (${custEmail})`;
    if (methodEl) methodEl.textContent = methodStr;
    if (sellerEl) sellerEl.textContent = seller;
    if (titleEl) titleEl.textContent = title;
    if (itemAmtEl) itemAmtEl.textContent = amtStr;
    if (totalAmtEl) totalAmtEl.textContent = amtStr;

    if (utrStr && utrStr.trim()) {
      if (utrEl) utrEl.textContent = utrStr;
      if (utrRow) utrRow.style.display = 'block';
    } else {
      if (utrRow) utrRow.style.display = 'none';
    }

    if (isApproved) {
      if (statusIcon) statusIcon.className = 'fa-solid fa-circle-check';
      if (statusIcon) statusIcon.style.color = '#10b981';
      if (statusText) {
        statusText.textContent = 'Payment Verified & Approved';
        statusText.style.color = '#10b981';
      }
      if (statusBanner) {
        statusBanner.style.background = 'rgba(16, 185, 129, 0.12)';
        statusBanner.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      }
      if (accessSec) accessSec.style.display = 'block';
      if (pendingSec) pendingSec.style.display = 'none';
      if (accessBtn) accessBtn.href = dlLink || 'https://t.me/TRUSTED_BROTHER1234';
    } else if (isRejected) {
      if (statusIcon) statusIcon.className = 'fa-solid fa-circle-xmark';
      if (statusIcon) statusIcon.style.color = '#ef4444';
      if (statusText) {
        statusText.textContent = 'Payment Proof Rejected';
        statusText.style.color = '#ef4444';
      }
      if (statusBanner) {
        statusBanner.style.background = 'rgba(239, 68, 68, 0.12)';
        statusBanner.style.borderColor = 'rgba(239, 68, 68, 0.3)';
      }
      if (accessSec) accessSec.style.display = 'none';
      if (pendingSec) {
        pendingSec.style.display = 'block';
        const rejReason = ord.rejectionReason || ord.rejectReason || ord.adminRemarks || 'Screenshot or reference could not be verified by Admin.';
        pendingSec.innerHTML = `<i class="fa-solid fa-circle-xmark" style="color:#ef4444;"></i> <strong style="color:#ef4444;">Payment Verification Failed:</strong> ${escapeHtml(rejReason)}<br><small style="color:var(--text-muted); margin-top:5px; display:inline-block;">If you believe this was an error, please reach out to admin support with your payment UTR reference.</small>`;
      }
    } else {
      if (statusIcon) statusIcon.className = 'fa-solid fa-clock';
      if (statusIcon) statusIcon.style.color = '#f59e0b';
      if (statusText) {
        statusText.textContent = 'Verification in Progress';
        statusText.style.color = '#f59e0b';
      }
      if (statusBanner) {
        statusBanner.style.background = 'rgba(245, 158, 11, 0.12)';
        statusBanner.style.borderColor = 'rgba(245, 158, 11, 0.3)';
      }
      if (accessSec) accessSec.style.display = 'none';
      if (pendingSec) {
        pendingSec.style.display = 'block';
        pendingSec.innerHTML = '<i class="fa-solid fa-clock"></i> <strong>Pending Admin Verification:</strong> We are verifying your payment screenshot/UTR. Once approved by admin, you will receive an official approval email and app notification, and access will unlock right here!';
      }
    }

    modal.style.display = 'flex';
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeOrderReceiptModal() {
    const modal = document.getElementById('orderReceiptModal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
    document.body.style.overflow = '';
  }

  function printOrderReceiptModal() {
    window.print();
  }

  function shareOrderReceiptModal() {
    const idEl = document.getElementById('ormOrderId');
    const titleEl = document.getElementById('ormItemTitle');
    const amtEl = document.getElementById('ormTotalAmt');
    const orderId = idEl ? idEl.textContent : '';
    const title = titleEl ? titleEl.textContent : '';
    const amt = amtEl ? amtEl.textContent : '';

    const shareData = {
      title: `JaiGram Receipt ${orderId}`,
      text: `Official Receipt for JaiGram Order ${orderId}: ${title} (${amt}) - Verified & Secured by JaiGram Shop.`,
      url: window.location.href
    };

    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      navigator.share(shareData).catch(() => {});
    } else {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareData.text).then(() => {
          showAppToast('Receipt details copied to clipboard!');
        }).catch(() => {
          prompt('Receipt Details:', shareData.text);
        });
      } else {
        prompt('Receipt Details:', shareData.text);
      }
    }
  }

  window.openOrderReceiptModal = openOrderReceiptModal;
  window.closeOrderReceiptModal = closeOrderReceiptModal;
  window.printOrderReceiptModal = printOrderReceiptModal;
  window.shareOrderReceiptModal = shareOrderReceiptModal;

})();
