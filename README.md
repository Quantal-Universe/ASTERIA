## New version

- main.js: Fixed the electron-store initialization error by passing app.getPath('userData') safely inside app.whenReady(), ensuring configuration settings save correctly.  
- preload.js: Cleaned up the duplicate contextBridge blocks so that both your team's core NASA IRSA APIs (searchSIA2, queryTAP, resolveObject, fetchIBE) and OpenRouter AI handlers load together cleanly without overwriting each other.
- launch.js: Separated the standalone Node script launcher from Electron's backend environment to prevent runtime TypeError issues with ipcMain.   
- index.html: Fully styled with a high-end NASA-themed interface (Meatball/Worm colors, deep-space background star canvas, 102-band Chart.js spectral plotter, and live OpenRouter AI target insights).



# New frontend

The new frontend completely changes how logging into OPENROUTER and how star visualization works
<img width="1426" height="910" alt="image" src="https://github.com/user-attachments/assets/f6f81066-a086-4620-8650-6079fe57b885" />
