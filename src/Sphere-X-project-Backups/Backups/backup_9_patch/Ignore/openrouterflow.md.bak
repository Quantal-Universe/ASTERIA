The OpenRouter OAuth PKCE flow allows your user-facing applications (like SPAs, mobile apps, or desktop clients) to securely obtain a user-controlled API key without managing their login credentials directly. [1] (https://marussy.com/pkce-authentication/), [2] (https://openrouter.ai/skills/openrouter-typescript-sdk)
The entire authentication flow is completed in three main steps:

Step 1: Generate a Challenge and Redirect the User

First, you must create a cryptographically secure code_verifier (a random high-entropy string) and hash it using SHA-256 to create a code_challenge. [1] (https://openrouter.ai/docs/guides/overview/auth/oauth), [2] (https://openrouter.ai/docs/client-sdks/typescript/sdks/oauth/README)
Once generated, redirect your user to the OpenRouter OAuth Page using the following URL structure: [1] (https://openrouter.ai/docs/guides/overview/auth/oauth)
text
https://openrouter.ai/auth
  ?callback_url=https://myapp.com/auth/callback
  &code_challenge=YOUR_SHA256_HASHED_CHALLENGE
  &code_challenge_method=S256
Use code with caution.
• callback_url: The URL where OpenRouter will send the user after they approve the authentication.
• code_challenge: The URL-safe, Base64-encoded SHA-256 hash of your verifier.
• code_challenge_method: Set this strictly to S256. [1] (https://openrouter.ai/docs/api/api-reference/oauth/create-authorization-code), [2] (https://openrouter.ai/docs/guides/overview/auth/oauth)

Step 2: Handle the Callback and Exchange the Code

After the user approves your app on OpenRouter, they will be redirected back to your callback_url with a temporary code appended to the query parameters: [1] (https://openrouter.ai/docs/api/api-reference/oauth/exchange-authorization-code-for-api-key), [2] (https://github.com/anomalyco/opencode/issues/7766)
text
https://myapp.com
Use code with caution.
Your application must immediately extract this code and make a backend POST request to exchange it for the user's permanent OpenRouter API key. [1] (https://openrouter.ai/docs/client-sdks/typescript/sdks/oauth/README), [2] (https://openrouter.ai/docs/api/api-reference/oauth/exchange-authorization-code-for-api-key)

HTTP Request Example [1] (https://openrouter.ai/docs/api/api-reference/oauth/exchange-authorization-code-for-api-key)

bash
curl --request POST \
  --url https://openrouter.ai/api/v1/auth/keys \
  --header 'Content-Type: application/json' \
  --data '{
    "code": "auth_code_abc123def456",
    "code_verifier": "your_original_unhashed_verifier_string",
    "code_challenge_method": "S256"
  }'
Use code with caution.

TypeScript SDK Example [1] (https://openrouter.ai/docs/client-sdks/typescript/sdks/oauth/README)

If you are using the official @openrouter/sdk, you can use the built-in OpenRouter OAuth helper methods to automate the exchange:
typescript
import { OpenRouter } from "@openrouter/sdk";

const openRouter = new OpenRouter();

async function completeAuth(authCode: string, originalVerifier: string) {
  const result = await openRouter.oAuth.exchangeAuthCodeForAPIKey({
    requestBody: {
      code: authCode,
      codeVerifier: originalVerifier,
      codeChallengeMethod: "S256",
    },
  });

  // The generated user-bound key is returned here
  console.log("User API Key:", result.key); 
}
Use code with caution.

Step 3: Use the Retreived API Key

The response from Step 2 will return a standard OpenRouter API key starting with sk-or-v1-.... You can now store this key locally in your application and pass it into the Authorization header for any standard LLM text generation requests: [1] (https://www.youtube.com/watch?v=88DEikbzvE4), [2] (https://openrouter.ai/docs/api/api-reference/oauth/exchange-authorization-code-for-api-key)
bash
Authorization: Bearer sk-or-v1-0e6f44a47a05...
Use code with caution.
To help give you the most accurate code snippets, what programming language or framework (e.g., React, Node.js, Python, Flutter) are you building your app with?
For Electron, this app uses OpenRouter's documented localhost callback support rather than a custom URI scheme. The main process listens on `http://localhost:3000/auth/callback`, forwards the callback to the renderer over IPC, and the renderer exchanges the code using the original PKCE verifier. The authorization URL remains `https://openrouter.ai/auth`.

2. Secure Preload Script (preload.js)

Expose a safe bridge via contextBridge to pass strings to and from the Renderer process without exposing Node internals. [1] (https://www.youtube.com/watch?v=b4y2Xe_FgZI&t=583)
javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openAuthBrowser: (url) => ipcRenderer.send('open-auth-browser', url),
  onOAuthCode: (callback) => ipcRenderer.on('oauth-code-received', (event, code) => callback(code))
});
Use code with caution.

3. Renderer / UI Implementation (renderer.js)

In your frontend script, you will perform the standard cryptographic generation of the verifier, listen for the incoming code, and complete the POST request to OpenRouter. [1] (https://openrouter.ai/docs/guides/overview/auth/oauth)
javascript
// Helper functions to generate PKCE challenge values
function generateVerifier() {
  const array = new Uint32Array(56);
  crypto.getRandomValues(array);
  return Array.from(array, dec => ('0' + dec.toString(16)).substr(-2)).join('');
}

async function generateChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+\$/, '');
}

let activeVerifier = '';

// Step 1: User clicks login
document.getElementById('login-btn').addEventListener('click', async () => {
  activeVerifier = generateVerifier();
  const challenge = await generateChallenge(activeVerifier);
  
  // Set your registered protocol string as the callback url
  const callbackUrl = 'myapp://auth-callback';
  const authUrl = `https://openrouter.ai{encodeURIComponent(callbackUrl)}&code_challenge=${challenge}&code_challenge_method=S256`;
  
  // Instruct Main Process to open the user's browser
  window.electronAPI.openAuthBrowser(authUrl);
});

// Step 2 & 3: Listen for code and exchange it
window.electronAPI.onOAuthCode(async (code) => {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code,
        code_verifier: activeVerifier,
        code_challenge_method: 'S256'
      })
    });

    const data = await response.json();
    if (data.key) {
      console.log('Successfully obtained OpenRouter Key:', data.key);
      // Store the key securely using safe desktop storage (e.g., keytar or encrypted store)
    }
  } catch (error) {
    console.error('Failed to exchange code:', error);
  }
});
Use code with caution.
Would you like assistance in implementing a local HTTP loopback server architecture instead of deep links, or do you need recommendations for safely storing the API key inside your Electron framework?
When building an Electron application that integrates OpenRouter, you must route your API traffic securely through Electron’s architecture.
Because an Electron app is a hybrid desktop application, exposing your OpenRouter API key directly in the UI layer (the Renderer process) creates a severe security risk. The correct package flow delegates all API communication to the backend layer (the Main process) and safely links it to the UI using a Preload script and Inter-Process Communication (IPC). [1] (https://medium.com/@kushanpabasara78/mastering-electron-js-febe7b421a35)

The Recommended Architecture Flow

[ Renderer Process (UI) ] 
       │
       ▼  (Invokes secure API wrapper exposed by preload)
[ Preload Script (Context Isolation) ]
       │
       ▼  (Sends ipcRenderer.invoke())
[ Main Process (Node.js/Backend) ] ───> Loads process.env.OPENROUTER_API_KEY
       │
       ▼  (Makes network request via @openrouter/sdk)
[ OpenRouter API Gateway ]

Step-by-Step Implementation Guide


1. Install Dependencies

In your Electron project root, install the official OpenRouter SDK as a production dependency. [1] (https://www.npmjs.com/package/@openrouter/sdk), [2] (https://openrouter.ai/developers)
bash
npm install @openrouter/sdk
Use code with caution.
(Alternatively, you can use the openai package and change the baseURL to https://openrouter.ai/api/v1). [1] (https://openrouter.ai/docs/quickstart), [2] (https://sevic.dev/tags/openrouter/)

2. The Main Process (main.js or index.js)

The Main process acts as your secure backend. It manages the app lifecycle, handles environment variables securely, and handles the actual OpenRouter API request. [1] (https://openrouter.ai/docs/cookbook/get-started/quickstart), [2] (https://medium.com/@kushanpabasara78/mastering-electron-js-febe7b421a35)
javascript
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { OpenRouter } = require('@openrouter/sdk');

// Initialize the OpenRouter client securely on the backend
// In production, load this from a secure configuration or encrypted local store
const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY || 'your-fallback-key-only-if-secure',
  httpReferer: 'https://github.com', // Optional tracking
  appTitle: 'My Electron AI App' 
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, // Crucial for security
      nodeIntegration: false  // Prevent UI from executing raw Node.js
    }
  });

  mainWindow.loadFile('index.html');
}

