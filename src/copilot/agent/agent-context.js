// @ts-check
/**
 * src/copilot/agent/agent-context.js
 *
 * Composition root do contexto compartilhado do agent. O estado vivo e os managers permanecem nesta classe por
 * compatibilidade; regras de sessão, runtime, métricas, dialog, tools e FSM vivem em módulos coesos de `context/`.
 *
 * @module copilot/agent/agent-context
 * @internal
 */

import { COPILOT_MODEL, COPILOT_REASONING_EFFORT } from '#copilot/config/agent';
import { EMITTER_PROCESS_QUEUE } from '#copilot/events';
import { createAgentContextFactories } from './context/factories/index.js';
import { dialogOps, fsmOps, metricsOps, runtimeOps, sessionOps, toolOps } from './context/ops/index.js';
import { performKeepaliveSdkTick } from './facades/agent-session-ops.js';
import { createToolSessionContext } from './ports/tool-port.js';

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

export class AgentContext {
    /** @type {Readonly<Record<AgentStatus, ReadonlySet<AgentStatus>>>} */
    static STATUS_TRANSITIONS = fsmOps.STATUS_TRANSITIONS;

    /** @type {import('./context/factories/index.js').AgentContextFactories} */
    #factories;

    /** @type {import('./context/factories/index.js').AgentContextFactoryHost} */
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

    /** @type {import('./dialog/orchestrators/loop-manager.js').DialogLoopManager} */
    dialogLoop;
    /** @type {import('./infra/message-queue.js').MessageQueue} */
    messageQueue;
    /** @type {import('../infra/webhooks.js').WebhookManager} */
    webhooks;
    /** @type {import('./ports/index.js').AgentPermissionController} */
    permissions;
    /** @type {import('#copilot/sdk/types').ToolSessionContext} */
    toolSessionContext;
    /** @type {import('#copilot/sdk/types').ToolRegistry} */
    toolsRegistry;
    /** @type {import('./session/lifecycle/keepalive.js').SessionKeepalive} */
    keepalive;
    /** @type {import('./infra/handoff-manager.js').HandoffManager} */
    handoff;
    /** @type {import('./session/history/history-sync.js').SessionMessagesCache} */
    messagesCache;
    /** @type {import('#copilot/sdk/types').QueuedElicitationHandler} */
    sdkElicitation;
    /** @type {import('./background/index.js').BackgroundTasks} */
    backgroundTasks;

