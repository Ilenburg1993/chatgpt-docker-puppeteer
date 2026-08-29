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

import { createAttachedChildProcessSupervisor } from '#copilot/infra/public/process/supervision';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { IO_CACHE_BENCHMARK_STATE_PATH } from './benchmark-state.js';
import { IO_CACHE_BENCHMARK_LAUNCHER, assertIoCacheBenchmarkRequestId } from './contracts.js';

/**
 * @typedef {{
 *     workspaceRoot: string;
 *     runnerEnvironment: Readonly<NodeJS.ProcessEnv>;
 *     signal?: AbortSignal;
 * }} IoCacheBenchmarkScheduleInput
 *
 * @typedef {{
 *     spawnChild?: typeof spawn;
 *     createRequestId?: () => string;
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
    if (!input.runnerEnvironment) {
        throw new TypeError('IO cache benchmark scheduling requires a projected runner environment.');
    }
    if (input.signal?.aborted) throw input.signal.reason ?? new Error('IO cache benchmark scheduling aborted.');

    const requestId = assertIoCacheBenchmarkRequestId(
        dependencies.createRequestId?.() ?? `mcp-io-cache-benchmark-${randomUUID()}`,
    );
    const spawnChild = dependencies.spawnChild ?? spawn;
    const child = spawnChild(process.execPath, [IO_CACHE_BENCHMARK_LAUNCHER, '--request-id', requestId], {
        cwd: input.workspaceRoot,
        env: { ...input.runnerEnvironment },
        detached: true,
        stdio: 'ignore',
    });

    const supervisor = createAttachedChildProcessSupervisor(child, { processGroup: true });
    const abortSignal = input.signal;
    let accepted = false;
    const terminateBeforeAcceptance = () => {
        if (accepted) return;
        supervisor.requestTermination({ graceMs: 1_000, initialSignal: 'SIGTERM', forceSignal: 'SIGKILL' });
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
            await supervisor.closed;
            throw abortSignal.reason ?? new Error('IO cache benchmark scheduling aborted before acceptance.');
        }
        accepted = true;
        child.unref();
        return { requestId, runnerPid: child.pid, stateFile: IO_CACHE_BENCHMARK_STATE_PATH };
    } finally {
        abortSignal?.removeEventListener('abort', terminateBeforeAcceptance);
        if (!accepted && child.pid && supervisor.snapshot().state !== 'closed') {
            terminateBeforeAcceptance();
            await supervisor.closed;
        }
    }
}
