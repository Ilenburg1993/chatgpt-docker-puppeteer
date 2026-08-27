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
import { createAttachedChildProcessSupervisor } from '#copilot/mcp/public/process/supervision';
import { buildMcpRuntimeSourcePromotionEnvironment } from '#copilot/mcp/public/runtime/source-generation';
import { MCP_WORKSPACE_ROOT } from '#copilot/mcp/public/workspace';
import { verifyRepositorySourceBarrierManifest } from '#copilot/mcp/public/workspace/repository/integrity';
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
const SOURCE_BARRIER_CLI = 'src/copilot/mcp/scripts/source-barrier.js';
const SOURCE_BARRIER_FINGERPRINT_RE = /^[a-f0-9]{64}$/u;
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
    const sourceBarrierManifestPath = read('--source-barrier-manifest');
    const expectedSourceFingerprint = read('--expected-source-fingerprint').trim().toLowerCase();
    if (!REQUEST_ID_RE.test(requestId)) throw new Error('Invalid generated request id.');
    if (!Object.hasOwn(RUNNER_PROFILE_TARGETS, profile)) throw new Error('Invalid restart profile.');
    if (!Number.isInteger(delayMs) || delayMs < MCP_RELOAD_MIN_DELAY_MS || delayMs > MCP_RELOAD_MAX_DELAY_MS) {
        throw new Error('Invalid restart delay.');
    }
    if (!sourceBarrierManifestPath) throw new Error('Controlled reload requires a source-barrier manifest.');
    if (!SOURCE_BARRIER_FINGERPRINT_RE.test(expectedSourceFingerprint)) {
        throw new Error('Controlled reload requires a valid expected source fingerprint.');
    }
    return {
        requestId,
        profile,
        delayMs,
        target: targetForProfile(profile),
        sourceBarrierManifestPath,
        expectedSourceFingerprint,
    };
}

/**
 * Project only generic operational state plus the explicitly configured stateful-env path. Restart-specific auth,
 * Cloudflare and persistence settings are declared by the allowlisted npm scripts themselves and therefore do not need
 * ambient inheritance from the calling MCP process.
 *
 * @param {NodeJS.ProcessEnv} parentEnv
 * @param {import('#copilot/mcp/public/runtime/source-generation').McpRuntimeSourcePromotionBinding | undefined} [promotionBinding]
 */
export function buildControlledReloadRunnerEnvironment(parentEnv, promotionBinding) {
    /** @type {Record<string, string | null>} */
    const overrides = {};
    const statefulEnvFile = parentEnv['COPILOT_MCP_STATEFUL_ENV_FILE'];
    if (statefulEnvFile !== undefined) overrides['COPILOT_MCP_STATEFUL_ENV_FILE'] = statefulEnvFile;
    if (promotionBinding) Object.assign(overrides, buildMcpRuntimeSourcePromotionEnvironment(promotionBinding));
    return buildMcpChildEnvironment({ parentEnv, overrides }).env;
}

/**
 * Schedule the detached stable reload launcher after persisting launch intent. The promise resolves only after Node has
 * observed the child `spawn` event and caller cancellation has not won that acceptance boundary. Before acceptance,
 * abort/failure terminates and drains the child tree before failed state is persisted.
 *
 * @param {{
 *     workspace: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 *     profile: string;
 *     delayMs: number;
 *     reason: string | null;
 *     runnerEnvironment: Readonly<NodeJS.ProcessEnv>;
 *     sourceBarrierManifestPath: string;
 *     expectedSourceFingerprint: string;
 *     audit?: Pick<ReturnType<typeof import('#copilot/mcp/public/observability').createMcpAuditCapability>, 'readTail'>;
 *     signal?: AbortSignal;
 * }} input
 */
export async function scheduleControlledMcpReload(input) {
    return await scheduleControlledMcpReloadWithDependencies(input, {});
}

