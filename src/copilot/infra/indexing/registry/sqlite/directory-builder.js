// @ts-check
/** Directory scan/limit/prune/concurrency orchestration for the persistent index registry. */
import { createIoTraceId } from '#copilot/core/io-contracts';
import { acquireIoResourceLock } from '#copilot/infra/internal/concurrency/locks';
import { scanDirectory } from '#copilot/infra/internal/indexing/scanner';
import { publishIoLifecycleEvent } from '#copilot/infra/internal/telemetry';
import pLimit from 'p-limit';
import { DEFAULT_INDEX_EXTENSIONS } from '../extensions/index.js';
import { createIoIndexFileReconciler } from './file-reconciler.js';
import { flattenScanEntries, normalizeIndexExtensions, normalizeIndexPath, shouldIndexFile } from './path/index.js';

const DEFAULT_INDEX_BUILD_CONFIG = Object.freeze({ concurrency: 8, maxFiles: 10_000 });
const DEFAULT_INDEX_SCANNER_CONFIG = Object.freeze({ batchSize: 512, hardMaxEntries: 20_000 });

/**
 * @param {{
 *   stats: import('./types.js').IoIndexRuntimeStats;
 *   now: () => number;
 *   freshnessPolicy: Readonly<Record<string, unknown>>;
 *   hashVerifyMaxBytes: number;
 *   hashVerifyIntervalMs: number;
 *   recheckUnchangedSnapshot: boolean;
 *   snapshotRetries: number;
 *   stmtGetFingerprint: { get: Function };
 *   stmtRefreshFingerprint: { run: Function };
 *   parserProjectionIsCurrent: (filePath:string, metadataJson:string|null|undefined)=>boolean;
 *   assertCurrentFileSnapshot: (filePath:string, snapshot:{sizeBytes:number;mtimeMs:number;ctimeMs:number;dev:number;ino:number}, context:{action:string;attempt:number})=>Promise<void>;
 *   buildIndexMetadataJson: (filePath:string, metadata:Record<string,unknown>|undefined, fingerprint:Record<string,unknown>)=>string;
 *   pruneMissingRows: ReturnType<typeof import('./writer.js').createIoIndexWriter>['pruneMissingRows'];
 *   indexTextFile: ReturnType<typeof import('./writer.js').createIoIndexWriter>['indexTextFile'];
 *   buildConfig?: {concurrency:number;maxFiles:number};
 *   scannerConfig?: {batchSize:number;hardMaxEntries:number};
 * }} context
 */
