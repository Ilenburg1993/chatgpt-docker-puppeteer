// @ts-check
/**
 * tests/unit/copilot/conversation-hub/test_call_strategies.spec.js
 *
 * F158: Testes para call-strategies.js (estratégias de chamada LLM-B).
 */

import {
    callViaDialogLoop,
    callViaSimpleChat,
    callViaStructured,
} from '../../../../src/copilot/conversation-hub/call-strategies.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

/** @returns {import('../../../../src/copilot/conversation-hub/call-strategies.js').CallStrategyContext} */
function makeCtx() {
    return {
        hubSessionId: 'hub-001',
        turnNumber: 0,
        timeoutMs: 5000,
        emit: vi.fn(() => true),
    };
}

// ─── callViaDialogLoop ───────────────────────────────────────────────────────

describe('callViaDialogLoop', () => {
    it('chama sendDialogTurn com content string', async () => {
        const agent = {
            sendDialogTurn: vi.fn(async () => 'resposta do dialog'),
            on: vi.fn(),
            off: vi.fn(),
        };
        const ctx = makeCtx();
        const result = await callViaDialogLoop(/** @type {any} */ (agent), 'hello', 'hello', ctx);
        expect(result).toBe('resposta do dialog');
        expect(agent.sendDialogTurn.mock.calls.length === 1).toBeTruthy();
    });

    it('lança SessionError quando agent não suporta sendDialogTurn', async () => {
        const agent = { on: vi.fn(), off: vi.fn() };
        const ctx = makeCtx();
        await expect(() => callViaDialogLoop(/** @type {any} */ (agent), 'hello', 'hello', ctx)).rejects.toThrow(
            'sendDialogTurn',
        );
    });

    it('registra e remove listener de task.delta', async () => {
        const listeners = /** @type {{ event: string; fn: Function }[]} */ ([]);
        const agent = {
            sendDialogTurn: vi.fn(async () => 'ok'),
            on: vi.fn((event, fn) => listeners.push({ event, fn })),
            off: vi.fn(),
        };
        const ctx = makeCtx();
        await callViaDialogLoop(/** @type {any} */ (agent), 'msg', 'msg', ctx);
        expect(agent.on.mock.calls.some((c) => c[0] === 'task.delta')).toBeTruthy();
        expect(agent.off.mock.calls.some((c) => c[0] === 'task.delta')).toBeTruthy();
    });

    it('emite turn:delta quando agent envia task.delta', async () => {
        /** @type {Function | null} */
        let deltaHandler = null;
        const agent = {
            sendDialogTurn: vi.fn(async () => {
                // Simular delta durante execução
                deltaHandler?.({ chunk: 'chunk1' });
                return 'done';
            }),
            on: vi.fn((event, fn) => {
                if (event === 'task.delta') deltaHandler = fn;
            }),
            off: vi.fn(),
        };
        const ctx = makeCtx();
        await callViaDialogLoop(/** @type {any} */ (agent), 'msg', 'msg', ctx);
        expect(
            /** @type {import('vitest').Mock} */ (ctx.emit).mock.calls.some(
                (c) => c[0] === 'turn:delta' && c[1]?.chunk === 'chunk1',
            ),
        ).toBeTruthy();
    });

    it('remove listener mesmo quando sendDialogTurn lança', async () => {
        const agent = {
            sendDialogTurn: vi.fn(async () => {
                throw new Error('falha');
            }),
            on: vi.fn(),
            off: vi.fn(),
        };
        const ctx = makeCtx();
        await expect(() => callViaDialogLoop(/** @type {any} */ (agent), 'msg', 'msg', ctx)).rejects.toThrow();
        expect(agent.off.mock.calls.some((c) => c[0] === 'task.delta')).toBeTruthy(); // off deve ser chamado no finally
    });
});

// ─── callViaStructured ───────────────────────────────────────────────────────

describe('callViaStructured', () => {
    it('retorna llmBResponse e llmBStructured', async () => {
        const bridge = {
            chatStructured: vi.fn(async () => ({
                raw: 'resposta raw',
                structured: { action: 'test' },
                parseError: null,
            })),
        };
        const ctx = makeCtx();
        const result = await callViaStructured(/** @type {any} */ (bridge), { text: 'hello' }, ctx);
        expect(result.llmBResponse).toBe('resposta raw');
        expect(result.llmBStructured).toEqual({ action: 'test' });
        expect(result.parseError).toBe(null);
    });

    it('usa accumulated quando raw é undefined', async () => {
        let onDeltaCb;
        const bridge = {
            chatStructured: vi.fn(async (_msg, opts) => {
                onDeltaCb = opts.onDelta;
                onDeltaCb('chunk1');
                onDeltaCb('chunk2');
                return { raw: undefined, structured: null, parseError: null };
            }),
        };
        const ctx = makeCtx();
        const result = await callViaStructured(/** @type {any} */ (bridge), {}, ctx);
        expect(result.llmBResponse).toBe('chunk1chunk2');
    });
});

// ─── callViaSimpleChat ───────────────────────────────────────────────────────

describe('callViaSimpleChat', () => {
    it('retorna response do bridge.chat', async () => {
        const bridge = {
            chat: vi.fn(async () => ({ response: 'simple response' })),
        };
        const ctx = makeCtx();
        const result = await callViaSimpleChat(/** @type {any} */ (bridge), 'hello', ctx);
        expect(result).toBe('simple response');
    });

    it('emite turn:delta via onDelta callback', async () => {
        const bridge = {
            chat: vi.fn(async (_msg, opts) => {
                opts.onDelta('delta1');
                return { response: 'done' };
            }),
        };
        const ctx = makeCtx();
        await callViaSimpleChat(/** @type {any} */ (bridge), 'hello', ctx);
        expect(
            /** @type {import('vitest').Mock} */ (ctx.emit).mock.calls.some(
                (c) => c[0] === 'turn:delta' && c[1]?.chunk === 'delta1',
            ),
        ).toBeTruthy();
    });
});
