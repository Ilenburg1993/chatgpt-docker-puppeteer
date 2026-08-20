// @ts-check

import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAiArtifactsReport, cleanupAiArtifacts } from '../../../../src/copilot/mcp/control-plane/ai-artifacts.js';

/** @type {string[]} */
const roots = [];

afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('MCP AI artifact cleanup', () => {
    it('keeps dry-run non-mutating and deletes only bounded UUID artifacts when applied', async () => {
        const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'mcp-ai-artifacts-'));
        roots.push(workspaceRoot);
        const jobsDir = path.join(workspaceRoot, 'src/copilot/.ai/jobs');
        await mkdir(jobsDir, { recursive: true });
        const artifactNames = Array.from(
            { length: 23 },
            (_, index) =>
                `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}.${index % 2 ? 'log' : 'json'}`,
        );
        const protectedNames = ['oauth-refresh-tokens.json', 'manual-note.log'];
        const names = [...artifactNames, ...protectedNames];
        for (const [index, name] of names.entries()) {
            const filePath = path.join(jobsDir, name);
            await writeFile(filePath, `${name}\n`);
            const time = new Date(Date.now() + index * 1000);
            await utimes(filePath, time, time);
        }

        const dryRun = await cleanupAiArtifacts({
            workspaceRoot,
            dryRun: true,
            retainNewest: 20,
            maxDeleteCount: 2,
        });
        expect(dryRun['deletedCount']).toBe(0);
        expect((await readdir(jobsDir)).sort()).toEqual([...names].sort());

        const applied = await cleanupAiArtifacts({
            workspaceRoot,
            dryRun: false,
            retainNewest: 20,
            maxDeleteCount: 2,
        });
        expect(applied['deletedCount']).toBe(2);
        const remaining = await readdir(jobsDir);
        expect(remaining).toHaveLength(names.length - 2);
        expect(remaining).toEqual(expect.arrayContaining(protectedNames));
        expect(applied['remainingCandidateCount']).toBe(1);
    });

    it('reports rollback sidecars read-only and never makes them cleanup targets', async () => {
        const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'mcp-ai-rollback-report-'));
        roots.push(workspaceRoot);
        const rollbackDir = path.join(workspaceRoot, 'src/copilot/.ai/rollback');
        await mkdir(rollbackDir, { recursive: true });

        const uuid = '00000000-0000-4000-8000-000000000001';
        const hash = 'a'.repeat(64);
        const expired = `${Date.now() - 60_000}-${hash}-${uuid}.rollback`;
        const active = `${Date.now() + 60_000}-${hash}-${uuid}.rollback`;
        const pending = `.pending-${Date.now() + 60_000}-123-${uuid}`;
        const unknown = 'manual-note.txt';
        for (const name of [expired, active, pending, unknown]) {
            await writeFile(path.join(rollbackDir, name), `${name}\n`);
        }

        const report = await buildAiArtifactsReport({ workspaceRoot });
        const rollback = /** @type {Record<string, unknown>} */ (report['rollback']);
        expect(rollback['enabled']).toBe(false);
        expect(rollback['sidecarCount']).toBe(2);
        expect(rollback['expiredCount']).toBe(1);
        expect(rollback['pendingCount']).toBe(1);
        expect(rollback['ignoredEntryCount']).toBe(1);
        expect(rollback['purgeCandidateCount']).toBe(3);
        expect(rollback['maintenanceMutation']).toBe('explicit-only');

        const applied = await cleanupAiArtifacts({ workspaceRoot, dryRun: false, retainNewest: 20, maxDeleteCount: 10 });
        expect(applied['deletedCount']).toBe(0);
        expect((await readdir(rollbackDir)).sort()).toEqual([expired, active, pending, unknown].sort());
    });

    it('purges only recognized rollback artifacts when explicitly requested and automatic rollback is disabled', async () => {
        vi.stubEnv('COPILOT_IO_ROLLBACK_ENABLED', 'false');
        const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'mcp-ai-rollback-purge-'));
        roots.push(workspaceRoot);
        const rollbackDir = path.join(workspaceRoot, 'src/copilot/.ai/rollback');
        await mkdir(rollbackDir, { recursive: true });

        const uuid = '00000000-0000-4000-8000-000000000002';
        const hash = 'b'.repeat(64);
        const sidecar = `${Date.now() + 60_000}-${hash}-${uuid}.rollback`;
        const pending = `.pending-${Date.now() + 60_000}-321-${uuid}`;
        const unknown = 'preserve-me.txt';
        for (const name of [sidecar, pending, unknown]) await writeFile(path.join(rollbackDir, name), name);

        const dryRun = await cleanupAiArtifacts({
            workspaceRoot,
            dryRun: true,
            retainNewest: 20,
            maxDeleteCount: 10,
            purgeDisabledRollback: true,
        });
        expect(dryRun['rollback']).toMatchObject({
            requested: true,
            allowed: true,
            candidateCount: 2,
            selectedCount: 2,
            cleanup: { dryRun: true, wouldRemove: 2 },
        });
        expect(await readdir(rollbackDir)).toEqual(expect.arrayContaining([sidecar, pending, unknown]));

        const applied = await cleanupAiArtifacts({
            workspaceRoot,
            dryRun: false,
            retainNewest: 20,
            maxDeleteCount: 10,
            purgeDisabledRollback: true,
        });
        expect(applied['success']).toBe(true);
        expect(applied['rollback']).toMatchObject({
            requested: true,
            allowed: true,
            candidateCount: 2,
            selectedCount: 2,
            remainingSidecarCount: 0,
        });
        const remaining = await readdir(rollbackDir);
        expect(remaining).toContain(unknown);
        expect(remaining).not.toContain(sidecar);
        expect(remaining).not.toContain(pending);
    });

    it('blocks active rollback purge while automatic rollback is enabled', async () => {
        vi.stubEnv('COPILOT_IO_ROLLBACK_ENABLED', 'true');
        const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'mcp-ai-rollback-enabled-'));
        roots.push(workspaceRoot);
        const rollbackDir = path.join(workspaceRoot, 'src/copilot/.ai/rollback');
        await mkdir(rollbackDir, { recursive: true });
        const uuid = '00000000-0000-4000-8000-000000000003';
        const sidecar = `${Date.now() + 60_000}-${'c'.repeat(64)}-${uuid}.rollback`;
        await writeFile(path.join(rollbackDir, sidecar), 'active');

        const applied = await cleanupAiArtifacts({
            workspaceRoot,
            dryRun: false,
            retainNewest: 20,
            maxDeleteCount: 10,
            purgeDisabledRollback: true,
        });

        expect(applied['success']).toBe(false);
        expect(applied['rollback']).toMatchObject({ requested: true, allowed: false, candidateCount: 0 });
        expect(await readdir(rollbackDir)).toContain(sidecar);
    });
});
