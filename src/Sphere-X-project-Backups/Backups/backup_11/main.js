const { app, BrowserWindow, ipcMain, net, safeStorage, shell } = require('electron');
const path = require('path');
const axios = require('axios');
const Store = require('electron-store');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const http = require('http');
const { SPHEREX_RELEASES, getReleaseFallback } = require('./spherex-data');

const activeGaiaTapRequests = new Map();

function getRateLimitRetryDelay(response, attempt) {
  const retryAfter = response?.headers?.['retry-after'];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(30000, Math.max(1000, seconds * 1000));
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.min(30000, Math.max(1000, retryAt - Date.now()));
  }
  return Math.min(10000, 1000 * (2 ** attempt));
}

async function abortGaiaTapJob(jobUrl) {
  if (!jobUrl) return;
  try {
    const response = await axios.post(`${jobUrl}/phase`, 'PHASE=ABORT', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 5000,
      validateStatus: () => true
    });
    if (response.status < 200 || response.status >= 300) {
      console.warn(`[Gaia TAP] Could not abort superseded job (HTTP ${response.status}).`);
    }
  } catch (error) {
    console.warn('[Gaia TAP] Could not abort superseded job.', error.message);
  }
}

// Fix: check if it's the class or a module wrapper and provide fallback
const StoreClass = typeof Store === 'function' ? Store : (Store.default || Store.Store || Store);
let store;
try {
  const storeCwd = (app && typeof app.getPath === 'function' && app.isReady())
    ? app.getPath('userData')
    : path.join(os.homedir(), '.asteria-store');
  store = new StoreClass({ cwd: storeCwd });
} catch (error) {
  console.warn('[Store] Falling back to memory store:', error.message);
  store = {
    _data: {},
    get(k) { return this._data[k]; },
    set(k, v) { this._data[k] = v; },
    delete(k) { delete this._data[k]; }
  };
}

function getSessionFilePath() {
  return path.join(app.getPath('userData'), 'session.bin');
}

async function decryptOpenRouterSession(encryptedSession) {
  let decrypted = await safeStorage.decryptStringAsync(encryptedSession);
  if (typeof decrypted === 'string') return decrypted;
  if (decrypted?.shouldReEncrypt) {
    decrypted = await safeStorage.decryptStringAsync(encryptedSession);
  }
  if (typeof decrypted?.result !== 'string') {
    throw new Error('The encrypted OpenRouter session did not contain a valid key.');
  }
  return decrypted.result;
}

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

  mainWindow.webContents.once('did-finish-load', flushPendingAuthCallback);
  mainWindow.loadFile('index.html');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    return { action: 'deny' };
  });
}

// Simple HTTP/HTTPS fetch helper using Node/Electron net API
async function fetchURL(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeout || 8000;
    let timer = null;
    let finished = false;

    const request = net.request({
      url: targetUrl,
      method: options.method || 'GET',
      headers: options.headers || {}
    });

    const cleanup = () => {
      finished = true;
      if (timer) clearTimeout(timer);
    };

    timer = setTimeout(() => {
      if (!finished) {
        cleanup();
        try { request.abort(); } catch (e) {}
        reject(new Error(`Request timed out after ${timeoutMs}ms: ${targetUrl}`));
      }
    }, timeoutMs);

    let body = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      response.on('end', () => {
        cleanup();
        resolve({
          status: response.statusCode,
          headers: response.headers,
          data: body
        });
      });
      response.on('error', (err) => {
        cleanup();
        reject(err);
      });
    });

    request.on('error', (err) => {
      cleanup();
      reject(err);
    });

    if (options.body) {
      request.write(options.body);
    }
    request.end();
  });
}

async function fetchURLWithRateLimitRetry(targetUrl, options) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchURL(targetUrl, options);
      if (![429, 502, 503, 504].includes(response.status) || attempt === 2) return response;
      await new Promise(resolve => setTimeout(resolve, getRateLimitRetryDelay(response, attempt)));
    } catch (error) {
      const retryableNetworkError = /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_RESET|ERR_TIMED_OUT|EAI_AGAIN|ECONNRESET|ETIMEDOUT/.test(
        `${error.code || ''} ${error.message || ''}`
      );
      if ((!retryableNetworkError && ![502, 503, 504].includes(error.response?.status)) || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw new Error('Request retry loop ended unexpectedly.');
}

let irsaTapQueue = Promise.resolve();
let irsaGatewayCooldownUntil = 0;
let irsaGatewayCooldownReason = '';

function recordIrsaGatewayFailure(status, route) {
  if (![502, 503, 504].includes(Number(status))) return;
  irsaGatewayCooldownUntil = Date.now() + 45000;
  irsaGatewayCooldownReason = `HTTP ${status} from ${route}`;
}

function clearIrsaGatewayCooldown() {
  irsaGatewayCooldownUntil = 0;
  irsaGatewayCooldownReason = '';
}

function assertIrsaGatewayAvailable() {
  if (Date.now() >= irsaGatewayCooldownUntil) return;
  const seconds = Math.ceil((irsaGatewayCooldownUntil - Date.now()) / 1000);
  const error = new Error(`IRSA is temporarily returning gateway errors (${irsaGatewayCooldownReason}); paused archive requests for ${seconds}s.`);
  error.irsaGatewayFailure = true;
  throw error;
}

function queueIrsaTap(task) {
  const pending = irsaTapQueue.then(task, task);
  irsaTapQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

async function queryIrsaTapAsync(adqlQuery, { format = 'json', label = 'IRSA TAP' } = {}) {
  assertIrsaGatewayAvailable();
  const tapBase = 'https://irsa.ipac.caltech.edu/TAP';
  const params = new URLSearchParams({
    REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: format, PHASE: 'RUN', QUERY: adqlQuery
  });
  const requestOptions = {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'SPHEREx-Electron-Tool/1.0'
    },
    maxRedirects: 0,
    timeout: 30000,
    responseType: 'text',
    transformResponse: [data => data],
    validateStatus: () => true
  };
  const submission = await axios.post(`${tapBase}/async`, params.toString(), requestOptions);
  const location = submission.headers?.location;
  if (![200, 201, 202, 302, 303].includes(submission.status) || !location) {
    recordIrsaGatewayFailure(submission.status, 'TAP async submission');
    const detail = String(submission.data || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    const error = new Error(`${label} async job submission failed (HTTP ${submission.status})${detail ? `: ${detail}` : ''}`);
    error.irsaGatewayFailure = [502, 503, 504].includes(submission.status);
    throw error;
  }
  const jobUrl = new URL(location, `${tapBase}/`).toString();
  const parsedJobUrl = new URL(jobUrl);
  if (parsedJobUrl.origin !== 'https://irsa.ipac.caltech.edu'
      || !parsedJobUrl.pathname.startsWith('/TAP/async/')) {
    throw new Error(`${label} returned an invalid async job URL.`);
  }

  let completed = false;
  let terminalError = '';
  try {
    let consecutiveGatewayErrors = 0;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const phaseResponse = await axios.get(`${jobUrl}/phase`, requestOptions);
      if ([502, 503, 504].includes(phaseResponse.status)) {
        recordIrsaGatewayFailure(phaseResponse.status, 'TAP async status');
        consecutiveGatewayErrors += 1;
        if (consecutiveGatewayErrors >= 6) {
          const error = new Error(`${label} job status endpoint repeatedly returned HTTP ${phaseResponse.status}.`);
          error.irsaGatewayFailure = true;
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * consecutiveGatewayErrors));
        continue;
      }
      if (phaseResponse.status === 429) {
        await new Promise(resolve => setTimeout(resolve, getRateLimitRetryDelay(phaseResponse, Math.min(attempt, 4))));
        continue;
      }
      if (phaseResponse.status < 200 || phaseResponse.status >= 300) {
        throw new Error(`${label} job status failed (HTTP ${phaseResponse.status}).`);
      }
      consecutiveGatewayErrors = 0;
      const phase = String(phaseResponse.data || '').trim().toUpperCase();
      if (phase === 'COMPLETED') {
        completed = true;
        break;
      }
      if (['ERROR', 'ABORTED', 'ABORT'].includes(phase)) {
        const detailResponse = await axios.get(`${jobUrl}/error`, requestOptions);
        const detail = String(detailResponse.data || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
        throw new Error(`${label} job ${phase.toLowerCase()}${detail ? `: ${detail}` : ''}`);
      }
      if (!['PENDING', 'QUEUED', 'EXECUTING'].includes(phase)) {
        throw new Error(`${label} returned an unexpected job phase: ${phase || 'empty response'}.`);
      }
    }
    if (!completed) throw new Error(`${label} async job exceeded the 180-second wait limit.`);
    let result;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      result = await axios.get(`${jobUrl}/results/result`, requestOptions);
      if (![502, 503, 504].includes(result.status) || attempt === 2) break;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    if (result.status < 200 || result.status >= 300) {
      recordIrsaGatewayFailure(result.status, 'TAP async result');
      const detail = String(result.data || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      const error = new Error(`${label} result download failed (HTTP ${result.status})${detail ? `: ${detail}` : ''}`);
      error.irsaGatewayFailure = [502, 503, 504].includes(result.status);
      throw error;
    }
    clearIrsaGatewayCooldown();
    if (format.toLowerCase() === 'json' && typeof result.data === 'string') {
      try { return JSON.parse(result.data); } catch (error) {
        throw new Error(`${label} result was not valid JSON: ${error.message}`);
      }
    }
    return result.data;
  } catch (error) {
    terminalError = error.message;
    throw error;
  } finally {
    if (!completed) {
      try {
        await axios.post(`${jobUrl}/phase`, 'PHASE=ABORT', {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 5000,
          validateStatus: () => true
        });
      } catch (abortError) {
        console.warn(`[${label}] Could not stop unfinished TAP job${terminalError ? ` after ${terminalError}` : ''}: ${abortError.message}`);
      }
    }
  }
}

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
  });
  const responseTokenLimit = Number.isInteger(maxTokens) ? Math.min(Math.max(maxTokens, 1), 800) : 700;

  try {
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: model || 'deepseek/deepseek-chat',
      messages: [...(systemPrompt ? [{ role: 'system', content: systemPrompt.slice(0, 10000) }] : []), ...safeMessages],
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
ipcMain.handle('spherex:search-sia2', async (event, { collection = 'spherex_dr1', ra = 150.119, dec = 2.2058, radius = 0.1 }) => {
  try {
    const url = `https://irsa.ipac.caltech.edu/SIA?COLLECTION=${encodeURIComponent(collection)}&POS=CIRCLE+${ra}+${dec}+${radius}&FORMAT=ALL`;
    console.log(`[SIA2 API Request] ${url}`);
    const res = await fetchURLWithRateLimitRetry(url, {
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
    console.log(`[TAP API Request] ADQL: ${adqlQuery}`);
    const data = await queueIrsaTap(() => queryIrsaTapAsync(adqlQuery, { label: 'IRSA TAP' }));
    return { success: true, data };
  } catch (err) {
    console.error('[TAP API Error]', err.message);
    return { success: false, error: err.message };
  }
});

function parseFitsCardValue(rawValue) {
  const raw = rawValue.trim();
  if (raw.startsWith("'")) {
    const end = raw.lastIndexOf("'");
    return raw.slice(1, end < 1 ? undefined : end).replace(/''/g, "'").trim();
  }
  const value = raw.split('/')[0].trim();
  if (value === 'T') return true;
  if (value === 'F') return false;
  const number = Number(value.replace(/[dD]/g, 'E'));
  return Number.isNaN(number) ? value : number;
}

function parseFitsHeaderAt(buffer, start = 0) {
  const header = {};
  let end = -1;
  for (let offset = start; offset + 80 <= buffer.length; offset += 80) {
    const card = buffer.toString('ascii', offset, offset + 80);
    if (card.startsWith('END ')) {
      end = offset + 80;
      break;
    }
    if (card.startsWith('HIERARCH ')) {
      const equals = card.indexOf('=');
      if (equals > 0) header[card.slice(9, equals).trim()] = parseFitsCardValue(card.slice(equals + 1));
    } else if (card[8] === '=' && card[9] === ' ') {
      header[card.slice(0, 8).trim()] = parseFitsCardValue(card.slice(10));
    }
  }
  if (end < 0) throw new Error('FITS header did not end within the requested byte range.');

  const headerBytes = Math.ceil((end - start) / 2880) * 2880;
  const axisCount = Number(header.NAXIS || 0);
  const pixelCount = Array.from({ length: axisCount }, (_, index) => Number(header[`NAXIS${index + 1}`] || 0))
    .reduce((product, dimension) => product * dimension, axisCount ? 1 : 0);
  const dataBytes = pixelCount * Math.abs(Number(header.BITPIX || 8)) / 8 + Number(header.PCOUNT || 0);
  const dataOffset = start + headerBytes;
  return {
    header,
    dataOffset,
    dataBytes,
    nextOffset: dataOffset + Math.ceil(dataBytes / 2880) * 2880
  };
}

function fitsNumber(header, key) {
  const value = Number(header[key]);
  if (!Number.isFinite(value)) throw new Error(`FITS header is missing ${key}.`);
  return value;
}

async function fetchFitsRange(url, ranges) {
  const parsedUrl = new URL(url);
  const isSpherexS3 = parsedUrl.hostname === 'nasa-irsa-spherex.s3.us-east-1.amazonaws.com';
  const requestRange = async ([start, end]) => axios.get(url, {
    headers: {
      Accept: 'application/fits, application/octet-stream',
      'Accept-Encoding': 'identity',
      Range: `bytes=${start}-${end}`
    },
    responseType: 'arraybuffer',
    timeout: 45000,
    maxContentLength: 8 * 1024 * 1024,
    validateStatus: status => status === 206
  });
  if (isSpherexS3 && ranges.length > 1) {
    // S3 object reads are most portable as one byte range per request. Build a
    // local multipart response so the existing FITS range parser can consume it.
    const responses = new Array(ranges.length);
    let nextRangeIndex = 0;
    const rangeWorker = async () => {
      while (nextRangeIndex < ranges.length) {
        const index = nextRangeIndex;
        nextRangeIndex += 1;
        responses[index] = await requestRange(ranges[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, ranges.length) }, rangeWorker));
    const boundary = `ASTERIA_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const parts = [];
    responses.forEach((response, index) => {
      const [start, end] = ranges[index];
      const total = response.headers['content-range']?.match(/\/(\d+)$/)?.[1] || '*';
      parts.push(Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes ${start}-${end}/${total}\r\n\r\n`));
      parts.push(Buffer.from(response.data));
      parts.push(Buffer.from('\r\n'));
    });
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return { data: Buffer.concat(parts), contentType: `multipart/byteranges; boundary=${boundary}` };
  }
  const rangeHeader = ranges.map(([start, end]) => `${start}-${end}`).join(',');
  const response = await axios.get(url, {
    headers: {
      Accept: 'application/fits, application/octet-stream',
      'Accept-Encoding': 'identity',
      Range: `bytes=${rangeHeader}`
    },
    responseType: 'arraybuffer',
    timeout: 45000,
    maxContentLength: 8 * 1024 * 1024,
    validateStatus: status => status === 206
  });
  return { data: Buffer.from(response.data), contentType: response.headers['content-type'] || '' };
}

