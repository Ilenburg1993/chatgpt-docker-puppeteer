// @ts-check

import { readIoRuntimeHealthSnapshot } from '#copilot/infra/internal/observability';
import { beginIoAdvisoryBudget, getIoAdvisoryBudgetStats } from '#copilot/infra/internal/telemetry';
import { afterEach, describe, expect, it } from 'vitest';

import { resetIoAdvisoryBudgetForTest } from '#copilot/infra/public/testing';
afterEach(() => {
    resetIoAdvisoryBudgetForTest();
});

describe('infra/io-advisory-budget', () => {
    it('observa pressão concorrente sem bloquear operações', () => {
        const limit = getIoAdvisoryBudgetStats().limits.maxActive;
        const leases = Array.from({ length: limit + 1 }, (_, index) =>
            beginIoAdvisoryBudget({ operation: `write-${index}`, estimatedBytes: 1 }),
        );

        const stats = getIoAdvisoryBudgetStats();
        expect(stats.active).toBe(limit + 1);
        expect(stats.pressure).toBe(true);
        expect(stats.reasons).toContain('active');
        expect(leases.at(-1)?.pressured).toBe(true);
        expect(readIoRuntimeHealthSnapshot().alerts).toContainEqual(
            expect.objectContaining({ code: 'IO_ADVISORY_BUDGET_PRESSURE', severity: 'medium' }),
        );

        for (const lease of leases) {
            lease.finish();
            lease.finish();
        }
        expect(getIoAdvisoryBudgetStats().active).toBe(0);
    });

    it('mantém a janela limitada e contabiliza bytes estimados', () => {
        const limit = getIoAdvisoryBudgetStats().limits.maxOperations;
        for (let index = 0; index <= limit; index++) {
            beginIoAdvisoryBudget({ operation: 'write', estimatedBytes: 2 }).finish();
        }

        const stats = getIoAdvisoryBudgetStats();
        expect(stats.operations).toBe(limit + 1);
        expect(stats.estimatedBytes).toBe((limit + 1) * 2);
        expect(stats.reasons).toContain('operations');
    });
});
