// @ts-check
/**
 * src/copilot/core/circuit-breaker.js
 *
 * Circuit breaker centralizado (padrão Closed → Open → Half-Open). Protege chamadas a serviços remotos contra falhas em
 * cascata.
 *
 * @module copilot/core/circuit-breaker
 * @see EventBus
 */

import { CopilotError } from './errors.js';

/**
 * Erro lançado quando o circuit breaker está aberto e rejeita a execução.
 */
export class CircuitOpenError extends CopilotError {
    /**
     * @param {string} name - Nome do circuit breaker
     */
    constructor(name) {
        super(`Circuit breaker "${name}" is OPEN — request rejected`, 'CIRCUIT_OPEN');
        this.name = 'CircuitOpenError';
    }
}

/** @typedef {'closed' | 'open' | 'half-open'} CircuitState */

/**
 * @typedef {object} CircuitBreakerOptions
 * @property {number} [failThreshold=5] - Falhas consecutivas para abrir o circuito. Default is `5`
 * @property {number} [resetTimeoutMs=30000] - Tempo em ms para transitar de open → half-open. Default is `30000`
 * @property {number} [halfOpenMax=2] - Tentativas permitidas em half-open antes de reabrir. Default is `2`
 */

export class CircuitBreaker {
    /** @type {string} */
    #name;
    /** @type {CircuitState} */
    #state = 'closed';
    /** @type {number} */
    #failCount = 0;
    /** @type {number} */
    #halfOpenAttempts = 0;
    /** @type {number} */
    #failThreshold;
    /** @type {number} */
    #resetTimeoutMs;
    /** @type {number} */
    #halfOpenMax;
    /** @type {number} */
    #openedAt = 0;

    /**
     * @param {string} name - Nome identificador do circuit breaker
     * @param {CircuitBreakerOptions} [opts] - Opções de configuração
     */
    constructor(name, opts = {}) {
        this.#name = name;
        this.#failThreshold = opts.failThreshold ?? 5;
        this.#resetTimeoutMs = opts.resetTimeoutMs ?? 30_000;
        this.#halfOpenMax = opts.halfOpenMax ?? 2;
    }

    /**
     * Executa a função protegida pelo circuit breaker. Lança `CircuitOpenError` se o circuito estiver aberto e o
     * timeout de reset ainda não expirou.
     *
     * @template T
     * @param {() => Promise<T>} fn - Função async a executar
     * @returns {Promise<T>}
     * @throws {CircuitOpenError} Se o circuito estiver aberto
     */
    async execute(fn) {
        if (this.#state === 'open') {
            if (Date.now() - this.#openedAt >= this.#resetTimeoutMs) {
                this.#state = 'half-open';
                this.#halfOpenAttempts = 0;
            } else {
                throw new CircuitOpenError(this.#name);
            }
        }

        if (this.#state === 'half-open') {
            this.#halfOpenAttempts++;
            if (this.#halfOpenAttempts > this.#halfOpenMax) {
                this.#state = 'open';
                this.#openedAt = Date.now();
                throw new CircuitOpenError(this.#name);
            }
        }

        try {
            const result = await fn();
            this.#onSuccess();
            return result;
        } catch (err) {
            this.#onFailure();
            throw err;
        }
    }

    #onSuccess() {
        this.#failCount = 0;
        this.#halfOpenAttempts = 0;
        this.#state = 'closed';
    }

    #onFailure() {
        this.#failCount++;
        if (this.#state === 'half-open' || this.#failCount >= this.#failThreshold) {
            this.#state = 'open';
            this.#openedAt = Date.now();
        }
    }

    /**
     * Retorna o estado atual do circuit breaker.
     *
     * @returns {CircuitState}
     */
    getState() {
        return this.#state;
    }

    /**
     * Reseta o circuit breaker para o estado inicial (closed).
     */
    reset() {
        this.#state = 'closed';
        this.#failCount = 0;
        this.#halfOpenAttempts = 0;
        this.#openedAt = 0;
    }
}
