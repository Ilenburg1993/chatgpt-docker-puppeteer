// @ts-check
/**
 * @module copilot/agent/always-alive
 * @file Agente always-alive: bootstrap, lifecycle e orquestração do loop de diálogo contínuo. Gerencia estado do
 *   agente, fila de mensagens e integração com o bus de eventos.
 * @see module:copilot/agent/lifecycle/state-io
 * @see module:copilot/agent/infra/message-queue
 */

import { logSwallowed } from '#copilot/core';
import { EMITTER_PROCESS_QUEUE } from '#copilot/events';
import { EventEmitter } from 'node:events';

// DialogProtocol agora é usado apenas pelo DialogLoopManager — removido daqui (E.1)

import { MAX_LISTENERS } from '#copilot/config/agent';
// F35: AgentContext — contexto compartilhado entre módulos internos
import { AgentContext } from './context/index.js';
import { HealthFacade, PermissionToolsFacade, SdkQueryFacade, StateQueryFacade } from './facades/index.js';
import {
    abortCurrentMessage,
    agentStart,
    agentStop,
    agentTryReconnect,
    clearAgentRuntimePendingQuestionShadow,
    compactSdkSession,
    confirmSdkSessionUi,
    createSdkWorkspaceFile,
    deleteSdkPlan,
    deselectSdkAgent,
    dialogEnsureAttached,
    dialogRecoverInputChannel,
    dialogResume,
    dialogStart,
    dialogStop,
    dispatchAgentDialogTurn,
    execSdkShell,
    getCurrentSdkAgent,
    getModel,
    getPendingSdkElicitation,
    getReasoningEffort,
    getRuntimeHandoffManager,
    getSdkSessionCapabilities,
    getSdkUsageMetrics,
    getSessionMessages,
    handleSdkPendingCommand,
    handleSdkPendingPermission,
    handleSdkPendingToolCall,
    inputSdkSessionUi,
    isAgentDialogLoopPaused,
    isSdkSessionUiElicitationAvailable,
    killSdkShell,
    listAvailableModels,
    listPendingSdkElicitations,
    listPendingSdkPermissions,
    listSdkAgents,
    listSdkWorkspaceFiles,
    loginSdkMcpOauth,
    msgAnswer,
    msgProcessQueue,
    msgSend,
    msgSendBoot,
    msgSteer,
    pauseAgentDialogLoop,
    pingDialogWatchdog,
    readAgentDialogLastPrInfo,
    readAgentDialogPrMetrics,
    readSdkPlan,
    readSdkWorkspaceFile,
    reloadSdkAgents,
    requestSdkElicitation,
    resetSdkSessionApprovals,
    resolvePendingSdkElicitation,
    selectSdkAgent,
    selectSdkSessionUi,
    sessionLog,
    setModel,
    setReasoningEffort,
    updateSdkPlan,
} from './runtime/root-surface/index.js';

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
     * Subfachadas de domínio (Fase C3.2 — Decomposição Moderada).
     *
     * @type {PermissionToolsFacade}
     */
    #permissionToolsFacade;

    /**
     * @type {StateQueryFacade}
     */
    #stateQueryFacade;

    /**
     * @type {SdkQueryFacade}
     */
    #sdkQueryFacade;

    /**
     * @type {HealthFacade}
     */
    #healthFacade;

    /**
     * @param {{ model?: string; reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' }} [options]
     */
    constructor(options = {}) {
        super();
        // Agentes de alta carga acumulam múltiplos listeners por tarefa + SSE + bridge.
        // O padrão de 10 é insuficiente; configurável via AGENT_MAX_LISTENERS (padrão 50).
        this.setMaxListeners(MAX_LISTENERS);
        this.ctx = new AgentContext(this, options);

        // C3.2: Instanciar subfachadas
        this.#permissionToolsFacade = new PermissionToolsFacade(this.ctx);
        this.#stateQueryFacade = new StateQueryFacade(this.ctx);
        this.#sdkQueryFacade = new SdkQueryFacade(this.ctx);
        this.#healthFacade = new HealthFacade(this.ctx, this);

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
        return this.#permissionToolsFacade.getPermissionMode();
    }

    /**
     * Altera o modo de aprovação de tools em runtime — sem reiniciar o agente.
     *
     * A mudança afeta as próximas requisições de permissão da sessão viva. O agent entrega ao SDK um handler estável e
     * troca apenas a policy delegada por ele.
     *
     * O dialog loop não é uma tool e não passa por este handler. Não é possível bloquear o encerramento do dialog loop
     * via configuração de permissão.
     *
     * @param {'approve_all' | 'audit_only' | 'selective'} mode - Modo de aprovação
     * @param {{ allowTools?: string[]; denyTools?: string[]; denyShell?: boolean }} [opts] - Opções para modo selective
     * @returns {void}
     */
    setPermissionMode(mode, opts = {}) {
        this.#permissionToolsFacade.setPermissionMode(mode, opts);
    }

    /**
     * Retorna readiness e metadata da capability de permissões governada pelo agent.
     *
     * @returns {{ mode: 'approve_all' | 'audit_only' | 'selective'; handlerAvailable: boolean }}
     */
    getPermissionCapabilitySnapshot() {
        return this.#permissionToolsFacade.getPermissionCapabilitySnapshot();
    }

    /**
     * Retorna snapshot detalhado da policy de permissões ativa (modo, allow/deny lists, denyShell, defaultDecision).
     *
     * @returns {unknown}
     */
    getPermissionPolicySnapshot() {
        return this.#permissionToolsFacade.getPermissionPolicySnapshot();
    }

    /**
     * Retorna o `ToolSessionContext` desta sessão — encapsula estado por sessão (input pendente, broadcast SSE).
     *
     * @returns {import('#copilot/sdk/types').ToolSessionContext}
     */
    getToolSessionContext() {
        return this.#permissionToolsFacade.getToolSessionContext();
    }

    /**
     * Retorna metadata do conjunto de factories que materializou managers/capabilities vivos do contexto.
     *
     * @returns {Record<string, Record<string, unknown>>}
     */
    getContextFactoryCapabilitiesSnapshot() {
        return this.#permissionToolsFacade.getContextFactoryCapabilitiesSnapshot();
    }

    /**
     * Retorna o registry ativo de tools sem expor o manager como contrato preferencial.
     *
     * @returns {import('#copilot/sdk/types').ToolRegistry}
     */
    getToolRegistrySnapshot() {
        return this.#permissionToolsFacade.getToolRegistrySnapshot();
    }

    /**
     * Retorna uma projeção serializável das tools registradas no runtime.
     *
     * @returns {{
     *     name: string;
     *     description: string | null;
     *     category: string;
     *     tags: string[];
     *     readOnly: boolean;
     *     skipPermission: boolean;
     * }[]}
     */
    getToolRegistryEntriesSnapshot() {
        return this.#permissionToolsFacade.getToolRegistryEntriesSnapshot();
    }

    /**
     * Registra uma URL de webhook para notificações de sessão.
     *
     * @param {string} url - URL HTTP(S) que receberá POST com payload de evento
     * @returns {{ id: string; url: string }} Identificador do webhook registrado
     */
    registerWebhook(url) {
        return this.#permissionToolsFacade.registerWebhook(url);
    }

    /**
     * Remove um webhook previamente registrado.
     *
     * @param {string} id - ID do webhook a remover
     * @returns {boolean} true se removido, false se não encontrado
     */
    unregisterWebhook(id) {
        return this.#permissionToolsFacade.unregisterWebhook(id);
    }

    /**
     * Lista todos os webhooks registrados.
     *
     * @returns {{ id: string; url: string }[]}
     */
    listWebhooks() {
        return this.#permissionToolsFacade.listWebhooks();
    }

    /**
     * Retorna o status atual do agente.
     *
     * @returns {AgentStatus}
     */
    get status() {
        return this.#stateQueryFacade.status;
    }

    /**
     * Indica se o modo de diálogo contínuo está ativo (startDialogLoop foi chamado e ainda não foi parado).
     *
     * @returns {boolean}
     */
    get dialogLoopActive() {
        return this.#stateQueryFacade.dialogLoopActive;
    }

    /**
     * F45: Retorna o HandoffManager para uso em rotas HTTP e terminal.
     *
     * @returns {import('./infra/handoff-manager.js').HandoffManager | null}
     */
    getHandoffManager() {
        return getRuntimeHandoffManager(this.ctx);
    }

    /**
     * Retorna o número atual de tarefas enfileiradas aguardando processamento.
     *
     * @returns {number}
     */
    get queueSize() {
        return this.#stateQueryFacade.queueSize;
    }

    /**
     * Retorna a pergunta pendente (se houver).
     *
     * @returns {PendingQuestion | null}
     */
    get pendingQuestion() {
        return this.#stateQueryFacade.pendingQuestion;
    }

    /**
     * Retorna a classificação semântica da pergunta viva atual, quando houver.
     *
     * @returns {import('./types.js').PendingQuestionKind | null}
     */
    get pendingQuestionKind() {
        return this.#stateQueryFacade.pendingQuestionKind;
    }

    /**
     * Retorna a sombra persistida de `ask_user` restaurada do disco, quando houver.
     *
     * @returns {import('./types.js').PendingQuestionShadow | null}
     */
    get pendingQuestionShadow() {
        return this.#stateQueryFacade.pendingQuestionShadow;
    }

    /**
     * Retorna a classificação semântica da sombra persistida de `ask_user`, quando houver.
     *
     * @returns {import('./types.js').PendingQuestionKind | null}
     */
    get pendingQuestionShadowKind() {
        return this.#stateQueryFacade.pendingQuestionShadowKind;
    }

    /**
     * Retorna o estado semântico atual da shadow persistida.
     *
     * @returns {import('./types.js').PendingQuestionShadowState | null}
     */
    get pendingQuestionShadowState() {
        return this.#stateQueryFacade.pendingQuestionShadowState;
    }

    /**
     * Indica se a shadow persistida já expirou.
     *
     * @returns {boolean}
     */
    get pendingQuestionShadowExpired() {
        return this.#stateQueryFacade.pendingQuestionShadowExpired;
    }

    /**
     * Retorna a idade atual da shadow persistida, em ms, quando houver.
     *
     * @returns {number | null}
     */
    get pendingQuestionShadowAgeMs() {
        return this.#stateQueryFacade.pendingQuestionShadowAgeMs;
    }

    /**
     * Retorna o timestamp de expiração da shadow persistida, quando houver.
     *
     * @returns {number | null}
     */
    get pendingQuestionShadowExpiresAt() {
        return this.#stateQueryFacade.pendingQuestionShadowExpiresAt;
    }

    /**
     * Retorna o tempo restante até a expiração da shadow persistida.
     *
     * @returns {number | null}
     */
    get pendingQuestionShadowRemainingMs() {
        return this.#stateQueryFacade.pendingQuestionShadowRemainingMs;
    }

    /**
     * Limpa a shadow persistida de `ask_user` restaurada do disco e agenda a persistência canônica do cleanup.
     *
     * @returns {boolean}
     */
    clearPendingQuestionShadow() {
        return clearAgentRuntimePendingQuestionShadow(this.ctx, {
            label: 'state.pendingQuestionShadow.clear',
            description: 'Clear ask_user shadow from persisted state',
        });
    }

    /**
     * Retorna o sessionId da sessão ativa (ou null).
     *
     * @returns {string | null}
     */
    get sessionId() {
        return this.#stateQueryFacade.sessionId;
    }

    /**
     * Retorna o sumário de métricas da sessão atual (compatibilidade — use container.resolve(METRICS_STORE)
     * diretamente).
     *
     * @returns {object}
     */
    get telemetry() {
        return this.#stateQueryFacade.telemetry;
    }

    /**
     * Retorna o registry de tools da sessão atual.
     *
     * @returns {import('#copilot/sdk/types').ToolRegistry}
     */
    get toolsRegistry() {
        return this.#stateQueryFacade.toolsRegistry;
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
     * @param {{ shutdownTimeoutMs?: number; preserveDialogLoopIntent?: boolean }} [opts]
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
     *     timeoutMs?: number | null;
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
     * @param {{ timeoutMs?: number | null }} [opts]
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
        return this.#sdkQueryFacade.pingSdk();
    }

    /**
     * Retorna o status do runtime SDK/CLI acoplado ao agent.
     *
     * @returns {Promise<import('#copilot/sdk/types').GetStatusResponse>}
     */
    async getSdkStatus() {
        return this.#sdkQueryFacade.getSdkStatus();
    }

    /**
     * Retorna o status de autenticação do runtime SDK/CLI acoplado ao agent.
     *
     * @returns {Promise<import('#copilot/sdk/types').GetAuthStatusResponse>}
     */
    async getSdkAuthStatus() {
        return this.#sdkQueryFacade.getSdkAuthStatus();
    }

    /**
     * Lista modelos disponíveis via RPC server-scoped do SDK.
     *
     * @returns {Promise<unknown>}
     */
    async listSdkModels() {
        return this.#sdkQueryFacade.listSdkModels();
    }

    /**
     * Lista tools expostas pelo runtime SDK/CLI, opcionalmente filtradas por modelo.
     *
     * @param {{ model?: string }} [options]
     * @returns {Promise<unknown>}
     */
    async listSdkBuiltInTools(options) {
        return this.#sdkQueryFacade.listSdkBuiltInTools(options);
    }

    /**
     * Descobre skills expostas pelo runtime SDK/CLI, opcionalmente limitando o scan a projetos/diretórios.
     *
     * @param {{ projectPaths?: string[]; skillDirectories?: string[] }} [options]
     * @returns {Promise<unknown>}
     */
    async listSdkSkills(options) {
        return this.#sdkQueryFacade.listSdkSkills(options);
    }

    /**
     * Retorna snapshot de quota via RPC server-scoped do SDK.
     *
     * @returns {Promise<unknown>}
     */
    async getSdkQuota() {
        return this.#sdkQueryFacade.getSdkQuota();
    }

    /**
     * Retorna o ID da última sessão conhecida pelo client SDK atual.
     *
     * @returns {Promise<string | undefined>}
     */
    async getLastSdkSessionId() {
        return this.#sdkQueryFacade.getLastSdkSessionId();
    }

    /**
     * Retorna o sessionId em foreground no client SDK atual.
     *
     * @returns {Promise<string | undefined>}
     */
    async getForegroundSdkSessionId() {
        return this.#sdkQueryFacade.getForegroundSdkSessionId();
    }

    /**
     * Define o sessionId em foreground no client SDK atual.
     *
     * @param {string} sessionId
     * @returns {Promise<void>}
     */
    async setForegroundSdkSessionId(sessionId) {
        await this.#sdkQueryFacade.setForegroundSdkSessionId(sessionId);
    }

    /**
     * Lista sessões persistidas/acessíveis pelo client SDK atual.
     *
     * @param {import('#copilot/sdk/types').SessionListFilter} [filter]
     * @returns {Promise<import('#copilot/sdk/types').SessionMetadata[]>}
     */
    async listSdkSessions(filter) {
        return this.#sdkQueryFacade.listSdkSessions(filter);
    }

    /**
     * Retorna o modo vanilla atual da sessão SDK (`interactive`, `plan`, `autopilot`).
     *
     * @returns {Promise<import('#copilot/sdk/types').ModeResult>}
     */
    async getSdkSessionMode() {
        return this.#sdkQueryFacade.getSdkSessionMode();
    }

    /**
     * Altera o modo vanilla da sessão SDK.
     *
     * @param {'interactive' | 'plan' | 'autopilot'} mode
     * @returns {Promise<import('#copilot/sdk/types').ModeResult>}
     */
    async setSdkSessionMode(mode) {
        return this.#sdkQueryFacade.setSdkSessionMode(mode);
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
     * Lista arquivos no workspace virtual da sessão SDK.
     *
     * @returns {Promise<unknown>}
     */
    async listSdkWorkspaceFiles() {
        return listSdkWorkspaceFiles(this.ctx);
    }

    /**
     * Lê arquivo no workspace virtual da sessão SDK.
     *
     * @param {string} path
     * @returns {Promise<unknown>}
     */
    async readSdkWorkspaceFile(path) {
        return readSdkWorkspaceFile(this.ctx, path);
    }

    /**
     * Cria ou sobrescreve arquivo no workspace virtual da sessão SDK.
     *
     * @param {string} path
     * @param {string} content
     * @returns {Promise<unknown>}
     */
    async createSdkWorkspaceFile(path, content) {
        return createSdkWorkspaceFile(this.ctx, path, content);
    }

    /**
     * Executa compaction manual da sessão SDK infinita.
     *
     * @returns {Promise<unknown>}
     */
    async compactSdkSession() {
        return compactSdkSession(this.ctx);
    }

    /**
     * Solicita elicitation estruturada pela superfície SDK.
     *
     * @param {string} message
     * @param {object} requestedSchema
     * @returns {Promise<unknown>}
     */
    async requestSdkElicitation(message, requestedSchema) {
        return requestSdkElicitation(this.ctx, message, requestedSchema);
    }

    /**
     * Retorna as capabilities atuais da sessão SDK.
     *
     * @returns {import('#copilot/sdk/types').SessionCapabilities}
     */
    getSdkSessionCapabilities() {
        return getSdkSessionCapabilities(this.ctx);
    }

    /**
     * Indica se a sessão SDK suporta elicitation/UI interativa.
     *
     * @returns {boolean}
     */
    isSdkSessionUiElicitationAvailable() {
        return isSdkSessionUiElicitationAvailable(this.ctx);
    }

    /**
     * Solicita confirmação via `session.ui.confirm()` ou fallback compatível.
     *
     * @param {string} message
     * @returns {Promise<boolean>}
     */
    async confirmSdkSessionUi(message) {
        return confirmSdkSessionUi(this.ctx, message);
    }

    /**
     * Solicita seleção via `session.ui.select()` ou fallback compatível.
     *
     * @param {string} message
     * @param {string[]} options
     * @returns {Promise<string | null>}
     */
    async selectSdkSessionUi(message, options) {
        return selectSdkSessionUi(this.ctx, message, options);
    }

    /**
     * Solicita input textual via `session.ui.input()` ou fallback compatível.
     *
     * @param {string} message
     * @param {import('#copilot/sdk/types').InputOptions} [options]
     * @returns {Promise<string | null>}
     */
    async inputSdkSessionUi(message, options) {
        return inputSdkSessionUi(this.ctx, message, options);
    }

    /**
     * Lista solicitações de elicitation pendentes vindas do SDK para este runtime.
     *
     * @param {{ sessionId?: string }} [options]
     * @returns {import('#copilot/sdk/types').QueuedElicitationEntry[]}
     */
    listPendingSdkElicitations(options = {}) {
        return listPendingSdkElicitations(this.ctx, options.sessionId);
    }

    /**
     * Retorna uma solicitação de elicitation pendente por id.
     *
     * @param {string} id
     * @returns {import('#copilot/sdk/types').QueuedElicitationEntry | null}
     */
    getPendingSdkElicitation(id) {
        return getPendingSdkElicitation(this.ctx, id);
    }

    /**
     * Resolve uma solicitação de elicitation pendente do SDK.
     *
     * @param {string} id
     * @param {import('#copilot/sdk/types').ElicitationResult} result
     * @returns {boolean}
     */
    resolvePendingSdkElicitation(id, result) {
        return resolvePendingSdkElicitation(this.ctx, id, result);
    }

    /**
     * Resolve permissão pendente do SDK.
     *
     * @param {string} requestId
     * @param {{ kind: string } & Record<string, unknown>} result
     * @returns {Promise<unknown>}
     */
    async handleSdkPendingPermission(requestId, result) {
        return handleSdkPendingPermission(this.ctx, requestId, result);
    }

    /**
     * Lista permissões pendentes via RPC da sessão SDK quando a surface suporta listagem ativa.
     *
     * @returns {Promise<{ available: boolean; source: string | null; requests: unknown[] }>}
     */
    async listPendingSdkPermissions() {
        return listPendingSdkPermissions(this.ctx);
    }

    /**
     * Reseta aprovações acumuladas da sessão SDK atual.
     *
     * @returns {Promise<unknown>}
     */
    async resetSdkSessionApprovals() {
        return resetSdkSessionApprovals(this.ctx);
    }

    /**
     * Inicia o fluxo OAuth de um servidor MCP via RPC experimental do SDK.
     *
     * @param {string} serverName
     * @returns {Promise<unknown>}
     */
    async loginSdkMcpOauth(serverName) {
        return loginSdkMcpOauth(this.ctx, serverName);
    }

    /**
     * Lê métricas de uso session-scoped expostas pela RPC experimental `usage.getMetrics()`.
     *
     * @returns {Promise<unknown>}
     */
    async getSdkUsageMetrics() {
        return getSdkUsageMetrics(this.ctx);
    }

    /**
     * Resolve tool call pendente do SDK.
     *
     * @param {string} requestId
     * @param {{
     *     result?: string | { textResultForLlm: string; resultType?: string; error?: string };
     *     error?: string;
     * }} [options]
     * @returns {Promise<unknown>}
     */
    async handleSdkPendingToolCall(requestId, options) {
        return handleSdkPendingToolCall(this.ctx, requestId, options);
    }

    /**
     * Resolve comando pendente do SDK.
     *
     * @param {string} requestId
     * @param {{ error?: string }} [options]
     * @returns {Promise<unknown>}
     */
    async handleSdkPendingCommand(requestId, options) {
        return handleSdkPendingCommand(this.ctx, requestId, options);
    }

    /**
     * Executa comando shell pela superfície SDK.
     *
     * @param {string} command
     * @param {{ cwd?: string; timeout?: number }} [options]
     * @returns {Promise<unknown>}
     */
    async execSdkShell(command, options) {
        return execSdkShell(this.ctx, command, options);
    }

    /**
     * Envia sinal para processo shell iniciado pela superfície SDK.
     *
     * @param {string} processId
     * @param {'SIGTERM' | 'SIGKILL' | 'SIGINT'} [signal]
     * @returns {Promise<unknown>}
     */
    async killSdkShell(processId, signal) {
        return killSdkShell(this.ctx, processId, signal);
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
     * Retorna snapshot do nível de raciocínio atual para leitores de controle runtime.
     *
     * @returns {'low' | 'medium' | 'high' | 'xhigh' | undefined}
     */
    getReasoningEffortSnapshot() {
        return this.reasoningEffort;
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
     * invalidação é perdida. O fallback persistido de sessionId continua canônico via façade de runtime-state.
     *
     * @returns {AgentStatusSnapshot}
     */
    getStatusSnapshot() {
        return this.#healthFacade.getStatusSnapshot();
    }

    /**
     * Retorna um snapshot consolidado de health do agente.
     *
     * Usado por rotas de health, registries de observabilidade e diagnósticos operacionais.
     *
     * @returns {import('./types.js').AgentHealthSnapshot}
     */
    getHealthSnapshot() {
        return this.#healthFacade.getHealthSnapshot();
    }

    /**
     * Retorna os handles crus do SDK atualmente acoplados ao agent.
     *
     * @returns {import('./types.js').AgentSdkHandles}
     */
    getSdkHandles() {
        return this.#healthFacade.getSdkHandles();
    }

    /**
     * Retorna um snapshot verificável da cobertura de recursos SDK disponíveis ao agent.
     *
     * @returns {import('./types.js').AgentSdkAccessSnapshot}
     */
    getSdkResourceSnapshot() {
        return this.#healthFacade.getSdkResourceSnapshot();
    }

    /**
     * Retorna contagem de listeners por evento para diagnóstico de leaks.
     *
     * @returns {{ [event: string]: number }}
     */
    listenerDiagnostics() {
        return this.#healthFacade.listenerDiagnostics();
    }

    /**
     * Inicia o "modo diálogo direto" com a LLM. Delega ao DialogLoopManager.
     *
     * @param {string} [bootPrompt] - Prompt de boot personalizado (opcional)
     * @param {{ resumeSessionAttach?: boolean }} [opts]
     * @returns {Promise<void>}
     * @throws {Error} Se o agente não estiver no estado 'idle'
     */
    async startDialogLoop(bootPrompt, opts = {}) {
        await dialogStart(this.ctx, this, bootPrompt, opts);
    }

    /**
     * Envia um turno de diálogo. Delega ao DialogLoopManager.
     *
     * @param {string} message
     * @param {{ timeout?: number | null; signal?: AbortSignal; traceId?: string }} [opts]
     * @returns {Promise<string>}
     */
    sendDialogTurn(message, opts) {
        return dispatchAgentDialogTurn(this.ctx, message, opts);
    }

    /**
     * Para o modo diálogo. Delega ao DialogLoopManager.
     *
     * @param {{
     *     authorized?: boolean;
     *     reason?: 'watchdog_restart' | 'authorized_stop' | 'recovery_restart';
     *     shutdownTimeoutMs?: number;
     * }} [opts]
     * @returns {Promise<void>}
     */
    async stopDialogLoop(opts) {
        await dialogStop(this.ctx, this, opts);
    }

    /**
     * Recupera o canal de input do dialog loop por operação semântica do Agent.
     *
     * @param {{ reason?: string; traceId?: string }} [opts]
     * @returns {Promise<import('./dialog/controllers/agent-dialog-controller.js').DialogInputRecoveryResult>}
     */
    async recoverDialogInputChannel(opts) {
        return dialogRecoverInputChannel(this.ctx, this, opts);
    }

    /**
     * Pausa o dialog loop. Delega ao DialogLoopManager.
     *
     * @returns {Promise<void>}
     */
    async pauseDialogLoop() {
        await pauseAgentDialogLoop(this.ctx, this.sessionId);
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
        return isAgentDialogLoopPaused(this.ctx);
    }

    /**
     * F41: Métricas de consumo de premium requests do dialog loop.
     *
     * @returns {{ boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null}
     */
    get dialogPrMetrics() {
        return readAgentDialogPrMetrics(this.ctx);
    }

    /**
     * Último snapshot de billing do PR consumido. Atualizado quando `assistant.usage` é emitido pelo SDK.
     *
     * @returns {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null}
     */
    get lastPrInfo() {
        // Retorna cópia rasa para evitar mutação externa do estado interno.
        return readAgentDialogLastPrInfo(this.ctx);
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
export { alwaysAliveAgent, getAgent, resetAgent } from './always-alive-singleton.js';
