// @ts-check
/**
 * tests/unit/copilot/test_terminal_event_adapters.spec.js
 *
 * Contrato: terminal/event-adapters.js
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getBusy: vi.fn(() => false),
    /** @type {import('vitest').Mock<(...args: any[]) => () => void>} */
    setupTerminalAgentRuntimeEventListeners: vi.fn(() => vi.fn()),
    /** @type {import('vitest').Mock<(...args: any[]) => () => void>} */
    setupTerminalSdkSessionEventListeners: vi.fn(() => vi.fn()),
    buildUserPrompt: vi.fn(() => 'prompt> '),
    readTerminalAgentRuntimeEventHost: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
}));

vi.mock('../../../src/copilot/presentation/runtime-ui-state-store.js', () => ({
    getBusy: mocks.getBusy,
}));

vi.mock('../../../src/copilot/terminal/agent-runtime-events.js', () => ({
    setupTerminalAgentRuntimeEventListeners: mocks.setupTerminalAgentRuntimeEventListeners,
}));

vi.mock('../../../src/copilot/terminal/sdk-session-events.js', () => ({
    setupTerminalSdkSessionEventListeners: mocks.setupTerminalSdkSessionEventListeners,
}));

vi.mock('../../../src/copilot/terminal/dialog/index.js', () => ({
    buildUserPrompt: mocks.buildUserPrompt,
}));

vi.mock('../../../src/copilot/terminal/frontend/llm-b-runtime.js', () => ({
    readTerminalAgentRuntimeEventHost: mocks.readTerminalAgentRuntimeEventHost,
}));

describe('terminal/event-adapters.js — contrato', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('registra adapters runtime + SDK por uma suite única em modo interativo', async () => {
        const { setupTerminalInteractiveEventAdapters } =
            await import('../../../src/copilot/terminal/event-adapters.js');
        const rl = { setPrompt: vi.fn(), prompt: vi.fn() };

        const cleanup = setupTerminalInteractiveEventAdapters(/** @type {any} */ (rl));
        const sdkArgs = /** @type {{ refreshPromptIfIdle: () => void }} */ (
            mocks.setupTerminalSdkSessionEventListeners.mock.calls[0]?.[0]
        );
        sdkArgs.refreshPromptIfIdle();
        cleanup();

        expect(mocks.setupTerminalAgentRuntimeEventListeners).toHaveBeenCalledWith(expect.objectContaining({ rl }));
        expect(mocks.setupTerminalSdkSessionEventListeners).toHaveBeenCalledWith(
            expect.objectContaining({ agent: expect.any(Object), refreshPromptIfIdle: expect.any(Function) }),
        );
        expect(rl.setPrompt).toHaveBeenCalledWith('prompt> ');
        expect(rl.prompt).toHaveBeenCalled();
    });

    it('registra os mesmos adapters em headless sem readline/prompt', async () => {
        const { setupTerminalHeadlessEventAdapters } = await import('../../../src/copilot/terminal/event-adapters.js');

        setupTerminalHeadlessEventAdapters();
        const sdkArgs = /** @type {{ refreshPromptIfIdle: () => void }} */ (
            mocks.setupTerminalSdkSessionEventListeners.mock.calls.at(-1)?.[0]
        );
        sdkArgs.refreshPromptIfIdle();

        expect(mocks.setupTerminalAgentRuntimeEventListeners).toHaveBeenCalledWith(
            expect.objectContaining({ rl: null }),
        );
        expect(mocks.buildUserPrompt).not.toHaveBeenCalled();
    });
});
