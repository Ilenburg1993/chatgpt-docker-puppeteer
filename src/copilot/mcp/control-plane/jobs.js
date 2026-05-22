// @ts-check
/**
 * Small in-process job manager for MCP validator runs.
 *
 * @module copilot/mcp/control-plane/jobs
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getMcpWorkspaceRoot } from './paths.js';

const MCP_JOBS_DIR = fileURLToPath(new URL('../../.ai/jobs/', import.meta.url));

/**
 * @typedef {'typecheck' | 'lint' | 'unit-mcp' | 'unit-copilot'} CopilotValidatorName
 *
 * @typedef {object} JobRecord
 * @property {string} id
 * @property {CopilotValidatorName} validator
 * @property {'running' | 'completed' | 'failed' | 'cancelled'} status
 * @property {number} startedAt
 * @property {number | null} endedAt
 * @property {number | null} exitCode
 * @property {string} logFile
 * @property {import('node:child_process').ChildProcess | null} process
 */

/** @type {Map<string, JobRecord>} */
const JOBS = new Map();

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
                args: ['vitest', '--config', 'vitest.copilot.config.js', 'run', 'tests/unit/copilot/mcp/*.spec.js'],
            };
        case 'unit-copilot':
            return { command: 'npm', args: ['run', 'test:copilot:unit'] };
        default:
            throw new Error(`Unsupported validator: ${String(validator)}`);
    }
}

/**
 * @param {CopilotValidatorName} validator
 * @returns {Promise<Omit<JobRecord, 'process'>>}
 */
export async function spawnValidatorJob(validator) {
    const id = randomUUID();
    const command = resolveValidatorCommand(validator);
    const logFile = path.join(MCP_JOBS_DIR, `${id}.log`);
    await mkdir(MCP_JOBS_DIR, { recursive: true });
    await writeFile(logFile, `$ ${command.command} ${command.args.join(' ')}\n\n`, 'utf8');

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
        logFile,
        process: child,
    };
    JOBS.set(id, record);

    child.stdout.on('data', (chunk) => {
        void appendJobLog(logFile, chunk);
    });
    child.stderr.on('data', (chunk) => {
        void appendJobLog(logFile, chunk);
    });
    child.on('exit', (code, signal) => {
        record.endedAt = Date.now();
        record.exitCode = code;
        record.process = null;
        if (record.status === 'cancelled') return;
        record.status = code === 0 ? 'completed' : 'failed';
        void appendJobLog(logFile, `\n[job:${record.status}] exitCode=${String(code)} signal=${String(signal)}\n`);
    });

    return publicJobRecord(record);
}

/**
 * @param {string} id
 * @param {number} [tailBytes]
 * @returns {Promise<{ job: Omit<JobRecord, 'process'> | null; output: string }>}
 */
export async function readJobOutput(id, tailBytes = 24_000) {
    const record = JOBS.get(id);
    if (!record) return { job: null, output: '' };
    /** @type {string} */
    let output;
    try {
        const content = await readFile(record.logFile, 'utf8');
        output = content.length > tailBytes ? content.slice(content.length - tailBytes) : content;
    } catch {
        output = '';
    }
    return { job: publicJobRecord(record), output };
}

/**
 * @param {string} id
 * @returns {{ ok: boolean; job: Omit<JobRecord, 'process'> | null; message: string }}
 */
export function cancelJob(id) {
    const record = JOBS.get(id);
    if (!record) return { ok: false, job: null, message: 'Job not found.' };
    if (!record.process || record.status !== 'running') {
        return { ok: false, job: publicJobRecord(record), message: `Job is ${record.status}.` };
    }
    record.status = 'cancelled';
    record.endedAt = Date.now();
    record.process.kill('SIGTERM');
    void appendJobLog(record.logFile, '\n[job:cancelled]\n');
    return { ok: true, job: publicJobRecord(record), message: 'Job cancelled.' };
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
 * @param {string} logFile
 * @param {string | Buffer} chunk
 * @returns {Promise<void>}
 */
async function appendJobLog(logFile, chunk) {
    await writeFile(logFile, String(chunk), { flag: 'a' });
}
