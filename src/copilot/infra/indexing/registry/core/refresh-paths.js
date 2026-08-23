// @ts-check
/** Explicit-path refresh executor. Scheduler state is injected by the caller.
 * @module copilot/infra/indexing/registry/core/refresh-paths */

import { BABEL_PARSER_POLICY_VERSION } from '#copilot/infra/internal/code-analysis';
import { readTextFileSnapshot, statPathSnapshot } from '#copilot/infra/internal/filesystem/read';
import { loadGitignoreMatcher } from '#copilot/infra/internal/indexing/scanner';
import { richFingerprintMatches } from '#copilot/infra/internal/platform/fingerprint';
import { extname, relative, resolve } from 'node:path';
import pLimit from 'p-limit';
import { DEFAULT_INDEX_EXTENSIONS } from '../extensions/index.js';
import { isIndexRefreshDomainCandidate } from './domain.js';

/** @typedef {import('./domain.js').IndexAutoRefreshDomain} IndexAutoRefreshDomain */

/**
 * @param {ReturnType<typeof import('../sqlite/index.js').createIoIndexSqlite> | null} index
 * @param {readonly string[]} filePaths
 * @param {{
 *     workspaceRoot: string;
 *     scopeRoot?: string;
 *     extensions?: readonly string[];
 *     respectGitignore?: boolean;
 *     include?: readonly string[];
 *     exclude?: readonly string[];
 *     snapshots?: ReadonlyMap<string, import('#copilot/infra/internal/filesystem/read').TextFileSnapshot>;
 *     parsedSymbols?: ReadonlyMap<string, import('#copilot/infra/internal/indexing/parser').FileSymbols>;
 *     concurrency?: number;
 *     signal?: AbortSignal;
 * }} options
 * @param {{ domain?: IndexAutoRefreshDomain | null; settlePending?: (filePath: string) => boolean }} [context]
 */
