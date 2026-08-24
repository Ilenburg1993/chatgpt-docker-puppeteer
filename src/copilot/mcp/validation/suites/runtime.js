// @ts-check
/**
 * Sequential allowlisted validation suites for the MCP/Copilot workspace.
 *
 * Suite policy, runtime configuration and child lifecycle are owned here. scripts/ contains only the stable executable
 * launcher. Importing this module does not enable caches or create runtime resources.
 *
 * @module copilot/mcp/validation/suites/runtime
 */

import {
    enableCopilotNodeCompileCache,
    readCopilotNodeCompileCacheConfig,
    withCopilotNodeCompileCacheEnv,
} from '#copilot/infra/public/platform/node';
import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';
import { createAttachedChildProcessSupervisor } from '#copilot/mcp/public/process/supervision';
import { MCP_WORKSPACE_ROOT } from '#copilot/mcp/public/workspace';
import { spawn } from 'node:child_process';
import process from 'node:process';

/**
 * @typedef {'mcp-fast' | 'mcp-full' | 'copilot-fast'} SafeValidationSuiteName
 *
 * @typedef {object} SafeValidationStep
 * @property {string} name
 * @property {string} command
 * @property {string[]} args
 *
 * @typedef {object} SafeValidationStepResult
 * @property {string} name
 * @property {string} commandLine
 * @property {number} durationMs
 * @property {number | null} exitCode
 * @property {NodeJS.Signals | null} signal
 * @property {boolean} passed
 * @property {boolean} cancelled
 * @property {string | null} error
 */

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

/** @type {Record<SafeValidationSuiteName, SafeValidationStep[]>} */
const SAFE_VALIDATION_SUITES = {
    'mcp-fast': [
        { name: 'typecheck', command: npmCommand, args: ['run', 'typecheck:strict:src.copilot'] },
        {
            name: 'unit-mcp',
            command: npxCommand,
            args: ['vitest', '--config', 'vitest.copilot.config.js', 'run', 'tests/unit/copilot/mcp'],
        },
    ],
    'mcp-full': [
        { name: 'typecheck', command: npmCommand, args: ['run', 'typecheck:strict:src.copilot'] },
        { name: 'lint', command: npmCommand, args: ['run', 'lint:copilot'] },
        { name: 'docs-contract', command: npmCommand, args: ['run', 'copilot:docs:check'] },
        { name: 'architecture-contract', command: npmCommand, args: ['run', 'copilot:architecture:check'] },
        {
            name: 'unit-mcp',
            command: npxCommand,
            args: ['vitest', '--config', 'vitest.copilot.config.js', 'run', 'tests/unit/copilot/mcp'],
        },
    ],
    'copilot-fast': [
        { name: 'typecheck', command: npmCommand, args: ['run', 'typecheck:strict:src.copilot'] },
        { name: 'lint', command: npmCommand, args: ['run', 'lint:copilot'] },
        { name: 'docs-contract', command: npmCommand, args: ['run', 'copilot:docs:check'] },
        { name: 'architecture-contract', command: npmCommand, args: ['run', 'copilot:architecture:check'] },
        { name: 'unit-copilot', command: npmCommand, args: ['run', 'test:copilot:unit'] },
    ],
};

/** @returns {SafeValidationSuiteName[]} */
export function listSafeValidationSuites() {
    return /** @type {SafeValidationSuiteName[]} */ (Object.keys(SAFE_VALIDATION_SUITES));
}

/** @param {SafeValidationSuiteName} suite @returns {SafeValidationStep[]} */
export function resolveSafeValidationSuite(suite) {
    const steps = SAFE_VALIDATION_SUITES[suite];
    if (!steps) throw new Error(`Unsupported validation suite: ${String(suite)}`);
    return steps.map((step) => ({ ...step, args: [...step.args] }));
}

/**
 * @param {SafeValidationSuiteName} suite
 * @param {{ signal?: AbortSignal; parentEnv?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<{
 *     success: boolean;
 *     suite: SafeValidationSuiteName;
 *     durationMs: number;
 *     results: SafeValidationStepResult[];
 * }>}
 */
