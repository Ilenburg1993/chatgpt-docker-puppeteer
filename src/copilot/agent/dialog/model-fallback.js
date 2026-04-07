// @ts-check
/**
 * src/copilot/agent/dialog/model-fallback.js
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
 */

import { log } from '#copilot/observability/logger';

/**
 * @typedef {Object} AgentHostForFallback
 * @property {() => string} getModel - Retorna o modelo ativo
 * @property {(modelId: string) => void} [setModel] - Altera o modelo ativo
 */

/**
 * Gerencia o estado de fallback de modelo para o dialog loop.
 */
export class ModelFallbackState {
    /** @type {boolean} */
    #pending = false;

    /** @type {string | null} */
    #model;

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
    }

    /**
     * Agenda o fallback de modelo para a próxima inicialização do loop.
     *
     * @param {string} model - Modelo de fallback a usar
     */
    schedule(model) {
        this.#model = model;
        this.#pending = true;
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
     * @returns {{ applied: boolean; previousModel?: string; newModel?: string }}
     */
    applyIfPending(host, emitFn) {
        if (!this.#pending || !this.#model) {
            return { applied: false };
        }
        const prev = host.getModel();
        this.#pending = false;
        if (typeof host.setModel === 'function') {
            host.setModel(this.#model);
        }
        emitFn('model.fallback', { previousModel: prev, newModel: this.#model, ts: Date.now() });
        log('WARN', `[ModelFallbackState] Aplicando modelo fallback: ${prev} → ${this.#model}`);
        return { applied: true, previousModel: prev, newModel: this.#model };
    }
}
