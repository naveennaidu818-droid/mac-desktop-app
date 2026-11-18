/**
 * Service Worker for Chat Notifications
 * Handles notification actions when app is not in focus
 */

self.addEventListener('notificationclick', (event) => {
  
  const notifData = event.notification.data || {};
  const innerData = notifData.data && typeof notifData.data === 'object' ? notifData.data : {};
  const conversationId = notifData.conversationId || innerData.conversationId || notifData.chatId || innerData.chatId || notifData.senderUserId || innerData.senderUserId || null;
  const { senderName, type, inviteId, groupName } = notifData;
  
  event.notification.close();
  
  const isDownloadOrExport =
    type === 'download' ||
    type === 'export' ||
    type === 'general' ||
    String(event.notification.title || '').toLowerCase().includes('download') ||
    String(event.notification.title || '').toLowerCase().includes('export') ||
    (!conversationId && !type && !inviteId);

  if (isDownloadOrExport) {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        if (clients.length > 0) {
          return clients[0].focus();
        }
      })
    );
    return;
  }
  
  // Handle different notification actions
  switch (event.action) {
    case 'reply':
      event.waitUntil(
        handleReplyAction({ conversationId, senderName })
      );
      break;
      
    case 'mark-read':
      event.waitUntil(
        handleMarkReadAction({ conversationId })
      );
      break;
      
    case 'open-chat':
      event.waitUntil(
        handleOpenChatAction({ conversationId })
      );
      break;

    case 'accept':
      event.waitUntil(
        handleAcceptGroupInvite({ inviteId, groupName })
      );
      break;

    case 'decline':
      event.waitUntil(
        handleDeclineGroupInvite({ inviteId, groupName })
      );
      break;

    case 'view-group':
      event.waitUntil(
        handleViewGroupInvite({ inviteId, groupName })
      );
      break;
      
    default:
      // Default action - open app to conversation
      event.waitUntil(
        handleOpenChatAction({ conversationId })
      );
      break;
  }
});

/**
 * Handle reply action from notification
 */
async function handleReplyAction({ conversationId, senderName }) {
  try {
    // Open or focus the app
    await handleOpenApp('/chat');
    
    // Send message to app to open reply for conversation
    const clients = await self.clients.matchAll({ type: 'window' });
    if (clients.length > 0) {
      clients[0].postMessage({
        type: 'REPLY_FROM_NOTIFICATION',
        payload: { conversationId, senderName }
      });
    }
  } catch (error) {
  }
}

/**
 * Handle mark as read action
 */
async function handleMarkReadAction({ conversationId }) {
  try {
    // Send message to app to mark conversation as read
    const clients = await self.clients.matchAll({ type: 'window' });
    if (clients.length > 0) {
      clients[0].postMessage({
        type: 'MARK_READ_FROM_NOTIFICATION',
        payload: { conversationId }
      });
    }
  } catch (error) {
  }
}

/**
 * Handle open chat action
 */
async function handleOpenChatAction({ conversationId }) {
  try {
    const targetPath = conversationId ? `/chat?conversationId=${encodeURIComponent(conversationId)}` : '/chat';
    await handleOpenApp(targetPath);
    
    // Send message to app to open specific conversation
    const clients = await self.clients.matchAll({ type: 'window' });
    if (clients.length > 0) {
      clients[0].postMessage({
        type: 'OPEN_CHAT_FROM_NOTIFICATION',
        payload: { conversationId }
      });
      clients[0].postMessage({
        type: 'NAVIGATE_FROM_NOTIFICATION',
        payload: { to: '/chat', type: 'chat', conversationId, data: { conversationId } }
      });
    }
  } catch (error) {  }
}

/**
 * Handle group invite acceptance
 */
async function handleAcceptGroupInvite({ inviteId, groupName }) {
  try {
    // Open or focus the app
    await handleOpenApp('/chat');
    
    // Send message to app to accept group invite
    const clients = await self.clients.matchAll({ type: 'window' });
    if (clients.length > 0) {
      clients[0].postMessage({
        type: 'ACCEPT_GROUP_INVITE_FROM_NOTIFICATION',
        payload: { inviteId, groupName }
      });
    }
  } catch (error) {
  }
}

/**
 * Handle group invite decline
 */
async function handleDeclineGroupInvite({ inviteId, groupName }) {
  try {
    // Send message to app to decline group invite
    const clients = await self.clients.matchAll({ type: 'window' });
    if (clients.length > 0) {
      clients[0].postMessage({
        type: 'DECLINE_GROUP_INVITE_FROM_NOTIFICATION',
        payload: { inviteId, groupName }
      });
    }
  } catch (error) {
  }
}

/**
 * Handle view group invite
 */
async function handleViewGroupInvite({ inviteId, groupName }) {
  try {
    // Open or focus the app
    await handleOpenApp('/chat');
    
    // Send message to app to view group invite
    const clients = await self.clients.matchAll({ type: 'window' });
    if (clients.length > 0) {
      clients[0].postMessage({
        type: 'VIEW_GROUP_INVITE_FROM_NOTIFICATION',
        payload: { inviteId, groupName }
      });
    }
  } catch (error) {
  }
}

