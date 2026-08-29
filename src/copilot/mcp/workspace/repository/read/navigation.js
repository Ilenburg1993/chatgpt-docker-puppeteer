// @ts-check
/**
 * Validated repository tree/search/symbol/outline navigation operations.
 *
 * Protocol-neutral: this file owns repository navigation semantics, not MCP wire schemas or result envelopes.
 *
 * @module copilot/mcp/workspace/repository/read/navigation
 */

import { windowFileContext } from '#copilot/infra/public/indexing/file-context';
import { DEFAULT_BLOCKED_PATH_SEGMENTS, evaluateWorkspacePathPolicy } from '#copilot/infra/public/policy';
import { isAbsolute } from 'node:path';

const DEFAULT_REPOSITORY_READ_PATH = 'src/copilot';

/** @typedef {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} RepositoryReadWorkspace */
/**
 * @typedef {{ ok: true; structured: Record<string, unknown>; text?: string } |
 *           { ok: false; message: string; details: Record<string, unknown> }} RepositoryReadOperationResult
 */

/** @param {Record<string, unknown>} structured @param {string} [text] @returns {RepositoryReadOperationResult} */
function success(structured, text) {
    return text === undefined ? { ok: true, structured } : { ok: true, structured, text };
}

/** @param {string} message @param {Record<string, unknown>} [details] @returns {RepositoryReadOperationResult} */
function failure(message, details = {}) {
    return { ok: false, message, details };
}

/** @param {unknown} value @param {string} fallback */
function normalizeOptionalRepositoryPath(value, fallback) {
    if (value === undefined || value === null) return fallback;
    const text = String(value).trim();
    return text === '' ? fallback : text;
}

/** @param {string} value */
function escapeForRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @param {string} workspaceRoot @param {string} output @param {string} defaultFile */
function parseUsageOutput(workspaceRoot, output, defaultFile) {
    /** @type {{ file: string; line: number; text: string }[]} */
    const matches = [];
    const files = new Set();
    const root = workspaceRoot.endsWith('/') ? workspaceRoot : `${workspaceRoot}/`;
    for (const rawLine of output.split('\n')) {
        if (!rawLine.trim() || rawLine === '--') continue;
        const matchedWithFile = rawLine.match(/^(.+?):(\d+):(.*)$/u);
        const matchedWithoutFile = matchedWithFile ? null : rawLine.match(/^(\d+):(.*)$/u);
        if (!matchedWithFile && !matchedWithoutFile) continue;
        const filePath = matchedWithFile?.[1] ?? defaultFile;
        const lineText = matchedWithFile?.[2] ?? matchedWithoutFile?.[1];
        const text = matchedWithFile?.[3] ?? matchedWithoutFile?.[2] ?? '';
        if (!filePath || !lineText) continue;
        const file = filePath.startsWith(root) ? filePath.slice(root.length) : filePath;
        files.add(file);
        matches.push({ file, line: Number(lineText), text: text.trimEnd() });
    }
    return { matches, fileCount: files.size };
}

/** @param {{ file: string; line: number; text: string }[]} matches */
function formatUsageMatches(matches) {
    return matches.map((match) => `${match.file}:${match.line}: ${match.text}`.trimEnd()).join('\n');
}

/** @param {{ type: string }[]} entries */
function countEntryTypes(entries) {
    const counts = { files: 0, directories: 0, symlinks: 0, other: 0 };
    for (const entry of entries) {
        if (entry.type === 'file') counts.files += 1;
        else if (entry.type === 'directory') counts.directories += 1;
        else if (entry.type === 'symlink') counts.symlinks += 1;
        else counts.other += 1;
    }
    return counts;
}

/** @param {string} candidate @param {string} scopePath */
function isTreePathWithinScope(candidate, scopePath) {
    return scopePath === '.' || candidate.startsWith(`${scopePath}/`);
}

/**
 * @param {string} workspaceRoot
 * @param {string} scopePath
 * @param {string | undefined} cursor
 * @returns {{ok:true;cursor:string|null}|{ok:false;message:string;details:Record<string,unknown>}}
 */
