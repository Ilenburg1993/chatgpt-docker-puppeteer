// @ts-check
/**
 * Pure Git read-model contracts and machine-output parsers.
 *
 * This module owns no subprocesses and no MCP result semantics. It exists so index startup evidence, public Git read
 * tools and future change-impact/change-session owners share the same revision grammar and NUL-safe parsers.
 *
 * @module copilot/mcp/workspace/git/read-model
 */

const MAX_GIT_REVISION_CHARS = 256;
const MAX_GIT_PICKAXE_CHARS = 1024;
const SAFE_GIT_REVISION_RE = /^[A-Za-z0-9@][A-Za-z0-9._/@{}~^+-]*$/u;

/** @typedef {'ordinary'|'renamed'|'unmerged'|'untracked'|'ignored'} GitStatusEntryKind */
/**
 * @typedef {Readonly<{
 *   kind: GitStatusEntryKind;
 *   path: string;
 *   indexStatus: string;
 *   worktreeStatus: string;
 *   submodule: string | null;
 *   originalPath?: string;
 *   score?: number | null;
 * }>} GitStatusEntry
 *
 * @typedef {Readonly<{
 *   oid: string | null;
 *   head: string | null;
 *   upstream: string | null;
 *   ahead: number;
 *   behind: number;
 *   stashCount: number;
 * }>} GitStatusBranch
 *
 * @typedef {Readonly<{
 *   branch: GitStatusBranch;
 *   entries: readonly GitStatusEntry[];
 *   uncertain: boolean;
 * }>} ParsedGitStatusV2
 *
 * @typedef {Readonly<{
 *   status: string;
 *   code: string;
 *   path: string;
 *   oldPath?: string;
 *   score?: number | null;
 *   deleted: boolean;
 * }>} GitNameStatusChange
 */

/**
 * Accept one revision atom, never an option or a caller-composed range. Ranges are represented by separate base/head
 * fields so `..`/`...` ambiguity and option injection never cross the Git argv boundary.
 *
 * @param {unknown} value
 * @param {string} [label]
 */
export function normalizeGitRevision(value, label = 'revision') {
    if (typeof value !== 'string') throw gitReadModelError('ERR_GIT_REVISION', `${label} must be a string.`);
    const revision = value.trim();
    if (
        revision.length < 1 ||
        revision.length > MAX_GIT_REVISION_CHARS ||
        revision.startsWith('-') ||
        revision.includes('\u0000') ||
        revision.includes('..') ||
        !SAFE_GIT_REVISION_RE.test(revision)
    ) {
        throw gitReadModelError(
            'ERR_GIT_REVISION',
            `${label} must be one bounded Git revision atom; options, whitespace and caller-composed ranges are rejected.`,
        );
    }
    return revision;
}

/** @param {unknown} value @param {string} label */
export function normalizeGitPickaxe(value, label) {
    if (typeof value !== 'string') throw gitReadModelError('ERR_GIT_PICKAXE', `${label} must be a string.`);
    if (value.length < 1 || value.length > MAX_GIT_PICKAXE_CHARS || value.includes('\u0000')) {
        throw gitReadModelError('ERR_GIT_PICKAXE', `${label} must contain 1-${MAX_GIT_PICKAXE_CHARS} characters.`);
    }
    return value;
}

/**
 * Parse `git status --porcelain=v2 -z --branch --show-stash`.
 *
 * @param {string} output
 * @returns {ParsedGitStatusV2}
 */
