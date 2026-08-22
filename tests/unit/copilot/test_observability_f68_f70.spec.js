/**
 * tests/unit/copilot/test_observability_f68_f70.spec.js
 *
 * Testes para F68 (OTEL spans), F69 (async FS), F70 (metrics + cleanup paralelo).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('#copilot/testing/config/env', () => ({
    getCopilotFallbackModel: vi.fn(() => 'auto'),
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
    LLM_B_DIALOG_BOOT_RECOVERY_ALLOW_PR_FALLBACK: false,
    LLM_B_WATCHDOG_MS: 60000,
    LLM_B_WATCHDOG_STALL_MS: 300000,
    MAX_WEBHOOKS: 10,
    WEBHOOK_MAX_RETRIES: 3,
    WEBHOOK_TIMEOUT_MS: 5000,

    COPILOT_MCP_SERVERS: '',
    COPILOT_CUSTOM_AGENTS: '',
    COPILOT_DISABLED_AGENTS: '',
    COPILOT_OPERATIONAL_PROFILE: 'production',
}));

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
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
    SYSTEM_MESSAGE_SECTIONS: {},
    SYSTEM_PROMPT_SECTIONS: {},
}));

vi.mock('../../../src/copilot/agent/ports/tracing-port.js', () => ({
    buildTelemetryConfig: vi.fn(() => null),
    startSpan: vi.fn(async (_name, _attrs, fn) => fn()),
    startSpanImmediate: vi.fn(() => ({ ...mockSpan })),
}));

vi.mock('#copilot/observability', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
    startSpan: vi.fn(async (_name, _attrs, fn) => fn()),
    startSpanImmediate: vi.fn(() => ({
        setAttribute: vi.fn(),
        setStatus: vi.fn(),
        recordException: vi.fn(),
        end: vi.fn(),
    })),
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
import { startSpan, startSpanImmediate } from '../../../src/copilot/agent/ports/index.js';
import { cleanupStaleSessions } from '../../../src/copilot/agent/session/lifecycle/cleanup.js';
import { shouldRotateSession } from '../../../src/copilot/agent/session/lifecycle/rotation.js';

/**
 * @param {{
 *     listSessions?: ReturnType<typeof vi.fn>;
 *     deleteSession?: ReturnType<typeof vi.fn>;
 *     getForegroundSessionId?: ReturnType<typeof vi.fn>;
 *     getLastSessionId?: ReturnType<typeof vi.fn>;
 * }} [overrides]
 * @returns {import('#copilot/sdk/types').CopilotClient}
 */
function makeClient(overrides = {}) {
    return /** @type {any} */ ({
        stop: vi.fn(),
        listSessions: overrides.listSessions ?? vi.fn(async () => []),
        deleteSession: overrides.deleteSession ?? vi.fn(async () => undefined),
        getForegroundSessionId: overrides.getForegroundSessionId ?? vi.fn(async () => undefined),
        getLastSessionId: overrides.getLastSessionId ?? vi.fn(async () => undefined),
    });
}

/**
 * @param {string} sessionId
 * @param {Date} startTime
 * @returns {import('#copilot/sdk/types').SessionMetadata}
 */
function makeSessionMetadata(sessionId, startTime) {
    return {
        sessionId,
        startTime,
        modifiedTime: startTime,
        isRemote: false,
    };
}

/** @returns {import('../../../src/copilot/agent/types.js').DialogLoopHost} */
function makeDialogHost() {
    return /** @type {any} */ ({
        sendMessage: vi.fn(async () => ''),
        sendMessageDialogBoot: vi.fn(async () => ''),
        answerPendingQuestion: vi.fn(() => true),
        hasPendingQuestion: vi.fn(() => false),
        setModel: vi.fn(),
        emit: vi.fn(() => true),
        on: vi.fn(() => {}),
        once: vi.fn(() => {}),
        off: vi.fn(() => {}),
        getSessionId: vi.fn(() => 'sess-span'),
        getModel: vi.fn(() => 'gpt-4o'),
    });
}

