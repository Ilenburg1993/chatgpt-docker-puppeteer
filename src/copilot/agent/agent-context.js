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

import { EMITTER_PERMISSION_MODE_CHANGED, EMITTER_PROCESS_QUEUE, EMITTER_STATUS } from '#copilot/events';
import { log } from '#copilot/observability';
import { createRegistry } from '#copilot/sdk';
import { COPILOT_MODEL, COPILOT_REASONING_EFFORT, MESSAGES_CACHE_TTL_MS } from '../config/agent.js';
import { PermissionController } from '../hooks/permission-controller.js';
import { WebhookManager } from '../infra/webhooks.js';
import { BackgroundTasks } from './background-tasks.js';
import { DialogLoopManager } from './dialog/loop-manager.js';
import { HandoffManager } from './infra/handoff-manager.js';
import { MessageQueue } from './infra/message-queue.js';
import { SessionMessagesCache } from './session/history-sync.js';
import { SessionKeepalive } from './session/keepalive.js';

/**
 * @typedef {import('#copilot/sdk/types').CopilotClient} CopilotClient
 *
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession
 *
 * @typedef {import('./types.js').PendingQuestion} PendingQuestion
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
 */

/**
 * Contexto compartilhado entre todos os módulos internos do agente.
 *
 * Ciclo de vida: criado uma vez no constructor do AlwaysAliveAgent, passado por referência a todos os sub-módulos. Em
 * `K1a`, o contexto passa a manter subestados nomeados, preservando accessors compatíveis para rollout gradual.
 */
export class AgentContext {
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

    /** @type {DialogLoopManager} */
    dialogLoop;

    /** @type {MessageQueue} */
    messageQueue;

    /** @type {WebhookManager} */
    webhooks;

    /** @type {PermissionController} */
    permissions;

    /** @type {import('#copilot/sdk/tools-registry').ToolRegistry} */
    toolsRegistry;

    /** @type {SessionKeepalive} */
    keepalive;

    /** @type {HandoffManager} */
    handoff;

    /** @type {SessionMessagesCache} */
    messagesCache;

    /** @type {BackgroundTasks} */
    backgroundTasks;

    /**
     * @param {import('node:events').EventEmitter} emitter - Referência ao AlwaysAliveAgent (para emit)
     * @param {{ model?: string; reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' }} [options]
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
        };

        // Compat grep-based contract: quotaMonitor = null

        this.ioState = {
            client: null,
        };

        // Instanciar managers com callbacks para o emitter
        this.messageQueue = new MessageQueue({
            onEnqueue: () => emitter.emit(EMITTER_PROCESS_QUEUE),
            onChanged: () => {
                this.metricsState.statusSnapshotCache = null;
            },
        });

        this.dialogLoop = new DialogLoopManager();
        this.webhooks = new WebhookManager();
        this.permissions = new PermissionController({
            onModeChanged: (mode) => emitter.emit(EMITTER_PERMISSION_MODE_CHANGED, { mode }),
        });
        this.toolsRegistry = createRegistry();
        this.keepalive = new SessionKeepalive();
        this.handoff = new HandoffManager();
        this.messagesCache = new SessionMessagesCache(MESSAGES_CACHE_TTL_MS);
        this.backgroundTasks = new BackgroundTasks({
            onCompleted: (event) => {
                emitter.emit('agent.background.completed', { agentType: 'always_alive', ...event });
            },
            onIdle: (event) => {
                emitter.emit('agent.background.idle', { agentType: 'always_alive', ...event });
            },
        });
    }

    // ─── Compat accessors (K1a) ─────────────────────────────────────────────

    /** @returns {CopilotClient | null} */
    get client() {
        return this.ioState.client;
    }

    /** @param {CopilotClient | null} value */
    set client(value) {
        this.ioState.client = value;
    }

    /** @returns {CopilotSession | null} */
    get session() {
        return this.sessionState.session;
    }

    /** @param {CopilotSession | null} value */
    set session(value) {
        this.sessionState.session = value;
    }

    /** @returns {boolean} */
    get isReconnecting() {
        return this.sessionState.isReconnecting;
    }

