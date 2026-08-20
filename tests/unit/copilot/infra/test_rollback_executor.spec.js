// @ts-check

import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { listRollbackSidecars, persistRollbackSidecar } from '../../../../src/copilot/infra/io/fs/rollback-sidecar.js';
import { executeIoRollbackToken } from '../../../../src/copilot/infra/runtime/rollback-executor.js';
import { createIoRollbackToken, serializeIoRollbackToken } from '../../../../src/copilot/infra/runtime/rollback.js';
import {
    appendIoChangeSetEntry,
    applyIoChangeSet,
    beginIoChangeSet,
} from '../../../../src/copilot/infra/runtime/transaction.js';
import { sha256 } from '../../../../src/copilot/infra/shared/hash.js';

const WORKSPACE = '/workspaces/chatgpt-docker-puppeteer';
/** @type {string[]} */
const temporaryPaths = [];

afterEach(async () => {
    await Promise.all(temporaryPaths.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

async function tempDirectory() {
    const directory = await mkdtemp(join(WORKSPACE, 'tmp', '.rollback-executor-'));
    temporaryPaths.push(directory);
    return directory;
}

/**
 * @param {import('../../../../src/copilot/infra/runtime/transaction.js').IoRollbackHint[]} hints
 */
function tokenFromHints(hints) {
    let changeSet = beginIoChangeSet({ capability: 'file.rollback.test' });
    for (const hint of hints) {
        changeSet = appendIoChangeSetEntry(changeSet, {
            action: hint.action,
            targets: [hint.target],
            rollback: hint,
        });
    }
    return createIoRollbackToken(applyIoChangeSet(changeSet));
}

describe('infra/runtime/rollback-executor', () => {
    it('faz dry-run e restaura write com snapshot inline', async () => {
        const directory = await tempDirectory();
        const filePath = join(directory, 'file.txt');
        const previous = Buffer.from('before');
        const current = Buffer.from('after');
        await writeFile(filePath, current);
        const token = tokenFromHints([
            {
                action: 'write',
                target: filePath,
                previousHash: sha256(previous),
                contentHash: sha256(current),
                bytes: previous.byteLength,
                snapshotBase64: previous.toString('base64'),
            },
        ]);
        const allowedPaths = new Set([filePath]);

        const dryRun = await executeIoRollbackToken(serializeIoRollbackToken(token), {
            dryRun: true,
            allowedPaths,
        });
        expect(dryRun).toMatchObject({ success: true, status: 'ready', appliedCount: 0 });
        expect(await readFile(filePath, 'utf8')).toBe('after');

        const applied = await executeIoRollbackToken(token, { dryRun: false, allowedPaths });
        expect(applied).toMatchObject({ success: true, status: 'applied', appliedCount: 1 });
        expect(await readFile(filePath, 'utf8')).toBe('before');
    });

    it('restaura corretamente um arquivo anteriormente vazio', async () => {
        const directory = await tempDirectory();
        const filePath = join(directory, 'empty.txt');
        const previous = Buffer.alloc(0);
        const current = Buffer.from('after');
        await writeFile(filePath, current);
        const token = tokenFromHints([
            {
                action: 'write',
                target: filePath,
                previousHash: sha256(previous),
                contentHash: sha256(current),
                bytes: 0,
                snapshotBase64: '',
            },
        ]);

        const applied = await executeIoRollbackToken(token, {
            dryRun: false,
            allowedPaths: new Set([filePath]),
        });

        expect(applied).toMatchObject({ success: true, appliedCount: 1 });
        expect(await readFile(filePath)).toEqual(previous);
    });

    it('restaura write usando snapshot verificado em sidecar', async () => {
        const directory = await tempDirectory();
        const sidecarDirectory = join(directory, 'sidecars');
        const filePath = join(directory, 'sidecar.txt');
        const previous = Buffer.from('before-from-sidecar');
        const current = Buffer.from('after');
        const snapshotSidecar = await persistRollbackSidecar(previous, {
            directory: sidecarDirectory,
            ttlMs: 60_000,
        });
        await writeFile(filePath, current);
        const token = tokenFromHints([
            {
                action: 'write',
                target: filePath,
                previousHash: sha256(previous),
                contentHash: sha256(current),
                bytes: previous.byteLength,
                snapshotSidecar,
            },
        ]);

        const applied = await executeIoRollbackToken(token, {
            dryRun: false,
            allowedPaths: new Set([filePath]),
            sidecarDirectory,
        });

        expect(applied).toMatchObject({ success: true, appliedCount: 1 });
        expect(await readFile(filePath, 'utf8')).toBe('before-from-sidecar');
    });

    it('remove arquivo criado somente quando o hash pós-mutação confere', async () => {
        const directory = await tempDirectory();
        const filePath = join(directory, 'created.txt');
        const current = Buffer.from('created');
        await writeFile(filePath, current);
        const token = tokenFromHints([
            {
                action: 'delete',
                target: filePath,
                previousHash: null,
                contentHash: sha256(current),
                bytes: current.byteLength,
            },
        ]);

        const applied = await executeIoRollbackToken(token, {
            dryRun: false,
            allowedPaths: new Set([filePath]),
        });

        expect(applied).toMatchObject({ success: true, appliedCount: 1 });
        await expect(access(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('reporta rollback fisicamente aplicado mas não confirmado quando falha após unlink', async () => {
        const directory = await tempDirectory();
        const filePath = join(directory, 'created-unconfirmed.txt');
        const current = Buffer.from('created');
        await writeFile(filePath, current);
        const token = tokenFromHints([
            {
                action: 'delete',
                target: filePath,
                previousHash: null,
                contentHash: sha256(current),
                bytes: current.byteLength,
            },
        ]);

        const result = await executeIoRollbackToken(token, {
            dryRun: false,
            allowedPaths: new Set([filePath]),
            onPhase: (phase) => {
                if (phase === 'after-unlink') throw new Error('fault:rollback-after-unlink');
            },
        });

        expect(result).toMatchObject({
            success: false,
            status: 'partially-applied',
            appliedCount: 1,
            mutationApplied: true,
            mutationPhase: 'after-unlink',
            mutationPaths: [filePath],
            steps: [{ status: 'applied-but-unconfirmed' }],
        });
        await expect(access(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('reverte move com overwrite na ordem move-inverso e restauração do destino', async () => {
        const directory = await tempDirectory();
        const source = join(directory, 'source.txt');
        const destination = join(directory, 'destination.txt');
        const moved = Buffer.from('source-content');
        const destinationPrevious = Buffer.from('destination-content');
        await writeFile(destination, moved);
        const token = tokenFromHints([
            {
                action: 'write',
                target: destination,
                previousHash: sha256(destinationPrevious),
                contentHash: null,
                bytes: destinationPrevious.byteLength,
                snapshotBase64: destinationPrevious.toString('base64'),
            },
            {
                action: 'move',
                target: source,
                source: destination,
                destination: source,
                previousHash: sha256(moved),
                contentHash: sha256(moved),
                bytes: moved.byteLength,
            },
        ]);

        const applied = await executeIoRollbackToken(token, {
            dryRun: false,
            allowedPaths: new Set([source, destination]),
        });

        expect(applied).toMatchObject({ success: true, appliedCount: 2 });
        expect(await readFile(source, 'utf8')).toBe('source-content');
        expect(await readFile(destination, 'utf8')).toBe('destination-content');
    });

    it('bloqueia rollback quando o arquivo mudou depois da mutação original', async () => {
        const directory = await tempDirectory();
        const filePath = join(directory, 'stale.txt');
        const previous = Buffer.from('before');
        await writeFile(filePath, 'external-change');
        const token = tokenFromHints([
            {
                action: 'write',
                target: filePath,
                previousHash: sha256(previous),
                contentHash: sha256('after'),
                bytes: previous.byteLength,
                snapshotBase64: previous.toString('base64'),
            },
        ]);

        const result = await executeIoRollbackToken(token, {
            dryRun: true,
            allowedPaths: new Set([filePath]),
        });

        expect(result).toMatchObject({ success: false, status: 'blocked', code: 'EROLLBACKEXPECTEDHASH' });
        expect(await readFile(filePath, 'utf8')).toBe('external-change');
    });

    it('lista e verifica sidecars sem retornar conteúdo ou path absoluto', async () => {
        const directory = await tempDirectory();
        const sidecarDirectory = join(directory, 'sidecars');
        const payload = Buffer.from('sidecar-content');
        const descriptor = await persistRollbackSidecar(payload, {
            directory: sidecarDirectory,
            ttlMs: 60_000,
        });

        const result = await listRollbackSidecars({
            directory: sidecarDirectory,
            verifyContent: true,
            maxEntries: 10,
        });

        expect(result.count).toBe(1);
        expect(result.sidecars[0]).toMatchObject({
            contentHash: descriptor.contentHash,
            bytes: payload.byteLength,
            expired: false,
            contentVerified: true,
        });
        expect(result.sidecars[0]).not.toHaveProperty('path');
        expect(result.sidecars[0]).not.toHaveProperty('content');
    });
});
