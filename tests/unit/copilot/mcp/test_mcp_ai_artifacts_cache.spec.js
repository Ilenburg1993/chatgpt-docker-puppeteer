// @ts-check
/** Tests for runtime-owned cached AI artifact diagnostics. */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { createAiArtifactsRuntime } from '#copilot/mcp/control-plane';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';

/** @type {string[]} */
const roots = [];
let runtimeSequence = 0;

function makeRoot() {
    const root = mkdtempSync(join(tmpdir(), 'mcp-ai-artifacts-'));
    roots.push(root);
    mkdirSync(join(root, 'src/copilot/.ai/jobs'), { recursive: true });
    mkdirSync(join(root, 'src/copilot/.ai/cloudflare'), { recursive: true });
    mkdirSync(join(root, 'src/copilot/.ai/mcp'), { recursive: true });
    return root;
}

function createRuntime(/** @type {string} */ root) {
    const aiDir = join(root, 'src/copilot/.ai');
    const rollbackPolicy = {
        enabled: false,
        directory: join(aiDir, 'rollback'),
        ttlMs: 24 * 60 * 60 * 1000,
        maxEntries: 32,
        maxBytes: 32 * 1024 * 1024,
    };
    const io = createConfiguredFsIo(
        createConfiguredFsGrant({
            id: `test.mcp.ai-artifacts-cache.${++runtimeSequence}`,
            roots: [aiDir],
            operations: ['list', 'stat'],
            symlinkPolicy: 'deny',
            durability: ['file-and-directory'],
        }),
    );
    return createAiArtifactsRuntime({ workspaceRoot: root, rollbackPolicy, io });
}

function writeJob(/** @type {string} */ root, /** @type {string} */ name) {
    writeFileSync(join(root, 'src/copilot/.ai/jobs', name), 'x');
}

/**
 * @param {Record<string, unknown>} report
 * @returns {{ artifactCount: number }}
 */
function jobsProjection(report) {
    const jobs = report['jobs'];
    assert.ok(jobs && typeof jobs === 'object' && !Array.isArray(jobs));
    const artifactCount = /** @type {Record<string, unknown>} */ (jobs)['artifactCount'];
    assert.equal(typeof artifactCount, 'number');
    return { artifactCount: /** @type {number} */ (artifactCount) };
}

describe('AI artifact diagnostics cache', () => {
    afterEach(() => {
        for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    it('caches reports per runtime and exposes explicit invalidation', async () => {
        const root = makeRoot();
        const runtime = createRuntime(root);
        writeJob(root, '00000000-0000-4000-8000-000000000001.log');

        const first = await runtime.buildReport({ retainNewest: 20 });
        writeJob(root, '00000000-0000-4000-8000-000000000002.log');
        const cached = await runtime.buildReport({ retainNewest: 20 });
        runtime.clearCache();
        const fresh = await runtime.buildReport({ retainNewest: 20 });

        assert.equal(jobsProjection(first).artifactCount, 1);
        assert.equal(jobsProjection(cached).artifactCount, 1);
        assert.equal(jobsProjection(fresh).artifactCount, 2);
    });
});
