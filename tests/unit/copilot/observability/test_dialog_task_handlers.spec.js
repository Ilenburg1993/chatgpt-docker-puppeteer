// @ts-check
/**
 * tests/unit/copilot/observability/test_dialog_task_handlers.spec.js
 *
 * Testes para src/copilot/observability/observers/dialog-task-handlers.js.
 *
 * F212: Mock event bus, test dialog/task/tool handlers via ObserverContext.
 */

import { EventEmitter } from 'node:events';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('#copilot/core/errors', () => ({
    CopilotError: class CopilotError extends Error {
        constructor(/** @type {string} */ msg, /** @type {any} */ opts = {}) {
            super(msg);
            this.name = 'CopilotError';
            this.code = opts.code ?? 'UNKNOWN';
        }
    },
    TimeoutError: class TimeoutError extends Error {
        constructor(/** @type {string} */ msg) {
            super(msg);
            this.name = 'TimeoutError';
        }
    },
}));

vi.mock('#copilot/sdk/models', () => ({
    modelStatsTracker: { record: vi.fn() },
    SYSTEM_MESSAGE_SECTIONS: {},
    SYSTEM_PROMPT_SECTIONS: {},
}));

vi.mock('../../../../src/copilot/observability/logger.js', () => ({
    log: vi.fn(),
}));

