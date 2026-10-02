import { db, ref, onValue, get, set, update, remove, auth, onAuthStateChanged } from './firebase.js';
import { RTDB_NODES } from './config.js';
import { safeJson, slugify, uid } from './utils.js';

const CACHE_KEY = 'linkadda_admin_store_cache_v4';

function loadCachedStore() {
  const initial = {
    hero: {},
    categories: {},
    products: {},
    events: {},
    banner: {},
    faq: {},
    testimonials: {},
    settings: {},
    payment: {},
    orders: {},
    order_approvals: {},
    analytics: {},
    media: {},
    visitors: {},
    customers: {},
    sellers: {},
    seller_applications: {},
    public_sellers: {},
    reports: {},
  };

  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const isStale = parsed.timestamp && (Date.now() - Number(parsed.timestamp) > 24 * 3600 * 1000);
        if (!isStale) {
          Object.keys(initial).forEach((k) => {
            if (parsed[k] && typeof parsed[k] === 'object' && Object.keys(parsed[k]).length > 0) {
              initial[k] = parsed[k];
            }
          });
        }
      }
    }
  } catch (_) {}

  return initial;
}

const STORE = loadCachedStore();
const subscribers = new Set();
const activeUnsubs = new Map();
let emitTimer = null;
let saveCacheTimer = null;

function syncWebsiteCache() {
  try {
    const liveCache = {
      categories: STORE.categories || {},
      products: STORE.products || {},
      banner: STORE.banner || {},
      timestamp: Date.now(),
    };
    localStorage.setItem('linkadda_cached_live_data', JSON.stringify(liveCache));
    if (STORE.payment) {
      localStorage.setItem('linkadda_payment_payment', JSON.stringify(STORE.payment));
    }
    if (STORE.settings) {
      localStorage.setItem('linkadda_payment_settings', JSON.stringify(STORE.settings));
    }
    if (STORE.faq) {
      localStorage.setItem('linkadda_cached_faq', JSON.stringify(STORE.faq));
    }
  } catch (_) {}
}

function saveStoreCache() {
  if (saveCacheTimer) return;
  saveCacheTimer = setTimeout(() => {
    saveCacheTimer = null;
    try {
      const updatedCache = {
        settings: STORE.settings || {},
        payment: STORE.payment || {},
        hero: STORE.hero || {},
        banner: STORE.banner || {},
        faq: STORE.faq || {},
        testimonials: STORE.testimonials || {},
        categories: STORE.categories || {},
        products: STORE.products || {},
        orders: STORE.orders || {},
        order_approvals: STORE.order_approvals || {},
        events: STORE.events || {},
        visitors: STORE.visitors || {},
        customers: STORE.customers || {},
        analytics: STORE.analytics || {},
        sellers: STORE.sellers || {},
        seller_applications: STORE.seller_applications || {},
        reports: STORE.reports || {},
        timestamp: Date.now(),
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(updatedCache));
      syncWebsiteCache();
    } catch (_) {}
  }, 250);
}

function emit() {
  if (emitTimer) clearTimeout(emitTimer);
  emitTimer = setTimeout(() => {
    emitTimer = null;
    saveStoreCache();
    const snapshot = getSnapshot();
    subscribers.forEach((fn) => {
      try {
        fn(snapshot);
      } catch (err) {
        console.error('Subscriber error:', err);
      }
    });
  }, 200);
}

export function getSnapshot() {
  const copy = {};
  for (const k in STORE) {
    copy[k] = typeof STORE[k] === 'object' && STORE[k] !== null ? { ...STORE[k] } : STORE[k];
  }
  return copy;
}

export function subscribe(fn) {
  subscribers.add(fn);
  fn(getSnapshot());
  return () => subscribers.delete(fn);
}

