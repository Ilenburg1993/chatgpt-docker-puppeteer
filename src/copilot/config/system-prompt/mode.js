// @ts-check
/**
 * src/copilot/config/system-prompt/mode.js
 *
 * Política de modo do system prompt. O default passa a ser `append`, preservando o prompt base do SDK e evitando a
 * substituição silenciosa das guardrails nativas.
 *
 * @module copilot/config/system-prompt/mode
 */

import { normalizeSystemPromptMode, readResolvedSystemPromptUserConfigSync } from './user-config.js';

/**
 * Modos de operação do system prompt.
 *
 * @typedef {import('./user-config.js').SystemPromptMode} SystemPromptMode
 */

/** @type {SystemPromptMode | null} */
let _modeOverride = null;

/**
 * @typedef {{
 *     configuredMode: SystemPromptMode;
 *     effectiveMode: SystemPromptMode;
 *     runtimeOverrideMode: SystemPromptMode | null;
 *     hasRuntimeOverride: boolean;
 * }} SystemPromptModeState
 */

/**
 * Retorna o modo atual do system prompt.
 *
 * @returns {SystemPromptMode}
 */
export function getMode() {
    return _modeOverride ?? readResolvedSystemPromptUserConfigSync().mode;
}

/**
 * Expõe o estado da política de modo para bordas de status/introspecção.
 *
 * @returns {SystemPromptModeState}
 */
export function readSystemPromptModeState() {
    const configuredMode = readResolvedSystemPromptUserConfigSync().mode;
    return {
        configuredMode,
        effectiveMode: _modeOverride ?? configuredMode,
        runtimeOverrideMode: _modeOverride,
        hasRuntimeOverride: _modeOverride !== null,
    };
}

/**
 * Altera o modo do system prompt em runtime.
 *
 * @param {SystemPromptMode} mode
 */
export function setMode(mode) {
    _modeOverride = normalizeSystemPromptMode(mode);
}

/**
 * Remove o override em memória e volta a seguir a configuração declarativa do usuário.
 *
 * @returns {void}
 */
export function resetMode() {
    _modeOverride = null;
}
