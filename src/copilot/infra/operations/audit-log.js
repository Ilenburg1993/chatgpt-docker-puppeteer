// @ts-check
/**
 * Runtime-owned append-only mutation audit capability.
 *
 * The factory owns one lazy JSONL writer for one immutable configured path. Application composition owns the instance
 * through `InfraRuntime`; no process-default or one-shot implicit writer exists.
 *
 * @module copilot/infra/operations/audit-log
 */

import { toError } from '#copilot/core/error-handlers';
import { createJsonlFileWriter } from '#copilot/infra/internal/persistence/jsonl';

const IO_MUTATION_AUDIT_SCHEMA_VERSION = 1;

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
 * @param {{ filePath?: string | null; runtimeId?: string }} [options]
 */
export function createIoMutationAuditRuntime(options = {}) {
    const runtimeId = options.runtimeId?.trim() || 'io-mutation-audit';
    const filePath = typeof options.filePath === 'string' && options.filePath.trim() ? options.filePath.trim() : null;
    /** @type {ReturnType<typeof createJsonlFileWriter> | null} */
    let writer = null;
    let disposed = false;

    function getWriter() {
        if (!filePath || disposed) return null;
        if (!writer) {
            writer = createJsonlFileWriter({
                filePath,
                autoFlush: false,
                // Mutation audit is security evidence: persist data and the directory entry before acknowledging.
                durability: 'file-and-directory',
                maxQueueLines: 10_000,
                softQueueLines: 8_000,
            });
        }
        return writer;
    }

    /**
     * @param {import('./operation.js').IoOperationEnvelope} envelope
     * @param {{tool?:string;io?:import('#copilot/core/io-contracts').IoMeta|null;result?:Record<string,unknown>}} [context]
     * @returns {Promise<{ enabled:boolean; path:string|null; written:boolean; error?:string }>}
     */
    async function record(envelope, context = {}) {
        if (!filePath) return { enabled: false, path: null, written: false };
        if (disposed) {
            return {
                enabled: true,
                path: filePath,
                written: false,
                error: `Mutation audit runtime ${runtimeId} is disposed.`,
            };
        }
        try {
            const activeWriter = getWriter();
            if (!activeWriter) return { enabled: false, path: null, written: false };
            activeWriter.enqueueLine(JSON.stringify(buildIoMutationAuditRecord(envelope, context)));
            await activeWriter.flush();
            return { enabled: true, path: filePath, written: true };
        } catch (error) {
            return { enabled: true, path: filePath, written: false, error: toError(error).message };
        }
    }

    async function flush() {
        if (writer) await writer.flush();
    }

    function snapshot() {
        return Object.freeze({
            runtimeId,
            enabled: filePath !== null,
            path: filePath,
            materialized: writer !== null,
            disposed,
            writer: writer ? Object.freeze({ ...writer.getState() }) : null,
        });
    }

    /** @type {Promise<void> | null} */
    let disposePromise = null;
    function dispose() {
        if (disposePromise) return disposePromise;
        disposePromise = (async () => {
            try {
                await flush();
            } finally {
                writer?.clearQueue();
                writer = null;
                disposed = true;
            }
        })();
        return disposePromise;
    }

    return Object.freeze({ runtimeId, enabled: filePath !== null, path: filePath, record, flush, snapshot, dispose });
}
