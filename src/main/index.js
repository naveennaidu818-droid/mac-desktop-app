"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  shell,
  Notification,
  session,
  dialog,
  clipboard,
  globalShortcut,
  crashReporter,
  systemPreferences,
  protocol,
  net,
  desktopCapturer
} = require("electron");
const log = require("electron-log/main");
const sqliteDb = require("./database");

function fillPortalLogin({ origin, username, password, attemptId }) {
  if (window.location.origin !== origin) return false;
  if (window.__vitelPortalAttempt?.id === attemptId) return window.__vitelPortalAttempt.submitted;
  const visible = (input) => !input.disabled && !input.readOnly &&
    input.getClientRects().length > 0;
  const passwordInput = [...document.querySelectorAll('input[type="password"]')].find(visible);
  if (!passwordInput) return false;
  const form = passwordInput.closest("form");
  const root = form || document;
  if (passwordInput.autocomplete === "new-password" || root.querySelectorAll('input[type="password"]').length !== 1) return false;
  const usernameInput = [...root.querySelectorAll(
    'input[autocomplete="username"], input[type="email"], input[name*="user" i], input[name*="email" i], input[type="text"], input:not([type])'
  )].find((input) => input !== passwordInput && input.type !== "hidden" && visible(input));
  if (!usernameInput) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  for (const [input, value] of [[usernameInput, username], [passwordInput, password]]) {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  window.__vitelPortalAttempt = { id: attemptId, submitted: false };
  return new Promise((resolve) => setTimeout(() => {
    if (window.location.origin !== origin || !passwordInput.isConnected) {
      delete window.__vitelPortalAttempt;
      resolve(false);
      return;
    }
    const submit = [...root.querySelectorAll('button, input[type="submit"]')].find((button) =>
      !button.disabled && button.getClientRects().length > 0 &&
      (button.type === "submit" || /^(log\s*in|sign\s*in|login)$/i.test(button.textContent.trim()))
    );
    if (submit) {
      window.__vitelPortalAttempt.submitted = true;
      resolve(true);
      submit.click();
    }
    else if (form && !root.querySelector('[type="submit"]') && typeof form.requestSubmit === "function") {
      window.__vitelPortalAttempt.submitted = true;
      resolve(true);
      form.requestSubmit();
    }
    else {
      delete window.__vitelPortalAttempt;
      resolve(false);
    }
  }, 250));
}

function attachPortalAutoLogin(webContents, { targetUrl, username, password }, {
  intervalMs = 400, timeoutMs = 20000,
} = {}) {
  if (!username || !password) return () => {};
  const origin = new URL(targetUrl).origin;
  const attemptId = require("node:crypto").randomUUID();
  const script = `(${fillPortalLogin.toString()})(${JSON.stringify({ origin, username, password, attemptId })})`;
  let busy = false;
  let stopped = false;
  const tick = async () => {
    if (stopped || busy || webContents.isDestroyed()) return;
    try {
      if (new URL(webContents.getURL()).origin !== origin) return;
      busy = true;
      if (await webContents.executeJavaScript(script)) stop();
    } catch { /* Navigation can replace the execution context; retry on load. */ }
    finally { busy = false; }
  };
  const interval = setInterval(tick, intervalMs);
  const stop = () => {
    stopped = true;
    clearInterval(interval);
    clearTimeout(timeout);
    try {
      if (webContents && !webContents.isDestroyed()) {
        webContents.removeListener("dom-ready", tick);
        webContents.removeListener("did-finish-load", tick);
        webContents.removeListener("destroyed", stop);
      }
    } catch (_) {}
  };
  const timeout = setTimeout(stop, timeoutMs);
  webContents.on("dom-ready", tick);
  webContents.on("did-finish-load", tick);
  webContents.once("destroyed", stop);
  return stop;
}
const {
  buildWindowsLaunchSpec,
  createNotificationDeduper,
  normalizeNotificationPayload,
  notificationActionPayload,
  resolveNotificationAction
} = require("./notificationPolicy");

const APP_NAME = "VitelGlobal Desktop";
const WINDOWS_APP_USER_MODEL_ID = "com.vitelglobal.desktop";
const WINDOWS_TOAST_ACTIVATOR_CLSID = "{D7F34804-48E6-41EB-8EBA-57EEC402B21A}";
const APP_URL = process.env.VITELGLOBAL_APP_URL || "https://desktop.officemeetings.net/";
const HOME_ORIGIN = new URL(APP_URL).origin;
const TRUSTED_HOST_SUFFIXES = [
  "officemeetings.net",
  "vitelglobal.com",
  "vitelglobal.in",
  "bharatpayroll.com",
  "pranathiss.com"
];

let mainWindow;
let splashWindow;
let tray;
let isQuitting = false;
let pendingDeepLink;
let pendingNotificationClick = null;
const activeNativeNotifications = new Set();
const nativeNotificationDeduper = createNotificationDeduper({ windowMs: 2500 });
let activeDockBounceId = null;

function stopDockBounce() {
  if (process.platform === "darwin" && app.dock && activeDockBounceId !== null) {
    try {
      app.dock.cancelBounce(activeDockBounceId);
    } catch (e) { }
    activeDockBounceId = null;
  }
}
let autoUpdater;
const gotSingleInstanceLock = app.requestSingleInstanceLock();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

app.name = APP_NAME;
app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
if (process.platform === "win32") {
  app.setToastActivatorCLSID(WINDOWS_TOAST_ACTIVATOR_CLSID);
}

let backgroundNoticeShown = false;

function registerWindowsNotificationShortcut() {
  if (process.platform !== "win32") {
    return;
  }

  const legacyElectronShortcutPath = path.join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Electron.lnk"
  );
  try {
    if (fs.existsSync(legacyElectronShortcutPath)) {
      fs.unlinkSync(legacyElectronShortcutPath);
      log.info("Cleaned up legacy Electron shortcut:", legacyElectronShortcutPath);
    }
  } catch (e) { }

  const additionalLegacyElectronPaths = [
    path.join(app.getPath("desktop"), "Electron.lnk"),
    path.join(process.env.PROGRAMDATA || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs", "Electron.lnk")
  ];
  for (const legacyPath of additionalLegacyElectronPaths) {
    try {
      if (fs.existsSync(legacyPath)) {
        fs.unlinkSync(legacyPath);
      }
    } catch (e) { }
  }

  const shortcutPaths = [
    path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "VitelGlobal Desktop.lnk"),
    path.join(app.getPath("desktop"), "VitelGlobal Desktop.lnk")
  ];

  const launchSpec = buildWindowsLaunchSpec({
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    portableExecutableFile: process.env.PORTABLE_EXECUTABLE_FILE,
    appPath: app.getAppPath(),
    brandedIconPath: assetPath("icons", "icon.ico")
  });
  const shortcutOptions = {
    target: launchSpec.target,
    args: launchSpec.args,
    cwd: launchSpec.cwd,
    icon: launchSpec.icon,
    iconIndex: 0,
    appUserModelId: WINDOWS_APP_USER_MODEL_ID,
    toastActivatorClsid: WINDOWS_TOAST_ACTIVATOR_CLSID,
    description: "VitelGlobal Desktop enterprise communications shell"
  };

  try {
    for (const shortcutPath of shortcutPaths) {
      shell.writeShortcutLink(shortcutPath, "replace", shortcutOptions)
        || shell.writeShortcutLink(shortcutPath, "create", shortcutOptions);
    }
    log.info("Registered Windows notification shortcut", {
      target: launchSpec.target,
      args: launchSpec.args,
      icon: launchSpec.icon,
      portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE)
    });
  } catch (err) {
    log.error("Failed to register Start Menu shortcut for notifications:", err);
  }
}

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("enable-features", "WebRtcApmInAudioService,WebRtcAllowInputVolumeAdjustment");

log.initialize({ preload: true });
log.transports.file.level = "info";
log.transports.file.maxSize = 10 * 1024 * 1024;
log.transports.console.level = app.isPackaged ? "warn" : "debug";

