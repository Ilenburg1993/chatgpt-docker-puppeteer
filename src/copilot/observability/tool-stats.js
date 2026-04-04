// @ts-check
/**
 * src/copilot/observability/tool-stats.js
 *
 * Rastreamento in-memory de métricas por tool: latência, erro e última chamada. Zero-dependência — apenas módulo
 * nativo. Consumido por `get_tool_health` em introspection-tools.
 *
 * @module copilot/observability/tool-stats
 */

/**
 * Estatísticas acumuladas de uma tool individual.
 *
 * @typedef {object} ToolCallStats
 * @property {number} calls - Total de chamadas
 * @property {number} errors - Total de chamadas com erro
 * @property {number} totalMs - Soma acumulada de latências em ms
 * @property {number} lastCallMs - Timestamp (Date.now()) da última chamada
 * @property {boolean} lastOk - Resultado da última chamada (true=sucesso)
 */

/** @type {Map<string, ToolCallStats>} */
const _stats = new Map();

/**
 * Registra o resultado de uma execução de tool.
 *
 * @param {string} name - Nome da tool (ex: 'git_status')
 * @param {number} durationMs - Duração da chamada em milissegundos
 * @param {boolean} [success] - `true` para sucesso, `false` para erro (default: true)
 * @returns {void}
 */
export function recordToolCall(name, durationMs, success = true) {
    let s = _stats.get(name);
    if (!s) {
        s = { calls: 0, errors: 0, totalMs: 0, lastCallMs: 0, lastOk: true };
        _stats.set(name, s);
    }
    s.calls++;
    s.totalMs += durationMs;
    s.lastCallMs = Date.now();
    s.lastOk = success;
    if (!success) s.errors++;
}

/**
 * Retorna uma snapshot imutável dos stats por tool.
 *
 * @returns {Record<
 *     string,
 *     {
 *         calls: number;
 *         errors: number;
 *         avgLatencyMs: number;
 *         errorRate: number;
 *         lastCallIso: string | null;
 *         lastOk: boolean;
 *     }
 * >}
 */
export function getToolStats() {
    /**
     * @type {Record<
     *     string,
     *     {
     *         calls: number;
     *         errors: number;
     *         avgLatencyMs: number;
     *         errorRate: number;
     *         lastCallIso: string | null;
     *         lastOk: boolean;
     *     }
     * >}
     */
    const result = {};
    for (const [name, s] of _stats) {
        result[name] = {
            calls: s.calls,
            errors: s.errors,
            avgLatencyMs: s.calls > 0 ? Math.round(s.totalMs / s.calls) : 0,
            errorRate: s.calls > 0 ? parseFloat(((s.errors / s.calls) * 100).toFixed(1)) : 0,
            lastCallIso: s.lastCallMs > 0 ? new Date(s.lastCallMs).toISOString() : null,
            lastOk: s.lastOk,
        };
    }
    return result;
}

/**
 * Envolve uma tool SDK para capturar automaticamente latência e status de cada chamada. Não altera parâmetros ou valor
 * de retorno — apenas registra métricas no `_stats` interno.
 *
 * @param {import('@github/copilot-sdk').Tool} tool - Tool original
 * @returns {import('@github/copilot-sdk').Tool} Mesma tool com handler instrumentado
 */
export function wrapWithStats(tool) {
    const original = tool.handler;
    if (typeof original !== 'function') return tool;

    return {
        ...tool,
        handler: async (
            /** @type {Record<string, unknown>} */ params,
            /** @type {import('@github/copilot-sdk').ToolInvocation} */ invocation,
        ) => {
            const t0 = Date.now();
            try {
                const result = await original(params, invocation);
                recordToolCall(tool.name, Date.now() - t0, true);
                return result;
            } catch (err) {
                recordToolCall(tool.name, Date.now() - t0, false);
                throw err;
            }
        },
    };
}

/**
 * Reseta os stats internos (uso exclusivo em testes). **Não usar em produção.**
 *
 * @returns {void}
 * @internal
 */
export function _resetToolStats() {
    _stats.clear();
}

/**
 * F17.2 — Agrupa estatísticas de tools por categoria (prefixo antes do ponto). Exemplo: `shell.exec_command` →
 * categoria `shell`. Tools sem ponto ficam na categoria `other`.
 *
 * @returns {Record<string, { totalCalls: number; totalErrors: number; avgLatencyMs: number; tools: string[] }>}
 */
export function getStatsByCategory() {
    /** @type {Record<string, { totalCalls: number; totalErrors: number; totalMs: number; tools: string[] }>} */
    const categories = {};

    for (const [name, s] of _stats) {
        const category = (name.includes('.') ? name.split('.')[0] : 'other') ?? 'other';
        if (!categories[category]) {
            categories[category] = { totalCalls: 0, totalErrors: 0, totalMs: 0, tools: [] };
        }
        categories[category].totalCalls += s.calls;
        categories[category].totalErrors += s.errors;
        categories[category].totalMs += s.totalMs;
        if (!categories[category].tools.includes(name)) {
            categories[category].tools.push(name);
        }
    }

    /** @type {Record<string, { totalCalls: number; totalErrors: number; avgLatencyMs: number; tools: string[] }>} */
    const result = {};
    for (const [cat, agg] of Object.entries(categories)) {
        result[cat] = {
            totalCalls: agg.totalCalls,
            totalErrors: agg.totalErrors,
            avgLatencyMs: agg.totalCalls > 0 ? Math.round(agg.totalMs / agg.totalCalls) : 0,
            tools: agg.tools.sort(),
        };
    }
    return result;
}
