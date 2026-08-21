// @ts-check

import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { IO_PATH_POLICY_VERSION } from '#copilot/core';
import {
    createWorkspaceIo,
    createWorkspacePathAuthority,
    getValidatedMutableWorkspacePathStats,
    getValidatedReadWorkspacePathStats,
    resolveValidatedMutableWorkspacePath,
    resolveValidatedReadWorkspacePath,
} from '#copilot/infra/internal/filesystem/workspace';

import {
    resetValidatedMutableWorkspacePathStatsForTest,
    resetValidatedReadWorkspacePathStatsForTest,
} from '#copilot/infra/public/testing';
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
    const authority = createWorkspacePathAuthority({ workspaceRoot });
    return { workspaceRoot, outsideRoot, authority, io: createWorkspaceIo(authority) };
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
        const { workspaceRoot, outsideRoot, authority, io } = await createWorkspaceFixture();
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

    it('lstat preserva o symlink final, mas continua recusando symlink ancestral para fora', async () => {
        const { workspaceRoot, outsideRoot, io } = await createWorkspaceFixture();
        const insideTarget = join(workspaceRoot, 'lstat-target.txt');
        const insideLink = join(workspaceRoot, 'lstat-inside-link.txt');
        const outsideTarget = join(outsideRoot, 'lstat-outside.txt');
        const outsideLink = join(workspaceRoot, 'lstat-outside-link.txt');
        await Promise.all([writeFile(insideTarget, 'inside', 'utf8'), writeFile(outsideTarget, 'outside', 'utf8')]);
        await Promise.all([symlink(insideTarget, insideLink), symlink(outsideTarget, outsideLink)]);

        const [insideMetadata, outsideMetadata] = await Promise.all([
            io.lstatPath(insideLink),
            io.lstatPath(outsideLink),
        ]);
        expect(insideMetadata.stats.isSymbolicLink()).toBe(true);
        expect(outsideMetadata.stats.isSymbolicLink()).toBe(true);
        await expect(io.statPath(outsideLink)).rejects.toMatchObject({ code: 'PATH_SYMLINK_OUTSIDE' });

        await symlink(outsideRoot, join(workspaceRoot, 'lstat-escape-parent'));
        await expect(io.lstatPath('lstat-escape-parent/file.txt')).rejects.toMatchObject({
            code: 'PATH_SYMLINK_OUTSIDE',
        });
    });

    it('não permite cunhar capability externa nem expõe constructors crus na API pública', async () => {
        const { outsideRoot, authority } = await createWorkspaceFixture();
        const outsideFile = join(outsideRoot, 'outside.txt');
        await writeFile(outsideFile, 'outside', 'utf8');

        await expect(authority.authorizeRead(outsideFile, 'read')).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
        await expect(authority.authorizeMutation(outsideFile, 'write')).rejects.toMatchObject({
            code: 'PATH_TRAVERSAL',
        });

        const publicWorkspace = await import('#copilot/infra/public/composition/workspace/io');
        expect(publicWorkspace).not.toHaveProperty('createValidatedReadWorkspacePath');
        expect(publicWorkspace).not.toHaveProperty('createValidatedMutableWorkspacePath');
        expect(publicWorkspace).not.toHaveProperty('resolveValidatedReadWorkspacePath');
        expect(publicWorkspace).not.toHaveProperty('resolveValidatedMutableWorkspacePath');
    });

    it('liga tokens à authority exata, inclusive quando duas authorities usam o mesmo root', async () => {
        const { workspaceRoot, authority, io } = await createWorkspaceFixture();
        const sameRootAuthority = createWorkspacePathAuthority({ workspaceRoot });
        const sameRootIo = createWorkspaceIo(sameRootAuthority);
        const filePath = join(workspaceRoot, 'authority-bound.txt');
        await io.writeFileAtomic(filePath, 'inside');

        const readToken = await authority.authorizeRead(filePath, 'read');
        const writeToken = await authority.authorizeMutation(filePath, 'write');

        await expect(sameRootIo.readTextValidated(readToken)).rejects.toMatchObject({
            code: 'EVALIDATEDPATHAUTHORITY',
        });
        await expect(sameRootIo.writeFileAtomicValidated(writeToken, 'outside')).rejects.toMatchObject({
            code: 'EVALIDATEDMUTABLEPATHAUTHORITY',
        });
        await expect(io.readTextValidated(readToken)).resolves.toMatchObject({ content: 'inside' });
    });

    it('abre detached append sink apenas após workspace mutation authority', async () => {
        const { workspaceRoot, outsideRoot, io } = await createWorkspaceFixture();
        const logPath = join(workspaceRoot, 'detached.log');
        const sink = await io.openDetachedAppendSink(logPath, { mode: 0o600 });
        try {
            await sink.handle.write('detached-output');
            await sink.handle.sync();
        } finally {
            await sink.handle.close();
        }

        await expect(readFile(logPath, 'utf8')).resolves.toBe('detached-output');
        await expect(io.openDetachedAppendSink(join(outsideRoot, 'outside.log'))).rejects.toMatchObject({
            code: 'PATH_TRAVERSAL',
        });
    });

    it('publica e lê paths internos após policy async', async () => {
        const { workspaceRoot, authority, io } = await createWorkspaceFixture();
        const filePath = join(workspaceRoot, 'inside.txt');

        await io.writeFileAtomic(filePath, 'inside');
        const snapshot = await io.readText(filePath);

        expect(snapshot.content).toBe('inside');
    });

    it('aceita capability opaca read-only e evita uma segunda policy async', async () => {
        const { workspaceRoot, authority, io } = await createWorkspaceFixture();
        const filePath = join(workspaceRoot, 'inside.txt');
        await io.writeFileAtomic(filePath, 'inside');
        resetValidatedReadWorkspacePathStatsForTest();
        const capability = await authority.authorizeRead(filePath, 'read');
        expect(capability.policyVersion).toBe(IO_PATH_POLICY_VERSION);

        const [snapshot, statSnapshot] = await Promise.all([
            io.readTextValidated(capability),
            io.statPathValidated(capability),
        ]);

        expect(snapshot.content).toBe('inside');
        expect(statSnapshot.stats.isFile()).toBe(true);
        expect(getValidatedReadWorkspacePathStats()).toMatchObject({ issued: 1, accepted: 2 });
    });

    it('compõe duas capabilities read em diff sem segunda policy async', async () => {
        const { workspaceRoot, authority, io } = await createWorkspaceFixture();
        const pathA = join(workspaceRoot, 'diff-a.txt');
        const pathB = join(workspaceRoot, 'diff-b.txt');
        await Promise.all([writeFile(pathA, 'alpha\n', 'utf8'), writeFile(pathB, 'beta\n', 'utf8')]);
        resetValidatedReadWorkspacePathStatsForTest();
        const capA = await authority.authorizeRead(pathA, 'read');
        const capB = await authority.authorizeRead(pathB, 'read');

        const diff = await io.diffTextValidated(capA, capB, { contextLines: 1 });

        expect(diff.identical).toBe(false);
        expect(diff.diff).toContain('-alpha');
        expect(diff.diff).toContain('+beta');
        expect(getValidatedReadWorkspacePathStats()).toMatchObject({ issued: 2, accepted: 2 });
    });

    it('aceita capability mutável opaca em write/patch sem revalidar a path no workspace facade', async () => {
        const { workspaceRoot, authority, io } = await createWorkspaceFixture();
        const filePath = join(workspaceRoot, 'mutable.txt');
        await io.writeFileAtomic(filePath, 'before');
        resetValidatedMutableWorkspacePathStatsForTest();
        const capability = await authority.authorizeMutation(filePath, 'write');
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
        const { workspaceRoot, authority, io } = await createWorkspaceFixture();
        const sourcePath = join(workspaceRoot, 'pair-source.txt');
        const copiedPath = join(workspaceRoot, 'pair-copied.txt');
        const movedPath = join(workspaceRoot, 'pair-moved.txt');
        await io.writeFileAtomic(sourcePath, 'pair-content');
        resetValidatedReadWorkspacePathStatsForTest();
        resetValidatedMutableWorkspacePathStatsForTest();

        const copySource = await authority.authorizeRead(sourcePath, 'read');
        const copyDestination = await authority.authorizeMutation(copiedPath, 'write');
        const copied = await io.copyFileLockedValidated(copySource, copyDestination, { overwrite: false });
        expect(copied.sourceHash).toBeTruthy();
        await expect(readFile(copiedPath, 'utf8')).resolves.toBe('pair-content');

        const moveSource = await authority.authorizeMutation(copiedPath, 'write');
        const moveDestination = await authority.authorizeMutation(movedPath, 'write');
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
        const { workspaceRoot, outsideRoot, authority, io } = await createWorkspaceFixture();
        const filePath = join(workspaceRoot, 'mutable.txt');
        await io.writeFileAtomic(filePath, 'inside');
        const capability = await authority.authorizeMutation(filePath, 'write');

        await expect(
            io.patchTextLockedValidated(
                {
                    realPath: filePath,
                    workspaceRoot,
                    policyVersion: capability.policyVersion,
                    access: 'mutable',
                    policyClass: 'write',
                },
                { oldString: 'inside', newString: 'outside' },
            ),
        ).rejects.toMatchObject({ code: 'EINVALIDVALIDATEDMUTABLEPATH' });

        const outsideFile = join(outsideRoot, 'outside-mutable.txt');
        await writeFile(outsideFile, 'outside', 'utf8');
        const otherAuthority = createWorkspacePathAuthority({ workspaceRoot: outsideRoot });
        const otherWorkspaceCapability = await otherAuthority.authorizeMutation(outsideFile, 'write');
        await expect(io.writeFileAtomicValidated(otherWorkspaceCapability, 'outside')).rejects.toMatchObject({
            code: 'EVALIDATEDMUTABLEPATHAUTHORITY',
        });
        expect(() => resolveValidatedMutableWorkspacePath(capability, authority, 'delete')).toThrowError(
            expect.objectContaining({ code: 'EVALIDATEDMUTABLEPATHMODE' }),
        );
        await expect(io.readTextValidated(capability)).rejects.toMatchObject({ code: 'EINVALIDVALIDATEDPATH' });
        await expect(readFile(filePath, 'utf8')).resolves.toBe('inside');
    });

    it('rejeita lookalike sem brand, workspace divergente e uso em modo mutável', async () => {
        const { workspaceRoot, outsideRoot, authority, io } = await createWorkspaceFixture();
        const filePath = join(workspaceRoot, 'inside.txt');
        await io.writeFileAtomic(filePath, 'inside');
        const capability = await authority.authorizeRead(filePath, 'read');

        await expect(
            io.readTextValidated({
                realPath: filePath,
                workspaceRoot,
                policyVersion: capability.policyVersion,
                access: 'read-only',
            }),
        ).rejects.toMatchObject({ code: 'EINVALIDVALIDATEDPATH' });

        const outsideFile = join(outsideRoot, 'outside-read.txt');
        await writeFile(outsideFile, 'outside', 'utf8');
        const otherAuthority = createWorkspacePathAuthority({ workspaceRoot: outsideRoot });
        const otherWorkspaceCapability = await otherAuthority.authorizeRead(outsideFile, 'read');
        await expect(io.readTextValidated(otherWorkspaceCapability)).rejects.toMatchObject({
            code: 'EVALIDATEDPATHAUTHORITY',
        });
        expect(() => resolveValidatedReadWorkspacePath(capability, authority, 'write')).toThrowError(
            expect.objectContaining({ code: 'EVALIDATEDPATHMODE' }),
        );
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
