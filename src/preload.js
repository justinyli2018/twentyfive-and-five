'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onCommand: cb => ipcRenderer.on('command', (_e, cmd) => cb(cmd)),
  onGlass: cb => ipcRenderer.on('glass', (_e, glass) => cb(glass)),
  onNotice: cb => ipcRenderer.on('notice', (_e, msg) => cb(msg)),
  reportState: state => ipcRenderer.send('state', state),
  openMenu: () => ipcRenderer.send('menu'),
  info: () => ipcRenderer.invoke('info'),
});
