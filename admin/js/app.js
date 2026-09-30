import { APP_CONFIG, NAV_ITEMS } from './config.js';
import { auth, db, ref, get, set, update, remove } from './firebase.js';
import {
  protectRoute,
  logout,
  getActiveAdminSessions,
  terminateAdminSession,
  terminateAllOtherAdminSessions,
  getCurrentSessionId,
  getDeviceDetails,
} from './auth.js';

export async function getAdminTokenHeader() {
  try {
    if (auth && auth.currentUser) {
      const idToken = await auth.currentUser.getIdToken();
      if (idToken) return { 'Authorization': `Bearer ${idToken}` };
    }
  } catch (_) {}
  return {};
}

export async function sendAdminNotificationEmail(payload) {
  try {
    const authHeaders = await getAdminTokenHeader();
    const res = await fetch('/api/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (err) {
    console.warn('sendAdminNotificationEmail notice:', err?.message);
    return false;
  }
}
import {
  startRealtime,
  ensureNodesForRoute,
  subscribe,
  stats,
  recentActivity,
  recentOrders,
  listCollection,
  getItem,
  createRecord,
  saveRecord,
  updateRecord,
  updateRecordsBatch,
  deleteRecord,
  duplicateRecord,
  getSnapshot,
} from './state.js';
import { uploadAsset, deletePublicAsset } from './storage.js';
import { fetchCurrentSiteCatalog, normalizeCatalogRecords } from './site-import.js';
import {
  escapeHtml,
  slugify,
  formatDateTime,
  formatRelativeTime,
  formatNumber,
  fromLines,
  safeJson,
  uid,
  copyText,
} from './utils.js';

const viewRoot = document.getElementById('viewRoot');
const sideNav = document.getElementById('sideNav');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
const toastHost = document.getElementById('toastHost');
const modalBackdrop = document.getElementById('modalBackdrop');
const modalRoot = document.getElementById('modalRoot');
const paletteBackdrop = document.getElementById('paletteBackdrop');

window.copyText = copyText;
window.closeModal = closeModal;
window.showToast = showToast;
const paletteList = document.getElementById('paletteList');
const commandInput = document.getElementById('commandInput');
const notifyBtn = document.getElementById('notifyBtn');
const notifyCount = document.getElementById('notifyCount');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const userEmail = document.getElementById('userEmail');
const CATALOG_PREF_KEY = 'linkadda_admin_catalog_prefs';

function readCatalogPrefs() {
  try {
    return JSON.parse(localStorage.getItem(CATALOG_PREF_KEY) || '{}') || {};
  } catch (_) {
    return {};
  }
}

function writeCatalogPrefs(next) {
  try {
    localStorage.setItem(CATALOG_PREF_KEY, JSON.stringify(next || {}));
  } catch (_) {
    // Ignore storage write failures.
  }
}

const catalogPrefs = readCatalogPrefs();

const ui = {
  route: 'dashboard',
  catalogTab: 'products',
  dashboardRange: 'all',
  dashboardMetric: 'visitors',
  media: {
    search: '',
    folder: 'all',
    type: 'all',
    sort: 'newest',
    lifecycle: 'active',
    view: 'grid',
    status: '',
    page: 1,
    pageSize: 36,
    selectedIds: new Set(),
  },
  management: {
    search: '',
    status: 'all',
    method: 'all',
    date: 'all',
  },
  reviews: {
    search: '',
    status: 'all',
  },
  sellers: {
    tab: 'pending',
    search: '',
  },
  catalogFiltersOpen: typeof catalogPrefs.catalogFiltersOpen === 'boolean'
    ? catalogPrefs.catalogFiltersOpen
    : !isMobileViewport(),
  search: '',
  commandSearch: '',
  sort: 'displayOrder',
  catalogView: 'list',
  catalogPageSize: Number(catalogPrefs.pageSize) || 8,
  filters: {
    status: catalogPrefs.status || 'all',
    category: catalogPrefs.category || 'all',
  },
  page: 1,
  modal: null,
  data: null,
  notificationsOpen: false,
  selection: new Set(),
};

function persistCatalogPrefs() {
  writeCatalogPrefs({
    view: ui.catalogView,
    pageSize: ui.catalogPageSize,
    status: ui.filters.status,
    category: ui.filters.category,
    sort: ui.sort,
    search: ui.search,
    tab: ui.catalogTab,
    catalogFiltersOpen: ui.catalogFiltersOpen,
  });
}

function syncCatalogPrefs(next = {}) {
  Object.assign(ui, next);
  persistCatalogPrefs();
}

function resetCatalogFilters() {
  ui.search = '';
  ui.sort = 'updatedAt';
  ui.filters.status = 'all';
  ui.filters.category = 'all';
  ui.catalogPageSize = 8;
  ui.page = 1;
  persistCatalogPrefs();
  closeCatalogActionMenus();
  renderView(ui.data || {});
}

const collectionSchemas = {
  products: {
    title: 'Products',
    node: 'products',
    label: 'Product',
    description: 'Manage every product that appears across the public site.',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'slug', label: 'Slug', type: 'text', required: true },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'sellerName', label: 'Seller / Store Name', type: 'text', hint: 'Creator / partner storefront name' },
      { key: 'sellerId', label: 'Seller ID', type: 'text', hint: 'Partner seller ID (e.g. seller_...)' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'priceINR', label: 'Price INR', type: 'text' },
      { key: 'priceUSD', label: 'Price USD', type: 'text' },
      { key: 'badge', label: 'Badge', type: 'text' },
      { key: 'badgeStyle', label: 'Badge Color', type: 'text' },
      { key: 'badgeIcon', label: 'Badge Icon', type: 'text' },
      { key: 'image', label: 'Main Image', type: 'text', hint: 'Paste a URL or use the file picker below.' },
      { key: 'video', label: 'Main Video', type: 'text' },
      { key: 'galleryImages', label: 'Gallery Images', type: 'textarea', hint: 'One URL per line or upload multiple files.' },
      { key: 'videos', label: 'Additional Videos', type: 'textarea', hint: 'One video URL per line or upload video files.' },
      { key: 'creators', label: 'Creators', type: 'textarea', hint: 'Comma or line separated' },
      { key: 'platforms', label: 'Platforms', type: 'textarea', hint: 'Comma or line separated' },
      { key: 'features', label: 'Features', type: 'textarea', hint: 'One feature per line' },
      { key: 'orderLink', label: 'Order Link', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'hidden', 'draft', 'deleted'] },
      { key: 'displayOrder', label: 'Display Order', type: 'number' },
    ],
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'category', label: 'Category' },
      { key: 'price', label: 'Price' },
      { key: 'status', label: 'Status' },
      { key: 'updatedAt', label: 'Updated' },
    ],
  },
  categories: {
    title: 'Categories',
    node: 'categories',
    label: 'Category',
    description: 'Manage product groups. Categories only store grouping details, not product-specific fields.',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'slug', label: 'Slug', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'image', label: 'Category Image', type: 'text', hint: 'Optional. Paste a URL or use the file picker below.' },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'hidden', 'draft', 'deleted'] },
      { key: 'displayOrder', label: 'Display Order', type: 'number' },
    ],
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'status', label: 'Status' },
      { key: 'updatedAt', label: 'Updated' },
    ],
  },
  faq: {
    title: 'FAQ',
    node: 'faq',
    label: 'FAQ Item',
    description: 'Edit accordion questions and answers.',
    fields: [
      { key: 'question', label: 'Question', type: 'text', required: true },
      { key: 'answer', label: 'Answer', type: 'textarea', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'hidden'] },
      { key: 'displayOrder', label: 'Display Order', type: 'number' },
    ],
    columns: [
      { key: 'question', label: 'Question' },
      { key: 'status', label: 'Status' },
      { key: 'updatedAt', label: 'Updated' },
    ],
  },
  testimonials: {
    title: 'Testimonials',
    node: 'testimonials',
    label: 'Testimonial',
    description: 'Manage social proof content.',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'rating', label: 'Rating', type: 'number', required: true },
      { key: 'photo', label: 'Photo URL', type: 'url' },
      { key: 'review', label: 'Review', type: 'textarea', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'hidden'] },
      { key: 'displayOrder', label: 'Display Order', type: 'number' },
    ],
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'rating', label: 'Rating' },
      { key: 'status', label: 'Status' },
      { key: 'updatedAt', label: 'Updated' },
    ],
  },
};

const singleEditors = {
  hero: {
    title: 'Hero',
    description: 'Edit the homepage hero section without changing layout or animation.',
    fields: [
      { key: 'title', label: 'Hero Title', type: 'text' },
      { key: 'subtitle', label: 'Subtitle', type: 'textarea' },
      { key: 'primaryButtonText', label: 'Primary Button Text', type: 'text' },
      { key: 'primaryButtonLink', label: 'Primary Button Link', type: 'url' },
      { key: 'secondaryButtonText', label: 'Secondary Button Text', type: 'text' },
      { key: 'secondaryButtonLink', label: 'Secondary Button Link', type: 'url' },
      { key: 'stat1', label: 'Stat 1', type: 'text' },
      { key: 'stat2', label: 'Stat 2', type: 'text' },
      { key: 'stat3', label: 'Stat 3', type: 'text' },
      { key: 'backgroundImage', label: 'Background Image', type: 'url' },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'hidden'] },
    ],
  },
  banner: {
    title: 'Pinned Deal Banner',
    description: 'Manage the special pinned deal banner shown on the home page.',
    fields: [
      { key: 'title', label: 'Banner Title', type: 'text' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'priceOriginal', label: 'Original Price (e.g. ₹10,900)', type: 'text' },
      { key: 'priceOfferINR', label: 'Offer Price INR (e.g. ₹4,399)', type: 'text' },
      { key: 'priceOfferUSD', label: 'Offer Price USD (e.g. $109)', type: 'text' },
      { key: 'buttonText', label: 'Button Text', type: 'text' },
      { key: 'buttonLink', label: 'Button Link', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'hidden'] },
    ],
  },
  settings: {
    title: 'Website Settings',
    description: 'Global settings for logo, contact links, footer and favicon.',
    fields: [
      { key: 'siteName', label: 'Website Name', type: 'text' },
      { key: 'logo', label: 'Logo URL', type: 'url' },
      { key: 'favicon', label: 'Favicon URL', type: 'url' },
      { key: 'whatsapp', label: 'WhatsApp', type: 'text' },
      { key: 'telegram', label: 'Telegram', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'footer', label: 'Footer Text', type: 'textarea' },
      { key: 'socialLinks', label: 'Social Links', type: 'textarea', hint: 'One URL per line' },
      { key: 'maintenanceMode', label: 'Maintenance Mode', type: 'select', options: ['active', 'hidden'] },
      { key: 'publicSiteSync', label: 'Public Website Status', type: 'text' },
      { key: 'currency', label: 'Currency', type: 'text' },
      { key: 'currencySymbol', label: 'Currency Symbol', type: 'text' },
      { key: 'priceFormat', label: 'Price Display Format', type: 'text' },
    ],
  },
  payment: {
    title: 'Payment Settings',
    description: 'Configure payment methods, brand logos, custom names, priority recommendations, and credentials.',
    fields: [
      { key: 'recommendedMethod', label: '⭐ Recommended Method (Placed at the Very TOP with Special Badge)', type: 'select', options: [
        { label: 'UPI (GPay / PhonePe / Paytm / QR)', value: 'upi' },
        { label: 'Binance Pay & Crypto (0% Gas Fee)', value: 'binancepay' },
        { label: 'Cards (Visa, Mastercard, RuPay)', value: 'cards' },
        { label: 'Netbanking (SBI, ICICI, HDFC, Axis)', value: 'netbanking' },
        { label: 'LinkAdda Wallet (1-Click Instant)', value: 'wallet' },
        { label: 'Bank Transfer (IMPS / NEFT)', value: 'custom_bank' },
        { label: 'Bitcoin (BTC Native Network)', value: 'custom_btc' },
        { label: 'USDT BEP-20 (BNB Smart Chain)', value: 'bep20' },
        { label: 'USDT ERC-20 (Ethereum Network)', value: 'eth' },
        { label: 'PayPal (International)', value: 'paypal' },
      ] },
      { key: 'recommendationBadge', label: 'Recommendation Badge Label (e.g. RECOMMENDED, POPULAR, FASTEST)', type: 'text' },
      
      // UPI Customization
      { key: 'upiTitle', label: 'UPI Method Display Title (default: UPI)', type: 'text' },
      { key: 'upiSub', label: 'UPI Subtitle (default: GPay, PhonePe, Paytm)', type: 'text' },
      { key: 'upiLogo', label: 'UPI Custom Logo Image URL (leave empty for official logos)', type: 'url' },
      { key: 'upiId', label: 'Merchant UPI VPA ID (e.g. Ritikane@ptyes)', type: 'text' },
      { key: 'merchantName', label: 'Merchant Display Name (e.g. LinkAdda Store)', type: 'text' },
      { key: 'qrImage', label: 'Custom Static QR Image URL', type: 'url' },

      // Binance Pay & Crypto
      { key: 'binanceTitle', label: 'Binance Method Display Title (default: Crypto & Binance Pay)', type: 'text' },
      { key: 'binanceSub', label: 'Binance Subtitle (default: 0% Gas Fee)', type: 'text' },
      { key: 'binanceLogo', label: 'Binance Custom Logo Image URL (leave empty for official logo)', type: 'url' },
      { key: 'binanceId', label: 'Binance Pay ID (e.g. 1197561104)', type: 'text' },
      { key: 'bep20Address', label: 'USDT BEP-20 Wallet Address', type: 'text' },
      { key: 'ethAddress', label: 'USDT ERC-20 Wallet Address', type: 'text' },

      // Cards & Netbanking
      { key: 'cardsTitle', label: 'Cards Method Display Title (default: Cards)', type: 'text' },
      { key: 'cardsSub', label: 'Cards Subtitle (default: Visa, Mastercard, RuPay)', type: 'text' },
      { key: 'cardsLogo', label: 'Cards Custom Logo Image URL (leave empty for official logos)', type: 'url' },
      { key: 'netbankingTitle', label: 'Netbanking Method Display Title (default: Netbanking)', type: 'text' },
      { key: 'netbankingSub', label: 'Netbanking Subtitle (default: SBI, ICICI, HDFC)', type: 'text' },
      { key: 'netbankingLogo', label: 'Netbanking Custom Logo Image URL (leave empty for official logos)', type: 'url' },
      { key: 'walletTitle', label: 'Wallet Display Title (default: Wallet)', type: 'text' },
      { key: 'walletSub', label: 'Wallet Subtitle', type: 'text' },

      // Bank Transfer Details
      { key: 'bankTitle', label: 'Bank Transfer Method Title (default: Bank Transfer (IMPS / NEFT))', type: 'text' },
      { key: 'bankSub', label: 'Bank Transfer Subtitle (default: Direct Account Transfer)', type: 'text' },
      { key: 'bankLogo', label: 'Bank Transfer Custom Logo Image URL', type: 'url' },
      { key: 'bankName', label: 'Bank Name (e.g. State Bank of India)', type: 'text' },
      { key: 'accountHolder', label: 'Account Holder Name', type: 'text' },
      { key: 'accountNumber', label: 'Bank Account Number', type: 'text' },
      { key: 'ifscCode', label: 'Bank IFSC Code', type: 'text' },
      { key: 'bankUpiId', label: 'Bank Associated UPI ID', type: 'text' },

      // Bitcoin Details
      { key: 'btcTitle', label: 'Bitcoin Method Display Title', type: 'text' },
      { key: 'btcSub', label: 'Bitcoin Subtitle (default: BTC Native Network)', type: 'text' },
      { key: 'btcLogo', label: 'Bitcoin Custom Logo Image URL', type: 'url' },
      { key: 'btcAddress', label: 'Bitcoin (BTC) Native Address', type: 'text' },

      // Support & Status
      { key: 'instructions', label: 'Checkout Instructions / Notice', type: 'textarea' },
      { key: 'telegramUrl', label: 'Support Telegram URL', type: 'url' },
      { key: 'telegramChannel', label: 'Telegram Channel', type: 'url' },
      { key: 'paypalLink', label: 'PayPal Link', type: 'url' },
      { key: 'status', label: 'Global Gateway Status', type: 'select', options: ['active', 'hidden'] },
    ],
  },
};

function showToast(message, type = 'info') {
  const node = document.createElement('div');
  const typeIcons = {
    success: 'check-circle-2',
    danger: 'alert-circle',
    warning: 'alert-triangle',
    info: 'bell',
  };
  const icon = typeIcons[type] || 'info';
  node.className = `toast toast-${type} glass`;
  node.innerHTML = `
    <div class="toast-icon-wrap">
      <i data-lucide="${icon}"></i>
    </div>
    <div class="toast-body">
      <strong class="toast-title">${escapeHtml(type.toUpperCase())}</strong>
      <div class="toast-text">${escapeHtml(message)}</div>
    </div>
    <button type="button" class="toast-close" onclick="this.closest('.toast').remove()" aria-label="Dismiss">&times;</button>
  `;
  toastHost.appendChild(node);
  if (window.lucide) lucide.createIcons();

  setTimeout(() => {
    node.classList.add('toast-exit');
    setTimeout(() => node.remove(), 300);
  }, 3200);
}

function setTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem(APP_CONFIG.themeKey, theme);
}

function getTheme() {
  return localStorage.getItem(APP_CONFIG.themeKey) || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
}

function initTheme() {
  setTheme(getTheme());
}

function toggleTheme() {
  setTheme(document.body.dataset.theme === 'light' ? 'dark' : 'light');
}

function openModal(html) {
  modalRoot.innerHTML = html;
  modalBackdrop.classList.add('open');
  if (window.lucide) lucide.createIcons();
}

function closeModal() {
  modalBackdrop.classList.remove('open');
  modalRoot.innerHTML = '';
}

function openPalette() {
  paletteBackdrop.classList.add('open');
  renderPalette();
}

function closePalette() {
  paletteBackdrop.classList.remove('open');
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 1180px)').matches;
}

function setSidebarOpen(open) {
  if (!sidebar) return;
  sidebar.classList.toggle('open', open);
  sidebarOverlay?.classList.toggle('open', open);
  document.body.classList.toggle('sidebar-lock', Boolean(open));
  if (sidebarOverlay) sidebarOverlay.setAttribute('aria-hidden', String(!open));
}

function openSidebar() {
  setSidebarOpen(true);
}

function closeSidebar() {
  setSidebarOpen(false);
}

function toggleSidebar() {
  if (!sidebar) return;
  setSidebarOpen(!sidebar.classList.contains('open'));
}

function renderPalette() {
  const items = [
    ...NAV_ITEMS.map((item) => ({ title: item.label, detail: `Open ${item.label}`, action: `goto:${item.key}` })),
    { title: 'Add Product', detail: 'Create a new product record', action: 'create:products' },
    { title: 'Add Category', detail: 'Create a new category record', action: 'create:categories' },
    { title: 'Upload Media', detail: 'Open media manager', action: 'goto:media' },
    { title: 'Logout', detail: 'Sign out from Firebase Auth', action: 'logout' },
  ];
  paletteList.innerHTML = items
    .filter((item) => !ui.commandSearch || `${item.title} ${item.detail}`.toLowerCase().includes(ui.commandSearch.toLowerCase()))
    .map((item) => `
      <button class="palette-item" data-palette-action="${escapeHtml(item.action)}">
        <span><strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(item.detail)}</small></span>
        <i data-lucide="arrow-right"></i>
      </button>
    `)
    .join('');
  if (window.lucide) lucide.createIcons();
}

function navMarkup() {
  return NAV_ITEMS.map((item) => `
    <a class="nav-link ${ui.route === item.key ? 'active' : ''}" href="#/${item.key}" data-route="${item.key}">
      <i data-lucide="${escapeHtml(item.icon)}"></i>
      <span>${escapeHtml(item.label)}</span>
    </a>
  `).join('');
}

function collectionRowBadge(item) {
  const status = String(item.status || 'active').toLowerCase();
  if (status === 'active') return '<span class="badge success">Active</span>';
  if (status === 'hidden') return '<span class="badge warning">Hidden</span>';
  if (status === 'draft') return '<span class="badge">Draft</span>';
  if (status === 'deleted') return '<span class="badge danger">Deleted</span>';
  return `<span class="badge">${escapeHtml(status)}</span>`;
}

function buildTableRows(node, columns, items) {
  if (!items.length) {
    return `<tr><td colspan="${columns.length + 1}"><div class="empty-state">No records found.</div></td></tr>`;
  }
  return items.map((item) => {
    const cells = columns.map((column) => {
      let value = item[column.key];
      if (column.key === 'price') value = `${item.priceINR || ''} / ${item.priceUSD || ''}`;
      if (column.key === 'rating') value = `${value || 0}/5`;
      if (column.key === 'updatedAt') value = formatDateTime(value);
      if (column.key === 'status') value = collectionRowBadge(item);
      if (value === undefined || value === null || value === '') value = '-';
      return `<td>${typeof value === 'string' && value.startsWith('<span') ? value : escapeHtml(value)}</td>`;
    }).join('');
    return `
      <tr>
        ${cells}
        <td>
          <div class="item-actions">
            <button class="icon-btn" data-action="edit" data-node="${node}" data-id="${item.id}"><i data-lucide="pencil"></i> Edit</button>
            <button class="icon-btn" data-action="duplicate" data-node="${node}" data-id="${item.id}"><i data-lucide="copy"></i> Duplicate</button>
            <button class="icon-btn" data-action="toggle" data-node="${node}" data-id="${item.id}"><i data-lucide="eye-off"></i> Hide/Show</button>
            <button class="icon-btn" data-action="delete" data-node="${node}" data-id="${item.id}"><i data-lucide="trash-2"></i> Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function sanitizeRecordFromForm(form, fields, existing = {}) {
  const data = { ...existing };
  const linesToArray = ['galleryImages', 'videos', 'creators', 'platforms', 'features', 'socialLinks'];
  fields.forEach((field) => {
    const el = form.querySelector(`[name="${field.key}"]`);
    if (!el) return;
    let value = el.value.trim();
    if (field.type === 'number') value = value === '' ? 0 : Number(value);
    if (field.type === 'textarea' && linesToArray.includes(field.key)) {
      value = fromLines(value);
    }
    if (field.key === 'slug' && !value) value = slugify(form.querySelector('[name="title"]')?.value || '');
    data[field.key] = value;
  });
  if (data.image && !data.images) data.images = [data.image];
  if (Array.isArray(data.galleryImages)) {
    const current = data.image ? [data.image] : [];
    data.images = [...new Set([...current, ...data.galleryImages.filter(Boolean)])];
  }
  if (data.video && !data.videos) data.videos = [data.video];
  if (Array.isArray(data.videos)) {
    const current = data.video ? [data.video] : [];
    data.videos = [...new Set([...current, ...data.videos.filter(Boolean)])];
  }
  if (data.status === '') data.status = 'active';
  if (!data.displayOrder && data.displayOrder !== 0) data.displayOrder = 0;
  data.updatedAt = Date.now();
  if (!data.createdAt) data.createdAt = Date.now();
  return data;
}

function fieldMarkup(field, value = '', options = {}) {
  const common = `name="${escapeHtml(field.key)}" id="${escapeHtml(field.key)}"`;
  const hint = field.hint ? `<small class="section-subtitle">${escapeHtml(field.hint)}</small>` : '';
  const allowUploads = Boolean(options.allowUploads);
  const uploadBlock = (name, label, accept, multiple = false) => allowUploads ? `
    <div class="field full">
      <label for="${escapeHtml(name)}">${escapeHtml(label)}</label>
      <input class="input" type="file" name="${escapeHtml(name)}" id="${escapeHtml(name)}" accept="${escapeHtml(accept)}"${multiple ? ' multiple' : ''} />
      <small class="section-subtitle">Upload a local file. If selected, this file will be uploaded to RustFS S3 and the URL field will update automatically.</small>
    </div>
  ` : '';
  const imageUploadKeys = ['image', 'photo', 'logo', 'favicon', 'qrImage', 'backgroundImage'];
  if (field.type === 'textarea') {
    if (allowUploads && field.key === 'galleryImages') {
      return `
        <div class="field full">
          <label for="${escapeHtml(field.key)}">${escapeHtml(field.label)}</label>
          <textarea class="textarea" ${common} placeholder="${escapeHtml(field.label)}">${escapeHtml(Array.isArray(value) ? value.join('\n') : value || '')}</textarea>
          ${hint}
          ${uploadBlock('galleryFiles', 'Upload Gallery Files', 'image/*', true)}
        </div>
      `;
    }
    return `
      <div class="field ${field.full ? 'full' : ''}">
        <label for="${escapeHtml(field.key)}">${escapeHtml(field.label)}</label>
        <textarea class="textarea" ${common} placeholder="${escapeHtml(field.label)}">${escapeHtml(Array.isArray(value) ? value.join('\n') : value || '')}</textarea>
        ${hint}
      </div>
    `;
  }
  if (field.type === 'select') {
    return `
      <div class="field">
        <label for="${escapeHtml(field.key)}">${escapeHtml(field.label)}</label>
        <select class="select" ${common}>
          ${(field.options || []).map((option) => {
            const val = typeof option === 'object' && option !== null ? option.value : option;
            const lbl = typeof option === 'object' && option !== null ? option.label : option;
            return `<option value="${escapeHtml(val)}" ${String(value) === String(val) ? 'selected' : ''}>${escapeHtml(lbl)}</option>`;
          }).join('')}
        </select>
      </div>
    `;
  }
  if (field.type === 'url') {
    if (allowUploads && imageUploadKeys.includes(field.key)) {
      return `
        <div class="field">
          <label for="${escapeHtml(field.key)}">${escapeHtml(field.label)}</label>
          <input class="input" type="text" inputmode="url" ${common} value="${escapeHtml(value)}" placeholder="${escapeHtml(field.label)}" />
          ${hint}
          ${uploadBlock(`${field.key}File`, `Upload ${field.label}`, 'image/*')}
        </div>
      `;
    }
    return `
      <div class="field">
        <label for="${escapeHtml(field.key)}">${escapeHtml(field.label)}</label>
        <input class="input" type="text" inputmode="url" ${common} value="${escapeHtml(value)}" placeholder="${escapeHtml(field.label)}" />
        ${hint}
      </div>
    `;
  }
  if (allowUploads && imageUploadKeys.includes(field.key)) {
    return `
      <div class="field">
        <label for="${escapeHtml(field.key)}">${escapeHtml(field.label)}</label>
        <input class="input" type="text" ${common} value="${escapeHtml(value)}" placeholder="${escapeHtml(field.label)}" />
        ${hint}
        ${uploadBlock(`${field.key}File`, `Upload ${field.label}`, 'image/*')}
      </div>
    `;
  }
  return `
    <div class="field">
      <label for="${escapeHtml(field.key)}">${escapeHtml(field.label)}</label>
      <input class="input" type="${escapeHtml(field.type || 'text')}" ${common} value="${escapeHtml(value)}" placeholder="${escapeHtml(field.label)}" />
      ${hint}
    </div>
  `;
}

function renderRecordPreview(record = {}) {
  const media = record.image || (Array.isArray(record.images) ? record.images[0] : '') || '';
  const galleryCount = Array.isArray(record.galleryImages) ? record.galleryImages.filter(Boolean).length : 0;
  return `
    <div class="editor-preview glass">
      <div class="editor-preview-media">
        ${media ? `<img src="${escapeHtml(media)}" alt="${escapeHtml(record.title || 'Preview')}" loading="lazy" />` : '<div class="preview-fallback">No image selected</div>'}
      </div>
      <div class="editor-preview-body">
        <div class="editor-preview-badge">${escapeHtml(record.badge || record.category || 'Live Record')}</div>
        <h3>${escapeHtml(record.title || 'Untitled')}</h3>
        <p>${escapeHtml(record.description || 'Add title, image and pricing to preview the live card shape.')}</p>
        <div class="editor-preview-list">
          <div><span>INR</span><strong>${escapeHtml(record.priceINR || '-')}</strong></div>
          <div><span>USD</span><strong>${escapeHtml(record.priceUSD || '-')}</strong></div>
          <div><span>Gallery</span><strong>${escapeHtml(String(galleryCount))}</strong></div>
        </div>
      </div>
    </div>
  `;
}

const PRODUCT_BADGE_STYLE_OPTIONS = [
  { label: 'Red (Crimson Luxury)', value: 'badge-red' },
  { label: 'White (Frosted White)', value: 'badge-white' },
  { label: 'Gold (Luxury Gold)', value: 'pcard-pill-gold' },
  { label: 'Default (Obsidian Glass)', value: '' },
];

function normalizeEditorList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeTierList(raw) {
  if (!raw) return [];
  let list = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'object') {
    list = Object.values(raw);
  } else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
      else if (typeof parsed === 'object') list = Object.values(parsed);
    } catch (_) {}
  }
  return list
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      label: String(item.label || item.title || item.name || '').trim(),
      inr: String(item.inr || item.priceINR || item.price || '').replace(/[₹\s,]/g, '').trim(),
      usd: String(item.usd || item.priceUSD || '').replace(/[\$\s,]/g, '').trim(),
    }))
    .filter((item) => item.label || item.inr || item.usd);
}

function mergeUniqueList(existing, incoming) {
  const seen = new Set();
  return [...existing, ...incoming].filter((item) => {
    const key = String(item || '').trim();
    if (!key || seen.has(key.toLowerCase())) return false;
    seen.add(key.toLowerCase());
    return true;
  });
}

function renderTagEditor(name, label, value = '', hint = '', placeholder = '') {
  const text = Array.isArray(value) ? value.join('\n') : String(value || '');
  return `
    <div class="field full editor-tag-field" data-tag-field="${escapeHtml(name)}">
      <label for="${escapeHtml(name)}">${escapeHtml(label)}</label>
      <div class="tag-editor-shell">
        <div class="tag-editor-list" data-role="tag-list"></div>
        <div class="tag-editor-row">
          <input class="input tag-editor-input" type="text" data-role="tag-input" placeholder="${escapeHtml(placeholder || `Add ${label.toLowerCase()}`)}" />
          <button type="button" class="btn btn-ghost tag-editor-add" data-role="tag-add">Add</button>
        </div>
        <textarea class="textarea sr-only" name="${escapeHtml(name)}" id="${escapeHtml(name)}" data-role="tag-source">${escapeHtml(text)}</textarea>
      </div>
      ${hint ? `<small class="section-subtitle">${escapeHtml(hint)}</small>` : ''}
    </div>
  `;
}

function renderMediaFallback(label = 'No image selected') {
  return `<div class="preview-fallback">${escapeHtml(label)}</div>`;
}

function resolveAdminMediaUrl(url) {
  let clean = String(url || '').trim();
  if (!clean) return '';
  if (clean.includes('media.jaigram.shop/')) {
    return clean.startsWith('http') ? clean : `https://${clean.replace(/^\/+/, '')}`;
  }
  if (clean.includes('/products/productsgallery/')) {
    clean = clean.replace('/products/productsgallery/', '/productsgallery/');
  }
  if (clean.includes('srv1942099.hstgr.cloud') || clean.includes('hstgr.cloud') || clean.includes('rustfs') || clean.includes('media.linkadda.shop') || clean.includes('r2.cloudflarestorage.com')) {
    let sub = '';
    if (clean.includes('/linkadda-media/')) {
      sub = clean.split('/linkadda-media/')[1];
    } else if (clean.includes('/jaigram-media/')) {
      sub = clean.split('/jaigram-media/')[1];
    } else if (clean.includes('media.linkadda.shop/')) {
      sub = clean.split('media.linkadda.shop/')[1];
    } else {
      const parts = clean.split('/');
      sub = parts.slice(3).join('/');
    }
    sub = (sub || '').replace(/^\/+/, '');
    if (sub && !sub.includes('/') && sub.match(/\.(jpg|jpeg|png|webp|gif|svg|avif|mp4|webm|mov|m4v)$/i)) {
      sub = `products/${sub}`;
    }
    return `https://media.jaigram.shop/${sub}`;
  }
  if (clean.startsWith('http://') || clean.startsWith('https://') || clean.startsWith('data:') || clean.startsWith('blob:')) {
    return clean;
  }
  if (clean.startsWith('/media/')) {
    return `https://media.jaigram.shop/${clean.replace(/^\/media\//, '')}`;
  }
  if (clean.startsWith('products/') || clean.startsWith('productsgallery/') || clean.startsWith('categories/') || clean.startsWith('seller_products/') || clean.startsWith('orders/') || clean.startsWith('logos/')) {
    return `https://media.jaigram.shop/${clean}`;
  }
  if (clean.startsWith('images/') || clean.startsWith('/images/')) {
    return clean.startsWith('/') ? clean : `/${clean}`;
  }
  return `https://media.jaigram.shop/products/${clean.replace(/^\/+/, '')}`;
}

function normalizeProductMedia(record = {}) {
  const rawImage = String(record.image || record.imageUrl || record.thumbnail || record.photo || '').trim();
  const rawImages = (Array.isArray(record.images) ? record.images : normalizeEditorList(record.images || '')).map((u) => String(u || '').trim()).filter(Boolean);
  const rawGallery = (Array.isArray(record.galleryImages) ? record.galleryImages : normalizeEditorList(record.galleryImages || '')).map((u) => String(u || '').trim()).filter(Boolean);
  
  const allImages = [...new Set([rawImage, ...rawImages, ...rawGallery].filter(Boolean))];
  const mainImage = rawImage || allImages[0] || '';
  const galleryImages = allImages.filter((u) => u !== mainImage);

  const rawVideo = String(record.video || '').trim();
  const rawVideos = (Array.isArray(record.videos) ? record.videos : normalizeEditorList(record.videos || '')).map((u) => String(u || '').trim()).filter(Boolean);
  const allVideos = [...new Set([rawVideo, ...rawVideos].filter(Boolean))];
  const mainVideo = rawVideo || allVideos[0] || '';

  const mediaItems = [];
  allImages.forEach((url) => {
    mediaItems.push({
      url,
      type: 'image',
      isMainImage: url === mainImage,
      isMainVideo: false,
    });
  });
  allVideos.forEach((url) => {
    mediaItems.push({
      url,
      type: 'video',
      isMainImage: false,
      isMainVideo: url === mainVideo,
    });
  });

  return {
    mainImage,
    allImages,
    galleryImages,
    mainVideo,
    allVideos,
    mediaItems,
  };
}

function renderMediaStudioCard(item, index) {
  const rawUrl = String(item.url || '').trim();
  if (!rawUrl) return '';
  const resolvedUrl = resolveAdminMediaUrl(rawUrl);
  const isVideo = item.type === 'video' || /\.(mp4|webm|mov|m4v)$/i.test(rawUrl);
  const isMainImg = Boolean(item.isMainImage);
  const isMainVid = Boolean(item.isMainVideo);

  return `
    <div class="media-card-item ${isMainImg || isMainVid ? 'is-main' : ''}" draggable="true" data-media-item data-index="${index}" data-url="${escapeHtml(rawUrl)}" data-type="${isVideo ? 'video' : 'image'}">
      <div class="media-card-badge-row">
        <span class="media-card-badge ${isVideo ? 'type-vid' : 'type-img'}">
          <i data-lucide="${isVideo ? 'video' : 'image'}" style="width:11px;height:11px;"></i> ${isVideo ? 'VIDEO' : 'IMAGE'}
        </span>
        <span class="media-card-index">#${index + 1}</span>
      </div>

      ${isMainImg ? '<span class="media-card-main-tag img-tag"><i data-lucide="star" style="width:11px;height:11px;"></i> Main Cover</span>' : ''}
      ${isMainVid ? '<span class="media-card-main-tag vid-tag"><i data-lucide="play-circle" style="width:11px;height:11px;"></i> Main Video</span>' : ''}

      <div class="media-card-preview-wrap">
        ${isVideo
          ? `<video src="${escapeHtml(resolvedUrl)}" preload="metadata" muted playsinline></video>
             <div class="media-vid-overlay-play"><i data-lucide="play" style="width:18px;height:18px;"></i></div>`
          : `<img src="${escapeHtml(resolvedUrl)}" data-raw-src="${escapeHtml(rawUrl)}" alt="Media ${index + 1}" loading="lazy" onerror="if(!this._failed){this._failed=true; if(this.getAttribute('data-raw-src').startsWith('images/')){this.src='/' + this.getAttribute('data-raw-src');}else{this.src='https://media.jaigram.shop/products/' + this.getAttribute('data-raw-src');}}" />`
        }
      </div>

      <div class="media-card-actions-overlay">
        ${!isVideo && !isMainImg ? `<button type="button" class="media-card-btn btn-make-main" data-role="set-main-image" data-index="${index}"><i data-lucide="star" style="width:11px;height:11px;"></i> Set Cover</button>` : ''}
        ${isVideo && !isMainVid ? `<button type="button" class="media-card-btn btn-make-main" data-role="set-main-video" data-index="${index}"><i data-lucide="play" style="width:11px;height:11px;"></i> Set Video</button>` : ''}

        <div class="media-action-row">
          <button type="button" class="media-card-btn" data-role="media-move-prev" data-index="${index}" title="Move Left / Earlier"><i data-lucide="arrow-left" style="width:12px;height:12px;"></i></button>
          <button type="button" class="media-card-btn" data-role="media-move-next" data-index="${index}" title="Move Right / Later"><i data-lucide="arrow-right" style="width:12px;height:12px;"></i></button>
          <button type="button" class="media-card-btn btn-remove" data-role="media-card-remove" data-index="${index}" title="Delete Media"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>
        </div>
      </div>
    </div>
  `;
}

function renderMediaStudio(record = {}) {
  const { allImages, allVideos, mediaItems, mainImage, mainVideo, galleryImages } = normalizeProductMedia(record);
  const imgCount = allImages.length;
  const vidCount = allVideos.length;
  const totalCount = mediaItems.length;

  return `
    <div class="editor-section media-studio-section">
      <div class="editor-section-head">
        <div>
          <h4><i data-lucide="film" style="color: #06b6d4; width: 18px; height: 18px;"></i> 4. Media Studio (Unlimited Images & Videos)</h4>
          <p>Upload photos & videos or paste direct links. Storefront slideshow automatically previews live.</p>
        </div>
      </div>

      <div class="media-studio">
        <div class="media-studio-header">
          <div class="media-studio-stats">
            <span class="media-stat-chip img-chip" data-role="stat-imgs"><i data-lucide="image" style="width:14px;height:14px;"></i> <strong>${imgCount}</strong> Images</span>
            <span class="media-stat-chip vid-chip" data-role="stat-vids"><i data-lucide="video" style="width:14px;height:14px;"></i> <strong>${vidCount}</strong> Videos</span>
            <span class="media-stat-chip total-chip"><i data-lucide="layers" style="width:14px;height:14px;"></i> <strong>${totalCount}</strong> Total Media</span>
          </div>
          <div class="media-studio-actions">
            <button type="button" class="btn media-btn-upload" data-role="media-upload-trigger"><i data-lucide="upload-cloud"></i> Upload Files (Images/Videos)</button>
            <button type="button" class="btn btn-ghost" data-role="media-url-toggle"><i data-lucide="link"></i> Add via URL</button>
            <input type="file" class="sr-only" accept="image/*,video/*" multiple data-role="media-multi-file-input" />
          </div>
        </div>

        <div class="media-url-adder" data-role="media-url-adder-box">
          <input class="input" type="text" data-role="media-url-input" placeholder="Paste Image URL or Video URL (https://...)" />
          <select class="select media-url-type-select" data-role="media-url-type">
            <option value="auto">Auto-Detect</option>
            <option value="image">Image</option>
            <option value="video">Video</option>
          </select>
          <button type="button" class="btn btn-primary" data-role="media-url-add-btn" style="flex-shrink:0;"><i data-lucide="plus"></i> Add Media</button>
        </div>

        <div class="media-items-grid" data-role="media-studio-grid">
          ${mediaItems.length ? mediaItems.map((item, index) => renderMediaStudioCard(item, index)).join('') : `
            <div class="media-empty-state">
              <i data-lucide="image-plus" style="width:36px;height:36px;color:#a855f7;"></i>
              <strong style="color:var(--text);font-size:1rem;">No media items added yet</strong>
              <p>Click "Upload Files" or "Add via URL" above to add photos & videos for this product.</p>
            </div>
          `}
        </div>

        <!-- Hidden sync inputs -->
        <input type="hidden" name="image" data-role="main-image-source" value="${escapeHtml(mainImage)}" />
        <input type="hidden" name="video" data-role="main-video-source" value="${escapeHtml(mainVideo)}" />
        <textarea class="textarea sr-only" name="galleryImages" data-role="gallery-images-source">${escapeHtml(galleryImages.join('\n'))}</textarea>
        <textarea class="textarea sr-only" name="videos" data-role="videos-source">${escapeHtml(allVideos.join('\n'))}</textarea>
        <textarea class="textarea sr-only" name="images" data-role="all-images-source">${escapeHtml(allImages.join('\n'))}</textarea>
      </div>
    </div>
  `;
}

function renderProductPreview(record = {}, activeIndex = 0) {
  const { allImages, allVideos, mediaItems } = normalizeProductMedia(record);
  const totalSlides = mediaItems.length;
  const safeIdx = totalSlides > 0 ? Math.max(0, Math.min(totalSlides - 1, activeIndex)) : 0;
  
  let mediaHtml = '';
  if (totalSlides === 0) {
    mediaHtml = renderMediaFallback('No media added yet');
  } else if (totalSlides === 1) {
    const single = mediaItems[0];
    const resolved = resolveAdminMediaUrl(single.url);
    const isVid = single.type === 'video' || /\.(mp4|webm|mov|m4v)$/i.test(single.url);
    mediaHtml = `
      <div class="editor-slideshow-wrap">
        <div class="editor-slideshow-slide active">
          ${isVid
            ? `<video src="${escapeHtml(resolved)}" autoplay muted loop playsinline></video>`
            : `<img src="${escapeHtml(resolved)}" alt="${escapeHtml(record.title || 'Preview')}" loading="lazy" />`
          }
        </div>
      </div>
    `;
  } else {
    const slidesHtml = mediaItems.map((m, i) => {
      const resolved = resolveAdminMediaUrl(m.url);
      const isVid = m.type === 'video' || /\.(mp4|webm|mov|m4v)$/i.test(m.url);
      return `
        <div class="editor-slideshow-slide ${i === safeIdx ? 'active' : ''}" data-slide-index="${i}">
          ${isVid
            ? `<video src="${escapeHtml(resolved)}" autoplay muted loop playsinline></video>`
            : `<img src="${escapeHtml(resolved)}" alt="${escapeHtml(record.title || 'Preview')}" loading="lazy" />`
          }
        </div>
      `;
    }).join('');

    const dotsHtml = mediaItems.map((_, i) => `
      <span class="editor-slideshow-dot ${i === safeIdx ? 'active' : ''}" data-slide-dot="${i}"></span>
    `).join('');

    mediaHtml = `
      <div class="editor-slideshow-wrap" data-role="editor-slideshow" data-active-idx="${safeIdx}">
        ${slidesHtml}
        <div class="editor-slideshow-nav">${dotsHtml}</div>
        <button type="button" class="editor-slideshow-arrow prev" data-slide-nav="prev" aria-label="Previous slide">&#8249;</button>
        <button type="button" class="editor-slideshow-arrow next" data-slide-nav="next" aria-label="Next slide">&#8250;</button>
      </div>
    `;
  }

  const tags = [record.badge, record.category, record.status].filter(Boolean);
  return `
    <div class="editor-preview glass product-preview-card" data-role="product-preview">
      <div class="editor-preview-media product-preview-media">
        ${mediaHtml}
      </div>
      <div class="editor-preview-body">
        <div class="editor-preview-badge ${escapeHtml(record.badgeStyle || '')}">${escapeHtml(record.badge || record.category || 'Product')}</div>
        <h3>${escapeHtml(record.title || 'Untitled product')}</h3>
        <p>${escapeHtml(record.description || 'Add details, pricing and media to preview the live product card.')}</p>
        <div class="preview-tags">
          ${tags.map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join('')}
        </div>
        <div class="editor-preview-list">
          <div><span>INR</span><strong>${escapeHtml(record.priceINR ? `₹${record.priceINR.replace(/^[₹\s]+/, '')}` : '-')}</strong></div>
          <div><span>USD</span><strong>${escapeHtml(record.priceUSD ? `$${record.priceUSD.replace(/^[\$\s]+/, '')}` : '-')}</strong></div>
          <div><span>Images</span><strong>${escapeHtml(String(allImages.length))}</strong></div>
          <div><span>Videos</span><strong>${escapeHtml(String(allVideos.length))}</strong></div>
        </div>
        ${(() => {
          const previewTiers = normalizeTierList(record.tiers);
          if (!previewTiers.length) return '';
          return `
            <div class="editor-preview-tiers" style="margin-top: 10px; display: flex; flex-direction: column; gap: 4px;">
              <div style="font-size: 10px; text-transform: uppercase; color: #a5b4fc; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 2px;">
                <i data-lucide="layers" style="width: 11px; height: 11px; display: inline-block; vertical-align: middle;"></i> Pack Options (${previewTiers.length}):
              </div>
              ${previewTiers.map((t, i) => `
                <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.04); border: 1px solid ${i === 0 ? 'rgba(232,67,147,0.5)' : 'rgba(255,255,255,0.08)'}; border-radius: 6px; padding: 4px 8px; font-size: 11px;">
                  <span style="color: #f8fafc; font-weight: 600;">${escapeHtml(t.label || `Option ${i + 1}`)}</span>
                  <span style="color: #ec4899; font-weight: 700;">₹${escapeHtml(t.inr || '0')}${t.usd ? `<span style="color:#94a3b8; font-size:10px; font-weight:500;"> / $${escapeHtml(t.usd)}</span>` : ''}</span>
                </div>
              `).join('')}
            </div>
          `;
        })()}
      </div>
    </div>
  `;
}

function renderTierRow(tier = {}, index = 0, total = 1) {
  return `
    <div class="tier-row glass" data-role="tier-row" data-index="${index}">
      <div class="tier-row-top">
        <div class="tier-num-badge-wrap" style="display: flex; align-items: center; gap: 6px;">
          <span class="tier-num-badge"><i data-lucide="layers"></i> Option #${index + 1}</span>
          ${tier.label ? `<span class="chip subtle" style="font-size: 10px; padding: 1px 7px; color: #c084fc; border-color: rgba(192,132,252,0.3);">${escapeHtml(tier.label)}</span>` : ''}
        </div>
        <div class="tier-row-actions" style="display: flex; align-items: center; gap: 4px;">
          <button type="button" class="btn btn-ghost tier-action-btn" data-role="move-tier-up" data-index="${index}" title="Move Up" ${index === 0 ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>
            <i data-lucide="arrow-up" style="width: 13px; height: 13px;"></i>
          </button>
          <button type="button" class="btn btn-ghost tier-action-btn" data-role="move-tier-down" data-index="${index}" title="Move Down" ${index >= total - 1 ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>
            <i data-lucide="arrow-down" style="width: 13px; height: 13px;"></i>
          </button>
          <button type="button" class="btn btn-ghost tier-action-btn" data-role="duplicate-tier-btn" data-index="${index}" title="Duplicate this option">
            <i data-lucide="copy" style="width: 13px; height: 13px;"></i>
          </button>
          <button type="button" class="btn btn-ghost tier-remove-btn" data-role="remove-tier-btn" data-index="${index}" title="Remove this option">
            <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i> Remove
          </button>
        </div>
      </div>
      <div class="tier-row-fields">
        <div class="field tier-label-box">
          <label style="font-size: 11px; font-weight: 600; color: #a5b4fc; margin-bottom: 3px; display: flex; align-items: center; gap: 4px;">
            <i data-lucide="tag" style="width: 12px; height: 12px;"></i> Option Title / Name *
          </label>
          <input class="input" type="text" data-role="tier-label" placeholder="e.g. 1 TG Group Only" value="${escapeHtml(tier.label || '')}" style="font-size: 13px;" />
        </div>
        <div class="field tier-price-box">
          <label style="font-size: 11px; font-weight: 600; color: #34d399; margin-bottom: 3px; display: flex; align-items: center; gap: 4px;">
            <i data-lucide="indian-rupee" style="width: 12px; height: 12px;"></i> Price INR (₹) *
          </label>
          <input class="input" type="text" data-role="tier-inr" placeholder="150" value="${escapeHtml(tier.inr || '')}" style="font-size: 13px;" />
        </div>
        <div class="field tier-usd-box">
          <label style="font-size: 11px; font-weight: 600; color: #38bdf8; margin-bottom: 3px; display: flex; align-items: center; gap: 4px;">
            <i data-lucide="dollar-sign" style="width: 12px; height: 12px;"></i> Price USD ($)
          </label>
          <input class="input" type="text" data-role="tier-usd" placeholder="9" value="${escapeHtml(tier.usd || '')}" style="font-size: 13px;" />
        </div>
      </div>
    </div>
  `;
}

function renderTierEditor(tiers = []) {
  const list = normalizeTierList(tiers);
  return `
    <div class="editor-section tier-editor-wrapper" data-role="tier-editor-section">
      <div class="editor-section-head" style="flex-wrap: wrap; gap: 10px;">
        <div>
          <h4><i data-lucide="layers" style="color: #a855f7; width: 18px; height: 18px;"></i> 3. Sub-Plans / Group Options (Unlimited)</h4>
          <p>Add separate purchase options (e.g. 1 TG Group @ ₹150 / $9, 4 Groups VIP @ ₹400 / $24). Card me interactive buttons dikhenge.</p>
        </div>
        <div class="tier-header-actions" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <button type="button" class="btn btn-ghost" data-role="add-tier-btn" style="color: #c084fc; border-color: rgba(192, 132, 252, 0.35); font-size: 12px; padding: 7px 14px; display: inline-flex; align-items: center; gap: 5px; font-weight: 700;">
            <i data-lucide="plus"></i> Add Sub-Option
          </button>
          <button type="button" class="btn btn-primary" data-role="quick-save-tiers-btn" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-color: rgba(16, 185, 129, 0.4); font-size: 12px; padding: 7px 14px; display: inline-flex; align-items: center; gap: 5px; font-weight: 700;">
            <i data-lucide="check"></i> Save Sub-Options
          </button>
        </div>
      </div>
      
      <div class="tier-items-list" data-role="tier-items-list" style="margin-top: 10px; display: flex; flex-direction: column; gap: 10px;">
        ${list.length > 0 ? list.map((tier, index) => renderTierRow(tier, index, list.length)).join('') : `
          <div class="tier-empty-placeholder" data-role="tier-empty-state" style="padding: 16px; text-align: center; border: 1px dashed rgba(255,255,255,0.12); border-radius: 12px; color: var(--muted); font-size: 13px; background: rgba(255,255,255,0.015);">
            No sub-options added. If you want to offer separate group or variant options (e.g. 1 Group ₹150), click <strong>"+ Add Sub-Option"</strong> above.
          </div>
        `}
      </div>
    </div>
  `;
}

function refreshTierRowIndices(container) {
  if (!container) return;
  const list = container.querySelector('[data-role="tier-items-list"]');
  if (!list) return;
  const rows = [...list.querySelectorAll('[data-role="tier-row"]')];
  if (!rows.length) {
    if (!list.querySelector('[data-role="tier-empty-state"]')) {
      list.innerHTML = `
        <div class="tier-empty-placeholder" data-role="tier-empty-state" style="padding: 16px; text-align: center; border: 1px dashed rgba(255,255,255,0.12); border-radius: 12px; color: var(--muted); font-size: 13px; background: rgba(255,255,255,0.015);">
          No sub-options added. If you want to offer separate group or variant options (e.g. 1 Group ₹150), click <strong>"+ Add Sub-Option"</strong> above.
        </div>
      `;
    }
  } else {
    const emptyState = list.querySelector('[data-role="tier-empty-state"]');
    if (emptyState) emptyState.remove();

    rows.forEach((row, idx) => {
      row.dataset.index = idx;
      const badge = row.querySelector('.tier-num-badge');
      if (badge) badge.innerHTML = `<i data-lucide="layers"></i> Option #${idx + 1}`;
      
      const upBtn = row.querySelector('[data-role="move-tier-up"]');
      const downBtn = row.querySelector('[data-role="move-tier-down"]');
      if (upBtn) {
        upBtn.dataset.index = idx;
        upBtn.disabled = idx === 0;
        upBtn.style.opacity = idx === 0 ? '0.3' : '1';
        upBtn.style.cursor = idx === 0 ? 'not-allowed' : 'pointer';
      }
      if (downBtn) {
        downBtn.dataset.index = idx;
        downBtn.disabled = idx === rows.length - 1;
        downBtn.style.opacity = idx === rows.length - 1 ? '0.3' : '1';
        downBtn.style.cursor = idx === rows.length - 1 ? 'not-allowed' : 'pointer';
      }
      const dupBtn = row.querySelector('[data-role="duplicate-tier-btn"]');
      if (dupBtn) dupBtn.dataset.index = idx;
      const removeBtn = row.querySelector('[data-role="remove-tier-btn"]');
      if (removeBtn) removeBtn.dataset.index = idx;
    });
  }
  if (window.lucide) lucide.createIcons();
}

function renderProductEditor(record = {}, schema = null) {
  const { allImages, allVideos, mainImage, mainVideo, galleryImages } = normalizeProductMedia(record);

  const data = {
    ...record,
    image: mainImage,
    images: allImages,
    galleryImages,
    video: mainVideo,
    videos: allVideos,
    creators: normalizeEditorList(record.creators || []),
    platforms: normalizeEditorList(record.platforms || []),
    features: normalizeEditorList(record.features || []),
    tiers: normalizeTierList(record.tiers || []),
    showTrustAssurance: record.showTrustAssurance !== false,
    trustTitle: record.trustTitle || 'Trust & Discrete Billing Assurance',
    trustPoint1Title: record.trustPoint1Title || '100% Discrete Billing',
    trustPoint1Desc: record.trustPoint1Desc || 'Your bank statement or UPI app will show a neutral business descriptor. Zero adult keywords or references. 100% anonymous.',
    trustPoint2Title: record.trustPoint2Title || 'Instant Cloud Access',
    trustPoint2Desc: record.trustPoint2Desc || 'Direct high-speed Mega.nz & Google Drive cloud folders delivered on-screen and via Telegram bot instantly.',
    trustPoint3Title: record.trustPoint3Title || 'Lifetime Link Replacement',
    trustPoint3Desc: record.trustPoint3Desc || 'If any cloud folder ever gets expired or blocked, our 24/7 VIP helpdesk refreshes your link free forever.',
    trustPoint4Title: record.trustPoint4Title || '',
    trustPoint4Desc: record.trustPoint4Desc || '',
    showSpecsTable: record.showSpecsTable !== false,
    specsTitle: record.specsTitle || 'Pack Specifications',
    specResolution: record.specResolution || '4K 2160p Ultra HD (60 FPS HDR)',
    specAudio: record.specAudio || 'Original Studio Stereo Clear Audio',
    specDelivery: record.specDelivery || 'Mega.nz & Google Drive Direct Fast Links',
    specDevices: record.specDevices || 'Android, iPhone (iOS), Windows PC, Mac, Smart TV',
    specAccess: record.specAccess || 'Lifetime Access + Free Link Replacement',
    specSupport: record.specSupport || '24/7 Instant Telegram VIP Helpdesk',
    specMediaCount: record.specMediaCount || '',
  };
  const categories = getCategoryOptions();
  const currentCategory = String(data.category || '').trim();
  const currentBadgeStyle = String(data.badgeStyle || '').trim();
  const categoryOptions = [...categories];
  if (currentCategory && !categoryOptions.some((item) => String(item.value) === currentCategory)) {
    categoryOptions.unshift({ value: currentCategory, label: currentCategory });
  }
  const badgeStyles = [...PRODUCT_BADGE_STYLE_OPTIONS];
  if (currentBadgeStyle && !badgeStyles.some((item) => item.value === currentBadgeStyle)) {
    badgeStyles.unshift({ value: currentBadgeStyle, label: currentBadgeStyle });
  }

  const isEdit = Boolean(data.id);

  return `
    <form id="recordForm" class="product-editor-form" data-node="products" data-id="${escapeHtml(data.id || '')}">
      <div class="product-editor-shell">
        
        <!-- Left Column: Live Card Preview & Slideshow -->
        <aside class="product-editor-preview-column">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #818cf8; letter-spacing: 0.06em; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
            <i data-lucide="eye" style="width: 14px; height: 14px;"></i> Live Storefront Preview
          </div>
          ${renderProductPreview(data, 0)}
          <div class="editor-help glass" style="margin-top: 14px; padding: 14px 16px; border-radius: 12px; border: 1px solid rgba(99, 102, 241, 0.2); background: rgba(99, 102, 241, 0.05);">
            <strong style="font-size: 12.5px; color: #a5b4fc; display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
              <i data-lucide="sparkles" style="width: 14px; height: 14px;"></i> Live Sync Tip
            </strong>
            <p style="font-size: 12px; color: var(--muted); margin: 0; line-height: 1.4;">This card updates in real time as you add media and change product details.</p>
          </div>
        </aside>

        <!-- Right Column: Step-by-Step Sections -->
        <section class="product-editor-main">
          
          <!-- Section 1: Basic Identity -->
          <div class="editor-section">
            <div class="editor-section-head">
              <div>
                <h4><i data-lucide="package" style="color: #818cf8; width: 18px; height: 18px;"></i> 1. Basic Identity & Category</h4>
                <p>Product name, category, and storefront highlight tags.</p>
              </div>
            </div>
            
            <div class="field full" style="margin-bottom: 14px;">
              <label for="title" style="font-weight: 700;">Product Title *</label>
              <input class="input" type="text" name="title" id="title" value="${escapeHtml(data.title || '')}" placeholder="e.g. Spx Pack #2 (400+ Videos)" required style="font-size: 14px; font-weight: 600;" />
              <small class="field-hint">Main title displayed on storefront cards and search results.</small>
            </div>

            <div class="product-grid-2">
              <div class="field">
                <label for="category">Category</label>
                <select class="select" name="category" id="category">
                  <option value="">Uncategorized (All Products)</option>
                  ${categoryOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === currentCategory ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
                </select>
                <small class="field-hint">The collection and filter category where this product appears.</small>
              </div>

              <div class="field">
                <label for="slug">URL Slug</label>
                <input class="input" type="text" name="slug" id="slug" value="${escapeHtml(data.slug || '')}" placeholder="e.g. spx-pack-2" />
                <small class="field-hint">Clean URL slug (auto-generated from title if left empty).</small>
              </div>

              <div class="field">
                <label for="badge">Highlight Badge Text</label>
                <input class="input" type="text" name="badge" id="badge" value="${escapeHtml(data.badge || '')}" placeholder="e.g. 4K QUALITY, HOT, TOP RATED" />
                <small class="field-hint">Glowing badge displayed on the top corner of the product card.</small>
              </div>

              <div class="field">
                <label for="badgeStyle">Badge Color</label>
                <select class="select" name="badgeStyle" id="badgeStyle">
                  ${badgeStyles.map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === currentBadgeStyle ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
                </select>
                <small class="field-hint">Choose badge color (Red, White, Gold, or Frosted Glass).</small>
              </div>
            </div>

            <div class="product-grid-2" style="margin-top: 14px;">
              <div class="field">
                <label for="sellerName" style="font-weight: 700;">Seller / Studio Name</label>
                <input class="input" type="text" name="sellerName" id="sellerName" value="${escapeHtml(data.sellerName || 'LinkAdda Official')}" placeholder="e.g. LinkAdda Official" />
                <small class="field-hint">Displays as 'Sold by [Store Name] 🛡️ Verified' on product card & details drawer.</small>
              </div>

              <div class="field">
                <label for="rating">Star Rating (1.0 to 5.0)</label>
                <input class="input" type="text" name="rating" id="rating" value="${escapeHtml(data.rating || '4.9')}" placeholder="e.g. 4.9" />
                <small class="field-hint">Displays on LinkAdda rating pill.</small>
              </div>

              <div class="field">
                <label for="reviewsCount">Reviews / Buyers Count Tag</label>
                <input class="input" type="text" name="reviewsCount" id="reviewsCount" value="${escapeHtml(data.reviewsCount || '')}" placeholder="e.g. 1,420 buyers" />
                <small class="field-hint">Custom text shown next to star rating (leave empty for auto-count).</small>
              </div>
            </div>

            <div class="field full" style="margin-top: 14px;">
              <label for="description">Full Description</label>
              <textarea class="textarea" name="description" id="description" rows="3" placeholder="Describe content, quality, updates, and specifications...">${escapeHtml(data.description || '')}</textarea>
              <small class="field-hint">Product features and details shown in card preview and customer modal.</small>
            </div>
          </div>

          <!-- Section 2: Pricing & Action Link -->
          <div class="editor-section">
            <div class="editor-section-head">
              <div>
                <h4><i data-lucide="badge-dollar-sign" style="color: #34d399; width: 18px; height: 18px;"></i> 2. Pricing & Instant Order Link</h4>
                <p>Commercial prices, original MRP for LinkAdda discount % and checkout links.</p>
              </div>
            </div>
            
            <div class="product-grid-2">
              <div class="field">
                <label for="priceINR" style="font-weight: 700;">Selling Price INR (₹)</label>
                <input class="input" type="text" name="priceINR" id="priceINR" value="${escapeHtml(data.priceINR || '')}" placeholder="e.g. 299" />
                <small class="field-hint">Price for Indian customers (₹ currency symbol is added automatically).</small>
              </div>

              <div class="field">
                <label for="originalPriceINR">Original MRP (₹ Cut Price)</label>
                <input class="input" type="text" name="originalPriceINR" id="originalPriceINR" value="${escapeHtml(data.originalPriceINR || '')}" placeholder="e.g. 1499" />
                <small class="field-hint">Displays as strike-through ~₹1,499~ with auto discount % on product card.</small>
              </div>

              <div class="field">
                <label for="priceUSD" style="font-weight: 700;">Selling Price USD ($)</label>
                <input class="input" type="text" name="priceUSD" id="priceUSD" value="${escapeHtml(data.priceUSD || '')}" placeholder="e.g. 14" />
                <small class="field-hint">Price for international buyers in US dollars ($).</small>
              </div>

              <div class="field">
                <label for="originalPriceUSD">Original MRP ($ Cut Price)</label>
                <input class="input" type="text" name="originalPriceUSD" id="originalPriceUSD" value="${escapeHtml(data.originalPriceUSD || '')}" placeholder="e.g. 45" />
                <small class="field-hint">Displays as strike-through ~$45~ for international buyers.</small>
              </div>

              <div class="field">
                <label for="orderLink">Order / Telegram Link</label>
                <input class="input" type="text" name="orderLink" id="orderLink" value="${escapeHtml(data.orderLink || '')}" placeholder="https://t.me/... or /payment.html" />
                <small class="field-hint">Direct checkout destination when customer clicks Buy Now.</small>
              </div>

              <div class="field">
                <label for="displayOrder">Display Ranking Order (#)</label>
                <input class="input" type="number" name="displayOrder" id="displayOrder" value="${escapeHtml(String(data.displayOrder ?? 0))}" placeholder="0" />
                <small class="field-hint">Catalog sorting order (1 = appears first at the top).</small>
              </div>
            </div>
          </div>

          <!-- Section 3: Sub-Plans / Group Options (Tiers) -->
          ${renderTierEditor(data.tiers)}

          <!-- Section 4: Unlimited Media Studio -->
          ${renderMediaStudio(data)}

          <!-- Section 5: Features & Tags -->
          <div class="editor-section">
            <div class="editor-section-head">
              <div>
                <h4><i data-lucide="tags" style="color: #ec4899; width: 18px; height: 18px;"></i> 4. Features & Content Tags</h4>
                <p>Bullet chips shown on cards (e.g. 400+ Videos, Mega, Direct Link).</p>
              </div>
            </div>
            ${renderTagEditor('features', 'Key Features / Highlights', data.features, 'Enter feature tag and press Enter (e.g. 400+ Videos, 24*7 Updates).', 'Add Feature Tag')}
            ${renderTagEditor('platforms', 'Storage Platforms', data.platforms, 'Content platform (e.g. Mega, Telegram, Google Drive).', 'Add Platform')}
            ${renderTagEditor('creators', 'Creators / Models', data.creators, 'Creator or model tags.', 'Add Creator')}
          </div>

          <!-- Section 5: Trust Guarantees & Buyer Assurance -->
          <div class="editor-section">
            <div class="editor-section-head">
              <div>
                <h4><i data-lucide="shield-check" style="color: #10b981; width: 18px; height: 18px;"></i> 5. Trust Guarantees & Buyer Assurance</h4>
                <p>Customize the discrete billing and delivery guarantees shown in customer product modal.</p>
              </div>
            </div>
            
            <div class="field full" style="margin-bottom: 12px;">
              <label style="display: flex; align-items: center; gap: 8px; font-weight: 700; cursor: pointer;">
                <input type="checkbox" name="showTrustAssurance" value="true" ${data.showTrustAssurance ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #10b981;" />
                Show Trust & Discrete Billing Assurance Block on Product Page
              </label>
            </div>

            <div class="field full" style="margin-bottom: 14px;">
              <label for="trustTitle">Section Heading</label>
              <input class="input" type="text" name="trustTitle" id="trustTitle" value="${escapeHtml(data.trustTitle)}" placeholder="Trust & Discrete Billing Assurance" />
            </div>

            <!-- Guarantee Point 1 -->
            <div class="glass" style="padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border); margin-bottom: 10px; background: rgba(16, 185, 129, 0.03);">
              <div class="field" style="margin-bottom: 6px;">
                <label style="font-weight: 700; color: #34d399; font-size: 12px;">🛡️ Guarantee Point 1 Title</label>
                <input class="input" type="text" name="trustPoint1Title" value="${escapeHtml(data.trustPoint1Title)}" placeholder="e.g. 100% Discrete Billing" style="font-size: 13px;" />
              </div>
              <div class="field full">
                <label style="font-size: 12px;">Point 1 Explanation</label>
                <textarea class="textarea" name="trustPoint1Desc" rows="2" placeholder="Your bank statement or UPI app will show a neutral business descriptor..." style="font-size: 12.5px;">${escapeHtml(data.trustPoint1Desc)}</textarea>
              </div>
            </div>

            <!-- Guarantee Point 2 -->
            <div class="glass" style="padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border); margin-bottom: 10px; background: rgba(59, 130, 246, 0.03);">
              <div class="field" style="margin-bottom: 6px;">
                <label style="font-weight: 700; color: #60a5fa; font-size: 12px;">⚡ Guarantee Point 2 Title</label>
                <input class="input" type="text" name="trustPoint2Title" value="${escapeHtml(data.trustPoint2Title)}" placeholder="e.g. Instant Cloud Access" style="font-size: 13px;" />
              </div>
              <div class="field full">
                <label style="font-size: 12px;">Point 2 Explanation</label>
                <textarea class="textarea" name="trustPoint2Desc" rows="2" placeholder="Direct high-speed Mega.nz & Google Drive cloud folders delivered on-screen..." style="font-size: 12.5px;">${escapeHtml(data.trustPoint2Desc)}</textarea>
              </div>
            </div>

            <!-- Guarantee Point 3 -->
            <div class="glass" style="padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border); margin-bottom: 10px; background: rgba(245, 158, 11, 0.03);">
              <div class="field" style="margin-bottom: 6px;">
                <label style="font-weight: 700; color: #fbbf24; font-size: 12px;">🔄 Guarantee Point 3 Title</label>
                <input class="input" type="text" name="trustPoint3Title" value="${escapeHtml(data.trustPoint3Title)}" placeholder="e.g. Lifetime Link Replacement" style="font-size: 13px;" />
              </div>
              <div class="field full">
                <label style="font-size: 12px;">Point 3 Explanation</label>
                <textarea class="textarea" name="trustPoint3Desc" rows="2" placeholder="If any cloud folder ever gets expired or blocked, our 24/7 VIP helpdesk refreshes your link free forever..." style="font-size: 12.5px;">${escapeHtml(data.trustPoint3Desc)}</textarea>
              </div>
            </div>

            <!-- Guarantee Point 4 (Optional) -->
            <div class="glass" style="padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border); background: rgba(168, 85, 247, 0.03);">
              <div class="field" style="margin-bottom: 6px;">
                <label style="font-weight: 700; color: #c084fc; font-size: 12px;">💬 Guarantee Point 4 Title (Optional)</label>
                <input class="input" type="text" name="trustPoint4Title" value="${escapeHtml(data.trustPoint4Title)}" placeholder="e.g. 24/7 VIP Telegram Support" style="font-size: 13px;" />
              </div>
              <div class="field full">
                <label style="font-size: 12px;">Point 4 Explanation</label>
                <textarea class="textarea" name="trustPoint4Desc" rows="2" placeholder="Leave empty if not needed..." style="font-size: 12.5px;">${escapeHtml(data.trustPoint4Desc)}</textarea>
              </div>
            </div>
          </div>

          <!-- Section 6: Pack Specifications & Technical Attributes -->
          <div class="editor-section">
            <div class="editor-section-head">
              <div>
                <h4><i data-lucide="list-check" style="color: #ec4899; width: 18px; height: 18px;"></i> 6. Pack Specifications & Quality Attributes</h4>
                <p>Customize the technical attributes shown in the Pack Specifications table.</p>
              </div>
            </div>

            <div class="field full" style="margin-bottom: 12px;">
              <label style="display: flex; align-items: center; gap: 8px; font-weight: 700; cursor: pointer;">
                <input type="checkbox" name="showSpecsTable" value="true" ${data.showSpecsTable ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #ec4899;" />
                Show Pack Specifications Table on Product Page
              </label>
            </div>

            <div class="field full" style="margin-bottom: 14px;">
              <label for="specsTitle">Table Heading</label>
              <input class="input" type="text" name="specsTitle" id="specsTitle" value="${escapeHtml(data.specsTitle)}" placeholder="Pack Specifications" />
            </div>

            <div class="product-grid-2">
              <div class="field">
                <label for="specResolution">Video Resolution / Quality</label>
                <input class="input" type="text" name="specResolution" id="specResolution" value="${escapeHtml(data.specResolution)}" placeholder="e.g. 4K 2160p Ultra HD (60 FPS HDR)" />
                <small class="field-hint">e.g. 4K Ultra HD, 1080p Full HD</small>
              </div>

              <div class="field">
                <label for="specAudio">Audio Quality</label>
                <input class="input" type="text" name="specAudio" id="specAudio" value="${escapeHtml(data.specAudio)}" placeholder="e.g. Original Studio Stereo Clear Audio" />
                <small class="field-hint">e.g. Studio Stereo, Clean Audio</small>
              </div>

              <div class="field">
                <label for="specDelivery">Cloud Delivery Method</label>
                <input class="input" type="text" name="specDelivery" id="specDelivery" value="${escapeHtml(data.specDelivery)}" placeholder="e.g. Mega.nz & Google Drive Direct Fast Links" />
                <small class="field-hint">e.g. Mega.nz, Google Drive, Terabox</small>
              </div>

              <div class="field">
                <label for="specDevices">Supported Devices</label>
                <input class="input" type="text" name="specDevices" id="specDevices" value="${escapeHtml(data.specDevices)}" placeholder="e.g. Android, iPhone (iOS), Windows PC, Mac, Smart TV" />
                <small class="field-hint">Playback compatibility list</small>
              </div>

              <div class="field">
                <label for="specAccess">Access Guarantee</label>
                <input class="input" type="text" name="specAccess" id="specAccess" value="${escapeHtml(data.specAccess)}" placeholder="e.g. Lifetime Access + Free Link Replacement" />
                <small class="field-hint">Access duration and replacement warranty</small>
              </div>

              <div class="field">
                <label for="specSupport">VIP Customer Support</label>
                <input class="input" type="text" name="specSupport" id="specSupport" value="${escapeHtml(data.specSupport)}" placeholder="e.g. 24/7 Instant Telegram VIP Helpdesk" />
                <small class="field-hint">Helpdesk channel for buyers</small>
              </div>

              <div class="field full">
                <label for="specMediaCount">Available Media / Pack Size (Optional Override)</label>
                <input class="input" type="text" name="specMediaCount" id="specMediaCount" value="${escapeHtml(data.specMediaCount)}" placeholder="e.g. 1,149 Direct Videos · 45 GB (Leave empty for auto-count)" />
                <small class="field-hint">Custom media count shown in specs row (e.g. 1,100+ Videos or 35 GB).</small>
              </div>
            </div>
          </div>

          <!-- Section 7: Publishing & Status -->
          <div class="editor-section">
            <div class="editor-section-head">
              <div>
                <h4><i data-lucide="shield-check" style="color: #fbbf24; width: 18px; height: 18px;"></i> 7. Publishing Status</h4>
                <p>Live visibility control for website.</p>
              </div>
            </div>
            <div class="product-grid-2">
              <div class="field">
                <label for="status">Status</label>
                <select class="select" name="status" id="status" style="font-weight: 700;">
                  <option value="active" ${String(data.status || 'active') === 'active' ? 'selected' : ''}>🟢 Active (Live on Store)</option>
                  <option value="hidden" ${String(data.status || 'active') === 'hidden' ? 'selected' : ''}>🟡 Hidden (Temporarily Disabled)</option>
                  <option value="draft" ${String(data.status || 'active') === 'draft' ? 'selected' : ''}>⚪ Draft (In-Progress)</option>
                </select>
                <small class="field-hint">When active, this product will be immediately visible on the live store.</small>
              </div>
              <div class="field">
                <label>Realtime Sync Status</label>
                <div style="padding: 10px 14px; border-radius: 10px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.25); color: #34d399; font-size: 12.5px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                  <i data-lucide="check-circle-2" style="width: 16px; height: 16px;"></i> Firebase Realtime Sync Enabled
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- Bottom Actions (Natural non-sticky flow) -->
      <div class="editor-bottom-actions">
        <div class="editor-upload-state" data-role="upload-state">
          <i data-lucide="info" style="width:14px;height:14px;"></i> Ready to save changes.
        </div>
        <div class="editor-action-buttons">
          <button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>
          <button type="submit" class="btn btn-primary btn-save-main" data-role="save-product">
            <i data-lucide="check"></i> ${isEdit ? 'Update Product' : 'Create Product'}
          </button>
        </div>
      </div>
    </form>
  `;
}

function renderCategoryPreviewBody(record = {}) {
  const image = String(record.image || '').trim();
  const productCount = countProductsForCategory(record);
  return `
    <div class="category-editor-media" data-role="category-image-preview">
      ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(record.title || 'Category image')}" loading="lazy" />` : renderMediaFallback('Optional image')}
    </div>
    <div class="category-editor-body">
      <div class="editor-preview-badge">Category</div>
      <h3>${escapeHtml(record.title || 'Untitled category')}</h3>
      <p>${escapeHtml(record.description || 'Categories group multiple products together. Keep this compact and clean.')}</p>
      <div class="preview-tags">
        <span class="badge">${escapeHtml(String(productCount))} products</span>
        <span class="badge">${escapeHtml(String(record.status || 'active'))}</span>
      </div>
    </div>
  `;
}

function renderCategoryPreview(record = {}) {
  return `
    <div class="category-editor-preview glass" data-role="category-preview">
      ${renderCategoryPreviewBody(record)}
    </div>
  `;
}

function renderCategoryEditor(record = {}, schema = null) {
  const data = {
    ...record,
    image: record.image || record.imageUrl || record.thumbnail || record.photo || (Array.isArray(record.images) ? record.images[0] : '') || '',
  };
  const productCount = countProductsForCategory(data);
  return `
    <form id="recordForm" class="category-editor-modal" data-node="categories" data-id="${escapeHtml(data.id || '')}">
      <div class="category-editor-shell">
        <aside class="category-editor-preview-column">
          ${renderCategoryPreview(data)}
          <div class="editor-help glass">
            <strong>Optional image</strong>
            <p>Use a category image only if it helps the collection feel recognizable. Leave it empty if you don't need one.</p>
          </div>
        </aside>
        <section class="category-editor-main">
          <div class="editor-section">
            <div class="editor-section-head">
              <div>
                <h4>Category Details</h4>
                <p>Keep this focused on the grouping itself, not product fields.</p>
              </div>
              <div class="category-editor-count">
                <span>Products</span>
                <strong>${escapeHtml(String(productCount))}</strong>
              </div>
            </div>
            <div class="category-image-row">
              <div class="field full">
                <label for="image">Category Image URL</label>
                <input class="input" type="text" name="image" id="image" value="${escapeHtml(data.image || '')}" placeholder="https://..." data-role="category-image-url" />
                <small class="section-subtitle">Optional. Keep the URL as a secondary field. Use upload for new images.</small>
              </div>
              <div class="toolbar category-image-actions">
                <button type="button" class="btn btn-ghost" data-role="category-image-replace">Replace Image</button>
                <button type="button" class="btn btn-ghost" data-role="category-image-remove">Remove Image</button>
                <input type="file" class="sr-only" accept="image/*" name="imageFile" data-role="category-image-file" />
              </div>
            </div>
            <div class="product-grid-2 category-grid">
              <div class="field">
                <label for="title">Category Name</label>
                <input class="input" type="text" name="title" id="title" value="${escapeHtml(data.title || '')}" placeholder="English Pack" />
              </div>
              <div class="field">
                <label for="slug">Slug</label>
                <input class="input" type="text" name="slug" id="slug" value="${escapeHtml(data.slug || '')}" placeholder="english-pack" />
              </div>
              <div class="field full">
                <label for="description">Description</label>
                <textarea class="textarea" name="description" id="description" placeholder="Short category description">${escapeHtml(data.description || '')}</textarea>
              </div>
              <div class="field">
                <label for="status">Status</label>
                <select class="select" name="status" id="status">
                  ${['active', 'hidden', 'draft', 'deleted'].map((status) => `<option value="${status}" ${String(data.status || 'active') === status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label for="displayOrder">Display Order</label>
                <input class="input" type="number" name="displayOrder" id="displayOrder" value="${escapeHtml(String(data.displayOrder ?? 0))}" placeholder="0" />
              </div>
            </div>
          </div>
        </section>
      </div>
      <div class="editor-footer glass">
        <div class="editor-upload-state" data-role="category-upload-state">Ready.</div>
        <div class="toolbar editor-footer-actions">
          <button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>
          <button type="submit" class="btn btn-primary">Save Category</button>
        </div>
      </div>
    </form>
  `;
}

function attachCategoryEditorBehaviors(form) {
  const stateEl = form.querySelector('[data-role="category-upload-state"]');
  const saveBtn = form.querySelector('[type="submit"]');
  const previewCard = form.querySelector('[data-role="category-preview"]');
  const imageUrlInput = form.querySelector('[data-role="category-image-url"]');
  const imageFileInput = form.querySelector('[data-role="category-image-file"]');
  const replaceBtn = form.querySelector('[data-role="category-image-replace"]');
  const removeBtn = form.querySelector('[data-role="category-image-remove"]');

  const getState = () => ({
    title: String(form.querySelector('[name="title"]')?.value || '').trim(),
    slug: String(form.querySelector('[name="slug"]')?.value || '').trim(),
    description: String(form.querySelector('[name="description"]')?.value || '').trim(),
    image: String(form.querySelector('[name="image"]')?.value || '').trim(),
    status: String(form.querySelector('[name="status"]')?.value || 'active').trim(),
    displayOrder: Number(form.querySelector('[name="displayOrder"]')?.value || 0),
  });

  const refreshPreview = () => {
    if (!previewCard) return;
    const current = {
      ...getState(),
      image: String(imageUrlInput?.value || '').trim(),
    };
    previewCard.innerHTML = renderCategoryPreviewBody(current);
    if (window.lucide) lucide.createIcons();
  };

  const setBusy = (busy, message = '') => {
    if (saveBtn) saveBtn.disabled = busy;
    if (stateEl && message) stateEl.textContent = message;
  };

  form.addEventListener('input', (event) => {
    if (event.target.name === 'title') {
      const slugInput = form.querySelector('[name="slug"]');
      if (slugInput) {
        slugInput.value = slugify(event.target.value);
      }
    }
    if (event.target === imageUrlInput || event.target.matches('[name="title"],[name="slug"],[name="description"],[name="status"],[name="displayOrder"]')) {
      refreshPreview();
    }
  });

  form.addEventListener('change', (event) => {
    if (event.target !== imageFileInput || !event.target.files?.[0]) return;
    const file = event.target.files[0];
    (async () => {
      try {
        setBusy(true, `Uploading ${file.name}...`);
        const url = await uploadEditorFile(file, mediaFolderForNode('categories', 'image'), stateEl, 'category-editor');
        if (imageUrlInput) imageUrlInput.value = url;
        imageFileInput.value = '';
        refreshPreview();
        if (stateEl) stateEl.textContent = `Uploaded ${file.name}`;
      } catch (error) {
        stateEl.textContent = error?.message || 'Image upload failed';
        showToast(error?.message || 'Image upload failed', 'danger');
      } finally {
        setBusy(false);
      }
    })();
  });

  form.addEventListener('click', (event) => {
    const pick = event.target.closest('[data-role="category-image-replace"]');
    if (pick) {
      imageFileInput?.click();
      return;
    }
    const remove = event.target.closest('[data-role="category-image-remove"]');
    if (remove) {
      if (imageUrlInput) imageUrlInput.value = '';
      if (imageFileInput) imageFileInput.value = '';
      refreshPreview();
      if (stateEl) stateEl.textContent = 'Category image cleared.';
    }
  });

  refreshPreview();
}

function syncTagEditor(form, name) {
  const field = form.querySelector(`[data-tag-field="${name}"]`);
  if (!field) return [];
  const source = field.querySelector('[data-role="tag-source"]');
  const items = normalizeEditorList(source?.value || '');
  const list = field.querySelector('[data-role="tag-list"]');
  if (list) {
    list.innerHTML = items.length ? items.map((item, index) => `
      <span class="tag-chip" data-tag-value="${escapeHtml(item)}">
        <span>${escapeHtml(item)}</span>
        <button type="button" class="tag-remove" data-role="tag-remove" data-name="${escapeHtml(name)}" data-index="${index}" aria-label="Remove ${escapeHtml(item)}">×</button>
      </span>
    `).join('') : '<div class="tag-empty">No items yet.</div>';
  }
  return items;
}

function getProductEditorRecord(form) {
  const items = form.__mediaStudioItems || [];
  let mainImage = items.find((i) => i.isMainImage)?.url || items.find((i) => i.type === 'image')?.url || form.querySelector('[name="image"]')?.value?.trim() || '';
  let allImages = items.filter((i) => i.type === 'image').map((i) => i.url);
  let galleryImages = allImages.filter((u) => u !== mainImage);

  if (!allImages.length) {
    const rawImg = form.querySelector('[name="image"]')?.value?.trim() || '';
    const rawGal = normalizeEditorList(form.querySelector('[name="galleryImages"]')?.value || '');
    allImages = [...new Set([rawImg, ...rawGal].filter(Boolean))];
    if (!mainImage && allImages.length) mainImage = allImages[0];
    galleryImages = allImages.filter((u) => u !== mainImage);
  }
  
  const mainVideo = items.find((i) => i.isMainVideo)?.url || items.find((i) => i.type === 'video')?.url || form.querySelector('[name="video"]')?.value || '';
  const allVideos = items.filter((i) => i.type === 'video').map((i) => i.url);

  const creators = syncTagEditor(form, 'creators');
  const platforms = syncTagEditor(form, 'platforms');
  const features = syncTagEditor(form, 'features');

  // Extract tiers / sub-plans
  const tierRows = [...form.querySelectorAll('[data-role="tier-row"]')];
  const tiers = tierRows.map((row) => {
    const label = String(row.querySelector('[data-role="tier-label"]')?.value || '').trim();
    const inr = String(row.querySelector('[data-role="tier-inr"]')?.value || '').replace(/[₹\s,]/g, '').trim();
    const usd = String(row.querySelector('[data-role="tier-usd"]')?.value || '').replace(/[\$\s,]/g, '').trim();
    return { label, inr, usd };
  }).filter((t) => t.label || t.inr || t.usd);

  return {
    title: form.querySelector('[name="title"]')?.value || '',
    slug: form.querySelector('[name="slug"]')?.value || '',
    category: form.querySelector('[name="category"]')?.value || '',
    description: form.querySelector('[name="description"]')?.value || '',
    sellerName: form.querySelector('[name="sellerName"]')?.value || '',
    rating: form.querySelector('[name="rating"]')?.value || '',
    reviewsCount: form.querySelector('[name="reviewsCount"]')?.value || '',
    priceINR: form.querySelector('[name="priceINR"]')?.value || '',
    originalPriceINR: form.querySelector('[name="originalPriceINR"]')?.value || '',
    priceUSD: form.querySelector('[name="priceUSD"]')?.value || '',
    originalPriceUSD: form.querySelector('[name="originalPriceUSD"]')?.value || '',
    badge: form.querySelector('[name="badge"]')?.value || '',
    badgeStyle: form.querySelector('[name="badgeStyle"]')?.value || '',
    badgeIcon: form.querySelector('[name="badgeIcon"]')?.value || '',
    image: mainImage,
    images: allImages.length ? allImages : (mainImage ? [mainImage] : []),
    galleryImages,
    video: mainVideo,
    videos: allVideos.length ? allVideos : (mainVideo ? [mainVideo] : []),
    creators,
    platforms,
    features,
    tiers,
    showTrustAssurance: form.querySelector('[name="showTrustAssurance"]')?.checked ?? true,
    trustTitle: form.querySelector('[name="trustTitle"]')?.value || '',
    trustPoint1Title: form.querySelector('[name="trustPoint1Title"]')?.value || '',
    trustPoint1Desc: form.querySelector('[name="trustPoint1Desc"]')?.value || '',
    trustPoint2Title: form.querySelector('[name="trustPoint2Title"]')?.value || '',
    trustPoint2Desc: form.querySelector('[name="trustPoint2Desc"]')?.value || '',
    trustPoint3Title: form.querySelector('[name="trustPoint3Title"]')?.value || '',
    trustPoint3Desc: form.querySelector('[name="trustPoint3Desc"]')?.value || '',
    trustPoint4Title: form.querySelector('[name="trustPoint4Title"]')?.value || '',
    trustPoint4Desc: form.querySelector('[name="trustPoint4Desc"]')?.value || '',
    showSpecsTable: form.querySelector('[name="showSpecsTable"]')?.checked ?? true,
    specsTitle: form.querySelector('[name="specsTitle"]')?.value || '',
    specResolution: form.querySelector('[name="specResolution"]')?.value || '',
    specAudio: form.querySelector('[name="specAudio"]')?.value || '',
    specDelivery: form.querySelector('[name="specDelivery"]')?.value || '',
    specDevices: form.querySelector('[name="specDevices"]')?.value || '',
    specAccess: form.querySelector('[name="specAccess"]')?.value || '',
    specSupport: form.querySelector('[name="specSupport"]')?.value || '',
    specMediaCount: form.querySelector('[name="specMediaCount"]')?.value || '',
    orderLink: form.querySelector('[name="orderLink"]')?.value || '',
    status: form.querySelector('[name="status"]')?.value || 'active',
    displayOrder: form.querySelector('[name="displayOrder"]')?.value || '0',
  };
}

function updateProductEditorPreview(form, activeIdx = null) {
  const previewRoot = form.querySelector('[data-role="product-preview"]');
  if (!previewRoot) return;
  const state = getProductEditorRecord(form);
  if (activeIdx !== null) form.__previewSlideIndex = activeIdx;
  previewRoot.innerHTML = renderProductPreview(state, form.__previewSlideIndex || 0);
  if (window.lucide) lucide.createIcons();
}

async function uploadEditorFile(file, folder, stateEl, source = 'product-editor') {
  const progress = stateEl;
  if (progress) progress.textContent = `Uploading ${file.name}...`;
  const result = await uploadAsset(file, folder, (value) => {
    if (progress) progress.textContent = `Uploading ${file.name}... ${value}%`;
  });
  const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
  await saveUploadedMediaRecord(file, result, folder, mediaType, source, `${folder}:${file.name}`);
  if (progress) progress.textContent = `Uploaded ${file.name}`;
  return result.publicUrl;
}

function attachProductEditorBehaviors(form) {
  const stateEl = form.querySelector('[data-role="upload-state"]');
  const saveBtn = form.querySelector('[data-role="save-product"]');
  const mediaGrid = form.querySelector('[data-role="media-studio-grid"]');
  const multiFileInput = form.querySelector('[data-role="media-multi-file-input"]');
  const uploadTriggerBtn = form.querySelector('[data-role="media-upload-trigger"]');
  const urlToggleBtn = form.querySelector('[data-role="media-url-toggle"]');
  const urlAdderBox = form.querySelector('[data-role="media-url-adder-box"]');
  const urlInput = form.querySelector('[data-role="media-url-input"]');
  const urlTypeSelect = form.querySelector('[data-role="media-url-type"]');
  const urlAddBtn = form.querySelector('[data-role="media-url-add-btn"]');
  
  const mainImageHidden = form.querySelector('[data-role="main-image-source"]');
  const mainVideoHidden = form.querySelector('[data-role="main-video-source"]');
  const galleryImagesHidden = form.querySelector('[data-role="gallery-images-source"]');
  const videosHidden = form.querySelector('[data-role="videos-source"]');
  const allImagesHidden = form.querySelector('[data-role="all-images-source"]');
  
  const tagFields = [...form.querySelectorAll('[data-tag-field]')];
  form.__galleryDragIndex = null;
  form.__previewSlideIndex = 0;

  // Initialize form.__mediaStudioItems from existing hidden fields
  const rawImage = String(mainImageHidden?.value || '').trim();
  const rawImages = normalizeEditorList(allImagesHidden?.value || '');
  const rawGallery = normalizeEditorList(galleryImagesHidden?.value || '');
  const allImgList = [...new Set([rawImage, ...rawImages, ...rawGallery].filter(Boolean))];
  const initialMainImage = rawImage || allImgList[0] || '';

  const rawVideo = String(mainVideoHidden?.value || '').trim();
  const rawVideos = normalizeEditorList(videosHidden?.value || '');
  const allVidList = [...new Set([rawVideo, ...rawVideos].filter(Boolean))];
  const initialMainVideo = rawVideo || allVidList[0] || '';

  const initialItems = [];
  allImgList.forEach((url) => {
    initialItems.push({
      url,
      type: 'image',
      isMainImage: url === initialMainImage,
      isMainVideo: false,
    });
  });
  allVidList.forEach((url) => {
    initialItems.push({
      url,
      type: 'video',
      isMainImage: false,
      isMainVideo: url === initialMainVideo,
    });
  });

  form.__mediaStudioItems = initialItems;

  const setBusy = (busy, message = '') => {
    if (saveBtn) saveBtn.disabled = busy;
    if (message && stateEl) stateEl.textContent = message;
  };

  const syncMediaStudio = () => {
    const items = form.__mediaStudioItems || [];
    
    // Ensure main image flag
    const hasMainImg = items.some((i) => i.type === 'image' && i.isMainImage);
    if (!hasMainImg) {
      const firstImg = items.find((i) => i.type === 'image');
      if (firstImg) firstImg.isMainImage = true;
    }
    
    // Ensure main video flag
    const hasMainVid = items.some((i) => i.type === 'video' && i.isMainVideo);
    if (!hasMainVid) {
      const firstVid = items.find((i) => i.type === 'video');
      if (firstVid) firstVid.isMainVideo = true;
    }

    const mainImgUrl = items.find((i) => i.type === 'image' && i.isMainImage)?.url || items.find((i) => i.type === 'image')?.url || '';
    const imgList = items.filter((i) => i.type === 'image').map((i) => i.url);
    const galleryList = imgList.filter((u) => u !== mainImgUrl);

    const mainVidUrl = items.find((i) => i.type === 'video' && i.isMainVideo)?.url || items.find((i) => i.type === 'video')?.url || '';
    const vidList = items.filter((i) => i.type === 'video').map((i) => i.url);

    if (mainImageHidden) mainImageHidden.value = mainImgUrl;
    if (mainVideoHidden) mainVideoHidden.value = mainVidUrl;
    if (galleryImagesHidden) galleryImagesHidden.value = galleryList.join('\n');
    if (videosHidden) videosHidden.value = vidList.join('\n');
    if (allImagesHidden) allImagesHidden.value = imgList.join('\n');

    // Update Stats chips
    const statImgs = form.querySelector('[data-role="stat-imgs"] strong');
    const statVids = form.querySelector('[data-role="stat-vids"] strong');
    if (statImgs) statImgs.textContent = String(imgList.length);
    if (statVids) statVids.textContent = String(vidList.length);

    // Re-render Media Studio Grid
    if (mediaGrid) {
      mediaGrid.innerHTML = items.length
        ? items.map((item, index) => renderMediaStudioCard(item, index)).join('')
        : `
          <div class="media-empty-state">
            <i data-lucide="image-plus"></i>
            <strong style="color:var(--text);font-size:0.95rem;">No media items added yet</strong>
            <p>Upload images/videos or paste URLs above. They will show directly on the live storefront slideshow.</p>
          </div>
        `;
    }

    updateProductEditorPreview(form);
    if (window.lucide) lucide.createIcons();
  };

  const addMediaItems = (newItems = []) => {
    const current = form.__mediaStudioItems || [];
    const valid = newItems.filter((it) => it && it.url && String(it.url).trim());
    form.__mediaStudioItems = [...current, ...valid];
    syncMediaStudio();
  };

  const removeMediaIndex = (index) => {
    const current = form.__mediaStudioItems || [];
    if (index >= 0 && index < current.length) {
      current.splice(index, 1);
      form.__mediaStudioItems = current;
      syncMediaStudio();
    }
  };

  const moveMediaIndex = (fromIndex, toIndex) => {
    const current = form.__mediaStudioItems || [];
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= current.length || toIndex >= current.length || fromIndex === toIndex) return;
    const [moved] = current.splice(fromIndex, 1);
    current.splice(toIndex, 0, moved);
    form.__mediaStudioItems = current;
    syncMediaStudio();
  };

  const setAsMainImage = (index) => {
    const current = form.__mediaStudioItems || [];
    current.forEach((item, i) => {
      if (item.type === 'image') {
        item.isMainImage = (i === index);
      }
    });
    form.__mediaStudioItems = current;
    syncMediaStudio();
  };

  const setAsMainVideo = (index) => {
    const current = form.__mediaStudioItems || [];
    current.forEach((item, i) => {
      if (item.type === 'video') {
        item.isMainVideo = (i === index);
      }
    });
    form.__mediaStudioItems = current;
    syncMediaStudio();
  };

  const handleTagAdd = (fieldName, input) => {
    const raw = String(input.value || '').trim();
    if (!raw) return;
    const values = normalizeEditorList(raw.replace(/,/g, '\n'));
    if (!values.length) return;
    const field = form.querySelector(`[data-tag-field="${fieldName}"]`);
    const source = field?.querySelector('[data-role="tag-source"]');
    const existing = normalizeEditorList(source?.value || '');
    const next = mergeUniqueList(existing, values);
    if (source) source.value = next.join('\n');
    input.value = '';
    syncTagEditor(form, fieldName);
    updateProductEditorPreview(form);
  };

  // Upload button trigger
  uploadTriggerBtn?.addEventListener('click', () => {
    multiFileInput?.click();
  });

  // Toggle URL adder box
  urlToggleBtn?.addEventListener('click', () => {
    if (urlAdderBox) {
      urlAdderBox.style.display = urlAdderBox.style.display === 'none' ? 'flex' : 'none';
      if (urlAdderBox.style.display === 'flex') {
        urlInput?.focus();
      }
    }
  });

  // URL Add handler
  urlAddBtn?.addEventListener('click', () => {
    const rawUrl = String(urlInput?.value || '').trim();
    if (!rawUrl) {
      showToast('Please enter a valid URL', 'warning');
      return;
    }
    const chosenType = urlTypeSelect?.value || 'auto';
    let mediaType = chosenType;
    if (chosenType === 'auto') {
      mediaType = (/\.(mp4|webm|mov|m4v|ogg)$/i.test(rawUrl) || rawUrl.includes('video')) ? 'video' : 'image';
    }
    addMediaItems([{
      url: rawUrl,
      type: mediaType,
      isMainImage: false,
      isMainVideo: false,
    }]);
    if (urlInput) urlInput.value = '';
    showToast(`Added ${mediaType} from URL`, 'success');
  });

  // Enter in URL input
  urlInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      urlAddBtn?.click();
    }
  });

  // File Upload change
  multiFileInput?.addEventListener('change', async (event) => {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    event.target.value = '';

    try {
      setBusy(true, `Uploading ${files.length} media file${files.length > 1 ? 's' : ''}...`);
      const newItems = [];
      for (const file of files) {
        const isVid = file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file.name);
        const folder = isVid ? mediaFolderForNode('products', 'video') : mediaFolderForNode('products', 'gallery');
        const url = await uploadEditorFile(file, folder, stateEl, 'product-editor');
        newItems.push({
          url,
          type: isVid ? 'video' : 'image',
          isMainImage: false,
          isMainVideo: false,
        });
      }
      addMediaItems(newItems);
      showToast(`Uploaded ${files.length} media item${files.length > 1 ? 's' : ''}!`, 'success');
    } catch (error) {
      if (stateEl) stateEl.textContent = error?.message || 'Media upload failed';
      showToast(error?.message || 'Media upload failed', 'danger');
    } finally {
      setBusy(false, 'Ready.');
    }
  });

  // Form input listeners (title, price, slug, etc.)
  form.addEventListener('input', (event) => {
    if (event.target.name === 'title') {
      const slugInput = form.querySelector('[name="slug"]');
      if (slugInput) {
        slugInput.value = slugify(event.target.value);
      }
    }
    if (event.target.matches('[name="title"],[name="slug"],[name="category"],[name="description"],[name="priceINR"],[name="priceUSD"],[name="badge"],[name="badgeStyle"],[name="badgeIcon"],[name="orderLink"],[name="status"],[name="displayOrder"]')) {
      updateProductEditorPreview(form);
      return;
    }
    if (event.target.matches('[data-role="tag-input"]')) {
      updateProductEditorPreview(form);
      return;
    }
    if (event.target.matches('[data-role="tier-label"],[data-role="tier-inr"],[data-role="tier-usd"]')) {
      updateProductEditorPreview(form);
      return;
    }
  });

  // Click delegation
  form.addEventListener('click', (event) => {
    // Add Tier / Sub-Option button
    const addTierBtn = event.target.closest('[data-role="add-tier-btn"]');
    if (addTierBtn) {
      const list = form.querySelector('[data-role="tier-items-list"]');
      if (list) {
        const emptyState = list.querySelector('[data-role="tier-empty-state"]');
        if (emptyState) emptyState.remove();
        const currentRows = list.querySelectorAll('[data-role="tier-row"]');
        const newIdx = currentRows.length;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = renderTierRow({ label: '', inr: '', usd: '' }, newIdx, newIdx + 1);
        const newRow = tempDiv.firstElementChild;
        list.appendChild(newRow);
        refreshTierRowIndices(form);
        const labelInput = newRow.querySelector('[data-role="tier-label"]');
        if (labelInput) labelInput.focus();
        updateProductEditorPreview(form);
      }
      return;
    }

    // Tier Preset button
    const presetBtn = event.target.closest('.tier-preset-btn:not(.custom-add)');
    if (presetBtn) {
      const list = form.querySelector('[data-role="tier-items-list"]');
      if (list) {
        const emptyState = list.querySelector('[data-role="tier-empty-state"]');
        if (emptyState) emptyState.remove();
        const currentRows = list.querySelectorAll('[data-role="tier-row"]');
        const newIdx = currentRows.length;
        const label = presetBtn.dataset.presetLabel || '';
        const inr = presetBtn.dataset.presetInr || '';
        const usd = presetBtn.dataset.presetUsd || '';
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = renderTierRow({ label, inr, usd }, newIdx, newIdx + 1);
        const newRow = tempDiv.firstElementChild;
        list.appendChild(newRow);
        refreshTierRowIndices(form);
        const inrInput = newRow.querySelector('[data-role="tier-inr"]');
        if (inrInput) inrInput.focus();
        updateProductEditorPreview(form);
      }
      return;
    }

    // Move Tier Up button
    const moveUpBtn = event.target.closest('[data-role="move-tier-up"]');
    if (moveUpBtn && !moveUpBtn.disabled) {
      const row = moveUpBtn.closest('[data-role="tier-row"]');
      const list = form.querySelector('[data-role="tier-items-list"]');
      const prev = row?.previousElementSibling;
      if (row && prev && prev.matches('[data-role="tier-row"]') && list) {
        list.insertBefore(row, prev);
        refreshTierRowIndices(form);
        updateProductEditorPreview(form);
      }
      return;
    }

    // Move Tier Down button
    const moveDownBtn = event.target.closest('[data-role="move-tier-down"]');
    if (moveDownBtn && !moveDownBtn.disabled) {
      const row = moveDownBtn.closest('[data-role="tier-row"]');
      const list = form.querySelector('[data-role="tier-items-list"]');
      const next = row?.nextElementSibling;
      if (row && next && next.matches('[data-role="tier-row"]') && list) {
        list.insertBefore(next, row);
        refreshTierRowIndices(form);
        updateProductEditorPreview(form);
      }
      return;
    }

    // Duplicate Tier button
    const dupTierBtn = event.target.closest('[data-role="duplicate-tier-btn"]');
    if (dupTierBtn) {
      const row = dupTierBtn.closest('[data-role="tier-row"]');
      const list = form.querySelector('[data-role="tier-items-list"]');
      if (row && list) {
        const label = row.querySelector('[data-role="tier-label"]')?.value || '';
        const inr = row.querySelector('[data-role="tier-inr"]')?.value || '';
        const usd = row.querySelector('[data-role="tier-usd"]')?.value || '';
        const currentRows = list.querySelectorAll('[data-role="tier-row"]');
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = renderTierRow({ label: `${label} (Copy)`, inr, usd }, currentRows.length, currentRows.length + 1);
        const newRow = tempDiv.firstElementChild;
        if (row.nextSibling) {
          list.insertBefore(newRow, row.nextSibling);
        } else {
          list.appendChild(newRow);
        }
        refreshTierRowIndices(form);
        updateProductEditorPreview(form);
      }
      return;
    }

    // Remove Tier / Sub-Option button
    const removeTierBtn = event.target.closest('[data-role="remove-tier-btn"]');
    if (removeTierBtn) {
      const row = removeTierBtn.closest('[data-role="tier-row"]');
      if (row) {
        row.remove();
        refreshTierRowIndices(form);
        updateProductEditorPreview(form);
      }
      return;
    }

    // Quick Save Sub-Options button
    const quickSaveBtn = event.target.closest('[data-role="quick-save-tiers-btn"]');
    if (quickSaveBtn) {
      const prodId = form.dataset.id;
      const prodData = getProductEditorRecord(form);
      const tiers = prodData.tiers || [];
      if (prodId) {
        (async () => {
          try {
            quickSaveBtn.disabled = true;
            quickSaveBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Saving...';
            await updateRecord('products', prodId, { tiers });
            if (ui.data?.products?.[prodId]) {
              ui.data.products[prodId].tiers = tiers;
            }
            showToast(`Sub-options saved successfully (${tiers.length} items)!`, 'success');
          } catch (err) {
            showToast(err?.message || 'Failed to save sub-options', 'danger');
          } finally {
            quickSaveBtn.disabled = false;
            quickSaveBtn.innerHTML = '<i data-lucide="check"></i> Save Sub-Options';
            if (window.lucide) lucide.createIcons();
          }
        })();
      } else {
        showToast('Sub-options added! Click "Create Product" below to save the product.', 'info');
      }
      return;
    }

    // Slideshow dot click in preview
    const slideDot = event.target.closest('[data-slide-dot]');
    if (slideDot) {
      const idx = Number(slideDot.dataset.slideDot);
      updateProductEditorPreview(form, idx);
      return;
    }

    // Slideshow arrow nav in preview
    const slideNav = event.target.closest('[data-slide-nav]');
    if (slideNav) {
      const total = (form.__mediaStudioItems || []).length;
      if (total <= 1) return;
      let currentIdx = form.__previewSlideIndex || 0;
      if (slideNav.dataset.slideNav === 'prev') {
        currentIdx = (currentIdx - 1 + total) % total;
      } else {
        currentIdx = (currentIdx + 1) % total;
      }
      updateProductEditorPreview(form, currentIdx);
      return;
    }

    // Media studio actions
    const removeBtn = event.target.closest('[data-role="media-card-remove"]');
    if (removeBtn) {
      const idx = Number(removeBtn.dataset.index);
      removeMediaIndex(idx);
      return;
    }

    const setMainImgBtn = event.target.closest('[data-role="set-main-image"]');
    if (setMainImgBtn) {
      const idx = Number(setMainImgBtn.dataset.index);
      setAsMainImage(idx);
      showToast('Set as Main Image', 'success');
      return;
    }

    const setMainVidBtn = event.target.closest('[data-role="set-main-video"]');
    if (setMainVidBtn) {
      const idx = Number(setMainVidBtn.dataset.index);
      setAsMainVideo(idx);
      showToast('Set as Main Video', 'success');
      return;
    }

    const movePrevBtn = event.target.closest('[data-role="media-move-prev"]');
    if (movePrevBtn) {
      const idx = Number(movePrevBtn.dataset.index);
      moveMediaIndex(idx, idx - 1);
      return;
    }

    const moveNextBtn = event.target.closest('[data-role="media-move-next"]');
    if (moveNextBtn) {
      const idx = Number(moveNextBtn.dataset.index);
      moveMediaIndex(idx, idx + 1);
      return;
    }

    // Tags
    const tagAdd = event.target.closest('[data-role="tag-add"]');
    if (tagAdd) {
      const field = tagAdd.closest('[data-tag-field]');
      const input = field?.querySelector('[data-role="tag-input"]');
      if (field && input) handleTagAdd(field.dataset.tagField, input);
      return;
    }
    const tagRemove = event.target.closest('[data-role="tag-remove"]');
    if (tagRemove) {
      const fieldName = tagRemove.dataset.name;
      const index = Number(tagRemove.dataset.index);
      const field = form.querySelector(`[data-tag-field="${fieldName}"]`);
      const source = field?.querySelector('[data-role="tag-source"]');
      const values = normalizeEditorList(source?.value || '');
      values.splice(index, 1);
      if (source) source.value = values.join('\n');
      syncTagEditor(form, fieldName);
      updateProductEditorPreview(form);
      return;
    }
  });

  // Drag and drop reordering
  form.addEventListener('dragstart', (event) => {
    const card = event.target.closest('[data-media-item]');
    if (!card) return;
    form.__galleryDragIndex = Number(card.dataset.index);
    card.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
  });

  form.addEventListener('dragend', (event) => {
    const card = event.target.closest('[data-media-item]');
    if (card) card.classList.remove('dragging');
    form.querySelectorAll('[data-media-item]').forEach((c) => c.classList.remove('drag-over'));
  });

  form.addEventListener('dragover', (event) => {
    const card = event.target.closest('[data-media-item]');
    if (!card) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    card.classList.add('drag-over');
  });

  form.addEventListener('dragleave', (event) => {
    const card = event.target.closest('[data-media-item]');
    if (card) card.classList.remove('drag-over');
  });

  form.addEventListener('drop', (event) => {
    const card = event.target.closest('[data-media-item]');
    if (!card) return;
    event.preventDefault();
    card.classList.remove('drag-over');
    const fromIndex = Number(form.__galleryDragIndex);
    const toIndex = Number(card.dataset.index);
    if (Number.isFinite(fromIndex) && Number.isFinite(toIndex) && fromIndex !== toIndex) {
      moveMediaIndex(fromIndex, toIndex);
    }
    form.__galleryDragIndex = null;
  });

  tagFields.forEach((field) => {
    const input = field.querySelector('[data-role="tag-input"]');
    if (!input) return;
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleTagAdd(field.dataset.tagField, input);
      }
    });
  });

  syncAllTags();
  syncMediaStudio();
}

function openProductEditor(record, schema) {
  const isEdit = Boolean(record.id);
  openModal(`
    <div class="product-editor-modal">
      <div class="panel-head product-editor-head">
        <div class="product-editor-head-left">
          <button class="btn btn-ghost modal-close-btn" data-close-modal type="button" aria-label="Close modal" title="Back / Close">
            <i data-lucide="arrow-left"></i>
          </button>
          <div class="product-editor-head-title">
            <h2 class="section-title">${escapeHtml(isEdit ? (record.title || 'Edit Product') : 'Create New Product')}</h2>
            <div class="product-editor-head-meta">
              <span class="badge ${isEdit ? 'badge-primary' : 'badge-success'}">${isEdit ? 'Editing' : 'New'}</span>
              ${record.id ? `<span class="product-id-pill">${escapeHtml(record.id)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="product-editor-head-right">
          <button type="submit" form="recordForm" class="btn btn-primary btn-header-save" data-role="save-product">
            <i data-lucide="check"></i> <span>${isEdit ? 'Save Changes' : 'Create'}</span>
          </button>
        </div>
      </div>
      ${renderProductEditor(record, schema)}
    </div>
  `);
  const form = document.getElementById('recordForm');
  if (form) {
    attachProductEditorBehaviors(form);
  }
  if (window.lucide) lucide.createIcons();
}

function openTiersEditorModal(product = {}) {
  const isProduct = Boolean(product && product.id);
  if (!isProduct) {
    showToast('Product not found to edit sub-plans', 'danger');
    return;
  }
  const currentTiers = normalizeTierList(product.tiers);

  openModal(`
    <div class="product-editor-modal tier-quick-modal-shell">
      <div class="panel-head product-editor-head">
        <div class="product-editor-head-left">
          <button class="btn btn-ghost modal-close-btn" data-close-modal type="button" aria-label="Close modal" title="Back / Close">
            <i data-lucide="arrow-left"></i>
          </button>
          <div class="product-editor-head-title">
            <h2 class="section-title">${escapeHtml(product.title || product.slug || 'Product Sub-Plans')}</h2>
            <div class="product-editor-head-meta">
              <span class="badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4);"><i data-lucide="layers" style="width: 12px; height: 12px;"></i> Sub-Plans & Tiers</span>
              <span class="product-id-pill">${escapeHtml(product.id)}</span>
              ${product.priceINR ? `<span class="chip subtle">Base: ₹${escapeHtml(String(product.priceINR).replace(/[₹\s]/g, ''))}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="product-editor-head-right">
          <button type="button" class="btn btn-primary btn-header-save" data-role="modal-save-tiers-btn" data-id="${escapeHtml(product.id)}" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
            <i data-lucide="check"></i> <span>Save Sub-Plans</span>
          </button>
        </div>
      </div>

      <div class="tier-quick-modal-body" style="padding: 20px;">
        <form id="tierQuickForm" data-id="${escapeHtml(product.id)}" style="display: flex; flex-direction: column; gap: 14px;">
          <div class="tier-items-list" data-role="tier-items-list" style="display: flex; flex-direction: column; gap: 10px;">
            ${currentTiers.length > 0 ? currentTiers.map((tier, index) => renderTierRow(tier, index, currentTiers.length)).join('') : `
              <div class="tier-empty-placeholder" data-role="tier-empty-state" style="padding: 24px 16px; text-align: center; border: 1px dashed rgba(168,85,247,0.3); border-radius: 12px; color: var(--muted); font-size: 13.5px; background: rgba(168,85,247,0.02);">
                <i data-lucide="layers" style="width: 32px; height: 32px; color: #a855f7; margin-bottom: 8px; opacity: 0.7;"></i>
                <div style="font-weight: 600; color: #f1f5f9; margin-bottom: 4px;">No Sub-Plans Configured</div>
                <div>You can offer custom purchase options (e.g. 1 Group ₹150, 4 Groups ₹400). Click <strong>"+ Add Option"</strong> below.</div>
              </div>
            `}
          </div>

          <div class="tier-quick-footer" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 10px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.08);">
            <div style="display: flex; align-items: center; gap: 8px;">
              <button type="button" class="btn btn-ghost" data-role="add-tier-btn" style="color: #c084fc; border-color: rgba(192, 132, 252, 0.35);">
                <i data-lucide="plus"></i> Add Another Option
              </button>
              <button type="button" class="btn btn-ghost" data-role="clear-all-tiers" style="color: #f87171;">
                <i data-lucide="trash"></i> Clear All
              </button>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>
              <button type="submit" class="btn btn-primary" data-role="modal-save-tiers-btn" data-id="${escapeHtml(product.id)}" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); font-weight: 700;">
                <i data-lucide="check"></i> Save Sub-Plans
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `);

  const form = document.getElementById('tierQuickForm');
  if (form) {
    attachTierQuickEditorBehaviors(form, product);
  }
  if (window.lucide) lucide.createIcons();
}

function attachTierQuickEditorBehaviors(form, product) {
  const productId = form.dataset.id || product.id;
  const list = form.querySelector('[data-role="tier-items-list"]');
  if (!list) return;

  function refreshIndices() {
    refreshTierRowIndices(form);
  }

  function addRow(data = { label: '', inr: '', usd: '' }, focus = true) {
    const emptyState = list.querySelector('[data-role="tier-empty-state"]');
    if (emptyState) emptyState.remove();

    const currentRows = list.querySelectorAll('[data-role="tier-row"]');
    const newIdx = currentRows.length;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = renderTierRow(data, newIdx, newIdx + 1);
    const newRow = tempDiv.firstElementChild;
    list.appendChild(newRow);
    refreshIndices();
    if (focus) {
      const targetInput = newRow.querySelector(data.label ? '[data-role="tier-inr"]' : '[data-role="tier-label"]');
      if (targetInput) targetInput.focus();
    }
    return newRow;
  }

  async function handleSaveTiers() {
    const tierRows = [...list.querySelectorAll('[data-role="tier-row"]')];
    const tiers = tierRows.map((row) => {
      const label = String(row.querySelector('[data-role="tier-label"]')?.value || '').trim();
      const inr = String(row.querySelector('[data-role="tier-inr"]')?.value || '').replace(/[₹\s,]/g, '').trim();
      const usd = String(row.querySelector('[data-role="tier-usd"]')?.value || '').replace(/[\$\s,]/g, '').trim();
      return { label, inr, usd };
    }).filter((t) => t.label || t.inr || t.usd);

    const modalRoot = form.closest('.tier-quick-modal-shell') || form;
    const saveBtns = modalRoot.querySelectorAll('[data-role="modal-save-tiers-btn"]');
    saveBtns.forEach((btn) => {
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Saving...';
    });

    try {
      await updateRecord('products', productId, { tiers });
      if (ui.data?.products?.[productId]) {
        ui.data.products[productId].tiers = tiers;
      }
      showToast(`Sub-plans updated successfully (${tiers.length} options configured)!`, 'success');
      closeModal();
      renderView(ui.data || {});
    } catch (err) {
      showToast(err?.message || 'Failed to save sub-plans', 'danger');
    } finally {
      saveBtns.forEach((btn) => {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="check"></i> Save Sub-Plans';
      });
      if (window.lucide) lucide.createIcons();
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSaveTiers();
  });

  const modalContainer = form.closest('.tier-quick-modal-shell') || form;
  modalContainer.addEventListener('click', (event) => {
    const saveBtn = event.target.closest('[data-role="modal-save-tiers-btn"]');
    if (saveBtn) {
      event.preventDefault();
      handleSaveTiers();
      return;
    }

    const presetBtn = event.target.closest('.tier-preset-btn:not(.custom-add)');
    if (presetBtn) {
      const label = presetBtn.dataset.presetLabel || '';
      const inr = presetBtn.dataset.presetInr || '';
      const usd = presetBtn.dataset.presetUsd || '';
      addRow({ label, inr, usd }, true);
      return;
    }

    const addBtn = event.target.closest('[data-role="add-tier-btn"]');
    if (addBtn) {
      addRow({ label: '', inr: '', usd: '' }, true);
      return;
    }

    const clearBtn = event.target.closest('[data-role="clear-all-tiers"]');
    if (clearBtn) {
      if (confirm('Clear all sub-plan options for this product?')) {
        list.innerHTML = '';
        refreshIndices();
      }
      return;
    }

    const removeBtn = event.target.closest('[data-role="remove-tier-btn"]');
    if (removeBtn) {
      const row = removeBtn.closest('[data-role="tier-row"]');
      if (row) {
        row.remove();
        refreshIndices();
      }
      return;
    }

    const upBtn = event.target.closest('[data-role="move-tier-up"]');
    if (upBtn && !upBtn.disabled) {
      const row = upBtn.closest('[data-role="tier-row"]');
      const prev = row?.previousElementSibling;
      if (row && prev && prev.matches('[data-role="tier-row"]')) {
        list.insertBefore(row, prev);
        refreshIndices();
      }
      return;
    }

    const downBtn = event.target.closest('[data-role="move-tier-down"]');
    if (downBtn && !downBtn.disabled) {
      const row = downBtn.closest('[data-role="tier-row"]');
      const next = row?.nextElementSibling;
      if (row && next && next.matches('[data-role="tier-row"]')) {
        list.insertBefore(next, row);
        refreshIndices();
      }
      return;
    }

    const dupBtn = event.target.closest('[data-role="duplicate-tier-btn"]');
    if (dupBtn) {
      const row = dupBtn.closest('[data-role="tier-row"]');
      if (row) {
        const label = row.querySelector('[data-role="tier-label"]')?.value || '';
        const inr = row.querySelector('[data-role="tier-inr"]')?.value || '';
        const usd = row.querySelector('[data-role="tier-usd"]')?.value || '';
        const currentRows = list.querySelectorAll('[data-role="tier-row"]');
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = renderTierRow({ label: `${label} (Copy)`, inr, usd }, currentRows.length, currentRows.length + 1);
        const newRow = tempDiv.firstElementChild;
        if (row.nextSibling) {
          list.insertBefore(newRow, row.nextSibling);
        } else {
          list.appendChild(newRow);
        }
        refreshIndices();
      }
      return;
    }
  });

  refreshIndices();
}

function openCategoryEditor(record, schema) {
  const isEdit = Boolean(record.id);
  openModal(`
    <div class="category-editor-modal">
      <div class="panel-head category-editor-head">
        <div>
          <h2 class="section-title">${escapeHtml(isEdit ? 'Edit Category' : 'Add Category')}</h2>
          <p class="section-subtitle">${escapeHtml(schema.description)}</p>
        </div>
        <button class="btn btn-ghost" data-close-modal type="button"><i data-lucide="x"></i></button>
      </div>
      ${renderCategoryEditor(record, schema)}
    </div>
  `);
  const form = document.getElementById('recordForm');
  if (form) {
    attachCategoryEditorBehaviors(form);
  }
  if (window.lucide) lucide.createIcons();
}

function openRecordEditor(node, schema, record = {}) {
  if (node === 'products') { openProductEditor(record, schema); return; }
  if (node === 'categories') { openCategoryEditor(record, schema); return; }
  const isEdit = Boolean(record.id);
  const data = record || {};
  const fields = schema.fields;
  const showPreview = node === 'products' || node === 'categories';
  openModal(`
    <div class="panel-head">
      <div>
        <h2 class="section-title">${escapeHtml(isEdit ? `Edit ${schema.label}` : `Add ${schema.label}`)}</h2>
        <p class="section-subtitle">${escapeHtml(schema.description)}</p>
      </div>
      <button class="btn btn-ghost" data-close-modal type="button"><i data-lucide="x"></i></button>
    </div>
    <form id="recordForm" data-node="${escapeHtml(node)}" data-id="${escapeHtml(data.id || '')}">
      <div class="${showPreview ? 'editor-layout' : ''}">
        ${showPreview ? `
        <div class="editor-preview-column">
          ${renderRecordPreview(data)}
          <div class="editor-help glass">
            <strong>Upload tip</strong>
            <p>Choose a file below and save. The file will upload to RustFS S3 first, then the public URL will be stored in Firebase.</p>
          </div>
        </div>
        ` : ''}
        <div class="form-grid editor-form">
          ${fields.map((field) => fieldMarkup(field, data[field.key] ?? '', { allowUploads: true })).join('')}
        </div>
      </div>
      <div class="toolbar" style="margin-top:16px;justify-content:flex-end;">
        <button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>
        <button type="submit" class="btn btn-primary">Save ${escapeHtml(schema.label)}</button>
      </div>
    </form>
  `);
}

window.copyShareLink = function(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    btn.innerHTML = '<i data-lucide="check" style="width: 14px; height: 14px;"></i> Copied!';
    
    btn.style.setProperty('background', '#10b981', 'important');
    btn.style.setProperty('border', 'none', 'important');
    btn.style.setProperty('color', '#ffffff', 'important');
    btn.style.setProperty('box-shadow', '0 4px 14px rgba(16, 185, 129, 0.4)', 'important');
    
    if (window.lucide) lucide.createIcons();
    showToast('Link copied to clipboard!');

    // Smooth Telegram-style modal dismiss animation after brief feedback (350ms)
    setTimeout(() => {
      const backdrop = document.getElementById('modalBackdrop');
      if (backdrop) {
        backdrop.classList.add('closing');
        setTimeout(() => {
          closeModal();
          backdrop.classList.remove('closing');
        }, 300);
      } else {
        closeModal();
      }
    }, 350);
  }).catch((err) => {
    console.error('Copy failed:', err);
    showToast('Copy failed, please select and copy manually.', 'danger');
  });
};

function openShareModal(node, id) {
  const item = getItem(node, id);
  if (!item) return;

  const isCategory = node === 'categories';
  const origin = window.location.origin;
  const pathname = window.location.pathname;
  const adminIdx = pathname.toLowerCase().indexOf('/admin');
  const baseFolder = adminIdx !== -1 ? pathname.substring(0, adminIdx) : '';
  const cleanBase = `${origin}${baseFolder}`.replace(/\/+$/, '');
  const slugify = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const targetParam = item.slug || slugify(item.title || item.name) || item.id || id;
  const paramName = isCategory ? 'category' : 'product';
  const homeUrl = `${cleanBase}/?${paramName}=${encodeURIComponent(targetParam)}`;

  const modalTitle = isCategory ? 'Share Category Link' : 'Share Product Link';
  const typeLabel = isCategory ? 'Category Selected' : 'Product Selected';
  const inputLabel = isCategory ? 'Customer Link (Opens page & filters to category)' : 'Customer Link (Opens page & highlights product)';
  const footerHelpText = isCategory
    ? 'When customers open this link, the site will automatically filter the catalog and scroll directly to this category.'
    : 'When customers open this link, the site will automatically scroll to the product and highlight it with a premium glow.';

  const html = `
    <div class="panel shadow-lg share-product-modal modal-sm" style="width: 100%; padding: 28px; border-radius: 16px; background: var(--panel-solid); border: 1px solid var(--border); overflow: hidden; position: relative;">
      <!-- Subtle top color accent line -->
      <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #6366f1, #ec4899);"></div>

      <!-- Header -->
      <div class="panel-head flex items-center justify-between" style="padding-bottom: 16px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between;">
        <h3 class="panel-title flex items-center gap-2" style="font-size: 16px; font-weight: 700; color: var(--text); margin: 0; display: flex; align-items: center; gap: 8px;">
          <i data-lucide="share-2" style="color: #6366f1; width: 20px; height: 20px;"></i>
          <span>${escapeHtml(modalTitle)}</span>
        </h3>
        <button class="btn btn-ghost" data-close-modal type="button" style="padding: 6px; border: none; background: transparent; cursor: pointer; color: var(--muted); display: flex; align-items: center; justify-content: center;">
          <i data-lucide="x" style="width: 18px; height: 18px;"></i>
        </button>
      </div>

      <!-- Preview Block -->
      <div style="background: rgba(99, 102, 241, 0.05); border: 1px solid rgba(99, 102, 241, 0.15); border-radius: 10px; padding: 14px; margin-bottom: 20px; display: flex; align-items: center; gap: 12px;">
        <div style="width: 42px; height: 42px; background: linear-gradient(135deg, #6366f1, #a855f7); border-radius: 8px; display: grid; place-items: center; color: white; font-weight: bold; font-size: 18px; flex-shrink: 0;">
          ${escapeHtml((item.title || item.name || 'C')[0].toUpperCase())}
        </div>
        <div>
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #818cf8; letter-spacing: 0.05em;">${escapeHtml(typeLabel)}</div>
          <div style="font-size: 14px; font-weight: 600; color: var(--text);">${escapeHtml(item.title || item.name || '')}</div>
        </div>
      </div>

      <!-- Link Box -->
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <label style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--muted); letter-spacing: 0.05em;">
          ${escapeHtml(inputLabel)}
        </label>
        <div style="display: flex; gap: 8px; width: 100%;">
          <input type="text" readonly value="${escapeHtml(homeUrl)}" onclick="this.select();" style="flex: 1; font-family: 'JetBrains Mono', monospace; font-size: 12px; background: var(--bg); padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border); color: var(--text); outline: none; width: 100%; box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);" />
          <button class="btn" onclick="copyShareLink(this, '${escapeHtml(homeUrl)}');" style="padding: 0 20px; font-size: 13px; font-weight: 700; border-radius: 8px; flex-shrink: 0; background: linear-gradient(135deg, #6366f1, #ec4899) !important; border: none !important; color: white !important; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; transition: all 0.25s ease; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);">
            <i data-lucide="copy" style="width: 14px; height: 14px;"></i> Copy Link
          </button>
        </div>
      </div>

      <!-- Footer Help Text -->
      <div style="font-size: 11px; color: var(--muted); margin-top: 14px; line-height: 1.4;">
        ${escapeHtml(footerHelpText)}
      </div>

      <!-- Footer Buttons -->
      <div style="margin-top: 24px; display: flex; justify-content: flex-end; border-top: 1px solid var(--border); padding-top: 16px;">
        <button type="button" class="btn" data-close-modal style="padding: 8px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; background: transparent; border: 1px solid var(--border); color: var(--text); cursor: pointer; transition: all 0.2s ease;">Close</button>
      </div>
    </div>
  `;
  openModal(html);
}

function openSingleEditor(node, schema, record = {}) {
  if (node === 'hero' || node === 'banner' || node === 'settings' || node === 'payment') {
    openModal(`
      <div class="panel-head management-modal-head">
        <div>
          <h2 class="section-title">${escapeHtml(schema.title)}</h2>
          <p class="section-subtitle">${escapeHtml(schema.description)}</p>
        </div>
        <button class="btn btn-ghost" data-close-modal type="button"><i data-lucide="x"></i></button>
      </div>
      <form id="singleForm" data-node="${escapeHtml(node)}" class="single-editor-modal">
        <div class="single-editor-shell">
          ${renderSingleEditorPreviewCard(node, record)}
          <div class="single-editor-main">
            ${renderSingleEditorSummaryGrid(node, record)}
            <div class="single-editor-section-list">
              ${renderSingleEditorFieldSections(node, schema, record)}
            </div>
          </div>
        </div>
        <div class="single-editor-status" id="singleEditorStatus" aria-live="polite"></div>
        <div class="toolbar single-editor-footer" style="margin-top:16px;justify-content:flex-end;">
          <button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>
          <button type="submit" class="btn btn-primary">Save Changes</button>
        </div>
      </form>
    `);
    return;
  }
  openModal(`
    <div class="panel-head">
      <div>
        <h2 class="section-title">${escapeHtml(schema.title)}</h2>
        <p class="section-subtitle">${escapeHtml(schema.description)}</p>
      </div>
      <button class="btn btn-ghost" data-close-modal type="button"><i data-lucide="x"></i></button>
    </div>
    <form id="singleForm" data-node="${escapeHtml(node)}">
      <div class="form-grid">
        ${schema.fields.map((field) => fieldMarkup(field, record[field.key] ?? '')).join('')}
      </div>
      <div class="toolbar" style="margin-top:16px;justify-content:flex-end;">
        <button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>
        <button type="submit" class="btn btn-primary">Save Changes</button>
      </div>
    </form>
  `);
}

function getRangeDays(range = ui.dashboardRange) {
  if (range === 'all') return 365;
  if (range === 'week') return 7;
  if (range === 'month') return 30;
  return 1;
}

function recordTimestamp(item) {
  if (!item) return 0;
  if (typeof item === 'number') return item;
  if (typeof item.timestamp === 'number' && item.timestamp > 0) return item.timestamp;
  if (typeof item.createdAt === 'number' && item.createdAt > 0) return item.createdAt;
  if (typeof item.updatedAt === 'number' && item.updatedAt > 0) return item.updatedAt;
  const raw = item.timestamp || item.createdAt || item.updatedAt || item.date;
  if (!raw) return 0;
  if (typeof raw === 'number') return raw;
  const num = Number(raw);
  if (Number.isFinite(num) && num > 1000000000) return num;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isInRange(timestamp, range) {
  if (range === 'all') return true;
  const days = getRangeDays(range);
  const stamp = typeof timestamp === 'object' ? recordTimestamp(timestamp) : (Number(timestamp) || recordTimestamp({ date: timestamp }));
  return stamp >= Date.now() - (days * 86400000);
}

function parseMetricNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!raw) return 0;
  const parsed = Number(raw[0]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getRangeWindow(range, offset = 0) {
  if (range === 'all') {
    return {
      start: 0,
      end: Date.now() + 86400000,
    };
  }
  const days = getRangeDays(range);
  const end = Date.now() - (offset * days * 86400000);
  return {
    start: end - (days * 86400000),
    end,
  };
}

function isInWindow(timestamp, start, end) {
  const value = typeof timestamp === 'object' ? recordTimestamp(timestamp) : Number(timestamp || 0);
  return value >= start && value < end;
}

function countInWindow(items, start, end, predicate = () => true) {
  return items.filter((item) => isInWindow(recordTimestamp(item), start, end) && predicate(item)).length;
}

function sumInWindow(items, start, end, valueFn = () => 0, predicate = () => true) {
  return items.reduce((total, item) => {
    if (!predicate(item)) return total;
    const stamp = recordTimestamp(item);
    if (!isInWindow(stamp, start, end)) return total;
    return total + parseMetricNumber(valueFn(item));
  }, 0);
}

function dayKey(timestamp) {
  return new Date(Number(timestamp || Date.now())).toISOString().slice(0, 10);
}

function buildSeries(items, range, predicate = () => true) {
  if (range === 'all') {
    const valid = items.filter(predicate);
    const stamps = valid.map(recordTimestamp).filter((s) => s > 0);
    const now = Date.now();
    const minStamp = stamps.length ? Math.min(...stamps) : now - (90 * 86400000);
    const span = Math.max(86400000 * 7, now - minStamp);
    const bucketCount = 14;
    const bucketSize = span / bucketCount;
    const series = [];
    for (let index = 0; index < bucketCount; index += 1) {
      const stamp = minStamp + (index * bucketSize);
      const date = new Date(stamp);
      series.push({
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        date: dayKey(stamp),
        timestamp: stamp,
        count: 0,
      });
    }
    valid.forEach((item) => {
      const stamp = recordTimestamp(item);
      const index = Math.floor((stamp - minStamp) / bucketSize);
      const bucket = series[Math.min(series.length - 1, Math.max(0, index))];
      if (bucket) bucket.count += 1;
    });
    return series;
  }
  const { start, end } = getRangeWindow(range);
  const bucketSize = range === 'day' ? 3600000 : 86400000;
  const bucketCount = range === 'day' ? 24 : getRangeDays(range);
  const series = [];
  for (let index = 0; index < bucketCount; index += 1) {
    const stamp = start + (index * bucketSize);
    const date = new Date(stamp);
    series.push({
      label: range === 'day'
        ? `${String(date.getHours()).padStart(2, '0')}:00`
        : `${date.getMonth() + 1}/${date.getDate()}`,
      date: dayKey(stamp),
      timestamp: stamp,
      count: 0,
    });
  }
  items.filter((item) => predicate(item)).forEach((item) => {
    const stamp = recordTimestamp(item);
    if (!isInWindow(stamp, start, end)) return;
    const index = Math.floor((stamp - start) / bucketSize);
    const bucket = series[Math.min(series.length - 1, Math.max(0, index))];
    if (bucket) bucket.count += 1;
  });
  return series;
}

function buildValueSeries(items, range, valueFn = () => 0, predicate = () => true) {
  if (range === 'all') {
    const valid = items.filter(predicate);
    const stamps = valid.map(recordTimestamp).filter((s) => s > 0);
    const now = Date.now();
    const minStamp = stamps.length ? Math.min(...stamps) : now - (90 * 86400000);
    const span = Math.max(86400000 * 7, now - minStamp);
    const bucketCount = 14;
    const bucketSize = span / bucketCount;
    const series = [];
    for (let index = 0; index < bucketCount; index += 1) {
      const stamp = minStamp + (index * bucketSize);
      const date = new Date(stamp);
      series.push({
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        date: dayKey(stamp),
        timestamp: stamp,
        count: 0,
      });
    }
    valid.forEach((item) => {
      const stamp = recordTimestamp(item);
      const index = Math.floor((stamp - minStamp) / bucketSize);
      const bucket = series[Math.min(series.length - 1, Math.max(0, index))];
      if (bucket) bucket.count += parseMetricNumber(valueFn(item));
    });
    return series;
  }
  const { start, end } = getRangeWindow(range);
  const bucketSize = range === 'day' ? 3600000 : 86400000;
  const bucketCount = range === 'day' ? 24 : getRangeDays(range);
  const series = [];
  for (let index = 0; index < bucketCount; index += 1) {
    const stamp = start + (index * bucketSize);
    const date = new Date(stamp);
    series.push({
      label: range === 'day'
        ? `${String(date.getHours()).padStart(2, '0')}:00`
        : `${date.getMonth() + 1}/${date.getDate()}`,
      date: dayKey(stamp),
      timestamp: stamp,
      count: 0,
    });
  }
  items.filter((item) => predicate(item)).forEach((item) => {
    const stamp = recordTimestamp(item);
    if (!isInWindow(stamp, start, end)) return;
    const index = Math.floor((stamp - start) / bucketSize);
    const bucket = series[Math.min(series.length - 1, Math.max(0, index))];
    if (bucket) bucket.count += parseMetricNumber(valueFn(item));
  });
  return series;
}

function countInRange(items, range, predicate = () => true) {
  return items.filter((item) => isInRange(recordTimestamp(item), range) && predicate(item)).length;
}

function percentChange(current, previous) {
  if (!previous) return current ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function summarizeDashboard(range = ui.dashboardRange) {
  const rawVisitors = listCollection('visitors');
  const orders = listCollection('orders');
  const events = listCollection('events');
  const products = listCollection('products');
  const currentWindow = getRangeWindow(range);
  const previousWindow = getRangeWindow(range, 1);
  const clickPredicate = (item) => {
    const type = String(item.type || '').toLowerCase();
    if (type === 'telegram_click' || type === 'review_submission' || type === 'visitor') return false;
    return type.includes('order') || type.includes('click') || type.includes('buy') || Boolean(item.productId || item.package || item.productName);
  };
  const isPureVisitor = (item) => !clickPredicate(item);
  const visitors = rawVisitors.filter(isPureVisitor);
  const allClicks = [...events, ...rawVisitors.filter(clickPredicate)];
  const directProductClicks = products.reduce((sum, p) => sum + Number(p.clicks || p.orderClicks || 0), 0);

  // Cumulative all-time real metrics from linkadda.shop RTDB
  const lifetimeClicks = allClicks.filter(clickPredicate).length || directProductClicks;
  const lifetimeOrders = orders.length;
  const lifetimeVisitors = visitors.length;
  const lifetimeRevenue = orders.reduce((sum, item) => isPaidOrder(item) ? sum + parseMetricNumber(item.amount || item.amountINR || item.inr) : sum, 0);

  const currentVisitors = range === 'all' ? lifetimeVisitors : countInWindow(visitors, currentWindow.start, currentWindow.end);
  const currentOrders = range === 'all' ? lifetimeOrders : countInWindow(orders, currentWindow.start, currentWindow.end);
  const eventsCount = range === 'all' ? lifetimeClicks : countInWindow(allClicks, currentWindow.start, currentWindow.end, clickPredicate);
  const currentClicks = eventsCount > 0 ? eventsCount : (range === 'all' ? directProductClicks : 0);
  const currentRevenue = range === 'all' ? lifetimeRevenue : sumInWindow(orders, currentWindow.start, currentWindow.end, (item) => item.amount, isPaidOrder);

  const prevVisitors = countInWindow(visitors, previousWindow.start, previousWindow.end);
  const prevOrders = countInWindow(orders, previousWindow.start, previousWindow.end);
  const prevClicks = countInWindow(allClicks, previousWindow.start, previousWindow.end, clickPredicate);
  const prevRevenue = sumInWindow(orders, previousWindow.start, previousWindow.end, (item) => item.amount, isPaidOrder);

  const topProducts = buildTopProducts({ range, clicks: currentClicks });
  const top = topProducts[0] ? [topProducts[0].title || topProducts[0].name, topProducts[0].clicks] : [];
  return {
    range,
    rangeDays: getRangeDays(range),
    visitors: currentVisitors,
    visitorsPrev: prevVisitors,
    visitorsTrend: range === 'all' ? 100 : percentChange(currentVisitors, prevVisitors),
    clicks: currentClicks,
    clicksPrev: prevClicks,
    clicksTrend: range === 'all' ? 100 : percentChange(currentClicks, prevClicks),
    orders: currentOrders,
    ordersPrev: prevOrders,
    ordersTrend: range === 'all' ? 100 : percentChange(currentOrders, prevOrders),
    revenue: currentRevenue,
    revenuePrev: prevRevenue,
    revenueTrend: range === 'all' ? 100 : percentChange(currentRevenue, prevRevenue),
    visitorSeries: buildSeries(visitors, range),
    clickSeries: buildSeries(allClicks, range, clickPredicate),
    orderSeries: buildSeries(orders, range),
    revenueSeries: buildValueSeries(orders, range, (item) => item.amount, isPaidOrder),
    topClicked: topProducts.map((p) => [p.title || p.name, p.clicks]),
    topProductName: top[0] || 'None',
    topProductClicks: top[1] || 0,
    totals: {
      ...stats(),
      lifetimeClicks,
      lifetimeOrders,
      lifetimeVisitors,
      lifetimeRevenue,
    },
    liveProducts: products.length,
    liveCategories: listCollection('categories').length,
    mediaAssets: listCollection('media').length,
  };
}

function renderRangeSwitch() {
  return `
    <div class="range-switch">
      ${[
        ['all', 'All Time'],
        ['month', '30D'],
        ['week', '7D'],
        ['day', '24H'],
      ].map(([range, label]) => `
        <button class="range-pill ${ui.dashboardRange === range ? 'active' : ''}" data-action="set-range" data-range="${range}">
          ${escapeHtml(label)}
        </button>
      `).join('')}
    </div>
  `;
}

function renderTrendBars(series, tone = 'primary') {
  const max = Math.max(1, ...series.map((item) => item.count));
  return series.map((item) => `
    <div class="trend-row">
      <span>${escapeHtml(item.label || item.date.slice(5))}</span>
      <div class="trend-track">
        <div class="trend-fill ${tone}" style="width:${Math.max(6, (item.count / max) * 100)}%"></div>
      </div>
      <strong>${escapeHtml(String(item.count))}</strong>
    </div>
  `).join('');
}

function formatTrendValue(value) {
  return `${value >= 0 ? '+' : ''}${escapeHtml(String(value))}%`;
}

function renderSparkline(series, tone = 'primary') {
  const values = series.map((item) => Number(item.count || 0));
  const max = Math.max(1, ...values);
  const width = 120;
  const height = 36;
  const padding = 4;
  const innerWidth = width - (padding * 2);
  const innerHeight = height - (padding * 2);
  const points = series.map((item, index) => {
    const x = series.length > 1 ? padding + (index * (innerWidth / (series.length - 1))) : width / 2;
    const y = padding + ((1 - (Number(item.count || 0) / max)) * innerHeight);
    return { x, y };
  });
  const linePath = points.length ? `M ${points[0].x} ${points[0].y} ${points.slice(1).map((point) => `L ${point.x} ${point.y}`).join(' ')}` : '';
  const areaPath = points.length ? `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z` : '';
  return `
    <svg class="sparkline ${tone}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      ${areaPath ? `<path class="sparkline-area" d="${areaPath}"></path>` : ''}
      ${linePath ? `<path class="sparkline-line" d="${linePath}"></path>` : ''}
    </svg>
  `;
}

function renderDashboardMetricSwitch(summary) {
  const options = [
    { key: 'visitors', label: 'Visitors', value: summary.visitorSeries, tone: 'primary' },
    { key: 'clicks', label: 'Clicks', value: summary.clickSeries, tone: 'secondary' },
    { key: 'orders', label: 'Orders', value: summary.orderSeries, tone: 'success' },
  ];
  return `
    <div class="metric-switch">
      ${options.map((item) => `
        <button class="metric-switch-btn ${ui.dashboardMetric === item.key ? 'active' : ''}" data-action="set-dashboard-metric" data-metric="${escapeHtml(item.key)}" type="button">
          ${escapeHtml(item.label)}
        </button>
      `).join('')}
    </div>
  `;
}

function renderTrafficChart(summary = summarizeDashboard()) {
  const config = {
    visitors: {
      label: 'Visitors',
      value: summary.visitors,
      trend: summary.visitorsTrend,
      series: summary.visitorSeries,
      tone: 'primary',
      copy: 'Unique visitor sessions in the selected range.',
    },
    clicks: {
      label: 'Order Clicks',
      value: summary.clicks,
      trend: summary.clicksTrend,
      series: summary.clickSeries,
      tone: 'secondary',
      copy: 'Product card interactions recorded from the live site.',
    },
    orders: {
      label: 'Orders',
      value: summary.orders,
      trend: summary.ordersTrend,
      series: summary.orderSeries,
      tone: 'success',
      copy: 'Completed payment records collected in the selected range.',
    },
  }[ui.dashboardMetric] || {
    label: 'Visitors',
    value: summary.visitors,
    trend: summary.visitorsTrend,
    series: summary.visitorSeries,
    tone: 'primary',
    copy: 'Unique visitor sessions in the selected range.',
  };
  const values = config.series.map((item) => Number(item.count || 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  const peak = values.length ? Math.max(...values) : 0;
  const average = values.length ? Math.round(total / values.length) : 0;
  const latest = values.length ? values[values.length - 1] : 0;
  const max = Math.max(1, ...values);
  const width = 960;
  const height = 320;
  const padding = 28;
  const innerWidth = width - (padding * 2);
  const innerHeight = height - (padding * 2);
  const points = config.series.map((item, index) => {
    const x = config.series.length > 1 ? padding + (index * (innerWidth / (config.series.length - 1))) : width / 2;
    const y = padding + ((1 - (Number(item.count || 0) / max)) * innerHeight);
    return { x, y, label: item.label, count: Number(item.count || 0) };
  });
  const linePath = points.length ? `M ${points[0].x} ${points[0].y} ${points.slice(1).map((point) => `L ${point.x} ${point.y}`).join(' ')}` : '';
  const areaPath = points.length ? `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z` : '';
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelStep = Math.max(1, Math.floor(points.length / 5));
  return `
    <section class="panel glass dashboard-chart-panel">
      <div class="panel-head dashboard-chart-head">
        <div>
          <h3>Traffic Overview</h3>
          <p class="section-subtitle">Switch between visitors, clicks, and orders for the selected period.</p>
        </div>
        ${renderDashboardMetricSwitch(summary)}
      </div>
      <div class="dashboard-chart-shell">
        <div class="dashboard-chart-copy">
          <span class="chart-eyebrow">${escapeHtml(config.label)}</span>
          <strong>${escapeHtml(formatNumber(config.value))}</strong>
          <p>${escapeHtml(config.copy)}</p>
          <div class="chart-mini-stats">
            <div>
              <span>Peak</span>
              <strong>${escapeHtml(formatNumber(peak))}</strong>
            </div>
            <div>
              <span>Average</span>
              <strong>${escapeHtml(formatNumber(average))}</strong>
            </div>
            <div>
              <span>Latest</span>
              <strong>${escapeHtml(formatNumber(latest))}</strong>
            </div>
          </div>
        </div>
        <div class="dashboard-chart-area">
          ${points.some((point) => point.count > 0) ? `
            <svg class="dashboard-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(config.label)} chart">
              <defs>
                <linearGradient id="chartGradient-${escapeHtml(ui.dashboardMetric)}" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.34"></stop>
                  <stop offset="100%" stop-color="var(--primary)" stop-opacity="0.02"></stop>
                </linearGradient>
              </defs>
              ${ticks.map((tick) => `
                <line class="chart-grid-line" x1="0" y1="${padding + (innerHeight * tick)}" x2="${width}" y2="${padding + (innerHeight * tick)}"></line>
              `).join('')}
              ${points.map((point, index) => (index % labelStep === 0 || index === points.length - 1) ? `
                <text class="chart-axis-label" x="${point.x}" y="${height - 8}" text-anchor="middle">${escapeHtml(point.label)}</text>
              ` : '').join('')}
              ${areaPath ? `<path class="chart-area" d="${areaPath}" fill="url(#chartGradient-${escapeHtml(ui.dashboardMetric)})"></path>` : ''}
              ${linePath ? `<path class="chart-line" d="${linePath}"></path>` : ''}
              ${points.map((point) => `
                <circle class="chart-point" cx="${point.x}" cy="${point.y}" r="4"></circle>
              `).join('')}
            </svg>
          ` : `
            <div class="empty-state dashboard-chart-empty">No ${escapeHtml(config.label.toLowerCase())} data in this range yet.</div>
          `}
        </div>
      </div>
    </section>
  `;
}

function doesEventMatchProduct(event = {}, prod = {}, allOrders = []) {
  if (!event || !prod) return false;

  const eventProdId = String(event.productId || event.product_id || '').trim();
  const prodId = String(prod.id || prod.key || '').trim();
  if (eventProdId && prodId && eventProdId === prodId) return true;

  if (event.href && prodId) {
    try {
      const u = new URL(event.href, 'http://localhost');
      const pId = u.searchParams.get('productId') || u.searchParams.get('id');
      if (pId && pId === prodId) return true;
    } catch (_) {}
  }

  const norm = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const prodHaystacks = [prod.title, prod.name, prod.slug].map(norm).filter((s) => s.length >= 2);
  const eventNeedles = [event.package, event.productName, event.title, event.name, event.label].map(norm).filter((s) => s.length >= 2);

  for (const needle of eventNeedles) {
    if (['order', 'product', 'buy', 'click', 'event', 'unknown'].includes(needle)) continue;
    for (const haystack of prodHaystacks) {
      if (needle === haystack) return true;
      if (needle.length > haystack.length && needle.includes(haystack)) return true;
      if (haystack.length > needle.length && haystack.includes(needle)) return true;
    }
  }

  // Correlate with orders by timestamp (within 30 seconds)
  const evTs = recordTimestamp(event);
  if (evTs && Array.isArray(allOrders) && allOrders.length) {
    const matchedOrder = allOrders.find((ord) => {
      const ordTs = recordTimestamp(ord);
      return ordTs && Math.abs(ordTs - evTs) <= 30000;
    });
    if (matchedOrder) {
      const ordProdId = String(matchedOrder.productId || matchedOrder.product_id || '').trim();
      if (ordProdId && prodId && ordProdId === prodId) return true;

      const ordNeedles = [matchedOrder.package, matchedOrder.productName, matchedOrder.title, matchedOrder.name].map(norm).filter((s) => s.length >= 2);
      for (const needle of ordNeedles) {
        if (['order', 'product', 'buy', 'click', 'event', 'unknown'].includes(needle)) continue;
        for (const haystack of prodHaystacks) {
          if (needle === haystack) return true;
          if (needle.length > haystack.length && needle.includes(haystack)) return true;
          if (haystack.length > needle.length && haystack.includes(needle)) return true;
        }
      }
    }
  }

  // Match by price if event recorded amount
  const evAmount = String(event.amountINR || event.amount || '').replace(/[^0-9.]/g, '');
  if (evAmount && Number(evAmount) > 0) {
    const prodAmount = String(prod.priceINR || prod.price || '').replace(/[^0-9.]/g, '');
    if (prodAmount && prodAmount === evAmount) return true;
  }

  return false;
}

function buildTopProducts(summary = {}) {
  const range = summary.range || ui.dashboardRange;
  const isOrderClick = (item) => {
    const type = String(item.type || '').toLowerCase();
    if (type === 'telegram_click' || type === 'review_submission' || type === 'visitor') return false;
    return type.includes('order') || type.includes('click') || type.includes('buy') || Boolean(item.productId || item.package || item.productName);
  };
  const allClickEvents = [...listCollection('events'), ...listCollection('visitors').filter(isOrderClick)];
  const events = allClickEvents.filter((item) => isInRange(recordTimestamp(item), range) && isOrderClick(item));
  const orders = listCollection('orders').filter((item) => isInRange(recordTimestamp(item), range));
  const allOrders = listCollection('orders');
  const products = listCollection('products').filter((item) => item.status !== 'deleted');

  const matchedEvents = new Set();

  const productsWithStats = products.map((prod) => {
    const matchedEvs = events.filter((ev) => {
      const match = doesEventMatchProduct(ev, prod, allOrders);
      if (match) matchedEvents.add(ev.id || ev.timestamp || ev);
      return match;
    });
    const orderCount = orders.filter((ord) => doesEventMatchProduct(ord, prod, allOrders)).length;
    return {
      ...prod,
      image: prod.image || (Array.isArray(prod.galleryImages) ? prod.galleryImages[0] : '') || '',
      clicks: Math.max(matchedEvs.length, Number(prod.clicks || prod.orderClicks || 0)),
      orders: orderCount,
      score: (orderCount * 3) + Math.max(matchedEvs.length, Number(prod.clicks || prod.orderClicks || 0)),
    };
  });

  const totalBase = summary.clicks || events.length || 1;
  const unassignedClicks = Math.max(0, events.length - matchedEvents.size);

  if (unassignedClicks > 0 && productsWithStats.length > 0) {
    productsWithStats.push({
      id: 'direct-orders',
      title: 'Direct Store Orders',
      name: 'Direct Store Orders',
      category: 'Store',
      image: '',
      clicks: unassignedClicks,
      orders: 0,
      score: unassignedClicks,
    });
  }

  productsWithStats.forEach((p) => {
    p.share = totalBase ? Math.min(100, Math.round((p.clicks / totalBase) * 100)) : 0;
  });

  productsWithStats.sort((a, b) => b.clicks - a.clicks || b.orders - a.orders || (b.updatedAt || 0) - (a.updatedAt || 0));

  return productsWithStats.slice(0, 6);
}

function buildAnalyticsChartModel(series = []) {
  const values = series.map((item) => Number(item.count || 0));
  const hasData = values.some((value) => value > 0);
  const max = Math.max(1, ...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  const peak = values.length ? Math.max(...values) : 0;
  const average = values.length ? Math.round(total / values.length) : 0;
  const latest = values.length ? values[values.length - 1] : 0;
  const width = 960;
  const height = 320;
  const padding = 30;
  const innerWidth = width - (padding * 2);
  const innerHeight = height - (padding * 2);
  const points = series.map((item, index) => {
    const x = series.length > 1 ? padding + (index * (innerWidth / (series.length - 1))) : width / 2;
    const value = Number(item.count || 0);
    const y = padding + ((1 - (value / max)) * innerHeight);
    return {
      x,
      y,
      count: value,
      label: item.label,
      date: item.date,
    };
  });
  const linePath = points.length ? `M ${points[0].x} ${points[0].y} ${points.slice(1).map((point) => `L ${point.x} ${point.y}`).join(' ')}` : '';
  const areaPath = points.length ? `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z` : '';
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
    value: hasData ? Math.round(max * (1 - fraction)) : 0,
    y: padding + (innerHeight * fraction),
  }));
  return {
    width,
    height,
    padding,
    innerWidth,
    innerHeight,
    points,
    linePath,
    areaPath,
    yTicks,
    total,
    peak,
    average,
    latest,
    max,
  };
}

function getAnalyticsToneColor(tone = 'primary') {
  if (tone === 'secondary') return '#0ea5e9';
  if (tone === 'success') return 'var(--success)';
  if (tone === 'accent') return '#f472b6';
  return 'var(--primary)';
}

function renderAnalyticsChart({ id, title, copy, series, tone = 'primary', metricLabel = 'events' }) {
  const model = buildAnalyticsChartModel(series);
  const labelStep = Math.max(1, Math.ceil(model.points.length / 6));
  const gradientId = `analytics-gradient-${id}`;
  const toneColor = getAnalyticsToneColor(tone);
  return `
    <section class="panel glass analytics-chart-panel" data-analytics-chart data-chart-id="${escapeHtml(id)}" data-chart-label="${escapeHtml(metricLabel)}">
      <div class="analytics-chart-head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(copy)}</p>
        </div>
        <div class="analytics-chart-summary">
          <span>Peak</span>
          <strong>${escapeHtml(formatNumber(model.peak))}</strong>
          <span>Average ${escapeHtml(formatNumber(model.average))}</span>
        </div>
      </div>
      <div class="analytics-chart-shell">
        <div class="analytics-chart-copy">
          <div class="analytics-chart-stat">
            <span>Total</span>
            <strong>${escapeHtml(formatNumber(model.total))}</strong>
          </div>
          <div class="analytics-chart-stat">
            <span>Latest</span>
            <strong>${escapeHtml(formatNumber(model.latest))}</strong>
          </div>
        </div>
        <div class="analytics-chart-area">
          <svg class="analytics-chart" viewBox="0 0 ${model.width} ${model.height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(title)} chart">
            <defs>
              <linearGradient id="${escapeHtml(gradientId)}" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="${escapeHtml(toneColor)}" stop-opacity="0.34"></stop>
                <stop offset="100%" stop-color="${escapeHtml(toneColor)}" stop-opacity="0.02"></stop>
              </linearGradient>
            </defs>
            ${model.yTicks.map((tick) => `
              <line class="analytics-chart-gridline" x1="${model.padding}" y1="${tick.y}" x2="${model.width - model.padding}" y2="${tick.y}"></line>
              <text class="analytics-chart-axis-y" x="${model.padding - 10}" y="${tick.y}" text-anchor="end" dominant-baseline="middle">${escapeHtml(formatNumber(tick.value))}</text>
            `).join('')}
            ${model.points.map((point, index) => (index % labelStep === 0 || index === model.points.length - 1) ? `
              <text class="analytics-chart-axis-x" x="${point.x}" y="${model.height - 10}" text-anchor="middle">${escapeHtml(point.label || '')}</text>
            ` : '').join('')}
            ${model.areaPath ? `<path class="analytics-chart-area ${escapeHtml(tone)}" d="${model.areaPath}" fill="url(#${escapeHtml(gradientId)})"></path>` : ''}
            ${model.linePath ? `<path class="analytics-chart-line ${escapeHtml(tone)}" d="${model.linePath}"></path>` : ''}
            ${model.points.map((point) => `
              <g class="analytics-chart-point-group" data-chart-point tabindex="0" role="img" aria-label="${escapeHtml(`${point.label}: ${formatNumber(point.count)} ${metricLabel}`)}" data-label="${escapeHtml(point.label || '')}" data-value="${escapeHtml(String(point.count))}" data-series="${escapeHtml(metricLabel)}" data-point-x="${escapeHtml(String(point.x))}" data-point-y="${escapeHtml(String(point.y))}">
                <circle class="analytics-chart-hit" cx="${point.x}" cy="${point.y}" r="16"></circle>
                <circle class="analytics-chart-point ${escapeHtml(tone)}" cx="${point.x}" cy="${point.y}" r="4"></circle>
              </g>
            `).join('')}
          </svg>
          <div class="analytics-chart-tooltip" data-role="chart-tooltip" aria-hidden="true"></div>
        </div>
      </div>
    </section>
  `;
}

function renderAnalyticsKpis(summary, topProduct) {
  const conversionRate = summary.visitors ? Math.round((summary.orders / summary.visitors) * 1000) / 10 : 0;
  const topName = topProduct?.title || topProduct?.name || 'No top product yet';
  const topClicks = Number(topProduct?.clicks || 0);
  return `
    <div class="analytics-kpi-grid">
      ${renderCompactStatCard('Visitors', summary.visitors, `vs previous ${summary.range}`, 'users', 'primary')}
      ${renderCompactStatCard('Order Clicks', summary.clicks, `vs previous ${summary.range}`, 'mouse-pointer-click', 'secondary')}
      ${renderCompactStatCard('Orders', summary.orders, `vs previous ${summary.range}`, 'receipt-text', 'success')}
      ${renderCompactStatCard('Conversion Rate', `${conversionRate.toFixed(1)}%`, `${summary.orders} orders from ${summary.visitors} visitors`, 'arrow-right-left', 'accent')}
      <div class="compact-stat glass analytics-top-product-card">
        <div class="compact-stat-top">
          <span class="compact-stat-label">Top Product</span>
          <span class="kpi-icon accent"><i data-lucide="award"></i></span>
        </div>
        <div class="analytics-top-product-name">${escapeHtml(topName)}</div>
        <span>${escapeHtml(topClicks ? `${formatNumber(topClicks)} clicks` : 'No clicks yet')}</span>
      </div>
    </div>
  `;
}

function renderTopProductsAnalytics(products, totalClicks) {
  if (!products.length) {
    return '<div class="empty-state analytics-empty">No click data yet for this range.</div>';
  }
  return `
    <div class="analytics-product-list">
      ${products.map((item, index) => {
        const share = item.share || 0;
        const rankClass = index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : '';
        const rankLabel = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
        return `
        <div class="analytics-product-row ${rankClass}">
          <div class="analytics-row-progress-fill" style="width: ${share}%;"></div>
          <div class="analytics-product-rank">${rankLabel}</div>
          <div class="analytics-product-thumb">
            ${item.image ? `<img src="${escapeHtml(resolveMediaSource(item.image) || item.image)}" alt="${escapeHtml(item.title || 'Product')}" loading="lazy" />` : '<div class="analytics-thumb-fallback"><i data-lucide="package"></i></div>'}
          </div>
          <div class="analytics-product-meta">
            <div class="analytics-product-head-line">
              <strong class="analytics-product-title">${escapeHtml(item.title || item.name || item.slug || 'Untitled product')}</strong>
              <span class="analytics-category-badge">${escapeHtml(item.category || 'General')}</span>
            </div>
          </div>
          <div class="analytics-product-stats">
            <span class="analytics-clicks-count">${escapeHtml(formatNumber(item.clicks || 0))} clicks</span>
            <span class="analytics-share-badge">${escapeHtml(String(share))}%</span>
          </div>
        </div>
      `;
      }).join('')}
    </div>
  `;
}

function mountAnalyticsCharts() {
  const charts = [...viewRoot.querySelectorAll('[data-analytics-chart]')];
  charts.forEach((chart) => {
    const tooltip = chart.querySelector('[data-role="chart-tooltip"]');
    const points = [...chart.querySelectorAll('[data-chart-point]')];
    if (!tooltip || !points.length) return;
    const hideTooltip = () => {
      tooltip.classList.remove('visible');
      tooltip.setAttribute('aria-hidden', 'true');
    };
    const showTooltip = (point, event) => {
      const label = point.dataset.label || '';
      const value = Number(point.dataset.value || 0);
      const series = point.dataset.series || 'events';
      const rect = chart.querySelector('.analytics-chart-area')?.getBoundingClientRect();
      if (!rect) return;
      const pointRect = point.getBoundingClientRect();
      const x = event?.clientX ? event.clientX - rect.left : (pointRect.left - rect.left) + (pointRect.width / 2);
      const y = event?.clientY ? event.clientY - rect.top : (pointRect.top - rect.top);
      tooltip.innerHTML = `
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(formatNumber(value))} ${escapeHtml(series)}</span>
      `;
      tooltip.style.left = `${Math.min(rect.width - 60, Math.max(60, x))}px`;
      tooltip.style.top = `${Math.min(rect.height - 12, Math.max(12, y))}px`;
      if (y < 55) {
        tooltip.classList.add('tooltip-bottom');
      } else {
        tooltip.classList.remove('tooltip-bottom');
      }
      tooltip.classList.add('visible');
      tooltip.setAttribute('aria-hidden', 'false');
    };
    points.forEach((point) => {
      point.addEventListener('pointerenter', (event) => showTooltip(point, event));
      point.addEventListener('pointermove', (event) => showTooltip(point, event));
      point.addEventListener('focus', (event) => showTooltip(point, event));
      point.addEventListener('blur', hideTooltip);
      point.addEventListener('pointerleave', hideTooltip);
    });
    chart.addEventListener('mouseleave', hideTooltip);
  });
}

function getActivityIcon(type) {
  const value = String(type || '').toLowerCase();
  if (value.includes('order')) return 'shopping-bag';
  if (value.includes('click')) return 'mouse-pointer-click';
  if (value.includes('visitor')) return 'users';
  if (value.includes('product') || value.includes('catalog')) return 'package';
  return 'sparkles';
}

function renderKpiCard({ label, value, change, note, icon, series, tone, valuePrefix = '' }) {
  return `
    <article class="kpi-card glass ${change !== null && change !== undefined ? 'kpi-card-dynamic' : ''}">
      <div class="kpi-card-top">
        <span class="kpi-label">${escapeHtml(label)}</span>
        <span class="kpi-icon ${escapeHtml(tone)}"><i data-lucide="${escapeHtml(icon)}"></i></span>
      </div>
      <div class="kpi-value">${escapeHtml(valuePrefix)}${escapeHtml(String(value))}</div>
      <div class="kpi-meta">
        <span class="kpi-change ${change >= 0 ? 'up' : 'down'}">${formatTrendValue(change || 0)}</span>
        <span>${escapeHtml(note)}</span>
      </div>
      <div class="kpi-sparkline">${renderSparkline(series, tone)}</div>
    </article>
  `;
}

function renderCompactStatCard(label, value, note, icon, tone = 'primary') {
  return `
    <div class="compact-stat glass">
      <div class="compact-stat-top">
        <span class="compact-stat-label">${escapeHtml(label)}</span>
        <span class="kpi-icon ${escapeHtml(tone)}"><i data-lucide="${escapeHtml(icon)}"></i></span>
      </div>
      <strong>${escapeHtml(String(value))}</strong>
      <span>${escapeHtml(note)}</span>
    </div>
  `;
}

function renderNotificationsPanel(summary = summarizeDashboard()) {
  const activity = recentActivity(12);
  return `
    <div class="panel-head">
      <div>
        <h2 class="section-title">Live Alerts</h2>
        <p class="section-subtitle">Recent visitors, click events, and order updates from the site.</p>
      </div>
      <button class="btn btn-ghost" data-close-modal type="button"><i data-lucide="x"></i></button>
    </div>
    <div class="notification-summary">
      <div class="summary-card">
        <span>${escapeHtml(summary.range)} Visitors</span>
        <strong>${escapeHtml(String(summary.visitors))}</strong>
      </div>
      <div class="summary-card">
        <span>Order Clicks</span>
        <strong>${escapeHtml(String(summary.clicks))}</strong>
      </div>
      <div class="summary-card">
        <span>Orders</span>
        <strong>${escapeHtml(String(summary.orders))}</strong>
      </div>
    </div>
    <div class="timeline-list notification-list">
      ${activity.length ? activity.map((item) => `
        <div class="timeline-item">
          <div class="timeline-dot"><i data-lucide="${escapeHtml(getActivityIcon(item.type))}"></i></div>
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <div class="meta">${escapeHtml(item.type)} - ${escapeHtml(item.meta || 'live')} - ${escapeHtml(formatDateTime(item.timestamp))}</div>
          </div>
        </div>
      `).join('') : '<div class="empty-state">No alerts yet.</div>'}
    </div>
  `;
}

function getCatalogMeta(tab = ui.catalogTab) {
  const node = tab === 'categories' ? 'categories' : 'products';
  return {
    node,
    schema: collectionSchemas[node],
    title: node === 'products' ? 'Products' : 'Categories',
    subtitle: node === 'products'
      ? 'Manage the live product cards that appear on the public site.'
      : 'Manage the live category cards and the way they group catalog content.',
  };
}

function summarizeSources() {
  const mStats = mediaStats(getAllUnifiedMediaItems(ui.data || {}));
  return [
    { label: 'Firebase RTDB', value: `${stats().products + stats().categories + stats().orders} live records` },
    { label: 'Media Assets', value: `${mStats.active} active (${mStats.total} total)` },
    { label: 'Public Site', value: 'Live catalog sync enabled' },
  ];
}

function resolveMediaSource(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';
  
  if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  
  const normalized = normalizeAssetValue(raw);
  const match = listCollection('media').find((item) => mediaMatchesReference(item, normalized) || mediaMatchesReference(item, raw));
  if (match?.publicUrl) {
    return match.publicUrl;
  }
  if (raw.startsWith('products/') || raw.startsWith('categories/') || raw.startsWith('logos/') || raw.startsWith('hero/') || raw.startsWith('banners/') || raw.startsWith('testimonials/')) {
    return `/media/${raw}`;
  }
  if (raw.startsWith('images/') || raw.startsWith('/images/')) {
    return raw.startsWith('/') ? raw : `/${raw}`;
  }
  return `/media/products/${raw.replace(/^\/+/, '')}`;
}

function mediaPreview(item) {
  let rawSrc = item.image
    || item.imageUrl
    || item.thumbnail
    || item.publicUrl
    || item.photo
    || (Array.isArray(item.images) ? item.images[0] : '')
    || (Array.isArray(item.galleryImages) ? item.galleryImages[0] : '')
    || item.cover
    || item.video
    || item.logo
    || item.backgroundImage
    || item.bannerImage
    || item.heroImage
    || item.path
    || '';

  if (!rawSrc && item.category) {
    const categories = listCollection('categories');
    const catKey = String(item.category).trim().toLowerCase();
    const matched = categories.find(c => 
      String(c.id || '').toLowerCase() === catKey || 
      String(c.slug || '').toLowerCase() === catKey || 
      String(c.title || '').toLowerCase() === catKey
    );
    if (matched) {
      rawSrc = matched.image || (Array.isArray(matched.images) ? matched.images[0] : '');
    }
  }

  const src = resolveMediaSource(rawSrc);
  if (!src) return '';
  if (String(item.type || '').toLowerCase() === 'video' || /\.(mp4|webm|mov|m4v)$/i.test(src)) {
    return `<video class="thumb-media" src="${escapeHtml(src)}" preload="none" muted loop playsinline></video>`;
  }
  const fn = src.split('/').pop().split('?')[0];
  const localFallback = `../images/${fn}`;
  return `<img class="thumb-media" src="${escapeHtml(src)}" alt="${escapeHtml(item.title || item.name || 'Preview')}" loading="lazy" decoding="async" onerror="if(this.src!=='${localFallback}' && !this._triedLocal){this._triedLocal=true; this.src='${localFallback}';}" />`;
}

function renderDataPill(label, value) {
  return `
    <div class="data-pill">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function getCatalogItems(node) {
  return node === 'categories' ? listCollection('categories') : listCollection('products');
}

function getCatalogCounts() {
  const products = listCollection('products').filter((item) => item.status !== 'deleted');
  const categories = listCollection('categories').filter((item) => item.status !== 'deleted');
  const allMedia = getAllUnifiedMediaItems(ui.data || {});
  const mStats = mediaStats(allMedia);
  const latestStamp = [...products, ...categories, ...allMedia]
    .map((item) => Number(item.updatedAt || item.createdAt || 0))
    .filter(Boolean)
    .sort((a, b) => b - a)[0] || 0;
  return {
    products: products.length,
    categories: categories.length,
    images: mStats.active,
    lastSync: latestStamp,
  };
}

function getCategoryOptions() {
  const categories = listCollection('categories')
    .filter((item) => item.status !== 'deleted')
    .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  const productCats = listCollection('products')
    .filter((item) => item.status !== 'deleted' && item.category)
    .map((item) => String(item.category || '').trim())
    .filter(Boolean);
  const merged = new Map();
  [...categories.map((item) => ({
    value: item.slug || item.title || item.id,
    label: item.title || item.slug || item.id,
  })), ...productCats.map((item) => ({
    value: slugify(item) || item,
    label: item,
  }))].forEach((item) => {
    if (!item.value || merged.has(item.value)) return;
    merged.set(item.value, item.label);
  });
  return [...merged.entries()].map(([value, label]) => ({ value, label }));
}

function countProductsForCategory(category) {
  const title = String(category?.title || '').trim().toLowerCase();
  const slug = String(category?.slug || '').trim().toLowerCase();
  return listCollection('products').filter((item) => {
    const value = String(item.category || '').trim().toLowerCase();
    return value === title || value === slug;
  }).length;
}

function normalizeFeatureList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function catalogImageCount(item) {
  const gallery = Array.isArray(item.galleryImages) ? item.galleryImages.filter(Boolean).length : 0;
  const images = Array.isArray(item.images) ? item.images.filter(Boolean).length : 0;
  let count = Math.max(images, gallery + (item.image ? 1 : 0));
  if (count === 0 && item.category) {
    const categories = listCollection('categories');
    const catKey = String(item.category).trim().toLowerCase();
    const matched = categories.find(c => 
      String(c.id || '').toLowerCase() === catKey || 
      String(c.slug || '').toLowerCase() === catKey || 
      String(c.title || '').toLowerCase() === catKey ||
      (catKey && String(c.id || '').toLowerCase().includes(catKey))
    );
    if (matched) {
      const catGallery = Array.isArray(matched.galleryImages) ? matched.galleryImages.filter(Boolean).length : 0;
      const catImages = Array.isArray(matched.images) ? matched.images.filter(Boolean).length : 0;
      count = Math.max(catImages, catGallery + (matched.image ? 1 : 0));
    }
  }
  return count > 0 ? count : (item.image ? 1 : 4);
}

function catalogMetaValue(item, key) {
  const value = item?.[key];
  if (key === 'updatedAt' || key === 'createdAt') return formatDateTime(value);
  if (key === 'status') return String(value || 'active');
  return String(value || '-');
}

function catalogCardBadge(status) {
  const value = String(status || 'active').toLowerCase();
  if (value === 'pending' || value === 'pending_approval') {
    return `<span class="badge warning" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-weight: 700;">⏳ Pending Approval</span>`;
  }
  const cls = value === 'active' ? 'success' : value === 'hidden' ? 'warning' : value === 'draft' ? 'badge' : 'danger';
  return `<span class="badge ${cls}">${escapeHtml(value)}</span>`;
}

function selectSelection(ids = [], enabled = true) {
  const nextIds = Array.isArray(ids) ? ids : [ids];
  nextIds.filter(Boolean).forEach((id) => {
    if (enabled) ui.selection.add(id);
    else ui.selection.delete(id);
  });
}

function clearSelection() {
  ui.selection.clear();
}

function isSelected(id) {
  return ui.selection.has(id);
}

function toggleSelection(id) {
  if (!id) return;
  if (ui.selection.has(id)) ui.selection.delete(id);
  else ui.selection.add(id);
}

function itemPreviewThumb(item) {
  return mediaPreview(item) || '<div class="preview-fallback">No image</div>';
}

function extractMediaUrls(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.flatMap(extractMediaUrls);
  if (typeof val === 'string') {
    return val.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function itemMediaCounts(item = {}) {
  if (!item) return { images: 0, videos: 0, total: 0 };
  const imagesSet = new Set();
  const videosSet = new Set();

  const addMediaUrl = (val) => {
    const urls = extractMediaUrls(val);
    urls.forEach((u) => {
      if (/\.(mp4|webm|mov|m4v|ogg)$/i.test(u)) {
        videosSet.add(u);
      } else {
        imagesSet.add(u);
      }
    });
  };

  const addVideoUrl = (val) => {
    const urls = extractMediaUrls(val);
    urls.forEach((u) => videosSet.add(u));
  };

  // Check all known product image keys
  addMediaUrl(item.image);
  addMediaUrl(item.imageUrl);
  addMediaUrl(item.thumbnail);
  addMediaUrl(item.photo);
  addMediaUrl(item.cover);
  addMediaUrl(item.coverImage);
  addMediaUrl(item.images);
  addMediaUrl(item.galleryImages);
  addMediaUrl(item.pics);
  addMediaUrl(item.photos);
  addMediaUrl(item.path);
  addMediaUrl(item.publicUrl);

  // Check all known video keys
  addVideoUrl(item.video);
  addVideoUrl(item.videos);
  addVideoUrl(item.videoUrl);

  // If no explicit image found, check category fallback
  if (imagesSet.size === 0 && item.category) {
    const categories = listCollection('categories');
    const catKey = String(item.category).trim().toLowerCase();
    const matched = categories.find(c => 
      String(c.id || '').toLowerCase() === catKey || 
      String(c.slug || '').toLowerCase() === catKey || 
      String(c.title || '').toLowerCase() === catKey
    );
    if (matched) {
      addMediaUrl(matched.image);
      addMediaUrl(matched.images);
    }
  }

  return {
    images: imagesSet.size,
    videos: videosSet.size,
    total: imagesSet.size + videosSet.size,
  };
}

function itemMediaCountLabel(item) {
  const counts = itemMediaCounts(item);
  if (counts.videos > 0) {
    return `${counts.images} Img${counts.images === 1 ? '' : 's'} • ${counts.videos} Vid${counts.videos === 1 ? '' : 's'}`;
  }
  return `${counts.images} image${counts.images === 1 ? '' : 's'}`;
}

function itemMediaCountBadgeHtml(item) {
  const counts = itemMediaCounts(item);
  if (counts.videos > 0) {
    return `<span class="catalog-media-badge-enhanced"><span class="img-num"><i data-lucide="image" style="width:12px;height:12px;"></i> ${counts.images}</span> • <span class="vid-num"><i data-lucide="video" style="width:12px;height:12px;"></i> ${counts.videos}</span></span>`;
  }
  return `<span class="catalog-media-badge-enhanced"><span class="img-num"><i data-lucide="image" style="width:12px;height:12px;"></i> ${counts.images} ${counts.images === 1 ? 'img' : 'imgs'}</span></span>`;
}

function itemOrderCountLabel(item) {
  const value = item.orderCount ?? item.orders ?? item.orderClicks ?? item.orderTotal;
  return value === undefined || value === null || value === '' ? '-' : String(value);
}

function productRecordMetrics(item) {
  return [
    { label: 'Price INR', value: item.priceINR || '-' },
    { label: 'Price USD', value: item.priceUSD || '-' },
    { label: 'Orders', value: itemOrderCountLabel(item) },
    { label: 'Created', value: catalogMetaValue(item, 'createdAt') },
    { label: 'Updated', value: catalogMetaValue(item, 'updatedAt') },
    { label: 'Order', value: item.displayOrder || '-' },
  ];
}

function categoryRecordMetrics(item) {
  return [
    { label: 'Products', value: String(countProductsForCategory(item)) },
    { label: 'Visibility', value: catalogMetaValue(item, 'status') },
    { label: 'Order', value: item.displayOrder || '-' },
    { label: 'Updated', value: catalogMetaValue(item, 'updatedAt') },
  ];
}

function renderCatalogMetric(label, value, detail = '') {
  return `
    <div class="catalog-metric glass">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
    </div>
  `;
}

function closeCatalogActionMenus() {
  document.querySelectorAll('.catalog-card-menu[open]').forEach((menu) => {
    menu.removeAttribute('open');
  });
  document.querySelectorAll('.catalog-mobile-actions[open]').forEach((menu) => {
    menu.removeAttribute('open');
  });
}

function renderCatalogActionMenu(item, node) {
  const isCategory = node === 'categories';
  const toggleAction = String(item.status || 'active') === 'hidden' ? 'Show' : 'Hide';
  const toggleIcon = String(item.status || 'active') === 'hidden' ? 'eye' : 'eye-off';
  return `
    <details class="catalog-card-menu">
      <summary aria-label="More actions"><i data-lucide="ellipsis"></i><span>More</span></summary>
      <div class="catalog-card-menu-panel">
        <button type="button" class="catalog-card-menu-item" data-action="share-product" data-node="${node}" data-id="${escapeHtml(item.id)}"><i data-lucide="share-2"></i> Share Product</button>
        ${isCategory ? `
          <button type="button" class="catalog-card-menu-item" data-action="move-up" data-node="${node}" data-id="${escapeHtml(item.id)}"><i data-lucide="arrow-up"></i> Move up</button>
          <button type="button" class="catalog-card-menu-item" data-action="move-down" data-node="${node}" data-id="${escapeHtml(item.id)}"><i data-lucide="arrow-down"></i> Move down</button>
        ` : `
          <button type="button" class="catalog-card-menu-item" data-action="duplicate" data-node="${node}" data-id="${escapeHtml(item.id)}"><i data-lucide="copy"></i> Duplicate</button>
        `}
        <button type="button" class="catalog-card-menu-item" data-action="toggle" data-node="${node}" data-id="${escapeHtml(item.id)}"><i data-lucide="${toggleIcon}"></i> ${toggleAction}</button>
        <button type="button" class="catalog-card-menu-item danger" data-action="delete" data-node="${node}" data-id="${escapeHtml(item.id)}"><i data-lucide="trash-2"></i> Delete</button>
      </div>
    </details>
  `;
}

function openCategoryProducts(item) {
  const value = String(item?.slug || item?.title || item?.id || '').trim();
  ui.route = 'catalog';
  ui.catalogTab = 'products';
  ui.filters.category = value || 'all';
  ui.catalogFiltersOpen = false;
  ui.page = 1;
  clearSelection();
  persistCatalogPrefs();
  renderView(ui.data || {});
}

function renderCatalogProductCard(item, node) {
  const active = isSelected(item.id);
  const features = normalizeFeatureList(item.features);
  const tiers = normalizeTierList(item.tiers);
  const tierCount = tiers.length;
  const toggleAction = String(item.status || 'active') === 'hidden' ? 'Show' : 'Hide';
  const toggleIcon = String(item.status || 'active') === 'hidden' ? 'eye' : 'eye-off';
  const sellerStore = item.sellerName || item.sellerStoreName || 'Trusted brother';
  const posBadge = `<button type="button" class="catalog-pos-badge-btn" data-action="move-position" data-node="${node}" data-id="${escapeHtml(item.id)}" title="Click to move position">Pos #${item.displayOrder || '1'} ↕</button>`;
  const sellerBadge = `<span class="chip" style="background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3); font-weight: 700; display: inline-flex; align-items: center; gap: 4px;" title="Seller: ${escapeHtml(sellerStore)}"><i data-lucide="store" style="width: 11px; height: 11px;"></i>${escapeHtml(sellerStore)}</span>`;
  const tierBadge = tierCount > 0 
    ? `<button type="button" class="catalog-tier-badge-btn" data-action="edit-tiers" data-node="${node}" data-id="${escapeHtml(item.id)}" title="Click to manage ${tierCount} sub-plans"><i data-lucide="layers"></i> ${tierCount} Sub-Plans</button>` 
    : '';
  const badges = [
    posBadge,
    sellerBadge,
    tierBadge,
    item.category ? `<span class="chip">${escapeHtml(item.category)}</span>` : '',
    catalogCardBadge(item.status),
    itemMediaCountBadgeHtml(item),
  ].filter(Boolean).join('');

  const cleanPriceINR = (val) => {
    if (!val) return '—';
    const raw = String(val).replace(/^[₹$\s]+/, '').trim();
    return raw ? `₹${raw}` : '—';
  };
  const cleanPriceUSD = (val) => {
    if (!val) return '—';
    const raw = String(val).replace(/^[₹$\s]+/, '').trim();
    return raw ? `$${raw}` : '—';
  };

  const metricsList = [
    { label: 'Seller', value: sellerStore },
    { label: 'INR', value: cleanPriceINR(item.priceINR) },
    { label: 'USD', value: cleanPriceUSD(item.priceUSD) },
    { label: 'Sub-Plans', value: tierCount > 0 ? `${tierCount} options` : '—' },
    { label: 'Media', value: itemMediaCountLabel(item) },
  ];
  if (item.orderCount || item.orders) {
    metricsList.push({ label: 'Orders', value: itemOrderCountLabel(item) });
  }

  const metrics = metricsList.map((entry) => `
    <div class="catalog-meta-item">
      <span>${escapeHtml(entry.label)}</span>
      <strong>${escapeHtml(String(entry.value))}</strong>
    </div>
  `).join('');

  return `
    <article class="catalog-card catalog-card-product ${active ? 'selected' : ''}" data-id="${escapeHtml(item.id)}" draggable="true">
      <label class="catalog-select">
        <input type="checkbox" data-action="toggle-select-item" data-id="${escapeHtml(item.id)}" ${active ? 'checked' : ''} />
      </label>
      <div class="catalog-card-media">
        <button class="catalog-media-frame catalog-media-button" type="button" data-action="preview" data-node="${node}" data-id="${escapeHtml(item.id)}">${itemPreviewThumb(item)}</button>
        <span class="catalog-image-badge">${itemMediaCountBadgeHtml(item)}</span>
      </div>
      <div class="catalog-card-content catalog-card-tapzone" data-action="preview" data-node="${node}" data-id="${escapeHtml(item.id)}">
        <div class="catalog-card-head">
          <div>
            <h3>${escapeHtml(item.title || item.slug || 'Untitled')}</h3>
            <p>${escapeHtml(item.description || item.review || item.answer || 'No description provided')}</p>
          </div>
          <div class="catalog-card-badges">${badges}</div>
        </div>
        ${features.length ? `
        <div class="catalog-card-chips">
          ${features.slice(0, 3).map((feature) => `<span class="chip subtle">${escapeHtml(feature)}</span>`).join('')}
        </div>
        ` : ''}
        <div class="catalog-card-metrics">${metrics}</div>
      </div>
      <div class="catalog-card-actions">
        ${(item.status === 'pending' || item.status === 'pending_approval') ? `
        <button type="button" class="catalog-action-btn action-approve" data-action="approve-product" data-id="${escapeHtml(item.id)}" style="background: rgba(16, 185, 129, 0.2); border: 1px solid #10b981; color: #10b981; font-weight: 700;" title="Approve pack and publish live to JaiGram"><i data-lucide="check-circle"></i> Approve & Go Live</button>
        ` : ''}
        <button type="button" class="catalog-action-btn action-preview" data-action="preview" data-node="${node}" data-id="${escapeHtml(item.id)}"><i data-lucide="eye"></i> Preview</button>
        <button type="button" class="catalog-action-btn action-edit" data-action="edit" data-node="${node}" data-id="${escapeHtml(item.id)}"><i data-lucide="pencil"></i> Edit</button>
        <button type="button" class="catalog-action-btn action-tiers" data-action="edit-tiers" data-node="${node}" data-id="${escapeHtml(item.id)}" title="Manage Sub-Plans / Options"><i data-lucide="layers"></i> Sub-Plans${tierCount > 0 ? ` (${tierCount})` : ''}</button>
        <button type="button" class="catalog-action-btn action-move-pos" data-action="move-position" data-node="${node}" data-id="${escapeHtml(item.id)}" title="Move position"><i data-lucide="arrow-up-down"></i> Move</button>
        <button type="button" class="catalog-action-btn action-share" data-action="share-product" data-node="${node}" data-id="${escapeHtml(item.id)}"><i data-lucide="share-2"></i> Share</button>
        <button type="button" class="catalog-action-btn action-duplicate" data-action="duplicate" data-node="${node}" data-id="${escapeHtml(item.id)}"><i data-lucide="copy"></i> Duplicate</button>
        <button type="button" class="catalog-action-btn action-toggle" data-action="toggle" data-node="${node}" data-id="${escapeHtml(item.id)}"><i data-lucide="${toggleIcon}"></i> ${toggleAction}</button>
        <button type="button" class="catalog-action-btn action-delete danger" data-action="delete" data-node="${node}" data-id="${escapeHtml(item.id)}"><i data-lucide="trash-2"></i> Delete</button>
      </div>
    </article>
  `;
}

function renderCatalogCategoryCard(item, node) {
  const active = isSelected(item.id);
  const productCount = countProductsForCategory(item);
  const toggleAction = String(item.status || 'active') === 'hidden' ? 'Show' : 'Hide';
  const toggleIcon = String(item.status || 'active') === 'hidden' ? 'eye' : 'eye-off';
  const posBadge = `<button type="button" class="catalog-pos-badge-btn" data-action="move-position" data-node="${node}" data-id="${escapeHtml(item.id)}" title="Click to move position">Pos #${item.displayOrder || '1'} ↕</button>`;
  const badges = [
    posBadge,
    catalogCardBadge(item.status),
    `<span class="chip">${escapeHtml(String(productCount))} products</span>`
  ].filter(Boolean).join('');

  const metricsList = [
    { label: 'Products', value: `${productCount} items` },
    { label: 'Display Order', value: `#${item.displayOrder ?? '1'}` },
  ];

  const metrics = metricsList.map((entry) => `
    <div class="catalog-meta-item">
      <span>${escapeHtml(entry.label)}</span>
      <strong>${escapeHtml(String(entry.value))}</strong>
    </div>
  `).join('');

  return `
    <article class="catalog-card catalog-card-category ${active ? 'selected' : ''}" data-id="${escapeHtml(item.id)}" draggable="true">
      <label class="catalog-select">
        <input type="checkbox" data-action="toggle-select-item" data-id="${escapeHtml(item.id)}" ${active ? 'checked' : ''} />
      </label>
      <div class="catalog-card-media compact category-card-media">
        <button class="catalog-media-frame catalog-media-button" type="button" data-action="preview" data-node="${node}" data-id="${escapeHtml(item.id)}">${itemPreviewThumb(item)}</button>
        <span class="catalog-image-badge">Category</span>
      </div>
      <div class="catalog-card-content catalog-card-tapzone" data-action="preview" data-node="${node}" data-id="${escapeHtml(item.id)}">
        <div class="catalog-card-head">
          <div>
            <div class="catalog-card-kicker">Category</div>
            <h3>${escapeHtml(item.title || item.name || item.slug || 'Untitled')}</h3>
            <p>${escapeHtml(item.description || 'No description provided')}</p>
          </div>
          <div class="catalog-card-badges">${badges}</div>
        </div>
        <div class="catalog-card-metrics">${metrics}</div>
      </div>
      <div class="catalog-card-actions">
        <button type="button" class="catalog-action-btn action-preview" data-action="preview" data-node="${node}" data-id="${escapeHtml(item.id)}"><i data-lucide="eye"></i> Preview</button>
        <button type="button" class="catalog-action-btn action-edit" data-action="edit" data-node="${node}" data-id="${escapeHtml(item.id)}"><i data-lucide="pencil"></i> Edit</button>
        <button type="button" class="catalog-action-btn action-move-pos" data-action="move-position" data-node="${node}" data-id="${escapeHtml(item.id)}" title="Move position"><i data-lucide="arrow-up-down"></i> Move</button>
        <button type="button" class="catalog-action-btn action-prods" data-action="view-products" data-node="${node}" data-id="${escapeHtml(item.id)}"><i data-lucide="layout-list"></i> Products</button>
        <button type="button" class="catalog-action-btn action-share" data-action="share-product" data-node="${node}" data-id="${escapeHtml(item.id)}"><i data-lucide="share-2"></i> Share</button>
        <button type="button" class="catalog-action-btn action-toggle" data-action="toggle" data-node="${node}" data-id="${escapeHtml(item.id)}"><i data-lucide="${toggleIcon}"></i> ${toggleAction}</button>
        <button type="button" class="catalog-action-btn action-delete danger" data-action="delete" data-node="${node}" data-id="${escapeHtml(item.id)}"><i data-lucide="trash-2"></i> Delete</button>
      </div>
    </article>
  `;
}

function buildCatalogFilters(node, items) {
  const categoryOptions = getCategoryOptions();
  const selectedCount = ui.selection.size;
  const selectedText = selectedCount ? `${selectedCount} selected` : 'No selection';
  return `
    <div class="catalog-toolbar-shell glass sticky ${ui.catalogFiltersOpen ? 'filters-open' : ''}">
      <button class="catalog-filter-backdrop" data-action="toggle-catalog-filters" type="button" aria-hidden="true"></button>
      <div class="catalog-toolbar-top">
        <div class="catalog-search">
          <label class="sr-only" for="collectionSearch">Search</label>
          <input class="input catalog-search-input" type="search" placeholder="Search ${escapeHtml(node === 'products' ? 'products' : 'categories')}" id="collectionSearch" value="${escapeHtml(ui.search)}" />
        </div>
        <div class="catalog-toolbar-actions">
          <button class="btn btn-ghost catalog-filters-toggle" data-action="toggle-catalog-filters" type="button"><i data-lucide="sliders-horizontal"></i> Filters</button>
          <div class="catalog-view-switch">
            <button class="view-switch ${ui.catalogView === 'grid' ? 'active' : ''}" data-action="set-catalog-view" data-view="grid"><i data-lucide="grid-2x2"></i> Grid</button>
            <button class="view-switch ${ui.catalogView === 'list' ? 'active' : ''}" data-action="set-catalog-view" data-view="list"><i data-lucide="rows-3"></i> List</button>
          </div>
        </div>
      </div>
      <div class="catalog-filter-panel">
        <div class="catalog-selects">
          <select class="select" id="categoryFilter">
            <option value="all">All Categories</option>
            ${categoryOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${ui.filters.category === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
          </select>
          <select class="select" id="statusFilter">
            <option value="all">All Status</option>
            <option value="active" ${ui.filters.status === 'active' ? 'selected' : ''}>Active</option>
            <option value="hidden" ${ui.filters.status === 'hidden' ? 'selected' : ''}>Hidden</option>
            <option value="draft" ${ui.filters.status === 'draft' ? 'selected' : ''}>Draft</option>
          </select>
          <select class="select" id="sortFilter">
            <option value="displayOrder" ${ui.sort === 'displayOrder' ? 'selected' : ''}>Display Order (Default)</option>
            <option value="updatedAt" ${ui.sort === 'updatedAt' ? 'selected' : ''}>Latest Updated</option>
            <option value="title" ${ui.sort === 'title' ? 'selected' : ''}>Title A-Z</option>
          </select>
          <select class="select" id="pageSizeFilter">
            ${[8, 12, 24, 48].map((size) => `<option value="${size}" ${Number(ui.catalogPageSize) === size ? 'selected' : ''}>${size} per page</option>`).join('')}
          </select>
        </div>
        <div class="catalog-filter-footer">
          <button class="btn btn-ghost" type="button" data-action="catalog-reset-filters"><i data-lucide="rotate-ccw"></i> Reset</button>
          <button class="btn btn-primary" type="button" data-action="catalog-apply-filters"><i data-lucide="check"></i> Apply Filters</button>
        </div>
      </div>
    </div>
    <div class="bulk-toolbar glass${selectedCount ? ' open' : ''}">
      <div>
        <strong>${escapeHtml(selectedText)}</strong>
        <p>Bulk actions apply to the current selection only.</p>
      </div>
      <div class="toolbar">
        <button class="btn btn-ghost" data-action="select-visible">${escapeHtml(selectedCount ? 'Deselect Visible' : 'Select Visible')}</button>
        <button class="btn btn-ghost" data-action="bulk" data-bulk-action="duplicate" ${selectedCount ? '' : 'disabled'}>Duplicate</button>
        <button class="btn btn-ghost" data-action="bulk" data-bulk-action="hide" ${selectedCount ? '' : 'disabled'}>Hide</button>
        <button class="btn btn-ghost" data-action="bulk" data-bulk-action="show" ${selectedCount ? '' : 'disabled'}>Show</button>
        <button class="btn btn-ghost" data-action="bulk" data-bulk-action="move-category" ${selectedCount && node === 'products' ? '' : 'disabled'}>Move Category</button>
        <button class="btn btn-danger" data-action="bulk" data-bulk-action="delete" ${selectedCount ? '' : 'disabled'}>Delete</button>
      </div>
    </div>
  `;
}

function mediaFileName(path) {
  const clean = String(path || '').split('?')[0].split('#')[0];
  return clean.split('/').filter(Boolean).pop() || 'asset';
}

function mediaTypeFromPath(path) {
  if (/\.(mp4|webm|mov|m4v)$/i.test(path || '')) return 'video';
  return 'image';
}

function mediaFolderForNode(node, kind) {
  const base = node === 'categories' ? 'categories' : 'products';
  if (kind === 'gallery') return `${base}/gallery`;
  return base;
}

function normalizeStorageFolder(folder) {
  const value = String(folder || '').trim();
  if (!value) return 'images';
  if (value === 'banner') return 'banners';
  return value;
}

function normalizeAssetValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.split('#')[0].split('?')[0];
}

function recordAssetRefs(record) {
  if (!record || typeof record !== 'object') return [];
  const refs = new Set();
  const add = (value) => {
    const normalized = normalizeAssetValue(value);
    if (normalized) refs.add(normalized);
  };
  const addList = (value) => {
    if (Array.isArray(value)) value.forEach(add);
    else add(value);
  };

  ['image', 'video', 'thumbnail', 'cover', 'photo', 'logo', 'backgroundImage', 'bannerImage', 'heroImage', 'publicUrl', 'path', 'sourcePath'].forEach((key) => add(record[key]));
  ['images', 'videos', 'galleryImages', 'thumbnails', 'slides', 'media', 'mediaUrls'].forEach((key) => addList(record[key]));

  return [...refs];
}

function mediaMatchesReference(media, reference) {
  const candidates = recordAssetRefs(media);
  const target = normalizeAssetValue(reference);
  if (!target) return false;
  const targetName = mediaFileName(target).toLowerCase();
  const targetBase = target.replace(/^\/+/, '').toLowerCase();
  return candidates.some((candidate) => {
    const value = candidate.toLowerCase();
    return value === targetBase
      || value === target.toLowerCase()
      || mediaFileName(value).toLowerCase() === targetName;
  });
}

async function deleteMediaIfUnused(reference, keepContext = null) {
  const target = normalizeAssetValue(reference);
  if (!target) return;
  const scanNodes = ['products', 'categories', 'media', 'hero', 'banner', 'testimonials'];
  const referencedElsewhere = scanNodes.some((node) => {
    return listCollection(node).some((item) => {
      if (keepContext && node === keepContext.node && item.id === keepContext.id) return false;
      return recordAssetRefs(item).some((candidate) => mediaMatchesReference({ image: candidate }, target));
    });
  });
  if (referencedElsewhere) return;
  const matches = listCollection('media').filter((item) => mediaMatchesReference(item, target));
  if (!matches.length) return;
  for (const media of matches) {
    const storagePath = normalizeAssetValue(media.path || media.sourcePath || media.publicUrl || media.image || '');
    if (storagePath) {
      try {
        await deletePublicAsset(storagePath);
      } catch (_) {
        // Keep going: the file may already be removed or inaccessible.
      }
    }
    if (media.id) {
      try {
        await deleteRecord('media', media.id);
      } catch (_) {
        // Ignore record cleanup failures.
      }
    }
  }
}

async function saveUploadedMediaRecord(file, result, folder, type, source = 'admin', sourcePath = '', linkedName = '', linkedId = '') {
  await saveRecord('media', uid('media'), {
    name: file.name,
    folder: normalizeStorageFolder(folder),
    type,
    path: result.path,
    publicUrl: result.publicUrl,
    sourcePath,
    size: file.size,
    mime: file.type,
    source,
    linkedName: linkedName || '',
    linkedId: linkedId || '',
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

async function uploadRecordMedia(form, node, next) {
  const recordLabel = next.name || next.title || next.label || (node === 'categories' ? 'Category' : 'Product');
  const imageFile = form.querySelector('input[name="imageFile"]')?.files?.[0] || null;
  const photoFile = form.querySelector('input[name="photoFile"]')?.files?.[0] || null;
  const galleryFiles = [...(form.querySelector('input[name="galleryFiles"]')?.files || [])];
  const uploaded = [];
  const uploadOne = async (file, folder, type, source) => {
    const result = await uploadAsset(file, folder);
    uploaded.push(result.path);
    await saveUploadedMediaRecord(file, result, folder, type, source, `${source}:${file.name}`, recordLabel, next.id);
    return result.publicUrl;
  };
  try {
    if (imageFile) {
      next.image = await uploadOne(imageFile, mediaFolderForNode(node, 'image'), 'image', `${node}-record`);
    }
    if (photoFile) {
      next.photo = await uploadOne(photoFile, mediaFolderForNode(node, 'photo'), 'image', `${node}-record`);
    }
    if (galleryFiles.length) {
      const urls = [];
      for (const file of galleryFiles) {
        urls.push(await uploadOne(file, mediaFolderForNode(node, 'gallery'), 'image', `${node}-record`));
      }
      const existingGallery = Array.isArray(next.galleryImages) ? next.galleryImages.filter(Boolean) : [];
      next.galleryImages = [...new Set([...existingGallery, ...urls])];
    }
    if (next.image) {
      next.thumbnail = next.image;
      const gallery = Array.isArray(next.galleryImages) ? next.galleryImages.filter(Boolean) : [];
      next.images = [...new Set([next.image, ...gallery])];
    } else if (Array.isArray(next.galleryImages) && next.galleryImages.length) {
      next.image = next.galleryImages[0];
      next.thumbnail = next.image;
      next.images = [...new Set(next.galleryImages.filter(Boolean))];
    }
    return next;
  } catch (error) {
    for (const path of uploaded.reverse()) {
      try {
        await deletePublicAsset(path);
      } catch (_) {
        // Ignore cleanup failures and surface the original error.
      }
    }
    throw error;
  }
}

async function syncFirebaseCollection(node, records) {
  const list = normalizeCatalogRecords(records);
  for (const record of list) {
    await saveRecord(node, record.id, record);
  }
  return list.length;
}

// syncCurrentSiteCatalog: REMOVED — was overwriting Firebase data from HTML scraping,
// causing all admin changes to revert. Do not restore.

async function syncCurrentSiteMedia() {
  const confirmed = confirm('Import the current public site images into RustFS S3 Storage and save media metadata in Firebase?');
  if (!confirmed) return;
  try {
    setMediaStatus('Scanning public site images...');
    const catalog = await fetchCurrentSiteCatalog();
    const assets = [...new Set(catalog.assets)];
    if (!assets.length) {
      setMediaStatus('No site images found.');
      showToast('No site assets found', 'warning');
      return;
    }
    let imported = 0;
    let skipped = 0;
    const total = assets.length;
    setMediaStatus(`Importing 0 / ${total} assets...`);
    for (const asset of assets) {
      const path = String(asset || '').trim();
      if (!path) continue;
      const existing = listCollection('media').find((item) => item.sourcePath === path || item.path === path);
      if (existing) {
        skipped += 1;
        setMediaStatus(`Importing ${imported} / ${total} assets...`);
        continue;
      }
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) continue;
      const blob = await response.blob();
      const file = new File([blob], mediaFileName(path), { type: blob.type || 'application/octet-stream' });
      const lowerPath = path.toLowerCase();
      const folder = lowerPath.includes('category')
        ? 'categories'
        : lowerPath.includes('photo') || lowerPath.includes('product')
          ? 'products'
          : lowerPath.includes('binance') || lowerPath.includes('paypal') || lowerPath.includes('upi')
            ? 'logos'
            : lowerPath.includes('hero')
              ? 'hero'
              : lowerPath.includes('banner')
                ? 'banners'
                : lowerPath.includes('testimonial') || lowerPath.includes('review')
                  ? 'testimonials'
                  : 'images';
      const result = await uploadAsset(file, folder);
      await saveRecord('media', slugify(path), {
        id: slugify(path),
        name: mediaFileName(path),
        folder: normalizeStorageFolder(folder),
        type: mediaTypeFromPath(path),
        path: result.path,
        publicUrl: result.publicUrl,
        sourcePath: path,
        source: 'public-site',
        size: blob.size,
        mime: blob.type,
        status: 'active',
      });
      imported += 1;
      setMediaStatus(`Importing ${imported} / ${total} assets...`);
    }
    renderView(ui.data || {});
    setMediaStatus(`Imported ${imported} assets${skipped ? `, skipped ${skipped}` : ''}.`);
    showToast(`Imported ${imported} media assets${skipped ? `, skipped ${skipped}` : ''}`);
  } catch (error) {
    setMediaStatus(error?.message || 'Media import failed');
    showToast(error?.message || 'Media import failed', 'danger');
  }
}

function renderCatalogTabs() {
  const productsCount = listCollection('products').filter((item) => item.status !== 'deleted').length;
  const categoriesCount = listCollection('categories').filter((item) => item.status !== 'deleted').length;
  return `
    <div class="catalog-tabs">
      <button class="catalog-tab ${ui.catalogTab === 'products' ? 'active' : ''}" data-action="switch-catalog" data-tab="products">Products <span>${escapeHtml(String(productsCount))}</span></button>
      <button class="catalog-tab ${ui.catalogTab === 'categories' ? 'active' : ''}" data-action="switch-catalog" data-tab="categories">Categories <span>${escapeHtml(String(categoriesCount))}</span></button>
    </div>
  `;
}

function renderCollectionInner(node, schema, data) {
  const items = filterItems(data, node);
  const pageSize = Math.max(4, Number(ui.catalogPageSize) || 8);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, ui.page), totalPages);
  const paged = items.slice((page - 1) * pageSize, page * pageSize);
  ui.page = page;

  const isCatalog = node === 'products' || node === 'categories';
  const itemLabel = node === 'categories' ? 'categories' : (node === 'products' ? 'products' : node);
  const itemSingular = schema.label.toLowerCase();

  const totalSelected = ui.selection.size;
  const visibleStart = items.length ? ((page - 1) * pageSize) + 1 : 0;
  const visibleEnd = Math.min(items.length, page * pageSize);

  let contentHtml = '';
  if (isCatalog) {
    contentHtml = `
      ${buildCatalogFilters(node, items)}
      <div class="catalog-results ${ui.catalogView}" id="catalogResultsGrid">
        ${paged.length ? paged.map((item) => (node === 'categories'
          ? renderCatalogCategoryCard(item, node)
          : renderCatalogProductCard(item, node))).join('') : `
          <div class="catalog-empty glass">
            <div class="catalog-empty-art">
              <div class="orb orb-a"></div>
              <div class="orb orb-b"></div>
              <i data-lucide="sparkles"></i>
            </div>
            <h3>Create your first ${escapeHtml(itemSingular)}.</h3>
            <p>Set up ${escapeHtml(itemLabel)} to populate the dynamic website sections.</p>
            <div class="toolbar">
              <button class="btn btn-ghost" data-action="goto" data-route="media"><i data-lucide="image-plus"></i> Open Media Library</button>
            </div>
          </div>
        `}
      </div>
    `;
  } else {
    contentHtml = `
      <div class="table-wrap list-table-wrap" style="margin-top: 1.5rem;">
        <table class="table">
          <thead>
            <tr>
              ${schema.columns.map(col => `<th>${escapeHtml(col.label)}</th>`).join('')}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${buildTableRows(node, schema.columns, paged)}
          </tbody>
        </table>
      </div>
    `;
  }

  return `
    <div class="panel-head catalog-section-head">
      <div>
        <h2 class="section-title">${escapeHtml(schema.title)}</h2>
        <p class="section-subtitle">${escapeHtml(schema.description)}</p>
      </div>
      <div class="toolbar catalog-header-actions">
        ${isCatalog ? `<button class="btn btn-ghost" data-action="select-visible"><i data-lucide="square-check"></i> ${ui.selection.size ? 'Clear Visible' : 'Select Visible'}</button>` : ''}
        ${node === 'products' ? `
          <button class="btn btn-ghost" data-action="assign-all-catalog-to-trusted" title="Assign and sync all catalog packs to Trusted brother (jaibajpai67@gmail.com)"><i data-lucide="user-check"></i> Assign to Trusted Brother</button>
          <button class="btn btn-ghost" data-action="bulk" data-bulk-action="move-category" ${totalSelected ? '' : 'disabled'}><i data-lucide="move-right"></i> Move Category</button>
        ` : ''}
        ${!isCatalog ? `<button class="btn btn-primary" data-action="add" data-node="${node}"><i data-lucide="plus"></i> Add ${escapeHtml(schema.label)}</button>` : ''}
      </div>
    </div>
    ${!isCatalog ? `
      <div class="collection-summary catalog-summary">
        <div class="summary-card">
          <span>Total Records</span>
          <strong>${escapeHtml(String(items.length))}</strong>
        </div>
        <div class="summary-card">
          <span>Visible</span>
          <strong>${escapeHtml(String(paged.length))}</strong>
        </div>
        <div class="summary-card">
          <span>Page</span>
          <strong>${escapeHtml(String(page))} / ${escapeHtml(String(totalPages))}</strong>
        </div>
      </div>
    ` : ''}
    ${contentHtml}
    <div class="pagination catalog-pagination">
      <span class="section-subtitle">Showing ${escapeHtml(String(visibleStart))}-${escapeHtml(String(visibleEnd))} of ${escapeHtml(String(items.length))} ${escapeHtml(itemLabel)}${totalSelected ? ` · ${escapeHtml(String(totalSelected))} selected` : ''}</span>
      <div class="toolbar catalog-pagination-actions">
        <span class="chip">Rows ${escapeHtml(String(pageSize))}</span>
        <button class="btn btn-ghost" data-page="prev"><i data-lucide="chevron-left"></i></button>
        <span class="chip">Page ${escapeHtml(String(page))} / ${escapeHtml(String(totalPages))}</span>
        <button class="btn btn-ghost" data-page="next"><i data-lucide="chevron-right"></i></button>
      </div>
    </div>
  `;
}

function renderDashboard(data) {
  const summary = summarizeDashboard();
  const activity = recentActivity(5);
  const orders = recentOrders(6);
  const topProducts = buildTopProducts(summary);
  return `
    <div class="page active">
      <section class="dashboard-hero">
        <div class="dashboard-hero-copy panel glass">
          <div class="panel-head dashboard-header">
            <div>
              <h2 class="section-title">Dashboard</h2>
              <p class="section-subtitle">Real-time overview of your store</p>
            </div>
            <div class="toolbar hero-actions">
              ${renderRangeSwitch()}
              <button class="btn btn-ghost" data-action="refresh" type="button"><i data-lucide="refresh-cw"></i> Refresh</button>
              <button class="btn btn-primary" data-action="goto" data-route="products" type="button"><i data-lucide="plus"></i> Add Product</button>
            </div>
          </div>
          <div class="dashboard-kpi-grid">
            ${renderKpiCard({
              label: 'Visitors',
              value: formatNumber(summary.visitors),
              change: summary.visitorsTrend,
              note: summary.range === 'all' ? 'All-time verified store traffic' : `${formatNumber(summary.totals.visitors || summary.totals.lifetimeVisitors || 0)} total all-time`,
              icon: 'users',
              series: summary.visitorSeries,
              tone: 'primary',
            })}
            ${renderKpiCard({
              label: 'Order Clicks',
              value: formatNumber(summary.clicks),
              change: summary.clicksTrend,
              note: summary.range === 'all' ? 'All-time checkout click intent' : `${formatNumber(summary.totals.clicks || summary.totals.lifetimeClicks || 0)} total all-time`,
              icon: 'mouse-pointer-click',
              series: summary.clickSeries,
              tone: 'secondary',
            })}
            ${renderKpiCard({
              label: 'Orders',
              value: formatNumber(summary.orders),
              change: summary.ordersTrend,
              note: summary.range === 'all' ? 'All-time customer orders' : `${formatNumber(summary.totals.orders || summary.totals.lifetimeOrders || 0)} total all-time`,
              icon: 'receipt-text',
              series: summary.orderSeries,
              tone: 'success',
            })}
            ${renderKpiCard({
              label: 'Revenue',
              value: formatNumber(summary.revenue),
              change: summary.revenueTrend,
              note: summary.range === 'all' ? 'From paid / completed orders' : `₹${formatNumber(summary.totals.lifetimeRevenue || summary.revenue || 0)} total all-time`,
              icon: 'banknote',
              series: summary.revenueSeries,
              tone: 'accent',
              valuePrefix: '₹',
            })}
          </div>
          <div class="dashboard-secondary-grid">
            ${renderCompactStatCard('Products', summary.totals.products, 'Live product records', 'package', 'primary')}
            ${renderCompactStatCard('Categories', summary.totals.categories, 'Live category records', 'layers-3', 'secondary')}
            ${renderCompactStatCard('Media Assets', summary.mediaAssets, 'Stored in RustFS S3', 'image', 'accent')}
            ${renderCompactStatCard("Today's Visitors", summary.totals.todaysVisitors || 0, 'Visitors tracked today', 'calendar-days', 'success')}
          </div>
        </div>

        <div class="dashboard-hero-side panel glass">
          <div class="panel-head">
            <div>
              <h3>Live Activity</h3>
              <p class="section-subtitle">Latest meaningful events from the store</p>
            </div>
            <button class="btn btn-ghost" type="button" data-action="open-notifications"><i data-lucide="external-link"></i> View all</button>
          </div>
          <div class="timeline-list activity-list">
            ${activity.length ? activity.map((item) => `
              <div class="activity-row">
                <div class="activity-icon"><i data-lucide="${escapeHtml(getActivityIcon(item.type))}"></i></div>
                <div class="activity-copy">
                  <strong>${escapeHtml(item.title)}</strong>
                  <span>${escapeHtml(item.meta || 'live')} - ${escapeHtml(formatDateTime(item.timestamp))}</span>
                </div>
              </div>
            `).join('') : '<div class="empty-state">No recent activity yet.</div>'}
          </div>
        </div>
      </section>

      <section class="dashboard-main-grid">
        ${renderTrafficChart(summary)}
        <section class="panel glass dashboard-side-panel">
          <div class="panel-head">
            <div>
              <h3>Top Products</h3>
              <p class="section-subtitle">Best performers from existing click and order data.</p>
            </div>
            <button class="btn btn-ghost" type="button" data-action="goto" data-route="products"><i data-lucide="arrow-right"></i> Manage</button>
          </div>
          <div class="top-products-list">
            ${topProducts.length ? topProducts.map((item) => `
              <div class="top-product-row">
                <div class="top-product-thumb">${mediaPreview(item) || `<span>${escapeHtml(String(item.title || '?').slice(0, 1).toUpperCase())}</span>`}</div>
                <div class="top-product-copy">
                  <strong>${escapeHtml(item.title || item.slug || 'Untitled')}</strong>
                  <span>${escapeHtml(item.category || 'Uncategorized')}</span>
                </div>
                <div class="top-product-stat">
                  <span>Clicks</span>
                  <strong>${escapeHtml(String(item.clicks || 0))}</strong>
                </div>
                <div class="top-product-stat">
                  <span>Orders</span>
                  <strong>${escapeHtml(String(item.orders || 0))}</strong>
                </div>
              </div>
            `).join('') : '<div class="empty-state">No performance data yet.</div>'}
          </div>
        </section>
      </section>

      <section class="panel glass" style="margin-top: 24px;">
        <div class="panel-head">
          <div>
            <div style="font-size: 11px; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">Live Stream</div>
            <h3 style="margin: 0; font-size: 20px; font-weight: 800; color: var(--text);">Recent Orders</h3>
            <p class="section-subtitle">The latest customer checkout events and payment submissions.</p>
          </div>
          <button class="btn btn-ghost" type="button" data-action="goto" data-route="orders"><i data-lucide="list"></i> View All Orders</button>
        </div>
        <div class="orders-table-shell" style="border: none; box-shadow: none;">
          <table class="orders-table">
            <thead>
              <tr>
                <th style="min-width: 260px;">Product & Order</th>
                <th style="min-width: 120px;">Amount</th>
                <th style="min-width: 130px;">Method</th>
                <th style="min-width: 140px;">Status</th>
                <th style="min-width: 140px;">Time</th>
                <th style="min-width: 100px; text-align: right;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${orders.length ? orders.map((item) => {
                const proof = orderPaymentProof(item);
                const isPaid = isPaidOrder(item);
                const isFailed = isFailedOrder(item);
                const orderId = item.id || item.orderId || '-';
                const shortId = orderId.length > 10 ? `${orderId.substring(0, 8)}...` : orderId;
                const prodTitle = orderProductName(item);
                const method = orderMethodLabel(item);
                const methodLower = method.toLowerCase();
                const methodClass = methodLower.includes('upi') ? 'upi' : methodLower.includes('binance') ? 'binance' : methodLower.includes('paypal') ? 'paypal' : 'crypto';
                const formattedAmt = item.amountDisplay || formatCurrencyCompact(item.amount || item.inr || 0);

                return `
                  <tr>
                    <td>
                      <div class="order-product-cell">
                        <div class="order-proof-thumb-wrap" data-action="open-order" data-id="${escapeHtml(item.id)}" title="${proof ? 'View Screenshot' : 'View Order'}">
                          ${proof ? `
                            <img src="${escapeHtml(proof)}" alt="Proof" loading="lazy" />
                            <span class="order-proof-badge"><i data-lucide="image" style="width: 8px; height: 8px; vertical-align: middle;"></i> PROOF</span>
                          ` : `
                            <div style="width: 100%; height: 100%; display: grid; place-items: center; background: linear-gradient(135deg, #6366f1, #a855f7); color: #fff; font-weight: 800; font-size: 15px;">
                              ${escapeHtml((prodTitle[0] || 'O').toUpperCase())}
                            </div>
                          `}
                        </div>
                        <div style="min-width: 0;">
                          <strong style="display: block; font-size: 13.5px; color: var(--text); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;" title="${escapeHtml(prodTitle)}">
                            ${escapeHtml(prodTitle)}
                          </strong>
                          <span class="order-id-badge" data-action="copy-order-id" data-id="${escapeHtml(orderId)}" title="Click to Copy #${escapeHtml(orderId)}">
                            <i data-lucide="copy" style="width: 10px; height: 10px;"></i> #${escapeHtml(shortId)}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class="order-amount-cell">${escapeHtml(formattedAmt)}</span>
                    </td>
                    <td>
                      <span class="order-method-badge ${methodClass}">
                        <i data-lucide="${methodClass === 'upi' ? 'smartphone' : methodClass === 'binance' ? 'coins' : methodClass === 'paypal' ? 'wallet' : 'shield-check'}" style="width: 13px; height: 13px;"></i>
                        ${escapeHtml(method)}
                      </span>
                    </td>
                    <td>
                      <span class="order-status-pill ${isPaid ? 'approved' : isFailed ? 'rejected' : 'pending'}">
                        ${isPaid ? '🟢 Approved' : isFailed ? '🔴 Rejected' : '🟡 Pending'}
                      </span>
                    </td>
                    <td>
                      <div style="font-size: 12.5px; color: var(--text); white-space: nowrap;">${escapeHtml(formatDateTime(orderDateValue(item)))}</div>
                      <div style="font-size: 11px; color: var(--muted); margin-top: 2px;">${escapeHtml(formatRelativeTime(orderDateValue(item)))}</div>
                    </td>
                    <td style="text-align: right;">
                      <button class="order-quick-btn view" type="button" data-action="open-order" data-id="${escapeHtml(item.id)}" title="View Proof & Order">
                        <i data-lucide="eye" style="width: 13px; height: 13px;"></i> View
                      </button>
                    </td>
                  </tr>
                `;
              }).join('') : `
                <tr>
                  <td colspan="6" style="text-align: center; padding: 36px 20px; color: var(--muted);">
                    <i data-lucide="inbox" style="width: 36px; height: 36px; opacity: 0.3; margin-bottom: 8px;"></i>
                    <div style="font-size: 14px; font-weight: 600; color: var(--text);">No recent orders yet</div>
                  </td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function filterItems(items, node = 'products') {
  const source = Array.isArray(items)
    ? items
    : Object.entries(items || {}).map(([id, item]) => ({ id, ...(item || {}) }));
  let list = [...source];
  if (ui.search) {
    const term = ui.search.toLowerCase();
    list = list.filter((item) => JSON.stringify(item).toLowerCase().includes(term));
  }
  if (ui.filters.status && ui.filters.status !== 'all') {
    list = list.filter((item) => String(item.status || 'active') === ui.filters.status);
  }
  if (node === 'products' && ui.filters.category && ui.filters.category !== 'all') {
    const categoryTerm = String(ui.filters.category || '').toLowerCase();
    list = list.filter((item) => {
      const value = String(item.category || '').toLowerCase();
      return value === categoryTerm || slugify(value) === categoryTerm || slugify(item.category || '') === categoryTerm;
    });
  }
  if (ui.sort === 'title') {
    list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  } else if (ui.sort === 'updatedAt') {
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } else {
    // Default: displayOrder
    list.sort((a, b) => {
      const orderA = a.displayOrder !== undefined && a.displayOrder !== null ? Number(a.displayOrder) : 999999;
      const orderB = b.displayOrder !== undefined && b.displayOrder !== null ? Number(b.displayOrder) : 999999;
      if (orderA !== orderB) return orderA - orderB;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }
  return list;
}

function renderCollection(node, schema, data) {
  return `
    <div class="page active">
      <section class="panel glass collection-shell">
        ${renderCollectionInner(node, schema, data)}
      </section>
    </div>
  `;
}

function renderCatalogView(data) {
  const meta = getCatalogMeta();
  const nodeData = listCollection(meta.node);
  const counts = getCatalogCounts();
  return `
    <div class="page active">
      <section class="panel glass collection-shell catalog-page">
        <div class="panel-head">
          <div>
            <h2 class="section-title">Catalog</h2>
            <p class="section-subtitle">Manage products and categories</p>
          </div>
          <div class="toolbar catalog-hero-actions">
            <button class="btn btn-primary catalog-primary-action" data-action="add" data-node="products"><i data-lucide="plus"></i> Add Product</button>
            <div class="catalog-secondary-actions">
              <button class="btn btn-ghost" data-action="add" data-node="categories"><i data-lucide="tag"></i> Add Category</button>
              <button class="btn btn-ghost" data-action="goto" data-route="media"><i data-lucide="image-plus"></i> Media Library</button>
            </div>
            <details class="catalog-mobile-actions">
              <summary class="btn btn-ghost"><i data-lucide="more-horizontal"></i> More</summary>
              <div class="catalog-mobile-actions-panel">
                <button class="catalog-mobile-actions-item" type="button" data-action="add" data-node="categories"><i data-lucide="tag"></i> Add Category</button>
                <button class="catalog-mobile-actions-item" type="button" data-action="goto" data-route="media"><i data-lucide="image-plus"></i> Media Library</button>
              </div>
            </details>
          </div>
        </div>
        <div class="catalog-hero">
          <div class="catalog-copy">
            <span class="eyebrow">Live RTDB + RustFS S3 Media</span>
            <h3>${escapeHtml(meta.title)} management</h3>
            <p>${escapeHtml(meta.subtitle)}</p>
          </div>
          <div class="catalog-side">
            ${renderCatalogMetric('Products', counts.products, 'Live product records')}
            ${renderCatalogMetric('Categories', counts.categories, 'Live category records')}
            ${renderCatalogMetric('Total Images', counts.images, 'RustFS S3 media assets')}
            ${renderCatalogMetric('Last Sync', counts.lastSync ? formatDateTime(counts.lastSync) : '-', 'Latest catalog write')}
          </div>
        </div>
        ${renderCatalogTabs()}
        ${renderCollectionInner(meta.node, meta.schema, nodeData)}
      </section>
    </div>
  `;
}

function openCatalogPreview(node, id) {
  const item = getItem(node, id);
  if (!item) return;
  const metrics = (node === 'categories' ? categoryRecordMetrics(item) : productRecordMetrics(item))
    .map((entry) => `
      <div class="summary-card summary-card-flat">
        <span>${escapeHtml(entry.label)}</span>
        <strong>${escapeHtml(String(entry.value))}</strong>
      </div>
    `)
    .join('');
  openModal(`
    <div class="panel-head">
      <div>
        <h2 class="section-title">${escapeHtml(item.title || item.name || 'Preview')}</h2>
        <p class="section-subtitle">${escapeHtml(item.description || item.review || item.answer || item.category || 'Catalog item preview')}</p>
      </div>
      <button class="btn btn-ghost" data-close-modal type="button"><i data-lucide="x"></i></button>
    </div>
    <div class="editor-layout catalog-preview-layout">
      <div class="editor-preview-column">
        <div class="editor-preview glass">
          <div class="editor-preview-media">${itemPreviewThumb(item)}</div>
          <div class="editor-preview-body">
            <span class="editor-preview-badge">${escapeHtml(node === 'categories' ? 'Category' : 'Product')}</span>
            <h3>${escapeHtml(item.title || item.name || 'Untitled')}</h3>
            <p>${escapeHtml(item.description || item.review || item.answer || item.category || '-')}</p>
          </div>
        </div>
      </div>
      <div class="editor-preview-column">
        <div class="panel glass editor-preview">
          <div class="editor-preview-list">${metrics}</div>
          <div class="card-list">
            <div class="item-card"><strong>Status</strong><div class="meta">${escapeHtml(String(item.status || 'active'))}</div></div>
            <div class="item-card"><strong>Slug</strong><div class="meta">${escapeHtml(item.slug || '-')}</div></div>
            <div class="item-card"><strong>Category</strong><div class="meta">${escapeHtml(item.category || '-')}</div></div>
            <div class="item-card"><strong>Order Link</strong><div class="meta">${escapeHtml(item.orderLink || '-')}</div></div>
          </div>
        </div>
      </div>
    </div>
  `);
}

function orderedCategories() {
  return listCollection('categories')
    .filter((item) => item.status !== 'deleted')
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
}

async function reorderCategory(id, direction) {
  const items = orderedCategories();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return;
  const current = items[index];
  const target = items[nextIndex];
  await updateRecord('categories', current.id, { displayOrder: target.displayOrder || nextIndex + 1 });
  await updateRecord('categories', target.id, { displayOrder: current.displayOrder || index + 1 });
  showToast('Category reordered');
  renderView(ui.data || {});
}

async function reorderProductPosition(itemId, targetPosInput) {
  const node = ui.catalogTab === 'categories' ? 'categories' : 'products';
  const nodeLabel = node === 'categories' ? 'Category' : 'Product';
  const allItems = listCollection(node)
    .filter((item) => item.status !== 'deleted')
    .sort((a, b) => {
      const orderA = a.displayOrder !== undefined && a.displayOrder !== null ? Number(a.displayOrder) : 999999;
      const orderB = b.displayOrder !== undefined && b.displayOrder !== null ? Number(b.displayOrder) : 999999;
      if (orderA !== orderB) return orderA - orderB;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

  if (!allItems.length) return;

  const totalCount = allItems.length;
  const targetPos = Math.max(1, Math.min(totalCount, Math.floor(Number(targetPosInput))));

  if (isNaN(targetPos)) {
    showToast('Invalid target position', 'danger');
    return;
  }

  const currentIndex = allItems.findIndex((item) => item.id === itemId);
  if (currentIndex === -1) {
    showToast(`${nodeLabel} not found`, 'danger');
    return;
  }

  const currentPos = currentIndex + 1;
  if (currentPos === targetPos) {
    showToast(`${nodeLabel} is already at position #${targetPos}`, 'info');
    return;
  }

  const targetItem = allItems[currentIndex];
  const listWithoutTarget = allItems.filter((item) => item.id !== itemId);
  listWithoutTarget.splice(targetPos - 1, 0, targetItem);

  const updates = {};
  const orderMap = {};
  const now = Date.now();

  listWithoutTarget.forEach((item, index) => {
    const newPos = index + 1;
    item.displayOrder = newPos;
    orderMap[item.id] = newPos;
    updates[`${item.id}/displayOrder`] = newPos;
    updates[`${item.id}/updatedAt`] = now;
    if (STORE[node] && STORE[node][item.id]) {
      STORE[node][item.id].displayOrder = newPos;
      STORE[node][item.id].updatedAt = now;
    }
  });

  ui.sort = 'displayOrder';
  emit();
  renderView(ui.data || {});

  try {
    const adminHeaders = (typeof getAdminTokenHeader === 'function') ? await getAdminTokenHeader() : {};
    const apiRes = await fetch('/api/seller/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders },
      body: JSON.stringify({ action: 'reorder_batch', orderMap }),
    });

    if (apiRes.ok) {
      showToast(`Moved ${nodeLabel.toLowerCase()} to position #${targetPos}`, 'success');
    } else {
      await updateRecordsBatch(node, updates);
      showToast(`Moved ${nodeLabel.toLowerCase()} to position #${targetPos}`, 'success');
    }
  } catch (err) {
    console.error('Reorder sync notice:', err);
    try {
      await updateRecordsBatch(node, updates);
      showToast(`Moved ${nodeLabel.toLowerCase()} to position #${targetPos}`, 'success');
    } catch (_) {
      showToast(`Moved ${nodeLabel.toLowerCase()} to position #${targetPos}`, 'info');
    }
  }

  renderView(ui.data || {});
}

function openMovePositionModal(itemId) {
  const node = ui.catalogTab === 'categories' ? 'categories' : 'products';
  const nodeLabel = node === 'categories' ? 'Category' : 'Product';
  const allItems = listCollection(node)
    .filter((item) => item.status !== 'deleted')
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0) || (a.createdAt || 0) - (b.createdAt || 0));

  const itemIndex = allItems.findIndex((item) => item.id === itemId);
  if (itemIndex === -1) return;

  const item = allItems[itemIndex];
  const currentPos = itemIndex + 1;
  const totalCount = allItems.length;
  const itemTitle = item.title || item.name || item.slug || nodeLabel;

  openModal(`
    <div class="panel-head">
      <div>
        <h2 class="section-title"><i data-lucide="arrow-up-down"></i> Move ${nodeLabel} Position</h2>
        <p class="section-subtitle">Reorder position across the entire ${nodeLabel.toLowerCase()} catalog.</p>
      </div>
      <button class="btn btn-ghost" data-close-modal type="button"><i data-lucide="x"></i></button>
    </div>
    <form id="movePositionForm" style="display:flex;flex-direction:column;gap:16px;padding:8px 0;">
      <div class="move-pos-info-card glass" style="padding:14px 18px;border-radius:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);">
        <div style="font-weight:700;font-size:1.05rem;color:#fff;margin-bottom:4px;">${escapeHtml(itemTitle)}</div>
        <div style="font-size:0.85rem;color:var(--muted);display:flex;gap:16px;">
          <span>Current position: <strong style="color:#f472b6;">#${currentPos}</strong></span>
          <span>Total ${nodeLabel.toLowerCase()}s: <strong>${totalCount}</strong></span>
        </div>
      </div>
      <div class="field">
        <label for="targetPosInput">Move to Position (1 - ${totalCount})</label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input class="input" type="number" id="targetPosInput" name="targetPosition" min="1" max="${totalCount}" step="1" value="${currentPos}" required placeholder="Enter position (1-${totalCount})" autofocus style="font-size: 1.1rem; font-weight: 700;" />
        </div>
        <!-- Quick Touch Helper Chips on Mobile & Desktop -->
        <div class="quick-pos-chips" style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px;">
          <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('targetPosInput').value = 1;" style="font-size: 0.75rem; padding: 4px 8px;"><i data-lucide="chevrons-up"></i> Top #1</button>
          ${currentPos > 1 ? `<button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('targetPosInput').value = Math.max(1, ${currentPos - 1});" style="font-size: 0.75rem; padding: 4px 8px;"><i data-lucide="chevron-up"></i> Up 1 (${currentPos - 1})</button>` : ''}
          ${currentPos < totalCount ? `<button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('targetPosInput').value = Math.min(${totalCount}, ${currentPos + 1});" style="font-size: 0.75rem; padding: 4px 8px;"><i data-lucide="chevron-down"></i> Down 1 (${currentPos + 1})</button>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('targetPosInput').value = ${totalCount};" style="font-size: 0.75rem; padding: 4px 8px;"><i data-lucide="chevrons-down"></i> Bottom #${totalCount}</button>
        </div>
        <small style="color:var(--muted);font-size:0.78rem;margin-top:6px;display:block;">All ${nodeLabel.toLowerCase()}s will automatically shift into their new sequence.</small>
      </div>
      <div class="toolbar" style="margin-top:8px;justify-content:flex-end;gap:10px;">
        <button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>
        <button type="submit" class="btn btn-primary" id="btnSubmitMove"><i data-lucide="check"></i> Apply Position</button>
      </div>
    </form>
  `);

  if (window.lucide) lucide.createIcons();

  const form = document.getElementById('movePositionForm');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = document.getElementById('btnSubmitMove');
    const inputVal = form.querySelector('[name="targetPosition"]')?.value;
    const targetPos = parseInt(inputVal, 10);

    if (isNaN(targetPos) || targetPos < 1 || targetPos > totalCount) {
      showToast(`Please enter a valid position between 1 and ${totalCount}`, 'danger');
      return;
    }

    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Moving...';
      if (window.lucide) lucide.createIcons();
    }

    try {
      closeModal();
      await reorderProductPosition(itemId, targetPos);
    } catch (err) {
      showToast(`Failed to move ${nodeLabel.toLowerCase()} position`, 'danger');
    }
  });
}

function initCatalogDragAndDrop() {
  const grid = document.getElementById('catalogResultsGrid');
  if (!grid) return;

  const cards = grid.querySelectorAll('.catalog-card-product[draggable="true"], .catalog-card-category[draggable="true"]');
  if (!cards.length) return;

  let draggedId = null;

  cards.forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      draggedId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedId);
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      cards.forEach((c) => c.classList.remove('drag-over'));
      draggedId = null;
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (card.dataset.id !== draggedId) {
        card.classList.add('drag-over');
      }
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });

    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const sourceId = draggedId || e.dataTransfer.getData('text/plain');
      const targetId = card.dataset.id;

      if (!sourceId || !targetId || sourceId === targetId) return;

      const node = ui.catalogTab === 'categories' ? 'categories' : 'products';
      const allItems = listCollection(node)
        .filter((item) => item.status !== 'deleted')
        .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0) || (a.createdAt || 0) - (b.createdAt || 0));

      const targetIndex = allItems.findIndex((item) => item.id === targetId);
      if (targetIndex === -1) return;

      const targetPos = targetIndex + 1;
      await reorderProductPosition(sourceId, targetPos);
    });
  });
}

function openMoveCategoryModal(ids) {
  const categories = orderedCategories();
  if (!categories.length) {
    showToast('Create a category first', 'warning');
    return;
  }
  openModal(`
    <div class="panel-head">
      <div>
        <h2 class="section-title">Move Category</h2>
        <p class="section-subtitle">Update the selected products to a different category.</p>
      </div>
      <button class="btn btn-ghost" data-close-modal type="button"><i data-lucide="x"></i></button>
    </div>
    <form id="bulkMoveForm">
      <div class="field">
        <label>Target Category</label>
        <select class="select" name="category" required>
          ${categories.map((item) => `<option value="${escapeHtml(item.title || item.slug || item.id)}">${escapeHtml(item.title || item.slug || item.id)}</option>`).join('')}
        </select>
      </div>
      <div class="toolbar" style="margin-top:16px;justify-content:flex-end;">
        <button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>
        <button type="submit" class="btn btn-primary">Move Selected</button>
      </div>
    </form>
  `);
  const form = document.getElementById('bulkMoveForm');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const category = form.querySelector('[name="category"]').value;
    for (const id of ids) {
      await updateRecord('products', id, { category });
    }
    showToast('Products moved');
    clearSelection();
    closeModal();
    renderView(ui.data || {});
  }, { once: true });
}

async function applyBulkAction(action, node, ids) {
  const selectedIds = [...ids].filter(Boolean);
  if (!selectedIds.length) return;
  if (action === 'delete') {
    if (!confirm(`Delete ${selectedIds.length} selected records?`)) return;
    for (const id of selectedIds) {
      await deleteRecord(node, id);
    }
    clearSelection();
    showToast('Selected records deleted');
    renderView(ui.data || {});
    return;
  }
  if (action === 'duplicate') {
    for (const id of selectedIds) {
      await duplicateRecord(node, id);
    }
    clearSelection();
    showToast('Selected records duplicated');
    renderView(ui.data || {});
    return;
  }
  if (action === 'hide' || action === 'show') {
    const status = action === 'hide' ? 'hidden' : 'active';
    for (const id of selectedIds) {
      await updateRecord(node, id, { status });
    }
    clearSelection();
    showToast(`Selected records ${status}`);
    renderView(ui.data || {});
    return;
  }
  if (action === 'move-category' && node === 'products') {
    openMoveCategoryModal(selectedIds);
  }
}

function renderSingleEditorPage(node, schema, data = {}) {
  const record = data || {};
  const isHero = node === 'hero';
  const isBanner = node === 'banner';
  const isLive = (record.status || 'active') === 'active';
  const lastUpdated = singleEditorLastUpdated(record);

  return `
    <div class="page active management-page-shell single-editor-page-shell" style="max-width: 1200px; margin: 0 auto; padding-bottom: 60px;">
      
      <!-- Top Control Bar -->
      <section class="panel glass" style="padding: 24px 28px; border-radius: 16px; margin-bottom: 24px; border: 1px solid var(--border);">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
              <span style="font-size: 11px; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.08em;">
                ${escapeHtml(isHero ? 'Homepage Hero' : 'Homepage Deal')}
              </span>
              <span class="badge ${isLive ? 'success' : 'warning'}" style="font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">
                <i data-lucide="${isLive ? 'eye' : 'eye-off'}" style="width: 12px; height: 12px;"></i>
                ${isLive ? 'Live on Store' : 'Hidden from Store'}
              </span>
            </div>
            <h2 style="margin: 0; font-size: 24px; font-weight: 800; color: var(--text);">${escapeHtml(schema.title)}</h2>
            <p style="margin: 4px 0 0 0; color: var(--muted); font-size: 13px;">${escapeHtml(schema.description)}</p>
          </div>
          <div class="toolbar" style="display: flex; gap: 10px; align-items: center;">
            <a class="btn btn-ghost" href="/" target="_blank" style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px;">
              <i data-lucide="external-link"></i> View on Website
            </a>
          </div>
        </div>
      </section>

      <!-- Main Layout: Preview on Left, Direct Form on Right -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 24px; align-items: start;">
        
        <!-- LIVE PREVIEW CARD -->
        <div>
          <div style="position: sticky; top: 88px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
              <span style="font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); letter-spacing: 0.05em; display: flex; align-items: center; gap: 6px;">
                <i data-lucide="monitor" style="width: 14px; height: 14px; color: var(--primary);"></i> Live Storefront Preview
              </span>
              <small style="font-size: 11px; color: var(--muted);">Last updated: ${escapeHtml(lastUpdated)}</small>
            </div>

            ${isBanner ? `
              <!-- Realistic Banner Card Preview -->
              <div class="panel glass" style="padding: 24px; border-radius: 16px; border: 1px solid rgba(99, 102, 241, 0.3); background: linear-gradient(145deg, rgba(99, 102, 241, 0.08), rgba(236, 72, 153, 0.05)); position: relative; overflow: hidden; box-shadow: 0 12px 30px rgba(0,0,0,0.3);">
                <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #6366f1, #ec4899);"></div>
                
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
                  <span style="background: rgba(236, 72, 153, 0.15); color: #f472b6; border: 1px solid rgba(236, 72, 153, 0.3); padding: 4px 10px; border-radius: 99px; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                    🔥 PINNED DEAL
                  </span>
                  <span style="font-size: 11px; color: var(--muted);">${escapeHtml(record.status === 'hidden' ? '⚠️ Hidden' : '🟢 Active')}</span>
                </div>

                <h3 style="font-size: 20px; font-weight: 800; color: var(--text); margin: 0 0 8px 0; line-height: 1.3;">
                  ${escapeHtml(record.title || 'All Collection Pack')}
                </h3>
                
                <p style="font-size: 13px; color: var(--muted); margin: 0 0 18px 0; line-height: 1.5;">
                  ${escapeHtml(record.description || 'Mega Pack — 3 Lac+ Videos | Every category bundled together — the ultimate deal.')}
                </p>

                <div style="display: flex; align-items: baseline; gap: 10px; margin-bottom: 18px; padding: 12px 16px; background: rgba(0,0,0,0.25); border-radius: 10px; border: 1px solid rgba(255,255,255,0.05);">
                  <span style="font-size: 22px; font-weight: 900; color: #10b981;">
                    ${escapeHtml(record.priceOfferINR ? `₹${record.priceOfferINR.replace(/[^0-9,]/g, '')}` : '₹15,700')}
                  </span>
                  ${record.priceOfferUSD ? `
                    <span style="font-size: 14px; font-weight: 700; color: #818cf8;">
                      / ${escapeHtml(record.priceOfferUSD.startsWith('$') ? record.priceOfferUSD : `$${record.priceOfferUSD}`)}
                    </span>
                  ` : ''}
                  ${record.priceOriginal ? `
                    <span style="font-size: 13px; text-decoration: line-through; color: var(--muted); margin-left: auto;">
                      ${escapeHtml(record.priceOriginal.startsWith('₹') ? record.priceOriginal : `₹${record.priceOriginal}`)}
                    </span>
                  ` : ''}
                </div>

                <a href="${escapeHtml(record.buttonLink || '#')}" target="_blank" style="display: block; width: 100%; text-align: center; padding: 12px; font-size: 14px; font-weight: 700; border-radius: 10px; background: linear-gradient(135deg, #6366f1, #ec4899); color: white; text-decoration: none; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);">
                  ${escapeHtml(record.buttonText || 'Claim Deal')} →
                </a>
              </div>
            ` : `
              <!-- Realistic Hero Preview -->
              <div class="panel glass" style="padding: 24px; border-radius: 16px; border: 1px solid var(--border); background: linear-gradient(145deg, rgba(99, 102, 241, 0.08), rgba(0,0,0,0.4)); position: relative;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                  <span style="font-size: 11px; font-weight: 700; color: var(--primary); text-transform: uppercase;">HERO SECTION</span>
                  <span style="font-size: 11px; color: var(--muted);">${escapeHtml(record.status === 'hidden' ? '⚠️ Hidden' : '🟢 Active')}</span>
                </div>
                <h3 style="font-size: 18px; font-weight: 800; color: var(--text); margin: 0 0 8px 0; line-height: 1.3;">
                  ${escapeHtml(record.title || 'Welcome to Linkadda Shop')}
                </h3>
                <p style="font-size: 12.5px; color: var(--muted); margin: 0 0 16px 0; line-height: 1.4;">
                  ${escapeHtml(record.subtitle || 'High quality products & instant digital access.')}
                </p>
                <div style="display: flex; gap: 8px; margin-bottom: 16px;">
                  <span style="padding: 8px 14px; font-size: 12px; font-weight: 700; background: var(--primary); color: white; border-radius: 8px;">
                    ${escapeHtml(record.primaryButtonText || 'Explore Catalog')}
                  </span>
                  ${record.secondaryButtonText ? `
                    <span style="padding: 8px 14px; font-size: 12px; font-weight: 600; background: rgba(255,255,255,0.06); color: var(--text); border-radius: 8px; border: 1px solid var(--border);">
                      ${escapeHtml(record.secondaryButtonText)}
                    </span>
                  ` : ''}
                </div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.06); text-align: center;">
                  <div style="font-size: 11px; font-weight: 700; color: var(--text);">${escapeHtml(record.stat1 || '50K+ Buyers')}</div>
                  <div style="font-size: 11px; font-weight: 700; color: var(--text);">${escapeHtml(record.stat2 || '100% Instant')}</div>
                  <div style="font-size: 11px; font-weight: 700; color: var(--text);">${escapeHtml(record.stat3 || '24/7 Support')}</div>
                </div>
              </div>
            `}
          </div>
        </div>

        <!-- DIRECT LIVE EDIT FORM -->
        <form id="directSingleForm" data-node="${node}" style="display: flex; flex-direction: column; gap: 20px;">
          
          <!-- Section 1: Content & Copy -->
          <section class="panel glass" style="padding: 24px; border-radius: 16px; border: 1px solid var(--border);">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.06);">
              <div style="width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, #6366f1, #8b5cf6); display: flex; align-items: center; justify-content: center; color: white;">
                <i data-lucide="type" style="width: 16px; height: 16px;"></i>
              </div>
              <div>
                <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: var(--text);">Headline & Promotional Text</h4>
                <p style="margin: 2px 0 0 0; font-size: 11.5px; color: var(--muted);">Shown directly to visitors on the homepage.</p>
              </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 14px;">
              <div>
                <label style="display: block; font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">
                  ${isHero ? 'Hero Title Heading' : 'Banner Deal Title'}
                </label>
                <input type="text" name="title" value="${escapeHtml(record.title || (isHero ? 'Linkadda Premium Shop' : 'All Collection Pack'))}" class="input" style="width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" required />
              </div>

              <div>
                <label style="display: block; font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">
                  ${isHero ? 'Hero Subtitle / Description' : 'Offer Description / Perks'}
                </label>
                <textarea name="description" rows="3" class="textarea" style="width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px; resize: vertical;">${escapeHtml(record.description || record.subtitle || '')}</textarea>
              </div>
            </div>
          </section>

          ${isBanner ? `
            <!-- Section 2: Pricing Details (For Banner) -->
            <section class="panel glass" style="padding: 24px; border-radius: 16px; border: 1px solid var(--border);">
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.06);">
                <div style="width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, #10b981, #059669); display: flex; align-items: center; justify-content: center; color: white;">
                  <i data-lucide="tag" style="width: 16px; height: 16px;"></i>
                </div>
                <div>
                  <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: var(--text);">Pricing & Discount Values</h4>
                  <p style="margin: 2px 0 0 0; font-size: 11.5px; color: var(--muted);">Original crossed-out price vs special discounted price.</p>
                </div>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 14px;">
                <div>
                  <label style="display: block; font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px;">Original Price (Strikethrough)</label>
                  <input type="text" name="priceOriginal" value="${escapeHtml(record.priceOriginal || '₹22,800')}" class="input" style="width: 100%; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" placeholder="₹22,800" />
                </div>

                <div>
                  <label style="display: block; font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: #10b981; margin-bottom: 6px;">Offer Price (INR) ⭐</label>
                  <input type="text" name="priceOfferINR" value="${escapeHtml(record.priceOfferINR || '₹15,700')}" class="input" style="width: 100%; padding: 10px 12px; background: var(--bg); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 8px; color: var(--text); font-size: 13px; font-weight: 700;" placeholder="₹15,700" />
                </div>

                <div>
                  <label style="display: block; font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: #818cf8; margin-bottom: 6px;">Offer Price (USD)</label>
                  <input type="text" name="priceOfferUSD" value="${escapeHtml(record.priceOfferUSD || '$109')}" class="input" style="width: 100%; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" placeholder="$109" />
                </div>
              </div>
            </section>
          ` : `
            <!-- Section 2: Statistics & Secondary (For Hero) -->
            <section class="panel glass" style="padding: 24px; border-radius: 16px; border: 1px solid var(--border);">
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.06);">
                <div style="width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, #10b981, #059669); display: flex; align-items: center; justify-content: center; color: white;">
                  <i data-lucide="bar-chart-2" style="width: 16px; height: 16px;"></i>
                </div>
                <div>
                  <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: var(--text);">Trust Badges / Counter Stats</h4>
                  <p style="margin: 2px 0 0 0; font-size: 11.5px; color: var(--muted);">3 highlight metrics displayed on the hero section.</p>
                </div>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 14px;">
                <div>
                  <label style="display: block; font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px;">Stat 1</label>
                  <input type="text" name="stat1" value="${escapeHtml(record.stat1 || '50K+ Happy Buyers')}" class="input" style="width: 100%; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" />
                </div>
                <div>
                  <label style="display: block; font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px;">Stat 2</label>
                  <input type="text" name="stat2" value="${escapeHtml(record.stat2 || '100% Instant')}" class="input" style="width: 100%; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" />
                </div>
                <div>
                  <label style="display: block; font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px;">Stat 3</label>
                  <input type="text" name="stat3" value="${escapeHtml(record.stat3 || '24/7 Delivery')}" class="input" style="width: 100%; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" />
                </div>
              </div>
            </section>
          `}

          <!-- Section 3: Call To Action & Links -->
          <section class="panel glass" style="padding: 24px; border-radius: 16px; border: 1px solid var(--border);">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.06);">
              <div style="width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, #ec4899, #f43f5e); display: flex; align-items: center; justify-content: center; color: white;">
                <i data-lucide="external-link" style="width: 16px; height: 16px;"></i>
              </div>
              <div>
                <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: var(--text);">Action Buttons & Links</h4>
                <p style="margin: 2px 0 0 0; font-size: 11.5px; color: var(--muted);">Button labels and destinations.</p>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px;">
              <div>
                <label style="display: block; font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px;">
                  ${isHero ? 'Primary Button Text' : 'Button Label Text'}
                </label>
                <input type="text" name="${isHero ? 'primaryButtonText' : 'buttonText'}" value="${escapeHtml(isHero ? (record.primaryButtonText || 'Explore Catalog') : (record.buttonText || 'Claim Deal'))}" class="input" style="width: 100%; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" required />
              </div>

              <div>
                <label style="display: block; font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px;">
                  ${isHero ? 'Primary Button Link' : 'Button Destination Link'}
                </label>
                <input type="text" name="${isHero ? 'primaryButtonLink' : 'buttonLink'}" value="${escapeHtml(isHero ? (record.primaryButtonLink || '#catalog') : (record.buttonLink || 'payment.html'))}" class="input" style="width: 100%; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" required />
              </div>

              ${isHero ? `
                <div>
                  <label style="display: block; font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px;">Secondary Button Text</label>
                  <input type="text" name="secondaryButtonText" value="${escapeHtml(record.secondaryButtonText || 'Telegram Support')}" class="input" style="width: 100%; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" />
                </div>

                <div>
                  <label style="display: block; font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px;">Secondary Button Link</label>
                  <input type="text" name="secondaryButtonLink" value="${escapeHtml(record.secondaryButtonLink || 'https://t.me/TRUSTED_BROTHER1234')}" class="input" style="width: 100%; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" />
                </div>
              ` : ''}
            </div>
          </section>

          <!-- Section 4: Publishing & Media -->
          <section class="panel glass" style="padding: 24px; border-radius: 16px; border: 1px solid var(--border);">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.06);">
              <div style="width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, #f59e0b, #d97706); display: flex; align-items: center; justify-content: center; color: white;">
                <i data-lucide="eye" style="width: 16px; height: 16px;"></i>
              </div>
              <div>
                <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: var(--text);">Visibility & Media</h4>
                <p style="margin: 2px 0 0 0; font-size: 11.5px; color: var(--muted);">Publishing status on the live store.</p>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px;">
              <div>
                <label style="display: block; font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px;">Publishing Status</label>
                <select name="status" class="select" style="width: 100%; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;">
                  <option value="active" ${record.status === 'active' || !record.status ? 'selected' : ''}>🟢 Visible (Active on Home)</option>
                  <option value="hidden" ${record.status === 'hidden' ? 'selected' : ''}>🟡 Hidden (Do Not Show)</option>
                </select>
              </div>

              <div>
                <label style="display: block; font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px;">Image / Background URL (Optional)</label>
                <div style="display: flex; gap: 8px;">
                  <input type="text" id="singleUrlInput_${node}" name="${isHero ? 'backgroundImage' : 'image'}" value="${escapeHtml(isHero ? (record.backgroundImage || '') : (record.image || ''))}" class="input" style="flex: 1; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" placeholder="https://..." />
                  <label class="btn btn-ghost" style="cursor: pointer; padding: 0 12px; display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; border: 1px solid var(--border); border-radius: 8px; font-size: 12px;">
                    <i data-lucide="upload" style="width: 14px; height: 14px;"></i> Upload
                    <input type="file" id="singleUploadFileInput" data-node="${node}" accept="image/*" style="display: none;" />
                  </label>
                </div>
              </div>
            </div>
          </section>

          <!-- Sticky Save Bar -->
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: var(--panel-solid); border: 1px solid var(--border); border-radius: 12px; flex-wrap: wrap; gap: 12px; position: sticky; bottom: 16px; z-index: 10; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
            <div style="display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12.5px;">
              <i data-lucide="sparkles" style="color: #6366f1; width: 15px; height: 15px;"></i>
              <span>Updates apply instantly to the homepage without redeploying.</span>
            </div>
            <button type="submit" class="btn btn-primary" id="saveSingleSubmitBtn" style="padding: 10px 24px; font-weight: 700; font-size: 13.5px; border-radius: 8px; background: linear-gradient(135deg, #6366f1, #8b5cf6) !important; border: none !important; color: white !important; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);">
              <i data-lucide="check" style="width: 16px; height: 16px;"></i> Save ${escapeHtml(schema.title)}
            </button>
          </div>

        </form>
      </div>
    </div>
  `;
}

function normalizeStatusText(value, fallback = 'unknown') {
  const text = String(value || '').trim().toLowerCase();
  return text || fallback;
}

function parseAmountValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!raw) return 0;
  const parsed = Number(raw[0]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrencyCompact(value) {
  const number = parseAmountValue(value);
  return `Rs ${formatNumber(number)}`;
}

function pickFirstValue(item = {}, keys = [], fallback = '') {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return fallback;
}

function candidateText(item = {}, keys = [], fallback = '-') {
  return String(pickFirstValue(item, keys, fallback) || fallback);
}

function orderProductName(item = {}) {
  if (item.cartItems && Array.isArray(item.cartItems) && item.cartItems.length > 0) {
    const names = item.cartItems.map((i) => i.name || i.title).filter(Boolean);
    if (names.length > 0) return names.join(' + ');
  }
  const name = pickFirstValue(item, ['productName', 'package', 'product', 'title', 'name', 'label', 'collectionTitle'], '');
  if (name && name !== 'Product') return name;
  if (item.productId) return String(item.productId);
  return 'Premium Pack Order';
}

function orderProductThumb(item = {}) {
  if (item.image) return resolveMediaSource(item.image) || item.image;
  if (item.productImage) return resolveMediaSource(item.productImage) || item.productImage;
  if (item.cartItems && Array.isArray(item.cartItems) && item.cartItems[0]?.img) {
    return item.cartItems[0].img;
  }
  return '';
}

function orderCustomerLabel(item = {}) {
  const name = pickFirstValue(item, ['customerName', 'name', 'buyerName', 'fullName'], '');
  const email = pickFirstValue(item, ['email', 'customerEmail', 'buyerEmail'], '');
  const phone = pickFirstValue(item, ['phone', 'customerPhone', 'buyerPhone', 'mobile', 'telegram', 'whatsapp'], '');
  const parts = [name, email, phone].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  if (item.source) return `Direct Buyer (${item.source})`;
  return 'Web Checkout Buyer';
}

function orderMethodLabel(item = {}) {
  const m = candidateText(item, ['paymentMethod', 'method', 'gateway', 'channel', 'provider'], '');
  if (!m || m.toLowerCase() === 'unknown' || m === '-') {
    if (item.screenshotUrl || item.proofUrl || item.paymentProof) return 'UPI / Screenshot';
    return 'Online Checkout';
  }
  return m;
}

function orderTransactionId(item = {}) {
  return candidateText(item, ['transactionId', 'referenceId', 'txnId', 'paymentId', 'orderId', 'checkoutToken', 'id'], '-');
}

function orderStatusValue(item = {}) {
  return normalizeStatusText(pickFirstValue(item, ['paymentStatus', 'orderStatus', 'status', 'state'], 'pending'));
}

function orderPaymentProof(item = {}) {
  return pickFirstValue(item, ['paymentProof', 'screenshotUrl', 'proofUrl', 'proof', 'screenshot', 'receiptUrl', 'receipt', 'image', 'screenshotBase64', 'payment_proof'], '');
}

function orderDeliveryInfo(item = {}) {
  return candidateText(item, ['deliveryInfo', 'accessInfo', 'delivery', 'access', 'notes'], '');
}

function orderDateValue(item = {}) {
  return recordTimestamp(item);
}

function isPaidOrder(item = {}) {
  const value = orderStatusValue(item);
  return ['paid', 'approved', 'success', 'completed', 'complete', 'verified'].includes(value);
}

function isPendingOrder(item = {}) {
  const value = orderStatusValue(item);
  return ['pending', 'processing', 'initiated', 'created', 'pending_payment', 'verification_pending'].includes(value);
}

function isFailedOrder(item = {}) {
  const value = orderStatusValue(item);
  return ['failed', 'rejected', 'expired', 'cancelled', 'canceled', 'error'].includes(value);
}

function renderStatusBadge(value) {
  const status = normalizeStatusText(value, 'unknown');
  const cls = status === 'paid' || status === 'approved' || status === 'completed'
    ? 'success'
    : status === 'pending' || status === 'processing'
      ? 'warning'
      : status === 'failed' || status === 'rejected' || status === 'expired'
        ? 'danger'
        : 'badge';
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

function orderStatusLabel(item = {}) {
  const value = orderStatusValue(item);
  if (value === 'pending') return 'Payment Submitted';
  if (value === 'approved' || value === 'paid') return 'Approved';
  if (value === 'completed') return 'Completed';
  if (value === 'rejected' || value === 'failed' || value === 'expired') return 'Rejected / Failed';
  return value;
}

function managementCounts(list = [], predicate = () => true) {
  return list.filter(predicate).length;
}

function managementTotals(list = []) {
  const today = new Date().toISOString().slice(0, 10);
  const monthKey = today.slice(0, 7);
  const totalReceived = list.filter(isPaidOrder).reduce((total, item) => total + parseAmountValue(item.amount || item.inr || item.amountINR), 0);
  const pending = managementCounts(list, isPendingOrder);
  const failed = managementCounts(list, isFailedOrder);
  const todayCount = list.filter((item) => String(item.date || '').slice(0, 10) === today || new Date(orderDateValue(item)).toISOString().slice(0, 10) === today).length;
  const monthCount = list.filter((item) => String(item.date || '').slice(0, 7) === monthKey || new Date(orderDateValue(item)).toISOString().slice(0, 7) === monthKey).length;
  return {
    totalReceived,
    pending,
    failed,
    today: todayCount,
    month: monthCount,
    total: list.length,
    paid: managementCounts(list, isPaidOrder),
  };
}

function filterManagementList(items = [], type = 'orders') {
  const search = String(ui.management.search || '').trim().toLowerCase();
  const status = String(ui.management.status || 'all');
  const method = String(ui.management.method || 'all');
  const date = String(ui.management.date || 'all');
  return items.filter((item) => {
    if (type === 'payment' && !orderPaymentProof(item)) return false;
    const searchable = JSON.stringify(item).toLowerCase();
    const itemStatus = orderStatusValue(item);
    const itemMethod = orderMethodLabel(item).toLowerCase();
    const orderDate = orderDateValue(item);
    const day = String(item.date || '').slice(0, 10) || (orderDate ? new Date(orderDate).toISOString().slice(0, 10) : '');
    if (search && !searchable.includes(search)) return false;
    if (status !== 'all') {
      if (status === 'paid' && !isPaidOrder(item)) return false;
      if (status === 'pending' && !isPendingOrder(item)) return false;
      if (status === 'failed' && !isFailedOrder(item)) return false;
      if (status === 'all' ? false : !['paid', 'pending', 'failed'].includes(status) && itemStatus !== status) return false;
    }
    if (method !== 'all' && itemMethod !== method.toLowerCase()) return false;
    if (date !== 'all') {
      const today = new Date();
      const todayKey = today.toISOString().slice(0, 10);
      const monthKey = today.toISOString().slice(0, 7);
      if (date === 'today' && day !== todayKey) return false;
      if (date === 'month' && day.slice(0, 7) !== monthKey) return false;
    }
    return true;
  });
}

function sortManagementList(items = []) {
  return [...items].sort((a, b) => orderDateValue(b) - orderDateValue(a));
}

function renderManagementSummaryCard(label, value, detail = '', tone = 'primary') {
  return `
    <div class="management-summary-card glass ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
    </div>
  `;
}

function renderInfoTile(label, value, detail = '') {
  return `
    <div class="management-info-tile">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value || '-'))}</strong>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
    </div>
  `;
}

function renderFieldGroup(title, description, content) {
  return `
    <section class="management-section panel glass">
      <div class="panel-head management-section-head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p class="section-subtitle">${escapeHtml(description)}</p>
        </div>
      </div>
      ${content}
    </section>
  `;
}

function singleEditorMediaValue(node, record = {}) {
  if (node === 'hero') return String(record.backgroundImage || record.image || '').trim();
  if (node === 'settings') return String(record.logo || record.favicon || record.qrImage || record.image || '').trim();
  if (node === 'payment') return String(record.qrImage || record.logo || record.image || '').trim();
  return String(record.image || record.backgroundImage || '').trim();
}

function singleEditorDisplayTitle(node, record = {}) {
  if (node === 'settings') return String(record.siteName || record.appName || 'Settings').trim();
  if (node === 'payment') return 'Payment Settings';
  return String(record.title || (node === 'hero' ? 'Hero' : 'Banner') || '').trim();
}

function singleEditorDisplaySubtitle(node, record = {}) {
  if (node === 'hero') return String(record.subtitle || 'Homepage hero copy and calls to action.');
  if (node === 'settings') return String(record.footer || record.publicSiteSync || record.maintenanceMode || 'Website configuration and checkout settings.');
  if (node === 'payment') return String(record.instructions || record.telegramUrl || record.telegramChannel || 'Checkout payment methods and proof handling.');
  if (node === 'banner') return String(record.description || record.offer || 'Homepage promotional banner and CTA.');
  return String(record.offer || 'Homepage promotional banner and CTA.');
}

function singleEditorLastUpdated(record = {}) {
  return formatDateTime(record.updatedAt || record.createdAt);
}

function renderSingleEditorPreviewCard(node, record = {}) {
  const image = singleEditorMediaValue(node, record);
  const title = singleEditorDisplayTitle(node, record);
  const subtitle = singleEditorDisplaySubtitle(node, record);
  const imageLabel = node === 'hero'
    ? 'Background Image'
    : node === 'settings'
      ? 'Logo / Favicon'
      : node === 'payment'
        ? 'QR Image'
        : 'Banner Image';
  const sectionLabel = node === 'hero'
    ? 'Hero Section'
    : node === 'settings'
      ? 'Website Settings'
      : node === 'payment'
        ? 'Payment Settings'
        : 'Banner Section';
  return `
    <div class="single-editor-preview panel glass">
      <div class="single-editor-preview-media">
        ${image ? `<img src="${escapeHtml(resolveMediaSource(image) || image)}" alt="${escapeHtml(title || imageLabel)}" loading="lazy" />` : renderMediaFallback(`No ${imageLabel.toLowerCase()} selected`)}
      </div>
      <div class="single-editor-preview-body">
        <span class="editor-preview-badge">${escapeHtml(sectionLabel)}</span>
        <h3>${escapeHtml(title || sectionLabel)}</h3>
        <p>${escapeHtml(subtitle)}</p>
        <div class="single-editor-url">${escapeHtml(image || 'Image URL not set')}</div>
      </div>
    </div>
  `;
}

function renderSingleEditorSummaryGrid(node, record = {}) {
  if (node === 'hero') {
    return `
      <div class="single-editor-summary-grid">
        ${renderInfoTile('Hero Title', record.title || 'Not set')}
        ${renderInfoTile('Subtitle', record.subtitle || 'Not set')}
        ${renderInfoTile('Primary Button', [record.primaryButtonText, record.primaryButtonLink].filter(Boolean).join(' · ') || 'Not set')}
        ${renderInfoTile('Secondary Button', [record.secondaryButtonText, record.secondaryButtonLink].filter(Boolean).join(' · ') || 'Not set')}
        ${renderInfoTile('Status', record.status || 'active')}
        ${renderInfoTile('Last Updated', singleEditorLastUpdated(record))}
      </div>
      <div class="single-editor-stat-grid">
        ${renderInfoTile('Stat 1', record.stat1 || 'Not set')}
        ${renderInfoTile('Stat 2', record.stat2 || 'Not set')}
        ${renderInfoTile('Stat 3', record.stat3 || 'Not set')}
      </div>
    `;
  }
  if (node === 'settings') {
    return `
      <div class="single-editor-summary-grid">
        ${renderInfoTile('Website Name', record.siteName || record.appName || 'Not set')}
        ${renderInfoTile('Email', record.email || 'Not set')}
        ${renderInfoTile('WhatsApp', record.whatsapp || 'Not set')}
        ${renderInfoTile('Telegram', record.telegram || 'Not set')}
        ${renderInfoTile('Currency', record.currency || 'INR')}
        ${renderInfoTile('Maintenance', record.maintenanceMode || 'off')}
      </div>
      <div class="single-editor-stat-grid">
        ${renderInfoTile('Currency Symbol', record.currencySymbol || '₹')}
        ${renderInfoTile('Price Format', record.priceFormat || 'INR / USD')}
        ${renderInfoTile('Last Updated', singleEditorLastUpdated(record))}
      </div>
    `;
  }
  if (node === 'payment') {
    return `
      <div class="single-editor-summary-grid">
        ${renderInfoTile('Recommended Method', record.recommendedMethod || 'binancepay')}
        ${renderInfoTile('UPI ID', record.upiId || 'Not set')}
        ${renderInfoTile('QR Image', record.qrImage ? 'Configured' : 'Not set')}
        ${renderInfoTile('Instructions', record.instructions || 'Not set')}
        ${renderInfoTile('Telegram', record.telegramUrl || record.telegramChannel || 'Not set')}
        ${renderInfoTile('Binance', record.binanceId || 'Not set')}
        ${renderInfoTile('PayPal', record.paypalLink || 'Not set')}
      </div>
      <div class="single-editor-stat-grid">
        ${renderInfoTile('BEP-20', record.bep20Address || 'Not set')}
        ${renderInfoTile('ERC-20', record.ethAddress || 'Not set')}
        ${renderInfoTile('Last Updated', singleEditorLastUpdated(record))}
      </div>
    `;
  }
  return `
    <div class="single-editor-summary-grid">
      ${renderInfoTile('Banner Title', record.title || 'Not set')}
      ${renderInfoTile('Description', record.description || record.offer || 'Not set')}
      ${renderInfoTile('Original Price', record.priceOriginal || 'Not set')}
      ${renderInfoTile('Offer INR', record.priceOfferINR || 'Not set')}
      ${renderInfoTile('Offer USD', record.priceOfferUSD || 'Not set')}
      ${renderInfoTile('Button Text', record.buttonText || 'Not set')}
      ${renderInfoTile('Button Link', record.buttonLink || record.link || 'Not set')}
      ${renderInfoTile('Status', record.status || 'active')}
      ${renderInfoTile('Last Updated', singleEditorLastUpdated(record))}
    </div>
  `;
}

function renderSingleEditorFieldSections(node, schema, record = {}) {
  const fieldByKey = (key) => schema.fields.find((field) => field.key === key);
  const groups = node === 'hero'
    ? [
        {
          title: 'Hero Copy',
          description: 'Main heading and supporting text for the homepage hero.',
          keys: ['title', 'subtitle'],
        },
        {
          title: 'Call to Action',
          description: 'Primary and secondary button labels and links.',
          keys: ['primaryButtonText', 'primaryButtonLink', 'secondaryButtonText', 'secondaryButtonLink'],
        },
        {
          title: 'Statistics',
          description: 'Three supporting stats shown on the hero block.',
          keys: ['stat1', 'stat2', 'stat3'],
        },
        {
          title: 'Media & Publishing',
          description: 'Background image and publishing status.',
          keys: ['backgroundImage', 'status'],
        },
      ]
    : node === 'settings'
      ? [
          {
            title: 'Website Identity',
            description: 'Brand name, logo, favicon, and footer copy.',
            keys: ['siteName', 'logo', 'favicon', 'footer'],
          },
          {
            title: 'Contact & Social',
            description: 'Contact details and social profiles for the public site.',
            keys: ['email', 'whatsapp', 'telegram', 'socialLinks'],
          },
          {
            title: 'Website Controls',
            description: 'Maintenance mode, public website status, and display preferences.',
            keys: ['maintenanceMode', 'publicSiteSync', 'currency', 'currencySymbol', 'priceFormat'],
          },
        ]
      : node === 'payment'
        ? [
            {
              title: '⭐ Priority & Recommended Choice (Top Placement)',
              description: 'Select which payment method appears at the very top with the special Recommendation Badge on checkout.',
              keys: ['recommendedMethod', 'recommendationBadge'],
            },
            {
              title: 'UPI Payment Method (GPay, PhonePe, Paytm, QR)',
              description: 'Custom title, subtitle, custom logo image, and merchant VPA ID.',
              keys: ['upiTitle', 'upiSub', 'upiLogo', 'upiId', 'merchantName', 'qrImage'],
            },
            {
              title: 'Binance Pay & Crypto Method',
              description: 'Custom title, subtitle, custom logo, Binance Pay ID, and USDT wallet addresses.',
              keys: ['binanceTitle', 'binanceSub', 'binanceLogo', 'binanceId', 'bep20Address', 'ethAddress'],
            },
            {
              title: 'Cards & Netbanking Display Settings',
              description: 'Custom titles, subtitles, and custom logos for credit/debit cards and Netbanking.',
              keys: ['cardsTitle', 'cardsSub', 'cardsLogo', 'netbankingTitle', 'netbankingSub', 'netbankingLogo', 'walletTitle', 'walletSub'],
            },
            {
              title: 'Direct Bank Transfer (IMPS / NEFT)',
              description: 'Bank name, account holder name, account number, IFSC code, and custom logo.',
              keys: ['bankTitle', 'bankSub', 'bankLogo', 'bankName', 'accountHolder', 'accountNumber', 'ifscCode', 'bankUpiId'],
            },
            {
              title: 'Bitcoin (BTC)',
              description: 'Native Bitcoin mainnet wallet address, titles, and custom logo.',
              keys: ['btcTitle', 'btcSub', 'btcLogo', 'btcAddress'],
            },
            {
              title: 'Support, Instructions & Gateway Status',
              description: 'Checkout notice, Telegram support URL, and global publishing status.',
              keys: ['instructions', 'telegramUrl', 'telegramChannel', 'paypalLink', 'status'],
            },
          ]
    : [
        {
          title: 'Banner Content',
          description: 'Title and promotional copy for the banner.',
          keys: ['title', 'description'],
        },
        {
          title: 'Pricing Details',
          description: 'Original and promotional prices for INR and USD.',
          keys: ['priceOriginal', 'priceOfferINR', 'priceOfferUSD'],
        },
        {
          title: 'Call to Action',
          description: 'Banner button label and destination.',
          keys: ['buttonText', 'buttonLink'],
        },
        {
          title: 'Publishing',
          description: 'Publishing status of the banner.',
          keys: ['status'],
        },
      ];

  return groups.map((group) => `
    <section class="editor-section single-editor-section">
      <div class="editor-section-head">
        <div>
          <h4>${escapeHtml(group.title)}</h4>
          <p>${escapeHtml(group.description)}</p>
        </div>
      </div>
      <div class="form-grid single-editor-fields${group.keys.length === 1 ? ' single-column' : ''}">
        ${group.keys.map((key) => {
          const field = fieldByKey(key);
          return field ? fieldMarkup(field, record[field.key] ?? '', { allowUploads: true }) : '';
        }).join('')}
      </div>
    </section>
  `).join('');
}

function singleEditorUploadFolder(node, key) {
  if (node === 'hero' && key === 'backgroundImage') return 'hero';
  if (node === 'banner' && key === 'image') return 'banner';
  if (node === 'settings') {
    if (key === 'logo' || key === 'favicon') return 'logos';
    return 'settings';
  }
  if (node === 'payment') {
    if (key === 'qrImage') return 'payments';
    return 'payment';
  }
  return 'images';
}

async function uploadSingleEditorMedia(form, node, next, statusEl = null) {
  const fileInputs = [...form.querySelectorAll('input[type="file"][name$="File"]')];
  const uploads = fileInputs
    .map((input) => ({
      input,
      file: input.files?.[0] || null,
      key: input.name.replace(/File$/, ''),
    }))
    .filter((entry) => entry.file);

  if (!uploads.length) return next;

  const total = uploads.length;
  let done = 0;
  for (const entry of uploads) {
    const folder = singleEditorUploadFolder(node, entry.key);
    if (statusEl) statusEl.textContent = `Uploading ${entry.key}... 0%`;
    const result = await uploadAsset(entry.file, folder, (value) => {
      if (statusEl) statusEl.textContent = `Uploading ${entry.key}... ${value}%`;
    });
    await saveUploadedMediaRecord(entry.file, result, folder, 'image', `${node}-single-editor`, `${node}:${entry.key}:${entry.file.name}`);
    next[entry.key] = result.publicUrl;
    done += 1;
    if (statusEl) statusEl.textContent = `Uploaded ${done} of ${total} image${total === 1 ? '' : 's'}`;
  }

  if (next.backgroundImage && !next.image) next.image = next.backgroundImage;
  if (next.image && !Array.isArray(next.images)) next.images = [next.image];
  return next;
}

function buildAdminSnapshot(data = {}) {
  const settings = safeJson(data.settings || {});
  const payment = safeJson(data.payment || {});
  const theme = document.body.dataset.theme || getTheme();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    theme,
    settings,
    payment,
  };
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openAdminSnapshotImportModal() {
  openModal(`
    <div class="panel-head management-modal-head">
      <div>
        <h2 class="section-title">Import Admin Snapshot</h2>
        <p class="section-subtitle">Restore settings and payment configuration from a safe JSON export.</p>
      </div>
      <button class="btn btn-ghost" data-close-modal type="button"><i data-lucide="x"></i></button>
    </div>
    <form id="adminSnapshotImportForm" class="management-import-form">
      <div class="field">
        <label for="adminSnapshotFile">JSON File</label>
        <input class="input" id="adminSnapshotFile" name="snapshotFile" type="file" accept="application/json,.json" />
      </div>
      <div class="field">
        <label for="adminSnapshotPaste">Or Paste JSON</label>
        <textarea class="textarea" id="adminSnapshotPaste" name="snapshotJson" placeholder='{"settings": {...}, "payment": {...}}'></textarea>
      </div>
      <div class="management-note">
        Only settings, payment, theme, and export metadata are imported. Secrets and unrelated nodes are ignored.
      </div>
      <div class="toolbar management-actions-inline">
        <button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>
        <button type="submit" class="btn btn-primary">Import Snapshot</button>
      </div>
      <div class="management-import-status" id="adminSnapshotStatus"></div>
    </form>
  `);
}

async function applyAdminSnapshotImport(form) {
  const status = form.querySelector('#adminSnapshotStatus');
  const file = form.querySelector('#adminSnapshotFile')?.files?.[0] || null;
  const pasted = String(form.querySelector('#adminSnapshotPaste')?.value || '').trim();
  let payload = null;

  try {
    if (file) {
      payload = JSON.parse(await file.text());
    } else if (pasted) {
      payload = JSON.parse(pasted);
    } else {
      throw new Error('Choose a JSON file or paste snapshot data first.');
    }
  } catch (error) {
    const message = error?.message || 'Invalid JSON snapshot';
    if (status) status.textContent = message;
    showToast(message, 'danger');
    return;
  }

  const nextSettings = safeJson(payload?.settings || {});
  const nextPayment = safeJson(payload?.payment || {});

  try {
    if (Object.keys(nextSettings).length) {
      await updateRecord('settings', null, nextSettings);
    }
    if (Object.keys(nextPayment).length) {
      await updateRecord('payment', null, nextPayment);
    }
    if (payload?.theme) {
      setTheme(String(payload.theme));
    }
    if (status) status.textContent = 'Snapshot imported successfully.';
    showToast('Admin snapshot imported');
    closeModal();
    renderView(ui.data || {});
  } catch (error) {
    const message = error?.message || 'Snapshot import failed';
    if (status) status.textContent = message;
    showToast(message, 'danger');
  }
}

function renderActiveSessionCard(sess, currentSessId) {
  const isCurrent = sess.id === currentSessId || Boolean(sess.isCurrent);
  const isMobile = sess.deviceType === 'Mobile';
  const isTablet = sess.deviceType === 'Tablet';
  const iconName = isMobile ? 'smartphone' : (isTablet ? 'tablet' : 'laptop');
  const timeSince = formatRelativeTime(sess.lastActiveAt || Date.now());

  return `
    <div class="glass" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; padding: 16px 20px; border-radius: 12px; border: 1px solid ${isCurrent ? 'rgba(16, 185, 129, 0.4)' : 'var(--border)'}; background: ${isCurrent ? 'rgba(16, 185, 129, 0.06)' : 'rgba(255,255,255,0.02)'}; box-shadow: ${isCurrent ? '0 4px 20px rgba(16, 185, 129, 0.08)' : 'none'};">
      <div style="display: flex; align-items: center; gap: 16px;">
        <div style="width: 44px; height: 44px; border-radius: 12px; background: ${isCurrent ? 'rgba(16, 185, 129, 0.15)' : 'rgba(99, 102, 241, 0.15)'}; color: ${isCurrent ? '#10b981' : '#818cf8'}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1px solid ${isCurrent ? 'rgba(16, 185, 129, 0.3)' : 'rgba(99, 102, 241, 0.25)'};">
          <i data-lucide="${iconName}" style="width: 22px; height: 22px;"></i>
        </div>
        <div>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <strong style="font-size: 14.5px; color: var(--text); font-weight: 700;">${escapeHtml(sess.browser || 'Browser')} on ${escapeHtml(sess.os || 'Windows PC')}</strong>
            ${isCurrent ? `
              <span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.5); font-size: 10.5px; font-weight: 800; padding: 2px 8px; letter-spacing: 0.04em;">🟢 THIS DEVICE (CURRENT ACTIVE)</span>
            ` : `
              <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 10.5px; font-weight: 700; padding: 2px 8px;">REMOTE SESSION</span>
            `}
          </div>
          <div style="font-size: 12px; color: var(--muted); margin-top: 4px; display: flex; gap: 16px; flex-wrap: wrap;">
            <span><i data-lucide="clock" style="width: 12px; height: 12px; vertical-align: -1px; margin-right: 3px;"></i> Logged in: <span style="color: var(--text);">${escapeHtml(formatDateTime(sess.loginAt || Date.now()))}</span></span>
            <span><i data-lucide="activity" style="width: 12px; height: 12px; vertical-align: -1px; margin-right: 3px;"></i> Last active: <strong style="color: ${isCurrent ? '#34d399' : 'var(--text)'};">${isCurrent ? 'Active Now' : escapeHtml(timeSince)}</strong></span>
            <span><i data-lucide="map-pin" style="width: 12px; height: 12px; vertical-align: -1px; margin-right: 3px;"></i> ${escapeHtml(sess.timezone || 'Asia/Kolkata')}</span>
          </div>
        </div>
      </div>
      <div>
        ${isCurrent ? `
          <button class="btn btn-ghost btn-sm" type="button" data-action="logout" style="font-size: 12px; padding: 7px 14px; color: #f87171; border-color: rgba(239, 68, 68, 0.3); display: inline-flex; align-items: center; gap: 6px;">
            <i data-lucide="log-out" style="width: 13px; height: 13px;"></i> Log Out Here
          </button>
        ` : `
          <button class="btn btn-danger btn-sm" type="button" data-action="terminate-session" data-session-id="${escapeHtml(sess.id)}" style="font-size: 12px; padding: 7px 14px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;">
            <i data-lucide="power" style="width: 13px; height: 13px;"></i> Log Out Device
          </button>
        `}
      </div>
    </div>
  `;
}

function renderActiveSessionsCardsList(sessions = [], currentSessId = null) {
  const currentId = currentSessId || getCurrentSessionId();
  if (!sessions.length) {
    const device = getDeviceDetails();
    return renderActiveSessionCard({
      id: currentId,
      browser: device.browser,
      os: device.os,
      deviceType: device.type,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
      loginAt: Date.now(),
      lastActiveAt: Date.now(),
      status: 'active',
      isCurrent: true,
    }, currentId);
  }
  return sessions.map((sess) => renderActiveSessionCard(sess, currentId)).join('');
}

function renderActiveSessionsSection(sessions = []) {
  const currentSessId = getCurrentSessionId();
  const otherCount = sessions.filter((s) => s.id !== currentSessId).length;

  return `
    <section class="panel glass" id="activeSessionsContainer" style="padding: 24px 28px; border-radius: 16px; border: 1px solid var(--border); margin-top: 24px;">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.06);">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 38px; height: 38px; border-radius: 10px; background: linear-gradient(135deg, #f59e0b, #ef4444); display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);">
            <i data-lucide="shield-check" style="width: 20px; height: 20px;"></i>
          </div>
          <div>
            <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text);">Active Logged-in Devices & Security</h3>
            <p style="margin: 2px 0 0 0; font-size: 12px; color: var(--muted);">Track active admin sessions across phones, laptops, and PCs. Terminate remote logins anytime.</p>
          </div>
        </div>
        <div class="toolbar" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          <button class="btn btn-ghost btn-sm" type="button" data-action="refresh-sessions" style="font-size: 12px; padding: 6px 12px;">
            <i data-lucide="refresh-cw" style="width: 13px; height: 13px;"></i> Refresh Devices
          </button>
          <button class="btn btn-danger btn-sm" type="button" data-action="terminate-all-other-sessions" id="terminateOtherSessionsBtn" ${otherCount === 0 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} style="font-size: 12px; padding: 6px 12px; font-weight: 700;">
            <i data-lucide="power" style="width: 13px; height: 13px;"></i> Log Out All Other Devices (<span id="otherSessionsCount">${otherCount}</span>)
          </button>
        </div>
      </div>

      <div id="activeSessionsList" style="display: flex; flex-direction: column; gap: 12px;">
        ${renderActiveSessionsCardsList(sessions, currentSessId)}
      </div>
    </section>
  `;
}

function renderSettingsManagementView(data = {}, fullData = {}) {
  const settings = fullData.settings || {};
  const currentEmail = userEmail?.textContent && userEmail.textContent !== 'connected' ? userEmail.textContent : 'ritikanetwork96@gmail.com';
  
  // Trigger async fetch for live sessions list if not already loaded
  if (!ui.sessionsLoaded) {
    ui.sessionsLoaded = true;
    getActiveAdminSessions().then((sess) => {
      ui.sessions = sess;
      const listEl = document.getElementById('activeSessionsList');
      if (listEl) {
        const currentSessId = getCurrentSessionId();
        listEl.innerHTML = renderActiveSessionsCardsList(sess, currentSessId);
        const otherCount = sess.filter((s) => s.id !== currentSessId).length;
        const countSpan = document.getElementById('otherSessionsCount');
        if (countSpan) countSpan.textContent = String(otherCount);
        const termBtn = document.getElementById('terminateOtherSessionsBtn');
        if (termBtn) {
          termBtn.disabled = otherCount === 0;
          termBtn.style.opacity = otherCount === 0 ? '0.5' : '1';
          termBtn.style.cursor = otherCount === 0 ? 'not-allowed' : 'pointer';
        }
        if (window.lucide) lucide.createIcons();
      }
    }).catch(() => {});
  }

  return `
    <div class="page active management-page-shell settings-page-shell" style="max-width: 1200px; margin: 0 auto; padding-bottom: 60px;">
      
      <!-- Top Control Bar -->
      <section class="panel glass" style="padding: 24px 28px; border-radius: 16px; margin-bottom: 24px; border: 1px solid var(--border);">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px;">
          <div>
            <div style="font-size: 11px; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">System Controls</div>
            <h2 style="margin: 0; font-size: 24px; font-weight: 800; color: var(--text);">Website & Store Settings</h2>
            <p style="margin: 4px 0 0 0; color: var(--muted); font-size: 13px;">Manage store branding, Telegram support links, footer copyright, currency, and data backups.</p>
          </div>
          <div class="toolbar" style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <button class="btn btn-ghost" type="button" data-action="export-admin-snapshot" title="Download entire store backup"><i data-lucide="download"></i> Export Backup</button>
            <button class="btn btn-ghost" type="button" data-action="import-admin-snapshot" title="Restore configuration"><i data-lucide="upload"></i> Restore Backup</button>
            <a class="btn btn-ghost" href="/" target="_blank" style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px;"><i data-lucide="external-link"></i> View Website</a>
          </div>
        </div>

        <!-- Realtime Connection Status -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.06);">
          <div style="background: rgba(16, 185, 129, 0.06); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px; padding: 12px 16px; display: flex; align-items: center; gap: 12px;">
            <div style="width: 36px; height: 36px; border-radius: 8px; background: rgba(16, 185, 129, 0.15); display: flex; align-items: center; justify-content: center; color: #10b981; flex-shrink: 0;"><i data-lucide="database"></i></div>
            <div>
              <div style="font-size: 10px; font-weight: 700; color: #10b981; text-transform: uppercase;">Firebase RTDB</div>
              <div style="font-size: 13px; font-weight: 600; color: var(--text);">Live & Synchronized</div>
            </div>
          </div>
          <div style="background: rgba(99, 102, 241, 0.06); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 12px; padding: 12px 16px; display: flex; align-items: center; gap: 12px;">
            <div style="width: 36px; height: 36px; border-radius: 8px; background: rgba(99, 102, 241, 0.15); display: flex; align-items: center; justify-content: center; color: #818cf8; flex-shrink: 0;"><i data-lucide="cloud"></i></div>
            <div>
              <div style="font-size: 10px; font-weight: 700; color: #818cf8; text-transform: uppercase;">Media Storage</div>
              <div style="font-size: 13px; font-weight: 600; color: var(--text);">RustFS S3 CDN (High Speed Storage)</div>
            </div>
          </div>
          <div style="background: rgba(245, 158, 11, 0.06); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 12px; padding: 12px 16px; display: flex; align-items: center; gap: 12px;">
            <div style="width: 36px; height: 36px; border-radius: 8px; background: rgba(245, 158, 11, 0.15); display: flex; align-items: center; justify-content: center; color: #f59e0b; flex-shrink: 0;"><i data-lucide="shield-check"></i></div>
            <div style="min-width: 0;">
              <div style="font-size: 10px; font-weight: 700; color: #f59e0b; text-transform: uppercase;">Logged-in Admin</div>
              <div style="font-size: 13px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(currentEmail)}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- Live Editable Form -->
      <form id="directSettingsForm" style="display: flex; flex-direction: column; gap: 24px;">
        
        <!-- 1. Store Identity -->
        <section class="panel glass" style="padding: 24px 28px; border-radius: 16px; border: 1px solid var(--border);">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.06);">
            <div style="width: 34px; height: 34px; border-radius: 8px; background: linear-gradient(135deg, #6366f1, #8b5cf6); display: flex; align-items: center; justify-content: center; color: white;"><i data-lucide="store" style="width: 18px; height: 18px;"></i></div>
            <div>
              <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text);">Store Identity & Header</h3>
              <p style="margin: 2px 0 0 0; font-size: 12px; color: var(--muted);">Directly updates website header, browser tab title, and branding.</p>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px;">
            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">Store / Website Name</label>
              <input type="text" name="siteName" value="${escapeHtml(settings.siteName || 'Linkadda Shop')}" class="input" style="width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" placeholder="e.g. Linkadda Shop" required />
              <small style="display: block; color: var(--muted); font-size: 11px; margin-top: 4px;">Shown in navbar and browser tab.</small>
            </div>

            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">Favicon URL</label>
              <div style="display: flex; gap: 8px;">
                <input type="text" id="settingsFaviconInput" name="favicon" value="${escapeHtml(settings.favicon || '/favicon.svg')}" class="input" style="flex: 1; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" placeholder="/favicon.svg or https://..." />
                <label class="btn btn-ghost" style="cursor: pointer; padding: 0 14px; display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; border: 1px solid var(--border); border-radius: 8px;">
                  <i data-lucide="upload" style="width: 15px; height: 15px;"></i> Upload
                  <input type="file" id="settingsFaviconFile" accept="image/*" style="display: none;" />
                </label>
              </div>
              <small style="display: block; color: var(--muted); font-size: 11px; margin-top: 4px;">Small icon for browser tab.</small>
            </div>

            <div style="grid-column: 1 / -1;">
              <label style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">Logo Image URL (Optional)</label>
              <div style="display: flex; gap: 8px;">
                <input type="text" id="settingsLogoInput" name="logo" value="${escapeHtml(settings.logo || '')}" class="input" style="flex: 1; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" placeholder="https://... (Leave empty to use clean text logo)" />
                <label class="btn btn-ghost" style="cursor: pointer; padding: 0 14px; display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; border: 1px solid var(--border); border-radius: 8px;">
                  <i data-lucide="upload" style="width: 15px; height: 15px;"></i> Upload
                  <input type="file" id="settingsLogoFile" accept="image/*" style="display: none;" />
                </label>
              </div>
            </div>

            <div style="grid-column: 1 / -1;">
              <label style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">Footer Copyright & Notice</label>
              <textarea name="footer" rows="2" class="textarea" style="width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px; resize: vertical;" placeholder="e.g. © 2026 Linkadda Shop. All rights reserved.">${escapeHtml(settings.footer || '© 2026 Linkadda.Shop. All rights reserved.')}</textarea>
              <small style="display: block; color: var(--muted); font-size: 11px; margin-top: 4px;">Displayed at the bottom of every page.</small>
            </div>
          </div>
        </section>

        <!-- 2. Support & Contact -->
        <section class="panel glass" style="padding: 24px 28px; border-radius: 16px; border: 1px solid var(--border);">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.06);">
            <div style="width: 34px; height: 34px; border-radius: 8px; background: linear-gradient(135deg, #0088cc, #229ED9); display: flex; align-items: center; justify-content: center; color: white;"><i data-lucide="message-circle" style="width: 18px; height: 18px;"></i></div>
            <div>
              <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text);">Customer Support & Contact Channels</h3>
              <p style="margin: 2px 0 0 0; font-size: 12px; color: var(--muted);">Controls where customers are directed for orders, support, and payments.</p>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px;">
            <div style="grid-column: 1 / -1;">
              <label style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #38bdf8; margin-bottom: 6px; letter-spacing: 0.04em;">Official Telegram Support Link / Username ⭐</label>
              <input type="text" name="telegram" value="${escapeHtml(settings.telegram || 'https://t.me/TRUSTED_BROTHER1234')}" class="input" style="width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 8px; color: var(--text); font-size: 13px; font-weight: 600;" placeholder="https://t.me/TRUSTED_BROTHER1234" required />
              <div style="margin-top: 6px; padding: 8px 12px; border-radius: 6px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.15); color: #bae6fd; font-size: 11.5px; line-height: 1.4;">
                <i data-lucide="info" style="width: 13px; height: 13px; vertical-align: middle; margin-right: 4px;"></i>
                Changing this link will <strong>instantly update all "Order via Telegram" and "Contact Support" buttons</strong> across the entire storefront and checkout pages in real time.
              </div>
            </div>

            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">Support Email</label>
              <input type="email" name="email" value="${escapeHtml(settings.email || currentEmail)}" class="input" style="width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" placeholder="support@linkadda.shop" />
            </div>

            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">Support WhatsApp (Optional)</label>
              <input type="text" name="whatsapp" value="${escapeHtml(settings.whatsapp || '')}" class="input" style="width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" placeholder="+91 98765 43210" />
            </div>
          </div>
        </section>

        <!-- 3. Currency & Pricing -->
        <section class="panel glass" style="padding: 24px 28px; border-radius: 16px; border: 1px solid var(--border);">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.06);">
            <div style="width: 34px; height: 34px; border-radius: 8px; background: linear-gradient(135deg, #10b981, #059669); display: flex; align-items: center; justify-content: center; color: white;"><i data-lucide="coins" style="width: 18px; height: 18px;"></i></div>
            <div>
              <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text);">Currency & Pricing Display</h3>
              <p style="margin: 2px 0 0 0; font-size: 12px; color: var(--muted);">Default currencies shown on products and checkout.</p>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 18px;">
            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">Primary Currency</label>
              <input type="text" name="currency" value="${escapeHtml(settings.currency || 'INR')}" class="input" style="width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" placeholder="INR" />
            </div>

            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">Currency Symbol</label>
              <input type="text" name="currencySymbol" value="${escapeHtml(settings.currencySymbol || '₹')}" class="input" style="width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" placeholder="₹" />
            </div>

            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">Dual Pricing Display</label>
              <input type="text" name="priceFormat" value="${escapeHtml(settings.priceFormat || 'INR / USD')}" class="input" style="width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" placeholder="INR / USD" />
            </div>
          </div>
        </section>

        <!-- 4. Live Popups & Social Proof Notifications (Toast System) -->
        <section class="panel glass" style="padding: 24px 28px; border-radius: 16px; border: 1px solid var(--border);">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.06);">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 34px; height: 34px; border-radius: 8px; background: linear-gradient(135deg, #f0247a, #e11d48); display: flex; align-items: center; justify-content: center; color: white;"><i data-lucide="bell" style="width: 18px; height: 18px;"></i></div>
              <div>
                <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text);">Live Popups & Social Proof (Toasts)</h3>
                <p style="margin: 2px 0 0 0; font-size: 12px; color: var(--muted);">Approved orders (cycles 1-10), Telegram DM counts (50+), and today's visitors count (100+, 200+).</p>
              </div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <button class="btn btn-ghost" type="button" data-action="broadcast-test-approved-order" style="font-size: 12px; padding: 7px 14px; border: 1px solid rgba(240, 36, 122, 0.4); color: #f43f5e;"><i data-lucide="send"></i> Test Approved Order</button>
              <button class="btn btn-ghost" type="button" data-action="broadcast-test-approved-review" style="font-size: 12px; padding: 7px 14px; border: 1px solid rgba(245, 158, 11, 0.4); color: #f59e0b;"><i data-lucide="star"></i> Test Approved Review</button>
              <button class="btn btn-ghost" type="button" data-action="clear-approved-orders" style="font-size: 12px; padding: 7px 14px; border: 1px solid var(--border);"><i data-lucide="rotate-ccw"></i> Reset Orders Queue</button>
              <button class="btn btn-ghost" type="button" data-action="clear-approved-reviews" style="font-size: 12px; padding: 7px 14px; border: 1px solid var(--border);"><i data-lucide="rotate-ccw"></i> Reset Reviews Queue</button>
            </div>
          </div>

          <!-- Realtime stats indicator pills -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px;">
            <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px;">
              <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--muted);">Approved Orders in Queue</div>
              <div style="font-size: 20px; font-weight: 800; color: #10b981; margin-top: 4px;">${Array.isArray(settings.recentApproved) ? settings.recentApproved.length : 0} <span style="font-size: 12px; color: var(--muted); font-weight: 500;">/ 10</span></div>
            </div>
            <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px;">
              <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--muted);">Approved Reviews in Queue</div>
              <div style="font-size: 20px; font-weight: 800; color: #f59e0b; margin-top: 4px;">${Array.isArray(settings.recentApprovedReviews) ? settings.recentApprovedReviews.length : 0} <span style="font-size: 12px; color: var(--muted); font-weight: 500;">/ 10</span></div>
            </div>
            <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px;">
              <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--muted);">Tracked Visitors Today</div>
              <div style="font-size: 20px; font-weight: 800; color: #38bdf8; margin-top: 4px;">${(listCollection('visitors') || []).filter(v => String(v.date || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length}</div>
            </div>
            <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px;">
              <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--muted);">Telegram Clicks Today</div>
              <div style="font-size: 20px; font-weight: 800; color: #a855f7; margin-top: 4px;">${(listCollection('events') || []).filter(e => (e.type === 'telegram_click') && String(e.date || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length}</div>
            </div>
          </div>

          <!-- Master Switches -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 22px; padding: 14px 16px; background: rgba(0,0,0,0.2); border-radius: 12px; border: 1px solid var(--border);">
            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--text);">
              <input type="checkbox" name="toastEnabled" value="on" ${settings.toastEnabled !== false && settings.toastEnabled !== 'false' ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: #f0247a;" />
              <span>Enable Live Toast Popups</span>
            </label>

            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--text);">
              <input type="checkbox" name="toastShowApprovedOrders" value="on" ${settings.toastShowApprovedOrders !== false && settings.toastShowApprovedOrders !== 'false' ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: #10b981;" />
              <span>Show Real Approved Orders</span>
            </label>

            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--text);">
              <input type="checkbox" name="toastShowApprovedReviews" value="on" ${settings.toastShowApprovedReviews !== false && settings.toastShowApprovedReviews !== 'false' ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: #f59e0b;" />
              <span>Show Real Approved Reviews & Ratings</span>
            </label>

            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--text);">
              <input type="checkbox" name="toastShowTelegramClicks" value="on" ${settings.toastShowTelegramClicks !== false && settings.toastShowTelegramClicks !== 'false' ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: #38bdf8;" />
              <span>Show Telegram Clicks</span>
            </label>

            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--text);">
              <input type="checkbox" name="toastShowVisitors" value="on" ${settings.toastShowVisitors !== false && settings.toastShowVisitors !== 'false' ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: #a855f7;" />
              <span>Show Website Visitors Milestone</span>
            </label>
          </div>

          <!-- Configuration Fields -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px;">
            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">Approved Order Message Format</label>
              <input type="text" name="toastApprovedOrderTemplate" value="${escapeHtml(settings.toastApprovedOrderTemplate || '⚡ Order approved: {name} just delivered!')}" class="input" style="width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" placeholder="⚡ Order approved: {name} just delivered!" />
              <small style="display: block; color: var(--muted); font-size: 11px; margin-top: 4px;">Use <code>{name}</code> for approved product name.</small>
            </div>

            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">Approved Review Message Format</label>
              <input type="text" name="toastApprovedReviewTemplate" value="${escapeHtml(settings.toastApprovedReviewTemplate || '⭐ {stars} ({rating}/5) from {name}: {comment}')}" class="input" style="width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" placeholder="⭐ {stars} ({rating}/5) from {name}: {comment}" />
              <small style="display: block; color: var(--muted); font-size: 11px; margin-top: 4px;">Use <code>{stars}</code>, <code>{name}</code>, <code>{comment}</code>, <code>{product}</code>.</small>
            </div>

            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">Popup Interval (Seconds)</label>
              <input type="number" name="toastInterval" value="${escapeHtml(String(settings.toastInterval || 8))}" min="5" max="60" class="input" style="width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" placeholder="8" />
              <small style="display: block; color: var(--muted); font-size: 11px; margin-top: 4px;">Speed remains steady regardless of order count (no speeding up).</small>
            </div>

            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">Telegram DMs Message Format</label>
              <input type="text" name="toastTelegramTemplate" value="${escapeHtml(settings.toastTelegramTemplate || '✈️ {count}+ people DM\'d on Telegram today!')}" class="input" style="width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" placeholder="✈️ {count}+ people DM'd on Telegram today!" />
              <small style="display: block; color: var(--muted); font-size: 11px; margin-top: 4px;">Use <code>{count}</code> for 50+, 100+, etc.</small>
            </div>

            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">Telegram Clicks Base Offset (Default: 50)</label>
              <input type="number" name="toastTelegramClicksBaseOffset" value="${escapeHtml(String(settings.toastTelegramClicksBaseOffset ?? 50))}" min="0" class="input" style="width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" placeholder="50" />
              <small style="display: block; color: var(--muted); font-size: 11px; margin-top: 4px;">Milestone baseline (e.g. 50+ people DM'd on Telegram today).</small>
            </div>

            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">Website Visitors Message Format</label>
              <input type="text" name="toastVisitorTemplate" value="${escapeHtml(settings.toastVisitorTemplate || '👥 {count}+ visitors visited the website today!')}" class="input" style="width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" placeholder="👥 {count}+ visitors visited the website today!" />
              <small style="display: block; color: var(--muted); font-size: 11px; margin-top: 4px;">Counts: 100+ when reaching 100, 200+ when reaching 200.</small>
            </div>

            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">Website Visitors Base Offset (Default: 100)</label>
              <input type="number" name="toastVisitorBaseOffset" value="${escapeHtml(String(settings.toastVisitorBaseOffset ?? 100))}" min="0" class="input" style="width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px;" placeholder="100" />
              <small style="display: block; color: var(--muted); font-size: 11px; margin-top: 4px;">Milestone baseline: 100+ visitors, updates to 200+ when reaching 200.</small>
            </div>

            <div style="grid-column: 1 / -1;">
              <label style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.04em;">Extra Custom Toast Announcements (Optional)</label>
              <textarea name="toastCustomMessages" rows="2" class="textarea" style="width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px; resize: vertical;" placeholder="One announcement per line...">${escapeHtml(settings.toastCustomMessages || '')}</textarea>
              <small style="display: block; color: var(--muted); font-size: 11px; margin-top: 4px;">Shown in the cyclic rotation alongside real approved orders.</small>
            </div>
          </div>
        </section>

        <!-- Save Button Bar -->
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 18px 24px; background: var(--panel-solid); border: 1px solid var(--border); border-radius: 14px; flex-wrap: wrap; gap: 14px; position: sticky; bottom: 16px; z-index: 10; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          <div style="display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px;">
            <i data-lucide="sparkles" style="color: #6366f1; width: 16px; height: 16px;"></i>
            <span>Changes sync instantly across live website & checkout.</span>
          </div>
          <div style="display: flex; gap: 10px;">
            <button type="submit" class="btn btn-primary" id="saveSettingsSubmitBtn" style="padding: 12px 28px; font-weight: 700; font-size: 14px; border-radius: 10px; background: linear-gradient(135deg, #6366f1, #8b5cf6) !important; border: none !important; color: white !important; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);">
              <i data-lucide="check" style="width: 18px; height: 18px;"></i> Save Settings
            </button>
          </div>
        </div>

      </form>

      <!-- 4. Active Logins & Device Security Section -->
      ${renderActiveSessionsSection(ui.sessions || [])}

    </div>
  `;
}

function renderPaymentMethodCard(label, value, detail = '', tone = 'primary') {
  const empty = !value || String(value).trim() === '' || value === 'Not set';
  return `
    <div class="management-summary-card glass ${tone} ${empty ? 'is-empty' : ''}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value || 'Not set'))}</strong>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
    </div>
  `;
}

function getStandardPaymentMethods(payment = {}) {
  const custom = payment.customMethods || {};
  const disabled = Array.isArray(payment.disabledMethods) ? payment.disabledMethods : (payment.disabledMethods ? Object.keys(payment.disabledMethods) : []);
  const recommendedId = payment.recommendedMethod || 'binancepay';

  const defaultList = [
    {
      id: 'binancepay',
      name: payment.binancepayName || payment.binanceName || 'Binance Pay',
      sub: payment.binancepaySub || payment.binanceSub || 'Zero-fee instant crypto transfer via Binance App',
      type: 'binance',
      iconClass: 'icon-binance',
      icon: 'sparkles',
      logo: payment.binanceLogo || 'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/bnb.png',
      qrImage: payment.binanceQr || '',
      identifierLabel: 'Binance ID / Pay ID',
      identifier: payment.binanceId || '969887942',
      tag: payment.binancepayTag || payment.binanceTag || '0% FEE',
      instructions: payment.binancepayInstructions || payment.binanceInstructions || 'Open Binance App → Pay → Enter Binance ID → Transfer exact USD amount.',
      status: disabled.includes('binancepay') ? 'disabled' : 'active',
      isRecommended: recommendedId === 'binancepay',
      isDefault: true,
    },
    {
      id: 'upi',
      name: payment.upiName || 'UPI (GPay / PhonePe / Paytm)',
      sub: payment.upiSub || 'Instant Indian UPI transfers & Dynamic QR Code',
      type: 'upi',
      iconClass: 'icon-upi',
      icon: 'smartphone',
      logo: payment.upiLogo || 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/UPI-Logo-vector.svg/320px-UPI-Logo-vector.svg.png',
      qrImage: payment.qrImage || payment.upiQr || '',
      identifierLabel: 'UPI VPA Address',
      identifier: payment.upiId || 'Ritikane@ptyes',
      tag: payment.upiTag || 'INR FAST',
      instructions: payment.upiInstructions || payment.instructions || 'Scan QR with GPay / PhonePe / Paytm or send to UPI ID → Upload screenshot proof.',
      status: disabled.includes('upi') ? 'disabled' : 'active',
      isRecommended: recommendedId === 'upi',
      isDefault: true,
    },
    {
      id: 'bep20',
      name: payment.bep20Name || 'USDT BEP-20 (BSC)',
      sub: payment.bep20Sub || 'BNB Smart Chain Low-Fee Network',
      type: 'crypto',
      iconClass: 'icon-bep20',
      icon: 'coins',
      logo: payment.bep20Logo || 'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/usdt.png',
      qrImage: payment.bep20Qr || '',
      identifierLabel: 'BEP-20 Wallet Address',
      identifier: payment.bep20Address || '0x7186b11f8fD49fe472Af49Cda490f168e09Fef0a',
      tag: payment.bep20Tag || 'USDT (BSC)',
      instructions: payment.bep20Instructions || 'Send exact USDT on Binance Smart Chain (BEP-20) network only.',
      status: disabled.includes('bep20') ? 'disabled' : 'active',
      isRecommended: recommendedId === 'bep20',
      isDefault: true,
    },
    {
      id: 'eth',
      name: payment.ethName || 'USDT ERC-20 (ETH)',
      sub: payment.ethSub || 'Ethereum Mainnet Network',
      type: 'crypto',
      iconClass: 'icon-eth',
      icon: 'wallet',
      logo: payment.ethLogo || 'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/eth.png',
      qrImage: payment.ethQr || '',
      identifierLabel: 'ERC-20 Wallet Address',
      identifier: payment.ethAddress || '0x7186b11f8fD49fe472Af49Cda490f168e09Fef0a',
      tag: payment.ethTag || 'USDT (ETH)',
      instructions: payment.ethInstructions || 'Send exact USDT on Ethereum (ERC-20) network only.',
      status: disabled.includes('eth') ? 'disabled' : 'active',
      isRecommended: recommendedId === 'eth',
      isDefault: true,
    },
    {
      id: 'paypal',
      name: payment.paypalName || 'PayPal',
      sub: payment.paypalSub || 'International Debit / Credit Cards',
      type: 'paypal',
      iconClass: 'icon-paypal',
      icon: 'credit-card',
      logo: payment.paypalLogo || 'images/logos/paypal.svg',
      qrImage: payment.paypalQr || '',
      identifierLabel: 'PayPal Link',
      identifier: payment.paypalLink || 'https://paypal.me/Jayagupta601',
      tag: payment.paypalTag || 'GLOBAL',
      instructions: payment.paypalInstructions || 'Click PayPal link and send exact USD amount as Friends & Family or Goods.',
      status: disabled.includes('paypal') ? 'disabled' : 'active',
      isRecommended: recommendedId === 'paypal',
      isDefault: true,
    },
    {
      id: 'giftcard',
      name: payment.giftcardName || 'Binance Gift Card',
      sub: payment.giftcardSub || 'Digital Voucher / G2A Key',
      type: 'giftcard',
      iconClass: 'icon-gift',
      icon: 'gift',
      logo: payment.giftcardLogo || '',
      qrImage: payment.giftcardQr || '',
      identifierLabel: 'Gift Card URL',
      identifier: payment.binanceGiftCardUrl || 'https://www.g2a.com/binance-gift-card-205-usdt-key-i10000337768061',
      tag: payment.giftcardTag || 'VOUCHER',
      instructions: payment.giftcardInstructions || 'Buy digital voucher key and submit voucher code in payment verification.',
      status: disabled.includes('giftcard') ? 'disabled' : 'active',
      isRecommended: recommendedId === 'giftcard',
      isDefault: true,
    },
    {
      id: 'cards',
      name: payment.cardsTitle || payment.cardsName || 'Cards',
      sub: payment.cardsSub || 'Visa, Mastercard, RuPay',
      type: 'cards',
      iconClass: 'icon-cards',
      icon: 'credit-card',
      logo: payment.cardsLogo || 'images/logos/visa.svg',
      qrImage: '',
      identifierLabel: payment.cardsLink ? 'Card Gateway Link' : 'Accepted Card Networks',
      identifier: payment.cardsLink || 'Visa, Mastercard, RuPay',
      tag: payment.cardsTag || 'CARDS',
      instructions: 'Pay securely using any Indian or International debit/credit card.',
      status: disabled.includes('cards') ? 'disabled' : 'active',
      isRecommended: recommendedId === 'cards',
      isDefault: true,
    },
    {
      id: 'netbanking',
      name: payment.netbankingTitle || payment.netbankingName || 'Netbanking',
      sub: payment.netbankingSub || 'SBI, ICICI, HDFC, Axis',
      type: 'netbanking',
      iconClass: 'icon-netbanking',
      icon: 'landmark',
      logo: payment.netbankingLogo || 'images/logos/sbi.svg',
      qrImage: '',
      identifierLabel: 'Supported Banks',
      identifier: 'SBI, ICICI, HDFC, Axis, All Indian Banks',
      tag: payment.netbankingTag || 'NETBANKING',
      instructions: 'Direct bank transfer / Netbanking authentication.',
      status: disabled.includes('netbanking') ? 'disabled' : 'active',
      isRecommended: recommendedId === 'netbanking',
      isDefault: true,
    },
    {
      id: 'wallet',
      name: payment.walletTitle || payment.walletName || 'LinkAdda Wallet',
      sub: payment.walletSub || '1-Click Instant Customer Balance',
      type: 'wallet',
      iconClass: 'icon-wallet',
      icon: 'wallet',
      logo: payment.walletLogo || 'images/logos/mobikwik.svg',
      qrImage: '',
      identifierLabel: 'Customer Balance System',
      identifier: 'Instant Wallet Checkout',
      tag: payment.walletTag || '1-CLICK',
      instructions: 'Instant 1-click checkout with zero verification needed.',
      status: disabled.includes('wallet') ? 'disabled' : 'active',
      isRecommended: recommendedId === 'wallet',
      isDefault: true,
    },
    {
      id: 'custom_bank',
      name: payment.bankTitle || payment.customMethods?.custom_bank?.name || 'Bank Transfer (IMPS / NEFT)',
      sub: payment.bankSub || payment.customMethods?.custom_bank?.sub || 'Direct Account Transfer',
      type: 'bank',
      iconClass: 'icon-bank',
      icon: 'building-2',
      logo: payment.bankLogo || 'images/logos/sbi.svg',
      qrImage: payment.bankQr || payment.customMethods?.custom_bank?.qrImage || '',
      bankName: payment.bankName || payment.customMethods?.custom_bank?.bankName || 'State Bank of India',
      accountName: payment.accountHolder || payment.accountName || payment.customMethods?.custom_bank?.accountName || 'Pandit Bajpai',
      accountNumber: payment.accountNumber || payment.customMethods?.custom_bank?.accountNumber || '45231994969',
      ifsc: payment.ifsc || payment.ifscCode || payment.customMethods?.custom_bank?.ifsc || 'SBIN0002594',
      upiId: payment.bankUpiId || payment.customMethods?.custom_bank?.upiId || '',
      identifierLabel: 'Bank Account Number',
      identifier: payment.accountNumber || payment.customMethods?.custom_bank?.accountNumber || '45231994969',
      tag: payment.bankTag || 'IMPS / NEFT',
      instructions: payment.customMethods?.custom_bank?.instructions || 'Transfer exact amount via IMPS/NEFT and upload screenshot.',
      status: disabled.includes('custom_bank') ? 'disabled' : 'active',
      isRecommended: recommendedId === 'custom_bank',
      isDefault: true,
    },
    {
      id: 'custom_btc',
      name: payment.btcTitle || payment.customMethods?.custom_btc?.name || 'Bitcoin (BTC)',
      sub: payment.btcSub || payment.customMethods?.custom_btc?.sub || 'BTC Native Network',
      type: 'crypto',
      iconClass: 'icon-btc',
      icon: 'bitcoin',
      logo: payment.btcLogo || 'images/logos/btc.svg',
      qrImage: payment.btcQr || payment.customMethods?.custom_btc?.qrImage || '',
      network: payment.btcSub || payment.customMethods?.custom_btc?.sub || payment.customMethods?.custom_btc?.network || 'BTC Native Network',
      identifierLabel: 'Bitcoin Wallet Address',
      identifier: payment.btcAddress || payment.customMethods?.custom_btc?.identifier || 'bc1q3vuldn6dz4jv5896gap27ngrtg7q4p6krtk9hu',
      tag: payment.btcTag || 'BTC',
      instructions: payment.customMethods?.custom_btc?.instructions || 'Send exact BTC amount to address on Bitcoin mainnet.',
      status: disabled.includes('custom_btc') ? 'disabled' : 'active',
      isRecommended: recommendedId === 'custom_btc',
      isDefault: true,
    },
  ];

  // Custom methods from Firebase / LocalStorage (strictly deduplicate against standard IDs)
  const standardIds = new Set(['binancepay', 'upi', 'bep20', 'eth', 'paypal', 'giftcard', 'cards', 'netbanking', 'wallet', 'custom_bank', 'custom_btc']);
  const customList = Object.entries(custom)
    .filter(([id]) => !standardIds.has(id))
    .map(([id, item]) => {
      if (!item || typeof item !== 'object') return null;
      const isCrypto = item.type === 'crypto' || /btc|bitcoin|usdt|eth|ton|sol|trx|crypto/i.test(item.name || '');
      const isBank = item.type === 'bank' || /bank|imps|neft|rtgs|account/i.test(item.name || '');
      const isUpi = item.type === 'upi' || /upi|gpay|phonepe|paytm|bhim/i.test(item.name || '');
      let iconClass = 'icon-custom';
      let icon = 'credit-card';
      if (isCrypto) { iconClass = 'icon-btc'; icon = 'bitcoin'; }
      else if (isBank) { iconClass = 'icon-bank'; icon = 'building-2'; }
      else if (isUpi) { iconClass = 'icon-upi'; icon = 'smartphone'; }

      const idVal = item.identifier || item.address || item.walletAddress || item.accountNumber || item.link || '';
      const qrVal = item.qrImage || item.insideImage || '';

      return {
        id,
        name: item.name || 'Custom Method',
        sub: item.sub || item.description || (isBank ? 'Direct Account Transfer' : isCrypto ? 'Crypto Network' : 'Custom payment method'),
        type: item.type || (isBank ? 'bank' : isCrypto ? 'crypto' : isUpi ? 'upi' : 'custom'),
        iconClass,
        icon,
        logo: item.logo || '',
        qrImage: qrVal,
        insideImage: qrVal,
        network: item.network || item.sub || '',
        bankName: item.bankName || '',
        accountName: item.accountName || item.accountHolder || '',
        accountNumber: item.accountNumber || (isBank ? idVal : ''),
        ifsc: item.ifsc || item.ifscCode || '',
        upiId: item.upiId || item.bankUpiId || (isUpi ? idVal : ''),
        identifierLabel: item.identifierLabel || (isBank ? 'Bank Account Number' : isCrypto ? 'Deposit Wallet Address' : isUpi ? 'UPI VPA Address' : 'Account / Address / Link'),
        identifier: idVal,
        tag: item.tag || (isCrypto ? 'CRYPTO' : isBank ? 'BANK' : 'ACTIVE'),
        instructions: item.instructions || '',
        status: item.status || 'active',
        isRecommended: recommendedId === id,
        isCustom: true,
      };
    }).filter(Boolean);

  const allList = [...defaultList, ...customList];
  allList.sort((a, b) => {
    if (a.id === recommendedId) return -1;
    if (b.id === recommendedId) return 1;
    return 0;
  });
  return allList;
}

function renderPaymentManagementView(data = {}, fullData = {}) {
  const DEFAULT_PAYMENT_CONFIG = {
    recommendedMethod: 'upi',
    upiId: 'Ritikane@ptyes',
    qrImage: '',
    telegramUrl: 'https://t.me/TRUSTED_BROTHER1234',
    telegramChannel: 'https://t.me/TRUSTED_BROTHER1234',
    bep20Address: '0x7186b11f8fD49fe472Af49Cda490f168e09Fef0a',
    ethAddress: '0x7186b11f8fD49fe472Af49Cda490f168e09Fef0a',
    binanceId: '1197561104',
    paypalLink: 'https://paypal.me/Jayagupta601',
    instructions: 'Pay exact order amount and submit screenshot for instant activation.',
    status: 'active',
    customMethods: {},
    disabledMethods: [],
  };

  const rawPayment = (fullData && fullData.payment) || (data && typeof data === 'object' && Object.keys(data).length ? data : {}) || {};
  const rawSettings = (fullData && fullData.settings) || {};

  const payment = {
    ...DEFAULT_PAYMENT_CONFIG,
    ...(rawSettings.upiId ? { upiId: rawSettings.upiId } : {}),
    ...(rawSettings.telegram ? { telegramUrl: rawSettings.telegram } : {}),
    ...rawPayment,
  };

  const methodsList = getStandardPaymentMethods(payment);
  const activeCount = methodsList.filter(m => m.status === 'active').length;
  const customCount = methodsList.filter(m => m.isCustom).length;
  const recMethod = methodsList.find(m => m.isRecommended) || methodsList[0] || {};

  return `
    <div class="page active management-page-shell">
      <section class="panel glass management-page">
        <div class="panel-head payment-management-head">
          <div>
            <div class="section-kicker">Checkout &amp; Gateways</div>
            <h2 class="section-title">Payment Gateways &amp; Methods Hub</h2>
            <p class="section-subtitle">Manage customer checkout options. Edit UPI, Bank, Crypto, PayPal &amp; Card credentials, upload logos &amp; QR codes, or add custom gateways.</p>
          </div>
          <div class="toolbar management-actions">
            <button class="btn btn-primary" type="button" data-action="add-payment-method"><i data-lucide="plus-circle"></i> Add Payment Method</button>
            <button class="btn btn-ghost" type="button" data-action="edit-single" data-node="payment"><i data-lucide="sliders"></i> Global Settings</button>
            <button class="btn btn-ghost" type="button" data-action="goto" data-route="orders"><i data-lucide="receipt-text"></i> Open Orders</button>
          </div>
        </div>

        <div class="management-summary-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-bottom: 20px;">
          ${renderManagementSummaryCard('Active Gateways', `${activeCount} / ${methodsList.length}`, 'Active on customer checkout', 'success')}
          ${renderManagementSummaryCard('Top Recommended', escapeHtml(recMethod.name || 'UPI'), 'Primary checkout option (RECOMMENDED)', 'warning')}
          ${renderManagementSummaryCard('Custom Gateways', String(customCount), 'Custom payment options added', 'accent')}
        </div>
      </section>

      ${renderFieldGroup('Active Payment Methods (Customer Checkout Rail)', 'These payment options appear directly on the customer checkout page. Click Edit to update accounts, logos, or QR codes.', `
        <div class="payment-methods-grid">
          ${methodsList.map((m) => `
            <div class="payment-card ${m.isRecommended ? 'is-recommended' : ''} ${m.status !== 'active' ? 'is-disabled' : ''}">
              <div class="payment-card-header">
                <div class="payment-card-brand">
                  <div class="payment-card-icon ${escapeHtml(m.iconClass || '')}" style="background: rgba(255,255,255,0.06); padding: 4px; display: flex; align-items: center; justify-content: center; border-radius: 12px; overflow: hidden; width: 44px; height: 44px;">
                    ${m.logo ? `<img src="${escapeHtml(m.logo)}" alt="${escapeHtml(m.name)}" style="width: 100%; height: 100%; object-fit: contain;" />` : `<i data-lucide="${escapeHtml(m.icon || 'credit-card')}"></i>`}
                  </div>
                  <div class="payment-card-titles">
                    <strong>${escapeHtml(m.name)}</strong>
                    <span>${escapeHtml(m.sub)}</span>
                  </div>
                </div>
                <button class="payment-toggle-btn ${m.status === 'active' ? 'is-active' : 'is-disabled'}" data-action="toggle-payment-method" data-id="${escapeHtml(m.id)}" title="Click to Toggle Active/Disabled">
                  <i data-lucide="${m.status === 'active' ? 'check-circle' : 'x-circle'}"></i> ${m.status === 'active' ? 'Active' : 'Disabled'}
                </button>
              </div>

              <div class="payment-card-badges">
                <span class="badge ${m.isRecommended ? 'warning' : 'primary'}">${escapeHtml(m.tag || 'ACTIVE')}</span>
                ${m.isRecommended ? '<span class="badge warning"><i data-lucide="star"></i> Recommended (Top)</span>' : ''}
                ${m.qrImage ? '<span class="badge success" style="font-size: 10px;"><i data-lucide="qr-code"></i> QR Configured</span>' : ''}
              </div>

              <div class="payment-card-body">
                <div class="payment-data-row">
                  <span class="payment-data-label">${escapeHtml(m.identifierLabel)}</span>
                  <button class="icon-btn" data-action="copy-payment-val" data-val="${escapeHtml(m.identifier)}" title="Copy Value"><i data-lucide="copy"></i></button>
                </div>
                <div class="payment-data-val" style="word-break: break-all;">${escapeHtml(m.identifier || 'Not set')}</div>
              </div>

              <div class="payment-card-actions">
                <button class="payment-make-rec-btn ${m.isRecommended ? 'active' : ''}" data-action="set-recommended-method" data-id="${escapeHtml(m.id)}">
                  <i data-lucide="star"></i> ${m.isRecommended ? '⭐ Recommended' : 'Set as Recommended'}
                </button>
                <div class="toolbar" style="gap: 4px;">
                  <button class="icon-btn" data-action="edit-payment-method" data-id="${escapeHtml(m.id)}" title="Edit Method"><i data-lucide="pencil"></i></button>
                  <button class="icon-btn danger" data-action="delete-payment-method" data-id="${escapeHtml(m.id)}" title="${m.isCustom ? 'Delete Custom Method' : 'Disable / Remove Method'}"><i data-lucide="trash-2"></i></button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `)}

      <div class="panel glass" style="margin-top: 20px; padding: 18px 22px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; border: 1px solid var(--border); border-radius: 14px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(37,99,235,0.12); color: #38bdf8; display: flex; align-items: center; justify-content: center; font-size: 18px;">
            <i data-lucide="receipt"></i>
          </div>
          <div>
            <div style="font-size: 14px; font-weight: 700; color: #fff;">Customer Payment Proofs &amp; Orders</div>
            <div style="font-size: 12px; color: var(--muted);">Review customer transaction IDs, UTR numbers, and uploaded payment screenshots.</div>
          </div>
        </div>
        <div class="toolbar">
          <button class="btn btn-ghost" type="button" data-action="goto" data-route="screenshots"><i data-lucide="image"></i> Screenshots Gallery</button>
          <button class="btn btn-primary" type="button" data-action="goto" data-route="orders"><i data-lucide="receipt-text"></i> Verify Orders</button>
        </div>
      </div>
    </div>
  `;
}

function renderPaymentMethodModal(method = {}, isEdit = false) {
  const isRecommended = Boolean(method.isRecommended);
  const status = method.status || 'active';
  let type = method.type || 'crypto';
  if (method.id === 'paypal') type = 'paypal';
  else if (method.id === 'upi') type = 'upi';
  else if (method.id === 'cards') type = 'cards';
  else if (method.id === 'custom_bank' || method.id === 'netbanking') type = 'bank';
  else if (method.id === 'binancepay') type = 'binance';

  const logo = method.logo || '';
  const qrImage = method.qrImage || method.insideImage || '';

  const bankName = method.bankName || '';
  const accountName = method.accountName || method.accountHolder || '';
  const accountNumber = method.accountNumber || (type === 'bank' ? method.identifier : '') || '';
  const ifsc = method.ifsc || method.ifscCode || '';
  const upiId = method.upiId || method.bankUpiId || (type === 'upi' ? method.identifier : '') || '';
  const network = method.network || method.sub || '';
  const identifier = method.identifier || method.address || method.walletAddress || accountNumber || '';

  return `
    <div class="panel-head management-modal-head">
      <div>
        <h2 class="section-title">${isEdit ? '✏️ Edit Payment Method' : '➕ Add New Payment Method'}</h2>
        <p class="section-subtitle">${isEdit ? `Update credentials, brand logo, and payment QR code for ${escapeHtml(method.name || 'method')}` : 'Add a new crypto wallet, bank transfer account, UPI ID, or payment link.'}</p>
      </div>
      <button class="btn btn-ghost" data-close-modal type="button" onclick="closeModal()"><i data-lucide="x"></i></button>
    </div>
    <form class="form" id="paymentMethodForm" data-method-id="${escapeHtml(method.id || '')}" data-is-edit="${isEdit ? 'true' : 'false'}" data-is-custom="${method.isCustom ? 'true' : 'false'}">
      <div class="form-grid">
        
        <!-- 1. METHOD CATEGORY / TYPE -->
        <div class="field full">
          <label for="pmType" style="font-weight: 700; color: #fff;">1. Payment Category / Type *</label>
          <select class="select" id="pmType" name="type" onchange="window.updatePaymentModalFields(this.value)">
            <option value="upi" ${type === 'upi' ? 'selected' : ''}>📱 Indian UPI (GPay / PhonePe / Paytm / BHIM)</option>
            <option value="bank" ${type === 'bank' ? 'selected' : ''}>🏦 Bank Account Transfer (IMPS / NEFT / RTGS)</option>
            <option value="crypto" ${type === 'crypto' ? 'selected' : ''}>🪙 Crypto Wallet (USDT / BTC / TON / BSC / ETH / Solana)</option>
            <option value="binance" ${type === 'binance' ? 'selected' : ''}>⚡ Binance Pay ID</option>
            <option value="paypal" ${type === 'paypal' ? 'selected' : ''}>💳 PayPal (Global Debit/Credit Cards &amp; USD)</option>
            <option value="cards" ${type === 'cards' ? 'selected' : ''}>🌐 Debit / Credit Cards Gateway</option>
            <option value="custom" ${type === 'custom' ? 'selected' : ''}>⚙️ Other / Custom Method</option>
          </select>
          <small class="section-subtitle" style="margin-top: 4px;">Choose the payment category to show relevant account fields below.</small>
        </div>

        <!-- 2. NAME & SUBTITLE -->
        <div class="field">
          <label for="pmName">Payment Method Display Name *</label>
          <input class="input" id="pmName" name="name" type="text" placeholder="e.g. Google Pay, Bitcoin (BTC), SBI Bank" value="${escapeHtml(method.name || '')}" required />
        </div>
        <div class="field">
          <label for="pmSub">Subtitle / Short Tagline</label>
          <input class="input" id="pmSub" name="sub" type="text" placeholder="e.g. Instant 0% Fee, BTC Native Network" value="${escapeHtml(method.sub || '')}" />
        </div>

        <!-- 3. CRYPTO SPECIFIC FIELDS -->
        <div class="field full glass" id="pmCryptoGroup" style="padding: 16px 18px; border-radius: 12px; border: 1px solid rgba(245, 158, 11, 0.25); background: rgba(245, 158, 11, 0.04); ${type === 'crypto' || type === 'binance' ? '' : 'display: none;'}">
          <div style="font-size: 13px; font-weight: 800; color: #f59e0b; display: flex; align-items: center; gap: 6px; margin-bottom: 12px;">
            <i data-lucide="coins" style="width: 16px; height: 16px;"></i> Crypto Deposit Address &amp; Network Details
          </div>
          <div class="form-grid" style="gap: 12px;">
            <div class="field full">
              <label for="pmIdentifierCrypto">Deposit Wallet Address / Binance Pay ID *</label>
              <input class="input" id="pmIdentifierCrypto" name="cryptoAddress" type="text" placeholder="e.g. bc1q3vuldn6dz4jv5896gap27ngrtg7q4p6krtk9hu or 0x7186..." value="${escapeHtml(identifier)}" />
              <small class="section-subtitle" style="margin-top: 4px;">Customers will see this address with a 1-click Copy button and QR code.</small>
            </div>
            <div class="field full">
              <label for="pmNetwork">Blockchain Network</label>
              <input class="input" id="pmNetwork" name="network" type="text" placeholder="e.g. Bitcoin Mainnet (BTC), BNB Smart Chain (BEP-20), TRON (TRC-20)" value="${escapeHtml(network)}" />
            </div>
          </div>
        </div>

        <!-- 4. BANK TRANSFER SPECIFIC FIELDS -->
        <div class="field full glass" id="pmBankGroup" style="padding: 16px 18px; border-radius: 12px; border: 1px solid rgba(16, 185, 129, 0.25); background: rgba(16, 185, 129, 0.04); ${type === 'bank' ? '' : 'display: none;'}">
          <div style="font-size: 13px; font-weight: 800; color: #10b981; display: flex; align-items: center; gap: 6px; margin-bottom: 12px;">
            <i data-lucide="building-2" style="width: 16px; height: 16px;"></i> Bank Account Transfer Details
          </div>
          <div class="form-grid" style="gap: 12px;">
            <div class="field">
              <label for="pmBankName">Bank Name *</label>
              <input class="input" id="pmBankName" name="bankName" type="text" placeholder="e.g. State Bank of India, HDFC Bank" value="${escapeHtml(bankName)}" />
            </div>
            <div class="field">
              <label for="pmAccountHolder">Beneficiary / Account Holder Name *</label>
              <input class="input" id="pmAccountHolder" name="accountHolder" type="text" placeholder="e.g. Pandit Bajpai" value="${escapeHtml(accountName)}" />
            </div>
            <div class="field">
              <label for="pmAccountNumber">Bank Account Number *</label>
              <input class="input" id="pmAccountNumber" name="accountNumber" type="text" placeholder="e.g. 45231994969" value="${escapeHtml(accountNumber)}" />
            </div>
            <div class="field">
              <label for="pmIfsc">IFSC Code *</label>
              <input class="input" id="pmIfsc" name="ifsc" type="text" placeholder="e.g. SBIN0002594" value="${escapeHtml(ifsc)}" />
            </div>
            <div class="field full">
              <label for="pmBankUpiId">Bank UPI ID / VPA (Optional)</label>
              <input class="input" id="pmBankUpiId" name="bankUpiId" type="text" placeholder="e.g. PanditBajpai@sbi" value="${escapeHtml(upiId)}" />
            </div>
          </div>
        </div>

        <!-- 5. GENERAL IDENTIFIER (UPI, PayPal, Links) -->
        <div class="field full" id="pmGeneralGroup" style="${type === 'crypto' || type === 'bank' ? 'display: none;' : ''}">
          <label for="pmIdentifier" id="pmGeneralLabel">UPI VPA / Payment Link / Account ID *</label>
          <input class="input" id="pmIdentifier" name="identifier" type="text" placeholder="e.g. Ritikane@ptyes or https://..." value="${escapeHtml(identifier)}" />
        </div>

        <!-- 6. BRAND DISPLAY LOGO / ICON -->
        <div class="field full glass" style="padding: 16px 18px; border-radius: 12px; border: 1px solid var(--border); background: rgba(99, 102, 241, 0.04);">
          <label style="font-size: 13px; font-weight: 700; color: #818cf8; display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
            <i data-lucide="image" style="width: 16px; height: 16px;"></i> 🏷️ 1. Brand Display Logo (Checkout Rail Icon)
          </label>
          <small class="section-subtitle" style="margin-bottom: 10px; display: block; color: #94a3b8;">
            This icon is displayed in the payment options rail on the customer checkout page.
          </small>
          <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
            <div id="pmLogoPreview" style="width: 54px; height: 54px; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.15); background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              ${logo ? `<img src="${escapeHtml(logo)}" alt="Logo" style="width:100%;height:100%;object-fit:contain;padding:4px;" />` : '<i data-lucide="credit-card" style="width: 24px; height: 24px; color: var(--muted);"></i>'}
            </div>
            <div style="flex: 1; min-width: 220px;">
              <input type="file" accept="image/*" class="input" id="pmLogoFileInput" style="padding: 8px 12px; font-size: 12px; margin-bottom: 6px;" onchange="window.handlePaymentFilePreview(this, 'pmLogoInput', 'pmLogoPreview')" />
              <input type="text" class="input" id="pmLogoInput" name="logo" placeholder="Or paste Logo Image URL (https://...)" value="${escapeHtml(logo)}" style="font-size: 12px; padding: 8px 12px;" oninput="window.handlePaymentUrlInput(this, 'pmLogoPreview')" />
            </div>
          </div>
          <!-- Quick Preset Buttons -->
          <div style="display: flex; align-items: center; gap: 6px; margin-top: 8px; flex-wrap: wrap;">
            <span style="font-size: 11px; color: var(--muted);">Quick Logos:</span>
            <button type="button" class="btn btn-ghost btn-sm" style="font-size: 11px; padding: 2px 8px;" onclick="document.getElementById('pmLogoInput').value='images/logos/upi.svg'; document.getElementById('pmLogoPreview').innerHTML='<img src=\'images/logos/upi.svg\' style=\'width:100%;height:100%;object-fit:contain;padding:4px;\' />';">UPI</button>
            <button type="button" class="btn btn-ghost btn-sm" style="font-size: 11px; padding: 2px 8px;" onclick="document.getElementById('pmLogoInput').value='images/logos/paypal.svg'; document.getElementById('pmLogoPreview').innerHTML='<img src=\'images/logos/paypal.svg\' style=\'width:100%;height:100%;object-fit:contain;padding:4px;\' />';">PayPal</button>
            <button type="button" class="btn btn-ghost btn-sm" style="font-size: 11px; padding: 2px 8px;" onclick="document.getElementById('pmLogoInput').value='images/logos/visa.svg'; document.getElementById('pmLogoPreview').innerHTML='<img src=\'images/logos/visa.svg\' style=\'width:100%;height:100%;object-fit:contain;padding:4px;\' />';">Visa</button>
            <button type="button" class="btn btn-ghost btn-sm" style="font-size: 11px; padding: 2px 8px;" onclick="document.getElementById('pmLogoInput').value='images/logos/sbi.svg'; document.getElementById('pmLogoPreview').innerHTML='<img src=\'images/logos/sbi.svg\' style=\'width:100%;height:100%;object-fit:contain;padding:4px;\' />';">SBI</button>
            <button type="button" class="btn btn-ghost btn-sm" style="font-size: 11px; padding: 2px 8px;" onclick="document.getElementById('pmLogoInput').value='images/logos/btc.svg'; document.getElementById('pmLogoPreview').innerHTML='<img src=\'images/logos/btc.svg\' style=\'width:100%;height:100%;object-fit:contain;padding:4px;\' />';">BTC</button>
            <button type="button" class="btn btn-ghost btn-sm" style="font-size: 11px; padding: 2px 8px;" onclick="document.getElementById('pmLogoInput').value='images/logos/usdt.svg'; document.getElementById('pmLogoPreview').innerHTML='<img src=\'images/logos/usdt.svg\' style=\'width:100%;height:100%;object-fit:contain;padding:4px;\' />';">USDT</button>
            <button type="button" class="btn btn-ghost btn-sm" style="font-size: 11px; padding: 2px 8px;" onclick="document.getElementById('pmLogoInput').value='images/logos/binance.svg'; document.getElementById('pmLogoPreview').innerHTML='<img src=\'images/logos/binance.svg\' style=\'width:100%;height:100%;object-fit:contain;padding:4px;\' />';">Binance</button>
          </div>
        </div>

        <!-- 7. PAYMENT QR CODE / SCANNER IMAGE -->
        <div class="field full glass" style="padding: 16px 18px; border-radius: 12px; border: 1px solid var(--border); background: rgba(16, 185, 129, 0.04);">
          <label style="font-size: 13px; font-weight: 700; color: #34d399; display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
            <i data-lucide="qr-code" style="width: 16px; height: 16px;"></i> 🖼️ 2. Payment QR Code / Scanner Image
          </label>
          <small class="section-subtitle" style="margin-bottom: 10px; display: block; color: #94a3b8;">
            This QR code is displayed inside the method details pane for customer scanning. (Auto-generated if left blank).
          </small>
          <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
            <div id="pmQrPreview" style="width: 72px; height: 72px; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.15); background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              ${qrImage ? `<img src="${escapeHtml(qrImage)}" alt="QR" style="width:100%;height:100%;object-fit:contain;padding:4px;" />` : '<i data-lucide="qr-code" style="width: 32px; height: 32px; color: var(--muted);"></i>'}
            </div>
            <div style="flex: 1; min-width: 220px;">
              <input type="file" accept="image/*" class="input" id="pmQrFileInput" style="padding: 8px 12px; font-size: 12px; margin-bottom: 6px;" onchange="window.handlePaymentFilePreview(this, 'pmQrImageInput', 'pmQrPreview')" />
              <input type="text" class="input" id="pmQrImageInput" name="qrImage" placeholder="Or paste QR Image URL (https://...)" value="${escapeHtml(qrImage)}" style="font-size: 12px; padding: 8px 12px;" oninput="window.handlePaymentUrlInput(this, 'pmQrPreview')" />
            </div>
          </div>
        </div>

        <!-- 8. TAG & INSTRUCTIONS -->
        <div class="field">
          <label for="pmTag">Highlight Badge Text (Optional)</label>
          <input class="input" id="pmTag" name="tag" type="text" placeholder="e.g. FAST, 0% FEE, 24x7, INTL" value="${escapeHtml(method.tag || '')}" />
        </div>
        <div class="field">
          <label for="pmStatus">Live Status</label>
          <select class="select" id="pmStatus" name="status">
            <option value="active" ${status === 'active' ? 'selected' : ''}>🟢 Active (Visible on Checkout)</option>
            <option value="disabled" ${status === 'disabled' ? 'selected' : ''}>🔴 Disabled (Hidden from Checkout)</option>
          </select>
        </div>
        <div class="field full">
          <label for="pmInstructions">Customer Instructions (Displayed on Checkout)</label>
          <textarea class="textarea" id="pmInstructions" name="instructions" rows="2" placeholder="e.g. Send exact order amount and upload transaction screenshot / reference ID for instant verification.">${escapeHtml(method.instructions || '')}</textarea>
        </div>
        
        <!-- 9. MAKE RECOMMENDED OPTION -->
        <div class="field full" style="display:flex; align-items:center; gap:10px; padding: 12px 14px; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 10px;">
          <input type="checkbox" id="pmIsRecommended" name="isRecommended" style="width:18px;height:18px;cursor:pointer;" ${isRecommended ? 'checked' : ''} />
          <label for="pmIsRecommended" style="cursor:pointer;margin:0;font-weight:700;color:#f59e0b;">⭐ Feature as Recommended Choice (Pinned to top with RECOMMENDED badge)</label>
        </div>
      </div>
      <div class="toolbar management-actions-inline" style="margin-top:20px; padding-top: 16px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 10px;">
        <button class="btn btn-ghost" data-close-modal type="button" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" type="submit"><i data-lucide="check"></i> Save Payment Method</button>
      </div>
    </form>
    <script>
      setTimeout(function() {
        if (window.updatePaymentModalFields) {
          window.updatePaymentModalFields('${type}');
        }
      }, 50);
    </script>
  `;
}

window.updatePaymentModalFields = function(type) {
  const cryptoGroup = document.getElementById('pmCryptoGroup');
  const bankGroup = document.getElementById('pmBankGroup');
  const generalGroup = document.getElementById('pmGeneralGroup');
  const generalLabel = document.getElementById('pmGeneralLabel');
  const generalInput = document.getElementById('pmIdentifier');

  if (cryptoGroup) cryptoGroup.style.display = (type === 'crypto' || type === 'binance') ? '' : 'none';
  if (bankGroup) bankGroup.style.display = (type === 'bank') ? '' : 'none';
  if (generalGroup) generalGroup.style.display = (type === 'crypto' || type === 'bank') ? 'none' : '';

  if (generalLabel && generalInput) {
    if (type === 'upi') {
      generalLabel.textContent = '📱 UPI ID / VPA Address (GPay, PhonePe, Paytm) *';
      generalInput.placeholder = 'e.g. yourname@ptyes or mobile@upi';
    } else if (type === 'paypal') {
      generalLabel.textContent = '💳 PayPal Link / PayPal.me URL *';
      generalInput.placeholder = 'e.g. https://paypal.me/yourusername';
    } else if (type === 'cards') {
      generalLabel.textContent = '🌐 Card Payment Gateway Link (Optional - Leave blank for standard checkout) *';
      generalInput.placeholder = 'e.g. https://buy.stripe.com/... or https://paypal.me/...';
    } else {
      generalLabel.textContent = '🔗 Payment Link / ID / Address *';
      generalInput.placeholder = 'e.g. Account number, ID, or payment URL';
    }
  }

  if (window.lucide) window.lucide.createIcons();
};

window.handlePaymentFilePreview = function(fileInput, textInputId, previewId) {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    const textInput = document.getElementById(textInputId);
    const previewEl = document.getElementById(previewId);
    if (textInput) textInput.value = dataUrl;
    if (previewEl) {
      previewEl.innerHTML = `<img src="${dataUrl}" alt="Preview" style="width:100%;height:100%;object-fit:contain;padding:4px;" />`;
    }
  };
  reader.readAsDataURL(file);
};

window.handlePaymentUrlInput = function(input, previewId) {
  const val = (input.value || '').trim();
  const previewEl = document.getElementById(previewId);
  if (!previewEl) return;
  if (val) {
    previewEl.innerHTML = `<img src="${val}" alt="Preview" style="width:100%;height:100%;object-fit:contain;padding:4px;" onerror="this.parentElement.innerHTML='<span style=\\'font-size:10px;color:#ef4444;text-align:center;\\'>Bad URL</span>'" />`;
  } else {
    previewEl.innerHTML = `<i data-lucide="image" style="width: 24px; height: 24px; color: var(--muted);"></i>`;
    if (window.lucide) window.lucide.createIcons();
  }
};

function renderOrderDetailsModal(item = {}) {
  const proof = orderPaymentProof(item);
  const delivery = orderDeliveryInfo(item);
  const isPaid = isPaidOrder(item);
  const isFailed = isFailedOrder(item);
  const amountFormatted = item.amountDisplay || formatCurrencyCompact(item.amount || item.inr || 0);
  const methodName = orderMethodLabel(item);
  const orderId = item.id || item.orderId || '-';
  const prodName = orderProductName(item);

  return `
    <div class="order-inspector-container" style="width: 100%; max-width: 960px; margin: 0 auto; padding: 4px 4px 30px 4px; box-sizing: border-box;">
      <div class="panel-head management-modal-head" style="padding-bottom: 16px; border-bottom: 1px solid var(--border); display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;">
        <div style="min-width: 0; flex: 1;">
          <div style="font-size: 11px; font-weight: 700; color: #818cf8; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">Order & Payment Inspector</div>
          <h2 class="section-title" style="font-size: 20px; font-weight: 800; color: #fff; line-height: 1.3; word-break: break-word;">${escapeHtml(prodName)}</h2>
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap;">
            <span class="order-id-badge" data-action="copy-order-id" data-id="${escapeHtml(orderId)}" title="Click to copy Order ID" style="cursor: pointer;">
              <i data-lucide="copy" style="width: 12px; height: 12px;"></i> #${escapeHtml(orderId)}
            </span>
            <span class="order-status-pill ${isPaid ? 'paid' : isFailed ? 'rejected' : 'pending'}">
              ${isPaid ? '🟢 Verified & Paid' : isFailed ? '🔴 Rejected' : '🟡 Pending Verification'}
            </span>
          </div>
        </div>
        <button class="btn btn-ghost" data-close-modal type="button" onclick="closeModal()" title="Close Inspector" style="padding: 8px; border-radius: 50%; flex-shrink: 0;"><i data-lucide="x"></i></button>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-top: 20px;">
        
        <!-- Left: Proof Screenshot / Product Media -->
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div style="font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: space-between;">
            <span>Payment Screenshot Proof</span>
            ${proof ? `<a href="${escapeHtml(proof)}" target="_blank" rel="noreferrer" class="btn btn-ghost btn-sm" style="font-size: 11px; padding: 2px 8px;"><i data-lucide="external-link" style="width: 12px; height: 12px;"></i> Open Full Size</a>` : ''}
          </div>
          
          <div class="glass" style="border-radius: 14px; overflow: hidden; border: 1px solid var(--border); min-height: 240px; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.3); position: relative;">
            ${proof ? `
              <a href="${escapeHtml(proof)}" target="_blank" rel="noreferrer" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
                <img src="${escapeHtml(proof)}" alt="Payment Proof" style="max-width: 100%; max-height: 360px; object-fit: contain; display: block; cursor: zoom-in;" />
              </a>
            ` : `
              <div style="text-align: center; color: var(--muted); padding: 30px;">
                <i data-lucide="image-off" style="width: 40px; height: 40px; opacity: 0.4; margin-bottom: 8px;"></i>
                <div style="font-size: 13px;">No payment screenshot uploaded by customer.</div>
              </div>
            `}
          </div>
        </div>

        <!-- Right: Order & Buyer Metadata -->
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <div style="font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em;">
            Transaction & Buyer Breakdown
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div class="glass" style="padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border);">
              <div style="font-size: 11px; color: var(--muted);">Amount Paid</div>
              <div style="font-size: 18px; font-weight: 800; color: #34d399; margin-top: 2px;">${escapeHtml(amountFormatted)}</div>
            </div>
            <div class="glass" style="padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border);">
              <div style="font-size: 11px; color: var(--muted);">Payment Method</div>
              <div style="font-size: 14px; font-weight: 700; color: #fff; margin-top: 4px;">${escapeHtml(methodName)}</div>
            </div>
          </div>

          <div class="glass" style="padding: 14px 16px; border-radius: 12px; border: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px;">
            <div style="display: flex; justify-content: space-between; font-size: 12.5px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 6px;">
              <span style="color: var(--muted);">Buyer Details:</span>
              <strong style="color: #fff;">${escapeHtml(orderCustomerLabel(item))}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12.5px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 6px;">
              <span style="color: var(--muted);">Order Date:</span>
              <span style="color: #fff;">${escapeHtml(formatDateTime(orderDateValue(item)))} (${escapeHtml(formatRelativeTime(orderDateValue(item)))})</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12.5px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 6px;">
              <span style="color: var(--muted);">Txn / Ref ID:</span>
              <code style="color: #818cf8; font-size: 11.5px;">${escapeHtml(orderTransactionId(item))}</code>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12.5px;">
              <span style="color: var(--muted);">Payment State:</span>
              <strong style="color: ${isPaid ? '#34d399' : isFailed ? '#f87171' : '#fbbf24'};">${escapeHtml(orderStatusLabel(item))}</strong>
            </div>
          </div>

          ${delivery ? `
            <div class="glass" style="padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(99,102,241,0.2); background: rgba(99,102,241,0.04);">
              <div style="font-size: 11px; font-weight: 700; color: #818cf8; text-transform: uppercase;">Delivery / Access Notes:</div>
              <div style="font-size: 12.5px; color: #fff; margin-top: 4px;">${escapeHtml(delivery)}</div>
            </div>
          ` : ''}
        </div>

      </div>

      <!-- Action Toolbar -->
      <div class="toolbar" style="margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding-bottom: 20px;">
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-danger btn-sm" type="button" data-action="delete-order" data-id="${escapeHtml(item.id || '')}" style="font-size: 12px; padding: 8px 14px;">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i> Delete Order
          </button>
        </div>

        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button class="btn btn-ghost" type="button" data-close-modal onclick="closeModal()" style="font-size: 13px; padding: 8px 16px;">
            Close
          </button>
          <button class="btn btn-ghost" type="button" data-action="reject-order" data-id="${escapeHtml(item.id || '')}" style="font-size: 13px; padding: 8px 16px; color: #f87171; border-color: rgba(239, 68, 68, 0.3);">
            <i data-lucide="x-circle" style="width: 15px; height: 15px;"></i> Reject Payment
          </button>
          <button class="btn btn-primary" type="button" data-action="approve-order" data-id="${escapeHtml(item.id || '')}" style="font-size: 13px; padding: 8px 20px; font-weight: 700; background: linear-gradient(135deg, #10b981, #059669) !important; border: none !important; color: white !important; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
            <i data-lucide="check-circle" style="width: 16px; height: 16px;"></i> Approve & Verify Order
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderOrdersManagementView(data = {}, fullData = {}) {
  const allOrders = listCollection('orders');
  const items = sortManagementList(filterManagementList(allOrders, 'orders'));
  const totals = managementTotals(allOrders);
  const activeTab = ui.management.status || 'all';

  const methods = [...new Set(allOrders.map((item) => orderMethodLabel(item)).filter((value) => value && value !== 'Unknown'))];

  return `
    <div class="page active management-page-shell" style="max-width: 1240px; margin: 0 auto; padding-bottom: 60px;">
      
      <!-- Top Control Header -->
      <section class="panel glass" style="padding: 24px 28px; border-radius: 16px; margin-bottom: 24px; border: 1px solid var(--border);">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px;">
          <div>
            <div style="font-size: 11px; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">Realtime Checkout Stream</div>
            <h2 style="margin: 0; font-size: 24px; font-weight: 800; color: var(--text);">Orders & Payment Verifications</h2>
            <p style="margin: 4px 0 0 0; color: var(--muted); font-size: 13px;">Manage real customer transactions, verify payment screenshot proofs, and approve orders.</p>
          </div>
          <div class="toolbar" style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <button class="btn btn-ghost" type="button" data-action="export-orders-csv" title="Export all orders to CSV"><i data-lucide="download"></i> Export CSV</button>
            <button class="btn btn-ghost" type="button" data-action="goto" data-route="payment"><i data-lucide="credit-card"></i> Payment Hub</button>
          </div>
        </div>

        <!-- Metric KPI Cards -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.06);">
          
          <div style="background: rgba(99, 102, 241, 0.06); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 14px; padding: 16px 18px;">
            <div style="font-size: 11px; font-weight: 700; color: #818cf8; text-transform: uppercase; letter-spacing: 0.05em;">Total Orders</div>
            <div style="font-size: 26px; font-weight: 800; color: #fff; margin-top: 4px;">${totals.total}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">All customer records</div>
          </div>

          <div style="background: rgba(245, 158, 11, 0.06); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 14px; padding: 16px 18px;">
            <div style="font-size: 11px; font-weight: 700; color: #f59e0b; text-transform: uppercase; letter-spacing: 0.05em;">Pending Review</div>
            <div style="font-size: 26px; font-weight: 800; color: #fbbf24; margin-top: 4px;">${totals.pending}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">Awaiting verification</div>
          </div>

          <div style="background: rgba(16, 185, 129, 0.06); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 14px; padding: 16px 18px;">
            <div style="font-size: 11px; font-weight: 700; color: #10b981; text-transform: uppercase; letter-spacing: 0.05em;">Verified & Paid</div>
            <div style="font-size: 26px; font-weight: 800; color: #34d399; margin-top: 4px;">${totals.paid}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">Approved orders</div>
          </div>

          <div style="background: rgba(236, 72, 153, 0.06); border: 1px solid rgba(236, 72, 153, 0.25); border-radius: 14px; padding: 16px 18px;">
            <div style="font-size: 11px; font-weight: 700; color: #f472b6; text-transform: uppercase; letter-spacing: 0.05em;">Total Volume</div>
            <div style="font-size: 26px; font-weight: 800; color: #fff; margin-top: 4px;">${formatCurrencyCompact(totals.totalReceived)}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">From verified payments</div>
          </div>

        </div>
      </section>

      <!-- Status Tab Filter Pills -->
      <div class="order-tabs-nav">
        <button type="button" class="order-tab-btn ${activeTab === 'all' ? 'active' : ''}" data-action="set-orders-tab" data-status="all">
          All Orders <span>${totals.total}</span>
        </button>
        <button type="button" class="order-tab-btn ${activeTab === 'pending' ? 'active' : ''}" data-action="set-orders-tab" data-status="pending">
          ⏳ Pending Review <span>${totals.pending}</span>
        </button>
        <button type="button" class="order-tab-btn ${activeTab === 'paid' ? 'active' : ''}" data-action="set-orders-tab" data-status="paid">
          ✅ Verified / Paid <span>${totals.paid}</span>
        </button>
        <button type="button" class="order-tab-btn ${activeTab === 'failed' ? 'active' : ''}" data-action="set-orders-tab" data-status="failed">
          ❌ Rejected <span>${totals.failed}</span>
        </button>
      </div>

      <!-- Search & Filters Toolbar -->
      <div class="panel glass" style="padding: 16px 20px; border-radius: 14px; margin-bottom: 20px; border: 1px solid var(--border);">
        <div class="management-filterbar" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px;">
          <div class="field" style="grid-column: span 2;">
            <label for="orderSearch" style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--muted);">Search Orders</label>
            <input class="input" id="orderSearch" type="search" placeholder="Search by Product, Order ID, buyer, or amount..." value="${escapeHtml(ui.management.search || '')}" />
          </div>
          <div class="field">
            <label for="orderMethodFilter" style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--muted);">Payment Method</label>
            <select class="select" id="orderMethodFilter">
              <option value="all">All Gateways</option>
              ${methods.map((m) => `<option value="${escapeHtml(m)}" ${ui.management.method === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="orderDateFilter" style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--muted);">Date Range</label>
            <select class="select" id="orderDateFilter">
              <option value="all" ${ui.management.date === 'all' ? 'selected' : ''}>All Time</option>
              <option value="today" ${ui.management.date === 'today' ? 'selected' : ''}>Today</option>
              <option value="month" ${ui.management.date === 'month' ? 'selected' : ''}>This Month</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Orders Table -->
      <div class="orders-table-shell">
        <table class="orders-table">
          <thead>
            <tr>
              <th style="min-width: 280px;">Order & Proof</th>
              <th style="min-width: 140px;">Customer</th>
              <th style="min-width: 120px;">Amount</th>
              <th style="min-width: 130px;">Method</th>
              <th style="min-width: 140px;">Status</th>
              <th style="min-width: 140px;">Date</th>
              <th style="min-width: 160px; text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${items.length ? items.map((item) => {
              const proof = orderPaymentProof(item);
              const isPaid = isPaidOrder(item);
              const isFailed = isFailedOrder(item);
              const orderId = item.id || item.orderId || '-';
              const shortId = orderId.length > 10 ? `${orderId.substring(0, 8)}...` : orderId;
              const prodTitle = orderProductName(item);
              const method = orderMethodLabel(item);
              const methodLower = method.toLowerCase();
              const methodClass = methodLower.includes('upi') ? 'upi' : methodLower.includes('binance') ? 'binance' : methodLower.includes('paypal') ? 'paypal' : 'crypto';
              const formattedAmt = item.amountDisplay || formatCurrencyCompact(item.amount || item.inr || 0);

              return `
                <tr>
                  <!-- Col 1: Order & Proof -->
                  <td>
                    <div class="order-product-cell">
                      <div class="order-proof-thumb-wrap" data-action="open-order" data-id="${escapeHtml(item.id)}" title="${proof ? 'View Payment Screenshot' : 'View Order Details'}">
                        ${proof ? `
                          <img src="${escapeHtml(proof)}" alt="Proof" loading="lazy" />
                          <span class="order-proof-badge"><i data-lucide="image" style="width: 8px; height: 8px; vertical-align: middle;"></i> PROOF</span>
                        ` : `
                          <div style="width: 100%; height: 100%; display: grid; place-items: center; background: linear-gradient(135deg, #6366f1, #a855f7); color: #fff; font-weight: 800; font-size: 16px;">
                            ${escapeHtml((prodTitle[0] || 'O').toUpperCase())}
                          </div>
                        `}
                      </div>
                      <div style="min-width: 0;">
                        <strong style="display: block; font-size: 13.5px; color: var(--text); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;" title="${escapeHtml(prodTitle)}">
                          ${escapeHtml(prodTitle)}
                        </strong>
                        <span class="order-id-badge" onclick="copyText('${escapeHtml(orderId)}'); showToast('Order ID copied!');" title="Click to Copy #${escapeHtml(orderId)}">
                          <i data-lucide="copy" style="width: 10px; height: 10px;"></i> #${escapeHtml(shortId)}
                        </span>
                      </div>
                    </div>
                  </td>

                  <!-- Col 2: Customer -->
                  <td>
                    <div style="font-size: 13px; color: var(--text); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">
                      ${escapeHtml(orderCustomerLabel(item))}
                    </div>
                  </td>

                  <!-- Col 3: Amount -->
                  <td>
                    <span class="order-amount-cell">${escapeHtml(formattedAmt)}</span>
                  </td>

                  <!-- Col 4: Method -->
                  <td>
                    <span class="order-method-badge ${methodClass}">
                      <i data-lucide="${methodClass === 'upi' ? 'smartphone' : methodClass === 'binance' ? 'coins' : methodClass === 'paypal' ? 'wallet' : 'shield-check'}" style="width: 13px; height: 13px;"></i>
                      ${escapeHtml(method)}
                    </span>
                  </td>

                  <!-- Col 5: Status -->
                  <td>
                    <span class="order-status-pill ${isPaid ? 'approved' : isFailed ? 'rejected' : 'pending'}">
                      ${isPaid ? '🟢 Approved' : isFailed ? '🔴 Rejected' : '🟡 Pending'}
                    </span>
                  </td>

                  <!-- Col 6: Date -->
                  <td>
                    <div style="font-size: 12.5px; color: var(--text); white-space: nowrap;">${escapeHtml(formatDateTime(orderDateValue(item)))}</div>
                    <div style="font-size: 11px; color: var(--muted); margin-top: 2px;">${escapeHtml(formatRelativeTime(orderDateValue(item)))}</div>
                  </td>

                  <!-- Col 7: Actions -->
                  <td style="text-align: right;">
                    <div class="order-actions-toolbar" style="justify-content: flex-end;">
                      <button class="order-quick-btn view" type="button" data-action="open-order" data-id="${escapeHtml(item.id)}" title="View Proof & Order">
                        <i data-lucide="eye" style="width: 13px; height: 13px;"></i> View
                      </button>
                      ${!isPaid ? `
                        <button class="order-quick-btn approve" type="button" data-action="approve-order" data-id="${escapeHtml(item.id)}" title="Verify & Approve">
                          <i data-lucide="check" style="width: 13px; height: 13px;"></i>
                        </button>
                      ` : ''}
                      ${!isFailed ? `
                        <button class="order-quick-btn reject" type="button" data-action="reject-order" data-id="${escapeHtml(item.id)}" title="Reject Order">
                          <i data-lucide="x" style="width: 13px; height: 13px;"></i>
                        </button>
                      ` : ''}
                    </div>
                  </td>
                </tr>
              `;
            }).join('') : `
              <tr>
                <td colspan="7" style="text-align: center; padding: 48px 24px; color: var(--muted);">
                  <i data-lucide="inbox" style="width: 44px; height: 44px; opacity: 0.3; margin-bottom: 12px;"></i>
                  <div style="font-size: 15px; font-weight: 600; color: var(--text);">No orders found</div>
                  <div style="font-size: 13px; margin-top: 4px;">${allOrders.length ? 'No orders match your current filter settings.' : 'Customer orders will appear here in real time as they complete checkout.'}</div>
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>

    </div>
  `;
}

function renderScreenshotsGalleryView(data = {}, fullData = {}) {
  const allOrders = listCollection('orders');
  
  // Filter for orders that have screenshots
  const itemsWithScreenshot = allOrders.filter((item) => {
    const proof = orderPaymentProof(item);
    return proof && String(proof).trim() !== '';
  });
  
  // Sort items (newest first)
  const sortedItems = [...itemsWithScreenshot].sort((a, b) => orderDateValue(b) - orderDateValue(a));
  
  const methods = [...new Set(sortedItems.map((item) => orderMethodLabel(item)).filter((value) => value && value !== 'Unknown'))];
  
  // Apply filters
  const search = String(ui.management.search || '').trim().toLowerCase();
  const statusFilter = String(ui.management.status || 'all');
  const methodFilter = String(ui.management.method || 'all');
  const dateFilter = String(ui.management.date || 'all');
  
  const todayStr = new Date().toISOString().slice(0, 10);
  const thisMonthStr = new Date().toISOString().slice(0, 7);
  
  const filteredItems = sortedItems.filter((item) => {
    const name = orderProductName(item).toLowerCase();
    const txn = orderTransactionId(item).toLowerCase();
    const customer = orderCustomerLabel(item).toLowerCase();
    const status = orderStatusValue(item);
    const method = orderMethodLabel(item);
    const dateValue = orderDateValue(item);
    const dateStr = dateValue ? new Date(dateValue).toISOString() : '';
    
    // Search match
    const matchesSearch = !search || 
      name.includes(search) || 
      txn.includes(search) || 
      customer.includes(search) || 
      String(item.id || '').toLowerCase().includes(search);
      
    // Status match
    let matchesStatus = true;
    if (statusFilter !== 'all') {
      if (statusFilter === 'paid' || statusFilter === 'approved') {
        matchesStatus = isPaidOrder(item);
      } else if (statusFilter === 'pending') {
        matchesStatus = isPendingOrder(item);
      } else if (statusFilter === 'failed' || statusFilter === 'rejected') {
        matchesStatus = isFailedOrder(item);
      } else {
        matchesStatus = status === statusFilter;
      }
    }
    
    // Method match
    const matchesMethod = methodFilter === 'all' || method === methodFilter;
    
    // Date match
    let matchesDate = true;
    if (dateFilter === 'today') {
      matchesDate = dateStr.slice(0, 10) === todayStr;
    } else if (dateFilter === 'month') {
      matchesDate = dateStr.slice(0, 7) === thisMonthStr;
    }
    
    return matchesSearch && matchesStatus && matchesMethod && matchesDate;
  });

  const totals = {
    total: itemsWithScreenshot.length,
    pending: itemsWithScreenshot.filter((item) => isPendingOrder(item)).length,
    paid: itemsWithScreenshot.filter((item) => isPaidOrder(item)).length,
    failed: itemsWithScreenshot.filter((item) => isFailedOrder(item)).length,
  };

  return `
    <div class="page active management-page-shell" style="max-width: 1300px; margin: 0 auto; padding-bottom: 60px;">
      
      <!-- Top Header -->
      <section class="panel glass" style="padding: 24px 28px; border-radius: 16px; margin-bottom: 24px; border: 1px solid var(--border);">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
              <span style="font-size: 11px; font-weight: 700; color: #10b981; text-transform: uppercase; letter-spacing: 0.08em;">
                Payment Proof Gallery
              </span>
              <span class="badge ${totals.pending > 0 ? 'warning' : 'success'}" style="font-size: 11px;">
                ${totals.pending > 0 ? `${totals.pending} Pending Review` : 'All Verified'}
              </span>
            </div>
            <h2 style="margin: 0; font-size: 24px; font-weight: 800; color: var(--text);">Order Screenshots</h2>
            <p style="margin: 4px 0 0 0; color: var(--muted); font-size: 13px;">Review payment screenshots submitted by customers and approve or reject orders directly.</p>
          </div>
          <div class="toolbar" style="display: flex; gap: 10px; align-items: center;">
            <button class="btn btn-ghost" type="button" data-action="goto" data-route="orders" style="font-size: 13px; display: inline-flex; align-items: center; gap: 6px;">
              <i data-lucide="receipt-text"></i> View Orders Table
            </button>
          </div>
        </div>

        <!-- 4 Metric Cards -->
        <div class="management-summary-grid" style="margin-top: 20px;">
          ${renderManagementSummaryCard('Total Screenshots', totals.total, 'All customer receipts', 'primary')}
          ${renderManagementSummaryCard('Pending Review', totals.pending, 'Awaiting approval', totals.pending > 0 ? 'warning' : 'default')}
          ${renderManagementSummaryCard('Approved & Paid', totals.paid, 'Verified payments', 'success')}
          ${renderManagementSummaryCard('Rejected / Failed', totals.failed, 'Declined orders', 'danger')}
        </div>
      </section>

      <!-- Search & Filters -->
      ${renderFieldGroup('Filter & Search Proofs', 'Narrow down screenshots by status, payment gateway, or keyword.', `
        <div class="management-filterbar">
          <div class="field">
            <label for="orderSearch">Search Customer / Order ID / Txn</label>
            <input class="input" id="orderSearch" type="search" placeholder="Type name, email, order ID, or transaction hash..." value="${escapeHtml(ui.management.search || '')}" />
          </div>
          <div class="field">
            <label for="orderStatusFilter">Status</label>
            <select class="select" id="orderStatusFilter">
              ${['all', 'pending', 'paid', 'failed', 'approved', 'rejected', 'expired'].map((status) => `<option value="${status}" ${ui.management.status === status ? 'selected' : ''}>${escapeHtml(status.toUpperCase())}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="orderMethodFilter">Payment Gateway</label>
            <select class="select" id="orderMethodFilter">
              <option value="all">All Gateways</option>
              ${methods.map((method) => `<option value="${escapeHtml(method)}" ${ui.management.method === method ? 'selected' : ''}>${escapeHtml(method)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="orderDateFilter">Date Period</label>
            <select class="select" id="orderDateFilter">
              <option value="all" ${ui.management.date === 'all' ? 'selected' : ''}>All Time</option>
              <option value="today" ${ui.management.date === 'today' ? 'selected' : ''}>Today</option>
              <option value="month" ${ui.management.date === 'month' ? 'selected' : ''}>This Month</option>
            </select>
          </div>
        </div>
      `)}

      <!-- Grid of Screenshot Cards -->
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 24px; margin-top: 24px;">
        ${filteredItems.length ? filteredItems.map((item) => {
          const proof = orderPaymentProof(item);
          const status = orderStatusValue(item);
          const resolvedProof = resolveMediaSource(proof) || proof;
          const isPending = isPendingOrder(item);
          const isPaid = isPaidOrder(item);

          return `
            <div class="panel glass" style="border-radius: 16px; overflow: hidden; border: 1px solid var(--border); display: flex; flex-direction: column; transition: transform 0.2s, box-shadow 0.2s; box-shadow: 0 8px 24px rgba(0,0,0,0.25);">
              
              <!-- Image Preview Area -->
              <div style="width: 100%; height: 260px; position: relative; background: #07070a; overflow: hidden; display: flex; align-items: center; justify-content: center; border-bottom: 1px solid var(--border);">
                <img 
                  src="${escapeHtml(resolvedProof)}" 
                  alt="Payment Receipt Screenshot" 
                  style="max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in; transition: transform 0.25s ease;"
                  onclick="window.open('${escapeHtml(resolvedProof)}', '_blank')" 
                  title="Click to view full high-resolution image"
                  loading="lazy"
                />
                <div style="position: absolute; top: 12px; right: 12px; display: flex; gap: 6px;">
                  <a href="${escapeHtml(resolvedProof)}" target="_blank" download="screenshot_${escapeHtml(item.id)}.jpg" style="padding: 6px 10px; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); border-radius: 8px; color: white; font-size: 11px; text-decoration: none; border: 1px solid rgba(255,255,255,0.15); display: inline-flex; align-items: center; gap: 4px;">
                    <i data-lucide="download" style="width: 13px; height: 13px;"></i> Download
                  </a>
                </div>
                <div style="position: absolute; top: 12px; left: 12px;">
                  ${renderStatusBadge(status)}
                </div>
              </div>

              <!-- Card Content -->
              <div style="padding: 20px; display: flex; flex-direction: column; gap: 14px; flex-grow: 1;">
                <div>
                  <div style="font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; margin-bottom: 2px;">
                    ${escapeHtml(orderMethodLabel(item))} · ${escapeHtml(formatDateTime(orderDateValue(item)))}
                  </div>
                  <h3 style="margin: 0; font-size: 16px; font-weight: 800; color: var(--text); line-height: 1.3;">
                    ${escapeHtml(orderProductName(item))}
                  </h3>
                </div>

                <div style="display: flex; flex-direction: column; gap: 8px; padding: 12px; background: rgba(255,255,255,0.02); border-radius: 10px; border: 1px solid rgba(255,255,255,0.04); font-size: 12.5px;">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: var(--muted);">Customer:</span>
                    <strong style="color: var(--text);">${escapeHtml(orderCustomerLabel(item))}</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: var(--muted);">Amount Paid:</span>
                    <strong style="color: #10b981; font-size: 14px;">${escapeHtml(formatCurrencyCompact(item.amount))}</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: var(--muted);">Order ID:</span>
                    <code style="font-size: 11.5px; color: var(--muted); background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px;">${escapeHtml(item.id || '-')}</code>
                  </div>
                </div>

                <!-- Action Buttons -->
                <div style="display: flex; gap: 8px; margin-top: auto; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.06);">
                  <button class="btn btn-ghost" type="button" data-action="open-order" data-id="${escapeHtml(item.id)}" style="flex: 1; font-size: 12.5px; padding: 9px 12px; display: inline-flex; align-items: center; justify-content: center; gap: 5px;">
                    <i data-lucide="eye" style="width: 14px; height: 14px;"></i> Details
                  </button>
                  
                  ${isPending ? `
                    <button class="btn btn-primary" type="button" data-action="approve-order" data-id="${escapeHtml(item.id)}" style="flex: 1; font-size: 12.5px; padding: 9px 12px; background: linear-gradient(135deg, #10b981, #059669) !important; border: none !important; color: white !important; display: inline-flex; align-items: center; justify-content: center; gap: 5px;">
                      <i data-lucide="check" style="width: 14px; height: 14px;"></i> Approve
                    </button>
                    <button class="btn btn-danger" type="button" data-action="reject-order" data-id="${escapeHtml(item.id)}" style="flex: 1; font-size: 12.5px; padding: 9px 12px; display: inline-flex; align-items: center; justify-content: center; gap: 5px;">
                      <i data-lucide="x" style="width: 14px; height: 14px;"></i> Reject
                    </button>
                  ` : ''}

                  ${isPaid ? `
                    <span style="flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 4px; font-size: 12px; font-weight: 700; color: #10b981; padding: 8px 12px; background: rgba(16, 185, 129, 0.1); border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.2);">
                      <i data-lucide="check-circle" style="width: 14px; height: 14px;"></i> Approved
                    </span>
                  ` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('') : `
          <div style="grid-column: 1/-1;">
            <div class="panel glass" style="padding: 40px 20px; text-align: center; border-radius: 16px; border: 1px dashed var(--border);">
              <i data-lucide="image-off" style="width: 42px; height: 42px; color: var(--muted); margin-bottom: 12px;"></i>
              <h3 style="margin: 0 0 6px 0; font-size: 17px; font-weight: 700; color: var(--text);">
                ${itemsWithScreenshot.length ? 'No screenshots match your current filter criteria' : 'No Customer Screenshots Found Yet'}
              </h3>
              <p style="margin: 0; font-size: 13px; color: var(--muted); max-width: 500px; margin: 0 auto;">
                ${itemsWithScreenshot.length ? 'Try clearing or changing your search filters above.' : 'When customers complete payments on the checkout page and upload payment screenshots, they will appear here in real-time.'}
              </p>
            </div>
          </div>
        `}
      </div>
    </div>
  `;
}

let _usersLoading = false;
let _usersCache = null;
let _usersLastFetched = 0;

async function fetchUsersForAdmin(force = false) {
  if (_usersLoading) return;
  if (!force && _usersCache && Date.now() - _usersLastFetched < 30000) {
    return _usersCache;
  }
  _usersLoading = true;
  try {
    // Try API endpoint first (works on Vercel deployment)
    const adminHeaders = await getAdminTokenHeader();
    const res = await fetch('/api/auth/customer?all=true', {
      headers: adminHeaders,
    });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.users) && data.users.length > 0) {
        _usersCache = data.users;
        _usersLastFetched = Date.now();
        if (ui.route === 'users') renderView(ui.data || {});
        return _usersCache;
      }
    }
  } catch (err) {
    console.warn('API fetch failed, using live RTDB data:', err?.message);
  } finally {
    _usersLoading = false;
  }
  // Fallback: build from live RTDB data (always available)
  _usersCache = _buildUsersFromLiveData(ui.data || {});
  _usersLastFetched = Date.now();
  if (ui.route === 'users') renderView(ui.data || {});
  return _usersCache;
}

function _buildUsersFromLiveData(data) {
  const userMap = new Map();

  // Source 1: events/customers (realtime subscribed)
  const evtCustomers = data.events?.customers || data.events?.Customers || {};
  if (evtCustomers && typeof evtCustomers === 'object') {
    Object.entries(evtCustomers).forEach(([key, u]) => {
      if (u && u.email) {
        const k = u.email.toLowerCase().trim();
        userMap.set(k, { uid: key, ...u });
      } else if (u && key.startsWith('cust_')) {
        // Customer record without email field — use UID as key
        userMap.set(key, { uid: key, ...u });
      }
    });
  }

  // Source 2: customers (realtime subscribed)
  const directCustomers = data.customers || {};
  if (directCustomers && typeof directCustomers === 'object') {
    Object.entries(directCustomers).forEach(([key, u]) => {
      if (u && u.email) {
        const k = u.email.toLowerCase().trim();
        const existing = userMap.get(k);
        userMap.set(k, { uid: key, ...existing, ...u });
      } else if (u && key.startsWith('cust_')) {
        const existing = userMap.get(key);
        userMap.set(key, { uid: key, ...existing, ...u });
      }
    });
  }

  // Source 3: Check orders for customer emails not in customers DB
  const orders = data.orders || {};
  if (orders && typeof orders === 'object') {
    Object.values(orders).forEach(order => {
      if (order && order.email) {
        const k = order.email.toLowerCase().trim();
        if (!userMap.has(k)) {
          userMap.set(k, {
            email: order.email,
            displayName: order.name || order.buyerName || order.email.split('@')[0],
            provider: 'order',
            verified: true,
            createdAt: order.date || order.createdAt || order.timestamp || Date.now(),
          });
        }
      }
    });
  }

  const list = Array.from(userMap.values());
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return list;
}

function exportUsersCsv() {
  // Build fresh from live data
  const users = _buildUsersFromLiveData(ui.data || {});
  if (!users.length) {
    showToast('No users available to export.');
    return;
  }
  const headers = ['Customer Name', 'Email Address', 'UID', 'Joined Date', 'Auth Providers', 'Status'];
  const rows = users.map(u => [
    `"${String(u.displayName || 'Customer').replace(/"/g, '""')}"`,
    `"${String(u.email || '').replace(/"/g, '""')}"`,
    `"${String(u.uid || '').replace(/"/g, '""')}"`,
    `"${u.createdAt ? new Date(u.createdAt).toISOString() : ''}"`,
    `"${Array.isArray(u.providers) ? u.providers.join('; ') : (u.provider || '')}"`,
    `"${u.verified !== false ? 'Verified Member' : 'Pending'}"`
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `linkadda_users_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast(`Exported ${users.length} users to CSV!`);
}

function renderUsersManagementView(data = {}, fullData = {}) {
  // Build users list directly from live RTDB data — no API dependency
  const allUsers = _buildUsersFromLiveData(data);

  const totalCount = allUsers.length;
  const googleCount = allUsers.filter(u => (u.providers && u.providers.includes('google')) || u.provider === 'google').length;
  const otpCount = allUsers.filter(u => (u.providers && u.providers.includes('email_otp')) || u.provider === 'email_otp').length;
  const verifiedCount = allUsers.filter(u => u.verified !== false).length;

  const searchTerm = String(ui.usersSearch || '').toLowerCase().trim();
  const providerFilter = ui.usersProvider || 'all';

  let filtered = allUsers;
  if (searchTerm) {
    filtered = filtered.filter(u => {
      const name = String(u.displayName || '').toLowerCase();
      const email = String(u.email || '').toLowerCase();
      const uid = String(u.uid || '').toLowerCase();
      return name.includes(searchTerm) || email.includes(searchTerm) || uid.includes(searchTerm);
    });
  }

  if (providerFilter === 'google') {
    filtered = filtered.filter(u => (u.providers && u.providers.includes('google')) || u.provider === 'google');
  } else if (providerFilter === 'email_otp') {
    filtered = filtered.filter(u => (u.providers && u.providers.includes('email_otp')) || u.provider === 'email_otp');
  } else if (providerFilter === 'both') {
    filtered = filtered.filter(u => u.providers && u.providers.includes('google') && u.providers.includes('email_otp'));
  }

  return `
    <div class="page active management-page-shell" style="max-width: 1240px; margin: 0 auto; padding-bottom: 60px;">
      
      <!-- Top Header -->
      <section class="panel glass" style="padding: 24px 28px; border-radius: 16px; margin-bottom: 24px; border: 1px solid var(--border);">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px;">
          <div>
            <div style="font-size: 11px; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">User Directory & Growth</div>
            <h2 style="margin: 0; font-size: 24px; font-weight: 800; color: var(--text);">Registered Customers & Users</h2>
            <p style="margin: 4px 0 0 0; color: var(--muted); font-size: 13px;">Live view of all customers registered via Continue with Google or Email OTP with exact joined dates.</p>
          </div>
          <div class="toolbar" style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <button class="btn btn-ghost" type="button" data-action="refresh-users" title="Refresh user list"><i data-lucide="refresh-cw"></i> Refresh</button>
            <button class="btn btn-ghost" type="button" data-action="export-users-csv" title="Export users to CSV"><i data-lucide="download"></i> Export CSV</button>
          </div>
        </div>

        <!-- Metric KPI Cards -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.06);">
          <div style="background: rgba(99, 102, 241, 0.06); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 14px; padding: 16px 18px;">
            <div style="font-size: 11px; font-weight: 700; color: #818cf8; text-transform: uppercase; letter-spacing: 0.05em;">Total Customers</div>
            <div style="font-size: 26px; font-weight: 800; color: #fff; margin-top: 4px;">${totalCount}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">Unified registered accounts</div>
          </div>

          <div style="background: rgba(66, 133, 244, 0.06); border: 1px solid rgba(66, 133, 244, 0.25); border-radius: 14px; padding: 16px 18px;">
            <div style="font-size: 11px; font-weight: 700; color: #60a5fa; text-transform: uppercase; letter-spacing: 0.05em;">Google Auth</div>
            <div style="font-size: 26px; font-weight: 800; color: #93c5fd; margin-top: 4px;">${googleCount}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">Connected with Google</div>
          </div>

          <div style="background: rgba(255, 42, 141, 0.06); border: 1px solid rgba(255, 42, 141, 0.25); border-radius: 14px; padding: 16px 18px;">
            <div style="font-size: 11px; font-weight: 700; color: #ff65a3; text-transform: uppercase; letter-spacing: 0.05em;">Email OTP</div>
            <div style="font-size: 26px; font-weight: 800; color: #ff8abf; margin-top: 4px;">${otpCount}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">Verified via OTP code</div>
          </div>

          <div style="background: rgba(16, 185, 129, 0.06); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 14px; padding: 16px 18px;">
            <div style="font-size: 11px; font-weight: 700; color: #10b981; text-transform: uppercase; letter-spacing: 0.05em;">Verified Members</div>
            <div style="font-size: 26px; font-weight: 800; color: #34d399; margin-top: 4px;">${verifiedCount}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">100% Active members</div>
          </div>
        </div>
      </section>

      <!-- Status / Provider Filter Tabs -->
      <div class="order-tabs-nav" style="margin-bottom: 18px; display: flex; gap: 8px; flex-wrap: wrap;">
        <button type="button" class="order-tab-btn ${providerFilter === 'all' ? 'active' : ''}" data-action="set-users-filter" data-filter="all">
          All Users <span>${totalCount}</span>
        </button>
        <button type="button" class="order-tab-btn ${providerFilter === 'google' ? 'active' : ''}" data-action="set-users-filter" data-filter="google">
          <i data-lucide="chrome" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle;"></i> Google Auth <span>${googleCount}</span>
        </button>
        <button type="button" class="order-tab-btn ${providerFilter === 'email_otp' ? 'active' : ''}" data-action="set-users-filter" data-filter="email_otp">
          <i data-lucide="mail" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle;"></i> Email OTP <span>${otpCount}</span>
        </button>
        <button type="button" class="order-tab-btn ${providerFilter === 'both' ? 'active' : ''}" data-action="set-users-filter" data-filter="both">
          <i data-lucide="shield-check" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle;"></i> Dual Linked
        </button>
      </div>

      <!-- Search Bar -->
      <div class="panel glass" style="padding: 16px 20px; border-radius: 14px; margin-bottom: 20px; border: 1px solid var(--border);">
        <div style="display: flex; gap: 14px; align-items: center;">
          <div style="flex: 1; position: relative;">
            <input class="input" id="usersSearchInput" type="search" placeholder="Search by name, email address, or #LA-UID..." value="${escapeHtml(ui.usersSearch || '')}" style="padding-left: 38px;" />
            <i data-lucide="search" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); width: 16px; height: 16px;"></i>
          </div>
          <span class="chip" style="white-space: nowrap;">${filtered.length} of ${totalCount} users</span>
        </div>
      </div>

      <!-- Users Table -->
      <section class="panel glass" style="border-radius: 16px; border: 1px solid var(--border); overflow: hidden; padding: 0;">
        <div class="table-wrap" style="margin: 0; max-height: 700px; overflow-y: auto;">
          <table class="table" style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: rgba(255,255,255,0.02); border-bottom: 1px solid var(--border);">
                <th style="min-width: 240px; padding: 14px 20px; text-align: left; font-size: 11px; text-transform: uppercase; color: var(--muted);">Customer Name</th>
                <th style="min-width: 260px; padding: 14px 20px; text-align: left; font-size: 11px; text-transform: uppercase; color: var(--muted);">Email Address</th>
                <th style="min-width: 200px; padding: 14px 20px; text-align: left; font-size: 11px; text-transform: uppercase; color: var(--muted);">Joined Date</th>
                <th style="min-width: 180px; padding: 14px 20px; text-align: left; font-size: 11px; text-transform: uppercase; color: var(--muted);">Auth Method</th>
                <th style="min-width: 140px; padding: 14px 20px; text-align: left; font-size: 11px; text-transform: uppercase; color: var(--muted);">Membership</th>
                <th style="min-width: 100px; padding: 14px 20px; text-align: right; font-size: 11px; text-transform: uppercase; color: var(--muted);">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.length ? filtered.map((u) => {
                const name = u.displayName || 'Customer';
                const email = u.email || '—';
                const uid = u.uid || '—';
                const shortUid = uid.startsWith('cust_') ? `#LA-${uid.slice(-6).toUpperCase()}` : uid;
                const initials = name.slice(0, 2).toUpperCase() || 'CU';
                const joinedDate = u.createdAt ? new Date(u.createdAt) : new Date();
                const joinedDateStr = joinedDate.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
                const joinedTimeStr = joinedDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                const providers = Array.isArray(u.providers) ? u.providers : (u.provider ? [u.provider] : ['email_otp']);
                const hasGoogle = providers.includes('google');
                const hasOtp = providers.includes('email_otp');

                return `
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.04); transition: background 0.15s ease;">
                    <td style="padding: 16px 20px;">
                      <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 38px; height: 38px; border-radius: 10px; background: linear-gradient(135deg, rgba(255,42,141,0.2), rgba(168,85,247,0.2)); border: 1px solid rgba(255,42,141,0.3); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; color: #ff65a3;">
                          ${escapeHtml(initials)}
                        </div>
                        <div>
                          <div style="font-weight: 750; font-size: 14px; color: #ffffff;">${escapeHtml(name)}</div>
                          <div style="font-size: 11px; color: var(--muted); font-family: monospace; margin-top: 2px;">${escapeHtml(shortUid)}</div>
                        </div>
                      </div>
                    </td>
                    <td style="padding: 16px 20px;">
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 13px; color: #cbd5e1; font-weight: 600;">${escapeHtml(email)}</span>
                        <button type="button" class="btn btn-ghost" style="padding: 4px 8px; font-size: 11px;" onclick="copyText('${escapeHtml(email)}'); showToast('Email copied!');" title="Copy Email">
                          <i data-lucide="copy" style="width: 12px; height: 12px;"></i>
                        </button>
                      </div>
                    </td>
                    <td style="padding: 16px 20px;">
                      <div style="display: flex; flex-direction: column; gap: 2px;">
                        <div style="font-size: 13px; font-weight: 700; color: #ffffff;">
                          <i data-lucide="calendar" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle; color: #ff2a8d; margin-right: 4px;"></i>${escapeHtml(joinedDateStr)}
                        </div>
                        <div style="font-size: 11px; color: var(--muted);">${escapeHtml(joinedTimeStr)}</div>
                      </div>
                    </td>
                    <td style="padding: 16px 20px;">
                      <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                        ${hasGoogle ? `
                          <span style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 9px; border-radius: 8px; font-size: 11px; font-weight: 700; background: rgba(66, 133, 244, 0.12); border: 1px solid rgba(66, 133, 244, 0.3); color: #60a5fa;">
                            <i data-lucide="chrome" style="width: 11px; height: 11px;"></i> Google
                          </span>
                        ` : ''}
                        ${hasOtp ? `
                          <span style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 9px; border-radius: 8px; font-size: 11px; font-weight: 700; background: rgba(255, 42, 141, 0.12); border: 1px solid rgba(255, 42, 141, 0.3); color: #ff65a3;">
                            <i data-lucide="mail" style="width: 11px; height: 11px;"></i> Email OTP
                          </span>
                        ` : ''}
                      </div>
                    </td>
                    <td style="padding: 16px 20px;">
                      <span style="display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 999px; font-size: 11px; font-weight: 750; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399;">
                        <i data-lucide="shield-check" style="width: 12px; height: 12px;"></i> Verified Member
                      </span>
                    </td>
                    <td style="padding: 16px 20px; text-align: right;">
                      <button type="button" class="btn btn-ghost" style="padding: 6px 12px; font-size: 12px;" onclick="copyText('${escapeHtml(uid)}'); showToast('Customer UID copied!');" title="Copy User ID">
                        <i data-lucide="fingerprint" style="width: 13px; height: 13px;"></i> Copy ID
                      </button>
                    </td>
                  </tr>
                `;
              }).join('') : `
                <tr>
                  <td colspan="6" style="text-align: center; padding: 60px 20px;">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 10px;">
                      <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(255,255,255,0.04); display: flex; align-items: center; justify-content: center; font-size: 24px; color: var(--muted);">
                        <i data-lucide="users"></i>
                      </div>
                      <h4 style="margin: 0; font-size: 16px; font-weight: 750; color: #fff;">No Customers Found</h4>
                      <p style="margin: 0; color: var(--muted); font-size: 13px; max-width: 360px;">
                        ${searchTerm ? 'No registered customers matched your search query. Try clearing filters.' : 'Customers who authenticate with Google or Email OTP will appear here automatically with their joined dates.'}
                      </p>
                    </div>
                  </td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  `;
}

function listAllReviews(reviewsData = {}, productsMap = {}) {
  const list = [];
  if (!reviewsData || typeof reviewsData !== 'object') return list;
  for (const [key, val] of Object.entries(reviewsData)) {
    if (!val || typeof val !== 'object') continue;
    const childKeys = Object.keys(val);
    const firstChild = childKeys.length > 0 ? val[childKeys[0]] : null;
    const looksLikeChildMap = firstChild && typeof firstChild === 'object' && ('rating' in firstChild || 'comment' in firstChild || 'name' in firstChild || 'stars' in firstChild || 'text' in firstChild || 'author' in firstChild);
    if (looksLikeChildMap) {
      const prodId = key;
      const prod = productsMap[prodId] || {};
      const prodName = prod.name || prod.title || prodId;
      for (const [revId, rev] of Object.entries(val)) {
        if (rev && typeof rev === 'object') {
          list.push({
            id: revId,
            productId: prodId,
            productName: prodName,
            name: rev.name || rev.author || 'Customer',
            comment: rev.comment || rev.text || '',
            rating: Number(rev.rating || rev.stars || 5),
            ...rev
          });
        }
      }
    } else if ('rating' in val || 'comment' in val || 'name' in val || 'stars' in val || 'text' in val || 'author' in val) {
      const prodId = val.productId || 'general';
      const prod = productsMap[prodId] || {};
      const prodName = prod.name || prod.title || prodId;
      list.push({
        id: key,
        productId: prodId,
        productName: prodName,
        name: val.name || val.author || 'Customer',
        comment: val.comment || val.text || '',
        rating: Number(val.rating || val.stars || 5),
        ...val
      });
    }
  }

  // Also include user review submissions from events
  try {
    const events = listCollection('events') || [];
    events.filter(e => e && e.type === 'review_submission').forEach(e => {
      const rId = String(e.reviewId || e.id || '');
      if (rId && !list.some(r => String(r.id) === rId)) {
        const prodId = e.productId || 'general';
        const prod = productsMap[prodId] || {};
        const prodName = e.productName || prod.name || prod.title || prodId;
        list.push({
          id: rId,
          productId: prodId,
          productName: prodName,
          name: e.name || e.author || 'Customer',
          comment: e.comment || e.text || '',
          rating: Number(e.rating || e.stars || 5),
          status: e.status || 'pending',
          isEventSubmission: true,
          ...e
        });
      }
    });
  } catch (_) {}

  // Cross-reference with settings.recentApprovedReviews to ensure approved status persists
  try {
    const settings = (typeof ui !== 'undefined' && ui?.data?.settings) ? ui.data.settings : (typeof STORE !== 'undefined' && STORE?.settings) ? STORE.settings : {};
    const approvedRevs = Array.isArray(settings?.recentApprovedReviews) ? settings.recentApprovedReviews : [];
    if (approvedRevs.length > 0) {
      const approvedIds = new Set(approvedRevs.map(r => String(r.id)));
      list.forEach(r => {
        if (approvedIds.has(String(r.id))) {
          r.status = 'approved';
        }
      });
    }
  } catch (_) {}

  return list.sort((a, b) => (b.createdAt || b.timestamp || 0) - (a.createdAt || a.timestamp || 0));
}

function cleanStoreName(name) {
  if (!name || typeof name !== 'string') return '';
  let s = name
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (s.includes('trusted') || s.includes('brother')) return 'trusted brother';
  if (s.includes('ghost') || s.includes('hardik')) return 'ghost layer shop';
  if (s.includes('linkadda') || s.includes('jaigram')) return 'linkadda official';
  return s;
}

function matchProductToSeller(p, s) {
  if (!p || !s) return false;
  const sId = String(s.id || s.sellerId || '').trim();
  const sEmail = String(s.email || '').trim().toLowerCase();
  const sStore = cleanStoreName(s.storeName || '');
  const sOwner = cleanStoreName(s.ownerName || '');

  const pSellerId = String(p.sellerId || p.storeId || p.creatorId || '').trim();
  const pSellerEmail = String(p.sellerEmail || p.ownerEmail || '').trim().toLowerCase();
  const pStore = cleanStoreName(p.sellerName || p.sellerStoreName || p.storeName || '');

  // 1. Primary Trusted Brother match (jaibajpai67@gmail.com)
  if (sEmail === 'jaibajpai67@gmail.com' || sStore === 'trusted brother') {
    if (pSellerEmail === 'jaibajpai67@gmail.com') return true;
    if (pStore === 'trusted brother') return true;
    if (pSellerId && sId && pSellerId === sId) return true;
    const rawProdSeller = String(p.sellerName || p.sellerStoreName || '').toLowerCase();
    if (rawProdSeller.includes('trusted') || rawProdSeller.includes('brother') || rawProdSeller.includes('𝐭𝐫𝐮𝐬𝐭𝐞𝐝') || rawProdSeller.includes('𝐛𝐫𝐨𝐭𝐡𝐞𝐫')) return true;

    // Check if product belongs to another explicit third-party seller (e.g. ghost_layer_shop)
    const isOtherThirdParty = (pSellerEmail && pSellerEmail !== 'jaibajpai67@gmail.com' && pSellerEmail !== 'ritikanetwork96@gmail.com') &&
                              (pSellerId && pSellerId !== 'seller_jaibajpai67' && pSellerId !== 'master_admin');
    if (!isOtherThirdParty) {
      return true;
    }
  }

  // 2. Direct ID match
  if (sId && pSellerId && (sId === pSellerId || pSellerId.includes(sId) || sId.includes(pSellerId))) return true;

  // 3. Direct Email match
  if (sEmail && pSellerEmail && sEmail === pSellerEmail) return true;

  // 4. Store name match
  if (sStore && pStore && (sStore === pStore || pStore.includes(sStore) || sStore.includes(pStore))) return true;

  // 5. Owner name match
  if (sOwner && pStore && (sOwner === pStore || pStore.includes(sOwner) || sOwner.includes(pStore))) return true;

  return false;
}

function getUnifiedSellersMap(data = {}, fullData = {}) {
  const unified = {};

  // 1. Collect all real sellers from database sources
  const allRawSellers = {
    ...(fullData.public_sellers || {}),
    ...(data.public_sellers || {}),
    ...(fullData.events?.sellers || {}),
    ...(data.events?.sellers || {}),
    ...(fullData.sellers || {}),
    ...(data.sellers || {}),
  };

  for (const [id, s] of Object.entries(allRawSellers)) {
    if (s && typeof s === 'object') {
      const sId = s.id || s.sellerId || id;
      unified[sId] = { ...s, id: sId };
    }
  }

  // 2. Merge approved seller applications
  const rawApps = {
    ...(fullData.events?.seller_applications || {}),
    ...(data.events?.seller_applications || {}),
    ...(fullData.seller_applications || {}),
    ...(data.seller_applications || {}),
  };
  for (const [id, app] of Object.entries(rawApps)) {
    if (app && (app.status === 'approved' || app.credentialsSent)) {
      const sId = app.sellerId || app.id || id;
      if (!unified[sId]) {
        unified[sId] = {
          id: sId,
          storeName: app.storeName || 'Verified Store',
          ownerName: app.applicantName || app.fullName || 'Partner',
          email: app.email || '',
          telegram: app.telegram || '',
          category: app.category || 'General',
          portfolioLink: app.portfolioLink || '',
          status: 'active',
          verified: true,
          createdAt: app.reviewedAt || app.createdAt || Date.now(),
        };
      } else {
        unified[sId].email = unified[sId].email || app.email;
        unified[sId].telegram = unified[sId].telegram || app.telegram;
        unified[sId].ownerName = unified[sId].ownerName || app.applicantName;
        unified[sId].storeName = unified[sId].storeName || app.storeName;
      }
    }
  }

  // 3. Identify the primary real account for Trusted Brother (jaibajpai67@gmail.com)
  const primaryTbId = Object.keys(unified).find(k => {
    const s = unified[k];
    const em = String(s.email || '').toLowerCase().trim();
    return em === 'jaibajpai67@gmail.com' || cleanStoreName(s.storeName) === 'trusted brother';
  });

  // 4. Discover any missing third-party sellers from products (excluding Trusted Brother products which belong to primaryTbId)
  const products = { ...(fullData.products || {}), ...(data.products || {}) };
  for (const p of Object.values(products)) {
    if (!p || typeof p !== 'object') continue;
    const pSellerName = p.sellerName || p.sellerStoreName || '';
    const pSellerId = p.sellerId || p.storeId || '';
    const cleanP = cleanStoreName(pSellerName);

    // If it's Trusted Brother / Jai Bajpai, attach to primaryTbId and never duplicate
    if (cleanP === 'trusted brother' || String(p.sellerEmail || '').toLowerCase().trim() === 'jaibajpai67@gmail.com') {
      continue;
    }

    // Check if product belongs to any existing seller in unified
    const existingKey = Object.keys(unified).find(k => {
      const u = unified[k];
      if (pSellerId && (u.id === pSellerId || u.sellerId === pSellerId)) return true;
      if (cleanP && cleanStoreName(u.storeName) === cleanP) return true;
      if (cleanP && cleanStoreName(u.ownerName) === cleanP) return true;
      return false;
    });

    if (!existingKey && pSellerName && cleanP !== 'linkadda official') {
      const genId = pSellerId || ('creator_' + (cleanP.replace(/\s+/g, '_') || Date.now()));
      unified[genId] = {
        id: genId,
        storeName: pSellerName,
        ownerName: p.sellerOwner || pSellerName,
        category: p.category || 'Digital Creator',
        email: p.sellerEmail || '',
        telegram: p.sellerTelegram || '',
        status: 'active',
        verified: true,
        createdAt: p.createdAt || Date.now(),
      };
    }
  }

  // 5. Clean up duplicates: If a primary real account for Trusted brother exists, remove redundant duplicate records
  for (const [id, s] of Object.entries(unified)) {
    if (primaryTbId && id !== primaryTbId) {
      const em = String(s.email || '').toLowerCase().trim();
      if (em === 'jaibajpai67@gmail.com' || cleanStoreName(s.storeName) === 'trusted brother') {
        delete unified[id];
      }
    }
    // Remove dummy hardcoded entries with static epoch date 1704067200000
    if (id.startsWith('store_') && s.createdAt === 1704067200000) {
      delete unified[id];
    }
  }

  return unified;
}

function formatSellerPayoutInfo(seller = {}) {
  let method = String(seller.payoutMethod || '').toLowerCase().trim();
  if (!method) {
    if (seller.upiId) method = 'upi';
    else if (seller.accountNumber || seller.bankName) method = 'bank';
    else if (seller.usdtAddress) method = 'usdt';
    else if (seller.binancePayId) method = 'binance';
    else if (seller.paypalEmail) method = 'paypal';
  }

  const upiId = String(seller.upiId || '').trim();
  const bankName = String(seller.bankName || '').trim();
  const accountHolder = String(seller.accountHolder || seller.ownerName || '').trim();
  const accountNumber = String(seller.accountNumber || '').trim();
  const ifsc = String(seller.ifsc || '').trim().toUpperCase();
  const usdtAddress = String(seller.usdtAddress || '').trim();
  const usdtNetwork = String(seller.usdtNetwork || 'TRC-20').trim();
  const binancePayId = String(seller.binancePayId || '').trim();
  const paypalEmail = String(seller.paypalEmail || '').trim();

  const hasPayout = Boolean(upiId || accountNumber || usdtAddress || binancePayId || paypalEmail);

  let label = 'Not Configured';
  let badgeColor = '#94a3b8';
  let primaryCopyText = '';
  let summaryText = 'No payout destination';

  if (method === 'upi' && upiId) {
    label = '🇮🇳 UPI Transfer';
    badgeColor = '#38bdf8';
    primaryCopyText = upiId;
    summaryText = `UPI: ${upiId}`;
  } else if (method === 'bank' && (accountNumber || bankName)) {
    label = '🏦 India Bank Transfer';
    badgeColor = '#34d399';
    primaryCopyText = accountNumber;
    summaryText = `${bankName || 'Bank'}: ${accountNumber}`;
  } else if (method === 'usdt' && usdtAddress) {
    label = `💎 USDT (${usdtNetwork})`;
    badgeColor = '#22c55e';
    primaryCopyText = usdtAddress;
    summaryText = `USDT ${usdtNetwork}: ${usdtAddress.slice(0, 6)}...${usdtAddress.slice(-4)}`;
  } else if (method === 'binance' && binancePayId) {
    label = '🟡 Binance Pay';
    badgeColor = '#facc15';
    primaryCopyText = binancePayId;
    summaryText = `Binance: ${binancePayId}`;
  } else if (method === 'paypal' && paypalEmail) {
    label = '💳 PayPal';
    badgeColor = '#60a5fa';
    primaryCopyText = paypalEmail;
    summaryText = `PayPal: ${paypalEmail}`;
  }

  return {
    hasPayout,
    method,
    label,
    badgeColor,
    primaryCopyText,
    summaryText,
    upiId,
    bankName,
    accountHolder,
    accountNumber,
    ifsc,
    usdtAddress,
    usdtNetwork,
    binancePayId,
    paypalEmail
  };
}

function renderSellerDetailsModal(seller = {}, allProducts = {}, allOrders = {}) {
  const sellerId = seller.id || '';
  const storeName = seller.storeName || 'Creator Store';
  const ownerName = seller.ownerName || 'Partner';
  const email = seller.email || '';
  const telegram = seller.telegram || '';
  const category = seller.category || 'General';
  const portfolioLink = seller.portfolioLink || '';
  const joinedDate = formatDateTime(seller.createdAt);
  const payout = formatSellerPayoutInfo(seller);
  
  const tgClean = String(telegram).replace('@', '').trim();
  const tgUrl = tgClean.startsWith('http') ? tgClean : (tgClean ? `https://t.me/${tgClean}` : '');

  // Filter products by this seller with robust multi-field matching
  const sellerProducts = Object.values(allProducts || {}).filter(p => {
    if (!p) return false;
    return matchProductToSeller(p, seller);
  });

  return `
    <div class="seller-details-modal">
      
      <!-- Modal Header -->
      <div class="seller-details-head">
        <div class="seller-details-head-main">
          <div class="seller-details-title-row">
            <h2 class="seller-details-title">${escapeHtml(storeName)}</h2>
            <span class="badge success">✓ Verified Partner</span>
            <span class="badge category-pill">${escapeHtml(category)}</span>
          </div>
          <p class="seller-details-meta">
            Seller ID: <code class="seller-id-code">${escapeHtml(sellerId)}</code> &bull; Joined: ${joinedDate}
          </p>
        </div>
        <button class="seller-close-btn" data-close-modal type="button" aria-label="Close modal"><i data-lucide="x"></i></button>
      </div>

      <!-- Modal Body (Scrollable) -->
      <div class="seller-details-body">
        
        <!-- Seller Info Cards Grid -->
        <div class="seller-info-grid">
          <div class="seller-info-card">
            <div class="seller-info-label">Owner Name</div>
            <div class="seller-info-val">${escapeHtml(ownerName)}</div>
          </div>

          <div class="seller-info-card">
            <div class="seller-info-label">Login Email</div>
            <div class="seller-info-val seller-email-val">${escapeHtml(email)}</div>
          </div>

          <div class="seller-info-card">
            <div class="seller-info-label">Telegram & WhatsApp</div>
            <div class="seller-info-val">
              ${tgUrl ? `<a href="${tgUrl}" target="_blank" class="seller-tg-link">${escapeHtml(telegram)} ↗</a>` : `<span class="seller-text-muted">${escapeHtml(telegram || 'Not provided')}</span>`}
            </div>
          </div>

          <div class="seller-info-card">
            <div class="seller-info-label">Creator Revenue Share</div>
            <div class="seller-info-val seller-payout-val">100% Payout (0% Platform Fee)</div>
          </div>
        </div>

        <!-- Seller Payout Destination Card -->
        <div class="seller-payout-box ${payout.hasPayout ? 'active' : 'empty'}">
          <div class="seller-payout-box-head">
            <div class="seller-payout-box-title">
              <i data-lucide="wallet-cards" style="width: 18px; height: 18px; color: ${payout.hasPayout ? '#34d399' : '#f59e0b'};"></i>
              <span>Creator Payout Transfer Destination</span>
              <span class="seller-payout-method-badge" style="border-color: ${payout.badgeColor}; color: ${payout.badgeColor};">
                ${payout.label}
              </span>
            </div>
            ${payout.primaryCopyText ? `
              <button class="btn btn-sm btn-ghost seller-payout-copy-btn" type="button" data-action="copy-payout" data-payout-text="${escapeHtml(payout.primaryCopyText)}" data-payout-label="${escapeHtml(payout.label)}">
                <i data-lucide="copy" style="width: 13px; height: 13px;"></i> Copy Destination
              </button>
            ` : ''}
          </div>

          ${payout.hasPayout ? `
            <div class="seller-payout-details-content">
              ${payout.method === 'upi' ? `
                <div class="seller-payout-row primary">
                  <span class="seller-payout-field-label">UPI ID / VPA:</span>
                  <div class="seller-payout-field-value-wrap">
                    <code class="seller-payout-code">${escapeHtml(payout.upiId)}</code>
                    <button class="seller-payout-inline-copy" type="button" data-action="copy-payout" data-payout-text="${escapeHtml(payout.upiId)}" data-payout-label="UPI ID" title="Copy UPI ID"><i data-lucide="copy"></i></button>
                  </div>
                </div>
              ` : ''}

              ${payout.method === 'bank' ? `
                <div class="seller-payout-grid-bank">
                  <div class="seller-payout-field">
                    <span class="seller-payout-field-label">Account Holder</span>
                    <span class="seller-payout-field-val">${escapeHtml(payout.accountHolder || ownerName)}</span>
                  </div>
                  <div class="seller-payout-field">
                    <span class="seller-payout-field-label">Bank Name</span>
                    <span class="seller-payout-field-val">${escapeHtml(payout.bankName || 'Not specified')}</span>
                  </div>
                  <div class="seller-payout-field highlight">
                    <span class="seller-payout-field-label">Account Number</span>
                    <div class="seller-payout-field-value-wrap">
                      <code class="seller-payout-code">${escapeHtml(payout.accountNumber)}</code>
                      <button class="seller-payout-inline-copy" type="button" data-action="copy-payout" data-payout-text="${escapeHtml(payout.accountNumber)}" data-payout-label="Account Number" title="Copy Account Number"><i data-lucide="copy"></i></button>
                    </div>
                  </div>
                  <div class="seller-payout-field highlight">
                    <span class="seller-payout-field-label">IFSC Code</span>
                    <div class="seller-payout-field-value-wrap">
                      <code class="seller-payout-code">${escapeHtml(payout.ifsc)}</code>
                      <button class="seller-payout-inline-copy" type="button" data-action="copy-payout" data-payout-text="${escapeHtml(payout.ifsc)}" data-payout-label="IFSC Code" title="Copy IFSC"><i data-lucide="copy"></i></button>
                    </div>
                  </div>
                </div>
                <div style="margin-top: 10px; display: flex; justify-content: flex-end;">
                  <button class="btn btn-ghost btn-sm" type="button" data-action="copy-payout" data-payout-text="Bank: ${escapeHtml(payout.bankName)} | Holder: ${escapeHtml(payout.accountHolder)} | A/C: ${escapeHtml(payout.accountNumber)} | IFSC: ${escapeHtml(payout.ifsc)}" data-payout-label="Complete Bank Details">
                    <i data-lucide="clipboard-copy"></i> Copy All Bank Details
                  </button>
                </div>
              ` : ''}

              ${payout.method === 'usdt' ? `
                <div class="seller-payout-crypto-card">
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                    <span class="badge" style="background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3);">
                      💎 Tether (USDT) &bull; Network: <strong>${escapeHtml(payout.usdtNetwork)}</strong>
                    </span>
                    <span style="font-size: 11px; color: #94a3b8;">Direct Wallet Payout</span>
                  </div>
                  <div class="seller-payout-field-label">USDT Deposit Address:</div>
                  <div class="seller-payout-field-value-wrap" style="margin-top: 4px;">
                    <code class="seller-payout-code-full">${escapeHtml(payout.usdtAddress)}</code>
                    <button class="seller-payout-inline-copy" type="button" data-action="copy-payout" data-payout-text="${escapeHtml(payout.usdtAddress)}" data-payout-label="USDT ${escapeHtml(payout.usdtNetwork)} Address" title="Copy USDT Address"><i data-lucide="copy"></i></button>
                  </div>
                  <div style="font-size: 11px; color: #f59e0b; margin-top: 8px; display: flex; align-items: center; gap: 4px;">
                    <i data-lucide="alert-triangle" style="width: 12px; height: 12px;"></i>
                    Verify network <strong>${escapeHtml(payout.usdtNetwork)}</strong> before sending transfer.
                  </div>
                </div>
              ` : ''}

              ${payout.method === 'binance' ? `
                <div class="seller-payout-row primary">
                  <span class="seller-payout-field-label">Binance Pay ID / Email:</span>
                  <div class="seller-payout-field-value-wrap">
                    <code class="seller-payout-code">${escapeHtml(payout.binancePayId)}</code>
                    <button class="seller-payout-inline-copy" type="button" data-action="copy-payout" data-payout-text="${escapeHtml(payout.binancePayId)}" data-payout-label="Binance Pay ID" title="Copy Binance Pay ID"><i data-lucide="copy"></i></button>
                  </div>
                </div>
              ` : ''}

              ${payout.method === 'paypal' ? `
                <div class="seller-payout-row primary">
                  <span class="seller-payout-field-label">PayPal Email (International):</span>
                  <div class="seller-payout-field-value-wrap">
                    <code class="seller-payout-code">${escapeHtml(payout.paypalEmail)}</code>
                    <button class="seller-payout-inline-copy" type="button" data-action="copy-payout" data-payout-text="${escapeHtml(payout.paypalEmail)}" data-payout-label="PayPal Email" title="Copy PayPal Email"><i data-lucide="copy"></i></button>
                    <a href="https://www.paypal.com" target="_blank" class="btn btn-ghost btn-sm" style="margin-left: 6px;" title="Open PayPal"><i data-lucide="external-link"></i></a>
                  </div>
                </div>
              ` : ''}
            </div>
          ` : `
            <div class="seller-payout-empty-notice">
              <i data-lucide="alert-circle" style="width: 18px; height: 18px; color: #f59e0b;"></i>
              <div>
                <strong style="color: #fbbf24;">No Payout Destination Configured Yet</strong>
                <p style="margin: 2px 0 0 0; font-size: 12px; color: var(--muted);">The creator has not saved their UPI, Bank, USDT, Binance Pay, or PayPal details in their Seller Hub yet.</p>
              </div>
            </div>
          `}
        </div>

        ${portfolioLink ? `
          <div class="seller-portfolio-banner">
            <span class="seller-portfolio-label">Portfolio / Channel Samples:</span>
            <a href="${escapeHtml(portfolioLink)}" target="_blank" class="seller-portfolio-link">${escapeHtml(portfolioLink)} ↗</a>
          </div>
        ` : ''}

        <!-- Products Section -->
        <div class="seller-products-section">
          <div class="seller-products-head">
            <div>
              <h3 class="seller-products-title">
                Published Packs &amp; Collections
                <span class="seller-products-count-badge">${sellerProducts.length}</span>
              </h3>
              <p class="seller-products-subtitle">Digital packs and mega vaults listed by this partner</p>
            </div>
            <div class="seller-products-actions">
              ${(email === 'jaibajpai67@gmail.com' || cleanStoreName(storeName) === 'trusted brother') ? `
                <button class="btn btn-primary btn-sm assign-catalog-btn" type="button" data-action="assign-all-catalog-to-trusted" data-seller-id="${sellerId}" title="Assign all catalog products to Trusted brother in DB">
                  <i data-lucide="check-check"></i> Assign All Catalog Products (${Object.keys(allProducts).length})
                </button>
              ` : (sellerProducts.length > 0 ? `
                <button class="btn btn-ghost btn-sm link-packs-btn" type="button" data-action="link-seller-packs" data-seller-id="${sellerId}" data-seller-email="${escapeHtml(email)}" data-seller-name="${escapeHtml(storeName)}" title="Assign and save all these packs to this seller account in Firebase database">
                  <i data-lucide="link"></i> Link &amp; Save All Packs (${sellerProducts.length})
                </button>
              ` : '')}
              <button class="btn btn-primary btn-sm" type="button" data-action="add-pack-for-seller" data-seller-id="${sellerId}" data-seller-name="${escapeHtml(storeName)}">
                <i data-lucide="plus"></i> Add Pack for Seller
              </button>
            </div>
          </div>

          ${sellerProducts.length === 0 ? `
            <div class="seller-empty-packs">
              <div class="seller-empty-icon">📦</div>
              <h4>No Products Published Yet</h4>
              <p>This seller has not listed any packs yet. You can publish packs on their behalf or they can upload directly from their Seller Hub.</p>
              <button class="btn btn-primary btn-sm" type="button" data-action="add-pack-for-seller" data-seller-id="${sellerId}" data-seller-name="${escapeHtml(storeName)}">
                <i data-lucide="plus"></i> Publish First Pack for Seller
              </button>
            </div>
          ` : `
            <div class="seller-packs-grid">
              ${sellerProducts.map(p => {
                const rawImg = p.coverImage || p.image || p.thumbnail || p.thumbnailUrl || (Array.isArray(p.images) && p.images[0]) || (Array.isArray(p.galleryImages) && p.galleryImages[0]) || '';
                let img = String(rawImg || '').trim();
                if (typeof resolveAdminMediaUrl === 'function') {
                  img = resolveAdminMediaUrl(img);
                } else {
                  if (img.includes('media.jaigram.shop/')) {
                    img = img.startsWith('http') ? img : `https://${img.replace(/^\/+/, '')}`;
                  } else if (img.includes('media.linkadda.shop/')) {
                    const sub = img.split('media.linkadda.shop/')[1].replace(/^\/+/, '');
                    img = `https://media.jaigram.shop/${sub}`;
                  } else if (img.startsWith('products/') || img.startsWith('categories/') || img.startsWith('seller_products/') || img.startsWith('orders/')) {
                    img = `https://media.jaigram.shop/${img}`;
                  } else if (img.startsWith('/media/')) {
                    img = `https://media.jaigram.shop/${img.replace(/^\/media\//, '')}`;
                  } else if (img.startsWith('images/')) {
                    img = `/${img}`;
                  }
                }
                if (img.includes('placeholder.svg') || img.includes('favicon.svg') || !img) {
                  img = '/images/prod_vip_bundle.jpg';
                }
                const pPrice = Number(p.priceINR || p.price || 0);
                const pOrigPrice = Number(p.originalPriceINR || p.originalPrice || 0);
                const discountPct = (pOrigPrice > pPrice && pPrice > 0)
                  ? Math.round(((pOrigPrice - pPrice) / pOrigPrice) * 100)
                  : 0;
                const isPending = p.status === 'pending' || p.status === 'pending_approval' || p.approvalStatus === 'pending';

                return `
                  <div class="seller-pack-card" data-product-id="${escapeHtml(p.id)}">
                    <div class="seller-pack-thumb-wrap">
                      <img class="seller-pack-thumb" src="${escapeHtml(img)}" alt="${escapeHtml(p.title || p.name || 'Pack')}" loading="lazy" onerror="if(!this._tried){this._tried=true;this.src='/images/prod_vip_bundle.jpg';}" />
                      <div class="seller-pack-thumb-overlay"></div>
                      <span class="seller-pack-badge">${escapeHtml(p.category || 'VIP Pack')}</span>
                      ${isPending ? `<span class="seller-pack-status-badge pending">Pending</span>` : ''}
                    </div>
                    
                    <div class="seller-pack-body">
                      <h4 class="seller-pack-title" title="${escapeHtml(p.title || p.name || 'Untitled')}">${escapeHtml(p.title || p.name || 'Untitled')}</h4>
                      
                      <div class="seller-pack-price-row">
                        <span class="seller-pack-price">₹${escapeHtml(pPrice)}</span>
                        ${pOrigPrice > pPrice ? `<span class="seller-pack-orig-price">₹${escapeHtml(pOrigPrice)}</span>` : ''}
                        ${discountPct > 0 ? `<span class="seller-pack-discount-tag">${discountPct}% OFF</span>` : ''}
                      </div>

                      <div class="seller-pack-actions">
                        ${isPending ? `
                          <button class="btn btn-primary btn-sm seller-pack-approve-btn" type="button" data-action="approve-product" data-id="${p.id}" title="Approve and make live">
                            <i data-lucide="check-circle"></i> Approve
                          </button>
                        ` : ''}
                        <button class="btn btn-ghost btn-sm seller-pack-btn-edit" type="button" data-action="edit" data-node="products" data-id="${p.id}" title="Edit product details">
                          <i data-lucide="pencil"></i> <span>Edit</span>
                        </button>
                        <a href="/#product-${p.id}" target="_blank" class="btn btn-ghost btn-sm seller-pack-btn-icon" title="View on live storefront">
                          <i data-lucide="external-link"></i>
                        </a>
                        <button class="btn btn-ghost danger btn-sm seller-pack-btn-icon" type="button" data-action="delete" data-node="products" data-id="${p.id}" title="Delete pack">
                          <i data-lucide="trash-2"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>

      </div>

      <!-- Modal Footer -->
      <div class="seller-details-footer">
        <div class="seller-details-footer-left">
          <button class="btn btn-ghost danger btn-sm" type="button" data-action="delete-seller" data-seller-id="${sellerId}" data-store="${escapeHtml(storeName)}">
            <i data-lucide="trash-2"></i> <span>Delete Seller Account</span>
          </button>
        </div>
        <div class="seller-details-footer-right">
          ${tgUrl ? `
            <a href="${tgUrl}" target="_blank" class="btn btn-ghost btn-sm">
              <i data-lucide="send"></i> <span>Message on Telegram</span>
            </a>
          ` : ''}
          <button class="btn btn-primary btn-sm" type="button" data-action="add-pack-for-seller" data-seller-id="${sellerId}" data-seller-name="${escapeHtml(storeName)}">
            <i data-lucide="plus"></i> <span>Add Pack</span>
          </button>
          <button class="btn btn-ghost btn-sm" data-close-modal type="button">Close</button>
        </div>
      </div>

    </div>
  `;
}

function renderSellersManagementView(data = {}, fullData = {}) {
  const rawApps = {
    ...(data.events?.seller_applications || fullData.events?.seller_applications || {}),
    ...(data.seller_applications || fullData.seller_applications || {}),
  };
  const products = data.products || fullData.products || {};
  const unifiedSellers = getUnifiedSellersMap(data, fullData);

  const applicationsList = Object.entries(rawApps).map(([id, app]) => ({
    id: app?.id || id,
    ...app,
  })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const sellersList = Object.values(unifiedSellers).map((s) => {
    const sId = s?.id || s?.sellerId;
    const sellerProds = Object.values(products).filter(p => matchProductToSeller(p, s));
    return {
      ...s,
      id: sId,
      productCount: sellerProds.length,
    };
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const pendingApps = applicationsList.filter(a => (a.status || 'pending') === 'pending');
  let activeTab = ui.sellers?.tab;
  if (!activeTab) {
    activeTab = pendingApps.length > 0 ? 'pending' : 'active';
    if (!ui.sellers) ui.sellers = {};
    ui.sellers.tab = activeTab;
  }

  return `
    <div class="page active management-page-shell sellers-mgmt-page" style="max-width: 1240px; margin: 0 auto; padding-bottom: 60px;">
      
      <!-- Top Header -->
      <section class="panel glass sellers-mgmt-header">
        <div class="sellers-mgmt-header-row">
          <div>
            <div class="sellers-mgmt-eyebrow">Partner &amp; Multi-Vendor Hub</div>
            <h2 class="sellers-mgmt-title">Seller Management &amp; Approvals</h2>
            <p class="sellers-mgmt-subtitle">Review partner applications, generate seller credentials via Brevo email, and monitor verified stores.</p>
          </div>
          <div class="toolbar sellers-mgmt-toolbar">
            <button class="btn btn-ghost" type="button" data-action="refresh-sellers" title="Refresh seller data"><i data-lucide="refresh-cw"></i> <span>Refresh</span></button>
            <a href="/seller/apply" target="_blank" class="btn btn-ghost" title="Open Application Page"><i data-lucide="external-link"></i> <span>Application Page</span></a>
          </div>
        </div>

        <!-- Metric KPI Cards -->
        <div class="sellers-kpi-grid">
          <div class="sellers-kpi-card pending">
            <div class="sellers-kpi-label">Pending Review</div>
            <div class="sellers-kpi-value">${pendingApps.length}</div>
            <div class="sellers-kpi-hint">Awaiting admin approval</div>
          </div>

          <div class="sellers-kpi-card active">
            <div class="sellers-kpi-label">Active Sellers</div>
            <div class="sellers-kpi-value">${sellersList.length}</div>
            <div class="sellers-kpi-hint">Verified creator accounts</div>
          </div>

          <div class="sellers-kpi-card total">
            <div class="sellers-kpi-label">Total Applications</div>
            <div class="sellers-kpi-value">${applicationsList.length}</div>
            <div class="sellers-kpi-hint">Lifetime applicant requests</div>
          </div>
        </div>
      </section>

      <!-- Tab Navigation -->
      <div class="order-tabs-nav sellers-tabs-nav">
        <button type="button" class="order-tab-btn ${activeTab === 'pending' ? 'active' : ''}" data-action="set-sellers-tab" data-tab="pending">
          Pending Applications <span class="tab-pill pending">${pendingApps.length}</span>
        </button>
        <button type="button" class="order-tab-btn ${activeTab === 'active' ? 'active' : ''}" data-action="set-sellers-tab" data-tab="active">
          Verified Active Sellers <span class="tab-pill active">${sellersList.length}</span>
        </button>
        <button type="button" class="order-tab-btn ${activeTab === 'all' ? 'active' : ''}" data-action="set-sellers-tab" data-tab="all">
          All History <span class="tab-pill default">${applicationsList.length}</span>
        </button>
      </div>

      <!-- TAB CONTENT: PENDING -->
      ${activeTab === 'pending' ? `
        <div class="panel glass sellers-tab-panel">
          ${pendingApps.length === 0 ? `
            <div class="sellers-empty-state">
              <div class="sellers-empty-icon">🎉</div>
              <h3 class="sellers-empty-title">No Pending Applications</h3>
              <p class="sellers-empty-desc">All creator store applications have been reviewed and approved.</p>
            </div>
          ` : `
            <div class="sellers-pending-list">
              ${pendingApps.map(app => {
                const tgClean = String(app.telegram || '').replace('@', '').trim();
                const tgUrl = tgClean.startsWith('http') ? tgClean : `https://t.me/${tgClean}`;
                return `
                  <div class="sellers-app-card">
                    <div class="sellers-app-card-head">
                      <div>
                        <div class="sellers-app-store-row">
                          <h3 class="sellers-app-store-name">${escapeHtml(app.storeName || 'Creator Store')}</h3>
                          <span class="badge category-badge">${escapeHtml(app.category || 'General')}</span>
                        </div>
                        <div class="sellers-app-meta">
                          Applicant: <strong style="color: #fff;">${escapeHtml(app.applicantName || 'Partner')}</strong> &bull; 
                          Email: <span class="sellers-app-email">${escapeHtml(app.email || '')}</span> &bull; 
                          Applied: <span>${formatDateTime(app.createdAt)}</span>
                        </div>
                      </div>

                      <div class="sellers-app-actions">
                        ${(app.status === 'approved' || app.credentialsSent) ? `
                          <span class="badge badge-success sellers-credentials-sent">
                            <i data-lucide="check-circle" style="width: 14px; height: 14px;"></i> Credentials Sent (Approved)
                          </span>
                          <button class="btn btn-ghost" type="button" data-action="view-seller-profile" data-seller-id="${app.sellerId || app.id || ''}" data-store="${escapeHtml(app.storeName || '')}">
                            <i data-lucide="eye"></i> View Profile &amp; Packs
                          </button>
                        ` : `
                          <button class="btn btn-primary btn-approve" type="button" data-action="approve-seller" data-id="${app.id}" data-store="${escapeHtml(app.storeName)}" data-email="${escapeHtml(app.email)}">
                            <i data-lucide="check"></i> Approve &amp; Send Mail
                          </button>
                          <button class="btn btn-ghost danger btn-reject" type="button" data-action="reject-seller" data-id="${app.id}">
                            <i data-lucide="x"></i> Reject
                          </button>
                        `}
                        <button class="btn btn-ghost danger btn-delete" type="button" data-action="delete-seller-app" data-id="${app.id}" data-store="${escapeHtml(app.storeName)}" title="Permanently delete application">
                          <i data-lucide="trash-2"></i> Delete
                        </button>
                      </div>
                    </div>

                    <!-- Details Row -->
                    <div class="sellers-app-details-grid">
                      <div>
                        <span class="sellers-app-detail-lbl">Telegram/Contact:</span>
                        <a href="${tgUrl}" target="_blank" class="sellers-app-detail-link">
                          ${escapeHtml(app.telegram || 'None')} ↗
                        </a>
                      </div>
                      ${app.portfolioLink ? `
                        <div>
                          <span class="sellers-app-detail-lbl">Portfolio / Samples:</span>
                          <a href="${escapeHtml(app.portfolioLink)}" target="_blank" class="sellers-app-detail-link portfolio">
                            View Samples ↗
                          </a>
                        </div>
                      ` : ''}
                      ${app.reason ? `
                        <div class="sellers-app-reason-box">
                          <span class="sellers-app-detail-lbl">Statement:</span> "${escapeHtml(app.reason)}"
                        </div>
                      ` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>
      ` : ''}

      <!-- TAB CONTENT: ACTIVE SELLERS -->
      ${activeTab === 'active' ? `
        <div class="panel glass sellers-tab-panel">
          ${sellersList.length === 0 ? `
            <div class="sellers-empty-state">
              <div class="sellers-empty-icon">🏪</div>
              <h3 class="sellers-empty-title">No Active Sellers Yet</h3>
              <p class="sellers-empty-desc">Once you approve applications, verified sellers will appear here.</p>
            </div>
          ` : `
            <!-- 1. DESKTOP VIEW: WIDE STRUCTURED TABLE (Visible >= 861px) -->
            <div class="table-container sellers-desktop-table">
              <table class="data-table" style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.08); text-align: left; font-size: 12px; color: var(--muted);">
                    <th style="padding: 14px 18px; min-width: 160px;">Store &amp; Owner</th>
                    <th style="padding: 14px 18px; min-width: 220px;">Payout Destination</th>
                    <th style="padding: 14px 18px; min-width: 200px;">Email &amp; Contact</th>
                    <th style="padding: 14px 18px; min-width: 100px;">Category</th>
                    <th style="padding: 14px 18px; min-width: 90px; text-align: center;">Packs</th>
                    <th style="padding: 14px 18px; min-width: 90px;">Status</th>
                    <th style="padding: 14px 18px; min-width: 150px; white-space: nowrap;">Joined</th>
                    <th style="padding: 14px 18px; text-align: right; min-width: 200px; white-space: nowrap;">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${sellersList.map(s => {
                    const pInfo = formatSellerPayoutInfo(s);
                    return `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 13px;">
                      <td style="padding: 14px 18px; cursor: pointer;" data-action="view-seller-profile" data-seller-id="${s.id}" data-store="${escapeHtml(s.storeName || '')}">
                        <strong style="color: #fff; font-size: 14px; text-decoration: underline; text-underline-offset: 3px;">${escapeHtml(s.storeName || 'Store')}</strong>
                        <div style="font-size: 12px; color: var(--muted);">${escapeHtml(s.ownerName || '')}</div>
                      </td>
                      <td style="padding: 14px 18px;">
                        ${pInfo.hasPayout ? `
                          <div style="display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 4px 10px; font-size: 12px;">
                            <span style="font-weight: 700; color: ${pInfo.badgeColor};">${escapeHtml(pInfo.label.split(' ')[0])}</span>
                            <span style="font-family: monospace; color: #fff; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(pInfo.primaryCopyText)}">${escapeHtml(pInfo.primaryCopyText)}</span>
                            <button class="btn btn-ghost icon-only" style="padding: 2px 4px; height: auto;" type="button" data-action="copy-payout" data-payout-text="${escapeHtml(pInfo.primaryCopyText)}" data-payout-label="${escapeHtml(pInfo.label)}" title="Copy payout destination"><i data-lucide="copy" style="width: 12px; height: 12px;"></i></button>
                          </div>
                        ` : `
                          <span class="badge" style="background: rgba(245, 158, 11, 0.1); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.25); font-size: 11px;">Not Configured</span>
                        `}
                      </td>
                      <td style="padding: 14px 18px;">
                        <div style="color: #93c5fd; font-family: monospace;">${escapeHtml(s.email || '')}</div>
                        <div style="font-size: 12px; color: var(--muted);">${escapeHtml(s.telegram || '')}</div>
                      </td>
                      <td style="padding: 14px 18px;">
                        <span class="badge" style="background: rgba(255,255,255,0.06); font-size: 11px;">${escapeHtml(s.category || 'General')}</span>
                      </td>
                      <td style="padding: 14px 18px; text-align: center;">
                        <span style="font-weight: 700; color: #fff;">${s.productCount}</span> <span style="font-size: 11px; color: var(--muted);">packs</span>
                      </td>
                      <td style="padding: 14px 18px;">
                        <span class="badge success" style="background: rgba(16, 185, 129, 0.15); color: #34d399; font-size: 11px;">Active</span>
                      </td>
                      <td style="padding: 14px 18px; color: var(--muted); white-space: nowrap;">
                        ${formatDateTime(s.createdAt)}
                      </td>
                      <td style="padding: 14px 18px; text-align: right; white-space: nowrap;">
                        <div style="display: inline-flex; gap: 8px; align-items: center; justify-content: flex-end;">
                          <button class="btn btn-primary btn-sm" type="button" data-action="view-seller-profile" data-seller-id="${s.id}" data-store="${escapeHtml(s.storeName || '')}" title="View seller profile and all published packs">
                            <i data-lucide="eye"></i> <span>View Profile &amp; Packs</span>
                          </button>
                          <button class="btn btn-ghost danger btn-sm" type="button" data-action="delete-seller" data-seller-id="${s.id}" data-store="${escapeHtml(s.storeName)}" title="Delete seller account">
                            <i data-lucide="trash-2"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>

            <!-- 2. MOBILE VIEW: ULTRA-POLISHED SELLER CARDS (Visible <= 860px) -->
            <div class="sellers-mobile-cards">
              ${sellersList.map(s => {
                const pInfo = formatSellerPayoutInfo(s);
                const tgClean = String(s.telegram || '').replace('@', '').trim();
                const tgUrl = tgClean.startsWith('http') ? tgClean : (tgClean ? `https://t.me/${tgClean}` : '');
                return `
                  <div class="seller-mobile-card">
                    
                    <!-- Card Top Header -->
                    <div class="seller-mobile-card-head">
                      <div style="flex: 1; min-width: 0;">
                        <h3 class="seller-mobile-store-title" data-action="view-seller-profile" data-seller-id="${s.id}" data-store="${escapeHtml(s.storeName || '')}">
                          <span>${escapeHtml(s.storeName || 'Store')}</span>
                          <i data-lucide="chevron-right" style="width: 15px; height: 15px; color: #94a3b8; flex-shrink: 0;"></i>
                        </h3>
                        <div class="seller-mobile-owner">${escapeHtml(s.ownerName || 'Partner')}</div>
                      </div>
                      <div class="seller-mobile-badges">
                        <span class="badge" style="background: rgba(255,255,255,0.06); font-size: 11px;">${escapeHtml(s.category || 'General')}</span>
                        <span class="badge success" style="background: rgba(16, 185, 129, 0.15); color: #34d399; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">
                          <span style="width: 6px; height: 6px; border-radius: 50%; background: #34d399;"></span> Active
                        </span>
                      </div>
                    </div>

                    <!-- Featured Payout Destination Box -->
                    <div class="seller-mobile-payout-box ${pInfo.hasPayout ? 'active' : 'empty'}">
                      <div class="seller-mobile-payout-left">
                        <span class="seller-mobile-payout-label">
                          <i data-lucide="wallet-cards" style="width: 12px; height: 12px; color: ${pInfo.badgeColor};"></i>
                          <span>Payout: <strong style="color: ${pInfo.badgeColor};">${escapeHtml(pInfo.label)}</strong></span>
                        </span>
                        <span class="seller-mobile-payout-val" title="${escapeHtml(pInfo.primaryCopyText || 'Not configured')}">
                          ${escapeHtml(pInfo.primaryCopyText || '⚠️ Destination Not Configured')}
                        </span>
                      </div>
                      ${pInfo.hasPayout ? `
                        <button class="seller-mobile-payout-copy-btn" type="button" data-action="copy-payout" data-payout-text="${escapeHtml(pInfo.primaryCopyText)}" data-payout-label="${escapeHtml(pInfo.label)}" title="Copy payout destination">
                          <i data-lucide="copy" style="width: 12px; height: 12px;"></i> <span>Copy</span>
                        </button>
                      ` : ''}
                    </div>

                    <!-- 2-Column Info & Contact Grid -->
                    <div class="seller-mobile-info-grid">
                      <div class="seller-mobile-info-item">
                        <span class="seller-mobile-info-lbl">Email Address</span>
                        <span class="seller-mobile-info-val">
                          ${s.email ? `<a href="mailto:${escapeHtml(s.email)}">${escapeHtml(s.email)}</a>` : '<span style="color: #64748b;">None</span>'}
                        </span>
                      </div>
                      <div class="seller-mobile-info-item">
                        <span class="seller-mobile-info-lbl">Telegram Contact</span>
                        <span class="seller-mobile-info-val">
                          ${tgUrl ? `<a href="${tgUrl}" target="_blank">${escapeHtml(s.telegram)} ↗</a>` : `<span style="color: #64748b;">${escapeHtml(s.telegram || 'None')}</span>`}
                        </span>
                      </div>
                      <div class="seller-mobile-info-item">
                        <span class="seller-mobile-info-lbl">Catalog Packs</span>
                        <span class="seller-mobile-info-val" style="color: #38bdf8; font-weight: 700;">
                          📦 ${s.productCount} Published Packs
                        </span>
                      </div>
                      <div class="seller-mobile-info-item">
                        <span class="seller-mobile-info-lbl">Joined Date</span>
                        <span class="seller-mobile-info-val" style="color: #94a3b8;">
                          ${formatDateTime(s.createdAt)}
                        </span>
                      </div>
                    </div>

                    <!-- Mobile Card Bottom Actions -->
                    <div class="seller-mobile-card-footer">
                      <button class="btn btn-primary seller-mobile-view-btn" type="button" data-action="view-seller-profile" data-seller-id="${s.id}" data-store="${escapeHtml(s.storeName || '')}" title="View seller profile and all published packs">
                        <i data-lucide="eye" style="width: 16px; height: 16px;"></i> <span>View Profile &amp; Packs (${s.productCount})</span>
                      </button>
                      <button class="btn btn-ghost danger seller-mobile-del-btn" type="button" data-action="delete-seller" data-seller-id="${s.id}" data-store="${escapeHtml(s.storeName)}" title="Delete seller account">
                        <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                      </button>
                    </div>

                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>
      ` : ''}

      <!-- TAB CONTENT: ALL HISTORY -->
      ${activeTab === 'all' ? `
        <div class="panel glass sellers-tab-panel">
          
          <!-- Desktop Table (Visible >= 861px) -->
          <div class="table-container sellers-desktop-table">
            <table class="data-table" style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.08); text-align: left; font-size: 12px; color: var(--muted);">
                  <th style="padding: 14px 18px; min-width: 160px;">Store Name</th>
                  <th style="padding: 14px 18px; min-width: 150px;">Applicant</th>
                  <th style="padding: 14px 18px; min-width: 200px;">Email</th>
                  <th style="padding: 14px 18px; min-width: 100px;">Status</th>
                  <th style="padding: 14px 18px; min-width: 150px; white-space: nowrap;">Date</th>
                  <th style="padding: 14px 18px; text-align: right; min-width: 100px;">Action</th>
                </tr>
              </thead>
              <tbody>
                ${applicationsList.map(a => `
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 13px;">
                    <td style="padding: 14px 18px; font-weight: 700; color: #fff;">${escapeHtml(a.storeName || 'Store')}</td>
                    <td style="padding: 14px 18px;">${escapeHtml(a.applicantName || '')}</td>
                    <td style="padding: 14px 18px; font-family: monospace; color: #93c5fd;">${escapeHtml(a.email || '')}</td>
                    <td style="padding: 14px 18px;">
                      ${a.status === 'approved' ? '<span class="badge success">Approved</span>' : a.status === 'rejected' ? '<span class="badge danger">Rejected</span>' : '<span class="badge warning">Pending</span>'}
                    </td>
                    <td style="padding: 14px 18px; color: var(--muted); white-space: nowrap;">${formatDateTime(a.createdAt)}</td>
                    <td style="padding: 14px 18px; text-align: right;">
                      <button class="icon-btn danger" type="button" data-action="delete-seller-app" data-id="${a.id}" data-store="${escapeHtml(a.storeName)}" title="Permanently delete application record">
                        <i data-lucide="trash-2"></i> Delete
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <!-- Mobile History Cards (Visible <= 860px) -->
          <div class="sellers-mobile-cards">
            ${applicationsList.map(a => `
              <div class="seller-mobile-card" style="gap: 10px;">
                <div class="seller-mobile-card-head">
                  <div>
                    <h3 class="seller-mobile-store-title" style="cursor: default;">${escapeHtml(a.storeName || 'Store')}</h3>
                    <div class="seller-mobile-owner">${escapeHtml(a.applicantName || 'Applicant')} &bull; <span style="font-family: monospace; color: #93c5fd;">${escapeHtml(a.email || '')}</span></div>
                  </div>
                  <div>
                    ${a.status === 'approved' ? '<span class="badge success">Approved</span>' : a.status === 'rejected' ? '<span class="badge danger">Rejected</span>' : '<span class="badge warning">Pending</span>'}
                  </div>
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--muted); padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.04);">
                  <span>Applied: ${formatDateTime(a.createdAt)}</span>
                  <button class="btn btn-ghost danger btn-sm" type="button" data-action="delete-seller-app" data-id="${a.id}" data-store="${escapeHtml(a.storeName)}" title="Delete application record">
                    <i data-lucide="trash-2"></i> Delete
                  </button>
                </div>
              </div>
            `).join('')}
          </div>

        </div>
      ` : ''}

    </div>
  `;
}

function renderReviewsManagementView(reviewsData = {}, fullData = {}) {
  const productsMap = fullData.products || {};
  const allReviews = listAllReviews(reviewsData, productsMap);
  const activeTab = ui.reviews?.status || 'all';
  const searchTerm = (ui.reviews?.search || '').toLowerCase().trim();

  const totalCount = allReviews.length;
  const pendingCount = allReviews.filter((r) => r.status !== 'approved').length;
  const approvedCount = allReviews.filter((r) => r.status === 'approved').length;
  const approvedItems = allReviews.filter((r) => r.status === 'approved');
  const avgRating = approvedItems.length > 0 
    ? (approvedItems.reduce((acc, r) => acc + (Number(r.rating) || 5), 0) / approvedItems.length).toFixed(1)
    : '5.0';

  let filtered = allReviews;
  if (activeTab === 'pending') {
    filtered = filtered.filter((r) => r.status !== 'approved');
  } else if (activeTab === 'approved') {
    filtered = filtered.filter((r) => r.status === 'approved');
  }

  if (searchTerm) {
    filtered = filtered.filter((r) => 
      (r.name && String(r.name).toLowerCase().includes(searchTerm)) ||
      (r.comment && String(r.comment).toLowerCase().includes(searchTerm)) ||
      (r.headline && String(r.headline).toLowerCase().includes(searchTerm)) ||
      (r.productName && String(r.productName).toLowerCase().includes(searchTerm))
    );
  }

  return `
    <div class="page active management-page-shell" style="max-width: 1240px; margin: 0 auto; padding-bottom: 60px;">
      
      <!-- Top Control Header -->
      <section class="panel glass" style="padding: 24px 28px; border-radius: 16px; margin-bottom: 24px; border: 1px solid var(--border);">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px;">
          <div>
            <div style="font-size: 11px; font-weight: 700; color: #f59e0b; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">Store Reviews Moderation</div>
            <h2 style="margin: 0; font-size: 24px; font-weight: 800; color: var(--text);">Customer Reviews & Ratings</h2>
            <p style="margin: 4px 0 0 0; color: var(--muted); font-size: 13px;">Moderate buyer feedback, approve authentic 5-star ratings, and eliminate spam before it shows on product pages.</p>
          </div>
          <div class="toolbar" style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <button class="btn btn-ghost" type="button" data-action="goto" data-route="catalog"><i data-lucide="package"></i> Product Catalog</button>
          </div>
        </div>

        <!-- Metric KPI Cards -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.06);">
          
          <div style="background: rgba(99, 102, 241, 0.06); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 14px; padding: 16px 18px;">
            <div style="font-size: 11px; font-weight: 700; color: #818cf8; text-transform: uppercase; letter-spacing: 0.05em;">Total Feedback</div>
            <div style="font-size: 26px; font-weight: 800; color: #fff; margin-top: 4px;">${totalCount}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">All submitted reviews</div>
          </div>

          <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 14px; padding: 16px 18px;">
            <div style="font-size: 11px; font-weight: 700; color: #f59e0b; text-transform: uppercase; letter-spacing: 0.05em;">Pending Approval</div>
            <div style="font-size: 26px; font-weight: 800; color: #fbbf24; margin-top: 4px;">${pendingCount}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">Requires moderation</div>
          </div>

          <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 14px; padding: 16px 18px;">
            <div style="font-size: 11px; font-weight: 700; color: #10b981; text-transform: uppercase; letter-spacing: 0.05em;">Live Approved</div>
            <div style="font-size: 26px; font-weight: 800; color: #34d399; margin-top: 4px;">${approvedCount}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">Visible on storefront</div>
          </div>

          <div style="background: rgba(234, 179, 8, 0.08); border: 1px solid rgba(234, 179, 8, 0.25); border-radius: 14px; padding: 16px 18px;">
            <div style="font-size: 11px; font-weight: 700; color: #eab308; text-transform: uppercase; letter-spacing: 0.05em;">Store Rating Avg</div>
            <div style="font-size: 26px; font-weight: 800; color: #fde047; margin-top: 4px;">★ ${avgRating}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">Across approved reviews</div>
          </div>

        </div>
      </section>

      <!-- Filter Controls & Search -->
      <section class="panel glass" style="padding: 16px 20px; border-radius: 16px; margin-bottom: 20px; border: 1px solid var(--border);">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px;">
          
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <button class="btn ${activeTab === 'all' ? 'btn-primary' : 'btn-ghost'}" type="button" data-action="filter-reviews-status" data-status="all">
              All (${totalCount})
            </button>
            <button class="btn ${activeTab === 'pending' ? 'btn-primary' : 'btn-ghost'}" type="button" data-action="filter-reviews-status" data-status="pending" style="${pendingCount > 0 ? 'border: 1px solid #f59e0b; color: #fbbf24;' : ''}">
              <i data-lucide="clock"></i> Pending (${pendingCount})
            </button>
            <button class="btn ${activeTab === 'approved' ? 'btn-primary' : 'btn-ghost'}" type="button" data-action="filter-reviews-status" data-status="approved">
              <i data-lucide="check-circle"></i> Approved (${approvedCount})
            </button>
          </div>

          <div style="display: flex; gap: 10px; align-items: center; flex: 1; max-width: 380px; min-width: 220px;">
            <div class="searchbox" style="width: 100%;">
              <i data-lucide="search"></i>
              <input id="reviewsSearchInput" type="search" placeholder="Search customer or comment..." value="${escapeHtml(ui.reviews?.search || '')}" />
            </div>
          </div>

        </div>
      </section>

      <!-- Reviews Feed -->
      ${filtered.length === 0 ? `
        <div class="panel glass" style="padding: 48px 24px; text-align: center; border-radius: 16px; border: 1px dashed rgba(255,255,255,0.15);">
          <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(245, 158, 11, 0.1); color: #f59e0b; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 14px;">
            <i data-lucide="message-square-dashed" style="width: 28px; height: 28px;"></i>
          </div>
          <h3 style="margin: 0 0 6px 0; font-size: 18px; color: var(--text);">No reviews found</h3>
          <p style="margin: 0; font-size: 13px; color: var(--muted);">
            ${activeTab === 'pending' ? 'No customer reviews currently pending moderation. All clear!' : 'No customer reviews match your filter or search query.'}
          </p>
        </div>
      ` : `
        <div style="display: flex; flex-direction: column; gap: 16px;">
          ${filtered.map((r) => {
            const stars = Math.min(5, Math.max(1, Number(r.rating) || 5));
            const starIcons = '★'.repeat(stars) + '☆'.repeat(5 - stars);
            const isApproved = r.status === 'approved';
            const dateStr = r.createdAt ? formatRelativeTime(r.createdAt) : 'Recently';

            return `
              <div class="panel glass" style="padding: 20px 24px; border-radius: 16px; border: 1px solid ${isApproved ? 'rgba(16, 185, 129, 0.25)' : 'rgba(245, 158, 11, 0.35)'}; background: ${isApproved ? 'rgba(16, 185, 129, 0.02)' : 'rgba(245, 158, 11, 0.03)'}; display: flex; flex-direction: column; gap: 14px;">
                
                <div style="display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
                  <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <span style="font-size: 15px; color: #fbbf24; letter-spacing: 2px; font-weight: 700;">${starIcons}</span>
                    <span style="background: rgba(251, 191, 36, 0.15); color: #fbbf24; font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 6px;">${stars}.0</span>
                    <span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.3); font-size: 11px;">
                      📦 ${escapeHtml(r.productName)}
                    </span>
                    ${isApproved ? `
                      <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 11px;">
                        ✓ Approved & Live
                      </span>
                    ` : `
                      <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 11px;">
                        ⏳ Pending Moderation
                      </span>
                    `}
                  </div>
                  <div style="font-size: 12px; color: var(--muted);">${escapeHtml(dateStr)}</div>
                </div>

                <div>
                  ${r.headline ? `<h4 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 700; color: var(--text);">${escapeHtml(r.headline)}</h4>` : ''}
                  <p style="margin: 0; font-size: 14px; line-height: 1.6; color: rgba(255,255,255,0.85);">${escapeHtml(r.comment || '(No written comment)')}</p>
                </div>

                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.06);">
                  <div style="font-size: 13px; color: var(--muted); display: flex; align-items: center; gap: 6px;">
                    <strong style="color: var(--text);">${escapeHtml(r.name || 'Customer')}</strong>
                    ${r.verified !== false ? '<span style="color: #10b981; font-size: 11px;">✓ Verified Buyer</span>' : ''}
                  </div>

                  <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    ${!isApproved ? `
                      <button class="btn btn-primary btn-sm" type="button" data-action="approve-review" data-product-id="${escapeHtml(r.productId)}" data-id="${escapeHtml(r.id)}" style="background: #10b981; border-color: #10b981;">
                        <i data-lucide="check"></i> Approve & Publish
                      </button>
                    ` : `
                      <button class="btn btn-ghost btn-sm" type="button" data-action="unapprove-review" data-product-id="${escapeHtml(r.productId)}" data-id="${escapeHtml(r.id)}">
                        <i data-lucide="clock"></i> Mark Pending
                      </button>
                    `}
                    <button class="btn btn-danger btn-sm" type="button" data-action="delete-review" data-product-id="${escapeHtml(r.productId)}" data-id="${escapeHtml(r.id)}">
                      <i data-lucide="trash-2"></i> Delete
                    </button>
                    <button class="btn btn-ghost btn-sm" type="button" data-action="sync-product-rating" data-product-id="${escapeHtml(r.productId)}" title="Sync this product card's rating to ${stars}.0">
                      <i data-lucide="refresh-cw"></i> Sync to Card
                    </button>
                  </div>
                </div>

              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

function renderReportsManagementView(reportsRaw = {}, data = {}) {
  const reportsList = Object.entries(reportsRaw || {}).map(([id, r]) => ({
    ...(r || {}),
    id: r?.id || id,
  }));

  reportsList.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

  const totalCount = reportsList.length;
  const pendingCount = reportsList.filter(r => (r.status || 'pending') === 'pending').length;
  const resolvedCount = reportsList.filter(r => r.status === 'resolved').length;
  const dismissedCount = reportsList.filter(r => r.status === 'dismissed').length;

  const activeTab = ui.reports?.status || 'all';
  const searchQuery = String(ui.reports?.search || '').toLowerCase().trim();

  let filtered = reportsList;
  if (activeTab !== 'all') {
    filtered = filtered.filter(r => (r.status || 'pending') === activeTab);
  }
  if (searchQuery) {
    filtered = filtered.filter(r => 
      String(r.targetName || '').toLowerCase().includes(searchQuery) ||
      String(r.targetId || '').toLowerCase().includes(searchQuery) ||
      String(r.reporterName || '').toLowerCase().includes(searchQuery) ||
      String(r.reporterEmail || '').toLowerCase().includes(searchQuery) ||
      String(r.reason || '').toLowerCase().includes(searchQuery) ||
      String(r.details || '').toLowerCase().includes(searchQuery)
    );
  }

  return `
    <div class="page active">
      <div style="margin-bottom: 24px;">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px;">
          <div>
            <h1 class="page-title" style="margin: 0; display: flex; align-items: center; gap: 10px;">
              <i data-lucide="flag" style="color: #ef4444;"></i> Reports & Moderation
            </h1>
            <p class="section-subtitle" style="margin-top: 4px;">
              Real-time user reports on products, broken links, copyright, and creator violations.
            </p>
          </div>
          <div style="display: flex; gap: 10px;">
            <button class="btn btn-ghost" type="button" data-action="refresh-reports">
              <i data-lucide="refresh-cw"></i> Refresh
            </button>
          </div>
        </div>
      </div>

      <!-- KPI Summary Cards -->
      <section class="panel glass" style="padding: 20px; border-radius: 16px; margin-bottom: 20px;">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
          
          <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 14px; padding: 16px 18px;">
            <div style="font-size: 11px; font-weight: 700; color: #f87171; text-transform: uppercase; letter-spacing: 0.05em;">Pending Attention</div>
            <div style="font-size: 26px; font-weight: 800; color: #fca5a5; margin-top: 4px;">${pendingCount}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">Require admin review</div>
          </div>

          <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 14px; padding: 16px 18px;">
            <div style="font-size: 11px; font-weight: 700; color: #10b981; text-transform: uppercase; letter-spacing: 0.05em;">Resolved Reports</div>
            <div style="font-size: 26px; font-weight: 800; color: #34d399; margin-top: 4px;">${resolvedCount}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">Investigated & fixed</div>
          </div>

          <div style="background: rgba(148, 163, 184, 0.08); border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 14px; padding: 16px 18px;">
            <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">Dismissed</div>
            <div style="font-size: 26px; font-weight: 800; color: #cbd5e1; margin-top: 4px;">${dismissedCount}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">No violation found</div>
          </div>

          <div style="background: rgba(255, 42, 141, 0.08); border: 1px solid rgba(255, 42, 141, 0.25); border-radius: 14px; padding: 16px 18px;">
            <div style="font-size: 11px; font-weight: 700; color: var(--primary-pink, #ff2a8d); text-transform: uppercase; letter-spacing: 0.05em;">Total Reports</div>
            <div style="font-size: 26px; font-weight: 800; color: #f472b6; margin-top: 4px;">${totalCount}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">All-time submissions</div>
          </div>

        </div>
      </section>

      <!-- Filter Controls & Search -->
      <section class="panel glass" style="padding: 16px 20px; border-radius: 16px; margin-bottom: 20px; border: 1px solid var(--border);">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px;">
          
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <button class="btn ${activeTab === 'all' ? 'btn-primary' : 'btn-ghost'}" type="button" data-action="filter-reports-status" data-status="all">
              All (${totalCount})
            </button>
            <button class="btn ${activeTab === 'pending' ? 'btn-primary' : 'btn-ghost'}" type="button" data-action="filter-reports-status" data-status="pending" style="${pendingCount > 0 ? 'border: 1px solid #ef4444; color: #fca5a5;' : ''}">
              <i data-lucide="clock"></i> Pending (${pendingCount})
            </button>
            <button class="btn ${activeTab === 'resolved' ? 'btn-primary' : 'btn-ghost'}" type="button" data-action="filter-reports-status" data-status="resolved">
              <i data-lucide="check-circle"></i> Resolved (${resolvedCount})
            </button>
            <button class="btn ${activeTab === 'dismissed' ? 'btn-primary' : 'btn-ghost'}" type="button" data-action="filter-reports-status" data-status="dismissed">
              <i data-lucide="x-circle"></i> Dismissed (${dismissedCount})
            </button>
          </div>

          <div style="display: flex; gap: 10px; align-items: center; flex: 1; max-width: 380px; min-width: 220px;">
            <div class="searchbox" style="width: 100%;">
              <i data-lucide="search"></i>
              <input id="reportsSearchInput" type="search" placeholder="Search target, reporter, or reason..." value="${escapeHtml(ui.reports?.search || '')}" />
            </div>
          </div>

        </div>
      </section>

      <!-- Reports Feed -->
      ${filtered.length === 0 ? `
        <div class="panel glass" style="padding: 48px 24px; text-align: center; border-radius: 16px; border: 1px dashed rgba(255,255,255,0.15);">
          <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(16, 185, 129, 0.1); color: #10b981; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 14px;">
            <i data-lucide="shield-check" style="width: 28px; height: 28px;"></i>
          </div>
          <h3 style="margin: 0 0 6px 0; font-size: 18px; color: var(--text);">No reports found</h3>
          <p style="margin: 0; font-size: 13px; color: var(--muted);">
            ${activeTab === 'pending' ? 'No user reports currently pending review. Storefront is clean!' : 'No reports match your selected filter or search term.'}
          </p>
        </div>
      ` : `
        <div style="display: flex; flex-direction: column; gap: 16px;">
          ${filtered.map((r) => {
            const isPending = (r.status || 'pending') === 'pending';
            const isResolved = r.status === 'resolved';
            const isDismissed = r.status === 'dismissed';
            const dateStr = r.createdAt ? formatRelativeTime(r.createdAt) : 'Recently';
            const fullDate = r.createdAt ? new Date(r.createdAt).toLocaleString('en-IN') : '';
            const isSeller = r.targetType === 'seller';

            return `
              <div class="panel glass" style="padding: 20px 24px; border-radius: 16px; border: 1px solid ${isPending ? 'rgba(239, 68, 68, 0.35)' : isResolved ? 'rgba(16, 185, 129, 0.25)' : 'rgba(148, 163, 184, 0.2)'}; background: ${isPending ? 'rgba(239, 68, 68, 0.03)' : 'rgba(255, 255, 255, 0.01)'}; display: flex; flex-direction: column; gap: 14px;">
                
                <div style="display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
                  <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <span class="badge" style="background: ${isSeller ? 'rgba(168, 85, 247, 0.15)' : 'rgba(59, 130, 246, 0.15)'}; color: ${isSeller ? '#c084fc' : '#60a5fa'}; border: 1px solid ${isSeller ? 'rgba(168, 85, 247, 0.3)' : 'rgba(59, 130, 246, 0.3)'}; font-size: 11px; font-weight: 700; text-transform: uppercase;">
                      ${isSeller ? '🏪 SELLER' : '📦 PRODUCT'}
                    </span>
                    <strong style="font-size: 15px; color: var(--text);">${escapeHtml(r.targetName || 'Untitled Item')}</strong>
                    ${r.targetId ? `<code style="font-size: 11px; color: var(--muted); background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px;">ID: ${escapeHtml(r.targetId)}</code>` : ''}
                    
                    ${isPending ? `
                      <span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 11px;">
                        ⏳ Pending Review
                      </span>
                    ` : isResolved ? `
                      <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 11px;">
                        ✓ Resolved
                      </span>
                    ` : `
                      <span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.3); font-size: 11px;">
                        ✖ Dismissed
                      </span>
                    `}
                  </div>
                  <div style="font-size: 12px; color: var(--muted);" title="${escapeHtml(fullDate)}">${escapeHtml(dateStr)}</div>
                </div>

                <div style="background: rgba(0,0,0,0.25); border-radius: 12px; padding: 14px 18px; border: 1px solid rgba(255,255,255,0.05);">
                  <div style="font-size: 13px; font-weight: 700; color: #fbbf24; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                    <i data-lucide="alert-triangle" style="width: 14px; height: 14px;"></i> Reason: ${escapeHtml(r.reason || 'Not specified')}
                  </div>
                  <p style="margin: 0; font-size: 13.5px; line-height: 1.6; color: rgba(255,255,255,0.9);">${escapeHtml(r.details || '(No written description provided by reporter)')}</p>
                </div>

                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.06);">
                  <div style="font-size: 12.5px; color: var(--muted); display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span>Reported by: <strong style="color: var(--text);">${escapeHtml(r.reporterName || 'Anonymous')}</strong></span>
                    ${r.reporterEmail && r.reporterEmail !== 'N/A' ? `<span>• <a href="mailto:${escapeHtml(r.reporterEmail)}" style="color: var(--primary); text-decoration: none;">${escapeHtml(r.reporterEmail)}</a></span>` : ''}
                    ${r.reporterIp ? `<span style="font-size: 11px; opacity: 0.6;">(IP: ${escapeHtml(r.reporterIp)})</span>` : ''}
                  </div>

                  <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    ${isPending ? `
                      <button class="btn btn-primary btn-sm" type="button" data-action="resolve-report" data-id="${escapeHtml(r.id)}" style="background: #10b981; border-color: #10b981;">
                        <i data-lucide="check"></i> Mark Resolved
                      </button>
                      <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-report" data-id="${escapeHtml(r.id)}">
                        <i data-lucide="x"></i> Dismiss
                      </button>
                    ` : `
                      <button class="btn btn-ghost btn-sm" type="button" data-action="reopen-report" data-id="${escapeHtml(r.id)}">
                        <i data-lucide="rotate-ccw"></i> Reopen
                      </button>
                    `}
                    <button class="btn btn-danger btn-sm" type="button" data-action="delete-report" data-id="${escapeHtml(r.id)}">
                      <i data-lucide="trash-2"></i> Delete
                    </button>
                  </div>
                </div>

              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

const MEDIA_FOLDER_FILTERS = [
  { value: 'all', label: 'All Folders' },
  { value: 'products', label: 'Products' },
  { value: 'categories', label: 'Categories' },
  { value: 'hero', label: 'Hero' },
  { value: 'banner', label: 'Banner' },
  { value: 'logos', label: 'Logos' },
  { value: 'other', label: 'Other' },
];

const MEDIA_TYPE_FILTERS = [
  { value: 'all', label: 'All Types' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'other', label: 'Other' },
];

const MEDIA_SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'oldest', label: 'Oldest First' },
  { value: 'name-asc', label: 'Name A-Z' },
  { value: 'name-desc', label: 'Name Z-A' },
];

const MEDIA_LIFECYCLE_TABS = [
  { value: 'active', label: 'All Active', icon: 'layers' },
  { value: 'in-use', label: 'In-Use / Assigned', icon: 'package-check' },
  { value: 'unused', label: 'Unassigned', icon: 'help-circle' },
  { value: 'deleted', label: 'Trash / Deleted', icon: 'trash-2', isTrash: true },
];

function mediaBucketKey(item = {}) {
  const raw = String(item.folder || item.path || '').toLowerCase();
  if (raw.includes('product')) return 'products';
  if (raw.includes('category')) return 'categories';
  if (raw.includes('hero')) return 'hero';
  if (raw.includes('banner')) return 'banner';
  if (raw.includes('logo')) return 'logos';
  return 'other';
}

function mediaBucketLabel(key) {
  return MEDIA_FOLDER_FILTERS.find((item) => item.value === key)?.label || 'Other';
}

function mediaKind(item = {}) {
  if (item.type === 'video' || /\.(mp4|webm|mov|m4v|ogg)$/i.test(item.path || item.publicUrl || item.name || '')) return 'video';
  return mediaTypeFromPath(item.path || item.publicUrl || item.name || '') || 'image';
}

function mediaSortValue(item = {}) {
  return Number(item.deletedAt || item.updatedAt || item.createdAt || 0);
}

let _unifiedMediaCache = null;
let _unifiedMediaCacheRef = null;

function getAllUnifiedMediaItems(data = {}) {
  const currentData = data || ui.data || {};
  if (_unifiedMediaCache && _unifiedMediaCacheRef === currentData) {
    return _unifiedMediaCache;
  }

  const mediaMap = new Map();

  // 1. Scan explicit records from 'media' node in Firebase
  const explicitMedia = listCollection('media');
  for (const item of explicitMedia) {
    const key = normalizeAssetValue(item.publicUrl || item.path || item.sourcePath || item.id);
    if (key) {
      mediaMap.set(key, {
        ...item,
        id: item.id || slugify(key),
        publicUrl: item.publicUrl || item.path,
        path: item.path || item.publicUrl,
        name: item.name || mediaFileName(item.publicUrl || item.path),
        folder: item.folder || 'images',
        type: item.type || mediaKind(item),
        status: item.status === 'deleted' ? 'deleted' : 'active',
        deletedAt: item.deletedAt || null,
        usedIn: item.linkedName ? [item.linkedName] : [],
        createdAt: item.createdAt || Date.now(),
        updatedAt: item.updatedAt || Date.now(),
      });
    }
  }

  // Helper to record asset usage and add missing assets from store catalog
  function recordAssetUsage(rawUrl, label, folderFallback = 'products') {
    const urls = extractMediaUrls(rawUrl);
    for (const url of urls) {
      const key = normalizeAssetValue(url);
      if (!key) continue;

      const isVid = /\.(mp4|webm|mov|m4v|ogg)$/i.test(url);

      if (mediaMap.has(key)) {
        const existing = mediaMap.get(key);
        if (label && !existing.usedIn.includes(label)) {
          existing.usedIn.push(label);
        }
        if (!existing.folder || existing.folder === 'all') {
          existing.folder = folderFallback;
        }
        if (existing.status === 'deleted') {
          existing.status = 'active';
          existing.deletedAt = null;
        }
      } else {
        const id = slugify(key) || uid('media');
        mediaMap.set(key, {
          id,
          name: mediaFileName(url),
          folder: folderFallback,
          type: isVid ? 'video' : 'image',
          path: url,
          publicUrl: resolveMediaSource(url) || url,
          sourcePath: url,
          source: 'catalog-sync',
          status: 'active',
          deletedAt: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          usedIn: label ? [label] : [],
        });
      }
    }
  }

  // 2. Scan All Products
  const products = listCollection('products').filter((p) => p.status !== 'deleted');
  for (const p of products) {
    const pName = p.name || p.title || `Product #${p.id}`;
    recordAssetUsage(p.image, pName, 'products');
    recordAssetUsage(p.photo, pName, 'products');
    recordAssetUsage(p.thumbnail, pName, 'products');
    recordAssetUsage(p.cover, pName, 'products');
    recordAssetUsage(p.coverImage, pName, 'products');
    recordAssetUsage(p.path, pName, 'products');
    recordAssetUsage(p.images, pName, 'products');
    recordAssetUsage(p.galleryImages, pName, 'products');
    recordAssetUsage(p.pics, pName, 'products');
    recordAssetUsage(p.photos, pName, 'products');
    recordAssetUsage(p.video, pName, 'products');
    recordAssetUsage(p.videos, pName, 'products');
    recordAssetUsage(p.videoUrl, pName, 'products');
  }

  // 3. Scan All Categories
  const categories = listCollection('categories').filter((c) => c.status !== 'deleted');
  for (const c of categories) {
    const cName = c.name || c.title || `Category #${c.id}`;
    recordAssetUsage(c.image, cName, 'categories');
    recordAssetUsage(c.imageUrl, cName, 'categories');
    recordAssetUsage(c.icon, cName, 'categories');
    recordAssetUsage(c.thumbnail, cName, 'categories');
    recordAssetUsage(c.photo, cName, 'categories');
    recordAssetUsage(c.images, cName, 'categories');
    recordAssetUsage(c.galleryImages, cName, 'categories');
    recordAssetUsage(c.video, cName, 'categories');
    recordAssetUsage(c.videos, cName, 'categories');
  }

  // 4. Scan Hero Section
  const hero = data.hero || ui.data?.hero || {};
  recordAssetUsage(hero.backgroundImage, 'Homepage Hero', 'hero');
  recordAssetUsage(hero.image, 'Homepage Hero', 'hero');
  recordAssetUsage(hero.video, 'Homepage Hero', 'hero');

  // 5. Scan Banner Section
  const banner = data.banner || ui.data?.banner || {};
  recordAssetUsage(banner.image, banner.title ? `Banner: ${banner.title}` : 'Homepage Pinned Deal', 'banners');
  recordAssetUsage(banner.mobileImage, banner.title ? `Banner (Mobile): ${banner.title}` : 'Homepage Deal Mobile', 'banners');
  recordAssetUsage(banner.video, banner.title ? `Banner Video: ${banner.title}` : 'Homepage Deal Video', 'banners');

  // 6. Scan Settings (Logo & Favicon)
  const settings = data.settings || ui.data?.settings || {};
  recordAssetUsage(settings.logo, 'Store Logo', 'logos');
  recordAssetUsage(settings.darkLogo, 'Store Dark Logo', 'logos');
  recordAssetUsage(settings.favicon, 'Store Favicon', 'logos');

  // 7. Scan Payment
  const payment = data.payment || ui.data?.payment || {};
  recordAssetUsage(payment.qrImage, 'Payment QR Code', 'payments');
  recordAssetUsage(payment.logo, 'Payment Method Logo', 'payments');

  // 8. Scan Testimonials
  const testimonials = listCollection('testimonials');
  for (const t of testimonials) {
    recordAssetUsage(t.avatar, `Testimonial: ${t.name || 'User'}`, 'testimonials');
    recordAssetUsage(t.image, `Testimonial: ${t.name || 'User'}`, 'testimonials');
  }

  const result = Array.from(mediaMap.values());
  _unifiedMediaCache = result;
  _unifiedMediaCacheRef = currentData;
  return result;
}

function filterMediaItems(items = []) {
  const search = String(ui.media.search || '').trim().toLowerCase();
  const folder = String(ui.media.folder || 'all');
  const type = String(ui.media.type || 'all');
  const lifecycle = String(ui.media.lifecycle || 'active');

  return items.filter((item) => {
    const isDel = item.status === 'deleted';
    
    // Lifecycle filtering
    if (lifecycle === 'active' && isDel) return false;
    if (lifecycle === 'in-use' && (isDel || !item.usedIn?.length)) return false;
    if (lifecycle === 'unused' && (isDel || item.usedIn?.length > 0)) return false;
    if (lifecycle === 'deleted' && !isDel) return false;

    const name = String(item.name || mediaFileName(item.path || item.publicUrl || '') || '').toLowerCase();
    const path = String(item.path || '').toLowerCase();
    const publicUrl = String(item.publicUrl || '').toLowerCase();
    const usedInStr = (item.usedIn || []).join(' ').toLowerCase();
    const bucket = mediaBucketKey(item);
    const kind = mediaKind(item);

    if (folder !== 'all' && bucket !== folder) return false;
    if (type !== 'all' && kind !== type) return false;
    if (!search) return true;

    return name.includes(search) || path.includes(search) || publicUrl.includes(search) || usedInStr.includes(search) || String(item.folder || '').toLowerCase().includes(search);
  });
}

function sortMediaItems(items = []) {
  const sort = String(ui.media.sort || 'newest');
  const compareName = (a, b) => String(a.name || a.path || '').localeCompare(String(b.name || b.path || ''), undefined, { sensitivity: 'base' });
  return [...items].sort((a, b) => {
    if (sort === 'oldest') return mediaSortValue(a) - mediaSortValue(b) || compareName(a, b);
    if (sort === 'name-asc') return compareName(a, b) || (mediaSortValue(b) - mediaSortValue(a));
    if (sort === 'name-desc') return compareName(b, a) || (mediaSortValue(b) - mediaSortValue(a));
    return mediaSortValue(b) - mediaSortValue(a) || compareName(a, b);
  });
}

function mediaStats(items = []) {
  const folders = new Set();
  const kinds = { image: 0, video: 0, other: 0 };
  let active = 0;
  let inUse = 0;
  let unused = 0;
  let deleted = 0;
  let latest = 0;

  items.forEach((item) => {
    const isDel = item.status === 'deleted';
    if (isDel) {
      deleted++;
    } else {
      active++;
      if (Array.isArray(item.usedIn) && item.usedIn.length > 0) {
        inUse++;
      } else {
        unused++;
      }
      folders.add(mediaBucketKey(item));
      const k = mediaKind(item);
      kinds[k] = (kinds[k] || 0) + 1;
    }
    latest = Math.max(latest, mediaSortValue(item));
  });

  return {
    total: items.length,
    active,
    inUse,
    unused,
    deleted,
    count: active,
    folders: folders.size,
    images: kinds.image || 0,
    videos: kinds.video || 0,
    other: kinds.other || 0,
    latest,
  };
}

function renderMediaStatus(message = '') {
  return `
    <div class="media-status ${message ? 'visible' : ''}" data-role="media-status">
      ${escapeHtml(message || '')}
    </div>
  `;
}

function setMediaStatus(message = '') {
  ui.media.status = message || '';
  const el = document.querySelector('[data-role="media-status"]');
  if (el) el.textContent = ui.media.status;
}

async function deleteMediaAndDetachFromCatalog(item = {}) {
  if (!item || !item.id) return { detachedProducts: [], detachedCategories: [] };
  const targetUrls = [
    item.publicUrl,
    item.path,
    item.sourcePath,
    item.id,
    resolveMediaSource(item.publicUrl || item.path || '')
  ].filter(Boolean).map((u) => normalizeAssetValue(String(u)));

  function matchesTarget(val) {
    if (!val) return false;
    const normalized = normalizeAssetValue(String(val).trim());
    return targetUrls.includes(normalized);
  }

  const detachedProducts = [];
  const detachedCategories = [];

  // 1. Clean from all products in Firebase
  const products = listCollection('products');
  for (const p of products) {
    let changed = false;
    const nextProd = { ...p };
    if (matchesTarget(nextProd.image)) { nextProd.image = ''; changed = true; }
    if (matchesTarget(nextProd.photo)) { nextProd.photo = ''; changed = true; }
    if (matchesTarget(nextProd.thumbnail)) { nextProd.thumbnail = ''; changed = true; }
    if (matchesTarget(nextProd.video)) { nextProd.video = ''; changed = true; }
    if (Array.isArray(nextProd.images)) {
      const filtered = nextProd.images.filter((img) => !matchesTarget(img));
      if (filtered.length !== nextProd.images.length) { nextProd.images = filtered; changed = true; }
    }
    if (Array.isArray(nextProd.galleryImages)) {
      const filtered = nextProd.galleryImages.filter((img) => !matchesTarget(img));
      if (filtered.length !== nextProd.galleryImages.length) { nextProd.galleryImages = filtered; changed = true; }
    }
    if (Array.isArray(nextProd.videos)) {
      const filtered = nextProd.videos.filter((v) => !matchesTarget(v));
      if (filtered.length !== nextProd.videos.length) { nextProd.videos = filtered; changed = true; }
    }
    if (changed) {
      await updateRecord('products', p.id, nextProd);
      detachedProducts.push(p.name || p.title || p.id);
    }
  }

  // 2. Clean from all categories in Firebase
  const categories = listCollection('categories');
  for (const c of categories) {
    let changed = false;
    const nextCat = { ...c };
    if (matchesTarget(nextCat.image)) { nextCat.image = ''; changed = true; }
    if (matchesTarget(nextCat.icon)) { nextCat.icon = ''; changed = true; }
    if (matchesTarget(nextCat.video)) { nextCat.video = ''; changed = true; }
    if (Array.isArray(nextCat.images)) {
      const filtered = nextCat.images.filter((img) => !matchesTarget(img));
      if (filtered.length !== nextCat.images.length) { nextCat.images = filtered; changed = true; }
    }
    if (Array.isArray(nextCat.galleryImages)) {
      const filtered = nextCat.galleryImages.filter((img) => !matchesTarget(img));
      if (filtered.length !== nextCat.galleryImages.length) { nextCat.galleryImages = filtered; changed = true; }
    }
    if (Array.isArray(nextCat.videos)) {
      const filtered = nextCat.videos.filter((v) => !matchesTarget(v));
      if (filtered.length !== nextCat.videos.length) { nextCat.videos = filtered; changed = true; }
    }
    if (changed) {
      await updateRecord('categories', c.id, nextCat);
      detachedCategories.push(c.name || c.title || c.id);
    }
  }

  // 3. Mark as deleted in Firebase (soft delete into Trash)
  await saveRecord('media', item.id, {
    ...item,
    status: 'deleted',
    deletedAt: Date.now(),
    updatedAt: Date.now(),
  });

  return { detachedProducts, detachedCategories };
}

async function restoreMediaItem(item = {}) {
  if (!item || !item.id) return;
  await saveRecord('media', item.id, {
    ...item,
    status: 'active',
    deletedAt: null,
    updatedAt: Date.now(),
  });
}

async function purgeMediaItem(item = {}) {
  if (!item || !item.id) return;
  // 1. Delete from remote storage bucket if applicable
  if (item.path && !item.path.startsWith('http') && !item.path.startsWith('data:')) {
    try {
      await deletePublicAsset(item.path);
    } catch (_) {}
  }
  // 2. Permanently delete from Firebase media node
  await deleteRecord('media', item.id);
}

function renderMediaPreviewModal(item = {}) {
  const src = resolveMediaSource(item.publicUrl || item.path || '');
  const bucket = mediaBucketLabel(mediaBucketKey(item));
  const isVideo = item.type === 'video' || /\.(mp4|webm|mov|m4v|ogg)$/i.test(src);
  const usedList = Array.isArray(item.usedIn) ? item.usedIn : [];
  const isDeleted = item.status === 'deleted';

  return `
    <div class="panel-head media-preview-head">
      <div>
        <h2 class="section-title">${escapeHtml(item.name || mediaFileName(item.path || item.publicUrl || '') || 'Media Preview')}</h2>
        <p class="section-subtitle">${escapeHtml(bucket)} · ${escapeHtml(isVideo ? 'Video' : 'Image')} · ${escapeHtml(formatDateTime(item.updatedAt || item.createdAt))}</p>
      </div>
      <button class="btn btn-ghost" data-close-modal type="button"><i data-lucide="x"></i></button>
    </div>
    <div class="media-preview-modal">
      <div class="media-preview-figure">
        ${src ? (
          isVideo
            ? `<video src="${escapeHtml(src)}" controls autoplay playsinline class="media-modal-video" style="max-width:100%;max-height:480px;border-radius:12px;"></video>`
            : `<img src="${escapeHtml(src)}" alt="${escapeHtml(item.name || 'Media preview')}" loading="eager" />`
        ) : '<div class="preview-fallback">No preview available</div>'}
      </div>
      <div class="media-preview-meta">
        <div class="media-preview-pill-row">
          <span class="badge">${escapeHtml(bucket)}</span>
          <span class="badge ${isVideo ? 'type-vid' : 'type-img'}">${escapeHtml(isVideo ? 'Video' : 'Image')}</span>
          ${isDeleted ? '<span class="media-trash-badge"><i data-lucide="trash-2" style="width:11px;height:11px;"></i> TRASH / DELETED</span>' : ''}
        </div>
        
        <!-- Linked Usage Box -->
        <div style="padding: 12px; border-radius: 10px; background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.25); margin-bottom: 12px;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #818cf8; margin-bottom: 4px;">Assigned Store Usage</div>
          <div style="font-size: 13px; font-weight: 700; color: var(--text);">
            ${usedList.length ? escapeHtml(usedList.join(', ')) : '<span style="color: var(--muted); font-weight: normal;">Not attached to any product or section</span>'}
          </div>
        </div>

        <div class="media-preview-details">
          <div><span>Filename</span><strong>${escapeHtml(item.name || mediaFileName(item.path || item.publicUrl || '') || '-')}</strong></div>
          <div><span>Folder</span><strong>${escapeHtml(item.folder || bucket)}</strong></div>
          <div class="full"><span>Direct URL</span><strong class="media-url">${escapeHtml(item.publicUrl || item.path || '-')}</strong></div>
          ${isDeleted ? `<div class="full"><span>Deleted At</span><strong style="color:#fca5a5;">${escapeHtml(formatDateTime(item.deletedAt))}</strong></div>` : ''}
        </div>
        <div class="toolbar media-preview-actions" style="margin-top: 14px; display: flex; gap: 8px;">
          <button class="btn btn-ghost" data-action="copy-url" data-url="${escapeHtml(item.publicUrl || item.path || '')}" type="button"><i data-lucide="copy"></i> Copy URL</button>
          ${isDeleted ? `
            <button class="btn btn-restore" data-action="restore-media" data-id="${escapeHtml(item.id || '')}" type="button"><i data-lucide="rotate-ccw"></i> Restore Media</button>
            <button class="btn btn-purge" data-action="purge-media" data-path="${escapeHtml(item.path || '')}" data-id="${escapeHtml(item.id || '')}" type="button"><i data-lucide="trash-2"></i> Permanently Purge</button>
          ` : `
            <button class="btn btn-danger" data-action="delete-media" data-path="${escapeHtml(item.path || '')}" data-id="${escapeHtml(item.id || '')}" type="button"><i data-lucide="trash-2"></i> Move to Trash</button>
          `}
        </div>
      </div>
    </div>
  `;
}

function renderMediaCard(item = {}) {
  const src = resolveMediaSource(item.publicUrl || item.path || '');
  const bucketKey = mediaBucketKey(item);
  const isVideo = item.type === 'video' || /\.(mp4|webm|mov|m4v|ogg)$/i.test(src);
  const isSelected = ui.media.selectedIds?.has(item.id);
  const isDeleted = item.status === 'deleted';
  const usedList = Array.isArray(item.usedIn) ? item.usedIn : [];

  return `
    <article class="media-card glass ${isSelected ? 'selected' : ''} ${isDeleted ? 'is-deleted' : ''}" style="border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; position: relative;">
      <label class="media-card-checkbox" title="Select asset">
        <input type="checkbox" data-action="toggle-select-media" data-id="${escapeHtml(item.id || '')}" ${isSelected ? 'checked' : ''} />
        <span>Select</span>
      </label>
      
      <button class="media-thumb media-thumb-button" type="button" data-action="preview-media" data-id="${escapeHtml(item.id || '')}" style="position: relative; height: 160px; overflow: hidden; background: #0b0f19;">
        ${isVideo ? `
          <div class="media-video-indicator"><i data-lucide="video" style="width:11px;height:11px;"></i> VID</div>
          <div class="media-play-pill"><i data-lucide="play"></i></div>
          <video class="thumb-media" src="${escapeHtml(src)}" preload="metadata" muted playsinline style="width:100%;height:100%;object-fit:cover;"></video>
        ` : `
          <img class="thumb-media" src="${escapeHtml(src)}" alt="${escapeHtml(item.name || 'Media')}" loading="lazy" style="width:100%;height:100%;object-fit:cover;" onerror="this.onerror=null; this.src='../images/placeholder.svg';" />
        `}
      </button>

      <div class="media-body" style="padding: 14px; display: flex; flex-direction: column; gap: 8px; flex-grow: 1;">
        <div class="media-card-head">
          <strong title="${escapeHtml(item.name || item.path || 'Media')}" style="font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;">
            ${escapeHtml(item.name || item.path || 'Media')}
          </strong>
          <div style="display: flex; gap: 4px; align-items: center;">
            ${isDeleted
              ? '<span class="media-trash-badge"><i data-lucide="trash-2" style="width:10px;height:10px;"></i> TRASH</span>'
              : (usedList.length
                ? '<span class="badge badge-success" style="font-size:10px;">IN-USE</span>'
                : '<span class="badge badge-warning" style="font-size:10px;">UNASSIGNED</span>')
            }
          </div>
        </div>

        <!-- Product Name / Section Tag -->
        <div style="margin: 2px 0;">
          ${isDeleted ? `
            <div style="font-size: 11px; color: #fca5a5; display: inline-flex; align-items: center; gap: 4px;">
              <i data-lucide="clock" style="width: 11px; height: 11px;"></i> Deleted ${escapeHtml(formatDateTime(item.deletedAt))}
            </div>
          ` : (usedList.length ? `
            <div style="display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; color: #818cf8; background: rgba(99, 102, 241, 0.12); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(99, 102, 241, 0.25); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="Used in: ${escapeHtml(usedList.join(', '))}">
              <i data-lucide="package" style="width: 12px; height: 12px; flex-shrink: 0;"></i>
              <span style="overflow: hidden; text-overflow: ellipsis;">${escapeHtml(usedList.join(', '))}</span>
            </div>
          ` : `
            <div style="display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted); background: rgba(255, 255, 255, 0.04); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.08);">
              <i data-lucide="circle-dashed" style="width: 12px; height: 12px;"></i> Unassigned
            </div>
          `)}
        </div>

        <div class="media-card-meta" style="font-size: 11px; color: var(--muted); display: flex; justify-content: space-between; margin-top: auto;">
          <span>${escapeHtml(mediaBucketLabel(bucketKey))}</span>
          <span>${escapeHtml(formatDateTime(item.updatedAt || item.createdAt))}</span>
        </div>

        <div class="toolbar media-card-actions" style="margin-top: 6px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06); display: flex; gap: 6px;">
          <button class="btn btn-ghost btn-sm" data-action="preview-media" data-id="${escapeHtml(item.id || '')}" type="button" style="flex: 1; font-size: 11.5px; padding: 5px 8px;">Preview</button>
          <button class="btn btn-ghost btn-sm" data-action="copy-url" data-url="${escapeHtml(item.publicUrl || item.path || '')}" type="button" style="font-size: 11.5px; padding: 5px 8px;" title="Copy URL"><i data-lucide="copy" style="width: 13px; height: 13px;"></i></button>
          
          ${isDeleted ? `
            <button class="btn btn-restore btn-sm" data-action="restore-media" data-id="${escapeHtml(item.id || '')}" type="button" style="font-size: 11.5px; padding: 5px 8px;" title="Restore Asset"><i data-lucide="rotate-ccw" style="width: 13px; height: 13px;"></i></button>
            <button class="btn btn-purge btn-sm" data-action="purge-media" data-path="${escapeHtml(item.path || '')}" data-id="${escapeHtml(item.id || '')}" type="button" style="font-size: 11.5px; padding: 5px 8px;" title="Permanently Purge"><i data-lucide="trash-2" style="width: 13px; height: 13px;"></i></button>
          ` : `
            <button class="btn btn-danger btn-sm" data-action="delete-media" data-path="${escapeHtml(item.path || '')}" data-id="${escapeHtml(item.id || '')}" type="button" style="font-size: 11.5px; padding: 5px 8px;" title="Move to Trash"><i data-lucide="trash-2" style="width: 13px; height: 13px;"></i></button>
          `}
        </div>
      </div>
    </article>
  `;
}

function renderMediaList(items = []) {
  const allSelected = items.length > 0 && items.every((i) => ui.media.selectedIds?.has(i.id));
  return `
    <div class="media-table">
      <div class="media-table-head" style="grid-template-columns: 40px 70px minmax(160px, 1.2fr) minmax(140px, 1fr) minmax(90px, 0.6fr) minmax(100px, 0.6fr) minmax(120px, 0.7fr) minmax(160px, 0.9fr);">
        <div>
          <input type="checkbox" data-action="select-all-media" ${allSelected ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px; accent-color: #6366f1;" />
        </div>
        <span>Preview</span>
        <span>Filename</span>
        <span>Used In (Store)</span>
        <span>Folder</span>
        <span>Status</span>
        <span>Date</span>
        <span>Actions</span>
      </div>
      ${items.length ? items.map((item) => {
        const isSelected = ui.media.selectedIds?.has(item.id);
        const isDeleted = item.status === 'deleted';
        const isVideo = item.type === 'video' || /\.(mp4|webm|mov|m4v|ogg)$/i.test(item.path || item.publicUrl || '');
        const usedList = Array.isArray(item.usedIn) ? item.usedIn : [];
        const src = resolveMediaSource(item.publicUrl || item.path || '');

        return `
          <div class="media-table-row ${isDeleted ? 'is-deleted' : ''}" style="grid-template-columns: 40px 70px minmax(160px, 1.2fr) minmax(140px, 1fr) minmax(90px, 0.6fr) minmax(100px, 0.6fr) minmax(120px, 0.7fr) minmax(160px, 0.9fr); ${isSelected ? 'background: rgba(99, 102, 241, 0.1); border-radius: 8px;' : ''}">
            <div>
              <input type="checkbox" data-action="toggle-select-media" data-id="${escapeHtml(item.id || '')}" ${isSelected ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px; accent-color: #6366f1;" />
            </div>
            <button class="media-table-preview" type="button" data-action="preview-media" data-id="${escapeHtml(item.id || '')}">
              ${isVideo
                ? `<div style="width:100%;height:100%;background:#1e1b4b;display:flex;align-items:center;justify-content:center;color:#ec4899;"><i data-lucide="play" style="width:18px;height:18px;"></i></div>`
                : `<img src="${escapeHtml(src)}" alt="${escapeHtml(item.name || 'Media')}" loading="lazy" style="width:100%;height:100%;object-fit:cover;" onerror="this.onerror=null; this.src='../images/placeholder.svg';" />`
              }
            </button>
            <div class="media-table-name">
              <strong title="${escapeHtml(item.name || item.path || 'Media')}">${escapeHtml(item.name || item.path || 'Media')}</strong>
              <span style="font-size: 11px; color: var(--muted);">${escapeHtml(item.path || '-')}</span>
            </div>
            <div>
              ${isDeleted ? `
                <span style="font-size: 11px; color: #fca5a5;">Deleted</span>
              ` : (usedList.length ? `
                <span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.25); font-size: 11px; display: inline-flex; align-items: center; gap: 4px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(usedList.join(', '))}">
                  <i data-lucide="package" style="width: 11px; height: 11px; flex-shrink: 0;"></i>
                  ${escapeHtml(usedList.join(', '))}
                </span>
              ` : `
                <span style="font-size: 11px; color: var(--muted);">Unassigned</span>
              `)}
            </div>
            <div>${escapeHtml(mediaBucketLabel(mediaBucketKey(item)))}</div>
            <div>
              ${isDeleted
                ? '<span class="media-trash-badge" style="font-size:10px;">TRASH</span>'
                : (usedList.length
                  ? '<span class="badge badge-success" style="font-size:10px;">IN-USE</span>'
                  : '<span class="badge badge-warning" style="font-size:10px;">UNASSIGNED</span>')
              }
            </div>
            <div style="font-size: 11.5px; color: var(--muted);">${escapeHtml(formatDateTime(isDeleted ? item.deletedAt : (item.updatedAt || item.createdAt)))}</div>
            <div class="toolbar media-table-actions" style="display: flex; gap: 6px;">
              <button class="btn btn-ghost btn-sm" data-action="preview-media" data-id="${escapeHtml(item.id || '')}" type="button">Preview</button>
              <button class="btn btn-ghost btn-sm" data-action="copy-url" data-url="${escapeHtml(item.publicUrl || item.path || '')}" type="button" title="Copy URL"><i data-lucide="copy" style="width: 13px; height: 13px;"></i></button>
              ${isDeleted ? `
                <button class="btn btn-restore btn-sm" data-action="restore-media" data-id="${escapeHtml(item.id || '')}" type="button" title="Restore"><i data-lucide="rotate-ccw" style="width: 13px; height: 13px;"></i></button>
                <button class="btn btn-purge btn-sm" data-action="purge-media" data-path="${escapeHtml(item.path || '')}" data-id="${escapeHtml(item.id || '')}" type="button" title="Purge Permanently"><i data-lucide="trash-2" style="width: 13px; height: 13px;"></i></button>
              ` : `
                <button class="btn btn-danger btn-sm" data-action="delete-media" data-path="${escapeHtml(item.path || '')}" data-id="${escapeHtml(item.id || '')}" type="button" title="Move to Trash"><i data-lucide="trash-2" style="width: 13px; height: 13px;"></i></button>
              `}
            </div>
          </div>
        `;
      }).join('') : '<div class="empty-state media-empty">No media matched your filters.</div>'}
    </div>
  `;
}

function renderMediaPagination(totalItems, currentPage, pageSize) {
  if (pageSize >= totalItems && totalItems <= 48) return '';
  const totalPages = pageSize >= totalItems ? 1 : Math.ceil(totalItems / pageSize);
  if (totalPages <= 1) return '';

  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...');
    }
  }

  const startIdx = (currentPage - 1) * pageSize + 1;
  const endIdx = Math.min(currentPage * pageSize, totalItems);

  return `
    <div class="media-pagination-bar">
      <div class="media-page-info">
        Showing <strong>${startIdx}–${endIdx}</strong> of <strong>${totalItems}</strong> assets
      </div>
      <div class="media-page-controls">
        <button type="button" class="media-page-btn" data-action="media-page" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''} aria-label="Previous page">&#8249; Prev</button>
        ${pages.map((p) => {
          if (p === '...') return '<span style="padding: 0 4px; color: var(--muted);">...</span>';
          return `<button type="button" class="media-page-btn ${p === currentPage ? 'active' : ''}" data-action="media-page" data-page="${p}">${p}</button>`;
        }).join('')}
        <button type="button" class="media-page-btn" data-action="media-page" data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''} aria-label="Next page">Next &#8250;</button>
      </div>
    </div>
  `;
}

function renderMediaView(data) {
  const rawItems = Array.isArray(data) ? data : getAllUnifiedMediaItems(data);
  const filteredItems = sortMediaItems(filterMediaItems(rawItems));
  const stats = mediaStats(rawItems);
  
  const currentLifecycle = ui.media.lifecycle || 'active';
  const isTrashTab = currentLifecycle === 'deleted';

  const folderCounts = MEDIA_FOLDER_FILTERS
    .filter((option) => option.value !== 'all')
    .map((option) => ({
      ...option,
      count: rawItems.filter((item) => (isTrashTab ? item.status === 'deleted' : item.status !== 'deleted') && mediaBucketKey(item) === option.value).length,
    }));

  const selectedCount = ui.media.selectedIds ? ui.media.selectedIds.size : 0;
  const allFilteredSelected = filteredItems.length > 0 && filteredItems.every((i) => ui.media.selectedIds?.has(i.id));

  // Pagination calculation
  const rawPageSize = ui.media.pageSize || 36;
  const pageSize = rawPageSize === 'all' ? filteredItems.length || 1 : Number(rawPageSize) || 36;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = Math.min(Math.max(1, Number(ui.media.page) || 1), totalPages);
  ui.media.page = currentPage;

  const startIdx = (currentPage - 1) * pageSize;
  const pageItems = filteredItems.slice(startIdx, startIdx + pageSize);

  return `
    <div class="page active" style="max-width: 1300px; margin: 0 auto; padding-bottom: 60px;">
      <section class="panel glass media-shell" style="padding: 24px 28px; border-radius: 16px; margin-bottom: 24px; border: 1px solid var(--border);">
        <div class="panel-head media-head" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 20px;">
          <div>
            <div class="section-kicker" style="font-size: 11px; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">Live Store Media Manager</div>
            <h2 class="section-title" style="margin: 0; font-size: 24px; font-weight: 800; color: var(--text);">Media Library</h2>
            <p class="section-subtitle" style="margin: 4px 0 0 0; color: var(--muted); font-size: 13px;">All store assets (Products, Categories, Banner, Hero, Logos) aggregated and synced in real-time.</p>
          </div>
          <div class="toolbar media-actions" style="display: flex; gap: 10px; align-items: center;">
            <button class="btn btn-primary" data-action="upload-media" type="button" style="display: inline-flex; align-items: center; gap: 6px; font-weight: 700;">
              <i data-lucide="upload-cloud"></i> Upload Media (Batch)
            </button>
          </div>
        </div>

        <div class="media-summary-grid">
          <div class="media-summary-card">
            <span>Active Store Media</span>
            <strong>${escapeHtml(String(stats.active))}</strong>
          </div>
          <div class="media-summary-card">
            <span>In-Use (Attached)</span>
            <strong>${escapeHtml(String(stats.inUse))}</strong>
          </div>
          <div class="media-summary-card">
            <span>Unassigned (Unused)</span>
            <strong>${escapeHtml(String(stats.unused))}</strong>
          </div>
          <div class="media-summary-card" style="${stats.deleted > 0 ? 'border-color: rgba(239, 68, 68, 0.4);' : ''}">
            <span>Trash / Deleted</span>
            <strong style="${stats.deleted > 0 ? 'color: #fca5a5;' : ''}">${escapeHtml(String(stats.deleted))}</strong>
          </div>
          <div class="media-summary-card">
            <span>Images / Videos</span>
            <strong>${escapeHtml(String(stats.images))} / ${escapeHtml(String(stats.videos))}</strong>
          </div>
        </div>

        <!-- Lifecycle Tabs Bar -->
        <div class="media-tab-bar" style="margin-top: 22px;">
          ${MEDIA_LIFECYCLE_TABS.map((tab) => {
            const isActive = currentLifecycle === tab.value;
            let count = stats.active;
            if (tab.value === 'in-use') count = stats.inUse;
            if (tab.value === 'unused') count = stats.unused;
            if (tab.value === 'deleted') count = stats.deleted;
            return `
              <button type="button" class="media-tab-btn ${tab.isTrash ? 'tab-trash' : ''} ${isActive ? 'active' : ''}" data-action="set-media-lifecycle" data-lifecycle="${tab.value}">
                <i data-lucide="${tab.icon}" style="width: 15px; height: 15px;"></i>
                <span>${escapeHtml(tab.label)}</span>
                <span class="media-tab-badge">${count}</span>
              </button>
            `;
          }).join('')}
        </div>

        <div class="media-filter-panel glass" style="padding: 16px; border-radius: 12px; border: 1px solid var(--border);">
          <div class="media-filter-row" style="display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end;">
            <div class="field media-search-field" style="flex: 1; min-width: 200px;">
              <label for="mediaSearch">Search Filename, Path or Product Name</label>
              <input class="input" id="mediaSearch" type="search" placeholder="Search product name, filename..." value="${escapeHtml(ui.media.search || '')}" />
            </div>
            <div class="field" style="min-width: 140px;">
              <label for="mediaFolderFilter">Folder</label>
              <select class="select" id="mediaFolderFilter">
                ${MEDIA_FOLDER_FILTERS.map((option) => `
                  <option value="${escapeHtml(option.value)}" ${ui.media.folder === option.value ? 'selected' : ''}>
                    ${escapeHtml(option.label)}${option.value !== 'all' ? ` (${folderCounts.find((item) => item.value === option.value)?.count || 0})` : ''}
                  </option>
                `).join('')}
              </select>
            </div>
            <div class="field" style="min-width: 120px;">
              <label for="mediaTypeFilter">File Type</label>
              <select class="select" id="mediaTypeFilter">
                ${MEDIA_TYPE_FILTERS.map((option) => `<option value="${escapeHtml(option.value)}" ${ui.media.type === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
              </select>
            </div>
            <div class="field" style="min-width: 130px;">
              <label for="mediaSortFilter">Sort</label>
              <select class="select" id="mediaSortFilter">
                ${MEDIA_SORT_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${ui.media.sort === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
              </select>
            </div>
            <div class="field" style="min-width: 100px;">
              <label for="mediaPageSizeFilter">Per Page</label>
              <select class="select" id="mediaPageSizeFilter">
                ${[24, 36, 48, 96, 'all'].map((size) => `<option value="${size}" ${String(ui.media.pageSize || 36) === String(size) ? 'selected' : ''}>${size === 'all' ? 'All' : size}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>View</label>
              <div class="view-switch media-view-switch">
                <button class="view-switch-btn ${ui.media.view === 'grid' ? 'active' : ''}" type="button" data-action="set-media-view" data-view="grid">Grid</button>
                <button class="view-switch-btn ${ui.media.view === 'list' ? 'active' : ''}" type="button" data-action="set-media-view" data-view="list">List</button>
              </div>
            </div>
          </div>
        </div>
        ${renderMediaStatus(ui.media.status || '')}
      </section>

      <section class="panel glass media-results-panel" style="padding: 24px 28px; border-radius: 16px; border: 1px solid var(--border);">
        <div class="panel-head media-results-head" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 18px;">
          <div>
            <h3 style="margin: 0; font-size: 18px; font-weight: 800; color: var(--text);">
              ${escapeHtml(isTrashTab ? 'Trash Bin' : (ui.media.view === 'list' ? 'List View' : 'Grid View'))}
            </h3>
            <p class="section-subtitle" style="margin: 2px 0 0 0; font-size: 12.5px; color: var(--muted);">
              ${escapeHtml(String(filteredItems.length))} assets found in ${escapeHtml(isTrashTab ? 'Trash' : 'Library')}.
            </p>
          </div>
          <div class="toolbar media-results-actions">
            <span class="badge ${isTrashTab ? 'badge-danger' : 'badge-primary'}">${escapeHtml(String(filteredItems.length))} ${isTrashTab ? 'in trash' : 'active assets'}</span>
            <span class="badge">${escapeHtml(String(stats.folders))} folders</span>
          </div>
        </div>

        <!-- Media Bulk Action Toolbar -->
        <div class="media-bulk-bar glass" style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; margin-bottom: 18px; border-radius: 12px; background: rgba(30, 27, 75, 0.45); border: 1px solid rgba(99, 102, 241, 0.3);">
          <div style="display: flex; align-items: center; gap: 14px;">
            <label style="display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; font-size: 13px; color: var(--text);">
              <input type="checkbox" data-action="select-all-media" ${allFilteredSelected ? 'checked' : ''} style="cursor: pointer; width: 18px; height: 18px; accent-color: #6366f1;" />
              <span>Select All (${selectedCount} / ${filteredItems.length} selected)</span>
            </label>
          </div>
          <div class="toolbar" style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${isTrashTab ? `
              <button class="btn btn-sm btn-success" data-action="bulk-restore-media" ${selectedCount === 0 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} type="button" style="display: inline-flex; align-items: center; gap: 6px;">
                <i data-lucide="rotate-ccw" style="width: 14px; height: 14px;"></i> Restore Selected (${selectedCount})
              </button>
              <button class="btn btn-sm btn-danger" data-action="bulk-purge-media" ${selectedCount === 0 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} type="button" style="display: inline-flex; align-items: center; gap: 6px;">
                <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i> Permanently Purge Selected (${selectedCount})
              </button>
              <button class="btn btn-sm btn-ghost" data-action="empty-trash-media" ${stats.deleted === 0 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} type="button" style="display: inline-flex; align-items: center; gap: 6px; color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.1);">
                <i data-lucide="alert-triangle" style="width: 14px; height: 14px;"></i> Empty Trash (${stats.deleted})
              </button>
            ` : `
              <button class="btn btn-sm btn-success" data-action="bulk-set-active-media" ${selectedCount === 0 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} type="button" style="display: inline-flex; align-items: center; gap: 6px;">
                <i data-lucide="check-circle" style="width: 14px; height: 14px;"></i> Set Active
              </button>
              <button class="btn btn-sm btn-ghost" data-action="bulk-set-inactive-media" ${selectedCount === 0 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} type="button" style="display: inline-flex; align-items: center; gap: 6px; background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3);">
                <i data-lucide="eye-off" style="width: 14px; height: 14px;"></i> Set Inactive
              </button>
              <button class="btn btn-sm btn-danger" data-action="bulk-delete-media" ${selectedCount === 0 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} type="button" style="display: inline-flex; align-items: center; gap: 6px;">
                <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i> Move to Trash (${selectedCount})
              </button>
            `}
          </div>
        </div>

        ${pageItems.length ? (
          ui.media.view === 'list'
            ? renderMediaList(pageItems)
            : `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 18px;">${pageItems.map((item) => renderMediaCard(item)).join('')}</div>`
        ) : `
          <div class="panel glass" style="padding: 40px 20px; text-align: center; border-radius: 16px; border: 1px dashed var(--border);">
            <i data-lucide="${isTrashTab ? 'trash-2' : 'image-off'}" style="width: 40px; height: 40px; color: var(--muted); margin-bottom: 12px;"></i>
            <h3 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 700; color: var(--text);">${isTrashTab ? 'Trash bin is empty' : 'No media matched your filters'}</h3>
            <p style="margin: 0; font-size: 13px; color: var(--muted);">${isTrashTab ? 'Deleted assets will appear here before being permanently purged.' : 'Try clearing the search or switching folder/type filters.'}</p>
          </div>
        `}

        ${renderMediaPagination(filteredItems.length, currentPage, pageSize)}
      </section>
    </div>
  `;
}

function renderOrdersView(data) {
  const items = Object.entries(data || {}).map(([id, item]) => ({ id, ...(item || {}) })).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const filtered = ui.search ? items.filter((item) => JSON.stringify(item).toLowerCase().includes(ui.search.toLowerCase())) : items;
  return `
    <div class="page active">
      <section class="panel glass">
        <div class="panel-head">
          <div>
            <h2 class="section-title">Orders</h2>
            <p class="section-subtitle">Review, approve, reject, or delete incoming order records.</p>
          </div>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Package</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Status</th>
                <th>Time</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.length ? filtered.map((item) => `
                <tr>
                  <td>${escapeHtml(item.package || '-')}</td>
                  <td>${escapeHtml(item.amount || '-')}</td>
                  <td>${escapeHtml(item.method || '-')}</td>
                  <td>${collectionRowBadge(item)}</td>
                  <td>${escapeHtml(formatDateTime(item.timestamp))}</td>
                  <td>
                    <div class="item-actions">
                      <button class="icon-btn" data-action="approve-order" data-id="${escapeHtml(item.id)}"><i data-lucide="check-circle"></i> Approve</button>
                      <button class="icon-btn" data-action="reject-order" data-id="${escapeHtml(item.id)}"><i data-lucide="x-circle"></i> Reject</button>
                      <button class="icon-btn" data-action="view-order" data-id="${escapeHtml(item.id)}"><i data-lucide="eye"></i> View</button>
                      <button class="icon-btn" data-action="delete-order" data-id="${escapeHtml(item.id)}"><i data-lucide="trash-2"></i> Delete</button>
                    </div>
                  </td>
                </tr>
              `).join('') : '<tr><td colspan="6"><div class="empty-state">No orders found.</div></td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function renderAnalyticsView(data) {
  const summary = summarizeDashboard();
  const topProducts = buildTopProducts(summary);
  const clicksDisplay = summary.clicks;
  return `
    <div class="page active">
      <section class="panel glass analytics-page-shell">
        <div class="panel-head analytics-page-head">
          <div>
            <h2 class="section-title">Analytics</h2>
            <p class="section-subtitle">Live visitor, click, and order insights from the selected period.</p>
          </div>
          <div class="toolbar analytics-toolbar">
            ${renderRangeSwitch()}
            <button class="btn btn-ghost" data-action="refresh" type="button"><i data-lucide="refresh-cw"></i> Refresh</button>
          </div>
        </div>
        ${renderAnalyticsKpis(summary, topProducts[0] || null)}
        <div class="analytics-chart-grid">
          ${renderAnalyticsChart({
            id: 'visitors',
            title: 'Visitor Trend',
            copy: 'Visitors over time for the selected range.',
            series: summary.visitorSeries,
            tone: 'primary',
            metricLabel: 'visitors',
          })}
          ${renderAnalyticsChart({
            id: 'clicks',
            title: 'Order Click Trend',
            copy: 'Product clicks over time for the selected range.',
            series: summary.clickSeries,
            tone: 'secondary',
            metricLabel: 'order clicks',
          })}
        </div>
        <div class="analytics-products-panel panel glass">
          <div class="panel-head analytics-products-head">
            <div>
              <h3>Top Clicked Products</h3>
              <p class="section-subtitle">Ranked by live click activity in the selected period.</p>
            </div>
            <div class="analytics-products-meta">
              <span class="badge">${escapeHtml(summary.range.toUpperCase())}</span>
              <span class="section-subtitle">${escapeHtml(formatNumber(clicksDisplay))} total clicks</span>
            </div>
          </div>
          ${renderTopProductsAnalytics(topProducts, clicksDisplay)}
        </div>
      </section>
    </div>
  `;
}

let _renderViewFrame = null;
function renderView(data) {
  ui.data = data;
  // Cancel any pending render frame to avoid double-renders
  if (_renderViewFrame) cancelAnimationFrame(_renderViewFrame);
  _renderViewFrame = requestAnimationFrame(() => {
    _renderViewFrame = null;
    try {
      const current = ui.route;
      if (sideNav && sideNav.__currentRoute !== current) {
        sideNav.__currentRoute = current;
        sideNav.innerHTML = navMarkup();
        if (window.lucide) lucide.createIcons({ node: sideNav });
      }
      let html = '';
      if (current === 'dashboard') html = renderDashboard(data);
      else if (current === 'catalog' || current === 'products' || current === 'categories') html = renderCatalogView(data);
      else if (current === 'faq') html = renderCollection('faq', collectionSchemas.faq, listCollection('faq'));
      else if (current === 'testimonials') html = renderCollection('testimonials', collectionSchemas.testimonials, listCollection('testimonials'));
      else if (current === 'media') html = renderMediaView(getAllUnifiedMediaItems(data || {}));
      else if (current === 'settings') html = renderSettingsManagementView(data.settings || {}, data || {});
      else if (current === 'payment') html = renderPaymentManagementView(data.payment || {}, data || {});
      else if (current === 'orders') html = renderOrdersManagementView(data.orders || {}, data || {});
      else if (current === 'reports') html = renderReportsManagementView(data.reports || {}, data || {});
      else if (current === 'reviews') html = renderReviewsManagementView(data.reviews || {}, data || {});
      else if (current === 'screenshots') html = renderScreenshotsGalleryView(data.orders || {}, data || {});
      else if (current === 'users') html = renderUsersManagementView(data || {});
      else if (current === 'sellers') html = renderSellersManagementView(data || {}, data || {});
      else if (current === 'analytics') html = renderAnalyticsView(data);
      else if (current === 'hero') html = renderSingleEditorPage('hero', singleEditors.hero, data.hero || {});
      else if (current === 'banner') html = renderSingleEditorPage('banner', singleEditors.banner, data.banner || {});
      else html = renderDashboard(data);
      viewRoot.innerHTML = html;
      // Defer icon rendering to let browser paint HTML first — prevents thread block
      setTimeout(() => {
        if (window.lucide) lucide.createIcons({ node: viewRoot });
      }, 0);
      initCatalogDragAndDrop();
      if (current === 'analytics') mountAnalyticsCharts();
      if (notifyCount) {
        const pendingReps = Object.values(data.reports || {}).filter(r => (r.status || 'pending') === 'pending').length;
        const pendingOrds = Object.values(data.orders || {}).filter(o => o.status === 'pending' || o.orderStatus === 'pending').length;
        notifyCount.textContent = String(pendingReps + pendingOrds);
      }
    } catch (error) {
      viewRoot.innerHTML = `
        <div class="page active">
          <section class="panel glass">
            <h2 class="section-title">Render Error</h2>
            <p class="section-subtitle">${escapeHtml(error?.message || 'Unknown error')}</p>
          </section>
        </div>
      `;
    }
  });
}

let _searchDebounceTimer = null;
function softUpdateCatalog() {
  // Update only catalog results + pagination without destroying the whole view
  // This keeps search input focused and cursor position intact
  const resultsEl = document.getElementById('catalogResultsGrid');
  const paginationEl = document.querySelector('.catalog-pagination');
  if (!resultsEl) {
    // Fallback: full render if not in catalog view
    renderView(ui.data || {});
    return;
  }
  const meta = getCatalogMeta();
  const nodeData = listCollection(meta.node);
  const items = filterItems(nodeData, meta.node);
  const pageSize = Math.max(4, Number(ui.catalogPageSize) || 8);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, ui.page), totalPages);
  const paged = items.slice((page - 1) * pageSize, page * pageSize);
  ui.page = page;
  const node = meta.node;
  const itemLabel = node === 'categories' ? 'categories' : 'products';
  const itemSingular = meta.schema?.label?.toLowerCase() || 'item';
  const isCatalog = node === 'products' || node === 'categories';

  if (paged.length) {
    resultsEl.className = `catalog-results ${ui.catalogView}`;
    resultsEl.innerHTML = paged.map((item) => (node === 'categories'
      ? renderCatalogCategoryCard(item, node)
      : renderCatalogProductCard(item, node))).join('');
  } else {
    resultsEl.className = `catalog-results ${ui.catalogView}`;
    resultsEl.innerHTML = `
      <div class="catalog-empty glass">
        <div class="catalog-empty-art">
          <div class="orb orb-a"></div>
          <div class="orb orb-b"></div>
          <i data-lucide="sparkles"></i>
        </div>
        <h3>No ${escapeHtml(itemLabel)} matched your search.</h3>
        <p>Try a different search term or reset filters.</p>
      </div>
    `;
  }
  if (paginationEl) {
    const visibleStart = items.length ? ((page - 1) * pageSize) + 1 : 0;
    const visibleEnd = Math.min(items.length, page * pageSize);
    const totalSelected = ui.selection.size;
    paginationEl.innerHTML = `
      <span class="section-subtitle">Showing ${escapeHtml(String(visibleStart))}-${escapeHtml(String(visibleEnd))} of ${escapeHtml(String(items.length))} ${escapeHtml(itemLabel)}${totalSelected ? ` · ${escapeHtml(String(totalSelected))} selected` : ''}</span>
      <div class="toolbar catalog-pagination-actions">
        <span class="chip">Rows ${escapeHtml(String(pageSize))}</span>
        <button class="btn btn-ghost" data-page="prev"><i data-lucide="chevron-left"></i></button>
        <span class="chip">Page ${escapeHtml(String(page))} / ${escapeHtml(String(totalPages))}</span>
        <button class="btn btn-ghost" data-page="next"><i data-lucide="chevron-right"></i></button>
      </div>
    `;
  }
  setTimeout(() => {
    if (window.lucide) lucide.createIcons({ node: viewRoot });
  }, 0);
  initCatalogDragAndDrop();
}

let routeProgressBar = null;
function triggerRouteProgressBar() {
  if (!routeProgressBar) {
    routeProgressBar = document.createElement('div');
    routeProgressBar.className = 'route-progress-bar';
    document.body.appendChild(routeProgressBar);
  }
  routeProgressBar.style.transition = 'none';
  routeProgressBar.style.width = '0%';
  routeProgressBar.style.opacity = '1';
  requestAnimationFrame(() => {
    routeProgressBar.style.transition = 'width 240ms cubic-bezier(0.16, 1, 0.3, 1)';
    routeProgressBar.style.width = '100%';
    setTimeout(() => {
      routeProgressBar.style.opacity = '0';
    }, 260);
  });
}

function hasDataForRoute(route) {
  const data = ui.data || {};
  if (route === 'catalog' || route === 'products' || route === 'categories') {
    return Array.isArray(data.products) || (data.products && Object.keys(data.products).length > 0);
  }
  if (route === 'media') {
    return Array.isArray(data.media) || (data.media && Object.keys(data.media).length > 0);
  }
  if (route === 'reviews') {
    return Array.isArray(data.reviews) || (data.reviews && Object.keys(data.reviews).length > 0);
  }
  if (route === 'dashboard') {
    return Boolean(data.products || data.orders || data.visitors);
  }
  return true;
}

function applyRoute(path) {
  const targetRoute = (path === 'products' || path === 'categories') ? 'catalog' : (NAV_ITEMS.some((item) => item.key === path) ? path : 'dashboard');
  if (path === 'products') {
    ui.catalogTab = 'products';
  } else if (path === 'categories') {
    ui.catalogTab = 'categories';
  }
  ui.route = targetRoute;
  ui.page = 1;

  // 1. Ensure Firebase nodes required for this view are requested on-demand
  ensureNodesForRoute(targetRoute);

  // 2. Immediately update active sidebar link and trigger progress bar
  sideNav.innerHTML = navMarkup();
  if (window.lucide) lucide.createIcons({ node: sideNav });
  triggerRouteProgressBar();

  // 3. Show a quick transition indicator FIRST so the UI never freezes
  //    Then render the full view on the next animation frame
  const dataReady = hasDataForRoute(targetRoute);
  if (dataReady) {
    // Add a brief opacity transition to prevent jarring content swap
    viewRoot.style.opacity = '0.5';
    viewRoot.style.pointerEvents = 'none';
    requestAnimationFrame(() => {
      renderView(ui.data || {});
      // Restore visibility after DOM is painted
      requestAnimationFrame(() => {
        viewRoot.style.opacity = '1';
        viewRoot.style.pointerEvents = '';
      });
    });
    window.scrollTo({ top: 0, behavior: 'instant' });
    return;
  }

  // 4. Otherwise, show immediate sleek loading feedback while data streams in
  const routeItem = NAV_ITEMS.find((item) => item.key === targetRoute);
  const routeLabel = routeItem ? routeItem.label : (targetRoute.charAt(0).toUpperCase() + targetRoute.slice(1));
  viewRoot.innerHTML = `
    <div class="view-loading-shell">
      <div class="view-loading-card glass">
        <div class="view-loading-spinner"></div>
        <div class="view-loading-title">Loading ${escapeHtml(routeLabel)}...</div>
        <div class="view-loading-sub">Preparing live records</div>
      </div>
    </div>
  `;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function syncTopbar(user) {
  userName.textContent = user.displayName || 'Admin';
  userEmail.textContent = user.email || 'connected';
  userAvatar.textContent = (user.email || 'A').slice(0, 1).toUpperCase();
}

function initRouteHandling() {
  const updateRoute = () => {
    const path = window.location.hash.replace(/^#\/?/, '') || 'dashboard';
    applyRoute(path);
    if (!isMobileViewport()) closeSidebar();
  };
  window.addEventListener('hashchange', updateRoute);
  window.addEventListener('resize', () => {
    if (!isMobileViewport()) closeSidebar();
  });
  updateRoute();
}

function attachGlobalHandlers() {
  // Global Tactile Ripple & Click Pulse Effect on all buttons, tabs, links, chips
  document.addEventListener('pointerdown', (event) => {
    const target = event.target.closest('.btn, .nav-link, .catalog-tab, .chip, button, a.btn-card, [data-action], .sidebar-close, .admin-mobile-toggle, .user-pill');
    if (!target) return;
    
    const rect = target.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'click-ripple';
    const size = Math.max(rect.width, rect.height) * 1.6;
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left}px`;
    ripple.style.top = `${event.clientY - rect.top}px`;
    
    const computedStyle = window.getComputedStyle(target);
    if (computedStyle.position === 'static') {
      target.style.position = 'relative';
    }
    target.style.overflow = 'hidden';
    
    target.appendChild(ripple);
    setTimeout(() => ripple.remove(), 420);
  });

  document.getElementById('themeBtn')?.addEventListener('click', toggleTheme);
  document.getElementById('sidebarThemeBtn')?.addEventListener('click', toggleTheme);
  document.getElementById('logoutBtn')?.addEventListener('click', logout);
  document.getElementById('sidebarLogoutBtn')?.addEventListener('click', logout);
  document.getElementById('mobileMenuBtn')?.addEventListener('click', toggleSidebar);
  sidebarCloseBtn?.addEventListener('click', closeSidebar);
  sidebarOverlay?.addEventListener('click', closeSidebar);
  notifyBtn?.addEventListener('click', () => {
    ui.notificationsOpen = !ui.notificationsOpen;
    openModal(renderNotificationsPanel());
  });
  commandInput?.addEventListener('input', (event) => {
    ui.commandSearch = event.target.value;
    if (paletteBackdrop.classList.contains('open')) renderPalette();
  });
  commandInput?.addEventListener('focus', openPalette);
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openPalette();
    }
    if (event.key === 'Escape') {
      closeSidebar();
      closeModal();
      closePalette();
    }
  });
  document.addEventListener('click', (event) => {
    const close = event.target.closest('[data-close-modal]');
    if (close) {
      closeModal();
      return;
    }
    const paletteClose = event.target.closest('[data-close-palette]');
    if (paletteClose) {
      closePalette();
    }
  });
  modalBackdrop.addEventListener('click', (event) => {
    if (event.target === modalBackdrop) closeModal();
  });
  paletteBackdrop.addEventListener('click', (event) => {
    if (event.target === paletteBackdrop) closePalette();
  });
  document.addEventListener('click', async (event) => {
    const routeBtn = event.target.closest('[data-route]');
    if (routeBtn) {
      event.preventDefault();
      const route = routeBtn.dataset.route;
      routeBtn.classList.add('nav-link-pressed');
      setTimeout(() => routeBtn.classList.remove('nav-link-pressed'), 250);

      const targetHash = `#/${route}`;
      if (window.location.hash !== targetHash) {
        window.location.hash = targetHash;
      } else {
        applyRoute(route);
      }
      if (isMobileViewport()) closeSidebar();
      return;
    }
    const actionBtn = event.target.closest('[data-action]');
    if (!actionBtn) return;
    const action = actionBtn.dataset.action;
    const node = actionBtn.dataset.node;
    const id = actionBtn.dataset.id;
    const target = actionBtn.dataset.target;
    closeCatalogActionMenus();
    if (action === 'goto') {
      const route = actionBtn.dataset.route;
      const targetHash = `#/${route}`;
      if (window.location.hash !== targetHash) {
        window.location.hash = targetHash;
      } else {
        applyRoute(route);
      }
      return;
    }
    if (action === 'refresh') {
      showToast('Refreshing live data from database...', 'info');
      startRealtime(true);
      return;
    }
    if (action === 'set-range') {
      ui.dashboardRange = actionBtn.dataset.range || 'all';
      renderView(ui.data || {});
      return;
    }
    if (action === 'set-dashboard-metric') {
      ui.dashboardMetric = actionBtn.dataset.metric || 'visitors';
      renderView(ui.data || {});
      return;
    }
    if (action === 'toggle-catalog-filters') {
      ui.catalogFiltersOpen = !ui.catalogFiltersOpen;
      persistCatalogPrefs();
      renderView(ui.data || {});
      return;
    }
    if (action === 'catalog-reset-filters') {
      resetCatalogFilters();
      return;
    }
    if (action === 'catalog-apply-filters') {
      ui.catalogFiltersOpen = false;
      persistCatalogPrefs();
      renderView(ui.data || {});
      return;
    }
    if (action === 'open-notifications') {
      openModal(renderNotificationsPanel());
      return;
    }
    if (action === 'sync-site-catalog') {
      // DISABLED: Sync was overwriting Firebase data from HTML scraping, reverting admin changes.
      showToast('Sync disabled to prevent data loss. Manage products directly in the catalog.', 'warning');
      return;
    }
    if (action === 'sync-site-media') {
      await syncCurrentSiteMedia();
      return;
    }
    if (action === 'add') {
      openRecordEditor(node, collectionSchemas[node]);
      return;
    }
    if (action === 'switch-catalog') {
      ui.route = 'catalog';
      ui.catalogTab = actionBtn.dataset.tab || 'products';
      clearSelection();
      ui.page = 1;
      persistCatalogPrefs();
      renderView(ui.data || {});
      return;
    }
    if (action === 'set-catalog-view') {
      ui.catalogView = actionBtn.dataset.view === 'list' ? 'list' : 'grid';
      persistCatalogPrefs();
      renderView(ui.data || {});
      return;
    }
    if (action === 'edit') {
      openRecordEditor(node, collectionSchemas[node], getItem(node, id) || {});
      return;
    }
    if (action === 'edit-tiers') {
      const prod = getItem('products', id) || listCollection('products').find((p) => p.id === id);
      if (prod) openTiersEditorModal(prod);
      else showToast('Product not found to manage sub-plans', 'danger');
      return;
    }
    if (action === 'preview') {
      openCatalogPreview(node, id);
      return;
    }
    if (action === 'view-products' && node === 'categories') {
      const category = getItem('categories', id);
      if (category) openCategoryProducts(category);
      return;
    }
    if (action === 'share-product') {
      openShareModal(node, id);
      return;
    }
    if (action === 'duplicate') {
      await duplicateRecord(node, id);
      showToast('Record duplicated');
      return;
    }
    if (action === 'toggle') {
      const record = getItem(node, id);
      await updateRecord(node, id, { status: record?.status === 'hidden' ? 'active' : 'hidden' });
      showToast('Visibility updated');
      return;
    }
    if (action === 'delete') {
      if (confirm('Delete this record?')) {
        await deleteRecord(node, id);
        showToast('Record deleted');
      }
      return;
    }
    if (action === 'move-position') {
      openMovePositionModal(id);
      return;
    }
    if (action === 'move-up') {
      const activeNode = node || (ui.catalogTab === 'categories' ? 'categories' : 'products');
      const allItems = listCollection(activeNode)
        .filter((item) => item.status !== 'deleted')
        .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0) || (a.createdAt || 0) - (b.createdAt || 0));
      const curIdx = allItems.findIndex((item) => item.id === id);
      if (curIdx > 0) {
        await reorderProductPosition(id, curIdx);
      } else {
        showToast('Already at the top position #1', 'info');
      }
      return;
    }
    if (action === 'move-down') {
      const activeNode = node || (ui.catalogTab === 'categories' ? 'categories' : 'products');
      const allItems = listCollection(activeNode)
        .filter((item) => item.status !== 'deleted')
        .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0) || (a.createdAt || 0) - (b.createdAt || 0));
      const curIdx = allItems.findIndex((item) => item.id === id);
      if (curIdx >= 0 && curIdx < allItems.length - 1) {
        await reorderProductPosition(id, curIdx + 2);
      } else {
        showToast(`Already at the bottom position #${allItems.length}`, 'info');
      }
      return;
    }
    if (action === 'terminate-session') {
      const sessId = actionBtn.dataset.sessionId;
      if (!sessId) return;
      if (confirm('Log out this remote device? It will be disconnected immediately.')) {
        try {
          await terminateAdminSession(sessId);
          showToast('Remote device signed out successfully.', 'success');
          ui.sessions = await getActiveAdminSessions();
          renderView(ui.data || {});
        } catch (err) {
          showToast(err?.message || 'Failed to log out device', 'danger');
        }
      }
      return;
    }
    if (action === 'terminate-all-other-sessions') {
      if (confirm('Are you sure you want to log out ALL other devices? All other phones, PCs, and tablets will be signed out immediately.')) {
        try {
          await terminateAllOtherAdminSessions();
          showToast('All other devices have been logged out.', 'success');
          ui.sessions = await getActiveAdminSessions();
          renderView(ui.data || {});
        } catch (err) {
          showToast(err?.message || 'Failed to log out other devices', 'danger');
        }
      }
      return;
    }
    if (action === 'refresh-sessions') {
      showToast('Refreshing active devices...', 'info');
      try {
        ui.sessions = await getActiveAdminSessions();
        renderView(ui.data || {});
      } catch (err) {
        showToast('Failed to refresh sessions', 'danger');
      }
      return;
    }
    if (action === 'refresh-users') {
      showToast('Refreshing users directory...', 'info');
      try {
        await fetchUsersForAdmin(true);
        renderView(ui.data || {});
        showToast('Users directory updated!', 'success');
      } catch (err) {
        showToast('Failed to refresh users', 'danger');
      }
      return;
    }
    if (action === 'export-users-csv') {
      exportUsersCsv();
      return;
    }
    if (action === 'set-users-filter') {
      ui.usersProvider = actionBtn.dataset.filter || 'all';
      renderView(ui.data || {});
      return;
    }
    if (action === 'set-sellers-tab') {
      if (!ui.sellers) ui.sellers = { tab: 'pending', search: '' };
      ui.sellers.tab = actionBtn.dataset.tab || 'pending';
      renderView(ui.data || {});
      return;
    }
    if (action === 'approve-seller') {
      const appId = actionBtn.dataset.id;
      const storeName = actionBtn.dataset.store || 'store';
      const sellerEmail = actionBtn.dataset.email || '';

      const currentApp = (ui.data?.seller_applications && ui.data.seller_applications[appId]) ||
                         (ui.data?.events?.seller_applications && ui.data.events.seller_applications[appId]) || {};
      if (currentApp.status === 'approved' || currentApp.credentialsSent) {
        showToast(`"${storeName}" has already been approved! Credentials were sent once upon approval.`, 'info');
        return;
      }

      if (!confirm(`Approve "${storeName}" (${sellerEmail}) as an official LinkAdda Seller?\n\nA secure temporary password will be generated and emailed to ${sellerEmail} via Brevo SMTP.`)) {
        return;
      }
      actionBtn.disabled = true;
      actionBtn.innerHTML = '<i data-lucide="loader-2"></i> Approving...';

      let apiApproved = false;
      let tempPassword = `LA-Seller@${Math.floor(1000 + Math.random() * 9000)}`;
      let sellerId = `seller_${Math.random().toString(36).substring(2, 10)}`;

      // 1. Try serverless backend endpoint with safe text parsing
      try {
        const adminHeaders = await getAdminTokenHeader();
        const res = await fetch('/api/seller/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...adminHeaders },
          body: JSON.stringify({ applicationId: appId, action: 'approve' }),
        });
        const rawText = await res.text();
        let resData = null;
        try { resData = rawText ? JSON.parse(rawText) : null; } catch(_) {}
        if (res.ok && resData && resData.success) {
          apiApproved = true;
          if (resData.temporaryPassword) tempPassword = resData.temporaryPassword;
          if (resData.sellerId) sellerId = resData.sellerId;
        }
      } catch (err) {
        console.warn('API approve notice, proceeding to direct client fallback:', err);
      }

      // 2. Direct client-side approval via authenticated Firebase SDK (fail-proof)
      if (!apiApproved) {
        try {
          let appRecord = (ui.data?.seller_applications && ui.data.seller_applications[appId]) ||
                          (ui.data?.events?.seller_applications && ui.data.events.seller_applications[appId]) || {};

          if (!appRecord || !appRecord.email) {
            try {
              const s = await get(ref(db, 'events/seller_applications/' + appId));
              if (s.exists()) appRecord = s.val();
            } catch (_) {}
          }

          const secret = 'cc3843b7abd7d382223640a8556e175a60781c794637c85ca28ec035036b644b';
          const enc = new TextEncoder();
          const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(tempPassword + secret));
          const passwordHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

          const sellerRecord = {
            id: sellerId,
            email: String(appRecord.email || sellerEmail).toLowerCase().trim(),
            ownerName: appRecord.applicantName || 'Partner',
            storeName: appRecord.storeName || storeName,
            telegram: appRecord.telegram || '',
            category: appRecord.category || 'General',
            portfolioLink: appRecord.portfolioLink || '',
            passwordHash,
            status: 'active',
            mustChangePassword: true,
            createdAt: Date.now(),
            totalProducts: 0,
            totalOrders: 0,
            totalRevenue: 0,
          };

          // Save seller to events/sellers and root sellers
          await set(ref(db, 'events/sellers/' + sellerId), sellerRecord);
          try { await set(ref(db, 'sellers/' + sellerId), sellerRecord); } catch (_) {}

          // Update application status
          const updateApp = { status: 'approved', sellerId, reviewedAt: Date.now() };
          await update(ref(db, 'events/seller_applications/' + appId), updateApp);
          try { await update(ref(db, 'seller_applications/' + appId), updateApp); } catch (_) {}

          // Secure backend email dispatch
          sendAdminNotificationEmail({
            to: [{ email: sellerEmail, name: storeName }],
            subject: `🎉 Congratulations! Your LinkAdda Seller Account is Approved (${storeName})`,
            htmlContent: `
              <div style="font-family: sans-serif; background: #07060c; color: #fff; padding: 30px; border-radius: 16px; max-width: 500px; margin: 0 auto;">
                <h1 style="color: #ff2a8d; margin-top: 0;">Welcome to LinkAdda, ${escapeHtml(storeName)}!</h1>
                <p style="color: #cbd5e1; line-height: 1.5;">Your digital content partner application has been approved by LinkAdda Admin. You can now log into your Seller Hub, list exclusive packs, and track your 100% payouts.</p>
                <div style="background: #181426; padding: 20px; border-radius: 12px; margin: 24px 0; border: 1px solid rgba(255,42,141,0.3);">
                  <p style="margin: 0 0 10px 0; color: #94a3b8; font-size: 13px;">Login Portal: <a href="https://linkadda.shop/seller/login" style="color: #ff2a8d; font-weight: 700;">linkadda.shop/seller/login</a></p>
                  <p style="margin: 0 0 10px 0; color: #94a3b8; font-size: 13px;">Email: <strong style="color: #fff;">${escapeHtml(sellerEmail)}</strong></p>
                  <p style="margin: 0; color: #94a3b8; font-size: 13px;">Temporary Password: <code style="color: #fbbf24; font-size: 16px; font-weight: 800;">${escapeHtml(tempPassword)}</code></p>
                </div>
                <p style="color: #64748b; font-size: 11px;">Security notice: You will be asked to choose your own permanent password on your first sign-in.</p>
              </div>
            `
          }).catch(e => console.warn('Email dispatch note:', e));

          apiApproved = true;
        } catch (fbErr) {
          console.error('Direct cloud approval error:', fbErr);
          showToast('Approval error: ' + fbErr.message, 'danger');
          actionBtn.disabled = false;
          actionBtn.innerHTML = '<i data-lucide="check"></i> Approve & Send Mail';
          return;
        }
      }

      showToast(`Seller "${storeName}" approved! Credentials dispatched.`, 'success');

      // Refresh RTDB store state
      try {
        let baseApps = {}, evtApps = {}, sellersData = {};
        try { const s = await get(ref(db, 'events/seller_applications')); if (s.exists()) evtApps = s.val(); } catch(_) {}
        try { const s = await get(ref(db, 'seller_applications')); if (s.exists()) baseApps = s.val(); } catch(_) {}
        try { const s = await get(ref(db, 'events/sellers')); if (s.exists()) sellersData = { ...sellersData, ...s.val() }; } catch(_) {}
        try { const s = await get(ref(db, 'sellers')); if (s.exists()) sellersData = { ...sellersData, ...s.val() }; } catch(_) {}
        if (ui.data) {
          ui.data.seller_applications = { ...evtApps, ...baseApps };
          ui.data.sellers = sellersData;
        }
        if (!ui.sellers) ui.sellers = { tab: 'active', search: '' };
        else ui.sellers.tab = 'active';
      } catch (_) {}

      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const portalUrl = isLocalhost ? `${window.location.origin}/seller/login` : 'https://linkadda.shop/seller/login';
      const portalLabel = isLocalhost ? `${window.location.host}/seller/login` : 'linkadda.shop/seller/login';

      // Open Success Credentials Modal with direct 1-click copy & profile view
      openModal(`
        <div style="max-width: 480px; width: 100%; padding: 24px; text-align: left;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 26px;">🎉</span>
              <div>
                <h3 style="margin: 0; font-size: 20px; font-weight: 800; color: #fff;">Seller Approved!</h3>
                <span style="font-size: 12px; color: #34d399; font-weight: 600;">✓ Account Active & Ready</span>
              </div>
            </div>
            <button class="btn btn-ghost" data-close-modal type="button"><i data-lucide="x"></i></button>
          </div>

          <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 12px; padding: 14px; margin-bottom: 16px; font-size: 13px; color: #d1fae5;">
            <strong>${escapeHtml(storeName)}</strong> has been approved as an official partner. An onboarding email was dispatched to <strong>${escapeHtml(sellerEmail)}</strong>.
          </div>

          <div style="background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 16px; margin-bottom: 20px; font-size: 13px;">
            <div style="font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; margin-bottom: 10px;">Seller Login Credentials</div>
            <div style="margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
              <span style="color: var(--muted);">Email:</span>
              <code style="color: #93c5fd; font-size: 13px;">${escapeHtml(sellerEmail)}</code>
            </div>
            <div style="margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
              <span style="color: var(--muted);">Temp Password:</span>
              <code style="color: #fbbf24; font-weight: 800; background: rgba(245, 158, 11, 0.15); padding: 3px 8px; border-radius: 4px; font-size: 14px;">${escapeHtml(tempPassword)}</code>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: var(--muted);">Partner Portal:</span>
              <a href="${portalUrl}" target="_blank" style="color: var(--primary); font-weight: 600; text-decoration: none;">${portalLabel} ↗</a>
            </div>
          </div>

          <div style="display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap;">
            <button class="btn btn-ghost" type="button" data-action="copy-credentials" data-text="LinkAdda Seller Login\nPortal: ${portalUrl}\nEmail: ${escapeHtml(sellerEmail)}\nPassword: ${escapeHtml(tempPassword)}">
              <i data-lucide="copy"></i> Copy Credentials
            </button>
            <button class="btn btn-primary" type="button" data-action="view-seller-profile" data-seller-id="${sellerId}">
              <i data-lucide="eye"></i> View Profile & Packs
            </button>
          </div>
        </div>
      `);

      renderView(ui.data || {});
      return;
    }
    if (action === 'delete-seller-app') {
      const appId = actionBtn.dataset.id;
      const storeName = actionBtn.dataset.store || 'Application';
      if (!confirm(`Permanently delete seller application for "${storeName}"?\n\nThis record will be permanently deleted from database.`)) {
        return;
      }
      actionBtn.disabled = true;
      try {
        await remove(ref(db, 'events/seller_applications/' + appId));
        try { await remove(ref(db, 'seller_applications/' + appId)); } catch(_) {}
        if (ui.data?.seller_applications) delete ui.data.seller_applications[appId];
        if (ui.data?.events?.seller_applications) delete ui.data.events.seller_applications[appId];
        showToast(`Application for "${storeName}" deleted permanently.`, 'warning');
      } catch (err) {
        showToast('Delete failed: ' + err.message, 'danger');
      } finally {
        renderView(ui.data || {});
      }
      return;
    }
    if (action === 'delete-seller') {
      const sellerId = actionBtn.dataset.sellerId;
      const storeName = actionBtn.dataset.store || 'Seller';
      if (!confirm(`Permanently delete verified seller "${storeName}"?\n\nTheir partner account will be revoked.`)) {
        return;
      }
      actionBtn.disabled = true;
      try {
        await remove(ref(db, 'events/sellers/' + sellerId));
        try { await remove(ref(db, 'sellers/' + sellerId)); } catch(_) {}
        if (ui.data?.sellers) delete ui.data.sellers[sellerId];
        if (ui.data?.events?.sellers) delete ui.data.events.sellers[sellerId];
        closeModal();
        showToast(`Seller "${storeName}" deleted permanently.`, 'warning');
      } catch (err) {
        showToast('Delete failed: ' + err.message, 'danger');
      } finally {
        renderView(ui.data || {});
      }
      return;
    }
    if (action === 'view-seller-profile') {
      const sellerId = actionBtn.dataset.sellerId || '';
      const storeHint = actionBtn.dataset.store || '';
      const allSellersMap = typeof getUnifiedSellersMap === 'function' 
        ? getUnifiedSellersMap(ui.data || {}, ui.data || {}) 
        : { ...(ui.data?.public_sellers || {}), ...(ui.data?.events?.sellers || {}), ...(ui.data?.sellers || {}) };
      
      let seller = allSellersMap[sellerId];
      if (!seller && (sellerId || storeHint)) {
        const cleanId = cleanStoreName(sellerId);
        const cleanHint = cleanStoreName(storeHint);
        seller = Object.values(allSellersMap).find(s => 
          (s.id && s.id === sellerId) || 
          (s.sellerId && s.sellerId === sellerId) || 
          (cleanId && cleanStoreName(s.storeName) === cleanId) ||
          (cleanHint && cleanStoreName(s.storeName) === cleanHint) ||
          (cleanId && cleanStoreName(s.ownerName) === cleanId)
        );
      }
      if (!seller) {
        seller = { id: sellerId, storeName: storeHint || 'Creator Store' };
      }

      // Ensure products are loaded so seller packs always show
      let prods = ui.data?.products;
      if (!prods || Object.keys(prods).length === 0) {
        try {
          const pSnap = await get(ref(db, 'products'));
          if (pSnap.exists()) {
            prods = pSnap.val() || {};
            if (ui.data) ui.data.products = prods;
          }
        } catch (_) {
          try {
            const pRes = await fetch('https://linkadda-cd1da-default-rtdb.firebaseio.com/products.json');
            if (pRes.ok) {
              prods = await pRes.json() || {};
              if (ui.data) ui.data.products = prods;
            }
          } catch (_) {}
        }
      }

      // Ensure latest payout and profile data is fetched from RTDB
      const sTargetId = seller.id || seller.sellerId || sellerId;
      if (sTargetId) {
        try {
          const sSnap = await get(ref(db, `events/sellers/${sTargetId}`));
          if (sSnap.exists()) {
            seller = { ...seller, ...sSnap.val() };
          } else {
            const sSnap2 = await get(ref(db, `sellers/${sTargetId}`));
            if (sSnap2.exists()) seller = { ...seller, ...sSnap2.val() };
          }
        } catch (_) {}
      }

      const allOrders = ui.data?.orders || {};
      openModal(renderSellerDetailsModal(seller, prods || {}, allOrders));
      setTimeout(() => {
        if (window.lucide) lucide.createIcons({ node: document.querySelector('.seller-details-modal') || document });
      }, 50);
      return;
    }
    if (action === 'assign-all-catalog-to-trusted' || action === 'link-seller-packs') {
      const sellerId = actionBtn.dataset.sellerId || 'seller_jaibajpai67';
      const sellerEmail = actionBtn.dataset.sellerEmail || 'jaibajpai67@gmail.com';
      const sellerName = actionBtn.dataset.sellerName || 'Trusted brother';
      const isTb = sellerEmail === 'jaibajpai67@gmail.com' || cleanStoreName(sellerName) === 'trusted brother' || action === 'assign-all-catalog-to-trusted';
      
      actionBtn.disabled = true;
      actionBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Assigning products in database...';

      try {
        if (isTb) {
          const adminHeaders = (typeof getAdminTokenHeader === 'function') ? await getAdminTokenHeader() : {};
          const apiRes = await fetch('/api/seller/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...adminHeaders },
            body: JSON.stringify({ action: 'assign_all_to_trusted_brother' }),
          });
          const resData = await apiRes.json();
          if (resData.success) {
            showToast(`Success! Assigned all ${resData.assignedCount} products to ${sellerName} (${sellerEmail})!`, 'success');
            actionBtn.style.background = '#10b981';
            actionBtn.style.color = '#fff';
            actionBtn.innerHTML = '<i data-lucide="check-check"></i> All Products Assigned to Seller!';
            // Refresh local products
            const authQuery = (typeof getAdminAuthParam === 'function' && getAdminAuthParam()) ? `?${getAdminAuthParam()}` : '';
            try {
              const pRes = await fetch(`${RTDB_URL}/products.json${authQuery}`);
              if (pRes.ok) {
                const freshP = await pRes.json();
                if (freshP) {
                  if (ui.data) ui.data.products = freshP;
                  if (STORE.products) STORE.products = freshP;
                }
              }
            } catch (_) {}
            setTimeout(() => { closeModal(); renderView(ui.data || {}); }, 1200);
            return;
          }
        }

        // Standard matching packs link
        const authQuery = (typeof getAdminAuthParam === 'function' && getAdminAuthParam()) ? `?${getAdminAuthParam()}` : '';
        const allProds = ui.data?.products || {};
        const sellerObj = { id: sellerId, sellerId, email: sellerEmail, storeName: sellerName };
        const matchingProds = Object.values(allProds).filter(p => matchProductToSeller(p, sellerObj));

        let updatedCount = 0;
        const tasks = matchingProds.map(async (p) => {
          if (!p || !p.id) return;
          const patchPayload = {
            sellerId,
            sellerEmail,
            sellerName,
            sellerVerified: true,
            status: 'active',
            approvalStatus: 'approved',
          };
          try {
            await fetch(`${RTDB_URL}/products/${encodeURIComponent(p.id)}.json${authQuery}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(patchPayload),
            });
            if (ui.data?.products?.[p.id]) {
              Object.assign(ui.data.products[p.id], patchPayload);
            }
            updatedCount++;
          } catch (_) {}
        });

        await Promise.allSettled(tasks);
        showToast(`Successfully linked ${updatedCount} packs to ${sellerName} in Firebase DB!`, 'success');
        actionBtn.style.background = '#10b981';
        actionBtn.style.color = '#fff';
        actionBtn.innerHTML = '<i data-lucide="check"></i> All Packs Linked to Seller!';
        setTimeout(() => { renderView(ui.data || {}); }, 1200);
      } catch (err) {
        showToast('Linking error: ' + err.message, 'danger');
        actionBtn.disabled = false;
        actionBtn.innerHTML = '<i data-lucide="link"></i> Retry Linking';
      }
      return;
    }
    if (action === 'add-pack-for-seller') {
      closeModal();
      const sellerId = actionBtn.dataset.sellerId || '';
      const sellerName = actionBtn.dataset.sellerName || '';
      ui.route = 'catalog';
      ui.catalogTab = 'products';
      window.location.hash = '#/catalog';
      renderView(ui.data || {});
      setTimeout(() => {
        openRecordEditor('products', collectionSchemas.products, {
          sellerId,
          sellerName,
          category: 'ALL IN ONE',
          badge: 'Creator Vault',
        });
      }, 100);
      return;
    }
    if (action === 'approve-product') {
      const pId = actionBtn.dataset.id;
      if (!pId) return;
      actionBtn.disabled = true;
      actionBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Approving...';
      try {
        const authQuery = (typeof getAdminAuthParam === 'function' && getAdminAuthParam()) ? `?${getAdminAuthParam()}` : '';
        await Promise.allSettled([
          fetch(`${RTDB_URL}/products/${encodeURIComponent(pId)}/status.json${authQuery}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify('active'),
          }),
          fetch(`${RTDB_URL}/products/${encodeURIComponent(pId)}/approvalStatus.json${authQuery}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify('approved'),
          })
        ]);
        showToast('Pack approved and published live to JaiGram Shop!', 'success');
        actionBtn.style.background = '#10b981';
        actionBtn.style.borderColor = '#10b981';
        actionBtn.innerHTML = '<i data-lucide="check"></i> Live on JaiGram';
        if (ui.data?.products?.[pId]) {
          ui.data.products[pId].status = 'active';
          ui.data.products[pId].approvalStatus = 'approved';
        }
        setTimeout(() => { if (typeof renderView === 'function') renderView(ui.data || {}); }, 800);
      } catch (err) {
        showToast('Failed to approve pack: ' + (err.message || err), 'error');
        actionBtn.disabled = false;
        actionBtn.innerHTML = '<i data-lucide="check-circle"></i> Approve';
      }
      return;
    }
    if (action === 'copy-credentials') {
      const text = actionBtn.dataset.text || '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          showToast('Credentials copied to clipboard!', 'success');
        }).catch(() => {
          prompt('Copy credentials:', text);
        });
      } else {
        prompt('Copy credentials:', text);
      }
      return;
    }
    if (action === 'copy-payout') {
      const text = actionBtn.dataset.payoutText || actionBtn.dataset.text || '';
      const label = actionBtn.dataset.payoutLabel || 'Payout destination';
      if (!text) {
        showToast('No payout destination configured yet for this seller.', 'warning');
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          showToast(`Copied ${label}!`, 'success');
        }).catch(() => {
          prompt(`Copy ${label}:`, text);
        });
      } else {
        prompt(`Copy ${label}:`, text);
      }
      return;
    }
    if (action === 'reject-seller') {
      const appId = actionBtn.dataset.id;
      const reason = prompt('Rejection reason (optional):', 'Application does not meet store criteria.');
      if (reason === null) return;
      actionBtn.disabled = true;
      try {
        let apiDone = false;
        try {
          const adminHeaders = await getAdminTokenHeader();
          const res = await fetch('/api/seller/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...adminHeaders },
            body: JSON.stringify({ applicationId: appId, action: 'reject', reason }),
          });
          const rawText = await res.text();
          let resData = null;
          try { resData = rawText ? JSON.parse(rawText) : null; } catch(_) {}
          if (res.ok && resData && resData.success) apiDone = true;
        } catch (_) {}

        if (!apiDone) {
          const rejectPayload = { status: 'rejected', rejectionReason: reason, reviewedAt: Date.now() };
          await update(ref(db, 'events/seller_applications/' + appId), rejectPayload);
          try { await update(ref(db, 'seller_applications/' + appId), rejectPayload); } catch (_) {}
        }
        showToast('Application rejected.', 'warning');
        try {
          let baseApps = {}, evtApps = {};
          try { const s = await get(ref(db, 'events/seller_applications')); if (s.exists()) evtApps = s.val(); } catch(_) {}
          try { const s = await get(ref(db, 'seller_applications')); if (s.exists()) baseApps = s.val(); } catch(_) {}
          if (ui.data) ui.data.seller_applications = { ...evtApps, ...baseApps };
        } catch (_) {}
      } catch (err) {
        showToast(err.message, 'danger');
      } finally {
        renderView(ui.data || {});
      }
      return;
    }
    if (action === 'refresh-sellers') {
      showToast('Refreshing seller records and products...', 'info');
      try {
        let baseApps = {}, evtApps = {}, sellersData = {}, pubSellers = {}, prods = {};
        await Promise.allSettled([
          (async () => { try { const s = await get(ref(db, 'events/seller_applications')); if (s.exists()) evtApps = s.val(); } catch(_) {} })(),
          (async () => { try { const s = await get(ref(db, 'seller_applications')); if (s.exists()) baseApps = s.val(); } catch(_) {} })(),
          (async () => { try { const s = await get(ref(db, 'events/sellers')); if (s.exists()) sellersData = { ...sellersData, ...s.val() }; } catch(_) {} })(),
          (async () => { try { const s = await get(ref(db, 'sellers')); if (s.exists()) sellersData = { ...sellersData, ...s.val() }; } catch(_) {} })(),
          (async () => { try { const s = await get(ref(db, 'public_sellers')); if (s.exists()) pubSellers = s.val(); } catch(_) {} })(),
          (async () => { try { const s = await get(ref(db, 'products')); if (s.exists()) prods = s.val(); } catch(_) {} })(),
        ]);
        if (ui.data) {
          ui.data.seller_applications = { ...evtApps, ...baseApps };
          ui.data.sellers = sellersData;
          if (pubSellers && Object.keys(pubSellers).length > 0) ui.data.public_sellers = pubSellers;
          if (prods && Object.keys(prods).length > 0) ui.data.products = prods;
        }
        renderView(ui.data || {});
        showToast('Sellers and products updated!', 'success');
      } catch (err) {
        showToast('Refresh error: ' + err.message, 'danger');
      }
      return;
    }
    if (action === 'view-seller-packs') {
      ui.route = 'catalog';
      window.location.hash = '#/catalog';
      return;
    }
    if (action === 'edit-single') {
      const fallbackPayment = node === 'payment' ? {
        recommendedMethod: 'binancepay',
        upiId: 'Ritikane@ptyes',
        qrImage: '',
        telegramUrl: 'https://t.me/TRUSTED_BROTHER1234',
        telegramChannel: 'https://t.me/TRUSTED_BROTHER1234',
        bep20Address: '0x7186b11f8fD49fe472Af49Cda490f168e09Fef0a',
        ethAddress: '0x7186b11f8fD49fe472Af49Cda490f168e09Fef0a',
        binanceId: '969887942',
        binanceGiftCardUrl: 'https://www.g2a.com/binance-gift-card-205-usdt-key-i10000337768061',
        paypalLink: 'https://paypal.me/Johnguzman456',
        instructions: 'Pay exact order amount and submit screenshot for instant activation.',
        status: 'active',
      } : {};
      const currentVal = {
        ...fallbackPayment,
        ...(ui.data?.[node] || {}),
      };
      openSingleEditor(node, singleEditors[node], currentVal);
      return;
    }
    if (action === 'set-media-lifecycle') {
      ui.media.lifecycle = actionBtn.dataset.lifecycle || 'active';
      ui.media.page = 1;
      if (ui.media.selectedIds) ui.media.selectedIds.clear();
      renderView(ui.data || {});
      return;
    }
    if (action === 'media-page') {
      ui.media.page = Number(actionBtn.dataset.page) || 1;
      renderView(ui.data || {});
      return;
    }
    if (action === 'set-media-view') {
      ui.media.view = actionBtn.dataset.view === 'list' ? 'list' : 'grid';
      renderView(ui.data || {});
      return;
    }
    if (action === 'upload-media') {
      openMediaUpload();
      return;
    }
    if (action === 'preview-media') {
      const allMedia = getAllUnifiedMediaItems(ui.data || {});
      const media = allMedia.find((item) => item.id === id) || getItem('media', id) || listCollection('media').find((item) => item.id === id) || {};
      openModal(renderMediaPreviewModal(media));
      return;
    }
    if (action === 'copy-url') {
      await navigator.clipboard.writeText(actionBtn.dataset.url || '');
      showToast('Direct URL copied to clipboard!', 'success');
      return;
    }
    if (action === 'select-visible') {
      const currentNode = ui.catalogTab === 'categories' ? 'categories' : 'products';
      const visibleItems = filterItems(getCatalogItems(currentNode), currentNode);
      const pageSize = Math.max(4, Number(ui.catalogPageSize) || 8);
      const page = Math.min(Math.max(1, ui.page), Math.max(1, Math.ceil(visibleItems.length / pageSize)));
      const pageItems = visibleItems.slice((page - 1) * pageSize, page * pageSize).map((item) => item.id);
      const allSelected = pageItems.length && pageItems.every((itemId) => ui.selection.has(itemId));
      if (allSelected) {
        selectSelection(pageItems, false);
      } else {
        selectSelection(pageItems, true);
      }
      renderView(ui.data || {});
      return;
    }
    if (action === 'bulk') {
      await applyBulkAction(actionBtn.dataset.bulkAction, node || (ui.catalogTab === 'categories' ? 'categories' : 'products'), ui.selection);
      return;
    }
    if (action === 'toggle-select-media') {
      const mediaId = actionBtn.dataset.id;
      if (!ui.media.selectedIds) ui.media.selectedIds = new Set();
      if (ui.media.selectedIds.has(mediaId)) {
        ui.media.selectedIds.delete(mediaId);
      } else {
        ui.media.selectedIds.add(mediaId);
      }
      renderView(ui.data || {});
      return;
    }
    if (action === 'select-all-media') {
      const rawItems = getAllUnifiedMediaItems(ui.data || {});
      const filteredItems = sortMediaItems(filterMediaItems(rawItems));
      if (!ui.media.selectedIds) ui.media.selectedIds = new Set();
      const allSelected = filteredItems.length > 0 && filteredItems.every(i => ui.media.selectedIds.has(i.id));
      if (allSelected) {
        filteredItems.forEach(i => ui.media.selectedIds.delete(i.id));
      } else {
        filteredItems.forEach(i => ui.media.selectedIds.add(i.id));
      }
      renderView(ui.data || {});
      return;
    }
    if (action === 'restore-media') {
      const mediaId = actionBtn.dataset.id;
      const allMedia = getAllUnifiedMediaItems(ui.data || {});
      const targetItem = allMedia.find((m) => m.id === mediaId) || getItem('media', mediaId) || { id: mediaId };
      await restoreMediaItem(targetItem);
      showToast('Media restored to library.', 'success');
      closeModal();
      renderView(ui.data || {});
      return;
    }
    if (action === 'purge-media') {
      const mediaId = actionBtn.dataset.id;
      if (confirm('Permanently delete this file from storage and database? This action cannot be undone.')) {
        const allMedia = getAllUnifiedMediaItems(ui.data || {});
        const targetItem = allMedia.find((m) => m.id === mediaId) || getItem('media', mediaId) || { id: mediaId, path: actionBtn.dataset.path };
        await purgeMediaItem(targetItem);
        showToast('Media permanently purged from bucket.', 'success');
        closeModal();
        renderView(ui.data || {});
      }
      return;
    }
    if (action === 'bulk-restore-media') {
      const selected = Array.from(ui.media.selectedIds || []);
      if (!selected.length) {
        showToast('Please select items to restore.', 'warning');
        return;
      }
      const allMedia = getAllUnifiedMediaItems(ui.data || {});
      for (const mId of selected) {
        const item = allMedia.find((m) => m.id === mId) || getItem('media', mId) || { id: mId };
        await restoreMediaItem(item);
      }
      ui.media.selectedIds.clear();
      showToast(`Restored ${selected.length} media assets.`, 'success');
      renderView(ui.data || {});
      return;
    }
    if (action === 'bulk-purge-media') {
      const selected = Array.from(ui.media.selectedIds || []);
      if (!selected.length) {
        showToast('Please select items to delete.', 'warning');
        return;
      }
      if (confirm(`Permanently delete ${selected.length} selected assets from storage and database? This CANNOT be undone.`)) {
        const allMedia = getAllUnifiedMediaItems(ui.data || {});
        for (const mId of selected) {
          const item = allMedia.find((m) => m.id === mId) || getItem('media', mId) || { id: mId };
          await purgeMediaItem(item);
        }
        ui.media.selectedIds.clear();
        showToast(`Permanently deleted ${selected.length} media assets.`, 'success');
        renderView(ui.data || {});
      }
      return;
    }
    if (action === 'empty-trash-media') {
      const allMedia = getAllUnifiedMediaItems(ui.data || {});
      const deletedItems = allMedia.filter((m) => m.status === 'deleted');
      if (!deletedItems.length) {
        showToast('Trash bin is already empty.', 'info');
        return;
      }
      if (confirm(`Permanently delete ALL ${deletedItems.length} items from the trash bin? This cannot be undone.`)) {
        for (const item of deletedItems) {
          await purgeMediaItem(item);
        }
        ui.media.selectedIds?.clear();
        showToast(`Trash emptied (${deletedItems.length} assets permanently deleted).`, 'success');
        renderView(ui.data || {});
      }
      return;
    }
    if (action === 'filter-reports-status') {
      if (!ui.reports) ui.reports = {};
      ui.reports.status = actionBtn.dataset.status || 'all';
      renderView(ui.data || {});
      return;
    }
    if (action === 'resolve-report') {
      const repId = actionBtn.dataset.id;
      if (!repId) return;
      try {
        await update(ref(db, `reports/${repId}`), {
          status: 'resolved',
          resolvedAt: Date.now(),
          updatedAt: Date.now(),
        });
        if (ui.data?.reports?.[repId]) {
          ui.data.reports[repId].status = 'resolved';
        }
        showToast('Report marked as resolved ✓', 'success');
        renderView(ui.data || {});
      } catch (err) {
        showToast('Failed to update report: ' + err.message, 'danger');
      }
      return;
    }
    if (action === 'dismiss-report') {
      const repId = actionBtn.dataset.id;
      if (!repId) return;
      try {
        await update(ref(db, `reports/${repId}`), {
          status: 'dismissed',
          dismissedAt: Date.now(),
          updatedAt: Date.now(),
        });
        if (ui.data?.reports?.[repId]) {
          ui.data.reports[repId].status = 'dismissed';
        }
        showToast('Report dismissed', 'info');
        renderView(ui.data || {});
      } catch (err) {
        showToast('Failed to dismiss report: ' + err.message, 'danger');
      }
      return;
    }
    if (action === 'reopen-report') {
      const repId = actionBtn.dataset.id;
      if (!repId) return;
      try {
        await update(ref(db, `reports/${repId}`), {
          status: 'pending',
          updatedAt: Date.now(),
        });
        if (ui.data?.reports?.[repId]) {
          ui.data.reports[repId].status = 'pending';
        }
        showToast('Report reopened to pending', 'info');
        renderView(ui.data || {});
      } catch (err) {
        showToast('Failed to reopen report: ' + err.message, 'danger');
      }
      return;
    }
    if (action === 'delete-report') {
      const repId = actionBtn.dataset.id;
      if (!repId) return;
      if (confirm('Permanently delete this report? This cannot be undone.')) {
        try {
          await remove(ref(db, `reports/${repId}`));
          if (ui.data?.reports?.[repId]) {
            delete ui.data.reports[repId];
          }
          showToast('Report permanently deleted', 'success');
          renderView(ui.data || {});
        } catch (err) {
          showToast('Failed to delete report: ' + err.message, 'danger');
        }
      }
      return;
    }
    if (action === 'refresh-reports') {
      showToast('Refreshing reports...', 'info');
      try {
        const snap = await get(ref(db, 'reports'));
        if (ui.data) {
          ui.data.reports = snap.exists() ? snap.val() : {};
        }
        renderView(ui.data || {});
        showToast('Reports refreshed!', 'success');
      } catch (err) {
        showToast('Refresh error: ' + err.message, 'danger');
      }
      return;
    }
    if (action === 'filter-reviews-status') {
      if (!ui.reviews) ui.reviews = {};
      ui.reviews.status = actionBtn.dataset.status || 'all';
      renderView(ui.data || {});
      return;
    }
    if (action === 'approve-review') {
      const prodId = actionBtn.dataset.productId || 'general';
      const revId = actionBtn.dataset.id;
      if (!revId) return;
      try {
        const safeProdId = String(prodId || 'general').replace(/[.#$\[\]\/]/g, '_');
        const safeRevId = String(revId).replace(/[.#$\[\]\/]/g, '_');

        const allRevs = listAllReviews(ui.data?.reviews || {}, ui.data?.products || {});
        const rev = allRevs.find(r => String(r.id) === String(revId)) || {};
        const revName = (rev.name || rev.author || 'Verified Buyer').trim();
        const revComment = (rev.comment || rev.text || rev.title || 'Great content and discrete delivery!').trim();
        const revRating = Number(rev.rating || rev.stars || 5);
        const prodName = (rev.productName || ui.data?.products?.[prodId]?.name || ui.data?.products?.[safeProdId]?.name || 'VIP Pack').trim();

        // 1. Authoritative persistence in Firebase events collection (permitted for authenticated read/write)
        let targetEventId = null;
        try {
          const events = listCollection('events') || [];
          const ev = events.find(e => (e.type === 'review_submission') && (String(e.reviewId || e.id) === String(revId)));
          targetEventId = ev?.id || (ui.data?.events?.[revId] ? revId : null);
          if (targetEventId) {
            await update(ref(db, `events/${targetEventId}`), {
              status: 'approved',
              approvedAt: Date.now(),
              updatedAt: Date.now(),
            });
            if (ui.data?.events?.[targetEventId]) {
              ui.data.events[targetEventId].status = 'approved';
              ui.data.events[targetEventId].approvedAt = Date.now();
            }
          }
        } catch (evErr) {
          console.warn('Events review status update notice:', evErr);
        }

        // 2. Broadcast live approved review via settings.recentApprovedReviews (syncs live to storefront marquee, toasts, and modals)
        const currentSettings = ui.data?.settings || {};
        const prevApprovedRevs = Array.isArray(currentSettings.recentApprovedReviews) ? [...currentSettings.recentApprovedReviews] : [];
        const newRevEntry = {
          id: revId,
          productId: prodId,
          productName: prodName,
          name: revName,
          comment: revComment,
          rating: revRating,
          status: 'approved',
          approvedAt: Date.now(),
        };
        const updatedRevsPool = [newRevEntry, ...prevApprovedRevs.filter(r => String(r.id) !== String(revId))].slice(0, 10);

        await updateRecord('settings', null, {
          ...currentSettings,
          recentApprovedReviews: updatedRevsPool,
          lastReviewApprovedAt: Date.now(),
          lastApprovedReview: newRevEntry,
        });

        // 3. Resilient write to reviews node (wrapped in try-catch so security rules never crash the approval)
        try {
          const revRef = ref(db, `reviews/${safeProdId}/${safeRevId}`);
          await update(revRef, {
            id: revId,
            productId: safeProdId,
            productName: prodName,
            name: revName,
            comment: revComment,
            text: revComment,
            rating: revRating,
            status: 'approved',
            approvedAt: Date.now(),
          });
        } catch (rtdbErr) {
          console.warn('Direct RTDB reviews node write safely bypassed:', rtdbErr?.message || rtdbErr);
        }

        // 4. Update local reactive state
        if (!ui.data.reviews) ui.data.reviews = {};
        if (!ui.data.reviews[safeProdId]) ui.data.reviews[safeProdId] = {};
        ui.data.reviews[safeProdId][safeRevId] = {
          ...newRevEntry,
          text: revComment,
        };

        showToast(`Review by ${revName} approved & synced live to storefront!`, 'success');
        renderView(ui.data || {});
      } catch (err) {
        showToast('Failed to approve review: ' + (err?.message || err), 'danger');
      }
      return;
    }
    if (action === 'unapprove-review') {
      const prodId = actionBtn.dataset.productId || 'general';
      const revId = actionBtn.dataset.id;
      if (!revId) return;
      try {
        const safeProdId = String(prodId || 'general').replace(/[.#$\[\]\/]/g, '_');
        const safeRevId = String(revId).replace(/[.#$\[\]\/]/g, '_');

        // 1. Mark pending in events
        try {
          const events = listCollection('events') || [];
          const ev = events.find(e => (e.type === 'review_submission') && (String(e.reviewId || e.id) === String(revId)));
          const targetEventId = ev?.id || (ui.data?.events?.[revId] ? revId : null);
          if (targetEventId) {
            await update(ref(db, `events/${targetEventId}`), {
              status: 'pending',
              updatedAt: Date.now(),
            });
            if (ui.data?.events?.[targetEventId]) {
              ui.data.events[targetEventId].status = 'pending';
            }
          }
        } catch (_) {}

        // 2. Remove from settings.recentApprovedReviews
        try {
          const currentSettings = ui.data?.settings || {};
          if (Array.isArray(currentSettings.recentApprovedReviews)) {
            const filteredRevs = currentSettings.recentApprovedReviews.filter(r => String(r.id) !== String(revId));
            await updateRecord('settings', null, {
              ...currentSettings,
              recentApprovedReviews: filteredRevs,
            });
          }
        } catch (_) {}

        // 3. Resilient update to reviews node
        try {
          const revRef = ref(db, `reviews/${safeProdId}/${safeRevId}`);
          await update(revRef, { status: 'pending' });
        } catch (_) {}

        // 4. Update local state
        if (ui.data?.reviews?.[safeProdId]?.[safeRevId]) {
          ui.data.reviews[safeProdId][safeRevId].status = 'pending';
        }

        showToast('Review marked back to pending.', 'info');
        renderView(ui.data || {});
      } catch (err) {
        showToast('Failed to update review: ' + (err?.message || err), 'danger');
      }
      return;
    }
    if (action === 'delete-review') {
      const prodId = actionBtn.dataset.productId || 'general';
      const revId = actionBtn.dataset.id;
      if (!revId) return;
      if (confirm('Permanently delete this customer review?')) {
        try {
          const safeProdId = String(prodId || 'general').replace(/[.#$\[\]\/]/g, '_');
          const safeRevId = String(revId).replace(/[.#$\[\]\/]/g, '_');

          // 1. Delete from events
          try {
            const events = listCollection('events') || [];
            const ev = events.find(e => (e.type === 'review_submission') && (String(e.reviewId || e.id) === String(revId)));
            const targetEventId = ev?.id || (ui.data?.events?.[revId] ? revId : null);
            if (targetEventId) {
              await remove(ref(db, `events/${targetEventId}`));
              if (ui.data?.events?.[targetEventId]) {
                delete ui.data.events[targetEventId];
              }
            }
          } catch (_) {}

          // 2. Remove from settings.recentApprovedReviews
          try {
            const currentSettings = ui.data?.settings || {};
            if (Array.isArray(currentSettings.recentApprovedReviews)) {
              const filteredRevs = currentSettings.recentApprovedReviews.filter(r => String(r.id) !== String(revId));
              await updateRecord('settings', null, {
                ...currentSettings,
                recentApprovedReviews: filteredRevs,
              });
            }
          } catch (_) {}

          // 3. Resilient remove from reviews node
          try {
            const revRef = ref(db, `reviews/${safeProdId}/${safeRevId}`);
            await remove(revRef);
          } catch (_) {}

          // 4. Delete from local state
          if (ui.data?.reviews?.[safeProdId]?.[safeRevId]) {
            delete ui.data.reviews[safeProdId][safeRevId];
          }

          showToast('Review permanently deleted.', 'info');
          renderView(ui.data || {});
        } catch (err) {
          showToast('Failed to delete review: ' + (err?.message || err), 'danger');
        }
      }
      return;
    }
    if (action === 'broadcast-test-approved-review') {
      const author = prompt('Enter reviewer / buyer name for test review:', 'Aman Sharma');
      if (!author || !author.trim()) return;
      const comment = prompt('Enter review comment:', 'Super fast delivery and 4K discrete content!');
      if (!comment || !comment.trim()) return;
      const currentSettings = ui.data?.settings || {};
      const prevApproved = Array.isArray(currentSettings.recentApprovedReviews) ? [...currentSettings.recentApprovedReviews] : [];
      const newEntry = {
        id: `rev_test_${Date.now()}`,
        name: author.trim(),
        comment: comment.trim(),
        productName: 'VIP Mega Pack',
        rating: 5,
        approvedAt: Date.now()
      };
      const updatedPool = [newEntry, ...prevApproved].slice(0, 10);
      await updateRecord('settings', null, {
        ...currentSettings,
        recentApprovedReviews: updatedPool,
        lastReviewApprovedAt: Date.now(),
        lastApprovedReview: newEntry,
      });
      showToast(`Test review from "${author.trim()}" broadcast live!`, 'success');
      renderView(ui.data || {});
      return;
    }
    if (action === 'clear-approved-reviews') {
      if (confirm('Reset the live approved reviews queue?')) {
        const currentSettings = ui.data?.settings || {};
        await updateRecord('settings', null, {
          ...currentSettings,
          recentApprovedReviews: [],
          lastReviewApprovedAt: 0,
          lastApprovedReview: null,
        });
        showToast('Approved reviews queue reset', 'info');
        renderView(ui.data || {});
      }
      return;
    }
    if (action === 'sync-product-rating') {
      const prodId = actionBtn.dataset.productId;
      if (!prodId) return;
      try {
        const allRevs = listAllReviews(ui.data?.reviews || {}, ui.data?.products || {});
        const prodApproved = allRevs.filter((r) => (String(r.productId) === String(prodId)) && (r.status === 'approved'));
        const count = prodApproved.length;
        const avg = count > 0 ? (prodApproved.reduce((acc, r) => acc + (Number(r.rating) || 5), 0) / count).toFixed(1) : '4.9';
        await updateRecord('products', prodId, {
          rating: Number(avg),
          reviewsCount: count > 0 ? count : 128,
        });
        showToast(`Product card synced with ${avg} ★ rating (${count} approved reviews).`, 'success');
        renderView(ui.data || {});
      } catch (err) {
        showToast('Failed to sync rating: ' + (err?.message || err), 'danger');
      }
      return;
    }
    if (action === 'bulk-delete-media') {
      const selected = Array.from(ui.media.selectedIds || []);
      if (!selected.length) {
        showToast('Please select media items first.', 'warning');
        return;
      }
      if (confirm(`Move ${selected.length} selected media assets to Trash? They will also be detached from any linked products or categories.`)) {
        const allMedia = getAllUnifiedMediaItems(ui.data || {});
        let totalDetachedProds = 0;
        let totalDetachedCats = 0;
        for (const mId of selected) {
          const item = allMedia.find((m) => m.id === mId) || getItem('media', mId) || { id: mId };
          const res = await deleteMediaAndDetachFromCatalog(item);
          totalDetachedProds += res.detachedProducts.length;
          totalDetachedCats += res.detachedCategories.length;
        }
        ui.media.selectedIds.clear();
        let notice = `Moved ${selected.length} assets to Trash.`;
        if (totalDetachedProds || totalDetachedCats) {
          notice += ` (Removed from ${totalDetachedProds} products, ${totalDetachedCats} categories)`;
        }
        showToast(notice, 'success');
        renderView(ui.data || {});
      }
      return;
    }
    if (action === 'bulk-set-active-media' || action === 'bulk-set-inactive-media') {
      const selected = Array.from(ui.media.selectedIds || []);
      if (!selected.length) {
        showToast('Please select media items first.', 'warning');
        return;
      }
      const newStatus = action === 'bulk-set-active-media' ? 'active' : 'inactive';
      for (const mId of selected) {
        const item = getItem('media', mId);
        if (item) {
          await updateRecord('media', mId, { ...item, status: newStatus });
        }
      }
      showToast(`Updated ${selected.length} assets to ${newStatus}.`);
      renderView(ui.data || {});
      return;
    }
    if (action === 'delete-media') {
      const mediaId = actionBtn.dataset.id;
      const allMedia = getAllUnifiedMediaItems(ui.data || {});
      const targetItem = allMedia.find((m) => m.id === mediaId) || getItem('media', mediaId) || { id: mediaId, path: actionBtn.dataset.path };

      if (confirm('Move this media to Trash? It will also be detached from any linked products and store sections.')) {
        const res = await deleteMediaAndDetachFromCatalog(targetItem);
        let msg = 'Media moved to Trash.';
        if (res.detachedProducts.length) {
          msg += ` Removed from product: ${res.detachedProducts.join(', ')}`;
        }
        if (res.detachedCategories.length) {
          msg += ` Removed from category: ${res.detachedCategories.join(', ')}`;
        }
        showToast(msg, 'success');
        setMediaStatus(msg);
        closeModal();
        renderView(ui.data || {});
      }
      return;
    }
    if (action === 'add-payment-method') {
      openModal(renderPaymentMethodModal({}, false));
      return;
    }
    if (action === 'edit-payment-method') {
      const currentPayment = ui.data?.payment || {};
      const methods = getStandardPaymentMethods(currentPayment);
      const targetMethod = methods.find((m) => m.id === id) || { id };
      openModal(renderPaymentMethodModal(targetMethod, true));
      return;
    }
    if (action === 'toggle-payment-method') {
      const currentPayment = { ...(ui.data?.payment || {}) };
      const customMethods = { ...(currentPayment.customMethods || {}) };
      let disabledMethods = Array.isArray(currentPayment.disabledMethods) ? [...currentPayment.disabledMethods] : [];

      if (customMethods[id]) {
        customMethods[id].status = customMethods[id].status === 'disabled' ? 'active' : 'disabled';
        currentPayment.customMethods = customMethods;
      } else {
        if (disabledMethods.includes(id)) {
          disabledMethods = disabledMethods.filter((mId) => mId !== id);
        } else {
          disabledMethods.push(id);
        }
      }
      currentPayment.disabledMethods = disabledMethods;

      await updateRecord('payment', null, currentPayment);
      showToast('Payment method visibility updated live');
      return;
    }
    if (action === 'set-recommended-method') {
      const currentPayment = { ...(ui.data?.payment || {}) };
      currentPayment.recommendedMethod = id;
      if (Array.isArray(currentPayment.disabledMethods)) {
        currentPayment.disabledMethods = currentPayment.disabledMethods.filter((mId) => mId !== id);
      }
      await updateRecord('payment', null, currentPayment);
      showToast('⭐ Recommended payment method updated live');
      return;
    }
    if (action === 'delete-payment-method') {
      if (confirm('Are you sure you want to remove this payment method?')) {
        const currentPayment = { ...(ui.data?.payment || {}) };
        const customMethods = { ...(currentPayment.customMethods || {}) };
        if (customMethods[id]) {
          delete customMethods[id];
          currentPayment.customMethods = customMethods;
        } else {
          let disabledMethods = Array.isArray(currentPayment.disabledMethods) ? [...currentPayment.disabledMethods] : [];
          if (!disabledMethods.includes(id)) disabledMethods.push(id);
          currentPayment.disabledMethods = disabledMethods;
        }
        await updateRecord('payment', null, currentPayment);
        showToast('Payment method removed');
      }
      return;
    }
    if (action === 'copy-payment-val') {
      const val = actionBtn.dataset.val;
      if (val && val !== 'Not set') {
        await navigator.clipboard.writeText(val);
        showToast('Payment credential copied to clipboard');
      }
      return;
    }
    if (action === 'view-order' || action === 'open-order') {
      const order = getItem('orders', id);
      openModal(renderOrderDetailsModal(order || {}));
      return;
    }
    if (action === 'export-admin-snapshot') {
      const snapshot = buildAdminSnapshot(ui.data || {});
      downloadTextFile(`admin-snapshot-${new Date().toISOString().slice(0, 10)}.json`, `${JSON.stringify(snapshot, null, 2)}\n`);
      showToast('Snapshot exported');
      return;
    }
    if (action === 'set-orders-tab') {
      const targetStatus = actionBtn.dataset.status || 'all';
      ui.management.status = targetStatus;
      renderView(ui.data || {});
      return;
    }
    if (action === 'export-orders-csv') {
      const allOrders = listCollection('orders');
      if (!allOrders.length) {
        showToast('No orders found to export', 'warning');
        return;
      }
      const headers = ['Order ID', 'Product', 'Customer', 'Amount', 'Method', 'Status', 'Date', 'Proof URL'];
      const rows = allOrders.map((o) => [
        `"${String(o.id || o.orderId || '').replace(/"/g, '""')}"`,
        `"${String(orderProductName(o) || '').replace(/"/g, '""')}"`,
        `"${String(orderCustomerLabel(o) || '').replace(/"/g, '""')}"`,
        `"${String(o.amountDisplay || o.amount || o.inr || 0).replace(/"/g, '""')}"`,
        `"${String(orderMethodLabel(o) || '').replace(/"/g, '""')}"`,
        `"${String(orderStatusValue(o) || '').replace(/"/g, '""')}"`,
        `"${String(formatDateTime(orderDateValue(o))).replace(/"/g, '""')}"`,
        `"${String(orderPaymentProof(o) || '').replace(/"/g, '""')}"`
      ]);
      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      downloadTextFile(`linkadda-orders-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      showToast('Orders exported to CSV!');
      return;
    }
    if (action === 'copy-order-id') {
      const text = actionBtn.dataset.id || '';
      if (text) {
        await copyText(text);
        showToast(`Order ID #${text} copied!`);
      }
      return;
    }
    if (action === 'approve-order') {
      actionBtn.disabled = true;
      const originalBtnHtml = actionBtn.innerHTML;
      actionBtn.innerHTML = '<i data-lucide="loader-2" class="spin" style="width: 16px; height: 16px;"></i> Approving...';
      if (window.lucide) lucide.createIcons();

      try {
        const allOrders = listCollection('orders') || [];
        const order = allOrders.find((o) => String(o.id) === String(id)) || {};
        const orderTitle = orderProductName(order) || order.productName || order.title || order.name || 'Digital VIP Pack';

        // Find product to get downloadLink / Telegram link if not already present on order
        let productLink = order.downloadLink || order.fileUrl || order.orderLink || '';
        let matchedProduct = null;

        const allProducts = listCollection('products') || [];
        matchedProduct = allProducts.find((p) => 
          (order.productId && String(p.id || p.key) === String(order.productId)) ||
          (order.productSlug && String(p.slug) === String(order.productSlug)) ||
          (orderTitle && (p.title === orderTitle || p.name === orderTitle))
        );

        if (matchedProduct) {
          if (!productLink) {
            productLink = matchedProduct.downloadLink || matchedProduct.fileUrl || matchedProduct.orderLink || '';
          }
          if (!order.sellerId && matchedProduct.sellerId) order.sellerId = matchedProduct.sellerId;
          if (!order.sellerName && matchedProduct.sellerName) order.sellerName = matchedProduct.sellerName;
        }

        // Fallback to default Telegram link if product has no link
        if (!productLink) {
          productLink = 'https://t.me/TRUSTED_BROTHER1234';
        }

        const approvedPayload = {
          status: 'approved',
          orderStatus: 'approved',
          paymentStatus: 'approved',
          verified: true,
          downloadLink: productLink,
          fileUrl: productLink,
          orderLink: productLink,
          sellerId: order.sellerId || matchedProduct?.sellerId || '',
          sellerName: order.sellerName || matchedProduct?.sellerName || '',
          reviewedAt: Date.now(),
          reviewedBy: userEmail?.textContent || userName?.textContent || APP_CONFIG.appName,
        };

        await updateRecord('orders', id, approvedPayload);

        // Also write to order_approvals for instantaneous client-side notification sync
        try {
          await set(ref(db, `order_approvals/${id}`), {
            orderId: id,
            productName: orderTitle,
            downloadLink: productLink,
            telegramLink: productLink,
            channelLink: productLink,
            groupLink: productLink,
            status: 'approved',
            approvedAt: Date.now(),
            customerEmail: order.customerEmail || order.email || order.buyerEmail || ''
          });
        } catch (syncErr) {
          console.warn('order_approvals sync note:', syncErr);
        }

        // If order was a wallet top-up, credit the customer wallet balance in database and dispatch official receipt email!
        if (order.type === 'wallet_topup' || order.pkg === 'wallet_topup') {
          try {
            const bEmail = order.customerEmail || order.email || order.buyerEmail || '';
            const cUid = order.customerUid || (bEmail ? 'cust_' + bEmail.toLowerCase().replace(/[^a-z0-9]/gi, '_') : '');
            const topupAmount = Number(order.amount || order.amountINR || order.price || 0);
            if (cUid && topupAmount > 0) {
              const custSnap = await get(ref(db, `customers/${cUid}`));
              const currentCust = custSnap.exists() ? custSnap.val() : {};
              const currentBal = Number(currentCust.walletBalance) || 0;
              const newBal = currentBal + topupAmount;
              await update(ref(db, `customers/${cUid}`), { walletBalance: newBal, updatedAt: Date.now() });
              try { await update(ref(db, `events/customers/${cUid}`), { walletBalance: newBal, updatedAt: Date.now() }); } catch (_) {}

              // ━━ DISPATCH OFFICIAL WALLET RECEIPT EMAIL TO CUSTOMER VIA LINKADDA SHOP ━━
              if (bEmail) {
                const buyerDispName = currentCust.displayName || order.customerName || order.buyerName || 'Valued Member';
                const formattedDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
                const orderReceiptId = order.orderId || id;
                const payMethod = order.paymentMethod || order.method || 'Instant UPI / Online Payment';
                sendAdminNotificationEmail({
                  to: [{ email: bEmail, name: buyerDispName }],
                  subject: `💰 Payment Receipt: ₹${topupAmount} Added to Your LinkAdda Wallet (${orderReceiptId})`,
                  htmlContent: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #07060c; color: #ffffff; padding: 32px 24px; border-radius: 16px; max-width: 520px; margin: 0 auto; border: 1px solid rgba(16, 185, 129, 0.3);">
                      <div style="text-align: center; margin-bottom: 24px;">
                        <div style="font-size: 26px; font-weight: 800; color: #ffffff;">LinkAdda <span style="color: #10b981;">&#9819;</span> Shop</div>
                        <div style="font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #10b981; font-weight: 700; margin-top: 4px;">Official Wallet Top-up Receipt</div>
                      </div>
                      <div style="text-align: center; margin-bottom: 20px;">
                        <span style="display: inline-block; padding: 5px 14px; border-radius: 9999px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); color: #34d399; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px;">
                          &#10004; Funds Added Successfully
                        </span>
                      </div>
                      <h2 style="color: #ffffff; margin: 0 0 10px; font-size: 19px; text-align: center;">Hello ${escapeHtml(buyerDispName)}! 🎉</h2>
                      <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6; margin-bottom: 22px; text-align: center;">
                        Aapke LinkAdda Wallet me <strong>₹${topupAmount.toFixed(2)}</strong> successfully add ho gaye hain. Ab aap instant 1-click checkout se koi bhi pack khareed sakte hain.
                      </p>
                      
                      <!-- Prominent Receipt Box -->
                      <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 14px; padding: 20px; margin-bottom: 22px; text-align: center;">
                        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.2px; color: #94a3b8; font-weight: 700; margin-bottom: 4px;">Amount Credited</div>
                        <div style="font-size: 32px; font-weight: 850; color: #ffffff; letter-spacing: -0.5px; margin-bottom: 8px;">₹${topupAmount.toFixed(2)}</div>
                        <div style="display: inline-block; padding: 3px 12px; border-radius: 6px; background: rgba(255, 255, 255, 0.06); font-size: 12px; color: #e2e8f0;">
                          New Wallet Balance: <strong style="color: #34d399;">₹${newBal.toFixed(2)}</strong>
                        </div>
                      </div>

                      <!-- Receipt Breakdown Table -->
                      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; color: #cbd5e1;">
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                          <td style="padding: 9px 0; color: #94a3b8;">Receipt / Ref ID:</td>
                          <td style="padding: 9px 0; color: #ffffff; font-weight: 700; text-align: right; font-family: monospace;">${escapeHtml(orderReceiptId)}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                          <td style="padding: 9px 0; color: #94a3b8;">Payment Mode:</td>
                          <td style="padding: 9px 0; color: #ffffff; font-weight: 600; text-align: right;">${escapeHtml(payMethod)}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                          <td style="padding: 9px 0; color: #94a3b8;">Date &amp; Time:</td>
                          <td style="padding: 9px 0; color: #cbd5e1; text-align: right;">${escapeHtml(formattedDate)}</td>
                        </tr>
                        <tr>
                          <td style="padding: 9px 0; color: #94a3b8;">Status:</td>
                          <td style="padding: 9px 0; color: #34d399; font-weight: 700; text-align: right;">&#10004; Verified &amp; Approved</td>
                        </tr>
                      </table>

                      <div style="text-align: center; margin-bottom: 20px;">
                        <a href="https://linkadda.shop/user" target="_blank" style="background: linear-gradient(135deg, #10b981, #059669); color: #ffffff; padding: 13px 28px; border-radius: 12px; font-weight: 750; font-size: 14px; text-decoration: none; display: inline-block; box-shadow: 0 4px 18px rgba(16, 185, 129, 0.45); letter-spacing: 0.3px;">
                          🚀 Open LinkAdda User Dashboard
                        </a>
                      </div>

                      <div style="border-top: 1px solid rgba(255,255,255,0.08); margin-top: 24px; padding-top: 16px; text-align: center;">
                        <p style="color: #64748b; font-size: 11px; margin: 0;">&copy; ${new Date().getFullYear()} LinkAdda Shop &bull; Official Digital Marketplace</p>
                      </div>
                    </div>
                  `
                }).catch(e => console.warn('Wallet topup receipt dispatch error:', e));
              }
            }
          } catch (wErr) {
            console.warn('Wallet balance credit on admin approval note:', wErr);
          }
        }

        // Update settings.recentApproved pool (up to 10 persistent) so storefront rotates them
        try {
          const currentSettings = ui.data?.settings || {};
          const prevApproved = Array.isArray(currentSettings.recentApproved) ? [...currentSettings.recentApproved] : [];
          const newEntry = {
            id,
            name: orderTitle,
            productName: orderTitle,
            amount: order.amount || order.amountINR || '',
            approvedAt: Date.now()
          };
          const updatedPool = [newEntry, ...prevApproved.filter((o) => String(o.id || o.name) !== String(id))].slice(0, 10);

          await updateRecord('settings', null, {
            ...currentSettings,
            recentApproved: updatedPool,
            lastOrderApprovedAt: Date.now(),
            lastApprovedOrderId: id,
            lastApprovedOrderTitle: orderTitle,
          });
        } catch (err) {
          console.warn('Sync approved order to settings error:', err);
        }

        // ━━ 1. DISPATCH TELEGRAM ACCESS LINK EMAIL TO BUYER (NO "DOWNLOAD" WORD) ━━
        const buyerEmail = order.customerEmail || order.email || order.buyerEmail || order.customer?.email || '';
        const buyerName = order.customerName || order.name || order.buyerName || 'Valued Member';

        if (buyerEmail && order.type !== 'wallet_topup' && order.pkg !== 'wallet_topup') {
          sendAdminNotificationEmail({
            to: [{ email: buyerEmail, name: buyerName }],
            subject: `✅ Payment Approved! Access Your Pack (${orderTitle})`,
            htmlContent: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #07060c; color: #ffffff; padding: 32px 24px; border-radius: 16px; max-width: 520px; margin: 0 auto; border: 1px solid rgba(16, 185, 129, 0.3);">
                <div style="text-align: center; margin-bottom: 24px;">
                  <div style="font-size: 26px; font-weight: 800; color: #ffffff;">LinkAdda <span style="color: #10b981;">&#9819;</span> Store</div>
                  <div style="font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #10b981; font-weight: 700; margin-top: 4px;">Payment Verified &amp; Approved</div>
                </div>
                <h2 style="color: #ffffff; margin: 0 0 12px; font-size: 19px;">Hello ${escapeHtml(buyerName)}! 🎉</h2>
                <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
                  Your payment for <strong>${escapeHtml(orderTitle)}</strong> has been verified and approved by LinkAdda Admin.
                </p>
                <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 22px; border-radius: 14px; margin: 24px 0; text-align: center;">
                  <p style="margin: 0 0 14px; font-size: 13px; color: #94a3b8; font-weight: 600;">Use the button below to join the VIP Telegram channel and access your pack:</p>
                  <a href="${escapeHtml(productLink)}" target="_blank" style="background: linear-gradient(135deg, #10b981, #059669); color: #ffffff; padding: 14px 28px; border-radius: 12px; font-weight: 850; font-size: 15px; text-decoration: none; display: inline-block; box-shadow: 0 4px 18px rgba(16, 185, 129, 0.45); letter-spacing: 0.3px;">
                    🚀 Open Telegram VIP Link
                  </a>
                </div>
                <p style="color: #64748b; font-size: 12px; margin-top: 24px; text-align: center;">
                  Direct URL: <a href="${escapeHtml(productLink)}" style="color: #38bdf8; word-break: break-all;">${escapeHtml(productLink)}</a>
                </p>
                <div style="border-top: 1px solid rgba(255,255,255,0.08); margin-top: 24px; padding-top: 16px; text-align: center;">
                  <p style="color: #64748b; font-size: 11px; margin: 0;">&copy; ${new Date().getFullYear()} LinkAdda Shop &bull; 24/7 VIP Support: @Linkadda_Support</p>
                </div>
              </div>
            `
          }).catch(e => console.warn('Buyer email notice:', e));
        }

        // ━━ 2. DISPATCH NOTIFICATION TO SELLER (EMAIL & IN-APP NOTIFICATION) ━━
        const targetSellerId = order.sellerId || matchedProduct?.sellerId || '';
        let sellerRecord = null;
        if (targetSellerId) {
          const allSellers = listCollection('sellers') || [];
          sellerRecord = allSellers.find(s => String(s.id) === String(targetSellerId)) || ui.data?.sellers?.[targetSellerId];
        }
        if (!sellerRecord && (order.sellerName || matchedProduct?.sellerName)) {
          const sName = String(order.sellerName || matchedProduct?.sellerName).toLowerCase().trim();
          const allSellers = listCollection('sellers') || [];
          sellerRecord = allSellers.find(s => String(s.storeName || '').toLowerCase().trim() === sName);
        }

        const sellerEmail = sellerRecord?.email || sellerRecord?.ownerEmail;
        const sellerStore = sellerRecord?.storeName || order.sellerName || matchedProduct?.sellerName || 'Creator Partner';
        const orderAmount = order.amount || order.amountINR || order.inr || 399;

        if (sellerEmail) {
          sendAdminNotificationEmail({
            to: [{ email: sellerEmail, name: sellerStore }],
            subject: `🎉 Order Approved! ₹${orderAmount} (100% Earnings) Credited for "${orderTitle}"`,
            htmlContent: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #07060c; color: #ffffff; padding: 32px 24px; border-radius: 16px; max-width: 520px; margin: 0 auto; border: 1px solid rgba(255, 42, 141, 0.3);">
                <div style="text-align: center; margin-bottom: 24px;">
                  <div style="font-size: 26px; font-weight: 800; color: #ffffff;">LinkAdda <span style="color: #ff2a8d;">&#9819;</span> Seller Hub</div>
                  <div style="font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #ff2a8d; font-weight: 700; margin-top: 4px;">Order Verified &amp; Approved</div>
                </div>
                <h2 style="color: #ffffff; margin: 0 0 12px; font-size: 19px;">Congratulations, ${escapeHtml(sellerStore)}! 💰</h2>
                <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
                  An order for your pack <strong>"${escapeHtml(orderTitle)}"</strong> has been verified and approved by LinkAdda Admin.
                </p>
                <div style="background: rgba(255, 42, 141, 0.08); border: 1px solid rgba(255, 42, 141, 0.25); padding: 18px; border-radius: 12px; margin: 20px 0;">
                  <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                    <span style="color: #94a3b8;">Pack Name:</span>
                    <strong style="color: #ffffff;">${escapeHtml(orderTitle)}</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                    <span style="color: #94a3b8;">Buyer:</span>
                    <strong style="color: #ffffff;">${escapeHtml(buyerName)}</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between; font-size: 15px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px; margin-top: 6px;">
                    <span style="color: #34d399; font-weight: 700;">100% Creator Earnings:</span>
                    <strong style="color: #34d399; font-size: 18px; font-weight: 850;">₹${orderAmount}</strong>
                  </div>
                </div>
                <p style="color: #cbd5e1; font-size: 13px; line-height: 1.5;">
                  100% of this sale amount has been approved and credited to your seller account for 7-day rolling automated UPI payout.
                </p>
                <div style="text-align: center; margin-top: 24px;">
                  <a href="https://linkadda.shop/seller/dashboard" target="_blank" style="background: linear-gradient(135deg, #ff2a8d, #ff5e36); color: #ffffff; padding: 12px 24px; border-radius: 10px; font-weight: 800; font-size: 13.5px; text-decoration: none; display: inline-block;">
                    Open Seller Dashboard
                  </a>
                </div>
              </div>
            `
          }).catch(e => console.warn('Seller email notice:', e));
        }

        // Save in-app notification in Firebase RTDB for seller
        if (targetSellerId) {
          try {
            const notifRef = ref(db, `events/seller_notifications/${targetSellerId}/${Date.now()}`);
            await set(notifRef, {
              type: 'order_approved',
              orderId: id,
              productName: orderTitle,
              amount: orderAmount,
              buyerName: buyerName,
              message: `Order for "${orderTitle}" approved! ₹${orderAmount} (100% earnings) credited.`,
              timestamp: Date.now(),
              read: false,
            });
          } catch (_) {}
        }

        closeModal();
        showToast('✅ Order approved! Telegram link dispatched to buyer & seller notified.', 'success');
        renderView(ui.data || {});
      } catch (err) {
        showToast('Failed to approve order: ' + (err?.message || err), 'danger');
        actionBtn.disabled = false;
        actionBtn.innerHTML = originalBtnHtml;
      }
      return;
    }
    if (action === 'broadcast-test-approved-order') {
      const title = prompt('Enter product/package name for test approved order:', 'MOM SON SIS BRO');
      if (!title || !title.trim()) return;
      const currentSettings = ui.data?.settings || {};
      const prevApproved = Array.isArray(currentSettings.recentApproved) ? [...currentSettings.recentApproved] : [];
      const newEntry = {
        id: `test_${Date.now()}`,
        name: title.trim(),
        productName: title.trim(),
        amount: '₹599',
        approvedAt: Date.now()
      };
      const updatedPool = [newEntry, ...prevApproved].slice(0, 10);
      await updateRecord('settings', null, {
        ...currentSettings,
        recentApproved: updatedPool,
        lastOrderApprovedAt: Date.now(),
        lastApprovedOrderId: newEntry.id,
        lastApprovedOrderTitle: title.trim(),
      });
      showToast(`Test approved order "${title.trim()}" broadcast live!`, 'success');
      renderView(ui.data || {});
      return;
    }
    if (action === 'clear-approved-orders') {
      if (confirm('Re-sync approved orders queue directly from real database orders?')) {
        const currentSettings = ui.data?.settings || {};
        const allOrders = listCollection('orders') || [];
        const approved = allOrders.filter(o => isPaidOrder(o)).sort((a, b) => orderDateValue(b) - orderDateValue(a));
        const topOrders = approved.slice(0, 10).map(o => {
          const name = orderProductName(o);
          return {
            id: o.id,
            name,
            productName: name,
            amount: o.amount || o.amountINR || '',
            approvedAt: orderDateValue(o) || Date.now()
          };
        });
        await updateRecord('settings', null, {
          ...currentSettings,
          recentApproved: topOrders,
          lastOrderApprovedAt: 0,
          lastApprovedOrderId: '',
          lastApprovedOrderTitle: '',
        });
        showToast(`Approved orders queue synced (${topOrders.length} real approved orders)!`, 'success');
        renderView(ui.data || {});
      }
      return;
    }
    if (action === 'reject-order') {
      await updateRecord('orders', id, {
        status: 'rejected',
        orderStatus: 'rejected',
        paymentStatus: 'rejected',
        reviewedAt: Date.now(),
        reviewedBy: userEmail?.textContent || userName?.textContent || APP_CONFIG.appName,
      });
      closeModal();
      showToast('Order rejected');
      return;
    }
    if (action === 'delete-order') {
      if (confirm('Delete this order?')) {
        await deleteRecord('orders', id);
        closeModal();
        showToast('Order deleted');
      }
      return;
    }
    if (action === 'quick') {
      if (target === 'products' || target === 'categories') {
        window.location.hash = '#/catalog';
        ui.catalogTab = target;
        ui.route = 'catalog';
        ui.page = 1;
        renderView(ui.data || {});
        setTimeout(() => openRecordEditor(target, collectionSchemas[target]), 50);
      } else if (target === 'media') {
        window.location.hash = '#/media';
        ui.route = 'media';
        ui.page = 1;
        renderView(ui.data || {});
        setTimeout(openMediaUpload, 50);
      } else {
        window.location.hash = `#/${target}`;
        applyRoute(target);
      }
      return;
    }
    if (action === 'palette') {
      const next = actionBtn.dataset.paletteAction;
      if (next.startsWith('goto:')) window.location.hash = `#/${next.split(':')[1]}`;
      if (next === 'logout') logout();
    }
  });

  document.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.id === 'paymentMethodForm') {
      const methodId = form.dataset.methodId || (`custom_${Date.now()}`);
      const isCustom = form.dataset.isCustom === 'true' || methodId.startsWith('custom_');
      
      const formData = new FormData(form);
      const name = (formData.get('name') || '').trim();
      const type = (formData.get('type') || 'crypto').trim();
      const cryptoAddress = (formData.get('cryptoAddress') || '').trim();
      const network = (formData.get('network') || '').trim();
      const bankName = (formData.get('bankName') || '').trim();
      const accountHolder = (formData.get('accountHolder') || '').trim();
      const accountNumber = (formData.get('accountNumber') || '').trim();
      const ifsc = (formData.get('ifsc') || '').trim().toUpperCase();
      const bankUpiId = (formData.get('bankUpiId') || '').trim();
      
      let identifier = (formData.get('identifier') || '').trim();
      if (!identifier && cryptoAddress) identifier = cryptoAddress;
      if (!identifier && accountNumber) identifier = accountNumber;

      const tag = (formData.get('tag') || 'ACTIVE').trim().toUpperCase();
      const logo = (formData.get('logo') || '').trim();
      const qrImage = (formData.get('qrImage') || '').trim();
      const sub = (formData.get('sub') || '').trim() || (network ? network : '');
      const instructions = (formData.get('instructions') || '').trim();
      const status = formData.get('status') || 'active';
      const isRecommended = form.querySelector('#pmIsRecommended')?.checked || false;

      const currentPayment = { ...(ui.data?.payment || {}) };
      const customMethods = { ...(currentPayment.customMethods || {}) };
      let disabledMethods = Array.isArray(currentPayment.disabledMethods) ? [...currentPayment.disabledMethods] : [];

      if (status === 'disabled') {
        if (!disabledMethods.includes(methodId)) disabledMethods.push(methodId);
      } else {
        disabledMethods = disabledMethods.filter((id) => id !== methodId);
      }

      const updatedPayment = { ...currentPayment, disabledMethods };

      if (isRecommended) {
        updatedPayment.recommendedMethod = methodId;
      }

      if (isCustom || !['binancepay', 'upi', 'bep20', 'eth', 'paypal', 'giftcard', 'custom_bank', 'custom_btc'].includes(methodId)) {
        customMethods[methodId] = {
          id: methodId,
          name,
          type,
          identifier,
          network,
          bankName,
          accountName: accountHolder,
          accountHolder,
          accountNumber,
          ifsc,
          upiId: bankUpiId,
          tag,
          logo,
          qrImage,
          insideImage: qrImage,
          sub,
          instructions,
          status,
          updatedAt: Date.now(),
        };
        updatedPayment.customMethods = customMethods;
      } else {
        if (methodId === 'binancepay') {
          updatedPayment.binanceId = identifier;
          updatedPayment.binanceLogo = logo;
          updatedPayment.binanceQr = qrImage;
          if (name) updatedPayment.binancepayName = name;
          if (sub) updatedPayment.binancepaySub = sub;
          if (tag) updatedPayment.binancepayTag = tag;
          if (instructions) updatedPayment.binancepayInstructions = instructions;
        } else if (methodId === 'upi') {
          updatedPayment.upiId = identifier;
          updatedPayment.upiLogo = logo;
          updatedPayment.qrImage = qrImage;
          updatedPayment.upiQr = qrImage;
          if (name) updatedPayment.upiName = name;
          if (sub) updatedPayment.upiSub = sub;
          if (tag) updatedPayment.upiTag = tag;
          if (instructions) updatedPayment.upiInstructions = instructions;
          try {
            await updateRecord('settings', null, { upiId: identifier, qrImage });
          } catch (_) {}
        } else if (methodId === 'bep20') {
          updatedPayment.bep20Address = identifier;
          updatedPayment.bep20Logo = logo;
          updatedPayment.bep20Qr = qrImage;
          if (name) updatedPayment.bep20Name = name;
          if (sub) updatedPayment.bep20Sub = sub;
          if (tag) updatedPayment.bep20Tag = tag;
          if (instructions) updatedPayment.bep20Instructions = instructions;
        } else if (methodId === 'eth') {
          updatedPayment.ethAddress = identifier;
          updatedPayment.ethLogo = logo;
          updatedPayment.ethQr = qrImage;
          if (name) updatedPayment.ethName = name;
          if (sub) updatedPayment.ethSub = sub;
          if (tag) updatedPayment.ethTag = tag;
          if (instructions) updatedPayment.ethInstructions = instructions;
        } else if (methodId === 'paypal') {
          updatedPayment.paypalLink = identifier;
          updatedPayment.paypalLogo = logo;
          updatedPayment.paypalQr = qrImage;
          if (name) { updatedPayment.paypalName = name; updatedPayment.paypalTitle = name; }
          if (sub) updatedPayment.paypalSub = sub;
          if (tag) updatedPayment.paypalTag = tag;
          if (instructions) updatedPayment.paypalInstructions = instructions;
        } else if (methodId === 'giftcard') {
          updatedPayment.binanceGiftCardUrl = identifier;
          updatedPayment.giftcardLogo = logo;
          updatedPayment.giftcardQr = qrImage;
          if (name) updatedPayment.giftcardName = name;
          if (sub) updatedPayment.giftcardSub = sub;
          if (tag) updatedPayment.giftcardTag = tag;
          if (instructions) updatedPayment.giftcardInstructions = instructions;
        } else if (methodId === 'cards') {
          updatedPayment.cardsLogo = logo;
          updatedPayment.cardsLink = identifier;
          updatedPayment.cardsUrl = identifier;
          if (name) { updatedPayment.cardsTitle = name; updatedPayment.cardsName = name; }
          if (sub) updatedPayment.cardsSub = sub;
          if (tag) updatedPayment.cardsTag = tag;
          if (instructions) updatedPayment.cardsInstructions = instructions;
        } else if (methodId === 'netbanking') {
          updatedPayment.netbankingLogo = logo;
          if (name) { updatedPayment.netbankingTitle = name; updatedPayment.netbankingName = name; }
          if (sub) updatedPayment.netbankingSub = sub;
          if (tag) updatedPayment.netbankingTag = tag;
        } else if (methodId === 'wallet') {
          if (name) { updatedPayment.walletTitle = name; updatedPayment.walletName = name; }
          if (sub) updatedPayment.walletSub = sub;
          if (tag) updatedPayment.walletTag = tag;
        } else if (methodId === 'custom_bank') {
          updatedPayment.bankLogo = logo;
          updatedPayment.bankQr = qrImage;
          if (bankName) updatedPayment.bankName = bankName;
          if (accountNumber) updatedPayment.accountNumber = accountNumber;
          if (ifsc) updatedPayment.ifsc = ifsc;
          if (accountHolder) updatedPayment.accountHolder = accountHolder;
          if (bankUpiId) updatedPayment.bankUpiId = bankUpiId;
          if (name) updatedPayment.bankTitle = name;
          if (sub) updatedPayment.bankSub = sub;
          if (tag) updatedPayment.bankTag = tag;
          customMethods.custom_bank = {
            ...(customMethods.custom_bank || {}),
            id: 'custom_bank',
            name: name || 'Bank Transfer (IMPS / NEFT)',
            sub: sub || 'Direct Account Transfer',
            bankName: bankName || updatedPayment.bankName || 'State Bank of India',
            accountName: accountHolder || updatedPayment.accountHolder || 'Pandit Bajpai',
            accountNumber: accountNumber || updatedPayment.accountNumber || '45231994969',
            ifsc: ifsc || updatedPayment.ifsc || 'SBIN0002594',
            upiId: bankUpiId || updatedPayment.bankUpiId || '',
            qrImage,
            logo,
            instructions,
            status,
          };
          updatedPayment.customMethods = customMethods;
        } else if (methodId === 'custom_btc') {
          updatedPayment.btcLogo = logo;
          updatedPayment.btcQr = qrImage;
          updatedPayment.btcAddress = identifier;
          if (name) updatedPayment.btcTitle = name;
          if (sub) updatedPayment.btcSub = sub;
          if (tag) updatedPayment.btcTag = tag;
          customMethods.custom_btc = {
            ...(customMethods.custom_btc || {}),
            id: 'custom_btc',
            name: name || 'Bitcoin (BTC)',
            sub: sub || 'BTC Native Network',
            network: network || sub || 'BTC Native Network',
            identifier,
            qrImage,
            logo,
            instructions,
            status,
          };
          updatedPayment.customMethods = customMethods;
        }
      }

      try {
        await updateRecord('payment', null, updatedPayment);
        if (ui.data) {
          ui.data.payment = { ...(ui.data.payment || {}), ...updatedPayment };
        }
        try {
          localStorage.setItem('linkadda_payment_payment', JSON.stringify(updatedPayment));
          localStorage.setItem('linkadda_payment_config', JSON.stringify({
            recommendedMethod: updatedPayment.recommendedMethod || 'binancepay',
            recommendationBadge: updatedPayment.recommendationBadge || 'RECOMMENDED',
            ...updatedPayment
          }));
        } catch (_) {}
        showToast(`Payment method "${name}" saved successfully!`, 'success');
        closeModal();
        renderView(ui.data || {});
      } catch (err) {
        showToast(err?.message || 'Failed to save payment method', 'danger');
      }
      return;
    }
    if (form.id === 'recordForm') {
      const node = form.dataset.node;
      const id = form.dataset.id;
      const schema = collectionSchemas[node];
      const existingItems = listCollection(node);
      const existingRecord = id ? getItem(node, id) || {} : {};
      const beforeRefs = recordAssetRefs(existingRecord);
      let next = sanitizeRecordFromForm(form, schema.fields, id ? getItem(node, id) || {} : {});
      if (node === 'products') {
        const prodData = getProductEditorRecord(form);
        next = {
          ...next,
          ...prodData,
          image: prodData.image,
          thumbnail: prodData.image,
          coverImage: prodData.image || (Array.isArray(prodData.images) && prodData.images[0]) || '',
          images: prodData.images,
          galleryImages: prodData.galleryImages,
          video: prodData.video,
          videos: prodData.videos,
          tiers: Array.isArray(prodData.tiers) ? prodData.tiers : [],
        };
      }
      const duplicate = existingItems.find((item) => item.slug && item.slug === next.slug && item.id !== id);
      if (duplicate) {
        showToast('Duplicate slug detected', 'warning');
        return;
      }
      if (node === 'products' || node === 'categories') {
        next = await uploadRecordMedia(form, node, next);
      }
      if (!next.id) {
        next.id = id || `prod_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`;
      }
      if (!id && node === 'products') {
        if (next.displayOrder === undefined || next.displayOrder === null || next.displayOrder === '') {
          const currentActiveItems = existingItems.filter(it => it.status !== 'deleted');
          const maxOrder = currentActiveItems.reduce((max, it) => Math.max(max, Number(it.displayOrder) || 0), 0);
          next.displayOrder = Math.max(currentActiveItems.length + 1, maxOrder + 1);
        }
        if (!next.sellerId) {
          next.sellerId = 'seller_jaibajpai67';
          next.sellerName = 'Trusted brother';
          next.sellerEmail = 'jaibajpai67@gmail.com';
          next.sellerPhone = '8004171852';
          next.sellerVerified = true;
        }
      }
      try {
        if (id) await updateRecord(node, id, next);
        else await createRecord(node, next);
        const afterRefs = recordAssetRefs(next);
        const removedRefs = beforeRefs.filter((refValue) => !afterRefs.includes(normalizeAssetValue(refValue)));
        if (removedRefs.length) {
          setTimeout(() => {
            removedRefs.forEach((refValue) => {
              deleteMediaIfUnused(refValue, { node, id }).catch(() => {});
            });
          }, 0);
        }
        showToast(`${schema.label} saved`, 'success');
        closeModal();
        renderView(ui.data || {});
      } catch (error) {
        // Resilient fallback for products via backend admin token
        if (node === 'products') {
          try {
            const adminHeaders = await getAdminTokenHeader();
            const apiRes = await fetch('/api/seller/products', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...adminHeaders },
              body: JSON.stringify({ action: 'admin_save', product: next }),
            });
            if (apiRes.ok) {
              const resJson = await apiRes.json();
              const savedProd = resJson.product || next;
              if (!ui.data) ui.data = {};
              if (!ui.data.products) ui.data.products = {};
              ui.data.products[savedProd.id] = savedProd;
              showToast(`${schema.label} saved successfully!`, 'success');
              closeModal();
              renderView(ui.data || {});
              return;
            }
          } catch (_) {}
        }
        showToast(error?.message || `Failed to save ${schema.label.toLowerCase()}`, 'danger');
        return;
      }
    }
    if (form.id === 'singleForm') {
      const node = form.dataset.node;
      const schema = singleEditors[node];
      const statusEl = form.querySelector('#singleEditorStatus');
      try {
        if (statusEl) statusEl.textContent = 'Preparing save...';
        let next = sanitizeRecordFromForm(form, schema.fields, ui.data?.[node] || {});
        next = await uploadSingleEditorMedia(form, node, next, statusEl);
        if (statusEl) statusEl.textContent = 'Saving changes...';
        await updateRecord(node, null, next);
        if (statusEl) statusEl.textContent = `${schema.title} updated successfully.`;
        showToast(`${schema.title} updated`);
        closeModal();
      } catch (error) {
        const message = error?.message || `Failed to save ${schema.title.toLowerCase()}`;
        if (statusEl) statusEl.textContent = message;
        showToast(message, 'danger');
      }
      return;
    }
    if (form.id === 'mediaUploadForm') {
      await handleMediaUpload(form);
      return;
    }
    if (form.id === 'directSettingsForm') {
      const formData = new FormData(form);
      const nextSettings = {
        ...(ui.data?.settings || {}),
        siteName: (formData.get('siteName') || '').trim() || 'Linkadda Shop',
        logo: (formData.get('logo') || '').trim(),
        favicon: (formData.get('favicon') || '').trim(),
        telegram: (formData.get('telegram') || '').trim(),
        whatsapp: (formData.get('whatsapp') || '').trim(),
        email: (formData.get('email') || '').trim(),
        footer: (formData.get('footer') || '').trim(),
        currency: (formData.get('currency') || 'INR').trim(),
        currencySymbol: (formData.get('currencySymbol') || '₹').trim(),
        priceFormat: (formData.get('priceFormat') || 'INR / USD').trim(),
        toastEnabled: formData.get('toastEnabled') === 'on' || formData.get('toastEnabled') === 'true',
        toastShowApprovedOrders: formData.get('toastShowApprovedOrders') === 'on' || formData.get('toastShowApprovedOrders') === 'true',
        toastShowApprovedReviews: formData.get('toastShowApprovedReviews') === 'on' || formData.get('toastShowApprovedReviews') === 'true',
        toastShowTelegramClicks: formData.get('toastShowTelegramClicks') === 'on' || formData.get('toastShowTelegramClicks') === 'true',
        toastShowVisitors: formData.get('toastShowVisitors') === 'on' || formData.get('toastShowVisitors') === 'true',
        toastVisitorBaseOffset: formData.get('toastVisitorBaseOffset') !== null && formData.get('toastVisitorBaseOffset') !== '' ? (Number(formData.get('toastVisitorBaseOffset')) || 100) : 100,
        toastTelegramClicksBaseOffset: formData.get('toastTelegramClicksBaseOffset') !== null && formData.get('toastTelegramClicksBaseOffset') !== '' ? (Number(formData.get('toastTelegramClicksBaseOffset')) || 50) : 50,
        toastApprovedOrderTemplate: (formData.get('toastApprovedOrderTemplate') || '').trim() || '⚡ Order approved: {name} just delivered!',
        toastApprovedReviewTemplate: (formData.get('toastApprovedReviewTemplate') || '').trim() || '⭐ {stars} ({rating}/5) from {name}: {comment}',
        toastTelegramTemplate: (formData.get('toastTelegramTemplate') || '').trim() || '✈️ {count}+ people DM\'d on Telegram today!',
        toastVisitorTemplate: (formData.get('toastVisitorTemplate') || '').trim() || '👥 {count}+ visitors visited the website today!',
        toastCustomMessages: (formData.get('toastCustomMessages') || '').trim(),
        toastInterval: Math.max(5, Number(formData.get('toastInterval')) || 8),
        updatedAt: Date.now(),
        updatedBy: userEmail?.textContent || userName?.textContent || 'Admin',
      };

      const btn = form.querySelector('#saveSettingsSubmitBtn');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Saving...';
      }

      try {
        await updateRecord('settings', null, nextSettings);
        showToast('Settings saved successfully and synced live to store!', 'success');
      } catch (err) {
        showToast(err?.message || 'Failed to save settings', 'danger');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i data-lucide="check"></i> Save Settings';
          if (window.lucide) lucide.createIcons();
        }
      }
      return;
    }
    if (form.id === 'directSingleForm') {
      const node = form.dataset.node;
      const schema = singleEditors[node];
      const formData = new FormData(form);
      const nextData = {
        ...(ui.data?.[node] || {}),
        updatedAt: Date.now(),
        updatedBy: userEmail?.textContent || userName?.textContent || 'Admin',
      };

      if (schema && Array.isArray(schema.fields)) {
        schema.fields.forEach((field) => {
          const val = formData.get(field.key);
          if (val !== null) {
            nextData[field.key] = typeof val === 'string' ? val.trim() : val;
          }
        });
      }

      const btn = form.querySelector('#saveSingleSubmitBtn');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Saving...';
      }

      try {
        await updateRecord(node, null, nextData);
        showToast(`${schema ? schema.title : 'Content'} saved successfully and updated live on website!`, 'success');
      } catch (err) {
        showToast(err?.message || 'Failed to save changes', 'danger');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = `<i data-lucide="check"></i> Save ${schema ? schema.title : 'Changes'}`;
          if (window.lucide) lucide.createIcons();
        }
      }
      return;
    }
    if (form.id === 'adminSnapshotImportForm') {
      await applyAdminSnapshotImport(form);
    }
  });

  document.addEventListener('click', (event) => {
    const close = event.target.closest('[data-close-modal]');
    if (close) closeModal();
    const palette = event.target.closest('[data-palette-action]');
    if (palette) {
      const action = palette.dataset.paletteAction;
      if (action.startsWith('goto:')) {
        const next = action.split(':')[1];
        if (next === 'products' || next === 'categories') {
          window.location.hash = '#/catalog';
          ui.catalogTab = next;
        } else {
          window.location.hash = `#/${next}`;
        }
      } else if (action.startsWith('create:')) {
        const node = action.split(':')[1];
        if (node === 'products' || node === 'categories') {
          ui.route = 'catalog';
          ui.catalogTab = node;
          renderView(ui.data || {});
        }
        openRecordEditor(node, collectionSchemas[node]);
      } else if (action === 'logout') {
        logout();
      }
      closePalette();
    }
    const pageBtn = event.target.closest('[data-page]');
    if (pageBtn) {
      ui.page = pageBtn.dataset.page === 'next' ? ui.page + 1 : Math.max(1, ui.page - 1);
      renderView(ui.data || {});
    }
    if (!event.target.closest('.catalog-card-menu')) {
      closeCatalogActionMenus();
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.id === 'collectionSearch') {
      ui.search = event.target.value;
      ui.page = 1;
      persistCatalogPrefs();
      // Debounced soft update — preserves focus and cursor position
      clearTimeout(_searchDebounceTimer);
      _searchDebounceTimer = setTimeout(() => softUpdateCatalog(), 180);
      return;
    }
    if (event.target.id === 'mediaSearch') {
      ui.media.search = event.target.value;
      renderView(ui.data || {});
      return;
    }
    if (event.target.id === 'paymentSearch' || event.target.id === 'orderSearch') {
      ui.management.search = event.target.value;
      renderView(ui.data || {});
      return;
    }
    if (event.target.id === 'reportsSearchInput') {
      if (!ui.reports) ui.reports = {};
      ui.reports.search = event.target.value;
      renderView(ui.data || {});
      const input = document.getElementById('reportsSearchInput');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
      return;
    }
    if (event.target.id === 'reviewsSearchInput') {
      if (!ui.reviews) ui.reviews = {};
      ui.reviews.search = event.target.value;
      renderView(ui.data || {});
      const input = document.getElementById('reviewsSearchInput');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
      return;
    }
    if (event.target.id === 'usersSearchInput') {
      ui.usersSearch = event.target.value;
      renderView(ui.data || {});
      const input = document.getElementById('usersSearchInput');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
      return;
    }
    if (event.target.id === 'pmLogoInput') {
      const val = (event.target.value || '').trim();
      const preview = document.getElementById('pmLogoPreview');
      if (preview) {
        preview.innerHTML = val
          ? `<img src="${escapeHtml(val)}" alt="Logo" style="width:100%;height:100%;object-fit:contain;padding:4px;" onerror="this.parentElement.innerHTML='<div style=\\'font-size:10px;color:var(--danger);text-align:center;\\'>Invalid URL</div>'" />`
          : '<i data-lucide="credit-card" style="width: 24px; height: 24px; color: var(--muted);"></i>';
        if (window.lucide) lucide.createIcons();
      }
      return;
    }
    if (event.target.id === 'pmQrImageInput') {
      const val = (event.target.value || '').trim();
      const preview = document.getElementById('pmQrPreview');
      if (preview) {
        preview.innerHTML = val
          ? `<img src="${escapeHtml(val)}" alt="QR" style="width:100%;height:100%;object-fit:contain;padding:4px;" onerror="this.parentElement.innerHTML='<div style=\\'font-size:10px;color:var(--danger);text-align:center;\\'>Invalid URL</div>'" />`
          : '<i data-lucide="qr-code" style="width: 32px; height: 32px; color: var(--muted);"></i>';
        if (window.lucide) lucide.createIcons();
      }
      return;
    }
  });
  document.addEventListener('change', (event) => {
    if (event.target.id === 'categoryFilter') {
      ui.filters.category = event.target.value;
      ui.page = 1;
      persistCatalogPrefs();
      renderView(ui.data || {});
      return;
    }
    if (event.target.id === 'statusFilter') {
      ui.filters.status = event.target.value;
      ui.page = 1;
      persistCatalogPrefs();
      renderView(ui.data || {});
      return;
    }
    if (event.target.id === 'sortFilter') {
      ui.sort = event.target.value;
      ui.page = 1;
      persistCatalogPrefs();
      renderView(ui.data || {});
      return;
    }
    if (event.target.id === 'pageSizeFilter') {
      ui.catalogPageSize = Number(event.target.value) || 8;
      ui.page = 1;
      persistCatalogPrefs();
      renderView(ui.data || {});
      return;
    }
    if (event.target.id === 'mediaFolderFilter') {
      ui.media.folder = event.target.value || 'all';
      ui.media.page = 1;
      renderView(ui.data || {});
      return;
    }
    if (event.target.id === 'mediaTypeFilter') {
      ui.media.type = event.target.value || 'all';
      ui.media.page = 1;
      renderView(ui.data || {});
      return;
    }
    if (event.target.id === 'mediaSortFilter') {
      ui.media.sort = event.target.value || 'newest';
      ui.media.page = 1;
      renderView(ui.data || {});
      return;
    }
    if (event.target.id === 'mediaPageSizeFilter') {
      ui.media.pageSize = event.target.value === 'all' ? 'all' : (Number(event.target.value) || 36);
      ui.media.page = 1;
      renderView(ui.data || {});
      return;
    }
    if (event.target.id === 'paymentStatusFilter' || event.target.id === 'orderStatusFilter') {
      ui.management.status = event.target.value || 'all';
      renderView(ui.data || {});
      return;
    }
    if (event.target.id === 'paymentMethodFilter' || event.target.id === 'orderMethodFilter') {
      ui.management.method = event.target.value || 'all';
      renderView(ui.data || {});
      return;
    }
    if (event.target.id === 'paymentDateFilter' || event.target.id === 'orderDateFilter') {
      ui.management.date = event.target.value || 'all';
      renderView(ui.data || {});
      return;
    }
    if (event.target.id === 'pmLogoFileInput') {
      const file = event.target.files?.[0];
      if (file) {
        showToast('Uploading payment method logo...', 'info');
        const preview = document.getElementById('pmLogoPreview');
        const input = document.getElementById('pmLogoInput');
        if (preview) preview.innerHTML = '<div style="font-size:10px;color:var(--muted);text-align:center;">Uploading...</div>';

        const reader = new FileReader();
        reader.onload = (e) => {
          const rawDataUrl = e.target.result;
          uploadAsset(file, 'logos').then((res) => {
            const finalUrl = res.publicUrl || rawDataUrl;
            if (input) input.value = finalUrl;
            if (preview) preview.innerHTML = `<img src="${finalUrl}" alt="Logo" style="width:100%;height:100%;object-fit:contain;padding:4px;" />`;
            showToast('Payment method logo uploaded!', 'success');
          }).catch((err) => {
            // Instant local fallback so upload never fails
            if (input) input.value = rawDataUrl;
            if (preview) preview.innerHTML = `<img src="${rawDataUrl}" alt="Logo" style="width:100%;height:100%;object-fit:contain;padding:4px;" />`;
            showToast('Payment method logo attached!', 'success');
          });
        };
        reader.readAsDataURL(file);
      }
      return;
    }
    if (event.target.id === 'pmQrFileInput') {
      const file = event.target.files?.[0];
      if (file) {
        showToast('Uploading payment QR code...', 'info');
        const preview = document.getElementById('pmQrPreview');
        const input = document.getElementById('pmQrImageInput');
        if (preview) preview.innerHTML = '<div style="font-size:10px;color:var(--muted);text-align:center;">Uploading...</div>';

        // Auto-decode UPI ID directly from uploaded QR image
        const reader = new FileReader();
        reader.onload = (e) => {
          const rawDataUrl = e.target.result;
          try {
            const img = new Image();
            img.onload = () => {
              try {
                if (typeof window.jsQR === 'function') {
                  const canvas = document.createElement('canvas');
                  canvas.width = img.width;
                  canvas.height = img.height;
                  const ctx = canvas.getContext('2d', { willReadFrequently: true });
                  ctx.drawImage(img, 0, 0);
                  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                  const code = window.jsQR(imgData.data, imgData.width, imgData.height);
                  if (code && code.data) {
                    const match = code.data.match(/[?&]pa=([^&]+)/i);
                    if (match && match[1]) {
                      const detectedUpi = decodeURIComponent(match[1]).trim();
                      const idInput = document.getElementById('pmIdentifier');
                      if (idInput && detectedUpi) {
                        idInput.value = detectedUpi;
                        showToast(`Auto-detected UPI ID: ${detectedUpi} from QR!`, 'success');
                      }
                    }
                  }
                }
              } catch (_) {}
            };
            img.src = rawDataUrl;
          } catch (_) {}

          uploadAsset(file, 'qrcodes').then((res) => {
            const finalUrl = res.publicUrl || rawDataUrl;
            if (input) input.value = finalUrl;
            if (preview) preview.innerHTML = `<img src="${finalUrl}" alt="QR" style="width:100%;height:100%;object-fit:contain;padding:4px;" />`;
            showToast('Payment QR code uploaded!', 'success');
          }).catch((err) => {
            // Seamless fail-safe fallback: set input & preview directly to rawDataUrl
            if (input) input.value = rawDataUrl;
            if (preview) preview.innerHTML = `<img src="${rawDataUrl}" alt="QR" style="width:100%;height:100%;object-fit:contain;padding:4px;" />`;
            showToast('Payment QR code attached successfully!', 'success');
          });
        };
        reader.readAsDataURL(file);
      }
      return;
    }
    if (event.target.id === 'settingsFaviconFile') {
      const file = event.target.files?.[0];
      if (file) {
        showToast('Uploading favicon image...', 'info');
        uploadAsset(file, 'logos').then((res) => {
          const input = document.getElementById('settingsFaviconInput');
          if (input) input.value = res.publicUrl;
          showToast('Favicon uploaded! Click Save Settings to apply.', 'success');
        }).catch((err) => {
          showToast(err?.message || 'Favicon upload failed', 'danger');
        });
      }
      return;
    }
    if (event.target.id === 'settingsLogoFile') {
      const file = event.target.files?.[0];
      if (file) {
        showToast('Uploading logo image...', 'info');
        uploadAsset(file, 'logos').then((res) => {
          const input = document.getElementById('settingsLogoInput');
          if (input) input.value = res.publicUrl;
          showToast('Logo uploaded! Click Save Settings to apply.', 'success');
        }).catch((err) => {
          showToast(err?.message || 'Logo upload failed', 'danger');
        });
      }
      return;
    }
    if (event.target.id === 'singleUploadFileInput') {
      const file = event.target.files?.[0];
      const node = event.target.dataset.node;
      if (file && node) {
        showToast(`Uploading ${node} image...`, 'info');
        const folder = node === 'hero' ? 'hero' : 'banner';
        uploadAsset(file, folder).then((res) => {
          const input = document.getElementById(`singleUrlInput_${node}`);
          if (input) input.value = res.publicUrl;
          showToast(`${node} image uploaded! Click Save to apply changes.`, 'success');
        }).catch((err) => {
          showToast(err?.message || 'Upload failed', 'danger');
        });
      }
      return;
    }
    if (event.target.matches?.('[data-action="toggle-select-item"]')) {
      toggleSelection(event.target.dataset.id);
      renderView(ui.data || {});
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeCatalogActionMenus();
    }
    if (event.key === 'Escape' && ui.route === 'catalog' && ui.catalogFiltersOpen && isMobileViewport()) {
      ui.catalogFiltersOpen = false;
      persistCatalogPrefs();
      renderView(ui.data || {});
    }
  });
}

function openMediaUpload() {
  openModal(`
    <div class="panel-head">
      <div>
        <h2 class="section-title">Batch Upload Media</h2>
        <p class="section-subtitle">Select or drag & drop multiple images and videos. Uploads directly to storage and updates library.</p>
      </div>
      <button class="btn btn-ghost" data-close-modal type="button"><i data-lucide="x"></i></button>
    </div>
    <form id="mediaUploadForm">
      <div class="form-grid">
        <div class="field">
          <label>Target Folder</label>
          <select class="select" name="folder" id="mediaUploadFolder">
            <option value="images">images/ (General Store Assets)</option>
            <option value="products" selected>products/ (Product Media)</option>
            <option value="categories">categories/ (Category Media)</option>
            <option value="hero">hero/ (Hero Media)</option>
            <option value="banner">banner/ (Banner Media)</option>
            <option value="logos">logos/ (Logos & QR)</option>
          </select>
        </div>
        <div class="field full">
          <div class="media-dropzone" id="mediaDropzone">
            <i data-lucide="upload-cloud" style="width: 44px; height: 44px; color: #818cf8; margin-bottom: 6px;"></i>
            <strong style="font-size: 14.5px; color: var(--text);">Click or Drag & Drop multiple files here</strong>
            <p style="font-size: 12px; color: var(--muted); margin: 2px 0 0 0;">Images (JPG, PNG, WEBP, GIF) and Videos (MP4, WEBM, MOV)</p>
            <input type="file" id="mediaMultiFileInput" name="files" accept="image/*,video/*" multiple style="display:none;" />
          </div>
        </div>
      </div>
      <div id="mediaUploadQueue" class="upload-queue-list"></div>
      <div class="toolbar" style="margin-top:20px; justify-content:flex-end;">
        <button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>
        <button type="submit" class="btn btn-primary" id="mediaSubmitUploadBtn" disabled style="display:inline-flex; align-items:center; gap:6px; font-weight:700;">
          <i data-lucide="upload"></i> Select Files to Upload
        </button>
      </div>
      <div class="section-subtitle" id="mediaProgress" style="margin-top:12px; font-weight:600;"></div>
    </form>
  `);

  let queueFiles = [];
  const dropzone = document.getElementById('mediaDropzone');
  const fileInput = document.getElementById('mediaMultiFileInput');
  const queueEl = document.getElementById('mediaUploadQueue');
  const submitBtn = document.getElementById('mediaSubmitUploadBtn');

  const updateQueueDisplay = () => {
    if (!queueFiles.length) {
      if (queueEl) queueEl.innerHTML = '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i data-lucide="upload"></i> Select Files to Upload';
      }
      return;
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i data-lucide="upload-cloud"></i> Upload ${queueFiles.length} File${queueFiles.length > 1 ? 's' : ''}`;
    }
    if (queueEl) {
      queueEl.innerHTML = queueFiles.map((f, i) => `
        <div class="upload-queue-item">
          <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
            <span style="font-weight:700; color:var(--primary);">#${i + 1}</span>
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:240px;" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
            <span style="color:var(--muted); font-size:11px;">(${(f.size / 1024 / 1024).toFixed(2)} MB)</span>
          </div>
          <span class="badge ${f.type.startsWith('video/') ? 'type-vid' : 'type-img'}" style="font-size:10px;">${f.type.startsWith('video/') ? 'VIDEO' : 'IMAGE'}</span>
        </div>
      `).join('');
    }
    if (window.lucide) lucide.createIcons();
  };

  dropzone?.addEventListener('click', () => fileInput?.click());
  dropzone?.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer?.files?.length) {
      queueFiles = Array.from(e.dataTransfer.files);
      updateQueueDisplay();
    }
  });
  fileInput?.addEventListener('change', (e) => {
    if (e.target?.files?.length) {
      queueFiles = Array.from(e.target.files);
      updateQueueDisplay();
    }
  });

  const form = document.getElementById('mediaUploadForm');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!queueFiles.length) return;
    await handleBatchMediaUpload(form, queueFiles);
  });
}

async function handleBatchMediaUpload(form, files = []) {
  if (!files.length) return;
  const folder = normalizeStorageFolder(form.querySelector('[name="folder"]')?.value || 'products');
  const progress = form.querySelector('#mediaProgress');
  const submitBtn = form.querySelector('#mediaSubmitUploadBtn');

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Uploading...';
    if (window.lucide) lucide.createIcons();
  }

  let successCount = 0;
  let failedCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileNum = i + 1;
    if (progress) {
      progress.textContent = `Uploading file ${fileNum} of ${files.length}: ${file.name}...`;
    }
    try {
      const result = await uploadAsset(file, folder, (pct) => {
        if (progress) progress.textContent = `Uploading file ${fileNum}/${files.length}: ${file.name} (${pct}%)`;
      });
      const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
      await saveUploadedMediaRecord(file, result, folder, mediaType, 'manual-upload');
      successCount++;
    } catch (err) {
      failedCount++;
      console.error('Batch upload item error:', err);
    }
  }

  if (successCount > 0) {
    showToast(`Successfully uploaded ${successCount} media asset${successCount > 1 ? 's' : ''}!`, 'success');
  }
  if (failedCount > 0) {
    showToast(`Failed to upload ${failedCount} asset${failedCount > 1 ? 's' : ''}.`, 'danger');
  }

  closeModal();
  renderView(ui.data || {});
}

async function handleMediaUpload(form) {
  const fileInput = form.querySelector('input[type="file"]');
  const files = Array.from(fileInput?.files || []);
  if (!files.length) {
    showToast('Please pick a file to upload.', 'warning');
    return;
  }
  await handleBatchMediaUpload(form, files);
}

async function handleRecordMediaUpload(form, node, next) {
  try {
    const withMedia = await uploadRecordMedia(form, node, next);
    return withMedia;
  } catch (error) {
    throw error;
  }
}

let syncOrdersDebounceTimer = null;
let _lastSyncedOrdersKey = '';
function syncRealApprovedOrdersToSettings(data) {
  if (syncOrdersDebounceTimer) return;
  syncOrdersDebounceTimer = setTimeout(() => {
    syncOrdersDebounceTimer = null;
    try {
      const rawOrders = data.orders || {};
      const ordersList = Object.entries(rawOrders).map(([id, o]) => ({ ...(o || {}), id }));
      if (!ordersList.length) return;

      const approved = ordersList.filter((o) => isPaidOrder(o));
      if (!approved.length) return;

      approved.sort((a, b) => orderDateValue(b) - orderDateValue(a));

      const topOrders = approved.slice(0, 10).map((o) => {
        const name = orderProductName(o);
        return {
          id: o.id,
          name,
          productName: name,
          amount: o.amount || o.amountINR || '',
          approvedAt: orderDateValue(o) || Date.now(),
        };
      });

      const currentSettings = data.settings || {};
      const existing = Array.isArray(currentSettings.recentApproved) ? currentSettings.recentApproved : [];

      const topKey = topOrders.map((o) => o.id + '::' + o.name).join('||');
      const existKey = existing.map((o) => (o.id || '') + '::' + (o.name || o.productName || '')).join('||');

      if (topKey !== existKey && topOrders.length > 0 && topKey !== _lastSyncedOrdersKey) {
        _lastSyncedOrdersKey = topKey;
        updateRecord('settings', null, {
          ...currentSettings,
          recentApproved: topOrders,
        }).catch(() => {});
      }
    } catch (_) {}
  }, 1000);
}

// Instant initial render from cache (0ms - data never disappears on refresh)
initTheme();
attachGlobalHandlers();
ui.data = getSnapshot();

// Subscribe to state updates for seamless live sync
let isInitialBoot = true;
subscribe((data) => {
  ui.data = data;
  if (!isInitialBoot) {
    renderView(data);
    syncRealApprovedOrdersToSettings(data);
  }
});

// Initial route handling renders the active route cleanly ONCE from cache
initRouteHandling();
isInitialBoot = false;

// Protect route verifies auth and activates authenticated realtime sync
protectRoute((user) => {
  syncTopbar(user);
  startRealtime(true);
});


