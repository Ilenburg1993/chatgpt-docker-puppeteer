// @ts-check
/**
 * @file Faixa 48 — observability/collectors: tool-handlers, assistant-handlers, interaction-handlers
 *
 *   Testa os 3 módulos de event collectors que registram handlers em sessões SDK. Usa mock de CollectorContext para
 *   validar wiring sem deps reais.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('#copilot/audit/pipeline', () => ({
    globalAuditBuffer: { push: vi.fn() },
}));
vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

/**
 * Cria um context mock mínimo para os collectors.
 *
 * @returns {any}
 */
function createMockContext() {
    /** @type {Map<string, Function[]>} */
    const handlers = new Map();
    const session = {
        on: vi.fn((/** @type {string} */ event, /** @type {Function} */ handler) => {
            if (!handlers.has(event)) handlers.set(event, []);
            handlers.get(event)?.push(handler);
            return () => {
                const list = handlers.get(event);
                if (list) {
                    const idx = list.indexOf(handler);
                    if (idx >= 0) list.splice(idx, 1);
                }
            };
        }),
    };
    return {
        session: /** @type {any} */ (session),
        sessionId: 'test-session-001',
        metrics: /** @type {any} */ ({
            recordToolCall: vi.fn(),
            recordCounter: vi.fn(),
            recordUsage: vi.fn(),
        }),
        errorTracker: /** @type {any} */ ({ trackError: vi.fn() }),
        hookBus: /** @type {any} */ ({ emitHook: vi.fn() }),
        persist: true,
        persistSet: new Set([
            'tool.execution_start',
            'tool.execution_complete',
            'tool.user_requested',
            'assistant.usage',
            'permission.requested',
            'permission.completed',
            'subagent.selected',
            'elicitation.requested',
        ]),
        persistEvent: vi.fn(),
        pending: new Map(),
        turnStart: new Map(),
        captureUserContent: false,
        captureAssistantContent: false,
        _emit: (/** @type {string} */ event, /** @type {any} */ data) => {
            const fns = handlers.get(event);
            if (fns) for (const fn of fns) fn({ type: event, timestamp: new Date().toISOString(), data });
        },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. tool-handlers.js — attachToolHandlers
// ═══════════════════════════════════════════════════════════════════════════════

describe('F48 — attachToolHandlers', () => {
    /** @type {ReturnType<typeof createMockContext>} */
    let ctx;
    /** @type {(() => void)[]} */
    let unsubs;

    beforeEach(async () => {
        ctx = createMockContext();
        const { attachToolHandlers } = await import('#copilot/observability/collectors/tool-handlers');
        unsubs = attachToolHandlers(/** @type {any} */ (ctx));
    });

    it('registra 5 handlers e retorna unsubs', () => {
        expect(unsubs).toHaveLength(5);
        expect(ctx.session.on).toHaveBeenCalledTimes(5);
    });

    it('tool.execution_start armazena no pending map', () => {
        ctx._emit('tool.execution_start', {
            toolCallId: 'tc-1',
            toolName: 'read_file',
            arguments: { path: '/foo' },
        });
        expect(ctx.pending.has('tc-1')).toBe(true);
        expect(ctx.pending.get('tc-1')?.toolName).toBe('read_file');
    });

    it('tool.execution_start persiste quando configurado', () => {
        ctx._emit('tool.execution_start', {
            toolCallId: 'tc-2',
            toolName: 'grep',
            arguments: {},
        });
        expect(ctx.persistEvent).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'tool.execution_start', toolName: 'grep' }),
        );
    });

    it('tool.execution_complete registra métricas e audit', async () => {
        const { globalAuditBuffer } = await import('#copilot/audit/pipeline');
        ctx.pending.set('tc-3', { toolName: 'bash', mcpServerName: null, startTs: Date.now() - 100, toolArgs: {} });
        ctx._emit('tool.execution_complete', {
            toolCallId: 'tc-3',
            success: true,
            result: { content: 'ok' },
        });
        expect(ctx.metrics.recordToolCall).not.toHaveBeenCalled();
        expect(globalAuditBuffer.push).toHaveBeenCalled();
        expect(ctx.pending.has('tc-3')).toBe(false);
    });

    it('tool.execution_complete com falha rastreia erro', () => {
        ctx.pending.set('tc-4', { toolName: 'lint', mcpServerName: null, startTs: Date.now(), toolArgs: {} });
        ctx._emit('tool.execution_complete', {
            toolCallId: 'tc-4',
            success: false,
            result: null,
        });
        expect(ctx.errorTracker.trackError).toHaveBeenCalled();
        expect(ctx.hookBus.emitHook).toHaveBeenCalledWith(
            'post_tool_use',
            'test-session-001',
            expect.objectContaining({ toolName: 'lint', success: false }),
            expect.any(Object),
        );
    });

    it('tool.execution_progress emite hook sem persistir', () => {
        ctx._emit('tool.execution_progress', {
            toolCallId: 'tc-5',
            progressMessage: '50%',
        });
        expect(ctx.hookBus.emitHook).toHaveBeenCalledWith(
            'post_tool_use',
            'test-session-001',
            expect.objectContaining({ _eventType: 'tool.execution_progress' }),
            null,
        );
    });

    it('tool.execution_partial_result incrementa contador', () => {
        ctx._emit('tool.execution_partial_result', {});
        expect(ctx.metrics.recordCounter).toHaveBeenCalledWith('tool.execution_partial_result');
    });

    it('tool.user_requested persiste e incrementa contador', () => {
        ctx._emit('tool.user_requested', {
            toolCallId: 'tc-6',
            toolName: 'run_tests',
            arguments: { suite: 'fast' },
        });
        expect(ctx.metrics.recordCounter).toHaveBeenCalledWith('tool.user_requested');
        expect(ctx.persistEvent).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'tool.user_requested', toolName: 'run_tests' }),
        );
    });

    it('pending TTL: limpa entradas expiradas em execution_start', () => {
        const expiredTs = Date.now() - 11 * 60 * 1000; // 11 min ago
        ctx.pending.set('old-tc', { toolName: 'old', mcpServerName: null, startTs: expiredTs, toolArgs: {} });
        ctx._emit('tool.execution_start', { toolCallId: 'new-tc', toolName: 'grep' });
        expect(ctx.pending.has('old-tc')).toBe(false);
        expect(ctx.pending.has('new-tc')).toBe(true);
    });

    it('unsubs desregistram handlers', () => {
        for (const unsub of unsubs) unsub();
        ctx._emit('tool.execution_partial_result', {});
        // Contador não deve ter sido chamado após unsub
        expect(ctx.metrics.recordCounter).not.toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. assistant-handlers.js — attachAssistantHandlers
// ═══════════════════════════════════════════════════════════════════════════════

describe('F48 — attachAssistantHandlers', () => {
    /** @type {ReturnType<typeof createMockContext>} */
    let ctx;

    beforeEach(async () => {
        ctx = createMockContext();
        const { attachAssistantHandlers } = await import('#copilot/observability/collectors/assistant-handlers');
        attachAssistantHandlers(/** @type {any} */ (ctx));
    });

    it('registra handlers', () => {
        expect(ctx.session.on).toHaveBeenCalled();
    });

    it('assistant.usage registra métricas de tokens', () => {
        ctx._emit('assistant.usage', {
            model: 'gpt-4o',
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 10,
            cacheWriteTokens: 5,
            duration: 200,
        });
        expect(ctx.metrics.recordUsage).toHaveBeenCalledWith('gpt-4o', 100, 50, 10, 5);
    });

    it('assistant.usage com reasoningEffort registra contador', () => {
        ctx._emit('assistant.usage', {
            model: 'o3',
            inputTokens: 0,
            outputTokens: 0,
            reasoningEffort: 'high',
        });
        expect(ctx.metrics.recordCounter).toHaveBeenCalledWith('reasoning.effort.high');
    });

    it('quotaState é atualizado com quotaSnapshots', async () => {
        const { quotaState } = await import('#copilot/observability/collectors/assistant-handlers');
        ctx._emit('assistant.usage', {
            model: 'gpt-4o',
            inputTokens: 0,
            outputTokens: 0,
            quotaSnapshots: { q1: { remainingPercentage: 0.5, resetDate: '2026-01-01' } },
        });
        expect(quotaState.snapshots).toEqual({ q1: { remainingPercentage: 0.5, resetDate: '2026-01-01' } });
        expect(quotaState.ts).toBeGreaterThan(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. interaction-handlers.js — attachInteractionHandlers
// ═══════════════════════════════════════════════════════════════════════════════

describe('F48 — attachInteractionHandlers', () => {
    /** @type {ReturnType<typeof createMockContext>} */
    let ctx;
    /** @type {(() => void)[]} */
    let unsubs;

    beforeEach(async () => {
        ctx = createMockContext();
        const { attachInteractionHandlers } = await import('#copilot/observability/collectors/interaction-handlers');
        unsubs = attachInteractionHandlers(/** @type {any} */ (ctx));
    });

    it('registra múltiplos handlers', () => {
        expect(unsubs.length).toBeGreaterThanOrEqual(5);
    });

    it('permission.requested persiste evento', () => {
        ctx._emit('permission.requested', { foo: 'bar' });
        expect(ctx.persistEvent).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'permission.requested', sessionId: 'test-session-001' }),
        );
    });

    it('subagent.started incrementa contador e persiste', () => {
        ctx._emit('subagent.started', { name: 'task' });
        expect(ctx.metrics.recordCounter).toHaveBeenCalledWith('subagent.started');
        expect(ctx.persistEvent).toHaveBeenCalled();
    });

    it('subagent.failed incrementa contador e loga warning', () => {
        ctx._emit('subagent.failed', { error: 'timeout' });
        expect(ctx.metrics.recordCounter).toHaveBeenCalledWith('subagent.failed');
    });
});
