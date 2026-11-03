const { app, BrowserWindow, ipcMain, net, shell } = require('electron');
const path = require('path');
const axios = require('axios');
const Store = require('electron-store');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const http = require('http');

let store;

// Auth callback server
const authServer = http.createServer((req, res) => {
  if (req.url.startsWith('/auth/callback')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (mainWindow) mainWindow.webContents.send('auth-callback', url.toString());
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Authentication successful.');
  }
});
authServer.listen(3000, '127.0.0.1');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: 'SPHEREx Sky Survey Research Tool - NASA Time-Domain Explorer',
    backgroundColor: '#05080f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    return { action: 'deny' };
  });
}

// Simple HTTP/HTTPS fetch helper using Node/Electron net API
async function fetchURL(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const request = net.request({
      url: targetUrl,
      method: options.method || 'GET',
      headers: options.headers || {}
    });

    let body = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      response.on('end', () => {
        resolve({
          status: response.statusCode,
          headers: response.headers,
          data: body
        });
      });
      response.on('error', (err) => reject(err));
    });

    request.on('error', (err) => reject(err));

    if (options.body) {
      request.write(options.body);
    }
    request.end();
  });
}

// --- AUTHENTICATION & AI HANDLERS ---
ipcMain.handle('get-openrouter-key', () => store ? store.get('openrouterApiKey') || '' : '');
ipcMain.handle('set-openrouter-key', (event, apiKey) => { if (store) store.set('openrouterApiKey', apiKey); return true; });
ipcMain.handle('set-api-key', (event, apiKey) => { if (store) store.set('openrouterApiKey', apiKey); return true; });
ipcMain.handle('is-authenticated', () => store ? !!store.get('openrouterApiKey') : false);
ipcMain.handle('logout', () => { if (store) store.delete('openrouterApiKey'); });

ipcMain.handle('call-openrouter-api', async (event, params) => {
  const apiKey = store ? store.get('openrouterApiKey') : '';
  if (!apiKey) throw new Error('OpenRouter API key not configured');

  const messages = params.messages || [
    { role: 'user', content: params.prompt || 'Provide a brief astrophysical target breakdown.' }
  ];

  const systemPrompt = params.systemPrompt || 'You are an expert NASA astrophysicist analyzing SPHEREx infrared survey data.';

  const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
    model: params.model || 'deepseek/deepseek-chat',
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    temperature: 0.7
  }, {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  });
  return response.data;
});

ipcMain.handle('exchange-code-for-key', async (event, { code, codeVerifier }) => {
  const response = await axios.post('https://openrouter.ai/api/v1/auth/keys', {
    code: code,
    code_verifier: codeVerifier,
    code_challenge_method: "S256"
  }, { headers: { 'Content-Type': 'application/json' } });
  if (store) store.set('openrouterApiKey', response.data.key);
  return response.data.key;
});

ipcMain.handle('open-external', (event, url) => { shell.openExternal(url); return true; });

// ------------------------------------------------------------------
// IPC HANDLERS FOR NASA IRSA API & CELESTIAL RESOLVER
// ------------------------------------------------------------------

