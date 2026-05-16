// @ts-check
/**
 * tests/unit/copilot/test_terminal_dialog_output.spec.js
 *
 * Contrato: terminal/dialog/output.js
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('#copilot/config', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        LLM_B_BOOT_PROMPT: undefined,
        LLM_B_TURN_TIMEOUT_MS: 120_000,
    };
});
vi.mock('../../../src/copilot/presentation/state/index.js', () => ({
    getBusy: vi.fn(() => false),
    getRl: vi.fn(() => null),
    getSdkSessionMode: vi.fn(() => 'interactive'),
    getShowThinking: vi.fn(() => false),
    setShowThinking: vi.fn(),
    getShowStreaming: vi.fn(() => false),
    setShowStreaming: vi.fn(),
    getShowUsage: vi.fn(() => false),
    setShowUsage: vi.fn(),
    getShowToolActivity: vi.fn(() => false),
    setShowToolActivity: vi.fn(),
    getShowIntentActivity: vi.fn(() => false),
    setShowIntentActivity: vi.fn(),
    getShowSessionActivity: vi.fn(() => false),
    setShowSessionActivity: vi.fn(),
}));
vi.mock('../../../src/copilot/terminal/state/activity-state.js', () => ({
    readTerminalActivitySnapshot: vi.fn(() => ({ phase: 'boot', label: 'initial' })),
}));
vi.mock('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js', () => ({
    readTerminalDialogStreamMeta: vi.fn(() => ({ model: 'gpt-5-mini', reasoningEffort: 'medium' })),
    readTerminalRuntimeState: vi.fn(() => ({
        dialogLoopActive: true,
        model: 'gpt-5-mini',
        reasoningEffort: 'medium',
        dialogPaused: false,
        queueSize: 0,
        pendingQuestion: null,
        pendingQuestionKind: null,
        pendingQuestionShadowState: null,
    })),
}));

describe('terminal/dialog/output.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/output.js');
        expect(mod).toBeTruthy();
    });

    it('exporta BOOT_PROMPT', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/output.js');
        expect(mod.BOOT_PROMPT).toBeDefined();
    });

    it('exporta PROMPT_USER', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/output.js');
        expect(mod.PROMPT_USER).toBeDefined();
    });

    it('exporta buildUserPrompt', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/output.js');
        expect(typeof mod.buildUserPrompt).toBe('function');
    });

    it('exporta buildWaitingPrompt', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/output.js');
        expect(typeof mod.buildWaitingPrompt).toBe('function');
    });

    it('exporta SEPARATOR', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/output.js');
        expect(mod.SEPARATOR).toBeDefined();
    });

    it('expõe utilitário ANSI para cálculo seguro de largura visual', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/output.js');
        expect(mod.stripAnsiEscapes('\x1b[32mLLM-B\x1b[0m')).toBe('LLM-B');
    });
});
