#!/bin/bash
echo "Starting local server on http://localhost:8000"
if command -v python3 &>/dev/null; then
    python3 -m http.server 8000
elif command -v python &>/dev/null; then
    python -m http.server 8000
else
    npx serve . -p 8000
fi
