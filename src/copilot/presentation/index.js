// @ts-check
/**
 * @module copilot/presentation
 * @file Barrel canônico das superfícies compartilhadas entre bordas.
 *
 *   Esta camada reúne accessors e projections consumidos por `server/`, `terminal/` e futuros clientes de borda sem
 *   reabrir a topologia interna do runtime do agent em cada ponto de consumo.
 */

export * from './agent-runtime.js';
export * as agentControl from './agent-control.js';
export * as agentHttpErrors from './agent-http-errors.js';
export * as conversationHubPresentation from './conversation-hub.js';
export * as realtimePresentation from './realtime.js';
export * as sdkSessionsPresentation from './sdk-sessions.js';
export * as systemConfigPresentation from './system-config.js';
export * as systemMetricsPresentation from './system-metrics.js';
