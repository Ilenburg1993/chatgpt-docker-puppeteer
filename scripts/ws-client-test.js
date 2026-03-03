#!/usr/bin/env node'use strict';
// @ts-check

import WebSocket from 'ws';

const endpoint =
    process.argv[2] ||
    process.env.CHROME_WSE ||
    process.env.CHROME_WS_ENDPOINT ||
    `ws://127.0.0.1:${process.env.CHROME_PROXY_PORT || 9224}/devtools/page/1`;
const ws = new WebSocket(endpoint);

ws.on('open', () => {
    console.log('[ws-client] open', endpoint);
    ws.send(JSON.stringify({ id: 1, method: 'Target.getTargets' }));
});

ws.on('message', data => {
    console.log('[ws-client] message', data.toString());
    ws.close();
});

ws.on('close', () => {
    console.log('[ws-client] closed');
    process.exit(0);
});

ws.on('error', err => {
    console.error('[ws-client] error', err && err.message ? err.message : String(err));
    process.exit(1);
});
