// @ts-check
/**
 * @module copilot/event-handlers/contracts
 * @file Contratos tipados compartilhados pelos event handlers do SDK.
 *
 *   Centraliza os typedefs usados por `event-handlers/` e pelo wirer em `agent/session/wiring`, evitando dependência
 *   do módulo concreto `event-wirer.js` apenas para tipos.
 */

/**
 * Tipo mínimo de sessão SDK usado pelos handlers.
 *
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSessionLike
 */

/**
 * @typedef {Object} SessionWirerCallbacks
 * @property {(event: string, payload?: unknown) => void} emit
 * @property {() => import('#copilot/agent/types').AgentStatusSnapshot} getStatusSnapshot
 * @property {(path: string) => void} onCheckpointPath
 * @property {(contextState: { tokens: number; tokenLimit: number; utilization: number } | null) => void} onContextState
 * @property {(prInfo: {
 *     model?: string;
 *     configuredModel?: string;
 *     modelMismatch?: boolean;
 *     sessionId?: string | null;
 *     cost?: number;
 *     quotaSnapshots?: Record<string, unknown>;
 *     ts: number;
 * }) => void} onPrInfo
 * @property {() => boolean} isProcessing
 * @property {() => boolean} dialogLoopActive
 */

export {};
