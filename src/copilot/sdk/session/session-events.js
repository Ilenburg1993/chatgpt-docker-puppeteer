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
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return Date.now();
}

/**
 * @param {unknown} value
 * @returns {boolean | null}
 */
function booleanOrNull(value) {
    return typeof value === 'boolean' ? value : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteNumberOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function stringOrNull(value) {
    return stringOr(value, '') || null;
}

/**
 * @param {Record<string, unknown>} root
 * @param {Record<string, unknown>} data
 * @returns {{ ts: number; timestamp: string | null }}
 */
function normalizeTimestamp(root, data) {
    const raw = root['timestamp'] ?? root['ts'] ?? data['timestamp'] ?? data['ts'];
    return {
        ts: tsOrNow(raw),
        timestamp: typeof raw === 'string' && raw.trim().length > 0 ? raw : null,
    };
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
 * @property {number} count Total de tools disponíveis quando materializado; `0` também pode significar desconhecido
 *   quando `countMaterialized=false`.
 * @property {ToolSummary[]} tools Lista enxuta de tools (nome + descrição).
 * @property {boolean} toolsMaterialized Indica que o SDK forneceu a lista de tools no payload.
 * @property {boolean} countMaterialized Indica que o SDK forneceu lista ou contador numérico explícito.
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

    const dataHasTools = Array.isArray(data['tools']);
    const rootHasTools = Array.isArray(root['tools']);
    const toolsMaterialized = dataHasTools || rootHasTools;
    const rawTools = dataHasTools
        ? /** @type {unknown[]} */ (data['tools'])
        : rootHasTools
          ? /** @type {unknown[]} */ (root['tools'])
          : [];

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
    const explicitCount = Number(data['count'] ?? root['count'] ?? data['toolCount'] ?? root['toolCount'] ?? NaN);
    const countMaterialized = toolsMaterialized || Number.isFinite(explicitCount);
    const count = toolsMaterialized ? tools.length : Number.isFinite(explicitCount) ? Math.max(0, explicitCount) : 0;
    return { count, tools, toolsMaterialized, countMaterialized, ts };
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

// ─── model.call_failure ────────────────────────────────────────────────────

/**
 * @typedef {object} NormalizedModelCallFailureEvent
 * @property {string | null} model Modelo usado na chamada com falha.
 * @property {string} source Origem da chamada (`top_level`, `subagent`, `mcp_sampling` ou `unknown`).
 * @property {number | null} statusCode Status HTTP, quando disponível.
 * @property {number | null} durationMs Duração da chamada em ms, quando disponível.
 * @property {string | null} errorMessage Mensagem de erro restrita.
 * @property {string | null} apiCallId ID de completion do provider.
 * @property {string | null} providerCallId ID de request do provider/GitHub.
 * @property {string | null} serviceRequestId ID de request do serviço Copilot.
 * @property {string | null} initiator Iniciador da chamada.
 * @property {number} ts Timestamp compat numérico.
 * @property {string | null} timestamp Timestamp ISO original.
 */

/**
 * Normaliza `model.call_failure` para telemetry/UX.
 *
 * @param {unknown} eventOrData
 * @returns {NormalizedModelCallFailureEvent}
 */
export function normalizeModelCallFailureEvent(eventOrData) {
    const root = objectOrEmpty(eventOrData);
    const data = objectOrEmpty(root['data']);
    const time = normalizeTimestamp(root, data);
    return {
        model: stringOrNull(data['model'] ?? root['model']),
        source: stringOr(data['source'], '') || stringOr(root['source'], 'unknown'),
        statusCode: finiteNumberOrNull(data['statusCode'] ?? root['statusCode']),
        durationMs: finiteNumberOrNull(data['durationMs'] ?? root['durationMs']),
        errorMessage: stringOrNull(data['errorMessage'] ?? root['errorMessage']),
        apiCallId: stringOrNull(data['apiCallId'] ?? root['apiCallId']),
        providerCallId: stringOrNull(data['providerCallId'] ?? root['providerCallId']),
        serviceRequestId: stringOrNull(data['serviceRequestId'] ?? root['serviceRequestId']),
        initiator: stringOrNull(data['initiator'] ?? root['initiator']),
        ...time,
    };
}

// ─── session.permissions_changed ───────────────────────────────────────────

/**
 * @typedef {object} NormalizedPermissionsChangedEvent
 * @property {boolean | null} allowAllPermissions Valor agregado após a mudança.
 * @property {boolean | null} previousAllowAllPermissions Valor agregado antes da mudança.
 * @property {'enabled' | 'disabled' | 'unchanged' | 'unknown'} transition Transição humana.
 * @property {number} ts Timestamp compat numérico.
 * @property {string | null} timestamp Timestamp ISO original.
 */

/**
 * Normaliza `session.permissions_changed`.
 *
 * @param {unknown} eventOrData
 * @returns {NormalizedPermissionsChangedEvent}
 */
export function normalizePermissionsChangedEvent(eventOrData) {
    const root = objectOrEmpty(eventOrData);
    const data = objectOrEmpty(root['data']);
    const allowAllPermissions = booleanOrNull(data['allowAllPermissions'] ?? root['allowAllPermissions']);
    const previousAllowAllPermissions = booleanOrNull(
        data['previousAllowAllPermissions'] ?? root['previousAllowAllPermissions'],
    );
    /** @type {'enabled' | 'disabled' | 'unchanged' | 'unknown'} */
    let transition = 'unknown';
    if (allowAllPermissions !== null && previousAllowAllPermissions !== null) {
        transition =
            allowAllPermissions === previousAllowAllPermissions
                ? 'unchanged'
                : allowAllPermissions
                  ? 'enabled'
                  : 'disabled';
    }
    return {
        allowAllPermissions,
        previousAllowAllPermissions,
        transition,
        ...normalizeTimestamp(root, data),
    };
}

// ─── session.canvas.* ──────────────────────────────────────────────────────

/**
 * @typedef {object} NormalizedCanvasOpenedEvent
 * @property {string | null} canvasId Provider-local canvas id.
 * @property {string | null} instanceId Instância aberta.
 * @property {string | null} extensionId Provider da extensão.
 * @property {string | null} extensionName Nome da extensão.
 * @property {string | null} title Título renderizado.
 * @property {string | null} status Status provider-side.
 * @property {string | null} url URL web, se houver.
 * @property {string} availability Estado de disponibilidade (`ready`, `stale` ou `unknown`).
 * @property {boolean} reopen Indica reopen idempotente.
 * @property {number} ts Timestamp compat numérico.
 * @property {string | null} timestamp Timestamp ISO original.
 */

/**
 * Normaliza `session.canvas.opened`.
 *
 * @param {unknown} eventOrData
 * @returns {NormalizedCanvasOpenedEvent}
 */
export function normalizeCanvasOpenedEvent(eventOrData) {
    const root = objectOrEmpty(eventOrData);
    const data = objectOrEmpty(root['data']);
    return {
        canvasId: stringOrNull(data['canvasId'] ?? root['canvasId']),
        instanceId: stringOrNull(data['instanceId'] ?? root['instanceId']),
        extensionId: stringOrNull(data['extensionId'] ?? root['extensionId']),
        extensionName: stringOrNull(data['extensionName'] ?? root['extensionName']),
        title: stringOrNull(data['title'] ?? root['title']),
        status: stringOrNull(data['status'] ?? root['status']),
        url: stringOrNull(data['url'] ?? root['url']),
        availability: stringOr(data['availability'], '') || stringOr(root['availability'], 'unknown'),
        reopen: Boolean(data['reopen'] ?? root['reopen']),
        ...normalizeTimestamp(root, data),
    };
}

/**
 * @typedef {object} NormalizedCanvasRegistryEntry
 * @property {string | null} canvasId Provider-local canvas id.
 * @property {string | null} displayName Nome humano.
 * @property {string | null} description Descrição curta.
 * @property {string | null} extensionId Provider da extensão.
 * @property {string | null} extensionName Nome da extensão.
 * @property {number} actionCount Quantidade de actions declaradas.
 */

/**
 * @typedef {object} NormalizedCanvasRegistryChangedEvent
 * @property {number} count Quantidade de canvases declarados.
 * @property {NormalizedCanvasRegistryEntry[]} canvases Canvases resumidos.
 * @property {number} ts Timestamp compat numérico.
 * @property {string | null} timestamp Timestamp ISO original.
 */

/**
 * Normaliza `session.canvas.registry_changed`.
 *
 * @param {unknown} eventOrData
 * @returns {NormalizedCanvasRegistryChangedEvent}
 */
export function normalizeCanvasRegistryChangedEvent(eventOrData) {
    const root = objectOrEmpty(eventOrData);
    const data = objectOrEmpty(root['data']);
    const rawCanvases = Array.isArray(data['canvases'])
        ? /** @type {unknown[]} */ (data['canvases'])
        : Array.isArray(root['canvases'])
          ? /** @type {unknown[]} */ (root['canvases'])
          : [];
    const canvases = rawCanvases.map((canvas) => {
        const item = objectOrEmpty(canvas);
        const actions = Array.isArray(item['actions']) ? item['actions'] : [];
        return {
            canvasId: stringOrNull(item['canvasId']),
            displayName: stringOrNull(item['displayName']),
            description: stringOrNull(item['description']),
            extensionId: stringOrNull(item['extensionId']),
            extensionName: stringOrNull(item['extensionName']),
            actionCount: actions.length,
        };
    });
    return {
        count: canvases.length,
        canvases,
        ...normalizeTimestamp(root, data),
    };
}

// ─── hook.progress ─────────────────────────────────────────────────────────

/**
 * @typedef {object} NormalizedHookProgressEvent
 * @property {string} message Mensagem humana de progresso.
 * @property {number} ts Timestamp compat numérico.
 * @property {string | null} timestamp Timestamp ISO original.
 */

/**
 * Normaliza `hook.progress`.
 *
 * @param {unknown} eventOrData
 * @returns {NormalizedHookProgressEvent}
 */
export function normalizeHookProgressEvent(eventOrData) {
    const root = objectOrEmpty(eventOrData);
    const data = objectOrEmpty(root['data']);
    return {
        message: stringOr(data['message'], '') || stringOr(root['message'], ''),
        ...normalizeTimestamp(root, data),
    };
}
