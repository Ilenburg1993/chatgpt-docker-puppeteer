// @ts-check
/**
 * Scanner canônico de diretórios para I/O local.
 *
 * Mantém listagem e scan em uma única superfície observável, sem indexação persistente. O índice L2/FTS deve consumir
 * esta engine depois, em vez de reimplementar traversal próprio.
 *
 * @module copilot/infra/io-scanner
 */

import {
    DEFAULT_BLOCKED_PATH_SEGMENTS,
    buildIoMeta,
    createIoTraceId,
    evaluateIoPathPolicyAsync,
    toError,
} from '#copilot/core';
import ignore from 'ignore';
import { lstat, readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import pLimit from 'p-limit';
import { nowIoMs, publishIoLifecycleEvent, publishIoOperation } from './io-observability.js';
import { hasNullByte, normalizeWorkspaceRoot } from './policy/path-resource.js';
import { mapInBatches, normalizeBatchSize } from './scan/batching.js';
import { buildFileFingerprint, classifyStats } from './scan/fingerprint.js';
import { loadGitignoreMatcher } from './scan/gitignore.js';
import { IO_GLOB_ENGINE, matchesAnyPattern, matchesFilter } from './scan/glob.js';
import { readEnvPositiveInt } from './shared/env.js';

const DEFAULT_SCAN_BATCH_SIZE = readEnvPositiveInt('IO_SCAN_BATCH_SIZE', 512);
const DEFAULT_SCAN_HARD_MAX_ENTRIES = readEnvPositiveInt('IO_SCAN_HARD_MAX_ENTRIES', 20_000);

/**
 * @param {unknown} candidate
 * @param {string} label
 * @returns {asserts candidate is string}
 */
function assertValidScannerPath(candidate, label) {
    if (typeof candidate !== 'string' || candidate.length === 0 || hasNullByte(candidate)) {
        const error = /** @type {TypeError & { code?: string }} */ (
            new TypeError(`${label} inválido: ${String(candidate)}`)
        );
        error.code = 'ERR_INVALID_ARG_VALUE';
        throw error;
    }
}

/**
 * @typedef {object} IoScanEntry
 * @property {string} name
 * @property {'file' | 'directory' | 'symlink' | 'other'} type
 * @property {string} path
 * @property {string} absolutePath
 * @property {number} [size]
 * @property {boolean} [blocked]
 * @property {string} [reasonCode]
 * @property {{
 *     realpath: string;
 *     mtimeMs: number;
 *     ctimeMs: number;
 *     size: number;
 *     dev: number;
 *     ino: number;
 * }} [fingerprint]
 * @property {IoScanEntry[]} [children]
 */

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
 *     batchSize?: number;
 *     fingerprint?: boolean;
 *     redactProtectedPaths?: boolean;
 *     maxEntries?: number;
 *     signal?: AbortSignal;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     entries: IoScanEntry[];
 *     scannedEntries: number;
 *     blockedEntries: number;
 *     io: import('#copilot/core/io-contracts').IoMeta;
 * }>}
 */
