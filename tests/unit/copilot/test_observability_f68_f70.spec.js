/**
 * tests/unit/copilot/test_observability_f68_f70.spec.js
 *
 * Testes para F68 (OTEL spans), F69 (async FS), F70 (metrics + cleanup paralelo).
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('#copilot/config/env', () => ({
    getCopilotFallbackModel: vi.fn(() => 'gpt-4o-mini'),
    COPILOT_LOG_DIR: '',
    COPILOT_MODEL: 'gpt-4o',
    AGENT_HOOK_CONTEXT_MAX_BYTES: 4096,
    AGENT_KEEPALIVE_IDLE_MS: 300000,
    AGENT_KEEPALIVE_MS: 60000,
    AGENT_MAX_LISTENERS: 50,
    AGENT_MAX_SNAPSHOTS: 10,
    AGENT_MAX_TASK_RETRIES: 3,
    AGENT_MCP_RECONNECT_MS: 5000,
    AGENT_MESSAGES_CACHE_TTL_MS: 60000,
    AGENT_METRICS_INTERVAL_MS: 30000,
    AGENT_PERMISSION_MODE: 'auto',
    AGENT_ROTATION_MAX_AGE_MS: 3600000,
    AGENT_ROTATION_MAX_COMPACTIONS: 5,
    AGENT_ROTATION_MAX_TURNS: 100,
    AGENT_ROTATION_MAX_UTIL: 0.9,
    AGENT_SESSION_MAX_AGE_MS: 86400000,
    AGENT_SNAPSHOT_DIR: '',
    AGENT_STARVATION_THRESHOLD_MS: 300000,
    AGENT_STATE_FILE: '/tmp/test-state-obs.json',
    AGENT_STATUS_SNAPSHOT_TTL_MS: 60000,
    AGENT_TASK_TIMEOUT_MS: 300000,
    AGENT_TOOL_AUDIT_MAX_LOG_BYTES: 4096,
    COPILOT_AUDIT_LOG_PATH: '/tmp/audit.log',
    COPILOT_REASONING_EFFORT: 'medium',
    COPILOT_RESTART_DELAY_MS: 5000,
    COPILOT_TOOL_PERMISSIONS_LOG: '',
    COPILOT_WORKING_DIRECTORY: '/tmp',
    LLM_B_BOOT_TIMEOUT_MS: 30000,
    LLM_B_DIALOG_QUEUE_MAX: 5,
    LLM_B_WATCHDOG_MS: 60000,
    LLM_B_WATCHDOG_STALL_MS: 300000,
    MAX_WEBHOOKS: 10,
    WEBHOOK_MAX_RETRIES: 3,
    WEBHOOK_TIMEOUT_MS: 5000,
}));

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
}));

/** Span mock */
const mockSpan = {
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
};

vi.mock('#copilot/observability/otel', () => ({
    startSpan: vi.fn(async (_name, _attrs, fn) => fn()),
    startSpanImmediate: vi.fn(() => ({ ...mockSpan })),
    buildTelemetryConfig: vi.fn(() => null),
    isOtelEnabled: vi.fn(() => false),
}));

vi.mock('#copilot/sdk/event-helpers', () => ({
    waitForEvent: vi.fn(),
}));

vi.mock('#copilot/sdk/session', () => ({
    listSessions: vi.fn(async () => []),
    deleteSession: vi.fn(async () => {}),
}));

