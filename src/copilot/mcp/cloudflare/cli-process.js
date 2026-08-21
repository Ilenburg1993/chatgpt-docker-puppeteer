// @ts-check
/**
 * Bound process supervision for the Cloudflare MCP control plane.
 *
 * Filesystem authority is minted once from `CloudflareTunnelConfig`. Operational methods never accept PID, metadata or
 * log paths, so callers cannot retarget privileged IO after controller construction.
 *
 * @module copilot/mcp/cloudflare/cli-process
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

export const CLOUDFLARED_TOKEN_FILE_MIN_VERSION = '2025.4.0';
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_KILL_TIMEOUT_MS = 2_000;
const STOP_POLL_INTERVAL_MS = 100;
const DEFAULT_DETACHED_LOG_ROTATE_BYTES = 2 * 1024 * 1024;
const DEFAULT_LOG_TAIL_BYTES = 64 * 1024;
const MAX_LOG_TAIL_BYTES = 1024 * 1024;

/**
 * @typedef {{ ok: true; version: string; parsedVersion?: string } | { ok: false; error: string }} CloudflaredVersion
 * @typedef {'mcpHttp'|'cloudflared'} CloudflareManagedProcessKey
 * @typedef {{
 *     name: string;
 *     command: string;
 *     args: string[];
 *     env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
 *     beforePidPublish?: (() => void | Promise<void>) | undefined;
 * }} BoundDetachedProcessOptions
 * @typedef {{
 *     key: CloudflareManagedProcessKey;
 *     name: string;
 *     pidFile: string;
 *     metadataFile: string;
 *     logFile: string;
 *     rotatedLogFile: string;
 *     resolvedPidFile: string;
 *     resolvedMetadataFile: string;
 *     resolvedLogFile: string;
 *     resolvedRotatedLogFile: string;
 * }} BoundProcessPaths
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
 * Create the only filesystem authority used by managed MCP/cloudflared process supervision.
 *
 * The configured PID/log paths are resolved eagerly. A later `cwd` change therefore cannot retarget process state.
 * Metadata and the single rotated log generation are derived inside this owner and included in the exact-path grant.
 *
 * @param {import('./config.js').CloudflareTunnelConfig} config
 */
export function createCloudflareManagedProcessController(config) {
    const mcpHttpPaths = createBoundProcessPaths('mcpHttp', 'mcp-http', config.mcpHttpPidFile, config.mcpHttpLogFile);
    const cloudflaredPaths = createBoundProcessPaths(
        'cloudflared',
        'cloudflared',
        config.managedTunnelPidFile,
        config.managedTunnelLogFile,
    );
    const directories = [
        ...new Set([
            dirname(mcpHttpPaths.resolvedPidFile),
            dirname(mcpHttpPaths.resolvedLogFile),
            dirname(cloudflaredPaths.resolvedPidFile),
            dirname(cloudflaredPaths.resolvedLogFile),
        ]),
    ];
    const exactPaths = [
        ...directories,
        ...flatResolvedProcessPaths(mcpHttpPaths),
        ...flatResolvedProcessPaths(cloudflaredPaths),
    ];
    const io = createConfiguredFsIo(
        createConfiguredFsGrant({
            id: 'mcp.cloudflare.cli-process',
            exactPaths,
            operations: ['read', 'stat', 'write', 'mkdir', 'delete', 'append', 'move'],
            symlinkPolicy: 'deny',
        }),
    );

    const mcpHttp = createBoundProcessFacade(mcpHttpPaths, io);
    const cloudflared = createBoundProcessFacade(cloudflaredPaths, io);
    return Object.freeze({
        mcpHttp,
        cloudflared,
        logs: Object.freeze({
            mcpHttp: mcpHttpPaths.logFile,
            cloudflared: cloudflaredPaths.logFile,
        }),
        async readCloudflaredLogTail(maxBytes = DEFAULT_LOG_TAIL_BYTES) {
            return readBoundLogTail(cloudflaredPaths, io, maxBytes);
        },
    });
}

/**
 * @param {CloudflareManagedProcessKey} key
 * @param {string} name
 * @param {string} pidFile
 * @param {string} logFile
 * @returns {Readonly<BoundProcessPaths>}
 */
function createBoundProcessPaths(key, name, pidFile, logFile) {
    const metadataFile = `${pidFile}.json`;
    const rotatedLogFile = `${logFile}.1`;
    return Object.freeze({
        key,
        name,
        pidFile,
        metadataFile,
        logFile,
        rotatedLogFile,
        resolvedPidFile: resolve(pidFile),
        resolvedMetadataFile: resolve(metadataFile),
        resolvedLogFile: resolve(logFile),
        resolvedRotatedLogFile: resolve(rotatedLogFile),
    });
}

