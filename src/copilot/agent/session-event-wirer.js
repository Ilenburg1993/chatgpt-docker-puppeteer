// @ts-check
/**
 * src/copilot/agent/session-event-wirer.js
 *
 * Registra todos os listeners de eventos SDK de uma sessão Copilot, retornando as funções de unsubscribe
 * correspondentes.
 *
 * Função pura sem estado próprio — recebe `session` e um conjunto de callbacks que permitem ao AlwaysAliveAgent reagir
 * aos eventos sem acoplar este módulo ao agente.
 *
 * @module copilot/agent/session-event-wirer
 */

import { log } from '#copilot/observability/logger';
import { writeStateAsync } from './state-io.js';

/**
 * G2-PERF-02: Set de eventos SDK conhecidos como constante de módulo para evitar realocação a cada chamada de
 * `wireSessionEvents()` (ex.: reconexão após disconnect).
 *
 * Expandido na Fase BA para incluir todos os eventos gerenciados pelo event-collector.js, pela própria wirer e pelo
 * task-executor.js. Isso elimina o DEBUG spam gerado pelo catch-all para eventos tratados por outros módulos do
 * sistema.
 *
 * Para detectar eventos genuinamente novos do SDK (que nenhum módulo conhece), mantemos separado o Set
 * `WIRER_HANDLED_EVENTS` com apenas os eventos tratados DIRETAMENTE por esta função.
 *
 * @type {ReadonlySet<string>}
 */
const KNOWN_SDK_EVENTS = new Set([
    // ── Gerenciados pelo event-collector.js (53+ handlers) ──────────────────────
    'abort',
    'assistant.intent',
    'assistant.message',
    'assistant.message_delta',
    'assistant.reasoning_delta',
    'assistant.turn_end',
    'assistant.turn_start',
    'assistant.usage',
    'command.execute',
    'elicitation.completed',
    'elicitation.requested',
    'exit_plan_mode.requested',
    'external_tool.requested',
    'hook.end',
    'hook.start',
    'mcp.oauth_completed',
    'mcp.oauth_required',
    'permission.completed',
    'permission.requested',
    'session.background_tasks_changed',
    'session.compaction_complete',
    'session.compaction_start',
    'session.context_changed',
    'session.error',
    'session.extensions_loaded',
    'session.handoff',
    'session.idle',
    'session.mcp_servers_loaded',
    'session.mcp_server_status_changed',
    'session.mode_changed',
    'session.model_change',
    'session.plan_changed',
    'session.resume',
    'session.shutdown',
    'session.skills_loaded',
    'session.start',
    'session.task_complete',
    'session.tools_updated',
    'session.truncation',
    'session.usage_info',
    'session.warning',
    'skill.invoked',
    'subagent.completed',
    'subagent.deselected',
    'subagent.failed',
    'subagent.selected',
    'subagent.started',
    'system.notification',
    'tool.execution_progress',
    'tool.user_requested',
    'user_input.completed',
    'user_input.requested',
    'user.message',
    // ── Gerenciados pelo task-executor.js (por-tarefa) — NÃO subscrever aqui ────
    'assistant.streaming_delta',
    'tool.execution_complete',
    'tool.execution_partial_result',
    'tool.execution_start',
    // ── Cobertos parcialmente (Fases BI-BK) — reconhecidos para suprimir aviso ──
    'session.info',
    'session.snapshot_rewind',
    'session.title_changed',
    'session.workspace_file_changed',
    'system.message',
    'command.completed',
    'command.queued',
    'commands.changed',
    'exit_plan_mode.completed',
    'external_tool.completed',
    'pending_messages.modified',
    'assistant.reasoning',
]);

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 */

/**
 * Payload genérico de eventos SDK. O SDK emite eventos com um `type` discriminant e `data` variável. Como
 * `session.on(eventName, cb)` não faz narrowing pelo tipo do evento, usamos este typedef genérico que permite acesso
 * via bracket notation em `data`.
 *
 * @typedef {object} SdkEvent
 * @property {string} [kind]
 * @property {string} [type]
 * @property {Record<string, unknown>} [data]
 */

