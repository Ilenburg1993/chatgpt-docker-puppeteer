// @ts-check
/**
 * src/copilot/services/audit-service.js
 *
 * Fachada de alto nível para operações de auditoria, consolidando audit + observability.
 *
 * @module copilot/services/audit-service
 */

import { AUDIT_LOG, defaultAuditLog, getAuditTail, globalAuditBuffer, isHighRiskTool } from '#copilot/audit';
import { container, EVENT_BUS } from '#copilot/core';
import { ERROR_TRACKER, log, METRICS_STORE } from '#copilot/observability';

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
     * @returns {import('../audit/pipeline-audit-log.js').AuditEntry[]}
     */
    getTail(count = 50) {
        return /** @type {import('../audit/pipeline-audit-log.js').AuditEntry[]} */ (
            /** @type {unknown} */ (getAuditTail(count))
        );
    }

    /**
     * Obtém o audit log padrão.
     *
     * @returns {import('../audit/pipeline-audit-log.js').AuditLog}
     */
    getDefaultLog() {
        return /** @type {import('../audit/pipeline-audit-log.js').AuditLog} */ (
            /** @type {unknown} */ (defaultAuditLog)
        );
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
     * @returns {import('../audit/ring-buffer.js').AuditRingBuffer<
     *     import('../audit/pipeline-sdk-buffer.js').SdkAuditEntry
     * >}
     */
    getBuffer() {
        return globalAuditBuffer;
    }

    /**
     * Obtém o error tracker.
     *
     * @returns {import('../observability/error-tracker.js').ErrorTracker}
     */
    getErrorTracker() {
        return container.resolve(ERROR_TRACKER);
    }

    /**
     * Obtém a store de métricas.
     *
     * @returns {import('../observability/metrics.js').MetricsStore}
     */
    getMetrics() {
        return container.resolve(METRICS_STORE);
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
