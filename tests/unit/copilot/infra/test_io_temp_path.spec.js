// @ts-check

import {
    cleanupStaleSiblingTemps,
    createSiblingTempPath,
    parseSiblingTempEntry,
} from '#copilot/infra/internal/filesystem/transaction';
import { writeAtomicFileUnlocked } from '#copilot/infra/internal/filesystem/write';
import { access, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resetSiblingTempCleanupForTest } from '#copilot/infra/public/testing';
/** @type {string[]} */
const tempDirs = [];

afterEach(async () => {
    resetSiblingTempCleanupForTest();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir() {
    const dir = await mkdtemp(path.join(tmpdir(), 'copilot-io-temp-cleanup-'));
    tempDirs.push(dir);
    return dir;
}

function localHostId() {
    const generated = parseSiblingTempEntry(path.basename(createSiblingTempPath('/workspace/host.txt', 'write')));
    if (!generated) throw new Error('generated temp path did not match its own schema');
    return generated.hostId;
}

/** @param {string} hostId @param {number} pid @param {string} token @param {string} [role] */
function managedEntry(hostId, pid, token, role = 'move') {
    return `.orphan.bin.${hostId}.${pid}.${token}.${role}.tmp`;
}

describe('infra/io sibling temporary paths', () => {
    it('cria nome oculto, irmão, identificável e com token de 128 bits', () => {
        const target = path.join('/workspace', 'report.txt');
        const temporary = createSiblingTempPath(target, 'write');

        expect(path.dirname(temporary)).toBe(path.dirname(target));
        expect(path.basename(temporary)).toMatch(
            new RegExp(`^\\.report\\.txt\\.[a-f0-9]{12}\\.${process.pid}\\.[a-f0-9]{32}\\.write\\.tmp$`),
        );
        expect(parseSiblingTempEntry(path.basename(temporary))).toMatchObject({
            basename: 'report.txt',
            pid: process.pid,
            role: 'write',
        });
    });

    it('gera nomes independentes para o mesmo destino', () => {
        const target = path.join('/workspace', 'report.txt');

        expect(createSiblingTempPath(target, 'copy')).not.toBe(createSiblingTempPath(target, 'copy'));
    });

    it('mantém nomes longos dentro do orçamento conservador de entrada', () => {
        const target = path.join('/workspace', `${'á'.repeat(180)}.txt`);
        const temporary = createSiblingTempPath(target, 'move');

        expect(Buffer.byteLength(path.basename(temporary), 'utf8')).toBeLessThanOrEqual(240);
        expect(path.basename(temporary)).toMatch(/\.[a-f0-9]{32}\.move\.tmp$/);
        expect(path.basename(temporary)).not.toContain('\uFFFD');
    });

    it('rejeita papéis que poderiam escapar da convenção', () => {
        expect(() => createSiblingTempPath('/workspace/report.txt', '../write')).toThrow(TypeError);
    });

    it('remove somente temporário antigo do host local sem PID vivo', async () => {
        const dir = await createTempDir();
        const hostId = localHostId();
        const old = new Date(Date.now() - 60_000);
        const stale = managedEntry(hostId, 900001, 'a'.repeat(32));
        const active = managedEntry(hostId, process.pid, 'b'.repeat(32));
        const foreign = managedEntry('f'.repeat(12), 900002, 'c'.repeat(32));
        const abandonedForeign = managedEntry('e'.repeat(12), 900004, 'f'.repeat(32));
        const young = managedEntry(hostId, 900003, 'd'.repeat(32));
        const legacy = `.legacy.${process.pid}.${'e'.repeat(32)}.move.tmp`;

        await Promise.all(
            [stale, active, foreign, abandonedForeign, young, legacy].map((entry) =>
                writeFile(path.join(dir, entry), entry),
            ),
        );
        await Promise.all([stale, active, foreign, legacy].map((entry) => utimes(path.join(dir, entry), old, old)));
        const abandoned = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
        await utimes(path.join(dir, abandonedForeign), abandoned, abandoned);

        const result = await cleanupStaleSiblingTemps({
            directory: dir,
            minimumAgeMs: 1_000,
            foreignHostMinimumAgeMs: 7 * 24 * 60 * 60 * 1000,
            isProcessAlive: (pid) => pid === process.pid,
        });

        expect(result).toMatchObject({
            matched: 5,
            removed: 2,
            removedForeignHost: 1,
            skippedYoung: 1,
            skippedActive: 1,
            skippedForeignHost: 1,
            failed: 0,
            limited: false,
        });
        await expect(access(path.join(dir, stale))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(access(path.join(dir, abandonedForeign))).rejects.toMatchObject({ code: 'ENOENT' });
        expect((await readdir(dir)).sort()).toEqual([active, foreign, legacy, young].sort());
    });

    it('faz cleanup best-effort apenas na primeira publicação do diretório por processo', async () => {
        const dir = await createTempDir();
        const hostId = localHostId();
        const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        const firstStale = managedEntry(hostId, 2_147_483_647, '1'.repeat(32), 'write');
        const secondStale = managedEntry(hostId, 2_147_483_647, '2'.repeat(32), 'write');
        await writeFile(path.join(dir, firstStale), 'stale');
        await utimes(path.join(dir, firstStale), old, old);

        await writeAtomicFileUnlocked(path.join(dir, 'first.txt'), 'first');
        await expect(access(path.join(dir, firstStale))).rejects.toMatchObject({ code: 'ENOENT' });

        await writeFile(path.join(dir, secondStale), 'stale');
        await utimes(path.join(dir, secondStale), old, old);
        await writeAtomicFileUnlocked(path.join(dir, 'second.txt'), 'second');

        expect(await access(path.join(dir, secondStale))).toBeUndefined();
    });
});
