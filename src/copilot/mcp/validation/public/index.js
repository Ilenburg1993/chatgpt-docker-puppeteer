// @ts-check
/** Public runtime membrane for MCP validation jobs. */

/** @typedef {import('../jobs/runtime.js').CopilotValidatorName} CopilotValidatorName */
/** @typedef {import('../jobs/runtime.js').PublicJobRecord} PublicJobRecord */

export {
    COPILOT_VALIDATOR_NAMES,
    canRunCopilotValidatorInline,
    cancelJob,
    isCopilotValidatorName,
    listJobs,
    normalizeFocusedUnitTestFiles,
    readCopilotValidatorCapacityState,
    readJobOutput,
    resolveFocusedUnitTestCommand,
    resolveValidatorCommand,
    runCopilotValidatorInline,
    spawnValidatorJob,
    waitForJobCompletion,
} from '../jobs/runtime.js';

export {
    cancelValidationJob,
    executeValidatorRequest,
    listValidationJobs,
    readLastValidationSummary,
    readValidationDashboard,
    readValidationJobOutput,
    readValidationJobSummary,
    startValidatorJobOperation,
    summarizeValidationJob,
} from '../jobs/operations.js';
