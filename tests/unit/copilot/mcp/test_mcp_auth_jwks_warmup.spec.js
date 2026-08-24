// @ts-check

import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, describe, it } from 'vitest';

import {
    readMcpAuthJwksWarmupState,
    scheduleMcpAuthJwksWarmup,
    stopMcpAuthJwksWarmup,
    warmMcpRemoteJwks,
} from '#copilot/mcp/public/auth';
import { resetMcpAuthJwksWarmupForTests, resetMcpAuthRuntimeForTests } from '#copilot/testing/mcp/auth';

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
        await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
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
        /** @type {{ value: (() => void) | undefined }} */
        const callback = { value: undefined };
        const scheduled = scheduleMcpAuthJwksWarmup({
            enabled: true,
            delayMs: 0,
            env: {},
            setTimeoutFn: (fn) => {
                callback.value = fn;
                return { unref() {} };
            },
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
        assert.ok(callback.value);
        callback.value();
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

    it('stops an in-flight warmup generation without publishing stale completion state', async () => {
        /** @type {{ value: (() => void) | undefined }} */
        const callback = { value: undefined };
        /** @type {(value: Awaited<ReturnType<typeof warmMcpRemoteJwks>>) => void} */
        let releaseWarmup = () => {
            throw new Error('warmup resolver was not installed');
        };
        scheduleMcpAuthJwksWarmup({
            enabled: true,
            delayMs: 0,
            env: {},
            setTimeoutFn: (fn) => {
                callback.value = fn;
                return { unref() {} };
            },
            warmupRunner: () =>
                new Promise((resolve) => {
                    releaseWarmup = resolve;
                }),
            logFn: () => {},
        });
        assert.ok(callback.value);
        callback.value();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(readMcpAuthJwksWarmupState().running, true);

        const stopping = stopMcpAuthJwksWarmup();
        releaseWarmup({
            ok: true,
            skipped: false,
            reason: null,
            jwksUri: 'https://stale.example/jwks.json',
            source: 'remote',
            keyCount: 1,
            durationMs: 1,
        });
        await stopping;

        const state = readMcpAuthJwksWarmupState();
        assert.equal(state.scheduled, false);
        assert.equal(state.running, false);
        assert.equal(state.completed, false);
        assert.equal(state.jwksUri, null);
    });

    it('records warmup failure without throwing into the HTTP startup path', async () => {
        /** @type {{ value: (() => void) | undefined }} */
        const callback = { value: undefined };
        scheduleMcpAuthJwksWarmup({
            enabled: true,
            delayMs: 0,
            env: {},
            setTimeoutFn: (fn) => {
                callback.value = fn;
                return { unref() {} };
            },
            warmupRunner: async () => {
                throw new Error('issuer unavailable');
            },
            logFn: () => {},
        });

        assert.ok(callback.value);
        callback.value();
        await new Promise((resolve) => setImmediate(resolve));
        const state = readMcpAuthJwksWarmupState();

        assert.equal(state.completed, true);
        assert.equal(state.success, false);
        assert.equal(state.error, 'issuer unavailable');
    });
});
