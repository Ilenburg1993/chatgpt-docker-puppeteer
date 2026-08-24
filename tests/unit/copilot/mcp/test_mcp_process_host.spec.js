// @ts-check

import { createMcpProcessHost } from '#copilot/mcp/public/process/host';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

/** @template T */
function deferred() {
    /** @type {(value: T | PromiseLike<T>) => void} */
    let resolve = () => {
        throw new Error('deferred resolver was not installed');
    };
    /** @type {(reason?: unknown) => void} */
    let reject = () => {
        throw new Error('deferred rejecter was not installed');
    };
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

describe('MCP process host lifecycle owner', () => {
    it('prepares once, reference-counts leases and tears services down in reverse order', async () => {
        /** @type {string[]} */
        const events = [];
        let prepares = 0;
        const host = createMcpProcessHost({
            hostId: 'lease-host',
            prepare: async () => {
                prepares += 1;
                events.push('prepare');
                return () => {
                    events.push('dispose:prepare');
                };
            },
            services: [
                {
                    name: 'first',
                    start: async () => {
                        events.push('start:first');
                        return async () => {
                            events.push('stop:first');
                        };
                    },
                },
                {
                    name: 'second',
                    start: () => {
                        events.push('start:second');
                        return {
                            dispose: () => {
                                events.push('stop:second');
                            },
                        };
                    },
                },
            ],
        });

        const first = await host.acquire({ reason: 'http1' });
        const second = await host.acquire({ reason: 'http2' });
        assert.equal(prepares, 1);
        assert.deepEqual(events, ['prepare', 'start:first', 'start:second']);
        assert.deepEqual(host.snapshot(), {
            ...host.snapshot(),
            state: 'active',
            prepared: true,
            leaseCount: 2,
            starts: 1,
            stops: 0,
        });

        assert.equal(await first.release(), true);
        assert.equal(await first.release(), false);
        assert.equal(host.snapshot().state, 'active');
        assert.equal(host.snapshot().leaseCount, 1);
        assert.deepEqual(events, ['prepare', 'start:first', 'start:second']);

        assert.equal(await second.release(), true);
        assert.equal(host.snapshot().state, 'idle');
        assert.equal(host.snapshot().leaseCount, 0);
        assert.equal(host.snapshot().stops, 1);
        assert.deepEqual(events, ['prepare', 'start:first', 'start:second', 'stop:second', 'stop:first']);

        const restarted = await host.acquire({ reason: 'restarted-http1' });
        assert.equal(prepares, 1);
        assert.equal(host.snapshot().starts, 2);
        assert.deepEqual(events.slice(-2), ['start:first', 'start:second']);
        await restarted.release();
        await host.dispose();
        assert.equal(host.snapshot().state, 'disposed');
        assert.equal(host.snapshot().prepared, false);
        assert.equal(events.at(-1), 'dispose:prepare');
    });

    it('keeps optional service failure degraded but rolls back a required start failure', async () => {
        const optionalLogs = [];
        const optional = createMcpProcessHost({
            hostId: 'optional-host',
            log: (level, message, fields) => optionalLogs.push({ level, message, fields }),
            services: [
                {
                    name: 'optional',
                    start: async () => {
                        throw new Error('optional unavailable');
                    },
                },
                { name: 'required', required: true, start: () => () => {} },
            ],
        });
        const optionalLease = await optional.acquire();
        assert.equal(optional.snapshot().state, 'active');
        assert.equal(optional.snapshot().services.find((service) => service.name === 'optional')?.state, 'degraded');
        assert.match(
            optional.snapshot().services.find((service) => service.name === 'optional')?.lastError ?? '',
            /optional unavailable/u,
        );
        assert.equal(optionalLogs.length, 1);
        await optionalLease.release();

        /** @type {string[]} */
        const events = [];
        const required = createMcpProcessHost({
            hostId: 'required-host',
            services: [
                {
                    name: 'started-before-failure',
                    required: true,
                    start: () => {
                        events.push('start:first');
                        return () => {
                            events.push('rollback:first');
                        };
                    },
                },
                {
                    name: 'required-failure',
                    required: true,
                    start: async () => {
                        events.push('start:failure');
                        throw new Error('required unavailable');
                    },
                },
            ],
        });
        await assert.rejects(required.acquire(), /required unavailable/u);
        assert.equal(required.snapshot().state, 'start_failed');
        assert.equal(required.snapshot().leaseCount, 0);
        assert.deepEqual(events, ['start:first', 'start:failure', 'rollback:first']);
    });

    it('publishes stop_failed rather than claiming teardown completed', async () => {
        const host = createMcpProcessHost({
            hostId: 'failed-stop-host',
            services: [
                {
                    name: 'broken-close',
                    required: true,
                    start: () => async () => {
                        throw new Error('close failed');
                    },
                },
            ],
        });
        const lease = await host.acquire();
        await assert.rejects(lease.release(), /teardown failed/u);
        const snapshot = host.snapshot();
        assert.equal(snapshot.state, 'stop_failed');
        assert.equal(snapshot.leaseCount, 0);
        assert.match(snapshot.lastError ?? '', /teardown failed/u);
        assert.equal(snapshot.services[0]?.state, 'failed');
        await assert.rejects(host.acquire(), /unresolved teardown failure/u);
        await assert.rejects(host.dispose(), /cannot claim disposal after unresolved stop failure/u);
        assert.equal(host.snapshot().state, 'dispose_failed');
    });

    it('does not report disposal while prepare is still in flight', async () => {
        const preparation = deferred();
        let prepareFinished = false;
        const host = createMcpProcessHost({
            hostId: 'prepare-race-host',
            prepare: async () => {
                await preparation.promise;
                prepareFinished = true;
            },
        });

        const acquiring = host.acquire({ reason: 'racing-listener' });
        await new Promise((resolve) => setImmediate(resolve));
        const disposing = host.dispose();
        let disposeResolved = false;
        void disposing.then(() => {
            disposeResolved = true;
        });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(disposeResolved, false);
        assert.equal(prepareFinished, false);

        preparation.resolve(undefined);
        await disposing;
        assert.equal(prepareFinished, true);
        assert.equal(host.snapshot().state, 'disposed');
        await assert.rejects(acquiring, /is disposed/u);
    });
});
