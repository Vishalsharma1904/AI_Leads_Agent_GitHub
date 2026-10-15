'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// No filesystem, process, shell or arbitrary IPC access reaches the renderer.
contextBridge.exposeInMainWorld('RudraDesktop', {
  googleSignIn: url => ipcRenderer.invoke('desktop:google-sign-in', url),
  configuration: () => ipcRenderer.invoke('desktop:configuration'),
  connect: (backendUrl) => ipcRenderer.invoke('desktop:connect', backendUrl),
  autoConnect: () => ipcRenderer.invoke('desktop:auto-connect'),
  openWorkspace: () => ipcRenderer.invoke('desktop:workspace'),
  hardware: () => ipcRenderer.invoke('desktop:hardware'),
  updateStatus: () => ipcRenderer.invoke('desktop:update-status'),
  stageUpdate: token => ipcRenderer.invoke('desktop:update-stage', token),
  updateReady: () => ipcRenderer.invoke('desktop:update-ready')
});
