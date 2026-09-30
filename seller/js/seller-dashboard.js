// seller/js/seller-dashboard.js
// Ultra-Modern Luxury Creator Dashboard Logic for LinkAdda

import { getSellerSession, requireSellerAuth, logoutSeller, changeSellerPassword, updateSellerProfile, getApiUrl } from './seller-auth.js';

const RTDB_URL = 'https://linkadda-cd1da-default-rtdb.firebaseio.com';

let currentSeller = null;
let currentSessionToken = null;
let sellerProducts = [];
let allCategories = [];
let sellerOrders = [];
let sellerPayouts = null;

// Search, Filter & Sort State
let searchQuery = '';
let selectedCategory = 'all';
let sortBy = 'newest';
let pendingDeleteId = null;

// ══════════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS (LUXURY FLOATING CARDS)
// ══════════════════════════════════════════════════════════════════
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `seller-toast toast-${type}`;
  const icon = type === 'success' ? 'fa-check' : type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-info';
  toast.innerHTML = `
    <span class="toast-icon"><i class="fa-solid ${icon}"></i></span>
    <span class="toast-msg">${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Helpers
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatINR(val) {
  const num = Number(val) || 0;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(num);
}

function formatDate(ts) {
  if (!ts) return 'N/A';
  const d = new Date(ts);
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ━━ SELLER PROFILE AVATAR MANAGEMENT (DIRECT DEVICE UPLOAD ONLY - NO URLS) ━━
function syncSellerAvatarUI(avatarData) {
  const avatar = avatarData !== undefined ? avatarData : (currentSeller?.avatar || '');
  const initial = (currentSeller?.storeName || currentSeller?.ownerName || 'S').trim().charAt(0).toUpperCase();

  const topAvatar = document.getElementById('seller-avatar');
  if (topAvatar) {
    if (avatar) {
      topAvatar.innerHTML = `<img src="${avatar}" class="seller-avatar-img" alt="Store Logo" onerror="this.onerror=null;this.parentElement.textContent='${initial}';" />`;
    } else {
      topAvatar.textContent = initial;
    }
  }

  const profHeroAvatar = document.getElementById('prof-hero-avatar');
  const btnRemove = document.getElementById('btn-remove-avatar-chip');
  if (profHeroAvatar) {
    if (avatar) {
      profHeroAvatar.innerHTML = `<img src="${avatar}" class="seller-avatar-img" alt="Store Logo" onerror="this.onerror=null;this.parentElement.textContent='${initial}';" />`;
      if (btnRemove) btnRemove.style.display = 'inline-flex';
    } else {
      profHeroAvatar.textContent = initial;
      if (btnRemove) btnRemove.style.display = 'none';
    }
  }
}

function compressImageToDataUri(file, maxWidth = 400, maxHeight = 400, quality = 0.88) {
  return new Promise((resolve, reject) => {
    if (file.type === 'image/svg+xml') {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        const size = Math.min(width, height);
        const startX = (width - size) / 2;
        const startY = (height - size) / 2;

        const targetSize = Math.min(size, maxWidth);
        const canvas = document.createElement('canvas');
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');

        ctx.drawImage(img, startX, startY, size, size, 0, 0, targetSize, targetSize);

        const dataUri = canvas.toDataURL('image/webp', quality) || canvas.toDataURL('image/jpeg', quality);
        resolve(dataUri);
      };
      img.onerror = () => reject(new Error('Failed to parse uploaded image.'));
      img.src = readerEvent.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

let avatarListenersBound = false;
function setupAvatarUploadListeners() {
  if (avatarListenersBound) return;
  avatarListenersBound = true;

  const fileInput = document.getElementById('seller-avatar-file-input');
  const triggerBtn = document.getElementById('btn-trigger-avatar-upload');
  const uploadChip = document.getElementById('btn-upload-avatar-chip');
  const avatarWrap = document.getElementById('prof-avatar-wrap');
  const removeBtn = document.getElementById('btn-remove-avatar-chip');

  const openPicker = () => {
    if (fileInput) fileInput.click();
  };

  if (triggerBtn) triggerBtn.addEventListener('click', (e) => { e.stopPropagation(); openPicker(); });
  if (uploadChip) uploadChip.addEventListener('click', (e) => { e.stopPropagation(); openPicker(); });
  if (avatarWrap) avatarWrap.addEventListener('click', () => { openPicker(); });

  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        showToast('Please upload an image file (PNG, JPG, WebP, or SVG).', 'error');
        return;
      }

      if (file.size > 8 * 1024 * 1024) {
        showToast('Image size exceeds 8MB. Please choose a smaller photo.', 'error');
        return;
      }

      try {
        showToast('Optimizing photo...', 'info');
        const compressedBase64 = await compressImageToDataUri(file, 400, 400, 0.88);
        if (!currentSeller) currentSeller = {};
        currentSeller.avatar = compressedBase64;
        syncSellerAvatarUI(compressedBase64);

        // Auto-save to server immediately for instant persistence
        try {
          await updateSellerProfile({ avatar: compressedBase64 });
          showToast('Store photo updated successfully!', 'success');
        } catch (saveErr) {
          showToast('Store photo ready. Click Save Profile to apply.', 'info');
        }
      } catch (err) {
        console.error('Avatar error:', err);
        showToast('Could not process image. Please try another photo.', 'error');
      } finally {
        fileInput.value = '';
      }
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Remove your store photo and reset to default monogram?')) {
        if (!currentSeller) currentSeller = {};
        currentSeller.avatar = '';
        syncSellerAvatarUI('');
        try {
          await updateSellerProfile({ avatar: '' });
          showToast('Store photo removed.', 'info');
        } catch (e) {
          showToast('Click Save Profile to commit photo removal.', 'info');
        }
      }
    });
  }
}

// ══════════════════════════════════════════════════════════════════
// DASHBOARD INITIALIZATION
// ══════════════════════════════════════════════════════════════════
export async function initSellerDashboard() {
  const session = await requireSellerAuth();
  if (!session) return;

  currentSeller = session.seller;
  currentSessionToken = session.token || null;

  // Render seller brand info in header
  const storeNameEl = document.getElementById('seller-store-name');
  if (storeNameEl) storeNameEl.textContent = currentSeller.storeName || 'My Creator Store';

  const heroStoreName = document.getElementById('hero-store-name');
  if (heroStoreName) heroStoreName.textContent = currentSeller.storeName || 'Creator Store';

  const ownerNameEl = document.getElementById('seller-owner-name');
  if (ownerNameEl) ownerNameEl.textContent = currentSeller.ownerName || currentSeller.email;

  const emailEl = document.getElementById('seller-email');
  if (emailEl) emailEl.textContent = currentSeller.email;

  // Sync avatar and attach device file upload listener (No URLs allowed)
  syncSellerAvatarUI();
  setupAvatarUploadListeners();

  // Pre-fill Profile & Settings Form Fields
  populateProfileForm();
  window.switchToTab = switchToTab;

  // Setup Logout
  const logoutBtn = document.getElementById('btn-seller-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (confirm('Are you sure you want to log out of JaiGram Seller Hub?')) {
        logoutSeller();
      }
    });
  }

  // Setup Must Change Password Modal
  if (currentSeller.mustChangePassword) {
    openPasswordModal(true);
  }

  // Load Data
  await Promise.all([
    loadCategories(),
    loadSellerProducts(),
    loadSellerOrders(),
    loadSellerFollowers(),
  ]);

  setupEventListeners();
}

export function switchToTab(tabName) {
  const navTabs = document.querySelectorAll('.seller-nav-item[data-tab]');
  navTabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === tabName));

  const dockTabs = document.querySelectorAll('.dock-nav-item[data-tab]');
  dockTabs.forEach(d => d.classList.toggle('active', d.getAttribute('data-tab') === tabName));

  document.querySelectorAll('.tab-section').forEach(sec => {
    const isTarget = sec.id === `section-${tabName}`;
    sec.classList.toggle('active', isTarget);
    sec.style.display = isTarget ? 'block' : 'none';
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function populateProfileForm() {
  renderSellerProfileUI();
}

// ══════════════════════════════════════════════════════════════════
// PAYOUT DESTINATION UI SYNC (INDIA & INTERNATIONAL)
// ══════════════════════════════════════════════════════════════════
export function syncSellerPayoutUI(seller = currentSeller || {}) {
  if (!seller) return;
  const method = seller.payoutMethod || (seller.upiId ? 'upi' : (seller.usdtAddress ? 'crypto' : (seller.accountNumber ? 'bank' : 'upi')));
  
  // Set tab buttons active state
  document.querySelectorAll('.btn-payout-tab').forEach(btn => {
    const type = btn.dataset.payoutType;
    if (type === method) {
      btn.classList.add('active');
      btn.style.background = 'rgba(16, 185, 129, 0.15)';
      btn.style.color = '#34d399';
      btn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    } else {
      btn.classList.remove('active');
      btn.style.background = 'rgba(255, 255, 255, 0.04)';
      btn.style.color = 'var(--sd-text-muted)';
      btn.style.borderColor = 'rgba(255, 255, 255, 0.1)';
    }
  });

  // Toggle field groups
  const groups = ['upi', 'bank', 'crypto', 'binance', 'paypal'];
  groups.forEach(g => {
    const el = document.getElementById(`payout-group-${g}`);
    if (el) el.style.display = (g === method) ? 'block' : 'none';
  });

  const hiddenMethod = document.getElementById('selected-payout-method');
  if (hiddenMethod) hiddenMethod.value = method;

  // Populate inputs
  const upiInput = document.getElementById('seller-upi-input');
  const profUpi = document.getElementById('prof-upi');
  const savedUpi = seller.upiId || localStorage.getItem(`linkadda_seller_upi_${seller.id}`) || '';
  if (upiInput) upiInput.value = savedUpi;
  if (profUpi) profUpi.value = savedUpi;

  const bankHolder = document.getElementById('seller-bank-holder');
  if (bankHolder) bankHolder.value = seller.accountHolder || '';
  const bankName = document.getElementById('seller-bank-name');
  if (bankName) bankName.value = seller.bankName || '';
  const bankAcc = document.getElementById('seller-bank-acc');
  if (bankAcc) bankAcc.value = seller.accountNumber || '';
  const bankIfsc = document.getElementById('seller-bank-ifsc');
  if (bankIfsc) bankIfsc.value = seller.ifsc || '';

  const usdtNet = document.getElementById('seller-usdt-network');
  if (usdtNet) usdtNet.value = seller.usdtNetwork || 'TRC-20';
  const usdtAddr = document.getElementById('seller-usdt-address');
  if (usdtAddr) usdtAddr.value = seller.usdtAddress || '';

  const binanceId = document.getElementById('seller-binance-id');
  if (binanceId) binanceId.value = seller.binancePayId || '';

  const paypalEmail = document.getElementById('seller-paypal-email');
  if (paypalEmail) paypalEmail.value = seller.paypalEmail || '';

  // Update Active Payout Destination Banner (so seller sees it clearly!)
  const displayEl = document.getElementById('payout-active-destination-display');
  const iconEl = document.getElementById('payout-status-icon');
  const pillEl = document.getElementById('payout-status-pill');

  let desc = '';
  let iconClass = 'fa-money-bill-transfer';
  let isConfigured = false;

  if (method === 'upi' && savedUpi) {
    desc = `⚡ UPI ID: ${savedUpi}`;
    iconClass = 'fa-qrcode';
    isConfigured = true;
  } else if (method === 'bank' && seller.accountNumber) {
    desc = `🏦 Bank A/C: ••••${seller.accountNumber.slice(-4)} (${seller.bankName || 'Bank'}) · IFSC: ${seller.ifsc || 'Set'}`;
    iconClass = 'fa-building-columns';
    isConfigured = true;
  } else if (method === 'crypto' && seller.usdtAddress) {
    desc = `💎 USDT (${seller.usdtNetwork || 'TRC-20'}): ${seller.usdtAddress.slice(0, 8)}...${seller.usdtAddress.slice(-6)}`;
    iconClass = 'fa-coins';
    isConfigured = true;
  } else if (method === 'binance' && seller.binancePayId) {
    desc = `🟡 Binance Pay ID: ${seller.binancePayId}`;
    iconClass = 'fa-wallet';
    isConfigured = true;
  } else if (method === 'paypal' && seller.paypalEmail) {
    desc = `💳 PayPal: ${seller.paypalEmail}`;
    iconClass = 'fa-credit-card';
    isConfigured = true;
  }

  if (displayEl) {
    if (isConfigured) {
      displayEl.innerHTML = `<span style="color: #34d399;">${escapeHtml(desc)}</span>`;
      if (pillEl) {
        pillEl.textContent = '✓ Ready for Payouts';
        pillEl.style.background = 'rgba(16, 185, 129, 0.2)';
        pillEl.style.color = '#34d399';
        pillEl.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      }
    } else {
      displayEl.innerHTML = `<span style="color: #fbbf24; font-size: 0.95rem;">⚠️ No Payout Destination Configured. Please enter your UPI or Bank/Crypto below.</span>`;
      if (pillEl) {
        pillEl.textContent = 'Action Required';
        pillEl.style.background = 'rgba(245, 158, 11, 0.2)';
        pillEl.style.color = '#fbbf24';
        pillEl.style.borderColor = 'rgba(245, 158, 11, 0.4)';
      }
    }
  }

  if (iconEl) {
    iconEl.className = `fa-solid ${iconClass}`;
  }

  const profHeroUpi = document.getElementById('prof-hero-upi');
  if (profHeroUpi) {
    profHeroUpi.textContent = isConfigured ? desc : 'Not Configured';
  }
}

function renderSellerProfileUI() {
  if (!currentSeller) return;

  const storeInput = document.getElementById('prof-store-name');
  if (storeInput) storeInput.value = currentSeller.storeName || '';

  const ownerInput = document.getElementById('prof-owner-name');
  if (ownerInput) ownerInput.value = currentSeller.ownerName || '';

  const emailInput = document.getElementById('prof-email');
  if (emailInput) emailInput.value = currentSeller.email || '';

  const phoneInput = document.getElementById('prof-phone');
  if (phoneInput) phoneInput.value = currentSeller.phone || '';

  const tgInput = document.getElementById('prof-telegram');
  if (tgInput) tgInput.value = currentSeller.telegram || '';

  const profCat = document.getElementById('prof-category');
  if (profCat) profCat.value = currentSeller.category || '';

  // Synchronize full payout destination UI
  syncSellerPayoutUI(currentSeller);

  // Sync Creator Brand Showcase Banner in Profile tab
  syncSellerAvatarUI();
  const profHeroStore = document.getElementById('prof-hero-store-name');
  if (profHeroStore) profHeroStore.textContent = currentSeller.storeName || 'Creator Store';
  const profHeroEmail = document.getElementById('prof-hero-email');
  if (profHeroEmail) profHeroEmail.textContent = currentSeller.email || '';
  const profHeroCat = document.getElementById('prof-hero-category');
  if (profHeroCat) profHeroCat.textContent = currentSeller.category || 'General';
  const profHeroFollowers = document.getElementById('prof-hero-followers');
  const followerCount = Number(currentSeller.followerCount || currentSeller.followers || 0);
  if (profHeroFollowers) profHeroFollowers.textContent = `${followerCount.toLocaleString('en-IN')} Followers`;
}

// ══════════════════════════════════════════════════════════════════
// DATA LOADING: CATEGORIES, PRODUCTS, ORDERS
// ══════════════════════════════════════════════════════════════════
async function loadCategories() {
  try {
    const res = await fetch(`${RTDB_URL}/categories.json`);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object') {
        allCategories = Object.values(data)
          .map(c => typeof c === 'string' ? c : (c.title || c.badge || c.name || ''))
          .filter(c => Boolean(c) && !c.includes('???') && c.length > 2);
        allCategories = Array.from(new Set(allCategories));
      }
    }
  } catch (_) {}

  // Collect dynamic categories from seller's own products
  const prodCats = Array.from(new Set(sellerProducts.map(p => p.category).filter(Boolean)));
  allCategories = Array.from(new Set([...allCategories, ...prodCats]));

  // Populate toolbar category filter
  syncToolbarCategoryFilter();
}

// Fetch live follower count for this seller
async function loadSellerFollowers() {
  if (!currentSeller) return;
  try {
    const sId = currentSeller.id || '';
    const sName = currentSeller.storeName || '';
    const res = await fetch(`/api/seller/auth?action=get_store_followers&sellerId=${encodeURIComponent(sId)}&storeName=${encodeURIComponent(sName)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.followerCount === 'number') {
        currentSeller.followerCount = data.followerCount;
        updateMetrics();
      }
    }
  } catch (_) {}
}

