// @ts-check
/**
 * @module copilot/server/routes/sdk/deps
 * @file Wiring do adapter HTTP do SDK.
 *
 *   Rotas em `server/routes/sdk/*` adaptam capacidades de domínio para HTTP. Este arquivo é o composition root autorizado
 *   desse adapter: SDK client/session, runtime agent, projections, hooks, observability e fallbacks estáticos entram
 *   aqui e chegam aos handlers como capacidades explícitas.
 */

import { defaultAuditLog, getAuditTail } from '#copilot/audit';
import { getMcpStatus, nervEventBusAdapter } from '#copilot/bridges';
import {
    BRIDGE_ADMIN_TOKEN,
    LLM_B_TURN_TIMEOUT_MS,
    OTEL_EXPORTER_OTLP_ENDPOINT,
    readSystemPromptStatus,
    SDK_API_TOKEN,
} from '#copilot/config';
import { container } from '#copilot/core';
import { defaultBus, SDK_HOOKS } from '#copilot/hooks';
import {
    DEFAULT_OTEL_FILE,
    defaultConvergenceTraceStore,
    defaultErrorTracker,
    defaultMetrics,
    getCatalog,
    getCompactionHistory,
    getDeadLetters,
    getLastQuotaSnapshots,
    getRecentLogs,
    isOtelEnabled,
    log,
    METRICS_STORE,
} from '#copilot/observability';
import {
    approveAll,
    commandsHandlePending,
    compactionCompact,
    createClientSession,
    disconnectClientSession,
    emitSdkOperationMetric,
    forceStopClient,
    getClient,
    getClientSession,
    getClientState,
    getForegroundClientSessionId,
    getLastClientSessionId,
    getSessionCapabilities,
    incrementSessionMessageCount,
    isSessionUiElicitationAvailable,
    listActiveClientSessions,
    listAllClientSessions,
    onAllSessionEvents,
    permissionsHandlePending,
    pickDefined,
    resumeClientSession,
    sessionUiConfirm,
    sessionUiElicitation,
    sessionUiInput,
    sessionUiSelect,
    setForegroundClientSessionId,
    shellExec,
    shellKill,
    stopClient,
    toolsHandlePendingCall,
    toolsList,
    uiElicitation,
    validateProviderConfig,
    workspaceCreateFile,
    workspaceListFiles,
    workspaceReadFile,
} from '#copilot/sdk';
import { getAllTools } from '#copilot/tools';
import { requireAgentRuntimeSelection } from '../../../presentation/agent-runtime.js';
import { resolveOptionalDialogTimeout } from '../../../presentation/dialog-timeout-policy.js';
import { buildRuntimeRouteMetaPayload } from '../../../presentation/runtime-meta.js';
import { setRuntimeModelProjection, setRuntimeReasoningProjection } from '../../../presentation/runtime-models.js';
import { resolveRequestedRuntimeId } from '../../../presentation/runtime-request.js';
import * as runtimeSdkSessionOps from '../../../presentation/runtime-sdk-session.js';
import {
    readAgentStatusSnapshot,
    readAgentStatusSnapshotForRuntime,
    readAgentStatusValue,
    readAgentStatusValueForRuntime,
} from '../../../presentation/runtime-status.js';
import {
    paginateAgentRuntimeToolsProjection,
    readAgentRuntimeToolsProjection,
    readAgentRuntimeToolsProjectionForRuntime,
} from '../../../presentation/runtime-tools.js';
import {
    attachSdkSessionOwnership,
    clearSdkRuntimeBinding,
    forgetSdkSessionOwnership,
    rememberSdkSessionOwnership,
    resolveSdkRuntimeProjection,
    resolveSdkRuntimeProjectionForRuntime,
    resolveSdkSessionRouteMeta,
} from '../../../presentation/sdk-sessions.js';

