"use strict";

const assert = require("node:assert/strict");
const {
  buildWindowsLaunchSpec,
  canonicalNotificationType,
  createNotificationDeduper,
  normalizeNotificationPayload,
  notificationActionPayload,
  resolveNotificationAction,
  sanitizeNotificationTitle,
  shouldClearNotificationType
} = require("../src/main/notificationPolicy");

let checks = 0;
function equal(actual, expected, label) {
  assert.equal(actual, expected, label);
  checks += 1;
}
function deepEqual(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks += 1;
}
function ok(value, label) {
  assert.ok(value, label);
  checks += 1;
}

const routingCases = [
  ["incoming-call", "incoming-call", "/calls"],
  ["ringing", "incoming-call", "/calls"],
  ["call", "incoming-call", "/calls"],
  ["missed-call", "missed-call", "/calls"],
  ["sms", "sms", "/sms"],
  ["chat", "chat", "/chat"],
  ["whatsapp", "whatsapp", "/whatsapp"],
  ["message", "chat", "/chat"],
  ["new-message", "chat", "/chat"],
  ["mention", "chat", "/chat"],
  ["meeting", "meeting", "/meetings"],
  ["meeting-started", "meeting", "/meetings"],
  ["meeting-reminder", "meeting", "/meetings"],
  ["upcoming-meeting", "meeting", "/meetings"],
  ["voicemail", "voicemail", "/voicemails"],
  ["contact-sync", "contact-sync", "/contact-sync"],
  ["sync-completed", "contact-sync", "/contact-sync"],
  ["presence", "presence", "/contacts"],
  ["general", "general", "/notifications"],
  ["system", "general", "/notifications"],
  ["unknown-type", "general", "/notifications"]
];

for (const [inputType, expectedType, expectedScreen] of routingCases) {
  const normalized = normalizeNotificationPayload({ inputType, type: inputType, data: { id: inputType + "-1" } });
  equal(normalized.type, expectedType, inputType + " canonical type");
  equal(normalized.screen, expectedScreen, inputType + " route");
}

equal(canonicalNotificationType(" NEW-MESSAGE "), "chat", "type normalization trims and lowercases");
equal(normalizeNotificationPayload({ type: "sms", screen: "/sms?conversationId=10" }).screen, "/sms?conversationId=10", "safe internal screen retained");
equal(normalizeNotificationPayload({ type: "sms", screen: "https://evil.invalid" }).screen, "/sms", "external URL rejected");
equal(normalizeNotificationPayload({ type: "chat", screen: "//evil.invalid" }).screen, "/chat", "protocol-relative URL rejected");

const longTitle = "T".repeat(200);
const longBody = "B".repeat(700);
const bounded = normalizeNotificationPayload({ title: longTitle, body: longBody });
equal(bounded.title.length, 120, "title bounded");
equal(bounded.body.length, 500, "body bounded");

const sms = normalizeNotificationPayload({
  type: "sms",
  title: "Rob",
  body: "Latest SMS",
  conversationId: "19086631380",
  data: { messageId: "sms-10", peerNumber: "19086631380" }
});
equal(sms.entityId, "19086631380", "SMS exact peer retained");
equal(sms.data.conversationId, "19086631380", "top-level conversation copied into click data");
ok(sms.dedupeKey.startsWith("sms|sms-10|"), "SMS stable duplicate key");

const entityCases = [
  ["incoming-call", { callId: "call-8" }, "call-8"],
  ["whatsapp", { conversationId: "wa-12" }, "wa-12"],
  ["meeting", { meetingId: "meeting-9" }, "meeting-9"],
  ["voicemail", { voicemailId: "vm-10" }, "vm-10"],
  ["contact-sync", { contactId: "contact-11" }, "contact-11"]
];
for (const [type, data, expectedId] of entityCases) {
  equal(normalizeNotificationPayload({ type, data }).entityId, expectedId, type + " entity retained");
}

const malformed = normalizeNotificationPayload({ type: "sms", data: ["invalid"] });
deepEqual(malformed.data, {}, "array payload rejected safely");
equal(malformed.silent, false, "silent defaults false");
equal(normalizeNotificationPayload({ silent: 1 }).silent, true, "silent normalized boolean");

