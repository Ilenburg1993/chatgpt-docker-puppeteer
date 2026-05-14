// @ts-check

import { channel } from 'node:diagnostics_channel';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { scanDirectory } from '../../../../src/copilot/infra/io-scanner.js';

/** @type {string[]} */
const TEMP_DIRS = [];

afterEach(async () => {
    while (TEMP_DIRS.length > 0) {
        const dir = TEMP_DIRS.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

async function createTempDir() {
    const dir = await mkdtemp(join(tmpdir(), 'copilot-io-scanner-'));
    TEMP_DIRS.push(dir);
    return dir;
}

describe('infra/io-scanner', () => {
    it('rejeita rootPath/workspaceRoot inválidos com null-byte', async () => {
        const dir = await createTempDir();
        await expect(scanDirectory(`${dir}\u0000bad`)).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_VALUE' });
        await expect(scanDirectory(dir, { workspaceRoot: `${dir}\u0000bad` })).rejects.toMatchObject({
            code: 'ERR_INVALID_ARG_VALUE',
        });
    });

    it('inclui realpath no fingerprint para freshness incremental', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'target.txt');
        await writeFile(file, 'hello', 'utf8');

        const result = await scanDirectory(dir, { fingerprint: true });
        const entry = result.entries.find((item) => item.name === 'target.txt');

        expect(entry?.fingerprint?.realpath).toBe(await realpath(file));
        expect(entry?.fingerprint?.size).toBe(5);
        expect(typeof entry?.fingerprint?.mtimeMs).toBe('number');
    });

    it('publica eventos de lifecycle scan.start e scan.complete', async () => {
        const dir = await createTempDir();
        await writeFile(join(dir, 'a.txt'), 'a', 'utf8');
        /** @type {{ phase?: string; traceId?: string }[]} */
        const events = [];
        const scanChannel = channel('copilot.io.scan');
        /** @param {unknown} message */
        const handler = (message) => events.push(/** @type {{ phase?: string; traceId?: string }} */ (message));
        scanChannel.subscribe(handler);
        try {
            await scanDirectory(dir, { traceId: 'scan-test-trace', fingerprint: true });
        } finally {
            scanChannel.unsubscribe(handler);
        }

        expect(events.some((event) => event.phase === 'start' && event.traceId === 'scan-test-trace')).toBe(true);
        expect(events.some((event) => event.phase === 'complete' && event.traceId === 'scan-test-trace')).toBe(true);
    });

    it('preserva symlink como entrada própria sem seguir árvore implicitamente', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'real.txt');
        const link = join(dir, 'link.txt');
        await writeFile(file, 'real', 'utf8');
        await symlink(file, link);

        const result = await scanDirectory(dir, { fingerprint: true });
        const entry = result.entries.find((item) => item.name === 'link.txt');

        expect(entry?.type).toBe('symlink');
        expect(entry?.fingerprint).toBeUndefined();
    });

    it('respeita .gitignore quando solicitado', async () => {
        const dir = await createTempDir();
        await writeFile(join(dir, '.gitignore'), 'ignored.txt\nnested/private.md\n', 'utf8');
        await mkdir(join(dir, 'nested'), { recursive: true });
        await writeFile(join(dir, 'visible.txt'), 'visible', 'utf8');
        await writeFile(join(dir, 'ignored.txt'), 'ignored', 'utf8');
        await writeFile(join(dir, 'nested', 'private.md'), 'private', 'utf8');

        const result = await scanDirectory(dir, {
            workspaceRoot: dir,
            recursive: true,
            respectGitignore: true,
            showHidden: true,
        });
        const names = JSON.stringify(result.entries);

        expect(names).toContain('visible.txt');
        expect(names).not.toContain('ignored.txt');
        expect(names).not.toContain('private.md');
    });

    it('aplica denylist canônica durante scan recursivo', async () => {
        const dir = await createTempDir();
        await mkdir(join(dir, 'node_modules'), { recursive: true });
        await writeFile(join(dir, 'node_modules', 'dep.js'), 'module.exports = 1;', 'utf8');
        await writeFile(join(dir, 'source.js'), 'export const ok = true;', 'utf8');

        const result = await scanDirectory(dir, {
            workspaceRoot: dir,
            recursive: true,
            respectDenylist: true,
            showHidden: true,
        });
        const names = JSON.stringify(result.entries);

        expect(names).toContain('source.js');
        expect(names).not.toContain('node_modules');
        expect(names).not.toContain('dep.js');
    });

    it('não prende slots de concorrência ao descer em muitos diretórios', async () => {
        const dir = await createTempDir();
        for (let i = 0; i < 12; i++) {
            await mkdir(join(dir, `dir-${i}`), { recursive: true });
            await writeFile(join(dir, `dir-${i}`, 'file.txt'), `file ${i}`, 'utf8');
        }

        const result = await Promise.race([
            scanDirectory(dir, { workspaceRoot: dir, recursive: true, concurrency: 2 }),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('scan timeout')), 2_000);
            }),
        ]);
        const entries = /** @type {Awaited<ReturnType<typeof scanDirectory>>} */ (result).entries;

        expect(JSON.stringify(entries)).toContain('dir-11');
        expect(JSON.stringify(entries)).toContain('file.txt');
    });

    it('processa scans em batches sem alterar ordenação ou recursão', async () => {
        const dir = await createTempDir();
        for (let i = 0; i < 5; i++) {
            await mkdir(join(dir, `b-${i}`), { recursive: true });
            await writeFile(join(dir, `b-${i}`, `${i}.txt`), `value ${i}`, 'utf8');
        }

        const result = await scanDirectory(dir, {
            workspaceRoot: dir,
            recursive: true,
            depth: 2,
            batchSize: 2,
            concurrency: 2,
        });

        expect(result.entries.map((entry) => entry.name)).toEqual(['b-0', 'b-1', 'b-2', 'b-3', 'b-4']);
        expect(result.entries.at(4)?.children?.map((entry) => entry.name)).toEqual(['4.txt']);
        expect(result.io.advisoryLimits).toMatchObject({ batchSize: 2, concurrency: 2 });
    });
});
