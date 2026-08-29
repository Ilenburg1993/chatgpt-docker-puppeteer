// @ts-check

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it } from 'vitest';

import { createMcpProcessConfig } from '#copilot/mcp/public/composition/process-config';
import {
    MCP_RUNTIME_SOURCE_PROMOTION_ENV,
    buildMcpRuntimeGenerationCertificate,
    buildMcpRuntimeSourcePromotionEnvironment,
    createMcpRuntimeSourceGeneration,
    projectMcpRuntimeSourcePromotionEnvironment,
} from '#copilot/mcp/public/runtime/source-generation';

const execFileAsync = promisify(execFile);
const PROMOTION = Object.freeze({
    requestId: 'mcp-reload-11111111-1111-4111-8111-111111111111',
    sourceBarrierFingerprint: 'a'.repeat(64),
    sourceBarrierManifestPath: 'src/copilot/.ai/mcp/promotion/source-barrier.json',
});

describe('MCP runtime source generation authority', () => {
    it('represents manual startup explicitly without fabricating a source fingerprint', () => {
        const generation = createMcpRuntimeSourceGeneration({
            PATH: '/usr/bin',
            COPILOT_MCP_STATIC_BEARER_TOKEN: 'must-never-serialize',
            FUTURE_UNKNOWN_SECRET: 'must-never-serialize-either',
        });

        assert.equal(generation.sourceBinding, 'manual-unbound');
        assert.equal(generation.promotionRequestId, null);
        assert.equal(generation.sourceBarrierFingerprint, null);
        assert.equal(generation.sourceBarrierManifestPath, null);
        assert.match(generation.runtimeEpochId, /^[0-9a-f-]{36}$/iu);
        assert.equal(generation.pid, process.pid);
        assert.ok(Number.isSafeInteger(generation.processStartedAtMs));
        assert.equal(new Date(generation.processStartedAtMs).toISOString(), generation.processStartedAt);
        assert.equal(Object.isFrozen(generation), true);
        const serialized = JSON.stringify(generation);
        assert.equal(serialized.includes('must-never-serialize'), false);
        assert.equal(serialized.includes('FUTURE_UNKNOWN_SECRET'), false);
    });

    it('captures the exact controlled promotion binding in immutable process composition', () => {
        const promotionEnv = buildMcpRuntimeSourcePromotionEnvironment(PROMOTION);
        const processConfig = createMcpProcessConfig({ PATH: '/usr/bin', ...promotionEnv });
        const generation = processConfig.runtime.sourceGeneration;

        assert.equal(generation.sourceBinding, 'controlled-promotion');
        assert.equal(generation.promotionRequestId, PROMOTION.requestId);
        assert.equal(generation.sourceBarrierFingerprint, PROMOTION.sourceBarrierFingerprint);
        assert.equal(generation.sourceBarrierManifestPath, PROMOTION.sourceBarrierManifestPath);
        assert.strictEqual(processConfig.toolConfig.runtimeSourceGeneration, generation);
        assert.equal(Object.isFrozen(generation), true);
        assert.throws(() => {
            /** @type {any} */ (generation).sourceBinding = 'manual-unbound';
        }, TypeError);
    });

    it('projects a stable certificate that binds process, source proof and registered tool surface', () => {
        const generation = createMcpRuntimeSourceGeneration(buildMcpRuntimeSourcePromotionEnvironment(PROMOTION));
        const first = buildMcpRuntimeGenerationCertificate(generation, {
            evidence: 'operation-context-frozen',
            toolCount: 84,
            descriptorFingerprint: 'b'.repeat(64),
            descriptorFingerprintKind: 'test-wire-descriptor-set-sha256',
        });
        const same = buildMcpRuntimeGenerationCertificate(generation, {
            evidence: 'operation-context-frozen',
            toolCount: 84,
            descriptorFingerprint: 'b'.repeat(64),
            descriptorFingerprintKind: 'test-wire-descriptor-set-sha256',
        });
        const changedSurface = buildMcpRuntimeGenerationCertificate(generation, {
            evidence: 'operation-context-frozen',
            toolCount: 85,
            descriptorFingerprint: 'c'.repeat(64),
            descriptorFingerprintKind: 'test-wire-descriptor-set-sha256',
        });

        assert.equal(first.runtime.runtimeEpochId, generation.runtimeEpochId);
        assert.equal(first.runtime.nodeVersion, process.version);
        assert.equal(first.source.proof, 'source-barrier-bound');
        assert.equal(first.source.sourceBarrierFingerprint, PROMOTION.sourceBarrierFingerprint);
        assert.equal(first.toolSurface.toolCount, 84);
        assert.equal(first.toolSurface.evidence, 'operation-context-frozen');
        assert.match(first.certificateFingerprint, /^[a-f0-9]{64}$/u);
        assert.equal(first.certificateFingerprint, same.certificateFingerprint);
        assert.notEqual(first.certificateFingerprint, changedSurface.certificateFingerprint);
        assert.equal(Object.isFrozen(first), true);
        assert.equal(Object.isFrozen(first.runtime), true);
        assert.equal(Object.isFrozen(first.source), true);
        assert.equal(Object.isFrozen(first.toolSurface), true);
    });

    it('rejects partial or malformed promotion metadata instead of degrading ambiguously', () => {
        assert.throws(
            () =>
                createMcpRuntimeSourceGeneration({
                    [MCP_RUNTIME_SOURCE_PROMOTION_ENV.requestId]: PROMOTION.requestId,
                }),
            /must provide request id, fingerprint and manifest path together/u,
        );
        assert.throws(
            () =>
                buildMcpRuntimeSourcePromotionEnvironment({
                    ...PROMOTION,
                    sourceBarrierFingerprint: 'A'.repeat(64),
                }),
            /lowercase SHA-256/u,
        );
        assert.throws(
            () =>
                buildMcpRuntimeSourcePromotionEnvironment({
                    ...PROMOTION,
                    sourceBarrierManifestPath: '../outside.json',
                }),
            /canonical|workspace-relative|invalid segment/u,
        );
    });

    it('keeps one epoch inside a process and rotates the epoch in a new Node process', async () => {
        const first = createMcpRuntimeSourceGeneration({});
        const second = createMcpRuntimeSourceGeneration(buildMcpRuntimeSourcePromotionEnvironment(PROMOTION));
        assert.equal(second.runtimeEpochId, first.runtimeEpochId);
        assert.equal(second.processStartedAtMs, first.processStartedAtMs);

        const child = await execFileAsync(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                "import { createMcpRuntimeSourceGeneration } from '#copilot/mcp/public/runtime/source-generation'; process.stdout.write(JSON.stringify(createMcpRuntimeSourceGeneration({})));",
            ],
            { cwd: process.cwd(), env: { PATH: process.env['PATH'] ?? '/usr/bin' } },
        );
        const childGeneration = JSON.parse(child.stdout);
        assert.match(childGeneration.runtimeEpochId, /^[0-9a-f-]{36}$/iu);
        assert.notEqual(childGeneration.runtimeEpochId, first.runtimeEpochId);
        assert.notEqual(childGeneration.pid, process.pid);
        assert.equal(childGeneration.sourceBinding, 'manual-unbound');
    });

    it('projects only the three non-secret promotion variables from a broader environment', () => {
        const promotionEnv = buildMcpRuntimeSourcePromotionEnvironment(PROMOTION);
        const projected = projectMcpRuntimeSourcePromotionEnvironment({
            ...promotionEnv,
            COPILOT_MCP_STATIC_BEARER_TOKEN: 'must-not-cross',
            CLOUDFLARE_TUNNEL_TOKEN: 'must-not-cross',
            FUTURE_UNKNOWN_SECRET: 'must-not-cross',
        });

        assert.deepEqual(projected, promotionEnv);
        assert.equal(Object.keys(projected).length, 3);
        assert.equal(JSON.stringify(projected).includes('must-not-cross'), false);
    });
});
