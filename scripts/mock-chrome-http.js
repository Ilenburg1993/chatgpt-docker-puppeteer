#!/usr/bin/env node
// @ts-check
import http from 'node:http';
import { v4 as uuidv4 } from 'uuid';

// ✅ Padronizado: host.docker.internal (Docker/WSL-friendly)
// Para uso local direto (fora de Docker): CHROME_HOST=127.0.0.1 node scripts/mock-chrome-http.js
const host = process.env['MOCK_CHROME_HOST'] || process.env['CHROME_HOST'] || 'host.docker.internal';

// ✅ Validação de porta (0-65535)
const rawPort = process.env['MOCK_CHROME_PORT'] || process.env['CHROME_PORT'] || '9225';
const parsedPort = parseInt(rawPort, 10);
const port = Number.isFinite(parsedPort) && parsedPort >= 0 && parsedPort <= 65535 ? parsedPort : 9225;

if (parsedPort !== port) {
    console.warn(`[WARN] Invalid port "${rawPort}", using default: ${port}`);
}

const wsUrl = `ws://${host}:${port}/devtools/browser/${uuidv4()}`;

const server = http.createServer((req, res) => {
    if (req.url === '/json/version') {
        const body = {
            Browser: 'MockChrome/1.0',
            'Protocol-Version': '1.3',
            'User-Agent': 'MockBrowser/1.0',
            'V8-Version': '9.9.0',
            'WebKit-Version': '537.36',
            webSocketDebuggerUrl: wsUrl,
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
        return;
    }

    if (req.url === '/json/list' || req.url === '/json') {
        const body = [
            {
                id: '1',
                title: 'about:blank',
                type: 'page',
                url: 'https://example.com',
                webSocketDebuggerUrl: wsUrl,
            },
        ];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
});

server.listen(port, host, () => {
    console.log(`Mock Chrome HTTP server listening on http://${host}:${port}`);
    console.log(`/json/version -> webSocketDebuggerUrl: ${wsUrl}`);
});

function shutdown() {
    server.close(() => {
        console.log('Mock Chrome HTTP server stopped');
        process.exit(0);
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
