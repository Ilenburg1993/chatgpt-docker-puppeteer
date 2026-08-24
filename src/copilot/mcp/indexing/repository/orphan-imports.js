// @ts-check
/**
 * Local-module graph audit over the repository index.
 *
 * Resolves relative and package-import aliases, distinguishes protected targets from true missing targets, and keeps
 * target-existence memoization scoped to one audit call.
 *
 * @module copilot/mcp/indexing/repository/orphan-imports
 */

import { normalizeSearchWindow, paginateSearchItems } from '#copilot/infra/public/indexing/search';
import { dirname, extname, join, relative, resolve as resolvePath } from 'node:path';
import { normalizeRepositoryIndexPath } from './runtime.js';

const DEFAULT_ORPHAN_IMPORT_SCAN_PATH = 'src/copilot';
const DEFAULT_ORPHAN_IMPORT_MAX_FILES = 500;
const MODULE_FILE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json'];
const MODULE_INDEX_CANDIDATES = MODULE_FILE_EXTENSIONS.map((extension) => `index${extension}`);
const LOCAL_IMPORT_ALIAS_PREFIXES = ['#copilot'];
const PACKAGE_JSON_RELATIVE_PATH = 'package.json';
const PACKAGE_IMPORTS_CACHE_TTL_MS = 30_000;

/** @type {Promise<[string, unknown][]> | null} */
let packageImportEntriesPromise = null;
let packageImportEntriesExpiresAtMs = 0;
let packageImportEntriesWorkspaceRoot = '';

/** @typedef {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} RepositoryIndexWorkspace */
/**
 * @typedef {{ ok: true; structured: Record<string, unknown>; text?: string } |
 *           { ok: false; message: string; details: Record<string, unknown> }} RepositoryIndexOperationResult
 */

/** @param {Record<string, unknown>} structured @param {string} [text] @returns {RepositoryIndexOperationResult} */
function success(structured, text) {
    return text === undefined ? { ok: true, structured } : { ok: true, structured, text };
}

/** @param {string} message @param {Record<string, unknown>} [details] @returns {RepositoryIndexOperationResult} */
function failure(message, details = {}) {
    return { ok: false, message, details };
}

