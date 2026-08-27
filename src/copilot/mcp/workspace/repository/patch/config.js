// @ts-check
/** Immutable process-scoped repository patch autonomy policy. */

export const MCP_REPOSITORY_PATCH_CONFIG_SCHEMA_VERSION = 1;
export const MCP_REPOSITORY_PATCH_CONFIG_KIND = 'copilot-mcp-repository-patch-config';

/**
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     kind: 'copilot-mcp-repository-patch-config';
 *     exactSelfRepairEnabled: boolean;
 *     exactSelfRepairMaxAttempts: 1;
 *     policyKey: string;
 * }>} McpRepositoryPatchConfig
 */

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env @returns {McpRepositoryPatchConfig} */
export function readMcpRepositoryPatchConfig(env) {
    if (!env) throw new TypeError('Repository patch config requires an explicit environment.');
    const disabled = readBoolean(env['COPILOT_MCP_PATCH_EXACT_SELF_REPAIR_DISABLED'], false);
    const exactSelfRepairEnabled = !disabled;
    return Object.freeze({
        schemaVersion: MCP_REPOSITORY_PATCH_CONFIG_SCHEMA_VERSION,
        kind: MCP_REPOSITORY_PATCH_CONFIG_KIND,
        exactSelfRepairEnabled,
        exactSelfRepairMaxAttempts: 1,
        policyKey: `v1:exact-self-repair:${exactSelfRepairEnabled ? 'enabled' : 'disabled'}:max-1`,
    });
}

/** @param {unknown} value @param {boolean} fallback */
function readBoolean(value, fallback) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}
