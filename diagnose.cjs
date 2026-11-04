const { app, BrowserWindow } = require('electron');
const fs = require('fs');

const logFile = 'D:/Desktop-app/exe-file/diagnose.log';
function log(msg) {
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
}

fs.writeFileSync(logFile, 'Starting diagnosis...\n');

app.whenReady().then(async () => {
  log('App ready');
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: 'D:/Desktop-app/exe-file/src/preload/index.js'
    }
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    log(`[CONSOLE ${level}] ${message} (${sourceId}:${line})`);
  });

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    log(`[DID-FAIL-LOAD] ${errorCode}: ${errorDescription} (${validatedURL})`);
  });

  win.webContents.on('did-navigate', (event, url) => {
    log(`[NAVIGATE] ${url}`);
  });

  win.webContents.on('did-navigate-in-page', (event, url) => {
    log(`[IN-PAGE] ${url}`);
  });

  log('Loading https://desktop.officemeetings.net/...');
  try {
    await win.loadURL('https://desktop.officemeetings.net/');
    log('Initial loadURL resolved');
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const url = win.webContents.getURL();
      const title = win.getTitle();
      const body = await win.webContents.executeJavaScript('document.body.innerText').catch(e => e.message);
      log(`Tick ${i}: URL=${url} | Title=${title} | Body=${body.slice(0, 100).replace(/\n/g, ' ')}`);
    }
  } catch (err) {
    log(`Error loading URL: ${err.message}`);
  } finally {
    app.quit();
  }
});

