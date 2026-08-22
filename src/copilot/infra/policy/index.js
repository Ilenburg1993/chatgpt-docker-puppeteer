// @ts-check
/**
 * Barrel de policies internas de infra.
 *
 * @module copilot/infra/policy
 */

/** @typedef {import('./workspace-path.js').WorkspacePathPolicySuccess} WorkspacePathPolicySuccess */
/** @typedef {import('./workspace-path.js').WorkspacePathPolicyFailure} WorkspacePathPolicyFailure */
/** @typedef {import('./workspace-path.js').WorkspacePathPolicyResult} WorkspacePathPolicyResult */

export {
    DEFAULT_IO_SEARCH_MAX_BUFFER_BYTES,
    DEFAULT_IO_SEARCH_TIMEOUT_MS,
    DEFAULT_PROCESS_MAX_BUFFER_BYTES,
    DEFAULT_PROCESS_TIMEOUT_MS,
    MIN_BUFFER_BYTES,
    MIN_TIMEOUT_MS,
    activateProcessBudgetConfig,
    getActiveIoSearchBudget,
    getActiveProcessBudgetOwnerSnapshot,
    normalizePositiveIntegerBudget,
    readIoSearchBudgetConfig,
    resolveIoSearchBudget,
    resolveProcessExecutionBudget,
} from './budgets.js';
export { IO_CAPABILITY, capabilityForCreate } from './capabilities.js';
export {
    attachSuppressedMutationError,
    isMutationAppliedError,
    markMutationAppliedError,
    normalizeMutationError,
    readMutationAppliedState,
} from './mutation-state.js';
export {
    limitTextLines,
    normalizeCursorOffset,
    normalizeMaxResults,
    windowItems,
    windowTextLines,
} from './output-window.js';
export {
    assertValidIoFilePath,
    hasNullByte,
    isPathInsideWorkspace,
    normalizePathResourceKey,
    normalizeWorkspaceRoot,
    resolveWorkspaceCandidate,
} from './path-resource.js';
export { assertExpectedSha256, assertExpectedSha256Digest } from './preconditions.js';
export { IO_RISK, riskForDryRun, riskForOverwrite } from './risk.js';
export {
    DEFAULT_BLOCKED_PATH_SEGMENTS,
    DEFAULT_BLOCKED_READ_PATH_PATTERNS,
    DEFAULT_BLOCKED_WRITE_PATH_PATTERNS,
    IO_PATH_POLICY_VERSION,
    evaluateWorkspacePathContainment,
    evaluateWorkspacePathPolicy,
    findWorkspaceBlockedPathPattern,
    normalizeWorkspaceBlockedPatterns,
    normalizeWorkspaceBlockedSegments,
    normalizeWorkspacePathPolicyMode,
    splitWorkspacePathSegments,
    workspacePathPolicyFailure,
} from './workspace-path.js';
