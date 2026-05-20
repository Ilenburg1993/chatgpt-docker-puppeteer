// @ts-check
/**
 * Correlação canônica do turno terminal.
 *
 * Eventos públicos do terminal (delta, mensagem final, tools, ask_user, SSE) precisam carregar a mesma identidade
 * operacional para que `/activity`, replay, testes live e consumidores externos consigam reconstruir o circuito sem
 * heurísticas locais. Este módulo centraliza a projeção mínima `traceId/turnId`.
 *
 * @module copilot/terminal/state/turn-correlation-state
 */

import { readTerminalTurnMaterialization } from './turn-materialization-state.js';
import { readTerminalTurnTraceProjection } from './turn-trace-state.js';

/**
 * @typedef {{
 *     traceId: string | null;
 *     turnId: string | null;
 *     source: 'materialization' | 'turn-trace' | 'none';
 * }} TerminalTurnCorrelation
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @returns {TerminalTurnCorrelation}
 */
export function readTerminalTurnCorrelation() {
    const materialization = readTerminalTurnMaterialization();
    if (materialization) {
        const turnId = normalizeString(materialization.turnId);
        return {
            traceId: turnId ? `turn:${turnId}` : materialization.turnKey,
            turnId,
            source: 'materialization',
        };
    }

    const trace = readTerminalTurnTraceProjection(1).current;
    if (trace) {
        return {
            traceId: normalizeString(trace.traceId),
            turnId: normalizeString(trace.turnId),
            source: 'turn-trace',
        };
    }

    return { traceId: null, turnId: null, source: 'none' };
}

/**
 * @template {Record<string, unknown>} T
 * @param {T} payload
 * @returns {T & { traceId?: string; turnId?: string }}
 */
export function withTerminalTurnCorrelation(payload) {
    const correlation = readTerminalTurnCorrelation();
    return {
        ...payload,
        ...(correlation.traceId ? { traceId: correlation.traceId } : {}),
        ...(correlation.turnId ? { turnId: correlation.turnId } : {}),
    };
}
