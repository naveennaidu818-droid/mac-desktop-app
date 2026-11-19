"use strict";

const { contextBridge, ipcRenderer, webFrame } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

// Ensure navigator.mediaDevices.getDisplayMedia converts intentional user cancellations
// into W3C standard NotAllowedError instead of Electron's internal AbortError ("Invalid capture constraints").
try {
  webFrame.executeJavaScript(`
    (() => {
      if (window.__vitelDisplayMediaWrapped) return;
      window.__vitelDisplayMediaWrapped = true;
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') return;
      const _origGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = async function (constraints) {
        try {
          return await _origGetDisplayMedia(constraints);
        } catch (error) {
          // If failure might be caused by loopback audio constraints unsupported on this platform,
          // automatically retry with audio: false so screen video still starts cleanly
          if (constraints && constraints.audio) {
            try {
              const videoOnly = { ...constraints, audio: false };
              return await _origGetDisplayMedia(videoOnly);
            } catch (_) {}
          }

          const isAbortOrConstraints = error && (
            error.name === 'AbortError' ||
            String(error.message || '').includes('Invalid capture constraints')
          );
          if (isAbortOrConstraints && typeof window.__vitelGetCaptureOutcome === 'function') {
            try {
              const outcome = await window.__vitelGetCaptureOutcome();
              if (outcome && (outcome.reason === 'user-cancelled' || outcome.reason === 'closed' || outcome.reason === 'superseded' || outcome.reason === 'timeout' || outcome.reason === 'permission-denied' || outcome.reason === 'no-sources')) {
                throw new DOMException('Permission denied by user', 'NotAllowedError');
              }
            } catch (queryErr) {
              if (queryErr && queryErr.name === 'NotAllowedError') {
                throw queryErr;
              }
            }
          }
          throw error;
        }
      };
    })();
  `, true).catch(() => {});
} catch (_) {}

contextBridge.exposeInMainWorld("__vitelGetCaptureOutcome", () => invoke("screen-capture:get-outcome"));

const clearIncomingCallNotification = () => {
  void invoke("app:clear-notifications", "incoming-call").catch(() => {});
};

for (const eventName of [
  "vitelglobal:clear-call-toasts",
  "vitelglobal:clear-active-call-notification"
]) {
  window.addEventListener(eventName, clearIncomingCallNotification);
}
const on = (channel, callback) => {
  if (typeof callback !== "function") {
    return () => {};
  }

  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("vitelDesktop", {
  getInfo: () => invoke("app:get-info"),
  reload: () => invoke("app:reload"),
  home: () => invoke("app:home"),
  openLogs: () => invoke("app:open-logs"),
  chooseFiles: () => invoke("app:choose-files"),
  openExternal: (url) => invoke("app:open-external", url),
  readClipboard: () => invoke("app:read-clipboard"),
  writeClipboard: (text) => invoke("app:write-clipboard", text),
  notify: (payload) => invoke("app:notify", payload),
  clearNotifications: (type) => invoke("app:clear-notifications", type),
  focus: () => invoke("app:focus"),
  restore: () => invoke("app:focus"),
  flashFrame: (enabled) => invoke("app:flash-frame", enabled),
  checkForUpdates: () => invoke("app:check-for-updates"),
  quitAndInstall: () => invoke("app:quit-and-install"),
  setCallActive: (active) => invoke("app:set-call-active", Boolean(active)),
  setVitelmeetCookies: (payload) => invoke("app:set-vitelmeet-session", payload),
  openPortal: (payload) => invoke("app:open-portal", payload),
  clearPortalCookies: (targetUrl) => invoke("app:clear-portal-cookies", targetUrl),
  getAutoLaunch: () => invoke("app:get-auto-launch"),
  setAutoLaunch: (enabled) => invoke("app:set-auto-launch", Boolean(enabled)),
  setBadgeCount: (count) => invoke("app:set-badge-count", Number(count) || 0),
  getLocation: () => invoke("app:get-location"),
  getMediaAccessStatus: (mediaType) => invoke("system:get-media-permission-status", mediaType),
  requestMediaAccess: (mediaType) => invoke("system:request-media-permission", mediaType),
  openPrivacySettings: (pane) => invoke("system:open-privacy-settings", pane),
  getCaptureOutcome: () => invoke("screen-capture:get-outcome"),
  clearAllData: () => invoke("app:clear-all-data"),
  onDeepLink: (callback) => on("deep-link", callback),
  onDownloadProgress: (callback) => on("download:progress", callback),
  onDownloadDone: (callback) => on("download:done", callback),
  onUpdateStatus: (callback) => on("update:status", callback),
  onUpdateProgress: (callback) => on("update:progress", callback),
  getPendingNotificationClick: () => invoke("app:get-pending-notification-click"),
  onWindowActivated: (callback) => on("window-activated", callback),
  onNotificationClick: (callback) => on("notification-click", callback),
  onNotificationAction: (callback) => on("notification-action", callback),
  loadOfflineApp: () => invoke("app:load-offline-app"),
  loadRemoteApp: () => invoke("app:load-remote-app"),
  sqlite: {
    saveSession: (sessionData) => invoke("sqlite:save-session", sessionData),
    getSession: () => invoke("sqlite:get-session"),
    clearSession: (userId) => invoke("sqlite:clear-session", userId),
    saveConversations: (conversations) => invoke("sqlite:save-conversations", conversations),
    getConversations: () => invoke("sqlite:get-conversations"),
    saveMessages: (conversationId, messages) => invoke("sqlite:save-messages", { conversationId, messages }),
    getMessages: (conversationId) => invoke("sqlite:get-messages", conversationId),
    saveSms: (line, peerNumber, messages) => invoke("sqlite:save-sms", { line, peerNumber, messages }),
    getSms: (line, peerNumber) => invoke("sqlite:get-sms", { line, peerNumber }),
    saveContacts: (contacts) => invoke("sqlite:save-contacts", contacts),
    getContacts: () => invoke("sqlite:get-contacts"),
    enqueueOutbox: (mutation) => invoke("sqlite:enqueue-outbox", mutation),
    getOutbox: () => invoke("sqlite:get-outbox"),
    dequeueOutbox: (id) => invoke("sqlite:dequeue-outbox", id),
    setKV: (key, value) => invoke("sqlite:set-kv", { key, value }),
    getKV: (key) => invoke("sqlite:get-kv", key),
  }
});