export function parseGitStatusPorcelainV2Z(output) {
    const records = output.split('\0');
    /** @type {GitStatusEntry[]} */
    const entries = [];
    let oid = null;
    let head = null;
    let upstream = null;
    let ahead = 0;
    let behind = 0;
    let stashCount = 0;
    let uncertain = false;

    for (let index = 0; index < records.length; index += 1) {
        const record = records[index] ?? '';
        if (!record) continue;
        if (record.startsWith('# ')) {
            if (record.startsWith('# branch.oid ')) oid = nullIfInitial(record.slice('# branch.oid '.length));
            else if (record.startsWith('# branch.head ')) head = nullIfDetached(record.slice('# branch.head '.length));
            else if (record.startsWith('# branch.upstream ')) upstream = cleanNullable(record.slice('# branch.upstream '.length));
            else if (record.startsWith('# branch.ab ')) {
                const match = /^# branch\.ab \+(\d+) -(\d+)$/u.exec(record);
                if (!match) uncertain = true;
                else {
                    ahead = Number(match[1]);
                    behind = Number(match[2]);
                }
            } else if (record.startsWith('# stash ')) {
                const parsed = Number(record.slice('# stash '.length));
                if (Number.isSafeInteger(parsed) && parsed >= 0) stashCount = parsed;
                else uncertain = true;
            }
            continue;
        }

        if (record.startsWith('? ')) {
            entries.push(statusEntry('untracked', record.slice(2), '?', '?', null));
            continue;
        }
        if (record.startsWith('! ')) {
            entries.push(statusEntry('ignored', record.slice(2), '!', '!', null));
            continue;
        }

        const ordinary = /^1 ([^ ]{2}) ([^ ]+) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.+)$/u.exec(record);
        if (ordinary) {
            entries.push(statusEntry('ordinary', ordinary[3] ?? '', ordinary[1]?.[0] ?? ' ', ordinary[1]?.[1] ?? ' ', ordinary[2] ?? null));
            continue;
        }

        const renamed = /^2 ([^ ]{2}) ([^ ]+) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ ([RC])(\d+) (.+)$/u.exec(record);
        if (renamed) {
            const originalPath = records[index + 1] ?? '';
            if (!originalPath) uncertain = true;
            else index += 1;
            entries.push(
                Object.freeze({
                    ...statusEntry(
                        'renamed',
                        renamed[5] ?? '',
                        renamed[1]?.[0] ?? ' ',
                        renamed[1]?.[1] ?? ' ',
                        renamed[2] ?? null,
                    ),
                    ...(originalPath ? { originalPath } : {}),
                    score: Number(renamed[4] ?? '') || null,
                }),
            );
            continue;
        }

        const unmerged = /^u ([^ ]{2}) ([^ ]+) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.+)$/u.exec(record);
        if (unmerged) {
            entries.push(statusEntry('unmerged', unmerged[3] ?? '', unmerged[1]?.[0] ?? 'U', unmerged[1]?.[1] ?? 'U', unmerged[2] ?? null));
            continue;
        }
        uncertain = true;
    }

    return Object.freeze({
        branch: Object.freeze({ oid, head, upstream, ahead, behind, stashCount }),
        entries: Object.freeze(entries),
        uncertain,
    });
}

/**
 * Parse `git diff --name-status -z`. Rename/copy records have three NUL fields; ordinary records have two.
 *
 * @param {string} output
 */
export function parseGitNameStatusZ(output) {
    const parts = output.split('\0');
    /** @type {GitNameStatusChange[]} */
    const changes = [];
    let uncertain = false;
    for (let index = 0; index < parts.length; ) {
        const status = parts[index++] ?? '';
        if (!status) continue;
        const code = status[0] ?? '';
        if (!/^[ACDMRTUXB]$/u.test(code)) uncertain = true;
        if (code === 'R' || code === 'C') {
            const oldPath = parts[index++] ?? '';
            const filePath = parts[index++] ?? '';
            if (!oldPath || !filePath) {
                uncertain = true;
                continue;
            }
            const scoreText = status.slice(1);
            const score = /^\d+$/u.test(scoreText) ? Number(scoreText) : null;
            changes.push(Object.freeze({ status, code, path: filePath, oldPath, score, deleted: false }));
            continue;
        }
        const filePath = parts[index++] ?? '';
        if (!filePath) {
            uncertain = true;
            continue;
        }
        changes.push(Object.freeze({ status, code, path: filePath, deleted: code === 'D' }));
    }
    return Object.freeze({ changes: Object.freeze(changes), uncertain });
}

/**
 * Parse commits encoded as NUL records with unit-separator fields.
 * @param {string} output
 */
export function parseGitLogRecords(output) {
    const commits = [];
    let uncertain = false;
    for (const rawRecord of output.split('\0')) {
        const record = rawRecord.replace(/^[\r\n]+/u, '');
        if (!record.trim()) continue;
        const fields = record.split('\u001f');
        if (fields.length !== 7) {
            uncertain = true;
            continue;
        }
        const [hash, shortHash, authorName, authorEmail, authoredAt, parentsText, subject] = fields;
        if (!hash || !shortHash || !authoredAt) {
            uncertain = true;
            continue;
        }
        commits.push(
            Object.freeze({
                hash,
                shortHash,
                authorName: authorName ?? '',
                authorEmail: authorEmail ?? '',
                authoredAt,
                parents: Object.freeze((parentsText ?? '').split(' ').filter(Boolean)),
                subject: subject ?? '',
            }),
        );
    }
    return Object.freeze({ commits: Object.freeze(commits), uncertain });
}

/**
 * Parse `git worktree list --porcelain -z` into one record per worktree.
 * @param {string} output
 */
