#!/usr/bin/env node'use strict';

import http from 'node:http';
import WebSocket from 'ws';

// ✅ Padronizado: host.docker.internal (Docker/WSL-friendly)
// Para uso local direto (fora de Docker): CHROME_HOST=127.0.0.1 node scripts/simulated-chrome.js
const HOST = process.env.CHROME_HOST || 'host.docker.internal';

// ✅ Validação de porta (0-65535)
const rawPort = process.env.CHROME_PORT || process.argv[2] || '9225';
const parsedPort = Number(rawPort);
const PORT = (Number.isFinite(parsedPort) && parsedPort >= 0 && parsedPort <= 65535) ? parsedPort : 9225;

if (parsedPort !== PORT) {
    console.warn(`[WARN] Invalid port "${rawPort}", using default: ${PORT}`);
}

const PATH = process.env.CHROME_WS_PATH || '/devtools/page/1';

const server = http.createServer((req, res) => {
  if (req.url === '/json/version' || req.url === '/json') {
    const json = {
      Browser: 'SimulatedChrome/1.0',
      'Protocol-Version': '1.3',
      webSocketDebuggerUrl: `ws://${HOST}:${PORT}${PATH}`
    };
    const body = JSON.stringify(json);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, req) => {
  console.log(`[sim-chrome] WS connection from ${req.socket.remoteAddress}`);
  ws.on('message', message => {
    console.log('[sim-chrome] received:', message.toString());
    try {
      const parsed = JSON.parse(message);
      const id = parsed && parsed.id ? parsed.id : null;
      const resp = { id, result: { echo: parsed } };
      ws.send(JSON.stringify(resp));
    } catch (_) {
      ws.send(JSON.stringify({ error: 'invalid json', raw: String(message) }));
    }
  });
  ws.on('close', () => console.log('[sim-chrome] ws closed'));
});

server.on('upgrade', (req, socket, head) => {
  if (req.url === PATH) {
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[sim-chrome] listening ${HOST}:${PORT}`);
});

process.on('SIGINT', () => {
  console.log('[sim-chrome] SIGINT, shutting down');
  server.close(() => process.exit(0));
});
