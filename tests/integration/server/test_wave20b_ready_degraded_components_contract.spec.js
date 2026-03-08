// @ts-check
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import {
    clearRuntimeResources,
    getRuntimeReadinessSummary,
    setRuntimeResourceState,
} from '../../../src/core/runtime_resource_registry.js';
import app from '../../../src/server/engine/app.js';

function listen(/** @type {any} */ server) {
    return /** @type {Promise<void>} */ (
        new Promise((resolve, reject) => {
            server.listen(0, '127.0.0.1', (/** @type {any} */ err) => {
                if (err) reject(err);
                else resolve();
            });
        })
    );
}

function close(/** @type {any} */ server) {
    return /** @type {Promise<void>} */ (
        new Promise((resolve) => {
            server.close(() => resolve());
        })
    );
}

test('wave20b: /ready reporta status degraded com componentes opcionais indisponíveis', async () => {
    clearRuntimeResources('dashboard-web');
    setRuntimeResourceState('http_server', 'ready', {
        owner: 'dashboard-web',
        criticality: 'required',
    });
    setRuntimeResourceState('nerv_runtime', 'ready', {
        owner: 'dashboard-web',
        criticality: 'required',
    });
    setRuntimeResourceState('server_adapter', 'ready', {
        owner: 'dashboard-web',
        criticality: 'required',
    });
    setRuntimeResourceState('mcp_upstreams', 'degraded', {
        owner: 'dashboard-web',
        criticality: 'optional',
        reasonCode: 'UPSTREAM_UNREADY',
        message: 'Upstream obrigatório ainda em recuperação',
    });

    app.locals = app.locals || {};
    app.locals.runtimeReadiness = { nerv: true, serverAdapter: true, httpServer: true };
    app.locals.requiredReadiness = ['nerv', 'serverAdapter', 'httpServer'];
    app.locals.getRuntimeResourcesStatus = () =>
        getRuntimeReadinessSummary({
            owner: 'dashboard-web',
            requiredComponents: ['http_server', 'nerv_runtime', 'server_adapter'],
            allowDegradedReady: true,
        });

    const server = http.createServer(app);
    await listen(server);

    try {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : null;
        assert.ok(port, 'porta efêmera deve ser resolvida');

        const response = await fetch(`http://127.0.0.1:${port}/ready`);
        assert.equal(response.status, 200);

        const payload = await response.json();
        assert.equal(payload.status, 'degraded');
        assert.equal(payload.runtime_resources.status, 'degraded');
        assert.ok(
            Array.isArray(payload.runtime_resources.degraded_components) &&
                payload.runtime_resources.degraded_components.some(
                    (/** @type {any} */ item) => item.id === 'mcp_upstreams',
                ),
            'degraded_components deve incluir mcp_upstreams',
        );
    } finally {
        await close(server);
        clearRuntimeResources('dashboard-web');
    }
});
