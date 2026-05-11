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
    COPILOT_OPERATIONAL_PROFILE: 'production',
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

// Mock waitForAgentSdkEvent — resolve imediatamente por padrão
const mockWaitForAgentSdkEvent = vi.fn(
    (/** @type {any} */ _emitter, /** @type {any} */ _event, /** @type {any} */ _opts) => Promise.resolve({}),
);
vi.mock('../../../src/copilot/agent/facades/agent-sdk-runtime.js', () => ({
    waitForAgentSdkEvent: (
        /** @type {import('node:events').EventEmitter} */ emitter,
        /** @type {string} */ event,
        /** @type {{ timeoutMs?: number; timeoutError?: string; signal?: AbortSignal }} */ opts,
    ) => mockWaitForAgentSdkEvent(emitter, event, opts),
}));

vi.mock('../../../src/copilot/agent/lifecycle/state/state-io.js', () => ({
    persistState: vi.fn(),
    persistStateWithPolicy: vi.fn(async () => ({ ok: true, value: /** @type {any} */ ({}) })),
    readState: vi.fn(() => null),
    writeStateAsync: vi.fn(async () => {}),
    SYSTEM_PROMPT_SECTIONS: {},
}));

vi.mock('../../../src/copilot/agent/dialog/executors/turn-executor.js', () => ({
    executeTurnImpl: vi.fn(async () => 'REPLY: ok'),
}));

vi.mock('../../../src/copilot/agent/dialog/watchdogs/watchdog.js', () => ({
    DialogWatchdog: class MockWatchdog {
        start = vi.fn();
        stop = vi.fn();
        ping = vi.fn();
    },
}));

import { executeTurnImpl } from '../../../src/copilot/agent/dialog/executors/turn-executor.js';
import { DialogLoopManager } from '../../../src/copilot/agent/dialog/orchestrators/loop-manager.js';
import { DialogCompactionPolicy } from '../../../src/copilot/agent/dialog/policies/compaction-policy.js';
import { selectDialogResumeStrategy } from '../../../src/copilot/agent/dialog/policies/resume-policy.js';
import { DialogCostLedger } from '../../../src/copilot/agent/dialog/state/cost-ledger.js';
import { DialogLoopStateMachine } from '../../../src/copilot/agent/dialog/state/state-machine.js';
import { persistStateWithPolicy, readState } from '../../../src/copilot/agent/lifecycle/state/state-io.js';

// ── Helpers ──────────────────────────────────────────────────────────────

/** @returns {any} Cria um host mock mínimo */
function createMockHost() {
    return {
        sendMessage: vi.fn(async () => 'ok'),
        sendMessageDialogBoot: vi.fn(async () => 'ok'),
        answerPendingQuestion: vi.fn(),
        hasPendingQuestion: vi.fn(() => false),
        getPendingQuestionSnapshot: vi.fn(() => null),
        setModel: vi.fn(),
        emit: vi.fn(),
        on: vi.fn(() => () => {}),
        once: vi.fn(() => {}),
        off: vi.fn(),
        getSessionId: vi.fn(() => 'test-session'),
        getModel: vi.fn(() => 'gpt-4o'),
        trackBackgroundTask: vi.fn(async (task) => {
            await task;
        }),
    };
}

// ── Testes ───────────────────────────────────────────────────────────────

/**
 * @typedef {ReturnType<typeof createMockHost>} MockDialogLoopHost
 */

