// @ts-check
/**
 * src/copilot/hooks/audit-trail.js
 *
 * E3.1 — Audit trail completo de todas as decisões de hooks.
 *
 * Registra cada decisão de hook (permissão, modificação, erro) em um buffer estruturado com suporte a consulta,
 * filtragem e exportação para compliance dashboard.
 *
 * @module copilot/hooks/audit-trail
 * @see EventBus
 */

import { log } from './logger.js';

/**
 * @typedef {'allow' | 'deny' | 'ask' | 'skip' | 'retry' | 'abort' | 'modify' | 'enrich' | 'cleanup'} DecisionType
 */

/**
 * @typedef {object} AuditDecision
 * @property {string} hookName - Nome do hook (ex: 'onPreToolUse', 'onSessionEnd')
 * @property {DecisionType} decision - Tipo da decisão tomada
 * @property {string} sessionId - ID da sessão
 * @property {string} [toolName] - Nome da tool (se aplicável)
 * @property {string} [reason] - Motivo da decisão
 * @property {number} timestamp - Timestamp da decisão (ms epoch)
 * @property {number} [durationMs] - Duração do processamento do hook
 * @property {Record<string, unknown>} [metadata] - Metadados adicionais
 */

/**
 * @typedef {object} AuditTrailStats
 * @property {number} total - Total de decisões registradas
 * @property {Record<DecisionType, number>} byDecision - Contagem por tipo de decisão
 * @property {Record<string, number>} byHook - Contagem por nome de hook
 * @property {number} deniedCount - Total de negações
 * @property {number} allowedCount - Total de aprovações
 * @property {number} errorCount - Total de erros/aborts
 */

/**
 * Buffer circular de decisões de hooks com suporte a consulta e estatísticas.
 */
export class AuditTrail {
    /** @type {AuditDecision[]} */
    #buffer;

    /** @type {number} */
    #maxSize;

    /** @type {number} */
    #writeIndex = 0;

    /** @type {number} */
    #count = 0;

    /**
     * @param {{ maxSize?: number }} [opts]
     */
    constructor(opts) {
        this.#maxSize = opts?.maxSize ?? 1000;
        this.#buffer = new Array(this.#maxSize);
    }

    /**
     * Registra uma decisão de hook.
     *
     * @param {AuditDecision} decision
     */
    record(decision) {
        this.#buffer[this.#writeIndex] = decision;
        this.#writeIndex = (this.#writeIndex + 1) % this.#maxSize;
        if (this.#count < this.#maxSize) this.#count++;

        log(
            'DEBUG',
            `[hooks/audit-trail] ${decision.hookName}: ${decision.decision}` +
                (decision.toolName ? ` tool=${decision.toolName}` : '') +
                (decision.reason ? ` reason=${decision.reason}` : '') +
                ` session=${decision.sessionId}`,
        );
    }

