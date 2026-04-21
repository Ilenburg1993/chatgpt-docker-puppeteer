// @ts-check
/**
 * @module copilot/presentation
 * @file Barrel canônico das superfícies compartilhadas entre bordas.
 *
 *   Esta camada reúne accessors e projections consumidos por `server/`, `terminal/` e futuros clientes de borda sem
 *   reabrir a topologia interna do runtime do agent em cada ponto de consumo.
 */

export * as agentControl from './agent-control.js';
export * as agentHttpErrors from './agent-http-errors.js';
export * from './agent-runtime.js';
export * as conversationHubPresentation from './conversation-hub.js';
export * as realtimePresentation from './realtime.js';
export * from './runtime-controls.js';
export * from './runtime-dialog.js';
export * from './runtime-file-context.js';
export {
    buildAgentModuleHealth,
    buildLegacyAgentHealth,
    getAgentHealthHttpStatus,
    getAgentHealthSnapshotCompat,
} from './runtime-health.js';
export * from './runtime-overview.js';
export * from './runtime-ownership.js';
export * from './runtime-route-deps.js';
export * from './runtime-sdk-session.js';
export {
    buildAgentConnectedSsePayload,
    buildAgentSessionHttpPayload,
    buildAgentStatusHttpPayload,
    readAgentStatusSnapshot,
    readAgentStatusValue,
} from './runtime-status.js';
export * from './runtime-targeting.js';
export * from './runtime-ui-state.js';
export * from './runtime-webhooks.js';
export * as sdkSessionsPresentation from './sdk-sessions.js';
export * as systemConfigPresentation from './system-config.js';
export * as systemMetricsPresentation from './system-metrics.js';
