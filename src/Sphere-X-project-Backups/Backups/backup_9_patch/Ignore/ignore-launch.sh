# # #!/usr/bin/env bash
# # # Universal ASTERIA Research Tool Launcher for macOS & Linux (Unix Based)
# # DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
# # cd "$DIR"

# # # Verify Node.js is available
# # if ! command -v node &> /dev/null; then
# #     echo "❌ Error: Node.js is not installed or not in PATH."
# #     exit 1
# # fi

# # # Print the boxed ASCII banner and command menu
# # clear
# # cat << "EOF"
# # ╔═══════════════════════════════════════════════════════════╗
# # ║                                                           ║
# # ║      ___    ____ _____ _____ ____ ___    _                ║
# # ║     /   |  / ___|_   _| ____|  _ \_ _|  / \               ║
# # ║    / /| | \___ \ | | |  _| | |_) | |  / _ \               ║
# # ║   / ___ |  ___) || | | |___|  _ <| | / ___ \              ║
# # ║  /_/  |_| |____/ |_| |_____|_| \_\___/_/   \_\            ║
# # ║                                                           ║
# # ║  ASTERIA Research Tool (Node 24 Launcher)                 ║   
# # ║Astronomical SPHEREx Time-series Extraction                ║
# # ║& Rapid Image Analysis                                     ║
# # ║                                                           ║
# # ╠═══════════════════════════════════════════════════════════╣
# # ║  AVAILABLE COMMANDS:                                      ║
# # ║   • about         - Display information about ASTERIA     ║
# # ║   • log / logging - Start application & live logging      ║
# # ║   • end / quit    - Exit the launcher (or press Ctrl+C)   ║
# # ╚═══════════════════════════════════════════════════════════╝
# # EOF

# # # Exit cleanly if Ctrl+C is pressed at the main prompt #
# # trap 'echo -e "\n\n👋 Exiting ASTERIA Launcher..."; exit 0' INT

# # # Interactive command loop
# # while true; do
# #     echo ""
# #     read -rp "asteria> " cmd

# #     # Convert input to lowercase and trim whitespace #
# #     cmd=$(echo "$cmd" | tr '[:upper:]' '[:lower:]' | xargs)

# #     case "$cmd" in
# #         about)
# #             cat << "EOF"
# # ┌───────────────────────────────────────────────────────────┐
# # │ ABOUT ASTERIA                                             │
# # ├───────────────────────────────────────────────────────────┤
# # │ ASTERIA is a time-domain research and analysis tool       │
# # │ powered by Node.js. Use the 'log' command to start the    │
# # │ engine and stream live telemetry and execution output.    │
# # └───────────────────────────────────────────────────────────┘
# # EOF
# #             ;;

# #         log|logging)
# #             echo "┌───────────────────────────────────────────────────────────┐"
# #             echo "│ Starting ASTERIA & Live Logging...                        │"
# #             echo "│ Press Ctrl+C to stop logging and return to the menu.      │"
# #             echo "└───────────────────────────────────────────────────────────┘"
            
# #             # Temporarily intercept Ctrl+C so it only stops node, not this script #
# #             trap 'echo -e "\n🛑 Logging stopped. Returning to menu..."' INT
            
# #             node launch.js
            
# #             # Restore the main exit trap once node stops #
# #             trap 'echo -e "\n\n👋 Exiting ASTERIA Launcher..."; exit 0' INT
# #             ;;

# #         end|quit|exit)
# #             echo "👋 Exiting ASTERIA Launcher..."
# #             exit 0
# #             ;;

# #         "")
# #             # Do nothing if the user just hits Enter
# #             ;;

# #         *)
# #             echo "❌ Unknown command: '$cmd'. Try 'about', 'log', or 'quit'."
# #             ;;
# #     esac
# # done 
# #!/usr/bin/env bash
# # Universal ASTERIA Research Tool Launcher for macOS & Linux (Unix Based)
# DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
# cd "$DIR"

# # Check for Node.js, Electron, and node_modules
# if [ ! -d "node_modules" ] || [ ! -d "node_modules/electron" ]; then
#     echo "⚠️  Electron / node_modules not found."
    
#     if command -v npm &> /dev/null; then
#         echo "📦 Installing Electron & dependencies via npm..."
#         if [ -f "package.json" ]; then
#             npm install
#         else
#             npm install electron
#         fi
#     else
#         echo "❌ Error: Neither Electron (node_modules) nor Node.js/npm is installed."
#         echo "   Please install Node.js (https://nodejs.org) first so npm can fetch Electron."
#         exit 1
#     fi
# fi

# # Determine runtime (prefer global node, fallback to Electron's bundled Node runtime)
# if command -v node &> /dev/null; then
#     RUNTIME="node"
# elif [ -f "./node_modules/.bin/electron" ]; then
#     RUNTIME="ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron"
# else
#     echo "❌ Error: Could not locate a valid Node.js or Electron runtime."
#     exit 1
# fi

# # Print the boxed ASCII banner and command menu
# clear
# cat << "EOF"
# ╔═══════════════════════════════════════════════════════════╗
# ║                                                           ║
# ║      ___    ____ _____ _____ ____ ___    _                ║
# ║     /   |  / ___|_   _| ____|  _ \_ _|  / \               ║
# ║    / /| | \___ \ | | |  _| | |_) | |  / _ \               ║
# ║   / ___ |  ___) || | | |___|  _ <| | / ___ \              ║
# ║  /_/  |_| |____/ |_| |_____|_| \_\___/_/   \_\            ║
# ║                                                           ║
# ║  ASTERIA Research Tool (Node 24 / Electron Launcher)      ║
# ║  Astronomical SPHEREx Time-series Extraction              ║
# ║  & Rapid Image Analysis                                   ║
# ║                                                           ║
# ╠═══════════════════════════════════════════════════════════╣
# ║  AVAILABLE COMMANDS:                                      ║
# ║   • about         - Display information about ASTERIA     ║
# ║   • log / logging - Start application & live logging      ║
# ║   • end / quit    - Exit the launcher (or press Ctrl+C)   ║
# ╚═══════════════════════════════════════════════════════════╝
# EOF