const call = normalizeNotificationPayload({ type: "ringing", data: { callId: "call-1", callerNumber: "19085550100" } });
deepEqual(notificationActionPayload(call, "accept"), {
  type: "incoming-call",
  screen: "/calls",
  data: {
    callId: "call-1",
    callerNumber: "19085550100",
    notificationAction: "accept",
    answerImmediately: true,
    rejectImmediately: false
  }
}, "incoming call accept action");
equal(notificationActionPayload(call, "reject").data.rejectImmediately, true, "incoming call reject action");
equal(sanitizeNotificationTitle("?? New SMS from Main Board"), "New SMS from Main Board", "malformed SMS title prefix removed");
equal(sanitizeNotificationTitle("Incoming Audio Call"), "Incoming Audio Call", "valid notification title preserved");
equal(normalizeNotificationPayload({ type: "incoming-call", data: { callerNumber: "19085550100" } }).entityId, "19085550100", "incoming caller number is a stable fallback identity");
equal(notificationActionPayload(call, "anything").data.notificationAction, "open", "unknown action becomes open");
equal(resolveNotificationAction({ actionIndex: 0 }, undefined), "accept", "Electron 43 action details accept index");
equal(resolveNotificationAction({ actionIndex: 1 }, undefined), "reject", "Electron 43 action details reject index");
equal(resolveNotificationAction({}, 0), "accept", "legacy Electron accept index fallback");
equal(resolveNotificationAction({}, 1), "reject", "legacy Electron reject index fallback");
equal(resolveNotificationAction({}, undefined), "open", "missing native action index opens application safely");

let clock = 1000;
const deduper = createNotificationDeduper({ windowMs: 2500, now: () => clock });
equal(deduper.shouldDeliver("sms-1"), true, "first notification delivered");
equal(deduper.shouldDeliver("sms-1"), false, "immediate duplicate suppressed");
equal(deduper.shouldDeliver("sms-2"), true, "different notification delivered");
equal(deduper.size(), 2, "dedupe state tracks keys");
clock = 4001;
equal(deduper.shouldDeliver("sms-1"), true, "same notification allowed after window");
equal(deduper.size(), 1, "expired dedupe keys pruned");
equal(deduper.shouldDeliver(""), true, "missing key never suppresses delivery");

equal(shouldClearNotificationType("incoming-call", "incoming-call"), true, "incoming call cleanup matches incoming toast");
equal(shouldClearNotificationType("ringing", "incoming-call"), true, "ringing alias cleanup matches incoming toast");
equal(shouldClearNotificationType("missed-call", "incoming-call"), false, "incoming cleanup preserves missed-call toast");
equal(shouldClearNotificationType("sms", "incoming-call"), false, "incoming cleanup preserves SMS toast");
equal(shouldClearNotificationType("voicemail", ""), true, "empty cleanup type clears all notifications");
const developmentLaunch = buildWindowsLaunchSpec({
  isPackaged: false,
  execPath: "C:\\project\\node_modules\\electron\\dist\\electron.exe",
  appPath: "C:\\project\\exe-file",
  brandedIconPath: "C:\\project\\exe-file\\build\\icons\\icon.ico"
});
equal(developmentLaunch.target, "C:\\project\\node_modules\\electron\\dist\\electron.exe", "development uses Electron binary");
equal(developmentLaunch.args, '"C:\\project\\exe-file"', "development includes exact app argument");
deepEqual(developmentLaunch.protocolArgs, ["C:\\project\\exe-file"], "development protocol includes app argument");
equal(developmentLaunch.cwd, "C:\\project\\exe-file", "development working directory is app");
equal(developmentLaunch.icon, "C:\\project\\exe-file\\build\\icons\\icon.ico", "development uses branded icon");

const packagedLaunch = buildWindowsLaunchSpec({
  isPackaged: true,
  execPath: "C:\\temp\\VitelGlobal Desktop.exe",
  portableExecutableFile: "C:\\release\\VitelGlobal Desktop-portable.exe",
  appPath: "C:\\temp\\resources\\app.asar",
  brandedIconPath: "C:\\temp\\icon.ico"
});
equal(packagedLaunch.target, "C:\\release\\VitelGlobal Desktop-portable.exe", "portable uses permanent launcher");
equal(packagedLaunch.args, "", "packaged launch has no development argument");
deepEqual(packagedLaunch.protocolArgs, [], "packaged protocol has no development argument");
equal(packagedLaunch.cwd, "C:\\release", "packaged working directory follows permanent launcher");
equal(packagedLaunch.icon, "C:\\release\\VitelGlobal Desktop-portable.exe", "packaged shortcut uses executable icon");

console.log("OK " + checks + " desktop notification unit checks passed");
