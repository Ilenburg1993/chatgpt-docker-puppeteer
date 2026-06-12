// @ts-check

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createDialogTurnOutputCollector } from '../../../src/copilot/agent/dialog/seams/turn-output-collector.js';

/**
 * @param {EventEmitter & {
 *     pending?: { kind: 'reply' | 'ready' | 'stopped'; question: string; reply?: string } | null;
 * }} host
 */
function createCollector(host) {
    return createDialogTurnOutputCollector(host, {
        normalizeAssistantMessageEvent: (/** @type {any} */ evt) => ({
            content: typeof evt?.content === 'string' ? evt.content : '',
            ts: null,
        }),
        normalizeAssistantReplyCandidate: (content) => content.trim() || null,
        readPendingProtocolSnapshot: (candidate) => candidate.pending ?? null,
    });
}

describe('dialog turn output collector', () => {
    it('preserva diagnóstico de assistant.message após resolver o reply', () => {
        const host = Object.assign(new EventEmitter(), { pending: null });
        const collector = createCollector(host);
        const resolve = vi.fn();
        const finalize = vi.fn();

        collector.markDispatched();
        host.emit('assistant.message', { content: 'resposta final' });

        expect(collector.tryResolve(10, resolve, finalize)).toBe(true);
        expect(resolve).toHaveBeenCalledWith('resposta final');
        expect(collector.snapshot()).toEqual(
            expect.objectContaining({
                assistantMessageCount: 1,
                lastResolutionSource: 'assistant.message',
            }),
        );
        collector.cleanup();
    });

    it('marca delta anterior à última tool como inelegível sem perder os sinais observados', () => {
        const host = Object.assign(new EventEmitter(), { pending: null });
        const collector = createCollector(host);

        collector.markDispatched();
        host.emit('dialog.delta', { chunk: 'rascunho antes da tool' });
        host.emit('tool.execution_start', { toolName: 'exec_command' });

        expect(collector.tryResolve(10, vi.fn(), vi.fn())).toBe(false);
        expect(collector.snapshot()).toEqual(
            expect.objectContaining({
                deltaChars: 'rascunho antes da tool'.length,
                deltaEligible: false,
                toolSignalCount: 1,
            }),
        );
        collector.cleanup();
    });

    it('expõe transição de protocolo mesmo sem reply público', () => {
        const host = Object.assign(new EventEmitter(), {
            pending: { kind: /** @type {'ready'} */ ('ready'), question: 'READY?' },
        });
        const collector = createCollector(host);

        collector.markDispatched();

        expect(collector.snapshot()).toEqual(
            expect.objectContaining({
                pendingProtocolKind: 'ready',
                pendingProtocolReply: null,
            }),
        );
        collector.cleanup();
    });
});
