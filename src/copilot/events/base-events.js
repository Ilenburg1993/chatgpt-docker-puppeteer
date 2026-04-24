// @ts-check
/**
 * src/copilot/events/base-events.js
 *
 * Catálogo base de nomes de eventos cross-module do sistema Copilot.
 *
 * Define namespaces e nomes de eventos usados pelo HookBus, EventBus e subsistemas de observabilidade.
 *
 * **Puro** — apenas constantes e tipagem, zero lógica.
 *
 * @module copilot/events/base-events
 */

// ─── Namespaces ──────────────────────────────────────────────────────────────

/**
 * Namespaces de eventos organizados por subsistema.
 *
 * @readonly
 * @enum {string}
 */
export const EVENT_NAMESPACES = /** @type {const} */ ({
    HOOK: 'hook',
    SESSION: 'session',
    TOOL: 'tool',
    SDK: 'sdk',
    AGENT: 'agent',
    API: 'api',
    TERMINAL: 'terminal',
    AUDIT: 'audit',
});

// ─── Event Names ─────────────────────────────────────────────────────────────

/**
 * Catálogo de nomes de eventos canônicos, agrupados por namespace.
 *
 * Padrão: `namespace:action` (ex: `session:start`, `tool:pre_invoke`).
 *
 * @readonly
 */
export const EVENT_NAMES = /** @type {const} */ ({
    hook: {
        PRE_TOOL_USE: 'hook:pre_tool_use',
        POST_TOOL_USE: 'hook:post_tool_use',
        PROMPT_SUBMITTED: 'hook:prompt_submitted',
        SESSION_START: 'hook:session_start',
        SESSION_END: 'hook:session_end',
        ERROR_OCCURRED: 'hook:error_occurred',
    },
    session: {
        START: 'session:start',
        END: 'session:end',
        RESUME: 'session:resume',
        ABORT: 'session:abort',
        TURN_START: 'session:turn_start',
        TURN_END: 'session:turn_end',
    },
    tool: {
        PRE_INVOKE: 'tool:pre_invoke',
        POST_INVOKE: 'tool:post_invoke',
        ERROR: 'tool:error',
        REGISTERED: 'tool:registered',
    },
    sdk: {
        REQUEST: 'sdk:request',
        RESPONSE: 'sdk:response',
        ERROR: 'sdk:error',
        CONNECTED: 'sdk:connected',
        DISCONNECTED: 'sdk:disconnected',
    },
    agent: {
        READY: 'agent:ready',
        SHUTDOWN: 'agent:shutdown',
        ERROR: 'agent:error',
    },
    api: {
        REQUEST: 'api:request',
        ERROR: 'api:error',
    },
    terminal: {
        STARTED: 'terminal:started',
        STOPPED: 'terminal:stopped',
        COMMAND: 'terminal:command',
    },
    audit: {
        ENTRY: 'audit:entry',
        FLUSH: 'audit:flush',
    },
});

// ─── JSDoc typedefs para uso cross-module ────────────────────────────────────

/**
 * Nome de namespace de evento válido.
 *
 * @typedef {(typeof EVENT_NAMESPACES)[keyof typeof EVENT_NAMESPACES]} EventNamespace
 */

/**
 * Evento base cross-module.
 *
 * @typedef {object} BaseEvent
 * @property {string} type - Nome canônico do evento (ex: `session:start`).
 * @property {number} timestamp - Unix epoch ms.
 * @property {string} [correlationId] - UUID de correlação para rastreamento ponta-a-ponta.
 * @property {string} [eventId] - UUID único deste evento.
 * @property {string} [causationId] - eventId do evento causador para rastreio de causalidade.
 * @property {string} [source] - Módulo/subsistema de origem.
 * @property {string} [_source] - Identificador host:pid injetado pelo timestampEnricher.
 * @property {Record<string, unknown>} [meta] - Metadata adicional.
 */

/**
 * Evento de sessão.
 *
 * @typedef {BaseEvent & { sessionId: string }} SessionEvent
 */

/**
 * Evento de tool.
 *
 * @typedef {BaseEvent & { toolName: string; toolArgs?: object }} ToolEvent
 */

/**
 * Evento de SDK.
 *
 * @typedef {BaseEvent & { method?: string; duration?: number }} SdkEvent
 */

/**
 * Evento de audit.
 *
 * @typedef {BaseEvent & { level: string; message: string }} AuditEvent
 */