function attachNode(key, mode = 'collection') {
  const nodeName = RTDB_NODES[key];
  if (!nodeName) return;

  // Clean up previous subscription if any
  if (activeUnsubs.has(key)) {
    try {
      activeUnsubs.get(key)();
    } catch (_) {}
    activeUnsubs.delete(key);
  }

  try {
    const unsub = onValue(
      ref(db, nodeName),
      (snap) => {
        const val = snap.val();
        STORE[key] = val !== null && val !== undefined ? val : (mode === 'singleton' ? {} : {});
        emit();
      },
      (err) => {
        // If permission denied before auth completes, remove from activeUnsubs so authenticated startRealtime can re-attach!
        activeUnsubs.delete(key);
        if (err?.code !== 'PERMISSION_DENIED') {
          console.warn(`RTDB node ${key} notice:`, err?.message || err);
        }
      }
    );
    activeUnsubs.set(key, unsub);

    // Initial query to fetch live data immediately
    get(ref(db, nodeName))
      .then((snap) => {
        if (snap.exists()) {
          STORE[key] = snap.val() || (mode === 'singleton' ? {} : {});
        } else {
          STORE[key] = mode === 'singleton' ? {} : {};
        }
        emit();
      })
      .catch(() => {});

    // For orders: also listen directly to events/orders and order_approvals where web checkout posts directly
    if (key === 'orders') {
      if (activeUnsubs.has('events_orders_stream')) {
        try { activeUnsubs.get('events_orders_stream')(); } catch (_) {}
        activeUnsubs.delete('events_orders_stream');
      }
      try {
        const backupUnsub = onValue(
          ref(db, 'events/orders'),
          (snap) => {
            const val = snap.val();
            if (val && typeof val === 'object') {
              if (!STORE.orders) STORE.orders = {};
              Object.entries(val).forEach(([oId, ord]) => {
                if (ord && typeof ord === 'object') {
                  const cleanId = String(ord.id || ord.orderId || oId).replace(/[^a-zA-Z0-9_-]/g, '');
                  if (cleanId) {
                    STORE.orders[cleanId] = { ...(STORE.orders[cleanId] || {}), ...ord, id: cleanId };
                  }
                }
              });
              emit();
            }
          },
          () => {}
        );
        activeUnsubs.set('events_orders_stream', backupUnsub);
      } catch (_) {}

      if (activeUnsubs.has('order_approvals_stream')) {
        try { activeUnsubs.get('order_approvals_stream')(); } catch (_) {}
        activeUnsubs.delete('order_approvals_stream');
      }
      try {
        const appUnsub = onValue(
          ref(db, 'order_approvals'),
          (snap) => {
            const val = snap.val();
            if (val && typeof val === 'object') {
              if (!STORE.order_approvals) STORE.order_approvals = {};
              if (!STORE.orders) STORE.orders = {};
              STORE.order_approvals = val;
              Object.entries(val).forEach(([oId, ord]) => {
                if (ord && typeof ord === 'object') {
                  const cleanId = String(ord.id || ord.orderId || oId).replace(/[^a-zA-Z0-9_-]/g, '');
                  if (cleanId) {
                    STORE.orders[cleanId] = { ...(STORE.orders[cleanId] || {}), ...ord, id: cleanId };
                  }
                }
              });
              emit();
            }
          },
          () => {}
        );
        activeUnsubs.set('order_approvals_stream', appUnsub);
      } catch (_) {}
    }
  } catch (err) {
    console.warn(`Attach node ${key} error:`, err);
  }
}

function isSingleton(node) {
  return ['hero', 'banner', 'settings', 'payment', 'analytics'].includes(node);
}

// Nodes required by specific view routes — prioritized for fast initial load
export const ROUTE_NODE_REQUIREMENTS = {
  dashboard: ['settings', 'orders', 'visitors', 'products', 'categories', 'events'],
  catalog: ['products', 'categories', 'media'],
  products: ['products', 'categories', 'media'],
  categories: ['categories', 'products'],
  reviews: ['reviews'],
  media: ['media'],
  hero: ['hero'],
  banner: ['banner'],
  faq: ['faq'],
  testimonials: ['testimonials'],
  settings: ['settings'],
  payment: ['payment'],
  orders: ['orders', 'products', 'sellers', 'events'],
  screenshots: ['orders', 'events'],
  reports: ['reports', 'products', 'sellers'],
  users: ['customers'],
  sellers: ['sellers', 'seller_applications', 'public_sellers', 'products', 'events', 'store_followers'],
  analytics: ['analytics', 'visitors', 'orders', 'events'],
};

// All available nodes in Linkadda RTDB
const ALL_RTDB_NODES = [
  'settings', 'orders', 'visitors', 'products', 'categories', 'events',
  'media', 'reviews', 'faq', 'testimonials', 'hero', 'banner',
  'payment', 'customers', 'sellers', 'seller_applications', 'public_sellers', 'analytics', 'reports', 'store_followers'
];

