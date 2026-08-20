// @ts-check
/**
 * Facade pública de policies reutilizáveis por tools.
 *
 * @module copilot/infra/public/policy
 */

export {
    DEFAULT_IO_SEARCH_MAX_BUFFER_BYTES,
    DEFAULT_IO_SEARCH_TIMEOUT_MS,
    DEFAULT_PROCESS_MAX_BUFFER_BYTES,
    DEFAULT_PROCESS_TIMEOUT_MS,
    IO_CAPABILITY,
    IO_RISK,
    MIN_BUFFER_BYTES,
    MIN_TIMEOUT_MS,
    capabilityForCreate,
    hasNullByte,
    isPathInsideWorkspace,
    normalizePathResourceKey,
    normalizePositiveIntegerBudget,
    normalizeWorkspaceRoot,
    readEnvPositiveIntegerBudget,
    resolveIoSearchBudget,
    resolveProcessExecutionBudget,
    resolveWorkspaceCandidate,
    riskForDryRun,
    riskForOverwrite,
} from '../policy/index.js';

export {
    createValidatedMutableWorkspacePath,
    createValidatedReadWorkspacePath,
} from '../io/policy/validated-path.js';
