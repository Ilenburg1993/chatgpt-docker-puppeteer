// @ts-check
/**
 * @module copilot/agent/background-tasks
 * @file Tracker de tarefas em background do agente. Centraliza operações fire-and-forget para permitir drenagem
 *   graciosa no shutdown e emissão de eventos de observabilidade.
 * @see EventBus
 */

import { logSwallowed, toError } from '#copilot/core';

/**
 * @typedef {Object} BackgroundTaskMeta
 * @property {string} [label] - Identificador curto da tarefa em background.
 * @property {string} [description] - Descrição humana da tarefa.
 */

/**
 * @typedef {Object} BackgroundTaskCompletedEvent
 * @property {string} label - Identificador curto da tarefa.
 * @property {string} description - Descrição humana da tarefa.
 * @property {'success' | 'error'} status - Resultado final da tarefa.
 * @property {number} durationMs - Duração observada em milissegundos.
 * @property {number} pendingCount - Quantidade restante de tarefas após esta conclusão.
 * @property {string} [error] - Mensagem de erro quando `status='error'`.
 * @property {number} ts - Timestamp da conclusão.
 */

/**
 * @typedef {Object} BackgroundTasksOptions
 * @property {(event: BackgroundTaskCompletedEvent) => void} [onCompleted] - Callback por conclusão individual.
 * @property {(event: { pendingCount: 0; ts: number }) => void} [onIdle] - Callback quando a fila zera.
 */

/**
 * Tracker de promises em background com suporte a drain no shutdown.
 */
export class BackgroundTasks {
    /** @type {Set<Promise<void>>} */
    #tasks = new Set();

    /** @type {number} */
    #sequence = 0;

    /** @type {((event: BackgroundTaskCompletedEvent) => void) | undefined} */
    #onCompleted;

    /** @type {((event: { pendingCount: 0; ts: number }) => void) | undefined} */
    #onIdle;

    /**
     * @param {BackgroundTasksOptions} [options]
     */
    constructor(options = {}) {
        this.#onCompleted = options.onCompleted;
        this.#onIdle = options.onIdle;
    }

    /**
     * Quantidade atual de tasks pendentes.
     *
     * @returns {number}
     */
    get pendingCount() {
        return this.#tasks.size;
    }

    /**
     * Registra uma promise em background e garante limpeza/telemetria na conclusão.
     *
     * A promise retornada nunca rejeita; erros são logados como swallowed e expostos no callback `onCompleted`.
     *
     * @param {Promise<unknown>} task
     * @param {BackgroundTaskMeta} [meta]
     * @returns {Promise<void>}
     */
    track(task, meta = {}) {
        const label = meta.label ?? `background-task-${++this.#sequence}`;
        const description = meta.description ?? label;
        const startedAt = Date.now();

        /** @type {Promise<void>} */
        const tracked = Promise.resolve(task)
            .then(
                () => ({ status: /** @type {'success'} */ ('success'), error: undefined }),
                (error) => {
                    logSwallowed(error, `agent.background.${label}`);
                    return { status: /** @type {'error'} */ ('error'), error: toError(error).message };
                },
            )
            .then(({ status, error }) => {
                this.#tasks.delete(tracked);
                this.#onCompleted?.({
                    label,
                    description,
                    status,
                    ...(error ? { error } : {}),
                    durationMs: Date.now() - startedAt,
                    pendingCount: this.#tasks.size,
                    ts: Date.now(),
                });
                if (this.#tasks.size === 0) {
                    this.#onIdle?.({ pendingCount: 0, ts: Date.now() });
                }
            });

        this.#tasks.add(tracked);
        return tracked;
    }

    /**
     * Aguarda a conclusão das tarefas atualmente pendentes até o timeout especificado.
     *
     * @param {number} [timeoutMs=5000] Default is `5000`
     * @returns {Promise<boolean>} `true` se todas as tarefas drenaram a tempo; `false` caso contrário.
     */
    async drain(timeoutMs = 5000) {
        const deadline = Date.now() + Math.max(0, timeoutMs);

        while (this.#tasks.size > 0) {
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) {
                return false;
            }

            const pending = [...this.#tasks];
            await Promise.race([
                Promise.allSettled(pending),
                new Promise((resolve) => setTimeout(resolve, remainingMs)),
            ]);
        }

        return true;
    }
}
