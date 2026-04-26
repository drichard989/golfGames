// Service Worker for Golf Scorecard PWA
// Update CACHE_VERSION every time you deploy changes
const CACHE_VERSION = 'v3.2.126';
const CACHE_NAME = `golf-${CACHE_VERSION}`;

// Files to cache - comprehensive list
const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/index.js',
  '/manifest.json',
  '/sw.js',
  '/js/vegas.js',
  '/js/banker.js',
  '/js/banker-sheet.js',
  '/js/skins.js',
  '/js/junk.js',
  '/js/junk-sheet.js',
  '/js/hilo.js',
  '/js/wolf.js',
  '/js/wolf-sheet.js',
  '/js/score-sheet.js',
  '/js/export.js',
  '/js/firebase-config.js',
  '/js/cloudsync.js',
  '/stylesheet/main.css',
  '/stylesheet/junk.css',
  '/stylesheet/banker.css',
  '/stylesheet/score-sheet.css',
  '/stylesheet/wolf.css',
  '/images/favicon-16.png',
  '/images/favicon-32.png',
  '/images/apple-touch-icon.png',
  '/images/icon-192.png',
  '/images/icon-512.png'
];

async function precacheFiles(cache) {
  // Avoid failing SW install if one optional/static file is missing.
  const results = await Promise.allSettled(
    FILES_TO_CACHE.map(async (path) => {
      const request = new Request(path, { cache: 'no-store' });
      const response = await fetch(request);
      if (!response || !response.ok) {
        throw new Error(`HTTP ${response ? response.status : 'ERR'} for ${path}`);
      }
      await cache.put(request, response);
      return path;
    })
  );

  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length) {
    failed.forEach((result) => {
      console.warn('[SW] Precache skipped:', result.reason?.message || result.reason);
    });
  }
}

async function pruneCacheEntries(cache) {
  const expectedUrls = new Set(
    FILES_TO_CACHE.map((path) => new URL(path, self.location.origin).href)
  );
  const keys = await cache.keys();
  const deletions = [];

  keys.forEach((request) => {
    if (!expectedUrls.has(request.url)) {
      deletions.push(cache.delete(request));
    }
  });

  if (deletions.length) {
    await Promise.all(deletions);
    console.log('[SW] Pruned stale cache entries:', deletions.length);
  }
}

// Install - cache files
self.addEventListener('install', (event) => {
  console.log('[SW] Installing version:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        await precacheFiles(cache);
        await pruneCacheEntries(cache);
      })
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
