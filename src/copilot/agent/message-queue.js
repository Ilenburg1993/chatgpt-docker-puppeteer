// @ts-check
/**
 * src/copilot/agent/message-queue.js
 *
 * Fila de tarefas (`AgentTask[]`) com suporte a AbortSignal, verificação de capacidade máxima e drain de shutdown.
 * Extrai responsabilidade de `always-alive.js` (F.4) para isolar o ciclo de vida da fila.
 *
 * Intencionalmente _não_ implementa o processamento de tarefas (`executeTask`, sessão, status) — essa lógica permanece
 * no host `AlwaysAliveAgent` que instancia esta classe e chama `scheduleNext()`.
 *
 * @module copilot/agent/message-queue
 */

import { MAX_QUEUE_SIZE } from '#copilot/core/constants';
import { SessionError } from '#copilot/core/errors';
import { log } from '#core/logger';

// ─── Typedefs ────────────────────────────────────────────────────────────────

/**
 * Tarefa de envio de mensagem aguardando processamento na fila.
 *
 * @typedef {Object} AgentTask
 * @property {string} id - ID único da tarefa
 * @property {string} message - Mensagem a enviar ao modelo
 * @property {function(string): void} resolve - Callback de resolução da Promise
 * @property {function(Error): void} reject - Callback de rejeição da Promise
 * @property {number} enqueuedAt - Timestamp em ms do momento de enqueue
 * @property {number} [timeoutMs] - Timeout personalizado para sendAndWait (ms). `undefined` = usa padrão do SDK (60 s).
 * @property {import('@github/copilot-sdk').MessageOptions['attachments']} [attachments] - Anexos adicionais
 */

// ─── MessageQueue ─────────────────────────────────────────────────────────────

/**
 * Gerencia a fila de tarefas do `AlwaysAliveAgent`.
 *
 * Responsabilidades:
 *
 * - Manter a lista `AgentTask[]` em memória
 * - Verificar capacidade máxima (`MAX_QUEUE_SIZE`) no enqueue
 * - Remover tarefas canceladas via `AbortSignal`
 * - Rejeitar todas as tarefas pendentes no shutdown (`drain()`)
 * - Expor `size`, `oldest`, `shift()`, `unshift()` para o processador no host
 *
 * O processamento efetivo (executar tarefa, atualizar status, chamar SDK) é feito pelo host por meio do callback
 * `onEnqueue` (ou chamando `scheduleNext()` manualmente após cada `shift()`).
 */
export class MessageQueue {
    /** @type {AgentTask[]} */
    #items = [];

    /**
     * Callback invocado sempre que um item é adicionado à fila. O host usa isso para disparar `#processQueue()` sem
     * criar dependência circular.
     *
     * @type {(() => void) | undefined}
     */
    #onEnqueue;

    /**
     * Callback para invalidar caches externos que dependem do tamanho da fila.
     *
     * @type {(() => void) | undefined}
     */
    #onChanged;

    /**
     * @param {{
     *     onEnqueue?: () => void;
     *     onChanged?: () => void;
     * }} [opts]
     */
    constructor(opts = {}) {
        this.#onEnqueue = opts.onEnqueue;
        this.#onChanged = opts.onChanged;
    }

    // ─── Getters ─────────────────────────────────────────────────────────────

    /**
     * Número de tarefas atualmente na fila.
     *
     * @returns {number}
     */
    get size() {
        return this.#items.length;
    }

    /**
     * Tarefa mais antiga (primeira posição da fila), ou `undefined` se a fila estiver vazia.
     *
     * @returns {AgentTask | undefined}
     */
    get oldest() {
        return this.#items[0];
    }

    // ─── Enqueue ─────────────────────────────────────────────────────────────

    /**
     * Adiciona uma tarefa ao final da fila.
     *
     * - Verifica capacidade máxima (`MAX_QUEUE_SIZE`); rejeita com `SESSION_ERROR('QUEUE_FULL')` se excedida.
     * - Registra listener `abort` no `signal` para remover a tarefa da fila e rejeitar a Promise.
     * - Invoca `onEnqueue()` após inserção para que o host dispare o processamento.
     *
     * @param {AgentTask} task - Tarefa a enfileirar (já construída pelo host)
     * @param {{ signal?: AbortSignal }} [opts]
     * @returns {void}
     * @throws {SessionError} Se a fila estiver cheia
     */
    enqueue(task, opts = {}) {
        const { signal } = opts;

        // G2-BUG-02: rejeitar imediatamente se o sinal já foi disparado antes do enqueue
        if (signal?.aborted) {
            task.reject(new DOMException('Tarefa cancelada pelo AbortSignal.', 'AbortError'));
            return;
        }

        if (this.#items.length >= MAX_QUEUE_SIZE) {
            const err = new SessionError(
                `[AlwaysAlive] Fila cheia (${MAX_QUEUE_SIZE} tarefas). Tente novamente mais tarde.`,
                'QUEUE_FULL',
            );
            log('WARN', `[AlwaysAlive] sendMessage rejeitado: fila cheia (${this.#items.length}/${MAX_QUEUE_SIZE}).`);
            throw err;
        }

        if (signal) {
            signal.addEventListener(
                'abort',
                () => {
                    const idx = this.#items.indexOf(task);
                    if (idx !== -1) {
                        this.#items.splice(idx, 1);
                        this.#onChanged?.();
                        log('INFO', `[AlwaysAlive] Tarefa ${task.id} cancelada via AbortSignal na fila.`);
                    }
                    task.reject(new DOMException('Tarefa cancelada pelo AbortSignal.', 'AbortError'));
                },
                { once: true },
            );
        }

        this.#items.push(task);
        this.#onChanged?.();
        log('INFO', `[AlwaysAlive] Tarefa enfileirada: ${task.id}`);
        this.#onEnqueue?.();
    }

    // ─── Dequeue ─────────────────────────────────────────────────────────────

    /**
     * Remove e retorna a primeira tarefa da fila. Retorna `undefined` se vazia.
     *
     * @returns {AgentTask | undefined}
     */
    shift() {
        const item = this.#items.shift();
        if (item !== undefined) this.#onChanged?.();
        return item;
    }

    /**
     * Reinsere uma tarefa no início da fila (re-enqueue após falha transiente).
     *
     * @param {AgentTask} task
     * @returns {void}
     */
    unshift(task) {
        this.#items.unshift(task);
        this.#onChanged?.();
    }

    // ─── Shutdown ─────────────────────────────────────────────────────────────

    /**
     * Drena a fila no shutdown: remove todas as tarefas e rejeita-as com o erro fornecido.
     *
     * @param {Error} err - Erro de shutdown a propagar para os callers de `sendMessage()`
     * @returns {AgentTask[]} Lista das tarefas removidas (para logging pelo host)
     */
    drain(err) {
        const tasks = this.#items.splice(0);
        if (tasks.length > 0) {
            this.#onChanged?.();
            for (const task of tasks) {
                // G2-BUG-12: criar cópia por task para que mutações de stack/cause por
                // diferentes handlers não se propagam entre tasks.
                let taskErr = err;
                if (err instanceof Error && tasks.length > 1) {
                    taskErr = Object.assign(
                        err.constructor === Error ? new Error(err.message) : Object.create(Object.getPrototypeOf(err)),
                        err,
                        { stack: err.stack },
                    );
                }
                task.reject(taskErr);
            }
        }
        return tasks;
    }
}
