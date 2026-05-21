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
        const onPrInfo = vi.fn();
        wireUsageEvent(/** @type {any} */ (session), { emit, onPrInfo });
        return { emit, handlers, onPrInfo };
    }

    it('emite llm.usage sempre e pr.consumed somente quando há user.message canônico', async () => {
        const session = {
            sessionId: 'sdk-123',
            __copilotConfiguredModel: 'gpt-5.4',
            __copilotEffectiveModel: 'claude-haiku-4.5',
        };
        const { emit, handlers, onPrInfo } = await setupUsageHarness(session);

        handlers.get('user.message')?.({ data: { content: 'oi' } });
        handlers.get('assistant.usage')?.({
            data: {
                model: 'claude-haiku-4.5',
                cost: 0.33,
                inputTokens: 10,
                outputTokens: 5,
                quotaSnapshots: { premium_interactions: { remainingPercentage: 99.1 } },
            },
        });

        expect(onPrInfo).toHaveBeenCalledTimes(1);
        expect(onPrInfo).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'claude-haiku-4.5',
                configuredModel: 'gpt-5.4',
                effectiveModel: 'claude-haiku-4.5',
                modelMismatch: true,
                sessionId: 'sdk-123',
                cost: 0.33,
                inputTokens: 10,
                outputTokens: 5,
                quotaSnapshots: { premium_interactions: { remainingPercentage: 99.1 } },
                classification: 'premium_request',
                premiumRequest: true,
                premiumRequestReason: 'user_message',
                ts: expect.any(Number),
            }),
        );
        expect(emit).toHaveBeenCalledWith(
            'llm.usage',
            expect.objectContaining({
                model: 'claude-haiku-4.5',
                classification: 'premium_request',
                premiumRequest: true,
            }),
        );
        expect(emit).toHaveBeenCalledWith(
            'pr.consumed',
            expect.objectContaining({
                model: 'claude-haiku-4.5',
                configuredModel: 'gpt-5.4',
                effectiveModel: 'claude-haiku-4.5',
                modelMismatch: true,
            }),
        );
        expect(mocks.log).toHaveBeenCalledWith('WARN', expect.stringContaining('[MODEL_MISMATCH]'));
    });

    it('não contabiliza Premium Request para user.message em sessão BYOK', async () => {
        const session = {
            sessionId: 'sdk-byok',
            model: 'kilo-auto/free',
            config: {
                model: 'kilo-auto/free',
                provider: { type: 'openai', baseUrl: 'https://example.invalid/v1' },
            },
            __copilotEffectiveModel: 'kilo-auto/free',
            __copilotByokEnabled: true,
            __copilotByokProfile: 'kilo',
            __copilotByokPreset: 'kilo-code',
            __copilotByokProviderType: 'openai',
        };
        const { emit, handlers, onPrInfo } = await setupUsageHarness(session);

        handlers.get('user.message')?.({ data: { content: 'turno BYOK' } });
        handlers.get('assistant.usage')?.({
            data: {
                model: 'kilo-auto/free',
                cost: 0,
                inputTokens: 100,
                outputTokens: 20,
                initiator: 'user',
            },
        });

        expect(onPrInfo).not.toHaveBeenCalled();
        expect(emit).toHaveBeenCalledWith(
            'llm.usage',
            expect.objectContaining({
                model: 'kilo-auto/free',
                classification: 'byok_user_message',
                premiumRequest: false,
                premiumRequestReason: 'byok_user_message:initiator:user',
                byokProvider: true,
                byokProfile: 'kilo',
                byokPreset: 'kilo-code',
                byokProviderType: 'openai',
            }),
        );
        expect(emit).not.toHaveBeenCalledWith('pr.consumed', expect.any(Object));
        expect(mocks.log).toHaveBeenCalledWith('DEBUG', expect.stringContaining('Telemetria LLM sem Premium Request'));
    });

    it('não contabiliza PR para continuação de ask_user', async () => {
        const session = {
            sessionId: 'sdk-456',
            model: 'gpt-5.4',
            __copilotEffectiveModel: 'gpt-5.4',
        };
        const { emit, handlers, onPrInfo } = await setupUsageHarness(session);

        handlers.get('user_input.requested')?.({ data: { requestId: 'ask-1', question: 'Confirma?' } });
        handlers.get('user_input.completed')?.({ data: { requestId: 'ask-1', answer: 'SIM' } });
        handlers.get('assistant.usage')?.({
            data: {
                model: 'gpt-5.4',
                cost: 0.1,
            },
        });

        expect(onPrInfo).not.toHaveBeenCalled();
        expect(emit).toHaveBeenCalledWith(
            'llm.usage',
            expect.objectContaining({
                model: 'gpt-5.4',
                classification: 'ask_user_continuation',
                premiumRequest: false,
                premiumRequestReason: 'user_input_completed_continuation',
            }),
        );
        expect(emit).not.toHaveBeenCalledWith('pr.consumed', expect.any(Object));
        expect(mocks.log).toHaveBeenCalledWith('DEBUG', expect.stringContaining('Telemetria LLM sem Premium Request'));
    });

    it('classifica usage emitido antes de user_input.completed como continuação de ask_user sem duplicar completed tardio', async () => {
        const { emit, handlers, onPrInfo } = await setupUsageHarness({
            sessionId: 'sdk-late-ask',
            model: 'gpt-5.4',
        });

        handlers.get('user_input.requested')?.({ data: { requestId: 'ask-late', question: 'Confirma?' } });
        handlers.get('assistant.usage')?.({
            data: {
                model: 'gpt-5.4',
                cost: 0.1,
                initiator: 'agent',
            },
        });
        handlers.get('user_input.completed')?.({ data: { requestId: 'ask-late', answer: 'SIM' } });
        handlers.get('assistant.usage')?.({
            data: {
                model: 'gpt-5.4',
                cost: 0.2,
                initiator: 'agent',
            },
        });

        expect(onPrInfo).not.toHaveBeenCalled();
        expect(emit).toHaveBeenCalledWith(
            'llm.usage',
            expect.objectContaining({
                classification: 'ask_user_continuation',
                premiumRequest: false,
                premiumRequestReason: 'pending_user_input_request_continuation',
                askUserRequestId: 'ask-late',
            }),
        );
        expect(emit).toHaveBeenCalledWith(
            'llm.usage',
            expect.objectContaining({
                classification: 'non_user_initiated',
                premiumRequest: false,
                premiumRequestReason: 'initiator:agent',
            }),
        );
        expect(emit).not.toHaveBeenCalledWith('pr.consumed', expect.any(Object));
    });

    it('classifica initiator:user com user.message pendente como PR real', async () => {
        const { emit, handlers, onPrInfo } = await setupUsageHarness({
            sessionId: 'sdk-user',
            model: 'gpt-5.3-codex',
        });

        handlers.get('user.message')?.({ data: { content: 'turno explícito' } });
        handlers.get('assistant.usage')?.({
            data: {
                model: 'gpt-5.3-codex',
                cost: 1,
                initiator: 'user',
            },
        });

        expect(onPrInfo).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith(
            'llm.usage',
            expect.objectContaining({
                classification: 'premium_request',
                premiumRequest: true,
                premiumRequestReason: 'user_message:initiator:user',
                initiator: 'user',
            }),
        );
        expect(emit).toHaveBeenCalledWith(
            'pr.consumed',
            expect.objectContaining({
                classification: 'premium_request',
                premiumRequest: true,
            }),
        );
    });

    it('não contabiliza PR para usage com initiator ou parentToolCallId', async () => {
        const { emit, handlers, onPrInfo } = await setupUsageHarness({
            sessionId: 'sdk-tool',
            model: 'gpt-5.4',
        });

        handlers.get('assistant.usage')?.({
            data: {
                model: 'gpt-5.4',
                cost: 0.1,
                initiator: 'mcp-sampling',
            },
        });

        handlers.get('assistant.usage')?.({
            data: {
                model: 'gpt-5.4',
                cost: 0.2,
                parentToolCallId: 'call_123',
            },
        });

        expect(onPrInfo).not.toHaveBeenCalled();
        expect(emit).toHaveBeenCalledWith(
            'llm.usage',
            expect.objectContaining({
                model: 'gpt-5.4',
                classification: 'non_user_initiated',
                premiumRequest: false,
                premiumRequestReason: 'initiator:mcp-sampling',
            }),
        );
        expect(emit).toHaveBeenCalledWith(
            'llm.usage',
            expect.objectContaining({
                classification: 'tool_originated',
                parentToolCallId: 'call_123',
                premiumRequest: false,
                premiumRequestReason: 'parent_tool_call',
            }),
        );
        expect(emit).not.toHaveBeenCalledWith('pr.consumed', expect.any(Object));
    });

    it('normaliza Auto como seleção efetiva em PR user-initiated, sem marcar mismatch', async () => {
        const session = {
            sessionId: 'sdk-auto',
            __copilotConfiguredModel: 'auto',
            __copilotEffectiveModel: 'auto',
        };
        const { emit, handlers, onPrInfo } = await setupUsageHarness(session);

        handlers.get('user.message')?.({ data: { content: 'rode' } });
        handlers.get('assistant.usage')?.({
            data: {
                model: 'claude-haiku-4.5',
                cost: 0.33,
            },
        });

        expect(onPrInfo).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'claude-haiku-4.5',
                configuredModel: 'auto',
                effectiveModel: 'claude-haiku-4.5',
                classification: 'premium_request',
                premiumRequest: true,
            }),
        );
        expect(onPrInfo.mock.calls[0]?.[0]?.modelMismatch ?? false).toBe(false);
        expect(emit).toHaveBeenCalledWith(
            'pr.consumed',
            expect.objectContaining({
                effectiveModel: 'claude-haiku-4.5',
            }),
        );
    });

    it('trata assistant.usage sem user.message como uso LLM não atribuído, sem PR', async () => {
        const { emit, handlers, onPrInfo } = await setupUsageHarness({
            sessionId: 'sdk-unattributed',
            model: 'gpt-5.4',
        });

        handlers.get('assistant.usage')?.({
            data: {
                model: 'gpt-5.4',
                cost: 0.1,
            },
        });

        expect(onPrInfo).not.toHaveBeenCalled();
        expect(emit).toHaveBeenCalledWith(
            'llm.usage',
            expect.objectContaining({
                classification: 'unattributed_llm_usage',
                premiumRequest: false,
                premiumRequestReason: 'no_user_message',
            }),
        );
        expect(emit).not.toHaveBeenCalledWith('pr.consumed', expect.any(Object));
    });
});
