// @ts-check
/**
 * src/copilot/channel/audit.js
 *
 * Auditoria JSONL de tool calls executados pela sessão SDK.
 *
 * Cada tool call gera uma entrada em `logs/tool-audit.jsonl` no formato: `{ ts, sessionId, toolCallId, toolName,
 * mcpServerName, argsSummary, resultSummary, durationMs, success }`
 *
 * Rotação automática: quando o arquivo ultrapassa 10 MB é renomeado para `tool-audit.jsonl.1` e um novo arquivo é
 * criado.
 *
 * @module copilot/channel/audit
 */

import fs from 'node:fs';
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Configuração de paths ────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const LOGS_DIR = path.join(ROOT, 'logs');
const AUDIT_FILE = path.join(LOGS_DIR, 'tool-audit.jsonl');
const AUDIT_ROTATE = path.join(LOGS_DIR, 'tool-audit.jsonl.1');
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// ─── Fila de escritas pendentes ───────────────────────────────────────────────

/** @type {Map<string, { toolName: string; mcpServerName: string | null; args: object; ts: number }>} */
const _pending = new Map();

// ─── Buffer de escritas assíncronas (BUG-CRIT-04 fix) ────────────────────────

/** @type {string[]} */
const _writeQueue = [];
let _flushScheduled = false;

/**
 * Flush assíncrono via setImmediate — não bloqueia o event loop.
 *
 * @returns {void}
 */
function scheduleFlush() {
    if (_flushScheduled) return;
    _flushScheduled = true;
    setImmediate(async () => {
        _flushScheduled = false;
        const batch = _writeQueue.splice(0);
        if (!batch.length) return;
        try {
            await mkdir(LOGS_DIR, { recursive: true });
            try {
                const { size } = await stat(AUDIT_FILE);
                if (size >= MAX_SIZE_BYTES) await rename(AUDIT_FILE, AUDIT_ROTATE);
            } catch {
                // arquivo ainda não existe — OK
            }
            await appendFile(AUDIT_FILE, batch.join(''), 'utf8');
        } catch {
            // Falha silenciosa — auditoria não deve interromper o agente
        }
    });
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Serializa os argumentos de uma tool call em texto curto para o log.
 *
 * @param {object} args
 * @returns {string}
 */
function argsSummary(args) {
    try {
        const str = JSON.stringify(args);
        return str.length > 200 ? str.slice(0, 200) + '…' : str;
    } catch {
        return '(não serializável)';
    }
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Registra o início de uma tool call. Chamado no evento `tool.execution_start`.
 *
 * @param {{ toolCallId: string; toolName: string; args?: object; mcpServerName?: string | null }} entry
 * @returns {void}
 */
export function auditToolStart(entry) {
    _pending.set(entry.toolCallId, {
        toolName: entry.toolName,
        mcpServerName: entry.mcpServerName ?? null,
        args: entry.args ?? {},
        ts: Date.now(),
    });
}

/**
 * Registra a conclusão de uma tool call e escreve a entrada JSONL.
 *
 * Chamado no evento `tool.execution_complete`.
 *
 * @param {{
 *     toolCallId: string;
 *     success: boolean;
 *     sessionId?: string | null;
 *     taskId?: string | null;
 *     resultContent?: string | null;
 * }} entry
 * @returns {void}
 */
export function auditToolComplete(entry) {
    const pending = _pending.get(entry.toolCallId);
    _pending.delete(entry.toolCallId);

    const durationMs = pending ? Date.now() - pending.ts : null;

    /** @type {object} */
    const record = {
        ts: new Date().toISOString(),
        sessionId: entry.sessionId ?? null,
        taskId: entry.taskId ?? null,
        toolCallId: entry.toolCallId,
        toolName: pending?.toolName ?? '(desconhecido)',
        mcpServerName: pending?.mcpServerName ?? null,
        argsSummary: pending ? argsSummary(pending.args) : null,
        resultSummary: entry.resultContent ? entry.resultContent.slice(0, 200) : null,
        durationMs,
        success: entry.success,
    };

    // BUG-CRIT-04 fix: I/O assíncrono via buffer+setImmediate — não bloqueia event loop
    const line = JSON.stringify(record) + '\n';
    _writeQueue.push(line);
    scheduleFlush();
}

/**
 * Retorna as últimas `limit` entradas de auditoria para um dado `sessionId`.
 *
 * Leitura sincronizada do arquivo completo — usar apenas para debug/diagnóstico.
 *
 * @param {string | null} sessionId - Filtrar por sessão; null retorna todas as entradas
 * @param {number} [limit=50] - Número máximo de entradas a retornar. Default is `50`
 * @returns {object[]}
 */
export function getAuditSummary(sessionId, limit = 50) {
    try {
        if (!fs.existsSync(AUDIT_FILE)) return [];
        const lines = fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean);
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