/** @param {BoundProcessPaths} paths */
function flatResolvedProcessPaths(paths) {
    return [paths.resolvedPidFile, paths.resolvedMetadataFile, paths.resolvedLogFile, paths.resolvedRotatedLogFile];
}

/**
 * @param {BoundProcessPaths} paths
 * @param {ReturnType<typeof createConfiguredFsIo>} io
 */
function createBoundProcessFacade(paths, io) {
    return Object.freeze({
        name: paths.name,
        pidFile: paths.pidFile,
        metadataFile: paths.metadataFile,
        logFile: paths.logFile,
        rotatedLogFile: paths.rotatedLogFile,
        status: () => readBoundPidFileStatus(paths, io),
        ensure: (/** @type {BoundDetachedProcessOptions} */ options) => ensureBoundDetachedProcess(paths, io, options),
        stop: () => stopBoundPidFileProcess(paths, io),
        readMetadata: () => readBoundProcessMetadata(paths, io),
        rotateLogIfOversized: (/** @type {{maxBytes?:number}} */ options = {}) =>
            rotateBoundProcessLogIfOversized(paths, io, options),
        readLogTail: (/** @type {number} */ maxBytes = DEFAULT_LOG_TAIL_BYTES) => readBoundLogTail(paths, io, maxBytes),
    });
}

/**
 * @param {BoundProcessPaths} paths
 * @param {ReturnType<typeof createConfiguredFsIo>} io
 */