// ── F68.3: reconnect-policy span ────────────────────────────────────────────

describe('F68: OTEL Spans', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('reconnect-policy', () => {
        it('envolve tryReconnect em startSpan copilot.reconnect', async () => {
            const { tryReconnect } = await import('../../../src/copilot/agent/lifecycle/policies/reconnect-policy.js');

            const callbacks = /** @type {any} */ ({
                emit: vi.fn(),
                initSession: vi.fn(async () => ({ session: { sessionId: 'new-sess' }, isResumed: false })),
                dialogLoop: { active: false, notifyReconnect: vi.fn() },
                clearSessionEventUnsubs: vi.fn(),
            });

            const result = await tryReconnect(new Error('test'), makeClient(), 'processing', callbacks, {
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
            const { DialogLoopManager } =
                await import('../../../src/copilot/agent/dialog/orchestrators/loop-manager.js');
            const dlm = new DialogLoopManager({ bootTimeoutMs: 50 });

            const host = makeDialogHost();

            dlm.attach(host);

            // start will fail (boot timeout) but startSpanImmediate should be called before the await
            await dlm.start(undefined).catch(() => {});

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
            const oldTime = new Date(now - 100_000_000);
            const listSessions = vi.fn(async () => [
                makeSessionMetadata('old-1', oldTime),
                makeSessionMetadata('old-2', oldTime),
                makeSessionMetadata('old-3', oldTime),
            ]);
            const deleteSession = vi.fn(async () => undefined);

            const client = makeClient({ listSessions, deleteSession });
            const result = await cleanupStaleSessions(client, { maxAgeMs: 86_400_000 });

            expect(result.deleted).toBe(3);
            expect(result.deletedIds).toEqual(['old-1', 'old-2', 'old-3']);
            expect(deleteSession).toHaveBeenCalledTimes(3);
        });

        it('captura erros individuais via Promise.allSettled', async () => {
            const now = Date.now();
            const oldTime = new Date(now - 100_000_000);
            const listSessions = vi.fn(async () => [
                makeSessionMetadata('ok-1', oldTime),
                makeSessionMetadata('fail-1', oldTime),
            ]);
            const deleteSession = vi
                .fn()
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error('network error'));

            const client = makeClient({ listSessions, deleteSession });
            const result = await cleanupStaleSessions(client, { maxAgeMs: 86_400_000 });

            expect(result.deleted).toBe(1);
            expect(result.errors.length).toBe(1);
            expect(result.errors[0]).toContain('network error');
        });

        it('preserva sessão ativa e sessões jovens', async () => {
            const now = Date.now();
            const recentTime = new Date(now - 1000);
            const oldTime = new Date(now - 100_000_000);
            const listSessions = vi.fn(async () => [
                makeSessionMetadata('current', oldTime),
                makeSessionMetadata('young', recentTime),
                makeSessionMetadata('old', oldTime),
            ]);
            const deleteSession = vi.fn(async () => undefined);

            const client = makeClient({ listSessions, deleteSession });
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
        const mod = await import('../../../src/copilot/agent/session/state/snapshot.js');

        expect(typeof mod.saveSnapshotAsync).toBe('function');
        expect(typeof mod.listSnapshotsAsync).toBe('function');
        expect(typeof mod.loadSnapshotAsync).toBe('function');
        expect(typeof mod.loadLatestSnapshotAsync).toBe('function');
        expect(typeof mod.pruneSnapshotsAsync).toBe('function');
    });

    it('createSnapshot continua síncrono', async () => {
        const { createSnapshot } = await import('../../../src/copilot/agent/session/state/snapshot.js');

        const snap = createSnapshot({
            sessionId: 'test-sess',
            model: 'gpt-4o',
            status: 'processing',
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