    /**
     * Retorna as últimas N decisões (mais recentes primeiro).
     *
     * @param {number} [n] - Número de decisões (default: todas)
     * @returns {AuditDecision[]}
     */
    tail(n) {
        const count = Math.min(n ?? this.#count, this.#count);
        /** @type {AuditDecision[]} */
        const result = [];
        for (let i = 0; i < count; i++) {
            const idx = (this.#writeIndex - 1 - i + this.#maxSize) % this.#maxSize;
            const entry = this.#buffer[idx];
            if (entry) result.push(entry);
        }
        return result;
    }

    /**
     * Filtra decisões por critérios.
     *
     * @param {{
     *     hookName?: string;
     *     decision?: DecisionType;
     *     sessionId?: string;
     *     toolName?: string;
     *     since?: number;
     * }} filter
     * @returns {AuditDecision[]}
     */
    query(filter) {
        const all = this.tail();
        return all.filter((d) => {
            if (filter.hookName && d.hookName !== filter.hookName) return false;
            if (filter.decision && d.decision !== filter.decision) return false;
            if (filter.sessionId && d.sessionId !== filter.sessionId) return false;
            if (filter.toolName && d.toolName !== filter.toolName) return false;
            if (filter.since && d.timestamp < filter.since) return false;
            return true;
        });
    }

    /**
     * Calcula estatísticas do trail.
     *
     * @returns {AuditTrailStats}
     */
    stats() {
        const all = this.tail();
        /** @type {Record<string, number>} */
        const byDecision = {};
        /** @type {Record<string, number>} */
        const byHook = {};
        let deniedCount = 0;
        let allowedCount = 0;
        let errorCount = 0;

        for (const d of all) {
            byDecision[d.decision] = (byDecision[d.decision] ?? 0) + 1;
            byHook[d.hookName] = (byHook[d.hookName] ?? 0) + 1;
            if (d.decision === 'deny') deniedCount++;
            if (d.decision === 'allow') allowedCount++;
            if (d.decision === 'abort') errorCount++;
        }

        return {
            total: all.length,
            byDecision: /** @type {Record<DecisionType, number>} */ (byDecision),
            byHook,
            deniedCount,
            allowedCount,
            errorCount,
        };
    }

    /**
     * Retorna todas as decisões como JSON serializável (para dashboard/API).
     *
     * @returns {{ decisions: AuditDecision[]; stats: AuditTrailStats }}
     */
    toJSON() {
        return {
            decisions: this.tail(),
            stats: this.stats(),
        };
    }

    /**
     * Limpa todo o buffer.
     */
    clear() {
        this.#buffer = new Array(this.#maxSize);
        this.#writeIndex = 0;
        this.#count = 0;
    }

    /** @returns {number} */
    get size() {
        return this.#count;
    }
}

/**
 * Instância global de audit trail para uso como singleton.
 *
 * @type {AuditTrail}
 */
export const globalAuditTrail = new AuditTrail({ maxSize: 2000 });

/**
 * Cria um wrapper `onPreToolUse` que registra a decisão no audit trail.
 *
 * @param {import('./types.js').PreToolUseHandler} handler - Handler original
 * @param {AuditTrail} [trail] - Trail para registro (default: globalAuditTrail)
 * @returns {import('./types.js').PreToolUseHandler}
 */
export function withPreToolAudit(handler, trail) {
    const t = trail ?? globalAuditTrail;
    return async (input, invocation) => {
        const start = Date.now();
        const result = await handler(input, invocation);
        const decision = result?.permissionDecision ?? 'allow';
        const hasModifiedArgs = result?.modifiedArgs !== undefined;

        t.record({
            hookName: 'onPreToolUse',
            decision: hasModifiedArgs ? 'modify' : /** @type {DecisionType} */ (decision),
            sessionId: invocation?.sessionId ?? '',
            toolName: input.toolName,
            durationMs: Date.now() - start,
            timestamp: Date.now(),
            ...(result?.additionalContext ? { reason: result.additionalContext } : {}),
        });

        return result;
    };
}

/**
 * Cria um wrapper `onPostToolUse` que registra a decisão no audit trail.
 *
 * @param {import('./types.js').PostToolUseHandler} handler - Handler original
 * @param {AuditTrail} [trail] - Trail para registro (default: globalAuditTrail)
 * @returns {import('./types.js').PostToolUseHandler}
 */
export function withPostToolAudit(handler, trail) {
    const t = trail ?? globalAuditTrail;
    return async (input, invocation) => {
        const start = Date.now();
        const result = await handler(input, invocation);
        const hasContext = result?.additionalContext !== undefined;

        t.record({
            hookName: 'onPostToolUse',
            decision: hasContext ? 'enrich' : 'allow',
            sessionId: invocation?.sessionId ?? '',
            toolName: input.toolName,
            durationMs: Date.now() - start,
            timestamp: Date.now(),
        });

        return result;
    };
}

/**
 * Cria um wrapper `onErrorOccurred` que registra a decisão no audit trail.
 *
 * @param {import('./types.js').ErrorOccurredHandler} handler - Handler original
 * @param {AuditTrail} [trail] - Trail para registro (default: globalAuditTrail)
 * @returns {import('./types.js').ErrorOccurredHandler}
 */
export function withErrorAudit(handler, trail) {
    const t = trail ?? globalAuditTrail;
    return async (input, invocation) => {
        const start = Date.now();
        const result = await handler(input, invocation);

        t.record({
            hookName: 'onErrorOccurred',
            decision: /** @type {DecisionType} */ (result?.errorHandling ?? 'abort'),
            sessionId: invocation?.sessionId ?? '',
            reason: `${input.errorContext}: ${input.error}`,
            durationMs: Date.now() - start,
            timestamp: Date.now(),
            metadata: { recoverable: input.recoverable },
        });

        return result;
    };
}
