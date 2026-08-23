// @ts-check
/**
 * Canonical SDK tool-surface policy for local filesystem and command execution.
 *
 * This module owns the names and exclusion rules used when the project-local tool surface is complete. It does not
 * decide presentation routing; it only describes which SDK built-ins must be hidden to avoid competing execution paths.
 *
 * @module copilot/sdk/tools/local-surface-policy
 */

/** @type {readonly string[]} */
export const CANONICAL_LOCAL_FS_TOOL_NAMES = Object.freeze([
    'list_directory',
    'read_file_content',
    'search_in_files',
    'create_file',
    'write_file_content',
    'patch_file',
]);

/** SDK file built-ins that compete with the canonical project-local filesystem surface. @type {readonly string[]} */
export const SDK_LOCAL_FS_TOOL_NAMES = Object.freeze(['view', 'glob']);

/** @type {readonly string[]} */
export const CANONICAL_LOCAL_EXEC_TOOL_NAMES = Object.freeze(['exec_command']);

/** SDK shell built-ins that compete with the canonical project-local execution surface. @type {readonly string[]} */
export const SDK_SHELL_TOOL_NAMES = Object.freeze(['bash', 'write_bash', 'read_bash', 'stop_bash']);

/**
 * @param {readonly string[]} toolNames
 * @returns {boolean}
 */
export function hasCanonicalLocalFsTools(toolNames) {
    return CANONICAL_LOCAL_FS_TOOL_NAMES.every((name) => toolNames.includes(name));
}

/**
 * @param {readonly string[]} toolNames
 * @returns {boolean}
 */
export function hasCanonicalLocalExecTools(toolNames) {
    return CANONICAL_LOCAL_EXEC_TOOL_NAMES.every((name) => toolNames.includes(name));
}

/**
 * Builds the effective SDK excluded-tools set from the capabilities actually loaded in the project-local registry.
 *
 * @param {readonly string[]} toolNames
 * @param {readonly string[]} [baseExcluded=[]]
 * @returns {string[]}
 */
export function buildCanonicalLocalSurfaceExcludedTools(toolNames, baseExcluded = []) {
    const excluded = new Set(baseExcluded);
    if (hasCanonicalLocalFsTools(toolNames)) {
        for (const name of SDK_LOCAL_FS_TOOL_NAMES) excluded.add(name);
    }
    if (hasCanonicalLocalExecTools(toolNames)) {
        for (const name of SDK_SHELL_TOOL_NAMES) excluded.add(name);
    }
    return [...excluded].sort();
}
