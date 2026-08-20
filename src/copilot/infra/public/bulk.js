// @ts-check
/**
 * Public facade for bounded protocol-agnostic bulk execution.
 *
 * Application/tool layers should import this facade instead of the broad `#copilot/infra` barrel so the dependency
 * surface remains stable and language-service resolution does not depend on the full infrastructure export graph.
 *
 * @module copilot/infra/public/bulk
 */

export {
    DEFAULT_BULK_CONCURRENCY,
    DEFAULT_BULK_MAX_ITEMS,
    HARD_BULK_MAX_ITEMS,
    MAX_BULK_CONCURRENCY,
    runBoundedOperationBatch,
} from '../bulk-executor.js';