async function readBoundPidFileStatus(paths, io) {
    try {
        const pid = Number((await io.readTextFresh(paths.resolvedPidFile)).content.trim());
        if (!Number.isInteger(pid) || pid <= 0) {
            return {
                pidFile: paths.pidFile,
                pid: null,
                alive: false,
                state: /** @type {const} */ ('invalid'),
                error: 'invalid-pid-file',
            };
        }
        try {
            process.kill(pid, 0);
            return {
                pidFile: paths.pidFile,
                pid,
                alive: true,
                state: /** @type {const} */ ('alive'),
                error: null,
            };
        } catch (error) {
            return {
                pidFile: paths.pidFile,
                pid,
                alive: false,
                state: /** @type {const} */ ('dead'),
                error: error instanceof Error ? error.message : String(error),
            };
        }
    } catch (error) {
        if (isNotFoundError(error)) {
            return {
                pidFile: paths.pidFile,
                pid: null,
                alive: false,
                state: /** @type {const} */ ('missing'),
                error: null,
            };
        }
        return {
            pidFile: paths.pidFile,
            pid: null,
            alive: false,
            state: /** @type {const} */ ('invalid'),
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Rotate only before a new process opens the log. Both source and destination are exact paths in the same grant.
 *
 * @param {BoundProcessPaths} paths
 * @param {ReturnType<typeof createConfiguredFsIo>} io
 * @param {{maxBytes?:number}} [options]
 */
async function rotateBoundProcessLogIfOversized(paths, io, options = {}) {
    const maxBytes =
        Number.isFinite(options.maxBytes) && Number(options.maxBytes) > 0
            ? Math.trunc(Number(options.maxBytes))
            : DEFAULT_DETACHED_LOG_ROTATE_BYTES;
    let currentStats;
    try {
        currentStats = (await io.statPath(paths.resolvedLogFile)).stats;
    } catch (error) {
        if (isNotFoundError(error)) return { rotated: false, previousBytes: 0, rotatedPath: null };
        throw error;
    }
    if (!currentStats.isFile() || currentStats.size <= maxBytes) {
        return { rotated: false, previousBytes: currentStats.size, rotatedPath: null };
    }
    await io.moveFile(paths.resolvedLogFile, paths.resolvedRotatedLogFile, { overwrite: true });
    return { rotated: true, previousBytes: currentStats.size, rotatedPath: paths.rotatedLogFile };
}

/**
 * @param {BoundProcessPaths} paths
 * @param {ReturnType<typeof createConfiguredFsIo>} io
 * @param {BoundDetachedProcessOptions} options
 */
async function ensureBoundDetachedProcess(paths, io, options) {
    const signature = { command: options.command, args: options.args, env: redactEnv(options.env ?? {}) };
    const existing = await readBoundPidFileStatus(paths, io);
    if (existing.alive && existing.pid !== null) {
        return {
            name: options.name,
            pidFile: paths.pidFile,
            logFile: paths.logFile,
            metadataFile: paths.metadataFile,
            pid: existing.pid,
            alreadyRunning: true,
            restarted: false,
        };
    }

    const parentDirectories = [...new Set([dirname(paths.resolvedPidFile), dirname(paths.resolvedLogFile)])];
    await Promise.all(parentDirectories.map((directory) => io.mkdirPath(directory, { recursive: true })));
    await rotateBoundProcessLogIfOversized(paths, io);
    const logSink = await io.openDetachedAppendSink(paths.resolvedLogFile, { mode: 0o600 });
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

    try {
        await io.writeFileAtomic(
            paths.resolvedMetadataFile,
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
            { mode: 0o600 },
        );
        // PID remains the readiness marker and is published only after metadata is durable.
        await options.beforePidPublish?.();
        await io.writeFileAtomic(paths.resolvedPidFile, `${child.pid}\n`, { mode: 0o600 });
    } catch (error) {
        await terminateDetachedProcess(child.pid);
        await Promise.all([
            io.deleteFile(paths.resolvedPidFile, { ignoreMissing: true }),
            io.deleteFile(paths.resolvedMetadataFile, { ignoreMissing: true }),
        ]);
        throw error;
    }
    return {
        name: options.name,
        pidFile: paths.pidFile,
        logFile: paths.logFile,
        metadataFile: paths.metadataFile,
        pid: child.pid,
        alreadyRunning: false,
        restarted: existing.state === 'dead',
    };
}

/** @param {number} pid */
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
 * @param {BoundProcessPaths} paths
 * @param {ReturnType<typeof createConfiguredFsIo>} io
 */
async function stopBoundPidFileProcess(paths, io) {
    const status = await readBoundPidFileStatus(paths, io);
    if (!status.pid) {
        return {
            pidFile: paths.pidFile,
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
                    pidFile: paths.pidFile,
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
                pidFile: paths.pidFile,
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
        io.deleteFile(paths.resolvedPidFile, { ignoreMissing: true }),
        io.deleteFile(paths.resolvedMetadataFile, { ignoreMissing: true }),
    ]);
    return {
        pidFile: paths.pidFile,
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
 * @param {BoundProcessPaths} paths
 * @param {ReturnType<typeof createConfiguredFsIo>} io
 */
async function readBoundProcessMetadata(paths, io) {
    try {
        return JSON.parse((await io.readTextFresh(paths.resolvedMetadataFile)).content);
    } catch {
        return null;
    }
}

/**
 * @param {BoundProcessPaths} paths
 * @param {ReturnType<typeof createConfiguredFsIo>} io
 * @param {number} maxBytes
 */
async function readBoundLogTail(paths, io, maxBytes) {
    const requested = Number(maxBytes);
    const boundedMaxBytes = Number.isFinite(requested)
        ? Math.min(MAX_LOG_TAIL_BYTES, Math.max(1, Math.trunc(requested)))
        : DEFAULT_LOG_TAIL_BYTES;
    const stats = (await io.statPath(paths.resolvedLogFile)).stats;
    if (!stats.isFile()) throw new Error(`Managed process log is not a regular file: ${paths.logFile}`);
    const start = Math.max(0, stats.size - boundedMaxBytes);
    const snapshot = await io.readBytesRangeFresh(paths.resolvedLogFile, {
        start,
        maxBytes: boundedMaxBytes,
        rejectSymlink: true,
    });
    return new TextDecoder('utf-8', { fatal: false }).decode(snapshot.content);
}

/** @param {number} pid @param {number} timeoutMs */
async function waitForPidExit(pid, timeoutMs) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (isPidAlive(pid)) {
        if (Date.now() >= deadline) return false;
        await sleep(STOP_POLL_INTERVAL_MS);
    }
    return true;
}

/** @param {number} pid */
function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** @param {number} ms */
function sleep(ms) {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** @param {NodeJS.ProcessEnv} env */
function readStopTimeoutMs(env) {
    const parsed = Number(env['COPILOT_MCP_PROCESS_STOP_TIMEOUT_MS'] ?? DEFAULT_STOP_TIMEOUT_MS);
    return Number.isFinite(parsed) && parsed >= 500 ? Math.floor(parsed) : DEFAULT_STOP_TIMEOUT_MS;
}

/** @param {unknown} error */
function isNotFoundError(error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env */
function redactEnv(env) {
    return Object.fromEntries(
        Object.entries(env).map(([key, value]) => [key, /TOKEN|SECRET|PASSWORD|KEY/u.test(key) ? '<redacted>' : value]),
    );
}
