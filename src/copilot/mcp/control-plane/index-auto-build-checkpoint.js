// @ts-check
/**
 * Persistent checkpoint + cheap Git evidence for MCP index startup.
 *
 * A clean tracked file is immutable while HEAD is unchanged. Dirty/untracked paths are always refreshed explicitly, and
 * commit-to-commit changes are derived from `git diff --name-status`. This lets startup avoid scanning the whole tree on
 * every restart while preserving a periodic full reconciliation safety net.
 *
 * @module copilot/mcp/control-plane/index-auto-build-checkpoint
 */

import { getCopilotDb } from '#copilot/db';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const TABLE = 'copilot_mcp_index_startup_checkpoint';
const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * @typedef {{ status: string; path: string; deleted: boolean }} IndexGitPathChange
 * @typedef {{
 *     available: boolean;
 *     head: string | null;
 *     worktreeChanges: IndexGitPathChange[];
 *     uncertain: boolean;
 *     error: string | null;
 *     durationMs: number;
 * }} IndexGitSnapshot
 * @typedef {{
 *     scopePath: string;
 *     head: string;
 *     schemaVersion: number;
 *     completedAtMs: number;
 *     lastFullReconcileAtMs: number;
 * }} IndexStartupCheckpoint
 */

/**
 * @param {import('better-sqlite3').Database} [db]
 */
