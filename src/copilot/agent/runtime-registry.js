// @ts-check
/**
 * @module copilot/agent/runtime-registry
 * @file Registry canônica dos runtimes de agent conhecidos neste processo.
 *
 *   Esta camada prepara a transição do singleton implícito para um modelo explícito de runtime default + runtimes
 *   nomeados, sem quebrar a API pública atual baseada em `getAgent()`.
 */

/**
 * @typedef {import('./runtime/always-alive/index.js').AlwaysAliveAgent} AgentRuntime
 *
 * @typedef {{ agentProfileId?: string | null }} AgentRuntimeRegistrationOptions
 */

/** @type {'default'} */
export const DEFAULT_AGENT_RUNTIME_ID = 'default';

/** @type {Map<string, AgentRuntime>} */
const _runtimeRegistry = new Map();

/** @type {Map<string, string | null>} */
const _runtimeProfileRegistry = new Map();

/** @type {string} */
let _defaultRuntimeId = DEFAULT_AGENT_RUNTIME_ID;

/**
 * Registra ou sobrescreve um runtime de agent sob um `runtimeId` estável.
 *
 * @param {AgentRuntime} runtime
 * @param {string} [runtimeId='default'] Default is `'default'`
 * @param {AgentRuntimeRegistrationOptions} [options]
 * @returns {AgentRuntime}
 */
export function registerAgentRuntime(runtime, runtimeId = DEFAULT_AGENT_RUNTIME_ID, options = {}) {
    _runtimeRegistry.set(runtimeId, runtime);
    const currentProfile = _runtimeProfileRegistry.get(runtimeId) ?? null;
    const requestedProfile = options.agentProfileId;
    const normalizedProfile =
        requestedProfile === undefined
            ? currentProfile
            : typeof requestedProfile === 'string' && requestedProfile.trim().length > 0
              ? requestedProfile.trim()
              : null;
    _runtimeProfileRegistry.set(runtimeId, normalizedProfile);
    return runtime;
}

/**
 * Remove um runtime registrado.
 *
 * @param {string} [runtimeId='default'] Default is `'default'`
 * @returns {boolean}
 */
export function unregisterAgentRuntime(runtimeId = DEFAULT_AGENT_RUNTIME_ID) {
    _runtimeProfileRegistry.delete(runtimeId);
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
 * @returns {{ runtimeId: string; runtime: AgentRuntime; agentProfileId: string | null }[]}
 */
export function listAgentRuntimes() {
    return Array.from(_runtimeRegistry.entries(), ([runtimeId, runtime]) => ({
        runtimeId,
        runtime,
        agentProfileId: _runtimeProfileRegistry.get(runtimeId) ?? null,
    }));
}

/**
 * Retorna o profile lógico associado a um runtime registrado.
 *
 * @param {string} [runtimeId='default'] Default is `'default'`
 * @returns {string | null}
 */
export function getAgentRuntimeProfileId(runtimeId = DEFAULT_AGENT_RUNTIME_ID) {
    return _runtimeProfileRegistry.get(runtimeId) ?? null;
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
    _runtimeProfileRegistry.clear();
    _defaultRuntimeId = DEFAULT_AGENT_RUNTIME_ID;
}
