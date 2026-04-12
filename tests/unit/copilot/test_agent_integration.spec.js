// @ts-check
import { describe, it, beforeEach, afterEach } from 'node:test';
/**
 * F67 — Teste de Integração: DialogLoopManager boot → send → stop
 *
 * Exercita o fluxo real do DialogLoopManager com módulos reais (protocol, backpressure, model-fallback) e mocks mínimos
 * para I/O externo (env, logger, state-io, watchdog, turn-executor).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ── mocks de camada I/O ── */
vi.mock('#copilot/config/env', () => ({
    getCopilotFallbackModel: vi.fn(() => 'gpt-4o-mini'),
    COPILOT_MODEL: 'gpt-4o',
    AGENT_HOOK_CONTEXT_MAX_BYTES: 4096,
    AGENT_KEEPALIVE_IDLE_MS: 300000,
    AGENT_KEEPALIVE_MS: 60000,
    AGENT_MAX_LISTENERS: 50,
    AGENT_MAX_RECONNECT: 3,
    AGENT_MAX_SNAPSHOTS: 10,
    AGENT_MAX_TASK_RETRIES: 3,
    AGENT_MCP_RECONNECT_MS: 5000,
    AGENT_MESSAGES_CACHE_TTL_MS: 60000,
    AGENT_METRICS_INTERVAL_MS: 30000,
    AGENT_PERMISSION_MODE: 'permissive',
    AGENT_RECONNECT_DELAY_MS: 5000,
    AGENT_RECONNECT_STATUS_CODES: '408,429,500,502,503,504',
    AGENT_RECONNECT_TIMEOUT_MS: 30000,
    AGENT_ROTATION_MAX_AGE_MS: 3600000,
    AGENT_ROTATION_MAX_COMPACTIONS: 3,
    AGENT_ROTATION_MAX_TURNS: 50,
    AGENT_ROTATION_MAX_UTIL: 0.9,
    AGENT_SESSION_MAX_AGE_MS: 86400000,
    AGENT_SNAPSHOT_DIR: '',
    AGENT_STARVATION_THRESHOLD_MS: 60000,
    AGENT_STATE_FILE: '',
    AGENT_STATUS_SNAPSHOT_TTL_MS: 5000,
    AGENT_TASK_TIMEOUT_MS: 30000,
    AGENT_TOOL_AUDIT_MAX_LOG_BYTES: 10000,
    COPILOT_AUDIT_LOG_PATH: '',
    COPILOT_BOOT_PROMPT: '',
    COPILOT_DEBUG: false,
    COPILOT_MAX_TURNS: 100,
    COPILOT_METADATA_FILE: '',
    COPILOT_LOG_DIR: '',
    COPILOT_REASONING_EFFORT: 'medium',
    COPILOT_RESTART_DELAY_MS: 3000,
    COPILOT_SESSION_ID: '',
    COPILOT_STOP_ON_IDLE: false,
    COPILOT_TOOL_PERMISSIONS_LOG: '',
    COPILOT_TURN_TIMEOUT_MS: 120000,
    COPILOT_WORKING_DIRECTORY: '/tmp',
    LLM_B_BOOT_TIMEOUT_MS: 30000,
    LLM_B_DIALOG_QUEUE_MAX: 5,
    LLM_B_WATCHDOG_MS: 60000,
    LLM_B_WATCHDOG_STALL_MS: 300000,
    MAX_WEBHOOKS: 10,
    WEBHOOK_MAX_RETRIES: 3,
    WEBHOOK_TIMEOUT_MS: 5000,
}));

vi.mock('#copilot/core/errors', () => {
    class CopilotError extends Error {
        /** @param {string} msg @param {string} code */
        constructor(msg, code) {
            super(msg);
            this.code = code;
            this.name = 'CopilotError';
        }
    }
    class SessionError extends CopilotError {
        /** @param {string} msg @param {string} code */
        constructor(msg, code) {
            super(msg, code);
            this.name = 'SessionError';
        }
    }
    class BridgeError extends CopilotError {
        /** @param {string} msg @param {string} code */
        constructor(msg, code) {
            super(msg, code);
            this.name = 'BridgeError';
        }
    }
    return { CopilotError, SessionError, BridgeError };
});

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
}));

vi.mock('#copilot/sdk/event-helpers', () => ({
    waitForEvent: vi.fn(
        (emitter, event, opts = {}) =>
            new Promise((resolve, reject) => {
                const timeoutMs = opts.timeoutMs ?? 30000;
                const timer = setTimeout(() => {
                    emitter.off(event, handler);
                    reject(new Error(opts.timeoutError ?? `waitForEvent timeout: ${event}`));
                }, timeoutMs);
                /** @param {any} data */
                const handler = (data) => {
                    clearTimeout(timer);
                    resolve(data);
                };
                emitter.once(event, handler);
            }),
    ),
}));

vi.mock('../../../src/copilot/agent/lifecycle/state-io.js', () => ({
    persistState: vi.fn(),
    readState: vi.fn(() => null),
    writeStateAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/copilot/agent/dialog/watchdog.js', () => ({
    DialogWatchdog: class MockWatchdog {
        start = vi.fn();
        stop = vi.fn();
        ping = vi.fn();
    },
}));