function syncToolbarCategoryFilter() {
  const catFilter = document.getElementById('packs-category-filter');
  if (!catFilter) return;

  const usedCategories = new Set(sellerProducts.map(p => p.category).filter(Boolean));
  allCategories.forEach(c => usedCategories.add(c));

  catFilter.innerHTML = '<option value="all">All Categories</option>' + 
    Array.from(usedCategories).map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

// Load Seller Products
async function loadSellerProducts() {
  try {
    const res = await fetch(`${RTDB_URL}/products.json?_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to fetch products');
    const data = await res.json();

    sellerProducts = [];
    const sEmail = String(currentSeller?.email || '').toLowerCase().trim();
    const sStore = String(currentSeller?.storeName || '').toLowerCase().trim();
    const sId = String(currentSeller?.id || '').trim();
    const isTb = sEmail === 'jaibajpai67@gmail.com' || sStore.includes('trusted');

    if (data && typeof data === 'object') {
      for (const [id, prod] of Object.entries(data)) {
        if (!prod || typeof prod !== 'object') continue;
        const pEmail = String(prod.sellerEmail || '').toLowerCase().trim();
        const pStore = String(prod.sellerName || prod.sellerStoreName || '').toLowerCase().trim();
        const pId = String(prod.sellerId || '').trim();

        const isOtherVerifiedSeller = (pEmail && pEmail !== 'jaibajpai67@gmail.com' && pEmail !== 'ritikanetwork96@gmail.com') &&
                                      (pId && pId !== 'seller_jaibajpai67' && pId !== 'seller_6e2c36f417' && pId !== 'master_admin');
        const matchTb = isTb && !isOtherVerifiedSeller;
        const matchDirect = (pId && sId && pId === sId) || (pEmail && sEmail && pEmail === sEmail);

        if (matchTb || matchDirect) {
          let resolvedSellerName = String(prod.sellerName || prod.sellerStoreName || '').trim();
          if (!resolvedSellerName || /linkadda/i.test(resolvedSellerName)) {
            resolvedSellerName = currentSeller?.storeName || 'Trusted brother';
          }
          sellerProducts.push({ ...prod, id, sellerName: resolvedSellerName });
        }
      }
    }

    // Sort by displayOrder first, then newest
    sellerProducts.sort((a, b) => {
      const orderA = a.displayOrder !== undefined && a.displayOrder !== null ? Number(a.displayOrder) : 999999;
      const orderB = b.displayOrder !== undefined && b.displayOrder !== null ? Number(b.displayOrder) : 999999;
      if (orderA !== orderB) return orderA - orderB;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    syncToolbarCategoryFilter();
    renderProducts();
    updateMetrics();
  } catch (err) {
    console.error('Error loading products:', err);
    showToast('Failed to load your products.', 'error');
  }
}

// Load Seller Orders
async function loadSellerOrders() {
  try {
    const res = await fetch(getApiUrl('/api/seller/products'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'orders',
        sellerId: currentSeller.id,
        token: currentSessionToken,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.success) {
        sellerOrders = data.orders || [];
        sellerPayouts = data.payouts || null;
        renderOrders();
        updateMetrics();
        return;
      }
    }
  } catch (apiErr) {
    console.warn('API orders fetch notice:', apiErr);
  }

  // Direct RTDB fetch fallback
  try {
    const res = await fetch(`${RTDB_URL}/orders.json?_t=${Date.now()}`);
    if (!res.ok) return;
    const data = await res.json();

    sellerOrders = [];
    if (data && typeof data === 'object') {
      const myProductIds = new Set(sellerProducts.map(p => p.id));
      const myProductNames = new Set(sellerProducts.map(p => String(p.name || '').toLowerCase().trim()));

      for (const [id, ord] of Object.entries(data)) {
        if (!ord) continue;

        let isSellerOrder = false;
        let matchedItem = null;

        if (Array.isArray(ord.items)) {
          matchedItem = ord.items.find(it => myProductIds.has(it.id) || myProductNames.has(String(it.name || '').toLowerCase().trim()));
          if (matchedItem) isSellerOrder = true;
        } else if (ord.productId && myProductIds.has(ord.productId)) {
          isSellerOrder = true;
          matchedItem = { name: ord.productName, price: ord.amount };
        } else if (ord.productName && myProductNames.has(String(ord.productName).toLowerCase().trim())) {
          isSellerOrder = true;
          matchedItem = { name: ord.productName, price: ord.amount };
        }

        if (isSellerOrder) {
          const statusVal = String(ord.status || ord.orderStatus || ord.paymentStatus || '').toLowerCase();
          const isApproved = statusVal === 'approved' || statusVal === 'completed' || statusVal === 'paid' || statusVal === 'verified' || ord.verified === true;

          // STRICT SECURITY RULE: If admin has not approved the order, do NOT show to seller
          if (!isApproved) continue;

          // STRICT PRIVACY: Seller must NEVER see customer payment screenshots, UTR or personal details
          const safeOrd = { ...ord };
          delete safeOrd.screenshot;
          delete safeOrd.paymentProof;
          delete safeOrd.screenshotUrl;
          delete safeOrd.proof;
          delete safeOrd.proofUrl;
          delete safeOrd.receipt;
          delete safeOrd.receiptUrl;
          delete safeOrd.screenshotBase64;
          delete safeOrd.utr;

          sellerOrders.push({
            id,
            ...safeOrd,
            isApproved: true,
            customerName: 'Verified Buyer', // PRIVACY: Anonymize buyer for seller
            customerEmail: '',
            customerPhone: '',
            matchedItem: matchedItem || {},
          });
        }
      }
    }

    renderOrders();
    updateMetrics();
  } catch (err) {
    console.warn('Orders fetch note:', err);
  }
}

// ══════════════════════════════════════════════════════════════════
// METRICS & TABS COUNTERS
// ══════════════════════════════════════════════════════════════════
function updateMetrics() {
  const prodCountEl = document.getElementById('stat-total-products');
  if (prodCountEl) prodCountEl.textContent = sellerProducts.length;

  const ordersCountEl = document.getElementById('stat-total-orders');
  if (ordersCountEl) ordersCountEl.textContent = sellerOrders.length;

  // Tabs counters (both desktop & mobile app bottom bar)
  const tabProdCount = document.getElementById('tab-prod-count');
  if (tabProdCount) tabProdCount.textContent = sellerProducts.length;

  const mobileTabProdCount = document.getElementById('mobile-tab-prod-count');
  if (mobileTabProdCount) mobileTabProdCount.textContent = sellerProducts.length;

  const tabOrdersCount = document.getElementById('tab-orders-count');
  if (tabOrdersCount) tabOrdersCount.textContent = sellerOrders.length;

  const mobileTabOrdersCount = document.getElementById('mobile-tab-orders-count');
  if (mobileTabOrdersCount) mobileTabOrdersCount.textContent = sellerOrders.length;

  // Calculate Revenue (100% Creator Share for Approved Orders Only)
  let totalRevenue = 0;
  if (sellerPayouts && typeof sellerPayouts.totalCreatorEarnings === 'number') {
    totalRevenue = sellerPayouts.totalCreatorEarnings;
  } else {
    sellerOrders.forEach(o => {
      const isApproved = o.isApproved !== false && (o.status === 'approved' || o.orderStatus === 'approved' || o.paymentStatus === 'approved' || o.payoutStatus === 'settled' || o.payoutStatus === 'escrow');
      if (isApproved) {
        const amt = Number(o.creatorEarnings || o.matchedItem?.price || o.amount || o.totalAmount || 0);
        totalRevenue += amt;
      }
    });
  }

  const revEl = document.getElementById('stat-total-revenue');
  if (revEl) revEl.textContent = formatINR(Math.round(totalRevenue));

  // Total Impressions (Views) & Appreciations (Likes)
  let totalViews = 0;
  let totalLikes = 0;
  sellerProducts.forEach(p => {
    totalViews += Math.max(Number(p.views || 0), 0);
    totalLikes += Math.max(Number(p.likes || 0), 0);
  });
  const viewsEl = document.getElementById('stat-total-views');
  if (viewsEl) viewsEl.textContent = totalViews.toLocaleString('en-IN');
  const likesEl = document.getElementById('stat-total-likes');
  if (likesEl) likesEl.textContent = totalLikes.toLocaleString('en-IN');

  // Store Followers
  const followersCountEl = document.getElementById('stat-total-followers');
  const fCount = Number(currentSeller?.followerCount || currentSeller?.followers || 0);
  if (followersCountEl) followersCountEl.textContent = fCount.toLocaleString('en-IN');
  const heroFollowers = document.getElementById('hero-followers-count');
  if (heroFollowers) heroFollowers.textContent = fCount.toLocaleString('en-IN');
  const profHeroFollowers = document.getElementById('prof-hero-followers');
  if (profHeroFollowers) profHeroFollowers.textContent = `${fCount.toLocaleString('en-IN')} Followers`;
}

// ══════════════════════════════════════════════════════════════════
// FILTERING, SEARCHING & SORTING PACKS
// ══════════════════════════════════════════════════════════════════
function getFilteredProducts() {
  let list = [...sellerProducts];

  // 1. Search Query Filter
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(p => {
      const name = String(p.name || p.title || '').toLowerCase();
      const cat = String(p.category || '').toLowerCase();
      const desc = String(p.description || '').toLowerCase();
      const tags = Array.isArray(p.features) ? p.features.join(' ').toLowerCase() : '';
      return name.includes(q) || cat.includes(q) || desc.includes(q) || tags.includes(q);
    });
  }

  // 2. Category Filter
  if (selectedCategory && selectedCategory !== 'all') {
    list = list.filter(p => p.category === selectedCategory);
  }

  // 3. Sorting
  if (sortBy === 'newest') {
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } else if (sortBy === 'price-asc') {
    list.sort((a, b) => Number(a.priceINR || a.price || 0) - Number(b.priceINR || b.price || 0));
  } else if (sortBy === 'price-desc') {
    list.sort((a, b) => Number(b.priceINR || b.price || 0) - Number(a.priceINR || a.price || 0));
  } else if (sortBy === 'likes-desc') {
    list.sort((a, b) => Number(b.likes || 0) - Number(a.likes || 0));
  }

  return list;
}

// ══════════════════════════════════════════════════════════════════
// RENDER LUXURY PRODUCT CARDS
// ══════════════════════════════════════════════════════════════════
function renderProducts() {
  const container = document.getElementById('seller-products-list');
  const emptyState = document.getElementById('seller-products-empty');
  if (!container) return;

  const list = getFilteredProducts();

  if (list.length === 0) {
    container.innerHTML = '';
    if (emptyState) {
      emptyState.style.display = 'block';
      if (searchQuery || selectedCategory !== 'all') {
        emptyState.querySelector('h3').textContent = 'No Matching Packs Found';
        emptyState.querySelector('p').textContent = `No packs matched your search "${searchQuery}". Try changing your filters.`;
      } else {
        emptyState.querySelector('h3').textContent = 'No Digital Packs Listed Yet';
        emptyState.querySelector('p').textContent = 'Start monetizing your exclusive creations! Click the button below to open the luxury product editor and publish your first pack.';
      }
    }
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  container.innerHTML = list.map(p => {
    const rawImg = p.coverImage || p.image || p.thumbnail || p.thumbnailUrl || (Array.isArray(p.images) && p.images[0]) || (Array.isArray(p.galleryImages) && p.galleryImages[0]) || '';
    let imgUrl = String(rawImg || '').trim();
    if (imgUrl.includes('placeholder.svg') || imgUrl.includes('favicon.svg') || !imgUrl) {
      imgUrl = '';
    } else if (imgUrl.includes('media.jaigram.shop/')) {
      imgUrl = imgUrl.startsWith('http') ? imgUrl : `https://${imgUrl.replace(/^\/+/, '')}`;
    } else if (imgUrl.includes('media.linkadda.shop/')) {
      const sub = imgUrl.split('media.linkadda.shop/')[1].replace(/^\/+/, '');
      imgUrl = `https://media.jaigram.shop/${sub}`;
    } else if (imgUrl.includes('r2.cloudflarestorage.com/')) {
      let sub = imgUrl.split('r2.cloudflarestorage.com/')[1].replace(/^\/+/, '');
      if (sub.startsWith('linkadda-media/')) sub = sub.replace(/^linkadda-media\//, '');
      if (sub.startsWith('jaigram-media/')) sub = sub.replace(/^jaigram-media\//, '');
      imgUrl = `https://media.jaigram.shop/${sub}`;
    } else if (imgUrl.includes('/products/productsgallery/')) {
      imgUrl = imgUrl.replace('/products/productsgallery/', '/productsgallery/');
    } else if (imgUrl.includes('srv1942099.hstgr.cloud') || imgUrl.includes('hstgr.cloud') || imgUrl.includes('rustfs')) {
      let sub = '';
      if (imgUrl.includes('/linkadda-media/')) {
        sub = imgUrl.split('/linkadda-media/')[1];
      } else if (imgUrl.includes('/jaigram-media/')) {
        sub = imgUrl.split('/jaigram-media/')[1];
      } else {
        const parts = imgUrl.split('/');
        sub = parts.slice(3).join('/');
      }
      sub = (sub || '').replace(/^\/+/, '');
      if (sub && !sub.includes('/') && sub.match(/\.(jpg|jpeg|png|webp|gif|svg|avif|mp4|webm|mov|m4v)$/i)) {
        sub = `products/${sub}`;
      }
      imgUrl = `https://media.jaigram.shop/${sub}`;
    } else if (imgUrl.startsWith('products/') || imgUrl.startsWith('productsgallery/') || imgUrl.startsWith('categories/') || imgUrl.startsWith('seller_products/') || imgUrl.startsWith('orders/')) {
      imgUrl = `https://media.jaigram.shop/${imgUrl}`;
    } else if (imgUrl.startsWith('/media/')) {
      imgUrl = `https://media.jaigram.shop/${imgUrl.replace(/^\/media\//, '')}`;
    } else if (imgUrl.startsWith('images/') || imgUrl.startsWith('/images/')) {
      imgUrl = imgUrl.startsWith('/') ? imgUrl : `/${imgUrl}`;
    } else if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://') || imgUrl.startsWith('data:') || imgUrl.startsWith('blob:')) {
      // Direct external URL
    } else if (imgUrl.match(/\.(jpg|jpeg|png|webp|gif|svg|avif)$/i)) {
      imgUrl = `https://media.jaigram.shop/products/${imgUrl.replace(/^\/+/, '')}`;
    }
    const priceINR = Number(p.priceINR || p.price || 0);
    const origPriceINR = Number(p.originalPrice || p.originalPriceINR || 0);
    const priceUSD = p.priceUSD || '';
    const likes = Math.max(0, Number(p.likes || 0));
    const views = Math.max(0, Number(p.views || 0));
    const badgeText = p.badge || 'TRENDING PACK';
    const badgeStyle = p.badgeStyle || 'pink';
    const tiersCount = Array.isArray(p.tiers) ? p.tiers.length : 0;

    // Discount percentage
    let discountPct = 0;
    if (origPriceINR > priceINR && priceINR > 0) {
      discountPct = Math.round(((origPriceINR - priceINR) / origPriceINR) * 100);
    }

    // Bullet tag chips
    const features = Array.isArray(p.features) ? p.features.slice(0, 2) : ['4K Ultra HD', 'Cloud Access'];

    return `
      <div class="seller-product-card" data-id="${escapeHtml(p.id)}">
        <div class="product-thumb-wrap">
          ${imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(p.name || 'Pack')}" class="product-thumb" onerror="if(!this._tried){this._tried=true; const c=this.src.split('?')[0]; if(this.src!==c){this.src=c;}else{this.style.opacity='0.4';}}" />` : `<div class="product-thumb-placeholder" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.05);color:#94a3b8;font-size:24px;"><i class="fa-solid fa-photo-film"></i></div>`}
          ${p.status === 'pending' || p.status === 'pending_approval'
            ? `<span class="product-badge-float" style="background: #f59e0b; color: #fff; font-weight: 800; box-shadow: 0 2px 8px rgba(245,158,11,0.4);"><i class="fa-solid fa-clock"></i> PENDING APPROVAL</span>`
            : `<span class="product-badge-float product-badge-${escapeHtml(badgeStyle)}">${escapeHtml(badgeText)}</span>`
          }
          ${discountPct > 0 ? `<span class="product-discount-float">${discountPct}% OFF</span>` : ''}
        </div>
        
        <div class="product-card-body">
          <div class="product-category-row">
            <span><i class="fa-solid fa-folder-closed" style="color: var(--ab-pink); margin-right: 4px;"></i> ${escapeHtml(p.category || 'Creator Pack')}</span>
            <span>${formatDate(p.createdAt || Date.now())}</span>
          </div>

          <h3 class="product-card-title" title="${escapeHtml(p.name || 'Untitled Pack')}">${escapeHtml(p.name || 'Untitled Pack')}</h3>

          <!-- Verified Seller Store Indicator -->
          <div class="product-seller-row" style="display: flex; align-items: center; gap: 6px; margin-bottom: 10px; font-size: 0.8rem; background: rgba(16, 185, 129, 0.08); padding: 5px 10px; border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.25);">
            <i class="fa-solid fa-circle-check" style="color: #10b981;"></i>
            <span style="color: var(--sd-text-body, #334155);">Sold by: <strong style="color: var(--sd-text-title, #0f172a); font-weight: 800;">${escapeHtml((p.sellerName && !/linkadda/i.test(p.sellerName)) ? p.sellerName : (currentSeller?.storeName || 'Creator Store'))}</strong></span>
            <span style="margin-left: auto; font-size: 0.72rem; font-weight: 800; color: #059669; background: rgba(16, 185, 129, 0.18); padding: 2px 6px; border-radius: 4px; white-space: nowrap;">✓ Verified</span>
          </div>

          <!-- Sub-plans / Tiers Badge if present -->
          ${tiersCount > 0 ? `
            <div class="product-tiers-badge">
              <i class="fa-solid fa-layer-group"></i> ${tiersCount} Sub-Plan Tier${tiersCount > 1 ? 's' : ''} Configured
            </div>
          ` : ''}

          <!-- Preview Tags -->
          <div class="product-tags-preview">
            ${features.map(f => `<span class="preview-tag-pill"><i class="fa-solid fa-check" style="color: #10b981;"></i> ${escapeHtml(f)}</span>`).join('')}
          </div>

          <!-- Price Row -->
          <div class="product-card-price-row">
            <span class="product-price">₹${priceINR}</span>
            ${origPriceINR > priceINR ? `<span class="product-old-price">₹${origPriceINR}</span>` : ''}
            ${priceUSD ? `<span class="product-usd-price">$${escapeHtml(priceUSD)} USD</span>` : ''}
          </div>

          <!-- Stats Row -->
          <div class="product-stats-row">
            <span class="stat-item"><i class="fa-solid fa-heart" style="color: #ef4444;"></i> ${likes.toLocaleString('en-IN')} likes</span>
            <span class="stat-item"><i class="fa-solid fa-eye" style="color: #38bdf8;"></i> ${views.toLocaleString('en-IN')} views</span>
            <span class="stat-item" style="color: #34d399; font-weight: 700;"><i class="fa-solid fa-circle" style="font-size: 8px; color: #10b981;"></i> Live</span>
          </div>

          <!-- Actions Row -->
          <div class="product-actions-row">
            <button type="button" class="btn-card-edit" data-id="${escapeHtml(p.id)}">
              <i class="fa-solid fa-pen-to-square"></i> <span>Edit</span>
            </button>
            <button type="button" class="btn-card-share" data-id="${escapeHtml(p.id)}" title="Share pack on WhatsApp / Telegram / Direct Link">
              <i class="fa-solid fa-share-nodes"></i> <span>Share</span>
            </button>
            <a href="/#product-${escapeHtml(p.id)}" target="_blank" class="btn-card-view" title="View on live storefront">
              <i class="fa-solid fa-arrow-up-right-from-square"></i> <span>Live</span>
            </a>
            <button type="button" class="btn-card-delete" data-id="${escapeHtml(p.id)}" title="Delete pack">
              <i class="fa-solid fa-trash-can"></i> <span>Delete</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Card-level preview / edit click handlers (thumbnail, title, card body)
  container.querySelectorAll('.seller-product-card').forEach(card => {
    const pid = card.getAttribute('data-id');
    const prod = sellerProducts.find(p => String(p.id) === String(pid));
    if (!prod) return;

    // Clicking anywhere on card outside of action buttons opens preview & editor
    card.addEventListener('click', (e) => {
      if (e.target.closest('.product-actions-row') || e.target.closest('button') || e.target.closest('a')) {
        return;
      }
      openProductModal(prod);
    });

    const thumb = card.querySelector('.product-thumb-wrap');
    if (thumb) {
      thumb.addEventListener('click', (e) => {
        e.stopPropagation();
        openProductModal(prod);
      });
    }

    const titleEl = card.querySelector('.product-card-title');
    if (titleEl) {
      titleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openProductModal(prod);
      });
    }
  });

  // Attach action listeners
  container.querySelectorAll('.btn-card-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = btn.getAttribute('data-id');
      const prod = sellerProducts.find(p => p.id === pid);
      if (prod) openProductModal(prod);
    });
  });

  container.querySelectorAll('.btn-card-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-id');
      const prod = sellerProducts.find(p => p.id === pid);
      if (!prod) return;
      openDeleteModal(prod);
    });
  });

  container.querySelectorAll('.btn-card-share').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pid = btn.getAttribute('data-id');
      const prod = sellerProducts.find(p => String(p.id) === String(pid));
      if (prod) openShareModal(prod);
    };
  });

  if (!container._hasShareDelegation) {
    container._hasShareDelegation = true;
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-card-share');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        const pid = btn.getAttribute('data-id');
        const prod = sellerProducts.find(p => String(p.id) === String(pid));
        if (prod) openShareModal(prod);
      }
    });
  }
}

