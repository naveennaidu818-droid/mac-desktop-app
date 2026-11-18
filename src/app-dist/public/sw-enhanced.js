/* eslint-disable no-undef */
/**
 * Enhanced Service Worker with Workbox-like strategies
 * Handles Asset Caching + Offline Fallbacks + Background Sync
 * 
 * ZERO BREAKING CHANGES: Falls back to network for all API calls when online
 */

const CACHE_VERSION = 'vitelglobal-v9';
const CACHE_NAMES = {
  STATIC: `${CACHE_VERSION}-static`,
  DYNAMIC: `${CACHE_VERSION}-dynamic`,
  IMAGES: `${CACHE_VERSION}-images`,
  FONTS: `${CACHE_VERSION}-fonts`,
  API_CACHE: `${CACHE_VERSION}-api`
};

// Core app shell assets that should be cached immediately
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/icon.png',
  '/manifest.json',
  '/offline.html' // Fallback offline page
];

// Max cache sizes to prevent unbounded growth
const MAX_CACHE_SIZE = {
  DYNAMIC: 50,
  IMAGES: 60,
  API_CACHE: 100
};

// Network-only patterns (never cache these)
const NETWORK_ONLY_PATTERNS = [
  /\/socket\.io\//,
  /\/ws/,
  /^wss?:/,
  /desktopapi\.officemeetings\.net/,
  /api\.officemeetings\.net/,
  /webrtc\.officemeetings\.net/,
  /@react-refresh/,  // Don't cache React dev tools
  /@vite\//,          // Don't cache Vite HMR  
  /\/@fs\//,          // Don't cache Vite file system access
  /\/@id\//,          // Don't cache Vite module IDs
  /\.hot-update\./,   // Don't cache HMR updates
  /vite\.svg/,        // Don't cache Vite logo
  /\/__vite_ping/,    // Don't cache Vite ping
  /node_modules/      // Don't cache node_modules paths
];

// Skip Service Worker entirely for these patterns
function shouldBypassServiceWorker(url) {
  // Always bypass for dev tools and HMR
  if (NETWORK_ONLY_PATTERNS.some(pattern => pattern.test(url.href))) {
    return true;
  }
  
  // Bypass for Vite dev server files
  if (url.searchParams.has('t') || url.searchParams.has('import')) {
    return true;
  }
  
  return false;
}

// ============================================================================
// INSTALLATION & ACTIVATION
// ============================================================================

self.addEventListener('install', (event) => {  
  event.waitUntil(
    caches.open(CACHE_NAMES.STATIC)
      .then(cache => {        return cache.addAll(PRECACHE_ASSETS.map(url => new Request(url, { cache: 'reload' })));
      })
      .then(() => {        return self.skipWaiting();
      })
      .catch(err => {      })
  );
});

self.addEventListener('activate', (event) => {  
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then(cacheNames => {
        const validCacheNames = Object.values(CACHE_NAMES);
        return Promise.all(
          cacheNames.map(cacheName => {
            if (!validCacheNames.includes(cacheName)) {              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Take control of all clients immediately
      self.clients.claim()
    ]).then(() => {    })
  );
});

// ============================================================================
// FETCH STRATEGIES
// ============================================================================

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome extensions and non-http(s) protocols
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // CRITICAL: Bypass Service Worker entirely for dev tools and HMR
  if (shouldBypassServiceWorker(url)) {
    return; // Let browser handle these directly, no SW interference
  }

  // Network-only for real-time APIs
  if (isNetworkOnly(url)) {
    return;
  }

  // Route to appropriate strategy
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
  } else if (url.pathname.match(/\.(png|jpg|jpeg|svg|gif|webp|ico)$/i)) {
    event.respondWith(cacheFirstStrategy(request, CACHE_NAMES.IMAGES));
  } else if (url.pathname.match(/\.(woff|woff2|ttf|eot)$/i)) {
    event.respondWith(cacheFirstStrategy(request, CACHE_NAMES.FONTS));
  } else if (url.pathname.match(/\.(js|css)$/i)) {
    // CRITICAL: Use network-first for JS/CSS to avoid stale React modules
    event.respondWith(networkFirstForAssetsStrategy(request, CACHE_NAMES.STATIC));
  } else if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstStrategy(request, CACHE_NAMES.API_CACHE));
  } else {
    event.respondWith(staleWhileRevalidateStrategy(request, CACHE_NAMES.DYNAMIC));
  }
});

// ============================================================================
// CACHING STRATEGIES
// ============================================================================

/**
 * Cache First Strategy: Check cache first, fallback to network
 * Best for: Images, fonts, static assets that rarely change
 */
async function cacheFirstStrategy(request, cacheName) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
      await limitCacheSize(cacheName, MAX_CACHE_SIZE[cacheName.split('-').pop().toUpperCase()] || 50);
    }
    return networkResponse;
  } catch (error) {    return new Response('Offline - Asset unavailable', { 
      status: 503,
      statusText: 'Service Unavailable'
    });
  }
}

/**
 * Stale While Revalidate: Return cached version immediately, update cache in background
 * Best for: JS/CSS bundles, HTML pages
 */
async function staleWhileRevalidateStrategy(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  const fetchPromise = fetch(request)
    .then(networkResponse => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => cachedResponse);

  return cachedResponse || fetchPromise;
}

/**
 * Network First Strategy: Try network first, fallback to cache
 * Best for: API calls that need fresh data but should work offline
 */
