// @ts-check
import * as socketEngine from '#server/engine/socket';
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

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
    return /** @type {Promise<void>} */ (
        new Promise((resolve) => {
            server.close(() => resolve());
        })
    );
}

async function waitFor(/** @type {any} */ predicate, timeoutMs = 10000, intervalMs = 100) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Timeout waiting for condition (${timeoutMs}ms)`);
}

async function findAgentSocket(/** @type {any} */ io, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const sockets = await io.fetchSockets();
        const agentSocket = sockets.find((/** @type {any} */ socket) => Boolean(socket.robot_id));
        if (agentSocket) {
            return agentSocket;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Agent socket not found');
}

test('split mode survives reconnect storm (3 forced transport drops)', async (t) => {
    const httpServer = http.createServer((_, res) => {
        res.statusCode = 200;
        res.end('ok');
    });

    const port = await listenRandomPort(httpServer);
    socketEngine.init(/** @type {any} */ (httpServer));

    const adapter = await socketEngine.connectExternal(port);

    onTestFinished(async () => {
        try {
            adapter.disconnect();
        } catch {
            // ignore disconnect errors in teardown
        }
        try {
            await socketEngine.stop();
        } catch {
            // ignore hub stop errors in teardown
        }
        await closeServer(httpServer);
    });

    const io = socketEngine.getIO();
    assert.ok(io, 'io instance should exist');

    let reconnectConnectEvents = 0;
    adapter.on('connect', () => {
        reconnectConnectEvents++;
    });

    for (let i = 0; i < 3; i++) {
        const agentSocket = await findAgentSocket(io);

        if (agentSocket.client?.conn && typeof agentSocket.client.conn.close === 'function') {
            agentSocket.client.conn.close();
        } else {
            agentSocket.disconnect(true);
        }

        await waitFor(() => reconnectConnectEvents >= i + 1 && adapter.connected() === true, 10000);

        // jitter/backoff window entre quedas
        await new Promise((resolve) => setTimeout(resolve, 350));
    }

    // Após múltiplas quedas, conexão ainda deve ficar estável além do timeout de handshake.
    await new Promise((resolve) => setTimeout(resolve, 5500));
    assert.equal(adapter.connected(), true, 'connection should remain alive after reconnect storm');

    const registry = socketEngine.getRegistry();
    assert.ok(registry.length >= 1, 'registry should still contain authorized agent after reconnect storm');
});