// ══════════════════════════════════════════════════════════════════
// SHARE PACK MODAL
// ══════════════════════════════════════════════════════════════════
export function openShareModal(product) {
  if (!product) return;
  const modal = document.getElementById('share-modal');
  const nameEl = document.getElementById('share-product-name');
  const inputEl = document.getElementById('share-link-input');
  const waBtn = document.getElementById('btn-share-whatsapp');
  const tgBtn = document.getElementById('btn-share-telegram');
  const nativeBtn = document.getElementById('btn-share-native');

  const shareTarget = product.slug || product.id;
  const shareUrl = `${window.location.origin}/?product=${encodeURIComponent(shareTarget)}`;
  const packTitle = product.name || product.title || 'Exclusive Pack';

  if (nameEl) nameEl.textContent = packTitle;
  if (inputEl) inputEl.value = shareUrl;

  const shareText = `Check out "${packTitle}" on JaiGram: ${shareUrl}`;

  if (waBtn) {
    waBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
  }
  if (tgBtn) {
    tgBtn.href = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(packTitle)}`;
  }

  if (nativeBtn) {
    if (navigator.share) {
      nativeBtn.style.display = 'inline-flex';
      nativeBtn.onclick = (e) => {
        e.preventDefault();
        navigator.share({
          title: packTitle,
          text: shareText,
          url: shareUrl,
        }).catch(() => {});
      };
    } else {
      nativeBtn.style.display = 'none';
    }
  }

  if (modal) {
    modal.classList.add('active');
    modal.style.display = 'flex';
  }
}

export function closeShareModal() {
  const modal = document.getElementById('share-modal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
}

// ══════════════════════════════════════════════════════════════════
// SHARE STOREFRONT MODAL (SELLERS SHARE THEIR STORE LINK / SELLER ID)
// ══════════════════════════════════════════════════════════════════
export function openShareStoreModal() {
  const modal = document.getElementById('share-store-modal');
  if (!modal) return;

  const storeName = currentSeller?.storeName || currentSeller?.ownerName || 'Creator Store';
  const sellerId = currentSeller?.id || currentSeller?.sellerId || '';
  const shareUrl = `${window.location.origin}/?store=${encodeURIComponent(storeName)}`;

  const nameEl = document.getElementById('share-store-title-text');
  const idEl = document.getElementById('share-store-id-text');
  const inputEl = document.getElementById('share-store-link-input');
  const waBtn = document.getElementById('btn-share-store-whatsapp');
  const tgBtn = document.getElementById('btn-share-store-telegram');
  const nativeBtn = document.getElementById('btn-share-store-native');

  if (nameEl) nameEl.textContent = storeName;
  if (idEl) idEl.textContent = sellerId || storeName;
  if (inputEl) inputEl.value = shareUrl;

  const shareText = `Explore all exclusive digital packs and drops from "${storeName}" on JaiGram Shop:\n${shareUrl}`;

  if (waBtn) {
    waBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
  }
  if (tgBtn) {
    tgBtn.href = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`;
  }

  if (nativeBtn) {
    if (navigator.share) {
      nativeBtn.style.display = 'inline-flex';
      nativeBtn.onclick = (e) => {
        e.preventDefault();
        navigator.share({
          title: `${storeName} • JaiGram Shop`,
          text: shareText,
          url: shareUrl,
        }).catch(() => {});
      };
    } else {
      nativeBtn.style.display = 'none';
    }
  }

  modal.classList.add('active');
  modal.style.display = 'flex';
}

