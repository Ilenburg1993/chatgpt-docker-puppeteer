// @ts-check
/**
 * src/copilot/agent/agent-context.js
 *
 * F35: AgentContext — objeto de contexto compartilhado entre todos os módulos do agente.
 *
 * Substitui os 32 campos #private espalhados por always-alive.js, permitindo que módulos extraídos (lifecycle, dialog,
 * messaging, state) acessem o estado via referência ao contexto ao invés de callbacks pesados.
 *
 * ATENÇÃO: este módulo NÃO é exportado no barrel público (index.js). Uso exclusivo interno do agent/ — consumidores
 * externos acessam via API pública do AlwaysAliveAgent.
 *
 * @module copilot/agent/agent-context
 * @internal
 * @see EventBus
 */

import { EMITTER_PROCESS_QUEUE, EMITTER_STATUS } from '#copilot/events';
import { COPILOT_MODEL, COPILOT_REASONING_EFFORT } from '../config/agent.js';
import { createAgentContextFactories } from './context-factories.js';
import {
    getPendingQuestionShadowAgeMs,
    getPendingQuestionShadowExpiresAt,
    getPendingQuestionShadowRemainingMs,
    getPendingQuestionShadowState,
    isPendingQuestionShadowExpired,
} from './dialog/state/pending-question-shadow.js';
import { performKeepaliveSdkTick } from './facades/agent-session-ops.js';
import { log } from './ports/logging-port.js';

/**
 * @typedef {import('#copilot/sdk/types').CopilotClient} CopilotClient
 *
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession
 *
 * @typedef {import('./types.js').PendingQuestion} PendingQuestion
 *
 * @typedef {import('./types.js').AgentTask} AgentTask
 *
 * @typedef {import('./types.js').AgentStatus} AgentStatus
 *
 * @typedef {import('./types.js').AgentSessionState} AgentSessionState
 *
 * @typedef {import('./types.js').AgentDialogState} AgentDialogState
 *
 * @typedef {import('./types.js').AgentConfigState} AgentConfigState
 *
 * @typedef {import('./types.js').AgentMetricsState} AgentMetricsState
 *
 * @typedef {import('./types.js').AgentRuntimeState} AgentRuntimeState
 *
 * @typedef {import('./types.js').AgentIOState} AgentIOState
 *
 * @typedef {import('./types.js').AgentBootReport} AgentBootReport
 *
 * @typedef {import('./types.js').AgentStartReport} AgentStartReport
 *
 * @typedef {{ emit: (event: string | symbol, payload?: unknown) => boolean }} StatusEmitterLike
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/**
 * @param {string} name
 * @param {unknown} entryValue
 * @returns {{
 *     name: string;
 *     description: string | null;
 *     category: string;
 *     tags: string[];
 *     readOnly: boolean;
 *     skipPermission: boolean;
 *     hasParameters: boolean;
 * }}
 */
function normalizeToolRegistryEntry(name, entryValue) {
    const entry = asRecord(entryValue);
    const tool = asRecord(entry['tool']);
    const toolName = typeof tool['name'] === 'string' && tool['name'] ? tool['name'] : name;
    return {
        name: toolName,
        description: typeof tool['description'] === 'string' ? tool['description'] : null,
        category: typeof entry['category'] === 'string' ? entry['category'] : 'uncategorized',
        tags: asStringArray(entry['tags']),
        readOnly: entry['readOnly'] === true,
        skipPermission: tool['skipPermission'] === true,
        hasParameters:
            tool['parameters'] !== undefined && tool['parameters'] !== null && typeof tool['parameters'] === 'object',
    };
}

/**
 * Contexto compartilhado entre todos os módulos internos do agente.
 *
 * Ciclo de vida: criado uma vez no constructor do AlwaysAliveAgent, passado por referência a todos os sub-módulos. Em
 * `K1a`, o contexto passa a manter subestados nomeados, preservando accessors compatíveis para rollout gradual.
 */
export class AgentContext {
    /** @type {import('./context-factories.js').AgentContextFactories} */
    #factories;

    /** @type {import('./context-factories.js').AgentContextFactoryHost} */
    #factoryHost;

    /** @type {AgentSessionState} */
    sessionState;

    /** @type {AgentDialogState} */
    dialogState;

    /** @type {AgentConfigState} */
    configState;

    /** @type {AgentMetricsState} */
    metricsState;

    /** @type {AgentRuntimeState} */
    runtimeState;

    /** @type {AgentIOState} */
    ioState;

    // ─── Managers (instâncias com lifecycle) ───────────────────────────────

    /** @type {import('./dialog/orchestrators/loop-manager.js').DialogLoopManager} */
    dialogLoop;

    /** @type {import('./infra/message-queue.js').MessageQueue} */
    messageQueue;

    /** @type {import('../infra/webhooks.js').WebhookManager} */
    webhooks;

    /** @type {import('./ports/permission-port.js').AgentPermissionController} */
    permissions;

    /** @type {import('#copilot/sdk/tools-registry').ToolRegistry} */
    toolsRegistry;

    /** @type {import('./session/lifecycle/keepalive.js').SessionKeepalive} */
    keepalive;

    /** @type {import('./infra/handoff-manager.js').HandoffManager} */
    handoff;

    /** @type {import('./session/history/history-sync.js').SessionMessagesCache} */
    messagesCache;

    /** @type {import('./background-tasks.js').BackgroundTasks} */
    backgroundTasks;

    /** @type {ReturnType<import('#copilot/hooks').createQueuedElicitationHandler>} */
    sdkElicitation;

    /**
     * @param {import('node:events').EventEmitter} emitter - Referência ao AlwaysAliveAgent (para emit)
     * @param {{
     *     model?: string;
     *     reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
     *     factories?: Partial<import('./context-factories.js').AgentContextFactories>;
     * }} [options]
     */
    constructor(emitter, options = {}) {
        this.sessionState = {
            session: null,
            isReconnecting: false,
            sessionEventUnsubscribers: [],
            isResumed: false,
            contextState: null,
            lastCheckpointPath: null,
        };

        this.dialogState = {
            pendingQuestion: null,
            pendingQuestionShadow: null,
            dialogLoopAttached: false,
        };

        this.configState = {
            model: options.model ?? COPILOT_MODEL,
            reasoningEffort:
                /** @type {'low' | 'medium' | 'high' | 'xhigh' | undefined} */
                (options.reasoningEffort ?? (COPILOT_REASONING_EFFORT || undefined)),
            mcpBridge: null,
        };

        this.metricsState = {
            sendCount: 0,
            statusSnapshotCache: null,
            lastPrInfo: null,
        };

        this.runtimeState = {
            status: 'stopped',
            metricsTimer: null,
            mcpReconnectCancel: null,
            quotaMonitor: null,
            agentObserver: null,
            lastBootReport: null,
            lastStartReport: null,
        };

        // Compat grep-based contract: quotaMonitor = null

        this.ioState = {
            client: null,
        };

        this.#factories = createAgentContextFactories(options.factories);
        this.#factoryHost = {
            emitter,
            emitProcessQueue: () => emitter.emit(EMITTER_PROCESS_QUEUE),
            invalidateStatusSnapshot: () => this.invalidateStatusSnapshot(),
        };

