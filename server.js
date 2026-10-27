const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { networkInterfaces } = require('node:os');

const requestedPort = parseInt(process.argv[2] || process.env.PORT || '8080', 10);

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.stl': 'model/stl',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function getLocalIp() {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'no-cache');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    let reqPath = decodeURI(req.url.split('?')[0]);
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

    const safePath = path.normalize(path.join(__dirname, reqPath));
    if (!safePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.stat(safePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(safePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stats.size
        });

        const stream = fs.createReadStream(safePath);
        stream.pipe(res);
        stream.on('error', () => {
            if (!res.headersSent) {
                res.writeHead(500);
                res.end();
            }
        });
    });
});

// Silently ignore speculative pre-connections and aborted sockets common on mobile Safari
server.on('clientError', (err, socket) => {
    if (['ECONNRESET', 'EPIPE', 'HPE_INVALID_METHOD', 'ERR_HTTP_REQUEST_TIMEOUT'].includes(err.code)) {
        return;
    }
    socket.destroy(err);
});

function startServer(port) {
    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`Port ${port} is in use, trying port ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('Server error:', err);
        }
    });

    server.listen(port, '0.0.0.0', () => {
        const localIp = getLocalIp();
        console.log('==========================================================');
        console.log('🚀 OpenSCAD Studio Local Server');
        console.log(`💻 Desktop URL:  http://localhost:${port}`);
        if (localIp !== 'localhost') {
            console.log(`📱 Mobile URL:   http://${localIp}:${port}  (same Wi-Fi network)`);
        }
        console.log('==========================================================');
        console.log('Press Ctrl+C to stop.');
    });
}

startServer(requestedPort);
