// @ts-check
/**
 * src/copilot/hooks/audit.js
 *
 * Auditoria interna do módulo de hooks SDK — Buffer em memória para capturar chamadas de ferramentas via
 * `onPostToolUse`.
 *
 * Resolve o **Gap 10** do roadmap: a tool `hook_get_audit_tail` em `tools/hook-tools.js` lia diretamente de
 * `.github/hooks/state/audit.jsonl`, misturando o log de compliance operacional (hooks do VS Code Copilot) com o log de
 * tool calls do SDK. Este módulo fornece um registro interno isolado, que pode ser consultado sem acesso ao filesystem
 * de `.github/`.
 *
 * ## Arquitetura
 *
 * - `AuditRingBuffer` — buffer circular de tamanho fixo (default 500 entradas)
 * - `globalAuditBuffer` — instância singleton do ring buffer
 * - `createAuditPostToolHandler(logger)` — factory que produz um handler `onPostToolUse` que registra no buffer e delega
 *   ao logger opcional (e.g. `tool-audit-logger.js`)
 * - `getAuditTail(n)` — retorna as N entradas mais recentes do buffer global
 *
 * ## Isolamento
 *
 * Este módulo **nunca** importa de `.github/hooks/` ou lê o `audit.jsonl` do sistema operacional.
 *
 * @module copilot/hooks/audit
 * @see module:copilot/hooks/types
 */

import { log } from '#core/logger';

/**
 * @typedef {import('./types.js').AuditEntry} AuditEntry
 *
 * @typedef {import('./types.js').AuditRingBufferConfig} AuditRingBufferConfig
 */

// ─── AuditRingBuffer ──────────────────────────────────────────────────────────

/**
 * Buffer circular de tamanho fixo para entradas de auditoria SDK.
 *
 * Quando o buffer está cheio, a entrada mais antiga é sobrescrita (comportamento FIFO circular). Operações são O(1)
 * para push e O(n) para snapshot.
 *
 * @example
 *     const buf = new AuditRingBuffer({ capacity: 100 });
 *     buf.push({
 *         toolName: 'read_file',
 *         toolArgs: {},
 *         toolResult: '...',
 *         sessionId: 'abc',
 *         ts: new Date().toISOString(),
 *         durationMs: 42,
 *     });
 *     const last10 = buf.tail(10);
 */
export class AuditRingBuffer {
    /**
     * @param {AuditRingBufferConfig} [config]
     */
    constructor(config = {}) {
        /** @type {number} */
        this._capacity = config.capacity ?? 500;
        /** @type {AuditEntry[]} */
        this._buffer = new Array(this._capacity);
        /** @type {number} write pointer (mod capacity) */
        this._writePos = 0;
        /** @type {number} total entries ever written */
        this._total = 0;
    }

    /**
     * Insere uma nova entrada no buffer. Se cheio, sobrescreve a entrada mais antiga.
     *
     * @param {AuditEntry} entry
     * @returns {void}
     */
    push(entry) {
        this._buffer[this._writePos % this._capacity] = entry;
        this._writePos++;
        this._total++;
    }

    /**
     * Retorna as últimas `n` entradas em ordem cronológica (mais antiga → mais recente).
     *
     * @param {number} [n] - Número de entradas (default: 20, máximo: capacity)
     * @returns {AuditEntry[]}
     */
    tail(n = 20) {
        const count = Math.min(n, this._capacity, this._total);
        if (count === 0) return [];

        const result = /** @type {AuditEntry[]} */ ([]);
        const size = Math.min(this._total, this._capacity);
        const start = this._total <= this._capacity ? 0 : this._writePos % this._capacity;

        for (let i = 0; i < size; i++) {
            const idx = (start + i) % this._capacity;
            const entry = this._buffer[idx];
            if (entry !== undefined) result.push(entry);
        }

        return result.slice(-count);
    }

    /**
     * Retorna o número total de entradas que foram inseridas (pode ser maior que capacity).
     *
     * @returns {number}
     */
    get total() {
        return this._total;
    }

    /**
     * Retorna o número de entradas atualmente no buffer (limitado por capacity).
     *
     * @returns {number}
     */
    get size() {
        return Math.min(this._total, this._capacity);
    }

    /**
     * Esvazia o buffer (útil em testes).
     *
     * @returns {void}
     */
    clear() {
        this._buffer = new Array(this._capacity);
        this._writePos = 0;
        this._total = 0;
    }
}

// ─── Instância global ─────────────────────────────────────────────────────────

/**
 * Buffer global de auditoria SDK. Usado por `hook_get_audit_tail` e `createAuditPostToolHandler`.
 *
 * A capacidade pode ser configurada via variável de ambiente `COPILOT_AUDIT_BUFFER_SIZE` (default: 500).
 *
 * @type {AuditRingBuffer}
 */
export const globalAuditBuffer = new AuditRingBuffer({
    capacity: Number(process.env['COPILOT_AUDIT_BUFFER_SIZE']) || 500,
});

// ─── Factory de handler onPostToolUse ─────────────────────────────────────────

/**
 * Cria um handler `onPostToolUse` que captura entradas no `globalAuditBuffer` e delega ao `logger` externo (opcional).
 *
 * O handler é puro — não lança exceções. Falhas no logger são silenciadas para não interromper a sessão SDK.
 *
 * @example
 *     import { createAuditPostToolHandler } from '#copilot/hooks/audit';
 *     const hooks = {
 *         onPostToolUse: createAuditPostToolHandler(),
 *     };
 *
 * @example
 *     // Com logger externo (tool-audit-logger.js):
 *     import { logToolAudit } from '#copilot/agent/tool-audit-logger';
 *     const hooks = {
 *         onPostToolUse: createAuditPostToolHandler((entry) =>
 *             logToolAudit({ tool: entry.toolName, decision: 'approved', highRisk: false }),
 *         ),
 *     };
 *
 * @param {((entry: AuditEntry) => void) | null | undefined} [logger] - Logger externo opcional
 * @param {AuditRingBuffer} [buffer] - Buffer alvo (default: globalAuditBuffer)
 * @returns {(
 *     input: { toolName: string; toolArgs: unknown; toolResult: unknown; timestamp?: string },
 *     invocation: { sessionId: string },
 * ) => Promise<{ additionalContext?: string }>}
 */
export function createAuditPostToolHandler(logger, buffer = globalAuditBuffer) {
    return async (input, invocation) => {
        const entry = /** @type {AuditEntry} */ ({
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
                log('WARN', `[hooks/audit] logger externo lançou exceção: ${err?.message}`);
            }
        }

        return {};
    };
}

// ─── API de leitura ───────────────────────────────────────────────────────────

/**
 * Retorna as últimas `n` entradas do buffer global de auditoria SDK.
 *
 * Usado por `hook_get_audit_tail` para expor o log de tool calls ao modelo sem depender do filesystem de
 * `.github/hooks/`.
 *
 * @example
 *     const entries = getAuditTail(20);
 *
 * @param {number} [n] - Número de entradas (default: 20)
 * @param {AuditRingBuffer} [buffer] - Buffer fonte (default: globalAuditBuffer)
 * @returns {AuditEntry[]}
 */
export function getAuditTail(n = 20, buffer = globalAuditBuffer) {
    return buffer.tail(n);
}
