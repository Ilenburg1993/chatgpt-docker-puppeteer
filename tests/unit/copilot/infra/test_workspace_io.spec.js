// @ts-check

import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { createWorkspaceIo } from '#copilot/infra/public/workspace-io';

/** @type {string[]} */
const cleanupPaths = [];

afterEach(async () => {
    await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function createWorkspaceFixture() {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'copilot-workspace-io-root-'));
    const outsideRoot = await mkdtemp(join(tmpdir(), 'copilot-workspace-io-outside-'));
    cleanupPaths.push(workspaceRoot, outsideRoot);
    return { workspaceRoot, outsideRoot, io: createWorkspaceIo({ workspaceRoot }) };
}

describe('workspace IO capability', () => {
    it('exige workspaceRoot explícito', () => {
        expect(() => createWorkspaceIo(/** @type {any} */ ({}))).toThrow('requires a non-empty workspaceRoot');
    });

    it.each([
        ['traversal', '../outside.txt', 'PATH_TRAVERSAL'],
        ['null byte', 'inside\u0000outside.txt', 'PATH_NULL_BYTE'],
    ])('recusa %s antes de acessar o filesystem', async (_label, candidate, code) => {
        const { io } = await createWorkspaceFixture();
        await expect(io.readText(candidate)).rejects.toMatchObject({ code });
    });

    it('recusa path absoluto externo e symlink que resolve para fora', async () => {
        const { workspaceRoot, outsideRoot, io } = await createWorkspaceFixture();
        const outsideFile = join(outsideRoot, 'outside.txt');
        await io.writeFileAtomic(join(workspaceRoot, 'inside.txt'), 'inside');
        await writeFile(outsideFile, 'outside');
        await symlink(outsideFile, join(workspaceRoot, 'outside-link'));

        await expect(io.readText(outsideFile)).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
        await expect(io.writeFileAtomic(join(workspaceRoot, 'outside-link'), 'outside')).rejects.toMatchObject({
            code: 'PATH_SYMLINK_OUTSIDE',
        });
        await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside');
    });

    it('publica e lê paths internos após policy async', async () => {
        const { workspaceRoot, io } = await createWorkspaceFixture();
        const filePath = join(workspaceRoot, 'inside.txt');

        await io.writeFileAtomic(filePath, 'inside');
        const snapshot = await io.readText(filePath);

        expect(snapshot.content).toBe('inside');
    });
});