function isRetryableSpectrumError(error) {
  const retryableCodes = new Set(['ECONNABORTED', 'ECONNRESET', 'EAI_AGAIN', 'ETIMEDOUT']);
  const status = error.response?.status;
  return retryableCodes.has(error.code) || status === 429 || status >= 500;
}

function parseMultipartRanges(data, contentType, requestedRanges) {
  if (!contentType.toLowerCase().includes('multipart/byteranges')) {
    if (requestedRanges.length !== 1 || data.length !== requestedRanges[0][1] - requestedRanges[0][0] + 1) {
      throw new Error('IRSA returned an unexpected response for a FITS byte-range request.');
    }
    return new Map([[requestedRanges[0][0], data]]);
  }

  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (!boundaryMatch) throw new Error('IRSA returned a multipart range response without a boundary.');
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const separator = Buffer.from('\r\n\r\n');
  const ranges = new Map();
  let marker = data.indexOf(boundary);
  while (marker >= 0) {
    const headerStart = marker + boundary.length + 2;
    const headerEnd = data.indexOf(separator, headerStart);
    if (headerEnd < 0) break;
    const headers = data.toString('ascii', headerStart, headerEnd);
    const match = headers.match(/content-range:\s*bytes\s+(\d+)-(\d+)\/\d+/i);
    if (match) {
      const start = Number(match[1]);
      const byteLength = Number(match[2]) - start + 1;
      const bodyStart = headerEnd + separator.length;
      const body = data.subarray(bodyStart, bodyStart + byteLength);
      if (body.length !== byteLength) throw new Error('IRSA returned an incomplete FITS byte range.');
      ranges.set(start, body);
      marker = data.indexOf(boundary, bodyStart + byteLength);
    } else {
      break;
    }
  }

  if (requestedRanges.some(([start]) => !ranges.has(start))) {
    throw new Error('IRSA omitted one or more requested FITS byte ranges.');
  }
  return ranges;
}

const spherexFitsLayoutCache = new Map();

async function getSpectrumHduLayout(product, url, image, {
  requireFlags = true, requireVariance = true, requireWave = false
} = {}) {
  // Header offsets belong to a specific FITS file; don't reuse one exposure's
  // layout for another exposure just because the detector/release match.
  const cacheKey = product.uri ? `${product.uri}|flags:${requireFlags}|variance:${requireVariance}|wave:${requireWave}` : null;
  const loadLayout = async () => {
    const targetWidth = Number(image.header.NAXIS1);
    const targetHeight = Number(image.header.NAXIS2);
    const found = {};
    const extensions = [];
    let offset = image.nextOffset;
    // Locate named HDUs instead of assuming FLAGS is immediately after IMAGE;
    // DR1/QR releases can place other image/table extensions in between.
    for (let count = 0; count < 12 && offset < Number(product.contentlength); count += 1) {
      const range = await fetchFitsRange(url, [[offset, Math.min(offset + 65535, Number(product.contentlength) - 1)]]);
      const hdu = parseFitsHeaderAt(range.data);
      const name = String(hdu.header.EXTNAME || '').trim().toUpperCase();
      if (name) extensions.push(name);
      const sameShape = Number(hdu.header.NAXIS) === 2
        && Number(hdu.header.NAXIS1) === targetWidth
        && Number(hdu.header.NAXIS2) === targetHeight;
      if (name === 'FLAGS' && sameShape && Number(hdu.header.BITPIX) > 0
          && [8, 16, 32, 64].includes(Number(hdu.header.BITPIX))) {
        found.flags = { header: hdu.header, dataOffset: offset + hdu.dataOffset };
      }
      if (name === 'VARIANCE' && sameShape && Math.abs(Number(hdu.header.BITPIX)) === 32) {
        found.variance = { header: hdu.header, dataOffset: offset + hdu.dataOffset };
      }
      if (name === 'WCS-WAVE') {
        found.wavelength = {
          header: hdu.header,
          fileOffset: offset,
          byteLength: hdu.dataOffset + hdu.dataBytes
        };
      }
      if ((found.flags || !requireFlags)
          && (found.variance || !requireVariance)
          && (found.wavelength || !requireWave)) break;
      if (!Number.isSafeInteger(hdu.nextOffset) || hdu.nextOffset <= 0) break;
      offset += hdu.nextOffset;
    }
    if (!found.flags && requireFlags) {
      throw new Error(`SPHEREx FITS has no compatible FLAGS image (extensions found: ${extensions.join(', ') || 'none'}).`);
    }
    if (!found.variance && requireVariance) {
      throw new Error(`SPHEREx FITS has no compatible VARIANCE image (extensions found: ${extensions.join(', ') || 'none'}).`);
    }
    if (!found.wavelength && requireWave) {
      throw new Error(`SPHEREx FITS has no WCS-WAVE table (extensions found: ${extensions.join(', ') || 'none'}).`);
    }
    return { flagsHdu: found.flags, varianceHdu: found.variance, wavelengthHdu: found.wavelength };
  };

  let layoutPromise = cacheKey ? spherexFitsLayoutCache.get(cacheKey) : null;
  if (!layoutPromise) {
    layoutPromise = loadLayout();
    if (cacheKey) {
      spherexFitsLayoutCache.set(cacheKey, layoutPromise);
      while (spherexFitsLayoutCache.size > 64) {
        spherexFitsLayoutCache.delete(spherexFitsLayoutCache.keys().next().value);
      }
    }
  }
  try {
    const layout = await layoutPromise;
    return layout;
  } catch (error) {
    if (cacheKey && spherexFitsLayoutCache.get(cacheKey) === layoutPromise) {
      spherexFitsLayoutCache.delete(cacheKey);
    }
    throw error;
  }
}

