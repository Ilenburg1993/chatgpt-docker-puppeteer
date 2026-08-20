// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const gateways = vi.hoisted(() => ({
    clearTerminalHistoryFeed: vi.fn(),
    clearTerminalTranscriptFeed: vi.fn(),
    countTerminalHubTurns: vi.fn(() => 0),
    readTerminalHistoryFeed: vi.fn(/** @returns {{ role: string; content: string; timestamp?: number }[]} */ () => []),
    readTerminalHubTurns: vi.fn(/** @returns {Record<string, unknown>[]} */ () => []),
    readTerminalSessionBinding: vi.fn(
        /** @returns {{ hubSessionId: string | null; sdkSessionId: string | null }} */ () => ({
            hubSessionId: null,
            sdkSessionId: null,
        }),
    ),
    readTerminalTranscriptFeed: vi.fn(
        /** @returns {import('../../../../src/copilot/terminal/state/transcript-state.js').TerminalTranscriptTurn[]} */ () => [],
    ),
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

const { readTerminalTimelineProjection } =
    await import('../../../../src/copilot/terminal/frontend/projections/timeline.js');

let _transcriptFixtureId = 0;
/**
 * @param {Pick<
 *     import('../../../../src/copilot/terminal/state/transcript-state.js').TerminalTranscriptTurn,
 *     'role' | 'rawRole' | 'content' | 'timestamp'
 * > & {
 *     metadata?: Record<string, unknown> | null;
 *     source?: string;
 * }} input
 * @returns {import('../../../../src/copilot/terminal/state/transcript-state.js').TerminalTranscriptTurn}
 */
function transcriptTurn(input) {
    _transcriptFixtureId += 1;
    return {
        id: `unit-transcript-${_transcriptFixtureId}`,
        role: input.role,
        rawRole: input.rawRole,
        content: input.content,
        byteLength: Buffer.byteLength(input.content, 'utf8'),
        source: input.source ?? 'unit-test',
        timestamp: input.timestamp,
        archived: false,
        metadata: input.metadata ?? null,
    };
}

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
            transcriptTurn({
                role: 'system',
                rawRole: 'ask_user',
                content: 'ask_user solicitou resposta humana:\nASK-CANONICAL: responda SIM',
                timestamp: 1710000002000,
                metadata: { envelope: { source: 'sdk/user_input.requested', eventId: 253 } },
            }),
            transcriptTurn({
                role: 'user',
                rawRole: 'ask_user_answer',
                content: 'Resposta ao ask_user:\nSIM',
                timestamp: 1710000002500,
                metadata: { envelope: { source: 'sdk/user_input.completed', eventId: 262 } },
            }),
            transcriptTurn({
                role: 'assistant',
                rawRole: 'llm_b',
                content: 'POST-ASK-CANONICAL-FINAL: usuário confirmou SIM',
                timestamp: 1710000003000,
                metadata: { assistantMessageEnvelope: { source: 'sdk/assistant.message', eventId: 280 } },
            }),
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
            transcriptTurn({
                role: 'assistant',
                rawRole: 'llm_b',
                content: 'Resposta paralela antiga sem overlap',
                timestamp: 1709999999000,
                metadata: { assistantMessageEnvelope: { source: 'sdk/assistant.message', eventId: 280 } },
            }),
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

    it('reconcilia prefixo vivo e cauda ask_user quando hub tem turno vazio posterior', async () => {
        gateways.countTerminalHubTurns.mockReturnValue(3);
        gateways.readTerminalHubTurns.mockReturnValue([
            {
                id: 1,
                role: 'user',
                content: 'Prompt route apply',
                created_at: 1710000001000,
                metadata: JSON.stringify({ source: 'hub' }),
            },
            {
                id: 2,
                role: 'llm_b',
                content: 'DELTA-CANONICAL-1\nDELTA-CANONICAL-2',
                created_at: 1710000001100,
                metadata: JSON.stringify({ source: 'hub' }),
            },
            {
                id: 3,
                role: 'user',
                content: '',
                created_at: 1710000005000,
                metadata: JSON.stringify({ source: 'hub' }),
            },
        ]);
        gateways.readTerminalTranscriptFeed.mockReturnValue([
            transcriptTurn({
                role: 'system',
                rawRole: 'intent',
                content: '[intenção] terminal live canonical deltas',
                timestamp: 1710000000000,
                metadata: { envelope: { source: 'sdk/assistant.intent', eventId: 40 } },
            }),
            transcriptTurn({
                role: 'system',
                rawRole: 'ask_user',
                content: 'ask_user solicitou resposta humana:\nASK-MODEL-GATEWAY-ROUTE-APPLY',
                timestamp: 1710000001200,
                metadata: { envelope: { source: 'sdk/user_input.requested', eventId: 403 } },
            }),
            transcriptTurn({
                role: 'user',
                rawRole: 'ask_user_answer',
                content: 'Resposta ao ask_user:\nSIM',
                timestamp: 1710000001300,
                metadata: { envelope: { source: 'sdk/user_input.completed', eventId: 409 } },
            }),
            transcriptTurn({
                role: 'assistant',
                rawRole: 'llm_b',
                content: 'POST-ASK-MODEL-GATEWAY-ROUTE-APPLY-FINAL',
                timestamp: 1710000001400,
                metadata: { assistantMessageEnvelope: { source: 'sdk/assistant.message', eventId: 430 } },
            }),
        ]);

        const projection = readTerminalTimelineProjection({ limitPairs: 10 });

        expect(projection.timelineSource).toBe('mixed');
        expect(projection.timelineAuthority).toBe('reconciled');
        expect(projection.reconciliationStatus).toBe('bridge_tail');
        expect(projection.sync.status).toBe('scheduled');
        expect(projection.syncBlockedReason).toBe(null);
        expect(projection.liveBridgeTailCount).toBe(3);
        expect(projection.turns.map((turn) => turn.content)).toEqual([
            '[intenção] terminal live canonical deltas',
            'Prompt route apply',
            'DELTA-CANONICAL-1\nDELTA-CANONICAL-2',
            'ask_user solicitou resposta humana:\nASK-MODEL-GATEWAY-ROUTE-APPLY',
            'Resposta ao ask_user:\nSIM',
            'POST-ASK-MODEL-GATEWAY-ROUTE-APPLY-FINAL',
            '',
        ]);
        await vi.waitFor(() => expect(gateways.writeTerminalHubTimelineTurn).toHaveBeenCalledTimes(3));
        expect(gateways.writeTerminalHubTimelineTurn).not.toHaveBeenCalledWith(
            'hub-1',
            expect.objectContaining({ content: '[intenção] terminal live canonical deltas' }),
        );
    });
});