const sdkSessionOps = Object.freeze({
    approveAll,
    createClientSession,
    disconnectClientSession,
    getClient,
    getClientSession,
    getForegroundClientSessionId,
    getLastClientSessionId,
    incrementSessionMessageCount,
    listActiveClientSessions,
    listAllClientSessions,
    pickDefined,
    resumeClientSession,
    setForegroundClientSessionId,
    validateProviderConfig,
});

const sdkSessionRpcOps = Object.freeze({
    commandsHandlePending,
    compactionCompact,
    permissionsHandlePending,
    shellExec,
    shellKill,
    toolsHandlePendingCall,
    toolsList,
    uiElicitation,
    workspaceCreateFile,
    workspaceListFiles,
    workspaceReadFile,
});

const sdkSessionEventOps = Object.freeze({
    onAllSessionEvents,
});

const sdkSessionUiOps = Object.freeze({
    getSessionCapabilities,
    isSessionUiElicitationAvailable,
    sessionUiConfirm,
    sessionUiElicitation,
    sessionUiInput,
    sessionUiSelect,
});

const runtimeSdkSessionNamespace = { ...runtimeSdkSessionOps };

const sdkRuntimeSessionOps = Object.freeze({
    resolveAgentSdkActiveSessionEntry: runtimeSdkSessionNamespace.resolveAgentSdkActiveSessionEntry,
});

const sdkSystemPromptOps = Object.freeze({
    readAgentSdkSystemPromptProjection:
        runtimeSdkSessionNamespace.readAgentSdkSystemPromptProjection ??
        (async () => {
            const status = await readSystemPromptStatus();
            return {
                systemPrompt: status,
                binding: null,
                freshness: null,
                sessionId: null,
                sessionAvailable: false,
                instructionSources: null,
                instructionSourcesError: 'readAgentSdkSystemPromptProjection unavailable',
                projection: {
                    status,
                    sdkCompatibility:
                        status?.sdkCompatibility && typeof status.sdkCompatibility === 'object'
                            ? status.sdkCompatibility
                            : null,
                    binding: null,
                    freshness: null,
                    session: { id: null, available: false },
                    instructionSources: {
                        value: null,
                        error: 'readAgentSdkSystemPromptProjection unavailable',
                        available: false,
                    },
                    revision: { digest: null },
                    ownership: {
                        policyOwner: 'config/system-prompt',
                        rpcOwner: 'sdk/rpc',
                        projectionOwner: 'presentation/runtime-sdk-session',
                    },
                },
            };
        }),
    readSystemPromptStatus,
});

const sdkSessionOwnershipOps = Object.freeze({
    attachSdkSessionOwnership,
    clearSdkRuntimeBinding,
    forgetSdkSessionOwnership,
    rememberSdkSessionOwnership,
    resolveSdkRuntimeProjection,
    resolveSdkRuntimeProjectionForRuntime,
    resolveSdkSessionRouteMeta,
});

const sdkRuntimeProjectionOps = Object.freeze({
    buildRuntimeRouteMetaPayload,
    paginateAgentRuntimeToolsProjection,
    readAgentRuntimeToolsProjection,
    readAgentRuntimeToolsProjectionForRuntime,
    readAgentStatusSnapshot,
    readAgentStatusSnapshotForRuntime,
    readAgentStatusValue,
    readAgentStatusValueForRuntime,
    setRuntimeModelProjection,
    setRuntimeReasoningProjection,
});

const sdkObservabilityOps = Object.freeze({
    defaultAuditLog,
    defaultErrorTracker,
    defaultMetrics,
    defaultOtelFile: DEFAULT_OTEL_FILE,
    getAuditTail,
    getCatalog,
    getCompactionHistory,
    getDeadLetters,
    getLastQuotaSnapshots,
    getMcpStatus,
    getRecentLogs,
    isOtelEnabled,
    log,
    nervEventBusAdapter,
    otelExporterOtlpEndpoint: OTEL_EXPORTER_OTLP_ENDPOINT,
    convergenceTraceStore: defaultConvergenceTraceStore,
});

