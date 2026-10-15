"use strict";

const params = new URLSearchParams(window.location.search);
const detail = [params.get("code"), params.get("message")].filter(Boolean).join(": ");

if (detail) {
  document.getElementById("details").textContent = detail;
}

const offlineBtn = document.getElementById("offline-app");
if (offlineBtn) {
  offlineBtn.addEventListener("click", () => {
    window.vitelDesktop?.loadOfflineApp();
  });
}

document.getElementById("retry")?.addEventListener("click", () => {
  if (typeof window.vitelDesktop?.loadRemoteApp === "function") {
    window.vitelDesktop.loadRemoteApp();
  } else {
    window.vitelDesktop?.home();
  }
});

document.getElementById("logs")?.addEventListener("click", () => {
  window.vitelDesktop?.openLogs();
});

// If internet is disconnected, offer smooth auto-handoff to local SQLite workspace
const errCode = params.get("code");
if (errCode === "-106" || !navigator.onLine) {
  const panel = document.querySelector(".state-panel");
  if (panel) {
    const hint = document.createElement("p");
    hint.style.fontSize = "13px";
    hint.style.color = "#112c74";
    hint.style.fontWeight = "500";
    hint.style.marginTop = "14px";
    hint.style.padding = "8px 12px";
    hint.style.background = "#eef4fd";
    hint.style.borderRadius = "6px";
    hint.textContent = "Switching to your local offline workspace with stored messages & contacts in 2 seconds...";
    panel.appendChild(hint);

    setTimeout(() => {
      window.vitelDesktop?.loadOfflineApp();
    }, 2000);
  }
}
