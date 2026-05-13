// @ts-check
/**
 * tests/unit/copilot/test_terminal_dialog_engine.spec.js
 *
 * Contrato: terminal/dialog/engine.js
 */

import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('#copilot/bridges', () => ({ emitNerv: vi.fn() }));
vi.mock('#copilot/config', async (importOriginal) => {
    const actual = /** @type {any} */ (await importOriginal());
    return {
        ...actual,
        LLM_B_BOOT_TIMEOUT_MS: 60_000,
        LLM_B_TURN_TIMEOUT_MS: 120_000,
        LLM_B_BOOT_PROMPT: undefined,
        LLM_B_DIALOG_QUEUE_MAX: 10,
    };
});
vi.mock('#copilot/core', async (importOriginal) => {
    const actual = /** @type {any} */ (await importOriginal());
    return {
        ...actual,
        container: { resolve: vi.fn(() => ({})) },
        toError: (/** @type {any} */ e) => e,
        registerShutdownHandler: vi.fn(),
        runShutdown: vi.fn(async () => []),
        isShuttingDown: vi.fn(() => false),
    };
});
vi.mock('#copilot/observability', async (importOriginal) => {
    const actual = /** @type {any} */ (await importOriginal());
    return {
        ...actual,
        log: vi.fn(),
        METRICS_STORE: Symbol.for('METRICS_STORE'),
    };
});
vi.mock('../../../src/copilot/presentation/dialog-timeout-policy.js', () => ({
    resolveOptionalDialogTimeout: vi.fn(() => ({
        timeoutMs: null,
        strategy: 'disabled',
        reasons: ['caller_disabled'],
    })),
}));
vi.mock('../../../src/copilot/presentation/files/context.js', () => ({
    embedMultiple: vi.fn(async () => []),
    readFileContext: vi.fn(async () => null),
}));
vi.mock('../../../src/copilot/presentation/state/index.js', () => ({
    clearAttachments: vi.fn(),
    getAttachmentQueue: vi.fn(() => []),
    getHubSessionId: vi.fn(() => null),
    getRl: vi.fn(() => null),
    getShowStreaming: vi.fn(() => false),
    getShowThinking: vi.fn(() => false),
    getShowUsage: vi.fn(() => false),
    setBusy: vi.fn(),
    setShowStreaming: vi.fn(),
    setShowThinking: vi.fn(),
    setShowUsage: vi.fn(),
    getShowToolActivity: vi.fn(() => false),
    setShowToolActivity: vi.fn(),
    getShowIntentActivity: vi.fn(() => false),
    setShowIntentActivity: vi.fn(),
    getShowSessionActivity: vi.fn(() => false),
    setShowSessionActivity: vi.fn(),
}));
vi.mock('../../../src/copilot/terminal/state/activity-state.js', () => ({
    markTerminalActivityIdle: vi.fn(),
    recordTerminalActivity: vi.fn(),
}));
vi.mock('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js', () => ({
    readTerminalDialogStreamMeta: vi.fn(() => ({ model: 'gpt-5-mini', reasoningEffort: 'medium' })),
    readTerminalRuntimeControlState: vi.fn(() => ({
        status: 'idle',
        model: 'gpt-5-mini',
        reasoningEffort: 'medium',
        sessionId: null,
        dialogLoopActive: true,
        dialogPaused: false,
        queueSize: 0,
    })),
    readTerminalRuntimeState: vi.fn(() => ({
        runtimeId: 'default',
        model: 'gpt-5-mini',
        reasoningEffort: 'medium',
        status: 'idle',
        sessionId: null,
        dialogLoopActive: true,
        dialogPaused: false,
        queueSize: 0,
        pendingQuestion: null,
        pendingQuestionKind: null,
        pendingQuestionShadow: null,
        pendingQuestionShadowKind: null,
        pendingQuestionShadowState: null,
        pendingQuestionShadowExpired: false,
        pendingQuestionShadowAgeMs: null,
        pendingQuestionShadowExpiresAt: null,
        pendingQuestionShadowRemainingMs: null,
        contextWindow: null,
        lastPrInfo: null,
    })),
    startTerminalAgentRuntime: vi.fn(async () => undefined),
}));
vi.mock('../../../src/copilot/terminal/frontend/gateways/dialog.js', () => ({
    runTerminalDialogTurn: vi.fn(async () => 'ok'),
    startTerminalDialogMode: vi.fn(async () => undefined),
}));
vi.mock('../../../src/copilot/terminal/dialog/engine-persistence.js', () => ({
    drainPendingNotifications: vi.fn(() => []),
    getPersistenceFailureCount: vi.fn(() => 0),
    persistTurnToHub: vi.fn(async () => undefined),
}));
vi.mock('../../../src/copilot/terminal/dialog/sse.js', () => ({ broadcastSse: vi.fn() }));
vi.mock('../../../src/copilot/terminal/dialog/turn-display.js', () => ({
    createDeltaCallback: vi.fn(() => () => {}),
    createDisplayState: vi.fn(() => ({})),
    createReasoningCallback: vi.fn(() => () => {}),
    renderStreamingFooter: vi.fn(),
}));

