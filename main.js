'use strict';

const { app, BrowserWindow, Menu, Tray, nativeImage, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn }  = require('child_process');
const http       = require('http');
const path       = require('path');
const fs         = require('fs');

// ── constants ─────────────────────────────────────────────────────────────────
const FLASK_URL  = 'http://localhost:5000';
const POLL_MS    = 500;
const TIMEOUT_MS = 60_000;   // 60 s — PyInstaller bundles are slow on first run

const PROJECT_ROOT = path.resolve(__dirname, '..');

// ── logging ───────────────────────────────────────────────────────────────────
let _logPath = null;

function logPath() {
  if (!_logPath) _logPath = path.join(app.getPath('userData'), 'startup.log');
  return _logPath;
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(logPath(), line); } catch (_) {}
}

// ── state ─────────────────────────────────────────────────────────────────────
let mainWindow        = null;
let splashWindow      = null;
let tray              = null;
let flaskProc         = null;
let isQuitting        = false;
let _manualUpdateCheck = false;   // true when triggered from tray menu

// ── Flask management ──────────────────────────────────────────────────────────
function startFlask() {
  let cmd, args, cwd;

  if (app.isPackaged) {
    // Production: launch the PyInstaller bundled executable from extraResources
    const exePath = path.join(
      process.resourcesPath,
      'ForexTradingAI',
      'ForexTradingAI.exe',
    );
    const exists = fs.existsSync(exePath);
    log(`Production mode`);
    log(`exePath  : ${exePath}`);
    log(`exists   : ${exists}`);
    if (!exists) {
      log('ERROR: executable not found — aborting Flask start');
      return;
    }
    cmd  = exePath;
    args = [];
    cwd  = path.join(process.resourcesPath, 'ForexTradingAI');
  } else {
    // Development: launch dashboard.py with the system Python
    const python = process.platform === 'win32' ? 'python' : 'python3';
    cmd  = python;
    args = ['src/dashboard.py'];
    cwd  = PROJECT_ROOT;
    log(`Development mode — cmd: ${python} src/dashboard.py`);
  }

  log(`Spawning: ${cmd} ${args.join(' ')}`);

  try {
    flaskProc = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    log(`spawn error: ${err.message}`);
    return;
  }

  flaskProc.stdout.on('data', d => {
    const text = d.toString().trim();
    log(`[flask stdout] ${text}`);
  });

  flaskProc.stderr.on('data', d => {
    const text = d.toString().trim();
    log(`[flask stderr] ${text}`);
  });

  flaskProc.on('error', err => {
    log(`Flask process error: ${err.message}`);
  });

  flaskProc.on('exit', (code, signal) => {
    log(`Flask exited — code: ${code}, signal: ${signal}`);
    if (!isQuitting) {
      log('WARNING: Flask exited unexpectedly');
    }
  });

  log(`Flask spawned — PID: ${flaskProc.pid}`);
}

function stopFlask() {
  if (!flaskProc) return;
  try {
    flaskProc.kill('SIGTERM');
    setTimeout(() => {
      try { flaskProc.kill('SIGKILL'); } catch (_) {}
    }, 2000);
  } catch (_) {}
  flaskProc = null;
}

function waitForFlask() {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    function poll() {
      http.get(FLASK_URL, (res) => {
        res.resume();
        log(`Flask responded — HTTP ${res.statusCode}`);
        resolve();
      }).on('error', () => {
        const elapsed = Date.now() - start;
        if (elapsed >= TIMEOUT_MS) {
          reject(new Error(`Flask did not respond within ${TIMEOUT_MS / 1000} s`));
        } else {
          setTimeout(poll, POLL_MS);
        }
      });
    }

    poll();
  });
}