export function ensureNodesForRoute(route = 'dashboard') {
  const cleanRoute = (route || 'dashboard').replace(/^#\/?/, '').trim() || 'dashboard';
  const nodes = ROUTE_NODE_REQUIREMENTS[cleanRoute] || ROUTE_NODE_REQUIREMENTS.dashboard;
  nodes.forEach((key) => {
    if (!activeUnsubs.has(key)) {
      attachNode(key, isSingleton(key) ? 'singleton' : 'collection');
    }
  });
}

let backgroundWarmupTimer = null;
export function scheduleBackgroundNodes() {
  if (backgroundWarmupTimer) clearTimeout(backgroundWarmupTimer);
  backgroundWarmupTimer = setTimeout(() => {
    backgroundWarmupTimer = null;
    let delay = 0;
    ALL_RTDB_NODES.forEach((key) => {
      if (!activeUnsubs.has(key)) {
        setTimeout(() => {
          if (!activeUnsubs.has(key)) {
            attachNode(key, isSingleton(key) ? 'singleton' : 'collection');
          }
        }, delay);
        delay += 60;
      }
    });
  }, 150);
}

let isRealtimeStarted = false;
export function startRealtime(force = false) {
  if (isRealtimeStarted && !force) return;
  isRealtimeStarted = true;

  if (force) {
    // When forced (e.g. user authenticated or explicit refresh), cancel old unsubs and re-attach all nodes cleanly
    activeUnsubs.forEach((unsub) => {
      try { unsub(); } catch (_) {}
    });
    activeUnsubs.clear();
  }

  // Connect active route nodes first
  const currentRoute = window.location.hash.replace(/^#\/?/, '') || 'dashboard';
  ensureNodesForRoute(currentRoute);

  // Attach all remaining nodes progressively
  scheduleBackgroundNodes();
}

// On startup: immediately connect public nodes needed for fast catalog / settings rendering
const initialRoute = window.location.hash.replace(/^#\/?/, '') || 'dashboard';
ensureNodesForRoute(initialRoute);

// Automatically bind authenticated listeners to auth state transitions
onAuthStateChanged(auth, (user) => {
  if (user) {
    startRealtime(true);
  }
});

function nodeRef(node, id = null) {
  if (!RTDB_NODES[node]) throw new Error(`Unknown node: ${node}`);
  if (!id) return ref(db, RTDB_NODES[node]);
  const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
  return ref(db, `${RTDB_NODES[node]}/${safeId}`);
}

export async function saveRecord(node, id, data) {
  const payload = {
    ...data,
    id: id || data.id || uid(node),
    updatedAt: Date.now(),
  };
  if (!payload.createdAt) payload.createdAt = Date.now();
  if (isSingleton(node)) {
    STORE[node] = payload;
    emit();
    syncWebsiteCache();
    await set(nodeRef(node), payload);
    return payload;
  }
  if (!STORE[node]) STORE[node] = {};
  STORE[node][payload.id] = payload;
  emit();
  syncWebsiteCache();
  await set(nodeRef(node, payload.id), payload);
  return payload;
}

export async function createRecord(node, data) {
  const payload = {
    ...data,
    id: data.id || uid(node),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  if (isSingleton(node)) {
    STORE[node] = payload;
    emit();
    syncWebsiteCache();
    await set(nodeRef(node), payload);
    return payload;
  }
  if (!STORE[node]) STORE[node] = {};
  STORE[node][payload.id] = payload;
  emit();
  syncWebsiteCache();
  await set(nodeRef(node, payload.id), payload);
  return payload;
}

export async function updateRecord(node, id, data) {
  if (isSingleton(node)) {
    const next = { ...(STORE[node] || {}), ...data, updatedAt: Date.now() };
    STORE[node] = next;
    emit();
    syncWebsiteCache();
    await set(nodeRef(node), next);
    return next;
  }
  const current = STORE[node]?.[id] || {};
  const next = { ...current, ...data, id, updatedAt: Date.now() };
  if (!STORE[node]) STORE[node] = {};
  STORE[node][id] = next;
  emit();
  syncWebsiteCache();
  await update(nodeRef(node, id), { ...data, updatedAt: Date.now() });
  return next;
}

export async function updateRecordsBatch(node, batchMap) {
  const nodeName = RTDB_NODES[node];
  if (!nodeName) throw new Error(`Unknown node: ${node}`);
  if (!STORE[node]) STORE[node] = {};
  for (const [key, val] of Object.entries(batchMap)) {
    if (key.includes('/')) {
      const parts = key.split('/');
      const itemId = parts[0];
      const prop = parts[1];
      if (STORE[node][itemId]) {
        STORE[node][itemId][prop] = val;
      }
    } else {
      STORE[node][key] = { ...(STORE[node][key] || {}), ...(val || {}) };
    }
  }
  emit();
  syncWebsiteCache();
  try {
    await update(ref(db, nodeName), batchMap);
  } catch (err) {
    console.warn(`Direct client SDK update failed for ${nodeName}, fallback handled by caller:`, err);
  }
}

export async function deleteRecord(node, id) {
  if (isSingleton(node)) {
    delete STORE[node];
    emit();
    syncWebsiteCache();
    await set(nodeRef(node), null);
    return;
  }

  if (node === 'orders') {
    await deleteOrders([id]);
    return;
  }

  if (STORE[node] && STORE[node][id]) {
    delete STORE[node][id];
    emit();
    syncWebsiteCache();
  }
  await remove(nodeRef(node, id));
}

export async function deleteOrders(ids) {
  if (!Array.isArray(ids)) ids = [ids];
  const targetIds = ids.map((s) => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '').trim()).filter(Boolean);
  if (targetIds.length === 0) return;

  const targetSet = new Set(targetIds.map((id) => id.toLowerCase()));

  // 1. Remove from in-memory STORE.orders & STORE.events
  if (STORE.orders) {
    Object.keys(STORE.orders).forEach((k) => {
      const cleanK = String(k).replace(/[^a-zA-Z0-9_-]/g, '').trim().toLowerCase();
      if (targetSet.has(cleanK) || targetSet.has(String(STORE.orders[k]?.id || '').toLowerCase()) || targetSet.has(String(STORE.orders[k]?.orderId || '').toLowerCase())) {
        delete STORE.orders[k];
      }
    });
  }
  if (STORE.order_approvals) {
    Object.keys(STORE.order_approvals).forEach((k) => {
      const cleanK = String(k).replace(/[^a-zA-Z0-9_-]/g, '').trim().toLowerCase();
      if (targetSet.has(cleanK) || targetSet.has(String(STORE.order_approvals[k]?.id || '').toLowerCase()) || targetSet.has(String(STORE.order_approvals[k]?.orderId || '').toLowerCase())) {
        delete STORE.order_approvals[k];
      }
    });
  }
  if (STORE.events && STORE.events.orders) {
    Object.keys(STORE.events.orders).forEach((k) => {
      const cleanK = String(k).replace(/[^a-zA-Z0-9_-]/g, '').trim().toLowerCase();
      if (targetSet.has(cleanK) || targetSet.has(String(STORE.events.orders[k]?.id || '').toLowerCase())) {
        delete STORE.events.orders[k];
      }
    });
  }

  // 2. Remove from LocalStorage & SessionStorage cache so listCollection won't resurrect them
  const storageKeys = [
    'jaigram_user_orders', 'jaigram_customer_orders', 'linkadda_user_orders',
    'linkadda_customer_orders', 'linkadda_orders', 'jaigram_orders_backup',
    'linkadda_admin_orders_local', 'jaigram_my_order_ids', 'linkadda_my_order_ids',
  ];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.includes('order') || k.includes('jaigram') || k.includes('linkadda')) && !storageKeys.includes(k)) {
        storageKeys.push(k);
      }
    }
  } catch (_) {}

  storageKeys.forEach((key) => {
    try {
      const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const filtered = parsed.filter((item) => {
            const itemKey = String(typeof item === 'string' ? item : (item?.orderId || item?.id || '')).replace(/[^a-zA-Z0-9_-]/g, '').trim().toLowerCase();
            return !targetSet.has(itemKey);
          });
          localStorage.setItem(key, JSON.stringify(filtered));
        } else if (parsed && typeof parsed === 'object') {
          let changed = false;
          Object.keys(parsed).forEach((k) => {
            const cleanK = String(k).replace(/[^a-zA-Z0-9_-]/g, '').trim().toLowerCase();
            if (targetSet.has(cleanK) || targetSet.has(String(parsed[k]?.id || parsed[k]?.orderId || '').toLowerCase())) {
              delete parsed[k];
              changed = true;
            }
          });
          if (changed) localStorage.setItem(key, JSON.stringify(parsed));
        }
      }
    } catch (_) {}
  });

  // Track deleted order IDs in a blocklist so listCollection never re-ingests them
  try {
    let deletedList = [];
    const rawDel = localStorage.getItem('jaigram_deleted_order_ids');
    if (rawDel) deletedList = JSON.parse(rawDel);
    if (!Array.isArray(deletedList)) deletedList = [];
    targetIds.forEach((id) => {
      if (!deletedList.includes(id)) deletedList.push(id);
    });
    localStorage.setItem('jaigram_deleted_order_ids', JSON.stringify(deletedList.slice(-300)));
  } catch (_) {}

  emit();
  saveStoreCache();

  // 3. Delete from Firebase RTDB nodes directly via client SDK
  targetIds.forEach((cleanId) => {
    try { remove(ref(db, `orders/${cleanId}`)).catch(() => {}); } catch (_) {}
    try { remove(ref(db, `events/orders/${cleanId}`)).catch(() => {}); } catch (_) {}
    try { remove(ref(db, `order_approvals/${cleanId}`)).catch(() => {}); } catch (_) {}
    try { remove(ref(db, `order_approvals/#${cleanId}`)).catch(() => {}); } catch (_) {}
  });

  // 4. Also call backend /api/orders with DELETE for server-side auth token cleanup
  try {
    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:';
    const targetUrl = isLocalHost ? 'https://jaigram.shop/api/orders' : '/api/orders';
    const currentUser = auth.currentUser;
    const token = currentUser ? await currentUser.getIdToken(false) : '';
    fetch(targetUrl, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ orderIds: targetIds }),
    }).catch((err) => console.warn('Backend DELETE error:', err));
  } catch (apiErr) {
    console.warn('Backend /api/orders DELETE notice:', apiErr);
  }
}

