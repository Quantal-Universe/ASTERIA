#!/usr/bin/env bash
# Universal SPHEREx Research Tool Launcher for macOS & Linux
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "========================================================="
echo "  NASA SPHEREx Time-Domain Research Tool (Node 24 Launcher)"
echo "========================================================="

if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed or not in PATH."
    exit 1
fi

node launch.js
