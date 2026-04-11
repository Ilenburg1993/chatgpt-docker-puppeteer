// @ts-check
/**
 * src/copilot/audit/pipeline-sdk-buffer.js
 *
 * SDK Audit Buffer — ring buffer para auditoria de tool calls do SDK. Ex-`hooks/audit.js`, consolidado no pipeline de
 * auditoria.
 *
 * @module copilot/audit/pipeline-sdk-buffer
 */

import { log } from './logger.js';
import { AuditRingBuffer } from './ring-buffer.js';

/** @param {string} key @param {number} def @returns {number} */
const envInt = (key, def) => {
    const v = parseInt(process.env[key] ?? '', 10);
    return Number.isFinite(v) ? v : def;
};

const COPILOT_AUDIT_BUFFER_SIZE = envInt('COPILOT_AUDIT_BUFFER_SIZE', 500);

/**
 * @typedef {import('#copilot/hooks/types').AuditEntry} SdkAuditEntry
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
    return buffer.tail(n);
}

/**
 * Cria um handler `onPostToolUse` que captura entradas no `globalAuditBuffer`.
 *
 * @deprecated Desde Fase AL — feed automático via `event-collector.js`. Mantido para compatibilidade.
 * @param {((entry: SdkAuditEntry) => void) | null | undefined} [logger]
 * @param {AuditRingBuffer<SdkAuditEntry>} [buffer]
 * @returns {(
 *     input: { toolName: string; toolArgs: unknown; toolResult: unknown; timestamp?: string },
 *     invocation: { sessionId: string },
 * ) => Promise<{ additionalContext?: string }>}
 */
export function createAuditPostToolHandler(logger, buffer = globalAuditBuffer) {
    return async (input, invocation) => {
        const entry = /** @type {SdkAuditEntry} */ ({
            toolName: input.toolName,
            toolArgs: input.toolArgs,
            toolResult: input.toolResult,
            sessionId: invocation.sessionId,
            ts: input.timestamp ?? new Date().toISOString(),
            durationMs: 0,
        });

        buffer.push(entry);

        if (logger) {
            try {
                logger(entry);
            } catch (/** @type {any} */ err) {
                log('WARN', `[audit/pipeline] logger externo lançou exceção: ${err?.message}`);
            }
        }

        return {};
    };
}
