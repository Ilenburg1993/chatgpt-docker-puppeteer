// @ts-check

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readJsonlTail, repairJsonlTrailingPartial } from '../../../../src/copilot/infra/io/jsonl-reader.js';

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

    it('trunca fisicamente apenas a última linha inválida quando solicitado', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-jsonl-reader-'));
        tempDirs.push(dir);
        const filePath = join(dir, 'events.jsonl');
        await writeFile(filePath, '{"id":1}\n{"broken":');

        const result = await readJsonlTail(filePath, { maxLines: 10, repairTrailingPartial: true });

        expect(result.records).toEqual([{ id: 1 }]);
        expect(result.trailingPartialIgnored).toBe(false);
        expect(result.trailingRepair).toMatchObject({
            repaired: true,
            reason: 'invalid-trailing-partial',
            truncatedBytes: Buffer.byteLength('{"broken":'),
        });
        expect(await readFile(filePath, 'utf8')).toBe('{"id":1}\n');
    });

    it('preserva último registro JSON válido sem newline', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-jsonl-reader-'));
        tempDirs.push(dir);
        const filePath = join(dir, 'events.jsonl');
        await writeFile(filePath, '{"id":1}\n{"id":2}');

        const repair = await repairJsonlTrailingPartial(filePath);

        expect(repair).toMatchObject({ repaired: false, reason: 'valid-trailing-record', truncatedBytes: 0 });
        expect(await readFile(filePath, 'utf8')).toBe('{"id":1}\n{"id":2}');
    });

    it('mantém cauda intacta quando fault injection ocorre antes do truncate', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-jsonl-reader-'));
        tempDirs.push(dir);
        const filePath = join(dir, 'events.jsonl');
        const content = '{"id":1}\n{"broken":';
        await writeFile(filePath, content);

        await expect(
            repairJsonlTrailingPartial(filePath, {
                onPhase: (phase) => {
                    if (phase === 'before-truncate') throw new Error('fault:before-truncate');
                },
            }),
        ).rejects.toThrow('fault:before-truncate');

        expect(await readFile(filePath, 'utf8')).toBe(content);
    });

    it('não aloca nem trunca registro final acima do orçamento sem newline conhecido', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-jsonl-reader-'));
        tempDirs.push(dir);
        const filePath = join(dir, 'events.jsonl');
        const content = `{"payload":"${'x'.repeat(4_096)}`;
        await writeFile(filePath, content);

        const repair = await repairJsonlTrailingPartial(filePath, { maxTrailingRecordBytes: 1_024 });

        expect(repair).toMatchObject({ repaired: false, reason: 'trailing-record-too-large', truncatedBytes: 0 });
        expect(await readFile(filePath, 'utf8')).toBe(content);
    });
});