export function closeShareStoreModal() {
  const modal = document.getElementById('share-store-modal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
}

window.openShareModal = openShareModal;
window.closeShareModal = closeShareModal;
window.openShareStoreModal = openShareStoreModal;
window.closeShareStoreModal = closeShareStoreModal;

// ══════════════════════════════════════════════════════════════════
// DELETE CONFIRMATION MODAL
// ══════════════════════════════════════════════════════════════════
function openDeleteModal(product) {
  pendingDeleteId = product.id;
  const modal = document.getElementById('delete-modal');
  const msgEl = document.getElementById('delete-modal-msg');
  if (msgEl) {
    msgEl.textContent = `Are you sure you want to permanently delete "${product.name || 'this pack'}"? It will be removed from your dashboard and storefront.`;
  }
  if (modal) modal.classList.add('active');
}

function closeDeleteModal() {
  pendingDeleteId = null;
  const modal = document.getElementById('delete-modal');
  if (modal) modal.classList.remove('active');
}

async function executeDeleteProduct() {
  if (!pendingDeleteId) return;
  const productId = pendingDeleteId;
  closeDeleteModal();

  try {
    showToast('Deleting pack from JaiGram...', 'info');

    const res = await fetch(getApiUrl('/api/seller/products'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete',
        sellerId: currentSeller.id,
        token: currentSessionToken,
        productId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Delete failed (Status ${res.status})`);
    }

    sellerProducts = sellerProducts.filter(p => p.id !== productId);
    renderProducts();
    updateMetrics();
    showToast('Pack deleted successfully from store.', 'success');
  } catch (err) {
    showToast('Failed to delete pack: ' + err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════════
// RENDER ORDERS TABLE
// ══════════════════════════════════════════════════════════════════
function renderOrders() {
  const tbody = document.getElementById('seller-orders-tbody');
  const cardsContainer = document.getElementById('seller-orders-cards');
  const emptyOrders = document.getElementById('seller-orders-empty');
  if (!tbody && !cardsContainer) return;

  if (sellerOrders.length === 0) {
    if (tbody) tbody.innerHTML = '';
    if (cardsContainer) cardsContainer.innerHTML = '';
    if (emptyOrders) emptyOrders.style.display = 'block';
    return;
  }

  if (emptyOrders) emptyOrders.style.display = 'none';

  // Desktop Table
  if (tbody) {
    tbody.innerHTML = sellerOrders.map(o => {
      const itemName = o.matchedItem?.name || o.productName || 'Creator Pack';
      const amount = Number(o.matchedItem?.price || o.amount || 0);
      const creatorShare = Number(o.creatorEarnings || amount);
      const isSettled = o.payoutStatus === 'settled';
      const payoutBadge = isSettled
        ? `<span class="badge-status-completed" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 5px 10px; border-radius: 8px; font-size: 11px; font-weight: 800;">✓ Completed & Settled</span>`
        : `<span class="badge-status-pending" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); padding: 5px 10px; border-radius: 8px; font-size: 11px; font-weight: 800;">⏳ 7-Day Escrow (${o.daysRemaining || 7}d left)</span>`;

      return `
        <tr>
          <td class="order-id" style="font-family: monospace; font-weight: 700; color: #93c5fd;">#${String(o.id).slice(-8).toUpperCase()}</td>
          <td class="order-date">${formatDate(o.createdAt || o.date)}</td>
          <td class="order-product"><strong>${escapeHtml(itemName)}</strong></td>
          <td class="order-buyer">
            <span style="display: inline-flex; align-items: center; gap: 6px; font-weight: 700; color: #10b981;">
              <i class="fa-solid fa-circle-check"></i> Verified Buyer
            </span>
          </td>
          <td class="order-amount" style="font-weight: 800; color: #fff;">₹${amount}</td>
          <td class="order-share" style="font-weight: 800; color: #34d399;">₹${creatorShare}</td>
          <td class="order-status">${payoutBadge}</td>
        </tr>
      `;
    }).join('');
  }

  // Mobile Native Cards Feed
  if (cardsContainer) {
    cardsContainer.innerHTML = sellerOrders.map(o => {
      const itemName = o.matchedItem?.name || o.productName || 'Creator Pack';
      const amount = Number(o.matchedItem?.price || o.amount || 0);
      const creatorShare = Number(o.creatorEarnings || amount);
      const isSettled = o.payoutStatus === 'settled';
      const payoutBadge = isSettled
        ? `<span class="badge-status-completed" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 800;">✓ Settled</span>`
        : `<span class="badge-status-pending" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 800;">⏳ Escrow (${o.daysRemaining || 7}d left)</span>`;

      return `
        <div class="mobile-order-card">
          <div class="mobile-order-head">
            <span class="mobile-order-id">#${String(o.id).slice(-8).toUpperCase()}</span>
            <span class="mobile-order-date">${formatDate(o.createdAt || o.date)}</span>
          </div>
          <div class="mobile-order-pack">${escapeHtml(itemName)}</div>
          <div class="mobile-order-meta">
            <span class="mobile-order-buyer" style="display: inline-flex; align-items: center; gap: 5px; color: #10b981; font-weight: 700;">
              <i class="fa-solid fa-circle-check"></i> Verified Buyer
            </span>
            ${payoutBadge}
          </div>
          <div class="mobile-order-finance">
            <div>
              <span class="lbl">Gross:</span>
              <strong>₹${amount}</strong>
            </div>
            <div class="creator-share-pill">
              <span class="lbl">Your 100%:</span>
              <strong style="color: #34d399;">₹${creatorShare}</strong>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

// ══════════════════════════════════════════════════════════════════
// ADVANCED CREATOR PRODUCT EDITOR (MATCHING ADMIN CATALOG NEW PRODUCT ADD)
// ══════════════════════════════════════════════════════════════════
let editingProductId = null;
let editorMediaItems = [];
let editorTiers = [];
let editorFeatures = ['4K Ultra HD', 'Mega.nz Direct Fast Link', '24/7 Lifetime Replacement'];
let editorPlatforms = ['Mega.nz', 'Google Drive'];
let editorCreators = ['Desi VIP', 'Verified Creator'];

function updateLivePreview() {
  const form = document.getElementById('product-form');
  if (!form) return;

  const title = form.elements['name']?.value?.trim() || 'Pack Title Preview';
  const price = form.elements['price']?.value?.trim() || '499';
  const origPrice = form.elements['originalPrice']?.value?.trim() || '';
  const priceUSD = form.elements['priceUSD']?.value?.trim() || '';
  const badgeText = form.elements['badge']?.value?.trim() || 'TRENDING PACK';
  const badgeStyle = form.elements['badgeStyle']?.value || 'pink';

  // Elements
  const prevTitle = document.getElementById('livePreviewTitle');
  const prevPrice = document.getElementById('livePreviewPrice');
  const prevOrigPrice = document.getElementById('livePreviewOrigPrice');
  const prevUSD = document.getElementById('livePreviewUSD');
  const prevBadge = document.getElementById('livePreviewBadge');
  const prevDiscPill = document.getElementById('livePreviewDiscountPill');
  const prevSeller = document.getElementById('livePreviewSeller');
  const prevImg = document.getElementById('livePreviewImg');
  const prevTags = document.getElementById('livePreviewTags');

  if (prevTitle) prevTitle.textContent = title;
  if (prevPrice) prevPrice.textContent = `₹${price}`;
  if (prevOrigPrice) {
    if (origPrice && Number(origPrice) > Number(price)) {
      prevOrigPrice.textContent = `₹${origPrice}`;
      prevOrigPrice.style.display = 'inline';
    } else {
      prevOrigPrice.style.display = 'none';
    }
  }

  if (prevUSD) {
    if (priceUSD) {
      prevUSD.textContent = `$${priceUSD} USD`;
      prevUSD.style.display = 'inline-block';
    } else {
      prevUSD.style.display = 'none';
    }
  }

  if (prevBadge) {
    prevBadge.textContent = badgeText;
    prevBadge.className = `live-card-badge badge-style-${badgeStyle}`;
  }

  if (prevDiscPill) {
    const numPrice = Number(price);
    const numOrig = Number(origPrice);
    if (numOrig > numPrice && numPrice > 0) {
      const discount = Math.round(((numOrig - numPrice) / numOrig) * 100);
      prevDiscPill.textContent = `${discount}% OFF`;
      prevDiscPill.style.display = 'block';
    } else {
      prevDiscPill.style.display = 'none';
    }
  }

  if (prevSeller) {
    const sInput = document.getElementById('modal-seller-name');
    const rawVal = sInput?.value?.trim();
    const displayStore = (rawVal && !/linkadda/i.test(rawVal)) ? rawVal : (currentSeller?.storeName || 'Creator Store');
    prevSeller.textContent = `Sold by ${displayStore}`;
  }

  // Update Preview Image from main media item
  const mainMedia = editorMediaItems.find(m => m.isMain) || editorMediaItems[0];
  if (prevImg && mainMedia && mainMedia.url) {
    prevImg.src = mainMedia.url;
  }

  // Update bullet tags preview (reflecting category & features)
  if (prevTags) {
    let catVal = form.elements['category']?.value?.trim() || '';
    if (catVal === '__custom__') {
      const customInput = document.getElementById('product-custom-category');
      catVal = customInput ? customInput.value.trim() : '';
    }
    const displayTags = [];
    if (catVal) displayTags.push(catVal);
    editorFeatures.slice(0, 1).forEach(f => displayTags.push(f));
    if (displayTags.length === 0) displayTags.push('4K Ultra HD', 'Mega.nz Direct');
    prevTags.innerHTML = displayTags.map(t => `<span class="live-tag">${escapeHtml(t)}</span>`).join('');
  }
}

let draggedMediaIndex = null;

function renderMediaGrid() {
  const grid = document.getElementById('media-items-grid');
  if (!grid) return;

  if (editorMediaItems.length === 0) {
    grid.innerHTML = `
      <div class="media-empty-placeholder">
        <i class="fa-solid fa-cloud-arrow-up" style="font-size: 1.8rem; color: var(--ab-muted); margin-bottom: 8px;"></i>
        <p>No media assets added yet. Upload screenshots or add image URLs above.</p>
        <span style="font-size: 0.74rem; color: var(--ab-muted);">Your first photo automatically becomes the storefront cover!</span>
      </div>
    `;
    return;
  }

  // Ensure at least one item is marked isMain
  if (!editorMediaItems.some(m => m.isMain)) {
    editorMediaItems[0].isMain = true;
  }

  grid.innerHTML = editorMediaItems.map((item, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === editorMediaItems.length - 1;
    const isMain = Boolean(item.isMain);

    return `
      <div class="media-card-item ${isMain ? 'is-main' : ''}" data-index="${idx}" draggable="true">
        <div class="media-preview-box">
          ${item.type === 'video' ? `
            <video src="${escapeHtml(item.url)}" muted preload="metadata"></video>
            <span class="media-type-pill video"><i class="fa-solid fa-play"></i> Video</span>
          ` : `
            <img src="${escapeHtml(item.url)}" alt="Media ${idx + 1}" onerror="this.src='/favicon.svg'" />
            <span class="media-type-pill"><i class="fa-solid fa-image"></i> Photo</span>
          `}
          <span class="media-sequence-pill ${isMain ? 'cover-pill' : ''}">
            #${idx + 1}${isMain ? ' • Cover' : ''}
          </span>
        </div>

        <div class="media-controls-toolbar">
          <!-- Move Left / Up Button -->
          <button type="button" class="btn-media-subaction btn-media-move btn-move-left" data-index="${idx}" data-dir="-1" title="Move image backward (e.g. 2nd to 1st)" ${isFirst ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>
            <i class="fa-solid fa-chevron-left"></i>
          </button>

          <!-- Set as Cover Button -->
          <button type="button" class="btn-media-subaction btn-media-set-main ${isMain ? 'active' : ''}" data-index="${idx}" title="${isMain ? 'Main Storefront Cover' : 'Set as Main Storefront Cover'}">
            <i class="fa-solid ${isMain ? 'fa-star' : 'fa-star-half-stroke'}"></i>
            <span>${isMain ? 'Cover' : 'Cover'}</span>
          </button>

          <!-- Move Right / Down Button -->
          <button type="button" class="btn-media-subaction btn-media-move btn-move-right" data-index="${idx}" data-dir="1" title="Move image forward (e.g. 1st to 2nd)" ${isLast ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>
            <i class="fa-solid fa-chevron-right"></i>
          </button>

          <!-- Delete / Remove Button -->
          <button type="button" class="btn-media-subaction btn-media-delete" data-index="${idx}" title="Remove this photo from pack">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // 1. Move Left / Right Handlers
  grid.querySelectorAll('.btn-media-move:not([disabled])').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.index);
      const dir = Number(btn.dataset.dir);
      const targetIdx = idx + dir;
      if (targetIdx >= 0 && targetIdx < editorMediaItems.length) {
        const temp = editorMediaItems[idx];
        editorMediaItems[idx] = editorMediaItems[targetIdx];
        editorMediaItems[targetIdx] = temp;

        renderMediaGrid();
        updateLivePreview();
        showToast(`Image moved to position #${targetIdx + 1}!`, 'info');
      }
    });
  });

  // 2. Set as Main Cover Handler
  grid.querySelectorAll('.btn-media-set-main').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.index);
      editorMediaItems.forEach((m, i) => { m.isMain = (i === idx); });
      renderMediaGrid();
      updateLivePreview();
      showToast(`Position #${idx + 1} set as main storefront cover!`, 'success');
    });
  });

  // 3. Delete Media Handler
  grid.querySelectorAll('.btn-media-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.index);
      const wasMain = editorMediaItems[idx]?.isMain;
      editorMediaItems.splice(idx, 1);
      if (editorMediaItems.length > 0 && (wasMain || !editorMediaItems.some(m => m.isMain))) {
        editorMediaItems[0].isMain = true;
      }
      renderMediaGrid();
      updateLivePreview();
      showToast('Image removed from pack.', 'info');
    });
  });

  // 4. Desktop Drag & Drop Reorder Listeners
  grid.querySelectorAll('.media-card-item').forEach(card => {
    const idx = Number(card.dataset.index);

    card.addEventListener('dragstart', (e) => {
      draggedMediaIndex = idx;
      card.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      draggedMediaIndex = null;
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('drag-over');
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (draggedMediaIndex !== null && draggedMediaIndex !== idx) {
        const item = editorMediaItems.splice(draggedMediaIndex, 1)[0];
        editorMediaItems.splice(idx, 0, item);
        renderMediaGrid();
        updateLivePreview();
        showToast(`Image moved to position #${idx + 1}!`, 'info');
      }
    });
  });
}

