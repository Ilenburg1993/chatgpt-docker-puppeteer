// @ts-check
/**
 * src/copilot/events/sdk-events.js
 *
 * Re-exporta símbolos do lado de eventos do `sdk/` (SESSION_EVENTS, onSessionEvent) para que módulos de camadas
 * inferiores (observability/) possam importá-los via `#copilot/events` sem criar uma dependência direta em
 * `#copilot/sdk`.
 *
 * Faixa 3.1 — AC: `observability/ → sdk/` layer violation fix.
 *
 * @module copilot/events/sdk-events
 */

export {
    ALL_EVENT_TYPES,
    getSessionCapabilities,
    normalizeElicitationCompletedEvent,
    normalizeElicitationPendingEvent,
    normalizeModeChangedEvent,
    normalizeModelChangedEvent,
    normalizePermissionCompletedEvent,
    normalizePermissionRequestedEvent,
    normalizePlanChangedEvent,
    normalizeToolsUpdatedEvent,
    normalizeUserInputCompletedEvent,
    normalizeUserInputRequestedEvent,
    onAllSessionEvents,
    onSessionEvent,
    onSessionEvents,
} from '#copilot/sdk/session';
export { SESSION_EVENTS } from '../sdk/constants.js';
