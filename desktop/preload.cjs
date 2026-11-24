const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pulsepcDesktop', {
  connect: (url, user) => ipcRenderer.invoke('connect', url, user)
});
