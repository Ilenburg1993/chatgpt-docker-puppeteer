// @ts-check
/**
 * @module copilot/presentation/runtime-fallback-telemetry
 * @file Centraliza telemetria e logging de fallback implícito de runtime.
 *
 *   Onda E2: transformar fallback implícito em fallback explícito e auditável. Este módulo registra TODAS as instâncias
 *   de fallback para runtime default, permitindo que diagnósticos, auditorias e testes comprovem que fallback é
 *   intencional e rastreável.
 *
 *   Uso:
 *
 *   - recordRuntimeFallback(runtimeId, caller) — registra um fallback
 *   - getRuntimeFallbackStats() — retorna estatísticas acumuladas
 *   - clearRuntimeFallbackLog() — limpa para testes
 */

/**
 * @typedef {{
 *     runtimeId: string;
 *     requestedRuntimeId: string | null;
 *     caller: string;
 *     timestamp: number;
 *     stackTrace: string;
 *     usedFallback: boolean;
 * }} RuntimeFallbackEvent
 */

/** @type {RuntimeFallbackEvent[]} */
const _fallbackLog = [];

/** @type {{ total: number; byCallee: Map<string, number>; byRequestedId: Map<string, number> }} */
const _stats = {
    total: 0,
    byCallee: new Map(),
    byRequestedId: new Map(),
};

/**
 * Registra um evento de fallback de runtime.
 *
 * @param {string} runtimeId - O runtime ID finalmente usado (pode ser default)
 * @param {string | null} requestedRuntimeId - O runtime ID solicitado (pode ser null ou inexistente)
 * @param {string} caller - Identificador do chamador (ex: "terminal/status.js" ou "routes/agent.js")
 * @param {boolean} usedFallback - Se houve fallback (requestedRuntimeId !== null e runtime não encontrado)
 * @returns {void}
 */
export function recordRuntimeFallback(runtimeId, requestedRuntimeId, caller, usedFallback) {
    const event = {
        runtimeId,
        requestedRuntimeId,
        caller,
        timestamp: Date.now(),
        stackTrace: _captureStack(),
        usedFallback,
    };

    _fallbackLog.push(event);
    _stats.total += 1;

    if (usedFallback && requestedRuntimeId) {
        const callerKey = caller || 'unknown';
        _stats.byCallee.set(callerKey, (_stats.byCallee.get(callerKey) ?? 0) + 1);
        _stats.byRequestedId.set(requestedRuntimeId, (_stats.byRequestedId.get(requestedRuntimeId) ?? 0) + 1);

        // Log warning para tornar explícito
        if (typeof console?.warn === 'function') {
            console.warn(
                `[RuntimeFallback] ${caller} solicitou runtime "${requestedRuntimeId}" mas não encontrado; usando "${runtimeId}"`,
            );
        }
    }
}

/**
 * Retorna todos os eventos de fallback registrados.
 *
 * @returns {RuntimeFallbackEvent[]}
 */
export function getRuntimeFallbackLog() {
    return [..._fallbackLog];
}

/**
 * Retorna estatísticas de fallback.
 *
 * @returns {{
 *     total: number;
 *     fallbackCount: number;
 *     byCallee: Record<string, number>;
 *     byRequestedId: Record<string, number>;
 * }}
 */
export function getRuntimeFallbackStats() {
    const fallbackCount = _fallbackLog.filter((e) => e.usedFallback).length;
    return {
        total: _stats.total,
        fallbackCount,
        byCallee: Object.fromEntries(_stats.byCallee),
        byRequestedId: Object.fromEntries(_stats.byRequestedId),
    };
}

/**
 * Limpa log e stats de fallback (útil para testes).
 *
 * @returns {void}
 */
export function clearRuntimeFallbackLog() {
    _fallbackLog.length = 0;
    _stats.total = 0;
    _stats.byCallee.clear();
    _stats.byRequestedId.clear();
}

/**
 * Captura stacktrace simplificado (primeiras 3 linhas relevantes).
 *
 * @returns {string}
 */
function _captureStack() {
    const err = new Error();
    const stack = (err.stack ?? '').split('\n');
    // Remove "Error" e a linha da própria function
    return stack
        .slice(2, 5)
        .map((line) => line.trim())
        .join(' | ');
}
