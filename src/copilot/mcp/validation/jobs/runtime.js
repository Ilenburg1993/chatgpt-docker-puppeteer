// @ts-check
/**
 * Small in-process job manager for MCP validator runs.
 *
 * @module copilot/mcp/validation/jobs/runtime
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { withCopilotNodeCompileCacheEnv } from '#copilot/infra/public/platform/node';
import { readProcessResourceSnapshot } from '#copilot/infra/public/platform/process/introspection';
import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';
import { createAttachedChildProcessSupervisor } from '#copilot/mcp/public/process/supervision';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MCP_JOBS_DIR = fileURLToPath(new URL('../../../.ai/jobs/', import.meta.url));
const DEFAULT_JOB_TIMEOUT_MS = 20 * 60 * 1000;
const MIN_JOB_TIMEOUT_MS = 1_000;
const MAX_JOB_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_IN_MEMORY_JOB_RECORDS = 200;
const MAX_JOB_MANIFEST_BYTES = 128 * 1024;
const MAX_JOB_OUTPUT_TAIL_BYTES = 1024 * 1024;
const MAX_FOCUSED_UNIT_TEST_FILES = 12;
const MAX_ACTIVE_VALIDATOR_PROCESSES = 1;
const MAX_PERSISTED_JOB_READ_CONCURRENCY = 32;
const DEFAULT_VALIDATOR_VITEST_MAX_WORKERS = 2;
const JOB_TERMINATION_GRACE_MS = 1_500;
const VALIDATOR_RUNTIME_EPOCH = randomUUID();

const JOB_ARTIFACT_IO = createConfiguredFsIo(
    createConfiguredFsGrant({
        id: 'mcp.validation.jobs.artifacts',
        roots: [MCP_JOBS_DIR],
        operations: ['append', 'list', 'mkdir', 'read', 'stat', 'write'],
        symlinkPolicy: 'deny',
        durability: ['file-and-directory'],
    }),
);
let validatorSpawnReserved = false;
const FOCUSED_UNIT_TEST_PREFIX = 'tests/unit/copilot/';
const FOCUSED_UNIT_TEST_SUFFIX = '.spec.js';
/** @type {ReadonlyArray<CopilotValidatorName>} */
export const COPILOT_VALIDATOR_NAMES = Object.freeze([
    'typecheck',
    'lint',
    'unit-mcp',
    'unit-copilot',
    'unit-focused',
    'devcontainer-shell',
    'network-contracts',
    'dependency-outdated',
    'suite-mcp-fast',
    'suite-mcp-full',
    'suite-copilot-fast',
]);

/** @param {unknown} value @returns {value is CopilotValidatorName} */
export function isCopilotValidatorName(value) {
    return typeof value === 'string' && COPILOT_VALIDATOR_NAMES.includes(/** @type {CopilotValidatorName} */ (value));
}

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * @typedef {'typecheck'
 *     | 'lint'
 *     | 'unit-mcp'
 *     | 'unit-copilot'
 *     | 'unit-focused'
 *     | 'devcontainer-shell'
 *     | 'network-contracts'
 *     | 'dependency-outdated'
 *     | 'suite-mcp-fast'
 *     | 'suite-mcp-full'
 *     | 'suite-copilot-fast'} CopilotValidatorName
 *
 *
 * @typedef {object} ValidatorResourceSnapshot
 * @property {string} observedAt
 * @property {number} mcpProcessRssBytes
 * @property {number} systemFreeBytes
 * @property {number} systemTotalBytes
 * @property {number | null} systemFreeRatio
 * @property {[number, number, number]} loadAverage
 * @property {number} availableParallelism
 * @property {{
 *     memoryCurrentBytes: number | null;
 *     memoryMaxBytes: number | null;
 *     memoryUsageRatio: number | null;
 *     events: Record<string, number> | null;
 * }} cgroup
 *
 *
 * @typedef {object} JobRecord
 * @property {string} id
 * @property {CopilotValidatorName} validator
 * @property {'running' | 'completed' | 'failed' | 'cancelled'} status
 * @property {number} startedAt
 * @property {number | null} endedAt
 * @property {number | null} exitCode
 * @property {string | null} signal
 * @property {string} command
 * @property {string[]} args
 * @property {number} timeoutMs
 * @property {boolean} timedOut
 * @property {'cancel' | 'timeout' | null} terminationRequested
 * @property {number | null} terminationRequestedAt
 * @property {string} logFile
 * @property {string} manifestFile
 * @property {string} [ownerRuntimeEpoch]
 * @property {number} [ownerPid]
 * @property {number | null} [childPid]
 * @property {ValidatorResourceSnapshot | null} [resourceBefore]
 * @property {ValidatorResourceSnapshot | null} [resourceAfter]
 * @property {import('node:child_process').ChildProcess | null} process
 * @property {ReturnType<typeof createAttachedChildProcessSupervisor> | null} supervisor
 * @property {Promise<void> | null} completion
 *
 * @typedef {Omit<JobRecord, 'process' | 'supervisor' | 'completion'> & {
 *     runtimeAttached: boolean | null;
 *     runtimeSameEpoch: boolean | null;
 * }} PublicJobRecord
 */

