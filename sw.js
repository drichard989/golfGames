// Service Worker for Golf Scorecard PWA
// Update CACHE_VERSION every time you deploy changes
const CACHE_VERSION = 'v3.1.43';
const CACHE_NAME = `golf-${CACHE_VERSION}`;

// Files to cache - comprehensive list
const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/index.js',
  '/manifest.json',
  '/js/vegas.js',
  '/js/banker.js',
  '/js/skins.js',
  '/js/junk.js',
  '/js/hilo.js',
  '/js/export.js',
  '/js/qrcode.js',
  '/js/firebase-config.js',
  '/js/cloudsync.js',
  '/stylesheet/main.css',
  '/images/favicon-16.png',
  '/images/favicon-32.png',
  '/images/apple-touch-icon.png',
  '/images/icon-192.png',
  '/images/icon-512.png'
];

// Install - cache files
self.addEventListener('install', (event) => {
  console.log('[SW] Installing version:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(FILES_TO_CACHE))
      .then(() => self.skipWaiting()) // Activate immediately
  );
});

// Activate - clean up old caches and force refresh
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating version:', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Take control of all clients immediately
      return self.clients.claim();
    })
  );
});

// Fetch - network-only for HTML/JS (no caching), cache-first for assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Network-first for all app files (HTML, JS, CSS) — always fresh, offline fallback
  if (request.destination === 'document' || 
      url.pathname.endsWith('.html') || 
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname === '/') {
    event.respondWith(
      fetch(request, {
        cache: 'no-store', // Don't use HTTP cache
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      })
        .catch(() => {
          // Offline fallback to cache only if network fails
          console.log('[SW] Network failed, using cached version');
          return caches.match(request);
        })
    );
    return;
  }
  
  // Cache-first for CSS, images, and other assets
  event.respondWith(
    caches.match(request)
      .then((response) => {
        if (response) {
          return response;
        }
        return fetch(request).then((fetchResponse) => {
          if (fetchResponse && fetchResponse.status === 200) {
            const responseClone = fetchResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return fetchResponse;
        });
      })
  );
});
