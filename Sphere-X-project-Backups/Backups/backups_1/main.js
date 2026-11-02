const { app, BrowserWindow, ipcMain, net } = require('electron');
const path = require('path');

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

  // Open external links safely if needed
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
      // Regex to extract the first access_url from the VOTable table data
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
    // Direct coordinate check (e.g. "150.119, 2.2058" or "05 35 17 -05 23 28")
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

    // CDS Sesame Resolver
    const url = `https://cds.unistra.fr/cgi-bin/nph-sesame/-I?${encodeURIComponent(trimmed)}`;
    const res = await fetchURL(url);

    if (res.data) {
      // Parse RA / Dec from Sesame response
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

    // Fallback dictionary for popular SPHEREx targets
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
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
