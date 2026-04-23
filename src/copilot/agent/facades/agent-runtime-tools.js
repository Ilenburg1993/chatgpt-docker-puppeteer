// @ts-check
/**
 * @module copilot/agent/facades/agent-runtime-tools
 * @file Leitura semântica das tools disponíveis no runtime do agent.
 *
 *   O registry vivo é materializado pelo SDK e governado pelo AgentContext. Esta facade oferece uma projeção defensiva
 *   para bordas HTTP/terminal/UI sem vazar o manager cru (`toolsRegistry.entries`) para fora do domínio do agent.
 */

/**
 * @typedef {{
 *     name: string;
 *     description: string | null;
 *     category: string;
 *     tags: string[];
 *     readOnly: boolean;
 *     skipPermission: boolean;
 * }} AgentRuntimeToolProjection
 *
 *
 * @typedef {{
 *     ok: boolean;
 *     source: 'registry' | 'static' | 'unavailable';
 *     count: number;
 *     tools: AgentRuntimeToolProjection[];
 *     error?: string;
 * }} AgentRuntimeToolsSnapshot
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/**
 * @param {unknown} toolValue
 * @returns {AgentRuntimeToolProjection}
 */
function normalizeStaticTool(toolValue) {
    const tool = asRecord(toolValue);
    return {
        name: typeof tool['name'] === 'string' && tool['name'] ? tool['name'] : '(unknown)',
        description: typeof tool['description'] === 'string' ? tool['description'] : null,
        category: 'uncategorized',
        tags: [],
        readOnly: false,
        skipPermission: tool['skipPermission'] === true,
    };
}

/**
 * @param {unknown} itemValue
 * @returns {AgentRuntimeToolProjection}
 */
function normalizeRegistryProjection(itemValue) {
    const item = asRecord(itemValue);
    return {
        name: typeof item['name'] === 'string' && item['name'] ? item['name'] : '(unknown)',
        description: typeof item['description'] === 'string' ? item['description'] : null,
        category: typeof item['category'] === 'string' ? item['category'] : 'uncategorized',
        tags: asStringArray(item['tags']),
        readOnly: item['readOnly'] === true,
        skipPermission: item['skipPermission'] === true,
    };
}

/**
 * @param {unknown} registryValue
 * @returns {AgentRuntimeToolProjection[] | null}
 */
function readLegacyRegistryEntries(registryValue) {
    const registry = asRecord(registryValue);
    const entries = registry['entries'];
    if (!(entries instanceof Map)) return null;
    return [...entries.entries()].map(([name, entryValue]) => {
        const entry = asRecord(entryValue);
        const tool = asRecord(entry['tool']);
        return {
            name:
                typeof tool['name'] === 'string' && tool['name']
                    ? tool['name']
                    : typeof name === 'string'
                      ? name
                      : '(unknown)',
            description: typeof tool['description'] === 'string' ? tool['description'] : null,
            category: typeof entry['category'] === 'string' ? entry['category'] : 'uncategorized',
            tags: asStringArray(entry['tags']),
            readOnly: entry['readOnly'] === true,
            skipPermission: tool['skipPermission'] === true,
        };
    });
}

/**
 * Lê as tools registradas pelo runtime do agent usando a superfície semântica do AgentContext/AlwaysAliveAgent.
 *
 * @param {{
 *     getToolRegistryEntriesSnapshot?: () => unknown;
 *     toolsRegistry?: unknown;
 * }} agent
 * @returns {AgentRuntimeToolProjection[] | null}
 */
export function readAgentRuntimeToolEntries(agent) {
    if (typeof agent.getToolRegistryEntriesSnapshot === 'function') {
        const entries = agent.getToolRegistryEntriesSnapshot();
        return Array.isArray(entries) ? entries.map(normalizeRegistryProjection) : [];
    }
    return readLegacyRegistryEntries(agent.toolsRegistry);
}

/**
 * Retorna a visão canônica de tools para bordas. O fallback estático existe apenas para endpoints globais antes do boot
 * do agent; rotas estritamente runtime-aware podem exigir registry.
 *
 * @param {{
 *     getToolRegistryEntriesSnapshot?: () => unknown;
 *     toolsRegistry?: unknown;
 * }} agent
 * @param {{ allTools?: unknown[]; requireRegistry?: boolean }} [options]
 * @returns {AgentRuntimeToolsSnapshot}
 */
export function readAgentRuntimeTools(agent, options = {}) {
    const registryTools = readAgentRuntimeToolEntries(agent);
    if (registryTools) {
        return { ok: true, source: 'registry', count: registryTools.length, tools: registryTools };
    }

    if (options.requireRegistry) {
        return {
            ok: false,
            source: 'unavailable',
            count: 0,
            tools: [],
            error: 'ToolsRegistry não disponível (agente não iniciado)',
        };
    }

    const staticTools = Array.isArray(options.allTools) ? options.allTools.map(normalizeStaticTool) : [];
    return { ok: true, source: 'static', count: staticTools.length, tools: staticTools };
}
