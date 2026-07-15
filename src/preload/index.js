"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
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
  readClipboard: () => invoke("app:read-clipboard"),
  writeClipboard: (text) => invoke("app:write-clipboard", text),
  notify: (payload) => invoke("app:notify", payload),
  checkForUpdates: () => invoke("app:check-for-updates"),
  getAutoLaunch: () => invoke("app:get-auto-launch"),
  setAutoLaunch: (enabled) => invoke("app:set-auto-launch", Boolean(enabled)),
  setBadgeCount: (count) => invoke("app:set-badge-count", Number(count) || 0),
  onDeepLink: (callback) => on("deep-link", callback),
  onDownloadProgress: (callback) => on("download:progress", callback),
  onDownloadDone: (callback) => on("download:done", callback),
  onUpdateStatus: (callback) => on("update:status", callback),
  onUpdateProgress: (callback) => on("update:progress", callback)
});
