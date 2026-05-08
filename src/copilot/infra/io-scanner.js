// @ts-check
/**
 * Scanner canônico de diretórios para I/O local.
 *
 * Mantém listagem e scan em uma única superfície observável, sem indexação persistente. O índice L2/FTS deve consumir
 * esta engine depois, em vez de reimplementar traversal próprio.
 *
 * @module copilot/infra/io-scanner
 */

import ignore from 'ignore';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import pLimit from 'p-limit';
import { buildIoMeta, createIoTraceId } from '../core/io-contracts.js';
import { DEFAULT_BLOCKED_PATH_SEGMENTS } from '../core/io-policy.js';
import { nowIoMs, publishIoLifecycleEvent, publishIoOperation } from './io-observability.js';

/**
 * @typedef {object} IoScanEntry
 * @property {string} name
 * @property {'file' | 'directory' | 'symlink' | 'other'} type
 * @property {string} path
 * @property {string} absolutePath
 * @property {number} [size]
 * @property {{ realpath: string; mtimeMs: number; size: number }} [fingerprint]
 * @property {IoScanEntry[]} [children]
 */

/**
 * @param {string} name
 * @param {string | undefined} filter
 * @returns {boolean}
 */
function matchesFilter(name, filter) {
    if (!filter) return true;
    if (filter.startsWith('*.')) return name.endsWith(filter.slice(1));
    return name === filter;
}

/**
 * @param {string} pattern
 * @returns {RegExp}
 */
function simpleGlobToRegExp(pattern) {
    const normalized = pattern.replace(/\\/g, '/');
    let out = '^';
    for (let i = 0; i < normalized.length; i++) {
        const ch = normalized[i];
        if (ch === '*') {
            const next = normalized[i + 1];
            if (next === '*') {
                out += '.*';
                i += 1;
            } else {
                out += '[^/]*';
            }
        } else if (ch === '?') {
            out += '[^/]';
        } else {
            out += ch?.replace(/[|\\{}()[\]^$+?.]/g, '\\$&') ?? '';
        }
    }
    out += '$';
    return new RegExp(out, 'u');
}

/**
 * @param {string} absolutePath
 * @param {string} workspaceRoot
 * @param {readonly string[]} patterns
 * @returns {boolean}
 */
function matchesAnyPattern(absolutePath, workspaceRoot, patterns) {
    if (!patterns.length) return false;
    const normalizedAbsolute = absolutePath.replace(/\\/g, '/');
    const normalizedRelative = relative(workspaceRoot, absolutePath).replace(/\\/g, '/');
    const name = basename(absolutePath);
    return patterns.some((pattern) => {
        const re = simpleGlobToRegExp(pattern);
        return re.test(normalizedRelative) || re.test(normalizedAbsolute) || re.test(name);
    });
}

/**
 * @param {import('node:fs').Stats} stats
 * @returns {'file' | 'directory' | 'symlink' | 'other'}
 */
function classifyStats(stats) {
    if (stats.isFile()) return 'file';
    if (stats.isDirectory()) return 'directory';
    if (stats.isSymbolicLink()) return 'symlink';
    return 'other';
}

/**
 * @param {string} workspaceRoot
 */
async function loadGitignoreMatcher(workspaceRoot) {
    const matcher = ignore();
    try {
        const content = await readFile(join(workspaceRoot, '.gitignore'), 'utf8');
        matcher.add(content);
        return matcher;
    } catch {
        return matcher;
    }
}

/**
 * Escaneia diretório com metadata canônica e limite de profundidade.
 *
 * @param {string} rootPath
 * @param {{
 *     workspaceRoot?: string;
 *     recursive?: boolean;
 *     depth?: number;
 *     showHidden?: boolean;
 *     filter?: string;
 *     traceId?: string;
 *     blockedSegments?: readonly string[];
 *     respectDenylist?: boolean;
 *     respectGitignore?: boolean;
 *     include?: readonly string[];
 *     exclude?: readonly string[];
 *     concurrency?: number;
 *     fingerprint?: boolean;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     entries: IoScanEntry[];
 *     scannedEntries: number;
 *     io: import('../core/io-contracts.js').IoMeta;
 * }>}
 */
