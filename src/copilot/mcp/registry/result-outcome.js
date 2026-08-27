// @ts-check
/**
 * Bounded result-outcome projection for MCP tool completion audit.
 *
 * This owner intentionally inspects only the top-level result envelope and the top-level
 * `structuredContent.success` / `structuredContent.code` fields. It never serializes messages,
 * arbitrary details, source text, terminal output, paths, environment values or nested payloads.
 *
 * Result classes are deliberately fail-closed. Only explicitly catalogued codes are promoted to
 * `option-config` or `precondition`; an unknown/new code remains `domain-or-unknown` so telemetry
 * cannot hide a new defect behind a broad naming heuristic.
 *
 * @module copilot/mcp/registry/result-outcome
 */

const RESULT_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,95}$/u;

/**
 * @typedef {'success' | 'tool-error' | 'domain-failure'} McpToolResultState
 * @typedef {'success' | 'option-config' | 'precondition' | 'domain-or-unknown' | 'uncoded-failure'} McpToolResultClass
 * @typedef {{ resultState: McpToolResultState; resultClass: McpToolResultClass; resultCode?: string }} McpToolResultOutcome
 */

/**
 * Project only bounded semantic outcome facts from a tool result.
 *
 * @param {unknown} result
 * @returns {McpToolResultOutcome}
 */
export function projectMcpToolResultOutcome(result) {
    const envelope = isRecord(result) ? result : {};
    const structured = isRecord(envelope['structuredContent']) ? envelope['structuredContent'] : {};
    const resultCode = sanitizeMcpToolResultCode(structured['code']);
    const resultState =
        envelope['isError'] === true
            ? /** @type {const} */ ('tool-error')
            : structured['success'] === false
              ? /** @type {const} */ ('domain-failure')
              : /** @type {const} */ ('success');

    /** @type {McpToolResultClass} */
    let resultClass = 'success';
    if (resultState !== 'success') {
        resultClass = resultCode ? classifyMcpToolResultCode(resultCode) : 'uncoded-failure';
    }

    return {
        resultState,
        resultClass,
        ...(resultCode ? { resultCode } : {}),
    };
}

/**
 * Accept only a short machine code. Arbitrary messages/paths/details are rejected rather than
 * truncated because truncation could accidentally transform untrusted content into a plausible
 * telemetry label.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function sanitizeMcpToolResultCode(value) {
    if (typeof value !== 'string') return null;
    const code = value.trim();
    return RESULT_CODE_PATTERN.test(code) ? code : null;
}

/**
 * Explicit, immutable code classification. A switch is intentional here: architecture governance
 * rejects top-level mutable lookup collections, and a broad naming regex would silently classify
 * future defects. New machine codes must therefore be reviewed before receiving a narrow class.
 *
 * @param {string} code
 * @returns {'option-config' | 'precondition' | 'domain-or-unknown'}
 */
function classifyMcpToolResultCode(code) {
    switch (code) {
        case 'ERR_BATCH_CONFIRM_REQUIRED':
        case 'ERR_BATCH_CONFLICTING_MODE':
        case 'ERR_BATCH_INVALID_ITEM':
        case 'ERR_BATCH_OPTIONS_WITHOUT_BATCH':
        case 'ERR_BULK_INSPECT_INVALID_ITEM':
        case 'ERR_BULK_INSPECT_INVALID_READ':
        case 'ERR_BULK_INSPECT_INVALID_SEARCH':
        case 'ERR_BULK_INSPECT_INVALID_STAT':
        case 'ERR_FILE_BATCH_OPTION_INACTIVE':
        case 'ERR_MOVE_CONFIRM_OVERWRITE_REQUIRED':
        case 'ERR_PATCH_BATCH_CONFIRM_REQUIRED':
        case 'ERR_PATCH_BATCH_INPUT_BYTES_LIMIT':
        case 'ERR_PATCH_BATCH_INPUT_SERIALIZATION':
        case 'ERR_PATCH_BATCH_OPERATION_LIMIT':
        case 'ERR_PATCH_BATCH_TARGET_LIMIT':
        case 'ERR_PATCH_BATCH_OPTION_INACTIVE':
        case 'ERR_PATCH_CONFLICTING_MODE':
        case 'ERR_PATCH_OPTION_INACTIVE':
        case 'ERR_POST_PATCH_VALIDATION_CONFIG':
        case 'ERR_POST_PATCH_VALIDATION_RECURSION_GUARD':
        case 'ERR_REMOVE_CONFIRM_REQUIRED':
        case 'ERR_RESTORE_CONFIRM_OVERWRITE_REQUIRED':
        case 'ERR_SEARCH_ALIAS_CONFLICT':
        case 'ERR_TERMINAL_COMMAND_REQUIRED':
        case 'ERR_TERMINAL_EXEC_SHAPE':
        case 'ERR_TERMINAL_SESSION_ACTION_OPTIONS':
        case 'ERR_TERMINAL_SESSION_ID_REQUIRED':
        case 'ERR_TERMINAL_SESSION_READ_ACTION_OPTIONS':
        case 'ERR_TERMINAL_SESSION_WAIT_REQUIRES_READ':
        case 'ERR_TERMINAL_SESSION_WAIT_REQUIRES_WAIT_FOR':
        case 'ERR_VALIDATOR_BATCH_CONFLICTING_MODE':
        case 'ERR_VALIDATOR_BATCH_INVALID_ITEM':
        case 'ERR_VALIDATOR_BATCH_OPTIONS_WITHOUT_BATCH':
        case 'ERR_VALIDATOR_REQUEST_INVALID':
            return 'option-config';
        case 'EEXPECTEDHASH':
        case 'ERR_GIT_HEAD_PRECONDITION':
        case 'ERR_GIT_UPSTREAM_PRECONDITION':
            return 'precondition';
        default:
            return 'domain-or-unknown';
    }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
