// @ts-check
/**
 * Ponte canônica para expor o ToolCallRegistry ativo da sessão atual para módulos que não recebem DI direta.
 *
 * Uso principal: correlacionar `io.operation` com tool calls em voo na emissão de `tool.lifecycle` (F3.2).
 *
 * @module copilot/terminal/state/active-tool-call-registry
 */

/** @type {ReturnType<import('./tool-call-registry.js').createToolCallRegistry> | null} */
let _activeToolCallRegistry = null;

/**
 * Define o ToolCallRegistry ativo da sessão.
 *
 * @param {ReturnType<import('./tool-call-registry.js').createToolCallRegistry> | null} registry
 * @returns {void}
 */
export function setActiveToolCallRegistry(registry) {
    _activeToolCallRegistry = registry;
}

/**
 * Lê o ToolCallRegistry ativo da sessão.
 *
 * @returns {ReturnType<import('./tool-call-registry.js').createToolCallRegistry> | null}
 */
export function getActiveToolCallRegistry() {
    return _activeToolCallRegistry;
}

/**
 * Limpa referência do ToolCallRegistry ativo.
 *
 * @returns {void}
 */
export function clearActiveToolCallRegistry() {
    _activeToolCallRegistry = null;
}