export async function fetchLiveOrders() {
  try {
    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:';
    let hasNew = false;

    // 1. Direct Firebase SDK real-time query (Fast, reliable, zero cross-origin timeouts on localhost)
    try {
      const snap = await get(ref(db, 'orders'));
      if (snap.exists()) {
        const val = snap.val();
        if (val && typeof val === 'object') {
          if (!STORE.orders) STORE.orders = {};
          Object.entries(val).forEach(([oId, ord]) => {
            if (ord && typeof ord === 'object') {
              const cleanId = String(ord.id || ord.orderId || oId).replace(/[^a-zA-Z0-9_-]/g, '').trim();
              if (cleanId) {
                STORE.orders[cleanId] = { ...(STORE.orders[cleanId] || {}), ...ord, id: cleanId };
                hasNew = true;
              }
            }
          });
        }
      }
    } catch (_) {}

    try {
      const appSnap = await get(ref(db, 'order_approvals'));
      if (appSnap.exists()) {
        const appVal = appSnap.val();
        if (appVal && typeof appVal === 'object') {
          if (!STORE.order_approvals) STORE.order_approvals = {};
          if (!STORE.orders) STORE.orders = {};
          STORE.order_approvals = appVal;
          Object.entries(appVal).forEach(([oId, ord]) => {
            if (ord && typeof ord === 'object') {
              const cleanId = String(ord.id || ord.orderId || oId).replace(/[^a-zA-Z0-9_-]/g, '').trim();
              if (cleanId) {
                STORE.orders[cleanId] = { ...(STORE.orders[cleanId] || {}), ...ord, id: cleanId };
                hasNew = true;
              }
            }
          });
        }
      }
    } catch (_) {}

    try {
      const evSnap = await get(ref(db, 'events/orders'));
      if (evSnap.exists()) {
        const evVal = evSnap.val();
        if (evVal && typeof evVal === 'object') {
          if (!STORE.orders) STORE.orders = {};
          Object.entries(evVal).forEach(([oId, ord]) => {
            if (ord && typeof ord === 'object') {
              const cleanId = String(ord.id || ord.orderId || oId).replace(/[^a-zA-Z0-9_-]/g, '').trim();
              if (cleanId) {
                STORE.orders[cleanId] = { ...(STORE.orders[cleanId] || {}), ...ord, id: cleanId };
                hasNew = true;
              }
            }
          });
        }
      }
    } catch (_) {}

    // 2. In production, also query /api/orders?all=true with silent fallback
    if (!isLocalHost) {
      try {
        const currentUser = auth.currentUser;
        const token = currentUser ? await currentUser.getIdToken(false) : '';
        const res = await fetch('/api/orders?all=true', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const data = await res.json();
          const ordersList = Array.isArray(data.orders) ? data.orders : (Array.isArray(data) ? data : []);
          if (ordersList.length > 0) {
            ordersList.forEach((ord) => {
              const cleanId = String(ord.id || ord.orderId || '').replace(/[^a-zA-Z0-9_-]/g, '').trim();
              if (cleanId) {
                STORE.orders[cleanId] = { ...(STORE.orders[cleanId] || {}), ...ord, id: cleanId };
                hasNew = true;
              }
            });
          }
        }
      } catch (_) {}
    }

    if (hasNew) {
      emit();
      saveStoreCache();
    }
  } catch (_) {}
  return listCollection('orders');
}

