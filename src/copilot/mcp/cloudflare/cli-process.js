// @ts-check
/** Process supervision helpers for Cloudflare MCP CLI. */
import { spawn, spawnSync } from 'node:child_process';

import { moveFileLocked } from '#copilot/infra/public/io';
import {
    deleteFileTrusted,
    mkdirPathTrusted,
    openDetachedAppendSinkTrusted,
    readTextFreshTrusted,
    statPathTrusted,
    writeFileAtomicTrusted,
} from '#copilot/infra/public/trusted-io';
import path from 'node:path';
import process from 'node:process';

export const CLOUDFLARED_TOKEN_FILE_MIN_VERSION = '2025.4.0';
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_KILL_TIMEOUT_MS = 2_000;
const STOP_POLL_INTERVAL_MS = 100;
const DEFAULT_DETACHED_LOG_ROTATE_BYTES = 2 * 1024 * 1024;

/**
 * @typedef {{ ok: true; version: string; parsedVersion?: string } | { ok: false; error: string }} CloudflaredVersion
 *
 * @typedef {{
 *     name: string;
 *     command: string;
 *     args: string[];
 *     pidFile: string;
 *     logFile: string;
 *     env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
 *     stateWriter?: (filePath: string, content: string) => Promise<void>;
 * }} DetachedProcessOptions
 */

/** @returns {CloudflaredVersion} */
export function readCloudflaredVersion() {
    const result = spawnSync('cloudflared', ['--version'], { encoding: 'utf8' });
    if (result.error) return { ok: false, error: result.error.message };
    if (result.status !== 0)
        return { ok: false, error: result.stderr.trim() || `cloudflared exited with ${result.status}` };
    const version = result.stdout.trim();
    const parsedVersion = parseCloudflaredVersion(version);
    return parsedVersion ? { ok: true, version, parsedVersion } : { ok: true, version };
}

/**
 * @param {CloudflaredVersion} cloudflared
 * @param {import('./config.js').CloudflareTunnelConfig} config
 * @returns {{ ok: boolean; reason?: string; minimumVersion?: string; detectedVersion?: string | null }}
 */
export function assessCloudflaredCompatibility(cloudflared, config) {
    if (!cloudflared.ok) return { ok: false, reason: cloudflared.error ?? 'cloudflared-not-available' };
    if (!config.hasTunnelTokenFile) return { ok: true };
    const detectedVersion = cloudflared.parsedVersion ?? parseCloudflaredVersion(cloudflared.version);
    if (!detectedVersion)
        return {
            ok: false,
            minimumVersion: CLOUDFLARED_TOKEN_FILE_MIN_VERSION,
            detectedVersion: null,
            reason: 'could-not-parse-cloudflared-version',
        };
    if (compareVersions(detectedVersion, CLOUDFLARED_TOKEN_FILE_MIN_VERSION) < 0) {
        return {
            ok: false,
            minimumVersion: CLOUDFLARED_TOKEN_FILE_MIN_VERSION,
            detectedVersion,
            reason: 'token-file-requires-newer-cloudflared',
        };
    }
    return { ok: true, minimumVersion: CLOUDFLARED_TOKEN_FILE_MIN_VERSION, detectedVersion };
}

/** @param {unknown} text @returns {string | null} */
function parseCloudflaredVersion(text) {
    const match = String(text ?? '').match(/\b(\d{4}\.\d{1,2}\.\d{1,3})\b/u);
    return match?.[1] ?? null;
}

/** @param {string} left @param {string} right @returns {-1 | 0 | 1} */
function compareVersions(left, right) {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        if ((a[i] ?? 0) < (b[i] ?? 0)) return -1;
        if ((a[i] ?? 0) > (b[i] ?? 0)) return 1;
    }
    return 0;
}

/**
 * @param {string} pidFile
 * @returns {Promise<{
 *     pidFile: string;
 *     pid: number | null;
 *     alive: boolean;
 *     state: 'alive' | 'dead' | 'missing' | 'invalid';
 *     error: string | null;
 * }>}
 */
