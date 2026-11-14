const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spherexAPI', {
  // Existing Data API handlers
  searchSIA2: (params) => ipcRenderer.invoke('spherex:search-sia2', params),
  queryTAP: (params) => ipcRenderer.invoke('spherex:query-tap', params),
  loadSpectrum: (params) => ipcRenderer.invoke('spherex:load-spectrum', params),
  loadCutouts: (params) => ipcRenderer.invoke('spherex:load-cutouts', params),
  onSpectrumProgress: (callback) => ipcRenderer.on('spherex:spectrum-progress', (event, progress) => callback(progress)),
  onCutoutProgress: (callback) => ipcRenderer.on('spherex:cutout-progress', (event, progress) => callback(progress)),
  queryGaia: (params) => ipcRenderer.invoke('spherex:query-gaia', params),
  querySimbadNamedStars: (params) => ipcRenderer.invoke('spherex:query-simbad-named-stars', params),
  resolveObject: (query) => ipcRenderer.invoke('spherex:resolve-object', query),
  fetchIBE: (params) => ipcRenderer.invoke('spherex:fetch-ibe', params),
  
  // New Auth & AI API handlers
  getOpenRouterKey: () => ipcRenderer.invoke('get-openrouter-key'),
  setOpenRouterKey: (key) => ipcRenderer.invoke('set-openrouter-key', key),
  isAuthenticated: () => ipcRenderer.invoke('is-authenticated'),
  logout: () => ipcRenderer.invoke('logout'),
  callOpenRouterAPI: (params) => ipcRenderer.invoke('call-openrouter-api', params),
  exchangeCodeForApiKey: (params) => ipcRenderer.invoke('exchange-code-for-key', params),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onAuthCallback: (callback) => ipcRenderer.on('auth-callback', (event, url) => callback(url)),
  
  isElectron: true
});
