// @ts-check

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'vitest';

import {
    IO_CACHE_BENCHMARK_LAUNCHER,
    readMcpIoCacheProcessConfig,
    scheduleIoCacheBenchmarkWithDependencies,
} from '#copilot/testing/mcp/diagnostics/io-cache';

/** @param {number | undefined} pid */
function createFakeChild(pid) {
    const emitter = new EventEmitter();
    let unrefCalled = false;
    let killCalls = 0;
    const child = Object.assign(emitter, {
        pid,
        kill(signal) {
            killCalls += 1;
            queueMicrotask(() => emitter.emit('close', null, signal));
            return true;
        },
        unref() {
            unrefCalled = true;
        },
    });
    return {
        child: /** @type {import('node:child_process').ChildProcess} */ (/** @type {unknown} */ (child)),
        wasUnrefCalled: () => unrefCalled,
        killCalls: () => killCalls,
    };
}

describe('MCP IO-cache benchmark scheduler boundary', () => {
    it('accepts only after spawn and projects operational env without ambient credentials', async () => {
        const fake = createFakeChild(424242);
        /** @type {{ args?: readonly string[]; options?: import('node:child_process').SpawnOptions }} */
        const observed = {};
        const spawnChildImpl = (
            /** @type {string} */ _command,
            /** @type {readonly string[]} */ args,
            /** @type {import('node:child_process').SpawnOptions} */ options,
        ) => {
            observed.args = args;
            observed.options = options;
            queueMicrotask(() => fake.child.emit('spawn'));
            return fake.child;
        };
        const spawnChild = /** @type {typeof import('node:child_process').spawn} */ (
            /** @type {unknown} */ (spawnChildImpl)
        );

        const config = readMcpIoCacheProcessConfig({
            PATH: '/usr/bin:/bin',
            LANG: 'C.UTF-8',
            AURELIN_TEST_AMBIENT_SECRET: 'must-not-cross',
        });
        const scheduled = await scheduleIoCacheBenchmarkWithDependencies(
            { workspaceRoot: '/workspace', runnerEnvironment: config.runnerEnvironment },
            {
                createRequestId: () => 'mcp-io-cache-benchmark-12345678',
                spawnChild,
            },
        );

        assert.equal(scheduled.requestId, 'mcp-io-cache-benchmark-12345678');
        assert.equal(scheduled.runnerPid, 424242);
        assert.equal(fake.wasUnrefCalled(), true);
        assert.deepEqual(observed.args, [IO_CACHE_BENCHMARK_LAUNCHER, '--request-id', scheduled.requestId]);
        assert.equal(observed.options?.cwd, '/workspace');
        assert.equal(observed.options?.detached, true);
        const env = /** @type {NodeJS.ProcessEnv} */ (observed.options?.env);
        assert.equal(env['PATH'], '/usr/bin:/bin');
        assert.equal(env['LANG'], 'C.UTF-8');
        assert.equal(env['AURELIN_TEST_AMBIENT_SECRET'], undefined);
        assert.equal(Object.isFrozen(config), true);
        assert.equal(Object.isFrozen(config.runnerEnvironment), true);
    });

    it('rejects a launcher spawn error instead of reporting a detached task as accepted', async () => {
        const fake = createFakeChild(undefined);
        const spawnChild = /** @type {typeof import('node:child_process').spawn} */ (
            /** @type {unknown} */ (
                () => {
                    queueMicrotask(() => fake.child.emit('error', new Error('injected-spawn-failure')));
                    return fake.child;
                }
            )
        );

        await assert.rejects(
            scheduleIoCacheBenchmarkWithDependencies(
                {
                    workspaceRoot: '/workspace',
                    runnerEnvironment: readMcpIoCacheProcessConfig({ PATH: '/usr/bin:/bin' }).runnerEnvironment,
                },
                {
                    createRequestId: () => 'mcp-io-cache-benchmark-87654321',
                    spawnChild,
                },
            ),
            /injected-spawn-failure/u,
        );
        assert.equal(fake.wasUnrefCalled(), false);
    });

    it('terminates and drains a launcher when cancellation wins before acceptance', async () => {
        const fake = createFakeChild(424244);
        const controller = new AbortController();
        const spawnChild = /** @type {typeof import('node:child_process').spawn} */ (
            /** @type {unknown} */ (
                () => {
                    queueMicrotask(() => {
                        controller.abort(new Error('abort-before-io-cache-acceptance'));
                        fake.child.emit('spawn');
                    });
                    return fake.child;
                }
            )
        );

        await assert.rejects(
            scheduleIoCacheBenchmarkWithDependencies(
                {
                    workspaceRoot: '/workspace',
                    runnerEnvironment: readMcpIoCacheProcessConfig({ PATH: '/usr/bin:/bin' }).runnerEnvironment,
                    signal: controller.signal,
                },
                { createRequestId: () => 'mcp-io-cache-benchmark-cancel123', spawnChild },
            ),
            /abort-before-io-cache-acceptance/u,
        );
        assert.ok(fake.killCalls() >= 1);
        assert.equal(fake.wasUnrefCalled(), false);
    });

    it('does not spawn when the operation is already aborted', async () => {
        const controller = new AbortController();
        controller.abort(new Error('caller-aborted'));
        let spawnCalls = 0;
        const spawnChild = /** @type {typeof import('node:child_process').spawn} */ (
            /** @type {unknown} */ (
                () => {
                    spawnCalls += 1;
                    return createFakeChild(424243).child;
                }
            )
        );

        await assert.rejects(
            scheduleIoCacheBenchmarkWithDependencies(
                {
                    workspaceRoot: '/workspace',
                    runnerEnvironment: readMcpIoCacheProcessConfig({ PATH: '/usr/bin:/bin' }).runnerEnvironment,
                    signal: controller.signal,
                },
                { createRequestId: () => 'mcp-io-cache-benchmark-abcdefgh', spawnChild },
            ),
            /caller-aborted/u,
        );
        assert.equal(spawnCalls, 0);
    });
});
