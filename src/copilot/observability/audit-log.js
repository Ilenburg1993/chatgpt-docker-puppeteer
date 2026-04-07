// @ts-check
/**
 * src/copilot/observability/audit-log.js
 *
 * Ring buffer de auditoria central para eventos significativos do agente. Consolida funcionalidade de
 * `channel/audit.js` (correlação de tool calls + JSONL I/O) e ring buffer geral de auditoria.
 *
 * Responsabilidades:
 *
 * - Ring buffer em memória de eventos de auditoria (session, permission, tool, hooks)
 * - Correlação start/complete de tool calls (ex-`channel/audit.js`)
 * - Escrita assíncrona em `logs/tool-execution-audit.jsonl` via batch I/O com setImmediate
 * - Rotação automática do JSONL (10 MB → `.1`)
 * - Leitura de histórico via `getAuditSummary()`
 *
 * @module copilot/observability/audit-log
 */

import { COPILOT_AUDIT_RING_SIZE } from '#copilot/config/env';
import fs from 'node:fs';
import { appendFile, mkdir, open, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { LOG_DIR, log } from './logger.js';

/** Máximo de entradas no buffer em memória. */
const MAX_AUDIT_ENTRIES = COPILOT_AUDIT_RING_SIZE;

/** Default path do arquivo de audit geral em disco. */
const AUDIT_FILE = join(LOG_DIR, 'audit.jsonl');

/** Path do arquivo JSONL de tool calls (execuções). CQ-01: renomeado de tool-audit.jsonl. */
const TOOL_AUDIT_FILE = join(LOG_DIR, 'tool-execution-audit.jsonl');
const MAX_TOOL_AUDIT_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * FINDING-P4-1 fix: lê as últimas N linhas de um arquivo JSONL sem carregar o arquivo inteiro em memória. Usa leitura
 * reversa em blocos de 64 KB a partir do fim do arquivo.
 *
 * @param {string} filePath - Caminho do arquivo
 * @param {number} [n=50] - Número de linhas a retornar. Default is `50`
 * @returns {Promise<string[]>} Últimas N linhas não-vazias
 */
async function readLastNLines(filePath, n = 50) {
    const BLOCK = 65_536; // 64KB por bloco
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
            // Últimas linhas completas — a primeira pode estar incompleta
            for (let i = split.length - 1; i >= 1 && lines.length < n; i--) {
                const line = split[i];
                if (line && line.trim()) lines.unshift(line);
            }
            tail = split[0] ?? ''; // possível linha incompleta no início
        }
        // Incluir a linha "tail" restante se for válida
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
 * @property {string} type - Tipo do evento auditado (ex: 'session.start', 'tool.executed').
 * @property {string} ts - ISO 8601 timestamp.
 * @property {string} [sessionId] - Session scope.
 * @property {Record<string, unknown>} [data] - Dados contextuais adicionais.
 */

/**
 * @typedef {object} ToolAuditStartEntry
 * @property {string} toolCallId - ID único do tool call.
 * @property {string} toolName - Nome da ferramenta.
 * @property {object} [args] - Argumentos da chamada.
 * @property {string | null} [mcpServerName] - Servidor MCP (se aplicável).
 */

/**
 * @typedef {object} ToolAuditCompleteEntry
 * @property {string} toolCallId - ID único do tool call.
 * @property {boolean} success - Se a chamada foi bem-sucedida.
 * @property {string | null} [sessionId] - ID da sessão.
 * @property {string | null} [taskId] - ID da tarefa.
 * @property {string | null} [resultContent] - Resultado parcial (até 200 chars).
 */

/**
 * @typedef {object} AuditLog
 * @property {(entry: Omit<AuditEntry, 'ts'>) => void} record Registra uma entrada de auditoria.
 * @property {() => AuditEntry[]} getEntries Retorna cópia das entradas recentes no buffer.
 * @property {(n?: number) => AuditEntry[]} getLast Retorna as últimas N entradas.
 * @property {() => Promise<void>} flush Persiste todas as entradas do buffer em `logs/audit.jsonl`.
 * @property {() => void} clear Limpa o buffer sem persistir.
 * @property {() => Promise<void>} clearAndFlush Persiste o buffer antes de limpar (FINDING-P4-2 fix).
 * @property {(entry: ToolAuditStartEntry) => void} recordToolStart Registra início de tool call (correlação).
 * @property {(entry: ToolAuditCompleteEntry) => void} recordToolComplete Registra conclusão de tool call + JSONL I/O.
 * @property {(sessionId?: string | null, limit?: number) => Promise<object[]>} getAuditSummary Lê histórico JSONL.
 */

/**
 * Serializa argumentos de tool call em texto curto para o log.
 *
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

    // ── Correlação de tool calls (ex-channel/audit.js) ─────────────────────────────

    /** @type {Map<string, { toolName: string; mcpServerName: string | null; args: object; ts: number }>} */
    const _pending = new Map();

    // ── Fila de escritas assíncronas para tool-execution-audit.jsonl ─────────────

    /** @type {string[]} */
    const _toolWriteQueue = [];
    let _flushScheduled = false;

    /**
     * Flush assíncrono via setImmediate — não bloqueia o event loop.
     *
     * @returns {void}
     */
    function scheduleFlushTool() {
        if (_flushScheduled) return;
        _flushScheduled = true;
        setImmediate(async () => {
            _flushScheduled = false;
            const batch = _toolWriteQueue.splice(0);
            if (!batch.length) return;
            try {
                // FINDING-P5-3: usar dirname em vez de regex para extrair diretório
                await mkdir(dirname(/** @type {string} */ (toolAuditFile)), { recursive: true });
                try {
                    const { size } = await stat(toolAuditFile);
                    if (size >= MAX_TOOL_AUDIT_BYTES) await rename(toolAuditFile, toolAuditRotate);
                } catch {
                    // arquivo ainda não existe — OK
                }
                await appendFile(toolAuditFile, batch.join(''), 'utf8');
            } catch {
                // Falha silenciosa — auditoria não deve interromper o agente
            }
        });
    }

    // ── Ring buffer geral ───────────────────────────────────────────────────────────

    /**
     * @param {Omit<AuditEntry, 'ts'>} entry
     * @returns {void}
     */
    function record(entry) {
        // F17.1 — dedup: ignora entradas com mesmo type + toolName em janela de 1s
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
        const full = /** @type {AuditEntry} */ ({
            ...entry,
            ts: new Date().toISOString(),
        });
        _buffer.push(full);
        if (_buffer.length > maxEntries) {
            _buffer.shift();
        }
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
            // FINDING-P5-3: usar dirname em vez de regex para extrair diretório
            await mkdir(dirname(/** @type {string} */ (auditFile)), { recursive: true });
            const lines = _buffer.map((e) => JSON.stringify(e)).join('\n') + '\n';
            await appendFile(auditFile, lines, 'utf8');
        } catch (/** @type {any} */ err) {
            log('WARN', `[audit-log] flush failed: ${err?.message ?? err}`);
        }
    }

    /** @returns {void} */
    function clear() {
        _buffer.length = 0;
        _pending.clear();
    }

    /**
     * FINDING-P4-2 fix: persiste o buffer antes de limpar, evitando perda de eventos não escritos.
     *
     * @returns {Promise<void>}
     */
    async function clearAndFlush() {
        await flush();
        clear();
    }

    // ── Tool call audit (ex-channel/audit.js) ──────────────────────────────────────

    /**
     * Registra o início de uma tool call. Equivalente a `auditToolStart()` de `channel/audit.js`.
     *
     * CQ-06: TTL cleanup — entradas com mais de 10 min são removidas para evitar leak.
     *
     * @param {ToolAuditStartEntry} entry
     * @returns {void}
     */
    function recordToolStart(entry) {
        // CQ-06: TTL cleanup — remover entradas órfãs (> 10 min)
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
     * Registra a conclusão de uma tool call, correlaciona com o start e escreve no JSONL. Equivalente a
     * `auditToolComplete()` de `channel/audit.js`.
     *
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

        // Alimenta ring buffer em memória
        record({
            type: 'tool.executed',
            ...(entry.sessionId != null ? { sessionId: entry.sessionId } : {}),
            data: {
                toolName: jsonRecord.toolName,
                durationMs,
                success: entry.success,
            },
        });

        // Enfileira para escrita assíncrona no JSONL
        _toolWriteQueue.push(JSON.stringify(jsonRecord) + '\n');
        scheduleFlushTool();
    }

    /**
     * Retorna as últimas `limit` entradas de auditoria de tool calls do arquivo JSONL. Equivalente a
     * `getAuditSummary()` de `channel/audit.js`.
     *
     * @param {string | null} [sessionId] - Filtrar por sessão; null retorna todas.
     * @param {number} [limit=50] Default is `50`
     * @returns {Promise<object[]>}
     */
    async function getAuditSummary(sessionId, limit = 50) {
        try {
            if (!fs.existsSync(toolAuditFile)) return [];
            // FINDING-P4-1 fix: leitura reversa (readLastNLines) — evita readFile completo de 10 MB
            // Se houver filtro de session, lemos um múltiplo para ter margem para filtragem
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

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Singleton global de audit log para src/copilot. */
export const defaultAuditLog = createAuditLog();

// BUG-OBS-001 fix: garante flush do buffer em desligamento ordenado (beforeExit).
// Registrado uma única vez no singleton para evitar duplicação em hot-reload.
process.once('beforeExit', () => {
    void defaultAuditLog.flush();
});
