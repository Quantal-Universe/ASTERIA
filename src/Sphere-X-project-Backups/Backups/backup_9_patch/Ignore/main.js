const { app, BrowserWindow, ipcMain, net, safeStorage, shell } = require('electron');
const path = require('path');
const axios = require('axios');
const Store = require('electron-store');
const http = require('http');

let store;
let mainWindow;

<<<<<<< HEAD
<<<<<<< HEAD
function getSessionFilePath() {
  return path.join(app.getPath('userData'), 'session.bin');
}

async function decryptOpenRouterSession(encryptedSession) {
  let decrypted = await safeStorage.decryptStringAsync(encryptedSession);
  if (typeof decrypted === 'string') return decrypted;
  if (decrypted?.shouldReEncrypt) {
    decrypted = await safeStorage.decryptStringAsync(encryptedSession);
=======
=======
>>>>>>> 0ff6d0f6efd68d0dbcf51b799a644fff69f534b2
// Local auth callback server
const authServer = http.createServer((req, res) => {
  if (req.url.startsWith('/auth/callback')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (mainWindow) mainWindow.webContents.send('auth-callback', url.toString());
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Authentication successful.');
>>>>>>> 0ff6d0f6efd68d0dbcf51b799a644fff69f534b2
  }
  if (typeof decrypted?.result !== 'string') {
    throw new Error('The encrypted OpenRouter session did not contain a valid key.');
  }
  return decrypted.result;
}

<<<<<<< HEAD
async function assertSessionEncryptionAvailable() {
  if (!await safeStorage.isAsyncEncryptionAvailable()) {
    throw new Error('Secure session storage is unavailable on this system. OpenRouter login cannot be saved safely.');
  }
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error('A secure Linux keyring is unavailable. Configure GNOME Keyring or KDE Wallet before saving an OpenRouter session.');
  }
}

async function saveOpenRouterSession(apiKey) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('OpenRouter did not return a valid API key.');
  }
  apiKey = apiKey.trim();
  await assertSessionEncryptionAvailable();

  const sessionFile = getSessionFilePath();
  const temporaryFile = `${sessionFile}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryFile, await safeStorage.encryptStringAsync(apiKey), { mode: 0o600 });
    fs.chmodSync(temporaryFile, 0o600);
    const savedApiKey = await decryptOpenRouterSession(fs.readFileSync(temporaryFile));
    if (savedApiKey !== apiKey) {
      throw new Error('Saved OpenRouter session did not match the authorized key.');
    }
    if (process.platform === 'win32' && fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
    }
    fs.renameSync(temporaryFile, sessionFile);
    store.delete('openrouterApiKey');
  } catch (error) {
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    throw new Error(`Could not save the encrypted OpenRouter session: ${error.message}`);
  }
}

async function getOpenRouterSession() {
  const sessionFile = getSessionFilePath();
  if (fs.existsSync(sessionFile)) {
    await assertSessionEncryptionAvailable();
    try {
      return await decryptOpenRouterSession(fs.readFileSync(sessionFile));
    } catch (error) {
      throw new Error(`Could not read the encrypted OpenRouter session: ${error.message}`);
    }
  }

  const legacyApiKey = store.get('openrouterApiKey');
  if (legacyApiKey) {
    await saveOpenRouterSession(legacyApiKey);
    return legacyApiKey;
  }
  return '';
}

function clearOpenRouterSession() {
  const sessionFile = getSessionFilePath();
  if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
  store.delete('openrouterApiKey');
}

function getOpenRouterAuthHeaders(apiKey) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('OpenRouter session does not contain a usable API key.');
  }
  const headers = new axios.AxiosHeaders();
  headers.set('Authorization', `Bearer ${apiKey.trim()}`);
  headers.setContentType('application/json');
  return headers;
}

async function validateOpenRouterKey(apiKey) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('OpenRouter did not provide a usable API key.');
  }

  await axios.get('https://openrouter.ai/api/v1/auth/key', {
    headers: getOpenRouterAuthHeaders(apiKey)
  });
  return apiKey.trim();
}

<<<<<<< HEAD
let mainWindow;
let pendingAuthCallback;

const authServer = http.createServer((req, res) => {
  let callbackUrl;
  try {
    callbackUrl = new URL(req.url, 'http://localhost:3000');
  } catch (error) {
    res.writeHead(400);
    res.end('Invalid authentication callback.');
    return;
  }

  if (req.method !== 'GET' || callbackUrl.pathname !== '/auth/callback') {
    res.writeHead(404);
    res.end('Not found.');
    return;
  }
  if (!callbackUrl.searchParams.has('code') && !callbackUrl.searchParams.has('error')) {
    res.writeHead(400);
    res.end('Authentication callback did not include a code or error.');
    return;
  }

  const callbackUrlString = callbackUrl.toString();
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('auth-callback', callbackUrlString);
  } else {
    pendingAuthCallback = callbackUrlString;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><body><p>Authentication complete. You can return to the SPHEREx app.</p></body></html>');
});
authServer.on('error', (error) => {
  console.error('[Auth callback] Local callback server failed:', error.message);
});
authServer.listen(3000, 'localhost');

function flushPendingAuthCallback() {
  if (!pendingAuthCallback || !mainWindow) return;
  const callbackUrl = pendingAuthCallback;
  pendingAuthCallback = undefined;
  mainWindow.webContents.send('auth-callback', callbackUrl);
}

=======
>>>>>>> 0ff6d0f6efd68d0dbcf51b799a644fff69f534b2
=======
>>>>>>> 0ff6d0f6efd68d0dbcf51b799a644fff69f534b2
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: 'ASTREIA · NASA SPHEREx Mission Control Terminal',
    backgroundColor: '#05080f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.once('did-finish-load', flushPendingAuthCallback);
  mainWindow.loadFile('index.html');
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// Net fetch helper for Electron
async function fetchURL(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const request = net.request({
      url: targetUrl,
      method: options.method || 'GET',
      headers: options.headers || {}
    });

    let body = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => body += chunk.toString('utf8'));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        data: body
      }));
      response.on('error', (err) => reject(err));
    });

    request.on('error', (err) => reject(err));
    if (options.body) request.write(options.body);
    request.end();
  });
}

<<<<<<< HEAD
<<<<<<< HEAD
// --- AUTHENTICATION & AI HANDLERS ---
ipcMain.handle('get-openrouter-key', () => getOpenRouterSession());
ipcMain.handle('set-openrouter-key', async (event, apiKey) => { await saveOpenRouterSession(apiKey); return true; });
ipcMain.handle('is-authenticated', async () => {
  const apiKey = await getOpenRouterSession();
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return false;
  }
  return true;
});
ipcMain.handle('logout', () => { clearOpenRouterSession(); return true; });

ipcMain.handle('call-openrouter-api', async (event, { messages, model, systemPrompt, maxTokens }) => {
  const apiKey = await getOpenRouterSession();
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('OPENROUTER_AUTH_REQUIRED: No OpenRouter key is saved in this app session. Sign in again.');
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 12) {
    throw new Error('OpenRouter chat requires between 1 and 12 messages.');
  }
  const safeMessages = messages.map(message => {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
      throw new Error('OpenRouter chat contains an invalid message.');
    }
    return { role: message.role, content: message.content.slice(0, 4000) };
=======
// --- OPENROUTER & CONFIG HANDLERS ---
ipcMain.handle('get-openrouter-key', () => store ? store.get('openrouterApiKey') || '' : '');
ipcMain.handle('set-openrouter-key', (event, apiKey) => { if (store) store.set('openrouterApiKey', apiKey); return true; });
ipcMain.handle('is-authenticated', () => store ? !!store.get('openrouterApiKey') : false);
ipcMain.handle('logout', () => { if (store) store.delete('openrouterApiKey'); });

=======
// --- OPENROUTER & CONFIG HANDLERS ---
ipcMain.handle('get-openrouter-key', () => store ? store.get('openrouterApiKey') || '' : '');
ipcMain.handle('set-openrouter-key', (event, apiKey) => { if (store) store.set('openrouterApiKey', apiKey); return true; });
ipcMain.handle('is-authenticated', () => store ? !!store.get('openrouterApiKey') : false);
ipcMain.handle('logout', () => { if (store) store.delete('openrouterApiKey'); });

>>>>>>> 0ff6d0f6efd68d0dbcf51b799a644fff69f534b2
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
>>>>>>> 0ff6d0f6efd68d0dbcf51b799a644fff69f534b2
  });
  const responseTokenLimit = Number.isInteger(maxTokens) ? Math.min(Math.max(maxTokens, 1), 800) : 700;

  try {
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: model || 'deepseek/deepseek-chat',
      messages: [...(systemPrompt ? [{ role: 'system', content: systemPrompt.slice(0, 2000) }] : []), ...safeMessages],
      max_tokens: responseTokenLimit,
      temperature: 0.3
    }, {
      headers: getOpenRouterAuthHeaders(apiKey)
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const apiMessage = error.response.data?.error?.message;
      const reason = typeof apiMessage === 'string' ? apiMessage.slice(0, 300) : 'OpenRouter rejected the chat request credentials.';
      throw new Error(`OPENROUTER_CHAT_UNAUTHORIZED: ${reason} Your saved session was kept; use Reauthorize only if you want to create a new key.`);
    }
    throw error;
  }
});

<<<<<<< HEAD
<<<<<<< HEAD
ipcMain.handle('exchange-code-for-key', async (event, { code, codeVerifier }) => {
  const response = await axios.post('https://openrouter.ai/api/v1/auth/keys', {
    code: code,
    code_verifier: codeVerifier,
    code_challenge_method: "S256"
  }, { headers: { 'Content-Type': 'application/json' } });
  const apiKey = await validateOpenRouterKey(response.data?.key);
  await saveOpenRouterSession(apiKey);
  return true;
});

ipcMain.handle('open-external', async (event, url) => {
  await shell.openExternal(url);
  return true;
});

// ------------------------------------------------------------------
// IPC HANDLERS FOR NASA IRSA API & CELESTIAL RESOLVER
// ------------------------------------------------------------------

// 1. SIA2 Web Service API (Simple Image Access v2)
=======
// --- LIVE NASA IRSA API HANDLERS (TAP & SIA2) ---
>>>>>>> 0ff6d0f6efd68d0dbcf51b799a644fff69f534b2
=======
// --- LIVE NASA IRSA API HANDLERS (TAP & SIA2) ---
>>>>>>> 0ff6d0f6efd68d0dbcf51b799a644fff69f534b2
ipcMain.handle('spherex:search-sia2', async (event, { collection = 'spherex_qr3', ra = 150.119, dec = 2.2058, radius = 0.1 }) => {
  try {
    const url = `https://irsa.ipac.caltech.edu/SIA?COLLECTION=${encodeURIComponent(collection)}&POS=CIRCLE+${ra}+${dec}+${radius}&FORMAT=ALL`;
    const res = await fetchURL(url, {
      headers: { 'User-Agent': 'ASTREIA-SPHEREx-Terminal/1.0 (NASA/IPAC)' }
    });

    if (res.status >= 200 && res.status < 300) {
      const urlMatch = res.data.match(/(https:\/\/irsa\.ipac\.caltech\.edu\/ibe\/data\/spherex\/[^<"\s]+)/);
      return { success: true, imageUrl: urlMatch ? urlMatch[1] : null, raw: res.data, url };
    }
    return { success: false, status: res.status, error: 'SIA2 request failed' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('spherex:query-tap', async (event, { adqlQuery }) => {
  try {
    const url = 'https://irsa.ipac.caltech.edu/TAP/sync';
    const params = new URLSearchParams({
      REQUEST: 'doQuery',
      LANG: 'ADQL',
      FORMAT: 'json',
      QUERY: adqlQuery
    });

<<<<<<< HEAD
    const res = await fetchURL(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'ASTREIA-SPHEREx-Terminal/1.0'
      },
      body: params.toString()
    });

    if (res.status >= 200 && res.status < 300) {
      return { success: true, data: res.data };
    }
    return { success: false, status: res.status, error: 'TAP Query failed', raw: res.data };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

<<<<<<< HEAD
ipcMain.handle('spherex:query-gaia', async (event, { adqlQuery }) => {
  const tapUrl = 'https://gea.esac.esa.int/tap-server/tap';
  let jobUrl;
  try {
    const params = new URLSearchParams({
      REQUEST: 'doQuery',
      LANG: 'ADQL',
      FORMAT: 'json',
      PHASE: 'RUN',
      QUERY: adqlQuery
    });

    const submission = await axios.post(`${tapUrl}/async`, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'SPHEREx-Electron-Tool/1.0'
      },
      maxRedirects: 0,
      timeout: 20000,
      responseType: 'text',
      transformResponse: [data => data],
      validateStatus: () => true
    });

    if (![201, 302, 303].includes(submission.status)) {
      const detail = String(submission.data || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
      throw new Error(`Gaia TAP job submission failed (HTTP ${submission.status})${detail ? `: ${detail}` : ''}`);
    }

    const location = submission.headers.location;
    if (!location) throw new Error('Gaia TAP did not return the asynchronous job URL.');
    jobUrl = new URL(location, tapUrl).toString();
    const parsedJobUrl = new URL(jobUrl);
    if (parsedJobUrl.origin !== 'https://gea.esac.esa.int'
      || !parsedJobUrl.pathname.startsWith('/tap-server/tap/async/')) {
      throw new Error('Gaia TAP returned an invalid asynchronous job URL.');
    }

    let completed = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const phaseResponse = await axios.get(`${jobUrl}/phase`, {
        timeout: 15000,
        responseType: 'text',
        transformResponse: [data => data],
        validateStatus: () => true
      });
      if (phaseResponse.status < 200 || phaseResponse.status >= 300) {
        throw new Error(`Gaia TAP job status request failed (HTTP ${phaseResponse.status}).`);
      }

      const phase = String(phaseResponse.data).trim().toUpperCase();
      if (phase === 'COMPLETED') {
        completed = true;
        break;
      }
      if (phase === 'ERROR' || phase === 'ABORTED') {
        const errorResponse = await axios.get(`${jobUrl}/error`, {
          timeout: 15000,
          responseType: 'text',
          transformResponse: [data => data],
          validateStatus: () => true
        });
        const detail = String(errorResponse.data || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
        throw new Error(`Gaia TAP job ${phase.toLowerCase()}${detail ? `: ${detail}` : ''}`);
      }
      if (!['PENDING', 'QUEUED', 'EXECUTING'].includes(phase)) {
        throw new Error(`Gaia TAP returned an unexpected job state: ${phase || 'empty response'}.`);
      }
    }

    if (!completed) throw new Error('Gaia TAP query timed out while waiting for the asynchronous job.');

    const result = await axios.get(`${jobUrl}/results/result`, {
      timeout: 20000,
      responseType: 'text',
      transformResponse: [data => data],
      validateStatus: () => true
    });
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Gaia TAP result download failed (HTTP ${result.status}).`);
    }
    return { success: true, data: result.data };
  } catch (err) {
    console.error('[Gaia TAP Error]', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('spherex:query-simbad-named-stars', async (event, { adqlQuery }) => {
  try {
    const url = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';
    const params = new URLSearchParams({
      REQUEST: 'doQuery',
      LANG: 'ADQL',
      FORMAT: 'csv',
      QUERY: adqlQuery
    });

=======
>>>>>>> 0ff6d0f6efd68d0dbcf51b799a644fff69f534b2
    const res = await fetchURL(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'ASTREIA-SPHEREx-Terminal/1.0'
      },
      body: params.toString()
    });

    if (res.status >= 200 && res.status < 300) {
      return { success: true, data: res.data };
    }
<<<<<<< HEAD
    return { success: false, status: res.status, error: 'SIMBAD TAP request failed', raw: res.data };
  } catch (err) {
    console.error('[SIMBAD TAP Error]', err.message);
=======
    return { success: false, status: res.status, error: 'TAP Query failed', raw: res.data };
  } catch (err) {
>>>>>>> 0ff6d0f6efd68d0dbcf51b799a644fff69f534b2
    return { success: false, error: err.message };
  }
});

<<<<<<< HEAD
// 3. Astronomical Object Name Resolver (via CDS Sesame / Simbad / NED)
=======
>>>>>>> 0ff6d0f6efd68d0dbcf51b799a644fff69f534b2
=======
>>>>>>> 0ff6d0f6efd68d0dbcf51b799a644fff69f534b2
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

    // Fallback known coordinates dictionary
    const knownTargets = {
      'cosmos': { ra: 150.119, dec: 2.2058, name: 'COSMOS Deep Field' },
      'm82': { ra: 148.968, dec: 69.679, name: 'M82 Starburst Core' },
      'orion': { ra: 83.822, dec: -5.391, name: 'Orion Nebula (M42)' },
      'proxima': { ra: 217.429, dec: -62.679, name: 'Proxima Centauri' }
    };

    const key = trimmed.toLowerCase();
    for (const [k, v] of Object.entries(knownTargets)) {
      if (key.includes(k)) {
        return { success: true, name: v.name, ra: v.ra, dec: v.dec, source: 'Catalog' };
      }
    }

    return { success: true, name: trimmed, ra: 150.119, dec: 2.2058, source: 'Default' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

app.whenReady().then(() => {
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