function renderTiersList() {
  const container = document.getElementById('tiers-container');
  if (!container) return;

  if (editorTiers.length === 0) {
    container.innerHTML = `
      <div style="padding: 16px; text-align: center; border: 1px dashed var(--ab-border); border-radius: 10px; color: var(--ab-muted); font-size: 0.82rem;">
        No sub-plans added yet. Standard base price will be used. Click "+ Add Sub-Plan / Tier" to offer tier options (e.g. 1 Group, 4 Groups VIP).
      </div>
    `;
    return;
  }

  container.innerHTML = editorTiers.map((tier, idx) => `
    <div class="tier-row" data-index="${idx}">
      <input type="text" class="editor-input tier-label-input" placeholder="e.g. 1 Group Access, 4 Groups Bundle, VIP Lifetime" value="${escapeHtml(tier.label || '')}" />
      <input type="number" class="editor-input tier-inr-input" placeholder="₹ INR (e.g. 299)" value="${escapeHtml(tier.inr || '')}" />
      <input type="number" class="editor-input tier-usd-input" placeholder="$ USD (e.g. 9)" value="${escapeHtml(tier.usd || '')}" />
      <button type="button" class="btn-tier-delete" data-index="${idx}" title="Delete tier">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  `).join('');

  // Bind change listeners
  container.querySelectorAll('.tier-row').forEach(row => {
    const idx = Number(row.dataset.index);
    const labelInput = row.querySelector('.tier-label-input');
    const inrInput = row.querySelector('.tier-inr-input');
    const usdInput = row.querySelector('.tier-usd-input');

    labelInput?.addEventListener('input', (e) => { editorTiers[idx].label = e.target.value; });
    inrInput?.addEventListener('input', (e) => { editorTiers[idx].inr = e.target.value; });
    usdInput?.addEventListener('input', (e) => { editorTiers[idx].usd = e.target.value; });
  });

  container.querySelectorAll('.btn-tier-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      editorTiers.splice(idx, 1);
      renderTiersList();
    });
  });
}

function renderTagChips(type) {
  const chipsContainer = document.getElementById(`${type}-chips`);
  if (!chipsContainer) return;

  const list = type === 'features' ? editorFeatures : type === 'platforms' ? editorPlatforms : editorCreators;

  chipsContainer.innerHTML = list.map((tag, idx) => `
    <span class="tag-chip">
      ${escapeHtml(tag)}
      <span class="tag-chip-remove" data-type="${type}" data-index="${idx}">&times;</span>
    </span>
  `).join('');

  chipsContainer.querySelectorAll('.tag-chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      if (type === 'features') editorFeatures.splice(idx, 1);
      else if (type === 'platforms') editorPlatforms.splice(idx, 1);
      else if (type === 'creators') editorCreators.splice(idx, 1);
      renderTagChips(type);
      updateLivePreview();
    });
  });
}

// ══════════════════════════════════════════════════════════════════
// PUBLISHING STATE & BUTTON FEEDBACK CONTROLS
// ══════════════════════════════════════════════════════════════════
let isSubmittingProduct = false;

