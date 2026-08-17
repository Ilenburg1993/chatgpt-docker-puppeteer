// @ts-check

import { describe, expect, it } from 'vitest';
import { runBoundedOperationBatch } from '#copilot/infra';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('shared bulk executor', () => {
    it('preserva ordem e isola exceção por item em best-effort', async () => {
        const result = await runBoundedOperationBatch(
            [0, 1, 2, 3],
            async (value) => {
                if (value === 1) {
                    const error = /** @type {Error & { code?: string }} */ (new Error('boom'));
                    error.code = 'EBOOM';
                    throw error;
                }
                await delay(value === 0 ? 8 : 1);
                return value * 10;
            },
            { concurrency: 3, failureMode: 'best-effort' },
        );

        expect(result).toMatchObject({
            requestCount: 4,
            attemptedCount: 4,
            succeededCount: 3,
            failedCount: 1,
            skippedCount: 0,
            concurrency: 3,
        });
        expect(result.results.map((row) => row.index)).toEqual([0, 1, 2, 3]);
        expect(result.results[0]).toMatchObject({ status: 'succeeded', value: 0 });
        expect(result.results[1]).toMatchObject({ status: 'failed', error: 'boom', code: 'EBOOM' });
        expect(result.results[2]).toMatchObject({ status: 'succeeded', value: 20 });
        expect(result.results[3]).toMatchObject({ status: 'succeeded', value: 30 });
    });

    it('marca itens não iniciados como skipped em fail-fast', async () => {
        const result = await runBoundedOperationBatch(
            [0, 1, 2, 3],
            async (value) => {
                if (value === 1) throw new Error('stop');
                return value;
            },
            { concurrency: 1, failureMode: 'fail-fast' },
        );

        expect(result).toMatchObject({ attemptedCount: 2, succeededCount: 1, failedCount: 1, skippedCount: 2 });
        expect(result.results.map((row) => row.status)).toEqual(['succeeded', 'failed', 'skipped', 'skipped']);
    });

    it('respeita o cap de concorrência observado', async () => {
        let inFlight = 0;
        let maxObserved = 0;
        const result = await runBoundedOperationBatch(
            Array.from({ length: 12 }, (_, index) => index),
            async (value) => {
                inFlight += 1;
                maxObserved = Math.max(maxObserved, inFlight);
                await delay(4);
                inFlight -= 1;
                return value;
            },
            { concurrency: 3 },
        );

        expect(maxObserved).toBeLessThanOrEqual(3);
        expect(result.maxInFlight).toBe(maxObserved);
        expect(result.succeededCount).toBe(12);
    });

    it('aplica budgets de itens e bytes antes de executar workers', async () => {
        let calls = 0;
        await expect(
            runBoundedOperationBatch([1, 2, 3], () => {
                calls += 1;
                return 1;
            }, { maxItems: 2 }),
        ).rejects.toMatchObject({ code: 'ERR_BULK_ITEM_LIMIT' });
        expect(calls).toBe(0);

        await expect(
            runBoundedOperationBatch(['abcd', 'efgh'], (value) => value, {
                maxInputBytes: 7,
                estimateItemBytes: (value) => Buffer.byteLength(value),
            }),
        ).rejects.toMatchObject({ code: 'ERR_BULK_INPUT_BYTES_LIMIT' });
    });

    it('pode tratar retorno normal como falha lógica sem lançar exceção', async () => {
        const result = await runBoundedOperationBatch(
            [{ ok: true }, { ok: false }, { ok: true }],
            (value) => value,
            { isFailure: (value) => value.ok !== true },
        );

        expect(result).toMatchObject({ succeededCount: 2, failedCount: 1, skippedCount: 0 });
        expect(result.results[1]).toMatchObject({ status: 'failed', value: { ok: false } });
    });
});
