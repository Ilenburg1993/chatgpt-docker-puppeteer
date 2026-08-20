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

    it('marca repair como aplicado quando hook falha depois do truncate', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-jsonl-reader-'));
        tempDirs.push(dir);
        const filePath = join(dir, 'applied-truncate.jsonl');
        await writeFile(filePath, '{"id":1}\n{"broken":');

        await expect(
            repairJsonlTrailingPartial(filePath, {
                onPhase: (phase) => {
                    if (phase === 'after-truncate') throw new Error('fault:after-truncate');
                },
            }),
        ).rejects.toMatchObject({
            message: 'fault:after-truncate',
            mutationApplied: true,
            mutationPhase: 'jsonl-truncate-confirmation',
            mutationPath: filePath,
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

    it('limita bytes da cauda quando uma linha sem newline é anormalmente grande', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-jsonl-reader-'));
        tempDirs.push(dir);
        const filePath = join(dir, 'events.jsonl');
        await writeFile(filePath, `{"payload":"${'x'.repeat(8_192)}"}`);

        const result = await readJsonlTail(filePath, { maxLines: 10, blockSize: 1_024, maxBytes: 2_048 });

        expect(result.records).toEqual([]);
        expect(result.bytesRead).toBe(2_048);
        expect(result.maxBytes).toBe(2_048);
        expect(result.truncatedByByteLimit).toBe(true);
    });

    it('rejeita bytes UTF-8 inválidos em vez de aceitar texto substituído', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-jsonl-reader-'));
        tempDirs.push(dir);
        const filePath = join(dir, 'events.jsonl');
        await writeFile(filePath, Buffer.from([0x7b, 0x22, 0x76, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]));

        await expect(readJsonlTail(filePath, { maxLines: 10 })).rejects.toMatchObject({ code: 'EUTF8JSONL' });
        await expect(repairJsonlTrailingPartial(filePath)).rejects.toMatchObject({ code: 'EUTF8JSONL' });
    });

    it('preserva code point UTF-8 dividido entre blocos cronológicos', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-jsonl-reader-'));
        tempDirs.push(dir);
        const filePath = join(dir, 'events.jsonl');
        let content = '';
        for (let suffixLength = 900; suffixLength < 1_100; suffixLength += 1) {
            const candidate = `${JSON.stringify({ value: `😀${'x'.repeat(suffixLength)}` })}\n`;
            const bytes = Buffer.from(candidate);
            const emojiStart = bytes.indexOf(Buffer.from('😀'));
            const boundary = bytes.length - 1_024;
            if (boundary > emojiStart && boundary < emojiStart + 4) {
                content = candidate;
                break;
            }
        }
        expect(content).not.toBe('');
        await writeFile(filePath, content);

        const result = await readJsonlTail(filePath, { maxLines: 2, blockSize: 1_024, maxBytes: 4_096 });

        expect(result.records).toEqual([JSON.parse(content)]);
        expect(result.truncatedByByteLimit).toBe(false);
    });

    it('descarta linha parcial em bytes antes de validar UTF-8 dos registros completos', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-jsonl-reader-'));
        tempDirs.push(dir);
        const filePath = join(dir, 'events.jsonl');
        await writeFile(filePath, Buffer.concat([Buffer.alloc(4_096, 0xff), Buffer.from('\n{"id":2}\n', 'utf8')]));

        const result = await readJsonlTail(filePath, { maxLines: 2, blockSize: 1_024, maxBytes: 1_024 });

        expect(result.records).toEqual([{ id: 2 }]);
        expect(result.truncatedByByteLimit).toBe(true);
    });
});
