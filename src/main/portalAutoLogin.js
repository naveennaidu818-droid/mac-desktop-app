"use strict";

// Runs inside the portal page. Keep credentials scoped to the exact destination
// origin, including after redirects, and wait for SPA forms to finish rendering.
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
  // Defer submission until controlled inputs have updated their state.
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

module.exports = { attachPortalAutoLogin, fillPortalLogin };