export async function executeIoIndexPathRefresh(index, filePaths, options, context = {}) {
    if (!index) {
        return {
            available: false,
            requested: filePaths.length,
            indexed: 0,
            invalidated: 0,
            unchanged: 0,
            snapshotReuses: 0,
            parsedSymbolReuses: 0,
            parsedSymbolPolicyRejects: 0,
            skipped: 0,
            failed: 0,
            concurrency: 0,
            durationMs: 0,
        };
    }
    const workspaceRoot = resolve(options.workspaceRoot);
    const domain = context.domain ?? null;
    const settlePending = context.settlePending ?? (() => false);
    const extensions = new Set(
        (options.extensions ?? DEFAULT_INDEX_EXTENSIONS).map((value) => String(value).toLowerCase()),
    );
    const gitignore = domain?.respectGitignore ? await loadGitignoreMatcher(domain.workspaceRoot) : null;
    let indexed = 0;
    let invalidated = 0;
    let unchanged = 0;
    let snapshotReuses = 0;
    let parsedSymbolReuses = 0;
    let parsedSymbolPolicyRejects = 0;
    let skipped = 0;
    let failed = 0;
    const startedAt = Date.now();
    const concurrency = Math.min(
        32,
        Number.isFinite(options.concurrency) && Number(options.concurrency) > 0
            ? Math.max(1, Math.floor(Number(options.concurrency)))
            : 8,
    );
    const limit = pLimit(concurrency);
    const uniquePaths = [...new Set(filePaths.map((value) => resolve(value)))];
    await Promise.all(
        uniquePaths.map((rawPath) =>
            limit(async () => {
                options.signal?.throwIfAborted();
                if (domain && !isIndexRefreshDomainCandidate(rawPath, domain)) {
                    if (index.invalidatePath(rawPath)) invalidated += 1;
                    skipped += 1;
                    settlePending(rawPath);
                    return;
                }
                if (gitignore) {
                    const relativePath = relative(domain?.workspaceRoot ?? workspaceRoot, rawPath).replace(/\\/gu, '/');
                    if (relativePath && gitignore.ignores(relativePath)) {
                        if (index.invalidatePath(rawPath)) invalidated += 1;
                        skipped += 1;
                        settlePending(rawPath);
                        return;
                    }
                }
                if (!extensions.has(extname(rawPath).toLowerCase())) {
                    if (index.invalidatePath(rawPath)) invalidated += 1;
                    skipped += 1;
                    settlePending(rawPath);
                    return;
                }
                try {
                    const stat = await statPathSnapshot(rawPath);
                    if (!stat.isFile()) {
                        if (index.invalidatePath(rawPath)) invalidated += 1;
                        skipped += 1;
                        settlePending(rawPath);
                        return;
                    }
                    if (
                        index.matchesFileFingerprint(rawPath, {
                            sizeBytes: stat.size,
                            mtimeMs: stat.mtimeMs,
                            ctimeMs: stat.ctimeMs,
                            dev: Number(stat.dev),
                            ino: Number(stat.ino),
                        })
                    ) {
                        unchanged += 1;
                        settlePending(rawPath);
                        return;
                    }
                    const suppliedSnapshot = options.snapshots?.get(rawPath) ?? null;
                    const snapshot =
                        suppliedSnapshot &&
                        richFingerprintMatches(
                            {
                                sizeBytes: suppliedSnapshot.sizeBytes,
                                mtimeMs: suppliedSnapshot.mtimeMs,
                                ctimeMs: suppliedSnapshot.ctimeMs,
                                dev: suppliedSnapshot.dev,
                                ino: suppliedSnapshot.ino,
                            },
                            {
                                sizeBytes: stat.size,
                                mtimeMs: stat.mtimeMs,
                                ctimeMs: stat.ctimeMs,
                                dev: Number(stat.dev),
                                ino: Number(stat.ino),
                            },
                            { mtimeToleranceMs: 0 },
                        )
                            ? suppliedSnapshot
                            : await readTextFileSnapshot(rawPath, options.signal ? { signal: options.signal } : {});
                    if (snapshot === suppliedSnapshot) snapshotReuses += 1;
                    const candidateSymbols =
                        snapshot === suppliedSnapshot ? options.parsedSymbols?.get(rawPath) : undefined;
                    const suppliedSymbols =
                        candidateSymbols?.parserPolicyVersion === BABEL_PARSER_POLICY_VERSION
                            ? candidateSymbols
                            : undefined;
                    if (suppliedSymbols) parsedSymbolReuses += 1;
                    else if (candidateSymbols) parsedSymbolPolicyRejects += 1;
                    await index.indexTextFile(
                        {
                            filePath: rawPath,
                            workspaceRoot,
                            content: snapshot.content,
                            sizeBytes: snapshot.sizeBytes,
                            mtimeMs: snapshot.mtimeMs,
                            ctimeMs: snapshot.ctimeMs,
                            dev: snapshot.dev,
                            ino: snapshot.ino,
                            metadata: { refreshMode: 'explicit-path' },
                        },
                        {
                            ...(options.signal ? { signal: options.signal } : {}),
                            ...(suppliedSymbols ? { parsedSymbols: suppliedSymbols } : {}),
                        },
                    );
                    indexed += 1;
                    settlePending(rawPath);
                } catch (error) {
                    options.signal?.throwIfAborted();
                    const code = error && typeof error === 'object' && 'code' in error ? String(error.code ?? '') : '';
                    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') {
                        if (index.invalidatePath(rawPath)) invalidated += 1;
                        settlePending(rawPath);
                        return;
                    }
                    failed += 1;
                }
            }),
        ),
    );
    return {
        available: true,
        requested: filePaths.length,
        indexed,
        invalidated,
        unchanged,
        snapshotReuses,
        parsedSymbolReuses,
        parsedSymbolPolicyRejects,
        skipped,
        failed,
        concurrency,
        durationMs: Math.max(0, Date.now() - startedAt),
    };
}
