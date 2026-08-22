// @ts-check
/** Directory scan, deterministic bounded working-set selection and warming. */

import { IO_GLOB_ENGINE, matchesAnyPattern, scanDirectory } from '#copilot/infra/internal/indexing/scanner';
import * as nodePath from 'node:path';
import { warmCacheForPaths } from './cache-warm.js';

/** @typedef {import('./types.js').PrefetchOptions} PrefetchOptions */

/**
 * Select a deterministic bounded working set without additional filesystem I/O. Coverage mode favors top-level
 * structural breadth, while lexical preserves the historical prefix behavior. Preferred paths are honored first only
 * when they are already eligible candidates and always count inside maxFiles.
 *
 * @param {string[]} allCandidateFiles
 * @param {string} baseDir
 * @param {number} requestedMaxFiles
 * @param {{ selectionMode?: 'coverage' | 'lexical'; preferredPaths?: string[] }} [options]
 */
function selectDirectoryWorkingSetPaths(allCandidateFiles, baseDir, requestedMaxFiles, options = {}) {
    /** @param {string} filePath */
    const sourceUtilityRank = (filePath) => {
        const extension = nodePath.extname(filePath).toLowerCase();
        if (['.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx', '.mts', '.cts'].includes(extension)) return 0;
        if (extension === '.json') return 1;
        if (extension === '.md') return 2;
        return 3;
    };
    const effectiveMaxFiles =
        Number.isFinite(requestedMaxFiles) && requestedMaxFiles > 0 ? Math.floor(requestedMaxFiles) : 500;
    const selectionMode = options.selectionMode === 'lexical' ? 'lexical' : 'coverage';
    const candidateSet = new Set(allCandidateFiles.map((filePath) => nodePath.resolve(filePath)));
    const uniquePreferred = [...new Set((options.preferredPaths ?? []).map((filePath) => nodePath.resolve(filePath)))];
    /** @type {string[]} */
    const selected = [];
    /** @type {Set<string>} */
    const selectedSet = new Set();

    /** @param {string} filePath */
    const addSelected = (filePath) => {
        const normalized = nodePath.resolve(filePath);
        if (selected.length >= effectiveMaxFiles || selectedSet.has(normalized) || !candidateSet.has(normalized))
            return false;
        selected.push(normalized);
        selectedSet.add(normalized);
        return true;
    };

    let preferredSelected = 0;
    for (const filePath of uniquePreferred) {
        if (addSelected(filePath)) preferredSelected += 1;
        if (selected.length >= effectiveMaxFiles) break;
    }

    /** @param {string} filePath */
    const bucketForPath = (filePath) => {
        const relative = nodePath.relative(baseDir, filePath);
        const parts = relative.split(nodePath.sep).filter(Boolean);
        return parts.length <= 1 ? '.' : (parts[0] ?? '.');
    };
    const allBuckets = new Set(allCandidateFiles.map(bucketForPath));

    if (selectionMode === 'lexical') {
        for (const filePath of allCandidateFiles) {
            if (selected.length >= effectiveMaxFiles) break;
            addSelected(filePath);
        }
    } else {
        /** @type {Map<string, { filePath: string; relative: string; depth: number; utilityRank: number }[]>} */
        const buckets = new Map();
        for (const filePath of allCandidateFiles) {
            const normalized = nodePath.resolve(filePath);
            if (selectedSet.has(normalized)) continue;
            const relative = nodePath.relative(baseDir, normalized);
            const parts = relative.split(nodePath.sep).filter(Boolean);
            const bucket = parts.length <= 1 ? '.' : (parts[0] ?? '.');
            const rows = buckets.get(bucket) ?? [];
            rows.push({
                filePath: normalized,
                relative,
                depth: Math.max(0, parts.length - 1),
                utilityRank: sourceUtilityRank(normalized),
            });
            buckets.set(bucket, rows);
        }
        for (const rows of buckets.values()) {
            rows.sort((left, right) => {
                const utilityDelta = left.utilityRank - right.utilityRank;
                if (utilityDelta !== 0) return utilityDelta;
                const depthDelta = left.depth - right.depth;
                if (depthDelta !== 0) return depthDelta;
                return left.relative < right.relative ? -1 : left.relative > right.relative ? 1 : 0;
            });
        }
        const bucketKeys = [...buckets.keys()].sort((left, right) => {
            if (left === right) return 0;
            if (left === '.') return -1;
            if (right === '.') return 1;
            return left < right ? -1 : 1;
        });
        const cursors = new Map(bucketKeys.map((key) => [key, 0]));
        let progressed = true;
        while (selected.length < effectiveMaxFiles && progressed) {
            progressed = false;
            for (const key of bucketKeys) {
                const rows = buckets.get(key) ?? [];
                const cursor = cursors.get(key) ?? 0;
                const row = rows[cursor];
                if (!row) continue;
                cursors.set(key, cursor + 1);
                addSelected(row.filePath);
                progressed = true;
                if (selected.length >= effectiveMaxFiles) break;
            }
        }
    }

    const selectedBuckets = new Set(selected.map(bucketForPath));
    return {
        paths: selected,
        effectiveMaxFiles,
        selection: {
            mode: selectionMode,
            candidateBuckets: allBuckets.size,
            selectedBuckets: selectedBuckets.size,
            preferredRequested: uniquePreferred.length,
            preferredSelected,
        },
    };
}

