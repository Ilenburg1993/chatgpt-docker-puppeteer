// @ts-check
/**
 * @module copilot/presentation/types
 * @file Tipos locais das projections compartilhadas por bordas.
 */

/**
 * Resultado comum produzido por handlers de presentation e adaptado por `server/routes/presentation-route`.
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
 * @typedef {object} RuntimeSessionCapabilities
 *
 * @typedef {{ [key: string]: unknown }} RuntimeCopilotSession
 *
 * @typedef {object} RuntimeInputOptions
 * @property {string} [title]
 * @property {string} [description]
 * @property {number} [minLength]
 * @property {number} [maxLength]
 * @property {'email' | 'uri' | 'date' | 'date-time'} [format]
 * @property {string} [default]
 *
 * @typedef {string | number | boolean | string[]} RuntimeElicitationFieldValue
 *
 * @typedef {{
 *     type: 'string';
 *     enum?: string[];
 *     enumNames?: string[];
 *     oneOf?: { const: string; title: string }[];
 *     minLength?: number;
 *     maxLength?: number;
 *     format?: 'email' | 'uri' | 'date' | 'date-time';
 *     default?: string;
 *     title?: string;
 *     description?: string;
 * }} RuntimeElicitationStringField
 *
 * @typedef {{
 *     type: 'array';
 *     minItems?: number;
 *     maxItems?: number;
 *     items?: { type?: 'string'; enum?: string[]; anyOf?: { const: string; title: string }[] };
 *     default?: string[];
 *     title?: string;
 *     description?: string;
 * }} RuntimeElicitationArrayField
 *
 * @typedef {{
 *     type: 'boolean';
 *     default?: boolean;
 *     title?: string;
 *     description?: string;
 * }} RuntimeElicitationBooleanField
 *
 * @typedef {{
 *     type: 'number' | 'integer';
 *     minimum?: number;
 *     maximum?: number;
 *     default?: number;
 *     title?: string;
 *     description?: string;
 * }} RuntimeElicitationNumberField
 *
 * @typedef {RuntimeElicitationStringField | RuntimeElicitationArrayField | RuntimeElicitationBooleanField |
 * RuntimeElicitationNumberField} RuntimeElicitationSchemaField
 *
 * @typedef {{
 *     type: 'object';
 *     properties: Record<string, RuntimeElicitationSchemaField | Record<string, unknown>>;
 *     required?: string[];
 *     title?: string;
 *     description?: string;
 * }} RuntimeElicitationSchema
 *
 * @typedef {{
 *     message: string;
 *     requestedSchema: RuntimeElicitationSchema;
 * }} RuntimeElicitationParams
 *
 * @typedef {{
 *     sessionId: string;
 *     message: string;
 *     requestedSchema?: RuntimeElicitationSchema;
 *     mode?: 'form' | 'url';
 *     elicitationSource?: string;
 *     url?: string;
 *     [key: string]: unknown;
 * }} RuntimeElicitationContext
 *
 * @typedef {{
 *     action: 'accept' | 'decline' | 'cancel';
 *     content?: Record<string, RuntimeElicitationFieldValue>;
 *     [key: string]: unknown;
 * }} RuntimeElicitationResult
 *
 *
 * @typedef {{
 *     id: string;
 *     name?: string;
 *     displayName?: string;
 *     vendor?: string;
 *     family?: string;
 *     capabilities?: {
 *         supports?: { reasoningEffort?: boolean; vision?: boolean };
 *         limits?: {
 *             max_prompt_tokens?: number;
 *             max_context_window_tokens?: number;
 *             [key: string]: unknown;
 *         };
 *     };
 *     byok?: {
 *         freeTier?: boolean | null;
 *         pricing?: { prompt?: number | null; completion?: number | null; request?: number | null };
 *         rateLimits?: {
 *             maxRequestTokens?: number | null;
 *             tokensPerMinute?: number | null;
 *             requestsPerMinute?: number | null;
 *             dailyRequests?: number | null;
 *         };
 *         provider?: string | null;
 *         profile?: string | null;
 *         source?: string;
 *         profileFreeTier?: boolean | null;
 *         profileCostSource?: string | null;
 *         profileCostDetail?: string | null;
 *         inputModalities?: string[];
 *         outputModalities?: string[];
 *         supportsReasoning?: boolean;
 *         [key: string]: unknown;
 *     };
 * }} RuntimeModelInfo
 *
 * @typedef {{
 *     sessionId: string;
 *     summary?: string | null;
 *     startTime?: Date | number | string | null;
 *     modifiedTime?: Date | number | string | null;
 *     createdAt?: Date | number | string | null;
 *     updatedAt?: Date | number | string | null;
 *     lastActivityAt?: Date | number | string | null;
 *     model?: string | null;
 *     cwd?: string;
 *     gitRoot?: string;
 *     repository?: string;
 *     branch?: string;
 *     isRemote?: boolean;
 *     mode?: RuntimeSdkMode | string;
 *     localMetadata?: Record<string, unknown> | null;
 *     sessionFs?: unknown;
 *     context?: unknown;
 *     [key: string]: unknown;
 * }} RuntimeSessionMetadata
 *
 * @typedef {{
 *     sessionId?: string;
 *     cwd?: string;
 *     gitRoot?: string;
 *     repository?: string;
 *     branch?: string;
 *     limit?: number;
 *     offset?: number;
 *     includeDeleted?: boolean;
 *     [key: string]: unknown;
 * }} RuntimeSessionListFilter
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
