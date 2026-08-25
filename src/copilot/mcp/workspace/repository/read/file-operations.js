// @ts-check
/**
 * Validated repository file read/stat/chunk/diff operations.
 *
 * Protocol-neutral: MCP schemas, batching and CallToolResult framing belong to the wire adapter.
 *
 * @module copilot/mcp/workspace/repository/read/file-operations
 */

import {
    readRepoFileChunksWithValidatedResultCache,
    readRepoFileWithValidatedResultCache,
} from '#copilot/mcp/public/workspace/repository/read-cache';

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

/**
 * @param {Record<string, unknown>} structured
 * @param {'full' | 'returned' | 'none'} hashMode
 */
function applyRepositoryReadHashMode(structured, hashMode) {
    if (hashMode === 'full') return structured;
    const output = { ...structured, hashMode };
    Reflect.deleteProperty(output, 'sha256');
    if (hashMode === 'none') Reflect.deleteProperty(output, 'returnedSha256');
    return output;
}

/**
 * @param {RepositoryReadWorkspace} workspace
 * @param {{ path?: string | undefined; startLine?: number | undefined; endLine?: number | undefined; hashMode?: 'full' | 'returned' | 'none' | undefined }} input
 * @param {import('#copilot/mcp/public/workspace/repository/read-cache').McpRepoReadCacheConfig} cacheConfig
 * @returns {Promise<RepositoryReadOperationResult>}
 */
export async function readRepositoryFile(workspace, input, cacheConfig) {
    const resolved = await workspace.resolveValidatedReadPath(input.path ?? '');
    if (!resolved.ok) return failure(resolved.reason, resolved);
    if (input.startLine !== undefined && input.endLine !== undefined && input.endLine < input.startLine) {
        return failure('endLine must be greater than or equal to startLine.', {
            code: 'ERR_INVALID_LINE_RANGE',
            hint: 'Use endLine greater than or equal to startLine, or omit endLine.',
        });
    }
    const effectiveHashMode = input.hashMode ?? 'full';
    const { structured, text } = await readRepoFileWithValidatedResultCache(
        workspace.io,
        resolved,
        input.startLine,
        input.endLine,
        cacheConfig,
        effectiveHashMode,
    );
    return success(applyRepositoryReadHashMode(structured, effectiveHashMode), text);
}

/**
 * @param {RepositoryReadWorkspace} workspace
 * @param {{ path: string; includeHash?: boolean; maxHashBytes?: number }} input
 * @returns {Promise<RepositoryReadOperationResult>}
 */
export async function readRepositoryFileStats(workspace, input) {
    const resolved = await workspace.resolveValidatedReadPath(input.path);
    if (!resolved.ok) return failure(resolved.reason, resolved);
    const statSnapshot = await workspace.io.statPathValidated(resolved.validatedReadPath);
    const stats = statSnapshot.stats;
    const isFile = stats.isFile();
    const effectiveMaxHashBytes = input.maxHashBytes ?? 5 * 1024 * 1024;
    const shouldHash = input.includeHash === true && isFile && stats.size <= effectiveMaxHashBytes;
    const bytes = shouldHash ? await workspace.io.readBytesValidated(resolved.validatedReadPath) : null;
    return success({
        success: true,
        path: resolved.relative,
        absolutePath: resolved.resolved,
        type: stats.isDirectory() ? 'directory' : isFile ? 'file' : 'other',
        sizeBytes: stats.size,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
        birthtimeMs: stats.birthtimeMs,
        mtimeIso: stats.mtime.toISOString(),
        ctimeIso: stats.ctime.toISOString(),
        birthtimeIso: stats.birthtime.toISOString(),
        sha256: bytes?.contentHash ?? null,
        hashComputed: Boolean(bytes),
        hashSkippedReason: shouldHash
            ? null
            : input.includeHash === true && !isFile
              ? 'not-a-file'
              : input.includeHash === true && stats.size > effectiveMaxHashBytes
                ? 'file-too-large'
                : 'hash-not-requested',
        maxHashBytes: effectiveMaxHashBytes,
        engine: bytes?.io.engine ?? statSnapshot.io.engine,
    });
}

/**
 * @param {RepositoryReadWorkspace} workspace
 * @param {{ path: string; startLine?: number; endLine?: number; chunkLines?: number; cursor?: string; highWaterMark?: number }} input
 * @param {import('#copilot/mcp/public/workspace/repository/read-cache').McpRepoReadCacheConfig} cacheConfig
 * @returns {Promise<RepositoryReadOperationResult>}
 */
export async function readRepositoryFileChunks(workspace, input, cacheConfig) {
    const resolved = await workspace.resolveValidatedReadPath(input.path);
    if (!resolved.ok) return failure(resolved.reason, resolved);
    const parsedCursorLine = input.cursor !== undefined ? Number.parseInt(input.cursor, 10) : null;
    if (parsedCursorLine !== null && (!Number.isFinite(parsedCursorLine) || parsedCursorLine < 1)) {
        return failure('cursor must be a positive line number string.', {
            code: 'ERR_INVALID_CURSOR',
            hint: 'Pass the nextCursor returned by repo_read_file_chunks, or omit cursor.',
        });
    }
    const effectiveStartLine = parsedCursorLine ?? input.startLine ?? 1;
    if (input.endLine !== undefined && input.endLine < effectiveStartLine) {
        return failure('endLine must be greater than or equal to the effective start line.', {
            code: 'ERR_INVALID_LINE_RANGE',
            hint: 'Use endLine greater than or equal to cursor/startLine, or omit endLine.',
        });
    }
    const { structured, text } = await readRepoFileChunksWithValidatedResultCache(
        workspace.io,
        resolved,
        effectiveStartLine,
        input.endLine,
        input.chunkLines ?? 200,
        input.highWaterMark,
        input.cursor,
        cacheConfig,
    );
    return success(structured, text);
}

/**
 * @param {RepositoryReadWorkspace} workspace
 * @param {{ pathA: string; pathB: string; contextLines?: number; includeDiffPreview?: boolean }} input
 * @returns {Promise<RepositoryReadOperationResult>}
 */
export async function diffRepositoryFiles(workspace, input) {
    const resolvedA = await workspace.resolveValidatedReadPath(input.pathA);
    if (!resolvedA.ok) return failure(`pathA: ${resolvedA.reason}`, { ...resolvedA, field: 'pathA' });
    const resolvedB = await workspace.resolveValidatedReadPath(input.pathB);
    if (!resolvedB.ok) return failure(`pathB: ${resolvedB.reason}`, { ...resolvedB, field: 'pathB' });
    const diff = await workspace.io.diffTextValidated(resolvedA.validatedReadPath, resolvedB.validatedReadPath, {
        contextLines: input.contextLines ?? 3,
    });
    const text = input.includeDiffPreview === true ? diff.diff : 'Diff computed; textual diff suppressed.';
    return success(
        {
            success: true,
            pathA: resolvedA.relative,
            pathB: resolvedB.relative,
            identical: diff.identical,
            diffPreviewSuppressed: input.includeDiffPreview !== true,
            diffPreviewAvailable: !diff.identical,
            ...(input.includeDiffPreview === true ? { diff: diff.diff } : {}),
            engine: diff.io.engine,
            contextLines: input.contextLines ?? 3,
        },
        text,
    );
}