/**
 * Callbacks repassados pelo AlwaysAliveAgent para que o wirer possa notificá-lo sem acoplamento.
 *
 * @typedef {Object} SessionWirerCallbacks
 * @property {(event: string, payload?: any) => void} emit - Emite eventos no agente
 * @property {() => import('./always-alive.js').AgentStatusSnapshot} getStatusSnapshot - Retorna snapshot atual
 * @property {(path: string) => void} onCheckpointPath - Atualiza o último caminho de checkpoint
 * @property {(contextState: { tokens: number; tokenLimit: number; utilization: number } | null) => void} onContextState
 *   - Atualiza estado do contexto
 *
 * @property {(prInfo: {
 *     model?: string;
 *     cost?: number;
 *     quotaSnapshots?: Record<string, unknown>;
 *     ts: number;
 * }) => void} onPrInfo
 *   - Atualiza info de billing
 *
 * @property {() => boolean} isProcessing - true quando status === 'processing' (para filtrar deltas)
 * @property {() => boolean} dialogLoopActive - true quando o dialog loop está ativo (para filtrar deltas de
 *   waiting_for_input)
 */

/**
 * Registra todos os listeners de eventos da sessão SDK.
 *
 * @example
 *     const unsubs = wireSessionEvents(session, false, callbacks);
 *     // cleanup: unsubs.forEach(fn => fn());
 *
 * @param {CopilotSession} session - Sessão SDK ativa
 * @param {boolean} isResumed - Se a sessão foi retomada (afeta aviso de contexto pesado)
 * @param {SessionWirerCallbacks} callbacks - Callbacks para notificar o host
 * @returns {(() => void)[]} Lista de funções de unsubscribe a chamar no cleanup
 */
export function wireSessionEvents(session, isResumed, callbacks) {
    const unsubs = [
        ..._wireCompactionEvents(session, callbacks),
        ..._wireStreamingEvents(session, callbacks),
        ..._wireTokenBudgetEvents(session, isResumed, callbacks),
        ..._wireModeAndToolEvents(session, callbacks),
        ..._wireSystemNotificationEvents(session, callbacks),
        ..._wireSdkResponseEvents(session, callbacks),
        _wireUsageEvent(session, callbacks),
        _wireCatchAll(session, callbacks),
    ];
    return unsubs;
}

// ─── Sub-funções de wireSessionEvents ────────────────────────────────────────

/**
 * Registra eventos de compaction da sessão.
 *
 * @param {CopilotSession} session
 * @param {SessionWirerCallbacks} callbacks
 * @returns {(() => void)[]}
 */
function _wireCompactionEvents(session, { emit, getStatusSnapshot, onCheckpointPath }) {
    return [
        session.on('session.compaction_start', (/** @type {SdkEvent} */ evt) => {
            log('INFO', '[AlwaysAlive] Compaction iniciada (sessão infinita).');
            emit('session.compaction_start', evt?.data ?? {});
        }),
        session.on('session.compaction_complete', (/** @type {SdkEvent} */ evt) => {
            const data = /** @type {{ success?: boolean; checkpointPath?: string }} */ (evt?.data ?? {});
            if (data['success'] === false) {
                log('ERROR', '[AlwaysAlive] Compaction falhou. Sessão pode estar instável.');
                if (data['checkpointPath']) {
                    log(
                        'WARN',
                        `[AlwaysAlive] Checkpoint disponível: ${data['checkpointPath']}. Para recovery manual, restaure esse arquivo e reinicie.`,
                    );
                }
            } else {
                log('INFO', '[AlwaysAlive] Compaction concluída.');
            }
            if (data['checkpointPath']) {
                onCheckpointPath(data['checkpointPath']);
            }
            emit('session.compaction_complete', data);
            const snap = getStatusSnapshot();
            emit('context:compacted', {
                sessionId: snap?.sessionId ?? null,
                ts: Date.now(),
                checkpoint: data['checkpointPath'] ?? null,
            });
        }),
    ];
}

