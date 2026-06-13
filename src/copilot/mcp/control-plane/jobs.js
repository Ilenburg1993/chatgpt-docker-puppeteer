// @ts-check
/**
 * Small in-process job manager for MCP validator runs.
 *
 * @module copilot/mcp/control-plane/jobs
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendTextLocked, writeFileAtomic } from '#copilot/infra/public/io';
import { getMcpWorkspaceRoot } from './paths.js';

const MCP_JOBS_DIR = fileURLToPath(new URL('../../.ai/jobs/', import.meta.url));
const DEFAULT_JOB_TIMEOUT_MS = 20 * 60 * 1000;
const MIN_JOB_TIMEOUT_MS = 1_000;
const MAX_JOB_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_IN_MEMORY_JOB_RECORDS = 200;
const MAX_JOB_MANIFEST_BYTES = 128 * 1024;
const MAX_JOB_OUTPUT_TAIL_BYTES = 1024 * 1024;
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * @typedef {'typecheck'
 *     | 'lint'
 *     | 'unit-mcp'
 *     | 'unit-copilot'
 *     | 'suite-mcp-fast'
 *     | 'suite-mcp-full'
 *     | 'suite-copilot-fast'} CopilotValidatorName
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
 * @property {string} logFile
 * @property {string} manifestFile
 * @property {import('node:child_process').ChildProcess | null} process
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
 * @param {CopilotValidatorName} validator
 * @returns {{ command: string; args: string[] }}
 */
export function resolveValidatorCommand(validator) {
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
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<Omit<JobRecord, 'process'>>}
 */
export async function spawnValidatorJob(validator, options = {}) {
    const id = randomUUID();
    const command = resolveValidatorCommand(validator);
    const timeoutMs = resolveJobTimeoutMs(options.timeoutMs);
    const artifacts = resolveJobArtifactPaths(id);
    if (!artifacts) throw new Error('Generated validator job id is invalid.');
    const { logFile, manifestFile } = artifacts;
    await mkdir(MCP_JOBS_DIR, { recursive: true });
    await writeFileAtomic(
        logFile,
        `$ ${command.command} ${command.args.join(' ')}\n[job:timeoutMs] ${timeoutMs}\n\n`,
        { encoding: 'utf8', mode: 0o600, failIfExists: true, riskClass: 'medium' },
    );

    const child = spawn(command.command, command.args, {
        cwd: getMcpWorkspaceRoot(),
        env: { ...process.env, NO_COLOR: '' },
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

    child.stdout.on('data', (chunk) => {
        void enqueueJobIo(record, 'append stdout', () => appendJobLog(logFile, chunk));
    });
    child.stderr.on('data', (chunk) => {
        void enqueueJobIo(record, 'append stderr', () => appendJobLog(logFile, chunk));
    });
    child.on('exit', (code, signal) => {
        clearTimeout(timeout);
        record.endedAt = Date.now();
        record.exitCode = code;
        record.signal = signal;
        record.process = null;
        if (record.status === 'cancelled' || record.timedOut) {
            void enqueueJobIo(record, 'finalize interrupted job', async () => {
                await persistJobRecord(record);
                pruneCompletedJobRecords(JOBS);
            });
            return;
        }
        record.status = code === 0 ? 'completed' : 'failed';
        void enqueueJobIo(record, 'finalize job', async () => {
            await appendJobLog(
                logFile,
                `\n[job:${record.status}] exitCode=${String(code)} signal=${String(signal)}\n`,
            );
            await persistJobRecord(record);
            pruneCompletedJobRecords(JOBS);
        });
    });

    return publicJobRecord(record);
}

/**
 * @param {string} id
 * @param {number} [tailBytes]
 * @returns {Promise<{ job: Omit<JobRecord, 'process'> | null; output: string }>}
 */
export async function readJobOutput(id, tailBytes = 24_000) {
    if (!resolveJobArtifactPaths(id)) return { job: null, output: '' };
    const record = JOBS.get(id) ?? (await readJobManifest(id));
    if (!record) return { job: null, output: '' };
    const output = await readJobLogTail(id, tailBytes);
    return { job: publicJobRecord(record), output };
}

/**
 * @param {string} id
 * @returns {{ ok: boolean; job: Omit<JobRecord, 'process'> | null; message: string }}
 */
export function cancelJob(id) {
    if (!resolveJobArtifactPaths(id)) return { ok: false, job: null, message: 'Job not found.' };
    const record = JOBS.get(id);
    if (!record) return { ok: false, job: null, message: 'Job not found.' };
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
 * @returns {Promise<Omit<JobRecord, 'process'>[]>}
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
 * @returns {Omit<JobRecord, 'process'>}
 */
function publicJobRecord(record) {
    const { process: _process, ...publicRecord } = record;
    return publicRecord;
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
