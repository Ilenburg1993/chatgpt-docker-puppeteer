// @ts-check
/**
 * Small in-process job manager for MCP validator runs.
 *
 * @module copilot/mcp/control-plane/jobs
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath } from 'node:fs/promises';
import { availableParallelism, freemem, loadavg, totalmem } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendTextLocked, writeFileAtomic } from '#copilot/infra/public/io';
import { withCopilotNodeCompileCacheEnv } from '#copilot/infra/public/node-runtime';
import { getMcpWorkspaceRoot } from './paths.js';

const MCP_JOBS_DIR = fileURLToPath(new URL('../../.ai/jobs/', import.meta.url));
const DEFAULT_JOB_TIMEOUT_MS = 20 * 60 * 1000;
const MIN_JOB_TIMEOUT_MS = 1_000;
const MAX_JOB_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_IN_MEMORY_JOB_RECORDS = 200;
const MAX_JOB_MANIFEST_BYTES = 128 * 1024;
const MAX_JOB_OUTPUT_TAIL_BYTES = 1024 * 1024;
const MAX_FOCUSED_UNIT_TEST_FILES = 12;
const MAX_ACTIVE_VALIDATOR_PROCESSES = 1;
const DEFAULT_VALIDATOR_VITEST_MAX_WORKERS = 2;
const VALIDATOR_RUNTIME_EPOCH = randomUUID();
const CGROUP_V2_MEMORY_CURRENT = '/sys/fs/cgroup/memory.current';
const CGROUP_V2_MEMORY_MAX = '/sys/fs/cgroup/memory.max';
const CGROUP_V2_MEMORY_EVENTS = '/sys/fs/cgroup/memory.events';
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
 * @property {{ memoryCurrentBytes: number | null; memoryMaxBytes: number | null; memoryUsageRatio: number | null; events: Record<string, number> | null }} cgroup
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
 * @property {string} logFile
 * @property {string} manifestFile
 * @property {string} [ownerRuntimeEpoch]
 * @property {number} [ownerPid]
 * @property {number | null} [childPid]
 * @property {ValidatorResourceSnapshot | null} [resourceBefore]
 * @property {ValidatorResourceSnapshot | null} [resourceAfter]
 * @property {import('node:child_process').ChildProcess | null} process
 *
 * @typedef {Omit<JobRecord, 'process'> & {
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
            throw new Error('Focused unit-test paths must be explicit canonical workspace-relative POSIX paths without globs.');
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
 * @returns {Promise<void>}
 */
