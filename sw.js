// JaiGram Shop — High-Performance Progressive Web App Service Worker (sw.js)
const CACHE_NAME = 'jaigram-pwa-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/images/pwa-icon.svg',
  '/images/pwa-icon-192.jpg',
  '/images/pwa-icon-512.jpg',
  '/landing-page.css',
  '/style.css'
];

// Install: Cache critical shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('PWA: Non-fatal precache item skipped:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean old caches and take control immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) {
            return caches.delete(k);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Strategy:
// 1. Never cache API endpoints, Firebase, or external dynamic data (Network-only)
// 2. Static images, fonts, styles: Stale-While-Revalidate or Cache-First
// 3. HTML pages: Network-first with Cache fallback
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Bypass non-GET requests and API/Firebase/WebSocket calls
  if (
    req.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('identitytoolkit') ||
    url.hostname.includes('googleapis.com') ||
    url.pathname.startsWith('/admin/') ||
    url.pathname.startsWith('/seller/')
  ) {
    return;
  }

  // HTML navigation: Network first, fallback to cached page or home
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => {
        return caches.match(req).then((cached) => {
          return cached || caches.match('/index.html');
        });
      })
    );
    return;
  }

  // Static Assets (Images, CSS, Fonts, JS)
  if (
    url.pathname.match(/\.(css|js|svg|png|jpg|jpeg|webp|woff2|woff|ico)$/) ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) {
          // Revalidate in background
          fetch(req).then((fresh) => {
            if (fresh && fresh.status === 200) {
              caches.open(CACHE_NAME).then((c) => c.put(req, fresh));
            }
          }).catch(() => {});
          return cached;
        }
        return fetch(req).then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
          return response;
        });
      })
    );
  }
});