const sdkHookOps = Object.freeze({
    bus: defaultBus,
    registry: SDK_HOOKS,
    log,
});

const sdkSessionPolicyOps = Object.freeze({
    defaultDialogTimeoutMs: LLM_B_TURN_TIMEOUT_MS,
    resolveOptionalDialogTimeout,
});

const sdkTelemetryOps = Object.freeze({
    emitOperationMetric: emitSdkOperationMetric,
});

/**
 * @returns {import('#copilot/observability/metrics.js').MetricsStore}
 */
function resolveMetricsStore() {
    try {
        return /** @type {import('#copilot/observability/metrics.js').MetricsStore} */ (
            container.resolve(METRICS_STORE)
        );
    } catch {
        return defaultMetrics;
    }
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     agent: import('../../../agent/always-alive.js').AlwaysAliveAgent;
 *     runtimeId: string;
 *     requestedRuntimeId: string | null;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 *     metrics: import('#copilot/observability/metrics.js').MetricsStore;
 *     getClient: typeof getClient;
 *     getClientState: typeof getClientState;
 *     stopClient: typeof stopClient;
 *     forceStopClient: typeof forceStopClient;
 *     allTools: ReturnType<typeof getAllTools>;
 *     sdkSession: typeof sdkSessionOps;
 *     sdkSessionRpc: typeof sdkSessionRpcOps;
 *     sdkSessionEvents: typeof sdkSessionEventOps;
 *     sdkSessionUi: typeof sdkSessionUiOps;
 *     sdkRuntimeSession: typeof sdkRuntimeSessionOps;
 *     sdkSystemPrompt: typeof sdkSystemPromptOps;
 *     sdkSessionOwnership: typeof sdkSessionOwnershipOps;
 *     sdkRuntimeProjection: typeof sdkRuntimeProjectionOps;
 *     sdkObservability: typeof sdkObservabilityOps;
 *     sdkHooks: typeof sdkHookOps;
 *     sdkSessionPolicy: typeof sdkSessionPolicyOps;
 *     sdkTelemetry: typeof sdkTelemetryOps;
 *     sdkApiToken: string | null;
 *     bridgeAdminToken: string | undefined;
 * }}
 */
export function buildDefaultSdkRouteSharedDeps(runtimeId) {
    const selection = requireAgentRuntimeSelection(runtimeId);
    return {
        agent: selection.runtime,
        runtimeId: selection.runtimeId,
        requestedRuntimeId: selection.requestedRuntimeId,
        runtimeFound: selection.runtimeFound,
        usedDefaultRuntimeFallback: selection.usedDefaultRuntimeFallback,
        metrics: resolveMetricsStore(),
        getClient,
        getClientState,
        stopClient,
        forceStopClient,
        allTools: getAllTools(),
        sdkSession: sdkSessionOps,
        sdkSessionRpc: sdkSessionRpcOps,
        sdkSessionEvents: sdkSessionEventOps,
        sdkSessionUi: sdkSessionUiOps,
        sdkRuntimeSession: sdkRuntimeSessionOps,
        sdkSystemPrompt: sdkSystemPromptOps,
        sdkSessionOwnership: sdkSessionOwnershipOps,
        sdkRuntimeProjection: sdkRuntimeProjectionOps,
        sdkObservability: sdkObservabilityOps,
        sdkHooks: sdkHookOps,
        sdkSessionPolicy: sdkSessionPolicyOps,
        sdkTelemetry: sdkTelemetryOps,
        sdkApiToken: SDK_API_TOKEN,
        bridgeAdminToken: BRIDGE_ADMIN_TOKEN,
    };
}

/**
 * Resolve as dependências canônicas das rotas `/sdk/*` para a requisição atual.
 *
 * @param {import('express').Request} req
 * @returns {ReturnType<typeof buildDefaultSdkRouteSharedDeps>}
 */
export function resolveSdkRouteSharedDeps(req) {
    return buildDefaultSdkRouteSharedDeps(resolveRequestedRuntimeId(req));
}
