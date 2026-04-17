// @ts-check
/**
 * tests/unit/copilot/test_loop_manager.spec.js
 *
 * F64: Testes unitários para DialogLoopManager (pós-decomposição F59-F61)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────
vi.mock('#copilot/config/env', () => ({
    getCopilotFallbackModel: vi.fn(() => 'gpt-4o-mini'),
    COPILOT_MODEL: 'gpt-4o',
    AGENT_HOOK_CONTEXT_MAX_BYTES: 8192,
    AGENT_KEEPALIVE_IDLE_MS: 300000,
    AGENT_KEEPALIVE_MS: 60000,
    AGENT_MAX_LISTENERS: 50,
    AGENT_MAX_SNAPSHOTS: 5,
    AGENT_MAX_TASK_RETRIES: 3,
    AGENT_MCP_RECONNECT_MS: 5000,
    AGENT_MESSAGES_CACHE_TTL_MS: 60000,
    AGENT_METRICS_INTERVAL_MS: 30000,
    AGENT_PERMISSION_MODE: 'ask',
    AGENT_ROTATION_MAX_AGE_MS: 3600000,
    AGENT_ROTATION_MAX_COMPACTIONS: 5,
    AGENT_ROTATION_MAX_TURNS: 100,
    AGENT_ROTATION_MAX_UTIL: 0.9,
    AGENT_SESSION_MAX_AGE_MS: 86400000,
    AGENT_SNAPSHOT_DIR: '/tmp/snapshots',
    AGENT_STARVATION_THRESHOLD_MS: 30000,
    AGENT_STATE_FILE: '/tmp/state.json',
    AGENT_STATUS_SNAPSHOT_TTL_MS: 5000,
    AGENT_TASK_TIMEOUT_MS: 300000,
    AGENT_TOOL_AUDIT_MAX_LOG_BYTES: 4096,
    COPILOT_AUDIT_LOG_PATH: '/tmp/audit.log',
    COPILOT_LOG_DIR: '',
    COPILOT_REASONING_EFFORT: 'medium',
    COPILOT_RESTART_DELAY_MS: 3000,
    COPILOT_TOOL_PERMISSIONS_LOG: '/tmp/perms.log',
    COPILOT_WORKING_DIRECTORY: '/tmp',
    LLM_B_BOOT_TIMEOUT_MS: 30000,
    LLM_B_DIALOG_QUEUE_MAX: 5,
    LLM_B_WATCHDOG_MS: 60000,
    LLM_B_WATCHDOG_STALL_MS: 120000,
    MAX_WEBHOOKS: 10,
    WEBHOOK_MAX_RETRIES: 3,
    WEBHOOK_TIMEOUT_MS: 5000,

    COPILOT_MCP_SERVERS: '',
    COPILOT_CUSTOM_AGENTS: '',
    COPILOT_DISABLED_AGENTS: '',
}));
vi.mock('#copilot/core/errors', async () => {
    const actual = await vi.importActual('#copilot/core/errors');
    return actual;
});
vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

// Mock waitForEvent — resolve imediatamente por padrão
const mockWaitForEvent = vi.fn(() => Promise.resolve({}));
vi.mock('#copilot/sdk/event-helpers', () => ({ waitForEvent: (...args) => mockWaitForEvent(...args) }));

vi.mock('../../../src/copilot/agent/lifecycle/state-io.js', () => ({
    persistState: vi.fn(),
    persistStateWithPolicy: vi.fn(async () => ({ ok: true, value: /** @type {any} */ ({}) })),
    readState: vi.fn(() => null),
    writeStateAsync: vi.fn(async () => {}),
    SYSTEM_PROMPT_SECTIONS: {},
}));

vi.mock('../../../src/copilot/agent/dialog/turn-executor.js', () => ({
    executeTurnImpl: vi.fn(async () => 'REPLY: ok'),
}));

vi.mock('../../../src/copilot/agent/dialog/watchdog.js', () => ({
    DialogWatchdog: class MockWatchdog {
        start = vi.fn();
        stop = vi.fn();
        ping = vi.fn();
    },
}));

import { DialogLoopManager } from '../../../src/copilot/agent/dialog/loop-manager.js';
import { executeTurnImpl } from '../../../src/copilot/agent/dialog/turn-executor.js';
import { persistStateWithPolicy, readState } from '../../../src/copilot/agent/lifecycle/state-io.js';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Cria um host mock mínimo */
function createMockHost() {
    return {
        sendMessage: vi.fn(async () => 'ok'),
        sendMessageDialogBoot: vi.fn(async () => 'ok'),
        answerPendingQuestion: vi.fn(),
        getPendingQuestion: vi.fn(() => null),
        setModel: vi.fn(),
        emit: vi.fn(),
        on: vi.fn(() => () => {}),
        off: vi.fn(),
        getSessionId: vi.fn(() => 'test-session'),
        getModel: vi.fn(() => 'gpt-4o'),
    };
}

