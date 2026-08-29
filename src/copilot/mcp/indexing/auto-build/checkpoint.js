// @ts-check
/**
 * Persistent checkpoint + cheap Git evidence for MCP index startup.
 *
 * A clean tracked file is immutable while HEAD is unchanged. Dirty/untracked paths are always refreshed explicitly, and
 * commit-to-commit changes are derived from `git diff --name-status`. This lets startup avoid scanning the whole tree
 * on every restart while preserving a periodic full reconciliation safety net.
 *
 * @module copilot/mcp/indexing/auto-build/checkpoint
 */

import { execWorkspaceGit, parseGitNameStatusZ } from '#copilot/mcp/public/workspace/git';
import { isAbsolute, normalize, relative } from 'node:path';
const TABLE = 'copilot_mcp_index_startup_checkpoint';
const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * @typedef {{ status: string; path: string; deleted: boolean }} IndexGitPathChange
 *
 * @typedef {{
 *     available: boolean;
 *     head: string | null;
 *     worktreeChanges: IndexGitPathChange[];
 *     uncertain: boolean;
 *     error: string | null;
 *     durationMs: number;
 * }} IndexGitSnapshot
 *
 * @typedef {{
 *     scopePath: string;
 *     head: string;
 *     schemaVersion: number;
 *     completedAtMs: number;
 *     lastFullReconcileAtMs: number;
 *     journalSequence: number;
 *     hashVerificationCursor: string;
 * }} IndexStartupCheckpoint
 *
 * @typedef {{
 *     available: boolean;
 *     gapDetected: boolean;
 *     truncated: boolean;
 *     replayablePathCount: number;
 *     recursiveScopeInvalidation: boolean;
 *     invalidPathRows?: number;
 * }} IndexJournalReplayEvidence
 */

/**
 * @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db
 */
function ensureCheckpointSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
            scope_path TEXT PRIMARY KEY,
            head TEXT NOT NULL,
            schema_version INTEGER NOT NULL,
            completed_at_ms INTEGER NOT NULL,
            last_full_reconcile_at_ms INTEGER NOT NULL,
            journal_sequence INTEGER NOT NULL DEFAULT 0,
            hash_verification_cursor TEXT NOT NULL DEFAULT ''
        ) STRICT;
    `);
    const columns = /** @type {{ name?: string }[]} */ (db.prepare(`PRAGMA table_info(${TABLE})`).all());
    if (!columns.some((column) => column.name === 'journal_sequence')) {
        db.exec(`ALTER TABLE ${TABLE} ADD COLUMN journal_sequence INTEGER NOT NULL DEFAULT 0`);
    }
    if (!columns.some((column) => column.name === 'hash_verification_cursor')) {
        db.exec(`ALTER TABLE ${TABLE} ADD COLUMN hash_verification_cursor TEXT NOT NULL DEFAULT ''`);
    }
    return db;
}

/** @param {string} scopePath @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db */
export function readIndexStartupCheckpoint(scopePath, db) {
    ensureCheckpointSchema(db);
    const row = /** @type {IndexStartupCheckpoint | undefined} */ (
        db
            .prepare(
                `SELECT scope_path AS scopePath, head, schema_version AS schemaVersion,
                        completed_at_ms AS completedAtMs, last_full_reconcile_at_ms AS lastFullReconcileAtMs,
                        journal_sequence AS journalSequence, hash_verification_cursor AS hashVerificationCursor
                 FROM ${TABLE} WHERE scope_path = ?`,
            )
            .get(scopePath)
    );
    return row ?? null;
}

/**
 * @param {{
 *     scopePath: string;
 *     head: string;
 *     schemaVersion: number;
 *     mode: 'full-reconcile' | 'incremental' | 'skip';
 *     nowMs?: number;
 *     journalSequence?: number;
 *     hashVerificationCursor?: string;
 * }} input
 * @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db
 */
export function writeIndexStartupCheckpoint(input, db) {
    ensureCheckpointSchema(db);
    const previous = readIndexStartupCheckpoint(input.scopePath, db);
    const nowMs = input.nowMs ?? Date.now();
    const lastFullReconcileAtMs = input.mode === 'full-reconcile' ? nowMs : (previous?.lastFullReconcileAtMs ?? nowMs);
    const journalSequence = normalizeJournalSequence(input.journalSequence, previous?.journalSequence ?? 0);
    const hashVerificationCursor = normalizeHashVerificationCursor(
        input.hashVerificationCursor,
        input.mode === 'full-reconcile' ? '' : (previous?.hashVerificationCursor ?? ''),
    );
    db.prepare(
        `INSERT INTO ${TABLE}(scope_path, head, schema_version, completed_at_ms, last_full_reconcile_at_ms, journal_sequence, hash_verification_cursor)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_path) DO UPDATE SET
             head = excluded.head,
             schema_version = excluded.schema_version,
             completed_at_ms = excluded.completed_at_ms,
             last_full_reconcile_at_ms = excluded.last_full_reconcile_at_ms,
             journal_sequence = excluded.journal_sequence,
             hash_verification_cursor = excluded.hash_verification_cursor`,
    ).run(
        input.scopePath,
        input.head,
        input.schemaVersion,
        nowMs,
        lastFullReconcileAtMs,
        journalSequence,
        hashVerificationCursor,
    );
    return {
        scopePath: input.scopePath,
        head: input.head,
        schemaVersion: input.schemaVersion,
        completedAtMs: nowMs,
        lastFullReconcileAtMs,
        journalSequence,
        hashVerificationCursor,
    };
}

/**
 * @param {{ workspaceRoot: string; scopePath: string; gitConfig: import('#copilot/mcp/public/workspace/git').McpGitProcessConfig; signal?: AbortSignal }} input
 * @returns {Promise<IndexGitSnapshot>}
 */
export async function readIndexGitSnapshot(input) {
    const startedAt = Date.now();
    try {
        const [headResult, statusResult] = await Promise.all([
            runGit(input.workspaceRoot, ['rev-parse', 'HEAD'], input.gitConfig, input.signal),
            runGit(
                input.workspaceRoot,
                ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames', '--', input.scopePath],
                input.gitConfig,
                input.signal,
            ),
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
 * @param {{ workspaceRoot: string; scopePath: string; fromHead: string; toHead: string; gitConfig: import('#copilot/mcp/public/workspace/git').McpGitProcessConfig; signal?: AbortSignal }} input
 */
export async function readCommittedIndexChanges(input) {
    if (input.fromHead === input.toHead) return { available: true, changes: [], uncertain: false, durationMs: 0 };
    const startedAt = Date.now();
    try {
        const output = await runGit(
            input.workspaceRoot,
            ['diff', '--name-status', '-z', '--no-renames', input.fromHead, input.toHead, '--', input.scopePath],
            input.gitConfig,
            input.signal,
        );
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
 *     journalReplay?: IndexJournalReplayEvidence;
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
    if (input.journalReplay) {
        if (!input.journalReplay.available) {
            return { mode: 'full-reconcile', reason: 'journal-evidence-unavailable', worktreeChanges: [] };
        }
        if (input.journalReplay.gapDetected) {
            return { mode: 'full-reconcile', reason: 'journal-gap-detected', worktreeChanges: [] };
        }
        if (input.journalReplay.truncated) {
            return { mode: 'full-reconcile', reason: 'journal-replay-truncated', worktreeChanges: [] };
        }
        if (Number(input.journalReplay.invalidPathRows ?? 0) > 0) {
            return { mode: 'full-reconcile', reason: 'journal-invalid-path', worktreeChanges: [] };
        }
        if (input.journalReplay.recursiveScopeInvalidation) {
            return { mode: 'full-reconcile', reason: 'journal-recursive-invalidation', worktreeChanges: [] };
        }
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
    if (Number(input.journalReplay?.replayablePathCount ?? 0) > 0) {
        return {
            mode: 'incremental',
            reason: 'journal-replay',
            worktreeChanges: [],
            needsCommittedDiff: false,
        };
    }
    return { mode: 'skip', reason: 'head-and-worktree-unchanged', worktreeChanges: [], needsCommittedDiff: false };
}

/**
 * Classify replay rows against one already-resolved startup scope.
 *
 * Journal paths are hints, not path authority: malformed/non-absolute rows are unsafe, outside-scope rows are ignored,
 * and recursive/root invalidations require a full reconcile.
 *
 * @param {{ filePath?: unknown; recursive?: unknown }[]} rows
 * @param {string} scopeRoot
 */
export function classifyIndexJournalReplayRows(rows, scopeRoot) {
    if (!isAbsolute(scopeRoot)) throw new TypeError('Index journal replay scopeRoot must already be absolute.');
    const normalizedScopeRoot = normalize(scopeRoot);
    const uniquePaths = new Set();
    let outsideScopeRows = 0;
    let hiddenScopeRows = 0;
    let invalidPathRows = 0;
    let recursiveScopeInvalidation = false;
    for (const row of rows) {
        if (typeof row.filePath !== 'string' || !row.filePath || !isAbsolute(row.filePath)) {
            invalidPathRows += 1;
            continue;
        }
        const candidate = normalize(row.filePath);
        const rel = relative(normalizedScopeRoot, candidate);
        const insideScope = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
        if (!insideScope) {
            outsideScopeRows += 1;
            continue;
        }
        if (rel.split('/').some((segment) => segment.startsWith('.') && segment.length > 1)) {
            hiddenScopeRows += 1;
            continue;
        }
        if (rel === '' || Number(row.recursive ?? 0) === 1 || row.recursive === true) {
            recursiveScopeInvalidation = true;
            continue;
        }
        uniquePaths.add(candidate);
    }
    return {
        paths: [...uniquePaths],
        replayablePathCount: uniquePaths.size,
        outsideScopeRows,
        hiddenScopeRows,
        invalidPathRows,
        recursiveScopeInvalidation,
    };
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

export { parseGitNameStatusZ } from '#copilot/mcp/public/workspace/git';

/** @param {unknown} value @param {number} fallback */
function normalizeJournalSequence(value, fallback) {
    const parsed = Number(value ?? fallback);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {import('#copilot/mcp/public/workspace/git').McpGitProcessConfig} gitConfig
 * @param {AbortSignal | undefined} signal
 */
async function runGit(cwd, args, gitConfig, signal) {
    const result = await execWorkspaceGit(args, {
        cwd,
        config: gitConfig,
        timeoutMs: GIT_TIMEOUT_MS,
        maxBufferBytes: GIT_MAX_BUFFER,
        ...(signal ? { signal } : {}),
    });
    if (!result.success) throw new Error(result.error ?? 'Index Git evidence command failed.');
    return result.stdout;
}
/** @param {unknown} value @param {string} fallback */
function normalizeHashVerificationCursor(value, fallback) {
    return typeof value === 'string' ? value : fallback;
}
