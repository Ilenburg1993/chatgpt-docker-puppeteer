// @ts-check
/** Bounded working-set selection and snapshot-prefetch stage for scope opening. */
import { findIoIndexSymbol } from '#copilot/infra/internal/indexing/registry';
import { startSessionScope, warmFromDirectory } from '../prefetch/index.js';
import { normalizeScopePath } from './state.js';

/** @typedef {import('./types.js').ScopeDeclareOptions} ScopeDeclareOptions */
/** @typedef {import('./types.js').ScopeSelectionStats} ScopeSelectionStats */
/** @typedef {import('./types.js')._InternalScope} _InternalScope */

/**
 * @param {_InternalScope} scope
 * @param {ScopeDeclareOptions} opts
 * @param {AbortSignal} signal
 */
export async function selectAndWarmScopePaths(scope, opts, signal) {
    const explicitPaths = opts.paths;
    const directory = opts.directory;
    const extensions = opts.extensions;
    const include = opts.include;
    const exclude = opts.exclude;
    const selectionMode = opts.selectionMode ?? 'coverage';
    const preferredPaths = opts.preferredPaths ?? [];
    const seedSymbols = opts.seedSymbols ?? [];
    const recursive = opts.recursive ?? true;
    const maxFiles = opts.maxFiles ?? 500;
    const concurrency = opts.concurrency ?? 8;
    const silent = opts.silent ?? true;

    let resolvedPaths = [...(explicitPaths ?? [])];
    /** @type {Map<string, import('#copilot/infra/internal/filesystem/read').TextFileSnapshot>} */
    const warmSnapshots = new Map();

    if (directory) {
        const uniqueSeedSymbols = [...new Set(seedSymbols.map((value) => String(value).trim()).filter(Boolean))].slice(
            0,
            32,
        );
        const symbolPreferredPaths = new Set();
        for (const seedSymbol of uniqueSeedSymbols) {
            const rows = findIoIndexSymbol(seedSymbol, {
                pathPrefix: directory,
                exactMatch: true,
                caseSensitive: false,
                maxResults: 4,
            });
            for (const row of rows) {
                if (typeof row.filePath === 'string' && row.filePath) symbolPreferredPaths.add(row.filePath);
            }
        }
        const effectivePreferredPaths = [
            ...new Set([...preferredPaths.map(normalizeScopePath), ...symbolPreferredPaths]),
        ];
        scope.selection.seedSymbolsRequested = uniqueSeedSymbols.length;
        scope.selection.seedSymbolPathsResolved = symbolPreferredPaths.size;
        const scanResult = await warmFromDirectory(
            directory,
            {
                ...(extensions === undefined ? {} : { extensions }),
                maxFiles,
                ...(include === undefined ? {} : { include }),
                ...(exclude === undefined ? {} : { exclude }),
                selectionMode,
                preferredPaths: effectivePreferredPaths,
                recursive,
            },
            {
                concurrency,
                silent,
                textMode: true,
                captureTextSnapshots: true,
                cacheBytes: false,
                signal,
            },
        );
        if (signal.aborted) return { resolvedPaths, warmSnapshots };
        scope.preloaded += scanResult.preloaded;
        scope.failed += scanResult.failed;
        scope.warmDurationMs += scanResult.durationMs;
        scope.candidateFiles = Number(scanResult.advisoryLimits['candidateFiles'] ?? scanResult.paths.length);
        scope.selectedFiles = Number(scanResult.advisoryLimits['selectedFiles'] ?? scanResult.paths.length);
        scope.hardLimitReached = Boolean(scanResult.advisoryLimits['hardLimitReached']);
        const selection =
            /** @type {Omit<ScopeSelectionStats, 'seedSymbolsRequested' | 'seedSymbolPathsResolved'> | undefined} */ (
                scanResult.advisoryLimits['selection']
            );
        if (selection) {
            scope.selection = {
                ...selection,
                seedSymbolsRequested: uniqueSeedSymbols.length,
                seedSymbolPathsResolved: symbolPreferredPaths.size,
            };
        }
        for (const [filePath, snapshot] of scanResult.snapshots ?? []) warmSnapshots.set(filePath, snapshot);
        resolvedPaths = [...new Set([...resolvedPaths, ...scanResult.paths])];
    } else if (explicitPaths && explicitPaths.length > 0) {
        const warm = await startSessionScope(opts.sessionId, explicitPaths, {
            concurrency,
            silent,
            captureTextSnapshots: true,
            cacheBytes: false,
            signal,
        });
        if (signal.aborted) return { resolvedPaths, warmSnapshots };
        scope.preloaded += warm.preloaded;
        scope.failed += warm.failed;
        scope.warmDurationMs += warm.durationMs;
        scope.candidateFiles = explicitPaths.length;
        scope.selectedFiles = explicitPaths.length;
        for (const [filePath, snapshot] of warm.snapshots ?? []) warmSnapshots.set(filePath, snapshot);
    }

    scope.paths = resolvedPaths;
    return { resolvedPaths, warmSnapshots };
}
