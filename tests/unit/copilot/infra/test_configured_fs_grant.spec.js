// @ts-check

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/** @type {string[]} */
const TEMP_DIRS = [];
afterEach(async () => {
    for (const directory of TEMP_DIRS.splice(0).reverse()) await rm(directory, { recursive: true, force: true });
});

async function tempRoot() {
    const root = await mkdtemp(join(tmpdir(), 'configured-fs-grant-'));
    TEMP_DIRS.push(root);
    return root;
}

describe('configured filesystem grants', () => {
    it('autoriza somente operações e paths declarados sob um root canônico', async () => {
        const root = await tempRoot();
        const sibling = `${root}-sibling`;
        await mkdir(sibling, { recursive: true });
        TEMP_DIRS.push(sibling);
        const file = join(root, 'nested', 'state.json');
        const outside = join(sibling, 'outside.json');
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, 'before', 'utf8');
        await writeFile(outside, 'outside', 'utf8');

        const grant = createConfiguredFsGrant({
            id: 'unit.root-read-write',
            roots: [root],
            operations: ['read', 'write', 'stat'],
            durability: ['file-and-directory', 'none'],
        });
        const io = createConfiguredFsIo(grant);

        expect(Object.isFrozen(grant)).toBe(true);
        expect(Object.isFrozen(io)).toBe(true);
        await expect(io.readTextFresh(file)).resolves.toMatchObject({ content: 'before' });
        await io.writeFileAtomic(file, 'after', { durability: 'none' });
        await expect(readFile(file, 'utf8')).resolves.toBe('after');
        await expect(io.statPath(file)).resolves.toHaveProperty('stats');
        await expect(io.readTextFresh(outside)).rejects.toMatchObject({ code: 'ERR_CONFIGURED_FS_PATH_DENIED' });
        await expect(
            io.readTextFresh(join(root, '..', `${root.split('/').pop()}-sibling`, 'outside.json')),
        ).rejects.toMatchObject({
            code: 'ERR_CONFIGURED_FS_PATH_DENIED',
        });
        await expect(io.deleteFile(file)).rejects.toMatchObject({ code: 'ERR_CONFIGURED_FS_OPERATION_DENIED' });
    });

    it('exactPaths não autoriza siblings do mesmo diretório', async () => {
        const root = await tempRoot();
        const allowed = join(root, 'allowed.json');
        const sibling = join(root, 'sibling.json');
        await Promise.all([writeFile(allowed, 'allowed'), writeFile(sibling, 'sibling')]);
        const io = createConfiguredFsIo(
            createConfiguredFsGrant({ id: 'unit.exact', exactPaths: [allowed], operations: ['read'] }),
        );
        await expect(io.readTextFresh(allowed)).resolves.toMatchObject({ content: 'allowed' });
        await expect(io.readTextFresh(sibling)).rejects.toMatchObject({ code: 'ERR_CONFIGURED_FS_PATH_DENIED' });
    });

    it('rejeita symlink final e symlink ancestral antes de tocar o alvo', async () => {
        const root = await tempRoot();
        const external = await tempRoot();
        const externalFile = join(external, 'secret.txt');
        await writeFile(externalFile, 'secret');
        const finalLink = join(root, 'final-link.txt');
        const ancestorLink = join(root, 'linked-dir');
        await symlink(externalFile, finalLink);
        await symlink(external, ancestorLink, 'dir');
        const io = createConfiguredFsIo(
            createConfiguredFsGrant({ id: 'unit.no-symlink', roots: [root], operations: ['read'] }),
        );

        await expect(io.readTextFresh(finalLink)).rejects.toMatchObject({ code: 'ERR_CONFIGURED_FS_SYMLINK' });
        await expect(io.readTextFresh(join(ancestorLink, 'secret.txt'))).rejects.toMatchObject({
            code: 'ERR_CONFIGURED_FS_SYMLINK',
        });
    });

    it('rejeita durability fora da allowlist e permite criar leaf novo sob ancestrais válidos', async () => {
        const root = await tempRoot();
        const target = join(root, 'new', 'nested.txt');
        await mkdir(dirname(target), { recursive: true });
        const io = createConfiguredFsIo(
            createConfiguredFsGrant({
                id: 'unit.durability',
                roots: [root],
                operations: ['write'],
                durability: ['none'],
            }),
        );
        await expect(io.writeFileAtomic(target, 'x', { durability: 'file' })).rejects.toMatchObject({
            code: 'ERR_CONFIGURED_FS_DURABILITY_DENIED',
        });
        await io.writeFileAtomic(target, 'ok', { durability: 'none' });
        await expect(readFile(target, 'utf8')).resolves.toBe('ok');
    });

    it('preserva exclusividade em writeFileAtomic failIfExists sem sobrescrever destino', async () => {
        const root = await tempRoot();
        const file = join(root, 'exclusive.txt');
        await writeFile(file, 'existing', 'utf8');
        const io = createConfiguredFsIo(
            createConfiguredFsGrant({
                id: 'unit.exclusive-write',
                roots: [root],
                operations: ['write'],
                durability: ['none'],
            }),
        );

        await expect(
            io.writeFileAtomic(file, 'incoming', { durability: 'none', failIfExists: true }),
        ).rejects.toMatchObject({
            code: 'EEXIST',
        });
        await expect(readFile(file, 'utf8')).resolves.toBe('existing');
        const created = join(root, 'created.txt');
        await io.writeFileAtomic(created, 'created', { durability: 'none', failIfExists: true });
        await expect(readFile(created, 'utf8')).resolves.toBe('created');
    });

    it('autoriza move somente quando source e destination pertencem ao mesmo grant', async () => {
        const root = await tempRoot();
        const outsideRoot = await tempRoot();
        const source = join(root, 'source.log');
        const destination = join(root, 'source.log.1');
        const outsideDestination = join(outsideRoot, 'escaped.log');
        await writeFile(source, 'payload', 'utf8');
        const io = createConfiguredFsIo(
            createConfiguredFsGrant({
                id: 'unit.move',
                exactPaths: [source, destination],
                operations: ['move'],
            }),
        );

        await io.moveFile(source, destination);
        await expect(readFile(destination, 'utf8')).resolves.toBe('payload');

        await writeFile(source, 'second', 'utf8');
        await expect(io.moveFile(source, outsideDestination)).rejects.toMatchObject({
            code: 'ERR_CONFIGURED_FS_PATH_DENIED',
        });
        await expect(readFile(source, 'utf8')).resolves.toBe('second');
        await expect(readFile(outsideDestination, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('preserva mode em atomic replace e mantém metadata de fresh/range reads', async () => {
        const root = await tempRoot();
        const file = join(root, 'mode-state.txt');
        await writeFile(file, 'alpha', 'utf8');
        await chmod(file, 0o640);
        const io = createConfiguredFsIo(
            createConfiguredFsGrant({
                id: 'unit.mode-and-range',
                exactPaths: [file],
                operations: ['read', 'write', 'stat'],
                durability: ['none'],
            }),
        );

        const fresh = await io.readTextFresh(file);
        expect(fresh.content).toBe('alpha');
        expect(fresh.cacheFingerprintStrategy).toBe('fresh-snapshot');
        expect(fresh.io).toMatchObject({
            operation: 'read',
            cache: 'none',
            engine: 'io-engine.fs.readFile.bytes-fresh',
        });

        await io.writeFileAtomic(file, 'beta', { durability: 'none' });
        expect((await stat(file)).mode & 0o777).toBe(0o640);
        expect(await readFile(file, 'utf8')).toBe('beta');

        const range = await io.readBytesRangeFresh(file, { start: 1, maxBytes: 2, rejectSymlink: true });
        expect(range.content.toString('utf8')).toBe('et');
        expect(range).toMatchObject({
            bytesRead: 2,
            startByte: 1,
            endByteExclusive: 3,
            consistent: true,
        });
        expect(range.io).toMatchObject({ operation: 'read', engine: 'io-engine.fs.read.range-fresh', cache: 'none' });
    });

    it('mantém append one-shot dentro do lock até write/durability e preserva linhas concorrentes', async () => {
        const root = await tempRoot();
        const file = join(root, 'history.jsonl');
        const io = createConfiguredFsIo(
            createConfiguredFsGrant({
                id: 'unit.append-text',
                exactPaths: [file],
                operations: ['append', 'read'],
                durability: ['none'],
            }),
        );

        const rows = Array.from({ length: 12 }, (_, index) => `${JSON.stringify({ index })}\n`);
        await Promise.all(rows.map((row) => io.appendText(file, row, { mode: 0o600, durability: 'none' })));
        const persisted = (await readFile(file, 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(persisted).toHaveLength(rows.length);
        expect(persisted.map((row) => row.index).sort((left, right) => left - right)).toEqual(
            Array.from({ length: rows.length }, (_, index) => index),
        );
        expect((await stat(file)).mode & 0o777).toBe(0o600);
        await expect(io.writeFileAtomic(file, 'forbidden')).rejects.toMatchObject({
            code: 'ERR_CONFIGURED_FS_OPERATION_DENIED',
        });
    });

    it('não aceita objeto forjado como grant', () => {
        const fake = /** @type {Parameters<typeof createConfiguredFsIo>[0]} */ ({
            id: 'fake',
            roots: ['/'],
            exactPaths: [],
            operations: ['read'],
            symlinkPolicy: 'deny',
            durability: ['file-and-directory'],
            policyVersion: 1,
        });
        expect(() => createConfiguredFsIo(fake)).toThrow(
            expect.objectContaining({ code: 'ERR_CONFIGURED_FS_GRANT_REQUIRED' }),
        );
    });
});
