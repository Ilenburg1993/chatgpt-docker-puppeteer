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

/** @type {Array<ReturnType<import('./events.js').buildRouteDecisionEvent>>} */
const ROUTE_DECISION_LEDGER = [];

/**
 * @param {ReturnType<import('./events.js').buildRouteDecisionEvent>} event
 * @returns {ReturnType<import('./events.js').buildRouteDecisionEvent>}
 */
export function recordModelGatewayRouteDecision(event) {
    const record = Object.freeze({ ...event, fallbackChain: [...event.fallbackChain], reasons: [...event.reasons] });
    ROUTE_DECISION_LEDGER.push(record);
    while (ROUTE_DECISION_LEDGER.length > DEFAULT_ROUTE_DECISION_LEDGER_LIMIT) {
        ROUTE_DECISION_LEDGER.shift();
    }
    return record;
}

/**
 * @param {{ limit?: number }} [options]
 * @returns {Array<ReturnType<import('./events.js').buildRouteDecisionEvent>>}
 */
export function listModelGatewayRouteDecisions(options = {}) {
    const limit =
        typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
            ? Math.floor(options.limit)
            : 50;
    return ROUTE_DECISION_LEDGER.slice(-limit).reverse().map((event) => ({
        ...event,
        fallbackChain: [...event.fallbackChain],
        reasons: [...event.reasons],
    }));
}

/**
 * @returns {void}
 */
export function resetModelGatewayRouteDecisionLedgerForTests() {
    ROUTE_DECISION_LEDGER.length = 0;
}