// Listen for the IPC call from the frontend
ipcMain.handle('openrouter:chat', async (event, payload) => {
  try {
    const response = await openrouter.chat.send({
      chatRequest: {
        model: payload.model || 'openrouter/auto', // Smart routing
        messages: payload.messages
      }
    });
    
    // Return the serializable text block back to the UI
    return { success: true, data: response.choices[0].message.content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

app.whenReady().then(createWindow);
Use code with caution.

3. The Preload Script (preload.js)

The preload script acts as a safe bridge. It uses contextBridge to expose an explicit, limited function to the frontend without exposing arbitrary Node.js APIs or IPC capabilities. [1] (https://medium.com/@kushanpabasara78/mastering-electron-js-febe7b421a35)
javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Expose a specific, scoped method to trigger the OpenRouter workflow
  sendToAI: (payload) => ipcRenderer.invoke('openrouter:chat', payload)
});
Use code with caution.

4. The Renderer Process UI (renderer.js / HTML)

Your frontend (React, Vue, or vanilla JS) calls the bridge function. It remains entirely decoupled from how the API keys are stored or how the network request is technically packaged. [1] (https://www.youtube.com/watch?v=11_x3_IV-yg)
javascript
const sendButton = document.getElementById('send-btn');
const inputField = document.getElementById('user-input');
const responseOutput = document.getElementById('output');

sendButton.addEventListener('click', async () => {
  const prompt = inputField.value;
  responseOutput.textContent = "Thinking...";

  // Call the secure bridge method exposed by the preload script
  const result = await window.electronAPI.sendToAI({
    model: 'google/gemini-2.5-flash', 
    messages: [{ role: 'user', content: prompt }]
  });

  if (result.success) {
    responseOutput.textContent = result.data;
  } else {
    responseOutput.textContent = `Error: ${result.error}`;
  }
});
Use code with caution.

Crucial Production & Packaging Checklist

• Environment Variable Storage: When compiling your app via Electron Forge or electron-builder, never hardcode your API key in the source files. If the app is public, you should implement an onboarding window inside the Electron app where users paste their own OpenRouter key, which you then save locally using an encrypted store (like electron-store). [1] (https://electronjs.org/docs/latest/tutorial/tutorial-packaging), [2] (https://electronjs.org/docs/latest/tutorial/application-distribution)
• ESM vs CommonJS Gotcha: The official @openrouter/sdk package natively prefers ESM (import/export). If your Electron app is configured to use legacy CommonJS (require), you may need to use dynamic imports (await import('@openrouter/sdk')) or fallback to the openai client package which has robust hybrid module support. [1] (https://sevic.dev/tags/openrouter/), [2] (https://openrouter.ai/docs/guides/community/render), [3] (https://openrouter.ai/docs/quickstart)
• UI Client Routing: If you are building a multi-screen chat interface using a UI router (like React Router), ensure you use HashRouter or MemoryRouter rather than BrowserRouter. Because Electron loads its UI directly from the file system (file:// protocol), a traditional browser router will cause navigation to break on reloads. [1] (https://stackoverflow.com/questions/36505404/how-to-use-react-router-with-electron), [2] (https://www.reddit.com/r/electronjs/comments/1pigazy/how_to_implement_routing_in_electron_app/)
To tailor this setup, let me know:
• Will users provide their own API keys, or will you host a backend proxy with a shared key?
• What frontend stack (React, Vue, Vanilla JS) are you using?
• Do you need assistance setting up streaming responses through Electron IPC?
