#!/usr/bin/env node
'use strict';

const http = require('http');
const WebSocket = require('ws');

const HOST = process.env.CHROME_HOST || '127.0.0.1';
const PORT = Number(process.env.CHROME_PORT || process.argv[2] || 9225);
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
    } catch (e) {
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
