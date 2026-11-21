'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onCommand: cb => ipcRenderer.on('command', (_e, cmd) => cb(cmd)),
  onGlass: cb => ipcRenderer.on('glass', (_e, glass) => cb(glass)),
  onNotice: cb => ipcRenderer.on('notice', (_e, msg) => cb(msg)),
  onGlassPanel: cb => ipcRenderer.on('glass-panel', () => cb()),
  setGlass: value => ipcRenderer.send('set-glass', value),
  reportState: state => ipcRenderer.send('state', state),
  openMenu: () => ipcRenderer.send('menu'),
  info: () => ipcRenderer.invoke('info'),
});