function ensureCheckpointSchema(db = getCopilotDb()) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
            scope_path TEXT PRIMARY KEY,
            head TEXT NOT NULL,
            schema_version INTEGER NOT NULL,
            completed_at_ms INTEGER NOT NULL,
            last_full_reconcile_at_ms INTEGER NOT NULL
        ) STRICT;
    `);
    return db;
}

/** @param {string} scopePath @param {import('better-sqlite3').Database} [db] */
export function readIndexStartupCheckpoint(scopePath, db = getCopilotDb()) {
    ensureCheckpointSchema(db);
    const row = /** @type {IndexStartupCheckpoint | undefined} */ (
        db
            .prepare(
                `SELECT scope_path AS scopePath, head, schema_version AS schemaVersion,
                        completed_at_ms AS completedAtMs, last_full_reconcile_at_ms AS lastFullReconcileAtMs
                 FROM ${TABLE} WHERE scope_path = ?`,
            )
            .get(scopePath)
    );
    return row ?? null;
}

/**
 * @param {{ scopePath: string; head: string; schemaVersion: number; mode: 'full-reconcile' | 'incremental' | 'skip'; nowMs?: number }} input
 * @param {import('better-sqlite3').Database} [db]
 */
export function writeIndexStartupCheckpoint(input, db = getCopilotDb()) {
    ensureCheckpointSchema(db);
    const previous = readIndexStartupCheckpoint(input.scopePath, db);
    const nowMs = input.nowMs ?? Date.now();
    const lastFullReconcileAtMs =
        input.mode === 'full-reconcile' ? nowMs : (previous?.lastFullReconcileAtMs ?? nowMs);
    db.prepare(
        `INSERT INTO ${TABLE}(scope_path, head, schema_version, completed_at_ms, last_full_reconcile_at_ms)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(scope_path) DO UPDATE SET
             head = excluded.head,
             schema_version = excluded.schema_version,
             completed_at_ms = excluded.completed_at_ms,
             last_full_reconcile_at_ms = excluded.last_full_reconcile_at_ms`,
    ).run(input.scopePath, input.head, input.schemaVersion, nowMs, lastFullReconcileAtMs);
    return {
        scopePath: input.scopePath,
        head: input.head,
        schemaVersion: input.schemaVersion,
        completedAtMs: nowMs,
        lastFullReconcileAtMs,
    };
}

/**
 * @param {{ workspaceRoot: string; scopePath: string }} input
 * @returns {Promise<IndexGitSnapshot>}
 */
export async function readIndexGitSnapshot(input) {
    const startedAt = Date.now();
    try {
        const [headResult, statusResult] = await Promise.all([
            runGit(input.workspaceRoot, ['rev-parse', 'HEAD']),
            runGit(input.workspaceRoot, [
                'status',
                '--porcelain=v1',
                '-z',
                '--untracked-files=all',
                '--no-renames',
                '--',
                input.scopePath,
            ]),
        ]);
        const head = headResult.trim();
        const parsed = parseGitStatusZ(statusResult);
        return {
            available: Boolean(head),
            head: head || null,
            worktreeChanges: parsed.changes,
            uncertain: parsed.uncertain || !head,
            error: null,
            durationMs: Math.max(0, Date.now() - startedAt),
        };
    } catch (error) {
        return {
            available: false,
            head: null,
            worktreeChanges: [],
            uncertain: true,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Math.max(0, Date.now() - startedAt),
        };
    }
}

/**
 * @param {{ workspaceRoot: string; scopePath: string; fromHead: string; toHead: string }} input
 */
export async function readCommittedIndexChanges(input) {
    if (input.fromHead === input.toHead) return { available: true, changes: [], uncertain: false, durationMs: 0 };
    const startedAt = Date.now();
    try {
        const output = await runGit(input.workspaceRoot, [
            'diff',
            '--name-status',
            '-z',
            '--no-renames',
            input.fromHead,
            input.toHead,
            '--',
            input.scopePath,
        ]);
        const parsed = parseGitNameStatusZ(output);
        return {
            available: true,
            changes: parsed.changes,
            uncertain: parsed.uncertain,
            durationMs: Math.max(0, Date.now() - startedAt),
        };
    } catch {
        return {
            available: false,
            changes: [],
            uncertain: true,
            durationMs: Math.max(0, Date.now() - startedAt),
        };
    }
}

/**
 * Pure startup decision. Full reconciliation wins on any missing/uncertain evidence.
 *
 * @param {{
 *     checkpoint: IndexStartupCheckpoint | null;
 *     gitSnapshot: IndexGitSnapshot;
 *     schemaVersion: number;
 *     indexFiles: number;
 *     nowMs?: number;
 *     fullReconcileIntervalMs: number;
 * }} input
 */
export function planIndexStartup(input) {
    const nowMs = input.nowMs ?? Date.now();
    if (!input.checkpoint) return { mode: 'full-reconcile', reason: 'checkpoint-missing', worktreeChanges: [] };
    if (!input.gitSnapshot.available || input.gitSnapshot.uncertain || !input.gitSnapshot.head) {
        return { mode: 'full-reconcile', reason: 'git-evidence-uncertain', worktreeChanges: [] };
    }
    if (input.indexFiles <= 0) return { mode: 'full-reconcile', reason: 'index-empty', worktreeChanges: [] };
    if (input.checkpoint.schemaVersion !== input.schemaVersion) {
        return { mode: 'full-reconcile', reason: 'schema-version-changed', worktreeChanges: [] };
    }
    if (nowMs - input.checkpoint.lastFullReconcileAtMs >= input.fullReconcileIntervalMs) {
        return { mode: 'full-reconcile', reason: 'periodic-safety-reconcile', worktreeChanges: [] };
    }
    if (input.checkpoint.head !== input.gitSnapshot.head) {
        return {
            mode: 'incremental',
            reason: 'head-changed',
            worktreeChanges: input.gitSnapshot.worktreeChanges,
            needsCommittedDiff: true,
        };
    }
    if (input.gitSnapshot.worktreeChanges.length > 0) {
        return {
            mode: 'incremental',
            reason: 'worktree-dirty',
            worktreeChanges: input.gitSnapshot.worktreeChanges,
            needsCommittedDiff: false,
        };
    }
    return { mode: 'skip', reason: 'head-and-worktree-unchanged', worktreeChanges: [], needsCommittedDiff: false };
}

/** @param {string} output */
export function parseGitStatusZ(output) {
    /** @type {IndexGitPathChange[]} */
    const changes = [];
    let uncertain = false;
    for (const record of output.split('\0')) {
        if (!record) continue;
        if (record.length < 4 || record[2] !== ' ') {
            uncertain = true;
            continue;
        }
        const status = record.slice(0, 2);
        const filePath = record.slice(3);
        const conflict = status.includes('U') || status === 'AA' || status === 'DD';
        if (conflict) uncertain = true;
        changes.push({ status, path: filePath, deleted: status.includes('D') });
    }
    return { changes, uncertain };
}

/** @param {string} output */
export function parseGitNameStatusZ(output) {
    const parts = output.split('\0').filter(Boolean);
    /** @type {IndexGitPathChange[]} */
    const changes = [];
    let uncertain = parts.length % 2 !== 0;
    for (let index = 0; index + 1 < parts.length; index += 2) {
        const status = parts[index] ?? '';
        const filePath = parts[index + 1] ?? '';
        if (!status || !filePath || status.startsWith('U')) uncertain = true;
        changes.push({ status, path: filePath, deleted: status.startsWith('D') });
    }
    return { changes, uncertain };
}

/** @param {string} cwd @param {string[]} args */
async function runGit(cwd, args) {
    const { stdout } = await execFileAsync('git', args, {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        encoding: 'utf8',
    });
    return String(stdout ?? '');
}
