// @ts-check
/**
 * Sequential allowlisted validation suites for the ChatGPT MCP connector.
 *
 * @module copilot/mcp/scripts/run-safe-validation-suite
 */

import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { enableCopilotNodeCompileCache, withCopilotNodeCompileCacheEnv } from '../runtime/node-compile-cache.js';

const nodeCompileCache = enableCopilotNodeCompileCache();

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
 * @property {string | null} signal
 * @property {boolean} passed
 */

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

/** @type {Record<SafeValidationSuiteName, SafeValidationStep[]>} */
const SAFE_VALIDATION_SUITES = {
    'mcp-fast': [
        {
            name: 'typecheck',
            command: npmCommand,
            args: ['run', 'typecheck:strict:src.copilot'],
        },
        {
            name: 'unit-mcp',
            command: npxCommand,
            args: ['vitest', '--config', 'vitest.copilot.config.js', 'run', 'tests/unit/copilot/mcp'],
        },
    ],
    'mcp-full': [
        {
            name: 'typecheck',
            command: npmCommand,
            args: ['run', 'typecheck:strict:src.copilot'],
        },
        {
            name: 'lint',
            command: npmCommand,
            args: ['run', 'lint:copilot'],
        },
        {
            name: 'docs-contract',
            command: npmCommand,
            args: ['run', 'copilot:docs:check'],
        },
        {
            name: 'architecture-contract',
            command: npmCommand,
            args: ['run', 'copilot:architecture:check'],
        },
        {
            name: 'unit-mcp',
            command: npxCommand,
            args: ['vitest', '--config', 'vitest.copilot.config.js', 'run', 'tests/unit/copilot/mcp'],
        },
    ],
    'copilot-fast': [
        {
            name: 'typecheck',
            command: npmCommand,
            args: ['run', 'typecheck:strict:src.copilot'],
        },
        {
            name: 'lint',
            command: npmCommand,
            args: ['run', 'lint:copilot'],
        },
        {
            name: 'docs-contract',
            command: npmCommand,
            args: ['run', 'copilot:docs:check'],
        },
        {
            name: 'architecture-contract',
            command: npmCommand,
            args: ['run', 'copilot:architecture:check'],
        },
        {
            name: 'unit-copilot',
            command: npmCommand,
            args: ['run', 'test:copilot:unit'],
        },
    ],
};

/**
 * @returns {SafeValidationSuiteName[]}
 */
export function listSafeValidationSuites() {
    return /** @type {SafeValidationSuiteName[]} */ (Object.keys(SAFE_VALIDATION_SUITES));
}

/**
 * @param {SafeValidationSuiteName} suite
 * @returns {SafeValidationStep[]}
 */
export function resolveSafeValidationSuite(suite) {
    const steps = SAFE_VALIDATION_SUITES[suite];
    if (!steps) throw new Error(`Unsupported validation suite: ${String(suite)}`);
    return steps.map((step) => ({ ...step, args: [...step.args] }));
}

/**
 * @param {SafeValidationSuiteName} suite
 * @returns {Promise<{
 *     success: boolean;
 *     suite: SafeValidationSuiteName;
 *     durationMs: number;
 *     results: SafeValidationStepResult[];
 * }>}
 */
export async function runSafeValidationSuite(suite) {
    const startedAt = Date.now();
    const results = [];
    for (const step of resolveSafeValidationSuite(suite)) {
        const result = await runStep(step);
        results.push(result);
        if (!result.passed) break;
    }
    const success = results.every((result) => result.passed);
    return {
        success,
        suite,
        durationMs: Date.now() - startedAt,
        results,
    };
}

/**
 * @param {SafeValidationStep} step
 * @returns {Promise<SafeValidationStepResult>}
 */
async function runStep(step) {
    const startedAt = Date.now();
    const commandLine = [step.command, ...step.args].join(' ');
    process.stdout.write(`\n[safe-suite:step:start] ${step.name}\n$ ${commandLine}\n`);
    if (nodeCompileCache.attempted && nodeCompileCache.directory) {
        process.stdout.write(
            `[safe-suite:node-compile-cache] status=${nodeCompileCache.status} statusName=${nodeCompileCache.statusName ?? 'unknown'} enabled=${nodeCompileCache.enabled} dir=${nodeCompileCache.directory} error=${nodeCompileCache.error ?? 'none'}\n`,
        );
    }
    const result = await new Promise((resolve) => {
        const child = spawn(step.command, step.args, {
            cwd: process.cwd(),
            env: withCopilotNodeCompileCacheEnv({ ...process.env, NO_COLOR: '' }),
            stdio: ['ignore', 'inherit', 'inherit'],
        });
        child.on('error', (error) => {
            process.stderr.write(`[safe-suite:step:error] ${step.name}: ${error.message}\n`);
            resolve({
                name: step.name,
                commandLine,
                durationMs: Date.now() - startedAt,
                exitCode: 1,
                signal: null,
                passed: false,
            });
        });
        child.on('exit', (exitCode, signal) => {
            resolve({
                name: step.name,
                commandLine,
                durationMs: Date.now() - startedAt,
                exitCode,
                signal,
                passed: exitCode === 0,
            });
        });
    });
    process.stdout.write(
        `[safe-suite:step:${result.passed ? 'pass' : 'fail'}] ${step.name} durationMs=${result.durationMs} exitCode=${String(
            result.exitCode,
        )} signal=${String(result.signal)}\n`,
    );
    return result;
}

/**
 * @param {string | undefined} rawSuite
 * @returns {SafeValidationSuiteName}
 */
function parseSuiteArg(rawSuite) {
    if (!rawSuite || rawSuite === '--help' || rawSuite === 'help') {
        process.stdout.write(`Usage: node src/copilot/mcp/scripts/run-safe-validation-suite.js <suite>\n`);
        process.stdout.write(`Suites: ${listSafeValidationSuites().join(', ')}\n`);
        process.exitCode = rawSuite ? 0 : 1;
        return 'mcp-fast';
    }
    if (listSafeValidationSuites().includes(/** @type {SafeValidationSuiteName} */ (rawSuite))) {
        return /** @type {SafeValidationSuiteName} */ (rawSuite);
    }
    throw new Error(`Unsupported validation suite: ${rawSuite}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const suite = parseSuiteArg(process.argv[2]);
    if (!process.exitCode) {
        const report = await runSafeValidationSuite(suite);
        process.stdout.write(`\n[safe-suite:summary]\n${JSON.stringify(report, null, 2)}\n`);
        if (!report.success) process.exitCode = 1;
    }
}