// ── error window ──────────────────────────────────────────────────────────────
function showErrorWindow(message) {
  const errWin = new BrowserWindow({
    width:          520,
    height:         320,
    center:         true,
    resizable:      false,
    title:          'Forex Trading AI — Startup Error',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  const lp   = logPath().replace(/\\/g, '\\\\');
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  body{margin:0;background:#1a1a2e;color:#f8fafc;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center;padding:0 32px;box-sizing:border-box;}
  h2{color:#ef4444;font-size:1.1rem;margin-bottom:12px;}
  p{color:#94a3b8;font-size:0.875rem;line-height:1.6;margin:0 0 8px;}
  code{display:block;margin-top:16px;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:10px 14px;font-size:0.75rem;color:#f59e0b;word-break:break-all;text-align:left;}
</style>
</head>
<body>
  <h2>&#9888; Forex Trading AI failed to start</h2>
  <p>${message}</p>
  <p>Please make sure <strong>MetaTrader 5</strong> is installed and open before launching.</p>
  <p>If the problem persists, send the log file to support.</p>
  <code>Log file: ${lp}</code>
</body>
</html>`;

  errWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  Menu.setApplicationMenu(null);
}

// ── splash window ─────────────────────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width:           400,
    height:          300,
    frame:           false,
    transparent:     false,
    resizable:       false,
    center:          true,
    alwaysOnTop:     true,
    skipTaskbar:     true,
    webPreferences:  { nodeIntegration: false, contextIsolation: true },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
}

function closeSplash() {
  if (splashWindow) {
    splashWindow.close();
    splashWindow = null;
  }
}

// ── main window ───────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:     1200,
    height:    800,
    minWidth:  900,
    minHeight: 600,
    title:     'Forex Trading AI v1.0.0',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
    show: false,
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadURL(FLASK_URL);

  mainWindow.once('ready-to-show', () => {
    closeSplash();
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ── tray ──────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const icon     = nativeImage.createFromPath(iconPath);
  tray           = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);

  tray.setToolTip('Forex Trading AI');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } },
    },
    {
      label: 'Check for Updates',
      click: () => {
        if (!app.isPackaged) {
          dialog.showMessageBox({
            type:    'info',
            title:   'Dev Mode',
            message: 'Auto-update only works in the packaged (installed) app.',
            buttons: ['OK'],
          });
          return;
        }
        _manualUpdateCheck = true;
        autoUpdater.checkForUpdates().catch(err => {
          log(`[updater] Manual check error: ${err.message}`);
        });
      },
    },
    { type: 'separator' },
    { label: 'Start Bot', click: () => apiPost('/api/start') },
    { label: 'Stop Bot',  click: () => apiPost('/api/stop')  },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { isQuitting = true; stopFlask(); app.quit(); },
    },
  ]);

  tray.setContextMenu(menu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) { mainWindow.focus(); }
      else { mainWindow.show(); mainWindow.focus(); }
    }
  });
}

// ── auto-updater ──────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  // Route updater logs into startup.log
  autoUpdater.logger = {
    info:  (msg) => log(`[updater] ${msg}`),
    warn:  (msg) => log(`[updater:warn] ${msg}`),
    error: (msg) => log(`[updater:error] ${msg}`),
    debug: ()    => {},
  };

  autoUpdater.on('update-available', (info) => {
    log(`[updater] Update available — version ${info.version}`);
    if (_manualUpdateCheck) {
      _manualUpdateCheck = false;
      dialog.showMessageBox({
        type:    'info',
        title:   'Update Available',
        message: `Version ${info.version} is available and downloading now.`,
        detail:  'You will be notified when it is ready to install.',
        buttons: ['OK'],
      });
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    log(`[updater] No update available — current version is up to date`);
    if (_manualUpdateCheck) {
      _manualUpdateCheck = false;
      dialog.showMessageBox({
        type:    'info',
        title:   'No Updates',
        message: "You're on the latest version.",
        detail:  `Forex Trading AI v${app.getVersion()} is current.`,
        buttons: ['OK'],
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    log(`[updater] Update downloaded — version ${info.version}`);
    dialog.showMessageBox({
      type:      'info',
      title:     'Update Ready to Install',
      message:   `Forex Trading AI v${info.version} has been downloaded.`,
      detail:    'Restart now to apply the update, or continue and restart later.',
      buttons:   ['Restart Now', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        isQuitting = true;
        stopFlask();
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (err) => {
    log(`[updater:error] ${err.message}`);
    // Do not crash the app — updater errors are non-fatal
  });

  // Only poll for updates in the packaged app; dev mode has no update feed
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
function apiPost(endpoint) {
  const opts = {
    hostname: 'localhost',
    port:     5000,
    path:     endpoint,
    method:   'POST',
    headers:  { 'Content-Type': 'application/json', 'Content-Length': 2 },
  };
  const req = http.request(opts, (res) => { res.resume(); });
  req.on('error', () => {});
  req.write('{}');
  req.end();
}

// ── app lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  log(`App ready — userData: ${app.getPath('userData')}`);
  log(`isPackaged: ${app.isPackaged}`);
  log(`resourcesPath: ${process.resourcesPath}`);

  createSplash();
  startFlask();

  try {
    await waitForFlask();
  } catch (err) {
    log(`FATAL: ${err.message}`);
    closeSplash();
    showErrorWindow(err.message);
    return;   // leave error window open — do not call app.quit()
  }

  createWindow();
  createTray();
  setupAutoUpdater();
});

app.on('window-all-closed', (e) => {
  // Stay alive in tray — do not quit when main window closes
  e.preventDefault();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopFlask();
});

app.on('activate', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});