function normalizeTreeCursor(workspaceRoot, scopePath, cursor) {
    if (cursor === undefined || cursor === '') return { ok: true, cursor: null };
    const normalized = String(cursor).trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
    const policy =
        normalized && !isAbsolute(normalized) && normalized !== '..' && !normalized.startsWith('../')
            ? evaluateWorkspacePathPolicy(normalized, { workspaceRoot, mode: 'read' })
            : { ok: false };
    if (!normalized || !policy.ok || !isTreePathWithinScope(normalized, scopePath)) {
        return {
            ok: false,
            message: 'Tree cursor is outside the visible tree scope.',
            details: {
                code: 'ERR_REPO_TREE_CURSOR',
                failureClass: 'invalid-input',
                retryability: 'fix-input',
                recoveryRequired: false,
                hint: 'Use nextCursor returned by the same repo_tree scope/filter configuration, or omit cursor.',
            },
        };
    }
    return { ok: true, cursor: normalized };
}

/**
 * @param {{name:string;type:string;path:string;depth:number}} entry
 */
function conservativeTreeEntryBytes(entry) {
    const projection = entry.type === 'file' ? { ...entry, size: Number.MAX_SAFE_INTEGER } : entry;
    return Buffer.byteLength(JSON.stringify(projection), 'utf8');
}

/**
 * @param {{name:string;type:string;path:string;depth:number}[]} entries
 * @param {number} maxEntries
 * @param {number} maxOutputBytes
 * @returns {{ok:true;entries:{name:string;type:string;path:string;depth:number}[];nextCursor:string|null;truncated:boolean;truncationReason:string|null}|{ok:false;message:string;details:Record<string,unknown>}}
 */
function pageTreeEntries(entries, maxEntries, maxOutputBytes) {
    /** @type {{name:string;type:string;path:string;depth:number}[]} */
    const selected = [];
    let budgetBytes = 2;
    let stoppedAtOutputBudget = false;
    for (const entry of entries) {
        if (selected.length >= maxEntries) break;
        const contribution = conservativeTreeEntryBytes(entry) + (selected.length > 0 ? 1 : 0);
        if (budgetBytes + contribution > maxOutputBytes) {
            if (selected.length === 0) {
                return {
                    ok: false,
                    message: `First tree entry requires at least ${String(budgetBytes + contribution)} UTF-8 bytes but maxOutputBytes is ${String(maxOutputBytes)}.`,
                    details: {
                        code: 'ERR_REPO_TREE_PAGE_ITEM_TOO_LARGE',
                        failureClass: 'bounded-output-item-too-large',
                        retryability: 'manual-decision',
                        recoveryRequired: false,
                        requiredBytes: budgetBytes + contribution,
                        maxOutputBytes,
                    },
                };
            }
            stoppedAtOutputBudget = true;
            break;
        }
        selected.push(entry);
        budgetBytes += contribution;
    }
    const truncated = selected.length < entries.length;
    return {
        ok: true,
        entries: selected,
        nextCursor: truncated ? selected[selected.length - 1]?.path ?? null : null,
        truncated,
        truncationReason: truncated ? (stoppedAtOutputBudget ? 'content-byte-budget' : 'entry-limit') : null,
    };
}

/**
 * Preserve the historical file-size convenience without paying stat cost for the complete candidate universe.
 * Metadata enrichment is bounded to the already-selected page and tolerates a file disappearing between enumeration
 * and stat by leaving size absent for that entry.
 *
 * @param {RepositoryReadWorkspace} workspace
 * @param {{name:string;type:string;path:string;depth:number}[]} entries
 * @param {AbortSignal | undefined} signal
 */
async function enrichTreePageFileSizes(workspace, entries, signal) {
    /** @type {{name:string;type:string;path:string;depth:number;size?:number}[]} */
    const enriched = [];
    const batchSize = 32;
    for (let offset = 0; offset < entries.length; offset += batchSize) {
        signal?.throwIfAborted();
        const batch = entries.slice(offset, offset + batchSize);
        const rows = await Promise.all(
            batch.map(async (entry) => {
                if (entry.type !== 'file') return entry;
                try {
                    const snapshot = await workspace.io.statPath(entry.path);
                    return { ...entry, size: snapshot.stats.size };
                } catch {
                    return entry;
                }
            }),
        );
        enriched.push(...rows);
    }
    return enriched;
}

