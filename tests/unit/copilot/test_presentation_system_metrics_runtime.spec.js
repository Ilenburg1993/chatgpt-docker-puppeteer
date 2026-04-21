// @ts-check

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    readAgentRuntimeOverview: vi.fn((runtimeId) => ({
        agent: {
            dialogLoopActive: runtimeId === 'alt',
            sessionId: runtimeId === 'alt' ? 'sess-alt' : 'sess-default',
            lastPrInfo:
                runtimeId === 'alt'
                    ? {
                          ts: 222,
                          model: 'gpt-5',
                          cost: 7,
                          quotaSnapshots: [{ remaining: 3 }],
                      }
                    : {
                          ts: 111,
                          model: 'gpt-5-mini',
                          cost: 1,
                          quotaSnapshots: [{ remaining: 9 }],
                      },
            dialogPrMetrics:
                runtimeId === 'alt'
                    ? { boots: 2, resumesWithPR: 1, resumesZeroPR: 0, totalPR: 7 }
                    : { boots: 1, resumesWithPR: 0, resumesZeroPR: 1, totalPR: 1 },
        },
        runtimeId: runtimeId ?? 'default',
        snap: { sendCount: runtimeId === 'alt' ? 99 : 10 },
        health: null,
        runtimeSessionId: runtimeId === 'alt' ? 'sess-alt' : 'sess-default',
        contextWindow: null,
        agentRuntimes: [],
    })),
}));

vi.mock('../../../src/copilot/presentation/runtime-overview.js', () => ({
    readAgentRuntimeOverview: mocks.readAgentRuntimeOverview,
}));

import { handleGetPrBudget, handleGetQuota } from '../../../src/copilot/presentation/system-metrics.js';

/** @template T @param {{ body: unknown }} result @returns {T} */
const bodyOf = (result) => /** @type {T} */ (result.body);

describe('presentation/system-metrics runtime-aware handlers', () => {
    it('handleGetQuota projeta runtimeId explícito', () => {
        const result = handleGetQuota({ runtimeId: 'alt' });
        const body = bodyOf(/** @type {{ body: any }} */ (result));

        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.runtimeId).toBe('alt');
        expect(body.sessionId).toBe('sess-alt');
        expect(body.sendCount).toBe(99);
        expect(body.lastPrModel).toBe('gpt-5');
        expect(mocks.readAgentRuntimeOverview).toHaveBeenCalledWith('alt');
    });

    it('handleGetPrBudget mantém fallback default quando runtimeId não vem', () => {
        const result = handleGetPrBudget();
        const body = bodyOf(/** @type {{ body: any }} */ (result));

        expect(result.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.runtimeId).toBe('default');
        expect(body.sessionId).toBe('sess-default');
        expect(body.prMetrics.totalPR).toBe(1);
        expect(mocks.readAgentRuntimeOverview).toHaveBeenCalledWith(null);
    });
});