        this.messageQueue = this.#factories.createMessageQueue(this.#factoryHost);
        this.dialogLoop = this.#factories.createDialogLoop(this.#factoryHost);
        this.webhooks = this.#factories.createWebhooks(this.#factoryHost);
        this.permissions = this.#factories.createPermissions(this.#factoryHost);
        this.toolsRegistry = this.#factories.createToolsRegistry(this.#factoryHost);
        this.keepalive = this.#factories.createKeepalive(this.#factoryHost);
        this.handoff = this.#factories.createHandoff(this.#factoryHost);
        this.messagesCache = this.#factories.createMessagesCache(this.#factoryHost);
        this.sdkElicitation = this.#factories.createSdkElicitation(this.#factoryHost);
        this.backgroundTasks = this.#factories.createBackgroundTasks(this.#factoryHost);
    }

    // ─── Compat accessors (K1a) ─────────────────────────────────────────────

    /** @returns {CopilotClient | null} */
    get client() {
        return this.ioState.client;
    }

    /** @param {CopilotClient | null} value */
    set client(value) {
        if (value === null) {
            this.clearClient();
            return;
        }
        this.setClient(value);
    }

    /** @returns {CopilotSession | null} */
    get session() {
        return this.sessionState.session;
    }

    /** @param {CopilotSession | null} value */
    set session(value) {
        if (value === null) {
            this.clearSession();
            return;
        }
        this.setSession(value);
    }

    /** @returns {boolean} */
    get isReconnecting() {
        return this.sessionState.isReconnecting;
    }

    /** @param {boolean} value */
    set isReconnecting(value) {
        this.setReconnectState(value);
    }

    /** @returns {(() => void)[]} */
    get sessionEventUnsubscribers() {
        return this.sessionState.sessionEventUnsubscribers;
    }

    /** @param {(() => void)[]} value */
    set sessionEventUnsubscribers(value) {
        this.setSessionEventUnsubscribers(value);
    }

    /** @returns {AgentStatus} */
    get status() {
        return this.runtimeState.status;
    }

    /** @param {AgentStatus} value */
    set status(value) {
        this.setRuntimeStatus(value);
    }

    /** @returns {boolean} */
    get isResumed() {
        return this.sessionState.isResumed;
    }

    /** @param {boolean} value */
    set isResumed(value) {
        this.setIsResumed(value);
    }

    /** @returns {number} */
    get sendCount() {
        return this.metricsState.sendCount;
    }

    /** @param {number} value */
    set sendCount(value) {
        this.setSendCount(value);
    }

    /** @returns {PendingQuestion | null} */
    get pendingQuestion() {
        return this.dialogState.pendingQuestion;
    }

    /** @param {PendingQuestion | null} value */
    set pendingQuestion(value) {
        if (value === null) {
            this.clearPendingQuestion();
            return;
        }
        this.setPendingQuestion(value);
    }

    /** @returns {{ snapshot: import('./types.js').AgentStatusSnapshot; at: number } | null} */
    get statusSnapshotCache() {
        return this.metricsState.statusSnapshotCache;
    }

    /** @param {{ snapshot: import('./types.js').AgentStatusSnapshot; at: number } | null} value */
    set statusSnapshotCache(value) {
        this.metricsState.statusSnapshotCache = value;
    }

    /** @returns {string} */
    get model() {
        return this.configState.model;
    }

    /** @param {string} value */
    set model(value) {
        this.setModel(value);
    }

    /** @returns {'low' | 'medium' | 'high' | 'xhigh' | undefined} */
    get reasoningEffort() {
        return this.configState.reasoningEffort;
    }

    /** @param {'low' | 'medium' | 'high' | 'xhigh' | undefined} value */
    set reasoningEffort(value) {
        this.setReasoningEffort(value);
    }

    /** @returns {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null} */
    get lastPrInfo() {
        return this.metricsState.lastPrInfo;
    }

    /** @param {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null} value */
    set lastPrInfo(value) {
        this.setLastPrInfo(value);
    }

    /** @returns {{ tokens: number; tokenLimit: number; utilization: number } | null} */
    get contextState() {
        return this.sessionState.contextState;
    }

    /** @param {{ tokens: number; tokenLimit: number; utilization: number } | null} value */
    set contextState(value) {
        this.setContextState(value);
    }

    /** @returns {string | null} */
    get lastCheckpointPath() {
        return this.sessionState.lastCheckpointPath;
    }

    /** @param {string | null} value */
    set lastCheckpointPath(value) {
        this.setLastCheckpointPath(value);
    }

    /** @returns {ReturnType<typeof setInterval> | null} */
    get metricsTimer() {
        return this.runtimeState.metricsTimer;
    }

    /** @param {ReturnType<typeof setInterval> | null} value */
    set metricsTimer(value) {
        if (value === null) {
            this.clearMetricsTimer();
            return;
        }
        this.setMetricsTimer(value);
    }

    /** @returns {(() => void) | null} */
    get mcpReconnectCancel() {
        return this.runtimeState.mcpReconnectCancel;
    }

    /** @param {(() => void) | null} value */
    set mcpReconnectCancel(value) {
        if (value === null) {
            this.clearMcpReconnectCancel();
            return;
        }
        this.setMcpReconnectCancel(value);
    }

    /**
     * F69: Injeção de dependências MCP — permite override em testes e desacoplamento de camadas.
     *
     * @returns {{
     *     buildTools: () => Promise<import('#copilot/sdk/types').Tool<any>[]>;
     *     buildConfig: () => Record<string, unknown>;
     *     startAutoReconnect: (onTools: (tools: import('#copilot/sdk/types').Tool<any>[]) => void) => () => void;
     * } | null}
     */
    get mcpBridge() {
        return this.configState.mcpBridge;
    }

    /**
     * @param {{
     *     buildTools: () => Promise<import('#copilot/sdk/types').Tool<any>[]>;
     *     buildConfig: () => Record<string, unknown>;
     *     startAutoReconnect: (onTools: (tools: import('#copilot/sdk/types').Tool<any>[]) => void) => () => void;
     * } | null} value
     */
    set mcpBridge(value) {
        this.configState.mcpBridge = value;
    }

    /** @returns {import('#copilot/sdk/quota-monitor').QuotaMonitor | null} */
    get quotaMonitor() {
        return this.runtimeState.quotaMonitor;
    }

    /** @param {import('#copilot/sdk/quota-monitor').QuotaMonitor | null} value */
    set quotaMonitor(value) {
        if (value === null) {
            this.clearQuotaMonitor();
            return;
        }
        this.setQuotaMonitor(value);
    }

    /** @returns {boolean} */
    get dialogLoopAttached() {
        return this.dialogState.dialogLoopAttached;
    }

    /** @param {boolean} value */
    set dialogLoopAttached(value) {
        this.setDialogLoopAttached(value);
    }

    /** @returns {{ attach: (agent: import('node:events').EventEmitter) => void; detach: () => void } | null} */
    get agentObserver() {
        return this.runtimeState.agentObserver;
    }

    /** @param {{ attach: (agent: import('node:events').EventEmitter) => void; detach: () => void } | null} value */
    set agentObserver(value) {
        if (value === null) {
            this.clearAgentObserver();
            return;
        }
        this.setAgentObserver(value);
    }

    /** @returns {AgentBootReport | null} */
    get bootReport() {
        return this.runtimeState.lastBootReport;
    }

    /** @param {AgentBootReport | null} value */
    set bootReport(value) {
        this.setBootReport(value);
    }

    /**
     * Atualiza o status operacional sem emitir eventos. Use `setStatus()` quando o host precisa ser notificado.
     *
     * @param {AgentStatus} status
     * @returns {void}
     */
    setRuntimeStatus(status) {
        if (this.runtimeState.status === status) {
            return;
        }
        this.runtimeState.status = status;
        this.invalidateStatusSnapshot();
    }

    /**
     * Retorna o status operacional atual sem expor `runtimeState`.
     *
     * @returns {AgentStatus}
     */
    getRuntimeStatus() {
        return this.runtimeState.status;
    }

    /**
     * Indica se o status atual corresponde ao valor informado.
     *
     * @param {AgentStatus} status
     * @returns {boolean}
     */
    isStatus(status) {
        return this.runtimeState.status === status;
    }

    /** @returns {boolean} */
    isStopped() {
        return this.isStatus('stopped');
    }

    /** @returns {boolean} */
    isStarting() {
        return this.isStatus('starting');
    }

    /** @returns {boolean} */
    isIdle() {
        return this.isStatus('idle');
    }

    /** @returns {boolean} */
    isProcessing() {
        return this.isStatus('processing');
    }

    /** @returns {boolean} */
    isWaitingForInput() {
        return this.isStatus('waiting_for_input');
    }

    /**
     * Retorna a configuração de modelo atual.
     *
     * @returns {string}
     */
    getModelSnapshot() {
        return this.configState.model;
    }

    /**
     * Retorna o esforço de reasoning atual.
     *
     * @returns {'low' | 'medium' | 'high' | 'xhigh' | undefined}
     */
    getReasoningEffortSnapshot() {
        return this.configState.reasoningEffort;
    }

    /**
     * Retorna se a sessão atual foi retomada.
     *
     * @returns {boolean}
     */
    getIsResumedSnapshot() {
        return this.sessionState.isResumed;
    }

    /**
     * Retorna o contador atual de envios.
     *
     * @returns {number}
     */
    getSendCountSnapshot() {
        return this.metricsState.sendCount;
    }

    /**
     * Retorna o estado atual de reconexão.
     *
     * @returns {boolean}
     */
    isReconnectActive() {
        return this.sessionState.isReconnecting;
    }

    /**
     * Retorna o cache de status ainda válido para o TTL informado.
     *
     * @param {number} ttlMs
     * @returns {import('./types.js').AgentStatusSnapshot | null}
     */
    getFreshStatusSnapshotCache(ttlMs) {
        const cached = this.metricsState.statusSnapshotCache;
        if (!cached) {
            return null;
        }
        if (Date.now() - cached.at < ttlMs) {
            return cached.snapshot;
        }
        this.invalidateStatusSnapshot();
        return null;
    }

    /**
     * Retorna dados mínimos da fila para snapshot/diagnóstico, sem expor o manager vivo.
     *
     * @returns {{ size: number; oldest: AgentTask | undefined }}
     */
    getQueueSnapshot() {
        return {
            size: this.messageQueue.size,
            oldest: this.messageQueue.oldest,
        };
    }

    /**
     * Indica se há tarefas aguardando na fila de mensagens.
     *
     * @returns {boolean}
     */
    hasQueuedMessages() {
        return this.messageQueue.size > 0;
    }

    /**
     * Enfileira uma task de mensagem usando o manager governado pelo contexto.
     *
     * @param {AgentTask} task
     * @param {{ signal?: AbortSignal }} [options]
     * @returns {void}
     */
    enqueueMessageTask(task, options = {}) {
        this.messageQueue.enqueue(task, ...(options.signal ? [{ signal: options.signal }] : []));
    }

    /**
     * Retira a próxima task de mensagem da fila.
     *
     * @returns {AgentTask | undefined}
     */
    shiftMessageTask() {
        return this.messageQueue.shift();
    }

    /**
     * Reinsere uma task no início da fila.
     *
     * @param {AgentTask} task
     * @returns {void}
     */
    unshiftMessageTask(task) {
        this.messageQueue.unshift(task);
    }

    /**
     * Drena a fila de mensagens rejeitando tasks pendentes com erro explícito.
     *
     * @param {Error} error
     * @returns {AgentTask[]}
     */
    drainMessageQueue(error) {
        return this.messageQueue.drain(error);
    }

    /**
     * Rastreia uma tarefa de background através do manager governado pelo contexto.
     *
     * @param {Promise<unknown>} task
     * @param {{ label?: string; description?: string }} [meta]
     * @returns {Promise<void>}
     */
    trackBackgroundTask(task, meta) {
        return this.backgroundTasks.track(task, meta);
    }

    /**
     * Aguarda o esvaziamento das tarefas de background.
     *
     * @param {number} timeoutMs
     * @returns {Promise<boolean>}
     */
    drainBackgroundTasks(timeoutMs) {
        return this.backgroundTasks.drain(timeoutMs);
    }

    /**
     * Para o quota monitor ativo e limpa sua referência.
     *
     * @returns {void}
     */
    stopQuotaMonitor() {
        const quotaMonitor = this.runtimeState.quotaMonitor;
        if (!quotaMonitor) {
            return;
        }
        quotaMonitor.stop();
        this.clearQuotaMonitor();
    }

    /**
     * Retorna a pergunta pendente viva para builders internos que ainda exigem o shape completo.
     *
     * @returns {PendingQuestion | null}
     */
    getPendingQuestionForStatusSnapshot() {
        return this.dialogState.pendingQuestion;
    }

    /**
     * Atualiza o cliente SDK ativo.
     *
     * @param {CopilotClient} client
     * @returns {void}
     */
    setClient(client) {
        this.ioState.client = client;
        this.invalidateStatusSnapshot();
    }

    /**
     * Remove o cliente SDK ativo.
     *
     * @returns {void}
     */
    clearClient() {
        if (this.ioState.client === null) {
            return;
        }
        this.ioState.client = null;
        this.invalidateStatusSnapshot();
    }

    /**
     * Atualiza a sessão SDK ativa.
     *
     * @param {CopilotSession} session
     * @returns {void}
     */
    setSession(session) {
        this.sessionState.session = session;
        this.invalidateStatusSnapshot();
    }

    /**
     * Remove a sessão SDK ativa.
     *
     * @returns {void}
     */
    clearSession() {
        if (this.sessionState.session === null) {
            return;
        }
        this.sessionState.session = null;
        this.invalidateStatusSnapshot();
    }

    /**
     * Atualiza a flag de sessão retomada.
     *
     * @param {boolean} isResumed
     * @returns {void}
     */
    setIsResumed(isResumed) {
        this.sessionState.isResumed = isResumed;
        this.invalidateStatusSnapshot();
    }

    /**
     * Atualiza a flag de reconexão em andamento.
     *
     * @param {boolean} isReconnecting
     * @returns {void}
     */
    setReconnectState(isReconnecting) {
        this.sessionState.isReconnecting = isReconnecting;
        this.invalidateStatusSnapshot();
    }

    /**
     * Substitui a lista de unsubscribers da sessão por uma cópia defensiva.
     *
     * @param {(() => void)[]} unsubs
     * @returns {void}
     */
    setSessionEventUnsubscribers(unsubs) {
        this.sessionState.sessionEventUnsubscribers = [...unsubs];
    }

    /**
     * Limpa a lista de unsubscribers da sessão atual.
     *
     * @returns {void}
     */
    clearSessionEventUnsubscribers() {
        if (this.sessionState.sessionEventUnsubscribers.length === 0) {
            return;
        }
        this.sessionState.sessionEventUnsubscribers = [];
    }

    /**
     * Define o contador absoluto de envios.
     *
     * @param {number} sendCount
     * @returns {void}
     */
    setSendCount(sendCount) {
        this.metricsState.sendCount = sendCount;
        this.invalidateStatusSnapshot();
    }

    /**
     * Atualiza o último snapshot de consumo de PR/quota conhecido.
     *
     * @param {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null} info
     * @returns {void}
     */
    setLastPrInfo(info) {
        this.metricsState.lastPrInfo = info ? { ...info } : null;
    }

    /**
     * Atualiza o estado de wiring do dialog loop.
     *
     * @param {boolean} attached
     * @returns {void}
     */
    setDialogLoopAttached(attached) {
        this.dialogState.dialogLoopAttached = attached;
        this.invalidateStatusSnapshot();
    }

    /**
     * Atualiza o contexto de uso da janela de contexto.
     *
     * @param {{ tokens: number; tokenLimit: number; utilization: number } | null} state
     * @returns {void}
     */
    setContextState(state) {
        this.sessionState.contextState = state;
        this.invalidateStatusSnapshot();
    }

    /**
     * Atualiza o último checkpoint persistido pelo SDK.
     *
     * @param {string | null} path
     * @returns {void}
     */
    setLastCheckpointPath(path) {
        this.sessionState.lastCheckpointPath = path;
        this.invalidateStatusSnapshot();
    }

    /**
     * Registra o último relatório de boot conhecido.
     *
     * @param {AgentBootReport | null} report
     * @returns {void}
     */
    setBootReport(report) {
        this.runtimeState.lastBootReport = report;
    }

    /**
     * Registra o último relatório transacional de start conhecido.
     *
     * @param {AgentStartReport | null} report
     * @returns {void}
     */
    setStartReport(report) {
        this.runtimeState.lastStartReport = report;
        this.invalidateStatusSnapshot();
    }

    /**
     * Atualiza o timer periódico de métricas do runtime.
     *
     * @param {ReturnType<typeof setInterval>} timer
     * @returns {void}
     */
    setMetricsTimer(timer) {
        this.runtimeState.metricsTimer = timer;
    }

    /**
     * Limpa a referência do timer periódico de métricas.
     *
     * @returns {void}
     */
    clearMetricsTimer() {
        this.runtimeState.metricsTimer = null;
    }

    /**
     * Atualiza o cancel handler do auto-reconnect MCP.
     *
     * @param {() => void} cancel
     * @returns {void}
     */
    setMcpReconnectCancel(cancel) {
        this.runtimeState.mcpReconnectCancel = cancel;
    }

    /**
     * Limpa a referência do cancel handler do auto-reconnect MCP.
     *
     * @returns {void}
     */
    clearMcpReconnectCancel() {
        this.runtimeState.mcpReconnectCancel = null;
    }

    /**
     * Atualiza o observer do agente usado pelo boot/lifecycle.
     *
     * @param {{ attach: (agent: import('node:events').EventEmitter) => void; detach: () => void }} observer
     * @returns {void}
     */
    setAgentObserver(observer) {
        this.runtimeState.agentObserver = observer;
    }

    /**
     * Limpa a referência do observer do agente.
     *
     * @returns {void}
     */
    clearAgentObserver() {
        this.runtimeState.agentObserver = null;
    }

    /**
     * Atualiza o quota monitor acoplado ao runtime.
     *
     * @param {import('#copilot/sdk/quota-monitor').QuotaMonitor} quotaMonitor
     * @returns {void}
     */
    setQuotaMonitor(quotaMonitor) {
        this.runtimeState.quotaMonitor = quotaMonitor;
    }

    /**
     * Limpa a referência do quota monitor acoplado ao runtime.
     *
     * @returns {void}
     */
    clearQuotaMonitor() {
        this.runtimeState.quotaMonitor = null;
    }

    /**
     * Atualiza o modelo configurado no agent.
     *
     * @param {string} model
     * @returns {void}
     */
    setModel(model) {
        this.configState.model = model;
        this.invalidateStatusSnapshot();
    }

    /**
     * Atualiza o nível de reasoning configurado.
     *
     * @param {'low' | 'medium' | 'high' | 'xhigh' | undefined} reasoningEffort
     * @returns {void}
     */
    setReasoningEffort(reasoningEffort) {
        this.configState.reasoningEffort = reasoningEffort;
        this.invalidateStatusSnapshot();
    }

    /**
     * Atualiza o cache de snapshot de status com valor já construído.
     *
     * @param {import('./types.js').AgentStatusSnapshot} snapshot
     * @returns {void}
     */
    cacheStatusSnapshot(snapshot) {
        this.metricsState.statusSnapshotCache = { snapshot, at: Date.now() };
    }

    /**
     * Invalida o cache do snapshot público de status.
     *
     * Centraliza a mutação para reduzir writes diretos em `metricsState.statusSnapshotCache` nos módulos quentes.
     *
     * @returns {void}
     */
    invalidateStatusSnapshot() {
        this.metricsState.statusSnapshotCache = null;
    }

    /**
     * Incrementa o contador de envios do agente e invalida o snapshot cacheado.
     *
     * @returns {number} Novo valor do contador.
     */
    incrementSendCount() {
        this.metricsState.sendCount += 1;
        this.invalidateStatusSnapshot();
        return this.metricsState.sendCount;
    }

    /**
     * Atualiza a pergunta pendente do SDK e invalida o snapshot cacheado.
     *
     * @param {PendingQuestion | null} question
     * @returns {void}
     */
    setPendingQuestion(question) {
        this.dialogState.pendingQuestion = question;
        this.dialogState.pendingQuestionShadow = null;
        this.invalidateStatusSnapshot();
    }

    /**
     * Limpa a pergunta pendente atual, preservando idempotência.
     *
     * @returns {void}
     */
    clearPendingQuestion() {
        if (this.dialogState.pendingQuestion === null) {
            return;
        }
        this.dialogState.pendingQuestion = null;
        this.invalidateStatusSnapshot();
    }

    /**
     * Atualiza a sombra persistida de `ask_user` restaurada do state-io.
     *
     * @param {import('./types.js').PendingQuestionShadow | null} shadow
     * @returns {void}
     */
    setPendingQuestionShadow(shadow) {
        this.dialogState.pendingQuestionShadow = shadow;
        this.invalidateStatusSnapshot();
    }

    /**
     * Limpa a sombra persistida de `ask_user`.
     *
     * @returns {void}
     */
    clearPendingQuestionShadow() {
        if (this.dialogState.pendingQuestionShadow === null) {
            return;
        }
        this.dialogState.pendingQuestionShadow = null;
        this.invalidateStatusSnapshot();
    }

    /**
     * Resolve e limpa a pergunta pendente atual de forma semântica.
     *
     * @param {string} answer
     * @returns {boolean} `true` quando havia pergunta pendente para resolver.
     */
    resolvePendingQuestion(answer) {
        const question = this.dialogState.pendingQuestion;
        if (question === null) {
            return false;
        }
        question.resolve(answer);
        this.clearPendingQuestion();
        return true;
    }

    /**
     * Retorna o handler SDK de elicitation atualmente governado pelo contexto.
     *
     * @returns {import('#copilot/sdk/types').ElicitationHandler}
     */
    getSdkElicitationHandlerSnapshot() {
        return this.sdkElicitation.handler;
    }

    /**
     * Lista solicitações de elicitation pendentes.
     *
     * @param {{ sessionId?: string }} [opts]
     * @returns {ReturnType<AgentContext['sdkElicitation']['listPending']>}
     */
    listPendingSdkElicitations(opts = {}) {
        return this.sdkElicitation.listPending(opts);
    }

    /**
     * Retorna uma solicitação de elicitation pendente por id.
     *
     * @param {string} id
     * @returns {ReturnType<AgentContext['sdkElicitation']['getPending']>}
     */
    getPendingSdkElicitation(id) {
        return this.sdkElicitation.getPending(id);
    }

    /**
     * Resolve uma solicitação de elicitation pendente.
     *
     * @param {string} id
     * @param {import('#copilot/sdk/types').ElicitationResult} result
     * @returns {boolean}
     */
    resolvePendingSdkElicitation(id, result) {
        const resolved = this.sdkElicitation.resolvePending(id, result);
        if (resolved) this.invalidateStatusSnapshot();
        return resolved;
    }

    /**
     * Cancela ou limpa uma solicitação de elicitation pendente.
     *
     * @param {string} id
     * @returns {boolean}
     */
    clearPendingSdkElicitation(id) {
        const cleared = this.sdkElicitation.clearPending(id, { action: 'cancel' });
        if (cleared) this.invalidateStatusSnapshot();
        return cleared;
    }

    /**
     * Retorna labels de tarefas em background ainda pendentes.
     *
     * @param {number} [limit=5] Default is `5`
     * @returns {string[]}
     */
    getBackgroundPendingLabels(limit = 5) {
        return this.backgroundTasks.getPendingLabels?.(limit) ?? [];
    }

    /**
     * Indica se existe um client SDK ativo acoplado ao agent.
     *
     * @returns {boolean}
     */
    hasClient() {
        return this.ioState.client !== null;
    }

    /**
     * Retorna o client SDK ativo sem expor diretamente o shape cru de `ioState` aos consumidores quentes.
     *
     * @returns {CopilotClient | null}
     */
    getClientSnapshot() {
        return this.ioState.client;
    }

    /**
     * Indica se existe uma sessão SDK ativa acoplada ao agent.
     *
     * @returns {boolean}
     */
    hasActiveSession() {
        return this.sessionState.session !== null;
    }

    /**
     * Retorna a sessão SDK ativa sem expor diretamente o shape cru de `sessionState` aos consumidores quentes.
     *
     * @returns {CopilotSession | null}
     */
    getSessionSnapshot() {
        return this.sessionState.session;
    }

    /**
     * Retorna a bridge MCP ativa sem expor diretamente o shape cru de `configState` aos consumidores quentes.
     *
     * @returns {{
     *     buildTools: () => Promise<import('#copilot/sdk/types').Tool<any>[]>;
     *     buildConfig: () => Record<string, unknown>;
     *     startAutoReconnect: (onTools: (tools: import('#copilot/sdk/types').Tool<any>[]) => void) => () => void;
     * } | null}
     */
    getMcpBridgeSnapshot() {
        return this.configState.mcpBridge;
    }

    /**
     * Retorna o estado de wiring do dialog loop sem expor diretamente o shape cru de `dialogState`.
     *
     * @returns {boolean}
     */
    getDialogLoopAttachedSnapshot() {
        return this.dialogState.dialogLoopAttached;
    }

    /**
     * Retorna o quota monitor ativo sem expor diretamente o shape cru de `runtimeState`.
     *
     * @returns {import('#copilot/sdk/quota-monitor').QuotaMonitor | null}
     */
    getQuotaMonitorSnapshot() {
        return this.runtimeState.quotaMonitor;
    }

    /**
     * Indica se o dialog loop está ativo no runtime atual.
     *
     * @returns {boolean}
     */
    isDialogLoopActive() {
        return Boolean(this.dialogLoop.active);
    }

    /**
     * Indica se o dialog loop está pausado no runtime atual.
     *
     * @returns {boolean}
     */
    isDialogLoopPaused() {
        return Boolean(this.dialogLoop.paused);
    }

    /**
     * Indica se o keepalive da sessão está ativo.
     *
     * @returns {boolean}
     */
    isKeepaliveRunning() {
        return Boolean(this.keepalive.running);
    }

    /**
     * Indica se há pergunta pendente do SDK aguardando resposta.
     *
     * @returns {boolean}
     */
    hasPendingQuestion() {
        return this.dialogState.pendingQuestion !== null;
    }

    /**
     * Retorna uma cópia semântica da pergunta pendente atual, quando existir.
     *
     * @returns {{
     *     question: string;
     *     allowFreeform: boolean;
     *     askedAt: number;
     *     kind: import('./types.js').PendingQuestionKind;
     *     protocolControlled: boolean;
     *     choices?: string[];
     * } | null}
     */
    getPendingQuestionSnapshot() {
        const question = this.dialogState.pendingQuestion;
        if (question === null) {
            return null;
        }
        return {
            question: question.question,
            allowFreeform: question.allowFreeform,
            askedAt: question.askedAt,
            kind: question.kind,
            protocolControlled: question.protocolControlled,
            ...(question.choices !== undefined ? { choices: [...question.choices] } : {}),
        };
    }

    /**
     * Indica se existe sombra persistida de `ask_user` restaurada do state-io.
     *
     * @returns {boolean}
     */
    hasPendingQuestionShadow() {
        return this.dialogState.pendingQuestionShadow !== null;
    }

    /**
     * Retorna a classificação semântica da pergunta pendente atual.
     *
     * @returns {import('./types.js').PendingQuestionKind | null}
     */
    getPendingQuestionKind() {
        return this.dialogState.pendingQuestion?.kind ?? null;
    }

    /**
     * Retorna a classificação semântica da sombra persistida de `ask_user`.
     *
     * @returns {import('./types.js').PendingQuestionKind | null}
     */
    getPendingQuestionShadowKind() {
        return this.dialogState.pendingQuestionShadow?.meta.kind ?? null;
    }

    /**
     * Retorna uma cópia defensiva da shadow persistida de `ask_user`, quando houver.
     *
     * @returns {import('./types.js').PendingQuestionShadow | null}
     */
    getPendingQuestionShadowSnapshot() {
        const shadow = this.dialogState.pendingQuestionShadow;
        if (shadow === null) {
            return null;
        }
        return {
            ...shadow,
            meta: {
                ...shadow.meta,
                ...(shadow.meta.choices !== undefined ? { choices: [...shadow.meta.choices] } : {}),
            },
        };
    }

    /**
     * Retorna a idade da shadow persistida de `ask_user`, em ms.
     *
     * @param {number} [now]
     * @returns {number | null}
     */
    getPendingQuestionShadowAgeMs(now = Date.now()) {
        return this.dialogState.pendingQuestionShadow
            ? getPendingQuestionShadowAgeMs(this.dialogState.pendingQuestionShadow, now)
            : null;
    }

    /**
     * Retorna o timestamp de expiração da shadow persistida.
     *
     * @returns {number | null}
     */
    getPendingQuestionShadowExpiresAt() {
        return this.dialogState.pendingQuestionShadow
            ? getPendingQuestionShadowExpiresAt(this.dialogState.pendingQuestionShadow)
            : null;
    }

    /**
     * Retorna o tempo restante da shadow persistida até expirar.
     *
     * @param {number} [now]
     * @returns {number | null}
     */
    getPendingQuestionShadowRemainingMs(now = Date.now()) {
        return this.dialogState.pendingQuestionShadow
            ? getPendingQuestionShadowRemainingMs(this.dialogState.pendingQuestionShadow, now)
            : null;
    }

    /**
     * Retorna o estado semântico da shadow persistida.
     *
     * @param {number} [now]
     * @returns {import('./dialog/state/pending-question-shadow.js').PendingQuestionShadowState | null}
     */
    getPendingQuestionShadowState(now = Date.now()) {
        return this.dialogState.pendingQuestionShadow
            ? getPendingQuestionShadowState(this.dialogState.pendingQuestionShadow, { now })
            : null;
    }

    /**
     * Indica se a shadow persistida já expirou.
     *
     * @param {number} [now]
     * @returns {boolean}
     */
    isPendingQuestionShadowExpired(now = Date.now()) {
        return this.dialogState.pendingQuestionShadow
            ? isPendingQuestionShadowExpired(this.dialogState.pendingQuestionShadow, { now })
            : false;
    }

    /**
     * Retorna a quantidade atual de tarefas fire-and-forget ainda pendentes.
     *
     * @returns {number}
     */
    getBackgroundPendingCount() {
        return this.backgroundTasks.pendingCount;
    }

    /**
     * Retorna uma cópia defensiva dos unsubscribers registrados para a sessão ativa.
     *
     * @returns {(() => void)[]}
     */
    getSessionEventUnsubscribersSnapshot() {
        return [...this.sessionState.sessionEventUnsubscribers];
    }

    /**
     * Retorna uma cópia rasa do último snapshot de PR/quota conhecido.
     *
     * @returns {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null}
     */
    getLastPrInfoSnapshot() {
        return this.metricsState.lastPrInfo ? { ...this.metricsState.lastPrInfo } : null;
    }

    /**
     * Retorna uma cópia defensiva do último boot report conhecido.
     *
     * @returns {AgentBootReport | null}
     */
    getBootReportSnapshot() {
        const report = this.runtimeState.lastBootReport;
        if (report === null) {
            return null;
        }
        return {
            ...report,
            steps: report.steps.map((step) => ({ ...step })),
        };
    }

    /**
     * Retorna uma cópia defensiva do último start report conhecido.
     *
     * @returns {AgentStartReport | null}
     */
    getStartReportSnapshot() {
        const report = this.runtimeState.lastStartReport;
        if (report === null) {
            return null;
        }
        return {
            ...report,
            phases: report.phases.map((phase) => ({ ...phase })),
        };
    }

    /**
     * Retorna uma cópia rasa do último uso de contexto conhecido.
     *
     * @returns {{ tokens: number; tokenLimit: number; utilization: number } | null}
     */
    getContextStateSnapshot() {
        return this.sessionState.contextState ? { ...this.sessionState.contextState } : null;
    }

    /**
     * Retorna o último checkpoint path persistido pelo SDK.
     *
     * @returns {string | null}
     */
    getLastCheckpointPathSnapshot() {
        return this.sessionState.lastCheckpointPath;
    }

    /**
     * Retorna as métricas atuais de PR do dialog loop sem expor diretamente o manager vivo.
     *
     * @returns {{ boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null}
     */
    getDialogPrMetricsSnapshot() {
        return this.dialogLoop?.prMetrics ?? null;
    }

    /**
     * Retorna o timer periódico de métricas do runtime.
     *
     * @returns {ReturnType<typeof setInterval> | null}
     */
    getMetricsTimerSnapshot() {
        return this.runtimeState.metricsTimer;
    }

    /**
     * Retorna o cancel handler atual do auto-reconnect MCP.
     *
     * @returns {(() => void) | null}
     */
    getMcpReconnectCancelSnapshot() {
        return this.runtimeState.mcpReconnectCancel;
    }

    /**
     * Retorna o observer atual do agente, quando houver.
     *
     * @returns {{ attach: (agent: import('node:events').EventEmitter) => void; detach: () => void } | null}
     */
    getAgentObserverSnapshot() {
        return this.runtimeState.agentObserver;
    }

    /**
     * Registra atividade no keepalive ativo.
     *
     * @returns {void}
     */
    pingKeepalive() {
        this.keepalive.ping();
    }

    /**
     * Inicia o keepalive do runtime usando os accessors semânticos atuais do contexto.
     *
     * @param {{
     *     isIdle?: () => boolean;
     *     onKeepalive?: (info: { ts: number; strategy: 'client.ping' | 'session.send' }) => void;
     * }} [options]
     * @returns {boolean} `true` quando o keepalive pôde ser iniciado.
     */
    startKeepalive(options = {}) {
        if (this.status === 'stopped' || !this.hasActiveSession()) {
            return false;
        }

        this.keepalive.start({
            performKeepalive: () => performKeepaliveSdkTick(this),
            isIdle: options.isIdle ?? (() => this.status === 'idle'),
            isDialogLoopActive: () => this.isDialogLoopActive(),
            ...(options.onKeepalive !== undefined ? { onKeepalive: options.onKeepalive } : {}),
        });

        return true;
    }

    /**
     * Para o keepalive do runtime com razão explícita.
     *
     * @param {string} [reason='manual'] Default is `'manual'`
     * @returns {void}
     */
    stopKeepalive(reason = 'manual') {
        this.keepalive.stop(reason);
    }

    // ─── Manager Boundary API ────────────────────────────────────────────

    /**
     * Retorna o modo de permissão efetivo sem expor o controller vivo.
     *
     * @returns {'approve_all' | 'audit_only' | 'selective'}
     */
    getPermissionModeSnapshot() {
        return this.permissions.getMode();
    }

    /**
     * Atualiza a policy de permissão de tools.
     *
     * @param {'approve_all' | 'audit_only' | 'selective'} mode
     * @param {{ allowTools?: string[]; denyTools?: string[]; denyShell?: boolean }} [opts]
     * @returns {void}
     */
    setPermissionMode(mode, opts = {}) {
        this.permissions.setMode(mode, opts);
        this.invalidateStatusSnapshot();
    }

    /**
     * Retorna o handler SDK de permissões atualmente governado pelo contexto.
     *
     * @returns {import('#copilot/sdk/types').PermissionHandler}
     */
    getPermissionHandlerSnapshot() {
        return this.permissions.handler;
    }

    /**
     * Retorna readiness/metadata da capability de permissões governada pelo agent.
     *
     * O shape é intencionalmente semântico: consumers não precisam saber se a implementação concreta é
     * `PermissionController`, mock de teste ou runtime alternativo.
     *
     * @returns {{
     *     mode: 'approve_all' | 'audit_only' | 'selective';
     *     handlerAvailable: boolean;
     *     provider?: unknown;
     *     factory?: unknown;
     *     sdkFirst?: unknown;
     *     stableHandler?: unknown;
     *     runtimeAuthority?: unknown;
     *     [key: string]: unknown;
     * }}
     */
    getPermissionCapabilitySnapshot() {
        const factorySet = this.getContextFactoryCapabilitiesSnapshot();
        const metadata = {
            ...this.#factories.describePermissionsCapability(this.#factoryHost),
            ...(factorySet['governance.permissions'] ?? {}),
        };
        const handler = this.getPermissionHandlerSnapshot();
        return {
            ...metadata,
            mode: this.getPermissionModeSnapshot(),
            handlerAvailable: typeof handler === 'function',
        };
    }

    /**
     * Retorna metadata do conjunto de factories que materializou os managers vivos do contexto.
     *
     * Essa leitura não é fonte de readiness operacional por si só; ela explica origem/autoridade dos componentes para
     * capability maps, diagnósticos e runtimes alternativos.
     *
     * @returns {Record<string, Record<string, unknown>>}
     */
    getContextFactoryCapabilitiesSnapshot() {
        const metadata = this.#factories.describeFactorySet(this.#factoryHost);
        return Object.fromEntries(
            Object.entries(metadata).map(([key, value]) => [
                key,
                {
                    ...value,
                },
            ]),
        );
    }

    /**
     * Retorna o registry ativo de tools.
     *
     * @returns {import('#copilot/sdk/tools-registry').ToolRegistry}
     */
    getToolRegistrySnapshot() {
        return this.toolsRegistry;
    }

    /**
     * Retorna uma leitura defensiva e serializável das tools registradas no runtime.
     *
     * @returns {{
     *     name: string;
     *     description: string | null;
     *     category: string;
     *     tags: string[];
     *     readOnly: boolean;
     *     skipPermission: boolean;
     *     hasParameters: boolean;
     * }[]}
     */
    getToolRegistryEntriesSnapshot() {
        const registry = this.getToolRegistrySnapshot();
        if (!(registry?.entries instanceof Map)) return [];
        return [...registry.entries.entries()].map(([name, entry]) => normalizeToolRegistryEntry(name, entry));
    }

    /**
     * Recria o registry de tools para um novo boot/resume de sessão.
     *
     * @returns {import('#copilot/sdk/tools-registry').ToolRegistry}
     */
    resetToolsRegistry() {
        this.toolsRegistry = this.#factories.createToolsRegistry(this.#factoryHost);
        return this.toolsRegistry;
    }

    /**
     * Retorna o manager de handoff governado pelo contexto.
     *
     * @returns {import('./infra/handoff-manager.js').HandoffManager}
     */
    getHandoffManagerSnapshot() {
        return this.handoff;
    }

    /**
     * Registra um evento de handoff recebido do SDK.
     *
     * @param {{ fromAgent: string; toAgent: string; reason?: string; context?: Record<string, unknown> }} event
     * @returns {void}
     */
    receiveHandoff(event) {
        this.handoff.receive(event);
    }

    /**
     * Retorna o manager vivo do dialog loop para integrações que ainda exigem EventEmitter/manager.
     *
     * @returns {import('./dialog/orchestrators/loop-manager.js').DialogLoopManager}
     */
    getDialogLoopManagerSnapshot() {
        return this.dialogLoop;
    }

    /**
     * Retorna o keepalive vivo para integrações legadas que ainda exigem o manager.
     *
     * @returns {import('./session/lifecycle/keepalive.js').SessionKeepalive}
     */
    getKeepaliveManagerSnapshot() {
        return this.keepalive;
    }

    /**
     * Atualiza o host do dialog loop.
     *
     * @param {import('./types.js').DialogLoopHost} host
     * @returns {void}
     */
    attachDialogLoop(host) {
        this.dialogLoop.attach(host);
    }

    /**
     * Inicia o dialog loop governado pelo contexto.
     *
     * @param {string} [bootPrompt]
     * @returns {Promise<void>}
     */
    startDialogLoop(bootPrompt) {
        return this.dialogLoop.start(bootPrompt);
    }

    /**
     * Envia um turno ao dialog loop.
     *
     * @param {string} message
     * @param {{ timeout?: number | null; signal?: AbortSignal; traceId?: string }} [opts]
     * @returns {Promise<string>}
     */
    sendDialogTurn(message, opts) {
        return this.dialogLoop.sendTurn(message, opts);
    }

    /**
     * Para o dialog loop governado pelo contexto.
     *
     * @param {{
     *     authorized?: boolean;
     *     reason?: 'watchdog_restart' | 'authorized_stop' | 'recovery_restart';
     *     shutdownTimeoutMs?: number;
     * }} [opts]
     * @returns {Promise<void>}
     */
    stopDialogLoop(opts) {
        return this.dialogLoop.stop(opts);
    }

    /**
     * Pausa o dialog loop governado pelo contexto.
     *
     * @param {string | null} sessionId
     * @returns {Promise<void>}
     */
    pauseDialogLoop(sessionId) {
        return this.dialogLoop.pause(sessionId);
    }

    /**
     * Retoma o dialog loop governado pelo contexto.
     *
     * @returns {Promise<void>}
     */
    resumeDialogLoop() {
        return this.dialogLoop.resume();
    }

    /**
     * Remove listeners do dialog loop e marca o wiring como desacoplado.
     *
     * @returns {void}
     */
    detachDialogLoopListeners() {
        this.dialogLoop.removeAllListeners();
        this.setDialogLoopAttached(false);
    }

    /**
     * Força desativação local do dialog loop.
     *
     * @returns {void}
     */
    forceDeactivateDialogLoop() {
        this.dialogLoop.forceDeactivate();
    }

    /**
     * Pinga o watchdog do dialog loop.
     *
     * @returns {void}
     */
    pingDialogWatchdog() {
        this.dialogLoop.pingWatchdog();
    }

    /**
     * Agenda fallback de modelo dentro do dialog loop.
     *
     * @param {string} model
     * @returns {unknown}
     */
    scheduleDialogFallback(model) {
        return this.dialogLoop.scheduleFallback(model);
    }

    /**
     * Encaminha input de protocolo `ask_user` ao dialog loop.
     *
     * @param {{ question: string }} input
     * @returns {unknown}
     */
    handleDialogProtocolInput(input) {
        return this.dialogLoop.handleProtocolInput(input);
    }

    /**
     * Encaminha warning de orçamento de tokens ao dialog loop.
     *
     * @param {{ currentTokens: number; tokenLimit: number; ratio: number }} event
     * @returns {void}
     */
    handleDialogTokenBudget(event) {
        this.dialogLoop.handleTokenBudget(event);
    }

    /**
     * Limpa a trava de compaction pendente no dialog loop.
     *
     * @returns {void}
     */
    resetDialogCompactionFlag() {
        this.dialogLoop.resetCompactionFlag();
    }

    /**
     * Invalida o cache de mensagens de sessão.
     *
     * @returns {void}
     */
    invalidateMessagesCache() {
        this.messagesCache.invalidate();
    }

    /**
     * Lê mensagens da sessão usando o cache governado pelo contexto.
     *
     * @param {CopilotSession | null} session
     * @returns {Promise<unknown[]>}
     */
    getCachedSessionMessages(session) {
        return this.messagesCache.get(session);
    }

    /**
     * Emite webhook registrado.
     *
     * @param {string} event
     * @param {object} payload
     * @returns {Promise<void>}
     */
    async emitWebhook(event, payload) {
        await Promise.resolve(this.webhooks.emit(event, payload));
    }

    /**
     * Registra webhook sem expor o manager vivo.
     *
     * @param {string} url
     * @returns {{ id: string; url: string }}
     */
    registerWebhook(url) {
        return this.webhooks.register(url);
    }

    /**
     * Remove webhook registrado.
     *
     * @param {string} id
     * @returns {boolean}
     */
    unregisterWebhook(id) {
        return this.webhooks.unregister(id);
    }

    /**
     * Lista webhooks registrados.
     *
     * @returns {{ id: string; url: string }[]}
     */
    listWebhooks() {
        return this.webhooks.list();
    }

    // ─── Status FSM ─────────────────────────────────────────────────────

    /**
     * Transições válidas do FSM de status do agente.
     *
     * Regra: qualquer estado pode transitar para 'stopped' (shutdown é sempre permitido).
     *
     * @type {Readonly<Record<AgentStatus, ReadonlySet<AgentStatus>>>}
     */
    static STATUS_TRANSITIONS = Object.freeze({
        stopped: new Set(/** @type {const} */ (['starting'])),
        starting: new Set(/** @type {const} */ (['idle', 'stopped'])),
        idle: new Set(/** @type {const} */ (['processing', 'stopped'])),
        processing: new Set(/** @type {const} */ (['idle', 'waiting_for_input', 'stopped'])),
        waiting_for_input: new Set(/** @type {const} */ (['processing', 'stopped'])),
    });

    /**
     * Altera o status e invalida o cache de snapshot. Emite evento 'status' no emitter passado. Valida a transição
     * contra o FSM — transições inválidas emitem warning mas NÃO bloqueiam (para não quebrar produção durante
     * rollout).
     *
     * @param {AgentStatus} status
     * @param {StatusEmitterLike} emitter
     */
    setStatus(status, emitter) {
        const allowed = AgentContext.STATUS_TRANSITIONS[this.status];
        if (allowed && !allowed.has(status)) {
            log('WARN', `[AgentContext] Transição de status inválida: ${this.status} → ${status}`);
        }
        this.status = status;
        this.invalidateStatusSnapshot();
        emitter.emit(EMITTER_STATUS, status);
    }
}
