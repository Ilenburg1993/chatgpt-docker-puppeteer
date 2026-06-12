// @ts-check

import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, describe, it } from 'vitest';

import {
    readMcpAuthJwksWarmupState,
    resetMcpAuthJwksWarmupForTests,
    resetMcpAuthRuntimeForTests,
    scheduleMcpAuthJwksWarmup,
    warmMcpRemoteJwks,
} from '#copilot/mcp/control-plane';

/** @type {http.Server[]} */
const servers = [];

afterEach(async () => {
    resetMcpAuthJwksWarmupForTests();
    resetMcpAuthRuntimeForTests();
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('MCP auth JWKS warmup', () => {
    it('preloads the configured JWKS once and reuses the fresh resolver', async () => {
        let requests = 0;
        const server = http.createServer((_request, response) => {
            requests += 1;
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ keys: [] }));
        });
        servers.push(server);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        const issuer = `http://127.0.0.1:${address.port}`;
        const env = {
            COPILOT_MCP_AUTH_MODE: 'oauth',
            COPILOT_MCP_AUTH_ENFORCEMENT: 'all',
            COPILOT_MCP_PUBLIC_URL: issuer,
            COPILOT_MCP_OAUTH_EXPECTED_ISSUER: issuer,
            COPILOT_MCP_OAUTH_AUDIENCE: issuer,
            COPILOT_MCP_OAUTH_JWKS_URI: `${issuer}/jwks.json`,
        };

        const first = await warmMcpRemoteJwks({ env });
        const second = await warmMcpRemoteJwks({ env });

        assert.equal(first.ok, true);
        assert.equal(first.source, 'remote');
        assert.equal(first.keyCount, 0);
        assert.equal(second.source, 'cache');
        assert.equal(requests, 1);
    });

    it('schedules once and records a successful non-blocking warmup', async () => {
        /** @type {(() => void) | null} */
        let callback = null;
        const scheduled = scheduleMcpAuthJwksWarmup({
            enabled: true,
            delayMs: 0,
            env: {},
            setTimeoutFn: /** @type {typeof setTimeout} */ ((fn) => {
                callback = /** @type {() => void} */ (fn);
                return /** @type {NodeJS.Timeout} */ ({ unref() {} });
            }),
            warmupRunner: async () => ({
                ok: true,
                skipped: false,
                reason: null,
                jwksUri: 'https://issuer.example/jwks.json',
                source: 'remote',
                keyCount: 2,
                durationMs: 12,
            }),
        });

        assert.equal(scheduled, true);
        assert.equal(scheduleMcpAuthJwksWarmup({ enabled: true }), false);
        assert.ok(callback);
        callback();
        await new Promise((resolve) => setImmediate(resolve));

        const state = readMcpAuthJwksWarmupState();
        assert.equal(state.scheduled, false);
        assert.equal(state.running, false);
        assert.equal(state.completed, true);
        assert.equal(typeof state.scheduledAt, 'string');
        assert.equal(typeof state.startedAt, 'string');
        assert.equal(typeof state.completedAt, 'string');
        assert.equal(state.success, true);
        assert.equal(state.skipped, false);
        assert.equal(state.reason, null);
        assert.equal(state.jwksUri, 'https://issuer.example/jwks.json');
        assert.equal(state.source, 'remote');
        assert.equal(state.keyCount, 2);
        assert.equal(state.durationMs, 12);
        assert.equal(state.delayMs, 0);
        assert.equal(state.error, null);
    });

    it('records warmup failure without throwing into the HTTP startup path', async () => {
        /** @type {(() => void) | null} */
        let callback = null;
        scheduleMcpAuthJwksWarmup({
            enabled: true,
            delayMs: 0,
            env: {},
            setTimeoutFn: /** @type {typeof setTimeout} */ ((fn) => {
                callback = /** @type {() => void} */ (fn);
                return /** @type {NodeJS.Timeout} */ ({ unref() {} });
            }),
            warmupRunner: async () => {
                throw new Error('issuer unavailable');
            },
            logFn: () => {},
        });

        assert.ok(callback);
        callback();
        await new Promise((resolve) => setImmediate(resolve));
        const state = readMcpAuthJwksWarmupState();

        assert.equal(state.completed, true);
        assert.equal(state.success, false);
        assert.equal(state.error, 'issuer unavailable');
    });
});
