const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { existsSync } = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ui = path.join(__dirname, 'ui', 'index.html');
function openWindow() {
  const win = new BrowserWindow({
    width: 1160, height: 820, minWidth: 400, minHeight: 500, autoHideMenuBar: true,
    backgroundColor: '#101821',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.loadFile(ui);
}
ipcMain.handle('connect', (event, address, user) => {
  if (!event.senderFrame?.url.startsWith('file:')) throw Error('Origine invalide.');
  const host = new URL(address).hostname;
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(host) || !/^[a-z_][a-z0-9_-]*$/i.test(user)) {
    throw Error('Adresse ou utilisateur SSH invalide.');
  }
  return new Promise((resolve, reject) => {
    const terminal = spawn(process.env.ComSpec || 'cmd.exe',
      ['/d','/s','/c','start','PulsePC SSH','ssh.exe','-tt',user + '@' + host,'su','-'],
      { detached: true, stdio: 'ignore', windowsHide: true });
    terminal.once('error', reject);
    terminal.once('spawn', () => { terminal.unref(); resolve(); });
  });
});
app.whenReady().then(() => {
  openWindow();
  const tailscale = path.join(process.env.ProgramFiles || 'C:\\Program Files','Tailscale','tailscale.exe');
  if (existsSync(tailscale)) {
    const process = spawn(tailscale,['up'],{windowsHide:true,stdio:'ignore'});
    process.on('error', console.error);
  }
  if (app.isPackaged) {
    autoUpdater.on('error', error => console.warn('PulsePC update',error.message));
    autoUpdater.autoInstallOnAppQuit = true;
    const check = () => autoUpdater.checkForUpdates().catch(() => {});
    check();
    setInterval(check, 4 * 60 * 60 * 1000).unref();
  }
});
app.on('window-all-closed', () => app.quit());
