const { app, BrowserWindow, ipcMain, net, safeStorage, shell } = require('electron');
const path = require('path');
const axios = require('axios');
const Store = require('electron-store');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const http = require('http');

let activeGaiaTapRequest = null;

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

// Fix: check if it's the class or a module wrapper
const StoreClass = typeof Store === 'function' ? Store : (Store.default || Store.Store || Store);
const store = new StoreClass();

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

async function fetchURLWithRateLimitRetry(targetUrl, options) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchURL(targetUrl, options);
      if (response.status !== 429 || attempt === 2) return response;
      await new Promise(resolve => setTimeout(resolve, getRateLimitRetryDelay(response, attempt)));
    } catch (error) {
      const retryableNetworkError = /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_RESET|ERR_TIMED_OUT|EAI_AGAIN|ECONNRESET|ETIMEDOUT/.test(
        `${error.code || ''} ${error.message || ''}`
      );
      if (!retryableNetworkError || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw new Error('Request retry loop ended unexpectedly.');
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
ipcMain.handle('spherex:search-sia2', async (event, { collection = 'spherex_qr3', ra = 150.119, dec = 2.2058, radius = 0.1 }) => {
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
    const url = 'https://irsa.ipac.caltech.edu/TAP/sync';
    const params = new URLSearchParams({
      REQUEST: 'doQuery',
      LANG: 'ADQL',
      FORMAT: 'json',
      QUERY: adqlQuery
    });

    console.log(`[TAP API Request] ADQL: ${adqlQuery}`);
    const res = await fetchURLWithRateLimitRetry(url, {
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
  const rangeHeader = ranges.map(([start, end]) => `${start}-${end}`).join(',');
  const response = await axios.get(url, {
    headers: {
      Accept: 'application/fits, application/octet-stream',
      'Accept-Encoding': 'identity',
      Range: `bytes=${rangeHeader}`
    },
    responseType: 'arraybuffer',
    timeout: 45000,
    maxContentLength: 1024 * 1024,
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

async function getSpectrumHduLayout(product, url, image) {
  const release = product.uri.match(/\/(l2b-[^/]+)\/(\d+)\//);
  const cacheKey = release ? `${release[1]}/${release[2]}/${product.energyBandpass}` : null;
  const loadLayout = async () => {
    const flagsOffset = image.nextOffset;
    const flagsRange = await fetchFitsRange(url, [[flagsOffset, flagsOffset + 65535]]);
    const flagsHdu = parseFitsHeaderAt(flagsRange.data);
    if (flagsHdu.header.EXTNAME?.trim() !== 'FLAGS' || Number(flagsHdu.header.BITPIX) !== 32
        || Number(flagsHdu.header.NAXIS1) !== Number(image.header.NAXIS1)
        || Number(flagsHdu.header.NAXIS2) !== Number(image.header.NAXIS2)) {
      throw new Error('SPHEREx product does not contain a compatible FLAGS image.');
    }

    const varianceOffset = flagsOffset + flagsHdu.nextOffset;
    const varianceRange = await fetchFitsRange(url, [[varianceOffset, varianceOffset + 65535]]);
    const varianceHdu = parseFitsHeaderAt(varianceRange.data);
    if (varianceHdu.header.EXTNAME?.trim() !== 'VARIANCE' || Math.abs(Number(varianceHdu.header.BITPIX)) !== 32
        || Number(varianceHdu.header.NAXIS1) !== Number(image.header.NAXIS1)
        || Number(varianceHdu.header.NAXIS2) !== Number(image.header.NAXIS2)) {
      throw new Error('SPHEREx product does not contain a compatible VARIANCE image.');
    }

    return {
      flagsHeader: flagsHdu.header,
      flagsHeaderBytes: flagsHdu.dataOffset,
      flagsDataBytes: flagsHdu.dataBytes,
      varianceHeader: varianceHdu.header,
      varianceHeaderBytes: varianceHdu.dataOffset,
      varianceDataBytes: varianceHdu.dataBytes
    };
  };

  let layoutPromise = cacheKey ? spherexFitsLayoutCache.get(cacheKey) : null;
  if (!layoutPromise) {
    layoutPromise = loadLayout();
    if (cacheKey) spherexFitsLayoutCache.set(cacheKey, layoutPromise);
  }
  try {
    const layout = await layoutPromise;
    const flagsOffset = image.nextOffset;
    const flagsDataOffset = flagsOffset + layout.flagsHeaderBytes;
    const varianceOffset = flagsDataOffset + Math.ceil(layout.flagsDataBytes / 2880) * 2880;
    const varianceDataOffset = varianceOffset + layout.varianceHeaderBytes;
    if (cacheKey) {
      return {
        flagsHdu: { header: layout.flagsHeader, dataOffset: flagsDataOffset },
        varianceHdu: { header: layout.varianceHeader, dataOffset: varianceDataOffset }
      };
    }
    return {
      flagsHdu: { header: layout.flagsHeader, dataOffset: flagsDataOffset },
      varianceHdu: { header: layout.varianceHeader, dataOffset: varianceDataOffset }
    };
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
  const { flagsHdu, varianceHdu } = await getSpectrumHduLayout(product, url.toString(), image);

  const midpointMjd = (Number(product.mjdStart) + Number(product.mjdEnd)) / 2;
  if (!Number.isFinite(midpointMjd)) throw new Error('SPHEREx product is missing a valid observation date.');
  const trackedPosition = positionAtMjd(ra, dec, motion, midpointMjd);
  const pixel = skyToFitsPixel(image.header, trackedPosition.ra, trackedPosition.dec);
  const width = Number(image.header.NAXIS1);
  const height = Number(image.header.NAXIS2);
  const pixelX = Math.round(pixel.x);
  const pixelY = Math.round(pixel.y);
  if (pixelX < 1 || pixelX > width || pixelY < 1 || pixelY > height
      || Number(flagsHdu.header.NAXIS1) !== width || Number(flagsHdu.header.NAXIS2) !== height
      || Number(varianceHdu.header.NAXIS1) !== width || Number(varianceHdu.header.NAXIS2) !== height) {
    throw new Error('Selected coordinate is outside the SPHEREx detector image.');
  }

  const pixelIndex = (pixelY - 1) * width + (pixelX - 1);
  const imageValueOffset = image.dataOffset + pixelIndex * 4;
  const flagsValueOffset = flagsHdu.dataOffset + pixelIndex * 4;
  const varianceValueOffset = varianceHdu.dataOffset + pixelIndex * 4;
  const waveTailStart = fileSize - 5760;
  const ranges = [
    [imageValueOffset, imageValueOffset + 3],
    [flagsValueOffset, flagsValueOffset + 3],
    [varianceValueOffset, varianceValueOffset + 3],
    [waveTailStart, fileSize - 1]
  ];
  const sampled = await fetchFitsRange(url.toString(), ranges);
  const parts = parseMultipartRanges(sampled.data, sampled.contentType, ranges);
  const imageBytes = parts.get(imageValueOffset);
  const flagsBytes = parts.get(flagsValueOffset);
  const varianceBytes = parts.get(varianceValueOffset);
  const waveTail = parts.get(waveTailStart);
  const lookup = readWavelengthLookup(waveTail);
  const wavelength = interpolateWavelength(lookup, pixelX, pixelY);
  const flux = imageBytes.readFloatBE(0) * Number(image.header.BSCALE ?? 1) + Number(image.header.BZERO ?? 0);
  const flags = flagsBytes.readInt32BE(0);
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

ipcMain.handle('spherex:load-spectrum', async (event, { ra, dec, motion = null, requestId }) => {
  try {
    if (!Number.isFinite(ra) || ra < 0 || ra > 360 || !Number.isFinite(dec) || dec < -90 || dec > 90) {
      throw new Error('A valid sky coordinate is required to load SPHEREx spectra.');
    }
    if (motion && ['ra', 'dec', 'pmra', 'pmdec', 'refEpoch'].some(key => !Number.isFinite(motion[key]))) {
      throw new Error('Gaia proper-motion data for the target is incomplete.');
    }
    const reportProgress = progress => {
      if (typeof event.sender?.send === 'function' && !event.sender.isDestroyed?.()) {
        event.sender.send('spherex:spectrum-progress', { requestId, ...progress });
      }
    };

    const queryProducts = async detector => {
      const adqlQuery = `SELECT TOP 17 o.observationid, p.energy_bandpassname, p.time_bounds_lower, p.time_bounds_upper, a.uri, a.contentlength, o.collection FROM spherex.plane AS p JOIN spherex.artifact AS a ON p.planeid = a.planeid JOIN spherex.observation AS o ON p.obsid = o.obsid WHERE o.collection = 'spherex_qr2' AND p.calibrationlevel = 2 AND p.dataproducttype = 'image' AND a.producttype = 'science' AND p.time_bounds_lower IS NOT NULL AND p.time_bounds_upper IS NOT NULL AND p.energy_bandpassname = 'SPHEREx-${detector}' AND 1 = CONTAINS(POINT('ICRS', ${ra}, ${dec}), p.poly) ORDER BY p.time_bounds_lower DESC`;
      const params = new URLSearchParams({
        REQUEST: 'doQuery',
        LANG: 'ADQL',
        FORMAT: 'json',
        QUERY: adqlQuery
      });
      const response = await axios.post('https://irsa.ipac.caltech.edu/TAP/sync', params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SPHEREx-Electron-Tool/1.0'
        },
        timeout: 45000
      });
      const payload = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
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

    const detectorResults = [];
    let completedDetectors = 0;
    reportProgress({ phase: 'search', completedDetectors, totalDetectors: 6 });
    for (const detector of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']) {
      try {
        detectorResults.push({ detector, products: await queryProducts(detector) });
      } catch (error) {
        if (!isRetryableSpectrumError(error)) {
          detectorResults.push({ detector, error: error.message });
          continue;
        }
        await new Promise(resolve => setTimeout(resolve, 350));
        try {
          detectorResults.push({ detector, products: await queryProducts(detector) });
        } catch (retryError) {
          detectorResults.push({ detector, error: retryError.message });
        }
      }
      completedDetectors += 1;
      reportProgress({
        phase: 'search',
        completedDetectors,
        totalDetectors: 6,
        detector,
        productCount: detectorResults.at(-1).products?.length || 0
      });
    }
    const products = detectorResults.flatMap(result => result.products || []);
    if (products.length === 0) {
      const queryErrors = detectorResults.filter(result => result.error).map(result => `${result.detector}: ${result.error}`);
      return {
        success: false,
        error: queryErrors.length
          ? `SPHEREx spectrum searches failed (${queryErrors.join('; ')}).`
          : 'No calibrated SPHEREx QR2 detector images cover this coordinate.'
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

ipcMain.handle('spherex:query-gaia', async (event, { adqlQuery, requestId }) => {
  const tapUrl = 'https://gea.esac.esa.int/tap-server/tap';
  let jobUrl;
  const tapRequest = { requestId, cancelled: false, jobUrl: null };
  const previousRequest = activeGaiaTapRequest;
  activeGaiaTapRequest = tapRequest;
  if (previousRequest) {
    previousRequest.cancelled = true;
    void abortGaiaTapJob(previousRequest.jobUrl);
  }
  const isSuperseded = () => tapRequest.cancelled || activeGaiaTapRequest !== tapRequest;
  try {
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
        timeout: 20000,
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
        timeout: 20000,
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
    console.error('[Gaia TAP Error]', err.message);
    return { success: false, error: err.message };
  } finally {
    if (activeGaiaTapRequest === tapRequest) activeGaiaTapRequest = null;
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
