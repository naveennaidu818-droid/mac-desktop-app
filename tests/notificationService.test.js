"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createNotificationService, normalizePayload } = require("../src/main/notificationService");

function fixture({ supported = true, loading = false } = {}) {
  const notifications = [], sends = [], logs = [];
  let restoreCount = 0;
  class FakeNotification extends EventEmitter {
    static isSupported() { return supported; }
    constructor(options) { super(); this.options = options; notifications.push(this); }
    show() { this.emit("show"); }
  }
  const webContents = { isDestroyed: () => false, isLoadingMainFrame: () => loading, send: (...args) => sends.push(args) };
  const window = { isDestroyed: () => false, webContents };
  const log = Object.fromEntries(["info", "warn", "error"].map((level) => [level, (message, details) => logs.push({ level, message, details })]));
  const service = createNotificationService({ Notification: FakeNotification, getMainWindow: () => window,
    showMainWindow: () => { restoreCount += 1; }, iconPath: () => "/icon.png", log });
  return { service, notifications, sends, logs, setLoading: (value) => { loading = value; }, restoreCount: () => restoreCount };
}

test("normalizes untrusted renderer payloads", () => {
  const payload = normalizePayload({ title: "x".repeat(150), body: "y".repeat(600), type: "unexpected", screen: "/sms/123", data: [] });
  assert.equal(payload.title.length, 120); assert.equal(payload.body.length, 500);
  assert.equal(payload.type, "general"); assert.equal(payload.screen, "/sms/123"); assert.deepEqual(payload.data, {});
});

test("creates and displays a native notification", () => {
  const f = fixture();
  assert.equal(f.service.show({ title: "Alice", body: "New SMS", type: "sms", screen: "/sms/42" }), true);
  assert.deepEqual(f.notifications[0].options, { title: "Alice", body: "New SMS", icon: "/icon.png", silent: false });
  assert.ok(f.logs.some((entry) => entry.message === "Native notification displayed"));
});

test("logs unsupported native notifications", () => {
  const f = fixture({ supported: false }); assert.equal(f.service.show({ type: "chat" }), false);
  assert.equal(f.notifications.length, 0); assert.ok(f.logs.some((entry) => entry.level === "warn"));
});

test("click restores existing window and sends exact destination", () => {
  const f = fixture(), data = { conversationId: "sms-123" };
  f.service.markClickListenerReady();
  f.service.show({ type: "sms", screen: "/sms/sms-123", data }); f.notifications[0].emit("click");
  assert.equal(f.restoreCount(), 1); assert.deepEqual(f.sends, [["notification-click", { type: "sms", screen: "/sms/sms-123", data }]]);
});

test("queues click during renderer load and delivers it exactly once", () => {
  const f = fixture({ loading: true });
  f.service.markClickListenerReady();
  f.service.show({ type: "meeting", screen: "/meetings/abc", data: { meetingId: "abc" } }); f.notifications[0].emit("click");
  assert.equal(f.restoreCount(), 1); assert.equal(f.service.pendingClickCount(), 1); assert.deepEqual(f.sends, []);
  f.setLoading(false); assert.equal(f.service.flushPendingClicks(), 1); assert.equal(f.service.flushPendingClicks(), 0);
  assert.deepEqual(f.sends[0][1], { type: "meeting", screen: "/meetings/abc", data: { meetingId: "abc" } });
});

test("holds a click until the renderer notification listener registers", () => {
  const f = fixture();
  f.service.show({ type: "chat", screen: "/chat", data: { conversationId: "chat-9" } });
  f.notifications[0].emit("click");
  assert.equal(f.service.pendingClickCount(), 1); assert.deepEqual(f.sends, []);
  assert.equal(f.service.markClickListenerReady(), 1);
  assert.deepEqual(f.sends[0][1], { type: "chat", screen: "/chat", data: { conversationId: "chat-9" } });
});

test("supports deployed renderer pending-click recovery", () => {
  const f = fixture({ loading: true });
  f.service.show({ type: "incoming-call", screen: "/calls", data: { callId: "call-7" } });
  f.notifications[0].emit("click");
  assert.deepEqual(f.service.takePendingClick(), { type: "incoming-call", screen: "/calls", data: { callId: "call-7" } });
  assert.equal(f.service.takePendingClick(), null);
});

for (const type of ["incoming-call", "missed-call", "sms", "chat", "meeting", "voicemail", "contact-sync", "general"]) {
  test(`preserves ${type} routing metadata`, () => {
    const f = fixture(), screen = `/${type}/entity-1`, data = { id: "entity-1" };
    f.service.markClickListenerReady();
    f.service.show({ type, screen, data }); f.notifications[0].emit("click");
    assert.deepEqual(f.sends[0][1], { type, screen, data });
  });
}
