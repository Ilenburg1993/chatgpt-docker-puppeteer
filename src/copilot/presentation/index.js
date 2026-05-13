// @ts-check
/**
 * @module copilot/presentation
 * @file Barrel canônico das superfícies compartilhadas entre bordas.
 *
 *   Esta camada reúne accessors e projections consumidos por `server/`, `terminal/` e futuros clientes de borda sem
 *   reabrir a topologia interna do runtime do agent em cada ponto de consumo.
 */

export * as agentHttpErrors from './agent/http-errors.js';
export * as agentControl from './agent/index.js';
export {
    createAgentRuntimeNotFoundError,
    getAgentRuntime,
    getAgentRuntimeOrDefault,
    getDefaultAgentRuntime,
    getDefaultAgentRuntimeId,
    isAgentRuntimeNotFoundError,
    listKnownAgentRuntimes,
    requireAgentRuntime,
    requireAgentRuntimeSelection,
    resolveAgentRuntimeId,
    resolveAgentRuntimeSelection,
} from './agent/runtime/index.js';
export * as contractsPresentation from './contracts/index.js';
export * as conversationHubPresentation from './conversation/index.js';
export * from './files/index.js';
export * as filesPresentation from './files/index.js';
export * from './routing/index.js';
export * as routingPresentation from './routing/index.js';
export * from './runtime/index.js';
export * as runtimePresentation from './runtime/index.js';
export * from './sdk/index.js';
export * as sdkPresentation from './sdk/index.js';
export * as sdkSessionsPresentation from './sdk/sessions.js';
export * from './state/index.js';
export * as statePresentation from './state/index.js';
export * as realtimePresentation from './state/realtime.js';
export * as systemConfigPresentation from './system/config.js';
export * from './system/index.js';
export * as systemPresentation from './system/index.js';
export * as systemMetricsPresentation from './system/metrics/index.js';
