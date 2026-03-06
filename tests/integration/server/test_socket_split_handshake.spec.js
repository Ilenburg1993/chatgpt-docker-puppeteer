// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as socketEngine from '#server/engine/socket';

function listenRandomPort(/** @type {any} */ server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve(address.port);
        });
    });
}

function closeServer(/** @type {any} */ server) {
    return /** @type {Promise<void>} */ (new Promise(resolve => {
        server.close(() => resolve());
    }));
}

test('split mode external connection performs handshake and remains connected', async () => {
    const httpServer = http.createServer((_, res) => {
        res.statusCode = 200;
        res.end('ok');
    });

    const port = await listenRandomPort(httpServer);
    socketEngine.init(/** @type {any} */ (httpServer));

    const adapter = await socketEngine.connectExternal(port);
    assert.equal(typeof adapter.sendToClient, 'function');
    assert.equal(adapter.connected(), true);

    // Guard against handshake-timeout disconnects (server timeout is 5s)
    await new Promise(resolve => setTimeout(resolve, 5500));
    assert.equal(adapter.connected(), true, 'connection should survive server handshake timeout window');

    adapter.disconnect();
    await socketEngine.stop();
    await closeServer(httpServer);
});
