// @ts-check
/**
 * src/copilot/config/system-prompt/mode.js
 *
 * Flag de modo do system prompt: 'replace' (controle total) ou 'customize' (SDK-managed com overrides). Default:
 * 'replace' para máximo controle.
 *
 * @module copilot/config/system-prompt/mode
 */

/**
 * Modos de operação do system prompt.
 *
 * @typedef {'replace' | 'customize'} SystemPromptMode
 */

/** @type {SystemPromptMode} */
let _mode = /** @type {SystemPromptMode} */ (process.env.COPILOT_SYSTEM_PROMPT_MODE || 'replace');

/**
 * Retorna o modo atual do system prompt.
 *
 * @returns {SystemPromptMode}
 */
export function getMode() {
    return _mode;
}

/**
 * Altera o modo do system prompt em runtime.
 *
 * @param {SystemPromptMode} mode
 */
export function setMode(mode) {
    _mode = mode;
}
