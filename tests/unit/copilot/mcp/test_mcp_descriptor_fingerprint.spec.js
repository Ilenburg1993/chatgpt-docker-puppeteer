// @ts-check

import {
    MCP_TOOL_DESCRIPTOR_FINGERPRINT_KIND,
    buildMcpToolDescriptorRevisionToken,
    buildMcpToolWireFingerprintIndex,
    compareMcpToolWireFingerprintIndexes,
    extractMcpToolWireDescriptors,
    fingerprintMcpToolWireDescriptor,
    fingerprintMcpToolWireDescriptorSet,
} from '#copilot/mcp/public/protocol/catalog';
import { buildMcpToolWireDescriptorSnapshot, getCanonicalMcpTools } from '#copilot/mcp/public/registry';
import { summarizeAuthenticatedToolsList } from '#copilot/testing/mcp/diagnostics/oauth-smoke';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

const descriptorA = {
    name: 'tool_a',
    description: 'A',
    inputSchema: { type: 'object', properties: { alpha: { type: 'string' } } },
};
const descriptorB = {
    name: 'tool_b',
    description: 'B',
    inputSchema: { type: 'object', properties: { beta: { type: 'number' } } },
};

describe('MCP wire descriptor fingerprint authority', () => {
    it('canonicalizes object-key order while preserving descriptor-set order', () => {
        const reorderedA = {
            inputSchema: { properties: { alpha: { type: 'string' } }, type: 'object' },
            description: 'A',
            name: 'tool_a',
        };
        assert.equal(fingerprintMcpToolWireDescriptor(descriptorA), fingerprintMcpToolWireDescriptor(reorderedA));
        assert.notEqual(
            fingerprintMcpToolWireDescriptorSet([descriptorA, descriptorB]),
            fingerprintMcpToolWireDescriptorSet([descriptorB, descriptorA]),
        );
    });

    it('indexes per-tool fingerprints independently from tools/list order and emits stable revision tokens', () => {
        const forward = buildMcpToolWireFingerprintIndex([descriptorA, descriptorB]);
        const reverse = buildMcpToolWireFingerprintIndex([descriptorB, descriptorA]);
        assert.deepEqual(reverse, forward);
        assert.match(forward['tool_a'] ?? '', /^[0-9a-f]{64}$/u);
        assert.equal(
            buildMcpToolDescriptorRevisionToken(forward['tool_a'] ?? ''),
            `wire-v1:${String(forward['tool_a']).slice(0, 16)}`,
        );
    });

    it('detects schema mismatch even when remote and local tool names are identical', () => {
        const local = buildMcpToolWireFingerprintIndex([descriptorA, descriptorB]);
        const remote = buildMcpToolWireFingerprintIndex([
            descriptorA,
            { ...descriptorB, inputSchema: { type: 'object', properties: { beta: { type: 'string' } } } },
        ]);
        assert.deepEqual(compareMcpToolWireFingerprintIndexes(local, remote), {
            matches: false,
            comparedToolCount: 2,
            matchingToolCount: 1,
            missingRemoteTools: [],
            unexpectedRemoteTools: [],
            mismatchedTools: ['tool_b'],
        });
    });

    it('pins the intentional canonical surface fingerprint and per-tool identities', () => {
        const snapshot = buildMcpToolWireDescriptorSnapshot(getCanonicalMcpTools());
        assert.equal(snapshot.schemaVersion, 2);
        assert.equal(snapshot.fingerprintKind, 'tools-list-wire-sha256-v1');
        assert.equal(snapshot.descriptors.length, 88);
        assert.equal(snapshot.fingerprint, 'eee32b918a88abca177e4803774da0725835f3fbb91129d0cefaf8c6a9a4e7b2');
        assert.equal(snapshot.toolRevisionTokens['repo_apply_patch_batch'], 'wire-v1:345553b0bc26ad02');
        assert.equal(snapshot.toolRevisionTokens['run_copilot_validator'], 'wire-v1:20ada120b6f14572');
        assert.equal(snapshot.toolRevisionTokens['repo_index_build'], 'wire-v1:adb3e310dcd61693');
        assert.equal(snapshot.toolRevisionTokens['repo_graph'], 'wire-v1:ff2baacea7b488d0');
        assert.equal(snapshot.toolRevisionTokens['repo_change_impact'], 'wire-v1:95c061bf0c47b372');
        assert.equal(snapshot.toolRevisionTokens['git_inspect'], 'wire-v1:918279dabe389fb3');
        for (const retired of [
            'repo_patch_batch_plan',
            'git_stage_plan',
            'git_commit_plan',
            'git_push_plan',
            'mcp_reload_plan',
            'repo_file_stats',
        ]) {
            assert.equal(retired in snapshot.toolRevisionTokens, false, retired);
        }
        assert.equal(Object.keys(snapshot.toolFingerprints).length, snapshot.descriptors.length);
        assert.equal(Object.keys(snapshot.toolRevisionTokens).length, snapshot.descriptors.length);
        for (const descriptor of snapshot.descriptors.slice(0, 5)) {
            const name = String(descriptor['name']);
            assert.equal(snapshot.toolFingerprints[name], fingerprintMcpToolWireDescriptor(descriptor));
            assert.match(snapshot.toolRevisionTokens[name] ?? '', /^wire-v1:[0-9a-f]{16}$/u);
        }
    });
});