export async function scanDirectory(rootPath, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const recursive = Boolean(options.recursive);
    const maxDepth = Math.max(1, options.depth ?? 3);
    const showHidden = Boolean(options.showHidden);
    const respectDenylist = options.respectDenylist !== false;
    const respectGitignore = options.respectGitignore === true;
    const workspaceRoot = options.workspaceRoot ?? rootPath;
    const includePatterns = options.include ?? [];
    const excludePatterns = options.exclude ?? [];
    const includeFingerprint = options.fingerprint !== false;
    const concurrency =
        Number.isFinite(options.concurrency) && Number(options.concurrency) > 0
            ? Math.floor(Number(options.concurrency))
            : 16;
    const limit = pLimit(concurrency);
    const gitignore = respectGitignore ? await loadGitignoreMatcher(workspaceRoot) : ignore();
    const blockedSegments = new Set(
        (options.blockedSegments ?? DEFAULT_BLOCKED_PATH_SEGMENTS).map((segment) => segment.toLowerCase()),
    );
    let scannedEntries = 0;
    publishIoLifecycleEvent('scan', 'start', {
        traceId,
        rootPath,
        recursive,
        depth: maxDepth,
        includePatternCount: includePatterns.length,
        excludePatternCount: excludePatterns.length,
    });

    /**
     * @param {string} dir
     * @param {number} currentDepth
     * @returns {Promise<IoScanEntry[]>}
     */
    async function scan(dir, currentDepth) {
        const names = await readdir(dir);
        names.sort((a, b) => a.localeCompare(b));
        const entries = await Promise.all(
            names.map(async (name) => {
                if (!showHidden && name.startsWith('.')) return null;
                if (respectDenylist && blockedSegments.has(name.toLowerCase())) return null;
                const absolutePath = join(dir, name);
                if (matchesAnyPattern(absolutePath, workspaceRoot, excludePatterns)) return null;
                const relativePath = relative(workspaceRoot, absolutePath).replace(/\\/g, '/');
                if (respectGitignore && relativePath && gitignore.ignores(relativePath)) return null;
                let stats;
                try {
                    stats = await limit(() => lstat(absolutePath));
                } catch {
                    return null;
                }
                const type = classifyStats(stats);
                const isDirectory = type === 'directory';
                const includeByPattern =
                    includePatterns.length === 0 || matchesAnyPattern(absolutePath, workspaceRoot, includePatterns);
                const includeEntry = (matchesFilter(name, options.filter) && includeByPattern) || isDirectory;
                if (!includeEntry) return null;

                const entry = /** @type {IoScanEntry} */ ({
                    name,
                    type,
                    path: options.workspaceRoot ? relative(options.workspaceRoot, absolutePath) : absolutePath,
                    absolutePath,
                });
                if (type === 'file') entry.size = stats.size;
                if (includeFingerprint && type === 'file') {
                    const canonicalPath = await limit(() => realpath(absolutePath)).catch(() => absolutePath);
                    entry.fingerprint = {
                        realpath: canonicalPath,
                        mtimeMs: stats.mtimeMs,
                        size: stats.size,
                    };
                }
                scannedEntries += 1;
                if (scannedEntries % 500 === 0) {
                    publishIoLifecycleEvent('scan', 'progress', {
                        traceId,
                        rootPath,
                        scannedEntries,
                        currentPath: absolutePath,
                    });
                }
                return entry;
            }),
        );
        const visibleEntries = entries.filter((entry) => entry !== null);
        await Promise.all(
            visibleEntries.map(async (entry) => {
                if (entry.type === 'directory' && recursive && currentDepth < maxDepth) {
                    entry.children = await scan(entry.absolutePath, currentDepth + 1);
                }
            }),
        );
        return visibleEntries;
    }

    try {
        const rootStats = await lstat(rootPath);
        if (!rootStats.isDirectory()) {
            throw new Error('Não é um diretório.');
        }
        const entries = await scan(rootPath, 1);
        const io = buildIoMeta({
            operation: 'scan',
            target: rootPath,
            targetKind: 'directory',
            engine: 'io-scanner.fs.readdir',
            durationMs: Math.max(0, Math.round(nowIoMs() - startedAt)),
            traceId,
            advisoryLimits: {
                recursive,
                depth: maxDepth,
                showHidden,
                scannedEntries,
                limitMode: 'informative',
                denylist: respectDenylist ? 'enabled' : 'disabled',
                gitignore: respectGitignore ? 'enabled' : 'disabled',
                includePatternCount: includePatterns.length,
                excludePatternCount: excludePatterns.length,
                concurrency,
                fingerprint: includeFingerprint,
            },
        });
        publishIoOperation(io, { success: true });
        publishIoLifecycleEvent('scan', 'complete', {
            traceId,
            rootPath,
            scannedEntries,
            durationMs: io.durationMs ?? 0,
        });
        return { path: rootPath, entries, scannedEntries, io };
    } catch (error) {
        const io = buildIoMeta({
            operation: 'scan',
            target: rootPath,
            targetKind: 'directory',
            engine: 'io-scanner.fs.readdir',
            durationMs: Math.max(0, Math.round(nowIoMs() - startedAt)),
            traceId,
        });
        publishIoOperation(io, { success: false, error });
        publishIoLifecycleEvent('scan', 'error', {
            traceId,
            rootPath,
            durationMs: io.durationMs ?? 0,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}

export { basename as getIoScanBasename };
