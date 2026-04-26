// @ts-check
/**
 * tests/unit/copilot/observability/test_session_handlers.spec.js
 *
 * Testes para src/copilot/observability/collectors/session-handlers.js.
 *
 * F214: Mock session events, test metrics recording, persistência, compaction.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../../../src/copilot/observability/logger.js', () => ({
    log: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Cria uma sessão mock que suporta `.on(eventType, handler)` estilo SDK. Retorna a sessão e um método `fire(type,
 * data)` para simular eventos.
 */
function createMockSession() {
    /** @type {Map<string, Function>} */
    const handlers = new Map();

    const session = {
        /**
         * @param {string} type
         * @param {Function} handler
         * @returns {() => void}
         */
        on(type, handler) {
            handlers.set(type, handler);
            return () => handlers.delete(type);
        },
    };

    /**
     * @param {string} type
     * @param {Record<string, any>} [data]
     */
    function fire(type, data = {}) {
        const h = handlers.get(type);
        if (h) h({ type, timestamp: Date.now(), data });
    }

    return { session, fire };
}

function createMockCtx(/** @type {ReturnType<typeof createMockSession>} */ { session }) {
    return {
        session: /** @type {any} */ (session),
        sessionId: 'test-session-1',
        metrics: {
            recordSessionStart: vi.fn(),
            recordSessionError: vi.fn(),
            recordCounter: vi.fn(),
        },
        errorTracker: { trackError: vi.fn() },
        hookBus: null,
        persist: true,
        persistSet: new Set([
            'session.error',
            'session.usage_info',
            'session.truncation',
            'session.start',
            'session.resume',
            'session.context_changed',
            'session.handoff',
            'session.skills_loaded',
            'session.extensions_loaded',
            'session.mcp_server_status_changed',
            'session.info',
            'session.workspace_file_changed',
            'session.snapshot_rewind',
            'session.idle',
        ]),
        persistEvent: vi.fn(),
        captureUserContent: false,
        captureAssistantContent: false,
        pending: new Map(),
        turnStart: new Map(),
    };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('session-handlers', () => {
    /** @type {ReturnType<typeof createMockSession>} */
    let mock;
    /** @type {ReturnType<typeof createMockCtx>} */
    let ctx;
    /** @type {(() => void)[]} */
    let unsubs;

    beforeEach(async () => {
        mock = createMockSession();
        ctx = createMockCtx(mock);
        const mod = await import('../../../../src/copilot/observability/collectors/session-handlers.js');
        unsubs = mod.attachSessionHandlers(/** @type {any} */ (ctx));
    });

    // ── retorna unsubscribers ─────────────────────────────────────────────

    it('retorna array de unsubscribers', () => {
        expect(Array.isArray(unsubs)).toBe(true);
        expect(unsubs.length).toBeGreaterThan(10);
        unsubs.forEach((u) => expect(typeof u).toBe('function'));
    });

    // ── session.error ─────────────────────────────────────────────────────

    describe('session.error', () => {
        it('registra erro no errorTracker e métricas', () => {
            mock.fire('session.error', { errorType: 'auth', message: 'Unauthorized' });
            expect(ctx.errorTracker.trackError).toHaveBeenCalled();
            expect(ctx.metrics.recordSessionError).toHaveBeenCalled();
            expect(ctx.persistEvent).toHaveBeenCalled();
        });
    });

    // ── session.start ─────────────────────────────────────────────────────

    describe('session.start', () => {
        it('registra session start e modelo', () => {
            mock.fire('session.start', {
                sessionId: 'sdk-1',
                copilotVersion: '1.0',
                selectedModel: 'gpt-4o',
                reasoningEffort: 'high',
                context: { branch: 'main' },
            });
            expect(ctx.metrics.recordSessionStart).toHaveBeenCalled();
            expect(ctx.metrics.recordCounter).toHaveBeenCalledWith('model.gpt-4o');
            expect(ctx.persistEvent).toHaveBeenCalled();
        });
    });

    // ── session.resume ────────────────────────────────────────────────────

    describe('session.resume', () => {
        it('registra resume counter', () => {
            mock.fire('session.resume', {
                eventCount: 10,
                selectedModel: 'gpt-4o',
                reasoningEffort: 'medium',
                context: {},
                alreadyInUse: false,
            });
            expect(ctx.metrics.recordCounter).toHaveBeenCalledWith('session.resumed');
            expect(ctx.persistEvent).toHaveBeenCalled();
        });

        it('registra already_in_use quando true', () => {
            mock.fire('session.resume', {
                eventCount: 5,
                selectedModel: 'gpt-4o',
                context: {},
                alreadyInUse: true,
            });
            expect(ctx.metrics.recordCounter).toHaveBeenCalledWith('session.already_in_use');
        });
    });

    // ── session.compaction_start / complete ───────────────────────────────

    describe('session.compaction', () => {
        it('persiste compaction_start', () => {
            mock.fire('session.compaction_start', {});
            expect(ctx.persistEvent).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'session.compaction_start' }),
            );
        });

        it('persiste compaction_complete com data', () => {
            mock.fire('session.compaction_complete', { summary: 'ok' });
            expect(ctx.persistEvent).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'session.compaction_complete' }),
            );
        });
    });

    // ── session.context_changed ───────────────────────────────────────────

    describe('session.context_changed', () => {
        it('persiste mudança de contexto', () => {
            mock.fire('session.context_changed', { branch: 'dev', repository: 'repo', cwd: '/app' });
            expect(ctx.persistEvent).toHaveBeenCalledWith(
                expect.objectContaining({ branch: 'dev', repository: 'repo' }),
            );
        });
    });

    // ── session.handoff ───────────────────────────────────────────────────

    describe('session.handoff', () => {
        it('registra handoff counter com sourceType', () => {
            mock.fire('session.handoff', {
                handoffTime: Date.now(),
                sourceType: 'vscode',
                summary: 'handoff summary',
                remoteSessionId: 'remote-1',
            });
            expect(ctx.metrics.recordCounter).toHaveBeenCalledWith('session.handoff');
            expect(ctx.metrics.recordCounter).toHaveBeenCalledWith('session.handoff.source.vscode');
        });
    });

    // ── session.skills_loaded ─────────────────────────────────────────────

    describe('session.skills_loaded', () => {
        it('registra skills loaded com contagem', () => {
            mock.fire('session.skills_loaded', {
                skills: [
                    { name: 's1', enabled: true, source: 'local' },
                    { name: 's2', enabled: false, source: 'remote' },
                ],
            });
            expect(ctx.metrics.recordCounter).toHaveBeenCalledWith('session.skills_loaded');
            expect(ctx.metrics.recordCounter).toHaveBeenCalledWith('skills.enabled', 1);
        });
    });

    // ── session.extensions_loaded ─────────────────────────────────────────

    describe('session.extensions_loaded', () => {
        it('persiste extensions loaded', () => {
            mock.fire('session.extensions_loaded', {
                extensions: [
                    { id: 'ext1', status: 'running' },
                    { id: 'ext2', status: 'stopped' },
                ],
            });
            expect(ctx.persistEvent).toHaveBeenCalled();
        });
    });

    // ── session.mcp_server_status_changed ─────────────────────────────────

    describe('session.mcp_server_status_changed', () => {
        it('registra MCP connected', () => {
            mock.fire('session.mcp_server_status_changed', { serverName: 'github', status: 'connected' });
            expect(ctx.metrics.recordCounter).toHaveBeenCalledWith('mcp.server.status.connected');
            expect(ctx.metrics.recordCounter).toHaveBeenCalledWith('mcp.server.connected');
        });

        it('registra MCP failed', () => {
            mock.fire('session.mcp_server_status_changed', { serverName: 'broken', status: 'failed' });
            expect(ctx.metrics.recordCounter).toHaveBeenCalledWith('mcp.server.failed');
        });
    });

    // ── session.title_changed ─────────────────────────────────────────────

    describe('session.title_changed', () => {
        it('registra counter e persiste título', () => {
            mock.fire('session.title_changed', { title: 'New Title' });
            expect(ctx.metrics.recordCounter).toHaveBeenCalledWith('session.title_changed');
            expect(ctx.persistEvent).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Title' }));
        });
    });

    // ── session.workspace_file_changed ────────────────────────────────────

    describe('session.workspace_file_changed', () => {
        it('registra counter com operation', () => {
            mock.fire('session.workspace_file_changed', { path: '/src/test.js', operation: 'modified' });
            expect(ctx.metrics.recordCounter).toHaveBeenCalledWith('session.workspace_file_changed.modified');
        });
    });

    // ── session.info ──────────────────────────────────────────────────────

    describe('session.info', () => {
        it('registra counter e persiste info', () => {
            mock.fire('session.info', { infoType: 'model', message: 'Model loaded' });
            expect(ctx.metrics.recordCounter).toHaveBeenCalledWith('session.info');
            expect(ctx.persistEvent).toHaveBeenCalled();
        });
    });

    // ── session simple persistence ────────────────────────────────────────

    describe('session persistence events', () => {
        it.each([
            'session.usage_info',
            'session.truncation',
            'session.tools_updated',
            'session.mcp_servers_loaded',
            'session.mode_changed',
            'session.model_change',
            'session.warning',
            'session.shutdown',
            'session.task_complete',
        ])('%s persiste evento', (eventType) => {
            mock.fire(eventType, {});
            // Todos estes devem chamar persistEvent quando persist=true
            expect(ctx.persistEvent).toHaveBeenCalled();
        });
    });

    // ── unsubscribe cleanup ───────────────────────────────────────────────

    describe('cleanup', () => {
        it('unsubscribers funcionam sem erro', () => {
            unsubs.forEach((u) => {
                expect(() => u()).not.toThrow();
            });
        });
    });
});
