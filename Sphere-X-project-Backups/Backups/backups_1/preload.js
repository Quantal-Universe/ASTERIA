const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spherexAPI', {
  searchSIA2: (params) => ipcRenderer.invoke('spherex:search-sia2', params),
  queryTAP: (params) => ipcRenderer.invoke('spherex:query-tap', params),
  resolveObject: (query) => ipcRenderer.invoke('spherex:resolve-object', query),
  fetchIBE: (params) => ipcRenderer.invoke('spherex:fetch-ibe', params),
  isElectron: true
});
