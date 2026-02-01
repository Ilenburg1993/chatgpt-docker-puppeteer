#!/usr/bin/env node
// Simple HTTP mock that serves Chrome DevTools JSON endpoints used by ConnectionOrchestrator
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const port = parseInt(process.env.MOCK_CHROME_PORT || process.env.CHROME_PORT || '9225', 10);
const host = process.env.MOCK_CHROME_HOST || process.env.CHROME_HOST || '127.0.0.1';
const wsUrl = `ws://${host}:${port}/devtools/browser/${uuidv4()}`;

const server = http.createServer((req, res) => {
    if (req.url === '/json/version') {
        const body = {
            Browser: 'MockChrome/1.0',
            'Protocol-Version': '1.3',
            'User-Agent': 'MockBrowser/1.0',
            'V8-Version': '9.9.0',
            'WebKit-Version': '537.36',
            webSocketDebuggerUrl: wsUrl
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
                webSocketDebuggerUrl: wsUrl
            }
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
