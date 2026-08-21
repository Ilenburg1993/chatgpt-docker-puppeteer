// @ts-check

import { readIoRuntimeHealthSnapshot } from '#copilot/infra/internal/observability';
import { createInfraRuntime } from '#copilot/infra/public/composition/runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** @type {ReturnType<typeof createInfraRuntime>} */
let runtime;
beforeEach(() => {
    runtime = createInfraRuntime({ runtimeId: `advisory-budget-test-${Date.now()}-${Math.random()}` });
});
afterEach(async () => {
    await runtime.dispose();
});

describe('infra/io-advisory-budget runtime ownership', () => {
    it('observa pressão concorrente sem bloquear operações', () => {
        const budget = runtime.telemetry.advisoryBudget;
        const limit = budget.stats().limits.maxActive;
        const leases = Array.from({ length: limit + 1 }, (_, index) =>
            budget.begin({ operation: `write-${index}`, estimatedBytes: 1 }),
        );

        const stats = budget.stats();
        expect(stats.active).toBe(limit + 1);
        expect(stats.pressure).toBe(true);
        expect(stats.reasons).toContain('active');
        expect(leases.at(-1)?.pressured).toBe(true);
        expect(readIoRuntimeHealthSnapshot(runtime).alerts).toContainEqual(
            expect.objectContaining({ code: 'IO_ADVISORY_BUDGET_PRESSURE', severity: 'medium' }),
        );

        for (const lease of leases) {
            lease.finish();
            lease.finish();
        }
        expect(budget.stats().active).toBe(0);
    });

    it('mantém a janela limitada e contabiliza bytes estimados', () => {
        const budget = runtime.telemetry.advisoryBudget;
        const limit = budget.stats().limits.maxOperations;
        for (let index = 0; index <= limit; index++) {
            budget.begin({ operation: 'write', estimatedBytes: 2 }).finish();
        }

        const stats = budget.stats();
        expect(stats.operations).toBe(limit + 1);
        expect(stats.estimatedBytes).toBe((limit + 1) * 2);
        expect(stats.reasons).toContain('operations');
    });

    it('isola pressão entre runtimes', async () => {
        const other = createInfraRuntime({ runtimeId: 'advisory-budget-isolation-peer' });
        try {
            const limit = runtime.telemetry.advisoryBudget.stats().limits.maxActive;
            const leases = Array.from({ length: limit + 1 }, (_, index) =>
                runtime.telemetry.advisoryBudget.begin({ operation: `isolated-${index}` }),
            );
            expect(runtime.telemetry.advisoryBudget.stats().pressure).toBe(true);
            expect(other.telemetry.advisoryBudget.stats().pressure).toBe(false);
            expect(other.telemetry.advisoryBudget.stats().active).toBe(0);
            for (const lease of leases) lease.finish();
        } finally {
            await other.dispose();
        }
    });
});
