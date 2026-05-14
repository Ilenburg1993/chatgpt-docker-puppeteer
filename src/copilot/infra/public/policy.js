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
    MIN_BUFFER_BYTES,
    MIN_TIMEOUT_MS,
    normalizePositiveIntegerBudget,
    readEnvPositiveIntegerBudget,
    resolveIoSearchBudget,
    resolveProcessExecutionBudget,
} from '../policy/index.js';
