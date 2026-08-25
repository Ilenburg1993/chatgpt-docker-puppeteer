// @ts-check
/** Immutable process generation for MCP validation jobs and safe suites. */

import { readCopilotNodeCompileCacheConfig, withCopilotNodeCompileCacheEnv } from '#copilot/infra/public/platform/node';
import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';

export const MCP_VALIDATION_PROCESS_CONFIG_SCHEMA_VERSION = 1;
export const MCP_VALIDATION_PROCESS_CONFIG_KIND = 'copilot-mcp-validation-process-config';
export const DEFAULT_VALIDATOR_VITEST_MAX_WORKERS = 2;

/**
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     kind: 'copilot-mcp-validation-process-config';
 *     inlineAllowed: boolean;
 *     vitestMaxWorkers: number;
 *     nodeCompileCache: Readonly<ReturnType<typeof readCopilotNodeCompileCacheConfig>>;
 *     childEnvironment: Readonly<NodeJS.ProcessEnv>;
 * }>} McpValidationProcessConfig
 */

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env */
export function resolveValidatorVitestMaxWorkers(env) {
    const candidate = Number(env['COPILOT_VALIDATOR_VITEST_MAX_WORKERS'] ?? env['VITEST_MAX_WORKERS']);
    if (Number.isInteger(candidate) && candidate >= 1 && candidate <= 4) return candidate;
    return DEFAULT_VALIDATOR_VITEST_MAX_WORKERS;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {McpValidationProcessConfig}
 */
export function readMcpValidationProcessConfig(env) {
    if (!env) throw new TypeError('MCP validation process config requires an explicit environment.');
    const vitestMaxWorkers = resolveValidatorVitestMaxWorkers(env);
    const nodeCompileCache = Object.freeze({ ...readCopilotNodeCompileCacheConfig(env) });
    const { env: operationalEnvironment } = buildMcpChildEnvironment({
        parentEnv: env,
        overrides: {
            NO_COLOR: '',
            VITEST_MAX_WORKERS: String(vitestMaxWorkers),
        },
    });
    const childEnvironment = Object.freeze({
        ...withCopilotNodeCompileCacheEnv(operationalEnvironment, nodeCompileCache),
    });
    return Object.freeze({
        schemaVersion: MCP_VALIDATION_PROCESS_CONFIG_SCHEMA_VERSION,
        kind: MCP_VALIDATION_PROCESS_CONFIG_KIND,
        inlineAllowed: !env['VITEST'] && env['NODE_ENV'] !== 'test',
        vitestMaxWorkers,
        nodeCompileCache,
        childEnvironment,
    });
}