vi.mock('../../../../src/copilot/observability/otel.js', () => ({
    startSpanImmediate: vi.fn(() => null),
}));

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('dialog-task-handlers', () => {
    /** @type {EventEmitter} */
    let agent;
    /** @type {Record<string, any>} */
    let metrics;
    /** @type {Record<string, any>} */
    let errorTracker;
    /** @type {{ record: import('vitest').Mock }} */
    let modelStatsTracker;
    /**
     * @type {ReturnType<
     *     typeof import('../../../../src/copilot/observability/observers/dialog-task-handlers.js').attachDialogTaskHandlers
     * >}
     */
    let accessors;

    /** @type {typeof import('../../../../src/copilot/observability/observers/dialog-task-handlers.js')} */
    let handlersMod;

    beforeAll(async () => {
        handlersMod = await import('../../../../src/copilot/observability/observers/dialog-task-handlers.js');
    });

    beforeEach(() => {
        agent = new EventEmitter();
        metrics = {
            recordDialogTurn: vi.fn(),
            recordDialogStall: vi.fn(),
            recordDialogTimeout: vi.fn(),
            recordTaskCompletion: vi.fn(),
            recordToolCall: vi.fn(),
            recordStreamingChunk: vi.fn(),
            recordSessionError: vi.fn(),
            recordCounter: vi.fn(),
            recordGauge: vi.fn(),
        };
        errorTracker = { trackError: vi.fn() };
        modelStatsTracker = { record: vi.fn() };

        const ctx = {
            metrics,
            errorTracker,
            modelStatsTracker,
            agent,
            on: (/** @type {EventEmitter} */ emitter, /** @type {string} */ event, /** @type {Function} */ fn) => {
                emitter.on(event, /** @type {any} */ (fn));
            },
            safe: (/** @type {Function} */ fn, /** @type {string} */ _context) => /** @type {any} */ (fn),
        };
        accessors = handlersMod.attachDialogTaskHandlers(/** @type {any} */ (ctx));
    });

    // ── dialog.turn_start + turn_end ──────────────────────────────────────

    describe('dialog.turn_start / turn_end', () => {
        it('registra turn completo com duração e sucesso', () => {
            agent.emit('dialog.turn_start', { turnId: 'T1' });
            agent.emit('dialog.turn_end', { turnId: 'T1', durationMs: 500, reply: 'Ok' });
            expect(metrics.recordDialogTurn).toHaveBeenCalledWith(500, true);
        });

        it('registra turn sem reply como falha', () => {
            agent.emit('dialog.turn_start', { turnId: 'T2' });
            agent.emit('dialog.turn_end', { turnId: 'T2', durationMs: 200, reply: '' });
            expect(metrics.recordDialogTurn).toHaveBeenCalledWith(200, false);
        });

        it('expõe lastTurnDurationMs e lastTurnSuccess', () => {
            agent.emit('dialog.turn_start', { turnId: 'T3' });
            agent.emit('dialog.turn_end', { turnId: 'T3', durationMs: 750, reply: 'done' });
            expect(accessors.lastTurnDurationMs()).toBe(750);
            expect(accessors.lastTurnSuccess()).toBe(true);
        });

        it('usa fallback turnId "current" quando turnId ausente', () => {
            agent.emit('dialog.turn_start', {});
            agent.emit('dialog.turn_end', { durationMs: 100, reply: 'r' });
            expect(metrics.recordDialogTurn).toHaveBeenCalledWith(100, true);
        });
    });

    // ── dialog.stalled ────────────────────────────────────────────────────

    describe('dialog.stalled', () => {
        it('registra stall com stalledMs', () => {
            agent.emit('dialog.stalled', { stalledMs: 3000 });
            expect(metrics.recordDialogStall).toHaveBeenCalledWith(3000);
            expect(metrics.recordCounter).toHaveBeenCalledWith('dialog.stalls');
        });

        it('usa 0 quando stalledMs ausente', () => {
            agent.emit('dialog.stalled', {});
            expect(metrics.recordDialogStall).toHaveBeenCalledWith(0);
        });
    });

    // ── dialog.turn_timeout ───────────────────────────────────────────────

    describe('dialog.turn_timeout', () => {
        it('registra timeout com phase e notifica errorTracker', () => {
            agent.emit('dialog.turn_timeout', { phase: 'boot', timeoutMs: 30000 });
            expect(metrics.recordDialogTimeout).toHaveBeenCalled();
            expect(metrics.recordCounter).toHaveBeenCalledWith('dialog.timeout.boot');
            expect(errorTracker.trackError).toHaveBeenCalled();
        });

        it('usa phase "unknown" quando ausente', () => {
            agent.emit('dialog.turn_timeout', {});
            expect(metrics.recordCounter).toHaveBeenCalledWith('dialog.timeout.unknown');
        });
    });

    // ── dialog.loop.changed ───────────────────────────────────────────────

    describe('dialog.loop.changed', () => {
        it('registra ativação do loop', () => {
            agent.emit('dialog.loop.changed', { active: true });
            expect(metrics.recordCounter).toHaveBeenCalledWith('dialog.loop.activated');
            expect(metrics.recordGauge).toHaveBeenCalledWith('dialog.loop.active', 1);
        });

        it('registra desativação do loop', () => {
            agent.emit('dialog.loop.changed', { active: false });
            expect(metrics.recordCounter).toHaveBeenCalledWith('dialog.loop.deactivated');
            expect(metrics.recordGauge).toHaveBeenCalledWith('dialog.loop.active', 0);
        });
    });

    // ── dialog simple events ──────────────────────────────────────────────

    describe('dialog simple events', () => {
        it.each(['dialog.ready', 'dialog.paused', 'dialog.resumed'])('%s registra counter', (evt) => {
            agent.emit(evt);
            expect(metrics.recordCounter).toHaveBeenCalledWith(evt);
        });

        it('dialog.reply registra counter', () => {
            agent.emit('dialog.reply', { reply: 'Hello', turnId: '1' });
            expect(metrics.recordCounter).toHaveBeenCalledWith('dialog.reply');
        });

        it('dialog.stopped registra counter com reason', () => {
            agent.emit('dialog.stopped', { reason: 'user_cancel' });
            expect(metrics.recordCounter).toHaveBeenCalledWith('dialog.stopped');
            expect(metrics.recordCounter).toHaveBeenCalledWith('dialog.stopped.user_cancel');
        });
    });

    // ── task.completed ────────────────────────────────────────────────────

    describe('task.completed', () => {
        it('registra task com sucesso', () => {
            agent.emit('task.completed', { taskId: 'TK1', durationMs: 1500 });
            expect(metrics.recordTaskCompletion).toHaveBeenCalledWith(1500, true);
            expect(metrics.recordCounter).toHaveBeenCalledWith('tasks.completed');
        });

        it('usa durationMs 0 quando ausente', () => {
            agent.emit('task.completed', {});
            expect(metrics.recordTaskCompletion).toHaveBeenCalledWith(0, true);
        });
    });

    // ── task.error ────────────────────────────────────────────────────────

    describe('task.error', () => {
        it('registra task com falha e notifica errorTracker', () => {
            const err = new Error('fail');
            agent.emit('task.error', { taskId: 'TK2', durationMs: 300, error: err });
            expect(metrics.recordTaskCompletion).toHaveBeenCalledWith(300, false);
            expect(metrics.recordCounter).toHaveBeenCalledWith('tasks.errors');
            expect(metrics.recordSessionError).toHaveBeenCalled();
            expect(errorTracker.trackError).toHaveBeenCalled();
        });
    });

    // ── task.queued / task.started ─────────────────────────────────────────

    describe('task.queued / task.started', () => {
        it('task.queued registra counter', () => {
            agent.emit('task.queued', { taskId: 'q-1' });
            expect(metrics.recordCounter).toHaveBeenCalledWith('tasks.queued');
        });

        it('task.started registra counter', () => {
            agent.emit('task.started', { taskId: 's-1' });
            expect(metrics.recordCounter).toHaveBeenCalledWith('tasks.started');
        });
    });

    // ── task.delta ────────────────────────────────────────────────────────

    describe('task.delta', () => {
        it('registra streaming delta counter e bytes', () => {
            agent.emit('task.delta', { delta: 'abc', taskId: '1' });
            expect(metrics.recordCounter).toHaveBeenCalledWith('task.streaming.deltas');
            expect(metrics.recordCounter).toHaveBeenCalledWith('task.streaming.bytes', 3);
        });
    });

    // ── task.reasoning ────────────────────────────────────────────────────

    describe('task.reasoning', () => {
        it('registra reasoning chunk counter', () => {
            agent.emit('task.reasoning', { text: 'reason text' });
            expect(metrics.recordCounter).toHaveBeenCalledWith('task.reasoning.chunks');
            expect(metrics.recordCounter).toHaveBeenCalledWith('task.reasoning.bytes', 11);
        });
    });

    // ── tool.execution_start + complete ───────────────────────────────────

    describe('tool.execution_start / complete', () => {
        it('registra start e complete com duração', () => {
            agent.emit('tool.execution_start', { toolName: 'read_file', callId: 'C1' });
            agent.emit('tool.execution_complete', {
                toolName: 'read_file',
                callId: 'C1',
                durationMs: 120,
                success: true,
            });
            expect(metrics.recordCounter).toHaveBeenCalledWith('tool.execution.start');
            expect(metrics.recordCounter).toHaveBeenCalledWith('tool.execution.complete');
            expect(metrics.recordToolCall).not.toHaveBeenCalled();
        });

        it('registra tool.execution_progress', () => {
            agent.emit('tool.execution_progress', { toolName: 'web_fetch', progress: 50 });
            expect(metrics.recordCounter).toHaveBeenCalledWith('tool.execution.progress');
        });
    });

    // ── pr.fallback_model / pr.consumed ───────────────────────────────────

    describe('pr events', () => {
        it('pr.fallback_model registra counter', () => {
            agent.emit('pr.fallback_model', { from: 'gpt-4o', to: 'gpt-4o-mini' });
            expect(metrics.recordCounter).toHaveBeenCalledWith('model.fallback');
        });

        it('pr.consumed registra counter', () => {
            agent.emit('pr.consumed', { tokens: 100, model: 'gpt-4o' });
            expect(metrics.recordCounter).toHaveBeenCalledWith('pr.consumed');
        });
    });

    // ── session.usage ─────────────────────────────────────────────────────

    describe('session.usage', () => {
        it('registra session.usage counter e chama modelStatsTracker injetado', async () => {
            agent.emit('session.usage', { model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
            expect(metrics.recordCounter).toHaveBeenCalledWith('session.usage');
            expect(modelStatsTracker.record).toHaveBeenCalledWith(
                'gpt-4o',
                expect.objectContaining({
                    inputTokens: 100,
                    outputTokens: 50,
                }),
            );
        });
    });

    // ── resetChunkTs ──────────────────────────────────────────────────────

    describe('resetChunkTs', () => {
        it('reseta chunk timestamp', () => {
            // resetChunkTs é exposto e não lança
            expect(() => accessors.resetChunkTs()).not.toThrow();
        });
    });
});
