// @ts-check
/**
 * @module copilot/presentation/runtime-tools
 * @file Projeções HTTP/terminal-safe para tools do runtime.
 *
 *   A leitura semântica vem de `agent/facades/agent-runtime-tools`. Esta camada só aplica formato de borda: fallback
 *   estático, filtros e paginação.
 */

import { readAgentRuntimeTools } from '#copilot/agent';
import { requireAgentRuntimeSelection } from './agent-runtime.js';
import { buildRuntimeRouteMetaFromSelection } from './runtime-meta.js';

/** @typedef {ReturnType<typeof readAgentRuntimeTools>} AgentRuntimeToolsSnapshot */
/**
 * @typedef {{
 *     requestedRuntimeId: string | null;
 *     runtimeId: string;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 * }} AgentRuntimeSelectionMeta
 */

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function parsePositiveInt(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function parseCategory(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * @param {{
 *     getToolRegistryEntriesSnapshot?: () => unknown;
 *     toolsRegistry?: unknown;
 * }} agent
 * @param {{ allTools?: unknown[]; requireRegistry?: boolean }} [options]
 * @returns {AgentRuntimeToolsSnapshot}
 */
export function readAgentRuntimeToolsProjection(agent, options = {}) {
    return readAgentRuntimeTools(agent, options);
}

/**
 * Resolve o runtime na camada de apresentação e devolve a projeção HTTP-safe de tools.
 *
 * Rotas de borda devem preferir esta função a receber o singleton cru do agent só para listar ferramentas. Isso deixa
 * fallback multi-runtime, runtime não encontrado e metadados de seleção concentrados em `presentation/`.
 *
 * @param {string | null | undefined} [runtimeId]
 * @param {{ allTools?: unknown[]; requireRegistry?: boolean }} [options]
 * @returns {AgentRuntimeToolsSnapshot & AgentRuntimeSelectionMeta}
 */
export function readAgentRuntimeToolsProjectionForRuntime(runtimeId, options = {}) {
    const selection = requireAgentRuntimeSelection(runtimeId);
    return {
        ...readAgentRuntimeTools(selection.runtime, options),
        ...buildRuntimeRouteMetaFromSelection(selection),
    };
}

/**
 * @param {AgentRuntimeToolsSnapshot} projection
 * @param {{ category?: unknown; page?: unknown; limit?: unknown }} [query]
 * @returns {AgentRuntimeToolsSnapshot & { total: number; page: number; limit: number; pages: number }}
 */
export function paginateAgentRuntimeToolsProjection(projection, query = {}) {
    const category = parseCategory(query.category);
    const filtered = category ? projection.tools.filter((tool) => tool.category === category) : [...projection.tools];
    const total = filtered.length;
    const page = parsePositiveInt(query.page) ?? 1;
    const limit = Math.min(200, parsePositiveInt(query.limit) ?? Math.max(1, total));
    const start = (page - 1) * limit;
    const tools = filtered.slice(start, start + limit);

    return {
        ...projection,
        count: tools.length,
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
        tools,
    };
}
