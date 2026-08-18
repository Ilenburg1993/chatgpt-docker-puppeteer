// @ts-check
/**
 * Bounded syntax validator for the canonical DevContainer Bash surface.
 *
 * Each file is parsed independently by ShellCheck in Bash mode at severity=error.
 * This validates syntax/high-confidence shell errors without executing lifecycle
 * code and avoids the observed pathological non-termination of `bash -n` on some
 * production monoliths. The runner still owns a dedicated POSIX process group per
 * parse so a pathological parser cannot pin the validator job indefinitely.
 *
 * @module copilot/mcp/scripts/validate-devcontainer-shell
 */

import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PER_FILE_TIMEOUT_MS = 20_000;
const TIMEOUT_SETTLE_GRACE_MS = 250;
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

/** @param {import('node:child_process').ChildProcess} child */
function killValidationProcessGroup(child) {
    if (typeof child.pid === 'number' && child.pid > 0 && process.platform !== 'win32') {
        try {
            process.kill(-child.pid, 'SIGKILL');
            return 'process-group';
        } catch {
            // Fall through to direct child kill. The result remains timeout-classified.
        }
    }
    try {
        child.kill('SIGKILL');
        return 'child';
    } catch {
        return 'kill-failed';
    }
}

/**
 * @param {string} file
 * @param {{ timeoutMs?: number }} [options]
 */
export async function validateDevcontainerBashFile(file, options = {}) {
    const timeoutMs = Number.isInteger(options.timeoutMs) && Number(options.timeoutMs) > 0
        ? Number(options.timeoutMs)
        : PER_FILE_TIMEOUT_MS;
    const startedAt = performance.now();

    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        /** @type {'process-group' | 'child' | 'kill-failed' | null} */
        let killScope = null;
        let settled = false;
        /** @type {NodeJS.Timeout | null} */
        let timeoutTimer = null;
        /** @type {NodeJS.Timeout | null} */
        let settleTimer = null;

        const child = spawn('shellcheck', ['--shell=bash', '--severity=error', '--format=gcc', file], {
            cwd: WORKSPACE_ROOT,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        /** @param {number | null} exitCode @param {NodeJS.Signals | null} signal @param {Error | null} [spawnError] */
        const finish = (exitCode, signal, spawnError = null) => {
            if (settled) return;
            settled = true;
            if (timeoutTimer) clearTimeout(timeoutTimer);
            if (settleTimer) clearTimeout(settleTimer);
            if (spawnError) stderr = appendBoundedOutput(stderr, spawnError.message);
            const ok = !timedOut && spawnError === null && exitCode === 0;
            resolve({
                file,
                ok,
                timedOut,
                killScope,
                exitCode,
                signal,
                durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
            });
        };

        child.stdout?.on('data', (chunk) => {
            stdout = appendBoundedOutput(stdout, chunk);
        });
        child.stderr?.on('data', (chunk) => {
            stderr = appendBoundedOutput(stderr, chunk);
        });
        child.once('error', (error) => finish(null, null, error));
        child.once('close', (exitCode, signal) => finish(exitCode, signal));

        timeoutTimer = setTimeout(() => {
            timedOut = true;
            killScope = killValidationProcessGroup(child);
            child.stdout?.destroy();
            child.stderr?.destroy();
            child.unref();
            settleTimer = setTimeout(() => finish(null, 'SIGKILL'), TIMEOUT_SETTLE_GRACE_MS);
            settleTimer.unref?.();
        }, timeoutMs);
    });
}

/**
 * @param {readonly string[]} files
 * @param {{ concurrency?: number; timeoutMs?: number; onResult?: (row: Awaited<ReturnType<typeof validateDevcontainerBashFile>>) => void }} [options]
 */
export async function validateDevcontainerBashFiles(files, options = {}) {
    const concurrency = Number.isInteger(options.concurrency)
        ? Math.max(1, Math.min(8, Number(options.concurrency)))
        : DEFAULT_CONCURRENCY;
    const results = new Array(files.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= files.length) return;
            const file = files[index];
            if (file === undefined) return;
            const row = await validateDevcontainerBashFile(
                file,
                options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
            );
            results[index] = row;
            options.onResult?.(row);
        }
    });
    await Promise.all(workers);
    const failed = results.filter((row) => row?.ok !== true);
    return {
        ok: failed.length === 0,
        fileCount: files.length,
        passedCount: files.length - failed.length,
        failedCount: failed.length,
        concurrency,
        perFileTimeoutMs: Number.isInteger(options.timeoutMs) ? Number(options.timeoutMs) : PER_FILE_TIMEOUT_MS,
        results,
    };
}

async function main() {
    const report = await validateDevcontainerBashFiles(DEVCONTAINER_BASH_SYNTAX_FILES, {
        onResult: (row) => {
            process.stdout.write(
                `[devcontainer-shell] ${row.ok ? 'ok' : row.timedOut ? 'timeout' : 'failed'} ${row.file} ${row.durationMs}ms${row.killScope ? ` kill=${row.killScope}` : ''}${row.stderr ? ` :: ${row.stderr.replaceAll('\n', ' ').slice(0, 500)}` : ''}\n`,
            );
        },
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    await main();
}
