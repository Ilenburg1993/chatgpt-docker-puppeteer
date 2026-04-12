// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('wave16r: dashboard command channel is disabled by default', () => {
    const script = `
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import { io as ioClient } from 'socket.io-client';
import * as socketHub from '#server/engine/socket';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'wave16r_dashboard_command_disabled_secret_123456789';
process.env.DASHBOARD_SOCKET_AUTH_REQUIRED = 'true';
process.env.DASHBOARD_COMMANDS_ENABLED = 'false';
process.env.DASHBOARD_COMMAND_ROLE = 'admin';

const app = express();
const server = http.createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
socketHub.init(server);

const token = jwt.sign(
  { id: 'admin', username: 'admin', role: 'admin', jti: 'jti-wave16r' },
  process.env.JWT_SECRET,
  { algorithm: 'HS256', expiresIn: '1h' }
);

const client = ioClient('http://localhost:' + port, {
  transports: ['websocket'],
  auth: { token },
  extraHeaders: { origin: 'http://localhost:3008' },
  reconnection: false
});

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('timeout waiting connect')), 8000);
  client.once('connect', () => {
    clearTimeout(timeout);
    resolve();
  });
});

let forwarded = false;
const handler = () => {
  forwarded = true;
};
socketHub.on('dashboard:command', handler);

client.emit('dashboard:command', { action: 'TASK_ABORT', task_id: 'task-wave16r' });

const errorPayload = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('timeout waiting dashboard:command:error')), 8000);
  client.once('dashboard:command:error', payload => {
    clearTimeout(timeout);
    resolve(payload);
  });
});

assert.equal(errorPayload.code, 'COMMAND_CHANNEL_DISABLED');
await new Promise(resolve => setTimeout(resolve, 100));
assert.equal(forwarded, false);

socketHub.off('dashboard:command', handler);
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