/**
 * @param {RepositoryReadWorkspace} workspace
 * @param {{ path?: string; recursive?: boolean; depth?: number; maxEntries?: number; showHidden?: boolean; includePattern?:string; excludePattern?:string; maxOutputBytes?:number; cursor?:string; hardMaxEntries?:number; signal?:AbortSignal }} [input]
 * @returns {Promise<RepositoryReadOperationResult>}
 */
export async function readRepositoryTree(workspace, input = {}) {
    const resolved = await workspace.resolveValidatedReadPath(
        normalizeOptionalRepositoryPath(input.path, DEFAULT_REPOSITORY_READ_PATH),
    );
    if (!resolved.ok) return failure(resolved.reason, resolved);
    const target = await workspace.io.statPathValidated(resolved.validatedReadPath);
    if (!target.stats.isDirectory()) {
        return failure('repo_tree requires a directory scope.', {
            code: 'ERR_REPO_TREE_NOT_DIRECTORY',
            failureClass: 'invalid-input',
            retryability: 'fix-input',
            recoveryRequired: false,
            path: resolved.relative,
        });
    }
    const effectiveMaxEntries = input.maxEntries ?? 2000;
    const effectiveMaxOutputBytes = input.maxOutputBytes ?? 512 * 1024;
    const effectiveDepth = input.recursive === true ? input.depth ?? 2 : 1;
    const scopePath = resolved.relative === '' ? '.' : resolved.relative.replace(/\\/gu, '/');
    const cursorResult = normalizeTreeCursor(workspace.workspaceRoot, scopePath, input.cursor);
    if (!cursorResult.ok) return failure(cursorResult.message, cursorResult.details);

    let structural;
    try {
        structural = await workspace.io.listWorkspaceTreeEntriesFreshValidated(resolved.validatedReadPath, {
            workspaceRoot: workspace.workspaceRoot,
            recursive: input.recursive === true,
            depth: effectiveDepth,
            showHidden: input.showHidden === true,
            includeSymlinks: true,
            ...(input.includePattern === undefined ? {} : { includePattern: input.includePattern }),
            ...(input.excludePattern === undefined ? {} : { excludePattern: input.excludePattern }),
            hardMaxEntries: input.hardMaxEntries ?? 100_000,
            ...(input.signal ? { signal: input.signal } : {}),
        });
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_WORKSPACE_WALK_LIMIT') {
            return failure(error instanceof Error ? error.message : 'Tree enumeration limit exceeded.', {
                code: 'ERR_REPO_TREE_ENUMERATION_LIMIT',
                failureClass: 'bounded-input-too-large',
                retryability: 'fix-input',
                recoveryRequired: false,
                hardMaxEntries: input.hardMaxEntries ?? 100_000,
                hint: 'Narrow path/depth or add include/exclude filters before retrying.',
            });
        }
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_WORKSPACE_WALK_GLOB_PATTERN') {
            return failure(error instanceof Error ? error.message : 'Tree include/exclude glob is invalid.', {
                code: 'ERR_REPO_TREE_GLOB_PATTERN',
                failureClass: 'invalid-input',
                retryability: 'fix-input',
                recoveryRequired: false,
            });
        }
        throw error;
    }

    const visible = structural.entries.map((entry) => ({ ...entry }));
    const cursor = cursorResult.cursor;
    const candidates = cursor ? visible.filter((entry) => entry.path > cursor) : visible;
    const page = pageTreeEntries(candidates, effectiveMaxEntries, effectiveMaxOutputBytes);
    if (!page.ok) return failure(page.message, page.details);
    const entries = await enrichTreePageFileSizes(workspace, page.entries, input.signal);
    const returnedContentBytes = Buffer.byteLength(JSON.stringify(entries), 'utf8');

    return success({
        success: true,
        path: scopePath,
        projection: 'flat-path-page-v2',
        cursorKind: 'path-keyset-v1',
        cursor,
        nextCursor: page.nextCursor,
        count: entries.length,
        totalVisible: visible.length,
        totalScanned: structural.visitedEntries,
        blockedEntriesCount: structural.protectedEntriesPruned,
        hiddenEntriesPruned: structural.hiddenEntriesPruned,
        symlinksObserved: structural.symlinksObserved,
        userExcludedEntries: structural.userExcludedEntries,
        truncated: page.truncated,
        truncationReason: page.truncationReason,
        returnedContentBytes,
        contentBudgetBytes: effectiveMaxOutputBytes,
        recursive: input.recursive === true,
        depth: effectiveDepth,
        engine: structural.engine,
        filters: {
            includePattern: input.includePattern ?? null,
            excludePattern: input.excludePattern ?? null,
        },
        securityPolicy: {
            readProtectedPaths: 'blocked',
            listProtectedPaths: 'redacted',
            writeProtectedPaths: 'blocked',
            pathProjection: 'workspace-relative-only',
            symlinkTraversal: 'disabled',
        },
        entries,
    });
}

