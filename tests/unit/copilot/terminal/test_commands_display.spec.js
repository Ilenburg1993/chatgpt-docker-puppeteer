// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const stateStore = vi.hoisted(() => ({
    getShowThinking: vi.fn(() => false),
    getShowStreaming: vi.fn(() => true),
    getShowUsage: vi.fn(() => true),
    getShowToolActivity: vi.fn(() => true),
    getShowIntentActivity: vi.fn(() => true),
    setShowThinking: vi.fn(),
    setShowStreaming: vi.fn(),
    setShowUsage: vi.fn(),
    setShowToolActivity: vi.fn(),
    setShowIntentActivity: vi.fn(),
}));

vi.mock('../../../../src/copilot/presentation/runtime-ui-state-store.js', () => ({
    getShowThinking: stateStore.getShowThinking,
    getShowStreaming: stateStore.getShowStreaming,
    getShowUsage: stateStore.getShowUsage,
    getShowToolActivity: stateStore.getShowToolActivity,
    getShowIntentActivity: stateStore.getShowIntentActivity,
    setShowThinking: stateStore.setShowThinking,
    setShowStreaming: stateStore.setShowStreaming,
    setShowUsage: stateStore.setShowUsage,
    setShowToolActivity: stateStore.setShowToolActivity,
    setShowIntentActivity: stateStore.setShowIntentActivity,
}));

import { cmdDisplay } from '../../../../src/copilot/terminal/commands/display.js';
import {
    listTerminalDisplayPresets,
    readTerminalPromptDisplayPolicy,
} from '../../../../src/copilot/terminal/display-policy.js';

function ctx() {
    const lines = /** @type {string[]} */ ([]);
    return {
        println: vi.fn((line) => lines.push(line)),
        output: () => lines.join('\n'),
    };
}

describe('terminal/commands/display', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('mostra ajuda com presets quando chamado sem argumentos', () => {
        const c = ctx();
        cmdDisplay({ println: c.println });
        expect(c.output()).toContain('Display Toggles');
        expect(c.output()).toContain('preset atual');
        expect(c.output()).toContain('/display preset <default|minimal|verbose|debug|focus>');
    });

    it('declara presets como contrato reutilizável de UX', () => {
        expect(listTerminalDisplayPresets().map((preset) => preset.name)).toEqual([
            'default',
            'minimal',
            'verbose',
            'debug',
            'focus',
        ]);
        expect(
            readTerminalPromptDisplayPolicy({
                thinking: false,
                streaming: false,
                usage: false,
                tools: false,
                intent: false,
            }),
        ).toMatchObject({
            density: 'minimal',
            showWaitingActivity: false,
        });
    });

    it('aplica preset minimal', () => {
        const c = ctx();
        cmdDisplay({ println: c.println }, 'preset', ['minimal']);

        expect(stateStore.setShowThinking).toHaveBeenCalledWith(false);
        expect(stateStore.setShowStreaming).toHaveBeenCalledWith(false);
        expect(stateStore.setShowUsage).toHaveBeenCalledWith(false);
        expect(stateStore.setShowToolActivity).toHaveBeenCalledWith(false);
        expect(stateStore.setShowIntentActivity).toHaveBeenCalledWith(false);
        expect(c.output()).toContain('Preset aplicado');
    });

    it('aplica preset debug', () => {
        const c = ctx();
        cmdDisplay({ println: c.println }, 'preset', ['debug']);

        expect(stateStore.setShowThinking).toHaveBeenCalledWith(true);
        expect(stateStore.setShowStreaming).toHaveBeenCalledWith(true);
        expect(stateStore.setShowUsage).toHaveBeenCalledWith(true);
        expect(stateStore.setShowToolActivity).toHaveBeenCalledWith(true);
        expect(stateStore.setShowIntentActivity).toHaveBeenCalledWith(true);
    });

    it('valida uso de preset inválido', () => {
        const c = ctx();
        cmdDisplay({ println: c.println }, 'preset', ['xpto']);
        expect(c.output()).toContain('Uso: /display preset');
    });
});