/**
 * @param {string} directory
 * @param {object} [opts]
 * @param {string[]} [opts.extensions=['.js','.ts','.mjs','.json','.md']] Default is
 *   `['.js','.ts','.mjs','.json','.md']`
 * @param {number} [opts.maxFiles=500] Default is `500`
 * @param {string[]} [opts.include]
 * @param {string[]} [opts.exclude]
 * @param {'coverage' | 'lexical'} [opts.selectionMode='coverage'] Selection policy inside the hard maxFiles cap.
 *   Default is `'coverage'`
 * @param {string[]} [opts.preferredPaths] Eligible candidate files to prioritize inside the same hard cap.
 * @param {boolean} [opts.recursive=true] Default is `true`
 * @param {Readonly<{batchSize:number;hardMaxEntries:number}>} [opts.scannerConfig] Runtime-owned scanner policy.
 * @param {PrefetchOptions} [prefetchOpts]
 * @returns {Promise<{
 *     scanned: number;
 *     preloaded: number;
 *     failed: number;
 *     skipped: number;
 *     durationMs: number;
 *     paths: string[];
 *     advisoryLimits: Record<string, unknown>;
 *     snapshots?: Map<string, import('#copilot/infra/internal/filesystem/read').TextFileSnapshot>;
 * }>}
 */
export async function warmFromDirectory(directory, opts = {}, prefetchOpts = {}) {
    const {
        extensions = ['.js', '.ts', '.mjs', '.json', '.md'],
        maxFiles = 500,
        include = [],
        exclude = [],
        selectionMode = 'coverage',
        preferredPaths = [],
        recursive = true,
    } = opts;

    const t0 = Date.now();
    const baseDir = nodePath.resolve(directory);
    prefetchOpts.signal?.throwIfAborted();

    const scanResult = await scanDirectory(directory, {
        recursive,
        showHidden: false,
        depth: recursive ? 20 : 1,
        respectGitignore: true,
        ...(opts.scannerConfig
            ? {
                  batchSize: opts.scannerConfig.batchSize,
                  hardMaxEntries: opts.scannerConfig.hardMaxEntries,
              }
            : {}),
        ...(prefetchOpts.signal ? { signal: prefetchOpts.signal } : {}),
    });
    prefetchOpts.signal?.throwIfAborted();

    /** @param {import('#copilot/infra/internal/indexing/scanner').IoScanEntry[]} entries @returns {import('#copilot/infra/internal/indexing/scanner').IoScanEntry[]} */
    function flattenEntries(entries) {
        /** @type {import('#copilot/infra/internal/indexing/scanner').IoScanEntry[]} */
        const flat = [];
        for (const e of entries) {
            flat.push(e);
            if (e.children) flat.push(...flattenEntries(e.children));
        }
        return flat;
    }

    const allEntries = flattenEntries(scanResult.entries);
    const allCandidateFiles = allEntries
        .filter((e) => e.type === 'file' && extensions.includes(nodePath.extname(e.name).toLowerCase()))
        .filter((e) => include.length === 0 || matchesAnyPattern(e.absolutePath, baseDir, include))
        .filter((e) => exclude.length === 0 || !matchesAnyPattern(e.absolutePath, baseDir, exclude))
        .map((e) => e.absolutePath);

    const selection = selectDirectoryWorkingSetPaths(allCandidateFiles, baseDir, maxFiles, {
        selectionMode,
        preferredPaths,
    });
    const effectiveMaxFiles = selection.effectiveMaxFiles;
    const files = selection.paths;

    const result = await warmCacheForPaths(files, prefetchOpts);
    prefetchOpts.signal?.throwIfAborted();
    return {
        scanned: scanResult.scannedEntries,
        ...result,
        durationMs: Date.now() - t0,
        paths: files,
        advisoryLimits: {
            requestedMaxFiles: maxFiles,
            effectiveMaxFiles,
            hardLimitReached: allCandidateFiles.length > files.length,
            selectedFiles: files.length,
            candidateFiles: allCandidateFiles.length,
            recursive,
            includePatternCount: include.length,
            excludePatternCount: exclude.length,
            globEngine: IO_GLOB_ENGINE,
            selection: selection.selection,
            limitMode: 'enforced-max-files',
        },
    };
}
