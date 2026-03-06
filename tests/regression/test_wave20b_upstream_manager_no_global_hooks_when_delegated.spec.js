// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';

import { registerUpstreams, shutdownUpstreams } from '../../src/integration/mcp/upstream-manager.mjs';

const registryStub = {
    has() {
        return false;
    },
    register() {},
};

function captureCounts(/** @type {any} */ events) {
    return Object.fromEntries(events.map((/** @type {any} */ event) => [event, process.listenerCount(event)]));
}

test('wave20b: registerUpstreams com installShutdownHook=false não instala listeners globais', async () => {
    const events = ['exit', 'SIGINT', 'SIGTERM'];
    await shutdownUpstreams();
    const before = captureCounts(events);

    try {
        await registerUpstreams(registryStub, {
            env: {
                MCP_UPSTREAM_ENABLED: 'true',
                MCP_UPSTREAM_URL: 'http://127.0.0.1:1',
                MCP_UPSTREAM_ALIAS: 'wave20b_dummy',
                MCP_UPSTREAM_RESTART_ENABLED: 'false',
            },
            installShutdownHook: false,
        });

        const afterRegister = captureCounts(events);
        assert.deepEqual(afterRegister, before, 'listeners globais devem permanecer inalterados');
    } finally {
        await shutdownUpstreams();
        const afterShutdown = captureCounts(events);
        assert.deepEqual(afterShutdown, before, 'shutdown deve manter contagem original de listeners');
    }
});