function evaluateSipPolynomial(coefficients, x, y) {
  let value = 0;
  for (const [i, j, coefficient] of coefficients) value += coefficient * x ** i * y ** j;
  return value;
}

function evaluateSipDerivative(coefficients, x, y, axis) {
  let value = 0;
  for (const [i, j, coefficient] of coefficients) {
    const exponent = axis === 0 ? i : j;
    if (!exponent) continue;
    value += coefficient * exponent * x ** (i - (axis === 0 ? 1 : 0)) * y ** (j - (axis === 1 ? 1 : 0));
  }
  return value;
}

function sipCoefficients(header, prefix) {
  const coefficients = [];
  for (const [key, value] of Object.entries(header)) {
    const match = key.match(new RegExp(`^${prefix}_(\\d+)_(\\d+)$`));
    if (match && Number.isFinite(value)) coefficients.push([Number(match[1]), Number(match[2]), value]);
  }
  return coefficients;
}

function skyToFitsPixel(header, ra, dec) {
  if (!String(header.CTYPE1 || '').includes('TAN') || !String(header.CTYPE2 || '').includes('TAN')) {
    throw new Error('SPHEREx image uses an unsupported spatial WCS projection.');
  }
  const ra0 = fitsNumber(header, 'CRVAL1') * Math.PI / 180;
  const dec0 = fitsNumber(header, 'CRVAL2') * Math.PI / 180;
  const targetRa = ra * Math.PI / 180;
  const targetDec = dec * Math.PI / 180;
  const deltaRa = ((targetRa - ra0 + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const denominator = Math.sin(dec0) * Math.sin(targetDec)
    + Math.cos(dec0) * Math.cos(targetDec) * Math.cos(deltaRa);
  if (denominator <= 0) throw new Error('Selected coordinate is outside the detector WCS projection.');

  const planeX = Math.cos(targetDec) * Math.sin(deltaRa) / denominator * 180 / Math.PI;
  const planeY = (
    Math.cos(dec0) * Math.sin(targetDec)
    - Math.sin(dec0) * Math.cos(targetDec) * Math.cos(deltaRa)
  ) / denominator * 180 / Math.PI;
  const cdelt1 = Number(header.CDELT1 ?? 1);
  const cdelt2 = Number(header.CDELT2 ?? 1);
  const cd = [
    [header.CD1_1 ?? cdelt1 * Number(header.PC1_1 ?? 1), header.CD1_2 ?? cdelt1 * Number(header.PC1_2 ?? 0)],
    [header.CD2_1 ?? cdelt2 * Number(header.PC2_1 ?? 0), header.CD2_2 ?? cdelt2 * Number(header.PC2_2 ?? 1)]
  ];
  const determinant = cd[0][0] * cd[1][1] - cd[0][1] * cd[1][0];
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-20) {
    throw new Error('SPHEREx image has a singular spatial WCS matrix.');
  }

  const undistortedX = (cd[1][1] * planeX - cd[0][1] * planeY) / determinant;
  const undistortedY = (-cd[1][0] * planeX + cd[0][0] * planeY) / determinant;
  const sipA = sipCoefficients(header, 'A');
  const sipB = sipCoefficients(header, 'B');
  let x = undistortedX;
  let y = undistortedY;
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const residualX = x + evaluateSipPolynomial(sipA, x, y) - undistortedX;
    const residualY = y + evaluateSipPolynomial(sipB, x, y) - undistortedY;
    const j11 = 1 + evaluateSipDerivative(sipA, x, y, 0);
    const j12 = evaluateSipDerivative(sipA, x, y, 1);
    const j21 = evaluateSipDerivative(sipB, x, y, 0);
    const j22 = 1 + evaluateSipDerivative(sipB, x, y, 1);
    const jacobian = j11 * j22 - j12 * j21;
    if (!Number.isFinite(jacobian) || Math.abs(jacobian) < 1e-12) {
      throw new Error('Could not invert the detector SIP distortion at this coordinate.');
    }
    const stepX = (residualX * j22 - residualY * j12) / jacobian;
    const stepY = (residualY * j11 - residualX * j21) / jacobian;
    x -= stepX;
    y -= stepY;
    if (Math.max(Math.abs(stepX), Math.abs(stepY)) < 1e-7) break;
    if (iteration === 19) throw new Error('Detector SIP WCS did not converge.');
  }

  return {
    x: fitsNumber(header, 'CRPIX1') + x,
    y: fitsNumber(header, 'CRPIX2') + y
  };
}

function readWavelengthLookup(tail) {
  const hdu = parseFitsHeaderAt(tail);
  if (hdu.header.EXTNAME !== 'WCS-WAVE') throw new Error('FITS file did not end with its WCS-WAVE table.');
  const fields = [];
  for (let index = 1; index <= Number(hdu.header.TFIELDS || 0); index += 1) {
    const name = String(hdu.header[`TTYPE${index}`] || '').trim();
    const format = String(hdu.header[`TFORM${index}`] || '').trim();
    const match = format.match(/^(\d+)([JE])$/);
    if (!name || !match) throw new Error('SPHEREx wavelength lookup has an unsupported table column.');
    const repeat = Number(match[1]);
    const type = match[2];
    fields.push({ name, repeat, type, offset: fields.reduce((size, field) => size + field.repeat * 4, 0) });
  }
  const column = name => {
    const field = fields.find(item => item.name === name);
    if (!field) throw new Error(`SPHEREx wavelength lookup is missing its ${name} column.`);
    return field;
  };

  const data = tail.subarray(hdu.dataOffset, hdu.dataOffset + hdu.dataBytes);
  const readArray = (field, count) => Array.from({ length: count }, (_, index) => (
    field.type === 'J'
      ? data.readInt32BE(field.offset + index * 4)
      : data.readFloatBE(field.offset + index * 4)
  ));
  const xField = column('X');
  const yField = column('Y');
  const valuesField = column('VALUES');
  const x = readArray(xField, xField.repeat);
  const y = readArray(yField, yField.repeat);
  const values = readArray(valuesField, valuesField.repeat);
  const dimensions = String(hdu.header.TDIM3 || '').match(/\d+/g)?.map(Number);
  if (dimensions?.length !== 3 || dimensions[0] !== 2 || dimensions[1] !== x.length || dimensions[2] !== y.length
      || values.length !== 2 * x.length * y.length) {
    throw new Error('SPHEREx wavelength lookup has an unexpected grid shape.');
  }
  return { x, y, values };
}

function interpolateWavelength(lookup, pixelX, pixelY) {
  const bracket = (axis, coordinate) => {
    if (coordinate < axis[0] || coordinate > axis[axis.length - 1]) {
      throw new Error('Target pixel is outside the wavelength calibration grid.');
    }
    for (let index = 0; index < axis.length - 1; index += 1) {
      if (coordinate <= axis[index + 1]) {
        return [index, (coordinate - axis[index]) / (axis[index + 1] - axis[index])];
      }
    }
    return [axis.length - 2, 1];
  };
  const [x0, fx] = bracket(lookup.x, pixelX);
  const [y0, fy] = bracket(lookup.y, pixelY);
  const valueAt = (x, y, component) => lookup.values[(y * lookup.x.length + x) * 2 + component];
  const interpolate = component => {
    const lower = valueAt(x0, y0, component) * (1 - fx) + valueAt(x0 + 1, y0, component) * fx;
    const upper = valueAt(x0, y0 + 1, component) * (1 - fx) + valueAt(x0 + 1, y0 + 1, component) * fx;
    return lower * (1 - fy) + upper * fy;
  };
  return { wavelengthUm: interpolate(0), bandwidthUm: interpolate(1) };
}

