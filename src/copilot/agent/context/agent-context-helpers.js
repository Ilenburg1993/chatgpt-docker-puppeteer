// @ts-check
/**
 * src/copilot/agent/context/agent-context-helpers.js
 *
 * Funções utilitárias puras para normalização e leitura de entradas do registry de tools no AgentContext. Extraídas de
 * `agent-context.js` na Faixa C3.1 — não há dependências de runtime, testáveis isoladamente.
 *
 * @module copilot/agent/context/agent-context-helpers
 * @internal
 */

/**
 * Converte um valor arbitrário em `Record<string, unknown>`, retornando `{}` para não-objetos.
 *
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function asRecord(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * Filtra um array de valores arbitrários, retornando apenas as strings.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function asStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/**
 * Normaliza uma entrada do tool registry para o shape público serializado.
 *
 * @param {string} name
 * @param {unknown} entryValue
 * @returns {{
 *     name: string;
 *     description: string | null;
 *     category: string;
 *     tags: string[];
 *     readOnly: boolean;
 *     skipPermission: boolean;
 *     hasParameters: boolean;
 * }}
 */
export function normalizeToolRegistryEntry(name, entryValue) {
    const entry = asRecord(entryValue);
    const tool = asRecord(entry['tool']);
    const toolName = typeof tool['name'] === 'string' && tool['name'] ? tool['name'] : name;
    return {
        name: toolName,
        description: typeof tool['description'] === 'string' ? tool['description'] : null,
        category: typeof entry['category'] === 'string' ? entry['category'] : 'uncategorized',
        tags: asStringArray(entry['tags']),
        readOnly: entry['readOnly'] === true,
        skipPermission: tool['skipPermission'] === true,
        hasParameters:
            tool['parameters'] !== undefined && tool['parameters'] !== null && typeof tool['parameters'] === 'object',
    };
}
