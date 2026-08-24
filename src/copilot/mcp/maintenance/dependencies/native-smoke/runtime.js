// @ts-check
/**
 * Fixed native-dependency smoke checks used after dependency maintenance.
 *
 * The checks are intentionally closed: they validate only native/runtime-sensitive packages already used by this
 * repository. No caller-controlled package name, command, cwd or environment is accepted.
 *
 * @module copilot/mcp/maintenance/dependencies/native-smoke/runtime
 */

import { createWorkspaceReadIo } from '#copilot/infra/public/composition/workspace/read-io';
import { createRequire } from 'node:module';
import path from 'node:path';

const requireFromHere = createRequire(import.meta.url);
const dependencySmokeWorkspaceIo = createWorkspaceReadIo({ workspaceRoot: process.cwd() });
const DEFAULT_PTY_TIMEOUT_MS = 5_000;

/** @returns {Promise<Set<string>>} */
async function readDeclaredPackages() {
    const parsed = JSON.parse(
        (
            await dependencySmokeWorkspaceIo.readTextFresh(path.resolve(process.cwd(), 'package.json'), {
                includeHash: false,
            })
        ).content,
    );
    return new Set([
        ...Object.keys(parsed.dependencies ?? {}),
        ...Object.keys(parsed.devDependencies ?? {}),
        ...Object.keys(parsed.optionalDependencies ?? {}),
    ]);
}

/** @param {string} name @param {() => Promise<Record<string, unknown>>} run */
async function runCheck(name, run) {
    const startedAt = performance.now();
    try {
        return {
            name,
            success: true,
            durationMs: Math.round(performance.now() - startedAt),
            ...(await run()),
        };
    } catch (error) {
        return {
            name,
            success: false,
            durationMs: Math.round(performance.now() - startedAt),
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

async function smokeBetterSqlite3() {
    const module = requireFromHere('better-sqlite3');
    const Database = module?.default ?? module;
    const db = new Database(':memory:');
    try {
        const row = db.prepare('select sqlite_version() as version, 1 as ok').get();
        if (!row || row.ok !== 1) throw new Error('better-sqlite3 query did not return the expected row.');
        return { sqliteVersion: String(row.version ?? 'unknown') };
    } finally {
        db.close();
    }
}

async function smokeNodePty() {
    const pty = await import('node-pty');
    if (typeof pty.spawn !== 'function') throw new Error('node-pty does not export spawn().');
    return await new Promise((resolve, reject) => {
        const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
        const args =
            process.platform === 'win32'
                ? ['-NoProfile', '-Command', "Write-Output -NoNewline 'node-pty-ok'"]
                : ['-lc', "printf 'node-pty-ok'"];
        const terminal = pty.spawn(shell, args, {
            cwd: process.cwd(),
            env: /** @type {Record<string, string>} */ (
                Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined))
            ),
            cols: 80,
            rows: 24,
            name: 'xterm-256color',
        });
        let output = '';
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try {
                terminal.kill();
            } catch {
                // Best-effort cleanup only; the timeout error below is the causal failure.
            }
            reject(new Error('node-pty smoke timed out.'));
        }, DEFAULT_PTY_TIMEOUT_MS);
        timer.unref();
        terminal.onData((data) => {
            output += String(data);
            if (output.length > 16_384) output = output.slice(-16_384);
        });
        terminal.onExit((event) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (Number(event.exitCode ?? 1) !== 0) {
                reject(new Error(`node-pty child exited with code ${String(event.exitCode)}.`));
                return;
            }
            if (!output.includes('node-pty-ok')) {
                reject(new Error('node-pty child output did not contain the smoke marker.'));
                return;
            }
            resolve({ backend: 'pty', markerObserved: true });
        });
    });
}

async function smokeLanceDb() {
    const module = await import('@lancedb/lancedb');
    if (typeof module.connect !== 'function') throw new Error('@lancedb/lancedb does not export connect().');
    return { connectExport: true };
}

/**
 * @returns {Promise<{
 *     success: boolean;
 *     checkedCount: number;
 *     skipped: string[];
 *     checks: Record<string, unknown>[];
 * }>}
 */
export async function runDependencyNativeSmoke() {
    const declared = await readDeclaredPackages();
    /** @type {Array<[string, () => Promise<Record<string, unknown>>]>} */
    const candidates = [
        ['better-sqlite3', smokeBetterSqlite3],
        ['node-pty', smokeNodePty],
        ['@lancedb/lancedb', smokeLanceDb],
    ];
    const checks = [];
    const skipped = [];
    for (const [name, run] of candidates) {
        if (!declared.has(name)) {
            skipped.push(name);
            continue;
        }
        checks.push(await runCheck(name, run));
    }
    return {
        success: checks.every((check) => check.success === true),
        checkedCount: checks.length,
        skipped,
        checks,
    };
}
