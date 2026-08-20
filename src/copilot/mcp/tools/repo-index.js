// @ts-check
/**
 * Workspace index MCP tools.
 *
 * These tools mirror the LLM-B `workspace_index_*` capabilities while keeping the MCP surface independent from the
 * in-repo LLM tool registry. Both surfaces share the canonical IO/index engine.
 *
 * @module copilot/mcp/tools/repo-index
 */

import { normalizeIoCacheKey, registerInvalidationHook } from '#copilot/infra/io-cache';
import {
    buildIoIndexForDirectory,
    filterIndexRowsByGlob,
    findIoIndexImports,
    findIoIndexImportsByPath,
    findIoIndexSymbol,
    formatIndexImportRows,
    formatIndexSearchRows,
    formatIndexSymbolRows,
    getIoIndexStats,
    invalidateIoIndexPath,
    normalizeSearchWindow,
    paginateSearchItems,
    parseFileForContext,
    searchIoIndex,
} from '#copilot/infra/public/indexing';
import { createWorkspaceIo } from '#copilot/infra/public/workspace-io';
import {
    boundedWriteAnnotations,
    createTtlCache,
    errorResult,
    getMcpWorkspaceRoot,
    okResult,
    readMcpIndexAutoBuildState,
    readOnlyAnnotations,
    resolveReadPath,
} from '#copilot/mcp/control-plane';
import { WORKSPACE_ROOT } from '#copilot/tools';
import { dirname, extname, join, relative, resolve as resolvePath } from 'node:path';
import { z } from 'zod';

const { readText, readTextValidated, statPath, statPathValidated } = createWorkspaceIo({
    workspaceRoot: getMcpWorkspaceRoot(),
});

const DEFAULT_INDEX_PATH = 'src/copilot';
const DEFAULT_ORPHAN_IMPORT_SCAN_PATH = 'src/copilot';
const DEFAULT_ORPHAN_IMPORT_MAX_FILES = 500;
const MODULE_FILE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json'];
const MODULE_INDEX_CANDIDATES = MODULE_FILE_EXTENSIONS.map((extension) => `index${extension}`);
const LOCAL_IMPORT_ALIAS_PREFIXES = ['#copilot'];
const PACKAGE_JSON_PATH = join(WORKSPACE_ROOT, 'package.json');
const IMPORT_TARGET_EXISTS_CACHE_TTL_MS = 5 * 60 * 1000;
const IMPORT_TARGET_EXISTS_CACHE_MAX_ENTRIES = 10_000;
/** @type {import('#copilot/mcp/control-plane').TtlCache<boolean>} */
const importTargetExistsCache = createTtlCache({
    name: 'repo-index-import-target-exists',
    ttlMs: IMPORT_TARGET_EXISTS_CACHE_TTL_MS,
    maxEntries: IMPORT_TARGET_EXISTS_CACHE_MAX_ENTRIES,
});

registerInvalidationHook((filePath, event) => {
    try {
        if (event?.recursive === true) {
            importTargetExistsCache.clear();
            return;
        }
        importTargetExistsCache.delete(normalizeIoCacheKey(filePath));
    } catch {
        // Cache externo jamais deve derrubar ferramentas de leitura.
    }
});

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeOptionalRepoPath(value, fallback) {
    if (value === undefined || value === null) return fallback;
    const text = String(value).trim();
    return text === '' ? fallback : text;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} max
 * @returns {number}
 */
