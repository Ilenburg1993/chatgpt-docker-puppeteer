// @ts-check
/**
 * tests/unit/copilot/test_client_dialog.spec.js
 *
 * Testes unitários para src/copilot/channel/client-dialog.js (114L).
 *
 * Valida:
 *
 * - registerDialogListeners: wiring de eventos, cleanup simétrico
 * - startDialogMode: delegação ao agent, cleanup em erro
 * - dialogTurn: sendDialogTurn + onDelta/onReasoning listeners
 * - stopDialogMode: delegação com authorized:true + reason
 */

import { LLM_B_TURN_TIMEOUT_MS } from '#copilot/config';
import { describe, expect, it, vi } from 'vitest';
import {
    dialogTurn,
    dialogTurnDetailed,
    registerDialogListeners,
    startDialogMode,
    stopDialogMode,
} from '../../../src/copilot/channel/client-dialog.js';

// ─── Mock Agent ───────────────────────────────────────────────────────────────

function createMockAgent() {
    /** @type {Map<string, Function[]>} */
    const listeners = new Map();

    return /** @type {any} */ ({
        on: vi.fn((event, fn) => {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event)?.push(fn);
        }),
        once: vi.fn((event, fn) => {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event)?.push(fn);
        }),
        off: vi.fn((event, fn) => {
            const fns = listeners.get(event);
            if (fns) {
                const idx = fns.indexOf(fn);
                if (idx >= 0) fns.splice(idx, 1);
            }
        }),
        startDialogLoop: vi.fn().mockResolvedValue(undefined),
        sendDialogTurn: vi.fn().mockResolvedValue('reply text'),
        stopDialogLoop: vi.fn().mockResolvedValue(undefined),
        // Stubs para BridgeAgentLike
        status: 'connected',
        sendMessage: vi.fn(),
        getStatusSnapshot: vi.fn().mockReturnValue({}),
        answerPendingQuestion: vi.fn(),
        _listeners: listeners,
        _fire(/** @type {string} */ event, /** @type {unknown} */ data) {
            for (const fn of listeners.get(event) ?? []) fn(data);
        },
    });
}

// ─── registerDialogListeners ──────────────────────────────────────────────────

describe('client-dialog › registerDialogListeners', () => {
    it('registra onReady, onReply, onStopped como listeners', () => {
        const agent = createMockAgent();
        const onReady = vi.fn();
        const onReply = vi.fn();
        const onStopped = vi.fn();

        registerDialogListeners(agent, { onReady, onReply, onStopped });

        expect(agent.once).toHaveBeenCalledWith('dialog.ready', onReady);
        expect(agent.on).toHaveBeenCalledWith('dialog.reply', expect.any(Function));
        expect(agent.once).toHaveBeenCalledWith('dialog.stopped', onStopped);
    });

    it('sem callbacks, não registra nada', () => {
        const agent = createMockAgent();
        registerDialogListeners(agent, {});

        expect(agent.once).not.toHaveBeenCalled();
        expect(agent.on).not.toHaveBeenCalled();
    });

    it('replyHandler extrai reply do evento e delega ao onReply', () => {
        const agent = createMockAgent();
        const onReply = vi.fn();
        const { replyHandler } = registerDialogListeners(agent, { onReply });

        expect(replyHandler).toBeTypeOf('function');
        replyHandler?.({ reply: 'hello' });
        expect(onReply).toHaveBeenCalledWith('hello');
    });

    it('replyHandler usa string vazia se reply ausente', () => {
        const agent = createMockAgent();
        const onReply = vi.fn();
        const { replyHandler } = registerDialogListeners(agent, { onReply });

        replyHandler?.({});
        expect(onReply).toHaveBeenCalledWith('');
    });

    it('cleanup remove todos os listeners registrados', () => {
        const agent = createMockAgent();
        const onReady = vi.fn();
        const onReply = vi.fn();
        const onStopped = vi.fn();

        const { cleanup } = registerDialogListeners(agent, { onReady, onReply, onStopped });
        cleanup();

        expect(agent.off).toHaveBeenCalledWith('dialog.ready', onReady);
        expect(agent.off).toHaveBeenCalledWith('dialog.reply', expect.any(Function));
        expect(agent.off).toHaveBeenCalledWith('dialog.stopped', onStopped);
    });

    it('retorna replyHandler null quando onReply não fornecido', () => {
        const agent = createMockAgent();
        const { replyHandler } = registerDialogListeners(agent, { onReady: vi.fn() });
        expect(replyHandler).toBeNull();
    });
});

