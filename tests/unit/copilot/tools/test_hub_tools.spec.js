// @ts-check
/**
 * tests/unit/copilot/tools/test_hub_tools.spec.js
 *
 * Testes unitários para src/copilot/tools/hub-tools.js.
 *
 * Valida:
 *
 * - hubTools exporta array com 5 tools
 * - setHub injeta o hub corretamente
 * - hub_create_session: sucesso, hub indisponível, erro interno
 * - hub_send_message: sucesso, trunca mensagens longas, clamp timeout, hub indisponível
 * - hub_poll_user_messages: sucesso, sem mensagens, hub indisponível
 * - hub_read_history: sucesso com turns, total count, hub indisponível
 * - hub_list_sessions: sucesso, filtro por status, hub indisponível
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
}));

vi.mock('../../../../src/copilot/tools/tool-factory.js', () => ({
    buildTool: vi.fn((opts) => ({
        name: opts.name,
        description: opts.description,
        handler: opts.handler,
        parameters: opts.parameters,
    })),
    withSkipPermission: vi.fn((tool) => tool),
}));

// ─── Fake Hub ─────────────────────────────────────────────────────────────────

function createFakeHub() {
    return {
        isReady: true,
        createSession: vi.fn(() => 'hub-session-123'),
        sendToLlmB: vi.fn(async () => ({
            turnId: 'turn-1',
            hubSessionId: 'hub-session-123',
            turnNumber: 1,
            durationMs: 450,
            content: 'LLM-B response text',
            structured: { status: 'ok' },
        })),
        pollUserMessages: vi.fn(() => [
            { id: 'msg-1', content: 'user message 1', turn_number: 5, created_at: '2026-01-01T00:00:00Z' },
            { id: 'msg-2', content: 'user message 2', turn_number: 6, created_at: '2026-01-01T00:01:00Z' },
        ]),
        store: {
            readTurns: vi.fn(() => [
                {
                    id: 't-1',
                    role: 'assistant',
                    content: 'Hello from B',
                    turn_number: 1,
                    duration_ms: 300,
                    model: 'gpt-4.1',
                    created_at: '2026-01-01',
                },
            ]),
            countTurns: vi.fn(() => 5),
            listHubSessions: vi.fn(() => [
                {
                    id: 'hub-session-123',
                    title: 'Test session',
                    status: 'active',
                    sdk_session_id: 'sdk-1',
                    created_at: '2026-01-01',
                    updated_at: '2026-01-01',
                },
            ]),
        },
    };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('hub-tools', () => {
    /** @type {typeof import('../../../../src/copilot/tools/hub-tools.js')} */
    let mod;
    /** @type {ReturnType<typeof createFakeHub>} */
    let fakeHub;

    beforeEach(async () => {
        vi.resetModules();
        mod = await import('../../../../src/copilot/tools/hub-tools.js');
        fakeHub = createFakeHub();
        mod.setHub(/** @type {any} */ (fakeHub));
    });

    // ── Exports ───────────────────────────────────────────────────────────

    describe('exports', () => {
        it('hubTools é array com 5 tools', () => {
            expect(Array.isArray(mod.hubTools)).toBe(true);
            expect(mod.hubTools.length).toBe(5);
        });

        it('contém todas as tools esperadas', () => {
            const names = mod.hubTools.map((t) => t.name);
            expect(names).toContain('hub_create_session');
            expect(names).toContain('hub_send_message');
            expect(names).toContain('hub_poll_user_messages');
            expect(names).toContain('hub_read_history');
            expect(names).toContain('hub_list_sessions');
        });
    });

    // ── hub_create_session ────────────────────────────────────────────────

    describe('hub_create_session', () => {
        /** @returns {any} */
        const find = () => mod.hubTools.find((t) => t.name === 'hub_create_session');

        it('cria sessão com sucesso', async () => {
            const result = await find().handler({ title: 'Test session' });

            expect(result.success).toBe(true);
            expect(result.hubSessionId).toBe('hub-session-123');
            expect(fakeHub.createSession).toHaveBeenCalledWith({ title: 'Test session' });
        });

        it('cria sessão com metadata', async () => {
            const result = await find().handler({ title: 'With meta', metadata: { key: 'value' } });

            expect(result.success).toBe(true);
            expect(fakeHub.createSession).toHaveBeenCalledWith({ title: 'With meta', metadata: { key: 'value' } });
        });

        it('retorna erro quando hub indisponível', async () => {
            mod.setHub(/** @type {any} */ (null));
            const result = await find().handler({});

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/não disponível/i);
        });

        it('retorna erro quando hub não está pronto', async () => {
            fakeHub.isReady = false;
            const result = await find().handler({});

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/não disponível/i);
        });

        it('captura erro interno do hub', async () => {
            fakeHub.createSession.mockImplementation(() => {
                throw new Error('DB full');
            });
            const result = await find().handler({ title: 'fail' });

            expect(result.success).toBe(false);
            expect(result.error).toBe('DB full');
        });
    });

    // ── hub_send_message ──────────────────────────────────────────────────

    describe('hub_send_message', () => {
        /** @returns {any} */
        const find = () => mod.hubTools.find((t) => t.name === 'hub_send_message');

        it('envia mensagem simples e retorna resposta', async () => {
            const result = await find().handler({
                hubSessionId: 'hub-session-123',
                message: 'Hello LLM-B',
            });

            expect(result.success).toBe(true);
            expect(result.turnId).toBe('turn-1');
            expect(result.durationMs).toBe(450);
            expect(result.response).toBe('LLM-B response text');
        });

        it('envia mensagem structured com context/intent', async () => {
            await find().handler({
                hubSessionId: 'hub-session-123',
                message: 'msg',
                context: 'ctx',
                intent: 'analyze',
                useStructured: true,
            });

            expect(fakeHub.sendToLlmB).toHaveBeenCalledWith(
                'hub-session-123',
                expect.objectContaining({ context: 'ctx', intent: 'analyze' }),
                expect.objectContaining({ useStructured: true }),
            );
        });

        it('trunca mensagem maior que 32000 chars', async () => {
            const longMsg = 'x'.repeat(40000);
            await find().handler({
                hubSessionId: 'hub-session-123',
                message: longMsg,
            });

            const call = fakeHub.sendToLlmB.mock.calls[0];
            const payload = call[1];
            expect(typeof payload).toBe('string');
            expect(payload.length).toBeLessThanOrEqual(32020); // 32000 + truncation marker
            expect(payload).toContain('…truncado');
        });

        it('clamp timeout para range válido (5s-300s)', async () => {
            await find().handler({
                hubSessionId: 'hub-session-123',
                message: 'test',
                timeoutMs: 1000000, // absurdo
            });

            const opts = fakeHub.sendToLlmB.mock.calls[0][2];
            expect(opts.timeoutMs).toBeLessThanOrEqual(300000);
        });

        it('retorna erro quando hub indisponível', async () => {
            mod.setHub(/** @type {any} */ (null));
            const result = await find().handler({ hubSessionId: 's', message: 'msg' });

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/não disponível/i);
        });

        it('captura erro do sendToLlmB', async () => {
            fakeHub.sendToLlmB.mockRejectedValueOnce(new Error('timeout'));
            const result = await find().handler({ hubSessionId: 's', message: 'msg' });

            expect(result.success).toBe(false);
            expect(result.error).toBe('timeout');
        });
    });

    // ── hub_poll_user_messages ────────────────────────────────────────────

    describe('hub_poll_user_messages', () => {
        /** @returns {any} */
        const find = () => mod.hubTools.find((t) => t.name === 'hub_poll_user_messages');

        it('retorna mensagens pendentes', async () => {
            const result = await find().handler({ hubSessionId: 'hub-session-123' });

            expect(result.success).toBe(true);
            expect(result.pendingCount).toBe(2);
            expect(result.messages.length).toBe(2);
            expect(result.messages[0].content).toBe('user message 1');
        });

        it('retorna 0 quando sem mensagens', async () => {
            fakeHub.pollUserMessages.mockReturnValueOnce([]);
            const result = await find().handler({ hubSessionId: 'hub-session-123' });

            expect(result.success).toBe(true);
            expect(result.pendingCount).toBe(0);
        });

        it('retorna erro quando hub indisponível', async () => {
            mod.setHub(/** @type {any} */ (null));
            const result = await find().handler({ hubSessionId: 's' });

            expect(result.success).toBe(false);
        });
    });

    // ── hub_read_history ──────────────────────────────────────────────────

    describe('hub_read_history', () => {
        /** @returns {any} */
        const find = () => mod.hubTools.find((t) => t.name === 'hub_read_history');

        it('retorna turns do histórico', async () => {
            const result = await find().handler({ hubSessionId: 'hub-session-123' });

            expect(result.success).toBe(true);
            expect(result.total).toBe(5);
            expect(result.returned).toBe(1);
            expect(result.turns[0].role).toBe('assistant');
            expect(result.turns[0].model).toBe('gpt-4.1');
        });

        it('passa limit e offset para store', async () => {
            await find().handler({ hubSessionId: 'hub-session-123', limit: 50, offset: 10 });

            expect(fakeHub.store.readTurns).toHaveBeenCalledWith(
                'hub-session-123',
                expect.objectContaining({ limit: 50, offset: 10 }),
            );
        });

        it('passa after para polling incremental', async () => {
            await find().handler({ hubSessionId: 'hub-session-123', after: 42 });

            expect(fakeHub.store.readTurns).toHaveBeenCalledWith(
                'hub-session-123',
                expect.objectContaining({ after: 42 }),
            );
        });

        it('trunca conteúdo longo a 500 chars', async () => {
            fakeHub.store.readTurns.mockReturnValueOnce([
                {
                    id: 't',
                    role: 'user',
                    content: 'A'.repeat(1000),
                    turn_number: 1,
                    duration_ms: 0,
                    model: 'm',
                    created_at: '',
                },
            ]);

            const result = await find().handler({ hubSessionId: 's' });
            expect(result.turns[0].content.length).toBeLessThanOrEqual(504); // 500 + "..."
        });

        it('retorna erro quando hub indisponível', async () => {
            mod.setHub(/** @type {any} */ (null));
            const result = await find().handler({ hubSessionId: 's' });

            expect(result.success).toBe(false);
        });
    });

    // ── hub_list_sessions ─────────────────────────────────────────────────

    describe('hub_list_sessions', () => {
        /** @returns {any} */
        const find = () => mod.hubTools.find((t) => t.name === 'hub_list_sessions');

        it('lista sessões ativas', async () => {
            const result = await find().handler({});

            expect(result.success).toBe(true);
            expect(result.count).toBe(1);
            expect(result.sessions[0].id).toBe('hub-session-123');
            expect(result.sessions[0].status).toBe('active');
        });

        it('passa limit e status para store', async () => {
            await find().handler({ limit: 5, status: 'closed' });

            expect(fakeHub.store.listHubSessions).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 5, status: 'closed' }),
            );
        });

        it('retorna erro quando hub indisponível', async () => {
            mod.setHub(/** @type {any} */ (null));
            const result = await find().handler({});

            expect(result.success).toBe(false);
        });
    });
});