/**
 * Registra eventos de streaming de tokens (reasoning + message delta).
 *
 * F36.2: Separa roteamento de filtro — `task.delta` só é emitido para non-dialog tasks; durante dialog loop, deltas vão
 * para `dialog.delta` (canais distintos para SSE/listeners).
 *
 * @param {CopilotSession} session
 * @param {SessionWirerCallbacks} callbacks
 * @returns {(() => void)[]}
 */
function _wireStreamingEvents(session, { emit, isProcessing, dialogLoopActive }) {
    return [
        session.on('assistant.reasoning_delta', (/** @type {SdkEvent} */ evt) => {
            const chunk = /** @type {string} */ (evt?.data?.['deltaContent'] ?? '');
            if (chunk)
                emit('task.reasoning', {
                    chunk,
                    reasoningId: /** @type {string | null} */ (evt?.data?.['reasoningId'] ?? null),
                });
        }),
        // F36.2: Roteamento explícito — dialog deltas vão para `dialog.delta`, task deltas para `task.delta`.
        // (G1-BUG-06: evita taskId:null no SSE durante dialog loop)
        session.on('assistant.message_delta', (/** @type {SdkEvent} */ evt) => {
            const chunk = /** @type {string} */ (evt?.data?.['deltaContent'] ?? evt?.data?.['content'] ?? '');
            if (!chunk) return;

            if (dialogLoopActive()) {
                // F36.2: Deltas durante dialog loop são internos — roteados para canal dialog
                emit('dialog.delta', { chunk });
                return;
            }
            if (isProcessing()) return; // Suppress durante estado transitório
            emit('task.delta', { taskId: null, chunk });
        }),
    ];
}

/**
 * Verifica uso de tokens e emite aviso quando próximo do limite.
 *
 * @param {{ currentTokens: number; tokenLimit: number }} usageData
 * @param {boolean} isResumed
 * @param {boolean} firstCheck
 * @param {(event: string, payload?: any) => void} emit
 * @returns {void}
 */
function _checkAndEmitTokenBudgetWarning({ currentTokens, tokenLimit }, isResumed, firstCheck, emit) {
    const ratio = Math.round((currentTokens / tokenLimit) * 100);
    if (firstCheck && isResumed && currentTokens / tokenLimit > 0.7) {
        log(
            'WARN',
            `[AlwaysAlive] Sessão retomada com contexto pesado (${ratio}% — ${currentTokens}/${tokenLimit}). Compaction automática pode ocorrer em breve.`,
        );
        emit('session.token_budget_warning', { currentTokens, tokenLimit, ratio, reason: 'startup_heavy' });
    } else if (currentTokens / tokenLimit > 0.8) {
        log(
            'WARN',
            `[AlwaysAlive] Token budget em ${ratio}% (${currentTokens}/${tokenLimit}) — emitindo token_budget_warning`,
        );
        emit('session.token_budget_warning', { currentTokens, tokenLimit, ratio });
    }
}

/**
 * Registra evento de token usage (atualiza contextState + aviso de budget).
 *
 * @param {CopilotSession} session
 * @param {boolean} isResumed
 * @param {SessionWirerCallbacks} callbacks
 * @returns {(() => void)[]}
 */
function _wireTokenBudgetEvents(session, isResumed, { emit, onContextState }) {
    let _firstUsageChecked = false;
    return [
        session.on('session.usage_info', (/** @type {SdkEvent} */ evt) => {
            const data = evt?.data ?? {};
            emit('session.usage', data);
            const currentTokens = /** @type {number} */ (data['currentTokens'] ?? 0);
            const tokenLimit = /** @type {number} */ (data['tokenLimit'] ?? 0);
            if (tokenLimit > 0) {
                onContextState({ tokens: currentTokens, tokenLimit, utilization: currentTokens / tokenLimit });
                _checkAndEmitTokenBudgetWarning({ currentTokens, tokenLimit }, isResumed, !_firstUsageChecked, emit);
                _firstUsageChecked = true;
            }
        }),
    ];
}