/**
 * White-box seam for acceptance/cancellation lifecycle tests.
 *
 * @param {{
 *     workspace: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 *     profile: string;
 *     delayMs: number;
 *     reason: string | null;
 *     runnerEnvironment: Readonly<NodeJS.ProcessEnv>;
 *     sourceBarrierManifestPath: string;
 *     expectedSourceFingerprint: string;
 *     audit?: Pick<ReturnType<typeof import('#copilot/mcp/public/observability').createMcpAuditCapability>, 'readTail'>;
 *     signal?: AbortSignal;
 * }} input
 * @param {{ spawnChild?: typeof spawn; createRequestUuid?: () => string; verifySourceBarrierManifest?: typeof verifyRepositorySourceBarrierManifest }} dependencies
 */
export async function scheduleControlledMcpReloadWithDependencies(input, dependencies) {
    if (!input.workspace) throw new TypeError('Controlled reload scheduling requires a workspace capability.');
    if (input.signal?.aborted) {
        throw input.signal.reason ?? new Error('Controlled MCP reload scheduling aborted before acceptance.');
    }
    const verifySourceBarrierManifest =
        dependencies.verifySourceBarrierManifest ?? verifyRepositorySourceBarrierManifest;
    const sourceBarrier = await verifySourceBarrierManifest(input.workspace, input.sourceBarrierManifestPath, {
        expectedFingerprint: input.expectedSourceFingerprint,
        ...(input.audit ? { audit: input.audit } : {}),
    });
    const target = targetForProfile(input.profile);
    if (
        !Number.isInteger(input.delayMs) ||
        input.delayMs < MCP_RELOAD_MIN_DELAY_MS ||
        input.delayMs > MCP_RELOAD_MAX_DELAY_MS
    ) {
        throw new Error('Invalid restart delay.');
    }
    const requestId = `mcp-reload-${dependencies.createRequestUuid?.() ?? randomUUID()}`;
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
        sourceBarrierManifestPath: sourceBarrier.manifestPath,
        sourceBarrierFingerprint: sourceBarrier.fingerprint,
        sourceBarrierVerifiedAt: sourceBarrier.verifiedAt,
    };
    await input.workspace.io.writeFileAtomic(MCP_RELOAD_STATE_FILE, `${JSON.stringify(launchingState, null, 2)}\n`);

    if (!input.runnerEnvironment)
        throw new TypeError('Controlled reload scheduling requires a projected runner environment.');
    if (input.signal?.aborted) {
        const error = input.signal.reason ?? new Error('Controlled MCP reload scheduling aborted before spawn.');
        await input.workspace.io.writeFileAtomic(
            MCP_RELOAD_STATE_FILE,
            `${JSON.stringify({ ...launchingState, status: 'failed', completedAt: Date.now(), error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`,
        );
        throw error;
    }
    const env = { ...input.runnerEnvironment };
    const spawnChild = dependencies.spawnChild ?? spawn;
    /** @type {import('node:child_process').ChildProcess | undefined} */
    let child;
    /** @type {ReturnType<typeof createAttachedChildProcessSupervisor> | null} */
    let supervisor = null;
    let accepted = false;
    /** @type {(() => void) | null} */
    let terminateBeforeAcceptance = null;
    try {
        child = spawnChild(
            process.execPath,
            [
                RELOAD_RUNNER_LAUNCHER,
                '--profile',
                input.profile,
                '--delay-ms',
                String(input.delayMs),
                '--request-id',
                requestId,
                '--source-barrier-manifest',
                sourceBarrier.manifestPath,
                '--expected-source-fingerprint',
                sourceBarrier.fingerprint,
            ],
            {
                cwd: MCP_WORKSPACE_ROOT,
                env,
                detached: true,
                stdio: 'ignore',
            },
        );
        supervisor = createAttachedChildProcessSupervisor(child, { processGroup: true });
        terminateBeforeAcceptance = () => {
            if (accepted || !supervisor || supervisor.snapshot().state === 'closed') return;
            supervisor.requestTermination({ graceMs: 1_000, initialSignal: 'SIGTERM', forceSignal: 'SIGKILL' });
        };
        input.signal?.addEventListener('abort', terminateBeforeAcceptance, { once: true });
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
            await supervisor.closed;
            throw input.signal.reason ?? new Error('Controlled MCP reload scheduling aborted before acceptance.');
        }
        const acceptedAt = Date.now();
        accepted = true;
        child.unref();
        return {
            requestId,
            requestedAt,
            acceptedAt,
            runnerPid: child.pid,
            target,
            sourceBarrierManifestPath: sourceBarrier.manifestPath,
            sourceBarrierFingerprint: sourceBarrier.fingerprint,
        };
    } catch (error) {
        if (supervisor && supervisor.snapshot().state !== 'closed') {
            terminateBeforeAcceptance?.();
            if (child?.pid) await supervisor.closed;
        }
        const message = error instanceof Error ? error.message : String(error);
        await input.workspace.io.writeFileAtomic(
            MCP_RELOAD_STATE_FILE,
            `${JSON.stringify({ ...launchingState, status: 'failed', completedAt: Date.now(), error: message }, null, 2)}\n`,
        );
        throw error;
    } finally {
        if (terminateBeforeAcceptance) input.signal?.removeEventListener('abort', terminateBeforeAcceptance);
    }
}

