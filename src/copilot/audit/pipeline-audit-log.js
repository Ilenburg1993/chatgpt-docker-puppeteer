// @ts-check
/**
 * src/copilot/audit/pipeline-audit-log.js
 *
 * General Audit Log — ring buffer em memória + JSONL I/O para tool call correlation. Ex-`observability/audit-log.js`,
 * consolidado no pipeline de auditoria.
 *
 * @module copilot/audit/pipeline-audit-log
 * @see EventBus
 */

import {
    SHUTDOWN_PRIORITY,
    logSwallowed,
    redactSecretRecord,
    redactSecretText,
    registerShutdownHandler,
    toError,
} from '#copilot/core';
import { join } from 'node:path';
import { createJsonlFileWriter } from '../infra/io/jsonl-file-writer.js';
import { readJsonlTail } from '../infra/io/jsonl-reader.js';
import { getLogDir, log } from './logger.js';

/** @param {string} key @param {number} def @returns {number} */
const envInt = (key, def) => {
    const v = parseInt(process.env[key] ?? '', 10);
    return Number.isFinite(v) ? v : def;
};

const COPILOT_AUDIT_RING_SIZE = envInt('COPILOT_AUDIT_RING_SIZE', 200);

/** Máximo de entradas no buffer em memória. */
const MAX_AUDIT_ENTRIES = COPILOT_AUDIT_RING_SIZE;

/** Default path do arquivo de audit geral em disco. */
const AUDIT_FILE = join(getLogDir(), 'audit.jsonl');

/** Path do arquivo JSONL de tool calls (execuções). */
const TOOL_AUDIT_FILE = join(getLogDir(), 'tool-execution-audit.jsonl');
const MAX_TOOL_AUDIT_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * @typedef {object} AuditEntry
 * @property {string} type
 * @property {string} ts
 * @property {string} [sessionId]
 * @property {Record<string, unknown>} [data]
 */

/**
 * @typedef {object} ToolAuditStartEntry
 * @property {string} toolCallId
 * @property {string} toolName
 * @property {object} [args]
 * @property {string | null} [mcpServerName]
 */

/**
 * @typedef {object} ToolAuditCompleteEntry
 * @property {string} toolCallId
 * @property {boolean} success
 * @property {string | null} [sessionId]
 * @property {string | null} [taskId]
 * @property {string | null} [resultContent]
 */

/**
 * @typedef {object} AuditLog
 * @property {(entry: Omit<AuditEntry, 'ts'>) => void} record
 * @property {() => AuditEntry[]} getEntries
 * @property {(n?: number) => AuditEntry[]} getLast
 * @property {() => Promise<void>} flush
 * @property {() => void} clear
 * @property {() => Promise<void>} clearAndFlush
 * @property {(entry: ToolAuditStartEntry) => void} recordToolStart
 * @property {(entry: ToolAuditCompleteEntry) => void} recordToolComplete
 * @property {(sessionId?: string | null, limit?: number) => Promise<object[]>} getAuditSummary
 */

/**
 * @param {object} args
 * @returns {string}
 */
function _argsSummary(args) {
    try {
        const str = JSON.stringify(redactSecretRecord(/** @type {Record<string, unknown>} */ (args)));
        return str.length > 200 ? str.slice(0, 200) + '…' : str;
    } catch {
        return '(não serializável)';
    }
}

/**
 * @param {AuditEntry} entry
 * @returns {AuditEntry}
 */
function redactAuditEntry(entry) {
    return /** @type {AuditEntry} */ (redactSecretRecord(/** @type {Record<string, unknown>} */ (entry)));
}

/**
 * Cria um AuditLog com ring buffer em memória e suporte a JSONL I/O de tool calls.
 *
 * @param {{ maxEntries?: number; auditFile?: string; toolAuditFile?: string }} [opts]
 * @returns {AuditLog}
 */
