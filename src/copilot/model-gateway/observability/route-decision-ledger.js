// @ts-check
/**
 * Bounded in-process ledger for model-gateway route decisions.
 *
 * The ledger intentionally stores only sanitized decision metadata: ids, scores, counts, token/cost estimates and
 * fallback ids. It never stores prompts, provider payloads, headers or secrets.
 *
 * @module copilot/model-gateway/observability/route-decision-ledger
 */

const DEFAULT_ROUTE_DECISION_LEDGER_LIMIT = 200;

/** @type {ReturnType<typeof import('./events.js').buildRouteDecisionEvent>[]} */
const ROUTE_DECISION_LEDGER = [];

/**
 * @param {ReturnType<typeof import('./events.js').buildRouteDecisionEvent>} event
 * @returns {ReturnType<typeof import('./events.js').buildRouteDecisionEvent>}
 */
function cloneRouteDecisionEvent(event) {
    return {
        ...event,
        fallbackChain: [...event.fallbackChain],
        reasons: [...event.reasons],
        traceAttributes: { ...event.traceAttributes },
    };
}

/**
 * @param {ReturnType<typeof import('./events.js').buildRouteDecisionEvent>} event
 * @returns {ReturnType<typeof import('./events.js').buildRouteDecisionEvent>}
 */
export function recordModelGatewayRouteDecision(event) {
    const record = Object.freeze(cloneRouteDecisionEvent(event));
    ROUTE_DECISION_LEDGER.push(record);
    while (ROUTE_DECISION_LEDGER.length > DEFAULT_ROUTE_DECISION_LEDGER_LIMIT) {
        ROUTE_DECISION_LEDGER.shift();
    }
    return record;
}

/**
 * @param {{ limit?: number }} [options]
 * @returns {ReturnType<typeof import('./events.js').buildRouteDecisionEvent>[]}
 */
export function listModelGatewayRouteDecisions(options = {}) {
    const limit =
        typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
            ? Math.floor(options.limit)
            : 50;
    return ROUTE_DECISION_LEDGER.slice(-limit).reverse().map(cloneRouteDecisionEvent);
}

/**
 * Deduplicates a route-decision stream by `decisionId` while keeping first-seen ordering and the most recent event
 * payload for each id. This is useful for scripts that capture pre-decision and runtime outcome events before writing
 * them to SQLite in one batch.
 *
 * @param {(ReturnType<typeof import('./events.js').buildRouteDecisionEvent> | null | undefined)[]} events
 * @returns {ReturnType<typeof import('./events.js').buildRouteDecisionEvent>[]}
 */
export function dedupeModelGatewayRouteDecisionEvents(events) {
    const validEvents = events.filter(
        /** @returns {event is ReturnType<typeof import('./events.js').buildRouteDecisionEvent>} */
        (event) => event !== null && event !== undefined && typeof event.decisionId === 'string',
    );
    return [
        ...new Map(validEvents.map((event) => [String(event.decisionId), cloneRouteDecisionEvent(event)])).values(),
    ];
}

/**
 * Creates a bounded-to-the-current-operation route-decision recorder. The returned `record` function has the same shape
 * as `recordModelGatewayRouteDecision`, so it can be injected into runtime selector execution and later flushed to an
 * operational store.
 *
 * @param {{ delegate?: typeof recordModelGatewayRouteDecision }} [options]
 * @returns {{
 *     record: typeof recordModelGatewayRouteDecision;
 *     list: () => ReturnType<typeof import('./events.js').buildRouteDecisionEvent>[];
 *     listUnique: () => ReturnType<typeof import('./events.js').buildRouteDecisionEvent>[];
 *     count: () => number;
 * }}
 */
export function createModelGatewayRouteDecisionCapture(options = {}) {
    /** @type {ReturnType<typeof import('./events.js').buildRouteDecisionEvent>[]} */
    const events = [];
    const delegate = typeof options.delegate === 'function' ? options.delegate : null;
    return Object.freeze({
        record: (event) => {
            const record = cloneRouteDecisionEvent(event);
            events.push(record);
            return delegate ? delegate(record) : record;
        },
        list: () => events.map(cloneRouteDecisionEvent),
        listUnique: () => dedupeModelGatewayRouteDecisionEvents(events),
        count: () => events.length,
    });
}

/**
 * @returns {void}
 */
export function resetModelGatewayRouteDecisionLedgerForTests() {
    ROUTE_DECISION_LEDGER.length = 0;
}
