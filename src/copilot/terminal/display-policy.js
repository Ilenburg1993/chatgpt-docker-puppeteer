// @ts-check
/**
 * @module copilot/terminal/display-policy
 * @file Policy canonica de densidade visual do terminal.
 *
 *   A store de presentation continua sendo a SSOT dos booleans vivos. Este modulo governa presets, nomes, labels e como
 *   os toggles impactam prompt/waiting/adapters do terminal.
 */

import {
    getShowIntentActivity,
    getShowStreaming,
    getShowThinking,
    getShowToolActivity,
    getShowUsage,
    setShowIntentActivity,
    setShowStreaming,
    setShowThinking,
    setShowToolActivity,
    setShowUsage,
} from '../presentation/runtime-ui-state-store.js';

/**
 * @typedef {'thinking' | 'streaming' | 'usage' | 'tools' | 'intent'} TerminalDisplayToggle
 *
 * @typedef {Record<TerminalDisplayToggle, boolean>} TerminalDisplayState
 *
 * @typedef {'default' | 'minimal' | 'verbose' | 'debug' | 'focus'} TerminalDisplayPresetName
 *
 * @typedef {{
 *     key: TerminalDisplayToggle;
 *     label: string;
 *     command: string;
 * }} TerminalDisplayToggleDescriptor
 *
 *
 * @typedef {{
 *     name: TerminalDisplayPresetName;
 *     label: string;
 *     description: string;
 *     state: TerminalDisplayState;
 * }} TerminalDisplayPresetDescriptor
 *
 *
 * @typedef {{
 *     density: TerminalDisplayPresetName | 'custom';
 *     state: TerminalDisplayState;
 *     showWaitingActivity: boolean;
 *     showWaitingRuntimeTags: boolean;
 *     showQueueTag: boolean;
 *     showNonCriticalShadowTag: boolean;
 * }} TerminalPromptDisplayPolicy
 */

/** @type {readonly TerminalDisplayToggle[]} */
export const TERMINAL_DISPLAY_TOGGLE_KEYS = Object.freeze(['thinking', 'streaming', 'usage', 'tools', 'intent']);

/** @type {Record<TerminalDisplayToggle, TerminalDisplayToggleDescriptor>} */
const TOGGLE_DESCRIPTORS = Object.freeze({
    thinking: { key: 'thinking', label: 'Thinking (raciocínio)', command: '/display thinking [on|off]' },
    streaming: { key: 'streaming', label: 'Streaming (resposta incremental)', command: '/display streaming [on|off]' },
    usage: { key: 'usage', label: 'Usage (tokens pós-turno)', command: '/display usage [on|off]' },
    tools: { key: 'tools', label: 'Tool activity (início/fim/progresso)', command: '/display tools [on|off]' },
    intent: { key: 'intent', label: 'Intent (o que a LLM-B está tentando fazer)', command: '/display intent [on|off]' },
});

/** @type {Record<TerminalDisplayPresetName, TerminalDisplayPresetDescriptor>} */
export const TERMINAL_DISPLAY_PRESETS = Object.freeze({
    default: {
        name: 'default',
        label: 'Default',
        description: 'Equilíbrio operacional: resposta incremental, usage, tools e intent.',
        state: Object.freeze({ thinking: false, streaming: true, usage: true, tools: true, intent: true }),
    },
    minimal: {
        name: 'minimal',
        label: 'Minimal',
        description: 'Prompt limpo para leitura longa; só estados críticos aparecem.',
        state: Object.freeze({ thinking: false, streaming: false, usage: false, tools: false, intent: false }),
    },
    verbose: {
        name: 'verbose',
        label: 'Verbose',
        description: 'Exibe todos os sinais humanos úteis durante turnos normais.',
        state: Object.freeze({ thinking: true, streaming: true, usage: true, tools: true, intent: true }),
    },
    debug: {
        name: 'debug',
        label: 'Debug',
        description: 'Mesmo volume do verbose, reservado para troubleshooting.',
        state: Object.freeze({ thinking: true, streaming: true, usage: true, tools: true, intent: true }),
    },
    focus: {
        name: 'focus',
        label: 'Focus',
        description: 'Oculta streaming/intent, mantendo usage e lifecycle de tools.',
        state: Object.freeze({ thinking: false, streaming: false, usage: true, tools: true, intent: false }),
    },
});

