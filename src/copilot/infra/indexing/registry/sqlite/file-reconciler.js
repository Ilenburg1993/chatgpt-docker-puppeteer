// @ts-check
/** Per-file freshness/hash/snapshot reconciliation for directory index builds. */
import { readTextFileSnapshot } from '#copilot/infra/internal/filesystem/read';
import { fingerprintMatches, sha256 } from '#copilot/infra/internal/platform';
import { publishIoLifecycleEvent } from '#copilot/infra/internal/telemetry';
import { extname } from 'node:path';
import { SYMBOL_EXTENSIONS } from './content.js';
import { normalizeIndexPath } from './paths.js';

/**
 * @typedef {object} DirectoryBuildCounters
 * @property {number} indexed
 * @property {number} failed
 * @property {number} unchanged
 * @property {number} hashVerifiedUnchanged
 * @property {number} hashVerifications
 * @property {number} hashVerificationHits
 * @property {number} hashVerificationMisses
 * @property {number} unchangedFingerprintFastPath
 * @property {number} unchangedSnapshotRechecks
 * @property {number} parserPolicyRefreshes
 * @property {number} snapshotConflicts
 */

/**
 * @param {{
 *   stats: import('./types.js').IoIndexRuntimeStats;
 *   now: () => number;
 *   hashVerifyMaxBytes: number;
 *   hashVerifyIntervalMs: number;
 *   recheckUnchangedSnapshot: boolean;
 *   snapshotRetries: number;
 *   stmtGetFingerprint: { get: Function };
 *   stmtRefreshFingerprint: { run: Function };
 *   parserProjectionIsCurrent: (filePath:string, metadataJson:string|null|undefined)=>boolean;
 *   assertCurrentFileSnapshot: (filePath:string, snapshot:{sizeBytes:number;mtimeMs:number;ctimeMs:number;dev:number;ino:number}, context:{action:string;attempt:number})=>Promise<void>;
 *   buildIndexMetadataJson: (filePath:string, metadata:Record<string,unknown>|undefined, fingerprint:Record<string,unknown>)=>string;
 *   indexTextFile: ReturnType<typeof import('./writer.js').createIoIndexWriter>['indexTextFile'];
 * }} context
 */
