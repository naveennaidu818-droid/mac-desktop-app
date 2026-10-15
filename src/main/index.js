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
  net
} = require("electron");
const log = require("electron-log/main");
const sqliteDb = require("./database");
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
  "vitelglobal.in"
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
    } catch (e) {}
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
  } catch (e) {}

  const additionalLegacyElectronPaths = [
    path.join(app.getPath("desktop"), "Electron.lnk"),
    path.join(process.env.PROGRAMDATA || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs", "Electron.lnk")
  ];
  for (const legacyPath of additionalLegacyElectronPaths) {
    try {
      if (fs.existsSync(legacyPath)) {
        fs.unlinkSync(legacyPath);
      }
    } catch (e) {}
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
    mainWindow.show();
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
        { role: "toggleDevTools" }
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
        checkForUpdates().catch(() => {});
      }
    }, 15 * 60 * 1000);

    // Initial check shortly after app start
    setTimeout(() => {
      if (!isCallActiveInApp) {
        checkForUpdates().catch(() => {});
      }
    }, 10 * 1000);
  }

  return autoUpdater;
}

function configureSession() {
  const defaultSession = session.defaultSession;

  // Clear stale HTTP and ServiceWorker caches on startup so desktop app always loads fresh code
  defaultSession.clearCache().catch(() => {});
  defaultSession.clearStorageData({
    storages: ["serviceworkers", "cachestorage", "shadercache"]
  }).catch(() => {});

  defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
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

  defaultSession.setPermissionCheckHandler((_webContents, permission) => {
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
  ipcMain.handle("app:notify", (_event, payload) => showNativeNotification(payload));
  ipcMain.handle("app:clear-notifications", (_event, type) => {
    stopDockBounce();
    for (const notification of activeNativeNotifications) {
      try {
        notification.close();
      } catch (err) {}
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
            } catch {}
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
      if (session?.defaultSession) {
        await session.defaultSession.clearStorageData({
          storages: ["cookies", "localstorage", "websql", "indexdb", "serviceworkers", "cachestorage"]
        });
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
}).catch((err) => {
  log.error("Fatal startup error in app.whenReady:", err);
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});