describe('DialogLoopManager', () => {
    /** @type {DialogLoopManager} */
    let dlm;
    /** @type {any} */
    let host;

    beforeEach(() => {
        vi.clearAllMocks();
        mockWaitForAgentSdkEvent.mockImplementation(() => Promise.resolve({}));
        vi.mocked(readState).mockReturnValue(null);
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

        it('start() limpa paused em memória mesmo quando o estado persistido vinha pausado', async () => {
            vi.mocked(readState).mockReturnValue(/** @type {any} */ ({ dialogPaused: true }));
            const fresh = new DialogLoopManager({
                bootTimeoutMs: 500,
                watchdogIntervalMs: 60000,
                watchdogStallMs: 120000,
            });
            fresh.attach(createMockHost());

            expect(fresh.paused).toBe(true);
            await fresh.start('Hello');

            expect(fresh.paused).toBe(false);
        });

        it('start() persiste dialogLoopActive via persistStateWithPolicy', async () => {
            await dlm.start('Hello');

            expect(persistStateWithPolicy).toHaveBeenCalledWith(
                { dialogLoopActive: true, dialogPaused: false },
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

        it('start() aceita READY tardio após timeout nominal de boot sem derrubar o loop', async () => {
            mockWaitForAgentSdkEvent
                .mockRejectedValueOnce(new Error('[DialogLoopManager] Boot timeout após 10ms'))
                .mockResolvedValueOnce({});

            await dlm.start('Hello');

            expect(dlm.active).toBe(true);
            expect(mockWaitForAgentSdkEvent).toHaveBeenCalledTimes(2);
        });

        it('start() limpa active/watchdog quando timeout e READY tardio falham', async () => {
            mockWaitForAgentSdkEvent
                .mockRejectedValueOnce(new Error('[DialogLoopManager] Boot timeout após 10ms'))
                .mockRejectedValueOnce(new Error('[DialogLoopManager] READY tardio não chegou'));

            await expect(dlm.start('Hello')).rejects.toThrow(/Boot timeout/);

            expect(dlm.active).toBe(false);
        });

        it('start() falha pelo erro de envio do boot sem emitir stopped duas vezes', async () => {
            mockWaitForAgentSdkEvent.mockRejectedValueOnce(new Error('[DialogLoopManager] Boot timeout após 10ms'));
            host.sendMessageDialogBoot.mockRejectedValueOnce(new Error('pipe closed'));
            const stoppedSpy = vi.fn();
            dlm.on('stopped', stoppedSpy);

            await expect(dlm.start('Hello')).rejects.toThrow('pipe closed');

            expect(dlm.active).toBe(false);
            expect(stoppedSpy).toHaveBeenCalledTimes(1);
            expect(stoppedSpy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'pipe closed' }));
        });

        it('abre circuit breaker após falhas repetidas de boot para evitar storm de PR', async () => {
            mockWaitForAgentSdkEvent.mockRejectedValue(new Error('[DialogLoopManager] Boot timeout após 10ms'));
            host.sendMessageDialogBoot.mockRejectedValue(new Error('pipe closed'));

            await expect(dlm.start('Hello 1')).rejects.toThrow('pipe closed');
            await expect(dlm.start('Hello 2')).rejects.toThrow('pipe closed');
            await expect(dlm.start('Hello 3')).rejects.toThrow(/Circuit breaker de boot aberto/);

            const callsBeforeCircuit = host.sendMessageDialogBoot.mock.calls.length;
            await expect(dlm.start('Hello 4')).rejects.toMatchObject({ code: 'DIALOG_BOOT_CIRCUIT_OPEN' });
            expect(host.sendMessageDialogBoot).toHaveBeenCalledTimes(callsBeforeCircuit);
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

        it('não reinicia automaticamente turno enfileirado quando READY ainda não reapareceu', async () => {
            mockWaitForAgentSdkEvent.mockResolvedValueOnce({});
            await dlm.start('Hello');
            const recoverySpy = vi.fn();
            const stoppedSpy = vi.fn();
            dlm.on('recovery', recoverySpy);
            dlm.on('stopped', stoppedSpy);

            const result = await dlm.sendTurn('queued', { traceId: 'q1' });

            expect(result).toBe('REPLY: ok');
            expect(host.sendMessageDialogBoot).toHaveBeenCalledTimes(1);
            expect(stoppedSpy).not.toHaveBeenCalled();
            expect(recoverySpy).not.toHaveBeenCalled();
        });

        it('mantém o caminho normal quando READY tardio já virou pending question', async () => {
            let pending = false;
            host.hasPendingQuestion.mockImplementation(() => pending);
            vi.mocked(executeTurnImpl).mockImplementationOnce(async () => {
                pending = true;
                return 'REPLY: ok';
            });
            mockWaitForAgentSdkEvent.mockResolvedValueOnce({});
            await dlm.start('Hello');
            const recoverySpy = vi.fn();
            dlm.on('recovery', recoverySpy);

            await dlm.sendTurn('queued', { traceId: 'q2' });

            expect(host.sendMessageDialogBoot).toHaveBeenCalledTimes(1);
            expect(recoverySpy).not.toHaveBeenCalled();
        });

        it('não reinicia após REPLY quando READY pós-turno não reaparece imediatamente', async () => {
            let pending = true;
            host.hasPendingQuestion.mockImplementation(() => pending);
            vi.mocked(executeTurnImpl).mockImplementationOnce(async () => {
                pending = false;
                return 'REPLY: ok';
            });
            mockWaitForAgentSdkEvent.mockResolvedValueOnce({});
            await dlm.start('Hello');
            const recoverySpy = vi.fn();
            const stoppedSpy = vi.fn();
            dlm.on('recovery', recoverySpy);
            dlm.on('stopped', stoppedSpy);
            host.trackBackgroundTask = vi.fn(async (task) => {
                await task;
            });

            await expect(dlm.sendTurn('single', { traceId: 'idle1' })).resolves.toBe('REPLY: ok');

            expect(host.trackBackgroundTask).not.toHaveBeenCalled();
            expect(host.sendMessageDialogBoot).toHaveBeenCalledTimes(1);
            expect(stoppedSpy).not.toHaveBeenCalled();
            expect(recoverySpy).not.toHaveBeenCalled();
        });

        it('sendTurn() rejeita enquanto stop() esta drenando', async () => {
            await dlm.start('Hello');
            /** @type {(value: string) => void} */
            let release = () => {};
            vi.mocked(executeTurnImpl).mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        release = resolve;
                    }),
            );

            const firstTurn = dlm.sendTurn('first');
            const stopPromise = dlm.stop({ authorized: true, shutdownTimeoutMs: 1000 });

            await expect(dlm.sendTurn('second')).rejects.toThrow(/não está ativo/);

            release('done');
            await firstTurn;
            await stopPromise;
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

        it('ignora READY durante stop em andamento para não rearmar watchdog nem late recovery', async () => {
            await dlm.start('Hello');
            /** @type {((v: string) => void) | undefined} */
            let resolveTurn;
            vi.mocked(executeTurnImpl).mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveTurn = resolve;
                    }),
            );
            const readySpy = vi.fn();
            dlm.on('ready', readySpy);

            const turnPromise = dlm.sendTurn('long turn');
            await new Promise((resolve) => setTimeout(resolve, 0));
            const stopPromise = dlm.stop({ authorized: true });

            dlm.handleProtocolInput({ question: 'READY: late while stopping' });

            expect(readySpy).not.toHaveBeenCalled();
            resolveTurn?.('REPLY: done');
            await turnPromise;
            await stopPromise;
        });

        it('reativa o loop quando READY chega apos drift de boot', () => {
            dlm.forceDeactivate();

            const changedSpy = vi.fn();
            const readySpy = vi.fn();
            dlm.on('changed', changedSpy);
            dlm.on('ready', readySpy);

            dlm.handleProtocolInput({ question: 'READY: recover' });

            expect(dlm.active).toBe(true);
            expect(readySpy).toHaveBeenCalled();
            expect(changedSpy).toHaveBeenCalledWith(
                expect.objectContaining({ active: true, reason: 'late_protocol_recovery', trigger: 'ready' }),
            );
            expect(persistStateWithPolicy).toHaveBeenCalledWith(
                { dialogLoopActive: true, dialogPaused: false },
                expect.objectContaining({ label: 'dialog.state.late_protocol_recovery' }),
            );
        });

        it('classifica REPLY: e emite reply com texto extraído', () => {
            const replySpy = vi.fn();
            dlm.on('reply', replySpy);
            dlm.handleProtocolInput({ question: 'REPLY: hello world' });
            expect(replySpy).toHaveBeenCalledWith(expect.objectContaining({ reply: expect.any(String) }));
        });

        it('classifica STOPPED exato e emite stopped', () => {
            const stoppedSpy = vi.fn();
            dlm.on('stopped', stoppedSpy);
            dlm.handleProtocolInput({ question: 'STOPPED' });
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

        it('não duplica compaction proativa antes do reset', async () => {
            await dlm.start('Hello');
            const spy = vi.fn();
            dlm.on('compaction.requested', spy);

            dlm.handleTokenBudget({ currentTokens: 90000, tokenLimit: 100000, ratio: 90 });
            dlm.handleTokenBudget({ currentTokens: 91000, tokenLimit: 100000, ratio: 91 });

            expect(spy).toHaveBeenCalledTimes(1);
        });

        it('volta a emitir compaction proativa após resetCompactionFlag()', async () => {
            await dlm.start('Hello');
            const spy = vi.fn();
            dlm.on('compaction.requested', spy);

            dlm.handleTokenBudget({ currentTokens: 90000, tokenLimit: 100000, ratio: 90 });
            dlm.resetCompactionFlag();
            dlm.handleTokenBudget({ currentTokens: 91000, tokenLimit: 100000, ratio: 91 });

            expect(spy).toHaveBeenCalledTimes(2);
        });
    });

    // ── F64.6: prMetrics ─────────────────────────────────────────────

    describe('prMetrics', () => {
        it('deve contar boots após start()', async () => {
            await dlm.start('Hello');
            expect(dlm.prMetrics.boots).toBe(1);
            expect(dlm.prMetrics.totalPR).toBe(1);
        });

        it('restaura métricas persistidas no ledger extraído', () => {
            vi.mocked(readState).mockReturnValue(
                /** @type {any} */ ({ prMetrics: { boots: 2, resumesWithPR: 1, resumesZeroPR: 3 } }),
            );
            const fresh = new DialogLoopManager({
                bootTimeoutMs: 500,
                watchdogIntervalMs: 60000,
                watchdogStallMs: 120000,
            });

            expect(fresh.prMetrics).toEqual({ boots: 2, resumesWithPR: 1, resumesZeroPR: 3, totalPR: 3 });
        });
    });

    // ── F64.7: pause/resume ──────────────────────────────────────────

    describe('pause/resume', () => {
        it('paused retorna false por padrão', () => {
            expect(dlm.paused).toBe(false);
        });

        it('paused retorna true quando state indica dialogPaused', () => {
            vi.mocked(readState).mockReturnValue(/** @type {any} */ ({ dialogPaused: true }));
            const fresh = new DialogLoopManager({
                bootTimeoutMs: 500,
                watchdogIntervalMs: 60000,
                watchdogStallMs: 120000,
            });
            fresh.attach(createMockHost());
            expect(fresh.paused).toBe(true);
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

describe('DialogCostLedger', () => {
    it('normaliza entradas persistidas e calcula totalPR sem contar zero-PR', () => {
        const ledger = new DialogCostLedger({ boots: 2, resumesWithPR: 1, resumesZeroPR: 4 });

        expect(ledger.snapshot()).toEqual({ boots: 2, resumesWithPR: 1, resumesZeroPR: 4, totalPR: 3 });
    });
});

describe('DialogCompactionPolicy', () => {
    it('deduplica proactive e critical até reset ou retorno à faixa segura', () => {
        const policy = new DialogCompactionPolicy();

        expect(policy.evaluate({ currentTokens: 90, tokenLimit: 100, ratio: 90 })?.urgency).toBe('proactive');
        expect(policy.evaluate({ currentTokens: 91, tokenLimit: 100, ratio: 91 })).toBeNull();
        expect(policy.evaluate({ currentTokens: 95, tokenLimit: 100, ratio: 95 })?.urgency).toBe('critical');
        expect(policy.evaluate({ currentTokens: 96, tokenLimit: 100, ratio: 96 })).toBeNull();
        policy.reset();
        expect(policy.evaluate({ currentTokens: 96, tokenLimit: 100, ratio: 96 })?.urgency).toBe('critical');
        expect(policy.evaluate({ currentTokens: 80, tokenLimit: 100, ratio: 80 })).toBeNull();
        expect(policy.evaluate({ currentTokens: 95, tokenLimit: 100, ratio: 95 })?.urgency).toBe('critical');
    });
});

describe('DialogLoopStateMachine', () => {
    it('governa active/stopping/paused/resuming sem side effects', () => {
        const state = new DialogLoopStateMachine({ paused: true });

        expect(state.paused).toBe(true);
        expect(state.active).toBe(false);

        state.activate();
        expect(state.active).toBe(true);
        expect(state.paused).toBe(false);
        expect(state.canSendTurn).toBe(true);

        expect(state.beginStop()).toBe('started');
        expect(state.canSendTurn).toBe(false);
        expect(state.beginStop()).toBe('already-stopping');

        state.finishStop();
        expect(state.active).toBe(false);
        expect(state.stopping).toBe(false);
    });

    it('bloqueia resume concorrente até finishResume()', () => {
        const state = new DialogLoopStateMachine();

        expect(state.beginResume()).toBe(true);
        expect(state.beginResume()).toBe(false);
        state.finishResume();
        expect(state.beginResume()).toBe(true);
    });
});

describe('selectDialogResumeStrategy', () => {
    it('seleciona zero-pr imediato quando host já tem pending question', async () => {
        const host = { ...createMockHost(), hasPendingQuestion: vi.fn(() => true) };

        const strategy = await selectDialogResumeStrategy({
            host,
            fallbackTarget: new DialogLoopManager(),
        });

        expect(strategy.kind).toBe('zero-pr-immediate');
        expect(strategy.prConsumed).toBe(false);
    });

    it('seleciona restart com PR quando pending question não é preservado', async () => {
        mockWaitForAgentSdkEvent.mockRejectedValueOnce(new Error('timeout'));
        const host = createMockHost();

        const strategy = await selectDialogResumeStrategy({
            host,
            fallbackTarget: new DialogLoopManager(),
            timeoutMs: 1,
        });

        expect(strategy.kind).toBe('restart-with-pr');
        expect(strategy.prConsumed).toBe(true);
    });
});
