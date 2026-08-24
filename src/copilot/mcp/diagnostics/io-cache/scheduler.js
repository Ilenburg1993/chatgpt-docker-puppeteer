// @ts-check
/**
 * Detached scheduling boundary for the representative MCP IO-cache benchmark.
 *
 * The wire/tool layer never owns launcher identity, child environment or spawn lifecycle. A schedule call is accepted
 * only after Node observes the child `spawn` event. Cancellation before acceptance terminates the child tree instead of
 * publishing a detached task that the caller never received.
 *
 * @module copilot/mcp/diagnostics/io-cache/scheduler
 */

import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';
import { signalProcessTreeDetailed } from '#copilot/mcp/public/process/supervision';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { IO_CACHE_BENCHMARK_STATE_PATH } from './benchmark-state.js';
import { IO_CACHE_BENCHMARK_LAUNCHER, assertIoCacheBenchmarkRequestId } from './contracts.js';

/**
 * @typedef {{
 *     workspaceRoot: string;
 *     signal?: AbortSignal;
 * }} IoCacheBenchmarkScheduleInput
 *
 * @typedef {{
 *     spawnChild?: typeof spawn;
 *     createRequestId?: () => string;
 *     parentEnv?: NodeJS.ProcessEnv;
 * }} IoCacheBenchmarkSchedulerDependencies
 */

/**
 * @param {IoCacheBenchmarkScheduleInput} input
 * @returns {Promise<{ requestId: string; runnerPid: number; stateFile: string }>}
 */
export function scheduleIoCacheBenchmark(input) {
    return scheduleIoCacheBenchmarkWithDependencies(input, {});
}

/**
 * Narrow dependency-injected seam used only by the owner testing membrane.
 *
 * @param {IoCacheBenchmarkScheduleInput} input
 * @param {IoCacheBenchmarkSchedulerDependencies} dependencies
 * @returns {Promise<{ requestId: string; runnerPid: number; stateFile: string }>}
 */
export async function scheduleIoCacheBenchmarkWithDependencies(input, dependencies) {
    if (!input?.workspaceRoot) throw new TypeError('IO cache benchmark scheduling requires workspaceRoot.');
    if (input.signal?.aborted) throw input.signal.reason ?? new Error('IO cache benchmark scheduling aborted.');

    const requestId = assertIoCacheBenchmarkRequestId(
        dependencies.createRequestId?.() ?? `mcp-io-cache-benchmark-${randomUUID()}`,
    );
    const { env } = buildMcpChildEnvironment({ parentEnv: dependencies.parentEnv ?? process.env });
    const spawnChild = dependencies.spawnChild ?? spawn;
    const child = spawnChild(process.execPath, [IO_CACHE_BENCHMARK_LAUNCHER, '--request-id', requestId], {
        cwd: input.workspaceRoot,
        env,
        detached: true,
        stdio: 'ignore',
    });

    const abortSignal = input.signal;
    let accepted = false;
    const terminateBeforeAcceptance = () => {
        if (accepted) return;
        signalProcessTreeDetailed(child.pid, 'SIGTERM', { child, processGroup: true });
    };
    abortSignal?.addEventListener('abort', terminateBeforeAcceptance, { once: true });
    try {
        await new Promise((resolvePromise, rejectPromise) => {
            /** @param {Error} error */
            const onError = (error) => rejectPromise(error);
            child.once('error', onError);
            child.once('spawn', () => {
                child.off('error', onError);
                child.on('error', () => {});
                resolvePromise(undefined);
            });
        });
        if (!child.pid) throw new Error('IO cache benchmark launcher did not expose a child pid.');
        if (abortSignal?.aborted) {
            terminateBeforeAcceptance();
            throw abortSignal.reason ?? new Error('IO cache benchmark scheduling aborted before acceptance.');
        }
        accepted = true;
        child.unref();
        return { requestId, runnerPid: child.pid, stateFile: IO_CACHE_BENCHMARK_STATE_PATH };
    } finally {
        abortSignal?.removeEventListener('abort', terminateBeforeAcceptance);
        if (!accepted && child.pid) terminateBeforeAcceptance();
    }
}
