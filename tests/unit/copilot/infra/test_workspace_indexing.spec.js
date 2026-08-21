// @ts-check

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    createWorkspacePathAuthority,
    getValidatedReadWorkspacePathStats,
} from '#copilot/infra/internal/filesystem/workspace';
import { createWorkspaceIndexing } from '#copilot/infra/internal/indexing/workspace';
import { resetValidatedReadWorkspacePathStatsForTest } from '#copilot/infra/public/testing';

/** @type {string[]} */
const cleanupPaths = [];

afterEach(async () => {
    resetValidatedReadWorkspacePathStatsForTest();
    await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function createFixture() {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'copilot-workspace-indexing-root-'));
    cleanupPaths.push(workspaceRoot);
    const authority = createWorkspacePathAuthority({ workspaceRoot });
    return { workspaceRoot, authority, indexing: createWorkspaceIndexing(authority) };
}

describe('workspace indexing capability', () => {
    it('exige workspaceRoot explícito', () => {
        expect(() => createWorkspaceIndexing(/** @type {any} */ ({}))).toThrow('requires a non-empty workspaceRoot');
    });

    it('mantém a policy canônica para paths string e rejeita traversal antes do scanner', async () => {
        const { indexing } = await createFixture();

        await expect(indexing.scanDirectory('../outside', { depth: 1 })).rejects.toMatchObject({
            code: 'PATH_TRAVERSAL',
        });
    });

    it('reusa capability read-only no scanner sem segunda policy async', async () => {
        const { workspaceRoot, authority, indexing } = await createFixture();
        const nested = join(workspaceRoot, 'nested');
        await mkdir(nested);
        await writeFile(join(nested, 'entry.txt'), 'entry', 'utf8');
        resetValidatedReadWorkspacePathStatsForTest();
        const capability = await authority.authorizeRead(nested, 'read');

        const scan = await indexing.scanDirectoryValidated(capability, { depth: 1, maxEntries: 10 });

        expect(scan.entries.some((entry) => entry.name === 'entry.txt')).toBe(true);
        expect(getValidatedReadWorkspacePathStats()).toMatchObject({
            issued: 1,
            accepted: 1,
            compatibleModes: ['read', 'search', 'stat', 'scan'],
        });
    });

    it('reusa a mesma capability read-only para search sem alterar ownership do filesystem', async () => {
        const { workspaceRoot, authority, indexing } = await createFixture();
        const filePath = join(workspaceRoot, 'sample.js');
        await writeFile(filePath, 'export const workspaceIndexingNeedle = 1;\n', 'utf8');
        resetValidatedReadWorkspacePathStatsForTest();
        const capability = await authority.authorizeRead(workspaceRoot, 'read');

        const result = await indexing.searchTextValidated(capability, {
            pattern: 'workspaceIndexingNeedle',
            maxResults: 10,
        });

        expect(result.output).toContain('workspaceIndexingNeedle');
        expect(getValidatedReadWorkspacePathStats()).toMatchObject({ issued: 1, accepted: 1 });
    });
});