describe('authenticated tools/list schema parity', () => {
    it('extracts descriptors from JSON-RPC envelopes and proves parity using canonical fingerprints', async () => {
        const descriptors = [descriptorA, descriptorB];
        const localToolFingerprints = buildMcpToolWireFingerprintIndex(descriptors);
        const body = { jsonrpc: '2.0', id: 2, result: { tools: descriptors } };
        assert.deepEqual(extractMcpToolWireDescriptors(body), descriptors);

        const summary = await summarizeAuthenticatedToolsList(
            { ok: true, status: 200, body },
            { verboseTools: false, localToolNames: ['tool_a', 'tool_b'], localToolFingerprints },
        );
        assert.equal(summary.ok, true);
        assert.equal(summary.toolsMatchLocalRegistry, true);
        assert.deepEqual(summary.schemaParity, {
            required: true,
            available: true,
            fingerprintKind: MCP_TOOL_DESCRIPTOR_FINGERPRINT_KIND,
            matches: true,
            comparedToolCount: 2,
            matchingToolCount: 2,
            missingRemoteTools: [],
            unexpectedRemoteTools: [],
            mismatchedTools: [],
        });
    });

    it('fails authenticated tool-list parity on same-name schema drift and stays name-compatible for diagnosis', async () => {
        const localToolFingerprints = buildMcpToolWireFingerprintIndex([descriptorA, descriptorB]);
        const changedB = { ...descriptorB, description: 'changed remotely' };
        const summary = await summarizeAuthenticatedToolsList(
            { ok: true, status: 200, body: { result: { tools: [descriptorA, changedB] } } },
            { verboseTools: false, localToolNames: ['tool_a', 'tool_b'], localToolFingerprints },
        );
        assert.equal(summary.ok, false);
        assert.equal(summary.toolsMatchLocalRegistry, true);
        assert.equal(summary.schemaParity['matches'], false);
        assert.deepEqual(summary.schemaParity['mismatchedTools'], ['tool_b']);
    });

    it('keeps schema parity optional for generic OAuth smoke callers that only provide names', async () => {
        const summary = await summarizeAuthenticatedToolsList(
            { ok: true, status: 200, body: { result: { tools: [descriptorA] } } },
            { verboseTools: false, localToolNames: ['tool_a'], localToolFingerprints: {} },
        );
        assert.equal(summary.ok, true);
        assert.equal(summary.schemaParity['required'], false);
        assert.equal(summary.schemaParity['matches'], null);
    });
});