// ─── startDialogMode ─────────────────────────────────────────────────────────

describe('client-dialog › startDialogMode', () => {
    it('chama agent.startDialogLoop com bootPrompt', async () => {
        const agent = createMockAgent();
        await startDialogMode(agent, 'custom prompt');
        expect(agent.startDialogLoop).toHaveBeenCalledWith('custom prompt');
    });

    it('chama agent.startDialogLoop sem bootPrompt', async () => {
        const agent = createMockAgent();
        await startDialogMode(agent);
        expect(agent.startDialogLoop).toHaveBeenCalledWith(undefined);
    });

    it('chama cleanup em caso de erro do startDialogLoop', async () => {
        const agent = createMockAgent();
        agent.startDialogLoop.mockRejectedValue(new Error('boot fail'));

        const onReady = vi.fn();
        await expect(startDialogMode(agent, undefined, { onReady })).rejects.toThrow('boot fail');

        // cleanup deve ter removido o listener
        expect(agent.off).toHaveBeenCalledWith('dialog.ready', onReady);
    });
});

// ─── dialogTurn ──────────────────────────────────────────────────────────────

describe('client-dialog › dialogTurn', () => {
    it('chama sendDialogTurn com message e timeout', async () => {
        const agent = createMockAgent();
        const reply = await dialogTurn(agent, 'hello', { timeout: 5000 });

        expect(agent.sendDialogTurn).toHaveBeenCalledWith('hello', { timeout: 5000 });
        expect(reply).toBe('reply text');
    });

    it('usa timeout padrão configurado quando não especificado', async () => {
        const agent = createMockAgent();
        await dialogTurn(agent, 'hello');
        expect(agent.sendDialogTurn).toHaveBeenCalledWith('hello', { timeout: LLM_B_TURN_TIMEOUT_MS });
    });

    it('registra e remove listener de onDelta', async () => {
        const agent = createMockAgent();
        const onDelta = vi.fn();
        await dialogTurn(agent, 'hello', { onDelta });

        // Deve ter registrado e depois removido
        expect(agent.on).toHaveBeenCalledWith('task.delta', expect.any(Function));
        expect(agent.off).toHaveBeenCalledWith('task.delta', expect.any(Function));
    });

    it('registra e remove listener de onReasoning', async () => {
        const agent = createMockAgent();
        const onReasoning = vi.fn();
        await dialogTurn(agent, 'hello', { onReasoning });

        expect(agent.on).toHaveBeenCalledWith('task.reasoning', expect.any(Function));
        expect(agent.off).toHaveBeenCalledWith('task.reasoning', expect.any(Function));
    });

    it('onDelta recebe chunks do evento task.delta', async () => {
        const agent = createMockAgent();
        const onDelta = vi.fn();

        // Make sendDialogTurn fire events before resolving
        agent.sendDialogTurn.mockImplementation(async () => {
            agent._fire('task.delta', { chunk: 'chunk1' });
            agent._fire('task.delta', { chunk: 'chunk2' });
            return 'done';
        });

        await dialogTurn(agent, 'hello', { onDelta });
        expect(onDelta).toHaveBeenCalledWith('chunk1');
        expect(onDelta).toHaveBeenCalledWith('chunk2');
    });

    it('onReasoning recebe chunks do evento task.reasoning', async () => {
        const agent = createMockAgent();
        const onReasoning = vi.fn();

        agent.sendDialogTurn.mockImplementation(async () => {
            agent._fire('task.reasoning', { chunk: 'think', reasoningId: 'r1' });
            return 'done';
        });

        await dialogTurn(agent, 'hello', { onReasoning });
        expect(onReasoning).toHaveBeenCalledWith('think', 'r1');
    });

    it('onReasoning usa null para reasoningId ausente', async () => {
        const agent = createMockAgent();
        const onReasoning = vi.fn();

        agent.sendDialogTurn.mockImplementation(async () => {
            agent._fire('task.reasoning', { chunk: 'think' });
            return 'done';
        });

        await dialogTurn(agent, 'hello', { onReasoning });
        expect(onReasoning).toHaveBeenCalledWith('think', null);
    });

    it('usa espelho de dialog.reply quando sendDialogTurn resolve string vazia', async () => {
        const agent = createMockAgent();

        agent.sendDialogTurn.mockImplementation(async () => {
            agent._fire('dialog.reply', { reply: 'reply via evento' });
            return '';
        });

        await expect(dialogTurn(agent, 'hello')).resolves.toBe('reply via evento');
        expect(agent.off).toHaveBeenCalledWith('dialog.reply', expect.any(Function));
    });

    it('encaminha onDelta também para dialog.delta no loop ativo', async () => {
        const agent = createMockAgent();
        const onDelta = vi.fn();

        agent.sendDialogTurn.mockImplementation(async () => {
            agent._fire('dialog.delta', { chunk: 'stream' });
            return 'done';
        });

        await dialogTurn(agent, 'hello', { onDelta });
        expect(onDelta).toHaveBeenCalledWith('stream');
    });

    it('suprime duplicata imediata quando task.delta e dialog.delta entregam o mesmo chunk', async () => {
        const agent = createMockAgent();
        const onDelta = vi.fn();

        agent.sendDialogTurn.mockImplementation(async () => {
            agent._fire('task.delta', { chunk: 'duplicado' });
            agent._fire('dialog.delta', { chunk: 'duplicado' });
            return 'done';
        });

        await dialogTurn(agent, 'hello', { onDelta });
        expect(onDelta).toHaveBeenCalledTimes(1);
        expect(onDelta).toHaveBeenCalledWith('duplicado');
    });

    it('remove listeners mesmo quando sendDialogTurn rejeita', async () => {
        const agent = createMockAgent();
        agent.sendDialogTurn.mockRejectedValue(new Error('fail'));

        await expect(dialogTurn(agent, 'hello', { onDelta: vi.fn() })).rejects.toThrow('fail');
        expect(agent.off).toHaveBeenCalledWith('task.delta', expect.any(Function));
    });
});

