// @ts-check
/**
 * Audit log append-only para operações agentic de I/O.
 *
 * O writer é opt-in por ambiente para evitar side effects obrigatórios em testes e runtimes mínimos. Quando
 * `COPILOT_IO_MUTATION_AUDIT_LOG_PATH` está definido, cada envelope de mutação pode ser registrado em JSONL.
 *
 * @module copilot/infra/operations/audit-log
 */

import { toError } from '#copilot/core';
import { createJsonlFileWriter } from '#copilot/infra/internal/persistence/jsonl';

const IO_MUTATION_AUDIT_SCHEMA_VERSION = 1;
/** @type {Map<string, ReturnType<typeof createJsonlFileWriter>>} */
const mutationAuditWriters = new Map();

/**
 * @param {string} filePath
 */
function getMutationAuditWriter(filePath) {
    let writer = mutationAuditWriters.get(filePath);
    if (!writer) {
        writer = createJsonlFileWriter({
            filePath,
            autoFlush: false,
            // Audit de mutações é evidência de segurança: persistimos conteúdo e a entrada de diretório antes de confirmar.
            durability: 'file-and-directory',
            maxQueueLines: 10_000,
            softQueueLines: 8_000,
        });
        mutationAuditWriters.set(filePath, writer);
    }
    return writer;
}

/**
 * @returns {string | null}
 */
export function getIoMutationAuditLogPath() {
    const raw = process.env['COPILOT_IO_MUTATION_AUDIT_LOG_PATH'];
    const path = raw === undefined ? '' : String(raw).trim();
    return path.length > 0 ? path : null;
}

/**
 * @param {import('./operation.js').IoOperationEnvelope} envelope
 * @param {{
 *     tool?: string;
 *     io?: import('#copilot/core/io-contracts').IoMeta | null;
 *     result?: Record<string, unknown>;
 * }} [context]
 * @returns {Record<string, unknown>}
 */
export function buildIoMutationAuditRecord(envelope, context = {}) {
    return {
        schemaVersion: IO_MUTATION_AUDIT_SCHEMA_VERSION,
        ts: new Date().toISOString(),
        kind: 'copilot.io.mutation',
        operationId: envelope.operationId,
        capability: envelope.capability,
        status: envelope.status,
        riskClass: envelope.riskClass,
        targets: envelope.targets,
        traceId: envelope.traceId,
        durationMs: envelope.durationMs,
        tool: context.tool ?? String(envelope.evidence['tool'] ?? ''),
        evidence: envelope.evidence,
        error: envelope.error,
        io: context.io
            ? {
                  operation: context.io.operation,
                  engine: context.io.engine,
                  target: context.io.target,
                  bytesRead: context.io.bytesRead,
                  bytesWritten: context.io.bytesWritten,
                  traceId: context.io.traceId,
                  durationMs: context.io.durationMs,
              }
            : null,
        result: context.result ?? {},
    };
}

/**
 * @param {import('./operation.js').IoOperationEnvelope} envelope
 * @param {{
 *     tool?: string;
 *     io?: import('#copilot/core/io-contracts').IoMeta | null;
 *     result?: Record<string, unknown>;
 * }} [context]
 * @returns {Promise<{ enabled: boolean; path: string | null; written: boolean; error?: string }>}
 */
export async function recordIoMutationAudit(envelope, context = {}) {
    const filePath = getIoMutationAuditLogPath();
    if (!filePath) return { enabled: false, path: null, written: false };
    try {
        const record = buildIoMutationAuditRecord(envelope, context);
        const writer = getMutationAuditWriter(filePath);
        writer.enqueueLine(JSON.stringify(record));
        await writer.flush();
        return { enabled: true, path: filePath, written: true };
    } catch (error) {
        return {
            enabled: true,
            path: filePath,
            written: false,
            error: toError(error).message,
        };
    }
}