/** @param {unknown} value @param {number} fallback @param {number} max */
function normalizePositiveInteger(value, fallback, max) {
    const parsed = Number(value ?? fallback);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

/** @param {string} rootPath @param {string} filePath */
function relativeFileDepth(rootPath, filePath) {
    const rel = relative(rootPath, filePath).replace(/\\/g, '/');
    if (!rel || rel === '.' || rel.startsWith('../') || rel === '..') return null;
    return rel.split('/').filter(Boolean).length;
}

/** @param {string} filePath */
function isAnalyzableModuleFile(filePath) {
    return MODULE_FILE_EXTENSIONS.includes(extname(filePath).toLowerCase());
}

/** @param {string} source */
function isLocalImportSource(source) {
    return (
        source.startsWith('.') ||
        LOCAL_IMPORT_ALIAS_PREFIXES.some((prefix) => source === prefix || source.startsWith(`${prefix}/`))
    );
}

/** @param {unknown} value @returns {string | null} */
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

/** @param {RepositoryIndexWorkspace} workspace */
async function readPackageImportEntries(workspace) {
    const now = Date.now();
    if (
        !packageImportEntriesPromise ||
        packageImportEntriesWorkspaceRoot !== workspace.workspaceRoot ||
        now >= packageImportEntriesExpiresAtMs
    ) {
        packageImportEntriesWorkspaceRoot = workspace.workspaceRoot;
        packageImportEntriesExpiresAtMs = now + PACKAGE_IMPORTS_CACHE_TTL_MS;
        packageImportEntriesPromise = workspace.io
            .readText(join(workspace.workspaceRoot, PACKAGE_JSON_RELATIVE_PATH))
            .then((text) => {
                const parsed = JSON.parse(text.content);
                const imports = parsed && typeof parsed === 'object' ? parsed.imports : null;
                return imports && typeof imports === 'object' ? Object.entries(imports) : [];
            })
            .catch(() => []);
    }
    return packageImportEntriesPromise ?? [];
}

/** @param {RepositoryIndexWorkspace} workspace @param {string} source @param {[string, unknown][]} entries */
function resolvePackageImportBasePath(workspace, source, entries) {
    const exact = entries.find(([key]) => key === source);
    if (exact) {
        const target = selectPackageImportTarget(exact[1]);
        if (target?.startsWith('./'))
            return { basePath: resolvePath(workspace.workspaceRoot, target), strategy: 'package-import-exact' };
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
        return { basePath: resolvePath(workspace.workspaceRoot, substituted), strategy: 'package-import-wildcard' };
    }
    return null;
}

/** @param {RepositoryIndexWorkspace} workspace @param {string} source @param {string} importerPath */
async function resolveImportBasePath(workspace, source, importerPath) {
    if (source.startsWith('.')) return { basePath: resolvePath(dirname(importerPath), source), strategy: 'relative' };
    if (source.startsWith('#')) {
        const mapped = resolvePackageImportBasePath(workspace, source, await readPackageImportEntries(workspace));
        if (mapped) return mapped;
    }
    if (source === '#copilot')
        return { basePath: join(workspace.workspaceRoot, 'src/copilot'), strategy: 'legacy-copilot-alias' };
    if (source.startsWith('#copilot/')) {
        return {
            basePath: join(workspace.workspaceRoot, 'src/copilot', source.slice('#copilot/'.length)),
            strategy: 'legacy-copilot-alias',
        };
    }
    return null;
}

/** @param {string} basePath */
function buildModuleCandidatePaths(basePath) {
    const candidates = new Set([basePath]);
    if (extname(basePath) === '') {
        for (const extension of MODULE_FILE_EXTENSIONS) candidates.add(`${basePath}${extension}`);
        for (const fileName of MODULE_INDEX_CANDIDATES) candidates.add(join(basePath, fileName));
    }
    return [...candidates];
}

/** @param {RepositoryIndexWorkspace} workspace @param {string} filePath */
async function fileExists(workspace, filePath) {
    try {
        const result = await workspace.io.statPath(filePath);
        return result.stats.isFile();
    } catch {
        return false;
    }
}

/**
 * @param {RepositoryIndexWorkspace} workspace
 * @param {Map<string, boolean>} targetExistsMemo
 * @param {string[]} candidates
 */
async function classifyCandidateTargets(workspace, targetExistsMemo, candidates) {
    let protectedCandidateCount = 0;
    for (const candidate of candidates) {
        const workspaceRelativeCandidate = relative(workspace.workspaceRoot, candidate);
        const policy = await workspace.resolveValidatedReadPath(workspaceRelativeCandidate);
        if (!policy.ok) {
            if (policy.code === 'ERR_PATH_DENIED') protectedCandidateCount += 1;
            continue;
        }
        let exists = targetExistsMemo.get(candidate);
        if (exists === undefined) {
            exists = await fileExists(workspace, candidate);
            targetExistsMemo.set(candidate, exists);
        }
        if (exists) return { status: 'exists', protectedCandidateCount };
    }
    return { status: protectedCandidateCount > 0 ? 'protected' : 'missing', protectedCandidateCount };
}

/**
 * @param {{ file: string; line: number; source: string; dynamic: boolean; attemptedTargets: string[]; resolutionStrategy: string }[]} rows
 * @param {{ file: string; line: number; source: string; dynamic: boolean; resolutionStrategy: string }[]} protectedRows
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
 * @param {RepositoryIndexWorkspace} workspace
 * @param {{ path?: string | undefined; recursive?: boolean | undefined; depth?: number | undefined; includeDynamic?: boolean | undefined; maxFiles?: number | undefined; maxResults?: number | undefined; cursor?: string | undefined }} input
 * @returns {Promise<RepositoryIndexOperationResult>}
 */
export async function auditRepositoryOrphanImports(workspace, input) {
    const targetExistsMemo = new Map();
    const resolved = await workspace.resolveValidatedReadPath(
        normalizeRepositoryIndexPath(input.path, DEFAULT_ORPHAN_IMPORT_SCAN_PATH),
    );
    if (!resolved.ok) return failure(resolved.reason, resolved);
    const stat = await workspace.io.statPathValidated(resolved.validatedReadPath);
    const fileLimit = normalizePositiveInteger(input.maxFiles, DEFAULT_ORPHAN_IMPORT_MAX_FILES, 5000);
    /** @type {{ file: string; line: number; source: string; dynamic: boolean; attemptedTargets: string[]; resolutionStrategy: string }[]} */
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
    const effectiveRecursive = input.recursive !== false;
    const effectiveDepth = effectiveRecursive ? normalizePositiveInteger(input.depth, 20, 50) : 1;

    if (stat.stats.isFile()) {
        if (isAnalyzableModuleFile(resolved.resolved)) {
            scannedFiles = 1;
            try {
                const text = await workspace.io.readTextValidated(resolved.validatedReadPath);
                const parsed = await workspace.indexing.parseFileForContext(resolved.resolved, text.content, {
                    ...(typeof text.contentHash === 'string' ? { contentHash: text.contentHash } : {}),
                });
                for (const importEntry of parsed.symbols.imports) {
                    const source = String(importEntry.source ?? '');
                    const dynamic = importEntry.isDynamic === true;
                    if (dynamic && input.includeDynamic !== true) {
                        skippedDynamicImports += 1;
                        continue;
                    }
                    if (!isLocalImportSource(source)) {
                        skippedExternalImports += 1;
                        continue;
                    }
                    const resolution = await resolveImportBasePath(workspace, source, resolved.resolved);
                    if (!resolution) continue;
                    if (resolution.strategy === 'legacy-copilot-alias') aliasResolutionGapCount += 1;
                    const candidates = buildModuleCandidatePaths(resolution.basePath);
                    checkedImports += 1;
                    const targetState = await classifyCandidateTargets(workspace, targetExistsMemo, candidates);
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
                        attemptedTargets: candidates.map((candidate) => relative(workspace.workspaceRoot, candidate)),
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
        const indexStats = workspace.indexRegistry.status();
        if (!indexStats.available) {
            return failure('MCP IO index is unavailable; build the index before scanning directories.', {
                code: 'MCP_IO_INDEX_UNAVAILABLE',
                hint: 'Run repo_index_build for src/copilot or enable the local IO index.',
                workspaceRoot: workspace.workspaceRoot,
            });
        }
        const rows = workspace.indexRegistry.findImportsByPath(resolved.resolved);
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
            if (dynamic && input.includeDynamic !== true) {
                skippedDynamicImports += 1;
                continue;
            }
            if (!isLocalImportSource(source)) {
                skippedExternalImports += 1;
                continue;
            }
            const resolution = await resolveImportBasePath(workspace, source, String(row.filePath ?? ''));
            if (!resolution) continue;
            if (resolution.strategy === 'legacy-copilot-alias') aliasResolutionGapCount += 1;
            const candidates = buildModuleCandidatePaths(resolution.basePath);
            checkedImports += 1;
            const targetState = await classifyCandidateTargets(workspace, targetExistsMemo, candidates);
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
                attemptedTargets: candidates.map((candidate) => relative(workspace.workspaceRoot, candidate)),
                resolutionStrategy: resolution.strategy,
            });
        }
    }

    const window = normalizeSearchWindow({
        ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });
    const paged = paginateSearchItems(orphanImports, window);
    const protectedPreview = protectedImports.slice(0, normalizePositiveInteger(input.maxResults, 50, 500));
    const output = formatOrphanImportRows(paged.items, protectedPreview);
    return success(
        {
            success: true,
            path: resolved.relative,
            workspaceRoot: workspace.workspaceRoot,
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
}
