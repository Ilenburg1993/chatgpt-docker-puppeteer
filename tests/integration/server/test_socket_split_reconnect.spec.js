// @ts-check
import * as socketEngine from '#server/engine/socket';
import assert from 'node:assert/strict';
import http from 'node:http';

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

test('split mode reconnects and reauthorizes handshake after forced disconnect', async (t) => {
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

    assert.equal(adapter.connected(), true);

    const io = socketEngine.getIO();
    assert.ok(io, 'io instance should be initialized');

    const sockets = await io.fetchSockets();
    const agentSocket = sockets.find((/** @type {any} */ socket) => Boolean(socket.robot_id));
    assert.ok(agentSocket, 'authorized agent socket should exist');

    let reconnectConnectEvents = 0;
    adapter.on('connect', () => {
        reconnectConnectEvents++;
    });

    // Simula queda de transporte para forçar ciclo de reconexão do client.
    if (agentSocket.client?.conn && typeof agentSocket.client.conn.close === 'function') {
        agentSocket.client.conn.close();
    } else {
        agentSocket.disconnect(true);
    }

    await waitFor(() => reconnectConnectEvents >= 1 && adapter.connected() === true, 10000);

    // Garante que após a janela de timeout de handshake (5s), a conexão continua viva.
    await new Promise((resolve) => setTimeout(resolve, 5500));
    assert.equal(adapter.connected(), true, 'connection must remain authorized after reconnect handshake');

    const registry = socketEngine.getRegistry();
    assert.ok(registry.length >= 1, 'agent should be present in registry after reconnection');
});
