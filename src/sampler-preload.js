'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sampler', {
  onRequest: cb => ipcRenderer.on('sampler-request', (_e, msg) => cb(msg)),
  reply: msg => ipcRenderer.send('sampler-reply', msg),
});
