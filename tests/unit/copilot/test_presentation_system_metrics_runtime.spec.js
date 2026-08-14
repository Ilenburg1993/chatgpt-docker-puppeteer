// @ts-check

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    readAgentRuntimeOverview: vi.fn((runtimeId) => {
        const lastPrInfo =
            runtimeId === 'alt'
                ? {
                      ts: 222,
                      model: 'gpt-5',
                      configuredModel: 'gpt-5.4',
                      modelMismatch: true,
                      cost: 7,
                  }
                : null;
        const lastLlmUsage =
            runtimeId === 'alt'
                ? {
                      ts: 333,
                      model: 'gpt-5.4',
                      billingSource: 'github_copilot',
                      classification: 'user_turn',
                      copilotUsage: { totalNanoAiu: 4_500_000 },
                  }
                : {
                      ts: 222,
                      model: 'gpt-5-mini',
                      billingSource: 'github_copilot',
                      classification: 'user_turn',
                      copilotUsage: { totalNanoAiu: 1_250_000 },
                  };
        const dialogUsageMetrics =
            runtimeId === 'alt'
                ? {
                      boots: 2,
                      resumesWithAdditionalModelCall: 1,
                      resumesWithoutAdditionalModelCall: 0,
                      totalModelCalls: 3,
                      resumesWithPR: 1,
                      resumesZeroPR: 0,
                      totalPR: 3,
                  }
                : {
                      boots: 1,
                      resumesWithAdditionalModelCall: 0,
                      resumesWithoutAdditionalModelCall: 1,
                      totalModelCalls: 1,
                      resumesWithPR: 0,
                      resumesZeroPR: 1,
                      totalPR: 1,
                  };
        return {
            agent: {
                dialogLoopActive: runtimeId === 'alt',
                sessionId: runtimeId === 'alt' ? 'sess-alt' : 'sess-default',
                lastPrInfo,
                lastLlmUsage,
                dialogUsageMetrics,
                dialogPrMetrics: dialogUsageMetrics,
            },
            runtimeId: runtimeId ?? 'default',
            snap: { sendCount: runtimeId === 'alt' ? 99 : 10 },
            health: null,
            runtimeSessionId: runtimeId === 'alt' ? 'sess-alt' : 'sess-default',
            contextWindow: null,
            agentRuntimes: [],
            dialogLoopActive: runtimeId === 'alt',
            sessionId: runtimeId === 'alt' ? 'sess-alt' : 'sess-default',
            lastPrInfo,
            lastLlmUsage,
            dialogUsageMetrics,
            dialogPrMetrics: dialogUsageMetrics,
        };
    }),
}));

vi.mock('../../../src/copilot/presentation/runtime/overview.js', () => ({
    readAgentRuntimeOverview: mocks.readAgentRuntimeOverview,
    readAgentRuntimeOverviewProjection: mocks.readAgentRuntimeOverview,
}));

import { handleGetPrBudget, handleGetQuota, handleGetUsageBudget } from '../../../src/copilot/presentation/system/index.js';

/** @template T @param {{ body: unknown }} result @returns {T} */
const bodyOf = (result) => /** @type {T} */ (result.body);

describe('presentation/system-metrics runtime-aware handlers', () => {
    it('handleGetQuota projeta usage moderno e isola billing request-based em legacyBilling', () => {
        const result = handleGetQuota({ runtimeId: 'alt' });
        const body = bodyOf(/** @type {{ body: any }} */ (result));

        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.runtimeId).toBe('alt');
        expect(body.sessionId).toBe('sess-alt');
        expect(body.sendCount).toBe(99);
        expect(body.lastUsage.model).toBe('gpt-5.4');
        expect(body.totalNanoAiu).toBe(4_500_000);
        expect(body.legacyBilling.lastRequestBasedSnapshot.model).toBe('gpt-5');
        expect(mocks.readAgentRuntimeOverview).toHaveBeenCalledWith('alt');
    });

    it('handleGetUsageBudget mantém fallback default e métricas modernas', () => {
        const result = handleGetUsageBudget();
        const body = bodyOf(/** @type {{ body: any }} */ (result));

        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.runtimeId).toBe('default');
        expect(body.sessionId).toBe('sess-default');
        expect(body.usageMetrics.totalModelCalls).toBe(1);
        expect(body.totalNanoAiu).toBe(1_250_000);
        expect(body.legacyBilling).toBeNull();
        expect(mocks.readAgentRuntimeOverview).toHaveBeenCalledWith(null);
    });

    it('handleGetPrBudget é somente alias deprecated de /usage-budget', () => {
        const result = handleGetPrBudget();
        const body = bodyOf(/** @type {{ body: any }} */ (result));

        expect(result.status).toBe(200);
        expect(body.deprecated).toBe(true);
        expect(body.replacement).toBe('/usage-budget');
        expect(body.legacyAlias).toBe('/pr-budget');
        expect(body.usageMetrics.totalModelCalls).toBe(1);
    });
});