export async function duplicateRecord(node, id) {
  const source = getItem(node, id);
  if (!source) throw new Error('Record not found');
  const clone = safeJson(source);
  clone.slug = `${slugify(clone.slug || clone.title || id)}-copy`;
  clone.title = clone.title ? `${clone.title} Copy` : clone.title;
  clone.id = uid(node);
  clone.createdAt = Date.now();
  clone.updatedAt = Date.now();
  if (isSingleton(node)) {
    await set(nodeRef(node), clone);
    return clone;
  }
  await set(nodeRef(node, clone.id), clone);
  return clone;
}

export function listCollection(node) {
  const value = STORE[node] || {};
  let list = Object.entries(value).map(([id, item]) => ({ ...(item || {}), id: item?.id || id }));

  // COMPREHENSIVE DEDUPLICATED ORDER UNIFICATION:
  // Merges orders from:
  // 1. Firebase RTDB /orders
  // 2. Firebase RTDB /events/orders (backup direct checkout stream)
  // 3. Firebase RTDB /events (any order-type event records)
  // 4. Browser LocalStorage & SessionStorage across customer/user/admin sessions
  // 5. Normalizes dates/timestamps so no order displays "365 days ago" or corrupt data
  if (node === 'orders') {
    const ordersMap = new Map();
    let deletedBlocklist = new Set();
    try {
      const rawDel = localStorage.getItem('jaigram_deleted_order_ids');
      if (rawDel) {
        const parsedDel = JSON.parse(rawDel);
        if (Array.isArray(parsedDel)) {
          parsedDel.forEach((dId) => deletedBlocklist.add(String(dId).replace(/[^a-zA-Z0-9_-]/g, '').trim().toLowerCase()));
        }
      }
    } catch (_) {}

    const addOrder = (ord, fallbackId = '') => {
      if (!ord || typeof ord !== 'object') return;
      const rawId = ord.id || ord.orderId || fallbackId || '';
      const cleanId = String(rawId).replace(/^#+/, '').replace(/[^a-zA-Z0-9_-]/g, '').trim();
      if (!cleanId) return;

      const lowerCleanId = cleanId.toLowerCase();
      // CRITICAL SECURITY: Never ingest products, sellers, categories or non-order items
      if (lowerCleanId.startsWith('prod_') || lowerCleanId.startsWith('seller_') || lowerCleanId.startsWith('cat_') || lowerCleanId.startsWith('banner_') || lowerCleanId.startsWith('usr_') || lowerCleanId.startsWith('cust_') || lowerCleanId.startsWith('vis_')) return;
      if (ord.inStock !== undefined || ord.pricing !== undefined || (ord.stock !== undefined && !ord.orderId && !ord.paymentMethod)) return;
      if (ord.sellerStoreName !== undefined && !ord.orderId && !ord.customerEmail && !ord.paymentMethod) return;
      if (ord.type === 'category' || ord.type === 'seller' || ord.type === 'product' || ord.type === 'visitor' || ord.type === 'telegram_click' || ord.type === 'review_submission') return;
      
      // An order MUST have at least an orderId, paymentMethod, customerEmail, customerUid, or be wallet_topup
      const hasOrderSignature = Boolean(ord.orderId || ord.paymentMethod || ord.customerEmail || ord.customerUid || ord.utr || ord.type === 'wallet_topup' || ord.pkg === 'wallet_topup');
      if (!hasOrderSignature && !ord.status) return;

      // Deduplicate prefixes: JG-153831, LA-153831, ORD-153831, 153831 all map to the exact same order
      const baseKey = lowerCleanId.replace(/^(jg|la|ord)[_-]?/, '');
      const lookupKey = (baseKey && baseKey.length >= 4) ? baseKey : lowerCleanId;
      if (deletedBlocklist.has(lookupKey) || deletedBlocklist.has(lowerCleanId)) return;

      const existing = ordersMap.get(lookupKey) || {};

      // Preserve authentic timestamp - do NOT overwrite real timestamps
      let ts = Number(ord.createdAt || ord.timestamp || existing.createdAt || existing.timestamp || 0);
      if (!ts) {
        if (ord.date) {
          const parsedD = Date.parse(ord.date);
          if (!isNaN(parsedD)) ts = parsedD;
        }
        if (!ts) ts = Date.now();
      }

      const displayOrderId = ord.displayOrderId || (cleanId.startsWith('JG-') ? ('#' + cleanId) : (String(rawId).startsWith('#') ? rawId : ('#JG-' + cleanId.replace(/^JG-/, ''))));
      const amount = Number(ord.amount !== undefined ? ord.amount : (ord.price !== undefined ? ord.price : (existing.amount || 0)));

      // Title & Type detection
      const isTopup = ord.type === 'wallet_topup' || ord.pkg === 'wallet_topup' || ord.productId === 'wallet_topup' ||
        (ord.productName && ord.productName.toLowerCase().includes('wallet recharge')) ||
        (ord.title && ord.title.toLowerCase().includes('wallet recharge')) ||
        existing.type === 'wallet_topup';

      const prodTitle = ord.productName || ord.title || ord.displayTitle || ord.productTitle || existing.productName || existing.title || (isTopup ? 'JaiGram Wallet Recharge' : 'Digital Media Pass');
      const prodImage = ord.image || ord.productImage || ord.thumbnail || existing.image || existing.productImage || '';
      const utrVal = ord.utr || ord.utrNumber || ord.upiRef || ord.transactionId || ord.txnId || ord.refId || ord.referenceId || ord.paymentUtr || ord.bankRef || existing.utr || '';

      const merged = {
        ...existing,
        ...ord,
        id: cleanId,
        orderId: cleanId,
        displayOrderId,
        amount,
        amountDisplay: ord.amountDisplay || `₹${amount.toFixed(2)}`,
        status: ord.status || ord.orderStatus || existing.status || 'pending',
        type: isTopup ? 'wallet_topup' : (ord.type || existing.type || 'product_purchase'),
        pkg: isTopup ? 'wallet_topup' : (ord.pkg || existing.pkg || 'product'),
        createdAt: ts,
        timestamp: ts,
        date: ord.date || new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        productName: prodTitle,
        title: prodTitle,
        image: prodImage,
        productImage: prodImage,
        thumbnail: prodImage,
        sellerName: (() => {
          const rawSeller = ord.sellerName || ord.seller || existing.sellerName || '';
          if (rawSeller && rawSeller !== 'JaiGram Verified' && rawSeller !== 'LinkAdda Verified' && rawSeller !== 'JaiGram Official' && rawSeller !== 'LinkAdda Official') {
            return rawSeller;
          }
          const prodId = String(ord.productId || ord.pId || ord.product_id || existing.productId || '').trim();
          const pTitle = String(prodTitle).trim().toLowerCase();
          const prods = STORE.products || {};
          const matchedProd = Object.values(prods).find(p => {
            if (!p || typeof p !== 'object') return false;
            if (prodId && (String(p.id || p.key || '') === prodId || String(p.productId || '') === prodId)) return true;
            if (pTitle) {
              const t = String(p.title || p.name || p.productName || '').trim().toLowerCase();
              if (t && (t === pTitle || t.includes(pTitle) || pTitle.includes(t))) return true;
            }
            return false;
          });
          if (matchedProd) {
            const foundSeller = matchedProd.sellerStoreName || matchedProd.sellerName || matchedProd.storeName || matchedProd.seller || '';
            if (foundSeller && foundSeller !== 'JaiGram Verified' && foundSeller !== 'LinkAdda Verified') return foundSeller;
          }
          return 'Trusted brother';
        })(),
        seller: (() => {
          const rawSeller = ord.sellerName || ord.seller || existing.sellerName || '';
          if (rawSeller && rawSeller !== 'JaiGram Verified' && rawSeller !== 'LinkAdda Verified' && rawSeller !== 'JaiGram Official' && rawSeller !== 'LinkAdda Official') {
            return rawSeller;
          }
          const prodId = String(ord.productId || ord.pId || ord.product_id || existing.productId || '').trim();
          const pTitle = String(prodTitle).trim().toLowerCase();
          const prods = STORE.products || {};
          const matchedProd = Object.values(prods).find(p => {
            if (!p || typeof p !== 'object') return false;
            if (prodId && (String(p.id || p.key || '') === prodId || String(p.productId || '') === prodId)) return true;
            if (pTitle) {
              const t = String(p.title || p.name || p.productName || '').trim().toLowerCase();
              if (t && (t === pTitle || t.includes(pTitle) || pTitle.includes(t))) return true;
            }
            return false;
          });
          if (matchedProd) {
            const foundSeller = matchedProd.sellerStoreName || matchedProd.sellerName || matchedProd.storeName || matchedProd.seller || '';
            if (foundSeller && foundSeller !== 'JaiGram Verified' && foundSeller !== 'LinkAdda Verified') return foundSeller;
          }
          return 'Trusted brother';
        })(),
        customerName: ord.customerName || ord.buyerName || ord.name || ord.customerEmail || existing.customerName || 'Customer',
        customerEmail: ord.customerEmail || ord.email || ord.buyerEmail || existing.customerEmail || '',
        customerUid: ord.customerUid || ord.buyerUid || ord.uid || existing.customerUid || '',
        paymentMethod: ord.paymentMethod || ord.method || existing.paymentMethod || 'UPI',
        screenshot: ord.screenshot || ord.screenshotUrl || ord.paymentProof || ord.proofUrl || existing.screenshot || '',
        screenshotUrl: ord.screenshotUrl || ord.screenshot || ord.paymentProof || ord.proofUrl || existing.screenshotUrl || '',
        paymentProof: ord.paymentProof || ord.screenshotUrl || ord.proofUrl || ord.screenshot || existing.paymentProof || '',
        proofUrl: ord.proofUrl || ord.paymentProof || ord.screenshotUrl || ord.screenshot || existing.proofUrl || '',
        utr: utrVal,
        utrNumber: utrVal,
        upiRef: utrVal,
        transactionId: utrVal,
      };

      ordersMap.set(lookupKey, merged);
    };

    // 1. Ingest base STORE.orders
    list.forEach((o) => addOrder(o, o.id));

    // 1b. Ingest STORE.order_approvals (Direct public RTDB order stream)
    if (STORE.order_approvals && typeof STORE.order_approvals === 'object') {
      Object.entries(STORE.order_approvals).forEach(([id, o]) => addOrder(o, id));
    }

    // 2. Ingest STORE.events.orders if present
    if (STORE.events && typeof STORE.events === 'object') {
      const evOrders = STORE.events.orders || {};
      if (typeof evOrders === 'object') {
        Object.entries(evOrders).forEach(([id, o]) => addOrder(o, id));
      }
      // Also check general events list for order events
      Object.entries(STORE.events).forEach(([id, ev]) => {
        if (ev && typeof ev === 'object' && (ev.type === 'order' || ev.orderId || ev.productName)) {
          addOrder(ev, id);
        }
      });
    }

    // 3. Scan ONLY explicit orders storage keys (never scan raw jaigram/linkadda keys that contain products/sellers!)
    const storageKeys = [
      'jaigram_user_orders', 'jaigram_customer_orders', 'linkadda_user_orders',
      'linkadda_customer_orders', 'linkadda_orders', 'jaigram_orders_backup',
      'linkadda_admin_orders_local'
    ];

    storageKeys.forEach((key) => {
      try {
        const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          const items = Array.isArray(parsed) ? parsed : (typeof parsed === 'object' ? Object.values(parsed) : []);
          items.forEach((item) => {
            if (item && typeof item === 'object' && (item.orderId || item.id || item.paymentMethod || item.type === 'wallet_topup')) {
              addOrder(item);
            }
          });
        }
      } catch (_) {}
    });

    list = Array.from(ordersMap.values());
    list.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }

  return list;
}