// ── Testes ───────────────────────────────────────────────────────────────

describe('DialogLoopManager', () => {
    /** @type {DialogLoopManager} */
    let dlm;
    let host;

    beforeEach(() => {
        vi.clearAllMocks();
        mockWaitForEvent.mockImplementation(() => Promise.resolve({}));
        dlm = new DialogLoopManager({ bootTimeoutMs: 500, watchdogIntervalMs: 60000, watchdogStallMs: 120000 });
        host = createMockHost();
        dlm.attach(host);
    });

    // ── F64.1: start/stop lifecycle ──────────────────────────────────

    describe('start/stop lifecycle', () => {
        it('deve iniciar com active=false', () => {
            expect(dlm.active).toBe(false);
        });

        it('deve ativar após start()', async () => {
            await dlm.start('Hello');
            expect(dlm.active).toBe(true);
        });

        it('start() persiste dialogLoopActive via persistStateWithPolicy', async () => {
            await dlm.start('Hello');

            expect(persistStateWithPolicy).toHaveBeenCalledWith(
                { dialogLoopActive: true },
                { label: 'dialog.state.active' },
            );
        });

        it('deve desativar após stop({ authorized: true })', async () => {
            await dlm.start('Hello');
            expect(dlm.active).toBe(true);
            await dlm.stop({ authorized: true });
            expect(dlm.active).toBe(false);
        });

        it('stop({ authorized: true }) persiste dialogLoopActive=false via persistStateWithPolicy', async () => {
            await dlm.start('Hello');
            vi.mocked(persistStateWithPolicy).mockClear();

            await dlm.stop({ authorized: true });

            expect(persistStateWithPolicy).toHaveBeenCalledWith(
                { dialogLoopActive: false },
                { label: 'dialog.state.inactive' },
            );
        });

        it('stop() sem authorized deve ser ignorado', async () => {
            await dlm.start('Hello');
            await dlm.stop(); // authorized=false by default
            expect(dlm.active).toBe(true);
        });

        it('start() sem attach deve lançar NOT_ATTACHED', async () => {
            const dlm2 = new DialogLoopManager();
            await expect(dlm2.start('Hello')).rejects.toThrow(/NOT_ATTACHED|Não vinculado/);
        });

        it('start() com loop já ativo deve lançar DIALOG_ALREADY_ACTIVE', async () => {
            await dlm.start('Hello');
            await expect(dlm.start('Hello')).rejects.toThrow(/DIALOG_ALREADY_ACTIVE|já está ativo/);
        });
    });

    // ── F64.2: Turn serialization ────────────────────────────────────

    describe('turn serialization', () => {
        it('sendTurn() rejeita quando loop não está ativo', async () => {
            await expect(dlm.sendTurn('test')).rejects.toThrow(/não está ativo/);
        });

        it('sendTurn() chama executeTurnImpl quando loop ativo', async () => {
            await dlm.start('Hello');
            const result = await dlm.sendTurn('test');
            expect(vi.mocked(executeTurnImpl)).toHaveBeenCalled();
            expect(result).toBe('REPLY: ok');
        });

        it('queueDepth inicia em 0', () => {
            expect(dlm.queueDepth).toBe(0);
        });
    });

    // ── F64.3: handleProtocolInput routing ───────────────────────────

    describe('handleProtocolInput routing', () => {
        it('classifica READY: e emite ready', () => {
            const readySpy = vi.fn();
            dlm.on('ready', readySpy);
            dlm.handleProtocolInput({ question: 'READY: bot is ready' });
            expect(readySpy).toHaveBeenCalled();
        });

        it('classifica REPLY: e emite reply com texto extraído', () => {
            const replySpy = vi.fn();
            dlm.on('reply', replySpy);
            dlm.handleProtocolInput({ question: 'REPLY: hello world' });
            expect(replySpy).toHaveBeenCalledWith(expect.objectContaining({ reply: expect.any(String) }));
        });

        it('classifica STOPPED e emite stopped', () => {
            const stoppedSpy = vi.fn();
            dlm.on('stopped', stoppedSpy);
            dlm.handleProtocolInput({ question: 'STOPPED: dialog acabou' });
            expect(stoppedSpy).toHaveBeenCalledWith(
                expect.objectContaining({ reason: 'model_stopped', authorized: false }),
            );
        });
    });

    // ── F64.4: forceDeactivate ───────────────────────────────────────

    describe('forceDeactivate', () => {
        it('deve forçar desativação e resetar queue', async () => {
            await dlm.start('Hello');
            expect(dlm.active).toBe(true);
            dlm.forceDeactivate();
            expect(dlm.active).toBe(false);
            expect(dlm.queueDepth).toBe(0);
        });

        it('deve emitir stopped com reason force_deactivate', async () => {
            await dlm.start('Hello');
            const stoppedSpy = vi.fn();
            dlm.on('stopped', stoppedSpy);
            dlm.forceDeactivate();
            expect(stoppedSpy).toHaveBeenCalledWith(
                expect.objectContaining({ reason: 'force_deactivate', authorized: false }),
            );
        });
    });

    // ── F64.5: handleTokenBudget ─────────────────────────────────────

    describe('handleTokenBudget', () => {
        it('não emite quando loop não ativo', () => {
            const spy = vi.fn();
            dlm.on('compaction.requested', spy);
            dlm.handleTokenBudget({ currentTokens: 95000, tokenLimit: 100000, ratio: 95 });
            expect(spy).not.toHaveBeenCalled();
        });

        it('emite compaction.requested com urgency critical em ratio >= 95', async () => {
            await dlm.start('Hello');
            const spy = vi.fn();
            dlm.on('compaction.requested', spy);
            dlm.handleTokenBudget({ currentTokens: 95000, tokenLimit: 100000, ratio: 95 });
            expect(spy).toHaveBeenCalledWith(expect.objectContaining({ urgency: 'critical' }));
        });

        it('emite compaction.requested com urgency proactive em ratio >= 90', async () => {
            await dlm.start('Hello');
            const spy = vi.fn();
            dlm.on('compaction.requested', spy);
            dlm.handleTokenBudget({ currentTokens: 90000, tokenLimit: 100000, ratio: 90 });
            expect(spy).toHaveBeenCalledWith(expect.objectContaining({ urgency: 'proactive' }));
        });
    });

    // ── F64.6: prMetrics ─────────────────────────────────────────────

    describe('prMetrics', () => {
        it('deve contar boots após start()', async () => {
            await dlm.start('Hello');
            expect(dlm.prMetrics.boots).toBe(1);
            expect(dlm.prMetrics.totalPR).toBe(1);
        });
    });

    // ── F64.7: pause/resume ──────────────────────────────────────────

    describe('pause/resume', () => {
        it('paused retorna false por padrão', () => {
            expect(dlm.paused).toBe(false);
        });

        it('paused retorna true quando state indica dialogPaused', () => {
            vi.mocked(readState).mockReturnValue(/** @type {any} */ ({ dialogPaused: true }));
            expect(dlm.paused).toBe(true);
        });

        it('pause() com loop inativo não emite paused', async () => {
            const spy = vi.fn();
            dlm.on('paused', spy);
            await dlm.pause('sess1');
            expect(spy).not.toHaveBeenCalled();
        });

        it('pause() com loop ativo emite paused', async () => {
            await dlm.start('Hello');
            const spy = vi.fn();
            dlm.on('paused', spy);
            await dlm.pause('sess1');
            expect(spy).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess1' }));
        });

        it('pause() persiste estado com a policy canônica', async () => {
            await dlm.start('Hello');
            vi.mocked(persistStateWithPolicy).mockClear();

            await dlm.pause('sess1');

            expect(persistStateWithPolicy).toHaveBeenCalledWith(
                expect.objectContaining({ dialogPaused: true, dialogLoopActive: true }),
                { label: 'dialog.state.pause' },
            );
        });
    });

    // ── F64.extra: notifyReconnect ───────────────────────────────────

    describe('notifyReconnect', () => {
        it('deve desativar e emitir changed com reason reconnect', async () => {
            await dlm.start('Hello');
            const changedSpy = vi.fn();
            dlm.on('changed', changedSpy);
            dlm.notifyReconnect();
            expect(dlm.active).toBe(false);
            expect(changedSpy).toHaveBeenCalledWith(expect.objectContaining({ active: false, reason: 'reconnect' }));
        });
    });

    // ── F64.extra: sendTurn com AbortSignal já abortado ──────────────

    describe('sendTurn abort', () => {
        it('rejeita imediatamente se signal já abortado', async () => {
            await dlm.start('Hello');
            const controller = new AbortController();
            controller.abort();
            await expect(dlm.sendTurn('test', { signal: controller.signal })).rejects.toThrow(/AbortError|abortado/);
        });
    });
});