# # Exit cleanly if Ctrl+C is pressed at the main prompt
# trap 'echo -e "\n\n👋 Exiting ASTERIA Launcher..."; exit 0' INT

# # Interactive command loop
# while true; do
#     echo ""
#     read -rp "asteria> " cmd

#     # Convert input to lowercase and trim whitespace
#     cmd=$(echo "$cmd" | tr '[:upper:]' '[:lower:]' | xargs)

#     case "$cmd" in
#         about)
#             cat << "EOF"
# ┌───────────────────────────────────────────────────────────┐
# │ ABOUT ASTERIA                                             │
# ├───────────────────────────────────────────────────────────┤
# │ Astronomical SPHEREx Time-series Extraction & Rapid       │
# │ Image Analysis (ASTERIA) is a time-domain research tool.  │
# │ Use 'log' to start the engine and stream live output.     │
# └───────────────────────────────────────────────────────────┘
# EOF
#             ;;

#         log|logging)
#             echo "┌───────────────────────────────────────────────────────────┐"
#             echo "│ Starting ASTERIA & Live Logging...                        │"
#             echo "│ Press Ctrl+C to stop logging and return to the menu.      │"
#             echo "└───────────────────────────────────────────────────────────┘"
            
#             # Temporarily intercept Ctrl+C so it only stops the app, not this script
#             trap 'echo -e "\n🛑 Logging stopped. Returning to menu..."' INT
            
#             eval "$RUNTIME launch.js"
            
#             # Restore the main exit trap once the app stops
#             trap 'echo -e "\n\n👋 Exiting ASTERIA Launcher..."; exit 0' INT
#             ;;

#         end|quit|exit)
#             echo "👋 Exiting ASTERIA Launcher..."
#             exit 0
#             ;;

#         "")
#             # Do nothing if the user just hits Enter
#             ;;

#         *)
#             echo "❌ Unknown command: '$cmd'. Try 'about', 'log', or 'quit'."
#             ;;
#     esac
# done
#!/usr/bin/env bash
# Universal ASTERIA Research Tool Launcher for macOS & Linux (Unix Based)
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

# Check for Node.js, Electron, and node_modules
if [ ! -d "node_modules" ] || [ ! -d "node_modules/electron" ]; then
    echo "⚠️  Electron / node_modules not found."
    
    if command -v npm &> /dev/null; then
        echo "📦 Installing Electron & dependencies via npm..."
        if [ -f "package.json" ]; then
            npm install
        else
            npm install electron
        fi
    else
        echo "❌ Error: Neither Electron (node_modules) nor Node.js/npm is installed."
        echo "   Please install Node.js (https://nodejs.org) first so npm can fetch Electron."
        exit 1
    fi
fi

# Determine runtime (prefer global node, fallback to Electron's bundled Node runtime)
if command -v node &> /dev/null; then
    RUNTIME="node"
elif [ -f "./node_modules/.bin/electron" ]; then
    RUNTIME="ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron"
else
    echo "❌ Error: Could not locate a valid Node.js or Electron runtime."
    exit 1
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
╚═══════════════════════════════════════════════════════════╝
EOF

# Global trap for clean exit when pressing Ctrl+C at the prompt or ending the script
cleanup() {
    echo -e "\n╚═══════════════════════════════════════════════════════════╝"
    echo "👋 Exiting ASTERIA Launcher..."
    exit 0
}
trap cleanup INT

# Continuous boxed session loop
while true; do
    echo -n "║ asteria> "
    read -r cmd

    # Convert input to lowercase and trim whitespace
    cmd=$(echo "$cmd" | tr '[:upper:]' '[:lower:]' | xargs)

    case "$cmd" in
        about)
            echo "╠───────────────────────────────────────────────────────────╣"
            echo "│ ABOUT ASTERIA:                                            │"
            echo "│ Astronomical SPHEREx Time-series Extraction & Rapid       │"
            echo "│ Image Analysis (ASTERIA) is a time-domain research tool.  │"
            echo "│ Use 'log' to start the engine and stream live output.     │"
            echo "╚═══════════════════════════════════════════════════════════╝"
            echo "╔═══════════════════════════════════════════════════════════╗"
            ;;

        log|logging)
            echo "╠───────────────────────────────────────────────────────────╣"
            echo "│ Starting ASTERIA & Live Logging...                        │"
            echo "│ Press Ctrl+C to stop logging and return to the box menu.  │"
            echo "╚═══════════════════════════════════════════════════════════╝"
            
            # Intercept Ctrl+C temporarily so it only halts node and brings back the box menu
            trap 'echo -e "\n🛑 Logging stopped. Returning to box menu..."; return 0' INT
            
            eval "$RUNTIME launch.js"
            
            # Restore the master exit trap after node finishes
            trap cleanup INT
            
            echo "╔═══════════════════════════════════════════════════════════╗"
            ;;

        end|quit|exit)
            cleanup
            ;;

        "")
            # Do nothing if user just presses Enter
            ;;

        *)
            echo "║ ❌ Unknown command: '$cmd'. Try 'about', 'log', or 'quit'."
            ;;
    esac
done