function positionAtMjd(ra, dec, motion, mjd) {
  if (!motion) return { ra, dec };
  const timestamp = (mjd - 40587) * 86400000;
  const julianYear = 2000 + (timestamp - Date.UTC(2000, 0, 1, 12)) / (365.25 * 86400000);
  const years = julianYear - motion.refEpoch;
  const cosineDeclination = Math.cos(motion.dec * Math.PI / 180);
  const raOffset = cosineDeclination === 0 ? 0 : motion.pmra * years / (3600000 * cosineDeclination);
  const decOffset = motion.pmdec * years / 3600000;
  return {
    ra: (motion.ra + raOffset + 360) % 360,
    dec: Math.max(-90, Math.min(90, motion.dec + decOffset))
  };
}

async function extractSpherexPixelSpectrum(product, ra, dec, motion) {
  const fileSize = Number(product.contentlength);
  if (!Number.isSafeInteger(fileSize) || fileSize < 10000 || fileSize > 100 * 1024 * 1024) {
    throw new Error('SPHEREx archive product has an invalid or unsupported file size.');
  }
  const url = new URL(product.uri, 'https://irsa.ipac.caltech.edu/');
  if (url.hostname !== 'irsa.ipac.caltech.edu' || !url.pathname.startsWith('/ibe/data/spherex/')) {
    throw new Error('SPHEREx archive returned an unexpected product URL.');
  }

  const firstRange = await fetchFitsRange(url.toString(), [[0, 65535]]);
  const primary = parseFitsHeaderAt(firstRange.data);
  const image = parseFitsHeaderAt(firstRange.data, primary.nextOffset);
  if (image.header.EXTNAME?.trim() !== 'IMAGE' || Number(image.header.NAXIS) !== 2
      || Math.abs(Number(image.header.BITPIX)) !== 32 || image.header.BUNIT !== 'MJy / sr'
      || image.header.CUNIT1W !== 'um') {
    throw new Error('SPHEREx product does not contain a supported 2-D science image.');
  }
  const { flagsHdu, varianceHdu, wavelengthHdu } = await getSpectrumHduLayout(product, url.toString(), image, {
    requireFlags: false,
    requireVariance: true,
    requireWave: true
  });

  const midpointMjd = (Number(product.mjdStart) + Number(product.mjdEnd)) / 2;
  if (!Number.isFinite(midpointMjd)) throw new Error('SPHEREx product is missing a valid observation date.');
  const trackedPosition = positionAtMjd(ra, dec, motion, midpointMjd);
  const pixel = skyToFitsPixel(image.header, trackedPosition.ra, trackedPosition.dec);
  const width = Number(image.header.NAXIS1);
  const height = Number(image.header.NAXIS2);
  const pixelX = Math.round(pixel.x);
  const pixelY = Math.round(pixel.y);
  if (pixelX < 1 || pixelX > width || pixelY < 1 || pixelY > height
      || !varianceHdu || Number(varianceHdu.header.NAXIS1) !== width || Number(varianceHdu.header.NAXIS2) !== height) {
    throw new Error('Selected coordinate is outside the SPHEREx detector image.');
  }

  const pixelIndex = (pixelY - 1) * width + (pixelX - 1);
  const imageValueOffset = image.dataOffset + pixelIndex * 4;
  const varianceValueOffset = varianceHdu.dataOffset + pixelIndex * 4;
  const flagsValueOffset = flagsHdu ? flagsHdu.dataOffset + pixelIndex * 4 : null;
  const waveStart = wavelengthHdu.fileOffset;
  const waveEnd = waveStart + wavelengthHdu.byteLength - 1;
  const ranges = [
    [imageValueOffset, imageValueOffset + 3],
    ...(flagsHdu ? [[flagsValueOffset, flagsValueOffset + 3]] : []),
    [varianceValueOffset, varianceValueOffset + 3],
    [waveStart, waveEnd]
  ];
  const sampled = await fetchFitsRange(url.toString(), ranges);
  const parts = parseMultipartRanges(sampled.data, sampled.contentType, ranges);
  const imageBytes = parts.get(imageValueOffset);
  const flagsBytes = flagsHdu ? parts.get(flagsValueOffset) : null;
  const varianceBytes = parts.get(varianceValueOffset);
  const waveTable = parts.get(waveStart);
  const lookup = readWavelengthLookup(waveTable);
  const wavelength = interpolateWavelength(lookup, pixelX, pixelY);
  const flux = imageBytes.readFloatBE(0) * Number(image.header.BSCALE ?? 1) + Number(image.header.BZERO ?? 0);
  const flags = flagsBytes ? flagsBytes.readInt32BE(0) : 0;
  const variance = varianceBytes.readFloatBE(0) * Number(varianceHdu.header.BSCALE ?? 1)
    + Number(varianceHdu.header.BZERO ?? 0);
  if (!Number.isFinite(flux) || !Number.isFinite(variance) || variance < 0
      || !Number.isFinite(wavelength.wavelengthUm) || wavelength.wavelengthUm <= 0
      || !Number.isFinite(wavelength.bandwidthUm) || wavelength.bandwidthUm <= 0) {
    throw new Error('SPHEREx product returned a non-finite pixel or wavelength sample.');
  }

  return {
    wavelengthUm: wavelength.wavelengthUm,
    bandwidthUm: wavelength.bandwidthUm,
    fluxMjySr: flux,
    varianceMjy2Sr2: variance,
    flags,
    detector: String(product.energyBandpass).replace('SPHEREx-', ''),
    observationId: product.observationId,
    timestamp: (midpointMjd - 40587) * 86400000,
    collection: product.collection,
    trackedRa: trackedPosition.ra,
    trackedDec: trackedPosition.dec,
    pixelX,
    pixelY
  };
}

ipcMain.handle('spherex:load-spectrum', async (event, { ra, dec, motion = null, collection = 'spherex_dr1', requestId }) => {
  try {
    if (!Number.isFinite(ra) || ra < 0 || ra > 360 || !Number.isFinite(dec) || dec < -90 || dec > 90) {
      throw new Error('A valid sky coordinate is required to load SPHEREx spectra.');
    }
    if (!SPHEREX_RELEASES.includes(collection)) {
      throw new Error('Unsupported SPHEREx data release.');
    }
    if (motion && ['ra', 'dec', 'pmra', 'pmdec', 'refEpoch'].some(key => !Number.isFinite(motion[key]))) {
      throw new Error('Gaia proper-motion data for the target is incomplete.');
    }
    const reportProgress = progress => {
      if (typeof event.sender?.send === 'function' && !event.sender.isDestroyed?.()) {
        event.sender.send('spherex:spectrum-progress', { requestId, ...progress });
      }
    };

    const queryProducts = async (detector, release) => {
      const adqlQuery = `SELECT TOP 17 o.observationid, p.energy_bandpassname, p.time_bounds_lower, p.time_bounds_upper, a.uri, a.contentlength, o.collection FROM spherex.plane AS p JOIN spherex.artifact AS a ON p.planeid = a.planeid JOIN spherex.observation AS o ON p.obsid = o.obsid WHERE o.collection = '${release}' AND p.calibrationlevel = 2 AND p.dataproducttype = 'image' AND a.producttype = 'science' AND p.time_bounds_lower IS NOT NULL AND p.time_bounds_upper IS NOT NULL AND p.energy_bandpassname = 'SPHEREx-${detector}' AND 1 = CONTAINS(POINT('ICRS', ${ra}, ${dec}), p.poly) ORDER BY p.time_bounds_lower DESC`;
      const payload = await queueIrsaTap(() => queryIrsaTapAsync(adqlQuery, { label: `SPHEREx ${detector} ${release} spectrum search` }));
      const table = payload?.VOTABLE?.RESOURCE_ARRAY?.[0]?.TABLE;
      const fields = table?.FIELD_ARRAY?.map(field => field['<xmlattr>']?.name);
      const rows = table?.DATA?.TABLEDATA;
      if (!fields || !rows) throw new Error('IRSA TAP response did not contain a detector-product table.');
      return rows.map(row => {
        const values = Object.fromEntries(fields.map((field, index) => [field, row[index]]));
        return {
          uri: values.uri,
          contentlength: values.contentlength,
          energyBandpass: values.energy_bandpassname,
          observationId: values.observationid,
          mjdStart: Number(values.time_bounds_lower),
          mjdEnd: Number(values.time_bounds_upper),
          collection: values.collection
        };
      });
    };

    let detectorResults = [];
    const releases = [collection, getReleaseFallback(collection)];
    for (const release of releases) {
      const releaseResults = [];
      let completedDetectors = 0;
      reportProgress({ phase: 'search', collection: release, completedDetectors, totalDetectors: 6 });
      for (const detector of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']) {
        try {
          releaseResults.push({ detector, products: await queryProducts(detector, release) });
        } catch (error) {
          if (!isRetryableSpectrumError(error)) {
            releaseResults.push({ detector, error: error.message });
          } else {
            await new Promise(resolve => setTimeout(resolve, 350));
            try {
              releaseResults.push({ detector, products: await queryProducts(detector, release) });
            } catch (retryError) {
              releaseResults.push({ detector, error: retryError.message });
            }
          }
        }
        completedDetectors += 1;
        reportProgress({
          phase: 'search',
          collection: release,
          completedDetectors,
          totalDetectors: 6,
          detector,
          productCount: releaseResults.at(-1).products?.length || 0
        });
      }
      detectorResults = releaseResults;
      if (releaseResults.some(result => result.products?.length)) break;
    }
    const products = detectorResults.flatMap(result => result.products || []);
    if (products.length === 0) {
      const queryErrors = detectorResults.filter(result => result.error).map(result => `${result.detector}: ${result.error}`);
      return {
        success: false,
        error: queryErrors.length
          ? `SPHEREx spectrum searches failed (${queryErrors.join('; ')}).`
          : `No calibrated SPHEREx DR1 or QR3 detector images cover this coordinate. QR2 is no longer searchable in IRSA.`
      };
    }

    const samples = [];
    const failures = detectorResults.filter(result => result.error).map(result => `${result.detector}: ${result.error}`);
    reportProgress({ phase: 'sampling', completedProducts: 0, totalProducts: products.length, failureCount: failures.length });
    let nextProduct = 0;
    let completedProducts = 0;
    const worker = async () => {
      while (nextProduct < products.length) {
        const product = products[nextProduct];
        nextProduct += 1;
        let sample;
        try {
          sample = await extractSpherexPixelSpectrum(product, ra, dec, motion);
          samples.push(sample);
        } catch (error) {
          if (isRetryableSpectrumError(error)) {
            await new Promise(resolve => setTimeout(resolve, 350));
            try {
              sample = await extractSpherexPixelSpectrum(product, ra, dec, motion);
              samples.push(sample);
            } catch (retryError) {
              failures.push(`${product.energyBandpass} ${product.observationId}: ${retryError.message}`);
            }
          } else {
            failures.push(`${product.energyBandpass} ${product.observationId}: ${error.message}`);
          }
        }
        completedProducts += 1;
        reportProgress({
          phase: 'sampling',
          completedProducts,
          totalProducts: products.length,
          failureCount: failures.length,
          ...(sample ? { sample } : {})
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, products.length) }, worker));
    samples.sort((a, b) => a.wavelengthUm - b.wavelengthUm);
    if (samples.length === 0) {
      return {
        success: false,
        error: `No usable SPHEREx pixel samples could be read. ${failures.slice(0, 3).join('; ')}`
      };
    }
    return {
      success: true,
      samples,
      productCount: products.length,
      failures: failures.slice(0, 12),
      additionalFailureCount: Math.max(0, failures.length - 12)
    };
  } catch (error) {
    console.error('[SPHEREx spectrum error]', error.message);
    return { success: false, error: error.message };
  }
});

