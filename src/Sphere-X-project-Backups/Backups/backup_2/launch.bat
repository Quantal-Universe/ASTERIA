@echo off
REM Windows Double-Click Launcher for SPHEREx Research Tool
title NASA SPHEREx Time-Domain Research Tool Launcher
cd /d "%~dp0"

echo =========================================================
echo   NASA SPHEREx Time-Domain Research Tool (Node 24 Launcher)
echo =========================================================

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Error: Node.js is not installed or not found in PATH.
    pause
    exit /b 1
)

node launch.js
pause
