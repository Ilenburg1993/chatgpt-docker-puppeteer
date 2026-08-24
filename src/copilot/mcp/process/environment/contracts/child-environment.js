// @ts-check
/**
 * Child-process environment projection for generic MCP execution capabilities.
 *
 * Execution authority and ambient credential authority are intentionally separate. Generic child
 * processes inherit only an operational environment required for normal shell/Node tooling. Any
 * additional variable must be supplied explicitly by the caller/owning operation.
 *
 * This is not a secret-name blacklist. Unknown parent variables are excluded by construction, so a
 * newly introduced credential cannot silently become terminal authority merely because its name was
 * not anticipated here.
 *
 * @module copilot/mcp/process/environment/contracts/child-environment
 */

export const MCP_CHILD_ENVIRONMENT_POLICY_VERSION = '1.0.0';

const OPERATIONAL_ENVIRONMENT_KEYS = Object.freeze(
    new Set([
        'COLORTERM',
        'COREPACK_HOME',
        'FORCE_COLOR',
        'HOME',
        'LANG',
        'LANGUAGE',
        'LOGNAME',
        'NODE_COMPILE_CACHE',
        'NODE_DISABLE_COMPILE_CACHE',
        'NO_COLOR',
        'PATH',
        'PNPM_HOME',
        'SHELL',
        'TEMP',
        'TERM',
        'TMP',
        'TMPDIR',
        'TZ',
        'USER',
        'UV_CACHE_DIR',
        'XDG_CACHE_HOME',
        'XDG_CONFIG_HOME',
        'XDG_DATA_HOME',
        'XDG_RUNTIME_DIR',
    ]),
);

const OPERATIONAL_ENVIRONMENT_PREFIXES = Object.freeze(['LC_']);

/**
 * @typedef {{
 *     parentEnv?: NodeJS.ProcessEnv;
 *     overrides?: Record<string, string | null>;
 *     inheritOperationalEnv?: boolean;
 * }} McpChildEnvironmentOptions
 *
 * @typedef {Readonly<{
 *     policyVersion: string;
 *     inheritance: 'operational' | 'none';
 *     ambientCredentialInheritance: false;
 *     inheritedKeyCount: number;
 *     explicitOverrideCount: number;
 *     removedOverrideCount: number;
 * }>} McpChildEnvironmentProjection
 */

/**
 * Build the environment for a generic MCP child process.
 *
 * Explicit overrides intentionally accept any syntactically valid environment key. This preserves
 * arbitrary-process freedom while requiring credential-bearing operations to possess and inject the
 * credential explicitly rather than receiving every credential owned by the parent MCP process.
 *
 * @param {McpChildEnvironmentOptions} [options]
 * @returns {{ env: NodeJS.ProcessEnv; projection: McpChildEnvironmentProjection }}
 */
export function buildMcpChildEnvironment(options = {}) {
    const parentEnv = options.parentEnv ?? process.env;
    const inheritOperationalEnv = options.inheritOperationalEnv !== false;
    /** @type {NodeJS.ProcessEnv} */
    const env = {};
    let inheritedKeyCount = 0;

    if (inheritOperationalEnv) {
        for (const [key, value] of Object.entries(parentEnv)) {
            if (value === undefined || !isOperationalEnvironmentKey(key)) continue;
            env[key] = value;
            inheritedKeyCount += 1;
        }
    }

    let explicitOverrideCount = 0;
    let removedOverrideCount = 0;
    if (options.overrides && typeof options.overrides === 'object') {
        for (const [key, value] of Object.entries(options.overrides)) {
            if (!isValidEnvironmentKey(key)) continue;
            if (value === null) {
                delete env[key];
                removedOverrideCount += 1;
                continue;
            }
            env[key] = String(value);
            explicitOverrideCount += 1;
        }
    }

    return {
        env,
        projection: Object.freeze({
            policyVersion: MCP_CHILD_ENVIRONMENT_POLICY_VERSION,
            inheritance: inheritOperationalEnv ? 'operational' : 'none',
            ambientCredentialInheritance: false,
            inheritedKeyCount,
            explicitOverrideCount,
            removedOverrideCount,
        }),
    };
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isOperationalEnvironmentKey(key) {
    if (OPERATIONAL_ENVIRONMENT_KEYS.has(key)) return true;
    return OPERATIONAL_ENVIRONMENT_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function isValidEnvironmentKey(key) {
    return Boolean(key) && !key.includes('\0') && !key.includes('=');
}