const spherexCutoutCache = new Map();
function parseCsvRows(csvText) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const text = String(csvText || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ',') { row.push(field); field = ''; }
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map(value => value.trim().toLowerCase());
  const cloudAccessIndex = headers.indexOf('cloud_access');
  return rows.map(values => {
    // IRSA's CSV currently emits cloud_access JSON containing commas without
    // CSV quotes. Rejoin just that trailing JSON cell so later columns remain
    // aligned and the documented S3 mirror can be used.
    if (cloudAccessIndex >= 0 && values.length > headers.length) {
      const trailingColumns = headers.length - cloudAccessIndex - 1;
      const cloudAccessEnd = values.length - trailingColumns;
      values = [
        ...values.slice(0, cloudAccessIndex),
        values.slice(cloudAccessIndex, cloudAccessEnd).join(','),
        ...values.slice(cloudAccessEnd)
      ];
    }
    return Object.fromEntries(headers.map((key, index) => [key, values[index] ?? '']));
  });
}

function sampleSpherexEpochRows(rows, limit) {
  const chronological = rows.slice().sort((left, right) => Number(left.t_min) - Number(right.t_min));
  const timed = chronological.filter(row => Number.isFinite(Number(row.t_min)));
  if (timed.length < 2) return chronological.slice(0, limit);
  // SIA may return several same-time spectral products for one sky pass. Keep
  // one representative per 20-minute epoch, then spread the selected frames
  // across the available dates rather than taking the first channels returned.
  const epochs = [];
  for (const row of timed) {
    const mjd = Number(row.t_min);
    const lastEpoch = epochs[epochs.length - 1];
    if (!lastEpoch || mjd - lastEpoch.mjd > 20 / 1440) epochs.push({ mjd, row });
  }
  if (epochs.length <= limit) return epochs.map(epoch => epoch.row);
  if (limit === 1) return [epochs[Math.floor(epochs.length / 2)].row];
  return Array.from({ length: limit }, (_, index) => {
    const selectedIndex = Math.round(index * (epochs.length - 1) / (limit - 1));
    return epochs[selectedIndex].row;
  });
}

function detectorInSpherexProductUrl(uri) {
  let path = String(uri || '');
  try { path = decodeURIComponent(new URL(path).pathname); } catch (error) { /* keep raw URL text */ }
  return path.match(/_2D([1-6])(?:_|\.)/i)?.[1] || null;
}

function spherexCloudAccessUrl(cloudAccess, release) {
  try {
    let cloud = cloudAccess;
    if (typeof cloud === 'string') {
      try { cloud = JSON.parse(cloud); }
      catch (error) {
        // The current IRSA CSV response strips JSON string quotes and does not
        // escape the commas in cloud_access. Restore this simple metadata form.
        const normalized = cloud
          .replace(/([{,]\s*)([A-Za-z_][\w-]*)(\s*:)/g, '$1"$2"$3')
          .replace(/:\s*([A-Za-z0-9_./-]+)(\s*[,}])/g, ':"$1"$2');
        cloud = JSON.parse(normalized);
      }
    }
    const bucket = cloud?.aws?.bucket_name;
    const key = String(cloud?.aws?.key || '').replace(/^\/+/, '');
    const prefix = release === 'spherex_dr1' ? 'dr1/' : release === 'spherex_qr3' ? 'qr3/' : '';
    if (bucket !== 'nasa-irsa-spherex' || !prefix || !key.startsWith(prefix)) return null;
    return `https://${bucket}.s3.us-east-1.amazonaws.com/${key.split('/').map(encodeURIComponent).join('/')}`;
  } catch (error) {
    return null;
  }
}

async function querySpherexCutoutProductsViaSia(ra, dec, detector, release, limit, motion = null) {
  // Center the archive search on the target's expected 2026 position and widen
  // it to cover the SPHEREx observing baseline. Each FITS cutout is then recentered
  // on the propagated target position at that image's own epoch.
  const searchEpochMjd = 61041;
  const searchCenter = positionAtMjd(ra, dec, motion, searchEpochMjd);
  const properMotionArcsecPerYear = motion ? Math.hypot(motion.pmra, motion.pmdec) : 0;
  const searchRadiusDegrees = 0.01 + properMotionArcsecPerYear * 1.5 / 3600;
  const params = new URLSearchParams({
    POS: `CIRCLE ${searchCenter.ra} ${searchCenter.dec} ${searchRadiusDegrees}`,
    CALIB: '2',
    DPTYPE: 'image',
    FORMAT: 'image/fits',
    // Ask SIA for enough of the target's real image products to select epochs
    // across the release baseline, rather than sampling only its first rows.
    MAXREC: String(Math.max(120, limit * 20)),
    RESPONSEFORMAT: 'CSV'
  });
  params.append('COLLECTION', release);
  params.append('COLLECTION', `${release}_deep`);
  const response = await axios.get(`https://irsa.ipac.caltech.edu/SIA?${params}`, {
    timeout: 25000,
    responseType: 'text',
    transformResponse: [data => data],
    validateStatus: () => true,
    headers: { 'User-Agent': 'SPHEREx-Electron-Tool/1.0' }
  });
  if (response.status < 200 || response.status >= 300) {
    const error = new Error(`IRSA SIA2 image search failed (HTTP ${response.status}).`);
    error.status = response.status;
    error.irsaGatewayFailure = [502, 503, 504].includes(response.status);
    throw error;
  }
  const rows = parseCsvRows(response.data);
  if (!rows.length) throw new Error('IRSA SIA2 returned no image rows.');
  const products = rows.filter(row => {
    const band = String(row.energy_bandpassname || row.energy_band || row.bandpass || '').toUpperCase();
    const format = String(row.access_format || '').toLowerCase();
    const uri = row.access_url;
    const uriDetector = detectorInSpherexProductUrl(uri);
    // SIA's bandpass label is not guaranteed to encode the detector. The
    // published SPHEREx filename does, so trust it when present.
    const matchesDetector = uriDetector
      ? uriDetector === detector.slice(1)
      : band.includes(`SPHEREX-${detector}`) || band.endsWith(detector);
    return uri && matchesDetector
      && (!format || format.includes('fits'));
  });
  const selectedProducts = sampleSpherexEpochRows(products, limit);
  const mapped = await Promise.all(selectedProducts.map(async row => {
    const cloudUri = spherexCloudAccessUrl(row.cloud_access, release);
    const candidateUris = [...new Set([cloudUri, row.access_url].filter(Boolean))];
    const start = Number(row.t_min || row.time_bounds_lower);
    const end = Number(row.t_max || row.time_bounds_upper || row.t_min || row.time_bounds_lower);
    const reportedBand = String(row.energy_bandpassname || row.energy_band || row.bandpass || '');
    const uriDetector = detectorInSpherexProductUrl(row.access_url || cloudUri);
    const band = /SPHEREX-D[1-6]/i.test(reportedBand) ? reportedBand : `SPHEREx-${uriDetector || detector}`;
    for (const uri of candidateUris) {
      try {
        const head = await axios.head(uri, { timeout: 10000, maxRedirects: 5, validateStatus: () => true });
        const contentlength = Number(head.headers?.['content-length'] || row.contentlength);
        if (head.status < 200 || head.status >= 400 || !Number.isSafeInteger(contentlength)) continue;
        return {
          uri,
          contentlength,
          energyBandpass: band,
          observationId: row.obs_id || row.observationid || row.obs_publisher_did || uri.split('/').pop().split('?')[0],
          mjdStart: start,
          mjdEnd: end,
          collection: row.obs_collection || release
        };
      } catch (error) {
        // Try the same public product through IRSA's documented S3 mirror.
      }
    }
    return null;
  }));
  return mapped.filter(product => product && Number.isFinite(product.mjdStart) && Number.isFinite(product.mjdEnd));
}

