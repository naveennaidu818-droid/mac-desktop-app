/**
 * Service Worker for Call Notifications
 * Handles notification actions when app is not in focus
 */

self.addEventListener('notificationclick', (event) => {  
  const { callerName, callerNumber, isVideo, type } = event.notification.data || {};
  
  event.notification.close();
  
  // Handle different notification actions
  switch (event.action) {
    case 'answer-audio':
      event.waitUntil(
        handleAnswerCall({ video: false, callerName, callerNumber, isVideo })
      );
      break;
      
    case 'answer-video':
      event.waitUntil(
        handleAnswerCall({ video: true, callerName, callerNumber, isVideo })
      );
      break;
      
    case 'decline':
      event.waitUntil(
        handleDeclineCall({ callerName, callerNumber })
      );
      break;
      
    case 'call-back':
      event.waitUntil(
        handleCallBack({ callerNumber })
      );
      break;
      
    case 'open-app':
    default:
      event.waitUntil(
        handleOpenApp()
      );
      break;
  }
});

/**
 * Handle answering call from notification
 */
async function handleAnswerCall({ video, callId, callerName, callerNumber, isVideo }) {
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({
        type: 'ANSWER_CALL_FROM_NOTIFICATION',
        payload: { video, callId, callerName, callerNumber, isVideo }
      });
    }
    await handleOpenApp();
  } catch (error) {  }
}

/**
 * Handle declining call from notification  
 */
async function handleDeclineCall({ callerName, callerNumber }) {
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({
        type: 'DECLINE_CALL_FROM_NOTIFICATION',
        payload: { callerName, callerNumber }
      });
    }
  } catch (error) {  }
}

async function handleSilenceCall({ callerName, callerNumber }) {
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({
        type: 'SILENCE_INCOMING_CALL_FROM_NOTIFICATION',
        payload: { callerName, callerNumber }
      });
    }
  } catch (error) {  }
}

self.addEventListener('notificationclose', (event) => {
  const data = event.notification?.data || {};
  const { callerName, callerNumber } = data;
  event.waitUntil(handleSilenceCall({ callerName, callerNumber }));
});

/**
 * Handle call back from missed call notification
 */
async function handleCallBack({ callerNumber }) {
  try {
    // Open or focus the app
    await handleOpenApp();
    
    // Send message to app to initiate call back
    const clients = await self.clients.matchAll({ type: 'window' });
    if (clients.length > 0) {
      clients[0].postMessage({
        type: 'CALL_BACK_FROM_NOTIFICATION',
        payload: { callerNumber }
      });
    }
  } catch (error) {  }
}

/**
 * Handle opening the app - focuses existing window via postMessage, NEVER reloads the page
 */
async function handleOpenApp(route) {
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    // 1. Prefer a window already on the calls screen
    for (const client of clients) {
      if (client.url.includes('calls')) {
        await client.focus();
        if (route) {
          client.postMessage({ type: 'NAVIGATE_FROM_NOTIFICATION', payload: { to: route } });
        }
        return client;
      }
    }

    // 2. Focus any existing app window and route via SPA postMessage (no page reload)
    for (const client of clients) {
      await client.focus();
      client.postMessage({ type: 'NAVIGATE_FROM_NOTIFICATION', payload: { to: route || '/calls' } });
      return client;
    }

    // 3. Only open a new window if no existing window is found
    const appUrl = self.registration.scope + (route ? route.replace(/^\//, '') : 'calls');
    return await self.clients.openWindow(appUrl);
  } catch (error) {  }
}

/**
 * Handle service worker installation
 */
self.addEventListener('install', (event) => {  self.skipWaiting();
});

/**
 * Handle service worker activation
 */
self.addEventListener('activate', (event) => {  event.waitUntil(self.clients.claim());
});

/**
 * Handle messages from the main app
 */
self.addEventListener('message', (event) => {  
  const { type, payload } = event.data || {};
  
  switch (type) {
    case 'SHOW_INCOMING_CALL_NOTIFICATION':
      showIncomingCallNotification(payload);
      break;
      
    case 'CLEAR_CALL_NOTIFICATIONS':
      clearAllCallNotifications();
      break;
      
    default:  }
});

/**
 * Show incoming call notification from service worker
 */
function showIncomingCallNotification({ callerName, callerNumber, isVideo }) {
  const callType = isVideo ? "Video Call" : "Audio Call";
  const title = `📞 VitelGlobal Connect`;
  const body = `${callType} from ${callerName}${callerNumber ? ` (${callerNumber})` : ""}`;
  
  const options = {
    body,
    icon: '/icon.png',
    badge: '/icon.png',
    tag: 'incoming-call',
    requireInteraction: true,
    silent: false,
    vibrate: [200, 100, 200],
    data: {
      callerName,
      callerNumber,
      isVideo,
      type: 'incoming-call'
    },
    actions: [
      {
        action: 'answer-audio',
        title: '📞 Answer Audio',
        icon: '/icons/phone.png'
      },
      ...(isVideo ? [{
        action: 'answer-video',
        title: '🎥 Answer Video', 
        icon: '/icons/video.png'
      }] : []),
      {
        action: 'decline',
        title: '❌ Decline',
        icon: '/icons/decline.png'
      }
    ]
  };
  
  self.registration.showNotification(title, options);
}

/**
 * Clear all call-related notifications
 */
async function clearAllCallNotifications() {
  try {
    const notifications = await self.registration.getNotifications();
    notifications.forEach(notification => {
      if (notification.tag === 'incoming-call' || notification.tag === 'ringing' || notification.tag === 'vitelglobal-active-call') {
        notification.close();
      }
    });
  } catch (error) {  }
}