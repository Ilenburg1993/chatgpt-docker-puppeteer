// @ts-check

import { createCloudflareStateStore } from '#copilot/mcp/public/cloudflare/tunnel';
import {
    readMcpStartupMaintenanceConfig,
    readMcpStartupMaintenanceState,
    resetMcpStartupMaintenanceForTests,
    scheduleMcpStartupMaintenance,
    stopMcpStartupMaintenance,
} from '#copilot/testing/mcp/runtime/startup-maintenance';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'vitest';

/** @type {string[]} */
const tempDirs = [];

afterEach(async () => {
    resetMcpStartupMaintenanceForTests();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('MCP startup maintenance', () => {
    it('captures one immutable startup policy generation without ambient drift', () => {
        const env = {
            NODE_ENV: 'production',
            COPILOT_MCP_STARTUP_SMOKE_ENABLED: 'true',
            COPILOT_MCP_STARTUP_SMOKE_DELAY_MS: '4321',
        };
        const policy = readMcpStartupMaintenanceConfig(env);
        env.COPILOT_MCP_STARTUP_SMOKE_ENABLED = 'false';
        env.COPILOT_MCP_STARTUP_SMOKE_DELAY_MS = '9999';

        assert.equal(policy.enabled, true);
        assert.equal(policy.delayMs, 4_321);
        assert.equal(Object.isFrozen(policy), true);
    });

    it('schedules once and records the smoke result without blocking startup', async () => {
        /** @type {(() => void)[]} */
        const callbacks = [];
        const setTimeoutFn = /** @type {typeof setTimeout} */ (
            (/** @type {() => void} */ fn) => {
                callbacks.push(fn);
                return /** @type {NodeJS.Timeout} */ ({ unref() {} });
            }
        );
        const scheduled = scheduleMcpStartupMaintenance({
            enabled: true,
            delayMs: 0,
            setTimeoutFn,
            smokeRunner: async () => ({ success: true, status: 'ok' }),
            cleanupRunner: async () => ({ removed: true }),
            rollbackCleanupRunner: async () => ({ removed: 0, expiredRemoved: 0, budgetRemoved: 0 }),
            detachedLiveReaper: async () => ({ reapedCount: 2, failureCount: 0 }),
        });

        assert.equal(scheduled, true);
        assert.equal(scheduleMcpStartupMaintenance({ setTimeoutFn }), false);
        assert.equal(readMcpStartupMaintenanceState().scheduled, true);
        const callback = callbacks.shift();
        assert.ok(callback);
        callback();
        await new Promise((resolve) => setImmediate(resolve));
        const state = readMcpStartupMaintenanceState();
        assert.equal(state.completed, true);
        assert.equal(state.success, true);
        assert.equal(state.staleQuickTunnelStateRemoved, true);
        assert.equal(state.detachedLiveRunsReaped, 2);
        assert.equal(state.detachedLiveRunReaperFailures, 0);
    });

    it('stops an in-flight startup generation before later maintenance phases can run', async () => {
        /** @type {(() => void)[]} */
        const callbacks = [];
        /** @type {(value: { removed: boolean }) => void} */
        let releaseCleanup = () => {
            throw new Error('cleanup resolver was not installed');
        };
        let smokeCalls = 0;
        scheduleMcpStartupMaintenance({
            enabled: true,
            delayMs: 0,
            setTimeoutFn: /** @type {typeof setTimeout} */ (
                (/** @type {() => void} */ fn) => {
                    callbacks.push(fn);
                    return /** @type {NodeJS.Timeout} */ ({ unref() {} });
                }
            ),
            cleanupRunner: () =>
                new Promise((resolve) => {
                    releaseCleanup = resolve;
                }),
            rollbackCleanupRunner: async () => {
                throw new Error('stale startup generation must not reach rollback cleanup');
            },
            detachedLiveReaper: async () => {
                throw new Error('stale startup generation must not reach detached reaper');
            },
            smokeRunner: async () => {
                smokeCalls += 1;
                return { success: true };
            },
        });
        callbacks.shift()?.();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(readMcpStartupMaintenanceState().running, true);

        const stopping = stopMcpStartupMaintenance();
        releaseCleanup({ removed: false });
        await stopping;

        const state = readMcpStartupMaintenanceState();
        assert.equal(state.scheduled, false);
        assert.equal(state.running, false);
        assert.equal(state.completed, false);
        assert.equal(smokeCalls, 0);
    });

    it('keeps workspace smoke successful when detached live reaping fails non-fatally', async () => {
        /** @type {(() => void)[]} */
        const callbacks = [];
        const setTimeoutFn = /** @type {typeof setTimeout} */ (
            (/** @type {() => void} */ fn) => {
                callbacks.push(fn);
                return /** @type {NodeJS.Timeout} */ ({ unref() {} });
            }
        );
        const scheduled = scheduleMcpStartupMaintenance({
            enabled: true,
            delayMs: 0,
            setTimeoutFn,
            smokeRunner: async () => ({ success: true, status: 'ok' }),
            cleanupRunner: async () => ({ removed: false }),
            rollbackCleanupRunner: async () => ({ removed: 0, expiredRemoved: 0, budgetRemoved: 0 }),
            detachedLiveReaper: async () => {
                throw new Error('simulated detached reaper failure');
            },
        });

        assert.equal(scheduled, true);
        const callback = callbacks.shift();
        assert.ok(callback);
        callback();
        await new Promise((resolve) => setImmediate(resolve));
        const state = readMcpStartupMaintenanceState();
        assert.equal(state.completed, true);
        assert.equal(state.success, true);
        assert.equal(state.error, null);
        assert.equal(state.detachedLiveRunsReaped, 0);
        assert.equal(state.detachedLiveRunReaperFailures, 1);
    });

    it('removes only stale quick-tunnel state with a dead process', async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mcp-quick-state-'));
        tempDirs.push(tempDir);
        const stateFile = path.join(tempDir, 'quick.json');
        const state = {
            schemaVersion: 1,
            mode: 'temporary-trycloudflare',
            createdAt: new Date(1_000).toISOString(),
            pid: 999_999_999,
            originUrl: 'http://127.0.0.1:3333',
            publicBaseUrl: 'https://example.trycloudflare.com',
            connectorUrl: 'https://example.trycloudflare.com/mcp',
            transportProtocol: 'auto',
            stateFile,
            chatgpt: {
                name: 'test',
                description: 'test',
                mcpServerUrl: 'https://example.trycloudflare.com/mcp',
                authentication: 'OAuth',
            },
            smokeCommand: 'test',
        };
        await writeFile(stateFile, JSON.stringify(state), 'utf8');

        const result = await createCloudflareStateStore({
            stateFile,
            smokeStateFile: path.join(tempDir, 'connector-smoke.json'),
        }).cleanupStaleQuickTunnelState({ nowMs: 10_000, staleAfterMs: 1_000 });
        assert.equal(result.removed, true);
        await assert.rejects(readFile(stateFile, 'utf8'), /ENOENT/u);
    });
});