export function getItem(node, id) {
  return STORE[node]?.[id] || null;
}

export function stats() {
  const products = listCollection('products').filter((item) => item.status !== 'deleted');
  const categories = listCollection('categories').filter((item) => item.status !== 'deleted').length;
  const orders = listCollection('orders');
  const visitors = listCollection('visitors');
  const events = listCollection('events');
  const today = new Date().toISOString().slice(0, 10);
  const isOrderClick = (item) => {
    const t = String(item.type || '').toLowerCase();
    if (t === 'telegram_click' || t === 'review_submission' || t === 'visitor') return false;
    return t.includes('order') || t.includes('click') || t.includes('buy') || Boolean(item.productId || item.package || item.productName);
  };
  const todaysOrders = orders.filter((item) => String(item.date || '').slice(0, 10) === today).length;
  const pureVisitors = visitors.filter((item) => !isOrderClick(item));
  const todaysVisitors = pureVisitors.filter((item) => String(item.date || '').slice(0, 10) === today).length;
  const allClicks = [...events, ...visitors.filter(isOrderClick)];
  const directProductClicks = products.reduce((sum, p) => sum + Number(p.clicks || p.orderClicks || 0), 0);
  const eventsClicks = allClicks.filter(isOrderClick).length;
  const todaysClicks = allClicks.filter((item) => String(item.date || '').slice(0, 10) === today && isOrderClick(item)).length;
  return {
    products: products.length,
    categories,
    orders: orders.length,
    todaysOrders,
    visitors: pureVisitors.length,
    todaysVisitors,
    clicks: eventsClicks > 0 ? eventsClicks : directProductClicks,
    todaysClicks,
  };
}