function setPublishingState(isLoading, isEditing = false, isSuccess = false) {
  const desktopBtn = document.getElementById('btn-submit-product');
  const mobileBtn = document.getElementById('btn-mobile-submit-product') || document.querySelector('.btn-editor-mobile-save');
  const desktopText = document.getElementById('btn-submit-text');
  const mobileText = document.getElementById('btn-mobile-submit-text');
  const banner = document.getElementById('product-publishing-banner');
  const bannerTitle = document.getElementById('pub-banner-title');
  const bannerSub = document.getElementById('pub-banner-sub');
  const bannerPulse = banner ? banner.querySelector('.pub-banner-pulse') : null;

  const defaultText = isEditing ? 'Save Changes' : 'Publish Pack Live';
  const loadingText = isEditing ? 'Saving Changes...' : 'Publishing Live...';
  const successText = isEditing ? 'Changes Saved! ✓' : 'Published Live! ✓';

  const buttons = [desktopBtn, mobileBtn].filter(Boolean);

  if (isLoading) {
    buttons.forEach(btn => {
      btn.disabled = true;
      btn.classList.add('btn-loading');
      btn.classList.remove('btn-success');
      const icon = btn.querySelector('i');
      if (icon) icon.className = 'fa-solid fa-circle-notch fa-spin';
    });
    if (desktopText) desktopText.textContent = loadingText;
    if (mobileText) mobileText.textContent = loadingText;

    if (banner) {
      banner.style.display = 'flex';
      if (bannerPulse) {
        bannerPulse.classList.remove('pub-success');
        bannerPulse.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
      }
      if (bannerTitle) bannerTitle.textContent = isEditing ? 'Saving Pack Changes...' : 'Publishing Pack Live...';
      if (bannerSub) bannerSub.textContent = 'Syncing pack with JaiGram storefront & database. Please wait...';
    }
  } else if (isSuccess) {
    buttons.forEach(btn => {
      btn.disabled = true;
      btn.classList.remove('btn-loading');
      btn.classList.add('btn-success');
      const icon = btn.querySelector('i');
      if (icon) icon.className = 'fa-solid fa-check';
    });
    if (desktopText) desktopText.textContent = successText;
    if (mobileText) mobileText.textContent = successText;

    if (banner) {
      banner.style.display = 'flex';
      if (bannerPulse) {
        bannerPulse.classList.add('pub-success');
        bannerPulse.innerHTML = '<i class="fa-solid fa-check"></i>';
      }
      if (bannerTitle) bannerTitle.textContent = isEditing ? 'Changes Saved Successfully!' : 'Pack Published Live to Storefront!';
      if (bannerSub) bannerSub.textContent = 'Your pack is live and ready for customers!';
    }
  } else {
    // Normal / Reset state
    buttons.forEach(btn => {
      btn.disabled = false;
      btn.classList.remove('btn-loading', 'btn-success');
      const icon = btn.querySelector('i');
      if (icon) icon.className = 'fa-solid fa-check';
    });
    if (desktopText) desktopText.textContent = defaultText;
    if (mobileText) mobileText.textContent = defaultText;

    if (banner) {
      banner.style.display = 'none';
      if (bannerPulse) bannerPulse.classList.remove('pub-success');
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// OPEN / CLOSE PRODUCT EDITOR MODAL
// ══════════════════════════════════════════════════════════════════
export function openProductModal(product = null) {
  const modal = document.getElementById('product-modal');
  const form = document.getElementById('product-form');
  const title = document.getElementById('modal-product-title');
  const badgeStatus = document.getElementById('modal-product-badge-status');
  const sellerInput = document.getElementById('modal-seller-name');
  if (!modal || !form) return;

  isSubmittingProduct = false;
  editingProductId = product ? product.id : null;
  if (title) title.textContent = product ? 'Edit Product Pack' : 'Create New Product';
  if (badgeStatus) {
    badgeStatus.textContent = product ? 'Editing Pack' : 'New Pack';
    badgeStatus.className = `status-badge ${product ? 'badge-edit' : 'badge-new'}`;
  }

  // Pre-fill verified creator / store name immediately
  const rawPStore = product?.sellerName || product?.sellerStoreName || '';
  const resolvedStoreName = (rawPStore && !/linkadda/i.test(rawPStore)) ? rawPStore : (currentSeller?.storeName || 'Creator Store');
  if (sellerInput) {
    sellerInput.value = resolvedStoreName;
  }

  // Category text input
  const catInput = document.getElementById('product-category');
  const productCategory = (product ? (product.category || '') : '').trim();
  if (catInput) {
    catInput.value = productCategory;
  }

  if (product) {
    // Populate form fields
    form.elements['name'].value = product.name || product.title || '';
    form.elements['slug'].value = product.slug || '';
    form.elements['price'].value = product.priceINR || product.price || '';
    form.elements['originalPrice'].value = product.originalPrice || product.originalPriceINR || '';
    form.elements['priceUSD'].value = product.priceUSD || '';
    form.elements['originalPriceUSD'].value = product.originalPriceUSD || '';
    form.elements['badge'].value = product.badge || 'TRENDING PACK';
    form.elements['badgeStyle'].value = product.badgeStyle || 'pink';
    form.elements['category'].value = productCategory;
    form.elements['description'].value = product.description || '';
    form.elements['downloadLink'].value = product.downloadLink || product.fileUrl || product.orderLink || '';
    form.elements['rating'].value = product.rating || '4.9';
    form.elements['specResolution'].value = product.specResolution || '4K 2160p Ultra HD (60 FPS HDR)';
    form.elements['specAudio'].value = product.specAudio || 'Original Studio Stereo Clear Audio';
    form.elements['specDevices'].value = product.specDevices || 'Android, iPhone (iOS), PC, Mac, Smart TV';
    form.elements['specMediaCount'].value = product.specMediaCount || '';

    // Reconstruct media items
    editorMediaItems = [];
    const mainImg = product.coverImage || product.image || product.thumbnail || '';
    const otherImgs = Array.isArray(product.images) ? product.images : Array.isArray(product.galleryImages) ? product.galleryImages : [];
    const allImgs = [...new Set([mainImg, ...otherImgs].filter(Boolean))];

    function resolveSellerMediaUrl(raw) {
      let resolved = String(raw || '').trim();
      if (!resolved) return '';
      if (resolved.includes('media.jaigram.shop/')) {
        return resolved.startsWith('http') ? resolved : `https://${resolved.replace(/^\/+/, '')}`;
      } else if (resolved.includes('media.linkadda.shop/')) {
        return `https://media.jaigram.shop/${resolved.split('media.linkadda.shop/')[1].replace(/^\/+/, '')}`;
      } else if (resolved.includes('r2.cloudflarestorage.com/')) {
        let sub = resolved.split('r2.cloudflarestorage.com/')[1].replace(/^\/+/, '');
        if (sub.startsWith('linkadda-media/')) sub = sub.replace(/^linkadda-media\//, '');
        if (sub.startsWith('jaigram-media/')) sub = sub.replace(/^jaigram-media\//, '');
        return `https://media.jaigram.shop/${sub}`;
      } else if (resolved.includes('/products/productsgallery/')) {
        resolved = resolved.replace('/products/productsgallery/', '/productsgallery/');
      } else if (resolved.includes('srv1942099.hstgr.cloud') || resolved.includes('hstgr.cloud') || resolved.includes('rustfs')) {
        let sub = '';
        if (resolved.includes('/linkadda-media/')) {
          sub = resolved.split('/linkadda-media/')[1];
        } else if (resolved.includes('/jaigram-media/')) {
          sub = resolved.split('/jaigram-media/')[1];
        } else {
          const parts = resolved.split('/');
          sub = parts.slice(3).join('/');
        }
        sub = (sub || '').replace(/^\/+/, '');
        if (sub && !sub.includes('/') && sub.match(/\.(jpg|jpeg|png|webp|gif|svg|avif|mp4|webm|mov|m4v)$/i)) {
          sub = `seller_products/${sub}`;
        }
        return `https://media.jaigram.shop/${sub}`;
      } else if (resolved.startsWith('products/') || resolved.startsWith('productsgallery/') || resolved.startsWith('categories/') || resolved.startsWith('seller_products/') || resolved.startsWith('orders/')) {
        return `https://media.jaigram.shop/${resolved}`;
      } else if (resolved.startsWith('/media/')) {
        return `https://media.jaigram.shop/${resolved.replace(/^\/media\//, '')}`;
      } else if (resolved.startsWith('images/') || resolved.startsWith('/images/')) {
        return resolved.startsWith('/') ? resolved : `/${resolved}`;
      } else if (resolved.startsWith('http://') || resolved.startsWith('https://') || resolved.startsWith('data:') || resolved.startsWith('blob:')) {
        return resolved;
      } else if (resolved.match(/\.(jpg|jpeg|png|webp|gif|svg|avif|mp4|webm|mov|m4v)$/i)) {
        return `https://media.jaigram.shop/seller_products/${resolved.replace(/^\/+/, '')}`;
      }
      return resolved;
    }

    allImgs.forEach((u, i) => {
      const resolved = resolveSellerMediaUrl(u);
      if (resolved) {
        editorMediaItems.push({
          url: resolved,
          type: 'image',
          isMain: i === 0 || u === mainImg,
        });
      }
    });

    if (product.video) {
      const vUrl = resolveSellerMediaUrl(product.video);
      if (vUrl && !editorMediaItems.some(m => m.url === vUrl)) {
        editorMediaItems.push({
          url: vUrl,
          type: 'video',
          isMain: false,
        });
      }
    }

    if (Array.isArray(product.videos)) {
      product.videos.forEach(v => {
        const vUrl = resolveSellerMediaUrl(v);
        if (vUrl && !editorMediaItems.some(m => m.url === vUrl)) {
          editorMediaItems.push({ url: vUrl, type: 'video', isMain: false });
        }
      });
    }

    // Reconstruct tiers
    editorTiers = Array.isArray(product.tiers) ? [...product.tiers] : [];

    // Reconstruct tags
    editorFeatures = Array.isArray(product.features) ? [...product.features] : ['4K Ultra HD', 'Mega.nz Direct Fast Link'];
    editorPlatforms = Array.isArray(product.platforms) ? [...product.platforms] : ['Mega.nz', 'Google Drive'];
    editorCreators = Array.isArray(product.creators) ? [...product.creators] : ['Desi VIP'];

  } else {
    // Reset Form for New Pack
    form.reset();
    form.elements['badge'].value = 'TRENDING PACK';
    form.elements['badgeStyle'].value = 'pink';
    form.elements['rating'].value = '4.9';
    form.elements['specResolution'].value = '4K 2160p Ultra HD (60 FPS HDR)';
    form.elements['specAudio'].value = 'Original Studio Stereo Clear Audio';
    form.elements['specDevices'].value = 'Android, iPhone (iOS), PC, Mac, Smart TV';

    // Repopulate verified seller name after form.reset()
    if (sellerInput) sellerInput.value = currentSeller?.storeName || 'Creator Store';

    editorMediaItems = [];
    editorTiers = [];
    editorFeatures = ['4K Ultra HD', 'Mega.nz Direct Fast Link', 'Lifetime VIP Access'];
    editorPlatforms = ['Mega.nz', 'Google Drive'];
    editorCreators = ['Desi VIP', 'Verified Partner'];
  }

  renderMediaGrid();
  renderTiersList();
  renderTagChips('features');
  renderTagChips('platforms');
  renderTagChips('creators');
  updateLivePreview();

  // Advanced Settings Collapsible Initial State
  const advCollapse = document.getElementById('advanced-settings-collapse');
  const advBadge = document.getElementById('adv-settings-badge');
  const advChevron = document.getElementById('adv-chevron-icon');

  const hasAdvanced = Boolean(
    product && (
      (product.tiers && product.tiers.length > 0) ||
      product.priceUSD ||
      product.originalPrice ||
      (product.description && product.description.length > 5) ||
      (product.specResolution && product.specResolution !== '4K 2160p Ultra HD (60 FPS HDR)') ||
      (product.badge && product.badge !== 'TRENDING PACK') ||
      product.slug
    )
  );

  if (advCollapse) {
    if (hasAdvanced) {
      advCollapse.style.display = 'block';
      if (advChevron) advChevron.style.transform = 'rotate(180deg)';
      if (advBadge) advBadge.textContent = 'Configured ✓';
    } else {
      advCollapse.style.display = 'none';
      if (advChevron) advChevron.style.transform = '';
      if (advBadge) advBadge.textContent = 'Expand to Edit';
    }
  }

  // Reset button texts, icons, and hide progress banner
  setPublishingState(false, Boolean(product));

  // Reset mobile toggle state to Edit Details mode
  const btnToggleEdit = document.getElementById('btn-toggle-edit-mode');
  const btnTogglePrev = document.getElementById('btn-toggle-preview-mode');
  const prevCol = document.querySelector('.product-editor-preview-col');
  const mainCol = document.querySelector('.product-editor-main-col');
  if (btnToggleEdit && btnTogglePrev && prevCol && mainCol) {
    btnToggleEdit.classList.add('active');
    btnTogglePrev.classList.remove('active');
    prevCol.classList.remove('mobile-active');
    mainCol.classList.remove('mobile-hidden');
  }

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

export function closeProductModal() {
  editingProductId = null;
  isSubmittingProduct = false;
  setPublishingState(false, false);
  const catInput = document.getElementById('product-category');
  if (catInput) catInput.value = '';
  const modal = document.getElementById('product-modal');
  if (modal) modal.classList.remove('active');
  document.body.style.overflow = '';
}

// ══════════════════════════════════════════════════════════════════
// GLOBAL EVENT LISTENERS & FORM BINDINGS
// ══════════════════════════════════════════════════════════════════
function setupEventListeners() {
  // Sync live stats helper (likes, views, orders, followers)
  const handleSyncStats = async (btn) => {
    if (btn) btn.classList.add('syncing');
    showToast('Syncing real-time stats & followers...', 'info');
    try {
      await Promise.all([loadSellerProducts(), loadSellerOrders(), loadSellerFollowers()]);
      showToast('✓ Live stats synced from database!', 'success');
    } catch (e) {
      showToast('Stats sync note: ' + (e.message || 'Updated'), 'info');
    } finally {
      if (btn) btn.classList.remove('syncing');
    }
  };

  const btnHeroSync = document.getElementById('btn-hero-sync-stats');
  if (btnHeroSync) btnHeroSync.addEventListener('click', () => handleSyncStats(btnHeroSync));

  const btnPacksSync = document.getElementById('btn-sync-packs');
  if (btnPacksSync) btnPacksSync.addEventListener('click', () => handleSyncStats(btnPacksSync));

  // Auto-refresh stats when seller switches back to dashboard tab / focuses window
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentSeller) {
      loadSellerProducts();
      loadSellerOrders();
    }
  });
  window.addEventListener('focus', () => {
    if (currentSeller) {
      loadSellerProducts();
      loadSellerOrders();
    }
  });

  // ━━ REAL-TIME PERIODIC SYNC (Every 20s while dashboard is active) ━━
  setInterval(() => {
    if (currentSeller && document.visibilityState === 'visible') {
      loadSellerProducts();
      loadSellerOrders();
    }
  }, 20000);

  // Custom Category toggling & input listeners
  const catSelect = document.getElementById('product-category');
  const customCatWrap = document.getElementById('custom-category-wrap');
  const customCatInput = document.getElementById('product-custom-category');
  const btnToggleCustomCat = document.getElementById('btn-toggle-custom-category');

  if (catSelect) {
    catSelect.addEventListener('change', (e) => {
      if (e.target.value === '__custom__') {
        if (customCatWrap) customCatWrap.style.display = 'block';
        if (customCatInput) customCatInput.focus();
      } else {
        if (customCatWrap) customCatWrap.style.display = 'none';
      }
      updateLivePreview();
    });
  }

  if (btnToggleCustomCat) {
    btnToggleCustomCat.addEventListener('click', () => {
      if (!customCatWrap) return;
      const isShowing = customCatWrap.style.display !== 'none';
      if (isShowing) {
        customCatWrap.style.display = 'none';
        if (catSelect && catSelect.value === '__custom__') {
          catSelect.value = allCategories[0] || '';
        }
      } else {
        customCatWrap.style.display = 'block';
        if (catSelect) catSelect.value = '__custom__';
        if (customCatInput) customCatInput.focus();
      }
      updateLivePreview();
    });
  }

  if (customCatInput) {
    customCatInput.addEventListener('input', () => {
      updateLivePreview();
    });
  }

  // Add pack buttons
  const btnAddPack = document.getElementById('btn-add-pack');
  if (btnAddPack) btnAddPack.addEventListener('click', () => openProductModal(null));

  const btnHeroAddPack = document.getElementById('btn-hero-add-pack');
  if (btnHeroAddPack) btnHeroAddPack.addEventListener('click', () => openProductModal(null));

  const btnMobileFabAdd = document.getElementById('btn-mobile-fab-add');
  if (btnMobileFabAdd) btnMobileFabAdd.addEventListener('click', () => openProductModal(null));

  // Close product modal
  const btnCloseProductModal = document.getElementById('btn-close-product-modal');
  if (btnCloseProductModal) btnCloseProductModal.addEventListener('click', closeProductModal);

  // Search & Filter listeners
  const searchInput = document.getElementById('packs-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      renderProducts();
    });
  }

  const categoryFilter = document.getElementById('packs-category-filter');
  if (categoryFilter) {
    categoryFilter.addEventListener('change', (e) => {
      selectedCategory = e.target.value;
      renderProducts();
    });
  }

  const sortFilter = document.getElementById('packs-sort-filter');
  if (sortFilter) {
    sortFilter.addEventListener('change', (e) => {
      sortBy = e.target.value;
      renderProducts();
    });
  }

  // Delete modal buttons
  const btnCancelDelete = document.getElementById('btn-cancel-delete');
  if (btnCancelDelete) btnCancelDelete.addEventListener('click', closeDeleteModal);

  const btnConfirmDelete = document.getElementById('btn-confirm-delete');
  if (btnConfirmDelete) btnConfirmDelete.addEventListener('click', executeDeleteProduct);

  // Live Preview Form Inputs
  const form = document.getElementById('product-form');
  if (form) {
    ['input', 'change'].forEach(evt => {
      form.addEventListener(evt, () => updateLivePreview());
    });

    // Auto-generate slug on title change if slug was empty
    const titleInput = form.elements['name'];
    const slugInput = form.elements['slug'];
    if (titleInput && slugInput) {
      titleInput.addEventListener('input', () => {
        if (!editingProductId) {
          slugInput.value = titleInput.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        }
      });
    }

    // Auto calculate discount percentage hint
    const priceInput = form.elements['price'];
    const origPriceInput = form.elements['originalPrice'];
    const calcHint = () => {
      const p = Number(priceInput.value);
      const o = Number(origPriceInput.value);
      const hint = document.getElementById('discount-calc-hint');
      if (hint) {
        if (o > p && p > 0) {
          const discount = Math.round(((o - p) / o) * 100);
          hint.textContent = `⚡ Calculated Buyer Discount: ${discount}% OFF!`;
          hint.style.display = 'block';
        } else {
          hint.style.display = 'none';
        }
      }
    };
    priceInput?.addEventListener('input', calcHint);
    origPriceInput?.addEventListener('input', calcHint);
  }

  // Add Tier Button
  const btnAddTier = document.getElementById('btn-add-tier');
  if (btnAddTier) {
    btnAddTier.addEventListener('click', () => {
      editorTiers.push({ label: '', inr: '', usd: '' });
      renderTiersList();
    });
  }

  // Tag inputs helper
  const setupTagInput = (inputId, type) => {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = input.value.trim().replace(/^,+|,+$/g, '');
        if (val) {
          if (type === 'features') editorFeatures.push(val);
          else if (type === 'platforms') editorPlatforms.push(val);
          else if (type === 'creators') editorCreators.push(val);
          input.value = '';
          renderTagChips(type);
          updateLivePreview();
        }
      }
    });
  };

  setupTagInput('features-input', 'features');
  setupTagInput('platforms-input', 'platforms');
  setupTagInput('creators-input', 'creators');

  // Media URL Adder
  const btnAddUrl = document.getElementById('btn-add-media-url');
  const urlInput = document.getElementById('media-url-input');
  if (btnAddUrl && urlInput) {
    btnAddUrl.addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (!url) return;
      const isVideo = url.endsWith('.mp4') || url.endsWith('.webm') || url.includes('video');
      editorMediaItems.push({
        url,
        type: isVideo ? 'video' : 'image',
        isMain: editorMediaItems.length === 0,
      });
      urlInput.value = '';
      renderMediaGrid();
      updateLivePreview();
      showToast('Media added to gallery!', 'info');
    });
  }

  // Media File Upload Picker
  const filePicker = document.getElementById('media-file-picker');
  const uploadStatus = document.getElementById('media-upload-status');

  /**
   * Fast client-side image compression using HTML5 Canvas.
   * Compresses large camera photos (5MB - 15MB) to ~120KB-250KB before uploading or base64 fallback.
   */
  const compressImage = async (file, maxDimension = 1400, quality = 0.85) => {
    if (!file || !file.type.startsWith('image/') || file.type === 'image/svg+xml' || file.type === 'image/gif') {
      return file;
    }
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const mime = 'image/jpeg';
          canvas.toBlob((blob) => {
            if (blob && blob.size < file.size) {
              const cleanName = (file.name || 'cover').replace(/\.[^.]+$/, '.jpg');
              resolve(new File([blob], cleanName, { type: mime }));
            } else {
              resolve(file);
            }
          }, mime, quality);
        };
        img.onerror = () => resolve(file);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });
  };

  const handleFilesUpload = async (files) => {
    if (!files || files.length === 0) return;

    if (uploadStatus) {
      uploadStatus.textContent = `Optimizing & uploading ${files.length} media file(s)...`;
      uploadStatus.style.display = 'block';
    }

    for (const rawFile of files) {
      const file = rawFile.type && rawFile.type.startsWith('image/') ? await compressImage(rawFile) : rawFile;
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });
      if (!dataUrl) continue;

      let uploadedUrl = '';
      try {
        const uploadHeaders = {
          'Content-Type': 'application/json',
        };
        if (currentSessionToken) uploadHeaders['Authorization'] = `Bearer ${currentSessionToken}`;
        if (currentSeller?.id) uploadHeaders['x-seller-id'] = currentSeller.id;

        const res = await fetch(getApiUrl('/api/upload'), {
          method: 'POST',
          headers: uploadHeaders,
          body: JSON.stringify({
            folder: 'seller_products',
            filename: file.name || `seller_${Date.now()}.jpg`,
            base64: dataUrl,
            contentType: file.type || 'image/jpeg',
            sellerId: currentSeller?.id,
            sellerToken: currentSessionToken,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          uploadedUrl = data && (data.publicUrl || data.url);
        }
      } catch (_) {}

      const finalUrl = uploadedUrl || dataUrl;
      const isFirst = editorMediaItems.length === 0 || !editorMediaItems.some(m => m.isMain);
      editorMediaItems.push({
        url: finalUrl,
        type: file.type && file.type.startsWith('video') ? 'video' : 'image',
        isMain: isFirst,
      });
    }

    if (uploadStatus) {
      uploadStatus.textContent = `Uploaded ${files.length} file(s) successfully!`;
      setTimeout(() => { uploadStatus.style.display = 'none'; }, 2500);
    }

    renderMediaGrid();
    updateLivePreview();
  };

  if (filePicker) {
    filePicker.addEventListener('change', async (e) => {
      const files = [...(e.target.files || [])];
      await handleFilesUpload(files);
      filePicker.value = '';
    });
  }

  // Drag and drop onto media studio
  const mediaGrid = document.getElementById('media-items-grid');
  if (mediaGrid) {
    mediaGrid.addEventListener('dragover', (e) => {
      e.preventDefault();
      mediaGrid.style.borderColor = 'var(--ab-pink)';
    });
    mediaGrid.addEventListener('dragleave', () => {
      mediaGrid.style.borderColor = '';
    });
    mediaGrid.addEventListener('drop', async (e) => {
      e.preventDefault();
      mediaGrid.style.borderColor = '';
      if (e.dataTransfer && e.dataTransfer.files) {
        await handleFilesUpload([...e.dataTransfer.files]);
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // SUBMIT FORM: SAVE (CREATE OR EDIT) PRODUCT
  // ══════════════════════════════════════════════════════════════════
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Guard against rapid duplicate clicks
      if (isSubmittingProduct) {
        return;
      }

      const titleVal = form.elements['name']?.value?.trim();
      let categoryVal = (form.elements['category']?.value || '').trim() || 'General';
      if (!allCategories.includes(categoryVal)) {
        allCategories.push(categoryVal);
        syncToolbarCategoryFilter();
      }
      const priceVal = form.elements['price']?.value?.trim();
      const origPriceVal = form.elements['originalPrice']?.value?.trim();
      const priceUSDVal = form.elements['priceUSD']?.value?.trim();
      const origPriceUSDVal = form.elements['originalPriceUSD']?.value?.trim();
      const badgeVal = form.elements['badge']?.value?.trim() || 'TRENDING PACK';
      const badgeStyleVal = form.elements['badgeStyle']?.value || 'pink';
      const slugVal = form.elements['slug']?.value?.trim();
      const descVal = form.elements['description']?.value?.trim();
      const downloadLinkVal = form.elements['downloadLink']?.value?.trim();
      const ratingVal = form.elements['rating']?.value?.trim() || '4.9';
      const specResVal = form.elements['specResolution']?.value?.trim() || '4K 2160p Ultra HD (60 FPS HDR)';
      const specAudioVal = form.elements['specAudio']?.value?.trim() || 'Original Studio Stereo Clear Audio';
      const specDevicesVal = form.elements['specDevices']?.value?.trim() || 'Android, iPhone (iOS), PC, Mac, Smart TV';
      const specMediaCountVal = form.elements['specMediaCount']?.value?.trim() || '';

      if (!titleVal) {
        showToast('Please enter pack title.', 'error');
        form.elements['name']?.focus();
        return;
      }
      if (!priceVal) {
        showToast('Please enter pack selling price (INR).', 'error');
        form.elements['price']?.focus();
        return;
      }
      if (!downloadLinkVal) {
        showToast('Please enter cloud delivery download link (Mega.nz or Drive).', 'error');
        form.elements['downloadLink']?.focus();
        return;
      }

      if (!editorMediaItems || editorMediaItems.length === 0) {
        showToast('Please upload or add at least one image or cover for your pack.', 'error');
        const mediaSec = document.querySelector('.media-studio-card');
        if (mediaSec) mediaSec.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      // Lock submission & trigger immediate visual loading state
      isSubmittingProduct = true;
      const isEditingMode = Boolean(editingProductId);
      setPublishingState(true, isEditingMode);
      showToast(isEditingMode ? 'Saving changes to store...' : '⚡ Publishing pack live to JaiGram...', 'info');

      try {
        const id = editingProductId || `prod_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`;
        const cleanSlug = slugVal || titleVal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

        // Media breakdown
        const mainMedia = editorMediaItems.find(m => m.isMain) || editorMediaItems.find(m => m.type === 'image') || editorMediaItems[0];
        const mainImageUrl = mainMedia?.url || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80';
        const allImageUrls = editorMediaItems.filter(m => m.type === 'image').map(m => m.url);
        const galleryImageUrls = allImageUrls.filter(u => u !== mainImageUrl);
        // Guarantee that mainImageUrl is the primary item in images array
        const finalImages = [mainImageUrl, ...galleryImageUrls];

        const mainVideo = editorMediaItems.find(m => m.type === 'video');
        const allVideoUrls = editorMediaItems.filter(m => m.type === 'video').map(m => m.url);

        const cleanTiers = editorTiers.filter(t => t.label || t.inr || t.usd);

        const productPayload = {
          id,
          name: titleVal,
          title: titleVal,
          slug: cleanSlug,
          category: categoryVal,
          badge: badgeVal,
          badgeStyle: badgeStyleVal,
          sellerId: currentSeller.id,
          sellerName: currentSeller.storeName,
          sellerEmail: currentSeller.email || '',
          sellerTelegram: currentSeller.telegram || '',
          description: descVal,
          price: String(priceVal),
          priceINR: String(priceVal),
          originalPrice: origPriceVal || String(Math.round(Number(priceVal) * 1.5)),
          originalPriceINR: origPriceVal || String(Math.round(Number(priceVal) * 1.5)),
          priceUSD: String(priceUSDVal || ''),
          originalPriceUSD: String(origPriceUSDVal || ''),
          downloadLink: downloadLinkVal,
          fileUrl: downloadLinkVal,
          orderLink: downloadLinkVal,
          image: mainImageUrl,
          thumbnail: mainImageUrl,
          coverImage: mainImageUrl,
          images: finalImages,
          galleryImages: galleryImageUrls,
          video: mainVideo?.url || '',
          videos: allVideoUrls,
          tiers: cleanTiers,
          features: editorFeatures,
          platforms: editorPlatforms,
          creators: editorCreators,
          specResolution: specResVal,
          specAudio: specAudioVal,
          specDevices: specDevicesVal,
          specMediaCount: specMediaCountVal,
          specDelivery: 'Mega.nz & Google Drive Direct Fast Links',
          specAccess: 'Lifetime Access + Free Link Replacement',
          specSupport: '24/7 Instant Telegram VIP Helpdesk',
          status: 'pending',
          approvalStatus: 'pending',
          rating: ratingVal,
          reviews: '1',
          updatedAt: Date.now(),
        };

        if (!editingProductId) {
          productPayload.createdAt = Date.now();
          productPayload.likes = 0; // Starts with 0 real likes
          productPayload.views = 0; // Starts with 0 real views
        } else {
          // Preserve existing product's likes and views
          const existingPack = sellerProducts.find(p => p.id === editingProductId);
          if (existingPack) {
            productPayload.likes = Number(existingPack.likes !== undefined ? existingPack.likes : 0);
            productPayload.views = Number(existingPack.views !== undefined ? existingPack.views : 0);
            productPayload.createdAt = existingPack.createdAt || Date.now();
          }
        }

        // Call backend API endpoint with 15s timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const apiRes = await fetch(getApiUrl('/api/seller/products'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save',
            isEditing: isEditingMode,
            sellerId: currentSeller.id,
            token: currentSessionToken,
            product: productPayload,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const apiData = await apiRes.json().catch(() => ({}));
        if (!apiRes.ok || !apiData.success) {
          throw new Error(apiData.error || `Server returned error (${apiRes.status})`);
        }

        const savedProduct = apiData.product || productPayload;

        // Update in-memory list
        const existingIdx = sellerProducts.findIndex(p => p.id === id);
        if (existingIdx >= 0) {
          sellerProducts[existingIdx] = { ...sellerProducts[existingIdx], ...savedProduct };
        } else {
          sellerProducts.unshift(savedProduct);
        }

        // Visual success state
        setPublishingState(false, isEditingMode, true);
        showToast(isEditingMode ? 'Pack updated & submitted for Admin approval!' : 'Pack submitted! It will go live on JaiGram once approved by Admin.', 'success');

        // Smoothly close modal after short visual confirmation
        setTimeout(() => {
          closeProductModal();
          renderProducts();
          updateMetrics();
        }, 450);

      } catch (err) {
        const errorMsg = err.name === 'AbortError' ? 'Publish timed out. Please check your network and try again.' : err.message;
        showToast('Save failed: ' + errorMsg, 'error');
        setPublishingState(false, isEditingMode);
      } finally {
        isSubmittingProduct = false;
      }
    });
  }

  // Setup Payout Method Tab Switching
  document.querySelectorAll('.btn-payout-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.payoutType;
      document.querySelectorAll('.btn-payout-tab').forEach(b => {
        const isSelected = (b === btn);
        b.classList.toggle('active', isSelected);
        if (isSelected) {
          b.style.background = 'rgba(16, 185, 129, 0.15)';
          b.style.color = '#34d399';
          b.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        } else {
          b.style.background = 'rgba(255, 255, 255, 0.04)';
          b.style.color = 'var(--sd-text-muted)';
          b.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        }
      });
      const groups = ['upi', 'bank', 'crypto', 'binance', 'paypal'];
      groups.forEach(g => {
        const el = document.getElementById(`payout-group-${g}`);
        if (el) el.style.display = (g === type) ? 'block' : 'none';
      });
      const hiddenMethod = document.getElementById('selected-payout-method');
      if (hiddenMethod) hiddenMethod.value = type;
    });
  });

  // Setup Payout Destination Save Form in Payouts tab
  const payoutDetailsForm = document.getElementById('payout-details-form') || document.getElementById('payout-upi-form');
  if (payoutDetailsForm) {
    payoutDetailsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const method = document.getElementById('selected-payout-method')?.value || 'upi';
      const upiId = document.getElementById('seller-upi-input')?.value?.trim() || '';
      const bankHolder = document.getElementById('seller-bank-holder')?.value?.trim() || '';
      const bankName = document.getElementById('seller-bank-name')?.value?.trim() || '';
      const bankAcc = document.getElementById('seller-bank-acc')?.value?.trim() || '';
      const bankIfsc = document.getElementById('seller-bank-ifsc')?.value?.trim().toUpperCase() || '';
      const usdtNetwork = document.getElementById('seller-usdt-network')?.value?.trim() || 'TRC-20';
      const usdtAddress = document.getElementById('seller-usdt-address')?.value?.trim() || '';
      const binancePayId = document.getElementById('seller-binance-id')?.value?.trim() || '';
      const paypalEmail = document.getElementById('seller-paypal-email')?.value?.trim() || '';

      // Validation depending on active method
      if (method === 'upi' && !upiId) {
        showToast('Please enter your receiving UPI ID (e.g. name@oksbi).', 'error');
        return;
      }
      if (method === 'bank' && (!bankAcc || !bankIfsc)) {
        showToast('Please enter both Bank Account Number and IFSC code.', 'error');
        return;
      }
      if (method === 'crypto' && !usdtAddress) {
        showToast('Please enter your USDT deposit address.', 'error');
        return;
      }
      if (method === 'binance' && !binancePayId) {
        showToast('Please enter your Binance Pay ID or registered email.', 'error');
        return;
      }
      if (method === 'paypal' && !paypalEmail) {
        showToast('Please enter your PayPal email address.', 'error');
        return;
      }

      const saveBtn = document.getElementById('btn-save-payout-details') || document.getElementById('btn-save-upi');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Saving...</span>';
      }

      try {
        const payload = {
          payoutMethod: method,
          payoutCountry: (method === 'crypto' || method === 'binance' || method === 'paypal') ? 'INTL' : 'IN',
          upiId,
          bankName,
          accountHolder: bankHolder,
          accountNumber: bankAcc,
          ifsc: bankIfsc,
          usdtAddress,
          usdtNetwork,
          binancePayId,
          paypalEmail,
        };

        const res = await updateSellerProfile(payload);
        if (res && res.seller) {
          currentSeller = { ...currentSeller, ...res.seller };
        } else {
          Object.assign(currentSeller, payload);
        }

        if (upiId) {
          localStorage.setItem(`linkadda_seller_upi_${currentSeller.id}`, upiId);
        }

        // Re-sync UI with new data
        syncSellerPayoutUI(currentSeller);

        showToast('✅ Receiving payout destination saved & updated in database for 7-day payouts!', 'success');
      } catch (err) {
        showToast('Failed to save payout details: ' + (err?.message || err), 'error');
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> <span>Save Payout Destination</span>';
        }
      }
    });
  }

  // Password Modal Controls
  const passwordForm = document.getElementById('password-change-form');
  if (passwordForm) {
    passwordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const oldPass = passwordForm.elements['oldPassword'].value;
      const newPass = passwordForm.elements['newPassword'].value;
      const confirmPass = passwordForm.elements['confirmPassword'].value;

      if (!newPass || newPass.length < 6) {
        showToast('New password must be at least 6 characters.', 'error');
        return;
      }
      if (newPass !== confirmPass) {
        showToast('Passwords do not match.', 'error');
        return;
      }

      try {
        await changeSellerPassword(oldPass, newPass);
        showToast('✅ Password changed successfully! A security confirmation has been sent to your email.', 'success');
        currentSeller.mustChangePassword = false;
        closePasswordModal();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  const btnOpenPass = document.getElementById('btn-open-password-modal');
  if (btnOpenPass) {
    btnOpenPass.addEventListener('click', (e) => {
      e.preventDefault();
      openPasswordModal(false);
    });
  }

  const btnClosePass = document.getElementById('btn-close-password-modal');
  if (btnClosePass) {
    btnClosePass.addEventListener('click', () => closePasswordModal());
  }

  // ━━ PROFILE FORM SUBMISSION (STORE NAME, OWNER, EMAIL, PHONE, TELEGRAM, UPI, PASSWORD) ━━
  const profileForm = document.getElementById('seller-profile-form');
  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('btn-save-profile');
      const saveBtnText = document.getElementById('btn-save-profile-text');
      const saveStatus = document.getElementById('profile-save-status');

      const storeName = document.getElementById('prof-store-name')?.value?.trim();
      const ownerName = document.getElementById('prof-owner-name')?.value?.trim();
      const email = document.getElementById('prof-email')?.value?.trim().toLowerCase();
      const category = document.getElementById('prof-category')?.value?.trim() || 'General';
      const phone = document.getElementById('prof-phone')?.value?.trim();
      const telegram = document.getElementById('prof-telegram')?.value?.trim();
      const upiId = document.getElementById('prof-upi')?.value?.trim();

      const curPass = document.getElementById('prof-cur-pwd')?.value?.trim();
      const newPass = document.getElementById('prof-new-pwd')?.value?.trim();
      const confPass = document.getElementById('prof-confirm-pwd')?.value?.trim();

      if (!storeName) {
        showToast('Please enter your Store / Company Name.', 'error');
        return;
      }
      if (!ownerName) {
        showToast('Please enter Owner Name.', 'error');
        return;
      }
      if (!email) {
        showToast('Please enter registered Email Address.', 'error');
        return;
      }

      if (newPass) {
        if (newPass.length < 6) {
          showToast('New password must be at least 6 characters.', 'error');
          return;
        }
        if (newPass !== confPass) {
          showToast('New passwords do not match.', 'error');
          return;
        }
      }

      if (saveBtn) saveBtn.disabled = true;
      if (saveBtnText) saveBtnText.textContent = 'Saving Profile...';

      try {
        const payload = {
          storeName,
          ownerName,
          email,
          category,
          phone,
          telegram,
          upiId: upiId || currentSeller.upiId || '',
          payoutMethod: currentSeller.payoutMethod || (upiId ? 'upi' : 'upi'),
          payoutCountry: currentSeller.payoutCountry || 'IN',
          bankName: currentSeller.bankName || '',
          accountHolder: currentSeller.accountHolder || '',
          accountNumber: currentSeller.accountNumber || '',
          ifsc: currentSeller.ifsc || '',
          usdtAddress: currentSeller.usdtAddress || '',
          usdtNetwork: currentSeller.usdtNetwork || 'TRC-20',
          binancePayId: currentSeller.binancePayId || '',
          paypalEmail: currentSeller.paypalEmail || '',
          avatar: currentSeller.avatar || '',
        };

        if (newPass) {
          payload.currentPassword = curPass;
          payload.newPassword = newPass;
        }

        const res = await updateSellerProfile(payload);
        if (res && res.seller) {
          currentSeller = { ...currentSeller, ...res.seller };
        } else {
          Object.assign(currentSeller, payload);
        }

        if (upiId) {
          localStorage.setItem(`linkadda_seller_upi_${currentSeller.id}`, upiId);
        }

        syncSellerPayoutUI(currentSeller);

        // Update brand displays across the dashboard
        const storeNameEl = document.getElementById('seller-store-name');
        if (storeNameEl) storeNameEl.textContent = currentSeller.storeName;

        const heroStoreName = document.getElementById('hero-store-name');
        if (heroStoreName) heroStoreName.textContent = currentSeller.storeName;

        const ownerNameEl = document.getElementById('seller-owner-name');
        if (ownerNameEl) ownerNameEl.textContent = currentSeller.ownerName;

        const emailEl = document.getElementById('seller-email');
        if (emailEl) emailEl.textContent = currentSeller.email;

        // Sync avatars across dashboard and profile hero
        syncSellerAvatarUI();

        const profHeroStore = document.getElementById('prof-hero-store-name');
        if (profHeroStore) profHeroStore.textContent = currentSeller.storeName;
        const profHeroEmail = document.getElementById('prof-hero-email');
        if (profHeroEmail) profHeroEmail.textContent = currentSeller.email;
        const profHeroCat = document.getElementById('prof-hero-category');
        if (profHeroCat) profHeroCat.textContent = currentSeller.category || 'General';
        const profHeroUpi = document.getElementById('prof-hero-upi');
        if (profHeroUpi) profHeroUpi.textContent = currentSeller.upiId || 'Not Set';

        // Update products seller name in memory
        sellerProducts.forEach(p => { p.sellerName = currentSeller.storeName; });
        renderProducts();

        // Clear password fields
        const curPassInput = document.getElementById('prof-cur-pwd');
        const newPassInput = document.getElementById('prof-new-pwd');
        const confPassInput = document.getElementById('prof-confirm-pwd');
        if (curPassInput) curPassInput.value = '';
        if (newPassInput) newPassInput.value = '';
        if (confPassInput) confPassInput.value = '';

        showToast('✅ Profile & Store settings updated successfully in database!', 'success');

        if (saveStatus) {
          saveStatus.textContent = '✓ Saved successfully in database!';
          saveStatus.style.display = 'inline';
          setTimeout(() => { saveStatus.style.display = 'none'; }, 4000);
        }
      } catch (err) {
        showToast('Error saving profile: ' + err.message, 'error');
      } finally {
        if (saveBtn) saveBtn.disabled = false;
        if (saveBtnText) saveBtnText.textContent = 'Save All Profile Changes';
      }
    });
  }

  // ━━ PROFILE TAB SHORTCUT ━━
  const headerUserBtn = document.getElementById('header-user-profile-btn');
  if (headerUserBtn) headerUserBtn.addEventListener('click', () => switchToTab('profile'));

  // ━━ TOGGLE ADVANCED SETTINGS ACCORDION ━━
  const btnToggleAdv = document.getElementById('btn-toggle-advanced-settings');
  const advCollapse = document.getElementById('advanced-settings-collapse');
  const advBadge = document.getElementById('adv-settings-badge');
  const advChevron = document.getElementById('adv-chevron-icon');

  if (btnToggleAdv && advCollapse) {
    btnToggleAdv.addEventListener('click', (e) => {
      e.preventDefault();
      const isOpen = advCollapse.style.display !== 'none';
      advCollapse.style.display = isOpen ? 'none' : 'block';
      if (advChevron) advChevron.style.transform = isOpen ? '' : 'rotate(180deg)';
      if (advBadge) advBadge.textContent = isOpen ? 'Expand to Edit' : 'Collapse Settings';
    });
  }

  // ━━ MOBILE VIEW SWITCHER IN PRODUCT EDITOR (1. FORM vs 2. PREVIEW) ━━
  const btnToggleEdit = document.getElementById('btn-toggle-edit-mode');
  const btnTogglePreview = document.getElementById('btn-toggle-preview-mode');
  const previewCol = document.querySelector('.product-editor-preview-col');
  const mainCol = document.querySelector('.product-editor-main-col');

  if (btnToggleEdit && btnTogglePreview && previewCol && mainCol) {
    btnToggleEdit.addEventListener('click', () => {
      btnToggleEdit.classList.add('active');
      btnTogglePreview.classList.remove('active');
      previewCol.classList.remove('mobile-active');
      mainCol.classList.remove('mobile-hidden');
    });

    btnTogglePreview.addEventListener('click', () => {
      updateLivePreview();
      btnTogglePreview.classList.add('active');
      btnToggleEdit.classList.remove('active');
      previewCol.classList.add('mobile-active');
      mainCol.classList.add('mobile-hidden');
    });
  }

  // ━━ SHARE MODAL CONTROLS ━━
  const btnCloseShare = document.getElementById('btn-close-share-modal');
  if (btnCloseShare) btnCloseShare.addEventListener('click', closeShareModal);

  const btnCopyShare = document.getElementById('btn-copy-share-link');
  if (btnCopyShare) {
    btnCopyShare.addEventListener('click', async () => {
      const inputEl = document.getElementById('share-link-input');
      if (inputEl && inputEl.value) {
        try {
          await navigator.clipboard.writeText(inputEl.value);
          btnCopyShare.innerHTML = '<i class="fa-solid fa-check" style="color: #10b981;"></i> <span>Copied!</span>';
          showToast('Product link copied to clipboard!', 'success');
          setTimeout(() => {
            btnCopyShare.innerHTML = '<i class="fa-solid fa-copy"></i> <span>Copy</span>';
          }, 2000);
        } catch (_) {
          inputEl.select();
          document.execCommand('copy');
          showToast('Product link copied to clipboard!', 'success');
        }
      }
    });
  }

  // Navigation Tab Switching (Desktop & Mobile Dock)
  const allTabs = document.querySelectorAll('.seller-nav-item[data-tab], .dock-nav-item[data-tab]');
  allTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const target = tab.getAttribute('data-tab');
      switchToTab(target);
    });
  });

  // ━━ SHARE STOREFRONT MODAL CONTROLS ━━
  const btnCloseStoreShare = document.getElementById('btn-close-share-store-modal');
  if (btnCloseStoreShare) btnCloseStoreShare.addEventListener('click', closeShareStoreModal);

  // Trigger buttons across dashboard
  ['btn-header-share-store', 'btn-hero-share-store', 'btn-prof-share-store', 'btn-sidebar-share-store'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openShareStoreModal();
      });
    }
  });

  // Copy Storefront Link button
  const btnCopyStoreLink = document.getElementById('btn-copy-store-link');
  if (btnCopyStoreLink) {
    btnCopyStoreLink.addEventListener('click', async () => {
      const inputEl = document.getElementById('share-store-link-input');
      if (inputEl && inputEl.value) {
        try {
          await navigator.clipboard.writeText(inputEl.value);
          btnCopyStoreLink.innerHTML = '<i class="fa-solid fa-check" style="color: #10b981;"></i> <span>Copied!</span>';
          showToast('Storefront link copied to clipboard!', 'success');
          setTimeout(() => {
            btnCopyStoreLink.innerHTML = '<i class="fa-solid fa-copy"></i> <span>Copy Link</span>';
          }, 2000);
        } catch (_) {
          inputEl.select();
          document.execCommand('copy');
          showToast('Storefront link copied to clipboard!', 'success');
        }
      }
    });
  }

  // Copy Seller ID button
  const btnCopyStoreId = document.getElementById('btn-copy-store-id');
  if (btnCopyStoreId) {
    btnCopyStoreId.addEventListener('click', async () => {
      const idEl = document.getElementById('share-store-id-text');
      const sellerId = idEl ? idEl.textContent.trim() : (currentSeller?.id || '');
      if (sellerId) {
        try {
          await navigator.clipboard.writeText(sellerId);
          btnCopyStoreId.innerHTML = '<i class="fa-solid fa-check" style="color: #ffffff;"></i> <span>Copied!</span>';
          showToast('Seller ID copied to clipboard!', 'success');
          setTimeout(() => {
            btnCopyStoreId.innerHTML = '<i class="fa-solid fa-copy"></i> <span>Copy ID</span>';
          }, 2000);
        } catch (_) {
          showToast(`Seller ID: ${sellerId}`, 'info');
        }
      }
    });
  }

  // Global modal escape key listener
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeProductModal();
      closeDeleteModal();
      closeShareModal();
      closeShareStoreModal();
      if (!currentSeller?.mustChangePassword) {
        closePasswordModal();
      }
    }
  });

  // Click outside dialog to dismiss
  ['product-modal', 'delete-modal', 'share-modal', 'share-store-modal'].forEach(modalId => {
    const el = document.getElementById(modalId);
    if (el) {
      el.addEventListener('click', (e) => {
        if (e.target === el) {
          if (modalId === 'product-modal') closeProductModal();
          else if (modalId === 'delete-modal') closeDeleteModal();
          else if (modalId === 'share-modal') closeShareModal();
          else if (modalId === 'share-store-modal') closeShareStoreModal();
        }
      });
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// PASSWORD MODAL
// ══════════════════════════════════════════════════════════════════
export function openPasswordModal(isForced = false) {
  const modal = document.getElementById('password-modal');
  if (!modal) return;
  modal.classList.add('active');

  const notice = document.getElementById('password-forced-notice');
  const closeBtn = document.getElementById('btn-close-password-modal');

  if (isForced) {
    if (notice) notice.style.display = 'block';
    if (closeBtn) closeBtn.style.display = 'none'; // Cannot dismiss if mandatory
  } else {
    if (notice) notice.style.display = 'none';
    if (closeBtn) closeBtn.style.display = 'inline-block';
  }
}

export function closePasswordModal() {
  const modal = document.getElementById('password-modal');
  if (modal) modal.classList.remove('active');
}

// Delegate for password visibility toggle buttons
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-pwd-icon[data-toggle-for]');
  if (!btn) return;
  e.preventDefault();
  const inputId = btn.getAttribute('data-toggle-for');
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPwd = input.type === 'password';
  input.type = isPwd ? 'text' : 'password';
  const icon = btn.querySelector('i');
  if (icon) {
    icon.className = isPwd ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
  }
});