export function parseGitWorktreePorcelainZ(output) {
    /** @type {Array<Readonly<{path:string;head:string|null;branch:string|null;detached:boolean;bare:boolean;locked:boolean|string;prunable:boolean|string}>>} */
    const rows = [];
    let current = /** @type {Record<string, unknown> | null} */ (null);
    let uncertain = false;
    const flush = () => {
        if (!current) return;
        if (typeof current['path'] !== 'string' || typeof current['head'] !== 'string') uncertain = true;
        rows.push(Object.freeze({
            path: typeof current['path'] === 'string' ? current['path'] : '',
            head: typeof current['head'] === 'string' ? current['head'] : null,
            branch: typeof current['branch'] === 'string' ? current['branch'] : null,
            detached: current['detached'] === true,
            bare: current['bare'] === true,
            locked: typeof current['locked'] === 'string' ? current['locked'] : current['locked'] === true ? true : false,
            prunable: typeof current['prunable'] === 'string' ? current['prunable'] : current['prunable'] === true ? true : false,
        }));
        current = null;
    };
    for (const record of output.split('\0')) {
        if (!record) {
            flush();
            continue;
        }
        if (record.startsWith('worktree ')) {
            flush();
            current = { path: record.slice('worktree '.length) };
            continue;
        }
        if (!current) {
            uncertain = true;
            continue;
        }
        if (record.startsWith('HEAD ')) current['head'] = record.slice('HEAD '.length);
        else if (record.startsWith('branch ')) current['branch'] = record.slice('branch '.length);
        else if (record === 'detached') current['detached'] = true;
        else if (record === 'bare') current['bare'] = true;
        else if (record === 'locked') current['locked'] = true;
        else if (record.startsWith('locked ')) current['locked'] = record.slice('locked '.length);
        else if (record === 'prunable') current['prunable'] = true;
        else if (record.startsWith('prunable ')) current['prunable'] = record.slice('prunable '.length);
        else uncertain = true;
    }
    flush();
    return Object.freeze({ worktrees: Object.freeze(rows), uncertain });
}

/**
 * Parse `git ls-tree -z -l` records without treating path text as line-oriented data.
 * @param {string} output
 */
export function parseGitLsTreeZ(output) {
    const entries = [];
    let uncertain = false;
    for (const record of output.split('\0')) {
        if (!record) continue;
        const match = /^([0-7]{6}) ([a-z]+) ([0-9a-f]{7,64})\s+(-|\d+)\t([\s\S]+)$/iu.exec(record);
        if (!match) {
            uncertain = true;
            continue;
        }
        entries.push(
            Object.freeze({
                mode: match[1] ?? '',
                type: match[2] ?? '',
                object: match[3] ?? '',
                size: match[4] === '-' ? null : Number(match[4]),
                path: match[5] ?? '',
            }),
        );
    }
    return Object.freeze({ entries: Object.freeze(entries), uncertain });
}

/**
 * Parse `git blame --line-porcelain`; metadata is repeated for each final line.
 * @param {string} output
 */
export function parseGitBlameLinePorcelain(output) {
    const lines = output.split(/\r?\n/u);
    const rows = [];
    let uncertain = false;
    for (let index = 0; index < lines.length; ) {
        const header = lines[index++] ?? '';
        if (!header) continue;
        const match = /^([0-9a-f]{7,64}) (\d+) (\d+)(?: (\d+))?$/iu.exec(header);
        if (!match) {
            uncertain = true;
            continue;
        }
        /** @type {Record<string,string>} */
        const metadata = {};
        let content = null;
        while (index < lines.length) {
            const line = lines[index++] ?? '';
            if (line.startsWith('\t')) {
                content = line.slice(1);
                break;
            }
            const separator = line.indexOf(' ');
            if (separator < 0) metadata[line] = '';
            else metadata[line.slice(0, separator)] = line.slice(separator + 1);
        }
        if (content === null) uncertain = true;
        rows.push(Object.freeze({
            commit: match[1] ?? '',
            originalLine: Number(match[2]),
            finalLine: Number(match[3]),
            groupLines: match[4] === undefined ? null : Number(match[4]),
            author: metadata['author'] ?? '',
            authorMail: metadata['author-mail'] ?? '',
            authorTime: metadata['author-time'] ? Number(metadata['author-time']) : null,
            authorTz: metadata['author-tz'] ?? '',
            committerTime: metadata['committer-time'] ? Number(metadata['committer-time']) : null,
            summary: metadata['summary'] ?? '',
            filename: metadata['filename'] ?? '',
            previous: metadata['previous'] ?? null,
            content: content ?? '',
        }));
    }
    return Object.freeze({ lines: Object.freeze(rows), uncertain });
}

/** @param {GitStatusEntryKind} kind @param {string} path @param {string} indexStatus @param {string} worktreeStatus @param {string|null} submodule */
function statusEntry(kind, path, indexStatus, worktreeStatus, submodule) {
    return Object.freeze({ kind, path, indexStatus, worktreeStatus, submodule });
}

/** @param {string} value */
function nullIfInitial(value) {
    return value === '(initial)' ? null : cleanNullable(value);
}
/** @param {string} value */
function nullIfDetached(value) {
    return value === '(detached)' ? null : cleanNullable(value);
}
/** @param {string} value */
function cleanNullable(value) {
    const clean = value.trim();
    return clean || null;
}

/** @param {string} code @param {string} message */
function gitReadModelError(code, message) {
    const error = /** @type {TypeError & {code?:string}} */ (new TypeError(message));
    error.code = code;
    return error;
}
