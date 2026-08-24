// @ts-check
/**
 * Validated repository tree/search/symbol/outline navigation operations.
 *
 * Protocol-neutral: this file owns repository navigation semantics, not MCP wire schemas or result envelopes.
 *
 * @module copilot/mcp/workspace/repository/read/navigation
 */

import { windowFileContext } from '#copilot/infra/public/indexing/file-context';
import { DEFAULT_BLOCKED_PATH_SEGMENTS } from '#copilot/infra/public/policy';

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

/** @param {{ io?: { advisoryLimits?: Record<string, unknown> } }} scan */
function scanHardLimitReached(scan) {
    return scan.io?.advisoryLimits?.['hardLimitReached'] === true;
}

/**
 * @param {RepositoryReadWorkspace} workspace
 * @param {{ path?: string; recursive?: boolean; depth?: number; maxEntries?: number; showHidden?: boolean }} [input]
 * @returns {Promise<RepositoryReadOperationResult>}
 */
export async function readRepositoryTree(workspace, input = {}) {
    const resolved = await workspace.resolveValidatedReadPath(
        normalizeOptionalRepositoryPath(input.path, DEFAULT_REPOSITORY_READ_PATH),
    );
    if (!resolved.ok) return failure(resolved.reason, resolved);
    const effectiveMaxEntries = input.maxEntries ?? 2000;
    const scan = await workspace.indexing.scanDirectoryValidated(resolved.validatedReadPath, {
        workspaceRoot: workspace.workspaceRoot,
        recursive: input.recursive === true,
        depth: input.depth ?? 2,
        showHidden: input.showHidden === true,
        maxEntries: effectiveMaxEntries,
        fingerprint: false,
        respectGitignore: input.recursive === true,
    });
    const entries = scan.entries.slice(0, effectiveMaxEntries);
    return success({
        success: true,
        workspaceRoot: workspace.workspaceRoot,
        path: resolved.relative,
        count: entries.length,
        totalScanned: scan.scannedEntries,
        blockedEntriesCount: scan.blockedEntries,
        truncated: entries.length < scan.entries.length || scanHardLimitReached(scan),
        securityPolicy: {
            readProtectedPaths: 'blocked',
            listProtectedPaths: 'redacted',
            writeProtectedPaths: 'blocked',
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
        hint: 'Use repo_root_tree without showHidden for names. Use this status tool for hidden/protected aggregate auditing.',
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
 * @param {{ path: string; includeImports?: boolean; includeExports?: boolean; includeOutline?: boolean; includeTopComments?: boolean; maxItems?: number; maxBytes?: number }} input
 * @returns {Promise<RepositoryReadOperationResult>}
 */
export async function readRepositoryFileOutline(workspace, input) {
    const resolved = await workspace.resolveValidatedReadPath(input.path);
    if (!resolved.ok) return failure(resolved.reason, resolved);
    const snapshot = await workspace.io.readTextValidated(resolved.validatedReadPath);
    const parsed = await workspace.indexing.parseFileForContext(resolved.resolved, snapshot.content, {
        ...(typeof snapshot.contentHash === 'string' ? { contentHash: snapshot.contentHash } : {}),
    });
    const windowed = windowFileContext(parsed, {
        ...(input.maxItems === undefined ? {} : { maxItems: input.maxItems }),
        ...(input.maxBytes === undefined ? {} : { maxBytes: input.maxBytes }),
        includeImports: input.includeImports !== false,
        includeExports: input.includeExports !== false,
        includeOutline: input.includeOutline !== false,
        includeTopComments: input.includeTopComments === true,
    });
    const structured = {
        success: true,
        path: resolved.relative,
        sha256: snapshot.contentHash,
        symbols: windowed.symbols,
        parseError: parsed.symbols.parseError ?? null,
        truncated: windowed.truncated,
        maxItems: windowed.maxItems,
        maxBytes: windowed.maxBytes,
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