/**
 * Build the exact argv used for a certified reload. Keeping this pure makes the promotion boundary independently
 * testable without starting a restart process.
 *
 * @param {string} target
 * @param {{ manifestPath: string; fingerprint: string }} sourceBarrier
 */
export function buildControlledReloadRestartInvocation(target, sourceBarrier) {
    return Object.freeze({
        executable: process.execPath,
        args: Object.freeze([
            SOURCE_BARRIER_CLI,
            'run',
            '--manifest',
            sourceBarrier.manifestPath,
            '--expected-fingerprint',
            sourceBarrier.fingerprint,
            '--',
            process.execPath,
            'src/copilot/mcp/scripts/stateful-env.js',
            'run',
            target,
        ]),
    });
}

/**
 * The restart command itself is executed through the source-barrier wrapper. The wrapper verifies the exact certified
 * bytes immediately before spawning the restart and again after it exits; a drifted source therefore cannot produce a
 * successful promotion record even if scheduling happened earlier.
 *
 * @param {string} target
 * @param {NodeJS.ProcessEnv} parentEnv
 * @param {{ manifestPath: string; fingerprint: string }} sourceBarrier
 * @param {string} promotionRequestId
 * @returns {Promise<{ exitCode: number; timedOut: boolean; error: string | null }>}
 */
async function runRestart(target, parentEnv, sourceBarrier, promotionRequestId) {
    const env = buildControlledReloadRunnerEnvironment(parentEnv, {
        requestId: promotionRequestId,
        sourceBarrierFingerprint: sourceBarrier.fingerprint,
        sourceBarrierManifestPath: sourceBarrier.manifestPath,
    });
    const invocation = buildControlledReloadRestartInvocation(target, sourceBarrier);
    let child;
    try {
        child = spawn(invocation.executable, invocation.args, {
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

/** @param {{ requestId: string; profile: string; delayMs: number; target: string; sourceBarrierManifestPath: string; expectedSourceFingerprint: string; parentEnv: NodeJS.ProcessEnv }} input */
async function executeControlledReload(input) {
    const scheduledAt = Date.now();
    const sourceBarrierState = {
        sourceBarrierManifestPath: input.sourceBarrierManifestPath,
        sourceBarrierFingerprint: input.expectedSourceFingerprint,
    };
    await writeState({
        schemaVersion: 1,
        status: 'scheduled',
        scheduledAt,
        requestId: input.requestId,
        profile: input.profile,
        delayMs: input.delayMs,
        target: input.target,
        runnerPid: process.pid,
        ...sourceBarrierState,
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
        ...sourceBarrierState,
    });
    const result = await runRestart(
        input.target,
        input.parentEnv,
        {
            manifestPath: input.sourceBarrierManifestPath,
            fingerprint: input.expectedSourceFingerprint,
        },
        input.requestId,
    );
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
        ...sourceBarrierState,
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
 * @param {NodeJS.ProcessEnv} parentEnv
 * @returns {Promise<number>}
 */
export async function runControlledMcpReloadCli(argv, parentEnv) {
    if (!parentEnv) throw new TypeError('Controlled reload CLI requires an explicit parent environment projection.');
    try {
        return await executeControlledReload({ ...parseArgs(argv), parentEnv });
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
