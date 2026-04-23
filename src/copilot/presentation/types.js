// @ts-check
/**
 * @module copilot/presentation/types
 * @file Tipos locais das projections compartilhadas por bordas.
 */

/**
 * Resultado comum produzido por handlers de presentation e adaptado por `server/handler-bridge`.
 *
 * @typedef {{
 *     status: number;
 *     body: unknown;
 *     cors?: boolean;
 * }} HandlerResult
 *
 * @typedef {'interactive' | 'plan' | 'autopilot' | 'shell'} RuntimeSdkMode
 *
 * @typedef {{ mode: RuntimeSdkMode | string; [key: string]: unknown }} RuntimeSdkModeResult
 *
 * @typedef {{ path?: string | null; content?: string | null; exists?: boolean; [key: string]: unknown }} RuntimeSdkPlanReadResult
 *
 *
 * @typedef {{
 *     id: string;
 *     capabilities?: {
 *         supports?: { reasoningEffort?: boolean; vision?: boolean };
 *     };
 * }} RuntimeModelInfo
 *
 *
 * @typedef {'ready' | 'reply' | 'stopped' | 'question'} RuntimePendingQuestionKind
 *
 * @typedef {'fresh' | 'active' | 'expiring_soon' | 'expired'} RuntimePendingQuestionShadowState
 *
 * @typedef {{
 *     question: string;
 *     kind: RuntimePendingQuestionKind;
 *     choices?: string[];
 *     askedAt: number;
 *     allowFreeform: boolean;
 *     protocolControlled: boolean;
 *     [key: string]: unknown;
 * }} RuntimePendingQuestion
 *
 *
 * @typedef {{
 *     question: string;
 *     meta: {
 *         kind: RuntimePendingQuestionKind;
 *         choices?: string[];
 *         askedAt: number;
 *         allowFreeform: boolean;
 *         protocolControlled: boolean;
 *         [key: string]: unknown;
 *     };
 *     restoredAt: number;
 *     expiresAt: number;
 *     [key: string]: unknown;
 * }} RuntimePendingQuestionShadow
 *
 *
 * @typedef {string} RuntimeRecommendedAction
 *
 * @typedef {{
 *     receivedAt?: number;
 *     fromAgent?: string;
 *     toAgent?: string;
 *     reason?: string;
 *     status?: string;
 *     runtimeId?: string;
 *     [key: string]: unknown;
 * }} RuntimeHandoffRequest
 */

export {};