/* turn-executor — mock que simula host interaction via emitter */
vi.mock('../../../src/copilot/agent/dialog/turn-executor.js', () => ({
    executeTurnImpl: vi.fn(),
}));

/* ── SUT (real) ── */
import { DialogLoopManager } from '../../../src/copilot/agent/dialog/loop-manager.js';
import { executeTurnImpl } from '../../../src/copilot/agent/dialog/turn-executor.js';

/* ── helpers ── */
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Cria host mock mínimo compatível.
 */
function makeHost() {
    return {
        getSessionId: vi.fn().mockReturnValue('sess-integ'),
        getPendingQuestion: vi.fn().mockReturnValue(null),
        answerPendingQuestion: vi.fn(),
        send: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockResolvedValue(undefined),
        getModel: vi.fn().mockReturnValue('gpt-4o'),
        on: vi.fn(),
        once: vi.fn(),
        off: vi.fn(),
    };
}

describe('F67 — Integration: DialogLoopManager boot → send → stop', () => {
    /** @type {DialogLoopManager} */
    let dlm;
    /** @type {ReturnType<typeof makeHost>} */
    let host;

    beforeEach(() => {
        vi.clearAllMocks();
        dlm = new DialogLoopManager();
        host = makeHost();
        dlm.attach(host);
    });

    afterEach(() => {
        // Cleanup: force deactivate to prevent leaking timers
        try {
            dlm.forceDeactivate();
        } catch {
            /* ignore */
        }
    });

    /**
     * Helper: inicia o DLM e emite ready logo que start é chamado.
     *
     * @returns {Promise<void>}
     */
    async function bootDlm() {
        const startPromise = dlm.start('Hello boot');
        // Emitir ready no próximo microtick (antes do timeout de boot)
        await tick();
        dlm.emit('ready', { ts: Date.now() });
        await startPromise;
    }

    /* ── F67.2: boot completo ── */
    describe('boot (start → ready)', () => {
        it('start() transiciona para active e emite changed', async () => {
            const changedSpy = vi.fn();
            dlm.on('changed', changedSpy);

            await bootDlm();

            expect(dlm.active).toBe(true);
            expect(changedSpy).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
        });

        it('start() sem attach rejeita NOT_ATTACHED', async () => {
            const fresh = new DialogLoopManager();
            await expect(fresh.start('test')).rejects.toThrow(/Não vinculado/);
        });
    });

    /* ── F67.3: send message → process → resolve ── */
    describe('send → process → resolve', () => {
        it('sendTurn() delega para TurnQueue e resolve com reply', async () => {
            await bootDlm();

            vi.mocked(executeTurnImpl).mockResolvedValue('reply-content');

            const reply = await dlm.sendTurn('question?');
            expect(reply).toBe('reply-content');
            expect(executeTurnImpl).toHaveBeenCalled();
        });

        it('sendTurn() rejeita quando não active', async () => {
            await expect(dlm.sendTurn('msg')).rejects.toThrow(/não está ativo/);
        });
    });

    /* ── F67.4: dialog loop turns ── */
    describe('dialog loop turns', () => {
        it('múltiplos turns são serializados pelo TurnQueue', async () => {
            await bootDlm();

            let callCount = 0;
            vi.mocked(executeTurnImpl).mockImplementation(async () => {
                callCount++;
                return `reply-${callCount}`;
            });

            const [r1, r2, r3] = await Promise.all([dlm.sendTurn('q1'), dlm.sendTurn('q2'), dlm.sendTurn('q3')]);

            expect(r1).toBe('reply-1');
            expect(r2).toBe('reply-2');
            expect(r3).toBe('reply-3');
            expect(callCount).toBe(3);
        });
    });

    /* ── F67.5: graceful stop ── */
    describe('graceful stop', () => {
        it('stop() authorized desativa loop e emite stopped', async () => {
            await bootDlm();

            expect(dlm.active).toBe(true);

            const stoppedSpy = vi.fn();
            dlm.on('stopped', stoppedSpy);

            await dlm.stop({ authorized: true, reason: 'authorized_stop' });

            expect(dlm.active).toBe(false);
            expect(stoppedSpy).toHaveBeenCalledWith(expect.objectContaining({ authorized: true }));
        });

        it('forceDeactivate() reseta estado completo', async () => {
            await bootDlm();

            dlm.forceDeactivate();

            expect(dlm.active).toBe(false);
            expect(dlm.stopping).toBe(false);
            expect(dlm.queueDepth).toBe(0);
        });
    });

    /* ── F67.6: handleProtocolInput ── */
    describe('protocol input routing', () => {
        it('handleProtocolInput ready emite ready event', async () => {
            const readySpy = vi.fn();
            dlm.on('ready', readySpy);

            dlm.handleProtocolInput({ question: 'READY: aguardando' });

            expect(readySpy).toHaveBeenCalled();
        });

        it('handleProtocolInput reply emite reply event', async () => {
            const replySpy = vi.fn();
            dlm.on('reply', replySpy);

            dlm.handleProtocolInput({ question: 'REPLY: test-reply' });

            expect(replySpy).toHaveBeenCalledWith(
                expect.objectContaining({ reply: expect.stringContaining('test-reply') }),
            );
        });
    });
});