async function networkFirstStrategy(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
      await limitCacheSize(cacheName, MAX_CACHE_SIZE.API_CACHE);
    }
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {      return cachedResponse;
    }
    return new Response(JSON.stringify({ 
      error: 'Offline',
      message: 'Network unavailable and no cached data',
      offline: true 
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Network First for Assets: Try network first for JS/CSS to avoid stale modules
 * Best for: JS/CSS bundles that must be fresh to avoid React errors
 */
async function networkFirstForAssetsStrategy(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {    const cachedResponse = await caches.match(request);
    if (cachedResponse) {      return cachedResponse;
    }
    throw error;
  }
}

/**
 * Navigation Request Handler: Special handling for HTML navigation
 */
async function handleNavigationRequest(request) {
  try {
    // Try network first for fresh content
    const networkResponse = await Promise.race([
      fetch(request),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Network timeout')), 3000)
      )
    ]);
    
    // Cache the successful response
    const cache = await caches.open(CACHE_NAMES.STATIC);
    cache.put(request, networkResponse.clone());
    return networkResponse;
  } catch (error) {    
    // Try to match the specific request first
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {      return cachedResponse;
    }
    
    // For SPA routes, try to serve index.html
    const indexResponse = await caches.match('/index.html');
    if (indexResponse) {      return indexResponse;
    }
    
    // Try to match without query params (for Vite dev mode)
    const url = new URL(request.url);
    const cleanUrl = `${url.origin}${url.pathname}`;
    const cleanResponse = await caches.match(cleanUrl);
    if (cleanResponse) {      return cleanResponse;
    }
    
    // Try to match the root path
    const rootResponse = await caches.match('/');
    if (rootResponse) {      return rootResponse;
    }
    
    // Last resort: offline page (if it exists)
    const offlineResponse = await caches.match('/offline.html');
    if (offlineResponse) {      return offlineResponse;
    }    
    // Ultimate fallback: Return a basic HTML page that tells user to go online
    return new Response(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Offline - VitelGlobal</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-align: center;
      padding: 20px;
    }
    .container { max-width: 500px; }
    h1 { font-size: 2.5rem; margin: 0 0 1rem; }
    p { font-size: 1.1rem; margin: 0 0 2rem; opacity: 0.9; line-height: 1.6; }
    .icon { font-size: 4rem; margin-bottom: 2rem; }
    button {
      background: white;
      color: #667eea;
      border: none;
      padding: 14px 36px;
      font-size: 1rem;
      font-weight: 600;
      border-radius: 30px;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
      box-shadow: 0 4px 15px rgba(0,0,0,0.2);
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0,0,0,0.3);
    }
    button:active {
      transform: translateY(0);
    }
    .info {
      margin-top: 2rem;
      padding: 1rem;
      background: rgba(255,255,255,0.1);
      border-radius: 12px;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">📡</div>
    <h1>You're Offline</h1>
    <p>You need an internet connection to use this app. Please check your connection and try again.</p>
    <button onclick="window.location.reload()">Retry Connection</button>
    <div class="info">
      <strong>First Time Using Offline Mode?</strong><br>
      Visit the app while ONLINE first to cache data for offline use.
    </div>
  </div>
  <script>
    // Auto-retry every 5 seconds
    let retryCount = 0;
    const maxRetries = 60; // 5 minutes
    
    function checkConnection() {
      fetch('/', { method: 'HEAD', cache: 'no-cache' })
        .then(response => {
          if (response.ok) {            window.location.reload();
          }
        })
        .catch(() => {
          retryCount++;
          if (retryCount < maxRetries) {            setTimeout(checkConnection, 5000);
          }
        });
    }
    
    // Start checking after 5 seconds
    setTimeout(checkConnection, 5000);
  </script>
</body>
</html>`,
      {
        status: 200,
        statusText: 'OK',
        headers: { 
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      }
    );
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function isNetworkOnly(url) {
  return NETWORK_ONLY_PATTERNS.some(pattern => pattern.test(url.href));
}

async function limitCacheSize(cacheName, maxSize) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  
  if (keys.length > maxSize) {
    const deleteCount = keys.length - maxSize;
    for (let i = 0; i < deleteCount; i++) {
      await cache.delete(keys[i]);
    }
  }
}

// ============================================================================
// MESSAGE HANDLING (Keep existing notification logic)
// ============================================================================

self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'CLEAR_CACHE':
      event.waitUntil(
        caches.keys().then(cacheNames => {
          return Promise.all(cacheNames.map(name => caches.delete(name)));
        })
      );
      break;
      
    case 'CACHE_URLS':
      event.waitUntil(
        caches.open(CACHE_NAMES.DYNAMIC).then(cache => {
          return cache.addAll(payload.urls || []);
        })
      );
      break;

    // Preserve existing notification handling
    case 'SHOW_INCOMING_CALL_NOTIFICATION':
    case 'CLEAR_CALL_NOTIFICATIONS':
    case 'SHOW_NEW_MESSAGE_NOTIFICATION':
    case 'SHOW_TYPING_NOTIFICATION':
    case 'SHOW_GROUP_INVITE_NOTIFICATION':
    case 'SHOW_MENTION_NOTIFICATION':
    case 'CLEAR_CHAT_NOTIFICATIONS':
    case 'UPDATE_UNREAD_BADGE':
      // Forward to existing notification handlers in sw.js
      // You can keep those handlers in a separate file and import them      break;

    default:  }
});

// ============================================================================
// BACKGROUND SYNC (For offline form submissions)
// ============================================================================

if ('sync' in self.registration) {
  self.addEventListener('sync', (event) => {    
    if (event.tag === 'sync-offline-data') {
      event.waitUntil(syncOfflineData());
    }
  });
}

async function syncOfflineData() {
  try {
    // This will be called by the sync manager in the client
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({ type: 'SYNC_OFFLINE_DATA' });
    });
  } catch (error) {  }
}