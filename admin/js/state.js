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
    analytics: {},
    media: {},
    visitors: {},
    customers: {},
    sellers: {},
    seller_applications: {},
    public_sellers: {},
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
        events: STORE.events || {},
        visitors: STORE.visitors || {},
        customers: STORE.customers || {},
        analytics: STORE.analytics || {},
        sellers: STORE.sellers || {},
        seller_applications: STORE.seller_applications || {},
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
  orders: ['orders'],
  screenshots: ['orders'],
  users: ['customers'],
  sellers: ['sellers', 'seller_applications', 'public_sellers', 'products', 'events'],
  analytics: ['analytics', 'visitors', 'orders', 'events'],
};

// All available nodes in Linkadda RTDB
const ALL_RTDB_NODES = [
  'settings', 'orders', 'visitors', 'products', 'categories', 'events',
  'media', 'reviews', 'faq', 'testimonials', 'hero', 'banner',
  'payment', 'customers', 'sellers', 'seller_applications', 'public_sellers', 'analytics'
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
  return id ? ref(db, `${RTDB_NODES[node]}/${id}`) : ref(db, RTDB_NODES[node]);
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
  if (STORE[node] && STORE[node][id]) {
    delete STORE[node][id];
    emit();
    syncWebsiteCache();
  }
  await remove(nodeRef(node, id));
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
  return Object.entries(value).map(([id, item]) => ({ ...(item || {}), id }));
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
