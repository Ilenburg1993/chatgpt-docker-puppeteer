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

import { startSpanImmediate } from '../../observability/otel.js';

/**
 * Máximo de tentativas de retry por task após reconexão. Configurável via AGENT_MAX_TASK_RETRIES.
 *
 * @type {number}
 */
const MAX_TASK_RETRIES = Number(process.env['AGENT_MAX_TASK_RETRIES']) || 3;

/**
 * Timeout padrão de execução de tarefa em ms. Configurável via AGENT_TASK_TIMEOUT_MS.
 *
 * @type {number}
 */
const DEFAULT_TASK_TIMEOUT_MS = Number(process.env['AGENT_TASK_TIMEOUT_MS']) || 60_000;

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
 * @property {number} [attempts] - Número de tentativas realizadas (para limitar reintentos após reconexão)
 * @property {(text: string) => void} resolve
 * @property {(err: Error) => void} reject
 */

/**
 * Executa uma única tarefa da fila do agente de forma assíncrona.
 *
 * Subscreve ao streaming de tokens, aguarda a resposta completa e trata erros com reconexão transparente. Chama os
 * callbacks fornecidos para toda interação com o estado do agente pai, evitando acesso direto a campos privados.
 *
 * @example
 *     await executeTask(session, task, { onDelta, setStatus, emit, ... });
 *
 * @param {import('@github/copilot-sdk').CopilotSession} session Sessão SDK ativa — deve expor `on` e `sendAndWait`.
 * @param {QueuedTask} task - Tarefa a executar
 * @param {TaskExecutorCallbacks} callbacks - Callbacks de interação com o agente pai
 * @returns {Promise<void>}
 */
export async function executeTask(session, task, callbacks) {
    const { onDelta, setStatus, emit, tryReconnect, scheduleNext, requeueTask } = callbacks;

    // Subscreve ao streaming de tokens enquanto a tarefa está em andamento
    const unsubDelta = session.on(
        'assistant.message_delta',
        (/** @type {{ data?: Record<string, unknown> }} */ event) => {
            const chunk = /** @type {string} */ (event?.data?.['deltaContent'] ?? '');
            if (chunk) onDelta(chunk, task.id);
        },
    );

    // CO-01: span OTEL para toda a tarefa
    const taskSpan = startSpanImmediate('copilot.task', { taskId: task.id });

    // Subscreve a eventos de execução de tool para observabilidade (SSE/NERV consumers)
    // Fase BC: removidas chamadas redundantes a defaultAuditLog.recordToolStart/Complete
    // (o event-collector.js já cobre registro completo via seus handlers dedicados)
    // Fase BC: corrigido naming dot→underscore para alinhar com AGENT_EVENTS em events.js

    /** @type {Map<string, import('../observability/otel.js').OtelSpan>} CO-02: spans por tool call */
    const _toolSpans = new Map();

    const unsubToolStart = session.on(
        'tool.execution_start',
        (/** @type {{ data?: Record<string, unknown> }} */ event) => {
            const toolCallId = /** @type {string} */ (event?.data?.['toolCallId'] ?? '');
            const toolName = /** @type {string} */ (event?.data?.['toolName'] ?? '');
            // CO-02: span OTEL por tool execution
            const toolSpan = startSpanImmediate('copilot.tool', { toolName, toolCallId, taskId: task.id });
            if (toolSpan && toolCallId) _toolSpans.set(toolCallId, toolSpan);
            emit('tool.execution_start', {
                toolCallId,
                toolName,
                args: event?.data?.['arguments'] ?? {},
                mcpServerName: /** @type {string | null} */ (event?.data?.['mcpServerName'] ?? null),
                taskId: task.id,
            });
        },
    );

    const unsubToolComplete = session.on(
        'tool.execution_complete',
        (/** @type {{ data?: Record<string, unknown> }} */ event) => {
            const toolCallId = /** @type {string} */ (event?.data?.['toolCallId'] ?? '');
            // CO-02: fecha span de tool
            const toolSpan = _toolSpans.get(toolCallId);
            if (toolSpan) {
                toolSpan.end();
                _toolSpans.delete(toolCallId);
            }
            emit('tool.execution_complete', {
                toolCallId,
                toolName: /** @type {string | null} */ (event?.data?.['toolName'] ?? null),
                success: /** @type {boolean} */ (event?.data?.['success'] ?? false),
                taskId: task.id,
            });
        },
    );

    // Captura o timestamp exato de session.idle para durationMs preciso.
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
        const event = await session.sendAndWait(sendOpts, task.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS);
        const text = event?.data?.content ?? '';
        const durationMs = (idleTime ?? Date.now()) - startTime;
        setStatus('idle');
        emit('task.completed', { taskId: task.id, response: text, responseLen: text.length, durationMs });
        task.resolve(text);
    } catch (/** @type {any} */ e) {
        // G1-BUG-03 (fix): AbortError não é erro de rede/sessão — não deve acionar reconexão.
        if (e instanceof DOMException && e.name === 'AbortError') {
            setStatus('idle');
            emit('task.error', { taskId: task.id, error: 'AbortError' });
            task.reject(e);
            return;
        }
        // Tenta reconectar com backoff exponencial se parecer erro de rede/sessão
        const recovered = await tryReconnect(e);
        if (recovered) {
            // Limita reintentos transparentes para evitar loop infinito em falhas repetidas.
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
        // CO-01/CO-02: fechar spans OTEL residuais
        for (const span of _toolSpans.values()) span.end();
        _toolSpans.clear();
        taskSpan?.end();
        scheduleNext();
    }
}
