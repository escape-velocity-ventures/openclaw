#!/usr/bin/env bash
# Remove \x1b[3J (clear scrollback) from pi-tui's fullRender to preserve terminal scrollback
# The screen still clears (\x1b[2J) but scrollback buffer is preserved.
TUI_JS="node_modules/@mariozechner/pi-tui/dist/tui.js"
if [ -f "$TUI_JS" ]; then
  sed -i '' 's/\\x1b\[3J\\x1b\[2J\\x1b\[H/\\x1b[2J\\x1b[H/' "$TUI_JS" 2>/dev/null || \
  sed -i 's/\\x1b\[3J\\x1b\[2J\\x1b\[H/\\x1b[2J\\x1b[H/' "$TUI_JS"
  echo "[patch-pi-tui] Removed scrollback clear from fullRender"
fi
