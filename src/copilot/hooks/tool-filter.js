// @ts-check
/**
 * src/copilot/hooks/tool-filter.js
 *
 * E1.1 — Separação de filtering estático para `availableTools`/`excludedTools` do SDK.
 *
 * Antes da Faixa E, o sistema usava hooks `onPreToolUse` para aplicar allowlists/blocklists
 * estáticas. O SDK suporta nativamente `availableTools` e `excludedTools` em `SessionConfig`,
 * que são mais eficientes (filtrados antes de a tool ser oferecida ao modelo).
 *
 * Este módulo extrai as listas estáticas de `HooksConfig` e as converte para os campos SDK
 * nativos, deixando apenas lógica dinâmica (ask, runtime deny, argsModifier) nos hooks.
 *
 * @module copilot/hooks/tool-filter
 * @see EventBus
 */

import { log } from './logger.js';

/**
 * @typedef {import('./types.js').HooksConfig} HooksConfig
 */

/**
 * Resultado da extração de filtros estáticos de um HooksConfig.
 *
 * @typedef {object} StaticFilterResult
 * @property {string[]} [availableTools] Whitelist nativa SDK — se definida, apenas estas tools são visíveis ao modelo
 * @property {string[]} [excludedTools] Blacklist nativa SDK — tools excluídas da visibilidade do modelo
 * @property {HooksConfig} cleanedConfig HooksConfig sem as listas estáticas (preserva lógica dinâmica)
 */

/**
 * Extrai filtros estáticos (allowTools/denyTools) de um `HooksConfig` e os converte
 * para os campos nativos do SDK (`availableTools`/`excludedTools`).
 *
 * Regras de conversão:
 * - `allowTools` → `availableTools` (whitelist SDK, precedência sobre excludedTools)
 * - `denyTools` → `excludedTools` (blacklist SDK)
 * - `denyPatterns` **não** são extraídos (regex não é suportado pelo SDK — permanece nos hooks)
 *
 * @param {HooksConfig} config
 * @returns {StaticFilterResult}
 */
export function extractStaticFilters(config) {
    /** @type {string[] | undefined} */
    let availableTools;
    /** @type {string[] | undefined} */
    let excludedTools;

    const { allowTools, denyTools, denyPatterns, ...rest } = config;

    if (allowTools && allowTools.length > 0) {
        availableTools = [...allowTools];
        log('DEBUG', `[hooks/tool-filter] allowTools → availableTools: [${availableTools.join(', ')}]`);
    }

    if (denyTools && denyTools.length > 0) {
        excludedTools = [...denyTools];
        log('DEBUG', `[hooks/tool-filter] denyTools → excludedTools: [${excludedTools.join(', ')}]`);
    }

    // denyPatterns permanece no config limpo — SDK não suporta regex filtering
    /** @type {HooksConfig} */
    const cleanedConfig = { ...rest };
    if (denyPatterns && denyPatterns.length > 0) {
        cleanedConfig.denyPatterns = denyPatterns;
        log('DEBUG', `[hooks/tool-filter] ${denyPatterns.length} denyPatterns preservados nos hooks (regex ≠ SDK)`);
    }

    return {
        ...(availableTools ? { availableTools } : {}),
        ...(excludedTools ? { excludedTools } : {}),
        cleanedConfig,
    };
}

/**
 * Verifica se um HooksConfig possui apenas lógica dinâmica (sem listas estáticas de allow/deny).
 * Útil para determinar se o onPreToolUse pode ser simplificado.
 *
 * @param {HooksConfig} config
 * @returns {boolean} true se config não tem allowTools, denyTools nem denyPatterns
 */
export function isDynamicOnly(config) {
    const noAllow = !config.allowTools || config.allowTools.length === 0;
    const noDeny = !config.denyTools || config.denyTools.length === 0;
    const noPatterns = !config.denyPatterns || config.denyPatterns.length === 0;
    return noAllow && noDeny && noPatterns;
}

/**
 * Combina dois conjuntos de filtros estáticos (merge aditivo).
 * Usado quando múltiplas fontes contribuem para o filtering (ex: preset + runtime config).
 *
 * @param {StaticFilterResult} a
 * @param {StaticFilterResult} b
 * @returns {{ availableTools?: string[]; excludedTools?: string[] }}
 */
export function mergeStaticFilters(a, b) {
    /** @type {string[] | undefined} */
    let availableTools;
    /** @type {string[] | undefined} */
    let excludedTools;

    // availableTools: interseção (mais restritivo) se ambos definidos, union se apenas um
    if (a.availableTools && b.availableTools) {
        const setB = new Set(b.availableTools);
        availableTools = a.availableTools.filter((t) => setB.has(t));
        log('DEBUG', `[hooks/tool-filter] merge availableTools: interseção → ${availableTools.length} tools`);
    } else {
        availableTools = a.availableTools ?? b.availableTools;
    }

    // excludedTools: union (mais restritivo)
    if (a.excludedTools || b.excludedTools) {
        excludedTools = [...new Set([...(a.excludedTools ?? []), ...(b.excludedTools ?? [])])];
    }

    return {
        ...(availableTools ? { availableTools } : {}),
        ...(excludedTools ? { excludedTools } : {}),
    };
}
