// @ts-check
/**
 * src/copilot/sdk/config.js
 *
 * Facade unificada para construção e merge de SessionConfig. Centraliza defaults do projeto, merge seguro de campos e
 * re-exports dos builders de perfil.
 *
 * @module copilot/sdk/config
 * @see EventBus
 */

import { approveAll } from '@github/copilot-sdk';

/**
 * @typedef {import('@github/copilot-sdk').SessionConfig} SessionConfig
 *
 * @typedef {import('@github/copilot-sdk').PermissionHandler} PermissionHandler
 *
 * @typedef {import('@github/copilot-sdk').Tool} Tool
 *
 * @typedef {import('@github/copilot-sdk').SystemMessageConfig} SystemMessageConfig
 *
 * @typedef {import('@github/copilot-sdk').MCPServerConfig} MCPServerConfig
 *
 * @typedef {import('@github/copilot-sdk').CustomAgentConfig} CustomAgentConfig
 *
 * @typedef {import('@github/copilot-sdk').InfiniteSessionConfig} InfiniteSessionConfig
 */

// ─── Defaults canônicos do projeto ────────────────────────────────────────────

/**
 * Modelo default usado no projeto.
 *
 * @type {string}
 */
export const DEFAULT_MODEL = 'gpt-4.1';

/**
 * Modelo leve para diagnósticos e testes.
 *
 * @type {string}
 */
export const DEFAULT_DIAGNOSTIC_MODEL = 'gpt-4.1-mini';

// DEFAULT_EXCLUDED_TOOLS removido — importar diretamente de '#copilot/config/session-config'.
// Cf. PARTE-21C Faixa H: eliminação de violação L1→L2.

/**
 * Configuração default de infinite sessions.
 *
 * @type {InfiniteSessionConfig}
 */
export const DEFAULT_INFINITE_SESSION = Object.freeze({
    enabled: true,
    backgroundCompactionThreshold: 0.75,
});

// ─── getProjectDefaults ───────────────────────────────────────────────────────

/**
 * Retorna os defaults canônicos do projeto para SessionConfig. Todos os campos são opcionais no resultado — servem como
 * fallback no merge.
 *
 * @returns {Partial<SessionConfig>}
 */
export function getProjectDefaults() {
    return {
        model: DEFAULT_MODEL,
        streaming: true,
        infiniteSessions: { ...DEFAULT_INFINITE_SESSION },
        onPermissionRequest: approveAll,
    };
}

// ─── buildSessionConfig ───────────────────────────────────────────────────────

/**
 * Constrói um SessionConfig completo fazendo merge de até 3 camadas:
 *
 * 1. Project defaults (via `getProjectDefaults()`)
 * 2. `defaults` (overrides parciais do chamador)
 * 3. `input` (overrides finais — maior prioridade)
 *
 * Campos do tipo array (tools, availableTools, excludedTools, customAgents, skillDirectories, disabledSkills) são
 * SUBSTITUÍDOS (não concatenados). Campos objeto (infiniteSessions, systemMessage, provider) fazem shallow merge.
 *
 * @param {Partial<SessionConfig>} [input={}] - Overrides de maior prioridade. Default is `{}`
 * @param {Partial<SessionConfig>} [defaults={}] - Overrides intermediários. Default is `{}`
 * @returns {SessionConfig}
 */
export function buildSessionConfig(input = {}, defaults = {}) {
    const base = getProjectDefaults();

    /** @type {Record<string, unknown>} */
    const merged = { ...base, ...defaults, ...input };

    // Shallow merge para campos objeto aninhados (se ambos existem)
    if (base.infiniteSessions || defaults.infiniteSessions || input.infiniteSessions) {
        merged.infiniteSessions = {
            ...(base.infiniteSessions ?? {}),
            ...(defaults.infiniteSessions ?? {}),
            ...(input.infiniteSessions ?? {}),
        };
    }

    // onPermissionRequest é obrigatório — garantir presença
    if (!merged.onPermissionRequest) {
        merged.onPermissionRequest = approveAll;
    }

    return /** @type {SessionConfig} */ (/** @type {unknown} */ (merged));
}

// ─── Helpers de merge ─────────────────────────────────────────────────────────

/**
 * Combina duas listas de tools sem duplicatas por nome. Útil para adicionar custom tools às tools registradas.
 *
 * @param {Tool[]} base - Lista base de tools
 * @param {Tool[]} extra - Tools adicionais a mesclar
 * @returns {Tool[]} Nova lista sem duplicatas (extra tem prioridade)
 */
export function mergeTools(base, extra) {
    /** @type {Map<string, Tool>} */
    const map = new Map();
    for (const t of base) {
        if (t && t.name) map.set(t.name, t);
    }
    for (const t of extra) {
        if (t && t.name) map.set(t.name, t);
    }
    return [...map.values()];
}

/**
 * Combina duas listas de exclusão sem duplicatas.
 *
 * @param {string[]} base - Lista base
 * @param {string[]} extra - Itens adicionais
 * @returns {string[]} Nova lista sem duplicatas
 */
export function mergeExcludedTools(base, extra) {
    return [...new Set([...base, ...extra])];
}

// ─── Re-exports dos builders de perfil ────────────────────────────────────────

// Profile builders removidos — importar diretamente de '#copilot/config/session-config'.
// Cf. PARTE-21C Faixa H: eliminação de violação L1→L2.
