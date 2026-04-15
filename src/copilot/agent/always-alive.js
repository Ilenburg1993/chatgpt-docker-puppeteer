// @ts-check
/**
 * @module copilot/agent/always-alive
 * @file Agente always-alive: bootstrap, lifecycle e orquestração do loop de diálogo contínuo. Gerencia estado do
 *   agente, fila de mensagens e integração com o bus de eventos.
 *
 *   src/copilot/agent/always-alive.js
 * @see module:copilot/agent/dialog/loop-manager
 * @see module:copilot/agent/session/initializer
 * @see module:copilot/agent/lifecycle/state-io
 * @see module:copilot/agent/infra/message-queue
 */

import { bridgeEmitter, container, logSwallowed } from '#copilot/core';
import { METRICS_STORE } from '#copilot/observability';
import { EventEmitter } from 'node:events';

// DialogProtocol agora é usado apenas pelo DialogLoopManager — removido daqui (E.1)

import { MAX_LISTENERS } from '../config/agent.js';
import {
    ensureDialogLoopAttached as dialogEnsureAttached,
    dialogResume,
    dialogStart,
    dialogStop,
} from './dialog/agent-dialog-controller.js';
import { readState } from './lifecycle/state-io.js';
import { processQueue } from './queue-processor.js';
// F35: AgentContext — contexto compartilhado entre módulos internos
import { AgentContext } from './agent-context.js';
// F36: Lifecycle — start, stop, initSession, tryReconnect
import { agentStart, agentStop, agentTryReconnect } from './lifecycle/agent-lifecycle.js';
// F38: Messaging — sendMessage, steerMessage, answerPendingQuestion
import {
    answerPendingQuestion as msgAnswer,
    sendMessage as msgSend,
    sendMessageDialogBoot as msgSendBoot,
    steerMessage as msgSteer,
} from './messaging/agent-messaging.js';
// F39: State — getStatusSnapshot, listenerDiagnostics
import { listenerDiagnostics as stateDiagnostics, getStatusSnapshot as stateSnapshot } from './state/agent-state.js';
// O3: Facades extraídas para reduzir LoC desta classe
import {
    getModel,
    getReasoningEffort,
    listAvailableModels,
    setModel,
    setReasoningEffort,
} from './facades/agent-model-config.js';
import {
    abortCurrentMessage,
    getSessionMessages,
    pingDialogWatchdog,
    sessionLog,
} from './facades/agent-session-ops.js';
import { listWebhooks, registerWebhook, unregisterWebhook } from './facades/agent-webhook-ops.js';

/**
 * @typedef {import('./types.js').CopilotSession} CopilotSession
 *
 * @typedef {import('./types.js').PendingQuestion} PendingQuestion
 *
 * @typedef {import('./types.js').AgentTask} AgentTask
 *
 * @typedef {import('./types.js').AgentStatus} AgentStatus
 *
 * @typedef {import('./types.js').AgentStatusSnapshot} AgentStatusSnapshot
 */

/**
 * Always-Alive Agent — instância singleton que gerencia o ciclo de vida completo do agente Copilot SDK neste processo.
 *
 * Implementa {@link import('../../core/interfaces.js').IAgent IAgent} (Faixa 3.2 — AC-5-01).
 *
 * @extends EventEmitter
 * @see module:copilot/core/interfaces
 */
export class AlwaysAliveAgent extends EventEmitter {
    /**
     * F35: AgentContext — contexto compartilhado com todos os módulos internos.
     *
     * @type {AgentContext}
     */
    ctx;

