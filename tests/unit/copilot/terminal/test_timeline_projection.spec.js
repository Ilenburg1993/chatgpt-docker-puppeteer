// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const gateways = vi.hoisted(() => ({
    clearTerminalHistoryFeed: vi.fn(),
    clearTerminalTranscriptFeed: vi.fn(),
    countTerminalHubTurns: vi.fn(() => 0),
    readTerminalHistoryFeed: vi.fn(() => []),
    readTerminalHubTurns: vi.fn(() => []),
    readTerminalSessionBinding: vi.fn(() => ({ hubSessionId: null, sdkSessionId: null })),
    readTerminalTranscriptFeed: vi.fn(() => []),
    seedTerminalHistoryFeed: vi.fn(),
    writeTerminalHubTimelineTurn: vi.fn(async () => undefined),
}));

vi.mock('../../../../src/copilot/terminal/frontend/gateways/index.js', () => gateways);

vi.mock('../../../../src/copilot/terminal/frontend/projections/shared.js', () => ({
    readTerminalRuntimeBase: () => ({
        requestedRuntimeId: null,
        runtimeId: 'default',
        runtimeFound: true,
        usedDefaultRuntimeFallback: false,
        runtimeFallbackWarning: null,
        binding: {
            hubSessionId: gateways.readTerminalSessionBinding().hubSessionId,
            sdkSessionId: gateways.readTerminalSessionBinding().sdkSessionId,
        },
        contextWindow: null,
    }),
}));

vi.mock('#copilot/boot', () => ({
    getWorkspaceContext: () => ({
        cwd: '/workspaces/test',
        gitRoot: '/workspaces/test',
        currentBranch: 'main',
    }),
}));

vi.mock('#copilot/core', () => ({
    sleepMs: vi.fn(async () => undefined),
    toError: (/** @type {unknown} */ error) => (error instanceof Error ? error : new Error(String(error))),
}));

vi.mock('../../../../src/copilot/presentation/runtime/index.js', () => ({
    sendRuntimeDialogTurnForRuntime: vi.fn(async () => ({ reply: 'ok' })),
}));

const { readTerminalTimelineProjection } = await import(
    '../../../../src/copilot/terminal/frontend/projections/timeline.js'
);

describe('terminal/frontend/projections/timeline', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        gateways.readTerminalSessionBinding.mockReturnValue({
            hubSessionId: 'hub-1',
            sdkSessionId: 'sdk-1',
        });
        gateways.countTerminalHubTurns.mockReturnValue(2);
        gateways.readTerminalHubTurns.mockReturnValue([
            {
                id: 1,
                role: 'user',
                content: 'Pergunta original',
                created_at: 1710000000000,
                metadata: JSON.stringify({ source: 'hub' }),
            },
            {
                id: 2,
                role: 'llm_b',
                content: 'Resposta original',
                created_at: 1710000001000,
                metadata: JSON.stringify({ source: 'hub' }),
            },
        ]);
        gateways.readTerminalHistoryFeed.mockReturnValue([]);
        gateways.readTerminalTranscriptFeed.mockReturnValue([]);
    });

    it('trata cauda viva posterior ao hub como bridge_tail sincronizável mesmo sem overlap', async () => {
        gateways.readTerminalTranscriptFeed.mockReturnValue([
            {
                role: 'system',
                rawRole: 'ask_user',
                content: 'ask_user solicitou resposta humana:\nASK-CANONICAL: responda SIM',
                timestamp: 1710000002000,
                metadata: { envelope: { source: 'sdk/user_input.requested', eventId: 253 } },
            },
            {
                role: 'user',
                rawRole: 'ask_user_answer',
                content: 'Resposta ao ask_user:\nSIM',
                timestamp: 1710000002500,
                metadata: { envelope: { source: 'sdk/user_input.completed', eventId: 262 } },
            },
            {
                role: 'assistant',
                rawRole: 'llm_b',
                content: 'POST-ASK-CANONICAL-FINAL: usuário confirmou SIM',
                timestamp: 1710000003000,
                metadata: { assistantMessageEnvelope: { source: 'sdk/assistant.message', eventId: 280 } },
            },
        ]);

        const projection = readTerminalTimelineProjection({ limitPairs: 10 });

        expect(projection.timelineSource).toBe('mixed');
        expect(projection.timelineAuthority).toBe('reconciled');
        expect(projection.reconciliationStatus).toBe('bridge_tail');
        expect(projection.sync.status).toBe('scheduled');
        expect(projection.syncBlockedReason).toBe(null);
        expect(projection.liveBridgeTailCount).toBe(3);
        expect(projection.turns.map((turn) => turn.content)).toEqual([
            'Pergunta original',
            'Resposta original',
            'ask_user solicitou resposta humana:\nASK-CANONICAL: responda SIM',
            'Resposta ao ask_user:\nSIM',
            'POST-ASK-CANONICAL-FINAL: usuário confirmou SIM',
        ]);
        await vi.waitFor(() => expect(gateways.writeTerminalHubTimelineTurn).toHaveBeenCalledTimes(3));
    });

    it('mantém sync bloqueado quando a timeline viva sem overlap é temporalmente conflitante', () => {
        gateways.readTerminalTranscriptFeed.mockReturnValue([
            {
                role: 'assistant',
                rawRole: 'llm_b',
                content: 'Resposta paralela antiga sem overlap',
                timestamp: 1709999999000,
                metadata: { assistantMessageEnvelope: { source: 'sdk/assistant.message', eventId: 280 } },
            },
        ]);

        const projection = readTerminalTimelineProjection({ limitPairs: 10 });

        expect(projection.timelineSource).toBe('mixed');
        expect(projection.timelineAuthority).toBe('reconciled');
        expect(projection.reconciliationStatus).toBe('diverged');
        expect(projection.sync.status).toBe('blocked');
        expect(projection.syncBlockedReason).toBe('diverged-no-overlap');
        expect(projection.liveBridgeTailCount).toBe(1);
        expect(gateways.writeTerminalHubTimelineTurn).not.toHaveBeenCalled();
    });
});