/** @type {Map<string, JobRecord>} */
const JOBS = new Map();
/** @type {Map<string, Promise<void>>} */
const JOB_IO_QUEUES = new Map();

/**
 * @param {string} id
 * @returns {{ logFile: string; manifestFile: string } | null}
 */
function resolveJobArtifactPaths(id) {
    if (!JOB_ID_PATTERN.test(id)) return null;
    return {
        logFile: path.join(MCP_JOBS_DIR, `${id}.log`),
        manifestFile: path.join(MCP_JOBS_DIR, `${id}.json`),
    };
}

/**
 * Serializa I/O por job, preserva ordem de chunks/status e transforma falhas em warning observado.
 *
 * @param {JobRecord} record
 * @param {string} operation
 * @param {() => Promise<void>} task
 * @returns {Promise<void>}
 */
function enqueueJobIo(record, operation, task) {
    const previous = JOB_IO_QUEUES.get(record.id) ?? Promise.resolve();
    const next = previous.then(task).catch((error) => {
        process.emitWarning(
            `[copilot/mcp/jobs] ${operation} failed for job ${record.id}: ${
                error instanceof Error ? error.message : String(error)
            }`,
            { code: 'COPILOT_MCP_JOB_IO' },
        );
    });
    JOB_IO_QUEUES.set(record.id, next);
    void next.then(() => {
        if (JOB_IO_QUEUES.get(record.id) === next) JOB_IO_QUEUES.delete(record.id);
    });
    return next;
}

/**
 * Pausa o pipe enquanto o append serializado está pendente, limitando a fila a um chunk por stream.
 *
 * @param {JobRecord} record
 * @param {import('node:stream').Readable} stream
 * @param {'stdout' | 'stderr'} channel
 * @param {string} logFile
 */
function attachJobOutputStream(record, stream, channel, logFile) {
    stream.on('data', (chunk) => {
        stream.pause();
        void enqueueJobIo(record, `append ${channel}`, () => appendJobLog(logFile, chunk)).finally(() => {
            if (!stream.destroyed) stream.resume();
        });
    });
}

/**
 * Limita somente jobs não ativos; manifests e logs persistidos continuam disponíveis para reload.
 *
 * @param {Map<string, JobRecord>} records
 * @param {number} [maxEntries]
 * @returns {number}
 */
export function pruneCompletedJobRecords(records, maxEntries = MAX_IN_MEMORY_JOB_RECORDS) {
    const normalizedMaxEntries =
        Number.isInteger(maxEntries) && maxEntries > 0
            ? Math.min(maxEntries, MAX_IN_MEMORY_JOB_RECORDS)
            : MAX_IN_MEMORY_JOB_RECORDS;
    if (records.size <= normalizedMaxEntries) return 0;

    const removable = [...records.values()]
        .filter((record) => record.status !== 'running' && record.process === null)
        .sort((left, right) => (left.endedAt ?? left.startedAt) - (right.endedAt ?? right.startedAt));
    let removed = 0;
    for (const record of removable) {
        if (records.size <= normalizedMaxEntries) break;
        if (records.delete(record.id)) removed += 1;
    }
    return removed;
}