describe('client-dialog › dialogTurnDetailed', () => {
    it('retorna replySource=runtime_return quando o runtime devolve texto diretamente', async () => {
        const agent = createMockAgent();

        await expect(dialogTurnDetailed(agent, 'hello')).resolves.toEqual({
            reply: 'reply text',
            replySource: 'runtime_return',
            hadReplyEvent: false,
        });
    });

    it('retorna replySource=transport_mirror quando usa o espelho de transporte', async () => {
        const agent = createMockAgent();

        agent.sendDialogTurn.mockImplementation(async () => {
            agent._fire('dialog.reply', { reply: 'reply via evento' });
            return '';
        });

        await expect(dialogTurnDetailed(agent, 'hello')).resolves.toEqual({
            reply: 'reply via evento',
            replySource: 'transport_mirror',
            hadReplyEvent: true,
        });
    });

    it('retorna replySource=empty quando nenhum conteúdo textual foi materializado', async () => {
        const agent = createMockAgent();
        agent.sendDialogTurn.mockResolvedValue('');

        await expect(dialogTurnDetailed(agent, 'hello')).resolves.toEqual({
            reply: '',
            replySource: 'empty',
            hadReplyEvent: false,
        });
    });
});

// ─── stopDialogMode ──────────────────────────────────────────────────────────

describe('client-dialog › stopDialogMode', () => {
    it('chama stopDialogLoop com authorized:true e reason', async () => {
        const agent = createMockAgent();
        await stopDialogMode(agent, 'authorized_stop');
        expect(agent.stopDialogLoop).toHaveBeenCalledWith({
            authorized: true,
            reason: 'authorized_stop',
        });
    });

    it('usa reason padrão watchdog_restart', async () => {
        const agent = createMockAgent();
        await stopDialogMode(agent);
        expect(agent.stopDialogLoop).toHaveBeenCalledWith({
            authorized: true,
            reason: 'watchdog_restart',
        });
    });
});
