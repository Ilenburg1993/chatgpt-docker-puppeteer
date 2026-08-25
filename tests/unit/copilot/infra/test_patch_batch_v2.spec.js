// @ts-check

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { patchTextBatchLocked } from '#copilot/infra/internal/filesystem/mutation';
import { sha256 } from '#copilot/infra/internal/platform/hash';

/** @type {string[]} */
const tempDirs = [];

/** @param {string} name @param {string} content */
async function createTempFile(name, content) {
    const dir = await mkdtemp(join(tmpdir(), 'copilot-patch-batch-v2-'));
    tempDirs.push(dir);
    const file = join(dir, name);
    await writeFile(file, content, 'utf8');
    return file;
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Patch Batch V2 low-level contract', () => {
    it('accepts one baseline hash for several sequential operations', async () => {
        const initial = 'alpha beta gamma';
        const file = await createTempFile('baseline.txt', initial);
        const result = await patchTextBatchLocked(file, {
            baselineExpectedHash: sha256(initial),
            operations: [
                { oldString: 'alpha', newString: 'ALPHA' },
                { oldString: 'beta', newString: 'BETA' },
                { oldString: 'gamma', newString: 'GAMMA' },
            ],
        });
        expect(result.previousHash).toBe(sha256(initial));
        expect(result.operationCount).toBe(3);
        expect(result.contentHash).toBe(sha256('ALPHA BETA GAMMA'));
        await expect(readFile(file, 'utf8')).resolves.toBe('ALPHA BETA GAMMA');
    });

    it('keeps an explicit no-op inside a same-file sequence without aborting later operations', async () => {
        const initial = 'alpha beta gamma';
        const file = await createTempFile('noop-sequence.txt', initial);
        const result = await patchTextBatchLocked(file, {
            operations: [
                { oldString: 'alpha', newString: 'alpha', allowNoop: true },
                { oldString: 'beta', newString: 'BETA' },
                { oldString: 'gamma', newString: 'GAMMA' },
            ],
        });
        expect(result.operations[0]?.['noop']).toBe(true);
        expect(result.operations[0]?.['previousHash']).toBe(sha256(initial));
        expect(result.operations[0]?.['contentHash']).toBe(sha256(initial));
        expect(result.operationCount).toBe(3);
        await expect(readFile(file, 'utf8')).resolves.toBe('alpha BETA GAMMA');
    });

    it('rejects a stale baseline before compute or publish', async () => {
        const initial = 'alpha beta gamma';
        const file = await createTempFile('stale.txt', initial);
        await expect(
            patchTextBatchLocked(file, {
                baselineExpectedHash: sha256('stale content'),
                operations: [
                    { oldString: 'alpha', newString: 'ALPHA' },
                    { oldString: 'beta', newString: 'BETA' },
                ],
            }),
        ).rejects.toMatchObject({
            code: 'EEXPECTEDHASH',
            operationIndex: 0,
            completedOperationCount: 0,
            failurePhase: 'baseline-hash',
        });
        await expect(readFile(file, 'utf8')).resolves.toBe(initial);
    });

    it('localizes an intermediate failure and keeps the file byte-identical', async () => {
        const initial = 'alpha beta gamma';
        const file = await createTempFile('failure.txt', initial);
        await expect(
            patchTextBatchLocked(file, {
                baselineExpectedHash: sha256(initial),
                operations: [
                    { oldString: 'alpha', newString: 'ALPHA' },
                    { oldString: 'missing', newString: 'MISSING' },
                    { oldString: 'gamma', newString: 'GAMMA' },
                ],
            }),
        ).rejects.toMatchObject({
            code: 'ERR_PATCH_NOT_FOUND',
            operationIndex: 1,
            completedOperationCount: 1,
            failurePhase: 'operation',
            details: {
                currentHash: sha256('ALPHA beta gamma'),
                currentBytes: Buffer.byteLength('ALPHA beta gamma', 'utf8'),
                currentStateKind: 'virtual-batch',
                diskBaselineHash: sha256(initial),
                diskBaselineBytes: Buffer.byteLength(initial, 'utf8'),
                desiredTextPresent: false,
                convergenceCandidate: false,
            },
        });
        await expect(readFile(file, 'utf8')).resolves.toBe(initial);
    });

    it('aborts after virtual validation but before publish without changing file bytes', async () => {
        const initial = 'alpha beta gamma';
        const file = await createTempFile('cancel-before-publish.txt', initial);
        const controller = new AbortController();

        await expect(
            patchTextBatchLocked(file, {
                signal: controller.signal,
                operations: [
                    { oldString: 'alpha', newString: 'ALPHA' },
                    { oldString: 'beta', newString: 'BETA' },
                ],
                validateUpdatedContent: (content) => {
                    expect(content).toBe('ALPHA BETA gamma');
                    controller.abort(new Error('cancel-patch-before-publish'));
                },
            }),
        ).rejects.toThrow(/cancel-patch-before-publish/u);

        expect(controller.signal.aborted).toBe(true);
        await expect(readFile(file, 'utf8')).resolves.toBe(initial);
    });

    it('preserves distinct per-operation virtual hash preconditions', async () => {
        const initial = 'alpha beta gamma';
        const afterFirst = 'alpha BETA gamma';
        const file = await createTempFile('virtual-hashes.txt', initial);
        const result = await patchTextBatchLocked(file, {
            dryRun: true,
            operations: [
                { oldString: 'beta', newString: 'BETA', expectedHash: sha256(initial) },
                { oldString: 'gamma', newString: 'GAMMA', expectedHash: sha256(afterFirst) },
            ],
        });
        expect(result.operations[0]?.['previousHash']).toBe(sha256(initial));
        expect(result.operations[1]?.['previousHash']).toBe(sha256(afterFirst));
        await expect(readFile(file, 'utf8')).resolves.toBe(initial);
    });
});
