const { app, BrowserWindow, webContents, session, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

const logFile = path.resolve(__dirname, 'test_progress.txt');
function logStep(msg) {
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
}
fs.writeFileSync(logFile, 'Starting test...\n');

process.on('uncaughtException', (err) => logStep('UNCAUGHT EXCEPTION: ' + err.stack));
process.on('unhandledRejection', (err) => logStep('UNHANDLED REJECTION: ' + (err?.stack || err)));

app.whenReady().then(async () => {
  logStep('app.whenReady');
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback) => callback(true));
  ses.setPermissionCheckHandler(() => true);

  let lastCaptureOutcome = null;
  const lastCaptureOutcomeByContents = new Map();
  let activeCapture = null;
  let simulatedPermissionDenied = false;
  let simulatedEmptySources = false;

  ipcMain.handle('screen-capture:get-outcome', (event) => {
    const senderId = event.sender?.id;
    const outcome = lastCaptureOutcomeByContents.get(senderId) || lastCaptureOutcome;
    if (outcome && (Date.now() - outcome.timestamp < 10000)) {
      return { ok: true, reason: outcome.reason, elapsed: Date.now() - outcome.timestamp };
    }
    return { ok: false, reason: 'none' };
  });

  function finishCapture(source, reason = (source ? 'selected' : 'user-cancelled')) {
    if (!activeCapture) return;
    const request = activeCapture;
    activeCapture = null;
    clearTimeout(request.timer);

    lastCaptureOutcome = {
      reason,
      sourceId: source?.id || null,
      timestamp: Date.now()
    };
    if (request.requestingId) {
      lastCaptureOutcomeByContents.set(request.requestingId, lastCaptureOutcome);
    }

    if (source) {
      request.respond({ video: source });
    } else {
      request.respond(null);
    }
  }

  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    logStep('setDisplayMediaRequestHandler called');
    if (activeCapture) {
      finishCapture(null, 'superseded');
    }

    let requestingWebContents = null;
    try {
      if (request.frame && typeof webContents.fromFrame === 'function') {
        requestingWebContents = webContents.fromFrame(request.frame);
      }
    } catch (_) {}
    const requestingId = requestingWebContents && !requestingWebContents.isDestroyed() ? requestingWebContents.id : null;

    if (simulatedPermissionDenied) {
      lastCaptureOutcome = { reason: 'permission-denied', timestamp: Date.now() };
      if (requestingId) lastCaptureOutcomeByContents.set(requestingId, lastCaptureOutcome);
      callback(null);
      return;
    }

    let sources = [];
    if (!simulatedEmptySources) {
      sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
    }

    if (!sources.length) {
      lastCaptureOutcome = { reason: 'no-sources', timestamp: Date.now() };
      if (requestingId) lastCaptureOutcomeByContents.set(requestingId, lastCaptureOutcome);
      callback(null);
      return;
    }

    activeCapture = {
      request,
      sources,
      respond: callback,
      requestingId,
      timer: setTimeout(() => finishCapture(null, 'timeout'), 15000)
    };
    logStep('activeCapture ready with ' + sources.length + ' sources');
  });

  async function waitForActiveCapture(timeout = 8000) {
    const start = Date.now();
    while (!activeCapture && (Date.now() - start < timeout)) {
      await new Promise(r => setTimeout(r, 50));
    }
    return activeCapture;
  }

  const preloadPath = path.resolve(__dirname, '../src/preload/index.js');
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: ses,
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  await win.loadURL('https://meet.vitelglobal.com');
  logStep('Page loaded');

  const testResults = {};

  // Scenario 1
  logStep('Start Scenario 1');
  let p1 = win.webContents.executeJavaScript(`
    navigator.mediaDevices.getDisplayMedia({ video: true })
      .then(() => ({ success: true }))
      .catch(err => ({ success: false, name: err.name, message: err.message }))
  `, true);
  await waitForActiveCapture();
  finishCapture(null, 'user-cancelled');
  let r1 = await p1;
  logStep('Scenario 1 result: ' + JSON.stringify(r1));
  testResults['Scenario 1 (Cancel button)'] = (r1.name === 'NotAllowedError' && !r1.message.includes('Invalid capture constraints')) ? 'PASS' : 'FAIL';

  // Scenario 2
  logStep('Start Scenario 2');
  let p2 = win.webContents.executeJavaScript(`
    navigator.mediaDevices.getDisplayMedia({ video: true })
      .then(() => ({ success: true }))
      .catch(err => ({ success: false, name: err.name, message: err.message }))
  `, true);
  await waitForActiveCapture();
  finishCapture(null, 'closed');
  let r2 = await p2;
  logStep('Scenario 2 result: ' + JSON.stringify(r2));
  testResults['Scenario 2 (Close X button)'] = (r2.name === 'NotAllowedError' && !r2.message.includes('Invalid capture constraints')) ? 'PASS' : 'FAIL';

  // Scenario 3
  logStep('Start Scenario 3');
  let p3 = win.webContents.executeJavaScript(`
    navigator.mediaDevices.getDisplayMedia({ video: true })
      .then(stream => {
        const tracks = stream.getVideoTracks();
        const hasTrack = tracks.length > 0;
        tracks.forEach(t => t.stop());
        return { success: true, hasTrack };
      })
      .catch(err => ({ success: false, name: err.name, message: err.message }))
  `, true);
  const cap3 = await waitForActiveCapture();
  const screenSources = cap3.sources.filter(s => s.id.startsWith('screen:'));
  finishCapture(screenSources[0] || cap3.sources[0], 'selected');
  let r3 = await p3;
  logStep('Scenario 3 result: ' + JSON.stringify(r3));
  testResults['Scenario 3 (Select Entire Screen)'] = (r3.success && r3.hasTrack) ? 'PASS' : 'FAIL';

  // Scenario 4
  logStep('Start Scenario 4');
  let p4 = win.webContents.executeJavaScript(`
    navigator.mediaDevices.getDisplayMedia({ video: true })
      .then(stream => {
        const tracks = stream.getVideoTracks();
        const hasTrack = tracks.length > 0;
        tracks.forEach(t => t.stop());
        return { success: true, hasTrack };
      })
      .catch(err => ({ success: false, name: err.name, message: err.message }))
  `, true);
  const cap4 = await waitForActiveCapture();
  const windowSources = cap4.sources.filter(s => s.id.startsWith('window:'));
  finishCapture(windowSources[0] || cap4.sources[0], 'selected');
  let r4 = await p4;
  logStep('Scenario 4 result: ' + JSON.stringify(r4));
  testResults['Scenario 4 (Select Window)'] = (r4.success && r4.hasTrack) ? 'PASS' : 'FAIL';

  // Scenario 5
  logStep('Start Scenario 5');
  let p5 = win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      navigator.mediaDevices.getDisplayMedia({ video: true })
        .then(stream => {
          const track = stream.getVideoTracks()[0];
          const trackStarted = track && track.readyState === 'live';
          track.stop();
          const trackEnded = track && track.readyState === 'ended';
          resolve({ success: true, trackStarted, trackEnded });
        })
        .catch(err => resolve({ success: false, error: err.message }))
    })
  `, true);
  const cap5 = await waitForActiveCapture();
  finishCapture(cap5.sources[0], 'selected');
  let r5 = await p5;
  logStep('Scenario 5 result: ' + JSON.stringify(r5));
  testResults['Scenario 5 (Start and Stop)'] = (r5.success && r5.trackStarted && r5.trackEnded) ? 'PASS' : 'FAIL';

  // Scenario 6
  logStep('Start Scenario 6');
  let p6_1 = win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      navigator.mediaDevices.getDisplayMedia({ video: true })
        .then(stream => {
          stream.getVideoTracks().forEach(t => t.stop());
          resolve(true);
        })
        .catch(() => resolve(false));
    })
  `, true);
  const cap6_1 = await waitForActiveCapture();
  finishCapture(cap6_1.sources[0], 'selected');
  await p6_1;

  let p6_2 = win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      navigator.mediaDevices.getDisplayMedia({ video: true })
        .then(stream => {
          const ok = stream.getVideoTracks().length > 0;
          stream.getVideoTracks().forEach(t => t.stop());
          resolve(ok);
        })
        .catch(() => resolve(false));
    })
  `, true);
  const cap6_2 = await waitForActiveCapture();
  finishCapture(cap6_2.sources[0], 'selected');
  let r6_2 = await p6_2;
  logStep('Scenario 6 result: ' + r6_2);
  testResults['Scenario 6 (Immediate Re-share)'] = r6_2 ? 'PASS' : 'FAIL';

  // Scenario 7
  logStep('Start Scenario 7');
  simulatedEmptySources = true;
  let p7 = win.webContents.executeJavaScript(`
    navigator.mediaDevices.getDisplayMedia({ video: true })
      .then(() => ({ success: true }))
      .catch(err => ({ success: false, name: err.name, message: err.message }))
  `, true);
  let r7 = await p7;
  simulatedEmptySources = false;
  logStep('Scenario 7 result: ' + JSON.stringify(r7));
  testResults['Scenario 7 (No source available)'] = (!r7.success) ? 'PASS' : 'FAIL';

  // Scenario 8
  logStep('Start Scenario 8');
  simulatedPermissionDenied = true;
  let p8 = win.webContents.executeJavaScript(`
    navigator.mediaDevices.getDisplayMedia({ video: true })
      .then(() => ({ success: true }))
      .catch(err => ({ success: false, name: err.name, message: err.message }))
  `, true);
  let r8 = await p8;
  simulatedPermissionDenied = false;
  logStep('Scenario 8 result: ' + JSON.stringify(r8));
  testResults['Scenario 8 (Permission denied)'] = (!r8.success) ? 'PASS' : 'FAIL';

  // Scenario 9
  logStep('Start Scenario 9');
  let p9_1 = win.webContents.executeJavaScript(`
    navigator.mediaDevices.getDisplayMedia({ video: true })
      .then(() => 'first_resolved')
      .catch(err => err.name)
  `, true);
  await waitForActiveCapture();

  let p9_2 = win.webContents.executeJavaScript(`
    navigator.mediaDevices.getDisplayMedia({ video: true })
      .then(stream => {
        stream.getTracks().forEach(t => t.stop());
        return 'second_resolved';
      })
      .catch(err => err.name)
  `, true);
  let r9_1 = await p9_1;
  const cap9_2 = await waitForActiveCapture();
  finishCapture(cap9_2.sources[0], 'selected');
  let r9_2 = await p9_2;
  logStep('Scenario 9 result: ' + r9_1 + ', ' + r9_2);
  testResults['Scenario 9 (Repeated clicks)'] = (r9_1 === 'NotAllowedError' && r9_2 === 'second_resolved') ? 'PASS' : 'FAIL';

  // Scenario 10
  logStep('Start Scenario 10');
  let p10 = win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      navigator.mediaDevices.getDisplayMedia({ video: true })
        .then(screenStream => {
          navigator.mediaDevices.enumerateDevices()
            .then(devs => {
              screenStream.getTracks().forEach(t => t.stop());
              resolve({ ok: true, count: devs.length });
            })
            .catch(() => {
              screenStream.getTracks().forEach(t => t.stop());
              resolve({ ok: false });
            });
        })
        .catch(err => resolve({ ok: false, error: err.message }));
    })
  `, true);
  const cap10 = await waitForActiveCapture();
  finishCapture(cap10.sources[0], 'selected');
  let r10 = await p10;
  logStep('Scenario 10 result: ' + JSON.stringify(r10));
  testResults['Scenario 10 (Mic and camera co-exist)'] = r10.ok ? 'PASS' : 'FAIL';

  // Scenario 11
  logStep('Start Scenario 11');
  let p11 = win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const initialUrl = window.location.href;
      navigator.mediaDevices.getDisplayMedia({ video: true })
        .then(() => resolve({ disconnected: true }))
        .catch(err => {
          const stillOnMeeting = window.location.href === initialUrl;
          resolve({ disconnected: false, stillOnMeeting, errName: err.name });
        });
    })
  `, true);
  await waitForActiveCapture();
  finishCapture(null, 'user-cancelled');
  let r11 = await p11;
  logStep('Scenario 11 result: ' + JSON.stringify(r11));
  testResults['Scenario 11 (Cancel preserves meeting)'] = (!r11.disconnected && r11.stillOnMeeting && r11.errName === 'NotAllowedError') ? 'PASS' : 'FAIL';

  fs.writeFileSync(
    path.resolve(__dirname, 'test_screen_sharing_report.json'),
    JSON.stringify(testResults, null, 2)
  );

  logStep('ALL DONE! Results: ' + JSON.stringify(testResults));
  app.quit();
});