function normalizePositiveInteger(value, fallback, max) {
    const parsed = Number(value ?? fallback);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

/**
 * @param {string} rootPath
 * @param {string} filePath
 * @returns {number | null}
 */
function relativeFileDepth(rootPath, filePath) {
    const rel = relative(rootPath, filePath).replace(/\\/g, '/');
    if (!rel || rel === '.' || rel.startsWith('../') || rel === '..') return null;
    return rel.split('/').filter(Boolean).length;
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isAnalyzableModuleFile(filePath) {
    return MODULE_FILE_EXTENSIONS.includes(extname(filePath).toLowerCase());
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function isLocalImportSource(source) {
    return (
        source.startsWith('.') ||
        LOCAL_IMPORT_ALIAS_PREFIXES.some((prefix) => source === prefix || source.startsWith(`${prefix}/`))
    );
}

const PACKAGE_IMPORTS_CACHE_TTL_MS = 30_000;
/** @type {Promise<Array<[string, unknown]>> | null} */
let packageImportEntriesPromise = null;
let packageImportEntriesExpiresAtMs = 0;

/**
 * Resolve the first usable string target from a Node.js package-import target.
 * Conditional objects prefer import/node/default and then fall back to declaration order.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function selectPackageImportTarget(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        for (const candidate of value) {
            const target = selectPackageImportTarget(candidate);
            if (target) return target;
        }
        return null;
    }
    if (!value || typeof value !== 'object') return null;
    const record = /** @type {Record<string, unknown>} */ (value);
    for (const condition of ['import', 'node', 'default']) {
        const target = selectPackageImportTarget(record[condition]);
        if (target) return target;
    }
    for (const candidate of Object.values(record)) {
        const target = selectPackageImportTarget(candidate);
        if (target) return target;
    }
    return null;
}

/**
 * @returns {Promise<Array<[string, unknown]>>}
 */
async function readPackageImportEntries() {
    const now = Date.now();
    if (!packageImportEntriesPromise || now >= packageImportEntriesExpiresAtMs) {
        packageImportEntriesExpiresAtMs = now + PACKAGE_IMPORTS_CACHE_TTL_MS;
        packageImportEntriesPromise = readText(PACKAGE_JSON_PATH)
            .then((text) => {
                const parsed = JSON.parse(text.content);
                const imports = parsed && typeof parsed === 'object' ? parsed.imports : null;
                return imports && typeof imports === 'object' ? Object.entries(imports) : [];
            })
            .catch(() => []);
    }
    return packageImportEntriesPromise;
}

/**
 * @param {string} source
 * @param {Array<[string, unknown]>} entries
 * @returns {{ basePath: string; strategy: 'package-import-exact' | 'package-import-wildcard' } | null}
 */
function resolvePackageImportBasePath(source, entries) {
    const exact = entries.find(([key]) => key === source);
    if (exact) {
        const target = selectPackageImportTarget(exact[1]);
        if (target?.startsWith('./')) {
            return { basePath: resolvePath(WORKSPACE_ROOT, target), strategy: 'package-import-exact' };
        }
    }

    const wildcardMatches = entries
        .map(([key, value]) => ({ key, value, starIndex: key.indexOf('*') }))
        .filter(({ starIndex }) => starIndex >= 0)
        .sort((a, b) => b.key.length - a.key.length);
    for (const { key, value, starIndex } of wildcardMatches) {
        const prefix = key.slice(0, starIndex);
        const suffix = key.slice(starIndex + 1);
        if (!source.startsWith(prefix) || !source.endsWith(suffix)) continue;
        const wildcardValue = source.slice(prefix.length, source.length - suffix.length);
        const target = selectPackageImportTarget(value);
        if (!target?.startsWith('./')) continue;
        const substituted = target.includes('*') ? target.replaceAll('*', wildcardValue) : target;
        return { basePath: resolvePath(WORKSPACE_ROOT, substituted), strategy: 'package-import-wildcard' };
    }
    return null;
}

/**
 * @param {string} source
 * @param {string} importerPath
 * @returns {Promise<{ basePath: string; strategy: string } | null>}
 */
async function resolveImportBasePath(source, importerPath) {
    if (source.startsWith('.')) {
        return { basePath: resolvePath(dirname(importerPath), source), strategy: 'relative' };
    }
    if (source.startsWith('#')) {
        const mapped = resolvePackageImportBasePath(source, await readPackageImportEntries());
        if (mapped) return mapped;
    }
    if (source === '#copilot') {
        return { basePath: join(WORKSPACE_ROOT, 'src/copilot'), strategy: 'legacy-copilot-alias' };
    }
    if (source.startsWith('#copilot/')) {
        return {
            basePath: join(WORKSPACE_ROOT, 'src/copilot', source.slice('#copilot/'.length)),
            strategy: 'legacy-copilot-alias',
        };
    }
    return null;
}

/**
 * @param {string} basePath
 * @returns {string[]}
 */
function buildModuleCandidatePaths(basePath) {
    const candidates = new Set([basePath]);
    const hasExtension = extname(basePath) !== '';
    if (!hasExtension) {
        for (const extension of MODULE_FILE_EXTENSIONS) {
            candidates.add(`${basePath}${extension}`);
        }
        for (const fileName of MODULE_INDEX_CANDIDATES) {
            candidates.add(join(basePath, fileName));
        }
    }
    return [...candidates];
}

/**
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
    try {
        const result = await statPath(filePath);
        return result.stats.isFile();
    } catch {
        return false;
    }
}

/**
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function cachedFileExists(filePath) {
    const cacheKey = normalizeIoCacheKey(filePath);
    const cached = importTargetExistsCache.get(cacheKey);
    if (cached !== null) return cached;
    const exists = await fileExists(filePath);
    importTargetExistsCache.set(cacheKey, exists);
    return exists;
}

/**
 * Classify candidate targets without collapsing path-policy denial into filesystem absence.
 *
 * @param {string[]} candidates
 * @returns {Promise<{ status: 'exists' | 'missing' | 'protected'; protectedCandidateCount: number }>}
 */
async function classifyCandidateTargets(candidates) {
    let protectedCandidateCount = 0;
    for (const candidate of candidates) {
        const workspaceRelativeCandidate = relative(WORKSPACE_ROOT, candidate);
        const policy = await resolveReadPath(workspaceRelativeCandidate);
        if (!policy.ok) {
            if (policy.code === 'ERR_PATH_DENIED') protectedCandidateCount += 1;
            continue;
        }
        if (await cachedFileExists(candidate)) {
            return { status: 'exists', protectedCandidateCount };
        }
    }
    return {
        status: protectedCandidateCount > 0 ? 'protected' : 'missing',
        protectedCandidateCount,
    };
}

/**
 * @param {{ file: string; line: number; source: string; dynamic: boolean; attemptedTargets: string[]; resolutionStrategy: string }[]} rows
 * @param {{ file: string; line: number; source: string; dynamic: boolean; resolutionStrategy: string }[]} protectedRows
 * @returns {string}
 */
function formatOrphanImportRows(rows, protectedRows = []) {
    const missingLines = rows.map((row) => {
        const dynamic = row.dynamic ? ' dynamic' : '';
        const attempted = row.attemptedTargets.slice(0, 3).join(', ');
        return `${row.file}:${row.line}: import${dynamic} from '${row.source}' -> alvo local não encontrado (${attempted}); resolução=${row.resolutionStrategy}`;
    });
    const protectedLines = protectedRows.map((row) => {
        const dynamic = row.dynamic ? ' dynamic' : '';
        return `${row.file}:${row.line}: import${dynamic} from '${row.source}' -> protected/unverifiable; resolução=${row.resolutionStrategy}`;
    });
    return [...missingLines, ...protectedLines].join('\n');
}

/**
 * @type {import('../registry.js').McpToolDefinition[]}
 */
export const repoIndexTools = [
    {
        name: 'repo_index_status',
        title: 'Repository index status',
        description: 'Return availability and freshness metadata for the shared local IO/FTS/symbol index.',
        inputSchema: {},
        annotations: readOnlyAnnotations(),
        handler: async () =>
            okResult({
                success: true,
                workspaceRoot: getMcpWorkspaceRoot(),
                defaultPath: DEFAULT_INDEX_PATH,
                stats: getIoIndexStats(),
                autoBuild: readMcpIndexAutoBuildState(),
            }),
    },
    {
        name: 'repo_index_build',
        title: 'Build repository index',
        description:
            'Build or refresh the shared local IO index for a workspace path. This updates only the local Copilot SQLite index.',
        inputSchema: {
            path: z
                .string()
                .optional()['describe']('Workspace-relative directory path. Default: src/copilot. Empty string uses the default.'),
            recursive: z.boolean().optional()['describe']('Index recursively. Default: true.'),
            depth: z.number().int().positive().max(50).optional()['describe']('Advisory scan depth. Default: 20.'),
            respectGitignore: z.boolean().optional()['describe']('Respect .gitignore. Default: true.'),
            include: z.array(z.string().min(1)).optional()['describe']('Include glob filters for scan candidates.'),
            exclude: z.array(z.string().min(1)).optional()['describe']('Exclude glob filters for scan candidates.'),
            extensions: z.array(z.string().min(1)).optional()['describe']('Textual file extensions to index.'),
            concurrency: z.number().int().positive().max(32).optional()['describe']('Advisory indexing concurrency.'),
            maxFiles: z.number().int().positive().max(25_000).optional()['describe']('Maximum candidate files to index.'),
            pruneMissing: z
                .boolean()
                .optional()['describe']('Remove missing files from the indexed slice. Default: safe auto-prune.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({
            path,
            recursive,
            depth,
            respectGitignore,
            include,
            exclude,
            extensions,
            concurrency,
            maxFiles,
            pruneMissing,
        }) => {
            const resolved = await resolveReadPath(normalizeOptionalRepoPath(path, DEFAULT_INDEX_PATH));
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const result = await buildIoIndexForDirectory(resolved.resolved, {
                workspaceRoot: WORKSPACE_ROOT,
                recursive: recursive ?? true,
                depth: depth ?? 20,
                respectGitignore: respectGitignore ?? true,
                ...(include !== undefined ? { include } : {}),
                ...(exclude !== undefined ? { exclude } : {}),
                ...(extensions !== undefined ? { extensions } : {}),
                ...(concurrency !== undefined ? { concurrency } : {}),
                ...(maxFiles !== undefined ? { maxFiles } : {}),
                ...(pruneMissing !== undefined ? { pruneMissing } : {}),
            });
            return okResult({
                success: result.available !== false,
                path: resolved.relative,
                workspaceRoot: getMcpWorkspaceRoot(),
                result,
                stats: getIoIndexStats(),
            });
        },
    },
    {
        name: 'repo_index_search',
        title: 'Search repository index',
        description:
            'Search the shared FTS5 index when available, with cursor pagination and include/exclude glob filters.',
        inputSchema: {
            query: z.string().min(1)['describe']('Text query for the FTS5 index.'),
            path: z
                .string()
                .optional()['describe']('Workspace-relative file or directory prefix. Default: entire indexed workspace.'),
            maxResults: z.number().int().positive().max(500).optional()['describe']('Maximum returned rows. Default: 50.'),
            cursor: z.string().optional()['describe']('Cursor returned by a previous repo_index_search call.'),
            includePattern: z.string().optional()['describe']('Include glob filter, for example *.ts.'),
            excludePattern: z.string().optional()['describe']('Exclude glob filter, for example node_modules.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ query, path, maxResults, cursor, includePattern, excludePattern }) => {
            const stats = getIoIndexStats();
            if (!stats.available) {
                return okResult({
                    success: true,
                    available: false,
                    query,
                    output: '',
                    matchCount: 0,
                    totalMatches: 0,
                    truncated: false,
                    nextCursor: null,
                    engine: 'fts5-index',
                    stats,
                });
            }
            const window = normalizeSearchWindow({ maxResults, cursor });
            let pathPrefix;
            let relativePath = null;
            if (path !== undefined) {
                const resolved = await resolveReadPath(normalizeOptionalRepoPath(path, '.'));
                if (!resolved.ok) return errorResult(resolved.reason, resolved);
                pathPrefix = resolved.resolved;
                relativePath = resolved.relative;
            }
            const rows = searchIoIndex(query, {
                ...(window.commandMaxCount != null ? { maxResults: window.commandMaxCount } : {}),
                ...(pathPrefix !== undefined ? { pathPrefix } : {}),
            });
            const filtered = filterIndexRowsByGlob(rows, includePattern, excludePattern);
            const paged = paginateSearchItems(filtered, window);
            const output = formatIndexSearchRows(paged.items);
            return okResult(
                {
                    success: true,
                    available: true,
                    query,
                    path: relativePath,
                    output,
                    matchCount: paged.items.length,
                    totalMatches: paged.totalItems,
                    truncated: paged.truncated,
                    nextCursor: paged.nextCursor,
                    cursorOffset: paged.cursorOffset,
                    engine: 'fts5-index',
                    stats,
                },
                output,
            );
        },
    },
    {
        name: 'repo_index_find_symbol',
        title: 'Find repository symbol in index',
        description:
            'Search persisted symbols in the shared local index. Use after repo_index_build for fast navigation.',
        inputSchema: {
            symbol: z.string().min(1)['describe']('Symbol name or substring.'),
            maxResults: z.number().int().positive().max(500).optional()['describe']('Maximum returned rows. Default: 50.'),
            cursor: z.string().optional()['describe']('Cursor returned by a previous repo_index_find_symbol call.'),
            exactMatch: z.boolean().optional()['describe']('Require exact symbol name. Default: false.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ symbol, maxResults, cursor, exactMatch }) => {
            const stats = getIoIndexStats();
            if (!stats.available) {
                return okResult({
                    success: true,
                    available: false,
                    symbol,
                    output: '',
                    matchCount: 0,
                    totalMatches: 0,
                    truncated: false,
                    nextCursor: null,
                    engine: 'fts5-index',
                    stats,
                });
            }
            const window = normalizeSearchWindow({ maxResults, cursor });
            const rows = findIoIndexSymbol(
                symbol,
                window.commandMaxCount != null ? { maxResults: window.commandMaxCount } : {},
            );
            const filtered = exactMatch ? rows.filter((row) => row.symbolName === symbol) : rows;
            const paged = paginateSearchItems(filtered, window);
            const output = formatIndexSymbolRows(paged.items);
            return okResult(
                {
                    success: true,
                    available: true,
                    symbol,
                    output,
                    matchCount: paged.items.length,
                    totalMatches: paged.totalItems,
                    truncated: paged.truncated,
                    nextCursor: paged.nextCursor,
                    cursorOffset: paged.cursorOffset,
                    engine: 'fts5-index',
                    stats,
                },
                output,
            );
        },
    },
    {
        name: 'repo_find_imports',
        title: 'Find repository imports',
        description: 'Find imports or dynamic imports by module source in the shared local index.',
        inputSchema: {
            source: z.string().min(1)['describe']('Imported module/source substring, for example react, zod, or ./utils.'),
            maxResults: z.number().int().positive().max(500).optional()['describe']('Maximum returned rows. Default: 50.'),
            cursor: z.string().optional()['describe']('Cursor returned by a previous repo_find_imports call.'),
            exactSource: z.boolean().optional()['describe']('Require exact import source. Default: false.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ source, maxResults, cursor, exactSource }) => {
            const stats = getIoIndexStats();
            if (!stats.available) {
                return okResult({
                    success: true,
                    available: false,
                    source,
                    output: '',
                    matchCount: 0,
                    totalMatches: 0,
                    truncated: false,
                    nextCursor: null,
                    engine: 'fts5-index',
                    stats,
                });
            }
            const window = normalizeSearchWindow({ maxResults, cursor });
            const rows = findIoIndexImports(source, {
                ...(window.commandMaxCount != null ? { maxResults: window.commandMaxCount } : {}),
                ...(exactSource ? { exactSource: true } : {}),
            });
            const paged = paginateSearchItems(rows, window);
            const output = formatIndexImportRows(paged.items);
            return okResult(
                {
                    success: true,
                    available: true,
                    source,
                    output,
                    matchCount: paged.items.length,
                    totalMatches: paged.totalItems,
                    truncated: paged.truncated,
                    nextCursor: paged.nextCursor,
                    cursorOffset: paged.cursorOffset,
                    engine: 'fts5-index',
                    stats,
                },
                output,
            );
        },
    },
    {
        name: 'repo_find_orphan_imports',
        title: 'Find orphan repository imports',
        description:
            'Parse a workspace file or directory and report local relative or #copilot imports whose target file cannot be found.',
        inputSchema: {
            path: z
                .string()
                .optional()['describe'](
                    'Workspace-relative file or directory path. Default: src/copilot. Empty string uses default.',
                ),
            recursive: z.boolean().optional()['describe']('Scan directories recursively. Default: true.'),
            depth: z.number().int().positive().max(50).optional()['describe']('Directory scan depth. Default: 20.'),
            respectGitignore: z
                .boolean()
                .optional()['describe']('Reserved for compatibility; directory scans use the current indexed rows.'),
            includeDynamic: z.boolean().optional()['describe']('Also validate dynamic import() sources. Default: true.'),
            maxFiles: z
                .number()
                .int()
                .positive()
                .max(5000)
                .optional()['describe']('Maximum files to parse. Default: 500.'),
            maxResults: z.number().int().positive().max(500).optional()['describe']('Maximum returned rows. Default: 50.'),
            cursor: z.string().optional()['describe']('Cursor returned by a previous repo_find_orphan_imports call.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ path, recursive, depth, includeDynamic, maxFiles, maxResults, cursor }) => {
            const resolved = await resolveReadPath(normalizeOptionalRepoPath(path, DEFAULT_ORPHAN_IMPORT_SCAN_PATH), {
                issueReadCapability: true,
            });
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const stat = await statPathValidated(resolved.validatedReadPath);
            const fileLimit = normalizePositiveInteger(maxFiles, DEFAULT_ORPHAN_IMPORT_MAX_FILES, 5000);
            /** @type {{
    file: string;
    line: number;
    source: string;
    dynamic: boolean;
    attemptedTargets: string[];
    resolutionStrategy: string;
}[]} */
            const orphanImports = [];
            /** @type {{ file: string; line: number; source: string; dynamic: boolean; resolutionStrategy: string }[]} */
            const protectedImports = [];
            /** @type {{ file: string; error: string }[]} */
            const parseErrors = [];
            let checkedImports = 0;
            let skippedExternalImports = 0;
            let skippedDynamicImports = 0;
            let aliasResolutionGapCount = 0;
            let scannedEntries = 1;
            let blockedEntries = 0;
            let hardLimitReached = false;
            let scannedFiles = 0;
            let totalCandidateFiles = 1;
            let skippedByDepth = 0;
            const effectiveRecursive = recursive !== false;
            const effectiveDepth = effectiveRecursive ? normalizePositiveInteger(depth, 20, 50) : 1;

            if (stat.stats.isFile()) {
                if (isAnalyzableModuleFile(resolved.resolved)) {
                    scannedFiles = 1;
                    try {
                        const text = await readTextValidated(resolved.validatedReadPath);
                        const parsed = await parseFileForContext(resolved.resolved, text.content, {
                            contentHash: text.contentHash,
                        });
                        for (const importEntry of parsed.symbols.imports) {
                            const source = String(importEntry.source ?? '');
                            const dynamic = importEntry.isDynamic === true;
                            if (dynamic && includeDynamic !== true) {
                                skippedDynamicImports += 1;
                                continue;
                            }
                            if (!isLocalImportSource(source)) {
                                skippedExternalImports += 1;
                                continue;
                            }
                            const resolution = await resolveImportBasePath(source, resolved.resolved);
                            if (!resolution) continue;
                            if (resolution.strategy === 'legacy-copilot-alias') aliasResolutionGapCount += 1;
                            const candidates = buildModuleCandidatePaths(resolution.basePath);
                            checkedImports += 1;
                            const targetState = await classifyCandidateTargets(candidates);
                            if (targetState.status === 'exists') continue;
                            if (targetState.status === 'protected') {
                                blockedEntries += targetState.protectedCandidateCount;
                                protectedImports.push({
                                    file: resolved.relative,
                                    line: Number(importEntry.line ?? 0),
                                    source,
                                    dynamic,
                                    resolutionStrategy: resolution.strategy,
                                });
                                continue;
                            }
                            orphanImports.push({
                                file: resolved.relative,
                                line: Number(importEntry.line ?? 0),
                                source,
                                dynamic,
                                attemptedTargets: candidates.map((candidate) => relative(WORKSPACE_ROOT, candidate)),
                                resolutionStrategy: resolution.strategy,
                            });
                        }
                    } catch (error) {
                        parseErrors.push({
                            file: resolved.relative,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
            } else {
                const indexStats = getIoIndexStats();
                if (!indexStats.available) {
                    return errorResult('MCP IO index is unavailable; build the index before scanning directories.', {
                        code: 'MCP_IO_INDEX_UNAVAILABLE',
                        hint: 'Run repo_index_build for src/copilot or enable the local IO index.',
                        workspaceRoot: getMcpWorkspaceRoot(),
                    });
                }
                const rows = findIoIndexImportsByPath(resolved.resolved);
                const scopedRows = rows.filter((row) => {
                    const depthFromRoot = relativeFileDepth(resolved.resolved, String(row.filePath ?? ''));
                    if (depthFromRoot === null || depthFromRoot > effectiveDepth) {
                        skippedByDepth += 1;
                        return false;
                    }
                    return true;
                });
                totalCandidateFiles = new Set(scopedRows.map((row) => row.filePath)).size;
                scannedEntries = scopedRows.length;
                let currentFilePath = '';
                for (const row of scopedRows) {
                    if (row.filePath !== currentFilePath) {
                        currentFilePath = row.filePath;
                        scannedFiles += 1;
                        if (scannedFiles > fileLimit) {
                            hardLimitReached = true;
                            break;
                        }
                    }
                    const source = String(row.source ?? '');
                    const dynamic = row.isDynamic === 1;
                    if (dynamic && includeDynamic !== true) {
                        skippedDynamicImports += 1;
                        continue;
                    }
                    if (!isLocalImportSource(source)) {
                        skippedExternalImports += 1;
                        continue;
                    }
                    const resolution = await resolveImportBasePath(source, String(row.filePath ?? ''));
                    if (!resolution) continue;
                    if (resolution.strategy === 'legacy-copilot-alias') aliasResolutionGapCount += 1;
                    const candidates = buildModuleCandidatePaths(resolution.basePath);
                    checkedImports += 1;
                    const targetState = await classifyCandidateTargets(candidates);
                    if (targetState.status === 'exists') continue;
                    if (targetState.status === 'protected') {
                        blockedEntries += targetState.protectedCandidateCount;
                        protectedImports.push({
                            file: String(row.relativePath ?? row.filePath),
                            line: Number(row.line ?? 0),
                            source,
                            dynamic,
                            resolutionStrategy: resolution.strategy,
                        });
                        continue;
                    }
                    orphanImports.push({
                        file: String(row.relativePath ?? row.filePath),
                        line: Number(row.line ?? 0),
                        source,
                        dynamic,
                        attemptedTargets: candidates.map((candidate) => relative(WORKSPACE_ROOT, candidate)),
                        resolutionStrategy: resolution.strategy,
                    });
                }
            }
            const window = normalizeSearchWindow({ maxResults, cursor });
            const paged = paginateSearchItems(orphanImports, window);
            const protectedPreview = protectedImports.slice(0, normalizePositiveInteger(maxResults, 50, 500));
            const output = formatOrphanImportRows(paged.items, protectedPreview);
            return okResult(
                {
                    success: true,
                    path: resolved.relative,
                    workspaceRoot: getMcpWorkspaceRoot(),
                    scannedEntries,
                    blockedEntries,
                    scannedFiles,
                    totalCandidateFiles,
                    checkedImports,
                    skippedExternalImports,
                    skippedDynamicImports,
                    skippedByDepth,
                    recursive: stat.stats.isDirectory() ? effectiveRecursive : null,
                    depth: stat.stats.isDirectory() ? effectiveDepth : null,
                    parseErrors,
                    orphanCount: paged.items.length,
                    totalOrphans: paged.totalItems,
                    trueOrphanCount: orphanImports.length,
                    protectedCount: protectedImports.length,
                    aliasResolutionGapCount,
                    truncated:
                        paged.truncated ||
                        hardLimitReached ||
                        protectedImports.length > protectedPreview.length ||
                        (stat.stats.isDirectory() && totalCandidateFiles > fileLimit),
                    nextCursor: paged.nextCursor,
                    cursorOffset: paged.cursorOffset,
                    output,
                    orphans: paged.items,
                    protectedImports: protectedPreview,
                },
                output,
            );
        },
    },
    {
        name: 'repo_index_invalidate',
        title: 'Invalidate repository index path',
        description: 'Invalidate a workspace file or directory in the shared local IO index after edits.',
        inputSchema: {
            path: z.string().min(1)['describe']('Workspace-relative file or directory path to invalidate.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({ path }) => {
            const resolved = await resolveReadPath(path);
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const invalidated = invalidateIoIndexPath(resolved.resolved);
            return okResult({
                success: true,
                path: resolved.relative,
                invalidated,
                stats: getIoIndexStats(),
            });
        },
    },
];
