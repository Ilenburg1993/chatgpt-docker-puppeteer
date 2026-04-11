// @ts-check
/**
 * src/copilot/services/audit-service.js
 *
 * Fachada de alto nível para operações de auditoria, consolidando audit + observability.
 *
 * @module copilot/services/audit-service
 */

import { defaultAuditLog, getAuditTail, globalAuditBuffer, isHighRiskTool } from '#copilot/audit';
import { container, EVENT_BUS } from '#copilot/core';
import { defaultErrorTracker, defaultMetrics, log } from '#copilot/observability';
import { AUDIT_LOG } from '#copilot/events';

/**
 * Fachada de auditoria — consolida operações de audit + observability.
 */
export class AuditService {
    /** @type {import('../core/event-bus.js').EventBus | null} */
    #eventBus = null;

    /**
     * Obtém EventBus (lazy).
     *
     * @returns {import('../core/event-bus.js').EventBus | null}
     */
    #bus() {
        if (!this.#eventBus) {
            try {
                this.#eventBus = container.resolve(EVENT_BUS);
            } catch {
                // EventBus não registrado
            }
        }
        return this.#eventBus;
    }

    /**
     * Obtém as últimas N entradas do audit log.
     *
     * @param {number} [count=50] Default is `50`
     * @returns {any[]}
     */
    getTail(count = 50) {
        return getAuditTail(count);
    }

    /**
     * Obtém o audit log padrão.
     *
     * @returns {any}
     */
    getDefaultLog() {
        return defaultAuditLog;
    }

    /**
     * Verifica se uma tool é high-risk.
     *
     * @param {string} toolName
     * @returns {boolean}
     */
    isHighRisk(toolName) {
        return isHighRiskTool(toolName);
    }

    /**
     * Obtém o global audit buffer.
     *
     * @returns {any}
     */
    getBuffer() {
        return globalAuditBuffer;
    }

    /**
     * Obtém o error tracker.
     *
     * @returns {any}
     */
    getErrorTracker() {
        return defaultErrorTracker;
    }

    /**
     * Obtém a store de métricas.
     *
     * @returns {any}
     */
    getMetrics() {
        return defaultMetrics;
    }

    /**
     * Loga uma entrada de auditoria.
     *
     * @param {'DEBUG' | 'INFO' | 'WARN' | 'ERROR'} level
     * @param {string} message
     */
    logAudit(level, message) {
        log(level, `[AuditService] ${message}`);
        this.#bus()?.emit({ type: AUDIT_LOG });
    }
}

/**
 * Cria instância de AuditService.
 *
 * @returns {AuditService}
 */
export function createAuditService() {
    return new AuditService();
}
