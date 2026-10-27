#!/bin/bash

# Prefer Node.js because /usr/local/bin/node is allowlisted in macOS firewall
# and handles mobile Safari speculative socket disconnects cleanly
if command -v node &>/dev/null; then
    exec node server.js "$@"
fi

# Fallback to Python if Node is not installed
PORT=${1:-8080}
while lsof -i :"$PORT" &>/dev/null; do
    PORT=$((PORT + 1))
done

LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")

echo "=========================================================="
echo "🚀 OpenSCAD Studio Local Server (Python Fallback)"
echo "💻 Desktop URL:  http://localhost:$PORT"
if [ "$LOCAL_IP" != "localhost" ]; then
echo "📱 Mobile URL:   http://$LOCAL_IP:$PORT  (same Wi-Fi network)"
fi
echo "=========================================================="
echo "Press Ctrl+C to stop the server."
echo ""

exec python3 -c "
import http.server, socketserver, sys

class SilentTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    def handle_error(self, request, client_address):
        exc_type, exc_val, exc_tb = sys.exc_info()
        # Suppress mobile Safari socket resets (Errno 57, 54, BrokenPipe)
        if isinstance(exc_val, (BrokenPipeError, ConnectionResetError)) or (isinstance(exc_val, OSError) and exc_val.errno in (54, 57, 32)):
            return
        super().handle_error(request, client_address)

handler = http.server.SimpleHTTPRequestHandler
handler.extensions_map.update({'.js': 'application/javascript', '.wasm': 'application/wasm'})
with SilentTCPServer(('0.0.0.0', $PORT), handler) as httpd:
    httpd.serve_forever()
"
