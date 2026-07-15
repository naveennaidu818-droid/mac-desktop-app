"use strict";

const setText = (id, value) => {
  document.getElementById(id).textContent = value || "-";
};

window.vitelDesktop?.getInfo().then((info) => {
  setText("version", info.version);
  setText("platform", `${info.platform} ${info.arch}`);
  setText("service", info.appUrl);
  setText("logs-path", info.logPath);
});

document.getElementById("logs").addEventListener("click", () => {
  window.vitelDesktop?.openLogs();
});

document.getElementById("updates").addEventListener("click", async () => {
  setText("update-status", "Checking for updates...");
  const result = await window.vitelDesktop?.checkForUpdates();
  if (result?.skipped) {
    setText("update-status", result.message);
  }
});

window.vitelDesktop?.onUpdateStatus((event) => {
  setText("update-status", event.message || event.status);
});