    /**
     * @param {{ model?: string; reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' }} [options]
     */
    constructor(options = {}) {
        super();
        // Agentes de alta carga acumulam múltiplos listeners por tarefa + SSE + bridge.
        // O padrão de 10 é insuficiente; configurável via AGENT_MAX_LISTENERS (padrão 50).
        this.setMaxListeners(MAX_LISTENERS);
        this.ctx = new AgentContext(this, options);

        // F35: MessageQueue emite __processQueue como evento interno para disparar processamento.
        this.on('__processQueue', () => this.#processQueue());
    }

    /**
     * Retorna o modo de permissão ativo como string legível.
     *
     * Modos disponíveis:
     *
     * - `"approve_all"` — aprova tudo automaticamente (comportamento padrão, SDK approveAll)
     * - `"audit_only"` — aprova tudo mas loga cada decisão
     * - `"selective"` — whitelist/blacklist/callback customizado
     *
     * @returns {'approve_all' | 'audit_only' | 'selective'}
     */
    getPermissionMode() {
        return this.ctx.permissions.getMode();
    }

    /**
     * Altera o modo de aprovação de tools em runtime — sem reiniciar o agente.
     *
     * A mudança é aplicada na PRÓXIMA reconexão/reinício real de sessão. Para sessões já ativas, apenas novos
     * `initOrResumeSession` usarão o handler atualizado.
     *
     * O dialog loop não é uma tool e não passa por este handler. Não é possível bloquear o encerramento do dialog loop
     * via configuração de permissão.
     *
     * @param {'approve_all' | 'audit_only' | 'selective'} mode - Modo de aprovação
     * @param {{ allowTools?: string[]; denyTools?: string[]; denyShell?: boolean }} [opts] - Opções para modo selective
     * @returns {void}
     */
    setPermissionMode(mode, opts = {}) {
        this.ctx.permissions.setMode(mode, opts);
    }

    /**
     * Registra uma URL de webhook para notificações de sessão.
     *
     * @param {string} url - URL HTTP(S) que receberá POST com payload de evento
     * @returns {{ id: string; url: string }} Identificador do webhook registrado
     */
    registerWebhook(url) {
        return registerWebhook(this.ctx, url);
    }

    /**
     * Remove um webhook previamente registrado.
     *
     * @param {string} id - ID do webhook a remover
     * @returns {boolean} true se removido, false se não encontrado
     */
    unregisterWebhook(id) {
        return unregisterWebhook(this.ctx, id);
    }

    /**
     * Lista todos os webhooks registrados.
     *
     * @returns {{ id: string; url: string }[]}
     */
    listWebhooks() {
        return listWebhooks(this.ctx);
    }

    /**
     * Retorna o status atual do agente.
     *
     * @returns {AgentStatus}
     */
    get status() {
        return this.ctx.status;
    }

    /**
     * Indica se o modo de diálogo contínuo está ativo (startDialogLoop foi chamado e ainda não foi parado).
     *
     * @returns {boolean}
     */
    get dialogLoopActive() {
        return this.ctx.dialogLoop.active;
    }

    /**
     * F45: Retorna o HandoffManager para uso em rotas HTTP e terminal.
     *
     * @returns {import('./infra/handoff-manager.js').HandoffManager}
     */
    getHandoffManager() {
        return this.ctx.handoff;
    }

    /**
     * Retorna o número atual de tarefas enfileiradas aguardando processamento.
     *
     * @returns {number}
     */
    get queueSize() {
        return this.ctx.messageQueue.size;
    }

    /**
     * Retorna a pergunta pendente (se houver).
     *
     * @returns {PendingQuestion | null}
     */
    get pendingQuestion() {
        return this.ctx.pendingQuestion;
    }

    /**
     * Retorna o sessionId da sessão ativa (ou null).
     *
     * @returns {string | null}
     */
    get sessionId() {
        return this.ctx.session?.sessionId ?? readState()?.sessionId ?? null;
    }

    /**
     * Retorna o sumário de métricas da sessão atual (compatibilidade — use container.resolve(METRICS_STORE)
     * diretamente).
     *
     * @returns {object}
     */
    get telemetry() {
        return container.resolve(METRICS_STORE).getSummary();
    }

    /**
     * Retorna o registry de tools da sessão atual.
     *
     * @returns {import('#copilot/sdk/tools-registry').ToolRegistry}
     */
    get toolsRegistry() {
        return this.ctx.toolsRegistry;
    }

    /**
     * M-04 (PARTE-8): Aborta a mensagem SDK em processamento na sessão atual.
     *
     * @returns {Promise<void>}
     */
    async abortCurrentMessage() {
        await abortCurrentMessage(this.ctx);
    }

    /**
     * F52 (PARTE-9): Pinga o watchdog do dialog loop para sinalizar atividade.
     */
    pingDialogWatchdog() {
        pingDialogWatchdog(this.ctx);
    }

    /**
     * M-05 (PARTE-8): Registra mensagem no timeline da sessão SDK via session.log().
     *
     * @param {string} message - Mensagem para registrar no timeline
     * @param {{ level?: 'info' | 'warning' | 'error' }} [options]
     * @returns {Promise<void>}
     */
    async sessionLog(message, options) {
        await sessionLog(this.ctx, message, options);
    }

    /**
     * Inicializa o agente: conecta ao CLI e cria/retoma sessão.
     *
     * @returns {Promise<void>}
     * @throws {Error} Se a conexão ao CLI ou criação/retomada de sessão SDK falhar
     */
    async start() {
        await agentStart(this.ctx, this);
    }

    /**
     * Para o agente graciosamente.
     *
     * @param {{ shutdownTimeoutMs?: number }} [opts]
     * @returns {Promise<void>}
     */
    async stop(opts) {
        await agentStop(this.ctx, this, opts);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * Enfileira uma mensagem para ser enviada ao modelo.
     *
     * @param {string} message - Mensagem a enviar
     * @param {{
     *     timeoutMs?: number;
     *     attachments?: import('#copilot/sdk/types').MessageOptions['attachments'];
     *     signal?: AbortSignal;
     * }} [opts]
     *   - `timeoutMs` sobrescreve o timeout padrão de 60 s do SDK para `sendAndWait`. Use um valor grande (ex.: `24 * 60 *
     *       60 * 1000`) para tarefas de longa duração como o dialog loop, que nunca emitem `session.idle`
     *       organicamente.
     *   - `attachments` permite enviar arquivos, imagens ou referências de contexto junto com a mensagem.
     *   - `signal` permite cancelar a tarefa via `AbortSignal` antes ou durante o processamento.
     *
     * @returns {Promise<string>} Resposta completa do modelo
     */
    sendMessage(message, opts) {
        return msgSend(this.ctx, this, message, opts);
    }

    /**
     * Variante interna de sendMessage() usada pelo DialogLoopManager para enviar o boot prompt.
     *
     * @param {string} message
     * @param {{ timeoutMs?: number }} [opts]
     * @returns {Promise<string>}
     */
    sendMessageDialogBoot(message, opts = {}) {
        return msgSendBoot(this.ctx, this, message, opts);
    }

    /**
     * Envia uma mensagem em modo "steering" (immediate).
     *
     * @param {string} prompt
     * @param {{ signal?: AbortSignal }} [opts]
     * @returns {Promise<string>}
     */
    async steerMessage(prompt, opts) {
        return msgSteer(this.ctx, this, prompt, opts);
    }

    /**
     * Responde a uma pergunta pendente do modelo.
     *
     * @param {string} answer
     * @returns {boolean}
     */
    answerPendingQuestion(answer) {
        return msgAnswer(this.ctx, this, answer);
    }

    /**
     * ID do modelo atual em uso.
     *
     * @returns {string}
     */
    get model() {
        return getModel(this.ctx);
    }

    /**
     * Troca o modelo em uso. A mudança é efetiva no próximo `sendMessage()`.
     *
     * @param {string} modelId - ID do modelo (ex. `'gpt-4.1'`, `'claude-sonnet-4-5'`)
     * @returns {void}
     */
    setModel(modelId) {
        setModel(this.ctx, modelId);
    }

    /**
     * Lista os modelos disponíveis via SDK. Retorna array vazio se cliente não estiver inicializado.
     *
     * @returns {Promise<import('#copilot/sdk/types').ModelInfo[]>}
     */
    async listAvailableModels() {
        return listAvailableModels(this.ctx);
    }

    /**
     * Nível de raciocínio atual.
     *
     * @returns {'low' | 'medium' | 'high' | 'xhigh' | undefined}
     */
    get reasoningEffort() {
        return getReasoningEffort(this.ctx);
    }

    /**
     * Troca o nível de raciocínio. A mudança é efetiva no próximo `sendMessage()`.
     *
     * @param {'low' | 'medium' | 'high' | 'xhigh' | undefined} effort - Nível de raciocínio
     * @returns {void}
     */
    setReasoningEffort(effort) {
        setReasoningEffort(this.ctx, effort);
    }

    /**
     * Retorna um snapshot do estado atual do agente para a API HTTP.
     *
     * G2-PERF-01: Dirty flag primário + TTL safety net. O cache é invalidado (null) em toda mutação de estado
     * (`#setStatus()`, `messageQueue.onChanged`, `stop()`). O TTL existe apenas como segurança para edge cases onde a
     * invalidação é perdida. `readState()` usa cache interno (O(1) quando warm).
     *
     * @returns {AgentStatusSnapshot}
     */
    getStatusSnapshot() {
        return stateSnapshot(this.ctx, this);
    }

    /**
     * Retorna contagem de listeners por evento para diagnóstico de leaks.
     *
     * @returns {{ [event: string]: number }}
     */
    listenerDiagnostics() {
        return stateDiagnostics(this);
    }

    /**
     * Inicia o "modo diálogo direto" com a LLM. Delega ao DialogLoopManager.
     *
     * @param {string} [bootPrompt] - Prompt de boot personalizado (opcional)
     * @returns {Promise<void>}
     * @throws {Error} Se o agente não estiver no estado 'idle'
     */
    async startDialogLoop(bootPrompt) {
        await dialogStart(this.ctx, this, bootPrompt);
    }

    /**
     * Envia um turno de diálogo. Delega ao DialogLoopManager.
     *
     * @param {string} message
     * @param {{ timeout?: number; signal?: AbortSignal }} [opts]
     * @returns {Promise<string>}
     */
    sendDialogTurn(message, opts) {
        return this.ctx.dialogLoop.sendTurn(message, opts);
    }

    /**
     * Para o modo diálogo. Delega ao DialogLoopManager.
     *
     * @param {{
     *     authorized?: boolean;
     *     reason?: 'watchdog_restart' | 'authorized_stop';
     *     shutdownTimeoutMs?: number;
     * }} [opts]
     * @returns {Promise<void>}
     */
    async stopDialogLoop(opts) {
        await dialogStop(this.ctx, this, opts);
    }

    /**
     * Pausa o dialog loop. Delega ao DialogLoopManager.
     *
     * @returns {Promise<void>}
     */
    async pauseDialogLoop() {
        await this.ctx.dialogLoop.pause(this.sessionId);
    }

    /**
     * Retoma o dialog loop. Delega ao DialogLoopManager.
     *
     * @returns {Promise<void>}
     */
    async resumeDialogLoop() {
        await dialogResume(this.ctx);
    }

    /**
     * Indica se o dialog loop está atualmente pausado.
     *
     * @returns {boolean}
     */
    get dialogPaused() {
        return this.ctx.dialogLoop.paused;
    }

    /**
     * F41: Métricas de consumo de premium requests do dialog loop.
     *
     * @returns {{ boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null}
     */
    get dialogPrMetrics() {
        return this.ctx.dialogLoop.prMetrics ?? null;
    }

    /**
     * Último snapshot de billing do PR consumido. Atualizado quando `assistant.usage` é emitido pelo SDK.
     *
     * @returns {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null}
     */
    get lastPrInfo() {
        // Retorna cópia rasa para evitar mutação externa do estado interno.
        return this.ctx.lastPrInfo ? { ...this.ctx.lastPrInfo } : null;
    }

    /**
     * E.1: Garante que o DialogLoopManager está vinculado ao host com a interface AgentHost.
     *
     * G1-BUG-01 (fix): `attach()` é sempre chamado para atualizar host/telemetry (podem mudar após reconexão). O wiring
     * de eventos (listeners) só ocorre uma vez — guard `#dialogLoopAttached` protege apenas essa parte.
     */
    ensureDialogLoopAttached() {
        dialogEnsureAttached(this.ctx, this);
    }

    /**
     * Processa a próxima tarefa da fila (se idle e sessão ativa).
     *
     * @returns {void}
     */
    #processQueue() {
        processQueue(this.ctx, this, { tryReconnect: (e) => this.#tryReconnect(e) });
    }

    /**
     * F36: Tenta reconectar à sessão SDK. Delegado para lifecycle/agent-lifecycle.js.
     *
     * @param {Error} originalError
     * @param {{ maxAttempts?: number; baseDelayMs?: number }} [opts]
     * @returns {Promise<boolean>}
     */
    async #tryReconnect(originalError, opts = {}) {
        return agentTryReconnect(this.ctx, this, originalError, opts);
    }

    /**
     * Retorna o histórico de mensagens da sessão SDK ativa.
     *
     * @returns {Promise<unknown[]>}
     */
    async getSessionMessages() {
        return getSessionMessages(this.ctx);
    }

    /**
     * Suporte a `await using agent = alwaysAliveAgent` no padrão Explicit Resource Management (TC39 Stage 4).
     *
     * Permite encapsular o ciclo de vida do agente em blocos `await using` de forma determinística.
     *
     * @returns {Promise<void>}
     */
    async [Symbol.asyncDispose]() {
        await this.stop();
    }

    /**
     * UPG-AGENT-005: Suporte a `using agent = alwaysAliveAgent` (sync Explicit Resource Management). Dispara stop() em
     * fire-and-forget; útil em contextos onde `await using` não é possível.
     */
    [Symbol.dispose]() {
        // fire-and-forget: Symbol.dispose não suporta await
        this.stop().catch((e) => logSwallowed(e, 'AlwaysAliveAgent.Symbol.dispose'));
    }
}
/**
 * Instância singleton do Always-Alive Agent para este processo.
 *
 * @type {AlwaysAliveAgent}
 */
export const alwaysAliveAgent = new AlwaysAliveAgent();

// M-3: Bridge agent lifecycle events → EventBus centralizado
try {
    const { container } = await import('../core/di-container.js');
    const { EVENT_BUS } = await import('../core/di-tokens.js');
    const {
        AGENT_ABORT,
        AGENT_ASSISTANT_INTENT,
        AGENT_ASSISTANT_REASONING_COMPLETE,
        AGENT_ASSISTANT_TURN_END,
        AGENT_ASSISTANT_TURN_START,
        AGENT_BACKGROUND_COMPLETED,
        AGENT_BACKGROUND_IDLE,
        AGENT_READY,
        AGENT_BEFORE_STOP,
        AGENT_STOPPED,
        AGENT_ERROR,
        AGENT_CONTEXT_COMPACTED,
        AGENT_DIALOG_BOOT_RECOVERY,
        AGENT_DIALOG_DELTA,
        AGENT_DIALOG_LOOP_CHANGED,
        AGENT_DIALOG_READY,
        AGENT_DIALOG_STALLED,
        AGENT_DIALOG_PAUSED,
        AGENT_DIALOG_RESUMED,
        AGENT_DIALOG_STOPPED,
        AGENT_DIALOG_REPLY,
        AGENT_DIALOG_COMPACTION_REQUESTED,
        AGENT_DIALOG_TURN_START,
        AGENT_DIALOG_TURN_END,
        AGENT_DIALOG_TURN_TIMEOUT,
        AGENT_ELICITATION_PENDING,
        AGENT_EXIT_PLAN_MODE_COMPLETED,
        AGENT_EXTERNAL_TOOL_COMPLETED,
        AGENT_HANDOFF_RECEIVED,
        AGENT_HANDOFF_ACCEPTED,
        AGENT_HANDOFF_REJECTED,
        AGENT_MCP_RECONNECTED,
        AGENT_METRICS,
        AGENT_PENDING_MESSAGES_MODIFIED,
        AGENT_PERMISSION_MODE_CHANGED,
        AGENT_PR_CONSUMED,
        AGENT_PR_FALLBACK_MODEL,
        AGENT_QUESTION_PENDING,
        AGENT_QUESTION_ANSWERED,
        AGENT_QUOTA_WARNING,
        AGENT_SDK_LIFECYCLE,
        AGENT_SESSION_CLEANUP,
        AGENT_SESSION_COMPACTION_START,
        AGENT_SESSION_COMPACTION_COMPLETE,
        AGENT_SESSION_CONTEXT_CHANGED,
        AGENT_SESSION_ERROR,
        AGENT_SESSION_FATAL,
        AGENT_SESSION_HANDOFF,
        AGENT_SESSION_HISTORY_SYNCED,
        AGENT_SESSION_INFO,
        AGENT_SESSION_KEEPALIVE,
        AGENT_SESSION_MODE_CHANGED,
        AGENT_SESSION_SHUTDOWN,
        AGENT_SESSION_SNAPSHOT_REWIND,
        AGENT_SESSION_TASK_COMPLETE,
        AGENT_SESSION_TITLE_CHANGED,
        AGENT_SESSION_TOKEN_BUDGET_WARNING,
        AGENT_SESSION_TRUNCATION,
        AGENT_SESSION_USAGE,
        AGENT_SESSION_WORKSPACE_FILE_CHANGED,
        AGENT_SHELL_COMPLETED,
        AGENT_SHELL_DETACHED_COMPLETED,
        AGENT_STATUS,
        AGENT_STEERING_SENT,
        AGENT_SUBAGENT_COMPLETED,
        AGENT_SUBAGENT_FAILED,
        AGENT_SUBAGENT_STARTED,
        AGENT_SYSTEM_MESSAGE,
        AGENT_TASK_COMPLETED,
        AGENT_TASK_DELTA,
        AGENT_TASK_ERROR,
        AGENT_TASK_QUEUED,
        AGENT_TASK_REASONING,
        AGENT_TASK_STARTED,
        AGENT_TOOL_EXECUTION_START,
        AGENT_TOOL_EXECUTION_COMPLETE,
        AGENT_TOOL_EXECUTION_PROGRESS,
        AGENT_DIALOG_PRE_STALL_WARNING,
        AGENT_SESSION_IDLE,
    } = await import('../events/index.js');
    const bus = container.resolve(EVENT_BUS);
    if (bus) {
        // FAIXA-L7+L9: bridge completo agent → EventBus (cobre TODOS os agent events)
        bridgeEmitter(alwaysAliveAgent, bus, {
            ready: AGENT_READY,
            'before-stop': AGENT_BEFORE_STOP,
            stopped: AGENT_STOPPED,
            error: AGENT_ERROR,
            'dialog.loop.changed': AGENT_DIALOG_LOOP_CHANGED,
            'dialog.ready': AGENT_DIALOG_READY,
            'dialog.turn_start': AGENT_DIALOG_TURN_START,
            'dialog.turn_end': AGENT_DIALOG_TURN_END,
            'dialog.turn_timeout': AGENT_DIALOG_TURN_TIMEOUT,
            'dialog.stalled': AGENT_DIALOG_STALLED,
            'dialog.paused': AGENT_DIALOG_PAUSED,
            'dialog.resumed': AGENT_DIALOG_RESUMED,
            'dialog.stopped': AGENT_DIALOG_STOPPED,
            'dialog.reply': AGENT_DIALOG_REPLY,
            'session.keepalive': AGENT_SESSION_KEEPALIVE,
            'session.fatal': AGENT_SESSION_FATAL,
            'session.compaction_start': AGENT_SESSION_COMPACTION_START,
            'session.compaction_complete': AGENT_SESSION_COMPACTION_COMPLETE,
            'session.usage': AGENT_SESSION_USAGE,
            'session.token_budget_warning': AGENT_SESSION_TOKEN_BUDGET_WARNING,
            'session.mode_changed': AGENT_SESSION_MODE_CHANGED,
            'session.history_synced': AGENT_SESSION_HISTORY_SYNCED,
            'session.info': AGENT_SESSION_INFO,
            'session.title_changed': AGENT_SESSION_TITLE_CHANGED,
            'session.snapshot_rewind': AGENT_SESSION_SNAPSHOT_REWIND,
            'session.workspace_file_changed': AGENT_SESSION_WORKSPACE_FILE_CHANGED,
            'task.queued': AGENT_TASK_QUEUED,
            'task.started': AGENT_TASK_STARTED,
            'task.completed': AGENT_TASK_COMPLETED,
            'task.delta': AGENT_TASK_DELTA,
            'task.error': AGENT_TASK_ERROR,
            'task.reasoning': AGENT_TASK_REASONING,
            'tool.execution_start': AGENT_TOOL_EXECUTION_START,
            'tool.execution_complete': AGENT_TOOL_EXECUTION_COMPLETE,
            'tool.execution_progress': AGENT_TOOL_EXECUTION_PROGRESS,
            'question.pending': AGENT_QUESTION_PENDING,
            'question.answered': AGENT_QUESTION_ANSWERED,
            'pr.consumed': AGENT_PR_CONSUMED,
            'pr.fallback_model': AGENT_PR_FALLBACK_MODEL,
            'permission.mode_changed': AGENT_PERMISSION_MODE_CHANGED,
            'context:compacted': AGENT_CONTEXT_COMPACTED,
            'agent.metrics': AGENT_METRICS,
            'system.message': AGENT_SYSTEM_MESSAGE,
            // ── FAIXA-L9: 26 previously unbridged events ─────────────────
            'assistant.turn_start': AGENT_ASSISTANT_TURN_START,
            'assistant.turn_end': AGENT_ASSISTANT_TURN_END,
            'assistant.intent': AGENT_ASSISTANT_INTENT,
            'assistant.reasoning_complete': AGENT_ASSISTANT_REASONING_COMPLETE,
            'session.error': AGENT_SESSION_ERROR,
            'session.shutdown': AGENT_SESSION_SHUTDOWN,
            'session.handoff': AGENT_SESSION_HANDOFF,
            'session.task_complete': AGENT_SESSION_TASK_COMPLETE,
            'session.context_changed': AGENT_SESSION_CONTEXT_CHANGED,
            'session.truncation': AGENT_SESSION_TRUNCATION,
            'session.cleanup': AGENT_SESSION_CLEANUP,
            'subagent.started': AGENT_SUBAGENT_STARTED,
            'subagent.completed': AGENT_SUBAGENT_COMPLETED,
            'subagent.failed': AGENT_SUBAGENT_FAILED,
            'dialog.delta': AGENT_DIALOG_DELTA,
            'dialog.boot_recovery': AGENT_DIALOG_BOOT_RECOVERY,
            abort: AGENT_ABORT,
            'elicitation.pending': AGENT_ELICITATION_PENDING,
            'agent.background.completed': AGENT_BACKGROUND_COMPLETED,
            'agent.background.idle': AGENT_BACKGROUND_IDLE,
            'agent.shell.completed': AGENT_SHELL_COMPLETED,
            'agent.shell.detached_completed': AGENT_SHELL_DETACHED_COMPLETED,
            'sdk.lifecycle': AGENT_SDK_LIFECYCLE,
            'mcp.reconnected': AGENT_MCP_RECONNECTED,
            'quota.warning': AGENT_QUOTA_WARNING,
            'steering.sent': AGENT_STEERING_SENT,
            // ── FAIXA-L14: 4 previously unbridged observer events ────────
            status: AGENT_STATUS,
            'pending_messages.modified': AGENT_PENDING_MESSAGES_MODIFIED,
            'exit_plan_mode.completed': AGENT_EXIT_PLAN_MODE_COMPLETED,
            'external_tool.completed': AGENT_EXTERNAL_TOOL_COMPLETED,
            // ── FAIXA-L32: bridge completude ────────────────────────
            'dialog.pre_stall_warning': AGENT_DIALOG_PRE_STALL_WARNING,
            'session.idle': AGENT_SESSION_IDLE,
        });
        // FAIXA-2A: bridge DialogLoopManager → EventBus
        bridgeEmitter(alwaysAliveAgent.ctx.dialogLoop, bus, {
            changed: AGENT_DIALOG_LOOP_CHANGED,
            stalled: AGENT_DIALOG_STALLED,
            paused: AGENT_DIALOG_PAUSED,
            resumed: AGENT_DIALOG_RESUMED,
            stopped: AGENT_DIALOG_STOPPED,
            reply: AGENT_DIALOG_REPLY,
            'compaction.requested': AGENT_DIALOG_COMPACTION_REQUESTED,
            turn_timeout: AGENT_DIALOG_TURN_TIMEOUT,
        });
        // FAIXA-2A: bridge HandoffManager → EventBus
        bridgeEmitter(alwaysAliveAgent.ctx.handoff, bus, {
            'handoff.received': AGENT_HANDOFF_RECEIVED,
            'handoff.accepted': AGENT_HANDOFF_ACCEPTED,
            'handoff.rejected': AGENT_HANDOFF_REJECTED,
        });
    }
} catch (_busWiringErr) {
    // EventBus not available yet — expected during early bootstrap
    // C-06 fix: log non-MODULE_NOT_FOUND errors for visibility
    const code =
        _busWiringErr instanceof Error
            ? /** @type {{ code?: string }} */ (/** @type {unknown} */ (_busWiringErr)).code
            : undefined;
    if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') {
        logSwallowed(_busWiringErr, 'AlwaysAliveAgent.eventBusWiring');
    }
}
/**
 * G1-ARCH-01: Accessor lazy do singleton — use este em vez de importar `alwaysAliveAgent` diretamente.
 *
 * Permite que futuramente a instância seja substituída (ex.: por um mock em testes de integração) sem alterar todos os
 * call sites.
 *
 * @returns {AlwaysAliveAgent}
 */
export function getAgent() {
    return alwaysAliveAgent;
}
