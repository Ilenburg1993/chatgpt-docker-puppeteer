// @ts-check
/**
 * Bounded syntax validator for the canonical DevContainer Bash surface.
 *
 * Each file is parsed independently by ShellCheck in Bash mode at severity=error. Child lifecycle is delegated to the
 * neutral MCP process supervisor: timeout means termination was requested and physical `close` was observed, never a
 * synthetic timer completion.
 *
 * @module copilot/mcp/validation/devcontainer-shell/runtime
 */

import { createAttachedChildProcessSupervisor } from '#copilot/infra/public/process/supervision';
import { MCP_WORKSPACE_ROOT } from '#copilot/mcp/public/workspace';
import { spawn } from 'node:child_process';
import process from 'node:process';

const PER_FILE_TIMEOUT_MS = 20_000;
const MAX_BUFFER_BYTES = 64 * 1024;
const DEFAULT_CONCURRENCY = 4;

export const DEVCONTAINER_BASH_SYNTAX_FILES = Object.freeze([
    '.devcontainer/scripts/healthcheck.sh',
    '.devcontainer/scripts/network-control-plane-state.sh',
    '.devcontainer/scripts/post-attach.sh',
    '.devcontainer/scripts/post-create.sh',
    '.devcontainer/scripts/post-start.sh',
    '.devcontainer/scripts/sync-local-auth.sh',
    '.devcontainer/scripts/validate-env.sh',
    '.devcontainer/scripts/network/copilot-route-advisor.sh',
    '.devcontainer/scripts/network/github-api-route-fix.sh',
    '.devcontainer/scripts/network/github-copilot-network-manager.sh',
    '.devcontainer/scripts/network/lib/endpoint-registry.sh',
    '.devcontainer/scripts/network/local-copilot-proxy.sh',
    '.devcontainer/scripts/network/local-dns-cache.sh',
]);

/** @param {string} current @param {unknown} chunk */
function appendBoundedOutput(current, chunk) {
    const next = `${current}${String(chunk ?? '')}`;
    return next.length <= MAX_BUFFER_BYTES ? next : next.slice(-MAX_BUFFER_BYTES);
}

/**
 * Low-level bounded process primitive kept private from the public validation membrane and exposed only via testing.
 * It is useful for proving timeout/close semantics without depending on ShellCheck behavior.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ timeoutMs: number; cwd?: string; env: Readonly<NodeJS.ProcessEnv>; signal?: AbortSignal }} options
 */
export async function runBoundedDevcontainerValidationProcess(command, args, options) {
    const startedAt = performance.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    /** @type {string | null} */
    let spawnError = null;
    if (!options.env) throw new TypeError('DevContainer validation process requires an explicit child environment.');
    const env = { ...options.env };

    /** @type {import('node:child_process').ChildProcess} */
    let child;
    try {
        child = spawn(command, args, {
            cwd: options.cwd ?? MCP_WORKSPACE_ROOT,
            env,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            timedOut: false,
            cancelled: false,
            terminationRequested: false,
            exitCode: null,
            signal: null,
            durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
            stdout: '',
            stderr: message,
            lifecycleState: 'closed',
        };
    }

    const supervisor = createAttachedChildProcessSupervisor(child, { processGroup: true });
    child.stdout?.on('data', (chunk) => {
        stdout = appendBoundedOutput(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
        stderr = appendBoundedOutput(stderr, chunk);
    });
    child.once('error', (error) => {
        spawnError = error.message;
    });
    const onAbort = () => {
        cancelled = true;
        supervisor.requestTermination({ graceMs: 1_000, initialSignal: 'SIGTERM', forceSignal: 'SIGKILL' });
    };
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });
    const timeoutTimer = setTimeout(() => {
        timedOut = true;
        supervisor.requestTermination({ graceMs: 0, initialSignal: 'SIGKILL', forceSignal: 'SIGKILL' });
    }, options.timeoutMs);
    timeoutTimer.unref();

    const closed = await supervisor.closed;
    clearTimeout(timeoutTimer);
    options.signal?.removeEventListener('abort', onAbort);
    if (spawnError) stderr = appendBoundedOutput(stderr, spawnError);
    return {
        ok: !timedOut && !cancelled && spawnError === null && closed.exitCode === 0,
        timedOut,
        cancelled,
        terminationRequested: closed.terminationRequested,
        exitCode: closed.exitCode,
        signal: closed.signal,
        durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        lifecycleState: 'closed',
    };
}

