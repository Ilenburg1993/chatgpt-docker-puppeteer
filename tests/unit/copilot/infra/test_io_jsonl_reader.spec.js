// @ts-check

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readJsonlTail } from '../../../../src/copilot/infra/io/jsonl-reader.js';

/** @type {string[]} */
const tempDirs = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('infra/io/jsonl-reader', () => {
    it('ignora cauda parcial e preserva registros completos', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-jsonl-reader-'));
        tempDirs.push(dir);
        const filePath = join(dir, 'events.jsonl');
        await writeFile(filePath, '{"id":1}\n{"id":2}\n{"id":3', 'utf8');

        const result = await readJsonlTail(filePath, { maxLines: 10 });

        expect(result.records).toEqual([{ id: 1 }, { id: 2 }]);
        expect(result.invalidLines).toBe(1);
        expect(result.trailingPartialIgnored).toBe(true);
    });

    it('aceita último registro válido mesmo sem newline final', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-jsonl-reader-'));
        tempDirs.push(dir);
        const filePath = join(dir, 'events.jsonl');
        await writeFile(filePath, '{"id":1}\n{"id":2}', 'utf8');

        const result = await readJsonlTail(filePath, { maxLines: 10 });

        expect(result.records).toEqual([{ id: 1 }, { id: 2 }]);
        expect(result.trailingPartialIgnored).toBe(false);
    });
});
