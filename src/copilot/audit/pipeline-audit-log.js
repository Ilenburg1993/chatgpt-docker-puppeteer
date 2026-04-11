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

import { logSwallowed, registerShutdownHandler } from '#copilot/core';
import fs from 'node:fs';
import { appendFile, mkdir, open, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
 * Lê as últimas N linhas de um arquivo JSONL sem carregar o arquivo inteiro em memória.
 *
 * @param {string} filePath
 * @param {number} [n=50] Default is `50`
 * @returns {Promise<string[]>}
 */
async function readLastNLines(filePath, n = 50) {
    const BLOCK = 65_536;
    let fh;
    try {
        fh = await open(filePath, 'r');
        const { size } = await fh.stat();
        if (size === 0) return [];
        let remaining = size;
        let tail = '';
        /** @type {string[]} */
        const lines = [];
        while (remaining > 0 && lines.length < n) {
            const readSize = Math.min(BLOCK, remaining);
            remaining -= readSize;
            const buf = Buffer.alloc(readSize);
            await fh.read(buf, 0, readSize, remaining);
            tail = buf.toString('utf8') + tail;
            const split = tail.split('\n');
            for (let i = split.length - 1; i >= 1 && lines.length < n; i--) {
                const line = split[i];
                if (line && line.trim()) lines.unshift(line);
            }
            tail = split[0] ?? '';
        }
        if (tail.trim() && lines.length < n) lines.unshift(tail);
        return lines.slice(-n);
    } catch {
        return [];
    } finally {
        await fh?.close();
    }
}

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
        const str = JSON.stringify(args);
        return str.length > 200 ? str.slice(0, 200) + '…' : str;
    } catch {
        return '(não serializável)';
    }
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
    const toolAuditRotate = toolAuditFile + '.1';

    /** @type {AuditEntry[]} */
    const _buffer = [];

    /** @type {Map<string, { toolName: string; mcpServerName: string | null; args: object; ts: number }>} */
    const _pending = new Map();

    /** @type {string[]} */
    const _toolWriteQueue = [];
    let _flushScheduled = false;

    /** @returns {void} */
    function scheduleFlushTool() {
        if (_flushScheduled) return;
        _flushScheduled = true;
        setImmediate(async () => {
            _flushScheduled = false;
            const batch = _toolWriteQueue.splice(0);
            if (!batch.length) return;
            try {
                await mkdir(dirname(/** @type {string} */ (toolAuditFile)), { recursive: true });
                try {
                    const { size } = await stat(toolAuditFile);
                    if (size >= MAX_TOOL_AUDIT_BYTES) await rename(toolAuditFile, toolAuditRotate);
                } catch (/** @type {any} */ e) {
                    logSwallowed(e, 'audit.pipeline.statToolAudit');
                }
                await appendFile(toolAuditFile, batch.join(''), 'utf8');
            } catch (/** @type {any} */ e) {
                logSwallowed(e, 'audit.pipeline.flushToolAudit');
            }
        });
    }

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
            /** @type {any} */ (last).data?.toolName === /** @type {any} */ (entry).data?.toolName &&
            entry.type !== 'tool.start' &&
            entry.type !== 'tool.complete' &&
            now - new Date(last.ts).getTime() < 1000
        ) {
            return;
        }
        const full = /** @type {AuditEntry} */ ({ ...entry, ts: new Date().toISOString() });
        _buffer.push(full);
        if (_buffer.length > maxEntries) _buffer.shift();
    }

    /** @returns {AuditEntry[]} */
    function getEntries() {
        return [..._buffer];
    }

    /**
     * @param {number} [n=50] Default is `50`
     * @returns {AuditEntry[]}
     */
    function getLast(n = 50) {
        return _buffer.slice(-n);
    }

    /** @returns {Promise<void>} */
    async function flush() {
        if (_buffer.length === 0) return;
        try {
            await mkdir(dirname(/** @type {string} */ (auditFile)), { recursive: true });
            const lines = _buffer.map((e) => JSON.stringify(e)).join('\n') + '\n';
            await appendFile(auditFile, lines, 'utf8');
        } catch (/** @type {any} */ err) {
            log('WARN', `[audit/pipeline] flush failed: ${err?.message ?? err}`);
        }
    }

    /** @returns {void} */
    function clear() {
        _buffer.length = 0;
        _pending.clear();
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
            toolName: entry.toolName,
            mcpServerName: entry.mcpServerName ?? null,
            args: entry.args ?? {},
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
            toolCallId: entry.toolCallId,
            toolName: pending?.toolName ?? '(desconhecido)',
            mcpServerName: pending?.mcpServerName ?? null,
            argsSummary: pending ? _argsSummary(pending.args) : null,
            resultSummary: entry.resultContent ? entry.resultContent.slice(0, 200) : null,
            durationMs,
            success: entry.success,
        };

        record({
            type: 'tool.executed',
            ...(entry.sessionId != null ? { sessionId: entry.sessionId } : {}),
            data: { toolName: jsonRecord.toolName, durationMs, success: entry.success },
        });

        _toolWriteQueue.push(JSON.stringify(jsonRecord) + '\n');
        scheduleFlushTool();
    }

    /**
     * @param {string | null} [sessionId]
     * @param {number} [limit=50] Default is `50`
     * @returns {Promise<object[]>}
     */
    async function getAuditSummary(sessionId, limit = 50) {
        try {
            if (!fs.existsSync(toolAuditFile)) return [];
            const fetchCount = sessionId ? limit * 10 : limit;
            const lines = await readLastNLines(toolAuditFile, fetchCount);
            const entries = lines
                .map((l) => {
                    try {
                        return JSON.parse(l);
                    } catch {
                        return null;
                    }
                })
                .filter(Boolean);
            const filtered = sessionId ? entries.filter((e) => e.sessionId === sessionId) : entries;
            return filtered.slice(-limit);
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
    90,
);