/** @type {any} */
let mod;
/** @type {string} */
let src;

beforeAll(async () => {
    mod = await import('../../../src/copilot/terminal/dialog/engine.js');
    src = await readFile(new URL('../../../src/copilot/terminal/dialog/engine.js', import.meta.url), 'utf-8');
});

describe('terminal/dialog/engine.js — contrato', () => {
    it('importa sem erros', async () => {
        expect(mod).toBeTruthy();
    });

    it('exporta sendTurn', async () => {
        expect(typeof mod.sendTurn).toBe('function');
    });

    it('exporta ensureDialogLoop', async () => {
        expect(typeof mod.ensureDialogLoop).toBe('function');
    });

    it('exporta getTurnQueueDepth', async () => {
        expect(typeof mod.getTurnQueueDepth).toBe('function');
    });

    it('pausa o boot do dialog loop quando a policy SDK bloqueia reconnect por auth', async () => {
        const runtime = await import('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js');
        const nerv = await import('#copilot/bridges');

        vi.mocked(runtime.readTerminalRuntimeControlState).mockReturnValue({
            model: 'gpt-5-mini',
            reasoningEffort: 'medium',
            sessionId: null,
            dialogLoopActive: false,
            dialogPaused: false,
            status: 'stopped',
            queueSize: 0,
        });
        vi.mocked(runtime.readTerminalRuntimeState).mockReturnValue({
            runtimeId: 'default',
            model: 'gpt-5-mini',
            reasoningEffort: 'medium',
            status: 'idle',
            sessionId: null,
            dialogLoopActive: false,
            dialogPaused: false,
            queueSize: 0,
            pendingQuestion: null,
            pendingQuestionKind: null,
            pendingQuestionShadow: null,
            pendingQuestionShadowKind: null,
            pendingQuestionShadowState: null,
            pendingQuestionShadowExpired: false,
            pendingQuestionShadowAgeMs: null,
            pendingQuestionShadowExpiresAt: null,
            pendingQuestionShadowRemainingMs: null,
            contextWindow: null,
            lastPrInfo: null,
        });
        vi.mocked(runtime.startTerminalAgentRuntime).mockRejectedValueOnce(
            Object.assign(new Error('unauthorized'), { status: 401 }),
        );

        await expect(mod.ensureDialogLoop()).resolves.toBeUndefined();
        expect(vi.mocked(nerv.emitNerv)).toHaveBeenCalledWith(
            'copilot:dialog:boot_blocked',
            expect.objectContaining({ reason: 'sdk_auth' }),
        );
    });

    it('pausa o boot do dialog loop quando a policy SDK bloqueia reconnect por rate_limit', async () => {
        const runtime = await import('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js');
        const nerv = await import('#copilot/bridges');

        vi.mocked(runtime.readTerminalRuntimeControlState).mockReturnValue({
            model: 'gpt-5-mini',
            reasoningEffort: 'medium',
            sessionId: null,
            dialogLoopActive: false,
            dialogPaused: false,
            status: 'stopped',
            queueSize: 0,
        });
        vi.mocked(runtime.readTerminalRuntimeState).mockReturnValue({
            runtimeId: 'default',
            model: 'gpt-5-mini',
            reasoningEffort: 'medium',
            status: 'idle',
            sessionId: null,
            dialogLoopActive: false,
            dialogPaused: false,
            queueSize: 0,
            pendingQuestion: null,
            pendingQuestionKind: null,
            pendingQuestionShadow: null,
            pendingQuestionShadowKind: null,
            pendingQuestionShadowState: null,
            pendingQuestionShadowExpired: false,
            pendingQuestionShadowAgeMs: null,
            pendingQuestionShadowExpiresAt: null,
            pendingQuestionShadowRemainingMs: null,
            contextWindow: null,
            lastPrInfo: null,
        });
        vi.mocked(runtime.startTerminalAgentRuntime).mockRejectedValueOnce(
            Object.assign(new Error('Too many requests'), { status: 429 }),
        );

        await expect(mod.ensureDialogLoop()).resolves.toBeUndefined();
        expect(vi.mocked(nerv.emitNerv)).toHaveBeenCalledWith(
            'copilot:dialog:boot_blocked',
            expect.objectContaining({
                reason: 'sdk_rate_limit',
                actionHint: expect.stringContaining('/model auto'),
            }),
        );
    });

    it('envia turnos interativos em modo watchdog-only (timeout nulo) por contrato estrutural', () => {
        expect(src).toContain('resolveOptionalDialogTimeout({');
        expect(src).toContain('explicitTimeoutMs: 0');
        expect(src).toContain('allowDisabled: true');
        expect(src).toContain('timeout: timeoutDecision.timeoutMs');
    });
});
