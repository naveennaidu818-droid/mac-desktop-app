"use strict";

const TYPE_ALIASES = Object.freeze({
  ringing: "incoming-call",
  call: "incoming-call",
  message: "chat",
  "new-message": "chat",
  mention: "chat",
  "meeting-started": "meeting",
  "meeting-reminder": "meeting",
  "upcoming-meeting": "meeting",
  "sync-completed": "contact-sync",
  system: "general"
});

const DEFAULT_SCREENS = Object.freeze({
  "incoming-call": "/calls",
  "missed-call": "/calls",
  sms: "/sms",
  chat: "/chat",
  whatsapp: "/whatsapp",
  meeting: "/meetings",
  voicemail: "/voicemails",
  "contact-sync": "/contact-sync",
  presence: "/contacts",
  general: "/notifications"
});

function canonicalNotificationType(value) {
  const raw = String(value || "general").trim().toLowerCase();
  return TYPE_ALIASES[raw] || (DEFAULT_SCREENS[raw] ? raw : "general");
}

function safeScreen(value, type) {
  const raw = String(value || "").trim();
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return DEFAULT_SCREENS[type] || DEFAULT_SCREENS.general;
}

function sanitizeNotificationTitle(value) {
  return String(value || "VitelGlobal Desktop")
    .replace(/^\?\?\s+(?=New (?:SMS|MMS)\b)/i, "")
    .slice(0, 120);
}

function normalizeNotificationPayload(payload = {}) {
  const type = canonicalNotificationType(payload.type);
  const data = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? { ...payload.data }
    : {};
  for (const key of ["conversationId", "peerNumber", "callId", "meetingId", "voicemailId", "contactId", "messageId", "id"]) {
    if (data[key] == null && payload[key] != null) data[key] = payload[key];
  }
  const screen = safeScreen(payload.screen || data.screen, type);
  const entityId = data.conversationId || data.peerNumber || data.callId || data.callerNumber || data.meetingId
    || data.voicemailId || data.contactId || data.id || payload.conversationId || "";
  const sourceId = payload.id || data.notificationId || data.messageId || entityId;

  return {
    title: sanitizeNotificationTitle(payload.title),
    body: String(payload.body || "").slice(0, 500),
    silent: Boolean(payload.silent),
    type,
    screen,
    data,
    entityId: String(entityId || ""),
    dedupeKey: [type, String(sourceId || ""), sanitizeNotificationTitle(payload.title), String(payload.body || "")].join("|")
  };
}

function createNotificationDeduper({ windowMs = 2500, now = () => Date.now() } = {}) {
  const recent = new Map();
  return {
    shouldDeliver(key) {
      const safeKey = String(key || "");
      const currentTime = now();
      for (const [existingKey, createdAt] of recent) {
        if (currentTime - createdAt > windowMs) recent.delete(existingKey);
      }
      if (!safeKey || recent.has(safeKey)) return !safeKey;
      recent.set(safeKey, currentTime);
      return true;
    },
    size() {
      return recent.size;
    }
  };
}

function buildWindowsLaunchSpec({ isPackaged, execPath, portableExecutableFile, appPath, brandedIconPath }) {
  const target = String(portableExecutableFile || execPath || "");
  const resolvedAppPath = String(appPath || "");
  const isElectronDist = target.toLowerCase().endsWith("electron.exe");
  const needsAppArg = !isPackaged || isElectronDist;
  const args = needsAppArg && resolvedAppPath ? '"' + resolvedAppPath + '"' : "";
  return {
    target,
    args,
    protocolArgs: needsAppArg && resolvedAppPath ? [resolvedAppPath] : [],
    cwd: isPackaged ? require("node:path").win32.dirname(target) : (resolvedAppPath || process.cwd()),
    icon: isPackaged ? target : String(brandedIconPath || target)
  };
}

function shouldClearNotificationType(notificationType, requestedType) {
  const requested = String(requestedType || "").trim();
  if (!requested) return true;
  return canonicalNotificationType(notificationType) === canonicalNotificationType(requested);
}
function notificationActionPayload(notification, action) {
  const normalizedAction = action === "accept" ? "accept" : action === "reject" ? "reject" : "open";
  return {
    type: notification.type,
    screen: notification.screen,
    data: {
      ...notification.data,
      notificationAction: normalizedAction,
      answerImmediately: normalizedAction === "accept",
      rejectImmediately: normalizedAction === "reject"
    }
  };
}

module.exports = {
  DEFAULT_SCREENS,
  buildWindowsLaunchSpec,
  canonicalNotificationType,
  createNotificationDeduper,
  normalizeNotificationPayload,
  notificationActionPayload,
  sanitizeNotificationTitle,
  shouldClearNotificationType
};