/** @param {RepositoryReadWorkspace} workspace @returns {Promise<RepositoryReadOperationResult>} */
export async function auditRepositoryRootRedaction(workspace) {
    const resolved = await workspace.resolveValidatedReadPath('.');
    if (!resolved.ok) return failure(resolved.reason, resolved);
    const visibleScan = await workspace.indexing.scanDirectoryValidated(resolved.validatedReadPath, {
        workspaceRoot: workspace.workspaceRoot,
        recursive: false,
        depth: 1,
        showHidden: false,
    });
    const aggregateScan = await workspace.indexing.scanDirectoryValidated(resolved.validatedReadPath, {
        workspaceRoot: workspace.workspaceRoot,
        recursive: false,
        depth: 1,
        showHidden: true,
        respectDenylist: false,
        redactProtectedPaths: true,
        fingerprint: false,
    });
    const hiddenInspectableCount = aggregateScan.entries.filter((entry) => entry.name.startsWith('.')).length;
    return success({
        success: true,
        workspaceRoot: workspace.workspaceRoot,
        path: resolved.relative,
        policy: {
            hiddenNamesReturned: false,
            protectedNamesReturned: false,
            rootTreeDefaultShowHidden: false,
            listProtectedPaths: 'redacted',
            readProtectedPaths: 'blocked',
            writeProtectedPaths: 'blocked',
            protectedSegmentCount: DEFAULT_BLOCKED_PATH_SEGMENTS.length,
        },
        visibleTopLevelCount: visibleScan.entries.length,
        visibleTypeCounts: countEntryTypes(visibleScan.entries),
        hiddenInspectableTopLevelCount: hiddenInspectableCount,
        protectedOrRedactedTopLevelCount: aggregateScan.blockedEntries,
        aggregateInspectableTopLevelCount: aggregateScan.entries.length,
        aggregateTypeCounts: countEntryTypes(aggregateScan.entries),
        totalScannedVisible: visibleScan.scannedEntries,
        totalScannedAggregate: aggregateScan.scannedEntries,
        hint: 'Use repo_tree path="." without showHidden for names. Use this status tool for hidden/protected aggregate auditing.',
    });
}

/**
 * @param {RepositoryReadWorkspace} workspace
 * @param {{ pattern?: string | undefined; query?: string | undefined; path?: string | undefined; isRegex?: boolean | undefined; caseSensitive?: boolean | undefined; includePattern?: string | undefined; excludePattern?: string | undefined; contextLines?: number | undefined; maxResults?: number | undefined; cursor?: string | undefined }} input
 * @returns {Promise<RepositoryReadOperationResult>}
 */
