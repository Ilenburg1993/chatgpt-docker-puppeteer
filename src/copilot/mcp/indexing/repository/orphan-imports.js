// @ts-check
/**
 * Local-module graph audit over the repository index.
 *
 * Resolves relative and package-import aliases, distinguishes protected targets from true missing targets, and keeps
 * target-existence memoization scoped to one audit call.
 *
 * @module copilot/mcp/indexing/repository/orphan-imports
 */

import {
    createLocalModuleResolver,
    isLocalModuleSource,
    LOCAL_MODULE_FILE_EXTENSIONS,
} from '#copilot/infra/public/indexing/module-resolution';
import { normalizeSearchWindow, paginateSearchItems } from '#copilot/infra/public/indexing/search';
import { extname, relative } from 'node:path';
import { normalizeRepositoryIndexPath } from './runtime.js';

const DEFAULT_ORPHAN_IMPORT_SCAN_PATH = 'src/copilot';
const DEFAULT_ORPHAN_IMPORT_MAX_FILES = 500;

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
    return LOCAL_MODULE_FILE_EXTENSIONS.includes(extname(filePath).toLowerCase());
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
    const moduleResolver = await createLocalModuleResolver({ workspaceRoot: workspace.workspaceRoot });
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
                    if (!isLocalModuleSource(source)) {
                        skippedExternalImports += 1;
                        continue;
                    }
                    const resolution = moduleResolver.resolve(resolved.resolved, source);
                    if (!resolution.resolved) {
                        aliasResolutionGapCount += 1;
                        continue;
                    }
                    if (resolution.strategy === 'legacy-copilot-alias') aliasResolutionGapCount += 1;
                    const candidates = resolution.candidates;
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
            if (!isLocalModuleSource(source)) {
                skippedExternalImports += 1;
                continue;
            }
            const resolution = moduleResolver.resolve(String(row.filePath ?? ''), source);
            if (!resolution.resolved) {
                aliasResolutionGapCount += 1;
                continue;
            }
            if (resolution.strategy === 'legacy-copilot-alias') aliasResolutionGapCount += 1;
            const candidates = resolution.candidates;
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
