#!/usr/bin/env node

/**
 * SPHEREx Sky Survey Tool - Universal Cross-Platform Launcher
 * Works on macOS, Windows, and Linux.
 * Requires Node.js 24+
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

// 1. ENFORCE NODE 24+ REQUIREMENT
const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
console.log(`\n---------------------------------------------------------`);
console.log(`🌌 NASA SPHEREx Time-Domain Research Tool Launcher`);
console.log(`💻 Platform: ${os.type()} ${os.release()} (${os.arch()})`);
console.log(`🟢 Running Node.js v${process.versions.node}`);
console.log(`---------------------------------------------------------\n`);

if (nodeMajor < 24) {
  console.warn(`⚠️ WARNING: Node.js 24 is recommended for this project (Current: v${process.versions.node}).`);
}

const PROJECT_DIR = __dirname;
const ELECTRON_CLI = path.join(PROJECT_DIR, 'node_modules', 'electron', 'cli.js');


// 2. CHECK & AUTO-FIX ELECTRON BINARY IF MISSING
function ensureElectronInstalled() {
  let isInstalled = false;
  try {
    if (fs.existsSync(ELECTRON_CLI)) {
      const check = execSync('npx electron -v', { cwd: PROJECT_DIR, stdio: 'pipe' }).toString();
      if (check.includes('v')) {
        isInstalled = true;
      }
    }
  } catch (err) {
    isInstalled = false;
  }

  if (!isInstalled) {
    console.log('🔧 Electron binary not found or corrupted. Auto-installing foreground binary...');
    try {
      execSync('npm install electron@latest --foreground-scripts', { cwd: PROJECT_DIR, stdio: 'inherit' });
      console.log('✅ Electron binary installed successfully!\n');
    } catch (err) {
      console.error('❌ Failed to auto-install Electron via npm:', err.message);
    }
  }
}

// 3. FALLBACK LIGHTWEIGHT SERVER FOR HEADLESS / BROWSER RUNS
function startFallbackServer() {
  console.log('🌐 Starting Fallback HTTP Web Server on http://localhost:3000 ...');

  const server = http.createServer((req, res) => {
    let filePath = path.join(PROJECT_DIR, req.url === '/' ? 'index.html' : req.url);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(PROJECT_DIR, 'index.html');
    }

    const ext = path.extname(filePath);
    const contentTypes = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png'
    };

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end(`Server Error: ${err.message}`);
      } else {
        res.writeHead(200, {
          'Content-Type': contentTypes[ext] || 'text/plain',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(data);
      }
    });
  });

  server.listen(3000, () => {
    console.log('✨ SPHEREx Tool running at http://localhost:3000');

    // Auto-open browser
    const platform = process.platform;
    let startCmd = 'open';
    if (platform === 'win32') startCmd = 'start';
    else if (platform === 'linux') startCmd = 'xdg-open';

    try {
      execSync(`${startCmd} http://localhost:3000`);
    } catch (e) {
      console.log('Open http://localhost:3000 in your web browser.');
    }
  });
}

// 4. MAIN LAUNCH EXECUTION
function launchApp() {
  ensureElectronInstalled();

  console.log('🚀 Launching SPHEREx Desktop App via Electron...\n');

  const electronProcess = spawn('npx', ['electron', '.'], {
    cwd: PROJECT_DIR,
    stdio: 'inherit',
    shell: true
  });

  electronProcess.on('error', (err) => {
    console.error('⚠️ Could not launch Electron desktop UI:', err.message);
    startFallbackServer();
  });
  electronProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`⚠️ Electron exited with code ${code}. Falling back to Web Server...`);
      startFallbackServer();
    } else {
      console.log('👋 SPHEREx Research Tool session closed.');
    }
  });
}

// Execute Launcher
launchApp();