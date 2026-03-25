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
 * @property {number} enqueuedAt
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

    try {
        const event = await session.sendAndWait({ prompt: task.message }, task.timeoutMs ?? 60_000);
        unsubDelta();
        const text = event?.data?.content ?? '';
        setStatus('idle');
        emit('task.completed', { taskId: task.id, response: text, responseLen: text.length });
        task.resolve(text);
    } catch (/** @type {any} */ e) {
        unsubDelta();
        // Tenta reconectar com backoff exponencial se parecer erro de rede/sessão
        const recovered = await tryReconnect(e);
        if (recovered) {
            // Sessão restaurada: reenfileira a tarefa para nova tentativa
            requeueTask(task);
            setStatus('idle');
        } else {
            setStatus('idle');
            emit('task.error', { taskId: task.id, error: e.message });
            task.reject(e);
        }
    } finally {
        scheduleNext();
    }
}
