// @ts-check
/**
 * Cloudflare quick tunnel runtime state summaries.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { summarizeQuickTunnelState } from '../../../../src/copilot/mcp/cloudflare/state.js';

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
        const summary = summarizeQuickTunnelState(
            baseState,
            Date.parse('2026-05-22T12:10:00.000Z'),
            5 * 60 * 1000,
        );

        assert.equal(summary.stateValid, true);
        assert.equal(summary.processAlive, true);
        assert.equal(summary.stale, true);
        assert.equal(summary.recommendedAction, 'smoke');
        assert.equal(summary.ageMinutes, 10);
        assert.equal(summary.connectorUrl, baseState.connectorUrl);
    });

    it('recommends direct use for an alive fresh temporary tunnel', () => {
        const summary = summarizeQuickTunnelState(
            baseState,
            Date.parse('2026-05-22T12:01:00.000Z'),
            5 * 60 * 1000,
        );

        assert.equal(summary.stateValid, true);
        assert.equal(summary.processAlive, true);
        assert.equal(summary.stale, false);
        assert.equal(summary.recommendedAction, 'use');
        assert.equal(summary.ageSeconds, 60);
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
