// @ts-check
/**
 * @module copilot/agent/task-executor
 * @file Execução assíncrona de uma tarefa individual do agente.
 *
 *   Extrai o IIFE interno de `AlwaysAliveAgent#processQueue`, tornando a lógica de send/await/reconexão testável de forma
 *   independente.
 *
 *   Por usar callbacks em vez de acessar campos privados diretamente, a função se mantém desacoplada do ciclo de vida do
 *   agente pai.
 */

import { auditToolComplete, auditToolStart } from '#copilot/channel';

/**
 * @typedef {object} TaskExecutorCallbacks
 * @property {(chunk: string, taskId: string) => void} onDelta - Emite fragmento de resposta em streaming
 * @property {(status: 'idle' | 'processing' | 'waiting_for_input' | 'starting' | 'stopped') => void} setStatus - Muda
 *   status do agente
 * @property {(event: string, payload: object) => void} emit - Emite evento no agente pai
 * @property {(error: Error) => Promise<boolean>} tryReconnect - Tenta reconectar a sessão; retorna true se ok
 * @property {() => void} scheduleNext - Re-agenda a fila para processar próxima tarefa
 * @property {(task: QueuedTask) => void} requeueTask - Reinsere tarefa no início da fila
 */

/**
 * @typedef {object} QueuedTask
 * @property {string} id
 * @property {string} message
 * @property {number} [timeoutMs]
 * @property {import('@github/copilot-sdk').MessageOptions['attachments']} [attachments]
 * @property {number} enqueuedAt
 * @property {number} [attempts] - RF-D02: número de tentativas realizadas (para limitar reintentos)
 * @property {(text: string) => void} resolve
 * @property {(err: Error) => void} reject
 */

/**
 * Executa uma única tarefa da fila do agente de forma assíncrona.
 *
 * Subscreve ao streaming de tokens, aguarda a resposta completa e trata erros com reconexão transparente. Chama os
 * callbacks fornecidos para toda interação com o estado do agente pai, evitando acesso direto a campos privados.
 *
 * @param {any} session Sessão SDK ativa — deve expor `on` e `sendAndWait`.
 * @param {QueuedTask} task - Tarefa a executar
 * @param {TaskExecutorCallbacks} callbacks - Callbacks de interação com o agente pai
 * @returns {Promise<void>}
 */
export async function executeTask(session, task, callbacks) {
    const { onDelta, setStatus, emit, tryReconnect, scheduleNext, requeueTask } = callbacks;

    // Subscreve ao streaming de tokens enquanto a tarefa está em andamento
    const unsubDelta = session.on('assistant.message_delta', (/** @type {any} */ event) => {
        const chunk = event?.data?.deltaContent ?? '';
        if (chunk) onDelta(chunk, task.id);
    });

    // Subscreve a eventos de execução de tool para auditoria e observabilidade
    const unsubToolStart = session.on('tool.execution_start', (/** @type {any} */ event) => {
        auditToolStart({
            toolCallId: event?.data?.toolCallId ?? '',
            toolName: event?.data?.toolName ?? '',
            args: event?.data?.arguments ?? {},
            mcpServerName: event?.data?.mcpServerName ?? null,
        });
        emit('tool.execution.start', {
            toolCallId: event?.data?.toolCallId ?? '',
            toolName: event?.data?.toolName ?? '',
            args: event?.data?.arguments ?? {},
            mcpServerName: event?.data?.mcpServerName ?? null,
            taskId: task.id,
        });
    });

    const unsubToolComplete = session.on('tool.execution_complete', (/** @type {any} */ event) => {
        auditToolComplete({
            toolCallId: event?.data?.toolCallId ?? '',
            success: event?.data?.success ?? false,
            taskId: task.id,
            resultContent: event?.data?.result?.content ?? null,
        });
        emit('tool.execution.complete', {
            toolCallId: event?.data?.toolCallId ?? '',
            toolName: event?.data?.toolName ?? null,
            success: event?.data?.success ?? false,
            taskId: task.id,
        });
    });

    // F4.3 (UPG-06): captura o timestamp exato de session.idle para durationMs preciso
    const startTime = Date.now();
    /** @type {number | undefined} */
    let idleTime;
    const unsubIdle = session.on('session.idle', () => {
        idleTime = Date.now();
    });

    try {
        const sendOpts = /** @type {import('@github/copilot-sdk').MessageOptions} */ ({
            prompt: task.message,
            ...(task.attachments !== undefined ? { attachments: task.attachments } : {}),
        });
        const event = await session.sendAndWait(sendOpts, task.timeoutMs ?? 60_000);
        const text = event?.data?.content ?? '';
        const durationMs = (idleTime ?? Date.now()) - startTime;
        setStatus('idle');
        emit('task.completed', { taskId: task.id, response: text, responseLen: text.length, durationMs });
        task.resolve(text);
    } catch (/** @type {any} */ e) {
        // Tenta reconectar com backoff exponencial se parecer erro de rede/sessão
        const recovered = await tryReconnect(e);
        if (recovered) {
            // RF-D02: limitar reintentos transparentes para evitar loop infinito em falhas repetidas
            const MAX_TASK_RETRIES = 3;
            task.attempts = (task.attempts ?? 0) + 1;
            if (task.attempts >= MAX_TASK_RETRIES) {
                setStatus('idle');
                emit('task.error', {
                    taskId: task.id,
                    error: `Máximo de ${MAX_TASK_RETRIES} tentativas atingido após reconexão`,
                });
                task.reject(
                    new Error(`[task-executor] Máximo de ${MAX_TASK_RETRIES} tentativas atingido (taskId: ${task.id})`),
                );
            } else {
                // Sessão restaurada: reenfileira a tarefa para nova tentativa
                requeueTask(task);
                setStatus('idle');
            }
        } else {
            setStatus('idle');
            emit('task.error', { taskId: task.id, error: e.message });
            task.reject(e);
        }
    } finally {
        // SDK-06 (fix): garantir que os listeners são removidos em qualquer caminho de execução
        // (sucesso, erro, ou exceção relançada após tryReconnect) para evitar memory leak acumulado
        unsubDelta();
        unsubToolStart();
        unsubToolComplete();
        unsubIdle();
        scheduleNext();
    }
}