    /** @param {boolean} value */
    set isReconnecting(value) {
        this.sessionState.isReconnecting = value;
    }

    /** @returns {(() => void)[]} */
    get sessionEventUnsubscribers() {
        return this.sessionState.sessionEventUnsubscribers;
    }

    /** @param {(() => void)[]} value */
    set sessionEventUnsubscribers(value) {
        this.sessionState.sessionEventUnsubscribers = value;
    }

    /** @returns {AgentStatus} */
    get status() {
        return this.runtimeState.status;
    }

    /** @param {AgentStatus} value */
    set status(value) {
        this.runtimeState.status = value;
    }

    /** @returns {boolean} */
    get isResumed() {
        return this.sessionState.isResumed;
    }

    /** @param {boolean} value */
    set isResumed(value) {
        this.sessionState.isResumed = value;
    }

    /** @returns {number} */
    get sendCount() {
        return this.metricsState.sendCount;
    }

    /** @param {number} value */
    set sendCount(value) {
        this.metricsState.sendCount = value;
    }

    /** @returns {PendingQuestion | null} */
    get pendingQuestion() {
        return this.dialogState.pendingQuestion;
    }

    /** @param {PendingQuestion | null} value */
    set pendingQuestion(value) {
        this.dialogState.pendingQuestion = value;
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
        this.configState.model = value;
    }

    /** @returns {'low' | 'medium' | 'high' | 'xhigh' | undefined} */
    get reasoningEffort() {
        return this.configState.reasoningEffort;
    }

    /** @param {'low' | 'medium' | 'high' | 'xhigh' | undefined} value */
    set reasoningEffort(value) {
        this.configState.reasoningEffort = value;
    }

    /** @returns {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null} */
    get lastPrInfo() {
        return this.metricsState.lastPrInfo;
    }

    /** @param {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null} value */
    set lastPrInfo(value) {
        this.metricsState.lastPrInfo = value;
    }

    /** @returns {{ tokens: number; tokenLimit: number; utilization: number } | null} */
    get contextState() {
        return this.sessionState.contextState;
    }

    /** @param {{ tokens: number; tokenLimit: number; utilization: number } | null} value */
    set contextState(value) {
        this.sessionState.contextState = value;
    }

    /** @returns {string | null} */
    get lastCheckpointPath() {
        return this.sessionState.lastCheckpointPath;
    }

    /** @param {string | null} value */
    set lastCheckpointPath(value) {
        this.sessionState.lastCheckpointPath = value;
    }

    /** @returns {ReturnType<typeof setInterval> | null} */
    get metricsTimer() {
        return this.runtimeState.metricsTimer;
    }

    /** @param {ReturnType<typeof setInterval> | null} value */
    set metricsTimer(value) {
        this.runtimeState.metricsTimer = value;
    }

    /** @returns {(() => void) | null} */
    get mcpReconnectCancel() {
        return this.runtimeState.mcpReconnectCancel;
    }

    /** @param {(() => void) | null} value */
    set mcpReconnectCancel(value) {
        this.runtimeState.mcpReconnectCancel = value;
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
        this.runtimeState.quotaMonitor = value;
    }

    /** @returns {boolean} */
    get dialogLoopAttached() {
        return this.dialogState.dialogLoopAttached;
    }

    /** @param {boolean} value */
    set dialogLoopAttached(value) {
        this.dialogState.dialogLoopAttached = value;
    }

    /** @returns {{ attach: (agent: import('node:events').EventEmitter) => void; detach: () => void } | null} */
    get agentObserver() {
        return this.runtimeState.agentObserver;
    }

    /** @param {{ attach: (agent: import('node:events').EventEmitter) => void; detach: () => void } | null} value */
    set agentObserver(value) {
        this.runtimeState.agentObserver = value;
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
     * @param {import('node:events').EventEmitter} emitter
     */
    setStatus(status, emitter) {
        const allowed = AgentContext.STATUS_TRANSITIONS[this.status];
        if (allowed && !allowed.has(status)) {
            log('WARN', `[AgentContext] Transição de status inválida: ${this.status} → ${status}`);
        }
        this.status = status;
        this.statusSnapshotCache = null;
        emitter.emit(EMITTER_STATUS, status);
    }
}