/**
 * Registra eventos de mudança de modo.
 *
 * Nota: `tool.execution_start` e `tool.execution_complete` eram subscritos aqui (Fase BC / G2-BUG-14), mas causavam
 * emissão duplicada no AGENT EventEmitter porque `task-executor.js` já os subscreve por-tarefa com enriquecimento de
 * `taskId`. Removidos na Fase CA para eliminar métricas dobradas e eventos duplicados no nerv-bridge.
 *
 * @param {CopilotSession} session
 * @param {SessionWirerCallbacks} callbacks
 * @returns {(() => void)[]}
 */
function _wireModeAndToolEvents(session, { emit }) {
    return [
        session.on('session.mode_changed', (/** @type {SdkEvent} */ evt) => {
            log('INFO', `[AlwaysAlive] Modo mudou: ${evt?.data?.['previousMode']} → ${evt?.data?.['newMode']}`);
            emit('session.mode_changed', evt?.data ?? {});
        }),
        // Fase CA: tool.execution_start e tool.execution_complete removidos daqui.
        // task-executor.js gerencia esses eventos por-tarefa com payload enriquecido (taskId).
    ];
}

/**
 * Propaga subtipos de `system.notification.kind` para o AGENT EventEmitter.
 *
 * O event-collector.js já captura `system.notification` para observabilidade (contadores, persist). Esta função
 * complementa emitindo AGENT_EVENTS para que bridges (nerv-bridge) e observadores possam reagir a conclusões de agentes
 * background e shells sem precisar ler o event-collector.
 *
 * Eventos AGENT emitidos:
 *
 * - `agent.background.completed` — agente background concluiu (status: 'completed' | 'failed')
 * - `agent.background.idle` — agente background ficou idle
 * - `agent.shell.completed` — shell concluiu com exitCode
 * - `agent.shell.detached_completed` — shell desacoplado concluiu
 *
 * @param {CopilotSession} session
 * @param {SessionWirerCallbacks} callbacks
 * @returns {(() => void)[]}
 */
function _wireSystemNotificationEvents(session, { emit }) {
    return [
        session.on('system.notification', (/** @type {SdkEvent} */ event) => {
            const kind = /** @type {Record<string, unknown> & { type: string }} */ (event?.data?.['kind']);
            if (!kind?.type) return;

            switch (kind.type) {
                case 'agent_completed':
                    emit('agent.background.completed', {
                        agentId: kind['agentId'],
                        agentType: kind['agentType'],
                        status: kind['status'],
                        description: kind['description'],
                    });
                    log(
                        'INFO',
                        `[session-event-wirer] system.notification agent_completed: agentId=${kind['agentId']} status=${kind['status']}`,
                    );
                    break;
                case 'agent_idle':
                    emit('agent.background.idle', {
                        agentId: kind['agentId'],
                        agentType: kind['agentType'],
                        description: kind['description'],
                    });
                    log('DEBUG', `[session-event-wirer] system.notification agent_idle: agentId=${kind['agentId']}`);
                    break;
                case 'shell_completed':
                    emit('agent.shell.completed', {
                        shellId: kind['shellId'],
                        exitCode: kind['exitCode'],
                        description: kind['description'],
                    });
                    log(
                        'DEBUG',
                        `[session-event-wirer] system.notification shell_completed: shellId=${kind['shellId']} exitCode=${kind['exitCode'] ?? '?'}`,
                    );
                    break;
                case 'shell_detached_completed':
                    emit('agent.shell.detached_completed', {
                        shellId: kind['shellId'],
                        description: kind['description'],
                    });
                    log(
                        'DEBUG',
                        `[session-event-wirer] system.notification shell_detached_completed: shellId=${kind['shellId']}`,
                    );
                    break;
                default:
                    // kind.type desconhecido dentro de system.notification — silencioso
                    break;
            }
        }),
    ];
}

