// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    onSessionEvent: vi.fn(),
    log: vi.fn(),
}));

vi.mock('#copilot/events', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        SESSION_EVENTS: {
            .../** @type {Record<string, string>} */ (actual['SESSION_EVENTS'] ?? {}),
            ASSISTANT_USAGE: 'assistant.usage',
            USER_MESSAGE: 'user.message',
            USER_INPUT_REQUESTED: 'user_input.requested',
            USER_INPUT_COMPLETED: 'user_input.completed',
            SESSION_LIMITS_CHANGED: 'session.session_limits_changed',
            SESSION_USAGE_CHECKPOINT: 'session.usage_checkpoint',
            SESSION_LIMITS_EXHAUSTED_REQUESTED: 'session.session_limits_exhausted.requested',
            SESSION_LIMITS_EXHAUSTED_COMPLETED: 'session.session_limits_exhausted.completed',
        },
    };
});

vi.mock('../../../../src/copilot/sdk/session/events.js', () => ({
    onSessionEvent: mocks.onSessionEvent,
}));

vi.mock('#copilot/observability', () => ({
    log: mocks.log,
}));

describe('event-handlers/usage wireUsageEvent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    async function setupUsageHarness(session = {}) {
        /** @type {Map<string, (evt: any) => void>} */
        const handlers = new Map();
        mocks.onSessionEvent.mockImplementation((_session, eventType, handler) => {
            handlers.set(eventType, handler);
            return () => {};
        });
        const { wireUsageEvent } = await import('../../../../src/copilot/event-handlers/usage.js');
        const emit = vi.fn();
        wireUsageEvent(/** @type {any} */ (session), { emit });
        return { emit, handlers };
    }

    it('classifica turno GitHub Copilot por attribution sem inferir Premium Request', async () => {
        const session = {
            sessionId: 'sdk-123',
            __copilotConfiguredModel: 'gpt-5.4',
            __copilotEffectiveModel: 'claude-haiku-4.5',
        };
        const { emit, handlers } = await setupUsageHarness(session);

        handlers.get('user.message')?.({ data: { content: 'oi' } });
        handlers.get('assistant.usage')?.({
            data: {
                model: 'claude-haiku-4.5',
                cost: 0.33,
                inputTokens: 10,
                outputTokens: 5,
                reasoningTokens: 2,
                serviceRequestId: 'srv-1',
                copilotUsage: { totalNanoAiu: 1250000 },
            },
        });

        expect(emit).toHaveBeenCalledWith(
            'llm.usage',
            expect.objectContaining({
                model: 'claude-haiku-4.5',
                configuredModel: 'gpt-5.4',
                effectiveModel: 'claude-haiku-4.5',
                modelMismatch: true,
                sessionId: 'sdk-123',
                classification: 'user_turn',
                attributionReason: 'user_turn',
                billingSource: 'github_copilot',
                inputTokens: 10,
                outputTokens: 5,
                reasoningTokens: 2,
                serviceRequestId: 'srv-1',
                copilotUsage: { totalNanoAiu: 1250000 },
            }),
        );
        expect(emit).not.toHaveBeenCalledWith('pr.consumed', expect.any(Object));
        expect(mocks.log).toHaveBeenCalledWith('WARN', expect.stringContaining('[MODEL_MISMATCH]'));
    });

    it('classifica turno BYOK sem atribuir billing ao GitHub Copilot', async () => {
        const session = {
            sessionId: 'sdk-byok',
            model: 'kilo-auto/free',
            config: { model: 'kilo-auto/free', provider: { type: 'openai', baseUrl: 'https://example.invalid/v1' } },
            __copilotEffectiveModel: 'kilo-auto/free',
            __copilotByokEnabled: true,
            __copilotByokProfile: 'kilo',
            __copilotByokPreset: 'kilo-code',
            __copilotByokProviderType: 'openai',
        };
        const { emit, handlers } = await setupUsageHarness(session);
        handlers.get('user.message')?.({ data: { content: 'turno BYOK' } });
        handlers.get('assistant.usage')?.({ data: { model: 'kilo-auto/free', cost: 0, initiator: 'user' } });

        expect(emit).toHaveBeenCalledWith(
            'llm.usage',
            expect.objectContaining({
                classification: 'byok_user_turn',
                attributionReason: 'byok_user_turn:initiator:user',
                billingSource: 'byok',
                byokProvider: true,
                byokProfile: 'kilo',
                byokPreset: 'kilo-code',
            }),
        );
        expect(emit).not.toHaveBeenCalledWith('pr.consumed', expect.any(Object));
    });

    it('classifica continuação de ask_user sem nova atribuição de turno', async () => {
        const { emit, handlers } = await setupUsageHarness({ sessionId: 'sdk-456', model: 'gpt-5.4' });
        handlers.get('user_input.requested')?.({ data: { requestId: 'ask-1' } });
        handlers.get('user_input.completed')?.({ data: { requestId: 'ask-1', answer: 'SIM' } });
        handlers.get('assistant.usage')?.({ data: { model: 'gpt-5.4', cost: 0.1 } });

        expect(emit).toHaveBeenCalledWith(
            'llm.usage',
            expect.objectContaining({
                classification: 'ask_user_continuation',
                attributionReason: 'user_input_completed_continuation',
                billingSource: 'github_copilot',
            }),
        );
    });

    it('correlaciona usage anterior ao user_input.completed sem duplicar continuação tardia', async () => {
        const { emit, handlers } = await setupUsageHarness({ sessionId: 'sdk-late-ask', model: 'gpt-5.4' });
        handlers.get('user_input.requested')?.({ data: { requestId: 'ask-late' } });
        handlers.get('assistant.usage')?.({ data: { model: 'gpt-5.4', initiator: 'agent' } });
        handlers.get('user_input.completed')?.({ data: { requestId: 'ask-late' } });
        handlers.get('assistant.usage')?.({ data: { model: 'gpt-5.4', initiator: 'agent' } });

        expect(emit).toHaveBeenCalledWith(
            'llm.usage',
            expect.objectContaining({
                classification: 'ask_user_continuation',
                attributionReason: 'pending_user_input_request_continuation',
                askUserRequestId: 'ask-late',
            }),
        );
        expect(emit).toHaveBeenCalledWith(
            'llm.usage',
            expect.objectContaining({
                classification: 'non_user_initiated',
                attributionReason: 'initiator:agent',
            }),
        );
    });

    it('classifica usage de tool/sampling sem fabricar unidade de billing', async () => {
        const { emit, handlers } = await setupUsageHarness({ sessionId: 'sdk-tool', model: 'gpt-5.4' });
        handlers.get('assistant.usage')?.({ data: { model: 'gpt-5.4', initiator: 'mcp-sampling' } });
        handlers.get('assistant.usage')?.({ data: { model: 'gpt-5.4', parentToolCallId: 'call_123' } });

        expect(emit).toHaveBeenCalledWith(
            'llm.usage',
            expect.objectContaining({ classification: 'non_user_initiated', attributionReason: 'initiator:mcp-sampling' }),
        );
        expect(emit).toHaveBeenCalledWith(
            'llm.usage',
            expect.objectContaining({ classification: 'tool_originated', attributionReason: 'parent_tool_call' }),
        );
    });

    it('normaliza Auto como seleção efetiva sem marcar mismatch', async () => {
        const { emit, handlers } = await setupUsageHarness({
            sessionId: 'sdk-auto',
            __copilotConfiguredModel: 'auto',
            __copilotEffectiveModel: 'auto',
        });
        handlers.get('user.message')?.({ data: { content: 'rode' } });
        handlers.get('assistant.usage')?.({ data: { model: 'claude-haiku-4.5', cost: 0.33 } });

        expect(emit).toHaveBeenCalledWith(
            'llm.usage',
            expect.objectContaining({
                configuredModel: 'auto',
                effectiveModel: 'claude-haiku-4.5',
                modelMismatch: false,
                classification: 'user_turn',
            }),
        );
    });

    it('encaminha checkpoints/limites de AI Credits e isola request-based wire fields em legacyBilling', async () => {
        const { emit, handlers } = await setupUsageHarness({ sessionId: 'sdk-limits' });

        handlers.get('session.session_limits_changed')?.({ data: { sessionLimits: { maxAiCredits: 250 } } });
        handlers.get('session.usage_checkpoint')?.({
            data: { totalNanoAiu: 9_000_000, totalPremiumRequests: 4 },
        });
        handlers.get('session.session_limits_exhausted.requested')?.({ data: { maxAiCredits: 250, usedAiCredits: 251 } });

        expect(emit).toHaveBeenCalledWith(
            'session.limits_changed',
            expect.objectContaining({ kind: 'limits_changed', maxAiCredits: 250 }),
        );
        expect(emit).toHaveBeenCalledWith(
            'session.usage_checkpoint',
            expect.objectContaining({
                kind: 'checkpoint',
                totalNanoAiu: 9_000_000,
                legacyBilling: { totalPremiumRequests: 4, source: 'sdk_explicit' },
            }),
        );
        expect(emit).toHaveBeenCalledWith(
            'session.limits_exhausted.requested',
            expect.objectContaining({ kind: 'exhausted_requested', maxAiCredits: 250, usedAiCredits: 251 }),
        );
    });
});
