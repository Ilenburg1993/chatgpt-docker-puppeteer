// @ts-check

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readJsonlTail, repairJsonlTrailingPartial } from '../../../../src/copilot/infra/io/jsonl-reader.js';

/** @type {string[]} */
const TEMP_DIRS = [];

afterEach(async () => {
    while (TEMP_DIRS.length > 0) {
        const dir = TEMP_DIRS.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

async function createTempDir() {
    const dir = await mkdtemp(join(tmpdir(), 'copilot-jsonl-reader-'));
    TEMP_DIRS.push(dir);
    return dir;
}

describe('infra/io/jsonl-reader', () => {
    it('valida último registro legítimo maior que a janela rápida de reparo', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'large-valid.jsonl');
        const first = JSON.stringify({ id: 1 });
        const large = JSON.stringify({ id: 2, payload: 'x'.repeat(4_096) });
        const content = `${first}\n${large}`;
        await writeFile(file, content, 'utf8');

        const repair = await repairJsonlTrailingPartial(file, {
            maxTrailingRecordBytes: 1_024,
            maxRepairScanBytes: 8_192,
        });

        expect(repair).toMatchObject({
            repaired: false,
            reason: 'valid-trailing-record',
            previousBytes: Buffer.byteLength(content, 'utf8'),
            finalBytes: Buffer.byteLength(content, 'utf8'),
            truncatedBytes: 0,
        });
        expect(await readFile(file, 'utf8')).toBe(content);

        const tail = await readJsonlTail(file, { maxLines: 2, blockSize: 1_024 });
        expect(tail.records).toHaveLength(2);
        expect(tail.invalidLines).toBe(0);
    });

    it('trunca partial final maior que a janela rápida quando newline anterior está dentro da varredura limitada', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'large-invalid.jsonl');
        const first = JSON.stringify({ id: 1 });
        const partial = `{"id":2,"payload":"${'x'.repeat(4_096)}`;
        const content = `${first}\n${partial}`;
        const expectedFinal = `${first}\n`;
        await writeFile(file, content, 'utf8');

        const repair = await repairJsonlTrailingPartial(file, {
            maxTrailingRecordBytes: 1_024,
            maxRepairScanBytes: 8_192,
        });

        expect(repair).toMatchObject({
            repaired: true,
            reason: 'invalid-trailing-partial',
            previousBytes: Buffer.byteLength(content, 'utf8'),
            finalBytes: Buffer.byteLength(expectedFinal, 'utf8'),
        });
        expect(repair.truncatedBytes).toBeGreaterThan(1_024);
        expect(await readFile(file, 'utf8')).toBe(expectedFinal);
    });

    it('mantém arquivo intacto quando a linha final excede a varredura máxima configurada', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'too-large.jsonl');
        const first = JSON.stringify({ id: 1 });
        const partial = `{"id":2,"payload":"${'x'.repeat(4_096)}`;
        const content = `${first}\n${partial}`;
        await writeFile(file, content, 'utf8');

        const repair = await repairJsonlTrailingPartial(file, {
            maxTrailingRecordBytes: 1_024,
            maxRepairScanBytes: 2_048,
        });

        expect(repair).toMatchObject({
            repaired: false,
            reason: 'trailing-record-too-large',
            previousBytes: Buffer.byteLength(content, 'utf8'),
            finalBytes: Buffer.byteLength(content, 'utf8'),
            truncatedBytes: 0,
        });
        expect(await readFile(file, 'utf8')).toBe(content);
    });
});
