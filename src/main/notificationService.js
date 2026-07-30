"use strict";

const ALLOWED_TYPES = new Set(["incoming-call", "missed-call", "sms", "chat", "meeting", "voicemail", "contact-sync", "general"]);

function normalizePayload(payload = {}) {
  const requestedType = String(payload.type || "general").trim().toLowerCase();
  return {
    title: String(payload.title || "VitelGlobal Desktop").slice(0, 120),
    body: String(payload.body || "").slice(0, 500),
    silent: Boolean(payload.silent),
    type: ALLOWED_TYPES.has(requestedType) ? requestedType : "general",
    screen: String(payload.screen || "").slice(0, 500),
    data: payload.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data : {}
  };
}

function createNotificationService({ Notification, getMainWindow, showMainWindow, iconPath, log }) {
  const pendingClicks = [];
  let clickListenerReady = false;
  const windowReady = (window) => Boolean(window && !window.isDestroyed() && window.webContents &&
    !window.webContents.isDestroyed() && !window.webContents.isLoadingMainFrame());

  function deliverClick(payload) {
    const window = getMainWindow();
    showMainWindow();
    if (!windowReady(window) || !clickListenerReady) {
      pendingClicks.push(payload);
      log.info("Notification click queued until renderer is ready", { type: payload.type, screen: payload.screen });
      return false;
    }
    window.webContents.send("notification-click", payload);
    log.info("Notification click delivered", { type: payload.type, screen: payload.screen });
    return true;
  }

  function flushPendingClicks() {
    const window = getMainWindow();
    if (!windowReady(window) || !clickListenerReady) return 0;
    let delivered = 0;
    while (pendingClicks.length) {
      const payload = pendingClicks.shift();
      window.webContents.send("notification-click", payload);
      log.info("Queued notification click delivered", { type: payload.type, screen: payload.screen });
      delivered += 1;
    }
    return delivered;
  }

  function show(payload) {
    const normalized = normalizePayload(payload);
    log.info("Native notification requested", { type: normalized.type, screen: normalized.screen });
    if (!Notification.isSupported()) {
      log.warn("Native notifications are not supported by this runtime", { platform: process.platform });
      return false;
    }
    const notification = new Notification({
      title: normalized.title, body: normalized.body, icon: iconPath(), silent: normalized.silent
    });
    notification.on("show", () => log.info("Native notification displayed", { type: normalized.type, screen: normalized.screen }));
    notification.on("failed", (_event, error) => log.error("Native notification failed", {
      type: normalized.type, error: error?.message || String(error || "unknown")
    }));
    notification.on("click", () => deliverClick({ type: normalized.type, screen: normalized.screen, data: normalized.data }));
    notification.on("close", () => log.info("Native notification closed", { type: normalized.type, screen: normalized.screen }));
    notification.show();
    return true;
  }

  function markClickListenerReady() {
    clickListenerReady = true;
    return flushPendingClicks();
  }

  function markRendererLoading() {
    clickListenerReady = false;
  }

  function takePendingClick() {
    return pendingClicks.shift() || null;
  }

  return {
    show,
    deliverClick,
    flushPendingClicks,
    markClickListenerReady,
    markRendererLoading,
    takePendingClick,
    pendingClickCount: () => pendingClicks.length
  };
}

module.exports = { ALLOWED_TYPES, createNotificationService, normalizePayload };
