// @ts-check
/** Immutable process-scoped policy for the shaped MCP repository read cache. */

export const MCP_REPO_READ_CACHE_CONFIG_SCHEMA_VERSION = 1;
export const MCP_REPO_READ_CACHE_CONFIG_KIND = 'copilot-mcp-repo-read-cache-config';
export const DEFAULT_REPO_READ_FILE_CACHE_MAX_BYTES = 8 * 1024 * 1024;
export const HARD_REPO_READ_FILE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
export const DEFAULT_REPO_READ_TRUST_WINDOW_MS = 250;

/**
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     kind: 'copilot-mcp-repo-read-cache-config';
 *     maxBytes: number;
 *     trustWindowMs: number;
 *     policyKey: string;
 * }>} McpRepoReadCacheConfig
 */

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env @returns {McpRepoReadCacheConfig} */
export function readMcpRepoReadCacheConfig(env) {
    if (!env) throw new TypeError('Repository read-cache config requires an explicit environment.');
    const trustWindowCandidate = Number(
        env['COPILOT_MCP_REPO_READ_TRUST_WINDOW_MS'] ?? DEFAULT_REPO_READ_TRUST_WINDOW_MS,
    );
    const trustWindowMs =
        Number.isFinite(trustWindowCandidate) && trustWindowCandidate > 0
            ? Math.min(5000, Math.floor(trustWindowCandidate))
            : 0;
    const maxBytesCandidate = Number(
        env['COPILOT_MCP_REPO_READ_CACHE_MAX_BYTES'] ?? DEFAULT_REPO_READ_FILE_CACHE_MAX_BYTES,
    );
    const maxBytes =
        !Number.isFinite(maxBytesCandidate) || maxBytesCandidate <= 0
            ? DEFAULT_REPO_READ_FILE_CACHE_MAX_BYTES
            : Math.min(HARD_REPO_READ_FILE_CACHE_MAX_BYTES, Math.floor(maxBytesCandidate));
    return Object.freeze({
        schemaVersion: MCP_REPO_READ_CACHE_CONFIG_SCHEMA_VERSION,
        kind: MCP_REPO_READ_CACHE_CONFIG_KIND,
        maxBytes,
        trustWindowMs,
        policyKey: `v1:${String(trustWindowMs)}:${String(maxBytes)}`,
    });
}
