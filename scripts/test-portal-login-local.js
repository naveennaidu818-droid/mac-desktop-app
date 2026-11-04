"use strict";

// Exercise the actual portal IPC handler in hidden Electron windows with only
// loopback fixtures. This never loads the main app or external portal services.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const http = require("node:http");
const { attachPortalAutoLogin } = require("../src/main/portalAutoLogin");

app.setPath("userData", path.resolve(__dirname, "../dist/portal-login-local/test-profile"));
app.on("window-all-closed", () => {});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const received = [];
const server = http.createServer((request, response) => {
  if (request.url === "/submit") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      received.push(Object.fromEntries(new URLSearchParams(body)));
      response.setHeader("Content-Type", "text/html");
      response.end("<h1>Signed in locally</h1>");
    });
    return;
  }
  response.setHeader("Content-Type", "text/html");
  response.end(`<html><body><div id="root">Loading local fixture...</div><script>
    setTimeout(() => {
      document.getElementById('root').innerHTML = '<form method="post" action="/submit"><input name="username" autocomplete="username"><input name="password" type="password"><button type="submit">Sign in</button></form>';
    }, 1200);
  </script></body></html>`);
});

async function waitForSubmission(count) {
  const deadline = Date.now() + 10000;
  while (received.length < count && Date.now() < deadline) await delay(100);
  assert.equal(received.length, count, "Expected one local form submission per launch");
  await delay(500);
}

app.whenReady().then(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const targetUrl = `http://127.0.0.1:${server.address().port}/login`;
  const source = fs.readFileSync(path.resolve(__dirname, "../src/main/index.js"), "utf8");
  const start = source.indexOf('  ipcMain.handle("app:open-portal",');
  const end = source.indexOf('  ipcMain.handle("app:get-location",', start);
  assert.ok(start >= 0 && end > start);
  let openPortal;
  function HiddenWindow(options) {
    const window = new BrowserWindow(options);
    window.show = () => {};
    window.focus = () => {};
    return window;
  }
  HiddenWindow.getAllWindows = () => BrowserWindow.getAllWindows();
  vm.runInNewContext(source.slice(start, end), {
    ipcMain: { handle: (_name, handler) => { openPortal = handler; } },
    BrowserWindow: HiddenWindow, session, URL, mainWindow: null,
    getPortalPartition: () => "portal-login-local-test",
    applyPortalSessionCookies: async () => ({ ok: true }),
    attachPortalAutoLogin,
    isTrustedUrl: () => false,
    shell: { openExternal: () => { throw new Error("External navigation forbidden in local test"); } },
    log: { info() {}, warn() {}, error() {} },
  });
  let bridge;
  const invocations = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../src/preload/index.js"), "utf8"), {
    window: { addEventListener() {} },
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, api) => { bridge = api; } },
      ipcRenderer: {
        invoke: (channel, payload) => {
          invocations.push([channel, payload]);
          return channel === "app:open-portal" ? openPortal(null, payload) : Promise.resolve({ ok: true });
        },
      },
    }),
  });
  const launch = (username, password) => bridge.openPortal({
    targetUrl, credentials: { username, password },
  });
  assert.equal((await launch("first-user", "first-password")).ok, true);
  await waitForSubmission(1);
  assert.deepEqual(received[0], { username: "first-user", password: "first-password" });
  const firstWindow = BrowserWindow.getAllWindows()[0];
  assert.equal((await launch("second-user", "second-password")).ok, true);
  await waitForSubmission(2);
  assert.deepEqual(received[1], { username: "second-user", password: "second-password" });
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  assert.equal(BrowserWindow.getAllWindows()[0], firstWindow);
  assert.equal((await openPortal(null, { targetUrl: "file:///invalid-portal" })).ok, false);
  assert.equal(received.length, 2);
  await bridge.clearPortalCookies(targetUrl);
  assert.deepEqual(invocations.at(-1), ["app:clear-portal-cookies", targetUrl]);
  console.log("PASS: preload-to-main portal bridge, delayed form, saved credentials, reused window with fresh credentials, single submission, invalid URL rejection, scoped disconnect (loopback only).");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  server.close();
  app.exit(process.exitCode || 0);
});
