// @ts-check

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { fileExists, readJson, writeJson } from '../../../../src/copilot/infra/storage.js';

/** @type {string[]} */
const TEMP_DIRS = [];

afterEach(async () => {
    while (TEMP_DIRS.length > 0) {
        const dir = TEMP_DIRS.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

async function createTempDir() {
    const dir = await mkdtemp(join(tmpdir(), 'copilot-storage-'));
    TEMP_DIRS.push(dir);
    return dir;
}

describe('infra/storage', () => {
    it('lê fallback para JSON ausente ou inválido', async () => {
        const dir = await createTempDir();
        const missing = join(dir, 'missing.json');
        const invalid = join(dir, 'invalid.json');
        await writeFile(invalid, '{bad', 'utf8');

        await expect(readJson(missing, { ok: false })).resolves.toEqual({ ok: false });
        await expect(readJson(invalid, { ok: false })).resolves.toEqual({ ok: false });
    });

    it('escreve JSON formatado via storage modular', async () => {
        const dir = await createTempDir();
        const target = join(dir, 'nested', 'state.json');

        await writeJson(target, { ok: true, count: 2 });

        expect(fileExists(target)).toBe(true);
        await expect(readJson(target, null)).resolves.toEqual({ ok: true, count: 2 });
        await expect(readFile(target, 'utf8')).resolves.toBe('{\n  "ok": true,\n  "count": 2\n}\n');
    });
});
