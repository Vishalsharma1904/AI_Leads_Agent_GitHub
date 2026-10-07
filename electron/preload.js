'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// No filesystem, process, shell or arbitrary IPC access reaches the renderer.
contextBridge.exposeInMainWorld('RudraDesktop', {
  configuration: () => ipcRenderer.invoke('desktop:configuration'),
  connect: (backendUrl) => ipcRenderer.invoke('desktop:connect', backendUrl),
  openWorkspace: () => ipcRenderer.invoke('desktop:workspace')
});
