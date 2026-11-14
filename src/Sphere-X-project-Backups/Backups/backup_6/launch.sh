#!/usr/bin/env bash
# Universal ASTERIA Research Tool Launcher for macOS & Linux (Unix Based)
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

# Ensure Node 24 via nvm if available
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    . "$HOME/.nvm/nvm.sh"
    nvm install 24
    nvm use 24
fi

# Ensure local dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies locally..."
    npm install
fi

# Determine runtime
if command -v node &> /dev/null; then
    # Ensure it's using the right version
    RUNTIME="node"
else
    RUNTIME="ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron"
fi

# Check for auto-launch flag
if [ "$1" == "--auto-launch" ]; then
    echo "🚀 Launching ASTERIA..."
    $RUNTIME main.js
    exit 0
fi

# Clear screen and print the continuous top box frame and header
clear
cat << "EOF"
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║      ___    ____ _____ _____ ____ ___    _                ║
║     /   |  / ___|_   _| ____|  _ \_ _|  / \               ║
║    / /| | \___ \ | | |  _| | |_) | |  / _ \               ║
║   / ___ |  ___) || | | |___|  _ <| | / ___ \              ║
║  /_/  |_| |____/ |_| |_____|_| \_\___/_/   \_\            ║
║                                                           ║
║  ASTERIA Research Tool (Node 24 / Electron Launcher)      ║
║  Astronomical SPHEREx Time-series Extraction              ║
║  & Rapid Image Analysis                                   ║
║                                                           ║
╠═══════════════════════════════════════════════════════════╣
║  AVAILABLE COMMANDS:                                      ║
║   • about         - Display information about ASTERIA     ║
║   • log / logging - Start application & live logging      ║
║   • end / quit    - Exit the launcher (or press Ctrl+C)   ║
╠═══════════════════════════════════════════════════════════╣
EOF

# Global trap for clean exit when pressing Ctrl+C at the prompt or ending the script
cleanup() {
    printf "\r║ %-57s ║\n" "👋 Exiting ASTERIA Launcher..."
    printf "╚═══════════════════════════════════════════════════════════╝\n"
    exit 0
}
trap cleanup INT

# Continuous boxed session loop
while true; do
    # Draw the empty prompt line AND the bottom border underneath it, then move cursor back up 1 line
    printf "║ asteria> %-48s ║\n" ""
    printf "╚═══════════════════════════════════════════════════════════╝"
    tput cuu1
    printf "\r║ asteria> "
    
    read -r cmd

    # Rewrite the line you just typed with a clean right-hand border
    tput cuu1
    printf "\r║ asteria> %-48s ║\n" "$cmd"

    # Convert input to lowercase and trim whitespace
    cmd=$(echo "$cmd" | tr '[:upper:]' '[:lower:]' | xargs)

    case "$cmd" in
        about)
            printf "╠───────────────────────────────────────────────────────────╣\n"
            printf "║ %-57s ║\n" "ABOUT ASTERIA:"
            printf "║ %-57s ║\n" "Astronomical SPHEREx Time-series Extraction & Rapid"
            printf "║ %-57s ║\n" "Image Analysis (ASTERIA) is a time-domain research tool."
            printf "║ %-57s ║\n" "Use 'log' to start the engine and stream live output."
            printf "╠───────────────────────────────────────────────────────────╣\n"
            ;;

        launch)
            printf "╠───────────────────────────────────────────────────────────╣\n"
            printf "║ %-57s ║\n" "Launching ASTERIA manually..."
            printf "╚═══════════════════════════════════════════════════════════╝\n"
            $RUNTIME main.js
            exit 0
            ;;

        log|logging)
            printf "╠───────────────────────────────────────────────────────────╣\n"
            printf "║ %-57s ║\n" "Starting ASTERIA & Live Logging..."
            printf "║ %-57s ║\n" "Press Ctrl+C to stop logging and return to the box menu."
            printf "╚═══════════════════════════════════════════════════════════╝\n"
            
            # Intercept Ctrl+C temporarily so it only halts node and brings back the box menu
            trap 'printf "\n🛑 Logging stopped. Returning to box menu...\n"' INT
            
            eval "$RUNTIME launch.js"
            
            # Restore the master exit trap after node finishes
            trap cleanup INT
            
            printf "╔═══════════════════════════════════════════════════════════╗\n"
            ;;

        end|quit|exit)
            cleanup
            ;;

        "")
            # Overwrite blank Enter cleanly without duplicating lines
            tput cuu1
            ;;

        *)
            printf "║ %-57s ║\n" "❌ Unknown command: '$cmd'. Try 'about', 'log', or 'quit'."
            ;;
    esac
done
