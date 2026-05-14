// @ts-check
/**
 * Barrel de policies internas de infra.
 *
 * @module copilot/infra/policy
 */

export { limitTextLines, normalizeCursorOffset, normalizeMaxResults, windowItems, windowTextLines } from './output-window.js';
export {
    hasNullByte,
    isPathInsideWorkspace,
    normalizePathResourceKey,
    normalizeWorkspaceRoot,
    resolveWorkspaceCandidate,
} from './path-resource.js';
export {
    DEFAULT_IO_SEARCH_MAX_BUFFER_BYTES,
    DEFAULT_IO_SEARCH_TIMEOUT_MS,
    DEFAULT_PROCESS_MAX_BUFFER_BYTES,
    DEFAULT_PROCESS_TIMEOUT_MS,
    MIN_BUFFER_BYTES,
    MIN_TIMEOUT_MS,
    normalizePositiveIntegerBudget,
    readEnvPositiveIntegerBudget,
    resolveIoSearchBudget,
    resolveProcessExecutionBudget,
} from './budgets.js';
export { assertExpectedSha256 } from './preconditions.js';