export function createAuditLog(opts = {}) {
    const maxEntries = opts.maxEntries ?? MAX_AUDIT_ENTRIES;
    const auditFile = opts.auditFile ?? AUDIT_FILE;
    const toolAuditFile = opts.toolAuditFile ?? TOOL_AUDIT_FILE;

    /** @type {AuditEntry[]} */
    const _buffer = [];
    const auditWriter = createJsonlFileWriter({
        filePath: auditFile,
        autoFlush: false,
        batchLines: maxEntries,
        maxQueueLines: maxEntries,
        softQueueLines: maxEntries,
    });
    const toolAuditWriter = createJsonlFileWriter({
        filePath: toolAuditFile,
        maxBytes: MAX_TOOL_AUDIT_BYTES,
        maxQueueLines: 10_000,
        softQueueLines: 8_000,
        onError: (error) => logSwallowed(error, 'audit.pipeline.flushToolAudit'),
    });

    /** @type {Map<string, { toolName: string; mcpServerName: string | null; args: object; ts: number }>} */
    const _pending = new Map();

    /**
     * @param {Omit<AuditEntry, 'ts'>} entry
     * @returns {void}
     */
    function record(entry) {
        const now = Date.now();
        const last = _buffer.at(-1);
        if (
            last &&
            last.type === entry.type &&
            last.data?.['toolName'] === entry.data?.['toolName'] &&
            entry.type !== 'tool.start' &&
            entry.type !== 'tool.complete' &&
            now - new Date(last.ts).getTime() < 1000
        ) {
            return;
        }
        const full = redactAuditEntry(/** @type {AuditEntry} */ ({ ...entry, ts: new Date().toISOString() }));
        _buffer.push(full);
        if (_buffer.length > maxEntries) _buffer.shift();
        auditWriter.enqueueLine(JSON.stringify(full));
    }

    /** @returns {AuditEntry[]} */
    function getEntries() {
        return _buffer.map(redactAuditEntry);
    }

    /**
     * @param {number} [n=50] Default is `50`
     * @returns {AuditEntry[]}
     */
    function getLast(n = 50) {
        return _buffer.slice(-n).map(redactAuditEntry);
    }

    /** @returns {Promise<void>} */
    async function flush() {
        try {
            await auditWriter.flush();
        } catch (err) {
            log('WARN', `[audit/pipeline] flush failed: ${toError(err).message ?? err}`);
        }
        try {
            await toolAuditWriter.flush();
        } catch (error) {
            logSwallowed(error, 'audit.pipeline.flushToolAudit');
        }
    }

    /** @returns {void} */
    function clear() {
        _buffer.length = 0;
        _pending.clear();
        auditWriter.clearQueue();
    }

    /** @returns {Promise<void>} */
    async function clearAndFlush() {
        await flush();
        clear();
    }

    /**
     * @param {ToolAuditStartEntry} entry
     * @returns {void}
     */
    function recordToolStart(entry) {
        const TTL = 10 * 60 * 1000;
        const now = Date.now();
        for (const [id, val] of _pending) {
            if (now - val.ts > TTL) _pending.delete(id);
        }
        _pending.set(entry.toolCallId, {
            toolName: redactSecretText(entry.toolName),
            mcpServerName: entry.mcpServerName ? redactSecretText(entry.mcpServerName) : null,
            args: redactSecretRecord(/** @type {Record<string, unknown>} */ (entry.args ?? {})),
            ts: now,
        });
    }

    /**
     * @param {ToolAuditCompleteEntry} entry
     * @returns {void}
     */
    function recordToolComplete(entry) {
        const pending = _pending.get(entry.toolCallId);
        _pending.delete(entry.toolCallId);
        const durationMs = pending ? Date.now() - pending.ts : null;

        const jsonRecord = {
            type: 'tool.execution',
            ts: new Date().toISOString(),
            sessionId: entry.sessionId ?? null,
            taskId: entry.taskId ?? null,
            toolCallId: redactSecretText(entry.toolCallId),
            toolName: redactSecretText(pending?.toolName ?? '(desconhecido)'),
            mcpServerName: pending?.mcpServerName ? redactSecretText(pending.mcpServerName) : null,
            argsSummary: pending ? _argsSummary(pending.args) : null,
            resultSummary: entry.resultContent ? redactSecretText(entry.resultContent.slice(0, 200)) : null,
            durationMs,
            success: entry.success,
        };

        record({
            type: 'tool.executed',
            ...(entry.sessionId != null ? { sessionId: entry.sessionId } : {}),
            data: { toolName: jsonRecord.toolName, durationMs, success: entry.success },
        });

        toolAuditWriter.enqueueLine(JSON.stringify(redactSecretRecord(jsonRecord)));
    }

    /**
     * @param {string | null} [sessionId]
     * @param {number} [limit=50] Default is `50`
     * @returns {Promise<object[]>}
     */
    async function getAuditSummary(sessionId, limit = 50) {
        try {
            const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(500, Math.trunc(limit)) : 50;
            const fetchCount = sessionId ? safeLimit * 10 : safeLimit;
            const { records, truncatedByByteLimit, bytesRead, maxBytes } = await readJsonlTail(toolAuditFile, {
                maxLines: fetchCount,
            });
            if (truncatedByByteLimit) {
                log(
                    'WARN',
                    `[audit/pipeline] tool audit tail reached byte budget (${bytesRead}/${maxBytes}); summary may be incomplete`,
                );
            }
            const entries = /** @type {Record<string, unknown>[]} */ (
                records.filter((entry) => entry && typeof entry === 'object')
            );
            const filtered = sessionId ? entries.filter((entry) => entry['sessionId'] === sessionId) : entries;
            return filtered
                .slice(-safeLimit)
                .map((entry) => redactSecretRecord(/** @type {Record<string, unknown>} */ (entry)));
        } catch {
            return [];
        }
    }

    return {
        record,
        getEntries,
        getLast,
        flush,
        clear,
        clearAndFlush,
        recordToolStart,
        recordToolComplete,
        getAuditSummary,
    };
}

/** Singleton global de audit log. */
export const defaultAuditLog = createAuditLog();

// F129: flush audit log via shutdown centralizado (priority 90 — low, runs late)
registerShutdownHandler(
    'audit.flush',
    async () => {
        await defaultAuditLog.flush();
    },
    SHUTDOWN_PRIORITY.AUDIT_FINALIZER,
);
