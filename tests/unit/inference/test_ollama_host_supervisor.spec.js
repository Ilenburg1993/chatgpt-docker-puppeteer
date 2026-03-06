// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaHostSupervisor } from '../../../src/inference_gateway/ollama_host_supervisor.js';

test('supervisor marks ready on successful probe and emits state', async () => {
    /** @type {any[]} */ const events = [];
    const supervisor = createOllamaHostSupervisor({
        fetch: /** @type {any} */ (async () => ({
            ok: true,
            status: 200,
            async json() {
                return { version: '0.7.0' };
            },
        })),
        onStateChange: (/** @type {any} */ s) => { events.push(s.state); },
        setIntervalFn: () => /** @type {any} */ (1),
        clearIntervalFn: () => {},
    });

    await supervisor.start();
    const state = supervisor.getState();
    assert.equal(state.state, 'ready');
    assert.equal(state.last.version, '0.7.0');
    assert.ok(events.includes('ready'));
    await supervisor.stop();
});

test('supervisor opens circuit after repeated failures and reports degraded', async () => {
    let now = 1_000;
    const supervisor = createOllamaHostSupervisor({
        fetch: async () => {
            throw new Error('connect ECONNREFUSED');
        },
        retryEnabled: false,
        circuitThreshold: 2,
        circuitTimeoutMs: 10_000,
        now: () => now,
        setIntervalFn: () => /** @type {any} */ (1),
        clearIntervalFn: () => {},
    });

    await supervisor.start();
    await supervisor.pollOnce();
    now += 10;
    await supervisor.pollOnce();
    const state = supervisor.getState();
    assert.equal(state.state, 'degraded');
    assert.ok(state.circuitOpenUntil > now);
    assert.equal(state.reasonCode, 'OLLAMA_CIRCUIT_OPEN');
    await supervisor.stop();
});