    /**
     * @param {import('node:events').EventEmitter} emitter
     * @param {{
     *     model?: string;
     *     reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
     *     factories?: Partial<import('./context/factories/index.js').AgentContextFactories>;
     *     mcpBridge?: import('./ports/index.js').AgentMcpCapability | null;
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
        this.dialogState = { pendingQuestion: null, pendingQuestionShadow: null, dialogLoopAttached: false };
        this.configState = {
            model: options.model ?? COPILOT_MODEL,
            reasoningEffort:
                /** @type {'low' | 'medium' | 'high' | 'xhigh' | undefined} */
                (options.reasoningEffort ?? (COPILOT_REASONING_EFFORT || undefined)),
            mcpBridge: options.mcpBridge ?? null,
        };
        this.metricsState = { sendCount: 0, statusSnapshotCache: null, lastPrInfo: null, lastLlmUsage: null };
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
        this.ioState = { client: null };

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
        this.toolSessionContext = createToolSessionContext();
        this.keepalive = this.#factories.createKeepalive(this.#factoryHost);
        this.handoff = this.#factories.createHandoff(this.#factoryHost);
        this.messagesCache = this.#factories.createMessagesCache(this.#factoryHost);
        this.sdkElicitation = this.#factories.createSdkElicitation(this.#factoryHost);
        this.backgroundTasks = this.#factories.createBackgroundTasks(this.#factoryHost);
    }

    get client() {
        return this.ioState.client;
    }
    /** @param {CopilotClient | null | undefined} value */
    set client(value) {
        if (value == null) this.clearClient();
        else this.setClient(value);
    }
    get session() {
        return this.sessionState.session;
    }
    /** @param {CopilotSession | null | undefined} value */
    set session(value) {
        if (value == null) this.clearSession();
        else this.setSession(value);
    }
    get isReconnecting() {
        return this.sessionState.isReconnecting;
    }
    /** @param {boolean} value */
    set isReconnecting(value) {
        this.setReconnectState(value);
    }
    get sessionEventUnsubscribers() {
        return this.sessionState.sessionEventUnsubscribers;
    }
    /** @param {(() => void)[]} value */
    set sessionEventUnsubscribers(value) {
        this.setSessionEventUnsubscribers(value);
    }
    get status() {
        return this.runtimeState.status;
    }
    /** @param {AgentStatus} value */
    set status(value) {
        this.setRuntimeStatus(value);
    }
    get isResumed() {
        return this.sessionState.isResumed;
    }
    /** @param {boolean} value */
    set isResumed(value) {
        this.setIsResumed(value);
    }
    get sendCount() {
        return this.metricsState.sendCount;
    }
    /** @param {number} value */
    set sendCount(value) {
        this.setSendCount(value);
    }
    get pendingQuestion() {
        return this.dialogState.pendingQuestion;
    }
    /** @param {PendingQuestion | null | undefined} value */
    set pendingQuestion(value) {
        if (value == null) this.clearPendingQuestion();
        else this.setPendingQuestion(value);
    }
    get statusSnapshotCache() {
        return this.metricsState.statusSnapshotCache;
    }
    /** @param {{ snapshot: import('./types.js').AgentStatusSnapshot; at: number } | null} value */
    set statusSnapshotCache(value) {
        this.metricsState.statusSnapshotCache = value;
    }
    get model() {
        return this.configState.model;
    }
    /** @param {string} value */
    set model(value) {
        this.setModel(value);
    }
    get reasoningEffort() {
        return this.configState.reasoningEffort;
    }
    /** @param {'low' | 'medium' | 'high' | 'xhigh' | undefined} value */
    set reasoningEffort(value) {
        this.setReasoningEffort(value);
    }
    get lastPrInfo() {
        return this.metricsState.lastPrInfo;
    }
    /** @param {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null} value */
    set lastPrInfo(value) {
        this.setLastPrInfo(value);
    }
    get lastLlmUsage() {
        return this.metricsState.lastLlmUsage;
    }
    /** @param {Record<string, unknown> | null} value */
    set lastLlmUsage(value) {
        this.setLastLlmUsage(value);
    }
    get contextState() {
        return this.sessionState.contextState;
    }
    /** @param {{ tokens: number; tokenLimit: number; utilization: number } | null} value */
    set contextState(value) {
        this.setContextState(value);
    }
    get lastCheckpointPath() {
        return this.sessionState.lastCheckpointPath;
    }
    /** @param {string | null} value */
    set lastCheckpointPath(value) {
        this.setLastCheckpointPath(value);
    }
    get metricsTimer() {
        return this.runtimeState.metricsTimer;
    }
    /** @param {ReturnType<typeof setInterval> | null | undefined} value */
    set metricsTimer(value) {
        if (value == null) this.clearMetricsTimer();
        else this.setMetricsTimer(value);
    }
    get mcpReconnectCancel() {
        return this.runtimeState.mcpReconnectCancel;
    }
    /** @param {(() => void) | null | undefined} value */
    set mcpReconnectCancel(value) {
        if (value == null) this.clearMcpReconnectCancel();
        else this.setMcpReconnectCancel(value);
    }
    get mcpBridge() {
        return this.configState.mcpBridge;
    }
    /** @param {import('./ports/index.js').AgentMcpCapability | null} value */
    set mcpBridge(value) {
        this.configState.mcpBridge = value;
    }
    get quotaMonitor() {
        return this.runtimeState.quotaMonitor;
    }
    /** @param {import('#copilot/sdk/types').QuotaMonitor | null | undefined} value */
    set quotaMonitor(value) {
        if (value == null) this.clearQuotaMonitor();
        else this.setQuotaMonitor(value);
    }
    get dialogLoopAttached() {
        return this.dialogState.dialogLoopAttached;
    }
    /** @param {boolean} value */
    set dialogLoopAttached(value) {
        this.setDialogLoopAttached(value);
    }
    get agentObserver() {
        return this.runtimeState.agentObserver;
    }
    /**
     * @param {{ attach: (agent: import('node:events').EventEmitter) => void; detach: () => void } | null | undefined} value
     */
    set agentObserver(value) {
        if (value == null) this.clearAgentObserver();
        else this.setAgentObserver(value);
    }
    get bootReport() {
        return this.runtimeState.lastBootReport;
    }
    /** @param {AgentBootReport | null} value */
    set bootReport(value) {
        this.setBootReport(value);
    }

    /** @param {AgentStatus} status */
    setRuntimeStatus(status) {
        fsmOps.setRuntimeStatus(this, status);
    }
    getRuntimeStatus() {
        return fsmOps.getRuntimeStatus(this);
    }
    /** @param {AgentStatus} status */
    isStatus(status) {
        return fsmOps.isStatus(this, status);
    }
    isStopped() {
        return fsmOps.isStopped(this);
    }
    isStarting() {
        return fsmOps.isStarting(this);
    }
    isIdle() {
        return fsmOps.isIdle(this);
    }
    isProcessing() {
        return fsmOps.isProcessing(this);
    }
    isWaitingForInput() {
        return fsmOps.isWaitingForInput(this);
    }
    /** @param {AgentStatus} status @param {StatusEmitterLike} emitter */
    setStatus(status, emitter) {
        fsmOps.applyStatusTransition(this, status, emitter);
    }

    getModelSnapshot() {
        return this.configState.model;
    }
    getReasoningEffortSnapshot() {
        return this.configState.reasoningEffort;
    }
    /** @param {string} model */
    setModel(model) {
        this.configState.model = model;
        this.invalidateStatusSnapshot();
    }
    /** @param {'low' | 'medium' | 'high' | 'xhigh' | undefined} reasoningEffort */
    setReasoningEffort(reasoningEffort) {
        this.configState.reasoningEffort = reasoningEffort;
        this.invalidateStatusSnapshot();
    }
    getMcpBridgeSnapshot() {
        return this.configState.mcpBridge;
    }

    getIsResumedSnapshot() {
        return sessionOps.getIsResumedSnapshot(this);
    }
    /** @param {boolean} isResumed */
    setIsResumed(isResumed) {
        sessionOps.setIsResumed(this, isResumed);
    }
    isReconnectActive() {
        return sessionOps.isReconnectActive(this);
    }
    /** @param {boolean} isReconnecting */
    setReconnectState(isReconnecting) {
        sessionOps.setReconnectState(this, isReconnecting);
    }
    /** @param {(() => void)[]} unsubs */
    setSessionEventUnsubscribers(unsubs) {
        sessionOps.setSessionEventUnsubscribers(this, unsubs);
    }
    clearSessionEventUnsubscribers() {
        sessionOps.clearSessionEventUnsubscribers(this);
    }
    getSessionEventUnsubscribersSnapshot() {
        return sessionOps.getSessionEventUnsubscribersSnapshot(this);
    }
    /** @param {CopilotClient} client */
    setClient(client) {
        sessionOps.setClient(this, client);
    }
    clearClient() {
        sessionOps.clearClient(this);
    }
    hasClient() {
        return sessionOps.hasClient(this);
    }
    getClientSnapshot() {
        return sessionOps.getClientSnapshot(this);
    }
    /** @param {CopilotSession} session */
    setSession(session) {
        sessionOps.setSession(this, session);
    }
    clearSession() {
        sessionOps.clearSession(this);
    }
    hasActiveSession() {
        return sessionOps.hasActiveSession(this);
    }
    getSessionSnapshot() {
        return sessionOps.getSessionSnapshot(this);
    }
    /** @param {{ tokens: number; tokenLimit: number; utilization: number } | null} state */
    setContextState(state) {
        sessionOps.setContextState(this, state);
    }
    getContextStateSnapshot() {
        return sessionOps.getContextStateSnapshot(this);
    }
    /** @param {string | null} path */
    setLastCheckpointPath(path) {
        sessionOps.setLastCheckpointPath(this, path);
    }
    getLastCheckpointPathSnapshot() {
        return sessionOps.getLastCheckpointPathSnapshot(this);
    }

    /** @param {number} sendCount */
    setSendCount(sendCount) {
        metricsOps.setSendCount(this, sendCount);
    }
    getSendCountSnapshot() {
        return metricsOps.getSendCountSnapshot(this);
    }
    incrementSendCount() {
        return metricsOps.incrementSendCount(this);
    }
    /** @param {import('./types.js').AgentStatusSnapshot} snapshot */
    cacheStatusSnapshot(snapshot) {
        metricsOps.cacheStatusSnapshot(this, snapshot);
    }
    invalidateStatusSnapshot() {
        metricsOps.invalidateStatusSnapshot(this);
    }
    /** @param {number} ttlMs */
    getFreshStatusSnapshotCache(ttlMs) {
        return metricsOps.getFreshStatusSnapshotCache(this, ttlMs);
    }
    /**
     * @param {{
     *     model?: string;
     *     configuredModel?: string;
     *     effectiveModel?: string;
     *     modelMismatch?: boolean;
     *     sessionId?: string | null;
     *     cost?: number;
     *     quotaSnapshots?: Record<string, unknown>;
     *     ts: number;
     * } | null} info
     */
    setLastPrInfo(info) {
        metricsOps.setLastPrInfo(this, info);
    }
    getLastPrInfoSnapshot() {
        return metricsOps.getLastPrInfoSnapshot(this);
    }
    /** @param {Record<string, unknown> | null} info */
    setLastLlmUsage(info) {
        metricsOps.setLastLlmUsage(this, info);
    }
    getLastLlmUsageSnapshot() {
        return metricsOps.getLastLlmUsageSnapshot(this);
    }

    /** @param {ReturnType<typeof setInterval>} timer */
    setMetricsTimer(timer) {
        runtimeOps.setMetricsTimer(this, timer);
    }
    clearMetricsTimer() {
        runtimeOps.clearMetricsTimer(this);
    }
    getMetricsTimerSnapshot() {
        return runtimeOps.getMetricsTimerSnapshot(this);
    }
    /** @param {() => void} cancel */
    setMcpReconnectCancel(cancel) {
        runtimeOps.setMcpReconnectCancel(this, cancel);
    }
    clearMcpReconnectCancel() {
        runtimeOps.clearMcpReconnectCancel(this);
    }
    getMcpReconnectCancelSnapshot() {
        return runtimeOps.getMcpReconnectCancelSnapshot(this);
    }
    /** @param {{ attach: (agent: import('node:events').EventEmitter) => void; detach: () => void }} observer */
    setAgentObserver(observer) {
        runtimeOps.setAgentObserver(this, observer);
    }
    clearAgentObserver() {
        runtimeOps.clearAgentObserver(this);
    }
    getAgentObserverSnapshot() {
        return runtimeOps.getAgentObserverSnapshot(this);
    }
    /** @param {import('#copilot/sdk/types').QuotaMonitor} quotaMonitor */
    setQuotaMonitor(quotaMonitor) {
        runtimeOps.setQuotaMonitor(this, quotaMonitor);
    }
    clearQuotaMonitor() {
        runtimeOps.clearQuotaMonitor(this);
    }
    stopQuotaMonitor() {
        runtimeOps.stopQuotaMonitor(this);
    }
    getQuotaMonitorSnapshot() {
        return runtimeOps.getQuotaMonitorSnapshot(this);
    }
    /** @param {AgentBootReport | null} report */
    setBootReport(report) {
        runtimeOps.setBootReport(this, report);
    }
    getBootReportSnapshot() {
        return runtimeOps.getBootReportSnapshot(this);
    }
    /** @param {AgentStartReport | null} report */
    setStartReport(report) {
        runtimeOps.setStartReport(this, report);
    }
    getStartReportSnapshot() {
        return runtimeOps.getStartReportSnapshot(this);
    }

    /** @param {boolean} attached */
    setDialogLoopAttached(attached) {
        dialogOps.setDialogLoopAttached(this, attached);
    }
    getDialogLoopAttachedSnapshot() {
        return dialogOps.getDialogLoopAttachedSnapshot(this);
    }
    /** @param {PendingQuestion | null} question */
    setPendingQuestion(question) {
        if (question == null) this.clearPendingQuestion();
        else dialogOps.setPendingQuestion(this, question);
    }
    clearPendingQuestion() {
        dialogOps.clearPendingQuestion(this);
    }
    /** @param {string} answer */
    resolvePendingQuestion(answer) {
        return dialogOps.resolvePendingQuestion(this, answer);
    }
    hasPendingQuestion() {
        return dialogOps.hasPendingQuestion(this);
    }
    getPendingQuestionForStatusSnapshot() {
        return dialogOps.getPendingQuestionForStatusSnapshot(this);
    }
    getPendingQuestionSnapshot() {
        return dialogOps.getPendingQuestionSnapshot(this);
    }
    getPendingQuestionKind() {
        return dialogOps.getPendingQuestionKind(this);
    }
    /** @param {import('./types.js').PendingQuestionShadow | null} shadow */
    setPendingQuestionShadow(shadow) {
        dialogOps.setPendingQuestionShadow(this, shadow);
    }
    clearPendingQuestionShadow() {
        dialogOps.clearPendingQuestionShadow(this);
    }
    hasPendingQuestionShadow() {
        return dialogOps.hasPendingQuestionShadow(this);
    }
    getPendingQuestionShadowKind() {
        return dialogOps.getPendingQuestionShadowKind(this);
    }
    getPendingQuestionShadowSnapshot() {
        return dialogOps.getPendingQuestionShadowSnapshot(this);
    }
    /** @param {number} [now] */
    getPendingQuestionShadowAgeMs(now = Date.now()) {
        return dialogOps.getPendingQuestionShadowAgeMs(this, now);
    }
    getPendingQuestionShadowExpiresAt() {
        return dialogOps.getPendingQuestionShadowExpiresAt(this);
    }
    /** @param {number} [now] */
    getPendingQuestionShadowRemainingMs(now = Date.now()) {
        return dialogOps.getPendingQuestionShadowRemainingMs(this, now);
    }
    /** @param {number} [now] */
    getPendingQuestionShadowState(now = Date.now()) {
        return dialogOps.getPendingQuestionShadowState(this, now);
    }
    /** @param {number} [now] */
    isPendingQuestionShadowExpired(now = Date.now()) {
        return dialogOps.isPendingQuestionShadowExpired(this, now);
    }
    getSdkElicitationHandlerSnapshot() {
        return dialogOps.getSdkElicitationHandlerSnapshot(this);
    }
    /** @param {{ sessionId?: string }} [opts] */
    listPendingSdkElicitations(opts = {}) {
        return dialogOps.listPendingSdkElicitations(this, opts);
    }
    /** @param {string} id */
    getPendingSdkElicitation(id) {
        return dialogOps.getPendingSdkElicitation(this, id);
    }
    /** @param {string} id @param {import('#copilot/sdk/types').ElicitationResult} result */
    resolvePendingSdkElicitation(id, result) {
        return dialogOps.resolvePendingSdkElicitation(this, id, result);
    }
    /** @param {string} id */
    clearPendingSdkElicitation(id) {
        return dialogOps.clearPendingSdkElicitation(this, id);
    }

    /**
     * Retorna o snapshot do registry de tools registradas no runtime.
     *
     * @returns {import('#copilot/sdk/types').ToolRegistry}
     */
    getToolRegistrySnapshot() {
        return toolOps.getToolRegistrySnapshot(this);
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
        return toolOps.getToolRegistryEntriesSnapshot(this);
    }
    getPermissionModeSnapshot() {
        return toolOps.getPermissionModeSnapshot(this);
    }
    /**
     * @param {'approve_all' | 'audit_only' | 'selective'} mode @param {{ allowTools?: string[]; denyTools?: string[];
     *   denyShell?: boolean }} [opts]
     */
    setPermissionMode(mode, opts = {}) {
        toolOps.setPermissionMode(this, mode, opts);
    }
    getPermissionHandlerSnapshot() {
        return toolOps.getPermissionHandlerSnapshot(this);
    }
    getPermissionPolicySnapshot() {
        return toolOps.getPermissionPolicySnapshot(this);
    }
    /**
     * Retorna readiness e metadata da capability de permissões governada pelo agent.
     *
     * @returns {{ mode: 'approve_all' | 'audit_only' | 'selective'; handlerAvailable: boolean }}
     */
    getPermissionCapabilitySnapshot() {
        const factorySet = this.getContextFactoryCapabilitiesSnapshot();
        const metadata = {
            ...this.#factories.describePermissionsCapability(this.#factoryHost),
            ...(factorySet['governance.permissions'] ?? {}),
        };
        const handler = this.getPermissionHandlerSnapshot();
        return { ...metadata, mode: this.getPermissionModeSnapshot(), handlerAvailable: typeof handler === 'function' };
    }
    getContextFactoryCapabilitiesSnapshot() {
        const metadata = this.#factories.describeFactorySet(this.#factoryHost);
        return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, { ...value }]));
    }
    resetToolsRegistry() {
        this.toolsRegistry = this.#factories.createToolsRegistry(this.#factoryHost);
        return this.toolsRegistry;
    }

    getQueueSnapshot() {
        const oldest = this.messageQueue.oldest;
        return {
            size: this.messageQueue.size,
            oldest: oldest ? { id: oldest.id, enqueuedAt: oldest.enqueuedAt } : undefined,
        };
    }
    hasQueuedMessages() {
        return this.messageQueue.size > 0;
    }
    /** @param {AgentTask} task @param {{ signal?: AbortSignal }} [options] */
    enqueueMessageTask(task, options = {}) {
        this.messageQueue.enqueue(task, ...(options.signal ? [{ signal: options.signal }] : []));
    }
    shiftMessageTask() {
        return this.messageQueue.shift();
    }
    /** @param {AgentTask} task */
    unshiftMessageTask(task) {
        this.messageQueue.unshift(task);
    }
    /** @param {Error} error */
    drainMessageQueue(error) {
        return this.messageQueue.drain(error);
    }
    /** @param {Promise<unknown>} task @param {{ label?: string; description?: string }} [meta] */
    trackBackgroundTask(task, meta) {
        return this.backgroundTasks.track(task, meta);
    }
    /** @param {number} timeoutMs */
    drainBackgroundTasks(timeoutMs) {
        return this.backgroundTasks.drain(timeoutMs);
    }
    /** @param {number} [limit] */
    getBackgroundPendingLabels(limit = 5) {
        return this.backgroundTasks.getPendingLabels?.(limit) ?? [];
    }
    getBackgroundPendingCount() {
        return this.backgroundTasks.pendingCount;
    }

    isDialogLoopActive() {
        return Boolean(this.dialogLoop.active);
    }
    isDialogLoopPaused() {
        return Boolean(this.dialogLoop.paused);
    }
    getDialogUsageMetricsSnapshot() {
        return this.dialogLoop?.usageMetrics ?? null;
    }

    /** @deprecated Use getDialogUsageMetricsSnapshot(). */
    getDialogPrMetricsSnapshot() {
        return this.getDialogUsageMetricsSnapshot();
    }
    getDialogLoopManagerSnapshot() {
        return this.dialogLoop;
    }
    getDialogTurnQueueDepth() {
        const depth = this.dialogLoop?.queueDepth;
        return typeof depth === 'number' && Number.isFinite(depth) ? depth : 0;
    }
    /** @param {import('./types.js').DialogLoopHost} host */
    attachDialogLoop(host) {
        this.dialogLoop.attach(host);
    }
    /** @param {string} [bootPrompt] @param {{ resumeSessionAttach?: boolean }} [opts] */
    startDialogLoop(bootPrompt, opts = {}) {
        if (opts.resumeSessionAttach === true) {
            return this.dialogLoop.startResumedSession();
        }
        return this.dialogLoop.start(bootPrompt);
    }
    /** @param {string} message @param {{ timeout?: number | null; signal?: AbortSignal; traceId?: string }} [opts] */
    sendDialogTurn(message, opts) {
        return this.dialogLoop.sendTurn(message, opts);
    }
    /** @param {string} message @param {{ timeout?: number | null; signal?: AbortSignal; traceId?: string }} [opts] */
    sendDialogTurnDetailed(message, opts) {
        return this.dialogLoop.sendTurnDetailed(message, opts);
    }
    /**
     * @param {{
     *     authorized?: boolean;
     *     reason?: 'watchdog_restart' | 'authorized_stop' | 'recovery_restart';
     *     shutdownTimeoutMs?: number;
     * }} [opts]
     */
    stopDialogLoop(opts) {
        return this.dialogLoop.stop(opts);
    }
    /** @param {string | null} sessionId */
    pauseDialogLoop(sessionId) {
        return this.dialogLoop.pause(sessionId);
    }
    resumeDialogLoop() {
        return this.dialogLoop.resume();
    }
    detachDialogLoopListeners() {
        this.dialogLoop.removeAllListeners();
        this.setDialogLoopAttached(false);
    }
    forceDeactivateDialogLoop() {
        this.dialogLoop.forceDeactivate();
    }
    pingDialogWatchdog() {
        this.dialogLoop.pingWatchdog();
    }
    /** @param {string} model */
    scheduleDialogFallback(model) {
        return this.dialogLoop.scheduleFallback(model);
    }
    /** @param {{ question: string }} input */
    handleDialogProtocolInput(input) {
        return this.dialogLoop.handleProtocolInput(input);
    }
    /** @param {{ currentTokens: number; tokenLimit: number; ratio: number }} event */
    handleDialogTokenBudget(event) {
        this.dialogLoop.handleTokenBudget(event);
    }
    resetDialogCompactionFlag() {
        this.dialogLoop.resetCompactionFlag();
    }

    isKeepaliveRunning() {
        return Boolean(this.keepalive.running);
    }
    getKeepaliveManagerSnapshot() {
        return this.keepalive;
    }
    pingKeepalive() {
        this.keepalive.ping();
    }
    /**
     * @param {{
     *     isIdle?: () => boolean;
     *     onKeepalive?: (info: { ts: number; strategy: 'client.ping' | 'session.send' }) => void;
     * }} [options]
     */
    startKeepalive(options = {}) {
        if (this.isStopped() || !this.hasActiveSession()) return false;
        this.keepalive.start({
            performKeepalive: () => performKeepaliveSdkTick(this),
            isIdle: options.isIdle ?? (() => this.isIdle()),
            isDialogLoopActive: () => this.isDialogLoopActive(),
            ...(options.onKeepalive !== undefined ? { onKeepalive: options.onKeepalive } : {}),
        });
        return true;
    }
    /** @param {string} [reason] */
    stopKeepalive(reason = 'manual') {
        this.keepalive.stop(reason);
    }

    getHandoffManagerSnapshot() {
        return this.handoff;
    }
    /** @param {{ fromAgent: string; toAgent: string; reason?: string; context?: Record<string, unknown> }} event */
    receiveHandoff(event) {
        this.handoff.receive(event);
    }
    invalidateMessagesCache() {
        this.messagesCache.invalidate();
    }
    /** @param {CopilotSession | null} session */
    getCachedSessionMessages(session) {
        return this.messagesCache.get(session);
    }
    /** @param {string} event @param {object} payload */
    async emitWebhook(event, payload) {
        await Promise.resolve(this.webhooks.emit(event, payload));
    }
    /** @param {string} url */
    registerWebhook(url) {
        return this.webhooks.register(url);
    }
    /** @param {string} id */
    unregisterWebhook(id) {
        return this.webhooks.unregister(id);
    }
    listWebhooks() {
        return this.webhooks.list();
    }
}
