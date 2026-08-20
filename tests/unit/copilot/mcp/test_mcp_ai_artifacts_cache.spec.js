// @ts-check
/** Tests for cached AI artifact diagnostics. */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';

import { buildAiArtifactsReport, clearAiArtifactsReportCache } from '#copilot/mcp/control-plane';

/** @type {string[]} */
const roots = [];

function makeRoot() {
    const root = mkdtempSync(join(tmpdir(), 'mcp-ai-artifacts-'));
    roots.push(root);
    mkdirSync(join(root, 'src/copilot/.ai/jobs'), { recursive: true });
    mkdirSync(join(root, 'src/copilot/.ai/cloudflare'), { recursive: true });
    mkdirSync(join(root, 'src/copilot/.ai/mcp'), { recursive: true });
    return root;
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
        clearAiArtifactsReportCache();
        for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    it('caches reports briefly and exposes explicit invalidation', async () => {
        const root = makeRoot();
        writeJob(root, '00000000-0000-4000-8000-000000000001.log');

        const first = await buildAiArtifactsReport({ workspaceRoot: root, retainNewest: 20 });
        writeJob(root, '00000000-0000-4000-8000-000000000002.log');
        const cached = await buildAiArtifactsReport({ workspaceRoot: root, retainNewest: 20 });
        clearAiArtifactsReportCache();
        const fresh = await buildAiArtifactsReport({ workspaceRoot: root, retainNewest: 20 });

        assert.equal(jobsProjection(first).artifactCount, 1);
        assert.equal(jobsProjection(cached).artifactCount, 1);
        assert.equal(jobsProjection(fresh).artifactCount, 2);
    });
});
