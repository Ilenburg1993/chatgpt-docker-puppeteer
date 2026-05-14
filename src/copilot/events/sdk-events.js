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

export { SESSION_EVENTS } from '../sdk/constants.js';
export { ALL_EVENT_TYPES, onSessionEvent, onSessionEvents } from '#copilot/sdk/session';
