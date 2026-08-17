// @ts-check

import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { IO_PATH_POLICY_VERSION } from '#copilot/core';
import { createWorkspaceIo } from '#copilot/infra/public/workspace-io';
import {
    createValidatedMutableWorkspacePath,
    createValidatedReadWorkspacePath,
    getValidatedMutableWorkspacePathStats,
    getValidatedReadWorkspacePathStats,
    resetValidatedMutableWorkspacePathStatsForTest,
    resetValidatedReadWorkspacePathStatsForTest,
    resolveValidatedMutableWorkspacePath,
    resolveValidatedReadWorkspacePath,
} from '../../../../src/copilot/infra/io/policy/validated-path.js';

/** @type {string[]} */
const cleanupPaths = [];

afterEach(async () => {
    resetValidatedReadWorkspacePathStatsForTest();
    resetValidatedMutableWorkspacePathStatsForTest();
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

    it('aceita capability opaca read-only e evita uma segunda policy async', async () => {
        const { workspaceRoot, io } = await createWorkspaceFixture();
        const filePath = join(workspaceRoot, 'inside.txt');
        await io.writeFileAtomic(filePath, 'inside');
        resetValidatedReadWorkspacePathStatsForTest();
        const capability = createValidatedReadWorkspacePath({ realPath: filePath, workspaceRoot });
        expect(capability.policyVersion).toBe(IO_PATH_POLICY_VERSION);

        const [snapshot, statSnapshot] = await Promise.all([
            io.readTextValidated(capability),
            io.statPathValidated(capability),
        ]);

        expect(snapshot.content).toBe('inside');
        expect(statSnapshot.stats.isFile()).toBe(true);
        expect(getValidatedReadWorkspacePathStats()).toMatchObject({ issued: 1, accepted: 2 });
    });

    it('aceita capability read-only para scan de diretório sem segunda policy async', async () => {
        const { workspaceRoot, io } = await createWorkspaceFixture();
        await mkdir(join(workspaceRoot, 'nested'));
        await writeFile(join(workspaceRoot, 'nested', 'entry.txt'), 'entry', 'utf8');
        resetValidatedReadWorkspacePathStatsForTest();
        const capability = createValidatedReadWorkspacePath({ realPath: join(workspaceRoot, 'nested'), workspaceRoot });

        const scan = await io.scanDirectoryValidated(capability, { depth: 1, maxEntries: 10 });

        expect(scan.entries.some((entry) => entry.name === 'entry.txt')).toBe(true);
        expect(getValidatedReadWorkspacePathStats()).toMatchObject({
            issued: 1,
            accepted: 1,
            compatibleModes: ['read', 'search', 'stat', 'scan'],
        });
    });

    it('aceita capability mutável opaca em write/patch sem revalidar a path no workspace facade', async () => {
        const { workspaceRoot, io } = await createWorkspaceFixture();
        const filePath = join(workspaceRoot, 'mutable.txt');
        await io.writeFileAtomic(filePath, 'before');
        resetValidatedMutableWorkspacePathStatsForTest();
        const capability = createValidatedMutableWorkspacePath({ realPath: filePath, workspaceRoot });
        expect(capability.policyVersion).toBe(IO_PATH_POLICY_VERSION);

        await io.writeFileAtomicValidated(capability, 'middle', { requireExists: true });
        const patch = await io.patchTextLockedValidated(capability, {
            oldString: 'middle',
            newString: 'after',
        });

        expect(patch.replacedOccurrences).toBe(1);
        await expect(readFile(filePath, 'utf8')).resolves.toBe('after');
        expect(getValidatedMutableWorkspacePathStats()).toMatchObject({ issued: 1, accepted: 2 });
    });

    it('compõe capabilities pair sem revalidar copy/move e mantém read/write separados', async () => {
        const { workspaceRoot, io } = await createWorkspaceFixture();
        const sourcePath = join(workspaceRoot, 'pair-source.txt');
        const copiedPath = join(workspaceRoot, 'pair-copied.txt');
        const movedPath = join(workspaceRoot, 'pair-moved.txt');
        await io.writeFileAtomic(sourcePath, 'pair-content');
        resetValidatedReadWorkspacePathStatsForTest();
        resetValidatedMutableWorkspacePathStatsForTest();

        const copySource = createValidatedReadWorkspacePath({ realPath: sourcePath, workspaceRoot });
        const copyDestination = createValidatedMutableWorkspacePath({ realPath: copiedPath, workspaceRoot });
        const copied = await io.copyFileLockedValidated(copySource, copyDestination, { overwrite: false });
        expect(copied.sourceHash).toBeTruthy();
        await expect(readFile(copiedPath, 'utf8')).resolves.toBe('pair-content');

        const moveSource = createValidatedMutableWorkspacePath({ realPath: copiedPath, workspaceRoot });
        const moveDestination = createValidatedMutableWorkspacePath({ realPath: movedPath, workspaceRoot });
        const moved = await io.moveFileLockedValidated(moveSource, moveDestination, { overwrite: false });
        expect(moved.sourceHash).toBeTruthy();
        await expect(readFile(movedPath, 'utf8')).resolves.toBe('pair-content');
        await expect(stat(copiedPath)).rejects.toMatchObject({ code: 'ENOENT' });

        expect(getValidatedReadWorkspacePathStats()).toMatchObject({ issued: 1, accepted: 1 });
        expect(getValidatedMutableWorkspacePathStats()).toMatchObject({ issued: 3, accepted: 3 });

        await expect(io.copyFileLockedValidated(copyDestination, moveDestination)).rejects.toMatchObject({
            code: 'EINVALIDVALIDATEDPATH',
        });
        await expect(io.moveFileLockedValidated(copySource, moveDestination)).rejects.toMatchObject({
            code: 'EINVALIDVALIDATEDMUTABLEPATH',
        });
    });

    it('rejeita capability mutável sem brand, de outro workspace e em modo incompatível', async () => {
        const { workspaceRoot, outsideRoot, io } = await createWorkspaceFixture();
        const filePath = join(workspaceRoot, 'mutable.txt');
        await io.writeFileAtomic(filePath, 'inside');
        const capability = createValidatedMutableWorkspacePath({ realPath: filePath, workspaceRoot });

        await expect(
            io.patchTextLockedValidated({
                realPath: filePath,
                workspaceRoot,
                policyVersion: capability.policyVersion,
                access: 'mutable',
                policyClass: 'write',
            }, { oldString: 'inside', newString: 'outside' }),
        ).rejects.toMatchObject({ code: 'EINVALIDVALIDATEDMUTABLEPATH' });

        const otherWorkspaceCapability = createValidatedMutableWorkspacePath({
            realPath: filePath,
            workspaceRoot: outsideRoot,
        });
        await expect(io.writeFileAtomicValidated(otherWorkspaceCapability, 'outside')).rejects.toMatchObject({
            code: 'EVALIDATEDMUTABLEPATHWORKSPACE',
        });
        expect(() =>
            resolveValidatedMutableWorkspacePath(capability, { workspaceRoot, mode: 'delete' }),
        ).toThrowError(expect.objectContaining({ code: 'EVALIDATEDMUTABLEPATHMODE' }));
        await expect(io.readTextValidated(capability)).rejects.toMatchObject({ code: 'EINVALIDVALIDATEDPATH' });
        await expect(readFile(filePath, 'utf8')).resolves.toBe('inside');
    });

    it('rejeita lookalike sem brand, workspace divergente e uso em modo mutável', async () => {
        const { workspaceRoot, outsideRoot, io } = await createWorkspaceFixture();
        const filePath = join(workspaceRoot, 'inside.txt');
        await io.writeFileAtomic(filePath, 'inside');
        const capability = createValidatedReadWorkspacePath({ realPath: filePath, workspaceRoot });

        await expect(
            io.readTextValidated({
                realPath: filePath,
                workspaceRoot,
                policyVersion: capability.policyVersion,
                access: 'read-only',
            }),
        ).rejects.toMatchObject({ code: 'EINVALIDVALIDATEDPATH' });

        const otherWorkspaceCapability = createValidatedReadWorkspacePath({
            realPath: filePath,
            workspaceRoot: outsideRoot,
        });
        await expect(io.readTextValidated(otherWorkspaceCapability)).rejects.toMatchObject({
            code: 'EVALIDATEDPATHWORKSPACE',
        });
        expect(() =>
            resolveValidatedReadWorkspacePath(capability, { workspaceRoot, mode: 'write' }),
        ).toThrowError(expect.objectContaining({ code: 'EVALIDATEDPATHMODE' }));
    });

    it('confirma remoção recursiva relativa e protege a raiz do workspace', async () => {
        const { workspaceRoot, io } = await createWorkspaceFixture();
        await mkdir(join(workspaceRoot, 'nested', 'deep'), { recursive: true });
        await writeFile(join(workspaceRoot, 'nested', 'deep', 'file.txt'), 'inside');

        await expect(io.removePathLocked('nested', { recursive: true, force: true })).rejects.toMatchObject({
            code: 'ERECURSIVEREMOVECONFIRMATION',
        });
        await io.removePathLocked('nested', {
            recursive: true,
            force: true,
            recursiveConfirmation: 'nested',
        });
        await expect(stat(join(workspaceRoot, 'nested'))).rejects.toMatchObject({ code: 'ENOENT' });

        await expect(
            io.removePathLocked(workspaceRoot, {
                recursive: true,
                force: true,
                recursiveConfirmation: workspaceRoot,
            }),
        ).rejects.toMatchObject({ code: 'ERECURSIVEWORKSPACEROOT' });
        await expect(stat(workspaceRoot)).resolves.toBeDefined();
    });
});