/**
 * Normalize an explicit focused unit-test file list without accepting globs, directories or path traversal.
 *
 * @param {unknown} testFiles
 * @returns {string[]}
 */
export function normalizeFocusedUnitTestFiles(testFiles) {
    if (!Array.isArray(testFiles) || testFiles.length < 1 || testFiles.length > MAX_FOCUSED_UNIT_TEST_FILES) {
        throw new Error(`Focused unit tests require 1-${MAX_FOCUSED_UNIT_TEST_FILES} explicit test files.`);
    }
    const normalized = [];
    const seen = new Set();
    for (const candidate of testFiles) {
        if (
            typeof candidate !== 'string' ||
            candidate.length === 0 ||
            candidate.includes('\\') ||
            ['*', '?', '[', ']', '{', '}'].some((token) => candidate.includes(token))
        ) {
            throw new Error(
                'Focused unit-test paths must be explicit canonical workspace-relative POSIX paths without globs.',
            );
        }
        const canonical = path.posix.normalize(candidate);
        if (
            canonical !== candidate ||
            path.posix.isAbsolute(candidate) ||
            !candidate.startsWith(FOCUSED_UNIT_TEST_PREFIX) ||
            !candidate.endsWith(FOCUSED_UNIT_TEST_SUFFIX)
        ) {
            throw new Error(
                `Focused unit-test path must match ${FOCUSED_UNIT_TEST_PREFIX}**/*${FOCUSED_UNIT_TEST_SUFFIX}.`,
            );
        }
        if (!seen.has(candidate)) {
            seen.add(candidate);
            normalized.push(candidate);
        }
    }
    return normalized;
}

/**
 * @param {unknown} testFiles
 * @returns {{ command: string; args: string[] }}
 */
export function resolveFocusedUnitTestCommand(testFiles) {
    const files = normalizeFocusedUnitTestFiles(testFiles);
    return {
        command: 'npx',
        args: ['vitest', '--config', 'vitest.copilot.config.js', 'run', ...files],
    };
}

/**
 * @param {string[]} testFiles
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @returns {Promise<void>}
 */
async function assertFocusedUnitTestFilesExist(testFiles, workspace) {
    for (const testFile of testFiles) {
        const candidatePath = path.join(workspace.workspaceRoot, testFile);
        const { stats } = await workspace.io.lstatPath(candidatePath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
            throw new Error(`Focused unit-test path must resolve to a regular non-symlink file: ${testFile}`);
        }
        const resolved = await workspace.resolveReadPath(testFile);
        if (!resolved.ok) throw new Error(`Focused unit-test path is denied: ${testFile}: ${resolved.reason}`);
        const canonicalRelative = resolved.relative.replace(/\\/gu, '/');
        if (
            !canonicalRelative.startsWith(FOCUSED_UNIT_TEST_PREFIX) ||
            !canonicalRelative.endsWith(FOCUSED_UNIT_TEST_SUFFIX)
        ) {
            throw new Error(`Focused unit-test path resolves outside ${FOCUSED_UNIT_TEST_PREFIX}: ${testFile}`);
        }
    }
}

/**
 * @param {CopilotValidatorName} validator
 * @param {{ testFiles?: string[] }} [options]
 * @returns {{ command: string; args: string[] }}
 */