export function createIoIndexFileReconciler(context) {
    /**
     * @param {import('#copilot/infra/internal/indexing/scanner').IoScanEntry} entry
     * @param {{
     *   rootPath:string; workspaceRoot:string; traceId:string; scanTraceId:string; scannerEngine:string; totalFiles:number;
     *   signal?:AbortSignal; counters:DirectoryBuildCounters;
     * }} build
     */
    return async function reconcileIndexFile(entry, build) {
        const { counters } = build;
        try {
            build.signal?.throwIfAborted();
            const normalizedFilePath = normalizeIndexPath(entry.absolutePath);
            const existing =
                /** @type {{sizeBytes?:number;mtimeMs?:number;ctimeMs?:number|null;dev?:number|null;ino?:number|null;contentHash?:string|null;refreshedAtMs?:number;metadataJson?:string|null;status?:string}|undefined} */ (
                    context.stmtGetFingerprint.get(normalizedFilePath)
                );
            const scannerFingerprint = entry.fingerprint;
            const parserProjectionCurrent = context.parserProjectionIsCurrent(
                normalizedFilePath,
                existing?.metadataJson,
            );
            if (
                existing?.status === 'fresh' &&
                SYMBOL_EXTENSIONS.has(extname(normalizedFilePath).toLowerCase()) &&
                !parserProjectionCurrent
            ) {
                context.stats.parserPolicyRefreshes += 1;
                counters.parserPolicyRefreshes += 1;
            }
            const basicFingerprintMatches =
                existing?.status === 'fresh' &&
                scannerFingerprint !== undefined &&
                fingerprintMatches(
                    { mtimeMs: Number(existing.mtimeMs), sizeBytes: Number(existing.sizeBytes) },
                    { mtimeMs: Number(scannerFingerprint.mtimeMs), sizeBytes: Number(scannerFingerprint.size) },
                );
            const richFingerprintMatched =
                basicFingerprintMatches &&
                Number(existing.ctimeMs) === Number(scannerFingerprint?.ctimeMs) &&
                Number(existing.dev) === Number(scannerFingerprint?.dev) &&
                Number(existing.ino) === Number(scannerFingerprint?.ino);
            const verificationAgeMs = Math.max(0, context.now() - Number(existing?.refreshedAtMs ?? 0));
            const reusableProjection = richFingerprintMatched && parserProjectionCurrent;
            const periodicHashDue =
                reusableProjection &&
                verificationAgeMs >= context.hashVerifyIntervalMs &&
                Number(existing?.sizeBytes) <= context.hashVerifyMaxBytes &&
                typeof existing?.contentHash === 'string';
            if (reusableProjection && !periodicHashDue && scannerFingerprint) {
                if (!context.recheckUnchangedSnapshot) {
                    context.stats.unchangedFingerprintFastPath += 1;
                    counters.unchangedFingerprintFastPath += 1;
                    counters.unchanged += 1;
                    return;
                }
                try {
                    context.stats.unchangedSnapshotRechecks += 1;
                    counters.unchangedSnapshotRechecks += 1;
                    await context.assertCurrentFileSnapshot(
                        normalizedFilePath,
                        {
                            sizeBytes: Number(scannerFingerprint.size),
                            mtimeMs: Number(scannerFingerprint.mtimeMs),
                            ctimeMs: Number(scannerFingerprint.ctimeMs),
                            dev: Number(scannerFingerprint.dev),
                            ino: Number(scannerFingerprint.ino),
                        },
                        { action: 'unchanged', attempt: 1 },
                    );
                    counters.unchanged += 1;
                    return;
                } catch (error) {
                    if (/** @type {{code?:string}} */ (error).code !== 'ESTALEINDEXSNAPSHOT') throw error;
                    context.stats.snapshotConflicts += 1;
                    counters.snapshotConflicts += 1;
                }
            }

            for (let snapshotAttempt = 1; snapshotAttempt <= context.snapshotRetries + 1; snapshotAttempt += 1) {
                try {
                    const text = await readTextFileSnapshot(
                        entry.absolutePath,
                        build.signal ? { signal: build.signal } : {},
                    );
                    build.signal?.throwIfAborted();
                    const hashVerificationEligible =
                        existing?.status === 'fresh' &&
                        parserProjectionCurrent &&
                        text.sizeBytes === Number(existing.sizeBytes) &&
                        text.sizeBytes <= context.hashVerifyMaxBytes &&
                        typeof existing.contentHash === 'string';
                    if (hashVerificationEligible) {
                        context.stats.hashVerifications += 1;
                        counters.hashVerifications += 1;
                        const currentHash = sha256(text.content);
                        if (currentHash === existing.contentHash) {
                            await context.assertCurrentFileSnapshot(normalizedFilePath, text, {
                                action: 'hash-refresh',
                                attempt: snapshotAttempt,
                            });
                            const refreshedAtMs = context.now();
                            context.stmtRefreshFingerprint.run({
                                filePath: normalizedFilePath,
                                sizeBytes: text.sizeBytes,
                                mtimeMs: text.mtimeMs,
                                ctimeMs: text.ctimeMs,
                                dev: text.dev,
                                ino: text.ino,
                                refreshedAtMs,
                                metadataJson: context.buildIndexMetadataJson(
                                    normalizedFilePath,
                                    {
                                        source: 'indexDirectory.hashVerification',
                                        indexTraceId: build.traceId,
                                        scanTraceId: build.scanTraceId,
                                    },
                                    {
                                        mtimeMs: text.mtimeMs,
                                        ctimeMs: text.ctimeMs,
                                        sizeBytes: text.sizeBytes,
                                        dev: text.dev,
                                        ino: text.ino,
                                        contentHash: currentHash,
                                    },
                                ),
                            });
                            context.stats.hashVerificationHits += 1;
                            counters.hashVerificationHits += 1;
                            counters.hashVerifiedUnchanged += 1;
                            counters.unchanged += 1;
                            return;
                        }
                        context.stats.hashVerificationMisses += 1;
                        counters.hashVerificationMisses += 1;
                    }
                    await context.indexTextFile(
                        {
                            filePath: entry.absolutePath,
                            workspaceRoot: build.workspaceRoot,
                            content: text.content,
                            sizeBytes: text.sizeBytes,
                            mtimeMs: text.mtimeMs,
                            ctimeMs: text.ctimeMs,
                            dev: text.dev,
                            ino: text.ino,
                            metadata: {
                                scanTraceId: build.scanTraceId,
                                indexTraceId: build.traceId,
                                scannerEngine: build.scannerEngine,
                                source: 'indexDirectory',
                                realpath: entry.fingerprint?.realpath ?? null,
                            },
                        },
                        {
                            confirmCurrent: true,
                            attempt: snapshotAttempt,
                            ...(build.signal ? { signal: build.signal } : {}),
                        },
                    );
                    counters.indexed += 1;
                    if (counters.indexed % 50 === 0)
                        publishIoLifecycleEvent('index', 'build.progress', {
                            traceId: build.traceId,
                            rootPath: build.rootPath,
                            workspaceRoot: build.workspaceRoot,
                            indexed: counters.indexed,
                            total: build.totalFiles,
                            pct: build.totalFiles > 0 ? Math.round((counters.indexed / build.totalFiles) * 100) : 100,
                            currentFile: entry.absolutePath,
                        });
                    return;
                } catch (error) {
                    if (/** @type {{code?:string}} */ (error).code !== 'ESTALEINDEXSNAPSHOT') throw error;
                    context.stats.snapshotConflicts += 1;
                    counters.snapshotConflicts += 1;
                    if (snapshotAttempt > context.snapshotRetries) throw error;
                }
            }
        } catch {
            build.signal?.throwIfAborted();
            counters.failed += 1;
        }
    };
}
