/**
 * Complete Offline Service Worker
 * Caches entire VitelGlobal application for offline use
 */

const CACHE_NAME = 'vitelglobal-v1';
const API_CACHE_NAME = 'vitelglobal-api-v1';

// Resources to cache for offline use
const CACHE_RESOURCES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.png',
  '/favicon.ico',
  
  // Core app route - SPA uses index.html for all routes
  '/index.html',
];

// API endpoints to cache
const API_CACHE_PATTERNS = [
  '/api/contacts',
  '/api/settings',
  '/api/profile',
  '/api/chat/conversations',
  '/api/calendar/events',
  '/api/files/list'
];

/**
 * Service Worker Installation
 */
self.addEventListener('install', (event) => {  
  event.waitUntil(
    Promise.all([
      cacheStaticResources(),
      self.skipWaiting()
    ])
  );
});

/**
 * Cache static resources
 */
async function cacheStaticResources() {
  try {
    const cache = await caches.open(CACHE_NAME);
    
    // Add core resources
    await cache.addAll(CACHE_RESOURCES);  } catch (error) {  }
}

/**
 * Service Worker Activation
 */
self.addEventListener('activate', (event) => {  
  event.waitUntil(
    Promise.all([
      cleanupOldCaches(),
      self.clients.claim()
    ])
  );
});

/**
 * Clean up old caches
 */
async function cleanupOldCaches() {
  try {
    const cacheNames = await caches.keys();
    const deletePromises = cacheNames
      .filter(name => name !== CACHE_NAME && name !== API_CACHE_NAME)
      .map(name => caches.delete(name));
    
    await Promise.all(deletePromises);  } catch (error) {  }
}

/**
 * Fetch Event Handler - Main offline logic
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Handle different types of requests
  if (isApiRequest(url)) {
    event.respondWith(handleApiRequest(request));
  } else if (isNavigationRequest(request)) {
    event.respondWith(handleNavigationRequest(request));
  } else if (isAssetRequest(url)) {
    event.respondWith(handleAssetRequest(request));
  } else {
    // Default: try network first, fallback to cache
    event.respondWith(handleDefaultRequest(request));
  }
});

/**
 * Check if request is for API
 */
function isApiRequest(url) {
  return url.pathname.startsWith('/api/') || 
         url.hostname !== self.location.hostname;
}

/**
 * Check if request is navigation (page load)
 */
function isNavigationRequest(request) {
  return request.mode === 'navigate' || 
         (request.method === 'GET' && request.headers.get('accept').includes('text/html'));
}

/**
 * Check if request is for static asset
 */
function isAssetRequest(url) {
  const assetExtensions = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2'];
  return assetExtensions.some(ext => url.pathname.endsWith(ext));
}

/**
 * Handle API requests with offline support
 */
