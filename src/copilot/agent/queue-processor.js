// @ts-check
/**
 * @module copilot/agent/queue-processor
 * @see EventBus
 * @file F57: Queue processor — extrai lógica de processamento de fila do AlwaysAliveAgent.
 */

import { EMITTER_TASK_DELTA, EMITTER_TASK_STARTED } from '#copilot/events';
import { log } from '#copilot/observability';
import { executeTask } from './infra/task-executor.js';

/**
 * Processa a próxima tarefa da fila (se idle e sessão ativa).
 *
 * @param {import('./agent-context.js').AgentContext} ctx
 * @param {import('node:events').EventEmitter} host
 * @param {{ tryReconnect: (e: Error) => Promise<boolean> }} callbacks
 * @returns {void}
 */
export function processQueue(ctx, host, callbacks) {
    // G1-ARCH-03: bloqueia processamento durante reconexão ativa
    if (ctx.isReconnecting || ctx.status !== 'idle' || ctx.messageQueue.size === 0 || !ctx.session) return;
    const session = ctx.session;

    const task = ctx.messageQueue.shift();
    if (!task) return;

    ctx.setStatus('processing', host);
    host.emit(EMITTER_TASK_STARTED, { taskId: task.id });

    log('INFO', `[AlwaysAlive] Processando tarefa ${task.id}`);
    ctx.sendCount++;
    // F42.2: registrar atividade para reset do timer de idle do keepalive
    ctx.keepalive.ping();

    void executeTask(session, task, {
        onDelta: (chunk, taskId) => host.emit(EMITTER_TASK_DELTA, { taskId, chunk }),
        setStatus: (s) => ctx.setStatus(s, host),
        emit: (event, payload) => host.emit(event, payload),
        tryReconnect: (e) => callbacks.tryReconnect(e),
        requeueTask: (t) => ctx.messageQueue.unshift(t),
        scheduleNext: () => processQueue(ctx, host, callbacks),
    });
}