async function assertFocusedUnitTestFilesExist(testFiles) {
    const workspaceRoot = await realpath(getMcpWorkspaceRoot());
    const allowedRoot = await realpath(path.join(workspaceRoot, FOCUSED_UNIT_TEST_PREFIX));
    for (const testFile of testFiles) {
        const candidatePath = path.join(workspaceRoot, testFile);
        const stats = await lstat(candidatePath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
            throw new Error(`Focused unit-test path must resolve to a regular non-symlink file: ${testFile}`);
        }
        const resolved = await realpath(candidatePath);
        const relativeToAllowedRoot = path.relative(allowedRoot, resolved);
        if (relativeToAllowedRoot.startsWith('..') || path.isAbsolute(relativeToAllowedRoot)) {
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
 * @param {{ timeoutMs?: number; testFiles?: string[] }} [options]
 * @returns {Promise<PublicJobRecord>}
 */
export async function spawnValidatorJob(validator, options = {}) {
    const id = randomUUID();
    const focusedTestFiles =
        validator === 'unit-focused' ? normalizeFocusedUnitTestFiles(options.testFiles) : undefined;
    if (focusedTestFiles) await assertFocusedUnitTestFilesExist(focusedTestFiles);
    const command = resolveValidatorCommand(
        validator,
        focusedTestFiles ? { testFiles: focusedTestFiles } : {},
    );
    const timeoutMs = resolveJobTimeoutMs(options.timeoutMs);
    const artifacts = resolveJobArtifactPaths(id);
    if (!artifacts) throw new Error('Generated validator job id is invalid.');
    const { logFile, manifestFile } = artifacts;
    if (!canRunCopilotValidatorInline()) {
        throw Object.assign(
            new Error('Validator subprocess fan-out is disabled inside test runners; run the integration check from the normal MCP runtime instead.'),
            { code: 'ERR_VALIDATOR_NESTED_RUNNER_BLOCKED' },
        );
    }
    const activeJob = [...JOBS.values()].find((record) => record.status === 'running' && record.process !== null) ?? null;
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
        await mkdir(MCP_JOBS_DIR, { recursive: true });
        await writeFileAtomic(
            logFile,
            `$ ${command.command} ${command.args.join(' ')}\n[job:timeoutMs] ${timeoutMs}\n\n`,
            { encoding: 'utf8', mode: 0o600, failIfExists: true, riskClass: 'medium' },
        );

        const resourceBefore = await readValidatorResourceSnapshot();
        const child = spawn(command.command, command.args, {
            cwd: getMcpWorkspaceRoot(),
            env: buildValidatorChildEnv(),
            stdio: ['ignore', 'pipe', 'pipe'],
        });

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
            logFile,
            manifestFile,
            ownerRuntimeEpoch: VALIDATOR_RUNTIME_EPOCH,
            ownerPid: process.pid,
            childPid: child.pid ?? null,
            resourceBefore,
            resourceAfter: null,
            process: child,
        };
    JOBS.set(id, record);
    pruneCompletedJobRecords(JOBS);
    await persistJobRecord(record);

    const timeout = setTimeout(() => {
        if (record.status !== 'running' || !record.process) return;
        record.status = 'failed';
        record.timedOut = true;
        record.endedAt = Date.now();
        void enqueueJobIo(record, 'persist timeout', async () => {
            await appendJobLog(record.logFile, `\n[job:timeout] timeoutMs=${timeoutMs}\n`);
            await persistJobRecord(record);
        });
        record.process.kill('SIGTERM');
    }, timeoutMs);
    timeout.unref();

    attachJobOutputStream(record, child.stdout, 'stdout', logFile);
    attachJobOutputStream(record, child.stderr, 'stderr', logFile);
        child.on('close', (code, signal) => {
            clearTimeout(timeout);
            record.endedAt = Date.now();
            record.exitCode = code;
            record.signal = signal;
            record.process = null;
            const interrupted = record.status === 'cancelled' || record.timedOut;
            if (!interrupted) record.status = code === 0 ? 'completed' : 'failed';
            void enqueueJobIo(record, interrupted ? 'finalize interrupted job' : 'finalize job', async () => {
                record.resourceAfter = await readValidatorResourceSnapshot();
                if (!interrupted) {
                    await appendJobLog(
                        logFile,
                        `\n[job:${record.status}] exitCode=${String(code)} signal=${String(signal)}\n`,
                    );
                }
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

    const deadline = Date.now() + boundedWaitMs;
    while (attached.status === 'running') {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(50, remaining)));
    }
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
    return withCopilotNodeCompileCacheEnv({
        ...process.env,
        NO_COLOR: '',
        VITEST_MAX_WORKERS: String(resolveValidatorVitestMaxWorkers()),
    });
}

const CGROUP_MEMORY_EVENT_KEYS = Object.freeze(['low', 'high', 'max', 'oom', 'oom_kill', 'oom_group_kill']);

/** @param {string} text */
export function parseCgroupMemoryEvents(text) {
    /** @type {Record<string, number>} */
    const events = {};
    for (const line of String(text ?? '').split(/\r?\n/u)) {
        const [key, rawValue, ...rest] = line.trim().split(/\s+/u);
        if (!key || rawValue === undefined || rest.length > 0 || !CGROUP_MEMORY_EVENT_KEYS.includes(key)) continue;
        const value = Number(rawValue);
        if (Number.isSafeInteger(value) && value >= 0) events[key] = value;
    }
    return events;
}

/** @param {string} text */
export function parseCgroupMemoryLimit(text) {
    const normalized = String(text ?? '').trim();
    if (!normalized || normalized === 'max') return null;
    const value = Number(normalized);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** @param {string} filePath */
async function readOptionalCgroupText(filePath) {
    try {
        return await readFile(filePath, 'utf8');
    } catch {
        return null;
    }
}

/** @returns {Promise<ValidatorResourceSnapshot>} */
export async function readValidatorResourceSnapshot() {
    const [currentText, maxText, eventsText] = await Promise.all([
        readOptionalCgroupText(CGROUP_V2_MEMORY_CURRENT),
        readOptionalCgroupText(CGROUP_V2_MEMORY_MAX),
        readOptionalCgroupText(CGROUP_V2_MEMORY_EVENTS),
    ]);
    const memoryCurrentBytes = currentText === null ? null : parseCgroupMemoryLimit(currentText);
    const memoryMaxBytes = maxText === null ? null : parseCgroupMemoryLimit(maxText);
    const systemTotalBytes = totalmem();
    const systemFreeBytes = freemem();
    const systemFreeRatio = systemTotalBytes > 0 ? roundResourceRatio(systemFreeBytes / systemTotalBytes) : null;
    const memoryUsageRatio =
        memoryCurrentBytes !== null && memoryMaxBytes !== null && memoryMaxBytes > 0
            ? roundResourceRatio(memoryCurrentBytes / memoryMaxBytes)
            : null;
    const loads = loadavg();
    return {
        observedAt: new Date().toISOString(),
        mcpProcessRssBytes: process.memoryUsage().rss,
        systemFreeBytes,
        systemTotalBytes,
        systemFreeRatio,
        loadAverage: [loads[0] ?? 0, loads[1] ?? 0, loads[2] ?? 0],
        availableParallelism: availableParallelism(),
        cgroup: {
            memoryCurrentBytes,
            memoryMaxBytes,
            memoryUsageRatio,
            events: eventsText === null ? null : parseCgroupMemoryEvents(eventsText),
        },
    };
}

/** @param {number} value */
function roundResourceRatio(value) {
    return Math.round(value * 1_000_000) / 1_000_000;
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
 * Run one canonical allowlisted validator and wait for a bounded completion window.
 * This is the shared primitive used by higher-level composite workflows that
 * need validation feedback without paying another model→tool round trip.
 *
 * @param {CopilotValidatorName} validator
 * @param {{ timeoutMs?: number; waitMs?: number; failureTailBytes?: number; testFiles?: string[] }} [options]
 */
export async function runCopilotValidatorInline(validator, options = {}) {
    if (!canRunCopilotValidatorInline()) {
        throw new Error('Inline validator fan-out is disabled inside test runners to prevent recursive Node/Vitest process trees.');
    }
    if (!isCopilotValidatorName(validator)) throw new Error(`Unsupported validator: ${String(validator)}`);
    const focused = validator === 'unit-focused';
    if (focused && !options.testFiles) throw new Error('unit-focused requires explicit testFiles.');
    if (!focused && options.testFiles) throw new Error('testFiles are valid only for unit-focused.');
    const job = await spawnValidatorJob(validator, {
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
    record.status = 'cancelled';
    record.endedAt = Date.now();
    record.process.kill('SIGTERM');
    void enqueueJobIo(record, 'persist cancellation', async () => {
        await appendJobLog(record.logFile, '\n[job:cancelled]\n');
        await persistJobRecord(record);
    });
    return { ok: true, job: publicJobRecord(record), message: 'Job cancelled.' };
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
    await mkdir(MCP_JOBS_DIR, { recursive: true });
    const entries = await readdir(MCP_JOBS_DIR).catch(() => []);
    for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        const id = entry.slice(0, -'.json'.length);
        if (records.has(id)) continue;
        const manifest = await readJobManifest(id);
        if (manifest) records.set(id, publicJobRecord(manifest));
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
    const { process: _process, ...publicRecord } = record;
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
    await mkdir(MCP_JOBS_DIR, { recursive: true });
    await writeFileAtomic(record.manifestFile, `${JSON.stringify(publicJobRecord(record), null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        riskClass: 'medium',
        advisoryLimits: { domain: 'mcp-validator-job-manifest' },
    });
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
        const stats = await lstat(manifestFile);
        if (stats.isSymbolicLink() || !stats.isFile() || stats.size > MAX_JOB_MANIFEST_BYTES) return null;
        const parsed = JSON.parse(await readFile(manifestFile, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        if (!('id' in parsed) || parsed.id !== id) return null;
        return /** @type {JobRecord} */ ({ ...parsed, logFile, manifestFile, process: null });
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
        const stats = await lstat(artifacts.logFile);
        if (stats.isSymbolicLink() || !stats.isFile()) return '';
        const bytesToRead = Math.min(stats.size, tailBytes);
        if (bytesToRead <= 0) return '';
        const buffer = Buffer.allocUnsafe(bytesToRead);
        const handle = await open(artifacts.logFile, 'r');
        try {
            let offset = 0;
            while (offset < bytesToRead) {
                const { bytesRead } = await handle.read(
                    buffer,
                    offset,
                    bytesToRead - offset,
                    stats.size - bytesToRead + offset,
                );
                if (bytesRead <= 0) break;
                offset += bytesRead;
            }
            return buffer.subarray(0, offset).toString('utf8');
        } finally {
            await handle.close();
        }
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
    await appendTextLocked(logFile, String(chunk), {
        mode: 0o600,
        advisoryLimits: { domain: 'mcp-validator-job-log' },
    });
}