export function resolveValidatorCommand(validator, options = {}) {
    switch (validator) {
        case 'typecheck':
            return { command: 'npm', args: ['run', 'typecheck:strict:src.copilot'] };
        case 'lint':
            return { command: 'npm', args: ['run', 'lint:copilot'] };
        case 'unit-mcp':
            return {
                command: 'npx',
                args: ['vitest', '--config', 'vitest.copilot.config.js', 'run', 'tests/unit/copilot/mcp'],
            };
        case 'unit-copilot':
            return { command: 'npm', args: ['run', 'test:copilot:unit'] };
        case 'unit-focused':
            return resolveFocusedUnitTestCommand(options.testFiles);
        case 'devcontainer-shell':
            return { command: 'node', args: ['src/copilot/mcp/scripts/validate-devcontainer-shell.js'] };
        case 'network-contracts':
            return {
                command: 'node',
                args: [
                    'src/copilot/mcp/scripts/network-summary-contracts.js',
                    'validate',
                    '.devcontainer/scripts/network/contracts/summary-contracts.jsonc',
                ],
            };
        case 'dependency-outdated':
            return {
                command: 'node',
                args: ['src/copilot/mcp/scripts/dependency-maintenance-runner.js', 'outdated'],
            };
        case 'suite-mcp-fast':
            return {
                command: 'node',
                args: ['src/copilot/mcp/scripts/run-safe-validation-suite.js', 'mcp-fast'],
            };
        case 'suite-mcp-full':
            return {
                command: 'node',
                args: ['src/copilot/mcp/scripts/run-safe-validation-suite.js', 'mcp-full'],
            };
        case 'suite-copilot-fast':
            return {
                command: 'node',
                args: ['src/copilot/mcp/scripts/run-safe-validation-suite.js', 'copilot-fast'],
            };
        default:
            throw new Error(`Unsupported validator: ${String(validator)}`);
    }
}

/**
 * @param {unknown} timeoutMs
 * @returns {number}
 */
export function resolveJobTimeoutMs(timeoutMs) {
    if (timeoutMs === undefined || timeoutMs === null) return DEFAULT_JOB_TIMEOUT_MS;
    const parsed = Number(timeoutMs);
    if (!Number.isFinite(parsed)) return DEFAULT_JOB_TIMEOUT_MS;
    return Math.min(MAX_JOB_TIMEOUT_MS, Math.max(MIN_JOB_TIMEOUT_MS, Math.trunc(parsed)));
}

/**
 * @param {CopilotValidatorName} validator
 * @param {{
 *     workspace: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 *     timeoutMs?: number;
 *     testFiles?: string[];
 * }} options
 * @returns {Promise<PublicJobRecord>}
 */
