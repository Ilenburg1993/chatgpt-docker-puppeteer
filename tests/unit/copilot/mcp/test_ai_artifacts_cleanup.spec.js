// @ts-check

import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanupAiArtifacts } from '../../../../src/copilot/mcp/control-plane/ai-artifacts.js';

const roots = [];

afterEach(async () => {
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
});