export async function scanDirectory(rootPath, options = {}) {
    assertValidScannerPath(rootPath, 'rootPath');
    options.signal?.throwIfAborted();
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const recursive = Boolean(options.recursive);
    const maxDepth = Math.max(1, options.depth ?? 3);
    const showHidden = Boolean(options.showHidden);
    const respectDenylist = options.respectDenylist !== false;
    const respectGitignore = options.respectGitignore === true;
    const workspaceRoot = options.workspaceRoot ?? rootPath;
    assertValidScannerPath(workspaceRoot, 'workspaceRoot');
    const includePatterns = (options.include ?? []).filter((pattern) => typeof pattern === 'string' && pattern);
    const excludePatterns = (options.exclude ?? []).filter((pattern) => typeof pattern === 'string' && pattern);
    const includeFingerprint = options.fingerprint !== false;
    const redactProtectedPaths = options.redactProtectedPaths !== false;
    const concurrency =
        Number.isFinite(options.concurrency) && Number(options.concurrency) > 0
            ? Math.floor(Number(options.concurrency))
            : 16;
    const batchSize = normalizeBatchSize(Number(options.batchSize), DEFAULT_SCAN_BATCH_SIZE);
    const requestedMaxEntries = Number(options.maxEntries);
    const hardMaxEntries =
        Number.isInteger(requestedMaxEntries) && requestedMaxEntries > 0
            ? Math.min(requestedMaxEntries, DEFAULT_SCAN_HARD_MAX_ENTRIES)
            : DEFAULT_SCAN_HARD_MAX_ENTRIES;
    const limit = pLimit(concurrency);
    const gitignore = respectGitignore ? await loadGitignoreMatcher(workspaceRoot) : ignore();
    options.signal?.throwIfAborted();
    const blockedSegments = new Set(
        (options.blockedSegments ?? DEFAULT_BLOCKED_PATH_SEGMENTS)
            .filter((segment) => typeof segment === 'string' && segment)
            .map((segment) => segment.toLowerCase()),
    );
    let scannedEntries = 0;
    let blockedEntries = 0;
    let hardLimitReached = false;
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
        options.signal?.throwIfAborted();
        const dirents = await readdir(dir, { withFileTypes: true });
        options.signal?.throwIfAborted();
        dirents.sort((a, b) => a.name.localeCompare(b.name));
        const entries = await mapInBatches(dirents, batchSize, async (dirent) => {
            options.signal?.throwIfAborted();
            const name = dirent.name;
            if (hardLimitReached || scannedEntries >= hardMaxEntries) {
                hardLimitReached = true;
                return null;
            }
            if (!showHidden && name.startsWith('.')) return null;
            if (respectDenylist && blockedSegments.has(name.toLowerCase())) return null;
            const absolutePath = join(dir, name);
            if (matchesAnyPattern(absolutePath, workspaceRoot, excludePatterns)) return null;
            const relativePath = relative(workspaceRoot, absolutePath).replace(/\\/g, '/');
            if (respectGitignore && relativePath && gitignore.ignores(relativePath)) return null;
            if (redactProtectedPaths) {
                const policy = await evaluateIoPathPolicyAsync(absolutePath, {
                    workspaceRoot: normalizeWorkspaceRoot(workspaceRoot),
                    mode: 'read',
                    blockedSegments: [...blockedSegments],
                });
                options.signal?.throwIfAborted();
                if (!policy.ok) {
                    blockedEntries += 1;
                    return null;
                }
            }
            let type = dirent.isFile()
                ? /** @type {const} */ ('file')
                : dirent.isDirectory()
                  ? /** @type {const} */ ('directory')
                  : dirent.isSymbolicLink()
                    ? /** @type {const} */ ('symlink')
                    : /** @type {const} */ ('other');
            /** @type {import('node:fs').Stats | null} */
            let stats = null;
            if (type === 'file' || type === 'other') {
                try {
                    stats = await limit(() => lstat(absolutePath));
                    options.signal?.throwIfAborted();
                    type = classifyStats(stats);
                } catch {
                    return null;
                }
            }
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
            if (type === 'file' && stats) entry.size = stats.size;
            if (includeFingerprint && type === 'file' && stats) {
                entry.fingerprint = await buildFileFingerprint(absolutePath, stats, limit);
                options.signal?.throwIfAborted();
            }
            scannedEntries += 1;
            if (scannedEntries >= hardMaxEntries) {
                hardLimitReached = true;
            }
            if (scannedEntries % 500 === 0) {
                publishIoLifecycleEvent('scan', 'progress', {
                    traceId,
                    rootPath,
                    scannedEntries,
                    currentPath: absolutePath,
                });
            }
            return entry;
        });
        const visibleEntries = entries.filter((entry) => entry !== null);
        if (recursive && currentDepth < maxDepth) {
            options.signal?.throwIfAborted();
            const directoryEntries = visibleEntries.filter((entry) => entry.type === 'directory');
            await Promise.all(
                directoryEntries.map(async (entry) => {
                    entry.children = await scan(entry.absolutePath, currentDepth + 1);
                }),
            );
        }
        return visibleEntries;
    }

    try {
        const rootStats = await lstat(rootPath);
        options.signal?.throwIfAborted();
        if (!rootStats.isDirectory()) {
            throw new Error('Não é um diretório.');
        }
        const entries = await scan(rootPath, 1);
        options.signal?.throwIfAborted();
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
                hardLimitReached,
                hardMaxEntries,
                denylist: respectDenylist ? 'enabled' : 'disabled',
                redactedProtectedPaths: redactProtectedPaths,
                blockedEntries,
                gitignore: respectGitignore ? 'enabled' : 'disabled',
                includePatternCount: includePatterns.length,
                excludePatternCount: excludePatterns.length,
                globEngine: IO_GLOB_ENGINE,
                concurrency,
                batchSize,
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
        return { path: rootPath, entries, scannedEntries, blockedEntries, io };
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
            error: toError(error).message,
        });
        throw error;
    }
}

export { basename as getIoScanBasename };
