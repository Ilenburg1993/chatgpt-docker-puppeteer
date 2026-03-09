// @ts-check
/**
 * Helper utilities for scripts
 */

import { execa } from 'execa';
import { spawn } from 'node:child_process';
import fss from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * Logs a message with timestamp
 *
 * @param {string} message
 * @returns {void}
 */
export function log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

/**
 * Logs an error message
 *
 * @param {string} message
 * @returns {void}
 */
export function error(message) {
    console.error(`[${new Date().toISOString()}] ERROR: ${message}`);
}

/**
 * Checks if a file exists
 *
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Reads a JSON file
 *
 * @param {string} filePath
 * @returns {Promise<void>}
 */
export async function readJson(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
}

/**
 * @typedef {object} WriteJsonData
 * @property {any} _ Propriedades definidas via runtime.
 */
/**
 * Writes a JSON file
 *
 * @param {string} filePath
 * @param {WriteJsonData} data
 * @returns {Promise<void>}
 */
export async function writeJson(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

/**
 * Runs a command and returns the result
 *
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<{ stdout: string; stderr: string }>}
 */
export async function runCommand(command, args = []) {
    const result = await execa(command, args);
    return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * Validates that required environment variables are set
 *
 * @param {string[]} vars
 * @returns {void}
 * @throws {Error} if any var is missing
 */
export function validateEnv(vars) {
    const missing = vars.filter((v) => !process.env[v]);
    if (missing.length > 0) {
        throw new Error(`Missing environment variables: ${missing.join(', ')}`);
    }
}

/**
 * Sleeps for the specified milliseconds
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Removes the agent run lock file (legacy helper).
 *
 * @returns {void}
 */
export function removeRunLock() {
    const lockPath = path.join(ROOT, 'run.lock');
    try {
        fss.unlinkSync(lockPath);
    } catch {
        /* lock inexistente — ignorar */
    }
}

/**
 * Cleans the tmp directory (legacy helper).
 *
 * @returns {void}
 */
export function cleanTmp() {
    const tmpDir = path.join(ROOT, 'tmp');
    try {
        if (fss.existsSync(tmpDir)) {
            for (const f of fss.readdirSync(tmpDir)) {
                fss.unlinkSync(path.join(tmpDir, f));
            }
        }
    } catch {
        /* ignorar falhas aqui */
    }
}

/**
 * @typedef {object} AgentHandle
 * @property {import('node:child_process').ChildProcess} proc - Handle do processo
 * @property {Promise<void>} ready - Resolve quando o agente estiver pronto
 */

/**
 * Starts the agent process (legacy helper).
 *
 * @returns {AgentHandle}
 */
export function startAgent() {
    const proc = spawn('node', [path.join(ROOT, 'src/main.js')], {
        detached: false,
        stdio: ['inherit', 'pipe', 'pipe'],
    });
    const ready = /** @type {Promise<void>} */ (
        new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Agent startup timeout')), 30000);
            proc.stdout?.on('data', (/** @type {Buffer} */ chunk) => {
                const text = chunk.toString();
                if (text.includes('online') || text.includes('ready') || text.includes('servidor')) {
                    clearTimeout(timer);
                    resolve();
                }
            });
            proc.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        })
    );
    return { proc, ready };
}

/**
 * Stops the agent process (legacy helper).
 *
 * @param {import('node:child_process').ChildProcess} proc
 * @returns {void}
 */
export function stopAgent(proc) {
    proc.kill('SIGTERM');
}

/**
 * Polls a condition function until it returns true or timeout is reached.
 *
 * @param {() => boolean | Promise<boolean>} fn
 * @param {number} [timeout=10000] Default is `10000`
 * @returns {Promise<boolean>}
 */
export async function waitForCondition(fn, timeout = 10000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        if (await fn()) return true;
        await new Promise((r) => setTimeout(r, 200));
    }
    return false;
}
