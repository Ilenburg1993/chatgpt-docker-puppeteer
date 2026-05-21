/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- test file uses untyped mocks extensively
/**
 * Testes — Faixa 6: sdk/session-lifecycle.js
 *
 * Cobre: abortSession, setSessionModel, getSessionMessages, getSessionWorkspacePath, disposeSession,
 * runSessionLifecycle
 */

import { SdkOperationError } from '#copilot/sdk/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLog } = vi.hoisted(() => ({
    mockLog: vi.fn(),
}));

// ─── Mock: logger ──────────────────────────────────────────────────────────
vi.mock('#copilot/observability/logger', () => ({
    log: mockLog,
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

// sdk-session-wrapper.js importa log de ./logger.js (DI local), não de #copilot/observability
vi.mock('../../../../src/copilot/sdk/logger.js', () => ({
    log: mockLog,
    setSdkLogger: vi.fn(),
}));

// ─── Mock: SDK (necessário pelo barrel) ────────────────────────────────────
vi.mock('@github/copilot-sdk', () => ({
    CopilotClient: vi.fn(),
    approveAll: vi.fn(),
    defineTool: vi.fn(),
    SYSTEM_PROMPT_SECTIONS: {
        guidelines: { name: 'guidelines' },
        identity: { name: 'identity' },
        context: { name: 'context' },
        safety: { name: 'safety' },
        responseFormat: { name: 'responseFormat' },
        tools: { name: 'tools' },
        abilities: { name: 'abilities' },
        instructions: { name: 'instructions' },
        conversationRules: { name: 'conversationRules' },
        errorHandling: { name: 'errorHandling' },
    },
}));

import {
    abortSession,
    disposeSession,
    getSessionMessages,
    getSessionWorkspacePath,
    logSessionTimeline,
    runSessionLifecycle,
    sendSessionAndWait,
    setSessionModel,
} from '#copilot/sdk/session-runtime';
import { setSdkMetricEmitter } from '../../../../src/copilot/sdk/telemetry/operation-metrics.js';

// ─── Helper: fake session ──────────────────────────────────────────────────

/**
 * @param {object} [overrides]
 * @returns {any}
 */
function fakeSession(overrides = {}) {
    return {
        sessionId: 'sess-test-001',
        abort: vi.fn().mockResolvedValue(undefined),
        setModel: vi.fn().mockResolvedValue(undefined),
        log: vi.fn().mockResolvedValue(undefined),
        getMessages: vi.fn().mockResolvedValue([]),
        disconnect: vi.fn().mockResolvedValue(undefined),
        [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
        workspacePath: '/tmp/ws/sess-test-001',
        ...overrides,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('sdk/session-lifecycle', () => {
    /** @type {import('../../../../src/copilot/sdk/types.js').SdkOperationMetric[]} */
    let metrics;

    beforeEach(() => {
        vi.clearAllMocks();
        metrics = [];
        setSdkMetricEmitter((metric) => metrics.push(metric));
    });

    afterEach(() => {
        setSdkMetricEmitter(null);
    });

    // ─── abortSession ──────────────────────────────────────────────────────

    describe('abortSession', () => {
        it('chama session.abort() e loga', async () => {
            const s = fakeSession();
            await abortSession(s);
            expect(s.abort).toHaveBeenCalledOnce();
            expect(mockLog).toHaveBeenCalledWith('INFO', expect.stringContaining('Abortando'));
            expect(mockLog).toHaveBeenCalledWith('INFO', expect.stringContaining('Abort concluído'));
        });

        it('rejeita com TypeError para sessão inválida', async () => {
            await expect(abortSession(null)).rejects.toThrow(TypeError);
            await expect(abortSession(undefined)).rejects.toThrow(TypeError);
            await expect(abortSession({})).rejects.toThrow('inválida');
        });

        it('propaga erro do SDK', async () => {
            const s = fakeSession({ abort: vi.fn().mockRejectedValue(new Error('disconnect')) });
            await expect(abortSession(s)).rejects.toThrow('disconnect');
        });

        it('normaliza erro do SDK em SdkOperationError', async () => {
            const s = fakeSession({
                abort: vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })),
            });
            await expect(abortSession(s)).rejects.toBeInstanceOf(SdkOperationError);
        });
    });

    // ─── setSessionModel ───────────────────────────────────────────────────

    describe('setSessionModel', () => {
        it('chama session.setModel com model e options', async () => {
            const s = fakeSession();
            await setSessionModel(s, 'gpt-4.1', { reasoningEffort: 'high' });
            expect(s.setModel).toHaveBeenCalledWith('gpt-4.1', { reasoningEffort: 'high' });
            expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
                expect.arrayContaining(['session.setModel:started', 'session.setModel:succeeded']),
            );
        });

        it('repassa modelCapabilities para session.setModel quando fornecido', async () => {
            const s = fakeSession();
            const modelCapabilities = { supports: { reasoningEffort: true } };
            await setSessionModel(s, 'gpt-5.4', {
                reasoningEffort: 'medium',
                modelCapabilities: /** @type {any} */ (modelCapabilities),
            });
            expect(s.setModel).toHaveBeenCalledWith('gpt-5.4', {
                reasoningEffort: 'medium',
                modelCapabilities,
            });
        });

        it('omite reasoningEffort para model IDs BYOK com dois-pontos antes de chamar o SDK', async () => {
            const s = fakeSession();
            const modelCapabilities = { supports: { reasoningEffort: true, vision: true } };

            await setSessionModel(s, 'deepseek/deepseek-v4-flash:free', {
                reasoningEffort: 'high',
                modelCapabilities,
            });

            expect(s.setModel).toHaveBeenCalledWith('deepseek/deepseek-v4-flash:free', {
                modelCapabilities: { supports: { reasoningEffort: false, vision: true } },
            });
            expect(mockLog).toHaveBeenCalledWith(
                'INFO',
                expect.stringContaining("reasoningEffort omitido para modelo provider-literal"),
            );
        });

        it('funciona sem options', async () => {
            const s = fakeSession();
            await setSessionModel(s, 'claude-sonnet-4-5');
            expect(s.setModel).toHaveBeenCalledWith('claude-sonnet-4-5', undefined);
        });

        it('aceita model auto quando SDK resolve modelo efetivo concreto', async () => {
            const s = fakeSession({
                rpc: {
                    model: {
                        getCurrent: vi.fn().mockResolvedValue({ modelId: 'gpt-5.4' }),
                        switchTo: vi.fn(),
                    },
                },
            });

            const result = await setSessionModel(s, 'auto');

            expect(s.setModel).toHaveBeenCalledWith('auto', undefined);
            expect(s.rpc.model.switchTo).not.toHaveBeenCalled();
            expect(result).toEqual({
                requestedModel: 'auto',
                effectiveModel: 'gpt-5.4',
                verifiedSwitch: true,
                usedRpcFallback: false,
            });
            expect(Reflect.get(s, '__copilotEffectiveModel')).toBe('gpt-5.4');
            expect(Reflect.get(s, '__copilotModelVerified')).toBe(true);
        });

        it('usa session.switchModel quando setModel não existe', async () => {
            const switchModel = vi.fn().mockResolvedValue(undefined);
            const s = fakeSession({
                setModel: undefined,
                switchModel,
            });

            await setSessionModel(s, 'gpt-5.4', { reasoningEffort: 'medium' });

            expect(switchModel).toHaveBeenCalledWith('gpt-5.4', { reasoningEffort: 'medium' });
            expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
                expect.arrayContaining(['session.switchModel:started', 'session.switchModel:succeeded']),
            );
        });

        it('rejeita para model vazio', async () => {
            const s = fakeSession();
            await expect(setSessionModel(s, '')).rejects.toThrow('string não-vazia');
        });

        it('rejeita para model não-string', async () => {
            const s = fakeSession();
            // @ts-expect-error -- testing invalid argument type
            await expect(setSessionModel(s, 42)).rejects.toThrow(TypeError);
        });

        it('rejeita para sessão inválida', async () => {
            await expect(setSessionModel(null, 'gpt-4.1')).rejects.toThrow(TypeError);
        });
    });

    describe('sendSessionAndWait', () => {
        it('emite métricas de sucesso', async () => {
            const s = fakeSession({ sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'ok' } }) });
            await expect(sendSessionAndWait(s, /** @type {any} */ ({ prompt: 'oi' }))).resolves.toEqual({
                data: { content: 'ok' },
            });
            expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
                expect.arrayContaining(['session.sendAndWait:started', 'session.sendAndWait:succeeded']),
            );
        });
    });

    describe('logSessionTimeline', () => {
        it('chama session.log com opções normalizadas e métricas', async () => {
            const s = fakeSession();
            await expect(logSessionTimeline(s, 'hello timeline', { level: 'warning', ephemeral: true })).resolves.toBe(
                undefined,
            );
            expect(s.log).toHaveBeenCalledWith('hello timeline', { level: 'warning', ephemeral: true });
            expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
                expect.arrayContaining(['session.log:started', 'session.log:succeeded']),
            );
        });

        it('rejeita message vazio e level inválido antes do SDK', async () => {
            const s = fakeSession();
            await expect(logSessionTimeline(s, '')).rejects.toThrow('message deve ser string');
            await expect(logSessionTimeline(s, 'x', /** @type {any} */ ({ level: 'debug' }))).rejects.toThrow(
                'level deve ser',
            );
            expect(s.log).not.toHaveBeenCalled();
        });
    });

    // ─── getSessionMessages ────────────────────────────────────────────────

    describe('getSessionMessages', () => {
        it('retorna os eventos da sessão', async () => {
            const events = [{ type: 'assistant.message', data: { content: 'hello' } }];
            const s = fakeSession({ getMessages: vi.fn().mockResolvedValue(events) });
            const result = await getSessionMessages(s);
            expect(result).toEqual(events);
            expect(s.getMessages).toHaveBeenCalledOnce();
        });

        it('retorna array vazio se não houver eventos', async () => {
            const s = fakeSession();
            const result = await getSessionMessages(s);
            expect(result).toEqual([]);
        });

        it('rejeita para sessão inválida', async () => {
            await expect(getSessionMessages(null)).rejects.toThrow(TypeError);
        });

        it('propaga erro do SDK', async () => {
            const s = fakeSession({ getMessages: vi.fn().mockRejectedValue(new Error('no connection')) });
            await expect(getSessionMessages(s)).rejects.toThrow('no connection');
        });

        it('normaliza erro de getMessages em SdkOperationError', async () => {
            const s = fakeSession({ getMessages: vi.fn().mockRejectedValue(new Error('connection reset')) });
            await expect(getSessionMessages(s)).rejects.toBeInstanceOf(SdkOperationError);
        });
    });

    // ─── getSessionWorkspacePath ───────────────────────────────────────────

    describe('getSessionWorkspacePath', () => {
        it('retorna workspacePath quando disponível', () => {
            const s = fakeSession({ workspacePath: '/tmp/ws/abc' });
            expect(getSessionWorkspacePath(s)).toBe('/tmp/ws/abc');
        });

        it('retorna undefined quando não disponível', () => {
            const s = fakeSession({ workspacePath: undefined });
            expect(getSessionWorkspacePath(s)).toBeUndefined();
        });

        it('rejeita para sessão inválida', () => {
            expect(() => getSessionWorkspacePath(null)).toThrow(TypeError);
        });
    });

    // ─── disposeSession ────────────────────────────────────────────────────

    describe('disposeSession', () => {
        it('chama Symbol.asyncDispose na sessão', async () => {
            const s = fakeSession();
            await disposeSession(s);
            expect(s[Symbol.asyncDispose]).toHaveBeenCalledOnce();
        });

        it('loga antes e depois', async () => {
            const s = fakeSession();
            await disposeSession(s);
            expect(mockLog).toHaveBeenCalledWith('INFO', expect.stringContaining('Disposing'));
            expect(mockLog).toHaveBeenCalledWith('INFO', expect.stringContaining('disposed'));
        });

        it('rejeita para sessão inválida', async () => {
            await expect(disposeSession(null)).rejects.toThrow(TypeError);
        });
    });

    // ─── runSessionLifecycle ───────────────────────────────────────────────

    describe('runSessionLifecycle', () => {
        it('executa ciclo completo: create → use → disconnect', async () => {
            const s = fakeSession();
            const create = vi.fn().mockResolvedValue(s);
            const use = vi.fn().mockResolvedValue(undefined);

            const result = await runSessionLifecycle({ create, use });

            expect(create).toHaveBeenCalledOnce();
            expect(use).toHaveBeenCalledWith(s);
            expect(s.disconnect).toHaveBeenCalledOnce();
            expect(result.session).toBe(s);
            expect(result.aborted).toBe(false);
            expect(result.error).toBeUndefined();
        });

        it('aborta e desconecta em caso de erro (abortOnError default)', async () => {
            const s = fakeSession();
            const create = vi.fn().mockResolvedValue(s);
            const use = vi.fn().mockRejectedValue(new Error('boom'));

            const result = await runSessionLifecycle({ create, use });

            expect(s.abort).toHaveBeenCalledOnce();
            expect(s.disconnect).toHaveBeenCalledOnce();
            expect(result.aborted).toBe(true);
            expect(result.error?.message).toBe('boom');
        });

        it('não aborta se abortOnError=false', async () => {
            const s = fakeSession();
            const create = vi.fn().mockResolvedValue(s);
            const use = vi.fn().mockRejectedValue(new Error('fail'));

            const result = await runSessionLifecycle({
                create,
                use,
                options: { abortOnError: false },
            });

            expect(s.abort).not.toHaveBeenCalled();
            expect(result.aborted).toBe(false);
            expect(result.error?.message).toBe('fail');
        });

        it('usa dispose em vez de disconnect com forceDispose', async () => {
            const s = fakeSession();
            const create = vi.fn().mockResolvedValue(s);
            const use = vi.fn().mockResolvedValue(undefined);

            await runSessionLifecycle({
                create,
                use,
                options: { forceDispose: true },
            });

            expect(s[Symbol.asyncDispose]).toHaveBeenCalledOnce();
            expect(s.disconnect).not.toHaveBeenCalled();
        });

        it('não propaga erro de cleanup', async () => {
            const s = fakeSession({
                disconnect: vi.fn().mockRejectedValue(new Error('cleanup fail')),
            });
            const create = vi.fn().mockResolvedValue(s);
            const use = vi.fn().mockResolvedValue(undefined);

            // não deve re-throw
            const result = await runSessionLifecycle({ create, use });
            expect(result.error).toBeUndefined();
            expect(mockLog).toHaveBeenCalledWith('WARN', expect.stringContaining('cleanup falhou'));
        });

        it('não propaga erro de abort', async () => {
            const s = fakeSession({
                abort: vi.fn().mockRejectedValue(new Error('abort fail')),
            });
            const create = vi.fn().mockResolvedValue(s);
            const use = vi.fn().mockRejectedValue(new Error('use fail'));

            const result = await runSessionLifecycle({ create, use });
            expect(result.aborted).toBe(false); // abort falhou
            expect(result.error?.message).toBe('use fail');
        });
    });

    // ─── Barrel re-export ──────────────────────────────────────────────────

    describe('barrel re-export', () => {
        it('exporta todos os 6 símbolos via barrel', async () => {
            const barrel = await import('#copilot/sdk');
            expect(barrel.abortSession).toBeTypeOf('function');
            expect(barrel.setSessionModel).toBeTypeOf('function');
            expect(barrel.getSessionMessages).toBeTypeOf('function');
            expect(barrel.getSessionWorkspacePath).toBeTypeOf('function');
            expect(barrel.disposeSession).toBeTypeOf('function');
            expect(barrel.runSessionLifecycle).toBeTypeOf('function');
        });
    });
});
