// @ts-check
/**
 * @module copilot/agent/runtime-registry
 * @file Registry canônica dos runtimes de agent conhecidos neste processo.
 *
 *   Esta camada prepara a transição do singleton implícito para um modelo explícito de runtime default + runtimes
 *   nomeados, sem quebrar a API pública atual baseada em `getAgent()`.
 */

/**
 * @typedef {import('./always-alive.js').AlwaysAliveAgent} AgentRuntime
 */

/** @type {'default'} */
export const DEFAULT_AGENT_RUNTIME_ID = 'default';

/** @type {Map<string, AgentRuntime>} */
const _runtimeRegistry = new Map();

/** @type {string} */
let _defaultRuntimeId = DEFAULT_AGENT_RUNTIME_ID;

/**
 * Registra ou sobrescreve um runtime de agent sob um `runtimeId` estável.
 *
 * @param {AgentRuntime} runtime
 * @param {string} [runtimeId='default'] Default is `'default'`
 * @returns {AgentRuntime}
 */
export function registerAgentRuntime(runtime, runtimeId = DEFAULT_AGENT_RUNTIME_ID) {
    _runtimeRegistry.set(runtimeId, runtime);
    return runtime;
}

/**
 * Remove um runtime registrado.
 *
 * @param {string} [runtimeId='default'] Default is `'default'`
 * @returns {boolean}
 */
export function unregisterAgentRuntime(runtimeId = DEFAULT_AGENT_RUNTIME_ID) {
    return _runtimeRegistry.delete(runtimeId);
}

/**
 * Indica se existe um runtime registrado para o `runtimeId` informado.
 *
 * @param {string} [runtimeId='default'] Default is `'default'`
 * @returns {boolean}
 */
export function hasAgentRuntime(runtimeId = DEFAULT_AGENT_RUNTIME_ID) {
    return _runtimeRegistry.has(runtimeId);
}

/**
 * Retorna um runtime registrado explicitamente, ou `null` se ausente.
 *
 * @param {string} [runtimeId='default'] Default is `'default'`
 * @returns {AgentRuntime | null}
 */
export function getRegisteredAgentRuntime(runtimeId = DEFAULT_AGENT_RUNTIME_ID) {
    return _runtimeRegistry.get(runtimeId) ?? null;
}

/**
 * Retorna todos os runtimes registrados com seus respectivos ids.
 *
 * @returns {{ runtimeId: string; runtime: AgentRuntime }[]}
 */
export function listAgentRuntimes() {
    return Array.from(_runtimeRegistry.entries(), ([runtimeId, runtime]) => ({ runtimeId, runtime }));
}

/**
 * Retorna o id do runtime default atualmente configurado.
 *
 * @returns {string}
 */
export function getDefaultAgentRuntimeId() {
    return _defaultRuntimeId;
}

/**
 * Define qual `runtimeId` deve ser tratado como runtime default.
 *
 * @param {string} runtimeId
 * @returns {void}
 * @throws {Error} Quando o runtime informado não estiver registrado
 */
export function setDefaultAgentRuntimeId(runtimeId) {
    if (!_runtimeRegistry.has(runtimeId)) {
        throw new Error(`AGENT_RUNTIME_NOT_FOUND:${runtimeId}`);
    }
    _defaultRuntimeId = runtimeId;
}

/**
 * Retorna o runtime explicitamente marcado como default, quando já registrado.
 *
 * @returns {AgentRuntime | null}
 */
export function getDefaultRegisteredAgentRuntime() {
    return getRegisteredAgentRuntime(_defaultRuntimeId);
}

/**
 * Limpa a registry para cenários controlados de teste.
 *
 * @returns {void}
 */
export function clearAgentRuntimeRegistry() {
    _runtimeRegistry.clear();
    _defaultRuntimeId = DEFAULT_AGENT_RUNTIME_ID;
}
