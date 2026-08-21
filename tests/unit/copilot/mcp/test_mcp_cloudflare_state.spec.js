// @ts-check
/**
 * Cloudflare quick tunnel runtime state summaries.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';

import { createCloudflareStateStore, summarizeQuickTunnelState } from '#copilot/mcp/cloudflare';

/** @type {import('#copilot/mcp/cloudflare').QuickTunnelState} */
const baseState = {
    schemaVersion: 1,
    mode: 'temporary-trycloudflare',
    createdAt: '2026-05-22T12:00:00.000Z',
    pid: process.pid,
    originUrl: 'http://127.0.0.1:3333',
    publicBaseUrl: 'https://alpha-beta-gamma.trycloudflare.com',
    connectorUrl: 'https://alpha-beta-gamma.trycloudflare.com/mcp',
    transportProtocol: 'http2',
    stateFile: 'src/copilot/.ai/cloudflare/quick-tunnel.json',
    chatgpt: {
        name: 'Repo DevContainer MCP',
        description: 'Test connector',
        mcpServerUrl: 'https://alpha-beta-gamma.trycloudflare.com/mcp',
        authentication: 'none-dev',
    },
    smokeCommand: 'npm run copilot:mcp:cloudflare:smoke',
};

describe('copilot MCP Cloudflare quick tunnel state', () => {
    it('recommends starting a tunnel when no state file exists', () => {
        const summary = summarizeQuickTunnelState(undefined, Date.parse(baseState.createdAt), 60000);

        assert.equal(summary.configured, false);
        assert.equal(summary.stateValid, false);
        assert.equal(summary.recommendedAction, 'start');
        assert.equal(summary.connectorUrl, null);
    });

    it('recommends restarting when the state file is invalid', () => {
        const summary = summarizeQuickTunnelState(
            { error: 'Invalid Cloudflare quick tunnel state file.' },
            Date.parse(baseState.createdAt),
            60000,
        );

        assert.equal(summary.configured, true);
        assert.equal(summary.stateValid, false);
        assert.equal(summary.recommendedAction, 'restart');
        assert.match(String(summary.stateError), /Invalid Cloudflare/);
    });

    it('recommends smoke-checking an alive but stale temporary tunnel', () => {
        const summary = summarizeQuickTunnelState(baseState, Date.parse('2026-05-22T12:10:00.000Z'), 5 * 60 * 1000);

        assert.equal(summary.stateValid, true);
        assert.equal(summary.processAlive, true);
        assert.equal(summary.stale, true);
        assert.equal(summary.recommendedAction, 'smoke');
        assert.equal(summary.ageMinutes, 10);
        assert.equal(summary.connectorUrl, baseState.connectorUrl);
    });

    it('recommends direct use for an alive fresh temporary tunnel', () => {
        const summary = summarizeQuickTunnelState(baseState, Date.parse('2026-05-22T12:01:00.000Z'), 5 * 60 * 1000);

        assert.equal(summary.stateValid, true);
        assert.equal(summary.processAlive, true);
        assert.equal(summary.stale, false);
        assert.equal(summary.recommendedAction, 'use');
        assert.equal(summary.ageSeconds, 60);
    });

    it('summarizes and persists the last successful remote smoke', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-mcp-cloudflare-state-'));
        const stateFile = path.join(dir, 'quick-tunnel.json');
        const stateStore = createCloudflareStateStore({
            stateFile,
            smokeStateFile: path.join(dir, 'connector-smoke.json'),
        });
        await fs.writeFile(stateFile, `${JSON.stringify(baseState, null, 2)}\n`, 'utf8');

        const updated = await stateStore.updateQuickTunnelLastSmoke(baseState, {
            checkedAt: '2026-05-22T12:02:00.000Z',
            ok: true,
            connectorUrl: baseState.connectorUrl,
            health: { ok: true, status: 200 },
            toolsList: {
                ok: true,
                status: 200,
                tools: 33,
                expectedLocalTools: 33,
                toolsMatchLocalRegistry: true,
                criticalToolsPresent: true,
                missingCriticalTools: [],
                missingLocalTools: [],
                unexpectedRemoteTools: [],
            },
        });
        assert.equal(updated, true);

        const persisted = await stateStore.readQuickTunnelState();
        const summary = summarizeQuickTunnelState(persisted, Date.parse('2026-05-22T12:05:00.000Z'), 10 * 60 * 1000);

        assert.equal(summary.lastSmokeOk, true);
        assert.equal(summary.lastSmokeAt, '2026-05-22T12:02:00.000Z');
        assert.equal(summary.lastSmokeAgeMinutes, 3);
        assert.equal(summary.lastSmokeConnectorUrl, baseState.connectorUrl);
    });

    it('atomically serializes concurrent state writes with private permissions', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-mcp-cloudflare-state-atomic-'));
        const stateFile = path.join(dir, 'quick-tunnel.json');
        const stateStore = createCloudflareStateStore({
            stateFile,
            smokeStateFile: path.join(dir, 'connector-smoke.json'),
        });
        try {
            await Promise.all(
                Array.from({ length: 20 }, (_, index) =>
                    stateStore.saveQuickTunnelState({
                        ...baseState,
                        connectorUrl: `${baseState.connectorUrl}?writer=${index}`,
                    }),
                ),
            );

            const persisted = await stateStore.readQuickTunnelState();
            assert.ok(persisted && !('error' in persisted));
            assert.match(persisted.connectorUrl, /\?writer=\d+$/u);
            assert.equal((await fs.stat(stateFile)).mode & 0o777, 0o600);
            assert.equal(
                (await fs.readdir(dir)).some((name) => name.startsWith('quick-tunnel.json.') && name.endsWith('.tmp')),
                false,
            );
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it('ignores last smoke metadata from a different connector URL', () => {
        const summary = summarizeQuickTunnelState(
            {
                ...baseState,
                lastSmoke: {
                    checkedAt: '2026-05-22T12:02:00.000Z',
                    ok: true,
                    connectorUrl: 'https://mcp.aurelin.org/mcp',
                    health: { ok: true, status: 200 },
                    toolsList: {
                        ok: true,
                        status: 200,
                        tools: 67,
                        expectedLocalTools: 67,
                        toolsMatchLocalRegistry: true,
                        criticalToolsPresent: true,
                        missingCriticalTools: [],
                        missingLocalTools: [],
                        unexpectedRemoteTools: [],
                    },
                },
            },
            Date.parse('2026-05-22T12:05:00.000Z'),
            10 * 60 * 1000,
        );

        assert.equal(summary.lastSmokeOk, null);
        assert.equal(summary.lastSmokeAt, null);
        assert.equal(summary.lastSmokeConnectorUrl, null);
    });

    it('recommends restart when the recorded process is gone', () => {
        const summary = summarizeQuickTunnelState(
            { ...baseState, pid: 9_999_999 },
            Date.parse('2026-05-22T12:01:00.000Z'),
            5 * 60 * 1000,
        );

        assert.equal(summary.stateValid, true);
        assert.equal(summary.processAlive, false);
        assert.equal(summary.recommendedAction, 'restart');
    });
});
