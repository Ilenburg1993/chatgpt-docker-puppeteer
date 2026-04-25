// @ts-check
/**
 * tests/unit/copilot/test_terminal_dialog_engine.spec.js
 *
 * Contrato: terminal/dialog/engine.js
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('#copilot/bridges', () => ({ emitNerv: vi.fn() }));
vi.mock('#copilot/config', () => ({
    LLM_B_BOOT_TIMEOUT_MS: 60_000,
    LLM_B_TURN_TIMEOUT_MS: 120_000,
    LLM_B_BOOT_PROMPT: undefined,
}));
vi.mock('#copilot/core', () => ({ container: { resolve: vi.fn(() => ({})) }, toError: (/** @type {any} */ e) => e }));
vi.mock('#copilot/observability', () => ({ log: vi.fn(), METRICS_STORE: Symbol.for('METRICS_STORE') }));
vi.mock('../../../src/copilot/presentation/dialog-timeout-policy.js', () => ({
    computeAdaptiveDialogTimeout: vi.fn(() => ({ timeoutMs: 120000, strategy: 'adaptive', reasons: ['test'] })),
}));
vi.mock('../../../src/copilot/presentation/runtime-file-context.js', () => ({
    embedMultiple: vi.fn(async () => []),
    readFileContext: vi.fn(async () => null),
}));
vi.mock('../../../src/copilot/presentation/runtime-ui-state-store.js', () => ({
    clearAttachments: vi.fn(),
    getAttachmentQueue: vi.fn(() => []),
    getHubSessionId: vi.fn(() => null),
    getRl: vi.fn(() => null),
    getShowStreaming: vi.fn(() => false),
    getShowThinking: vi.fn(() => false),
    getShowUsage: vi.fn(() => false),
    setBusy: vi.fn(),
}));
vi.mock('../../../src/copilot/terminal/activity-state.js', () => ({
    markTerminalActivityIdle: vi.fn(),
    recordTerminalActivity: vi.fn(),
}));
vi.mock('../../../src/copilot/terminal/frontend/llm-b-runtime.js', () => ({
    readTerminalDialogStreamMeta: vi.fn(() => ({ model: 'gpt-5-mini', reasoningEffort: 'medium' })),
    readTerminalRuntimeControlState: vi.fn(() => ({ dialogLoopActive: true, dialogPaused: false, status: 'idle' })),
    readTerminalRuntimeState: vi.fn(() => ({ status: 'idle', pendingQuestionKind: null })),
    runTerminalDialogTurn: vi.fn(async () => 'ok'),
    startTerminalAgentRuntime: vi.fn(async () => undefined),
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

beforeAll(async () => {
    mod = await import('../../../src/copilot/terminal/dialog/engine.js');
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
});