export async function readPidFileStatus(pidFile) {
    try {
        const pid = Number(
            (await readTextFreshTrusted(pidFile, { caller: 'mcp.cloudflare.cli-process' })).content.trim(),
        );
        if (!Number.isInteger(pid) || pid <= 0)
            return { pidFile, pid: null, alive: false, state: 'invalid', error: 'invalid-pid-file' };
        try {
            process.kill(pid, 0);
            return { pidFile, pid, alive: true, state: 'alive', error: null };
        } catch (error) {
            return {
                pidFile,
                pid,
                alive: false,
                state: 'dead',
                error: error instanceof Error ? error.message : String(error),
            };
        }
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
            return { pidFile, pid: null, alive: false, state: 'missing', error: null };
        return {
            pidFile,
            pid: null,
            alive: false,
            state: 'invalid',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Rotaciona apenas antes de um novo processo abrir o log. Isso evita renomear o inode atualmente mantido por um
 * processo vivo e mantém uma única geração `.1` para diagnóstico pós-restart.
 *
 * @param {string} logFile
 * @param {{ maxBytes?: number }} [options]
 * @returns {Promise<{ rotated: boolean; previousBytes: number; rotatedPath: string | null }>}
 */
export async function rotateDetachedProcessLogIfOversized(logFile, options = {}) {
    const maxBytes =
        Number.isFinite(options.maxBytes) && Number(options.maxBytes) > 0
            ? Math.trunc(Number(options.maxBytes))
            : DEFAULT_DETACHED_LOG_ROTATE_BYTES;
    let currentStats;
    try {
        currentStats = (await statPathTrusted(logFile, { caller: 'mcp.cloudflare.cli-process' })).stats;
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return { rotated: false, previousBytes: 0, rotatedPath: null };
        }
        throw error;
    }
    if (!currentStats.isFile() || currentStats.size <= maxBytes) {
        return { rotated: false, previousBytes: currentStats.size, rotatedPath: null };
    }
    const rotatedPath = `${logFile}.1`;
    await moveFileLocked(logFile, rotatedPath, { overwrite: true });
    return { rotated: true, previousBytes: currentStats.size, rotatedPath };
}

/**
 * @param {DetachedProcessOptions} options
 * @returns {Promise<{
 *     name: string;
 *     pidFile: string;
 *     logFile: string;
 *     metadataFile: string;
 *     pid: number;
 *     alreadyRunning: boolean;
 *     restarted: boolean;
 * }>}
 */
export async function ensureDetachedProcess(options) {
    const metadataFile = `${options.pidFile}.json`;
    const signature = { command: options.command, args: options.args, env: redactEnv(options.env ?? {}) };
    const existing = await readPidFileStatus(options.pidFile);
    if (existing.alive && existing.pid !== null)
        return {
            name: options.name,
            pidFile: options.pidFile,
            logFile: options.logFile,
            metadataFile,
            pid: existing.pid,
            alreadyRunning: true,
            restarted: false,
        };
    await mkdirPathTrusted(path.dirname(options.pidFile), {
        caller: 'mcp.cloudflare.cli-process',
        recursive: true,
    });
    await rotateDetachedProcessLogIfOversized(options.logFile);
    const logSink = await openDetachedAppendSinkTrusted(options.logFile, {
        caller: 'mcp.cloudflare.cli-process',
        mode: 0o600,
    });
    let child;
    try {
        child = spawn(options.command, options.args, {
            detached: true,
            stdio: ['ignore', logSink.handle.fd, logSink.handle.fd],
            env: { ...process.env, ...(options.env ?? {}) },
        });
    } finally {
        await logSink.handle.close();
    }
    if (!child.pid) throw new Error(`Could not start ${options.name}`);
    child.unref();
    const stateWriter =
        options.stateWriter ??
        ((filePath, content) =>
            writeFileAtomicTrusted(filePath, content, { caller: 'mcp.cloudflare.cli-process', mode: 0o600 }));
    try {
        await stateWriter(
            metadataFile,
            `${JSON.stringify(
                {
                    schemaVersion: 2,
                    name: options.name,
                    pid: child.pid,
                    startedAt: new Date().toISOString(),
                    signature,
                },
                null,
                2,
            )}\n`,
        );
        // PID is the readiness marker and must be published only after metadata is durable.
        await stateWriter(options.pidFile, `${child.pid}\n`);
    } catch (error) {
        await terminateDetachedProcess(child.pid);
        await Promise.all([
            deleteFileTrusted(options.pidFile, { caller: 'mcp.cloudflare.cli-process', ignoreMissing: true }),
            deleteFileTrusted(metadataFile, { caller: 'mcp.cloudflare.cli-process', ignoreMissing: true }),
        ]);
        throw error;
    }
    return {
        name: options.name,
        pidFile: options.pidFile,
        logFile: options.logFile,
        metadataFile,
        pid: child.pid,
        alreadyRunning: false,
        restarted: existing.state === 'dead',
    };
}

/**
 * @param {number} pid
 * @returns {Promise<void>}
 */
async function terminateDetachedProcess(pid) {
    try {
        process.kill(-pid, 'SIGTERM');
    } catch {
        try {
            process.kill(pid, 'SIGTERM');
        } catch {
            return;
        }
    }
    if (await waitForPidExit(pid, DEFAULT_KILL_TIMEOUT_MS)) return;
    try {
        process.kill(-pid, 'SIGKILL');
    } catch {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // Process exited between the wait and the forced kill.
        }
    }
    await waitForPidExit(pid, DEFAULT_KILL_TIMEOUT_MS);
}

/**
 * @param {string} pidFile
 * @returns {Promise<{
 *     pidFile: string;
 *     pid: number | null;
 *     wasAlive: boolean;
 *     stopped: boolean;
 *     error: string | null;
 *     processGroupSignalled: boolean;
 *     forcedKilled: boolean;
 *     stopWaitMs: number;
 * }>}
 */
export async function stopPidFileProcess(pidFile) {
    const status = await readPidFileStatus(pidFile);
    if (!status.pid) {
        return {
            pidFile,
            pid: null,
            wasAlive: false,
            stopped: true,
            error: null,
            processGroupSignalled: false,
            forcedKilled: false,
            stopWaitMs: 0,
        };
    }
    let processGroupSignalled = false;
    let forcedKilled = false;
    const startedAt = Date.now();
    if (status.alive) {
        try {
            process.kill(-status.pid, 'SIGTERM');
            processGroupSignalled = true;
        } catch {
            try {
                process.kill(status.pid, 'SIGTERM');
            } catch (error) {
                return {
                    pidFile,
                    pid: status.pid,
                    wasAlive: true,
                    stopped: false,
                    error: error instanceof Error ? error.message : String(error),
                    processGroupSignalled,
                    forcedKilled,
                    stopWaitMs: Date.now() - startedAt,
                };
            }
        }
        let stopped = await waitForPidExit(status.pid, readStopTimeoutMs(process.env));
        if (!stopped) {
            forcedKilled = true;
            try {
                process.kill(processGroupSignalled ? -status.pid : status.pid, 'SIGKILL');
            } catch {
                // Process may have exited between the timeout and SIGKILL.
            }
            stopped = await waitForPidExit(status.pid, DEFAULT_KILL_TIMEOUT_MS);
        }
        if (!stopped) {
            return {
                pidFile,
                pid: status.pid,
                wasAlive: true,
                stopped: false,
                error: 'process-still-alive-after-stop-timeout',
                processGroupSignalled,
                forcedKilled,
                stopWaitMs: Date.now() - startedAt,
            };
        }
    }
    await Promise.all([
        deleteFileTrusted(pidFile, { caller: 'mcp.cloudflare.cli-process', ignoreMissing: true }),
        deleteFileTrusted(`${pidFile}.json`, { caller: 'mcp.cloudflare.cli-process', ignoreMissing: true }),
    ]);
    return {
        pidFile,
        pid: status.pid,
        wasAlive: status.alive,
        stopped: true,
        error: null,
        processGroupSignalled,
        forcedKilled,
        stopWaitMs: Date.now() - startedAt,
    };
}

/**
 * @param {number} pid
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitForPidExit(pid, timeoutMs) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (isPidAlive(pid)) {
        if (Date.now() >= deadline) return false;
        await sleep(STOP_POLL_INTERVAL_MS);
    }
    return true;
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {number}
 */
function readStopTimeoutMs(env) {
    const parsed = Number(env['COPILOT_MCP_PROCESS_STOP_TIMEOUT_MS'] ?? DEFAULT_STOP_TIMEOUT_MS);
    return Number.isFinite(parsed) && parsed >= 500 ? Math.floor(parsed) : DEFAULT_STOP_TIMEOUT_MS;
}

/** @param {string} metadataFile @returns {Promise<unknown | null>} */
export async function readProcessMetadata(metadataFile) {
    try {
        return JSON.parse((await readTextFreshTrusted(metadataFile, { caller: 'mcp.cloudflare.cli-process' })).content);
    } catch {
        return null;
    }
}

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env @returns {Record<string, string | undefined>} */
function redactEnv(env) {
    return Object.fromEntries(
        Object.entries(env).map(([key, value]) => [key, /TOKEN|SECRET|PASSWORD|KEY/u.test(key) ? '<redacted>' : value]),
    );
}