// 1. SIA2 Web Service API (Simple Image Access v2)
ipcMain.handle('spherex:search-sia2', async (event, { collection = 'spherex_qr3', ra = 150.119, dec = 2.2058, radius = 0.1 }) => {
  try {
    const url = `https://irsa.ipac.caltech.edu/SIA?COLLECTION=${encodeURIComponent(collection)}&POS=CIRCLE+${ra}+${dec}+${radius}&FORMAT=ALL`;
    console.log(`[SIA2 API Request] ${url}`);
    const res = await fetchURL(url, {
      headers: { 'User-Agent': 'SPHEREx-Electron-Tool/1.0 (NASA/IPAC)' }
    });

    if (res.status >= 200 && res.status < 300) {
      const urlMatch = res.data.match(/(https:\/\/irsa\.ipac\.caltech\.edu\/ibe\/data\/spherex\/[^<"\s]+)/);
      const imageUrl = urlMatch ? urlMatch[1] : null;

      return { success: true, imageUrl, raw: res.data, url };
    } else {
      return { success: false, status: res.status, error: 'SIA2 request failed' };
    }
  } catch (err) {
    console.error('[SIA2 API Error]', err.message);
    return { success: false, error: err.message };
  }
});

// 2. Table Access Protocol (TAP) Metadata API
ipcMain.handle('spherex:query-tap', async (event, { adqlQuery }) => {
  try {
    const url = 'https://irsa.ipac.caltech.edu/TAP/sync';
    const params = new URLSearchParams({
      REQUEST: 'doQuery',
      LANG: 'ADQL',
      FORMAT: 'json',
      QUERY: adqlQuery
    });

    console.log(`[TAP API Request] ADQL: ${adqlQuery}`);
    const res = await fetchURL(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'SPHEREx-Electron-Tool/1.0'
      },
      body: params.toString()
    });

    if (res.status >= 200 && res.status < 300) {
      return { success: true, data: res.data };
    } else {
      return { success: false, status: res.status, error: 'TAP Query failed', raw: res.data };
    }
  } catch (err) {
    console.error('[TAP API Error]', err.message);
    return { success: false, error: err.message };
  }
});

// 3. Astronomical Object Name Resolver (via CDS Sesame / Simbad / NED)
ipcMain.handle('spherex:resolve-object', async (event, query) => {
  try {
    const trimmed = query.trim();
    const coordMatch = trimmed.match(/^([+-]?\d+\.?\d*)[,\s]+([+-]?\d+\.?\d*)$/);
    if (coordMatch) {
      return {
        success: true,
        name: `RA ${coordMatch[1]}, Dec ${coordMatch[2]}`,
        ra: parseFloat(coordMatch[1]),
        dec: parseFloat(coordMatch[2]),
        source: 'coordinates'
      };
    }

    const url = `https://cds.unistra.fr/cgi-bin/nph-sesame/-I?${encodeURIComponent(trimmed)}`;
    const res = await fetchURL(url);

    if (res.data) {
      const raMatch = res.data.match(/%J\s+([0-9\.]+)\s+([+-]?[0-9\.]+)/);
      if (raMatch) {
        return {
          success: true,
          name: trimmed,
          ra: parseFloat(raMatch[1]),
          dec: parseFloat(raMatch[2]),
          source: 'CDS Sesame'
        };
      }
    }

    const knownTargets = {
      'cosmos': { ra: 150.119, dec: 2.2058, name: 'COSMOS Deep Field' },
      'm82': { ra: 148.968, dec: 69.679, name: 'M82 Starburst Core' },
      'orion': { ra: 83.822, dec: -5.391, name: 'Orion Nebula (M42)' },
      'pleiades': { ra: 56.75, dec: 24.116, name: 'Pleiades Cluster' },
      'crab': { ra: 83.633, dec: 22.014, name: 'Crab Nebula (M1)' },
      'proxima': { ra: 217.429, dec: -62.679, name: 'Proxima Centauri' }
    };

    const key = trimmed.toLowerCase();
    for (const [k, v] of Object.entries(knownTargets)) {
      if (key.includes(k)) {
        return { success: true, name: v.name, ra: v.ra, dec: v.dec, source: 'Internal Catalog' };
      }
    }

    return { success: false, error: 'Could not resolve object name into celestial coordinates.' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 4. IBE Directory metadata reader
ipcMain.handle('spherex:fetch-ibe', async (event, { path = 'qr3' }) => {
  try {
    const url = `https://irsa.ipac.caltech.edu/ibe/data/spherex/${path}`;
    const res = await fetchURL(url);
    return { success: true, url, data: res.data };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

app.whenReady().then(() => {
  // Initialize store safely once Electron app is ready
  const StoreClass = typeof Store === 'function' ? Store : (Store.default || Store.Store || Store);
  store = new StoreClass({ cwd: app.getPath('userData') });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});