// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { __mainTestHooks } from '#main';

async function withEnv(/** @type {any} */ overrides, /** @type {any} */ fn) {
    const previous = new Map();

    for (const [key, value] of Object.entries(overrides)) {
        previous.set(key, process.env[key]);
        if (value === undefined || value === null) {
            delete process.env[key];
        } else {
            process.env[key] = String(value);
        }
    }

    try {
        return await fn();
    } finally {
        for (const [key, value] of previous.entries()) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

async function startHealthServer() {
    const server = http.createServer((req, res) => {
        if (req.url === '/health') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{"status":"ok"}');
            return;
        }

        res.writeHead(404);
        res.end();
    });

    await /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
        /** @type {any} */ (server).listen(0, 'localhost', (/** @type {any} */ err) => {
            if (err) reject(err);
            else resolve();
        });
    }));

    const address = server.address();
    if (!address || typeof address !== 'object') {
        throw new Error('failed to resolve ephemeral port for health server');
    }

    return {
        server,
        port: address.port,
        close: () =>
            /** @type {Promise<void>} */ (new Promise(resolve => {
                server.close(() => resolve());
            })),
    };
}

test('split retry tolerates transient connect failures and succeeds before max attempts', async () => {
    let attempts = 0;

    const fakeSocketModule = {
        connectExternal: async () => {
            attempts += 1;
            if (attempts < 3) {
                throw new Error('external server not ready yet');
            }

            return {
                on() {},
                off() {},
                emit() {},
                sendToClient() {
                    return true;
                },
            };
        },
    };

    await withEnv(
        {
            SPLIT_CONNECT_MAX_ATTEMPTS: '5',
            SPLIT_CONNECT_RETRY_BASE_MS: '10',
            SPLIT_CONNECT_RETRY_MAX_MS: '20',
            SPLIT_WAIT_HEALTH: 'false',
        },
        async () => {
            const socketHub = await __mainTestHooks.connectSplitExternalWithRetry(fakeSocketModule, 3008);
            assert.ok(socketHub, 'split helper should eventually return a socket hub');
        }
    );

    assert.equal(attempts, 3, 'helper should stop retrying after first successful connection');
});

test('split retry can gate connection on /health when SPLIT_WAIT_HEALTH=true', async () => {
    const healthServer = await startHealthServer();

    let connectCalls = 0;
    const fakeSocketModule = {
        connectExternal: async () => {
            connectCalls += 1;
            return {
                on() {},
                off() {},
                emit() {},
                sendToClient() {
                    return true;
                },
            };
        },
    };

    try {
        await withEnv(
            {
                SPLIT_CONNECT_MAX_ATTEMPTS: '3',
                SPLIT_CONNECT_RETRY_BASE_MS: '10',
                SPLIT_CONNECT_RETRY_MAX_MS: '20',
                SPLIT_WAIT_HEALTH: 'true',
            },
            async () => {
                const socketHub = await __mainTestHooks.connectSplitExternalWithRetry(
                    fakeSocketModule,
                    healthServer.port
                );
                assert.ok(socketHub, 'split helper should connect when health endpoint is available');
            }
        );

        assert.equal(connectCalls, 1, 'connectExternal should be called after health gate passes');
    } finally {
        await healthServer.close();
    }
});
