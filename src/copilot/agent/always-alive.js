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

import { container, logSwallowed } from '#copilot/core';
import { EMITTER_PROCESS_QUEUE } from '#copilot/events';
import { METRICS_STORE } from './ports/observability-port.js';
import { EventEmitter } from 'node:events';

// DialogProtocol agora é usado apenas pelo DialogLoopManager — removido daqui (E.1)

import { MAX_LISTENERS } from '../config/agent.js';
import {
    ensureDialogLoopAttached as dialogEnsureAttached,
    dialogResume,
    dialogStart,
    dialogStop,
} from './dialog/agent-dialog-controller.js';
import { persistStateWithPolicy, readState } from './lifecycle/state-io.js';
// F35: AgentContext — contexto compartilhado entre módulos internos
import { AgentContext } from './agent-context.js';
import { getAgentHealthSnapshot as healthSnapshot } from './health-check.js';
// F36: Lifecycle — start, stop, initSession, tryReconnect
import { agentStart, agentStop, agentTryReconnect } from './lifecycle/agent-lifecycle.js';
// F38: Messaging — sendMessage, steerMessage, answerPendingQuestion
import {
    answerPendingQuestion as msgAnswer,
    processQueue as msgProcessQueue,
    sendMessage as msgSend,
    sendMessageDialogBoot as msgSendBoot,
    steerMessage as msgSteer,
} from './messaging/agent-messaging.js';
// F39: State — getStatusSnapshot, listenerDiagnostics
import { listenerDiagnostics as stateDiagnostics, getStatusSnapshot as stateSnapshot } from './state/agent-state.js';
// O3: Facades extraídas para reduzir LoC desta classe
import { ensureAgentEventBusBridge, resetAgentEventBusBridgeWiring } from './event-bridge-wiring.js';
import {
    getModel,
    getReasoningEffort,
    listAvailableModels,
    setModel,
    setReasoningEffort,
} from './facades/agent-model-config.js';
import {
    deleteSdkPlan,
    deselectSdkAgent,
    getCurrentSdkAgent,
    getForegroundSdkSessionId,
    getLastSdkSessionId,
    getSdkAuthStatus,
    getSdkHandles,
    getSdkResourceSnapshot,
    getSdkSessionMode,
    getSdkStatus,
    listSdkAgents,
    listSdkSessions,
    pingSdk,
    readSdkPlan,
    reloadSdkAgents,
    selectSdkAgent,
    setForegroundSdkSessionId,
    setSdkSessionMode,
    updateSdkPlan,
} from './facades/agent-sdk-access.js';
import {
    abortCurrentMessage,
    getSessionMessages,
    pingDialogWatchdog,
    sessionLog,
} from './facades/agent-session-ops.js';
import { listWebhooks, registerWebhook, unregisterWebhook } from './facades/agent-webhook-ops.js';
import { registerAgentRuntime, unregisterAgentRuntime } from './runtime-registry.js';

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

        // F35: MessageQueue emite EMITTER_PROCESS_QUEUE (Symbol interno) para disparar processamento.
        this.on(EMITTER_PROCESS_QUEUE, () => this.#processQueue());
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
        return this.ctx.getRuntimeStatus();
    }

    /**
     * Indica se o modo de diálogo contínuo está ativo (startDialogLoop foi chamado e ainda não foi parado).
     *
     * @returns {boolean}
     */
    get dialogLoopActive() {
        return this.ctx.isDialogLoopActive();
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
        return this.ctx.getQueueSnapshot().size;
    }

    /**
     * Retorna a pergunta pendente (se houver).
     *
     * @returns {PendingQuestion | null}
     */
    get pendingQuestion() {
        return this.ctx.getPendingQuestionForStatusSnapshot();
    }

    /**
     * Retorna a classificação semântica da pergunta viva atual, quando houver.
     *
     * @returns {import('./types.js').PendingQuestionKind | null}
     */
    get pendingQuestionKind() {
        return this.ctx.getPendingQuestionKind();
    }

    /**
     * Retorna a sombra persistida de `ask_user` restaurada do disco, quando houver.
     *
     * @returns {import('./types.js').PendingQuestionShadow | null}
     */
    get pendingQuestionShadow() {
        return this.ctx.getPendingQuestionShadowSnapshot();
    }

    /**
     * Retorna a classificação semântica da sombra persistida de `ask_user`, quando houver.
     *
     * @returns {import('./types.js').PendingQuestionKind | null}
     */
    get pendingQuestionShadowKind() {
        return this.ctx.getPendingQuestionShadowKind();
    }

    /**
     * Retorna o estado semântico atual da shadow persistida.
     *
     * @returns {import('./types.js').PendingQuestionShadowState | null}
     */
    get pendingQuestionShadowState() {
        return this.ctx.getPendingQuestionShadowState();
    }

    /**
     * Indica se a shadow persistida já expirou.
     *
     * @returns {boolean}
     */
    get pendingQuestionShadowExpired() {
        return this.ctx.isPendingQuestionShadowExpired();
    }

    /**
     * Retorna a idade atual da shadow persistida, em ms, quando houver.
     *
     * @returns {number | null}
     */
    get pendingQuestionShadowAgeMs() {
        return this.ctx.getPendingQuestionShadowAgeMs();
    }

    /**
     * Retorna o timestamp de expiração da shadow persistida, quando houver.
     *
     * @returns {number | null}
     */
    get pendingQuestionShadowExpiresAt() {
        return this.ctx.getPendingQuestionShadowExpiresAt();
    }

    /**
     * Retorna o tempo restante até a expiração da shadow persistida.
     *
     * @returns {number | null}
     */
    get pendingQuestionShadowRemainingMs() {
        return this.ctx.getPendingQuestionShadowRemainingMs();
    }

    /**
     * Limpa a shadow persistida de `ask_user` restaurada do disco e agenda a persistência canônica do cleanup.
     *
     * @returns {boolean}
     */
    clearPendingQuestionShadow() {
        if (!this.ctx.hasPendingQuestionShadow()) {
            return false;
        }
        this.ctx.clearPendingQuestionShadow();
        void this.ctx.trackBackgroundTask(
            persistStateWithPolicy(
                { pendingQuestion: null, pendingQuestionMeta: null },
                { label: 'state.pendingQuestionShadow.clear' },
            ).then((result) => {
                if (!result.ok) {
                    throw result.error;
                }
                return undefined;
            }),
            {
                label: 'state.pendingQuestionShadow.clear',
                description: 'Clear ask_user shadow from persisted state',
            },
        );
        return true;
    }

    /**
     * Retorna o sessionId da sessão ativa (ou null).
     *
     * @returns {string | null}
     */
    get sessionId() {
        return this.ctx.getSessionSnapshot()?.sessionId ?? readState()?.sessionId ?? null;
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
     * Executa um ping no client SDK atualmente acoplado ao agent.
     *
     * @returns {Promise<{ message: string; timestamp: number; protocolVersion?: number }>}
     */
    async pingSdk() {
        return pingSdk(this.ctx);
    }

    /**
     * Retorna o status do runtime SDK/CLI acoplado ao agent.
     *
     * @returns {Promise<import('#copilot/sdk/types').GetStatusResponse>}
     */
    async getSdkStatus() {
        return getSdkStatus(this.ctx);
    }

    /**
     * Retorna o status de autenticação do runtime SDK/CLI acoplado ao agent.
     *
     * @returns {Promise<import('#copilot/sdk/types').GetAuthStatusResponse>}
     */
    async getSdkAuthStatus() {
        return getSdkAuthStatus(this.ctx);
    }

    /**
     * Retorna o ID da última sessão conhecida pelo client SDK atual.
     *
     * @returns {Promise<string | undefined>}
     */
    async getLastSdkSessionId() {
        return getLastSdkSessionId(this.ctx);
    }

    /**
     * Retorna o sessionId em foreground no client SDK atual.
     *
     * @returns {Promise<string | undefined>}
     */
    async getForegroundSdkSessionId() {
        return getForegroundSdkSessionId(this.ctx);
    }

    /**
     * Define o sessionId em foreground no client SDK atual.
     *
     * @param {string} sessionId
     * @returns {Promise<void>}
     */
    async setForegroundSdkSessionId(sessionId) {
        await setForegroundSdkSessionId(this.ctx, sessionId);
    }

    /**
     * Lista sessões persistidas/acessíveis pelo client SDK atual.
     *
     * @param {import('#copilot/sdk/types').SessionListFilter} [filter]
     * @returns {Promise<import('#copilot/sdk/types').SessionMetadata[]>}
     */
    async listSdkSessions(filter) {
        return listSdkSessions(this.ctx, filter);
    }

    /**
     * Retorna o modo vanilla atual da sessão SDK (`interactive`, `plan`, `autopilot`).
     *
     * @returns {Promise<import('#copilot/sdk/types').ModeResult>}
     */
    async getSdkSessionMode() {
        return getSdkSessionMode(this.ctx);
    }

    /**
     * Altera o modo vanilla da sessão SDK.
     *
     * @param {'interactive' | 'plan' | 'autopilot'} mode
     * @returns {Promise<import('#copilot/sdk/types').ModeResult>}
     */
    async setSdkSessionMode(mode) {
        return setSdkSessionMode(this.ctx, mode);
    }

    /**
     * Lê o plan.md vanilla da sessão SDK.
     *
     * @returns {Promise<import('#copilot/sdk/types').PlanReadResult>}
     */
    async readSdkPlan() {
        return readSdkPlan(this.ctx);
    }

    /**
     * Atualiza o plan.md vanilla da sessão SDK.
     *
     * @param {string} content
     * @returns {Promise<object>}
     */
    async updateSdkPlan(content) {
        return updateSdkPlan(this.ctx, content);
    }

    /**
     * Remove o plan.md vanilla da sessão SDK.
     *
     * @returns {Promise<object>}
     */
    async deleteSdkPlan() {
        return deleteSdkPlan(this.ctx);
    }

    /**
     * Lista agentes customizados disponíveis na sessão SDK atual.
     *
     * @returns {Promise<unknown>}
     */
    async listSdkAgents() {
        return listSdkAgents(this.ctx);
    }

    /**
     * Retorna o agente customizado atualmente selecionado na sessão SDK.
     *
     * @returns {Promise<unknown>}
     */
    async getCurrentSdkAgent() {
        return getCurrentSdkAgent(this.ctx);
    }

    /**
     * Seleciona um agente customizado na sessão SDK atual.
     *
     * @param {string} name
     * @returns {Promise<unknown>}
     */
    async selectSdkAgent(name) {
        return selectSdkAgent(this.ctx, name);
    }

    /**
     * Remove a seleção do agente customizado atual na sessão SDK.
     *
     * @returns {Promise<unknown>}
     */
    async deselectSdkAgent() {
        return deselectSdkAgent(this.ctx);
    }

    /**
     * Recarrega a lista de agentes customizados na sessão SDK atual.
     *
     * @returns {Promise<unknown>}
     */
    async reloadSdkAgents() {
        return reloadSdkAgents(this.ctx);
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
     * Retorna um snapshot consolidado de health do agente.
     *
     * Usado por rotas de health, registries de observabilidade e diagnósticos operacionais.
     *
     * @returns {import('./types.js').AgentHealthSnapshot}
     */
    getHealthSnapshot() {
        return healthSnapshot(this.ctx, this);
    }

    /**
     * Retorna os handles crus do SDK atualmente acoplados ao agent.
     *
     * @returns {import('./types.js').AgentSdkHandles}
     */
    getSdkHandles() {
        return getSdkHandles(this.ctx);
    }

    /**
     * Retorna um snapshot verificável da cobertura de recursos SDK disponíveis ao agent.
     *
     * @returns {import('./types.js').AgentSdkAccessSnapshot}
     */
    getSdkResourceSnapshot() {
        return getSdkResourceSnapshot(this.ctx);
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
        return this.ctx.isDialogLoopPaused();
    }

    /**
     * F41: Métricas de consumo de premium requests do dialog loop.
     *
     * @returns {{ boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null}
     */
    get dialogPrMetrics() {
        return this.ctx.getDialogPrMetricsSnapshot();
    }

    /**
     * Último snapshot de billing do PR consumido. Atualizado quando `assistant.usage` é emitido pelo SDK.
     *
     * @returns {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null}
     */
    get lastPrInfo() {
        // Retorna cópia rasa para evitar mutação externa do estado interno.
        return this.ctx.getLastPrInfoSnapshot();
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
        msgProcessQueue(this.ctx, this, { tryReconnect: (e) => this.#tryReconnect(e) });
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
/** @type {AlwaysAliveAgent | null} */
let _alwaysAliveAgent = null;

/**
 * Reseta a instância lazy do agente.
 *
 * Útil principalmente em testes e cenários controlados de reinicialização do runtime.
 *
 * @returns {void}
 */
export function resetAgent() {
    if (_alwaysAliveAgent) {
        unregisterAgentRuntime();
    }
    _alwaysAliveAgent = null;
    resetAgentEventBusBridgeWiring();
}

/**
 * Proxy de compatibilidade para manter a API pública `alwaysAliveAgent` sem instanciar o singleton no topo do módulo.
 *
 * @type {AlwaysAliveAgent}
 */
export const alwaysAliveAgent = /** @type {AlwaysAliveAgent} */ (
    new Proxy(
        {},
        {
            get(_target, prop) {
                const agent = getAgent();
                const value = Reflect.get(agent, prop, agent);
                return typeof value === 'function' ? value.bind(agent) : value;
            },
            set(_target, prop, value) {
                const agent = getAgent();
                return Reflect.set(agent, prop, value, agent);
            },
            defineProperty(_target, prop, descriptor) {
                return Reflect.defineProperty(getAgent(), prop, descriptor);
            },
            deleteProperty(_target, prop) {
                return Reflect.deleteProperty(getAgent(), prop);
            },
            getOwnPropertyDescriptor(_target, prop) {
                const agent = getAgent();
                return (
                    Reflect.getOwnPropertyDescriptor(agent, prop) ??
                    Reflect.getOwnPropertyDescriptor(AlwaysAliveAgent.prototype, prop)
                );
            },
            has(_target, prop) {
                return prop in getAgent();
            },
            ownKeys() {
                return Reflect.ownKeys(getAgent());
            },
            getPrototypeOf() {
                return AlwaysAliveAgent.prototype;
            },
            isExtensible() {
                return Reflect.isExtensible(getAgent());
            },
            preventExtensions() {
                return Reflect.preventExtensions(getAgent());
            },
        },
    )
);
/**
 * G1-ARCH-01: Accessor lazy do singleton — use este em vez de importar `alwaysAliveAgent` diretamente.
 *
 * Permite que futuramente a instância seja substituída (ex.: por um mock em testes de integração) sem alterar todos os
 * call sites.
 *
 * @returns {AlwaysAliveAgent}
 */
export function getAgent() {
    if (!_alwaysAliveAgent) {
        _alwaysAliveAgent = new AlwaysAliveAgent();
    }
    registerAgentRuntime(_alwaysAliveAgent);
    ensureAgentEventBusBridge(_alwaysAliveAgent, {
        isCurrentAgent: (agent) => agent === _alwaysAliveAgent,
    });
    return _alwaysAliveAgent;
}