export async function searchRepositoryText(workspace, input) {
    const effectivePattern = input.pattern ?? input.query;
    if (!effectivePattern)
        return failure('Search pattern is required.', {
            code: 'ERR_SEARCH_PATTERN_REQUIRED',
            hint: 'Provide pattern or query.',
        });
    const resolved = await workspace.resolveValidatedReadPath(
        normalizeOptionalRepositoryPath(input.path, DEFAULT_REPOSITORY_READ_PATH),
    );
    if (!resolved.ok) return failure(resolved.reason, resolved);
    const result = await workspace.indexing.searchTextValidated(resolved.validatedReadPath, {
        workspaceRoot: workspace.workspaceRoot,
        pattern: effectivePattern,
        isRegex: input.isRegex === true,
        caseSensitive: input.caseSensitive === true,
        ...(input.includePattern === undefined ? {} : { includePattern: input.includePattern }),
        ...(input.excludePattern === undefined ? {} : { excludePattern: input.excludePattern }),
        ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
        contextLines: input.contextLines ?? 0,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });
    const targetStat = await workspace.io.statPathValidated(resolved.validatedReadPath);
    const targetStats = targetStat.stats;
    const targetIsFile = targetStats.isFile();
    const targetHashBytes =
        targetIsFile && targetStats.size <= 5 * 1024 * 1024
            ? await workspace.io.readBytesValidated(resolved.validatedReadPath)
            : null;
    return success(
        {
            success: true,
            path: resolved.relative,
            searchTargetMetadata: targetIsFile
                ? {
                      type: 'file',
                      sizeBytes: targetStats.size,
                      sha256: targetHashBytes?.contentHash ?? null,
                      hashComputed: Boolean(targetHashBytes),
                  }
                : { type: targetStats.isDirectory() ? 'directory' : 'other' },
            pattern: effectivePattern,
            query: input.query ?? null,
            contextLines: input.contextLines ?? 0,
            cursor: input.cursor ?? null,
            output: result.output,
            matchCount: result.matchCount,
            returnedMatchCount: result.returnedMatchCount ?? result.matchCount,
            returnedLineCount: result.returnedLineCount ?? (result.output ? result.output.split('\n').length : 0),
            totalMatches: result.totalMatches ?? result.matchCount,
            totalMatchCount: result.totalMatchCount ?? result.totalMatches ?? result.matchCount,
            totalLineCount: result.totalLineCount ?? null,
            countsPostSanitization: result.countsPostSanitization,
            truncated: result.truncated,
            nextCursor: result.nextCursor ?? null,
            cursorOffset: result.cursorOffset ?? 0,
            engine: result.engine,
        },
        result.output,
    );
}

/**
 * @param {RepositoryReadWorkspace} workspace
 * @param {{ symbol: string; path?: string; includePattern?: string; excludePattern?: string; wholeWord?: boolean; caseSensitive?: boolean; maxResults?: number; cursor?: string }} input
 * @returns {Promise<RepositoryReadOperationResult>}
 */
export async function findRepositorySymbolUsages(workspace, input) {
    const resolved = await workspace.resolveValidatedReadPath(
        normalizeOptionalRepositoryPath(input.path, DEFAULT_REPOSITORY_READ_PATH),
    );
    if (!resolved.ok) return failure(resolved.reason, resolved);
    const escaped = escapeForRegex(input.symbol);
    const pattern = input.wholeWord !== false ? `\\b${escaped}\\b` : escaped;
    const result = await workspace.indexing.searchTextValidated(resolved.validatedReadPath, {
        workspaceRoot: workspace.workspaceRoot,
        pattern,
        isRegex: true,
        caseSensitive: input.caseSensitive !== false,
        includePattern: input.includePattern ?? '*.{js,ts,mjs,cjs}',
        ...(input.excludePattern === undefined ? {} : { excludePattern: input.excludePattern }),
        contextLines: 0,
        ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });
    const parsed = parseUsageOutput(workspace.workspaceRoot, result.output, resolved.relative);
    const output = formatUsageMatches(parsed.matches);
    return success(
        {
            success: true,
            symbol: input.symbol,
            path: resolved.relative,
            output,
            matchCount: parsed.matches.length,
            fileCount: parsed.fileCount,
            matches: parsed.matches,
            totalMatches: result.totalMatches ?? result.matchCount,
            totalMatchCount: result.totalMatchCount ?? result.totalMatches ?? result.matchCount,
            countsPostSanitization: result.countsPostSanitization,
            truncated: Boolean(result.truncated),
            nextCursor: result.nextCursor ?? null,
            cursorOffset: result.cursorOffset ?? 0,
            engine: result.engine,
        },
        output,
    );
}

/**
 * @param {RepositoryReadWorkspace} workspace
 * @param {{ name: string; kind?: 'function' | 'class' | 'variable' | 'export' | 'type' | 'all'; path?: string; includePattern?: string; caseSensitive?: boolean; exactMatch?: boolean; maxResults?: number; cursor?: string }} input
 * @returns {Promise<RepositoryReadOperationResult>}
 */
