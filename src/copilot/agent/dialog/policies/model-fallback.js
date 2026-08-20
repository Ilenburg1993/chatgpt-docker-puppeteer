// @ts-check
/**
 * src/copilot/agent/dialog/policies/model-fallback.js
 *
 * F60: Encapsula o estado de fallback de modelo do dialog loop.
 *
 * Extraído de loop-manager.js para separação de concerns. O `ModelFallbackState` gerencia:
 *
 * - Flag de fallback pendente
 * - Modelo de fallback agendado
 * - Aplicação do fallback ao host durante boot
 *
 * @module copilot/agent/dialog/model-fallback
 * @see EventBus
 */

import { randomUUID } from 'node:crypto';
import { log } from '../../ports/logging/index.js';

/**
 * @typedef {{
 *     getModel: () => string;
 *     getSessionId?: () => string | null;
 *     setModel?: (model: string) => void;
 *     switchModel?: (
 *         model: string,
 *         options?: { idempotencyKey?: string; source?: string },
 *     ) => Promise<Record<string, unknown>>;
 * }} AgentHostForFallback
 */

/**
 * Gerencia o estado de fallback de modelo para o dialog loop.
 */
export class ModelFallbackState {
    /** @type {boolean} */
    #pending = false;

    /** @type {string | null} */
    #model;

    /** @type {string} */
    #operationNonce = randomUUID();

    /** @type {number} */
    #generation = 0;

    /**
     * @param {{ defaultModel: string | null }} options
     */
    constructor({ defaultModel }) {
        this.#model = defaultModel;
    }

    /**
     * Sinaliza que na próxima inicialização o modelo alternativo deve ser usado.
     */
    setPending() {
        this.#pending = true;
        this.#generation += 1;
    }

    /**
     * Agenda o fallback de modelo para a próxima inicialização do loop.
     *
     * @param {string} model - Modelo de fallback a usar
     */
    schedule(model) {
        this.#model = model;
        this.#pending = true;
        this.#generation += 1;
        log('INFO', `[ModelFallbackState] scheduleFallback: ${model} agendado para próximo boot.`);
    }

    /** @returns {boolean} Se há fallback pendente */
    get pending() {
        return this.#pending;
    }

    /**
     * Aplica o fallback no host se estiver pendente. Emite evento e consome o flag.
     *
     * @param {AgentHostForFallback} host
     * @param {(event: string, payload: Record<string, unknown>) => void} emitFn
     * @returns {{
     *           applied: boolean;
     *           previousModel?: string;
     *           newModel?: string;
     *       }
     *     | Promise<{ applied: boolean; previousModel?: string; newModel?: string }>}
     */
    applyIfPending(host, emitFn) {
        if (!this.#pending || !this.#model) {
            return { applied: false };
        }
        const prev = host.getModel();
        const target = this.#model;
        const commit = () => {
            this.#pending = false;
            emitFn('model.fallback', { previousModel: prev, newModel: target, ts: Date.now() });
            log('WARN', `[ModelFallbackState] Aplicando modelo fallback: ${prev} → ${target}`);
            return { applied: true, previousModel: prev, newModel: target };
        };
        if (typeof host.switchModel === 'function') {
            const sessionId = host.getSessionId?.() ?? 'no-session';
            return host
                .switchModel(target, {
                    idempotencyKey: `dialog-model-fallback:${sessionId}:${target}:${this.#operationNonce}:${this.#generation}`,
                    source: 'agent.dialog.model-fallback',
                })
                .then((operation) => {
                    if (operation['state'] !== 'committed') {
                        throw new Error(
                            `DIALOG_MODEL_FALLBACK_NOT_COMMITTED: state=${String(operation['state'] ?? 'unknown')}`,
                        );
                    }
                    return commit();
                });
        }
        if (typeof host.setModel === 'function') {
            host.setModel(target);
        }
        return commit();
    }
}