export function createIoIndexDirectoryBuilder(context) {
    const { stats, freshnessPolicy, pruneMissingRows } = context;
    const buildConfig = context.buildConfig ?? DEFAULT_INDEX_BUILD_CONFIG;
    const scannerConfig = context.scannerConfig ?? DEFAULT_INDEX_SCANNER_CONFIG;
    const reconcileIndexFile = createIoIndexFileReconciler(context);

    /**
     * @param {string} rootPath
     * @param {{workspaceRoot?:string;recursive?:boolean;depth?:number;respectGitignore?:boolean;include?:readonly string[];exclude?:readonly string[];extensions?:readonly string[];concurrency?:number;maxFiles?:number;pruneMissing?:boolean;signal?:AbortSignal}} [options]
     */
    return async function indexDirectory(rootPath, options = {}) {
        const normalizedRoot = normalizeIndexPath(options.workspaceRoot ?? rootPath);
        const lease = await acquireIoResourceLock(`io-index-build:${normalizedRoot}`, {
            operation: 'index-build',
            target: normalizedRoot,
            riskClass: 'low',
            ...(options.signal ? { signal: options.signal } : {}),
        });
        try {
            return await lease.run(async () => {
                options.signal?.throwIfAborted();
                const startedAt = Date.now();
                const traceId = createIoTraceId();
                const workspaceRoot = normalizeIndexPath(options.workspaceRoot ?? rootPath);
                const extensions = normalizeIndexExtensions(options.extensions ?? DEFAULT_INDEX_EXTENSIONS);
                const concurrency =
                    Number.isFinite(options.concurrency) && Number(options.concurrency) > 0
                        ? Math.floor(Number(options.concurrency))
                        : buildConfig.concurrency;
                const effectiveMaxFiles =
                    Number.isFinite(options.maxFiles) && Number(options.maxFiles) > 0
                        ? Math.floor(Number(options.maxFiles))
                        : buildConfig.maxFiles;
                const limit = pLimit(concurrency);

                publishIoLifecycleEvent('index', 'build.start', {
                    traceId,
                    rootPath,
                    workspaceRoot,
                    recursive: options.recursive ?? true,
                    concurrency,
                    effectiveMaxFiles,
                });
                /** @type {Parameters<typeof scanDirectory>[1]} */
                const scanOptions = {
                    workspaceRoot,
                    recursive: options.recursive ?? true,
                    depth: options.depth ?? 20,
                    respectGitignore: options.respectGitignore ?? true,
                    concurrency,
                    batchSize: scannerConfig.batchSize,
                    hardMaxEntries: scannerConfig.hardMaxEntries,
                    fingerprint: true,
                    ...(options.signal ? { signal: options.signal } : {}),
                };
                if (options.include !== undefined) scanOptions.include = options.include;
                if (options.exclude !== undefined) scanOptions.exclude = options.exclude;
                const scan = await scanDirectory(rootPath, scanOptions);
                options.signal?.throwIfAborted();
                const flatEntries = flattenScanEntries(scan.entries);
                const allCandidates = flatEntries.filter((entry) => shouldIndexFile(entry.absolutePath, extensions));
                const files = allCandidates.slice(0, effectiveMaxFiles);
                const hardLimitReached = allCandidates.length > files.length;
                const currentFilePaths = new Set(files.map((entry) => normalizeIndexPath(entry.absolutePath)));
                const hasFilterSlice = (options.include?.length ?? 0) > 0 || (options.exclude?.length ?? 0) > 0;
                const maySafelyPrune =
                    options.pruneMissing === true || (!hasFilterSlice && options.pruneMissing !== false);
                const pruned = maySafelyPrune ? pruneMissingRows(rootPath, currentFilePaths, extensions) : 0;
                const counters = {
                    indexed: 0,
                    failed: 0,
                    unchanged: 0,
                    hashVerifiedUnchanged: 0,
                    hashVerifications: 0,
                    hashVerificationHits: 0,
                    hashVerificationMisses: 0,
                    unchangedFingerprintFastPath: 0,
                    unchangedSnapshotRechecks: 0,
                    parserPolicyRefreshes: 0,
                    snapshotConflicts: 0,
                };

                await Promise.all(
                    files.map((entry) =>
                        limit(() =>
                            reconcileIndexFile(entry, {
                                rootPath,
                                workspaceRoot,
                                traceId,
                                scanTraceId: scan.io.traceId ?? traceId,
                                scannerEngine: scan.io.engine ?? 'io-engine.scanDirectory',
                                totalFiles: files.length,
                                ...(options.signal ? { signal: options.signal } : {}),
                                counters,
                            }),
                        ),
                    ),
                );

                const skipped = Math.max(0, flatEntries.length - files.length);
                stats.builds += 1;
                stats.skipped += skipped + counters.unchanged;
                stats.failed += counters.failed;
                stats.pruned += pruned;
                const summary = {
                    traceId,
                    rootPath,
                    workspaceRoot,
                    scannedEntries: scan.scannedEntries,
                    candidateFiles: files.length,
                    totalCandidates: allCandidates.length,
                    indexed: counters.indexed,
                    unchanged: counters.unchanged,
                    hashVerifiedUnchanged: counters.hashVerifiedUnchanged,
                    hashVerifications: counters.hashVerifications,
                    hashVerificationHits: counters.hashVerificationHits,
                    hashVerificationMisses: counters.hashVerificationMisses,
                    unchangedFingerprintFastPath: counters.unchangedFingerprintFastPath,
                    unchangedSnapshotRechecks: counters.unchangedSnapshotRechecks,
                    parserPolicyRefreshes: counters.parserPolicyRefreshes,
                    snapshotConflicts: counters.snapshotConflicts,
                    skipped,
                    failed: counters.failed,
                    pruned,
                    hardLimitReached,
                    effectiveMaxFiles,
                    durationMs: Math.max(0, Date.now() - startedAt),
                };
                publishIoLifecycleEvent('index', 'build.complete', summary);
                return {
                    available: true,
                    traceId,
                    workspaceRoot,
                    scannedEntries: scan.scannedEntries,
                    candidateFiles: files.length,
                    totalCandidates: allCandidates.length,
                    effectiveMaxFiles,
                    hardLimitReached,
                    indexed: counters.indexed,
                    skipped: skipped + counters.unchanged,
                    unchanged: counters.unchanged,
                    hashVerifiedUnchanged: counters.hashVerifiedUnchanged,
                    hashVerifications: counters.hashVerifications,
                    hashVerificationHits: counters.hashVerificationHits,
                    hashVerificationMisses: counters.hashVerificationMisses,
                    unchangedFingerprintFastPath: counters.unchangedFingerprintFastPath,
                    unchangedSnapshotRechecks: counters.unchangedSnapshotRechecks,
                    parserPolicyRefreshes: counters.parserPolicyRefreshes,
                    snapshotConflicts: counters.snapshotConflicts,
                    failed: counters.failed,
                    pruned,
                    pruneMissing: maySafelyPrune,
                    durationMs: summary.durationMs,
                    limitMode: 'enforced-max-files',
                    freshnessPolicy,
                };
            });
        } finally {
            await lease.releaseAsync();
        }
    };
}
