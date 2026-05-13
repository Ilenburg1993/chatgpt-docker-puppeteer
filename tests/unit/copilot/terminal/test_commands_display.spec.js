// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const stateStore = vi.hoisted(() => ({
    getShowThinking: vi.fn(() => false),
    getShowStreaming: vi.fn(() => true),
    getShowUsage: vi.fn(() => true),
    getShowToolActivity: vi.fn(() => true),
    getShowIntentActivity: vi.fn(() => true),
    getShowSessionActivity: vi.fn(() => false),
    setShowThinking: vi.fn(),
    setShowStreaming: vi.fn(),
    setShowUsage: vi.fn(),
    setShowToolActivity: vi.fn(),
    setShowIntentActivity: vi.fn(),
    setShowSessionActivity: vi.fn(),
}));

vi.mock('../../../../src/copilot/presentation/state/index.js', () => ({
    getShowThinking: stateStore.getShowThinking,
    getShowStreaming: stateStore.getShowStreaming,
    getShowUsage: stateStore.getShowUsage,
    getShowToolActivity: stateStore.getShowToolActivity,
    getShowIntentActivity: stateStore.getShowIntentActivity,
    getShowSessionActivity: stateStore.getShowSessionActivity,
    setShowThinking: stateStore.setShowThinking,
    setShowStreaming: stateStore.setShowStreaming,
    setShowUsage: stateStore.setShowUsage,
    setShowToolActivity: stateStore.setShowToolActivity,
    setShowIntentActivity: stateStore.setShowIntentActivity,
    setShowSessionActivity: stateStore.setShowSessionActivity,
}));

import { cmdDisplay } from '../../../../src/copilot/terminal/commands/display.js';
import {
    applyTerminalBootDisplayPreset,
    listTerminalDisplayPresets,
    readTerminalPromptDisplayPolicy,
    resolveTerminalBootDisplayPreset,
} from '../../../../src/copilot/terminal/state/display-policy.js';
import {
    getTerminalDetailLevel,
    setTerminalDetailLevel,
} from '../../../../src/copilot/terminal/state/ui-preferences.js';
import { getTerminalThemeName, setTerminalThemeName } from '../../../../src/copilot/terminal/state/ui-theme.js';

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
        setTerminalThemeName('elegant');
        setTerminalDetailLevel('detailed');
    });

    it('mostra ajuda com presets quando chamado sem argumentos', () => {
        const c = ctx();
        cmdDisplay({ println: c.println });
        expect(c.output()).toContain('Display Toggles');
        expect(c.output()).toContain('preset atual');
        expect(c.output()).toContain('tema atual');
        expect(c.output()).toContain('/display preset <default|minimal|verbose|debug|full|focus>');
        expect(c.output()).toContain('/display theme <elegant|vivid|mono>');
        expect(c.output()).toContain('/display detail <compact|detailed>');
    });

    it('declara presets como contrato reutilizável de UX', () => {
        expect(listTerminalDisplayPresets().map((preset) => preset.name)).toEqual([
            'default',
            'minimal',
            'verbose',
            'debug',
            'full',
            'focus',
        ]);
        expect(
            readTerminalPromptDisplayPolicy({
                thinking: false,
                streaming: false,
                usage: false,
                tools: false,
                intent: false,
                session: false,
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
        expect(stateStore.setShowSessionActivity).toHaveBeenCalledWith(false);
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
        expect(stateStore.setShowSessionActivity).toHaveBeenCalledWith(true);
    });

    it('aplica preset full como padrão de boot e valida fallback', () => {
        expect(resolveTerminalBootDisplayPreset(undefined)).toBe('full');
        expect(resolveTerminalBootDisplayPreset('xpto')).toBe('full');
        expect(resolveTerminalBootDisplayPreset('minimal')).toBe('minimal');

        const preset = applyTerminalBootDisplayPreset('full');
        expect(preset.name).toBe('full');
        expect(stateStore.setShowThinking).toHaveBeenCalledWith(true);
        expect(stateStore.setShowStreaming).toHaveBeenCalledWith(true);
        expect(stateStore.setShowSessionActivity).toHaveBeenCalledWith(true);
    });

    it('valida uso de preset inválido', () => {
        const c = ctx();
        cmdDisplay({ println: c.println }, 'preset', ['xpto']);
        expect(c.output()).toContain('Uso: /display preset');
    });

    it('aplica tema de cor elegante/vivid/mono', () => {
        const c = ctx();

        cmdDisplay({ println: c.println }, 'theme', ['vivid']);
        expect(getTerminalThemeName()).toBe('vivid');
        expect(c.output()).toContain('Tema aplicado');

        cmdDisplay({ println: c.println }, 'theme', ['mono']);
        expect(getTerminalThemeName()).toBe('mono');
    });

    it('valida uso de tema inválido', () => {
        const c = ctx();
        cmdDisplay({ println: c.println }, 'theme', ['neon']);
        expect(c.output()).toContain('Uso: /display theme');
    });

    it('aplica nível de detalhe compact/detailed', () => {
        const c = ctx();

        cmdDisplay({ println: c.println }, 'detail', ['compact']);
        expect(getTerminalDetailLevel()).toBe('compact');
        expect(c.output()).toContain('Detalhe aplicado');
    });

    it('valida uso de detalhe inválido', () => {
        const c = ctx();
        cmdDisplay({ println: c.println }, 'detail', ['verbose']);
        expect(c.output()).toContain('Uso: /display detail');
    });
});