export async function spawnValidatorJob(validator, options) {
    if (!options?.workspace) throw new TypeError('Validator execution requires a workspace capability.');
    const id = randomUUID();
    const focusedTestFiles =
        validator === 'unit-focused' ? normalizeFocusedUnitTestFiles(options.testFiles) : undefined;
    if (focusedTestFiles) await assertFocusedUnitTestFilesExist(focusedTestFiles, options.workspace);
    const command = resolveValidatorCommand(validator, focusedTestFiles ? { testFiles: focusedTestFiles } : {});
    const timeoutMs = resolveJobTimeoutMs(options.timeoutMs);
    const artifacts = resolveJobArtifactPaths(id);
    if (!artifacts) throw new Error('Generated validator job id is invalid.');
    const { logFile, manifestFile } = artifacts;
    if (!canRunCopilotValidatorInline()) {
        throw Object.assign(
            new Error(
                'Validator subprocess fan-out is disabled inside test runners; run the integration check from the normal MCP runtime instead.',
            ),
            { code: 'ERR_VALIDATOR_NESTED_RUNNER_BLOCKED' },
        );
    }
    const activeJob =
        [...JOBS.values()].find((record) => record.status === 'running' && record.process !== null) ?? null;
    if (validatorSpawnReserved || activeJob) {
        throw Object.assign(
            new Error(
                activeJob
                    ? `Validator capacity is busy with ${activeJob.validator} (${activeJob.id}).`
                    : 'Validator capacity is reserved by another spawn in progress.',
            ),
            {
                code: 'ERR_VALIDATOR_CAPACITY_BUSY',
                activeJobId: activeJob?.id ?? null,
                activeValidator: activeJob?.validator ?? null,
                maxActive: MAX_ACTIVE_VALIDATOR_PROCESSES,
            },
        );
    }
    validatorSpawnReserved = true;
    try {
        await JOB_ARTIFACT_IO.mkdirPath(MCP_JOBS_DIR, { recursive: true });
        await JOB_ARTIFACT_IO.writeFileAtomic(
            logFile,
            `$ ${command.command} ${command.args.join(' ')}\n[job:timeoutMs] ${timeoutMs}\n\n`,
            { mode: 0o600, failIfExists: true },
        );

        const resourceBefore = await readValidatorResourceSnapshot();
        const child = spawn(command.command, command.args, {
            cwd: options.workspace.workspaceRoot,
            env: buildValidatorChildEnv(),
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const supervisor = createAttachedChildProcessSupervisor(child);

        /** @type {JobRecord} */
        const record = {
            id,
            validator,
            status: 'running',
            startedAt: Date.now(),
            endedAt: null,
            exitCode: null,
            signal: null,
            command: command.command,
            args: command.args,
            timeoutMs,
            timedOut: false,
            terminationRequested: null,
            terminationRequestedAt: null,
            logFile,
            manifestFile,
            ownerRuntimeEpoch: VALIDATOR_RUNTIME_EPOCH,
            ownerPid: process.pid,
            childPid: child.pid ?? null,
            resourceBefore,
            resourceAfter: null,
            process: child,
            supervisor,
            completion: null,
        };
        JOBS.set(id, record);
        pruneCompletedJobRecords(JOBS);
        await persistJobRecord(record);

        const timeout = setTimeout(() => {
            if (record.status !== 'running' || !record.process || record.terminationRequested) return;
            record.timedOut = true;
            record.terminationRequested = 'timeout';
            record.terminationRequestedAt = Date.now();
            void enqueueJobIo(record, 'persist timeout request', async () => {
                await appendJobLog(record.logFile, `\n[job:timeout-requested] timeoutMs=${timeoutMs}\n`);
                await persistJobRecord(record);
            });
            record.supervisor?.requestTermination({ graceMs: JOB_TERMINATION_GRACE_MS });
        }, timeoutMs);
        timeout.unref();

        attachJobOutputStream(record, child.stdout, 'stdout', logFile);
        attachJobOutputStream(record, child.stderr, 'stderr', logFile);
        record.completion = supervisor.closed.then(async ({ exitCode, signal }) => {
            clearTimeout(timeout);
            const terminationRequested = record.terminationRequested;
            record.endedAt = Date.now();
            record.exitCode = exitCode;
            record.signal = signal;
            record.process = null;
            if (terminationRequested === 'cancel') record.status = 'cancelled';
            else if (terminationRequested === 'timeout') record.status = 'failed';
            else record.status = exitCode === 0 ? 'completed' : 'failed';
            await enqueueJobIo(record, terminationRequested ? 'finalize interrupted job' : 'finalize job', async () => {
                record.resourceAfter = await readValidatorResourceSnapshot();
                const terminalLabel = terminationRequested === 'timeout' ? 'timed-out' : record.status;
                await appendJobLog(
                    logFile,
                    `\n[job:${terminalLabel}] exitCode=${String(exitCode)} signal=${String(signal)}\n`,
                );
                await persistJobRecord(record);
                pruneCompletedJobRecords(JOBS);
            });
        });

        return publicJobRecord(record);
    } finally {
        validatorSpawnReserved = false;
    }
}

/**
 * Wait only against an attached in-memory job record for a bounded window. Persisted/unattached jobs are read once.
 *
 * @param {string} id
 * @param {number} [waitMs]
 * @returns {Promise<PublicJobRecord | null>}
 */
export async function waitForJobCompletion(id, waitMs = 30_000) {
    const boundedWaitMs = Math.max(0, Math.min(120_000, Math.floor(Number(waitMs) || 0)));
    const attached = JOBS.get(id);
    if (!attached) {
        const persisted = await readJobManifest(id);
        return persisted ? publicJobRecord(persisted) : null;
    }
    if (attached.status !== 'running' || boundedWaitMs === 0) return publicJobRecord(attached);

    if (!attached.completion) return publicJobRecord(attached);
    /** @type {NodeJS.Timeout | null} */
    let waitTimer = null;
    const boundedWait = new Promise((resolve) => {
        waitTimer = setTimeout(resolve, boundedWaitMs);
        waitTimer.unref();
    });
    await Promise.race([attached.completion, boundedWait]);
    if (waitTimer) clearTimeout(waitTimer);
    return publicJobRecord(attached);
}

/**
 * @param {string} id
 * @param {number} [tailBytes]
 * @returns {Promise<{ job: PublicJobRecord | null; output: string }>}
 */
export async function readJobOutput(id, tailBytes = 24_000) {
    if (!resolveJobArtifactPaths(id)) return { job: null, output: '' };
    const record = JOBS.get(id) ?? (await readJobManifest(id));
    if (!record) return { job: null, output: '' };
    const output = await readJobLogTail(id, tailBytes);
    return { job: publicJobRecord(record), output };
}

/**
 * Prevent validator subprocess fan-out from inside Vitest/test runners.
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
export function canRunCopilotValidatorInline(env = process.env) {
    return !env['VITEST'] && env['NODE_ENV'] !== 'test';
}

export function resolveValidatorVitestMaxWorkers(env = process.env) {
    const candidate = Number(env['COPILOT_VALIDATOR_VITEST_MAX_WORKERS'] ?? env['VITEST_MAX_WORKERS']);
    if (Number.isInteger(candidate) && candidate >= 1 && candidate <= 4) return candidate;
    return DEFAULT_VALIDATOR_VITEST_MAX_WORKERS;
}

function buildValidatorChildEnv() {
    const { env } = buildMcpChildEnvironment();
    return withCopilotNodeCompileCacheEnv({
        ...env,
        NO_COLOR: '',
        VITEST_MAX_WORKERS: String(resolveValidatorVitestMaxWorkers()),
    });
}

/** @returns {Promise<ValidatorResourceSnapshot>} */
export async function readValidatorResourceSnapshot() {
    const snapshot = await readProcessResourceSnapshot();
    return {
        observedAt: snapshot.observedAt,
        mcpProcessRssBytes: snapshot.processRssBytes,
        systemFreeBytes: snapshot.systemFreeBytes,
        systemTotalBytes: snapshot.systemTotalBytes,
        systemFreeRatio: snapshot.systemFreeRatio,
        loadAverage: [snapshot.loadAverage[0], snapshot.loadAverage[1], snapshot.loadAverage[2]],
        availableParallelism: snapshot.availableParallelism,
        cgroup: {
            memoryCurrentBytes: snapshot.cgroup.memoryCurrentBytes,
            memoryMaxBytes: snapshot.cgroup.memoryMaxBytes,
            memoryUsageRatio: snapshot.cgroup.memoryUsageRatio,
            events: snapshot.cgroup.events === null ? null : { ...snapshot.cgroup.events },
        },
    };
}

export function readCopilotValidatorCapacityState() {
    const active = [...JOBS.values()]
        .filter((record) => record.status === 'running' && record.process !== null)
        .map((record) => ({ id: record.id, validator: record.validator, startedAt: record.startedAt }));
    return {
        runtimeEpoch: VALIDATOR_RUNTIME_EPOCH,
        ownerPid: process.pid,
        maxActive: MAX_ACTIVE_VALIDATOR_PROCESSES,
        vitestMaxWorkers: resolveValidatorVitestMaxWorkers(),
        spawnReserved: validatorSpawnReserved,
        activeCount: active.length,
        active,
    };
}

/**
 * Run one canonical allowlisted validator and wait for a bounded completion window. This is the shared primitive used
 * by higher-level composite workflows that need validation feedback without paying another model→tool round trip.
 *
 * @param {CopilotValidatorName} validator
 * @param {{
 *     workspace: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 *     timeoutMs?: number;
 *     waitMs?: number;
 *     failureTailBytes?: number;
 *     testFiles?: string[];
 * }} options
 */
export async function runCopilotValidatorInline(validator, options) {
    if (!options?.workspace) throw new TypeError('Inline validator execution requires a workspace capability.');
    if (!canRunCopilotValidatorInline()) {
        throw new Error(
            'Inline validator fan-out is disabled inside test runners to prevent recursive Node/Vitest process trees.',
        );
    }
    if (!isCopilotValidatorName(validator)) throw new Error(`Unsupported validator: ${String(validator)}`);
    const focused = validator === 'unit-focused';
    if (focused && !options.testFiles) throw new Error('unit-focused requires explicit testFiles.');
    if (!focused && options.testFiles) throw new Error('testFiles are valid only for unit-focused.');
    const job = await spawnValidatorJob(validator, {
        workspace: options.workspace,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(focused ? { testFiles: options.testFiles } : {}),
    });
    const waitMs = Math.max(0, Math.min(120_000, Math.floor(Number(options.waitMs ?? 30_000))));
    const waited = await waitForJobCompletion(job.id, waitMs);
    if (!waited) throw new Error(`Validator job ${job.id} disappeared while waiting.`);
    const completedWithinWait = waited.status !== 'running';
    const passed = waited.status === 'completed' && waited.exitCode === 0;
    const shouldReadFailureTail = completedWithinWait && !passed && waited.status === 'failed';
    const failureOutput = shouldReadFailureTail
        ? await readJobOutput(job.id, Math.max(1_000, Math.min(12_000, Number(options.failureTailBytes ?? 4_000))))
        : { output: '' };
    return {
        validator,
        passed,
        completedWithinWait,
        waitMs,
        job: waited,
        ...(failureOutput.output ? { failureOutputTail: failureOutput.output } : {}),
    };
}

/**
 * @param {string} id
 * @returns {Promise<{ ok: boolean; job: PublicJobRecord | null; message: string; unattached?: boolean }>}
 */
export async function cancelJob(id) {
    if (!resolveJobArtifactPaths(id)) return { ok: false, job: null, message: 'Job not found.' };
    const record = JOBS.get(id);
    if (!record) {
        const persisted = await readJobManifest(id);
        if (!persisted) return { ok: false, job: null, message: 'Job not found.' };
        const job = publicJobRecord(persisted);
        if (persisted.status === 'running') {
            return {
                ok: false,
                job,
                unattached: true,
                message: 'Job is persisted as running but is not attached to the current MCP runtime.',
            };
        }
        return { ok: false, job, message: `Job is ${persisted.status}.` };
    }
    if (!record.process || record.status !== 'running') {
        return { ok: false, job: publicJobRecord(record), message: `Job is ${record.status}.` };
    }
    if (record.terminationRequested) {
        return {
            ok: true,
            job: publicJobRecord(record),
            message: `Job termination already requested (${record.terminationRequested}).`,
        };
    }
    record.terminationRequested = 'cancel';
    record.terminationRequestedAt = Date.now();
    record.supervisor?.requestTermination({ graceMs: JOB_TERMINATION_GRACE_MS });
    await enqueueJobIo(record, 'persist cancellation request', async () => {
        await appendJobLog(record.logFile, '\n[job:cancellation-requested]\n');
        await persistJobRecord(record);
    });
    return { ok: true, job: publicJobRecord(record), message: 'Job cancellation requested.' };
}

/**
 * @param {{
 *     status?: JobRecord['status'];
 *     validator?: CopilotValidatorName;
 *     limit?: number;
 *     includeCompleted?: boolean;
 * }} [options]
 * @returns {Promise<PublicJobRecord[]>}
 */
export async function listJobs(options = {}) {
    const records = new Map();
    for (const record of JOBS.values()) {
        records.set(record.id, publicJobRecord(record));
    }
    const entries = await JOB_ARTIFACT_IO.listDirectoryNamesFresh(MCP_JOBS_DIR)
        .then((result) => result.entries)
        .catch(() => []);
    const persistedIds = entries
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => entry.slice(0, -'.json'.length))
        .filter((id) => !records.has(id));
    for (let offset = 0; offset < persistedIds.length; offset += MAX_PERSISTED_JOB_READ_CONCURRENCY) {
        const batch = persistedIds.slice(offset, offset + MAX_PERSISTED_JOB_READ_CONCURRENCY);
        const manifests = await Promise.all(batch.map((id) => readJobManifest(id)));
        for (const manifest of manifests) {
            if (manifest) records.set(manifest.id, publicJobRecord(manifest));
        }
    }
    const includeCompleted = options.includeCompleted !== false;
    const limit = Math.max(1, Math.min(200, Number(options.limit ?? 50)));
    return [...records.values()]
        .filter((record) => (options.status ? record.status === options.status : true))
        .filter((record) => (options.validator ? record.validator === options.validator : true))
        .filter((record) => (includeCompleted ? true : record.status === 'running'))
        .sort((left, right) => right.startedAt - left.startedAt)
        .slice(0, limit);
}

/**
 * @param {JobRecord} record
 * @returns {PublicJobRecord}
 */
function publicJobRecord(record) {
    const { process: _process, supervisor: _supervisor, completion: _completion, ...publicRecord } = record;
    return {
        ...publicRecord,
        runtimeAttached: record.status === 'running' ? record.process !== null : null,
        runtimeSameEpoch:
            typeof record.ownerRuntimeEpoch === 'string' ? record.ownerRuntimeEpoch === VALIDATOR_RUNTIME_EPOCH : null,
    };
}

/**
 * @param {JobRecord} record
 * @returns {Promise<void>}
 */
async function persistJobRecord(record) {
    await JOB_ARTIFACT_IO.mkdirPath(MCP_JOBS_DIR, { recursive: true });
    await JOB_ARTIFACT_IO.writeFileAtomic(
        record.manifestFile,
        `${JSON.stringify(publicJobRecord(record), null, 2)}\n`,
        {
            mode: 0o600,
        },
    );
}

/**
 * @param {string} id
 * @returns {Promise<JobRecord | null>}
 */
async function readJobManifest(id) {
    const artifacts = resolveJobArtifactPaths(id);
    if (!artifacts) return null;
    const { logFile, manifestFile } = artifacts;
    try {
        const { stats } = await JOB_ARTIFACT_IO.lstatPath(manifestFile);
        if (stats.isSymbolicLink() || !stats.isFile() || stats.size > MAX_JOB_MANIFEST_BYTES) return null;
        const parsed = JSON.parse((await JOB_ARTIFACT_IO.readTextFresh(manifestFile)).content);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        if (!('id' in parsed) || parsed.id !== id) return null;
        return /** @type {JobRecord} */ ({
            ...parsed,
            logFile,
            manifestFile,
            process: null,
            supervisor: null,
            completion: null,
        });
    } catch {
        return null;
    }
}

/**
 * @param {string} id
 * @param {number} requestedTailBytes
 * @returns {Promise<string>}
 */
async function readJobLogTail(id, requestedTailBytes) {
    const artifacts = resolveJobArtifactPaths(id);
    if (!artifacts) return '';
    const tailBytes = Math.max(
        1,
        Math.min(
            MAX_JOB_OUTPUT_TAIL_BYTES,
            Number.isFinite(requestedTailBytes) ? Math.floor(requestedTailBytes) : 24_000,
        ),
    );
    try {
        const snapshot = await JOB_ARTIFACT_IO.readBytesRangeFresh(artifacts.logFile, {
            maxBytes: tailBytes,
            fromEnd: true,
            rejectSymlink: true,
        });
        if (!snapshot.isFile || snapshot.bytesRead <= 0) return '';
        return snapshot.content.toString('utf8');
    } catch {
        return '';
    }
}

/**
 * @param {string} logFile
 * @param {string | Buffer} chunk
 * @returns {Promise<void>}
 */
async function appendJobLog(logFile, chunk) {
    await JOB_ARTIFACT_IO.appendText(logFile, String(chunk), { mode: 0o600 });
}
