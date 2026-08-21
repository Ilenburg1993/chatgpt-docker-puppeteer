// @ts-check

import { parseFileSymbols } from '#copilot/infra/internal/indexing/parser';
import { createInfraRuntime } from '#copilot/infra/public/composition/runtime';
import { describe, expect, it } from 'vitest';

describe('parser worker runtime lifecycle', () => {
    it('isolates worker pools per InfraRuntime and disposes only the owning pool', async () => {
        const first = createInfraRuntime({ runtimeId: 'parser-worker-owner:first' });
        const second = createInfraRuntime({ runtimeId: 'parser-worker-owner:second' });
        try {
            const firstResult = await parseFileSymbols('/tmp/first-runtime.js', 'export const first = 1;', {
                workerRuntime: first.parserWorkers,
            });
            const secondResult = await parseFileSymbols('/tmp/second-runtime.js', 'export const second = 2;', {
                workerRuntime: second.parserWorkers,
            });

            expect(firstResult.exports).toContain('first');
            expect(secondResult.exports).toContain('second');
            expect(first.parserWorkers.status()).toMatchObject({ disposed: false, poolInitialized: true });
            expect(second.parserWorkers.status()).toMatchObject({ disposed: false, poolInitialized: true });
            expect(first.parserWorkers.status().poolSize).toBeGreaterThan(0);
            expect(second.parserWorkers.status().poolSize).toBeGreaterThan(0);

            await first.dispose();
            expect(first.parserWorkers.status()).toMatchObject({
                disposed: true,
                poolInitialized: false,
                poolSize: 0,
                queueLength: 0,
                inFlight: 0,
            });
            expect(second.parserWorkers.status()).toMatchObject({ disposed: false, poolInitialized: true });

            const stillAlive = await parseFileSymbols('/tmp/second-runtime-again.js', 'export const alive = 3;', {
                workerRuntime: second.parserWorkers,
            });
            expect(stillAlive.exports).toContain('alive');
        } finally {
            await first.dispose();
            await second.dispose();
        }

        expect(second.parserWorkers.status()).toMatchObject({
            disposed: true,
            poolInitialized: false,
            poolSize: 0,
            queueLength: 0,
            inFlight: 0,
        });
    });
});
