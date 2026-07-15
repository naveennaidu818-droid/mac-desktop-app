"use strict";

const params = new URLSearchParams(window.location.search);
const detail = [params.get("code"), params.get("message")].filter(Boolean).join(": ");

if (detail) {
  document.getElementById("details").textContent = detail;
}

document.getElementById("retry").addEventListener("click", () => {
  window.vitelDesktop?.home();
});

document.getElementById("logs").addEventListener("click", () => {
  window.vitelDesktop?.openLogs();
});