export function recentOrders(limit = 6) {
  return listCollection('orders')
    .sort((a, b) => (Number(b.timestamp || b.createdAt || b.updatedAt || 0)) - (Number(a.timestamp || a.createdAt || a.updatedAt || 0)))
    .slice(0, limit);
}

export function recentProducts(limit = 6) {
  return listCollection('products')
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, limit);
}

export function recentActivity(limit = 10) {
  const prettyPage = (page) => {
    const value = String(page || 'Visit').toLowerCase();
    if (value === 'index' || value === 'home' || value === 'homepage') return 'Homepage';
    return page || 'Visit';
  };
  const orders = recentOrders(limit).map((item) => ({
    type: 'order',
    title: item.package || item.title || 'Order',
    meta: item.status || 'pending',
    timestamp: item.timestamp || item.updatedAt || Date.now(),
  }));
  const events = listCollection('events')
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit)
    .map((item) => ({
      type: item.type || 'event',
      title: item.package || item.title || item.label || 'Event',
      meta: item.page || item.source || item.path || '',
      timestamp: item.timestamp || Date.now(),
    }));
  const visitors = listCollection('visitors')
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit)
    .map((item) => ({
      type: 'visitor',
      title: prettyPage(item.page),
      meta: item.date || '',
      timestamp: item.timestamp || Date.now(),
    }));
  return [...orders, ...events, ...visitors]
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit);
}
