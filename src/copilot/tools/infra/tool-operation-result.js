// @ts-check
/**
 * Envelope canônico incremental para resultados operacionais de tools.
 *
 * @module copilot/tools/infra/tool-operation-result
 */

/**
 * @param {Record<string, unknown>} [payload]
 * @param {{ terminalSummary?: string; durationMs?: number; traceId?: string }} [options]
 */
export function buildToolSuccessResult(payload = {}, options = {}) {
    return {
        success: true,
        ok: true,
        status: 'success',
        retryable: false,
        terminalSummary: options.terminalSummary ?? 'Tool executada com sucesso.',
        ...(typeof options.durationMs === 'number' ? { durationMs: options.durationMs } : {}),
        ...(options.traceId ? { traceId: options.traceId } : {}),
        ...payload,
    };
}

/**
 * @param {{
 *     error: unknown;
 *     code?: string;
 *     category?: string;
 *     retryable?: boolean;
 *     blockedReason?: string;
 *     suggestedNextAction?: string;
 *     terminalSummary?: string;
 *     durationMs?: number;
 *     exitCode?: number;
 *     traceId?: string;
 * }} input
 */
export function buildToolFailureResult(input) {
    const message = input.error instanceof Error ? input.error.message : String(input.error ?? 'Erro desconhecido.');
    const category = input.category ?? 'unknown';
    return {
        success: false,
        ok: false,
        status: 'failure',
        error: message,
        category,
        retryable: input.retryable === true,
        blockedReason: input.blockedReason ?? `${category}_failure`,
        terminalSummary: input.terminalSummary ?? `Tool falhou: ${message}`,
        ...(input.code ? { code: input.code } : {}),
        ...(input.suggestedNextAction ? { suggestedNextAction: input.suggestedNextAction } : {}),
        ...(typeof input.durationMs === 'number' ? { durationMs: input.durationMs } : {}),
        ...(typeof input.exitCode === 'number' ? { exitCode: input.exitCode } : {}),
        ...(input.traceId ? { traceId: input.traceId } : {}),
    };
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
export function extractToolFailureCode(error) {
    const record = asRecord(error);
    const code = record?.['code'];
    return typeof code === 'string' || typeof code === 'number' ? String(code) : undefined;
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
export function extractToolFailureTraceId(error) {
    const record = asRecord(error);
    const direct = record?.['traceId'];
    if (typeof direct === 'string' && direct.trim()) return direct;
    const io = asRecord(record?.['io']);
    const ioTraceId = io?.['traceId'];
    return typeof ioTraceId === 'string' && ioTraceId.trim() ? ioTraceId : undefined;
}

/**
 * @param {unknown} error
 * @param {Partial<Parameters<typeof buildToolFailureResult>[0]>} [options]
 */
export function normalizeToolFailure(error, options = {}) {
    return buildToolFailureResult({ error, ...options });
}
