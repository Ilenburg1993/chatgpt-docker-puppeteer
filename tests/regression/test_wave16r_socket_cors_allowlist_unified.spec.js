// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('wave16r: socket CORS uses unified allowlist without permissive private-network regex', async () => {
    const socketPath = path.join(process.cwd(), 'src/server/engine/socket.js');
    const appPath = path.join(process.cwd(), 'src/server/engine/app.js');

    const [socketContent, appContent] = await Promise.all([
        fs.readFile(socketPath, 'utf8'),
        fs.readFile(appPath, 'utf8'),
    ]);

    assert.match(socketContent, /CONFIG\.ALLOWED_ORIGINS/);
    assert.match(appContent, /CONFIG\.ALLOWED_ORIGINS/);

    assert.doesNotMatch(socketContent, /172\\\.17\\\.0\\\./);
    assert.doesNotMatch(socketContent, /192\\\.168\\\./);
    assert.doesNotMatch(socketContent, /10\\\./);
    assert.doesNotMatch(socketContent, /host\\\.docker\\\.internal/);
    assert.doesNotMatch(socketContent, /docker\\\.internal/);
});