crashReporter.start({
  uploadToServer: false,
  compress: true,
  companyName: "VitelGlobal",
  productName: APP_NAME,
  submitURL: "https://updates.vitelglobal.com/crash"
});

function assetPath(...segments) {
  return path.join(__dirname, "..", "..", "build", ...segments);
}

function rendererPath(fileName) {
  return path.join(__dirname, "..", "renderer", fileName);
}

function localPage(fileName) {
  return pathToFileURL(rendererPath(fileName)).toString();
}

function iconPath() {
  const png = assetPath("icons", "icon.png");
  const ico = assetPath("icons", "icon.ico");
  return process.platform === "win32" ? ico : png;
}

function getAppDistPath() {
  const packagedPath = path.join(__dirname, "..", "app-dist");
  if (fs.existsSync(path.join(packagedPath, "index.html"))) {
    return packagedPath;
  }
  const devPath = path.resolve(__dirname, "..", "..", "..", "web-app", "dist");
  if (fs.existsSync(path.join(devPath, "index.html"))) {
    return devPath;
  }
  return null;
}

function registerAppProtocol() {
  const distDir = getAppDistPath();
  if (!distDir) {
    log.warn("[Main] Local web app dist directory not found. Protocol app:// not registered.");
    return;
  }

  log.info("[Main] Registering app:// protocol mapped to:", distDir);

  protocol.handle("app", (request) => {
    try {
      const parsedUrl = new URL(request.url);
      let requestedPath = decodeURIComponent(parsedUrl.pathname);
      if (requestedPath === "/" || requestedPath === "") {
        requestedPath = "/index.html";
      }

      const safePath = path.normalize(requestedPath).replace(/^(\.\.[\/\\])+/, "");
      let resolvedPath = path.join(distDir, safePath);

      if (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
        resolvedPath = path.join(distDir, "index.html");
      }

      return net.fetch(pathToFileURL(resolvedPath).toString());
    } catch (err) {
      log.error("[Main] Protocol app:// error:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  });
}

function isTrustedUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (!["https:", "vitelglobal:", "app:"].includes(parsed.protocol)) {
      return false;
    }

    if (parsed.protocol === "vitelglobal:" || parsed.protocol === "app:") {
      return true;
    }

    return TRUSTED_HOST_SUFFIXES.some((suffix) => (
      parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`)
    ));
  } catch {
    return false;
  }
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function notificationLog(event, details = {}) {
  log.info("[DesktopNotification]", { event, ...details });
}

function dispatchNotificationClick(payload) {
  pendingNotificationClick = payload;
  const restored = showMainWindow("notification-click");
  notificationLog("window-restored", { restored, type: payload.type, screen: payload.screen });
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // If payload indicates stayOnPage, download, export, general, or has no valid screen to navigate to:
  // simply restore/focus the window and DO NOT dispatch a deep-link navigation!
  if (
    payload.type === "download" ||
    payload.type === "export" ||
    payload.type === "general" ||
    payload.stayOnPage ||
    payload.data?.stayOnPage ||
    !payload.screen ||
    payload.screen === "/notifications"
  ) {
    notificationLog("stay-on-page", { type: payload.type, screen: payload.screen });
    return;
  }

  const deliver = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("notification-click", payload);
    notificationLog("deep-link-dispatched", {
      type: payload.type,
      screen: payload.screen,
      entityId: payload.data?.conversationId || payload.data?.peerNumber || payload.data?.callId
        || payload.data?.meetingId || payload.data?.voicemailId || payload.data?.id || ""
    });
  };

  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once("did-finish-load", () => setTimeout(deliver, 250));
  } else {
    setTimeout(deliver, 100);
  }
}

function showNativeNotification(payload = {}) {
  if (!Notification.isSupported()) {
    notificationLog("unsupported", { type: payload.type || "general" });
    return false;
  }

  const normalized = normalizeNotificationPayload(payload);
  if (!nativeNotificationDeduper.shouldDeliver(normalized.dedupeKey)) {
    notificationLog("duplicate-suppressed", { type: normalized.type, entityId: normalized.entityId });
    return false;
  }
  notificationLog("received", { type: normalized.type, screen: normalized.screen, entityId: normalized.entityId });

  let notifIcon;
  try {
    const iconImg = nativeImage.createFromPath(iconPath());
    if (!iconImg.isEmpty()) notifIcon = iconImg;
  } catch (err) {
    log.warn("[DesktopNotification] Icon load failed", err);
  }

  const notificationOptions = {
    title: normalized.title,
    body: normalized.body,
    icon: notifIcon,
    silent: normalized.silent,
    timeoutType: normalized.type === "incoming-call" ? "never" : "default"
  };
  const isIncomingCall = normalized.type === "incoming-call";
  const isVideoCall = isIncomingCall && Boolean(normalized.data?.isVideo === true || normalized.data?.isVideo === "true");

  if ((process.platform === "darwin" || process.platform === "win32") && isIncomingCall) {
    notificationOptions.actions = isVideoCall ? [
      { type: "button", text: "Answer Video" },
      { type: "button", text: "Audio Only" },
      { type: "button", text: "Reject" }
    ] : [
      { type: "button", text: "Answer" },
      { type: "button", text: "Reject" }
    ];
  }
  if (process.platform === "darwin" && isIncomingCall) {
    notificationOptions.closeButtonText = "Reject";
  }

  try {
    const notification = new Notification(notificationOptions);
    activeNativeNotifications.add(notification);

    if (process.platform === "darwin" && app.dock) {
      try {
        stopDockBounce();
        activeDockBounceId = app.dock.bounce(isIncomingCall ? "critical" : "informational");
      } catch (error) {
        log.warn("[DesktopNotification] Dock bounce failed", error);
      }
    }

    if (isIncomingCall && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
      mainWindow.flashFrame(true);
      mainWindow.once("focus", () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(false);
      });
    }

    notification.on("click", () => {
      stopDockBounce();
      activeNativeNotifications.delete(notification);
      notificationLog("clicked", { type: normalized.type, screen: normalized.screen, action: "open" });
      dispatchNotificationClick(notificationActionPayload(normalized, "open"));
    });

    notification.on("action", (event, index) => {
      stopDockBounce();
      activeNativeNotifications.delete(notification);
      try {
        const action = resolveNotificationAction(event, index, isVideoCall);
        notificationLog("clicked", { type: normalized.type, screen: normalized.screen, action });
        const payload = notificationActionPayload(normalized, action);
        if (action === "accept" || action === "answer" || action === "accept-video" || action === "accept-audio") {
          dispatchNotificationClick(payload);
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("notification-action", payload);
        }
      } catch (err) {
        log.error("[DesktopNotification] Error handling action:", err);
      }
    });

    notification.once("show", () => {
      notificationLog("displayed", { type: normalized.type, screen: normalized.screen, entityId: normalized.entityId });
    });
    notification.on("close", () => {
      stopDockBounce();
      activeNativeNotifications.delete(notification);
      try {
        notificationLog("closed", { type: normalized.type, entityId: normalized.entityId });
        if (normalized.type === "incoming-call" && mainWindow && !mainWindow.isDestroyed()) {
          const payload = notificationActionPayload(normalized, "close");
          mainWindow.webContents.send("notification-action", payload);
        }
      } catch (err) {
        log.error("[DesktopNotification] Error handling close:", err);
      }
    });
    notification.on("failed", (_event, error) => {
      activeNativeNotifications.delete(notification);
      log.error("[DesktopNotification]", { event: "display-failed", type: normalized.type, error });
    });

    notification.show();
    registerWindowsNotificationShortcut();
    return true;
  } catch (error) {
    log.error("[DesktopNotification] Failed to create or display notification", { error: error?.message || error });
    return false;
  }
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 360,
    frame: false,
    resizable: false,
    show: false,
    center: true,
    backgroundColor: "#f6f8ff",
    icon: iconPath(),
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  try {
    const brandedIcon = nativeImage.createFromPath(assetPath("icons", "icon.png"));
    if (!brandedIcon.isEmpty()) {
      splashWindow.setIcon(brandedIcon);
    }
  } catch (e) { }

  splashWindow.loadFile(rendererPath("splash.html"));
  splashWindow.once("ready-to-show", () => splashWindow.show());
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: "#f6f8ff",
    title: APP_NAME,
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
      backgroundThrottling: false
    }
  });

  mainWindow.autoHideMenuBar = true;
  mainWindow.setMenuBarVisibility(false);

  // Block Ctrl+Shift+K, Ctrl+Shift+I, F12 and other developer shortcuts
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const isControlOrCommand = input.control || input.meta;
    const isShift = input.shift;
    const key = (input.key || "").toLowerCase();

    // Block Ctrl+Shift+K, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C
    if (isControlOrCommand && isShift && ["k", "i", "j", "c"].includes(key)) {
      event.preventDefault();
      return;
    }

    // Block F12
    if (key === "f12") {
      event.preventDefault();
      return;
    }

    // Block Ctrl+U (View Source)
    if (isControlOrCommand && key === "u") {
      event.preventDefault();
      return;
    }

    // Block Ctrl+P (Print)
    if (isControlOrCommand && key === "p") {
      event.preventDefault();
      return;
    }
  }); // vitelglobal:block-exe-shortcuts


  try {
    const brandedIcon = nativeImage.createFromPath(assetPath("icons", "icon.png"));
    if (!brandedIcon.isEmpty()) {
      mainWindow.setIcon(brandedIcon);
    }
  } catch (e) {
    log.warn("[Main] Failed to set window icon:", e);
  }

  mainWindow.on("close", (event) => {
    if (!isQuitting && process.env.VITELGLOBAL_CLOSE_TO_TRAY !== "false") {
      event.preventDefault();
      mainWindow.hide();
      if (!backgroundNoticeShown) {
        backgroundNoticeShown = true;
        showNativeNotification({
          title: APP_NAME,
          body: "Calls and notifications remain active in the background.",
          silent: true
        });
      }
    }
  });

  mainWindow.on("focus", () => {
    stopDockBounce();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window-activated");
    }
  });

  mainWindow.on("restore", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window-activated");
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
    showMainWindow("initial-ready-to-show");
    if (pendingDeepLink) {
      handleDeepLink(pendingDeepLink);
      pendingDeepLink = undefined;
    }
  });

  // Safety fallback: ensure mainWindow is displayed if ready-to-show is delayed
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
      }
      mainWindow.show();
    }
  }, 4000);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedUrl(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1366,
          height: 850,
          minWidth: 900,
          minHeight: 600,
          show: true,
          autoHideMenuBar: true,
          webPreferences: {
            session: session.defaultSession,
            nodeIntegration: false,
            contextIsolation: true
          }
        }
      };
    }

    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Enable mouse right-click context menu (Copy, Paste, Cut, Select All, Link handling)
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const menuTemplate = [];

    if (params.linkURL) {
      menuTemplate.push(
        {
          label: "Open Link",
          click: () => shell.openExternal(params.linkURL)
        },
        {
          label: "Copy Link Address",
          click: () => clipboard.writeText(params.linkURL)
        },
        { type: "separator" }
      );
    }

    if (params.selectionText && params.selectionText.trim().length > 0) {
      menuTemplate.push(
        { role: "copy", label: "Copy" }
      );
    }

    if (params.isEditable) {
      if (menuTemplate.length > 0 && !params.selectionText) {
        menuTemplate.push({ type: "separator" });
      }
      menuTemplate.push(
        { role: "undo", label: "Undo" },
        { role: "redo", label: "Redo" },
        { type: "separator" },
        { role: "cut", label: "Cut" },
        { role: "copy", label: "Copy" },
        { role: "paste", label: "Paste" },
        { role: "delete", label: "Delete" },
        { type: "separator" },
        { role: "selectAll", label: "Select All" }
      );
    } else {
      if (!params.selectionText && !params.linkURL) {
        menuTemplate.push(
          { role: "copy", label: "Copy" },
          { role: "selectAll", label: "Select All" }
        );
      } else if (params.selectionText) {
        menuTemplate.push(
          { type: "separator" },
          { role: "selectAll", label: "Select All" }
        );
      }
    }

    if (menuTemplate.length > 0) {
      const contextMenu = Menu.buildFromTemplate(menuTemplate);
      contextMenu.popup({ window: mainWindow });
    }
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    log.warn("did-fail-load", { errorCode, errorDescription, validatedUrl, isMainFrame });
    if (isMainFrame) {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
      }

      const isNetworkFailure = [
        -106, // ERR_INTERNET_DISCONNECTED
        -105, // ERR_NAME_NOT_RESOLVED
        -102, // ERR_CONNECTION_REFUSED
        -118, // ERR_CONNECTION_TIMED_OUT
        -109, // ERR_ADDRESS_UNREACHABLE
        -2,   // ERR_FAILED
        -3    // ERR_ABORTED
      ].includes(errorCode);

      const distPath = getAppDistPath();
      if (isNetworkFailure && distPath && !String(validatedUrl || "").startsWith("app://")) {
        log.info(`[Main] Network offline (${errorCode}: ${errorDescription}). Switching to local offline workspace with SQLite...`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.loadURL("app://localhost/index.html");
          return;
        }
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.loadURL(`${localPage("offline.html")}?code=${encodeURIComponent(errorCode)}&message=${encodeURIComponent(errorDescription)}`);
      }
    }
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log.error("Renderer process gone", details);
    mainWindow.reload();
  });

  mainWindow.webContents.on("unresponsive", () => {
    log.warn("Renderer became unresponsive");
  });

  mainWindow.webContents.session.on("will-download", (_event, item) => {
    const totalBytes = item.getTotalBytes();
    log.info("Download started", { fileName: item.getFilename(), totalBytes });

    item.on("updated", (_downloadEvent, state) => {
      send("download:progress", {
        fileName: item.getFilename(),
        state,
        receivedBytes: item.getReceivedBytes(),
        totalBytes
      });
    });

    item.once("done", (_downloadEvent, state) => {
      log.info("Download finished", { fileName: item.getFilename(), state });
      send("download:done", { fileName: item.getFilename(), state });
      if (state === "completed") {
        showNativeNotification({
          title: "Download complete",
          body: item.getFilename(),
          type: "download",
          screen: null,
          data: {
            type: "download",
            stayOnPage: true,
            fileName: item.getFilename()
          }
        });
      }
    });
  });

  return mainWindow.loadURL(APP_URL);
}

function createTray() {
  const trayImg = nativeImage.createFromPath(assetPath("icons", "tray.png"));
  tray = new Tray(trayImg.isEmpty() ? nativeImage.createFromPath(iconPath()) : trayImg);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show VitelGlobal Desktop", click: () => showMainWindow() },
    { label: "Hide", click: () => mainWindow?.hide() },
    { type: "separator" },
    { label: "Reload", click: () => mainWindow?.webContents.reload() },
    { label: "Open Logs", click: () => shell.openPath(log.transports.file.getFile().path) },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on("click", () => showMainWindow());
}

function showMainWindow(reason = "user") {
  if (!mainWindow || mainWindow.isDestroyed()) {
    notificationLog("window-restore-skipped", { reason, cause: "missing-window" });
    return false;
  }
  try {
    if (process.platform === "darwin" && app.dock) {
      try {
        stopDockBounce();
        app.dock.show();
      } catch (e) { }
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();

    if (process.platform === "darwin") {
      try {
        if (app.focus) {
          app.focus({ steal: true });
        }
      } catch (e) { }
    } else {
      mainWindow.setAlwaysOnTop(true);
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(false);
    }
    notificationLog("window-restored", { reason, visible: mainWindow.isVisible() });
    return true;
  } catch (err) {
    log.warn("[Main] Error showing main window:", err);
    return false;
  }
}

function createMenu() {
  const template = [
    {
      label: "VitelGlobal",
      submenu: [
        { label: "About VitelGlobal Desktop", click: () => showAboutWindow() },
        { type: "separator" },
        { label: "Check for Updates", click: () => checkForUpdates() },
        { label: "Open Logs", click: () => shell.showItemInFolder(log.transports.file.getFile().path) },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "File",
      submenu: [
        { label: "Home", accelerator: "CommandOrControl+H", click: () => mainWindow?.loadURL(APP_URL) },
        { label: "Reload", accelerator: "CommandOrControl+R", click: () => mainWindow?.webContents.reload() },
        { label: "Force Reload (Clear Cache)", accelerator: "CommandOrControl+Shift+R", click: () => mainWindow?.webContents.reloadIgnoringCache() },
        {
          label: "Clear All Caches & Reload",
          click: async () => {
            try {
              if (session?.defaultSession) {
                await session.defaultSession.clearCache();
                await session.defaultSession.clearStorageData({
                  storages: ["serviceworkers", "cachestorage", "shadercache"]
                });
              }
              mainWindow?.webContents.reloadIgnoringCache();
            } catch (e) {
              log.error("Clear cache failed:", e);
            }
          }
        },
        { type: "separator" },
        { label: "Choose File", accelerator: "CommandOrControl+O", click: () => chooseFiles(mainWindow) },
        { type: "separator" },
        { label: "Minimize to Tray", click: () => mainWindow?.hide() }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "togglefullscreen" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" },
        { type: "separator" },
        { label: "Zoom", role: "resetZoom" }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "close" }
      ]
    },
    {
      label: "Help",
      submenu: [
        { label: "VitelGlobal Website", click: () => shell.openExternal("https://www.vitelglobal.com/") },
        { label: "Launch Web App", click: () => shell.openExternal(APP_URL) }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showAboutWindow() {
  const about = new BrowserWindow({
    parent: mainWindow,
    modal: false,
    width: 520,
    height: 540,
    resizable: false,
    title: `About ${APP_NAME}`,
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });
  about.loadFile(rendererPath("about.html"));
}

function chooseFiles(owner) {
  return dialog.showOpenDialog(owner || mainWindow, {
    title: "Choose files",
    properties: ["openFile", "multiSelections", "showHiddenFiles"]
  });
}

let isCallActiveInApp = false;
let autoUpdateCheckInterval = null;

function checkForUpdates() {
  if (!app.isPackaged) {
    const message = "Update checks run only from a packaged application.";
    log.info(message);
    send("update:status", { status: "skipped", message });
    return Promise.resolve({ skipped: true, message });
  }

  if (!autoUpdater) {
    configureAutoUpdater();
  }

  return autoUpdater.checkForUpdates().catch((error) => {
    log.error("Update check failed", error);
    send("update:status", { status: "error", message: error.message });
    return { error: error.message };
  });
}

function quitAndInstallUpdate() {
  if (!autoUpdater) {
    return false;
  }
  try {
    log.info("Applying downloaded update via quitAndInstall...");
    autoUpdater.quitAndInstall(false, true);
    return true;
  } catch (err) {
    log.error("Failed to quit and install update:", err);
    return false;
  }
}

function configureAutoUpdater() {
  if (autoUpdater) {
    return autoUpdater;
  }

  ({ autoUpdater } = require("electron-updater"));
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const updateFeedUrl = process.env.VITELGLOBAL_UPDATE_URL || "https://desktop.officemeetings.net/updates/";
  try {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: updateFeedUrl
    });
    log.info("[AutoUpdater] Feed URL configured:", updateFeedUrl);
  } catch (feedErr) {
    log.warn("[AutoUpdater] Could not set custom feed URL, falling back to package config:", feedErr);
  }

  autoUpdater.on("checking-for-update", () => send("update:status", { status: "checking" }));
  autoUpdater.on("update-available", (info) => {
    log.info("Update available:", info?.version);
    send("update:status", { status: "available", info });
  });
  autoUpdater.on("update-not-available", (info) => {
    send("update:status", { status: "not-available", info });
  });
  autoUpdater.on("download-progress", (progress) => {
    send("update:progress", progress);
  });
  autoUpdater.on("update-downloaded", (info) => {
    log.info("Update downloaded:", info?.version, "isCallActive:", isCallActiveInApp);
    send("update:status", {
      status: "downloaded",
      info,
      isCallActive: isCallActiveInApp
    });

    if (!isCallActiveInApp) {
      showNativeNotification({
        title: "Update ready",
        body: `VitelGlobal Desktop ${info?.version || ""} is ready to install.`
      });
    } else {
      showNativeNotification({
        title: "Update downloaded",
        body: `An update is available. Install after your current call.`
      });
    }
  });
  autoUpdater.on("error", (error) => {
    log.error("AutoUpdater error:", error);
    send("update:status", { status: "error", message: error?.message || String(error) });
  });

  // Schedule periodic background check every 15 minutes
  if (app.isPackaged && !autoUpdateCheckInterval) {
    autoUpdateCheckInterval = setInterval(() => {
      if (!isCallActiveInApp) {
        checkForUpdates().catch(() => { });
      }
    }, 15 * 60 * 1000);

    // Initial check shortly after app start
    setTimeout(() => {
      if (!isCallActiveInApp) {
        checkForUpdates().catch(() => { });
      }
    }, 10 * 1000);
  }

  return autoUpdater;
}

const PICKER_HTML = path.join(__dirname, "..", "picker", "picker.html");
let capturePickerWin = null;
let pendingCapture = null;

function finishCapture(source) {
  if (!pendingCapture) return;
  const request = pendingCapture;
  pendingCapture = null;
  clearTimeout(request.timer);
  const captureWindow = capturePickerWin;
  capturePickerWin = null;
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.destroy();
  }
  request.respond(source ? {
    video: source,
    ...(request.audio && process.platform === "win32" ? { audio: "loopback" } : {})
  } : null);

  // Restore focus to the window that initiated screen sharing (e.g., meeting window)
  if (request.ownerWindow && !request.ownerWindow.isDestroyed()) {
    request.ownerWindow.focus();
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.focus();
  }
}

function showCapturePicker(sources, respond, audio, ownerWindow) {
  if (capturePickerWin && !capturePickerWin.isDestroyed()) {
    capturePickerWin.focus();
    return;
  }
  const parentWin = (ownerWindow && !ownerWindow.isDestroyed())
    ? ownerWindow
    : (BrowserWindow.getFocusedWindow() || mainWindow || undefined);

  const isModal = Boolean(parentWin);
  capturePickerWin = new BrowserWindow({
    parent: parentWin || undefined,
    modal: isModal,
    alwaysOnTop: !isModal,
    width: 860,
    height: 620,
    minWidth: 500,
    minHeight: 400,
    title: "Choose what to share",
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "..", "picker", "picker-preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  capturePickerWin.removeMenu();
  pendingCapture = {
    sources,
    respond,
    audio,
    ownerWindow: parentWin,
    timer: setTimeout(() => finishCapture(null), 60000)
  };
  capturePickerWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  capturePickerWin.webContents.on("will-navigate", (event) => event.preventDefault());
  capturePickerWin.webContents.once("did-finish-load", () => {
    if (capturePickerWin && !capturePickerWin.isDestroyed()) {
      capturePickerWin.webContents.send(
        "sources",
        sources.map((source) => ({
          id: source.id,
          name: source.name,
          thumbnail: source.thumbnail.toDataURL()
        }))
      );
    }
  });
  capturePickerWin.on("closed", () => finishCapture(null));
  void capturePickerWin.loadFile(PICKER_HTML).catch(() => finishCapture(null));
}

function configureMediaAndPermissions(targetSession) {
  if (!targetSession) return;

  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const permitted = new Set([
      "media",
      "microphone",
      "camera",
      "display-capture",
      "notifications",
      "fullscreen",
      "clipboard-sanitized-write",
      "clipboard-read",
      "geolocation"
    ]);

    log.info("Permission request auto-granted:", { permission, requestingUrl: details?.requestingUrl });
    callback(permitted.has(permission));
  });

  targetSession.setPermissionCheckHandler((_webContents, permission) => {
    return [
      "media",
      "microphone",
      "camera",
      "display-capture",
      "notifications",
      "fullscreen",
      "clipboard-sanitized-write",
      "clipboard-read",
      "geolocation"
    ].includes(permission);
  });

  if (typeof targetSession.setDisplayMediaRequestHandler === "function") {
    targetSession.setDisplayMediaRequestHandler(async (request, callback) => {
      let answered = false;
      const respond = (stream) => {
        if (answered) return;
        answered = true;
        try {
          callback(stream);
        } catch (cbErr) {
          log.error("Failed to callback displayMedia:", cbErr);
          try {
            callback(null);
          } catch (_) {}
        }
      };

      if (process.platform === "darwin" && systemPreferences.getMediaAccessStatus?.("screen") === "denied") {
        respond(null);
        dialog.showMessageBox({
          type: "warning",
          title: "Screen Recording Permission Required",
          message: "Screen recording permission is blocked by macOS.",
          detail: "Please allow VitelGlobal Desktop in System Settings > Privacy & Security > Screen & System Audio Recording, then restart and rejoin your meeting."
        }).catch(() => {});
        return;
      }

      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 320, height: 180 }
        });
        if (!sources.length) {
          respond(null);
          dialog.showMessageBox({
            type: "info",
            title: "No Screens Available",
            message: "No screens or windows are available to share.",
            detail: "Make sure the window you want to share is open and not minimized, and verify operating system screen recording permissions."
          }).catch(() => {});
          return;
        }

        let ownerWindow = null;
        try {
          if (request.frame && typeof BrowserWindow.fromWebFrameMain === "function") {
            ownerWindow = BrowserWindow.fromWebFrameMain(request.frame);
          }
        } catch (_) {}
        if (!ownerWindow || ownerWindow.isDestroyed()) {
          ownerWindow = BrowserWindow.getFocusedWindow() || mainWindow;
        }

        showCapturePicker(sources, respond, request.audioRequested, ownerWindow);
      } catch (error) {
        log.error("Display media request failed", error);
        respond(null);
      }
    });
  }
}

function configureSession() {
  const defaultSession = session.defaultSession;

  // Clear stale HTTP and ServiceWorker caches on startup so desktop app always loads fresh code
  defaultSession.clearCache().catch(() => { });
  defaultSession.clearStorageData({
    storages: ["serviceworkers", "cachestorage", "shadercache"]
  }).catch(() => { });

  configureMediaAndPermissions(defaultSession);

  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    headers["X-Content-Type-Options"] = ["nosniff"];
    headers["Referrer-Policy"] = ["strict-origin-when-cross-origin"];
    if (details.resourceType === "mainFrame" || details.resourceType === "subFrame") {
      headers["Cache-Control"] = ["no-cache, no-store, must-revalidate"];
      headers["Pragma"] = ["no-cache"];
      headers["Expires"] = ["0"];
    }
    callback({ responseHeaders: headers });
  });
}

function handleDeepLink(rawUrl) {
  if (!rawUrl) {
    return;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingDeepLink = rawUrl;
    return;
  }

  try {
    const parsed = new URL(rawUrl);
    let target = APP_URL;

    if (parsed.protocol === "vitelglobal:") {
      const pathPart = [parsed.hostname, parsed.pathname].join("").replace(/^\/?/, "/");
      target = new URL(pathPart + parsed.search + parsed.hash, APP_URL).toString();
    } else if (isTrustedUrl(rawUrl)) {
      target = rawUrl;
    }

    showMainWindow();
    mainWindow.loadURL(target);
    send("deep-link", { url: rawUrl, target });
  } catch (error) {
    log.warn("Invalid deep link ignored", { rawUrl, error: error.message });
  }
}

function registerIpc() {
  ipcMain.handle("select-source", async (event, id) => {
    if (!capturePickerWin || event.sender !== capturePickerWin.webContents) {
      return { ok: false };
    }
    if (!pendingCapture) return { ok: false };
    if (id === null) {
      finishCapture(null);
      return { ok: true };
    }
    const source = pendingCapture.sources.find((value) => value.id === id);
    if (!source) return { ok: false };
    finishCapture(source);
    return { ok: true };
  });

  ipcMain.handle("app:get-info", () => ({
    name: APP_NAME,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    appUrl: APP_URL,
    homeOrigin: HOME_ORIGIN,
    logPath: log.transports.file.getFile().path
  }));

  ipcMain.handle("app:reload", async () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.webContents.session.clearCache();
        mainWindow.webContents.reloadIgnoringCache();
      }
    } catch (err) {
      log.warn("Failed to clear session cache on reload:", err);
    }
    return { ok: true };
  });
  ipcMain.handle("app:home", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(APP_URL);
    }
  });
  ipcMain.handle("app:open-logs", () => shell.showItemInFolder(log.transports.file.getFile().path));
  ipcMain.handle("app:choose-files", () => chooseFiles(mainWindow));
  ipcMain.handle("app:read-clipboard", () => clipboard.readText());
  ipcMain.handle("app:write-clipboard", (_event, text) => clipboard.writeText(String(text ?? "")));
  ipcMain.handle("app:open-external", (_event, rawUrl) => {
    if (typeof rawUrl === "string" && rawUrl.trim()) {
      shell.openExternal(rawUrl.trim());
    }
    return { ok: true };
  });
  ipcMain.handle("app:notify", (_event, payload) => showNativeNotification(payload));
  ipcMain.handle("app:clear-notifications", (_event, type) => {
    stopDockBounce();
    for (const notification of activeNativeNotifications) {
      try {
        notification.close();
      } catch (err) { }
    }
    activeNativeNotifications.clear();
    return true;
  });
  ipcMain.handle("app:focus", () => showMainWindow());
  ipcMain.handle("app:flash-frame", (_event, enabled) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.flashFrame(Boolean(enabled));
    }
  });
  ipcMain.handle("app:get-pending-notification-click", () => {
    const temp = pendingNotificationClick;
    pendingNotificationClick = null;
    return temp;
  });
  ipcMain.handle("app:check-for-updates", () => checkForUpdates());
  ipcMain.handle("app:quit-and-install", () => quitAndInstallUpdate());
  ipcMain.handle("app:set-call-active", (_event, active) => {
    isCallActiveInApp = Boolean(active);
    return isCallActiveInApp;
  });
  function getPortalPartition(targetUrl = "") {
    const urlLower = String(targetUrl || "").toLowerCase();
    if (urlLower.includes("payg")) return "persist:portal_payg";
    if (urlLower.includes("vitelmeet") || urlLower.includes("vmadmin")) return "persist:portal_vitelmeet";
    if (urlLower.includes("omnichannel")) return "persist:portal_omnichannel";
    if (urlLower.includes("bharatpayroll") || urlLower.includes("payroll")) return "persist:portal_bharatpayroll";
    if (urlLower.includes("digitalemployees") || urlLower.includes("vitelai")) return "persist:portal_vitelai";
    if (urlLower.includes("scancard")) return "persist:portal_scancard";
    return "persist:portal_general";
  }

  function safeCookieVal(val) {
    const s = String(val ?? "").trim();
    if (/[\s;"\\,]/g.test(s)) {
      return encodeURIComponent(s);
    }
    return s;
  }

  async function applyPortalSessionCookies(payload, targetSession = null) {
    const { token, user, targetUrl } = payload || {};
    if (!token || !user) return { ok: false, error: "Missing token or user" };

    const fullName = (user.first_name || user.last_name)
      ? `${user.first_name || ""} ${user.last_name || ""}`.trim()
      : (user.full_name || user.auth_user || user.name || user.username || "User");

    const userId = String(
      (user.user_type === "sub_user" && user.sub_user_id)
        ? user.sub_user_id
        : (user.user_id || user.id || user.customer_id || "")
    );

    const email = user.email || user.email_id || user.customer_email || "";
    const freshExpiry = String(Date.now() + (30 * 24 * 60 * 60 * 1000));
    const freshTimeLeft = "2592000000";

    const cookiesToSet = [
      { name: "customer_user_token", value: safeCookieVal(token) },
      { name: "user_token", value: safeCookieVal(token) },
      { name: "w_token", value: safeCookieVal(token) },
      { name: "auth_user", value: safeCookieVal(fullName || user.username || "") },
      { name: "username", value: safeCookieVal(user.username || "") },
      { name: "email", value: safeCookieVal(email) },
      { name: "user_type", value: safeCookieVal(user.user_type || "customer") },
      { name: "user_id", value: safeCookieVal(userId) },
      { name: "customer_id", value: safeCookieVal(userId) },
      { name: "company_name", value: safeCookieVal(user.company_name || "") },
      { name: "full_name", value: safeCookieVal(fullName) },
      { name: "agreement_signed", value: "true" },
      { name: "type", value: "whatsapp" },
      { name: "logout_expiration_time", value: freshExpiry },
      { name: "logout_time_left", value: freshTimeLeft }
    ];

    if (user.profile_photo_url && user.profile_photo_url !== "undefined") {
      cookiesToSet.push({ name: "profile_photo_url", value: safeCookieVal(user.profile_photo_url) });
    }

    const expires = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
    const origins = [
      "https://payg.vitelglobal.com",
      "https://vitelmeet.vitelglobal.com",
      "https://omnichannel.vitelglobal.com",
      "https://vmadmin.vitelglobal.com"
    ];

    const part = getPortalPartition(targetUrl);
    const activeSession = targetSession || session.fromPartition(part);

    for (const origin of origins) {
      for (const c of cookiesToSet) {
        if (!c.value) continue;
        // 1. Set domain cookie on .vitelglobal.com in isolated session
        try {
          await activeSession.cookies.set({
            url: origin,
            domain: ".vitelglobal.com",
            path: "/",
            name: c.name,
            value: c.value,
            secure: true,
            sameSite: "lax",
            expirationDate: expires
          });
        } catch (e1) {
          log.warn(`[Electron] Domain cookie set warning for ${c.name}:`, e1?.message);
        }
        // 2. Set host-only cookie on specific origin in isolated session
        try {
          await activeSession.cookies.set({
            url: origin,
            path: "/",
            name: c.name,
            value: c.value,
            secure: true,
            sameSite: "lax",
            expirationDate: expires
          });
        } catch (e2) {
          log.warn(`[Electron] Host cookie set warning for ${c.name}:`, e2?.message);
        }
      }
    }

    if (targetUrl.toLowerCase().includes("bharatpayroll") || targetUrl.toLowerCase().includes("payroll")) {
      try {
        await activeSession.cookies.set({
          url: "https://tradein.bharatpayroll.com",
          path: "/",
          name: "access",
          value: safeCookieVal(token),
          secure: true,
          sameSite: "lax",
          expirationDate: expires
        });
        await activeSession.cookies.set({
          url: "https://tradein.bharatpayroll.com",
          path: "/",
          name: "refresh",
          value: safeCookieVal(user?.refreshToken || token),
          secure: true,
          sameSite: "lax",
          expirationDate: expires
        });
      } catch (ePayroll) {
        log.warn("[Electron] Bharat payroll cookie set error:", ePayroll?.message);
      }
    }

    if (targetUrl.toLowerCase().includes("digitalemployees") || targetUrl.toLowerCase().includes("vitelai")) {
      try {
        await activeSession.cookies.set({
          url: "https://digitalemployees.vitelglobal.com",
          path: "/",
          name: "access_token",
          value: safeCookieVal(token),
          secure: true,
          sameSite: "lax",
          expirationDate: expires
        });
        await activeSession.cookies.set({
          url: "https://digitalemployees.vitelglobal.com",
          path: "/",
          name: "session_token",
          value: safeCookieVal(user?.session_token || token),
          secure: true,
          sameSite: "lax",
          expirationDate: expires
        });
      } catch (eAI) {
        log.warn("[Electron] Vitel AI cookie set error:", eAI?.message);
      }
    }

    await activeSession.cookies.flushStore().catch(() => { });
    log.info(`[Electron] Successfully set persistent portal cookies for ${part}`);
    return { ok: true, cookiesToSet };
  }

  ipcMain.handle("app:set-vitelmeet-session", async (_event, payload) => {
    try {
      const part = getPortalPartition(payload?.targetUrl || payload?.url || "");
      const portalSession = session.fromPartition(part);
      return await applyPortalSessionCookies(payload, portalSession);
    } catch (err) {
      log.error("[Electron] Failed to set portal cookies:", err);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("app:clear-portal-cookies", async (_event, targetPortal) => {
    try {
      const partitions = targetPortal
        ? [getPortalPartition(targetPortal)]
        : ["persist:portal_payg", "persist:portal_vitelmeet", "persist:portal_omnichannel", "persist:portal_general", "persist:vitel_portals"];
      for (const part of partitions) {
        const s = session.fromPartition(part);
        await s.clearStorageData({ storages: ["cookies", "localstorage"] }).catch(() => {});
      }
      log.info("[Electron] Cleared portal session cookies & storage data for partitions:", partitions);
      return { ok: true };
    } catch (err) {
      log.error("[Electron] Failed to clear portal cookies:", err);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("app:open-portal", async (_event, payload) => {
    try {
      const url = typeof payload === "string" ? payload : payload?.url;
      const targetUrl = (typeof payload === "object" && payload?.targetUrl) ? payload.targetUrl : url;
      const title = (typeof payload === "object" && payload?.title) ? payload.title : "VitelGlobal Portal";
      if (!url && !targetUrl) return { ok: false, error: "Missing URL" };

      // Resolve the actual destination portal URL directly (prevent any redirection to dbchat / sso-handoff)
      let finalUrl = targetUrl || url;
      if (finalUrl && finalUrl.includes("sso-handoff")) {
        try {
          const parsed = new URL(finalUrl);
          const extracted = parsed.searchParams.get("target");
          if (extracted) finalUrl = extracted;
        } catch (_) {}
      }

      const destination = new URL(finalUrl);
      if (!["https:", "http:"].includes(destination.protocol) || destination.username || destination.password) {
        return { ok: false, error: "Invalid portal URL" };
      }

      // ISOLATED PARTITION PER PORTAL:
      // Pay As You Go: persist:portal_payg
      // VitelMeet: persist:portal_vitelmeet
      // Omnichannel: persist:portal_omnichannel
      // This ensures complete separation so portals never overwrite or interfere with each other!
      const partitionName = getPortalPartition(finalUrl);
      const portalSession = session.fromPartition(partitionName);
      configureMediaAndPermissions(portalSession);

      // Ensure fresh cookies are installed in isolated portalSession before opening
      if (typeof payload === "object" && payload?.token && payload?.user) {
        try {
          await applyPortalSessionCookies({ token: payload.token, user: payload.user, targetUrl: finalUrl }, portalSession);
        } catch (_) {}
      }

      // If an existing window for this portal is already open, reload it with fresh cookies and bring to front
      let existingWin;
      try {
        const parsedTarget = new URL(finalUrl);
        existingWin = BrowserWindow.getAllWindows().find((w) => {
          if (w === mainWindow || w.isDestroyed()) return false;
          try {
            return w.__vitelPortalOrigin === parsedTarget.origin && w.webContents.session === portalSession;
          } catch { }
          return false;
        });

        if (existingWin) {
          existingWin.show();
          existingWin.focus();
          existingWin.__disposePortalLogin?.();
        }
      } catch (checkErr) {
        log.warn("[Electron] Error checking existing portal window:", checkErr?.message);
      }

      const portalWin = existingWin || new BrowserWindow({
        width: 1366,
        height: 850,
        minWidth: 900,
        minHeight: 600,
        title,
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
          session: portalSession,
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      portalWin.__vitelPortalOrigin = destination.origin;
      const cleanup = [];
      portalWin.__disposePortalLogin = () => {
        while (cleanup.length > 0) {
          const dispose = cleanup.shift();
          try {
            if (typeof dispose === "function") {
              dispose();
            }
          } catch (_) {}
        }
      };

      if (!existingWin) portalWin.once("ready-to-show", () => {
        portalWin.show();
        portalWin.focus();
      });

      if (!existingWin) portalWin.on("closed", () => {
        try {
          portalWin.__disposePortalLogin?.();
        } catch (_) {}
      });

      // Synchronize storage on the destination origin; the form helper also
      // handles applications whose login UI mounts after these load events.
      if (typeof payload === "object" && payload?.token) {
        const injectCredentials = () => {
          try {
            const curUrl = portalWin.webContents.getURL();
            if (curUrl && new URL(curUrl).origin === destination.origin) {
              const u = payload.user || {};
              const fn = (u.first_name || u.last_name) ? `${u.first_name || ""} ${u.last_name || ""}`.trim() : (u.full_name || u.auth_user || u.username || "User");
              const cid = String(u.customer_id || u.user_id || u.id || "");
              const freshExp = String(Date.now() + (30 * 24 * 60 * 60 * 1000));
              const cookiesMap = {
                user_token: String(payload.token),
                customer_user_token: String(payload.token),
                w_token: String(payload.token),
                auth_user: fn,
                customer_id: cid,
                user_id: cid,
                company_name: String(u.company_name || ""),
                user_type: String(u.user_type || "customer"),
                username: String(u.username || ""),
                full_name: fn,
                email: String(u.email || u.email_id || ""),
                agreement_signed: "true",
                type: "whatsapp",
                logout_expiration_time: freshExp,
                logout_time_left: "2592000000"
              };
              const jsCode = `
                (function() {
                  try {
                    if (window.location.origin !== ${JSON.stringify(destination.origin)}) return;
                    var m = ${JSON.stringify(cookiesMap)};
                    for (var k in m) {
                      if (m[k]) {
                        document.cookie = k + "=" + encodeURIComponent(m[k]) + "; path=/; domain=.vitelglobal.com; max-age=2592000; SameSite=Lax; Secure";
                        document.cookie = k + "=" + encodeURIComponent(m[k]) + "; path=/; max-age=2592000; SameSite=Lax; Secure";
                        try { localStorage.setItem(k, m[k]); } catch(e2) {}
                        try { sessionStorage.setItem(k, m[k]); } catch(e3) {}
                      }
                    }
                    if (window.location.origin.includes("bharatpayroll")) {
                      try {
                        localStorage.setItem("access", ${JSON.stringify(payload.token)});
                        localStorage.setItem("refresh", ${JSON.stringify(payload.user?.refreshToken || payload.token)});
                        localStorage.setItem("token", ${JSON.stringify(payload.token)});
                      } catch(e4) {}
                    }
                    if (window.location.origin.includes("digitalemployees")) {
                      try {
                        localStorage.setItem("access_token", ${JSON.stringify(payload.token)});
                        localStorage.setItem("session_token", ${JSON.stringify(payload.user?.session_token || payload.token)});
                      } catch(e5) {}
                    }
                  } catch(e) {}
                })();
              `;
              portalWin.webContents.executeJavaScript(jsCode).catch(() => {});
            }
          } catch (_) {}
        };

        portalWin.webContents.on("dom-ready", injectCredentials);
        portalWin.webContents.on("did-finish-load", injectCredentials);
        cleanup.push(() => {
          try {
            if (!portalWin.isDestroyed() && !portalWin.webContents?.isDestroyed()) {
              portalWin.webContents.removeListener("dom-ready", injectCredentials);
              portalWin.webContents.removeListener("did-finish-load", injectCredentials);
            }
          } catch (_) {}
        });
      }

      cleanup.push(attachPortalAutoLogin(portalWin.webContents, {
        targetUrl: finalUrl,
        username: payload?.credentials?.username || payload?.user?.username || payload?.username || "",
        password: payload?.credentials?.password || payload?.password || "",
      }));

      portalWin.webContents.setWindowOpenHandler(({ url: childUrl }) => {
        if (isTrustedUrl(childUrl)) {
          return {
            action: "allow",
            overrideBrowserWindowOptions: {
              width: 1366,
              height: 850,
              show: true,
              autoHideMenuBar: true,
              webPreferences: {
                session: portalSession,
                nodeIntegration: false,
                contextIsolation: true
              }
            }
          };
        }
        shell.openExternal(childUrl);
        return { action: "deny" };
      });

      await portalWin.loadURL(finalUrl);
      return { ok: true };
    } catch (err) {
      log.error("[Electron] Failed to open portal window:", err);
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle("app:get-location", async () => {
    try {
      const https = require("https");
      return await new Promise((resolve) => {
        const req = https.get("https://ipwho.is/", { timeout: 4000 }, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const json = JSON.parse(data);
              if (json && json.success && typeof json.latitude === "number" && typeof json.longitude === "number") {
                resolve({
                  coords: {
                    latitude: json.latitude,
                    longitude: json.longitude,
                    accuracy: 1000,
                  },
                  city: json.city,
                  region: json.region,
                  country: json.country,
                  timestamp: Date.now(),
                });
                return;
              }
            } catch { }
            resolve(null);
          });
        });
        req.on("error", () => resolve(null));
        req.on("timeout", () => {
          req.destroy();
          resolve(null);
        });
      });
    } catch {
      return null;
    }
  });
  ipcMain.handle("app:get-auto-launch", () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle("app:set-auto-launch", (_event, enabled) => {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      openAsHidden: true
    });
    return app.getLoginItemSettings().openAtLogin;
  });
  const DIGITS_4x6 = {
    '0': [0b1111, 0b1001, 0b1001, 0b1001, 0b1001, 0b1111],
    '1': [0b0110, 0b0010, 0b0010, 0b0010, 0b0010, 0b0111],
    '2': [0b1111, 0b0001, 0b1111, 0b1000, 0b1000, 0b1111],
    '3': [0b1111, 0b0001, 0b1111, 0b0001, 0b0001, 0b1111],
    '4': [0b1001, 0b1001, 0b1111, 0b0001, 0b0001, 0b0001],
    '5': [0b1111, 0b1000, 0b1111, 0b0001, 0b0001, 0b1111],
    '6': [0b1111, 0b1000, 0b1111, 0b1001, 0b1001, 0b1111],
    '7': [0b1111, 0b0001, 0b0010, 0b0010, 0b0100, 0b0100],
    '8': [0b1111, 0b1001, 0b1111, 0b1001, 0b1001, 0b1111],
    '9': [0b1111, 0b1001, 0b1111, 0b0001, 0b0001, 0b1111],
    '+': [0b0000, 0b0100, 0b1110, 0b0100, 0b0000, 0b0000]
  };

  function createWindowsBadgeImage(count) {
    try {
      const width = 32;
      const height = 32;
      const buf = Buffer.alloc(width * height * 4);
      const cx = 16, cy = 16, radius = 14;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const offset = (y * width + x) * 4;
          const dx = x - cx + 0.5;
          const dy = y - cy + 0.5;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist <= radius) {
            if (dist >= radius - 2) {
              buf[offset] = 255;
              buf[offset + 1] = 255;
              buf[offset + 2] = 255;
              buf[offset + 3] = 255;
            } else {
              buf[offset] = 220;
              buf[offset + 1] = 38;
              buf[offset + 2] = 38;
              buf[offset + 3] = 255;
            }
          }
        }
      }

      const text = count > 99 ? "99+" : String(count);
      const scale = text.length === 1 ? 2 : (text.length === 2 ? 2 : 1);
      const charWidth = 4 * scale;
      const charHeight = 6 * scale;
      const spacing = 1 * scale;
      const totalTextWidth = text.length * charWidth + (text.length - 1) * spacing;
      const startX = Math.round(cx - totalTextWidth / 2);
      const startY = Math.round(cy - charHeight / 2);

      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const bitmap = DIGITS_4x6[ch] || DIGITS_4x6['0'];
        const curX = startX + i * (charWidth + spacing);

        for (let row = 0; row < 6; row++) {
          const rowBits = bitmap[row];
          for (let col = 0; col < 4; col++) {
            const isSet = (rowBits >> (3 - col)) & 1;
            if (isSet) {
              for (let sy = 0; sy < scale; sy++) {
                for (let sx = 0; sx < scale; sx++) {
                  const px = curX + col * scale + sx;
                  const py = startY + row * scale + sy;
                  if (px >= 0 && px < width && py >= 0 && py < height) {
                    const offset = (py * width + px) * 4;
                    buf[offset] = 255;
                    buf[offset + 1] = 255;
                    buf[offset + 2] = 255;
                    buf[offset + 3] = 255;
                  }
                }
              }
            }
          }
        }
      }

      return nativeImage.createFromBitmap(buf, { width, height });
    } catch (err) {
      log.error("[Electron] Failed to generate dynamic badge image:", err);
      return null;
    }
  }

  ipcMain.handle("app:set-badge-count", (_event, count) => {
    const safeCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
    if (process.platform === "darwin" || process.platform === "linux") {
      return app.setBadgeCount(safeCount);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        if (safeCount > 0) {
          const dynamicImg = createWindowsBadgeImage(safeCount);
          if (dynamicImg && !dynamicImg.isEmpty()) {
            mainWindow.setOverlayIcon(dynamicImg, `${safeCount} unread`);
          } else {
            const badgeOverlayPath = assetPath("icons", "badge-overlay.png");
            const overlayImg = fs.existsSync(badgeOverlayPath)
              ? nativeImage.createFromPath(badgeOverlayPath)
              : null;
            mainWindow.setOverlayIcon(overlayImg, `${safeCount} unread`);
          }
        } else {
          mainWindow.setOverlayIcon(null, "");
        }
      } catch (err) {
        log.error("[Electron] setOverlayIcon error:", err);
      }
    }
    return true;
  });

  ipcMain.handle("app:clear-all-data", async () => {
    try {
      // Purge all external portal partitions on logout so credentials don't leak
      const portalPartitions = ["persist:portal_payg", "persist:portal_vitelmeet", "persist:portal_omnichannel"];
      for (const part of portalPartitions) {
        try {
          const partSession = session.fromPartition(part);
          await partSession.clearStorageData({
            storages: ["cookies", "localstorage", "websql", "indexdb", "serviceworkers", "cachestorage"]
          });
        } catch (_) {}
      }
      sqliteDb.clearSession();
      return true;
    } catch (err) {
      log.error("[Electron] clear-all-data error:", err);
      return false;
    }
  });

  // SQLite Database IPC handlers
  ipcMain.handle("sqlite:save-session", (_event, sessionData) => sqliteDb.saveSession(sessionData));
  ipcMain.handle("sqlite:get-session", () => sqliteDb.getLatestSession());
  ipcMain.handle("sqlite:clear-session", (_event, userId) => sqliteDb.clearSession(userId));

  ipcMain.handle("sqlite:save-conversations", (_event, conversations) => sqliteDb.saveConversations(conversations));
  ipcMain.handle("sqlite:get-conversations", () => sqliteDb.getConversations());

  ipcMain.handle("sqlite:save-messages", (_event, { conversationId, messages }) => sqliteDb.saveMessages(conversationId, messages));
  ipcMain.handle("sqlite:get-messages", (_event, conversationId) => sqliteDb.getMessages(conversationId));

  ipcMain.handle("sqlite:save-sms", (_event, { line, peerNumber, messages }) => sqliteDb.saveSmsMessages(line, peerNumber, messages));
  ipcMain.handle("sqlite:get-sms", (_event, { line, peerNumber }) => sqliteDb.getSmsMessages(line, peerNumber));

  ipcMain.handle("sqlite:save-contacts", (_event, contacts) => sqliteDb.saveContacts(contacts));
  ipcMain.handle("sqlite:get-contacts", () => sqliteDb.getContacts());

  ipcMain.handle("sqlite:enqueue-outbox", (_event, mutation) => sqliteDb.enqueueOutboxMutation(mutation));
  ipcMain.handle("sqlite:get-outbox", () => sqliteDb.getPendingOutboxMutations());
  ipcMain.handle("sqlite:dequeue-outbox", (_event, id) => sqliteDb.dequeueOutboxMutation(id));

  ipcMain.handle("sqlite:set-kv", (_event, { key, value }) => sqliteDb.setKV(key, value));
  ipcMain.handle("sqlite:get-kv", (_event, key) => sqliteDb.getKV(key));

  ipcMain.handle("app:load-offline-app", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      log.info("[Main] Manually triggering local offline workspace...");
      return mainWindow.loadURL("app://localhost/index.html");
    }
  });
  ipcMain.handle("app:load-remote-app", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      log.info("[Main] Manually triggering remote service load...");
      return mainWindow.loadURL(APP_URL);
    }
  });
}

app.on("certificate-error", (event, _webContents, url, error, certificate, callback) => {
  log.error("Certificate rejected", { url, error, subjectName: certificate.subjectName });
  event.preventDefault();
  callback(false);
});

app.on("second-instance", (_event, argv) => {
  const deepLink = argv.find((arg) => arg.startsWith("vitelglobal://"));
  showMainWindow();
  if (deepLink) {
    handleDeepLink(deepLink);
  }
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createSplashWindow();
    createMainWindow();
  } else {
    showMainWindow();
  }
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) {
    app.quit();
    return;
  }

  // Ensure macOS users run the app from /Applications to avoid App Translocation TCC permission loss
  if (process.platform === "darwin" && app.isPackaged) {
    if (typeof app.isInApplicationsFolder === "function" && !app.isInApplicationsFolder()) {
      try {
        const moved = app.moveToApplicationsFolder({
          conflictHandler: () => true
        });
        if (moved) {
          log.info("App moved to Applications folder and relaunching.");
          return;
        }
      } catch (err) {
        log.warn("app.moveToApplicationsFolder failed or declined:", err);
      }
    }
  }

  registerWindowsNotificationShortcut();

  // Pre-request macOS System Media Permissions once at startup
  if (process.platform === "darwin" && systemPreferences) {
    try {
      if (typeof systemPreferences.getMediaAccessStatus === "function" && typeof systemPreferences.askForMediaAccess === "function") {
        const micStatus = systemPreferences.getMediaAccessStatus("microphone");
        if (micStatus === "not-determined") {
          await systemPreferences.askForMediaAccess("microphone");
        }
        const camStatus = systemPreferences.getMediaAccessStatus("camera");
        if (camStatus === "not-determined") {
          await systemPreferences.askForMediaAccess("camera");
        }
      }
    } catch (e) {
      log.warn("Error requesting macOS media access:", e);
    }
  }

  if (process.platform === "win32" && app.isPackaged) {
    app.setAsDefaultProtocolClient("vitelglobal", process.env.PORTABLE_EXECUTABLE_FILE || process.execPath);
  } else if (process.platform === "win32") {
    const launchSpec = buildWindowsLaunchSpec({
      isPackaged: false,
      execPath: process.execPath,
      appPath: app.getAppPath(),
      brandedIconPath: iconPath()
    });
    app.setAsDefaultProtocolClient("vitelglobal", launchSpec.target, launchSpec.protocolArgs);
  } else {
    app.setAsDefaultProtocolClient("vitelglobal");
  }
  sqliteDb.initializeDatabase(app.getPath("userData"));
  configureSession();
  registerIpc();
  registerAppProtocol();
  configureAutoUpdater();
  createMenu();
  createTray();
  createSplashWindow();
  await createMainWindow();

  // globalShortcut.register("CommandOrControl+Shift+V") removed).catch((err) => {
  log.error("Fatal startup error in app.whenReady:", err);
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