export async function runSafeValidationSuite(suite, options = {}) {
    const startedAt = Date.now();
    const parentEnv = options.parentEnv ?? process.env;
    const nodeCompileCacheConfig = readCopilotNodeCompileCacheConfig(parentEnv);
    const nodeCompileCache = enableCopilotNodeCompileCache(nodeCompileCacheConfig);
    const { env } = buildMcpChildEnvironment({ parentEnv, overrides: { NO_COLOR: '' } });
    const stepEnv = withCopilotNodeCompileCacheEnv(env, nodeCompileCacheConfig);
    /** @type {SafeValidationStepResult[]} */
    const results = [];

    for (const step of resolveSafeValidationSuite(suite)) {
        if (options.signal?.aborted) break;
        const result = await runStep(step, {
            env: stepEnv,
            nodeCompileCache,
            ...(options.signal ? { signal: options.signal } : {}),
        });
        results.push(result);
        if (!result.passed) break;
    }
    return {
        success:
            results.length === resolveSafeValidationSuite(suite).length && results.every((result) => result.passed),
        suite,
        durationMs: Date.now() - startedAt,
        results,
    };
}

/**
 * @param {SafeValidationStep} step
 * @param {{
 *     env: NodeJS.ProcessEnv;
 *     nodeCompileCache: ReturnType<typeof enableCopilotNodeCompileCache>;
 *     signal?: AbortSignal;
 * }} runtime
 * @returns {Promise<SafeValidationStepResult>}
 */
async function runStep(step, runtime) {
    const startedAt = Date.now();
    const commandLine = [step.command, ...step.args].join(' ');
    process.stdout.write(`\n[safe-suite:step:start] ${step.name}\n$ ${commandLine}\n`);
    if (runtime.nodeCompileCache.attempted && runtime.nodeCompileCache.directory) {
        process.stdout.write(
            `[safe-suite:node-compile-cache] status=${runtime.nodeCompileCache.status} statusName=${runtime.nodeCompileCache.statusName ?? 'unknown'} enabled=${runtime.nodeCompileCache.enabled} dir=${runtime.nodeCompileCache.directory} error=${runtime.nodeCompileCache.error ?? 'none'}\n`,
        );
    }

    /** @type {import('node:child_process').ChildProcess} */
    let child;
    try {
        child = spawn(step.command, step.args, {
            cwd: MCP_WORKSPACE_ROOT,
            env: runtime.env,
            stdio: ['ignore', 'inherit', 'inherit'],
            detached: process.platform !== 'win32',
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[safe-suite:step:error] ${step.name}: ${message}\n`);
        return {
            name: step.name,
            commandLine,
            durationMs: Date.now() - startedAt,
            exitCode: 1,
            signal: null,
            passed: false,
            cancelled: false,
            error: message,
        };
    }

    const supervisor = createAttachedChildProcessSupervisor(child, { processGroup: true });
    /** @type {string | null} */
    let spawnError = null;
    let cancelled = false;
    child.once('error', (error) => {
        spawnError = error.message;
    });
    const onAbort = () => {
        cancelled = true;
        supervisor.requestTermination({ graceMs: 1500, initialSignal: 'SIGTERM', forceSignal: 'SIGKILL' });
    };
    if (runtime.signal?.aborted) onAbort();
    else runtime.signal?.addEventListener('abort', onAbort, { once: true });

    const closed = await supervisor.closed;
    runtime.signal?.removeEventListener('abort', onAbort);
    if (spawnError) process.stderr.write(`[safe-suite:step:error] ${step.name}: ${spawnError}\n`);
    const result = {
        name: step.name,
        commandLine,
        durationMs: Date.now() - startedAt,
        exitCode: closed.exitCode,
        signal: closed.signal,
        passed: closed.exitCode === 0 && !cancelled && spawnError === null,
        cancelled,
        error: spawnError,
    };
    process.stdout.write(
        `[safe-suite:step:${result.passed ? 'pass' : 'fail'}] ${step.name} durationMs=${String(result.durationMs)} exitCode=${String(
            result.exitCode,
        )} signal=${String(result.signal)} cancelled=${String(result.cancelled)}\n`,
    );
    return result;
}

/**
 * Stable launcher-facing entrypoint. Domain code returns a numeric exit code and never mutates process.exitCode.
 *
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function runSafeValidationSuiteCli(argv) {
    const rawSuite = argv[0];
    if (!rawSuite || rawSuite === '--help' || rawSuite === 'help') {
        process.stdout.write('Usage: node src/copilot/mcp/scripts/run-safe-validation-suite.js <suite>\n');
        process.stdout.write(`Suites: ${listSafeValidationSuites().join(', ')}\n`);
        return rawSuite ? 0 : 1;
    }
    if (!listSafeValidationSuites().includes(/** @type {SafeValidationSuiteName} */ (rawSuite))) {
        process.stderr.write(`Unsupported validation suite: ${rawSuite}\n`);
        return 1;
    }
    const report = await runSafeValidationSuite(/** @type {SafeValidationSuiteName} */ (rawSuite));
    process.stdout.write(`\n[safe-suite:summary]\n${JSON.stringify(report, null, 2)}\n`);
    return report.success ? 0 : 1;
}