async function handleApiRequest(request) {
  try {
    // Try network first for fresh data
    const networkResponse = await fetch(request);
    
    // Cache successful responses for offline use
    if (networkResponse.ok && shouldCacheApiResponse(request.url)) {
      const cache = await caches.open(API_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {    
    // Network failed, try cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {      return cachedResponse;
    }
    
    // No cache available, return offline response
    return createOfflineApiResponse(request);
  }
}

/**
 * Check if API response should be cached
 */
function shouldCacheApiResponse(url) {
  return API_CACHE_PATTERNS.some(pattern => url.includes(pattern));
}

/**
 * Create offline API response
 */
function createOfflineApiResponse(request) {
  const url = new URL(request.url);
  
  // Return appropriate offline responses based on endpoint
  if (url.pathname.includes('/contacts')) {
    return new Response(JSON.stringify({ contacts: [], offline: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  if (url.pathname.includes('/chat')) {
    return new Response(JSON.stringify({ messages: [], offline: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  if (url.pathname.includes('/calendar')) {
    return new Response(JSON.stringify({ events: [], offline: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Generic offline response
  return new Response(JSON.stringify({ offline: true, error: 'No network connection' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Handle navigation requests (page loads)
 */
async function handleNavigationRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  
  // For SPA: always serve cached index.html for any navigation route
  // This ensures the app shell loads even when offline
  let cachedResponse = await cache.match('/index.html');
  
  if (cachedResponse) {
    // Cache the specific URL for next time, then return app shell
    event.waitUntil(
      fetch(request).then(networkResponse => {
        if (networkResponse.ok) {
          cache.put(request.url, networkResponse.clone());
        }
      }).catch(() => {
        // Network failed, app shell is already being served
      })
    );
    return cachedResponse;
  }
  
  // index.html not cached, try network for initial load
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request.url, networkResponse.clone());
      cache.put('/index.html', networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // Nothing cached and no network - serve offline page
    return createOfflinePage();
  }
}

/**
 * Handle static asset requests
 */
async function handleAssetRequest(request) {
  const url = new URL(request.url);
  // If it's an SVG request imported by a script (destination is not image), bypass service worker cache
  if (url.pathname.endsWith(".svg") && request.destination !== "image") {
    return fetch(request);
  }

  try {
    // Try cache first for assets (faster loading)
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Not in cache, try network and cache the result
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {    
    // Return empty response for missing assets
    return new Response('', { status: 404 });
  }
}

/**
 * Handle default requests
 */
async function handleDefaultRequest(request) {
  try {
    const networkResponse = await fetch(request);
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    return cachedResponse || new Response('Offline', { status: 503 });
  }
}

/**
 * Create offline page
 */
function createOfflinePage() {
  const offlineHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>VitelGlobal - Offline</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          margin: 0;
          padding: 0;
          background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
        }
        .offline-container {
          text-align: center;
          padding: 2rem;
          max-width: 500px;
        }
        .offline-icon {
          font-size: 4rem;
          margin-bottom: 1rem;
        }
        .offline-title {
          font-size: 2rem;
          font-weight: bold;
          margin-bottom: 1rem;
        }
        .offline-message {
          font-size: 1.1rem;
          opacity: 0.9;
          margin-bottom: 2rem;
        }
        .retry-button {
          background: white;
          color: #1e3a8a;
          border: none;
          padding: 0.75rem 2rem;
          border-radius: 0.5rem;
          font-weight: bold;
          cursor: pointer;
          font-size: 1rem;
        }
        .retry-button:hover {
          background: #f1f5f9;
        }
      </style>
    </head>
    <body>
      <div class="offline-container">
        <div class="offline-icon">📡</div>
        <h1 class="offline-title">You're Offline</h1>
        <p class="offline-message">
          VitelGlobal is working offline. Some features may be limited until you reconnect to the internet.
        </p>
        <button class="retry-button" onclick="window.location.reload()">
          Try Again
        </button>
      </div>
      <script>
        // Auto-retry when online
        window.addEventListener('online', () => {
          window.location.reload();
        });
      </script>
    </body>
    </html>
  `;
  
  return new Response(offlineHTML, {
    headers: { 'Content-Type': 'text/html' }
  });
}

/**
 * Background Sync - Handle queued actions when online
 */
self.addEventListener('sync', (event) => {  
  switch (event.tag) {
    case 'send-messages':
      event.waitUntil(syncPendingMessages());
      break;
    case 'upload-files':
      event.waitUntil(syncPendingUploads());
      break;
    case 'sync-contacts':
      event.waitUntil(syncContacts());
      break;
    case 'sync-calendar':
      event.waitUntil(syncCalendar());
      break;
    default:
      event.waitUntil(syncAllData());
  }
});

/**
 * Sync pending messages
 */
async function syncPendingMessages() {
  try {    
    // This would integrate with your offline manager
    // const pendingMessages = await offlineManager.query('chat', { synced: false });
    
    // Send each pending message
    // for (const message of pendingMessages) {
    //   await sendMessageToServer(message);
    //   await offlineManager.update('chat', message._id, { synced: true });
    // }  } catch (error) {  }
}

/**
 * Sync pending file uploads
 */
async function syncPendingUploads() {
  try {    
    // Implement file upload sync logic  } catch (error) {  }
}

/**
 * Sync contacts
 */
async function syncContacts() {
  try {    
    // Implement contact sync logic  } catch (error) {  }
}

/**
 * Sync calendar events
 */
async function syncCalendar() {
  try {    
    // Implement calendar sync logic  } catch (error) {  }
}

/**
 * Sync all data
 */
async function syncAllData() {
  try {    
    await Promise.all([
      syncPendingMessages(),
      syncPendingUploads(),
      syncContacts(),
      syncCalendar()
    ]);  } catch (error) {  }
}

/**
 * Handle messages from main app
 */
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};
  
  switch (type) {
    case 'CACHE_ASSETS':
      event.waitUntil(cacheAdditionalAssets(payload));
      break;
    case 'CLEAR_CACHE':
      event.waitUntil(clearAllCaches());
      break;
    case 'GET_CACHE_STATUS':
      event.waitUntil(sendCacheStatus());
      break;
    default:  }
});

/**
 * Cache additional assets
 */
async function cacheAdditionalAssets(assets) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(assets);  } catch (error) {  }
}

/**
 * Clear all caches
 */
async function clearAllCaches() {
  try {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(name => caches.delete(name)));  } catch (error) {  }
}

/**
 * Send cache status to main app
 */
async function sendCacheStatus() {
  try {
    const cacheNames = await caches.keys();
    const status = {
      caches: cacheNames,
      timestamp: Date.now()
    };
    
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'CACHE_STATUS',
        payload: status
      });
    });
  } catch (error) {  }
}

/* console. removed */