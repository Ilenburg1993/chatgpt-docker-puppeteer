// @ts-check

import { describe, expect, it, vi } from 'vitest';

import {
    dispatchAgentDialogTurn,
    isAgentDialogLoopPaused,
    pauseAgentDialogLoop,
    readAgentDialogLastPrInfo,
    readAgentDialogPrMetrics,
} from '../../../src/copilot/agent/facades/agent-dialog-runtime.js';

describe('agent-dialog-runtime facade', () => {
    it('dispatchAgentDialogTurn delega para sendDialogTurn com options opcionais', async () => {
        const runtime = {
            sendDialogTurn: vi.fn(async (_message, _options) => 'ok'),
        };

        await expect(dispatchAgentDialogTurn(runtime, 'oi', { timeout: null, traceId: 't-1' })).resolves.toBe('ok');
        expect(runtime.sendDialogTurn).toHaveBeenCalledWith('oi', { timeout: null, traceId: 't-1' });
    });

    it('pauseAgentDialogLoop delega sessionId explicitamente', async () => {
        const runtime = {
            pauseDialogLoop: vi.fn(async () => {}),
        };

        await pauseAgentDialogLoop(runtime, 'sess-1');
        expect(runtime.pauseDialogLoop).toHaveBeenCalledWith('sess-1');
    });

    it('isAgentDialogLoopPaused/readAgentDialogPrMetrics/readAgentDialogLastPrInfo leem snapshots do runtime', () => {
        const prInfo = { model: 'gpt-5-mini', cost: 1, ts: 123 };
        const runtime = {
            isDialogLoopPaused: vi.fn(() => true),
            getDialogPrMetricsSnapshot: vi.fn(() => ({ boots: 1, resumesWithPR: 2, resumesZeroPR: 3, totalPR: 4 })),
            getLastPrInfoSnapshot: vi.fn(() => prInfo),
        };

        expect(isAgentDialogLoopPaused(runtime)).toBe(true);
        expect(readAgentDialogPrMetrics(runtime)).toEqual({ boots: 1, resumesWithPR: 2, resumesZeroPR: 3, totalPR: 4 });
        expect(readAgentDialogLastPrInfo(runtime)).toEqual(prInfo);
    });
});
