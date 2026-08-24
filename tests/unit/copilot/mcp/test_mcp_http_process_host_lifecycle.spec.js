// @ts-check

import { startHttpMcpServer } from '#copilot/mcp/public/adapters/http1';
import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import { createMcpProcessHost } from '#copilot/mcp/public/process/host';
import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';

/** @template T */
function deferred() {
    /** @type {(value: T | PromiseLike<T>) => void} */
    let resolve = () => {
        throw new Error('deferred resolver was not installed');
    };
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('MCP HTTP listener + process host lifecycle', () => {
    it('rejects listener startup without an explicit workspace authority', async () => {
        await assert.rejects(
            () => startHttpMcpServer({ host: '127.0.0.1', port: 0 }),
            /requires a composition-owned workspace capability/u,
        );
    });

    it('does not complete concurrent server.close callbacks before request/runtime teardown finishes', async () => {
        vi.stubEnv('COPILOT_MCP_AUTH_MODE', 'none-dev');
        vi.stubEnv('COPILOT_MCP_HTTP_STATEFUL_SESSIONS', 'false');
        const stopGate = deferred();
        let serviceStarts = 0;
        let serviceStops = 0;
        const processHost = createMcpProcessHost({
            hostId: 'http-listener-lifecycle-test',
            services: [
                {
                    name: 'owned-background-service',
                    required: true,
                    start: () => {
                        serviceStarts += 1;
                        return async () => {
                            serviceStops += 1;
                            await stopGate.promise;
                        };
                    },
                },
            ],
        });
        const workspace = createComposedMcpProcessHost({
            hostId: 'http-listener-lifecycle-workspace',
            backgroundServices: false,
        }).workspace;
        const server = await startHttpMcpServer({ host: '127.0.0.1', port: 0, processHost, workspace });
        assert.equal(serviceStarts, 1);
        assert.equal(processHost.snapshot().state, 'active');
        assert.equal(processHost.snapshot().leaseCount, 1);

        let closeCallbacks = 0;
        /** @type {Error[]} */
        const closeErrors = [];
        const firstClosed = new Promise((resolve) => {
            server.close((error) => {
                if (error) closeErrors.push(error);
                closeCallbacks += 1;
                resolve(undefined);
            });
        });
        const secondClosed = new Promise((resolve) => {
            server.close((error) => {
                if (error) closeErrors.push(error);
                closeCallbacks += 1;
                resolve(undefined);
            });
        });

        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(serviceStops, 1);
        assert.equal(closeCallbacks, 0);
        assert.equal(processHost.snapshot().state, 'stopping');

        stopGate.resolve(undefined);
        await Promise.all([firstClosed, secondClosed]);
        assert.deepEqual(closeErrors, []);
        assert.equal(closeCallbacks, 2);
        assert.equal(processHost.snapshot().state, 'idle');
        assert.equal(processHost.snapshot().leaseCount, 0);
        assert.equal(processHost.snapshot().stops, 1);

        await processHost.dispose();
        assert.equal(processHost.snapshot().state, 'disposed');
    });
});