async function querySpherexCutoutProducts(ra, dec, detector, release, limit, motion = null) {
  const searchCenter = positionAtMjd(ra, dec, motion, 61041);
  const adqlQuery = `SELECT TOP ${limit} o.observationid, p.energy_bandpassname, p.time_bounds_lower, p.time_bounds_upper, a.uri, a.contentlength, o.collection FROM spherex.plane AS p JOIN spherex.artifact AS a ON p.planeid = a.planeid JOIN spherex.observation AS o ON p.obsid = o.obsid WHERE o.collection IN ('${release}', '${release}_deep') AND p.calibrationlevel = 2 AND p.dataproducttype = 'image' AND a.producttype = 'science' AND p.time_bounds_lower IS NOT NULL AND p.time_bounds_upper IS NOT NULL AND p.energy_bandpassname = 'SPHEREx-${detector}' AND 1 = CONTAINS(POINT('ICRS', ${searchCenter.ra}, ${searchCenter.dec}), p.poly) ORDER BY p.time_bounds_lower`;
  // SIA2 is IRSA's current image-search interface and is independent of TAP's
  // async job queue, which can return gateway errors while the archive is busy.
  try {
    const siaProducts = await querySpherexCutoutProductsViaSia(ra, dec, detector, release, limit, motion);
    if (siaProducts.length) return siaProducts;
    console.warn(`[SPHEREx ${detector} ${release}] SIA2 returned no usable products; trying TAP.`);
  } catch (siaError) {
    console.warn(`[SPHEREx ${detector} ${release}] SIA2 discovery failed; trying TAP: ${siaError.message}`);
  }
  let payload;
  try {
    payload = await queueIrsaTap(() => queryIrsaTapAsync(adqlQuery, { label: `SPHEREx ${detector} ${release} cutout search` }));
  } catch (tapError) {
    if (tapError.irsaGatewayFailure) throw tapError;
    throw new Error(`IRSA image discovery failed via SIA2 and TAP (${tapError.message}).`);
  }
  const table = payload?.VOTABLE?.RESOURCE_ARRAY?.[0]?.TABLE;
  const fields = table?.FIELD_ARRAY?.map(field => field['<xmlattr>']?.name);
  const rows = table?.DATA?.TABLEDATA;
  if (!fields || !rows) throw new Error('IRSA TAP response did not contain a detector-product table.');
  return rows.map(row => {
    const values = Object.fromEntries(fields.map((field, index) => [field, row[index]]));
    return {
      uri: values.uri,
      contentlength: values.contentlength,
      energyBandpass: values.energy_bandpassname,
      observationId: values.observationid,
      mjdStart: Number(values.time_bounds_lower),
      mjdEnd: Number(values.time_bounds_upper),
      collection: values.collection
    };
  });
}

async function extractSpherexImageCutout(product, ra, dec, motion, size = 64) {
  const fileSize = Number(product.contentlength);
  if (!Number.isSafeInteger(fileSize) || fileSize < 10000 || fileSize > 2 * 1024 * 1024 * 1024) {
    throw new Error('SPHEREx archive product has an invalid or unsupported file size.');
  }
  const url = new URL(product.uri, 'https://irsa.ipac.caltech.edu/');
  const validIpacProduct = url.hostname === 'irsa.ipac.caltech.edu'
    && /^\/(?:ibe\/)?data\/(?:spherex|SPHEREx)\//i.test(url.pathname);
  const validCloudProduct = url.hostname === 'nasa-irsa-spherex.s3.us-east-1.amazonaws.com'
    && /^\/(?:dr1|qr3)\//.test(url.pathname);
  if (!validIpacProduct && !validCloudProduct) {
    throw new Error('SPHEREx archive returned an unexpected product URL.');
  }
  const headerResponse = await fetchFitsRange(url.toString(), [[0, 65535]]);
  const primary = parseFitsHeaderAt(headerResponse.data);
  const image = parseFitsHeaderAt(headerResponse.data, primary.nextOffset);
  if (image.header.EXTNAME?.trim() !== 'IMAGE' || Number(image.header.NAXIS) !== 2
      || Math.abs(Number(image.header.BITPIX)) !== 32 || image.header.BUNIT !== 'MJy / sr') {
    throw new Error('SPHEREx product does not contain a supported 2-D science image.');
  }
  const { flagsHdu, wavelengthHdu } = await getSpectrumHduLayout(product, url.toString(), image, {
    requireFlags: false,
    requireVariance: false,
    requireWave: true
  });
  const midpointMjd = (product.mjdStart + product.mjdEnd) / 2;
  const trackedPosition = positionAtMjd(ra, dec, motion, midpointMjd);
  const pixel = skyToFitsPixel(image.header, trackedPosition.ra, trackedPosition.dec);
  const imageWidth = Number(image.header.NAXIS1);
  const imageHeight = Number(image.header.NAXIS2);
  const width = Math.min(size, imageWidth);
  const height = Math.min(size, imageHeight);
  const startX = Math.max(1, Math.min(imageWidth - width + 1, Math.round(pixel.x) - Math.floor(width / 2)));
  const startY = Math.max(1, Math.min(imageHeight - height + 1, Math.round(pixel.y) - Math.floor(height / 2)));
  if (pixel.x < 1 || pixel.x > imageWidth || pixel.y < 1 || pixel.y > imageHeight
      || (flagsHdu && (Number(flagsHdu.header.NAXIS1) !== imageWidth || Number(flagsHdu.header.NAXIS2) !== imageHeight))) {
    throw new Error('Selected coordinate is outside the SPHEREx detector image.');
  }

  const flagBytesPerPixel = flagsHdu ? Math.abs(Number(flagsHdu.header.BITPIX)) / 8 : 0;
  if (flagsHdu && ![1, 2, 4, 8].includes(flagBytesPerPixel)) {
    throw new Error(`Unsupported SPHEREx FLAGS pixel width (${flagsHdu.header.BITPIX} bits).`);
  }
  // Fetch row strips rather than one tiny range per row. This reduces a
  // 64x64 image from 129 separate S3 requests to at most three ranges while
  // keeping transferred data below roughly 1.1 MB for a 2040-pixel detector.
  const firstRowPixel = (startY - 1) * imageWidth;
  const lastRowPixelExclusive = (startY - 1 + height) * imageWidth;
  const imageBlockStart = image.dataOffset + firstRowPixel * 4;
  const imageBlockEnd = image.dataOffset + lastRowPixelExclusive * 4 - 1;
  const imageBlockRange = [imageBlockStart, imageBlockEnd];
  const flagsBlockStart = flagsHdu ? flagsHdu.dataOffset + firstRowPixel * flagBytesPerPixel : null;
  const flagsBlockEnd = flagsHdu ? flagsHdu.dataOffset + lastRowPixelExclusive * flagBytesPerPixel - 1 : null;
  const flagsBlockRange = flagsHdu ? [flagsBlockStart, flagsBlockEnd] : null;
  const waveRange = [wavelengthHdu.fileOffset, wavelengthHdu.fileOffset + wavelengthHdu.byteLength - 1];
  const ranges = [imageBlockRange, ...(flagsBlockRange ? [flagsBlockRange] : []), waveRange];
  const cutoutResponse = await fetchFitsRange(url.toString(), ranges);
  const rangeData = parseMultipartRanges(cutoutResponse.data, cutoutResponse.contentType, ranges);
  const imageBlock = rangeData.get(imageBlockStart);
  const flagsBlock = flagsHdu ? rangeData.get(flagsBlockStart) : null;
  const wavelengthBlock = rangeData.get(wavelengthHdu.fileOffset);
  const pixels = new Array(width * height);
  const flags = new Array(width * height).fill(0);
  for (let y = 0; y < height; y += 1) {
    const rowPixelOffset = y * imageWidth + startX - 1;
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const sourcePixel = rowPixelOffset + x;
      pixels[index] = imageBlock.readFloatBE(sourcePixel * 4) * Number(image.header.BSCALE ?? 1)
        + Number(image.header.BZERO ?? 0);
      if (!flagsHdu) continue;
      const flagValue = flagBytesPerPixel === 8
        ? flagsBlock.readBigInt64BE(sourcePixel * 8)
        : flagBytesPerPixel === 4
          ? flagsBlock.readInt32BE(sourcePixel * 4)
          : flagBytesPerPixel === 2
            ? flagsBlock.readInt16BE(sourcePixel * 2)
            : flagsBlock.readInt8(sourcePixel);
      flags[index] = flagValue === 0 || flagValue === 0n ? 0 : 1;
    }
  }
  const lookup = readWavelengthLookup(wavelengthBlock);
  const wavelength = interpolateWavelength(lookup, Math.round(pixel.x), Math.round(pixel.y));
  const cdelt1 = Number(image.header.CDELT1 ?? 1);
  const cdelt2 = Number(image.header.CDELT2 ?? 1);
  const cdMatrix = [
    [Number(image.header.CD1_1 ?? cdelt1 * Number(image.header.PC1_1 ?? 1)),
      Number(image.header.CD1_2 ?? cdelt1 * Number(image.header.PC1_2 ?? 0))],
    [Number(image.header.CD2_1 ?? cdelt2 * Number(image.header.PC2_1 ?? 0)),
      Number(image.header.CD2_2 ?? cdelt2 * Number(image.header.PC2_2 ?? 1))]
  ];
  const pixelScaleDegrees = Math.sqrt(Math.abs(cdMatrix[0][0] * cdMatrix[1][1] - cdMatrix[0][1] * cdMatrix[1][0]));
  if (!Number.isFinite(pixelScaleDegrees) || pixelScaleDegrees <= 0) {
    throw new Error('SPHEREx image is missing a valid pixel scale.');
  }
  return {
    width,
    height,
    pixels,
    flags,
    centerRa: trackedPosition.ra,
    centerDec: trackedPosition.dec,
    centerX: pixel.x - startX,
    centerY: pixel.y - startY,
    cdMatrix,
    pixelScaleArcsec: pixelScaleDegrees * 3600,
    detector: String(product.energyBandpass).replace('SPHEREx-', ''),
    wavelengthUm: wavelength.wavelengthUm,
    bandwidthUm: wavelength.bandwidthUm,
    observationId: product.observationId,
    timestamp: ((midpointMjd - 40587) * 86400000),
    exposureSeconds: Math.max(0, (product.mjdEnd - product.mjdStart) * 86400),
    collection: product.collection,
    flagsAvailable: Boolean(flagsHdu)
  };
}

