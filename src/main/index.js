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
  desktopCapturer,
  systemPreferences
} = require("electron");
const log = require("electron-log/main");
const {
  buildWindowsLaunchSpec,
  createNotificationDeduper,
  normalizeNotificationPayload,
  notificationActionPayload,
  resolveNotificationAction,
  shouldClearNotificationType
} = require("./notificationPolicy");

const APP_NAME = "VitelGlobal Desktop";
const WINDOWS_APP_USER_MODEL_ID = "com.vitelglobal.desktop";
const WINDOWS_TOAST_ACTIVATOR_CLSID = "{D7F34804-48E6-41EB-8EBA-57EEC402B21A}";
const APP_URL = process.env.VITELGLOBAL_APP_URL || "https://desktop.officemeetings.net/";
const HOME_ORIGIN = new URL(APP_URL).origin;
const TRUSTED_HOST_SUFFIXES = [
  "officemeetings.net",
  "vitelglobal.com",
  "vitelglobal.in"
];

let mainWindow;
let splashWindow;
let tray;
let isQuitting = false;
let pendingDeepLink;
let pendingNotificationClick = null;
let backgroundNoticeShown = false;
const activeNativeNotifications = new Set();
const nativeNotificationDeduper = createNotificationDeduper({ windowMs: 2500 });
let autoUpdater;
const gotSingleInstanceLock = app.requestSingleInstanceLock();

app.name = APP_NAME;
app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
if (process.platform === "win32") {
  app.setToastActivatorCLSID(WINDOWS_TOAST_ACTIVATOR_CLSID);
}

function registerWindowsNotificationShortcut() {
  if (process.platform !== "win32") {
    return;
  }

  const shortcutPath = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "VitelGlobal Desktop.lnk");
  const legacyElectronShortcutPath = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "Electron.lnk");
  // Portable Electron apps run from a temporary extraction directory. Using
  // process.execPath there makes Windows label notifications as "Electron" and
  // notification activation later opens the raw Electron welcome screen.
  const launchSpec = buildWindowsLaunchSpec({
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    portableExecutableFile: process.env.PORTABLE_EXECUTABLE_FILE,
    appPath: app.getAppPath(),
    brandedIconPath: iconPath()
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
    if (fs.existsSync(legacyElectronShortcutPath)) {
      try {
        const legacyShortcut = shell.readShortcutLink(legacyElectronShortcutPath);
        if (path.resolve(legacyShortcut.target) === path.resolve(launchSpec.target)) {
          fs.unlinkSync(legacyElectronShortcutPath);
          log.info("Removed legacy Electron notification shortcut");
        }
      } catch (error) {
        log.warn("Could not inspect legacy Electron notification shortcut", error);
      }
    }
    shell.writeShortcutLink(shortcutPath, "replace", shortcutOptions)
      || shell.writeShortcutLink(shortcutPath, "create", shortcutOptions);
    log.info("Registered Windows notification shortcut", {
      target: launchSpec.target,
      args: launchSpec.args,
      portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE)
    });
  } catch (err) {
    log.error("Failed to register Start Menu shortcut for notifications:", err);
  }
}

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");

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

function isTrustedUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (!["https:", "vitelglobal:"].includes(parsed.protocol)) {
      return false;
    }

    if (parsed.protocol === "vitelglobal:") {
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
  if (normalized.type === "incoming-call" && normalized.entityId) {
    const alreadyActive = [...activeNativeNotifications].some((item) => (
      item.vitelNotificationType === "incoming-call"
      && item.vitelNotificationEntityId === normalized.entityId
    ));
    if (alreadyActive) {
      notificationLog("active-call-duplicate-suppressed", { type: normalized.type, entityId: normalized.entityId });
      return false;
    }
  }
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
  if ((process.platform === "darwin" || process.platform === "win32") && normalized.type === "incoming-call") {
    notificationOptions.actions = [
      { type: "button", text: "Accept" },
      { type: "button", text: "Reject" }
    ];
  }
  if (process.platform === "darwin" && normalized.type === "incoming-call") {
    notificationOptions.closeButtonText = "Reject";
  }

  const notification = new Notification(notificationOptions);
  notification.vitelNotificationType = normalized.type;
  notification.vitelNotificationEntityId = normalized.entityId;
  activeNativeNotifications.add(notification);

  if (process.platform === "darwin" && app.dock) {
    try {
      app.dock.bounce(normalized.type === "incoming-call" ? "critical" : "informational");
    } catch (error) {
      log.warn("[DesktopNotification] Dock bounce failed", error);
    }
  }

  if (normalized.type === "incoming-call" && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
    mainWindow.flashFrame(true);
    mainWindow.once("focus", () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(false);
    });
  }

  notification.on("click", () => {
    try { notification.close(); } catch {}
    activeNativeNotifications.delete(notification);
    notificationLog("clicked", { type: normalized.type, screen: normalized.screen, action: "open" });
    dispatchNotificationClick(notificationActionPayload(normalized, "open"));
  });

  notification.on("action", (details, legacyActionIndex) => {
    const action = resolveNotificationAction(details, legacyActionIndex);
    try { notification.close(); } catch {}
    activeNativeNotifications.delete(notification);
    notificationLog("clicked", { type: normalized.type, screen: normalized.screen, action });
    dispatchNotificationClick(notificationActionPayload(normalized, action));
  });

  notification.once("show", () => {
    notificationLog("displayed", { type: normalized.type, screen: normalized.screen, entityId: normalized.entityId });
  });
  notification.on("close", () => {
    activeNativeNotifications.delete(notification);
    notificationLog("closed", { type: normalized.type, entityId: normalized.entityId });
  });
  notification.on("failed", (_event, error) => {
    activeNativeNotifications.delete(notification);
    log.error("[DesktopNotification]", { event: "display-failed", type: normalized.type, error });
  });

  notification.show();
  return true;
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
    const brandedIcon = nativeImage.createFromPath(iconPath());
    if (!brandedIcon.isEmpty()) {
      splashWindow.setIcon(brandedIcon);
    }
  } catch (e) {}

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

  try {
    const brandedIcon = nativeImage.createFromPath(iconPath());
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
          title: "VitelGlobal is running in the background",
          body: "Calls and notifications remain active. Open VitelGlobal from the system tray to return.",
          silent: true,
          type: "general",
          screen: "/notifications"
        });
      }
    }
  });

  mainWindow.on("focus", () => {
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
    mainWindow.show();
    if (pendingDeepLink) {
      handleDeepLink(pendingDeepLink);
      pendingDeepLink = undefined;
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedUrl(url)) {
      return { action: "allow" };
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

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    log.warn("did-fail-load", { errorCode, errorDescription, validatedUrl, isMainFrame });
    if (isMainFrame) {
      mainWindow.loadURL(`${localPage("offline.html")}?code=${encodeURIComponent(errorCode)}&message=${encodeURIComponent(errorDescription)}`);
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
          body: item.getFilename()
        });
      }
    });
  });

  return mainWindow.loadURL(APP_URL);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath()));
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
        app.dock.show();
      } catch (e) {}
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
      } catch (e) {}
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
        { role: "togglefullscreen" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" },
        { type: "separator" },
        { role: "toggleDevTools", visible: !app.isPackaged }
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

function configureAutoUpdater() {
  if (autoUpdater) {
    return autoUpdater;
  }

  ({ autoUpdater } = require("electron-updater"));
  autoUpdater.logger = log;
  autoUpdater.on("checking-for-update", () => send("update:status", { status: "checking" }));
  autoUpdater.on("update-available", (info) => send("update:status", { status: "available", info }));
  autoUpdater.on("update-not-available", (info) => send("update:status", { status: "not-available", info }));
  autoUpdater.on("download-progress", (progress) => send("update:progress", progress));
  autoUpdater.on("update-downloaded", (info) => {
    send("update:status", { status: "downloaded", info });
    showNativeNotification({
      title: "Update ready",
      body: "Restart VitelGlobal Desktop to finish installing the update."
    });
  });
  autoUpdater.on("error", (error) => send("update:status", { status: "error", message: error.message }));

  return autoUpdater;
}

function configureSession() {
  const defaultSession = session.defaultSession;

  defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const permitted = new Set([
      "media",
      "microphone",
      "camera",
      "display-capture",
      "notifications",
      "fullscreen",
      "clipboard-sanitized-write",
      "clipboard-read"
    ]);

    log.info("Permission request auto-granted:", { permission, requestingUrl: details?.requestingUrl });
    callback(permitted.has(permission));
  });

  defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return ["media", "microphone", "camera", "display-capture", "notifications", "fullscreen", "clipboard-sanitized-write", "clipboard-read"].includes(permission);
  });

  if (typeof defaultSession.setDisplayMediaRequestHandler === "function") {
    defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 320, height: 180 }
        });
        callback(sources[0] ? { video: sources[0], audio: "loopback" } : {});
      } catch (error) {
        log.error("Display media request failed", error);
        callback({});
      }
    }, { useSystemPicker: true });
  }

  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    headers["X-Content-Type-Options"] = ["nosniff"];
    headers["Referrer-Policy"] = ["strict-origin-when-cross-origin"];
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
  ipcMain.handle("app:get-info", () => ({
    name: APP_NAME,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    appUrl: APP_URL,
    homeOrigin: HOME_ORIGIN,
    logPath: log.transports.file.getFile().path
  }));

  ipcMain.handle("app:reload", () => mainWindow?.webContents.reload());
  ipcMain.handle("app:home", () => mainWindow?.loadURL(APP_URL));
  ipcMain.handle("app:open-logs", () => shell.showItemInFolder(log.transports.file.getFile().path));
  ipcMain.handle("app:choose-files", () => chooseFiles(mainWindow));
  ipcMain.handle("app:read-clipboard", () => clipboard.readText());
  ipcMain.handle("app:write-clipboard", (_event, text) => clipboard.writeText(String(text ?? "")));
  ipcMain.handle("app:notify", (_event, payload) => showNativeNotification(payload));
  ipcMain.handle("app:clear-notifications", (_event, type) => {
    const requestedType = String(type || "").trim().toLowerCase();
    let cleared = 0;
    for (const notification of [...activeNativeNotifications]) {
      const notificationType = String(notification.vitelNotificationType || "").trim().toLowerCase();
      if (!shouldClearNotificationType(notificationType, requestedType)) continue;
      try {
        notification.close();
        cleared += 1;
      } catch (err) {}
      activeNativeNotifications.delete(notification);
    }
    if (requestedType === "incoming-call" && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.flashFrame(false);
    }
    notificationLog("clear-request", { requestedType: requestedType || "all", cleared, remaining: activeNativeNotifications.size });
    return cleared;
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
  ipcMain.handle("app:get-auto-launch", () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle("app:set-auto-launch", (_event, enabled) => {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      openAsHidden: true
    });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle("app:set-badge-count", (_event, count) => {
    const safeCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
    if (process.platform === "darwin" || process.platform === "linux") {
      return app.setBadgeCount(safeCount);
    }
    if (mainWindow) {
      mainWindow.setOverlayIcon(safeCount > 0 ? nativeImage.createFromPath(iconPath()) : null, safeCount > 0 ? `${safeCount} unread` : "");
    }
    return true;
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
  configureSession();
  registerIpc();
  configureAutoUpdater();
  createMenu();
  createTray();
  createSplashWindow();
  await createMainWindow();

  globalShortcut.register("CommandOrControl+Shift+V", () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      showMainWindow();
    }
  });

  log.info(`${APP_NAME} started`, {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    os: `${os.type()} ${os.release()}`
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
