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
  download: null,
  export: null,
  general: null
});

function canonicalNotificationType(value) {
  const raw = String(value || "general").trim().toLowerCase();
  return TYPE_ALIASES[raw] || (DEFAULT_SCREENS[raw] !== undefined ? raw : "general");
}

function safeScreen(value, type) {
  if (type === "download" || type === "export" || type === "general") return null;
  const raw = String(value || "").trim();
  if (raw === "/notifications") return null;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return DEFAULT_SCREENS[type] || null;
}

function sanitizeNotificationTitle(title = "") {
  const str = String(title || "");
  const cleaned = str.replace(/^[\?\s\uFFFD\u200B-\u200D\uFEFF]+/, "").trim();
  return cleaned || "VitelGlobal Desktop";
}

function normalizeNotificationPayload(payload = {}) {
  const type = canonicalNotificationType(payload.type);
  const data = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? { ...payload.data }
    : {};
  for (const key of ["conversationId", "peerNumber", "callId", "meetingId", "voicemailId", "contactId", "callerNumber", "messageId", "id"]) {
    if (data[key] == null && payload[key] != null) data[key] = payload[key];
  }
  const screen = safeScreen(payload.screen || data.screen, type);
  const entityId = data.conversationId || data.peerNumber || data.callId || data.meetingId
    || data.voicemailId || data.contactId || data.callerNumber || data.id || payload.conversationId || "";
  const isVideoFlag = Boolean(data.isVideo === true || data.isVideo === "true");
  const explicitMsgId = String(payload.id || data.id || data.messageId || "").trim();
  const sourceId = explicitMsgId || entityId;
  const dedupeKey = explicitMsgId
    ? `${type}:msg:${explicitMsgId}:v=${isVideoFlag}`
    : [type, String(sourceId || ""), String(payload.title || ""), String(payload.body || ""), String(isVideoFlag)].join("|");

  return {
    title: sanitizeNotificationTitle(payload.title || "VitelGlobal Desktop").slice(0, 120),
    body: String(payload.body || "").slice(0, 500),
    silent: Boolean(payload.silent),
    type,
    screen,
    data,
    entityId: String(entityId || ""),
    dedupeKey
  };
}

function createNotificationDeduper({ windowMs = 2500, now = () => Date.now() } = {}) {
  const recent = new Map();
  return {
    shouldDeliver(key) {
      const safeKey = String(key || "");
      const currentTime = now();
      const isExplicitMsgId = safeKey.includes(":msg:");
      const maxAge = isExplicitMsgId ? 600000 : windowMs;
      for (const [existingKey, createdAt] of recent) {
        const itemMaxAge = existingKey.includes(":msg:") ? 600000 : windowMs;
        if (currentTime - createdAt > itemMaxAge) recent.delete(existingKey);
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

function notificationActionPayload(notification, action) {
  const isVideoCall = Boolean(notification.data?.isVideo === true || notification.data?.isVideo === "true");
  const normalizedAction =
    action === "accept-video" || action === "answer-video"
      ? "accept-video"
      : action === "accept-audio" || action === "answer-audio"
        ? "accept-audio"
        : action === "accept" || action === "answer"
          ? (isVideoCall ? "accept-video" : "accept")
          : action === "reject" || action === "decline"
            ? "reject"
            : action === "close" || action === "dismiss" || action === "silence"
              ? "close"
              : "open";

  const isAccept = normalizedAction === "accept" || normalizedAction === "accept-video" || normalizedAction === "accept-audio";
  const data = {
    ...notification.data,
    notificationAction: normalizedAction,
    answerImmediately: isAccept,
    answerWithVideo: normalizedAction === "accept-video",
    audioOnly: normalizedAction === "accept-audio",
    rejectImmediately: normalizedAction === "reject"
  };
  if (normalizedAction === "close") {
    data.silenceImmediately = true;
  }
  return {
    type: notification.type,
    screen: notification.screen,
    data
  };
}

function resolveNotificationAction(details, legacyIndex, isVideo = false) {
  let index = -1;
  if (Number.isInteger(legacyIndex)) {
    index = legacyIndex;
  } else if (Number.isInteger(details?.actionIndex)) {
    index = details.actionIndex;
  } else if (Number.isInteger(details?.index)) {
    index = details.index;
  } else if (Number.isInteger(details)) {
    index = details;
  }

  const actionText = String(details?.action || details?.text || (typeof details === "string" ? details : "")).toLowerCase();
  if (actionText.includes("video")) return "accept-video";
  if (actionText.includes("audio")) return "accept-audio";
  if (actionText.includes("answer") || actionText.includes("accept")) return isVideo ? "accept-video" : "accept";
  if (actionText.includes("reject") || actionText.includes("decline")) return "reject";
  if (actionText.includes("close") || actionText.includes("dismiss") || actionText.includes("silence")) return "close";

  if (isVideo) {
    if (index === 0) return "accept-video";
    if (index === 1) return "accept-audio";
    if (index === 2) return "reject";
  } else {
    if (index === 0) return "accept";
    if (index === 1) return "reject";
  }

  return "open";
}

function shouldClearNotificationType(activeType, targetType) {
  if (!targetType) return true;
  return canonicalNotificationType(activeType) === canonicalNotificationType(targetType);
}

module.exports = {
  DEFAULT_SCREENS,
  buildWindowsLaunchSpec,
  canonicalNotificationType,
  createNotificationDeduper,
  normalizeNotificationPayload,
  notificationActionPayload,
  resolveNotificationAction,
  sanitizeNotificationTitle,
  shouldClearNotificationType
};