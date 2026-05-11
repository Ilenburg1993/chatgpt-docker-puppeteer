// @ts-check
/**
 * Contratos canônicos do subsistema de tools.
 *
 * Este módulo centraliza validações/normalizações leves para reduzir drift entre `src/copilot/tools/**` e
 * `src/copilot/sdk/**`.
 *
 * @module copilot/core/tool-contracts
 */

/**
 * @typedef {object} ToolDefinitionContract
 * @property {string} name
 * @property {string} description
 * @property {unknown} handler
 * @property {boolean} [skipPermission]
 */

/**
 * @typedef {object} ToolExecutionTelemetryContract
 * @property {string} toolName
 * @property {number} durationMs
 * @property {boolean} success
 * @property {string | null} [sessionId]
 */

/**
 * @typedef {object} ToolPermissionDecisionContract
 * @property {string} toolName
 * @property {'allow' | 'deny'} decision
 * @property {string} reason
 */

/**
 * @typedef {object} UserInputBridgeContract
 * @property {string} requestId
 * @property {string} question
 * @property {string[]} choices
 * @property {boolean} allowFreeform
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Valida contrato mínimo de definição de tool.
 *
 * @param {unknown} tool
 * @returns {{ ok: true; value: ToolDefinitionContract } | { ok: false; reason: string }}
 */
export function validateToolDefinitionContract(tool) {
    if (!isRecord(tool)) {
        return { ok: false, reason: 'tool inválida: objeto esperado.' };
    }
    const name = tool['name'];
    if (typeof name !== 'string' || name.trim().length === 0) {
        return { ok: false, reason: 'tool inválida: name (string) obrigatório.' };
    }
    const description = tool['description'];
    if (typeof description !== 'string' || description.trim().length === 0) {
        return { ok: false, reason: `tool "${name}" inválida: description (string) obrigatório.` };
    }
    const handler = tool['handler'];
    if (typeof handler !== 'function') {
        return { ok: false, reason: `tool "${name}" inválida: handler (function) obrigatório.` };
    }
    return {
        ok: true,
        value: {
            name,
            description,
            handler,
            ...(typeof tool['skipPermission'] === 'boolean' ? { skipPermission: tool['skipPermission'] } : {}),
        },
    };
}

/**
 * Normaliza payload de telemetria de execução de tools.
 *
 * @param {Partial<ToolExecutionTelemetryContract> & { toolName: string }} input
 * @returns {ToolExecutionTelemetryContract}
 */
export function normalizeToolExecutionTelemetryContract(input) {
    const rawDurationMs = input.durationMs;
    const durationMs =
        typeof rawDurationMs === 'number' && Number.isFinite(rawDurationMs) && rawDurationMs >= 0 ? rawDurationMs : 0;

    return {
        toolName: input.toolName,
        durationMs,
        success: input.success === true,
        sessionId: typeof input.sessionId === 'string' && input.sessionId.length > 0 ? input.sessionId : null,
    };
}

/**
 * Normaliza payload de decisão de permissão.
 *
 * @param {{ toolName: string; decision?: string; reason?: string }} input
 * @returns {ToolPermissionDecisionContract}
 */
export function normalizeToolPermissionDecisionContract(input) {
    return {
        toolName: input.toolName,
        decision: input.decision === 'deny' ? 'deny' : 'allow',
        reason: typeof input.reason === 'string' && input.reason.trim().length > 0 ? input.reason : 'unspecified',
    };
}

/**
 * Normaliza payload da ponte de input estruturado usuário↔tool.
 *
 * @param {Partial<UserInputBridgeContract> & { requestId: string; question: string }} input
 * @returns {UserInputBridgeContract}
 */
export function normalizeUserInputBridgeContract(input) {
    return {
        requestId: input.requestId,
        question: input.question,
        choices: Array.isArray(input.choices) ? input.choices.filter((c) => typeof c === 'string') : [],
        allowFreeform: input.allowFreeform !== false,
    };
}
