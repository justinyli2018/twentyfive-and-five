'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onCommand: cb => ipcRenderer.on('command', (_e, cmd) => cb(cmd)),
  onGlass: cb => ipcRenderer.on('glass', (_e, glass) => cb(glass)),
  onNotice: cb => ipcRenderer.on('notice', (_e, msg) => cb(msg)),
  onGlassPanel: cb => ipcRenderer.on('glass-panel', () => cb()),
  onAppearance: cb => ipcRenderer.on('appearance', (_e, a) => cb(a)),
  onThemePending: cb => ipcRenderer.on('theme-pending', (_e, p) => cb(p)),
  setGlass: value => ipcRenderer.send('set-glass', value),
  reportState: state => ipcRenderer.send('state', state),
  setContentHeight: h => ipcRenderer.send('content-height', h),
  wantFocus: on => ipcRenderer.invoke('want-focus', !!on),
  todosLoad: () => ipcRenderer.invoke('todos-load'),
  todosSave: data => ipcRenderer.send('todos-save', data),
  openMenu: () => ipcRenderer.send('menu'),
  info: () => ipcRenderer.invoke('info'),
});
