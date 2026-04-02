// @ts-check
/**
 * src/copilot/observability/audit-log.js
 *
 * Fase S — Ring buffer de auditoria para eventos significativos do agente.
 *
 * Armazena até MAX_AUDIT_ENTRIES entradas (padrão 200) em memória, com flush periódico ou ao hit de capacidade para
 * `logs/copilot/audit.jsonl`.
 *
 * Diferente do ErrorTracker (foco em erros), o AuditLog é um log de auditoria geral — registra decisões, mudanças de
 * estado, e eventos de conformidade:
 *
 * - Início/fim de session (session.start, session.end)
 * - Início/fim de turn (dialog.turn_start, dialog.turn_end)
 * - Permissões concedidas/negadas (permission.approved, permission.denied)
 * - Execução de tool (tool.executed)
 * - Erros fatais (session.fatal)
 * - Hooks disparados (hook.fired)
 *
 * @module copilot/observability/audit-log
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LOG_DIR, log } from './logger.js';

/** Máximo de entradas no buffer em memória. */
const MAX_AUDIT_ENTRIES = 200;

/** Default path do arquivo de audit em disco. */
const AUDIT_FILE = join(LOG_DIR, 'audit.jsonl');

/**
 * @typedef {object} AuditEntry
 * @property {string} type - Tipo do evento auditado (ex: 'session.start', 'tool.executed').
 * @property {string} ts - ISO 8601 timestamp.
 * @property {string} [sessionId] - Session scope.
 * @property {Record<string, unknown>} [data] - Dados contextuais adicionais.
 */

/**
 * @typedef {object} AuditLog
 * @property {(entry: Omit<AuditEntry, 'ts'>) => void} record Registra uma entrada de auditoria. Thread-safe (in-memory
 *   only).
 * @property {() => AuditEntry[]} getEntries Retorna cópia das entradas recentes no buffer.
 * @property {(n?: number) => AuditEntry[]} getLast Retorna as últimas N entradas.
 * @property {() => Promise<void>} flush Persiste todas as entradas do buffer em `logs/copilot/audit.jsonl`.
 * @property {() => void} clear Limpa o buffer sem persistir.
 */

/**
 * Cria um AuditLog com ring buffer em memória.
 *
 * @param {{ maxEntries?: number; auditFile?: string }} [opts]
 * @returns {AuditLog}
 */
export function createAuditLog(opts = {}) {
    const maxEntries = opts.maxEntries ?? MAX_AUDIT_ENTRIES;
    const auditFile = opts.auditFile ?? AUDIT_FILE;

    /** @type {AuditEntry[]} */
    const _buffer = [];

    /**
     * @param {Omit<AuditEntry, 'ts'>} entry
     * @returns {void}
     */
    function record(entry) {
        const full = /** @type {AuditEntry} */ ({
            ...entry,
            ts: new Date().toISOString(),
        });
        _buffer.push(full);
        if (_buffer.length > maxEntries) {
            _buffer.shift();
        }
    }

    /**
     * @returns {AuditEntry[]}
     */
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

    /**
     * @returns {Promise<void>}
     */
    async function flush() {
        if (_buffer.length === 0) return;
        try {
            await mkdir(/** @type {string} */ (auditFile.replace(/[^/]+$/, '')), { recursive: true });
            const lines = _buffer.map((e) => JSON.stringify(e)).join('\n') + '\n';
            await appendFile(auditFile, lines, 'utf8');
        } catch (/** @type {any} */ err) {
            log('WARN', `[audit-log] flush failed: ${err?.message ?? err}`);
        }
    }

    /**
     * @returns {void}
     */
    function clear() {
        _buffer.length = 0;
    }

    return { record, getEntries, getLast, flush, clear };
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Singleton global de audit log para src/copilot. */
export const defaultAuditLog = createAuditLog();
