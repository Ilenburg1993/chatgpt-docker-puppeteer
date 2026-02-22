import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import * as promClient from 'prom-client';

import ChromeProxyService from '#infra/proxy/chromeProxyService';

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();

        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Unable to resolve a free TCP port')));
                return;
            }

            const { port } = address;
            server.close(err => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(port);
            });
        });
    });
}

test('wave5: chrome proxy installs and removes signal handlers deterministically', async () => {
    const previousNervIntegration = process.env.NERV_INTEGRATION;
    process.env.NERV_INTEGRATION = 'false';

    promClient.register.clear();

    let service;
    try {
        const proxyPort = await getFreePort();
        const sigintBefore = process.listenerCount('SIGINT');
        const sigtermBefore = process.listenerCount('SIGTERM');

        service = new ChromeProxyService({
            PROXY_PORT: proxyPort,
            CHROME_HOST: '127.0.0.1',
            CHROME_PORT: 9225,
            PROXY_BIND: '127.0.0.1',
            ALLOWED_ORIGINS: ['http://localhost:3000'],
            AUTO_HANDLE_SIGNALS: true,
            LOG_LEVEL: 'ERROR',
        });

        await service.start();

        assert.equal(process.listenerCount('SIGINT'), sigintBefore + 1);
        assert.equal(process.listenerCount('SIGTERM'), sigtermBefore + 1);

        await service.stop();

        assert.equal(process.listenerCount('SIGINT'), sigintBefore);
        assert.equal(process.listenerCount('SIGTERM'), sigtermBefore);
    } finally {
        if (service && service.server) {
            await service.stop().catch(() => {});
        }

        promClient.register.clear();

        if (previousNervIntegration === undefined) {
            delete process.env.NERV_INTEGRATION;
        } else {
            process.env.NERV_INTEGRATION = previousNervIntegration;
        }
    }
});

test('wave5: inline chrome proxy in main disables internal signal handlers', async () => {
    const mainPath = path.join(import.meta.dirname, '..', '..', 'src', 'main.js');
    const mainSource = await readFile(mainPath, 'utf-8');

    assert.match(mainSource, /AUTO_HANDLE_SIGNALS:\s*false/);
});
