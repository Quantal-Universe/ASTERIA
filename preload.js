const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spherexAPI', {
  // --- NASA IRSA Data Handlers ---
  searchSIA2: (params) => ipcRenderer.invoke('spherex:search-sia2', params),
  queryTAP: (params) => ipcRenderer.invoke('spherex:query-tap', params),
  resolveObject: (query) => ipcRenderer.invoke('spherex:resolve-object', query),
  fetchIBE: (params) => ipcRenderer.invoke('spherex:fetch-ibe', params),

  // --- OpenRouter AI Handlers ---
  getOpenRouterKey: () => ipcRenderer.invoke('get-openrouter-key'),
  setOpenRouterKey: (key) => ipcRenderer.invoke('set-openrouter-key', key),
  isAuthenticated: () => ipcRenderer.invoke('is-authenticated'),
  logout: () => ipcRenderer.invoke('logout'),
  callOpenRouterAPI: (params) => ipcRenderer.invoke('call-openrouter-api', params),

  // --- Utilities ---
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onAuthCallback: (callback) => ipcRenderer.on('auth-callback', (event, url) => callback(url)),

  isElectron: true
});