/**
 * Handle opening the app
 */
async function handleOpenApp(path = '/chat') {
  try {
    // Try to focus existing app window
    const clients = await self.clients.matchAll({ type: 'window' });
    
    for (const client of clients) {
      if (client.url.includes('chat') || client.url.includes('vitelglobal')) {
        await client.focus();
        return client;
      }
    }
    
    // If no suitable window found, open new one
    const safePath = path.startsWith('/') ? path : '/' + path;
    const baseScope = self.registration.scope.replace(/\/+$/, '');
    const appUrl = baseScope + safePath;
    return await self.clients.openWindow(appUrl);
  } catch (error) {
  }
}

/**
 * Handle service worker messages from main app
 */
self.addEventListener('message', (event) => {
  
  const { type, payload } = event.data || {};
  
  switch (type) {
    case 'SHOW_NEW_MESSAGE_NOTIFICATION':
      showNewMessageNotification(payload);
      break;
      
    case 'SHOW_TYPING_NOTIFICATION':
      showTypingNotification(payload);
      break;
      
    case 'SHOW_GROUP_INVITE_NOTIFICATION':
      showGroupInviteNotification(payload);
      break;
      
    case 'SHOW_MENTION_NOTIFICATION':
      showMentionNotification(payload);
      break;
      
    case 'CLEAR_CHAT_NOTIFICATIONS':
      clearChatNotifications(payload);
      break;
      
    case 'UPDATE_UNREAD_BADGE':
      updateUnreadBadge(payload);
      break;
      
    default:
  }
});

/**
 * Show new message notification from service worker
 */
function showNewMessageNotification({
  senderName,
  senderExtension,
  senderAvatar,
  messagePreview,
  conversationId,
  isGroupChat,
  groupName,
  unreadCount
}) {
  const fullSenderDisplay = senderExtension && !senderName?.includes(senderExtension)
    ? `${senderName} (Ext: ${senderExtension})`
    : (senderName || 'Unknown User');

  const title = isGroupChat 
    ? `💬 ${groupName}` 
    : `💬 ${fullSenderDisplay}`;

  const body = isGroupChat
    ? `${fullSenderDisplay}: ${messagePreview}`
    : messagePreview;

  const badge = unreadCount > 1 ? ` (${unreadCount} messages)` : "";

  const options = {
    body: body + badge,
    icon: senderAvatar || '/icon.png',
    badge: '/icon.png',
    tag: `chat-${conversationId}`,
    requireInteraction: true,
    silent: false,
    vibrate: [100, 50, 100],
    data: {
      senderName: fullSenderDisplay,
      senderExtension,
      senderAvatar,
      messagePreview,
      conversationId,
      isGroupChat,
      groupName,
      unreadCount,
      type: 'new-message'
    },
    actions: [
      {
        action: 'reply',
        title: '✏️ Reply',
        icon: '/icons/reply.png'
      },
      {
        action: 'mark-read',
        title: '✓ Mark Read',
        icon: '/icons/read.png'
      },
      {
        action: 'open-chat',
        title: '💬 Open Chat',
        icon: '/icons/chat.png'
      }
    ]
  };
  
  self.registration.showNotification(title, options);
}

/**
 * Show typing notification
 */
function showTypingNotification({ senderName, conversationId, isGroupChat, groupName }) {
  const title = isGroupChat ? groupName : senderName;
  const body = `${senderName} is typing...`;

  const options = {
    body,
    icon: '/icon.png',
    badge: '/icon.png',
    tag: `typing-${conversationId}`,
    requireInteraction: false,
    silent: true,
    data: {
      senderName,
      conversationId,
      isGroupChat,
      groupName,
      type: 'typing'
    }
  };

  self.registration.showNotification(title, options);
}

/**
 * Clear chat notifications
 */
async function clearChatNotifications({ conversationId = null }) {
  try {
    const notifications = await self.registration.getNotifications();
    notifications.forEach(notification => {
      if (conversationId) {
        // Clear specific conversation notifications
        if (notification.tag === `chat-${conversationId}` || 
            notification.tag === `typing-${conversationId}` ||
            notification.tag === `mention-${conversationId}`) {
          notification.close();
        }
      } else {
        // Clear all chat notifications
        if (notification.tag && (
            notification.tag.startsWith('chat-') || 
            notification.tag.startsWith('typing-') ||
            notification.tag.startsWith('mention-') ||
            notification.tag.startsWith('group-invite-'))) {
          notification.close();
        }
      }
    });
  } catch (error) {
  }
}

/**
 * Update unread message badge
 */
function updateUnreadBadge({ count }) {
  try {
    if ('setAppBadge' in self.navigator) {
      self.navigator.setAppBadge(count > 0 ? count : 0);
    }
  } catch (error) {
  }
}

/* console. removed */