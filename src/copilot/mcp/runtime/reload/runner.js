// @ts-check
/**
 * Controlled MCP reload runtime.
 *
 * This owner accepts only a generated request id, a bounded delay and one of the canonical Cloudflare transport
 * profiles. The stable script launcher delegates here; subprocess lifecycle, environment projection and persisted
 * reload truth belong to this runtime rather than to scripts/.
 *
 * @module copilot/mcp/runtime/reload/runner
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';
import {
    createAttachedChildProcessSupervisor,
    signalProcessTreeDetailed,
} from '#copilot/mcp/public/process/supervision';
import { MCP_WORKSPACE_ROOT } from '#copilot/mcp/public/workspace';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { MCP_RELOAD_MAX_DELAY_MS, MCP_RELOAD_MIN_DELAY_MS } from './plan.js';
import { MCP_RELOAD_STATE_FILE } from './state.js';

const STATE_FILE = resolve(MCP_WORKSPACE_ROOT, MCP_RELOAD_STATE_FILE);
const RELOAD_STATE_FS = createConfiguredFsIo(
    createConfiguredFsGrant({
        id: 'mcp.runtime.reload.runner',
        exactPaths: [STATE_FILE],
        operations: ['write'],
        symlinkPolicy: 'deny',
        durability: ['file-and-directory'],
    }),
);
const RUNNER_PROFILE_TARGETS = Object.freeze({
    quic: 'copilot:mcp:quic:restart',
    h2: 'copilot:mcp:h2:restart',
    auto: 'copilot:mcp:auto:restart',
});
const REQUEST_ID_RE = /^mcp-reload-[a-z0-9-]{8,80}$/u;
const RELOAD_RUNNER_LAUNCHER = 'src/copilot/mcp/scripts/scheduled-restart-runner.js';
const RESTART_CHILD_TIMEOUT_MS = 120_000;

/** @param {number} ms */
function sleep(ms) {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** @param {Record<string, unknown>} state */
async function writeState(state) {
    await RELOAD_STATE_FS.writeFileAtomic(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

/** @param {string} profile */
function targetForProfile(profile) {
    const target = RUNNER_PROFILE_TARGETS[/** @type {keyof typeof RUNNER_PROFILE_TARGETS} */ (profile)];
    if (!target) throw new Error(`Unsupported restart profile: ${profile}`);
    return target;
}

/** @param {string[]} argv */
function parseArgs(argv) {
    /** @param {string} name */
    const read = (name) => {
        const index = argv.indexOf(name);
        return index >= 0 ? (argv[index + 1] ?? '') : '';
    };
    const requestId = read('--request-id');
    const profile = read('--profile');
    const delayMs = Number(read('--delay-ms'));
    if (!REQUEST_ID_RE.test(requestId)) throw new Error('Invalid generated request id.');
    if (!Object.hasOwn(RUNNER_PROFILE_TARGETS, profile)) throw new Error('Invalid restart profile.');
    if (!Number.isInteger(delayMs) || delayMs < MCP_RELOAD_MIN_DELAY_MS || delayMs > MCP_RELOAD_MAX_DELAY_MS) {
        throw new Error('Invalid restart delay.');
    }
    return { requestId, profile, delayMs, target: targetForProfile(profile) };
}

/**
 * Project only generic operational state plus the explicitly configured stateful-env path. Restart-specific auth,
 * Cloudflare and persistence settings are declared by the allowlisted npm scripts themselves and therefore do not need
 * ambient inheritance from the calling MCP process.
 *
 * @param {NodeJS.ProcessEnv} [parentEnv]
 */
export function buildControlledReloadRunnerEnvironment(parentEnv = process.env) {
    /** @type {Record<string, string | null>} */
    const overrides = {};
    const statefulEnvFile = parentEnv['COPILOT_MCP_STATEFUL_ENV_FILE'];
    if (statefulEnvFile !== undefined) overrides['COPILOT_MCP_STATEFUL_ENV_FILE'] = statefulEnvFile;
    return buildMcpChildEnvironment({ parentEnv, overrides }).env;
}

/**
 * Schedule the detached stable reload launcher after persisting launch intent. The promise resolves only after Node has
 * observed the child `spawn` event; only then is the request accepted by the caller-facing API. Completion is reported
 * asynchronously through the fixed reload state file.
 *
 * @param {{
 *     workspace: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 *     profile: string;
 *     delayMs: number;
 *     reason: string | null;
 *     parentEnv?: NodeJS.ProcessEnv;
 *     signal?: AbortSignal;
 * }} input
 */
export async function scheduleControlledMcpReload(input) {
    if (!input.workspace) throw new TypeError('Controlled reload scheduling requires a workspace capability.');
    if (input.signal?.aborted) {
        throw input.signal.reason ?? new Error('Controlled MCP reload scheduling aborted before acceptance.');
    }
    const target = targetForProfile(input.profile);
    if (
        !Number.isInteger(input.delayMs) ||
        input.delayMs < MCP_RELOAD_MIN_DELAY_MS ||
        input.delayMs > MCP_RELOAD_MAX_DELAY_MS
    ) {
        throw new Error('Invalid restart delay.');
    }
    const requestId = `mcp-reload-${randomUUID()}`;
    const requestedAt = Date.now();
    const launchingState = {
        schemaVersion: 1,
        status: 'launching',
        requestedAt,
        requestId,
        profile: input.profile,
        delayMs: input.delayMs,
        target,
        reason: input.reason,
        requestedByPid: process.pid,
    };
    await input.workspace.io.writeFileAtomic(MCP_RELOAD_STATE_FILE, `${JSON.stringify(launchingState, null, 2)}\n`);

    const env = buildControlledReloadRunnerEnvironment(input.parentEnv ?? process.env);
    /** @type {import('node:child_process').ChildProcess | undefined} */
    let child;
    let accepted = false;
    const terminateBeforeAcceptance = () => {
        if (accepted || !child?.pid) return;
        signalProcessTreeDetailed(child.pid, 'SIGTERM', { child, processGroup: true });
    };
    input.signal?.addEventListener('abort', terminateBeforeAcceptance, { once: true });
    try {
        child = spawn(
            process.execPath,
            [
                RELOAD_RUNNER_LAUNCHER,
                '--profile',
                input.profile,
                '--delay-ms',
                String(input.delayMs),
                '--request-id',
                requestId,
            ],
            {
                cwd: MCP_WORKSPACE_ROOT,
                env,
                detached: true,
                stdio: 'ignore',
            },
        );
        await new Promise((resolvePromise, rejectPromise) => {
            /** @param {Error} error */
            const onError = (error) => rejectPromise(error);
            child?.once('error', onError);
            child?.once('spawn', () => {
                child?.off('error', onError);
                child?.on('error', () => {});
                resolvePromise(undefined);
            });
        });
        if (!child.pid) throw new Error('Controlled MCP reload launcher did not expose a child pid.');
        if (input.signal?.aborted) {
            terminateBeforeAcceptance();
            throw input.signal.reason ?? new Error('Controlled MCP reload scheduling aborted before acceptance.');
        }
        const acceptedAt = Date.now();
        accepted = true;
        child.unref();
        return { requestId, requestedAt, acceptedAt, runnerPid: child.pid, target };
    } catch (error) {
        terminateBeforeAcceptance();
        const message = error instanceof Error ? error.message : String(error);
        await input.workspace.io.writeFileAtomic(
            MCP_RELOAD_STATE_FILE,
            `${JSON.stringify({ ...launchingState, status: 'failed', completedAt: Date.now(), error: message }, null, 2)}\n`,
        );
        throw error;
    } finally {
        input.signal?.removeEventListener('abort', terminateBeforeAcceptance);
    }
}

/**
 * @param {string} target
 * @param {NodeJS.ProcessEnv} [parentEnv]
 * @returns {Promise<{ exitCode: number; timedOut: boolean; error: string | null }>}
 */
async function runRestart(target, parentEnv = process.env) {
    const env = buildControlledReloadRunnerEnvironment(parentEnv);
    let child;
    try {
        child = spawn(process.execPath, ['src/copilot/mcp/scripts/stateful-env.js', 'run', target], {
            cwd: MCP_WORKSPACE_ROOT,
            env,
            stdio: 'ignore',
            detached: process.platform !== 'win32',
        });
    } catch (error) {
        return {
            exitCode: 1,
            timedOut: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }

    const supervisor = createAttachedChildProcessSupervisor(child, { processGroup: true });
    let timedOut = false;
    /** @type {string | null} */
    let spawnError = null;
    child.once('error', (error) => {
        spawnError = error.message;
    });
    const timer = setTimeout(() => {
        timedOut = true;
        supervisor.requestTermination({ graceMs: 3000, initialSignal: 'SIGTERM', forceSignal: 'SIGKILL' });
    }, RESTART_CHILD_TIMEOUT_MS);
    timer.unref();

    const closed = await supervisor.closed;
    clearTimeout(timer);
    const exitCode = Number(closed.exitCode ?? (closed.signal || spawnError ? 1 : 0));
    return {
        exitCode,
        timedOut,
        error: timedOut
            ? `restart child timed out after ${String(RESTART_CHILD_TIMEOUT_MS)}ms`
            : (spawnError ?? (closed.signal ? `restart child terminated by ${closed.signal}` : null)),
    };
}

/** @param {{ requestId: string; profile: string; delayMs: number; target: string }} input */
async function executeControlledReload(input) {
    const scheduledAt = Date.now();
    await writeState({
        schemaVersion: 1,
        status: 'scheduled',
        scheduledAt,
        requestId: input.requestId,
        profile: input.profile,
        delayMs: input.delayMs,
        target: input.target,
        runnerPid: process.pid,
    });
    await sleep(input.delayMs);
    const startedAt = Date.now();
    await writeState({
        schemaVersion: 1,
        status: 'running',
        scheduledAt,
        startedAt,
        requestId: input.requestId,
        profile: input.profile,
        delayMs: input.delayMs,
        target: input.target,
        runnerPid: process.pid,
    });
    const result = await runRestart(input.target);
    await writeState({
        schemaVersion: 1,
        status: result.exitCode === 0 ? 'completed' : 'failed',
        scheduledAt,
        startedAt,
        completedAt: Date.now(),
        requestId: input.requestId,
        profile: input.profile,
        delayMs: input.delayMs,
        target: input.target,
        runnerPid: process.pid,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        error: result.error,
    });
    return result.exitCode;
}

/**
 * Stable script-facing entrypoint. Errors are converted into persisted failure evidence and an exit code rather than
 * mutating process.exitCode inside the domain runtime.
 *
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function runControlledMcpReloadCli(argv) {
    try {
        return await executeControlledReload(parseArgs(argv));
    } catch (error) {
        try {
            await writeState({
                schemaVersion: 1,
                status: 'failed',
                completedAt: Date.now(),
                error: error instanceof Error ? error.message : String(error),
            });
        } catch {
            // Best effort: there is no safe recovery path if the fixed state file itself cannot be written.
        }
        return 1;
    }
}