/** @type {Record<TerminalDisplayToggle, { get: () => boolean; set: (value: boolean) => void }>} */
const TOGGLE_ACCESSORS = Object.freeze({
    thinking: { get: getShowThinking, set: setShowThinking },
    streaming: { get: getShowStreaming, set: setShowStreaming },
    usage: { get: getShowUsage, set: setShowUsage },
    tools: { get: getShowToolActivity, set: setShowToolActivity },
    intent: { get: getShowIntentActivity, set: setShowIntentActivity },
});

/**
 * @param {unknown} value
 * @returns {value is TerminalDisplayToggle}
 */
export function isTerminalDisplayToggle(value) {
    return (
        typeof value === 'string' && TERMINAL_DISPLAY_TOGGLE_KEYS.includes(/** @type {TerminalDisplayToggle} */ (value))
    );
}

/**
 * @param {unknown} value
 * @returns {value is TerminalDisplayPresetName}
 */
export function isTerminalDisplayPresetName(value) {
    return typeof value === 'string' && Object.hasOwn(TERMINAL_DISPLAY_PRESETS, value);
}

/**
 * @returns {TerminalDisplayToggleDescriptor[]}
 */
export function listTerminalDisplayToggles() {
    return TERMINAL_DISPLAY_TOGGLE_KEYS.map((key) => TOGGLE_DESCRIPTORS[key]);
}

/**
 * @returns {TerminalDisplayPresetDescriptor[]}
 */
export function listTerminalDisplayPresets() {
    return Object.values(TERMINAL_DISPLAY_PRESETS);
}

/**
 * @returns {TerminalDisplayState}
 */
export function readTerminalDisplayState() {
    return {
        thinking: getShowThinking(),
        streaming: getShowStreaming(),
        usage: getShowUsage(),
        tools: getShowToolActivity(),
        intent: getShowIntentActivity(),
    };
}

/**
 * @param {TerminalDisplayState} state
 * @returns {void}
 */
export function writeTerminalDisplayState(state) {
    for (const key of TERMINAL_DISPLAY_TOGGLE_KEYS) {
        TOGGLE_ACCESSORS[key].set(Boolean(state[key]));
    }
}

/**
 * @param {TerminalDisplayToggle} toggle
 * @param {boolean} value
 * @returns {void}
 */
export function writeTerminalDisplayToggle(toggle, value) {
    TOGGLE_ACCESSORS[toggle].set(value);
}

/**
 * @param {TerminalDisplayPresetName} presetName
 * @returns {TerminalDisplayPresetDescriptor}
 */
export function readTerminalDisplayPreset(presetName) {
    return TERMINAL_DISPLAY_PRESETS[presetName];
}

/**
 * @param {TerminalDisplayPresetName} presetName
 * @returns {TerminalDisplayPresetDescriptor}
 */
export function applyTerminalDisplayPreset(presetName) {
    const preset = readTerminalDisplayPreset(presetName);
    writeTerminalDisplayState(preset.state);
    return preset;
}

/**
 * @param {TerminalDisplayState} state
 * @returns {TerminalDisplayPresetName | 'custom'}
 */
export function resolveTerminalDisplayPresetName(state) {
    for (const preset of listTerminalDisplayPresets()) {
        if (TERMINAL_DISPLAY_TOGGLE_KEYS.every((key) => preset.state[key] === state[key])) {
            return preset.name;
        }
    }
    return 'custom';
}

/**
 * @param {TerminalDisplayState} [state]
 * @returns {TerminalPromptDisplayPolicy}
 */
export function readTerminalPromptDisplayPolicy(state = readTerminalDisplayState()) {
    const density = resolveTerminalDisplayPresetName(state);
    const showWaitingActivity = state.streaming || state.tools || state.intent;
    return {
        density,
        state,
        showWaitingActivity,
        showWaitingRuntimeTags: state.tools || state.intent || state.usage,
        showQueueTag: state.tools || state.intent,
        showNonCriticalShadowTag: state.tools || state.intent || density !== 'minimal',
    };
}
