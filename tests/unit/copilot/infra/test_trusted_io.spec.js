// @ts-check

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { writeFileAtomicTrusted } from '#copilot/infra/public/trusted-io';

/** @type {string[]} */
const cleanupPaths = [];

afterEach(async () => {
    await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('trusted IO facade', () => {
    it('exige caller explícito antes de acessar o filesystem', async () => {
        const root = await mkdtemp(join(tmpdir(), 'copilot-trusted-io-'));
        cleanupPaths.push(root);
        const filePath = join(root, 'state.json');

        await expect(
            writeFileAtomicTrusted(filePath, '{}', /** @type {any} */ ({ mode: 0o600 })),
        ).rejects.toThrow('requires a non-empty caller');
        await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('publica atomicamente um path trusted declarado', async () => {
        const root = await mkdtemp(join(tmpdir(), 'copilot-trusted-io-'));
        cleanupPaths.push(root);
        const filePath = join(root, 'state.json');

        await writeFileAtomicTrusted(filePath, '{"ok":true}\n', { caller: 'test.trusted-io', mode: 0o600 });

        await expect(readFile(filePath, 'utf8')).resolves.toBe('{"ok":true}\n');
    });
});
