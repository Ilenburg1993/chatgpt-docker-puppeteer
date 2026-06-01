// @ts-check
/** Process supervision helpers for Cloudflare MCP CLI. */
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export const CLOUDFLARED_TOKEN_FILE_MIN_VERSION = '2025.4.0';

export function readCloudflaredVersion() {
    const result = spawnSync('cloudflared', ['--version'], { encoding: 'utf8' });
    if (result.error) return { ok: false, error: result.error.message };
    if (result.status !== 0) return { ok: false, error: result.stderr.trim() || `cloudflared exited with ${result.status}` };
    const version = result.stdout.trim();
    return { ok: true, version, parsedVersion: parseCloudflaredVersion(version) ?? undefined };
}

export function assessCloudflaredCompatibility(cloudflared, config) {
    if (!cloudflared.ok) return { ok: false, reason: cloudflared.error ?? 'cloudflared-not-available' };
    if (!config.hasTunnelTokenFile) return { ok: true };
    const detectedVersion = cloudflared.parsedVersion ?? parseCloudflaredVersion(cloudflared.version);
    if (!detectedVersion) return { ok: false, minimumVersion: CLOUDFLARED_TOKEN_FILE_MIN_VERSION, detectedVersion: null, reason: 'could-not-parse-cloudflared-version' };
    if (compareVersions(detectedVersion, CLOUDFLARED_TOKEN_FILE_MIN_VERSION) < 0) {
        return { ok: false, minimumVersion: CLOUDFLARED_TOKEN_FILE_MIN_VERSION, detectedVersion, reason: 'token-file-requires-newer-cloudflared' };
    }
    return { ok: true, minimumVersion: CLOUDFLARED_TOKEN_FILE_MIN_VERSION, detectedVersion };
}

function parseCloudflaredVersion(text) {
    const match = String(text ?? '').match(/\b(\d{4}\.\d{1,2}\.\d{1,3})\b/u);
    return match?.[1] ?? null;
}

function compareVersions(left, right) {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        if ((a[i] ?? 0) < (b[i] ?? 0)) return -1;
        if ((a[i] ?? 0) > (b[i] ?? 0)) return 1;
    }
    return 0;
}

export async function readPidFileStatus(pidFile) {
    try {
        const pid = Number((await readFile(pidFile, 'utf8')).trim());
        if (!Number.isInteger(pid) || pid <= 0) return { pidFile, pid: null, alive: false, state: 'invalid', error: 'invalid-pid-file' };
        try {
            process.kill(pid, 0);
            return { pidFile, pid, alive: true, state: 'alive', error: null };
        } catch (error) {
            return { pidFile, pid, alive: false, state: 'dead', error: error instanceof Error ? error.message : String(error) };
        }
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { pidFile, pid: null, alive: false, state: 'missing', error: null };
        return { pidFile, pid: null, alive: false, state: 'invalid', error: error instanceof Error ? error.message : String(error) };
    }
}

export async function ensureDetachedProcess(options) {
    const metadataFile = `${options.pidFile}.json`;
    const signature = { command: options.command, args: options.args, env: redactEnv(options.env ?? {}) };
    const existing = await readPidFileStatus(options.pidFile);
    if (existing.alive) return { name: options.name, pidFile: options.pidFile, logFile: options.logFile, metadataFile, pid: existing.pid, alreadyRunning: true, restarted: false };
    await mkdir(path.dirname(options.pidFile), { recursive: true });
    await mkdir(path.dirname(options.logFile), { recursive: true });
    const out = openSync(options.logFile, 'a');
    let child;
    try {
        child = spawn(options.command, options.args, { detached: true, stdio: ['ignore', out, out], env: { ...process.env, ...(options.env ?? {}) } });
    } finally {
        closeSync(out);
    }
    if (!child.pid) throw new Error(`Could not start ${options.name}`);
    child.unref();
    await writeFile(options.pidFile, `${child.pid}\n`, 'utf8');
    await writeFile(metadataFile, `${JSON.stringify({ schemaVersion: 2, name: options.name, pid: child.pid, startedAt: new Date().toISOString(), signature }, null, 2)}\n`, 'utf8');
    return { name: options.name, pidFile: options.pidFile, logFile: options.logFile, metadataFile, pid: child.pid, alreadyRunning: false, restarted: existing.state === 'dead' };
}

export async function stopPidFileProcess(pidFile) {
    const status = await readPidFileStatus(pidFile);
    if (!status.pid) return { pidFile, pid: null, wasAlive: false, stopped: true, error: null, processGroupSignalled: false };
    let processGroupSignalled = false;
    if (status.alive) {
        try {
            process.kill(-status.pid, 'SIGTERM');
            processGroupSignalled = true;
        } catch {
            try { process.kill(status.pid, 'SIGTERM'); } catch (error) { return { pidFile, pid: status.pid, wasAlive: true, stopped: false, error: error instanceof Error ? error.message : String(error), processGroupSignalled }; }
        }
    }
    await rm(pidFile, { force: true });
    await rm(`${pidFile}.json`, { force: true });
    return { pidFile, pid: status.pid, wasAlive: status.alive, stopped: true, error: null, processGroupSignalled };
}

export async function readProcessMetadata(metadataFile) {
    try { return JSON.parse(await readFile(metadataFile, 'utf8')); } catch { return null; }
}

function redactEnv(env) {
    return Object.fromEntries(Object.entries(env).map(([key, value]) => [key, /TOKEN|SECRET|PASSWORD|KEY/u.test(key) ? '<redacted>' : value]));
}
