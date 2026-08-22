// @ts-check
/** Tests for OpenAI Secure MCP Tunnel readiness audit. */

import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';

import { auditOpenAiSecureMcpTunnelReadiness } from '#copilot/mcp/openai';

/** @type {string[]} */
const tempRoots = [];

afterEach(() => {
    while (tempRoots.length > 0) rmSync(tempRoots.pop() ?? '', { recursive: true, force: true });
});

describe('OpenAI Secure MCP Tunnel readiness audit', () => {
    it('reports blockers when tunnel credentials are absent', () => {
        const result = auditOpenAiSecureMcpTunnelReadiness({ env: {}, pathEnv: '' });

        assert.equal(result.success, true);
        assert.equal(result.ok, false);
        const readiness = /** @type {{ blockers: string[]; warnings: string[] }} */ (result['readiness']);
        assert.ok(readiness.blockers.some((item) => item.includes('tunnel_id')));
        assert.ok(readiness.blockers.some((item) => item.includes('runtime credential')));
        assert.ok(readiness.warnings.some((item) => item.includes('tunnel-client')));
        assert.match(JSON.stringify(result['costPosture']), /do-not-proceed-if-paid-or-plan-upgrade-required/u);
    });

    it('detects tunnel-client through the canonical resolver without exposing its absolute path', () => {
        const root = mkdtempSync(join(tmpdir(), 'secure-tunnel-client-'));
        tempRoots.push(root);
        const binary = join(root, 'tunnel-client');
        writeFileSync(binary, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
        chmodSync(binary, 0o755);

        const result = auditOpenAiSecureMcpTunnelReadiness({
            env: {
                OPENAI_MCP_TUNNEL_ID: 'configured-tunnel-id',
                CONTROL_PLANE_API_KEY: 'configured-runtime-key',
                PATH: root,
            },
        });
        const observed =
            /** @type {{tunnelClientBinary:{found:boolean;pathHint?:string;searchedPathEntries:number}}} */ (
                result['observed']
            );
        assert.equal(observed.tunnelClientBinary.found, true);
        assert.equal(observed.tunnelClientBinary.pathHint, '*/tunnel-client');
        assert.equal(observed.tunnelClientBinary.searchedPathEntries, 1);
        assert.doesNotMatch(JSON.stringify(result), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    });

    it('does not expose raw secret-like environment values', () => {
        const result = auditOpenAiSecureMcpTunnelReadiness({
            env: {
                OPENAI_MCP_TUNNEL_ID: 'tunnel_0123456789abcdef0123456789abcdef',
                CONTROL_PLANE_API_KEY: 'sk-test-secret-value',
                PATH: '',
            },
            pathEnv: '',
        });
        const text = JSON.stringify(result);

        assert.equal(result.ok, true);
        assert.doesNotMatch(text, /sk-test-secret-value/u);
        assert.doesNotMatch(text, /tunnel_0123456789abcdef0123456789abcdef/u);
    });
});
