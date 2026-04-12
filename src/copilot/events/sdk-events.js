// @ts-check
/**
 * src/copilot/events/sdk-events.js
 *
 * FAIXA-L5 — Constantes SSOT para eventos do SDK session bridgeados ao EventBus.
 *
 * Selecionamos um subconjunto de alto valor dos ~74 session events do SDK
 * para relay ao EventBus centralizado, mantendo namespace `sdk:`.
 *
 * @module copilot/events/sdk-events
 */

// ── Session lifecycle ──
/** @type {string} */ export const SDK_SESSION_START = 'sdk:session:start';
/** @type {string} */ export const SDK_SESSION_IDLE = 'sdk:session:idle';
/** @type {string} */ export const SDK_SESSION_ERROR = 'sdk:session:error';
/** @type {string} */ export const SDK_SESSION_SHUTDOWN = 'sdk:session:shutdown';
/** @type {string} */ export const SDK_SESSION_COMPACTION_START = 'sdk:session:compaction_start';
/** @type {string} */ export const SDK_SESSION_COMPACTION_COMPLETE = 'sdk:session:compaction_complete';
/** @type {string} */ export const SDK_SESSION_MODE_CHANGED = 'sdk:session:mode_changed';
/** @type {string} */ export const SDK_SESSION_USAGE_INFO = 'sdk:session:usage_info';

// ── Assistant ──
/** @type {string} */ export const SDK_ASSISTANT_TURN_START = 'sdk:assistant:turn_start';
/** @type {string} */ export const SDK_ASSISTANT_TURN_END = 'sdk:assistant:turn_end';
/** @type {string} */ export const SDK_ASSISTANT_MESSAGE = 'sdk:assistant:message';

// ── User ──
/** @type {string} */ export const SDK_USER_MESSAGE = 'sdk:user:message';

// ── Tool ──
/** @type {string} */ export const SDK_TOOL_EXECUTION_START = 'sdk:tool:execution_start';
/** @type {string} */ export const SDK_TOOL_EXECUTION_COMPLETE = 'sdk:tool:execution_complete';

// ── Subagent ──
/** @type {string} */ export const SDK_SUBAGENT_STARTED = 'sdk:subagent:started';
/** @type {string} */ export const SDK_SUBAGENT_COMPLETED = 'sdk:subagent:completed';
/** @type {string} */ export const SDK_SUBAGENT_FAILED = 'sdk:subagent:failed';

// ── Abort ──
/** @type {string} */ export const SDK_ABORT = 'sdk:abort';

/**
 * Mapa SDK session event type → EventBus SSOT constant.
 * Usado pelo SdkSessionBridge para relay automático.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SDK_SESSION_TO_EVENTBUS = Object.freeze({
    'session.start': SDK_SESSION_START,
    'session.idle': SDK_SESSION_IDLE,
    'session.error': SDK_SESSION_ERROR,
    'session.shutdown': SDK_SESSION_SHUTDOWN,
    'session.compaction_start': SDK_SESSION_COMPACTION_START,
    'session.compaction_complete': SDK_SESSION_COMPACTION_COMPLETE,
    'session.mode_changed': SDK_SESSION_MODE_CHANGED,
    'session.usage_info': SDK_SESSION_USAGE_INFO,
    'assistant.turn_start': SDK_ASSISTANT_TURN_START,
    'assistant.turn_end': SDK_ASSISTANT_TURN_END,
    'assistant.message': SDK_ASSISTANT_MESSAGE,
    'user.message': SDK_USER_MESSAGE,
    'tool.execution_start': SDK_TOOL_EXECUTION_START,
    'tool.execution_complete': SDK_TOOL_EXECUTION_COMPLETE,
    'subagent.started': SDK_SUBAGENT_STARTED,
    'subagent.completed': SDK_SUBAGENT_COMPLETED,
    'subagent.failed': SDK_SUBAGENT_FAILED,
    'abort': SDK_ABORT,
});
