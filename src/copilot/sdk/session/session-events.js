// @ts-check
/**
 * Normalização canônica de eventos de sessão SDK.
 *
 * Módulo análogo a `permission-events.js` para os eventos: `session.model_changed`, `session.tools_updated`,
 * `session.plan_changed`, `session.mode_changed`.
 *
 * Consumers **nunca** devem parsear esses eventos ad-hoc — devem usar os normalizers deste módulo.
 *
 * @module copilot/sdk/session/session-events
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function objectOrEmpty(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function stringOr(value, fallback) {
    return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function tsOrNow(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

// ─── session.model_changed ──────────────────────────────────────────────────

/**
 * Payload normalizado de `session.model_changed` (emitido pelo agent EventBus).
 *
 * @typedef {object} NormalizedModelChangedEvent
 * @property {string | null} previousModel Modelo anterior ou `null` se desconhecido.
 * @property {string} newModel Modelo novo (nunca vazio).
 * @property {string | null} reasoningEffort Nível de reasoning effort ou `null`.
 * @property {number} ts Timestamp do evento.
 */

/**
 * Normaliza um evento raw `session.model_changed` / `SESSION_MODEL_CHANGE` em contrato estável.
 *
 * @param {unknown} eventOrData
 * @returns {NormalizedModelChangedEvent}
 */
export function normalizeModelChangedEvent(eventOrData) {
    const root = objectOrEmpty(eventOrData);
    const data = objectOrEmpty(root['data']);

    const previousModel = stringOr(data['previousModel'], '') || stringOr(root['previousModel'], '') || null;
    const newModel =
        stringOr(data['newModel'], '') ||
        stringOr(root['newModel'], '') ||
        stringOr(data['model'], '') ||
        stringOr(root['model'], 'unknown');
    const reasoningEffort = stringOr(data['reasoningEffort'], '') || stringOr(root['reasoningEffort'], '') || null;

    const ts = tsOrNow(root['timestamp'] ?? root['ts'] ?? data['ts']);
    return { previousModel, newModel, reasoningEffort, ts };
}

// ─── session.tools_updated ──────────────────────────────────────────────────

/**
 * @typedef {object} ToolSummary
 * @property {string} name Nome canônico da tool (namespacedName > name).
 * @property {string | null} description Descrição curta ou `null`.
 * @property {string | null} rawName Nome bruto (`name`) recebido do SDK.
 * @property {string | null} namespacedName Nome namespaced recebido do SDK.
 * @property {boolean} hasParameters Indica presença de JSON schema em `parameters`.
 * @property {boolean} hasInstructions Indica presença de texto em `instructions`.
 */

/**
 * Payload normalizado de `session.tools_updated`.
 *
 * @typedef {object} NormalizedToolsUpdatedEvent
 * @property {number} count Total de tools disponíveis.
 * @property {ToolSummary[]} tools Lista enxuta de tools (nome + descrição).
 * @property {number} ts Timestamp do evento.
 */

/**
 * Normaliza um evento raw `session.tools_updated` / `SESSION_TOOLS_UPDATED`.
 *
 * @param {unknown} eventOrData
 * @returns {NormalizedToolsUpdatedEvent}
 */
export function normalizeToolsUpdatedEvent(eventOrData) {
    const root = objectOrEmpty(eventOrData);
    const data = objectOrEmpty(root['data']);

    const rawTools = Array.isArray(data['tools']) ? data['tools'] : Array.isArray(root['tools']) ? root['tools'] : [];

    /** @type {ToolSummary[]} */
    const tools = rawTools.map((t) => {
        const rec = objectOrEmpty(t);
        const rawName = stringOr(rec['name'], '') || null;
        const namespacedName = stringOr(rec['namespacedName'], '') || null;
        const name = namespacedName || rawName || stringOr(t, 'unknown');
        const description = stringOr(rec['description'], '') || null;
        const hasParameters = Boolean(rec['parameters'] && typeof rec['parameters'] === 'object');
        const hasInstructions = typeof rec['instructions'] === 'string' && rec['instructions'].trim().length > 0;
        return { name, description, rawName, namespacedName, hasParameters, hasInstructions };
    });

    const ts = tsOrNow(root['timestamp'] ?? root['ts'] ?? data['ts']);
    return { count: tools.length, tools, ts };
}

// ─── session.plan_changed ───────────────────────────────────────────────────

/**
 * Payload normalizado de `session.plan_changed`.
 *
 * @typedef {object} NormalizedPlanChangedEvent
 * @property {'create' | 'update' | 'delete' | 'unknown'} operation Operação realizada no plano.
 * @property {number} ts Timestamp do evento.
 */

/**
 * Normaliza um evento raw `session.plan_changed` / `SESSION_PLAN_CHANGED`.
 *
 * @param {unknown} eventOrData
 * @returns {NormalizedPlanChangedEvent}
 */
export function normalizePlanChangedEvent(eventOrData) {
    const root = objectOrEmpty(eventOrData);
    const data = objectOrEmpty(root['data']);

    const rawOp = stringOr(data['operation'], '') || stringOr(root['operation'], '');
    /** @type {'create' | 'update' | 'delete' | 'unknown'} */
    const operation = rawOp === 'create' || rawOp === 'update' || rawOp === 'delete' ? rawOp : 'unknown';

    const ts = tsOrNow(root['timestamp'] ?? root['ts'] ?? data['ts']);
    return { operation, ts };
}

// ─── session.mode_changed ───────────────────────────────────────────────────

/**
 * Payload normalizado de `session.mode_changed`.
 *
 * @typedef {object} NormalizedModeChangedEvent
 * @property {string | null} previousMode Modo anterior ou `null`.
 * @property {string} newMode Modo novo (nunca vazio).
 * @property {number} ts Timestamp do evento.
 */

/**
 * Normaliza um evento raw `session.mode_changed` / `SESSION_MODE_CHANGED`.
 *
 * @param {unknown} eventOrData
 * @returns {NormalizedModeChangedEvent}
 */
export function normalizeModeChangedEvent(eventOrData) {
    const root = objectOrEmpty(eventOrData);
    const data = objectOrEmpty(root['data']);

    const previousMode = stringOr(data['previousMode'], '') || stringOr(root['previousMode'], '') || null;
    const newMode =
        stringOr(data['newMode'], '') ||
        stringOr(root['newMode'], '') ||
        stringOr(data['mode'], '') ||
        stringOr(root['mode'], 'unknown');

    const ts = tsOrNow(root['timestamp'] ?? root['ts'] ?? data['ts']);
    return { previousMode, newMode, ts };
}
