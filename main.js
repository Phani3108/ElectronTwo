/**
 * ElectronTwo — main process.
 *
 * Intentionally minimal. Window + IPC for things the renderer can't do
 * (reading .env key, granting mic permission on mac). No business logic.
 */

const { app, BrowserWindow, ipcMain, session, systemPreferences, globalShortcut, screen } = require('electron');
const path = require('path');

try { require('dotenv').config(); } catch {}

process.title = 'Helper'; // stealth in Activity Monitor

let mainWindow;
let isVisible = true;

function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: 480,
    height: 600,
    x: width - 500,
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Invisible to screen share (the core stealth property)
  mainWindow.setContentProtection(true);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));

  if (!app.isPackaged) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); isVisible = false; }
  });
}

app.whenReady().then(async () => {
  // Pre-grant mic on macOS
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status !== 'granted') await systemPreferences.askForMediaAccess('microphone');
  }

  // Auto-grant renderer media permission (required in Electron 20+)
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media');
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));

  createWindow();

  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (isVisible) { mainWindow.hide(); isVisible = false; }
    else { mainWindow.show(); isVisible = true; }
  });
});

ipcMain.handle('get-env', (_e, key) => process.env[key]);

ipcMain.handle('get-mic-permission', () => {
  if (process.platform === 'darwin') return systemPreferences.getMediaAccessStatus('microphone');
  return 'granted';
});

ipcMain.handle('request-mic-permission', async () => {
  if (process.platform === 'darwin') {
    const granted = await systemPreferences.askForMediaAccess('microphone');
    return granted ? 'granted' : 'denied';
  }
  return 'granted';
});

app.on('before-quit', () => { app.isQuitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
