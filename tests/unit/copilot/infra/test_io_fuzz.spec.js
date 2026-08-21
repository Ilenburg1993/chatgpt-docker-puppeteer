// @ts-check

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { patchTextLocked } from '#copilot/infra/internal/filesystem/mutation';
import { readTextLineChunks } from '#copilot/infra/internal/filesystem/read';
import { computeTextPatch } from '../../../../src/copilot/infra/filesystem/patch/index.js';

const PATCH_SEED = 0x1a2b3c4d;
const CHUNK_SEED = 0x5e6f7788;
const PATCH_CASES = 160;
const CHUNK_CASES = 48;
const OLD = '<<OLD>>';
const TEXT_ATOMS = ['alpha', 'ação', 'βeta', '東京', '🚀', 'zero', 'fim'];
/** @type {string[]} */
const tempDirs = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Mulberry32: PRNG pequeno e estável para reproduzir qualquer caso por seed.
 *
 * @param {number} seed
 */
function createRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * @param {() => number} random
 * @param {number} maxExclusive
 */
function integer(random, maxExclusive) {
    return Math.floor(random() * maxExclusive);
}

/**
 * @template T
 * @param {() => number} random
 * @param {readonly T[]} values
 * @returns {T}
 */
function pick(random, values) {
    return /** @type {T} */ (values[integer(random, values.length)]);
}

/**
 * @param {() => number} random
 * @param {number} minAtoms
 * @param {number} maxAtoms
 */
function randomText(random, minAtoms = 1, maxAtoms = 5) {
    const count = minAtoms + integer(random, maxAtoms - minAtoms + 1);
    return Array.from({ length: count }, () => pick(random, TEXT_ATOMS)).join(' ');
}

/**
 * @param {string} content
 * @param {string} oldString
 * @param {string} newString
 * @param {number} occurrenceIndex
 */
function replaceOccurrence(content, oldString, newString, occurrenceIndex) {
    let seen = 0;
    return content.replaceAll(oldString, (match) => {
        seen += 1;
        return seen === occurrenceIndex ? newString : match;
    });
}

/**
 * @param {number} seed
 * @param {number} count
 * @param {(random: () => number, caseIndex: number) => Promise<void> | void} run
 */
async function runSeededCases(seed, count, run) {
    const random = createRandom(seed);
    for (let caseIndex = 0; caseIndex < count; caseIndex += 1) {
        try {
            await run(random, caseIndex);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Fuzz reproduzível falhou: seed=${seed} case=${caseIndex}: ${message}`, { cause: error });
        }
    }
}

async function createTempDir() {
    const dir = await mkdtemp(join(tmpdir(), 'copilot-io-fuzz-'));
    tempDirs.push(dir);
    return dir;
}

describe('infra/io deterministic fuzz', () => {
    it(`preserva propriedades de patch textual em ${PATCH_CASES} casos Unicode/line-ending`, async () => {
        await runSeededCases(PATCH_SEED, PATCH_CASES, (random, caseIndex) => {
            const occurrences = 1 + integer(random, 5);
            const separator = pick(random, ['\n', '\r\n']);
            const segments = Array.from({ length: occurrences + 1 }, () => randomText(random));
            const content = segments.join(`${separator}${OLD}${separator}`);
            const newString = `${randomText(random)}-${caseIndex}${random() > 0.7 ? `${separator}${randomText(random)}` : ''}`;
            const replaceAll = random() > 0.5;
            const occurrenceIndex = 1 + integer(random, occurrences);
            const patch = computeTextPatch(content, {
                oldString: OLD,
                newString,
                expectedOccurrences: occurrences,
                ...(replaceAll ? { replaceAll: true } : { occurrenceIndex }),
            });
            const expected = replaceAll
                ? content.split(OLD).join(newString)
                : replaceOccurrence(content, OLD, newString, occurrenceIndex);

            expect(patch.updated, `seed=${PATCH_SEED} case=${caseIndex}`).toBe(expected);
            expect(patch.occurrences).toBe(occurrences);
            expect(patch.replacedOccurrences).toBe(replaceAll ? occurrences : 1);
            expect(patch.previousBytes).toBe(Buffer.byteLength(content, 'utf8'));
            expect(patch.bytesWritten).toBe(Buffer.byteLength(expected, 'utf8'));
            expect(patch.byteDelta).toBe(Buffer.byteLength(expected, 'utf8') - Buffer.byteLength(content, 'utf8'));
            expect(patch.lineDelta).toBe(expected.split('\n').length - content.split('\n').length);
        });
    });

    it(`reconstitui janelas textuais em ${CHUNK_CASES} casos com fronteiras de byte pequenas`, async () => {
        const dir = await createTempDir();
        await runSeededCases(CHUNK_SEED, CHUNK_CASES, async (random, caseIndex) => {
            const lineCount = 1 + integer(random, 30);
            const lines = Array.from({ length: lineCount }, () => randomText(random));
            const lineEnding = pick(random, ['\n', '\r\n']);
            const content = lines.join(lineEnding);
            const startLine = 1 + integer(random, lineCount);
            const endLine = startLine + integer(random, lineCount - startLine + 1);
            const chunkLines = 1 + integer(random, 6);
            const highWaterMark = 1 + integer(random, 12);
            const caseDetails = JSON.stringify({
                seed: CHUNK_SEED,
                caseIndex,
                lineEnding: lineEnding === '\r\n' ? 'CRLF' : 'LF',
                startLine,
                endLine,
                chunkLines,
                highWaterMark,
                lines,
            });
            const file = join(dir, `chunks-${caseIndex}.txt`);
            await writeFile(file, content, 'utf8');

            const result = await readTextLineChunks(file, {
                startLine,
                endLine,
                chunkLines,
                highWaterMark,
            });
            const returned = result.chunks.flatMap((chunk) => chunk.content.split('\n'));

            expect(returned, caseDetails).toEqual(lines.slice(startLine - 1, endLine));
            expect(result.returnedLineCount).toBe(endLine - startLine + 1);
            expect(result.chunks.every((chunk) => chunk.bytes === Buffer.byteLength(chunk.content, 'utf8'))).toBe(true);
            expect(result.consistent).toBe(true);
            expect(result.snapshotVersion).toMatch(/^[a-f0-9]{24}$/);
        });
    });

    it('recusa corpus UTF-8 inválido sem regravar os bytes', async () => {
        const dir = await createTempDir();
        const invalidSequences = [
            [0xc3, 0x28],
            [0xa0, 0xa1],
            [0xe2, 0x28, 0xa1],
            [0xf0, 0x28, 0x8c, 0xbc],
            [0xf0, 0x9f, 0x92],
            [0xed, 0xa0, 0x80],
        ];

        for (const [caseIndex, sequence] of invalidSequences.entries()) {
            const file = join(dir, `invalid-${caseIndex}.bin`);
            const payload = Buffer.concat([Buffer.from('prefix '), Buffer.from(sequence), Buffer.from(' suffix')]);
            await writeFile(file, payload);

            await expect(
                patchTextLocked(file, {
                    oldString: 'prefix',
                    newString: 'changed',
                }),
                `invalid UTF-8 case=${caseIndex}`,
            ).rejects.toMatchObject({ name: 'BinaryFileError' });
            await expect(
                readTextLineChunks(file, { highWaterMark: 1 + caseIndex }),
                `invalid chunked UTF-8 case=${caseIndex}`,
            ).rejects.toMatchObject({ name: 'BinaryFileError', code: 'ERR_INVALID_UTF8' });
            await expect(readFile(file)).resolves.toEqual(payload);
        }
    });
});