ipcMain.handle('spherex:load-cutouts', async (event, {
  ra, dec, motion = null, collection = 'spherex_dr1', detector = 'D1', frameLimit = 8, cutoutSize = 64, requestId, allEpochs = false
}) => {
  try {
    if (!Number.isFinite(ra) || ra < 0 || ra >= 360 || !Number.isFinite(dec) || dec < -90 || dec > 90) {
      throw new Error('A valid sky coordinate is required to load SPHEREx cutouts.');
    }
    if (!SPHEREX_RELEASES.includes(collection)) throw new Error('Unsupported SPHEREx data release.');
    if (detector !== 'all' && !/^D[1-6]$/.test(detector)) {
      throw new Error('Choose all detector arrays or a SPHEREx detector from D1 to D6.');
    }
    if (!Number.isInteger(frameLimit) || frameLimit < 2 || frameLimit > 12) {
      throw new Error('The cutout frame limit must be from 2 to 12.');
    }
    if (!Number.isInteger(cutoutSize) || cutoutSize < 32 || cutoutSize > 256) {
      throw new Error('The image cutout size must be from 32 to 256 native pixels.');
    }
    if (motion && ['ra', 'dec', 'pmra', 'pmdec', 'refEpoch'].some(key => !Number.isFinite(motion[key]))) {
      throw new Error('Gaia proper-motion data for the target is incomplete.');
    }

    const cacheKey = [ra.toFixed(7), dec.toFixed(7), detector, collection, frameLimit, cutoutSize, allEpochs ? 'all-epochs' : 'preferred-release',
      ...(motion ? [motion.ra, motion.dec, motion.pmra, motion.pmdec, motion.refEpoch] : [])].join(':');
    const cached = spherexCutoutCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { success: true, ...cached.result, cached: true };

    const releases = [collection, getReleaseFallback(collection)];
    let products = [];
    const failures = [];
    for (const release of releases) {
      try {
        const detectors = detector === 'all' ? ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'] : [detector];
        const productsByDetector = [];
        for (const detectorName of detectors) {
          try {
            const detectorLimit = detector === 'all' ? Math.min(2, frameLimit) : frameLimit;
            productsByDetector.push(...await querySpherexCutoutProducts(ra, dec, detectorName, release, detectorLimit, motion));
          } catch (error) {
            failures.push(`${detectorName} ${release}: ${error.message}`);
            if (error.irsaGatewayFailure) break;
          }
        }
        products.push(...productsByDetector);
        if (products.length && !allEpochs) break;
        if (failures.some(message => /temporarily returning gateway errors|HTTP 50[234]|repeatedly returned HTTP 50[234]/.test(message))) break;
      } catch (error) {
        failures.push(`${release}: ${error.message}`);
      }
    }
    const uniqueProducts = new Map();
    for (const product of products) {
      const key = `${product.observationId}|${product.energyBandpass}|${product.mjdStart}`;
      if (!uniqueProducts.has(key)) uniqueProducts.set(key, product);
    }
    products = [...uniqueProducts.values()].sort((a, b) => a.mjdStart - b.mjdStart);
        if (allEpochs && detector !== 'all' && products.length > frameLimit) {
      products = sampleSpherexEpochRows(products.map(product => ({ ...product, t_min: product.mjdStart })), frameLimit);
    }
    if (!products.length) {
      return {
        success: false,
        error: failures.length
          ? `SPHEREx image search failed: ${failures.join('; ')}`
          : `No calibrated SPHEREx ${detector} cutouts cover this coordinate in DR1 or QR3. QR2 is no longer searchable in IRSA.`
      };
    }

    const frames = [];
    let completedProducts = 0;
    let nextProductIndex = 0;
    const reportCutoutProgress = progress => {
      if (typeof event.sender?.send === 'function' && !event.sender.isDestroyed?.()) {
        event.sender.send('spherex:cutout-progress', { requestId, ...progress });
      }
    };
    const readProduct = async product => {
      reportCutoutProgress({ phase: 'reading', completed: completedProducts, total: products.length, observationId: product.observationId });
      let errorMessage;
      try {
        frames.push(await extractSpherexImageCutout(product, ra, dec, motion, cutoutSize));
      } catch (error) {
        errorMessage = error.message;
        failures.push(`${product.observationId}: ${errorMessage}`);
      }
      completedProducts += 1;
      reportCutoutProgress({ phase: 'complete', completed: completedProducts, total: products.length, observationId: product.observationId, error: errorMessage });
    };
    const worker = async () => {
      while (nextProductIndex < products.length) {
        const index = nextProductIndex;
        nextProductIndex += 1;
        await readProduct(products[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, products.length) }, worker));
    frames.sort((a, b) => a.timestamp - b.timestamp);
    if (!frames.length) {
      throw new Error(`No SPHEREx image cutouts could be read. ${failures.slice(0, 3).join('; ')}`);
    }

    const result = {
      frames,
      productCount: products.length,
      failures: failures.slice(0, 8),
      additionalFailureCount: Math.max(0, failures.length - 8)
    };
    spherexCutoutCache.set(cacheKey, { result, expiresAt: Date.now() + 10 * 60 * 1000 });
    while (spherexCutoutCache.size > 6) spherexCutoutCache.delete(spherexCutoutCache.keys().next().value);
    return { success: true, ...result, cached: false };
  } catch (error) {
    console.error('[SPHEREx cutout error]', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('spherex:query-gaia', async (event, { adqlQuery, requestId }) => {
  const tapUrl = 'https://gea.esac.esa.int/tap-server/tap';
  let jobUrl;
  const requestScope = typeof requestId === 'number' && requestId < 0 ? 'hover' : 'field';
  const tapRequest = { requestId, cancelled: false, jobUrl: null };
  const activeFieldRequest = activeGaiaTapRequests.get('field');
  if (requestScope === 'hover' && activeFieldRequest && !activeFieldRequest.cancelled) {
    return { success: false, error: 'Gaia DR3 field query is active; hover lookup was skipped.' };
  }
  if (requestScope === 'field') {
    const activeHoverRequest = activeGaiaTapRequests.get('hover');
    if (activeHoverRequest) {
      activeHoverRequest.cancelled = true;
      void abortGaiaTapJob(activeHoverRequest.jobUrl);
    }
  }
  const previousRequest = activeGaiaTapRequests.get(requestScope);
  activeGaiaTapRequests.set(requestScope, tapRequest);
  if (previousRequest) {
    previousRequest.cancelled = true;
    void abortGaiaTapJob(previousRequest.jobUrl);
  }
  const isSuperseded = () => tapRequest.cancelled || activeGaiaTapRequests.get(requestScope) !== tapRequest;
  try {
    // Small cone searches (including the app's 500-source overlay) are more
    // reliable through Gaia's synchronous TAP endpoint and avoid orphaned UWS jobs.
    const syncParams = new URLSearchParams({
      REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'json', QUERY: adqlQuery
    });
    try {
      const syncResponse = await axios.post(`${tapUrl}/sync`, syncParams.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SPHEREx-Electron-Tool/1.0'
        },
        timeout: 25000,
        responseType: 'text',
        transformResponse: [data => data],
        validateStatus: () => true
      });
      if (syncResponse.status >= 200 && syncResponse.status < 300) {
        return { success: true, data: syncResponse.data };
      }
      console.warn(`[Gaia TAP] Sync endpoint returned HTTP ${syncResponse.status}; trying async TAP.`);
    } catch (syncError) {
      if (isSuperseded()) return { success: false, error: 'Gaia TAP request was superseded by a newer target.' };
      console.warn(`[Gaia TAP] ESA sync request failed (${syncError.message}); trying Gaia@AIP DR3 mirror.`);
      try {
        const mirrorParams = new URLSearchParams({
          REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'votable',
          QUERY: adqlQuery
        });
        const mirrorResponse = await axios.post('https://gaia.aip.de/tap/sync', mirrorParams.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'SPHEREx-Electron-Tool/1.0'
          },
          timeout: 30000,
          responseType: 'text',
          transformResponse: [data => data],
          validateStatus: () => true
        });
        if (mirrorResponse.status >= 200 && mirrorResponse.status < 300) {
          return { success: true, data: mirrorResponse.data, mirror: 'Gaia@AIP DR3' };
        }
        const mirrorDetail = String(mirrorResponse.data || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
        if (mirrorResponse.status === 429) {
          console.warn(`[Gaia TAP] Gaia@AIP is at its concurrent-job limit; not retrying that mirror. Trying one ESA async request instead.${mirrorDetail ? ` ${mirrorDetail}` : ''}`);
        } else {
          console.warn(`[Gaia TAP] Gaia@AIP returned HTTP ${mirrorResponse.status}${mirrorDetail ? `: ${mirrorDetail}` : ''}; trying ESA async TAP.`);
        }
      } catch (mirrorError) {
        console.warn(`[Gaia TAP] Gaia@AIP mirror failed (${mirrorError.message}); stopping to avoid queuing duplicate Gaia jobs.`);
        return { success: false, error: `Gaia ESA sync and Gaia@AIP fallback both failed: ${mirrorError.message}` };
      }
    }

    const params = new URLSearchParams({
      REQUEST: 'doQuery',
      LANG: 'ADQL',
      FORMAT: 'json',
      PHASE: 'RUN',
      QUERY: adqlQuery
    });

    let submission;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (isSuperseded()) return { success: false, error: 'Gaia TAP request was superseded by a newer target.' };
      submission = await axios.post(`${tapUrl}/async`, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SPHEREx-Electron-Tool/1.0'
        },
        maxRedirects: 0,
        timeout: 30000,
        responseType: 'text',
        transformResponse: [data => data],
        validateStatus: () => true
      });
      if (submission.status !== 429) break;
      if (attempt === 3) break;
      await new Promise(resolve => setTimeout(resolve, getRateLimitRetryDelay(submission, attempt)));
    }

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
    tapRequest.jobUrl = jobUrl;
    if (isSuperseded()) {
      await abortGaiaTapJob(jobUrl);
      return { success: false, error: 'Gaia TAP request was superseded by a newer target.' };
    }

    let completed = false;
    let consecutiveRateLimits = 0;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (isSuperseded()) {
        await abortGaiaTapJob(jobUrl);
        return { success: false, error: 'Gaia TAP request was superseded by a newer target.' };
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
      let phaseResponse = await axios.get(`${jobUrl}/phase`, {
        timeout: 15000,
        responseType: 'text',
        transformResponse: [data => data],
        validateStatus: () => true
      });
      if (isSuperseded()) {
        return { success: false, error: 'Gaia TAP request was superseded by a newer target.' };
      }
      if (phaseResponse.status === 429) {
        consecutiveRateLimits += 1;
        if (consecutiveRateLimits > 4) {
          throw new Error('Gaia TAP status polling was rate limited repeatedly (HTTP 429).');
        }
        await new Promise(resolve => setTimeout(resolve, getRateLimitRetryDelay(phaseResponse, consecutiveRateLimits - 1)));
        attempt -= 1;
        continue;
      }
      if (phaseResponse.status < 200 || phaseResponse.status >= 300) {
        throw new Error(`Gaia TAP job status request failed (HTTP ${phaseResponse.status}).`);
      }
      consecutiveRateLimits = 0;

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
        if (isSuperseded()) {
          return { success: false, error: 'Gaia TAP request was superseded by a newer target.' };
        }
        const detail = String(errorResponse.data || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
        if (phase === 'ABORTED') {
          throw new Error(`Gaia TAP service aborted the query${detail ? `: ${detail}` : '. It was not superseded by another target.'}`);
        }
        throw new Error(`Gaia TAP job error${detail ? `: ${detail}` : ''}`);
      }
      if (!['PENDING', 'QUEUED', 'EXECUTING'].includes(phase)) {
        throw new Error(`Gaia TAP returned an unexpected job state: ${phase || 'empty response'}.`);
      }
    }

    if (!completed) throw new Error('Gaia TAP query timed out while waiting for the asynchronous job.');
    if (isSuperseded()) return { success: false, error: 'Gaia TAP request was superseded by a newer target.' };

    let result;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      result = await axios.get(`${jobUrl}/results/result`, {
        timeout: 30000,
        responseType: 'text',
        transformResponse: [data => data],
        validateStatus: () => true
      });
      if (result.status !== 429 || attempt === 3) break;
      await new Promise(resolve => setTimeout(resolve, getRateLimitRetryDelay(result, attempt)));
      if (isSuperseded()) return { success: false, error: 'Gaia TAP request was superseded by a newer target.' };
    }
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Gaia TAP result download failed (HTTP ${result.status}).`);
    }
    return { success: true, data: result.data };
  } catch (err) {
    if (isSuperseded()) {
      return { success: false, error: 'Gaia TAP request was superseded by a newer target.' };
    }
    if (['ECONNABORTED', 'ETIMEDOUT'].includes(err.code)) {
      if (jobUrl) await abortGaiaTapJob(jobUrl);
      const timeoutMessage = 'Gaia TAP timed out. The query was stopped; ASTERIA did not resubmit it synchronously because that duplicated request was also timing out.';
      console.error('[Gaia TAP Error]', timeoutMessage);
      return { success: false, error: timeoutMessage };
    }
    console.error('[Gaia TAP Error]', err.message);
    return { success: false, error: err.message };
  } finally {
    if (activeGaiaTapRequests.get(requestScope) === tapRequest) activeGaiaTapRequests.delete(requestScope);
  }
});

ipcMain.handle('spherex:query-simbad-named-stars', async (event, { adqlQuery }) => {
  try {
    const params = new URLSearchParams({
      REQUEST: 'doQuery',
      LANG: 'ADQL',
      FORMAT: 'csv',
      QUERY: adqlQuery
    });
    const requestOptions = {
      timeout: 30000,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'SPHEREx-Electron-Tool/1.0'
      },
      body: params.toString()
    };
    const endpoints = [
      'https://simbad.cds.unistra.fr/simbad/sim-tap/sync',
      'https://www-cds.cds.unistra.fr/simbad/sim-tap/sync'
    ];
    let res;
    for (let index = 0; index < endpoints.length; index += 1) {
      try {
        res = await fetchURLWithRateLimitRetry(endpoints[index], requestOptions);
        break;
      } catch (error) {
        const dnsFailure = /ERR_NAME_NOT_RESOLVED|ENOTFOUND/.test(`${error.code || ''} ${error.message || ''}`);
        if (!dnsFailure || index === endpoints.length - 1) throw error;
        console.warn('[SIMBAD TAP] Primary hostname did not resolve; retrying with the CDS canonical hostname.');
      }
    }

    if (res.status >= 200 && res.status < 300) {
      return { success: true, data: res.data };
    }
    return { success: false, status: res.status, error: 'SIMBAD TAP request failed', raw: res.data };
  } catch (err) {
    const message = /ERR_NAME_NOT_RESOLVED|ENOTFOUND/.test(`${err.code || ''} ${err.message || ''}`)
      ? 'SIMBAD is unavailable because its hostname could not be resolved. Check this device’s network or DNS settings; Gaia and SPHEREx data can still load.'
      : err.message;
    console.warn('[SIMBAD TAP unavailable]', message);
    return { success: false, error: message };
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

    // CDS Sesame Resolver with strict 3.5s timeout
    const url = `https://cds.unistra.fr/cgi-bin/nph-sesame/?${encodeURIComponent(trimmed)}`;
    let res = null;
    try {
      res = await fetchURL(url, { timeout: 3500 });
    } catch (e) {
      // CDS Sesame timed out or unreachable
    }

    if (res && res.data) {
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

    // Fallback dictionary for popular SPHEREx targets & celestial landmarks
    const knownTargets = {
      'cosmos': { ra: 150.119, dec: 2.2058, name: 'COSMOS Deep Field' },
      'm82': { ra: 148.968, dec: 69.679, name: 'M82 Starburst Core' },
      'orion': { ra: 83.822, dec: -5.391, name: 'Orion Nebula (M42)' },
      'pleiades': { ra: 56.75, dec: 24.116, name: 'Pleiades Cluster' },
      'crab': { ra: 83.633, dec: 22.014, name: 'Crab Nebula (M1)' },
      'proxima': { ra: 217.429, dec: -62.679, name: 'Proxima Centauri' },
      'andromeda': { ra: 10.685, dec: 41.269, name: 'Andromeda Galaxy (M31)' },
      'm31': { ra: 10.685, dec: 41.269, name: 'Andromeda Galaxy (M31)' },
      'sombrero': { ra: 189.998, dec: -11.623, name: 'Sombrero Galaxy (M104)' },
      'm104': { ra: 189.998, dec: -11.623, name: 'Sombrero Galaxy (M104)' },
      'whirlpool': { ra: 202.470, dec: 47.195, name: 'Whirlpool Galaxy (M51)' },
      'm51': { ra: 202.470, dec: 47.195, name: 'Whirlpool Galaxy (M51)' },
      'triangulum': { ra: 23.462, dec: 30.660, name: 'Triangulum Galaxy (M33)' },
      'm33': { ra: 23.462, dec: 30.660, name: 'Triangulum Galaxy (M33)' },
      'centaurus': { ra: 201.365, dec: -43.019, name: 'Centaurus A (NGC 5128)' },
      'trappist': { ra: 346.622, dec: -5.041, name: 'TRAPPIST-1 System' },
      'sirius': { ra: 101.287, dec: -16.716, name: 'Sirius' },
      'betelgeuse': { ra: 88.793, dec: 7.407, name: 'Betelgeuse' },
      'vega': { ra: 279.235, dec: 38.784, name: 'Vega' },
      'barnard': { ra: 269.452, dec: 4.693, name: "Barnard's Star" },
      'wise': { ra: 133.795, dec: -7.245, name: 'WISE 0855-0714' },
      'sagittarius': { ra: 266.417, dec: -29.008, name: 'Sagittarius A*' },
      'sgr a': { ra: 266.417, dec: -29.008, name: 'Sagittarius A*' },
      'cygnus': { ra: 299.590, dec: 35.202, name: 'Cygnus X-1' },
      'nep': { ra: 270.000, dec: 66.561, name: 'North Ecliptic Pole (NEP)' },
      'sep': { ra: 90.000, dec: -66.561, name: 'South Ecliptic Pole (SEP)' },
      'galaxy': { ra: 10.685, dec: 41.269, name: 'Andromeda Galaxy (M31)' }
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