export async function searchRepositorySymbols(workspace, input) {
    const resolved = await workspace.resolveValidatedReadPath(
        normalizeOptionalRepositoryPath(input.path, DEFAULT_REPOSITORY_READ_PATH),
    );
    if (!resolved.ok) return failure(resolved.reason, resolved);
    const result = await workspace.indexing.searchWorkspaceSymbolsValidated(resolved.validatedReadPath, {
        symbolName: input.name,
        kind: input.kind ?? 'all',
        ...(input.includePattern === undefined ? {} : { includePattern: input.includePattern }),
        caseSensitive: input.caseSensitive === true,
        exactMatch: input.exactMatch === true,
        ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });
    return success(
        {
            success: true,
            path: resolved.relative,
            symbol: input.name,
            kind: input.kind ?? 'all',
            output: result.output,
            matchCount: result.matchCount,
            totalMatches: result.totalMatches ?? result.matchCount,
            countsPostSanitization: result.countsPostSanitization,
            truncated: Boolean(result.truncated),
            nextCursor: result.nextCursor ?? null,
            cursorOffset: result.cursorOffset ?? 0,
            engine: result.engine,
        },
        result.output,
    );
}

/**
 * @param {RepositoryReadWorkspace} workspace
 * @param {{ path: string; includeImports?: boolean; includeExports?: boolean; includeOutline?: boolean; includeTopComments?: boolean; maxItems?: number; maxBytes?: number; cursor?: string }} input
 * @returns {Promise<RepositoryReadOperationResult>}
 */
export async function readRepositoryFileOutline(workspace, input) {
    const resolved = await workspace.resolveValidatedReadPath(input.path);
    if (!resolved.ok) return failure(resolved.reason, resolved);
    const snapshot = await workspace.io.readTextValidated(resolved.validatedReadPath);
    const parsed = await workspace.indexing.parseFileForContext(resolved.resolved, snapshot.content, {
        ...(typeof snapshot.contentHash === 'string' ? { contentHash: snapshot.contentHash } : {}),
    });
    let windowed;
    try {
        windowed = windowFileContext(parsed, {
            ...(input.maxItems === undefined ? {} : { maxItems: input.maxItems }),
            ...(input.maxBytes === undefined ? {} : { maxBytes: input.maxBytes }),
            includeImports: input.includeImports !== false,
            includeExports: input.includeExports !== false,
            includeOutline: input.includeOutline !== false,
            includeTopComments: input.includeTopComments === true,
            ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
            ...(typeof snapshot.contentHash === 'string' ? { cursorRevision: snapshot.contentHash } : {}),
        });
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_FILE_CONTEXT_WINDOW_CURSOR') {
            return failure(error instanceof Error ? error.message : 'Repository outline cursor is invalid.', {
                code: 'ERR_REPO_OUTLINE_CURSOR',
                failureClass: 'invalid-input',
                retryability: 'fix-input',
                recoveryRequired: false,
                hint: 'Use nextCursor from the same file revision and include* projection, or omit cursor.',
            });
        }
        if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'ERR_FILE_CONTEXT_WINDOW_ITEM_TOO_LARGE'
        ) {
            const row = /** @type {Record<string, unknown>} */ (error);
            return failure(error instanceof Error ? error.message : 'Repository outline item exceeds the page budget.', {
                code: 'ERR_REPO_OUTLINE_PAGE_ITEM_TOO_LARGE',
                failureClass: 'bounded-output-item-too-large',
                retryability: 'manual-decision',
                recoveryRequired: false,
                collection: row['collection'],
                index: row['index'],
                requiredBytes: row['requiredBytes'],
                maxBytes: row['maxBytes'],
            });
        }
        throw error;
    }
    const structured = {
        success: true,
        path: resolved.relative,
        sha256: snapshot.contentHash,
        symbols: windowed.symbols,
        parseError: parsed.symbols.parseError ?? null,
        cursorKind: windowed.cursorKind,
        cursor: windowed.cursor,
        nextCursor: windowed.nextCursor,
        hasMore: windowed.hasMore,
        truncated: windowed.truncated,
        truncationReason: windowed.truncationReason,
        maxItems: windowed.maxItems,
        maxBytes: windowed.maxBytes,
        contentBudgetBytes: windowed.maxBytes,
        returnedContentBytes: windowed.returnedContentBytes,
        totalCounts: windowed.totalCounts,
        returnedCounts: windowed.returnedCounts,
        ...(input.includeImports !== false ? { imports: windowed.imports } : {}),
        ...(input.includeExports !== false ? { exports: windowed.exports } : {}),
        ...(input.includeOutline !== false ? { outline: windowed.outline } : {}),
        ...(input.includeTopComments === true ? { topComments: windowed.topComments } : {}),
    };
    return success(structured, Array.isArray(structured.outline) ? structured.outline.join('\n') : '');
}
