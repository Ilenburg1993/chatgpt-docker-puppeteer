// @ts-check

import { channel } from 'node:diagnostics_channel';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
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
});