vi.mock('#copilot/observability', () => ({
    defaultMetrics: {
        recordSessionRotation: vi.fn(),
        recordSessionStart: vi.fn(),
        recordSessionEnd: vi.fn(),
        recordSessionError: vi.fn(),
        recordKeepalivePing: vi.fn(),
        recordSessionCleanup: vi.fn(),
        recordHandoff: vi.fn(),
        recordDialogTurn: vi.fn(),
        recordDialogStall: vi.fn(),
        recordDialogTimeout: vi.fn(),
        recordTaskCompletion: vi.fn(),
        recordStreamingChunk: vi.fn(),
        recordQuestionLatency: vi.fn(),
        recordCounter: vi.fn(),
        recordGauge: vi.fn(),
        recordToolCall: vi.fn(),
        recordUsage: vi.fn(),
        startPeriodicSnapshot: vi.fn(),
    },
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { defaultMetrics } from '#copilot/observability';
import { startSpan, startSpanImmediate } from '#copilot/observability/otel';
import { deleteSession, listSessions } from '#copilot/sdk/session';
import { cleanupStaleSessions } from '../../../src/copilot/agent/session/cleanup.js';
import { shouldRotateSession } from '../../../src/copilot/agent/session/rotation.js';

// ── F68.3: reconnect-policy span ────────────────────────────────────────────

describe('F68: OTEL Spans', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('reconnect-policy', () => {
        it('envolve tryReconnect em startSpan copilot.reconnect', async () => {
            const { tryReconnect } = await import('../../../src/copilot/agent/lifecycle/reconnect-policy.js');

            const callbacks = {
                emit: vi.fn(),
                initSession: vi.fn(async () => ({ session: { sessionId: 'new-sess' }, isResumed: false })),
                dialogLoop: { active: false, notifyReconnect: vi.fn() },
                clearSessionEventUnsubs: vi.fn(),
            };

            const result = await tryReconnect(new Error('test'), { stop: vi.fn() }, 'running', callbacks, {
                maxAttempts: 1,
                baseDelayMs: 0,
                jitterFn: () => 0,
            });

            expect(result).toBe(true);
            expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
                'copilot.reconnect',
                expect.objectContaining({ extra: expect.objectContaining({ maxAttempts: 1 }) }),
                expect.any(Function),
            );
        });
    });

    describe('loop-manager span lifecycle', () => {
        it('startSpanImmediate é chamado no start() com copilot.dialog.loop', async () => {
            const { DialogLoopManager } = await import('../../../src/copilot/agent/dialog/loop-manager.js');
            const dlm = new DialogLoopManager({ bootTimeoutMs: 50 });

            const host = {
                sendMessage: vi.fn(async () => {}),
                sendMessageDialogBoot: vi.fn(async () => {}),
                answerPendingQuestion: vi.fn(),
                getPendingQuestion: vi.fn(() => null),
                setModel: vi.fn(),
                emit: vi.fn(),
                on: vi.fn(() => () => {}),
                off: vi.fn(),
                getSessionId: vi.fn(() => 'sess-span'),
                getModel: vi.fn(() => 'gpt-4o'),
            };

            dlm.attach(host);

            // start will fail (boot timeout) but startSpanImmediate should be called before the await
            await dlm.start(null).catch(() => {});

            expect(vi.mocked(startSpanImmediate)).toHaveBeenCalledWith(
                'copilot.dialog.loop',
                expect.objectContaining({ 'session.id': 'sess-span', model: 'gpt-4o' }),
            );
        });
    });
});

// ── F70: Metrics & Cleanup ──────────────────────────────────────────────────

describe('F70: Métricas e Cleanup paralelo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('rotation metrics', () => {
        it('shouldRotateSession é pura: retorna shouldRotate=true sem chamar métricas', () => {
            const result = shouldRotateSession({ contextUtilization: 0.95 }, { maxUtilization: 0.9 });
            expect(result.shouldRotate).toBe(true);
            expect(result.reason).toBeDefined();
            // F74: shouldRotateSession é agora uma função pura — métricas são gravadas externamente em initializer.js
            expect(vi.mocked(defaultMetrics.recordSessionRotation)).not.toHaveBeenCalled();
        });

        it('shouldRotateSession retorna shouldRotate=false sem chamar métricas', () => {
            const result = shouldRotateSession({ contextUtilization: 0.5 }, { maxUtilization: 0.9 });
            expect(result.shouldRotate).toBe(false);
            expect(vi.mocked(defaultMetrics.recordSessionRotation)).not.toHaveBeenCalled();
        });

        it('shouldRotateSession retorna reason correto para cada trigger', () => {
            const r1 = shouldRotateSession({ sessionAgeMs: 999_999_999 }, { maxAgeMs: 1000 });
            expect(r1.shouldRotate).toBe(true);
            expect(r1.reason).toContain('idade');

            const r2 = shouldRotateSession({ compactionCount: 10 }, { maxCompactions: 5 });
            expect(r2.shouldRotate).toBe(true);
            expect(r2.reason).toMatch(/compaction/i);

            const r3 = shouldRotateSession({ totalTurns: 300 }, { maxTurns: 100 });
            expect(r3.shouldRotate).toBe(true);
            expect(r3.reason).toMatch(/turno/i);

            // F74: nenhuma chamada de métricas — função pura
            expect(vi.mocked(defaultMetrics.recordSessionRotation)).not.toHaveBeenCalled();
        });
    });

    describe('cleanup paralelo (Promise.allSettled)', () => {
        it('deleta múltiplas sessões em paralelo', async () => {
            const now = Date.now();
            const oldTime = new Date(now - 100_000_000).toISOString();

            vi.mocked(listSessions).mockResolvedValueOnce([
                { sessionId: 'old-1', startTime: oldTime },
                { sessionId: 'old-2', startTime: oldTime },
                { sessionId: 'old-3', startTime: oldTime },
            ]);
            vi.mocked(deleteSession).mockResolvedValue(undefined);

            const client = /** @type {any} */ ({});
            const result = await cleanupStaleSessions(client, { maxAgeMs: 86_400_000 });

            expect(result.deleted).toBe(3);
            expect(result.deletedIds).toEqual(['old-1', 'old-2', 'old-3']);
            expect(vi.mocked(deleteSession)).toHaveBeenCalledTimes(3);
        });

        it('captura erros individuais via Promise.allSettled', async () => {
            const now = Date.now();
            const oldTime = new Date(now - 100_000_000).toISOString();

            vi.mocked(listSessions).mockResolvedValueOnce([
                { sessionId: 'ok-1', startTime: oldTime },
                { sessionId: 'fail-1', startTime: oldTime },
            ]);
            vi.mocked(deleteSession).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('network error'));

            const client = /** @type {any} */ ({});
            const result = await cleanupStaleSessions(client, { maxAgeMs: 86_400_000 });

            expect(result.deleted).toBe(1);
            expect(result.errors.length).toBe(1);
            expect(result.errors[0]).toContain('network error');
        });

        it('preserva sessão ativa e sessões jovens', async () => {
            const now = Date.now();
            const recentTime = new Date(now - 1000).toISOString();
            const oldTime = new Date(now - 100_000_000).toISOString();

            vi.mocked(listSessions).mockResolvedValueOnce([
                { sessionId: 'current', startTime: oldTime },
                { sessionId: 'young', startTime: recentTime },
                { sessionId: 'old', startTime: oldTime },
            ]);
            vi.mocked(deleteSession).mockResolvedValue(undefined);

            const client = /** @type {any} */ ({});
            const result = await cleanupStaleSessions(client, {
                maxAgeMs: 86_400_000,
                currentSessionId: 'current',
            });

            expect(result.deleted).toBe(1);
            expect(result.deletedIds).toEqual(['old']);
            expect(result.kept).toBe(2);
        });
    });
});

// ── F69: Async snapshot ─────────────────────────────────────────────────────

describe('F69: Async snapshot exports', () => {
    it('exporta funções async de snapshot.js', async () => {
        const mod = await import('../../../src/copilot/agent/session/snapshot.js');

        expect(typeof mod.saveSnapshotAsync).toBe('function');
        expect(typeof mod.listSnapshotsAsync).toBe('function');
        expect(typeof mod.loadSnapshotAsync).toBe('function');
        expect(typeof mod.loadLatestSnapshotAsync).toBe('function');
        expect(typeof mod.pruneSnapshotsAsync).toBe('function');
    });

    it('createSnapshot continua síncrono', async () => {
        const { createSnapshot } = await import('../../../src/copilot/agent/session/snapshot.js');

        const snap = createSnapshot({
            sessionId: 'test-sess',
            model: 'gpt-4o',
            status: 'running',
            sendCount: 5,
            dialogLoopActive: true,
            dialogPaused: false,
            pendingQuestion: null,
        });

        expect(snap.snapshotId).toMatch(/^snap-/);
        expect(snap.sessionId).toBe('test-sess');
        expect(snap.model).toBe('gpt-4o');
    });
});