/**
 * Propaga eventos do SDK previamente não emitidos no AGENT EventEmitter (STREAMING-EVENTS-AUDIT BUG-SE-002/003).
 *
 * - `assistant.intent` — intenção detectada pelo modelo (ex.: 'code_edit', 'explain')
 * - `assistant.reasoning` — bloco de raciocínio completo (não delta)
 * - `assistant.turn_start` / `assistant.turn_end` — ciclo de vida de turns
 * - `session.context_changed` — workspace/branch/cwd mudou
 * - `session.error` — erro de sessão (auth, quota, etc.)
 * - `session.shutdown` — sessão encerrada com métricas
 * - `session.task_complete` — tarefa concluída pelo agente
 * - `session.title_changed` — título da sessão atualizado
 * - `abort` — processamento abortado pelo usuário
 * - `subagent.started/completed/failed` — ciclo de vida de sub-agentes
 * - `elicitation.requested` — MCP form solicitado (surfaced como elicitation.pending)
 *
 * @param {CopilotSession} session
 * @param {SessionWirerCallbacks} callbacks
 * @returns {(() => void)[]}
 */
function _wireSdkResponseEvents(session, { emit }) {
    return [
        session.on('assistant.intent', (/** @type {SdkEvent} */ evt) => {
            const { intent } = evt?.data ?? {};
            emit('assistant.intent', { intent: intent ?? 'unknown', ts: Date.now() });
        }),
        session.on('assistant.reasoning', (/** @type {SdkEvent} */ evt) => {
            const { reasoningId, content } = evt?.data ?? {};
            const len = typeof content === 'string' ? content.length : 0;
            emit('assistant.reasoning_complete', {
                reasoningId: reasoningId ?? null,
                contentLength: len,
                ts: Date.now(),
            });
        }),
        // ── Turn lifecycle ──────────────────────────────────────────────────
        session.on('assistant.turn_start', (/** @type {SdkEvent} */ evt) => {
            const { turnId } = evt?.data ?? {};
            emit('assistant.turn_start', { turnId: turnId ?? null, ts: Date.now() });
            log('DEBUG', `[session-event-wirer] assistant.turn_start turnId=${turnId ?? '?'}`);
        }),
        session.on('assistant.turn_end', (/** @type {SdkEvent} */ evt) => {
            const { turnId } = evt?.data ?? {};
            emit('assistant.turn_end', { turnId: turnId ?? null, ts: Date.now() });
            log('DEBUG', `[session-event-wirer] assistant.turn_end turnId=${turnId ?? '?'}`);
        }),
        // ── Session lifecycle ───────────────────────────────────────────────
        session.on('session.error', (/** @type {SdkEvent} */ evt) => {
            const data = evt?.data ?? {};
            const errorType = /** @type {string} */ (data['errorType'] ?? 'unknown');
            const message = /** @type {string} */ (data['message'] ?? 'Unknown error');
            emit('session.error', { errorType, message, ts: Date.now() });
            log('ERROR', `[session-event-wirer] session.error type=${errorType}: ${message}`);
        }),
        session.on('session.shutdown', (/** @type {SdkEvent} */ evt) => {
            const data = evt?.data ?? {};
            emit('session.shutdown', { ...data, ts: Date.now() });
            log('INFO', `[session-event-wirer] session.shutdown type=${data['shutdownType'] ?? '?'}`);
        }),
        session.on('session.task_complete', (/** @type {SdkEvent} */ evt) => {
            const { summary } = evt?.data ?? {};
            emit('session.task_complete', { summary: summary ?? null, ts: Date.now() });
            log('INFO', `[session-event-wirer] session.task_complete`);
        }),
        session.on('session.title_changed', (/** @type {SdkEvent} */ evt) => {
            const { title } = evt?.data ?? {};
            emit('session.title_changed', { title: title ?? '', ts: Date.now() });
            log('DEBUG', `[session-event-wirer] session.title_changed: "${title ?? ''}"`);
        }),
        session.on('session.context_changed', (/** @type {SdkEvent} */ evt) => {
            emit('session.context_changed', evt?.data ?? {});
            log('DEBUG', `[session-event-wirer] session.context_changed propagado para AGENT EventEmitter`);
        }),
        session.on('abort', (/** @type {SdkEvent} */ evt) => {
            emit('abort', { reason: evt?.data?.['reason'] ?? 'user_initiated', ts: Date.now() });
            log('INFO', '[session-event-wirer] abort propagado para AGENT EventEmitter');
        }),
        session.on('subagent.started', (/** @type {SdkEvent} */ evt) => {
            const { agentName, agentId } = evt?.data ?? {};
            emit('subagent.started', { agentName, agentId, ts: Date.now() });
        }),
        session.on('subagent.completed', (/** @type {SdkEvent} */ evt) => {
            const { agentName, agentId } = evt?.data ?? {};
            emit('subagent.completed', { agentName, agentId, ts: Date.now() });
        }),
        session.on('subagent.failed', (/** @type {SdkEvent} */ evt) => {
            const { agentName, agentId, error } = evt?.data ?? {};
            emit('subagent.failed', { agentName, agentId, error: error ?? 'unknown', ts: Date.now() });
        }),
        session.on('elicitation.requested', (/** @type {SdkEvent} */ evt) => {
            const { requestId, schema, title, description } = evt?.data ?? {};
            emit('elicitation.pending', { requestId, schema, title, description, ts: Date.now() });
            log('INFO', `[session-event-wirer] elicitation.pending requestId=${requestId ?? '?'}`);
        }),
    ];
}

