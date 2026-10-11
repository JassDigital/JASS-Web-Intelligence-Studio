const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { initDatabase } = require('./store.cjs');
const { registerIpc } = require('./services.cjs');

let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1080, minHeight: 700,
    backgroundColor: '#f5f7fb', title: 'JASS Web Intelligence Studio',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) shell.openExternal(url); return { action: 'deny' }; });
  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}
app.whenReady().then(() => {
  const db = initDatabase(path.join(app.getPath('userData'), 'jass-web-intelligence.sqlite'));
  registerIpc(ipcMain, db);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
