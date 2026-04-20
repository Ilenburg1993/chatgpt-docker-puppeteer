// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'vitest';

test('wave16r: dashboard socket rejects clients without JWT when auth is required', () => {
    const script = `
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import express from 'express';
import { io as ioClient } from 'socket.io-client';
import * as socketHub from '#server/engine/socket';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'wave16r_dashboard_socket_auth_required_secret_123456789';
process.env.DASHBOARD_SOCKET_AUTH_REQUIRED = 'true';
process.env.DASHBOARD_COMMANDS_ENABLED = 'false';

const app = express();
const server = http.createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
socketHub.init(server);

const client = ioClient('http://localhost:' + port, {
  transports: ['websocket'],
  auth: {},
  extraHeaders: { origin: 'http://localhost:3008' },
  reconnection: false
});

const authError = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('timeout waiting dashboard:auth:error')), 8000);
  client.once('dashboard:auth:error', payload => {
    clearTimeout(timeout);
    resolve(payload);
  });
});

assert.equal(authError.code, 'AUTH_TOKEN_MISSING');
client.disconnect();
await socketHub.stop();
await new Promise(resolve => server.close(resolve));
console.log('PASS');
`;

    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 30000,
    });

    assert.equal(result.status, 0, `subprocess must exit 0. stderr=${result.stderr || ''}`);
    assert.match(result.stdout || '', /PASS/);
});