/**
 * Catch-all para eventos genuinamente não tratados por nenhum módulo do sistema.
 *
 * `assistant.usage` é tratado por um handler dedicado (_wireUsageEvent) — não deve aparecer aqui. Todos os eventos em
 * `KNOWN_SDK_EVENTS` são gerenciados por outros módulos e suprimidos silenciosamente. Apenas eventos fora de
 * `KNOWN_SDK_EVENTS` geram log WARNING para detectar novos tipos do SDK.
 *
 * @param {CopilotSession} session
 * @param {SessionWirerCallbacks} _ Callbacks não utilizados diretamente neste handler.
 * @returns {() => void}
 */
function _wireCatchAll(session, _) {
    return session.on((/** @type {SdkEvent} */ evt) => {
        const kind = /** @type {string} */ (evt?.kind ?? evt?.type ?? 'unknown');
        // Suprimir silenciosamente eventos gerenciados por outros módulos do sistema
        if (KNOWN_SDK_EVENTS.has(kind)) return;
        // Detectar e logar eventos genuinamente desconhecidos (novos tipos do SDK)
        log('WARN', `[AlwaysAlive] Evento SDK desconhecido: kind=${kind} — SDK pode ter sido atualizado`);
    });
}

/**
 * Registra handler dedicado para billing (assistant.usage).
 *
 * Responsabilidade do wirer: atualizar lastPrInfo, emitir pr.consumed no AGENT emitter, persistir estado de billing.
 * NÃO chamar metrics.recordUsage() — isso é responsabilidade do event-collector.
 *
 * @param {CopilotSession} session
 * @param {SessionWirerCallbacks} callbacks
 * @returns {() => void}
 */
function _wireUsageEvent(session, { emit, onPrInfo }) {
    return session.on('assistant.usage', (/** @type {SdkEvent} */ evt) => {
        const data = evt?.data ?? {};
        const model = /** @type {string | undefined} */ (data['model']);
        const cost = /** @type {number | undefined} */ (data['cost']);
        const quotaSnapshots = /** @type {Record<string, unknown> | undefined} */ (data['quotaSnapshots']);
        const prInfo = {
            ts: Date.now(),
            ...(model !== undefined ? { model } : {}),
            ...(cost !== undefined ? { cost } : {}),
            ...(quotaSnapshots !== undefined ? { quotaSnapshots } : {}),
        };
        log('INFO', `[AlwaysAlive] PR consumido: model=${model ?? '?'}, cost=${cost ?? '?'}`);
        onPrInfo(prInfo);
        emit('pr.consumed', prInfo);
        writeStateAsync({
            pendingTurnConsumedPR: true,
            lastPrConsumedAt: Date.now(),
            lastPrModel: model ?? '',
            lastPrCost: cost ?? 0,
            lastQuotaSnapshots: quotaSnapshots ?? null,
        }).catch((/** @type {any} */ e) => log('WARN', `[AlwaysAlive] writeState pendingTurnConsumedPR: ${e.message}`));
    });
}