/**
 * @param {string} file
 * @param {{ timeoutMs?: number; childEnvironment: Readonly<NodeJS.ProcessEnv>; signal?: AbortSignal }} options
 */
export async function validateDevcontainerBashFile(file, options) {
    if (!options?.childEnvironment)
        throw new TypeError('DevContainer Bash validation requires an explicit child environment.');
    const timeoutMs =
        Number.isInteger(options.timeoutMs) && Number(options.timeoutMs) > 0
            ? Number(options.timeoutMs)
            : PER_FILE_TIMEOUT_MS;
    const result = await runBoundedDevcontainerValidationProcess(
        'shellcheck',
        ['--shell=bash', '--severity=error', '--format=gcc', file],
        {
            timeoutMs,
            cwd: MCP_WORKSPACE_ROOT,
            env: options.childEnvironment,
            ...(options.signal ? { signal: options.signal } : {}),
        },
    );
    return {
        file,
        ok: result.ok,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
        killScope: result.timedOut ? (process.platform === 'win32' ? 'child' : 'process-group') : null,
        terminationRequested: result.terminationRequested,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        lifecycleState: result.lifecycleState,
    };
}

/**
 * @param {readonly string[]} files
 * @param {{
 *     concurrency?: number;
 *     timeoutMs?: number;
 *     childEnvironment: Readonly<NodeJS.ProcessEnv>;
 *     signal?: AbortSignal;
 *     onResult?: (row: Awaited<ReturnType<typeof validateDevcontainerBashFile>>) => void;
 * }} options
 */
export async function validateDevcontainerBashFiles(files, options) {
    if (!options?.childEnvironment)
        throw new TypeError('DevContainer Bash validation requires an explicit child environment.');
    const concurrency = Number.isInteger(options.concurrency)
        ? Math.max(1, Math.min(8, Number(options.concurrency)))
        : DEFAULT_CONCURRENCY;
    /** @type {Array<Awaited<ReturnType<typeof validateDevcontainerBashFile>> | undefined>} */
    const results = new Array(files.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
        while (true) {
            if (options.signal?.aborted) return;
            const index = cursor;
            cursor += 1;
            if (index >= files.length) return;
            const file = files[index];
            if (file === undefined) return;
            const row = await validateDevcontainerBashFile(file, {
                childEnvironment: options.childEnvironment,
                ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
                ...(options.signal ? { signal: options.signal } : {}),
            });
            results[index] = row;
            options.onResult?.(row);
        }
    });
    await Promise.all(workers);
    const completedResults = results.filter((row) => row !== undefined);
    const failed = completedResults.filter((row) => row.ok !== true);
    return {
        ok: completedResults.length === files.length && failed.length === 0,
        fileCount: files.length,
        passedCount: completedResults.filter((row) => row.ok === true).length,
        failedCount: failed.length + Math.max(0, files.length - completedResults.length),
        concurrency,
        perFileTimeoutMs: Number.isInteger(options.timeoutMs) ? Number(options.timeoutMs) : PER_FILE_TIMEOUT_MS,
        results: completedResults,
    };
}

/** @param {import('../config.js').McpValidationProcessConfig} config @returns {Promise<number>} */
export async function runDevcontainerShellValidationCli(config) {
    if (!config)
        throw new TypeError('DevContainer shell validation CLI requires a validation process config generation.');
    const report = await validateDevcontainerBashFiles(DEVCONTAINER_BASH_SYNTAX_FILES, {
        childEnvironment: config.childEnvironment,
        onResult: (row) => {
            process.stdout.write(
                `[devcontainer-shell] ${row.ok ? 'ok' : row.timedOut ? 'timeout' : 'failed'} ${row.file} ${String(row.durationMs)}ms${row.killScope ? ` kill=${row.killScope}` : ''}${row.stderr ? ` :: ${row.stderr.replaceAll('\n', ' ').slice(0, 500)}` : ''}\n`,
            );
        },
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
}
