// @ts-check
/**
 * src/copilot/audit/pipeline-sdk-buffer.js
 *
 * SDK Audit Buffer — ring buffer para auditoria de tool calls do SDK. Ex-`hooks/audit.js`, consolidado no pipeline de
 * auditoria.
 *
 * @module copilot/audit/pipeline-sdk-buffer
 * @see EventBus
 */

import { redactSecretRecord } from '#copilot/infra/public/observability/redaction';
import { toError } from '#copilot/infra/public/platform/error';
import { log } from './logger.js';
import { AuditRingBuffer } from './ring-buffer.js';

/** @param {string} key @param {number} def @returns {number} */
const envInt = (key, def) => {
    const v = parseInt(process.env[key] ?? '', 10);
    return Number.isFinite(v) ? v : def;
};

const COPILOT_AUDIT_BUFFER_SIZE = envInt('COPILOT_AUDIT_BUFFER_SIZE', 500);

/**
 * @typedef {{
 *     toolName: string;
 *     toolArgs: unknown;
 *     toolResult: unknown;
 *     sessionId: string;
 *     ts: string;
 *     durationMs?: number;
 * }} SdkAuditEntry
 */

/**
 * Buffer global de auditoria SDK. Capacidade configurável via `COPILOT_AUDIT_BUFFER_SIZE`.
 *
 * @type {AuditRingBuffer<SdkAuditEntry>}
 */
export const globalAuditBuffer = new AuditRingBuffer({
    capacity: COPILOT_AUDIT_BUFFER_SIZE,
});

/**
 * Retorna as últimas `n` entradas do buffer global de auditoria SDK.
 *
 * @param {number} [n] - Número de entradas (default: 20)
 * @param {AuditRingBuffer<SdkAuditEntry>} [buffer] - Buffer fonte (default: globalAuditBuffer)
 * @returns {SdkAuditEntry[]}
 */
export function getAuditTail(n = 20, buffer = globalAuditBuffer) {
    return buffer
        .tail(n)
        .map(
            (entry) =>
                /** @type {SdkAuditEntry} */ (redactSecretRecord(/** @type {Record<string, unknown>} */ (entry))),
        );
}

/**
 * Cria um handler `onPostToolUse` que captura entradas no `globalAuditBuffer`.
 *
 * Desde Fase AL, o feed principal é automático via `event-collector.js`. Este handler pode ser usado como hook
 * adicional quando necessário.
 *
 * @param {((entry: SdkAuditEntry) => void) | null | undefined} [logger]
 * @param {AuditRingBuffer<SdkAuditEntry>} [buffer]
 * @returns {(
 *     input: { toolName: string; toolArgs: unknown; toolResult: unknown; timestamp?: string },
 *     invocation: { sessionId: string },
 * ) => Promise<{ additionalContext?: string }>}
 */
export function createAuditPostToolHandler(logger, buffer = globalAuditBuffer) {
    return async (input, invocation) => {
        const entry = /** @type {SdkAuditEntry} */ (
            redactSecretRecord({
                toolName: input.toolName,
                toolArgs: input.toolArgs,
                toolResult: input.toolResult,
                sessionId: invocation.sessionId,
                ts: input.timestamp ?? new Date().toISOString(),
                durationMs: 0,
            })
        );

        buffer.push(entry);

        if (logger) {
            try {
                logger(entry);
            } catch (err) {
                log('WARN', `[audit/pipeline] logger externo lançou exceção: ${toError(err).message}`);
            }
        }

        return {};
    };
}
