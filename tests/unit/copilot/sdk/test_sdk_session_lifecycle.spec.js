// @ts-nocheck
/**
 * Testes — Faixa 6: sdk/session-lifecycle.js
 *
 * Cobre: abortSession, setSessionModel, getSessionMessages, getSessionWorkspacePath, disposeSession,
 * runSessionLifecycle
 */

import { beforeEach, describe, expect, it } from 'vitest';

const { mockLog } = vi.hoisted(() => ({
    mockLog: vi.fn(),
}));

// ─── Mock: logger ──────────────────────────────────────────────────────────
vi.mock('#copilot/observability/logger', () => ({
    log: mockLog,
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
    runSessionLifecycle,
    setSessionModel,
} from '#copilot/sdk/session-lifecycle';

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
        getMessages: vi.fn().mockResolvedValue([]),
        disconnect: vi.fn().mockResolvedValue(undefined),
        [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
        workspacePath: '/tmp/ws/sess-test-001',
        ...overrides,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('sdk/session-lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
    });

    // ─── setSessionModel ───────────────────────────────────────────────────

    describe('setSessionModel', () => {
        it('chama session.setModel com model e options', async () => {
            const s = fakeSession();
            await setSessionModel(s, 'gpt-4.1', { reasoningEffort: 'high' });
            expect(s.setModel).toHaveBeenCalledWith('gpt-4.1', { reasoningEffort: 'high' });
        });

        it('funciona sem options', async () => {
            const s = fakeSession();
            await setSessionModel(s, 'claude-sonnet-4-5');
            expect(s.setModel).toHaveBeenCalledWith('claude-sonnet-4-5', undefined);
        });

        it('rejeita para model vazio', async () => {
            const s = fakeSession();
            await expect(setSessionModel(s, '')).rejects.toThrow('string não-vazia');
        });

        it('rejeita para model não-string', async () => {
            const s = fakeSession();
            // @ts-ignore
            await expect(setSessionModel(s, 42)).rejects.toThrow(TypeError);
        });

        it('rejeita para sessão inválida', async () => {
            await expect(setSessionModel(null, 'gpt-4.1')).rejects.toThrow(TypeError);
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
