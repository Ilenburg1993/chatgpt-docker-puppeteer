// @ts-check
/**
 * Controlled workspace write MCP tools.
 *
 * @module copilot/mcp/tools/repo-write
 */

import {
    createOrReplaceFileAtomic,
    deleteFileLocked,
    moveFileLocked,
    patchTextLocked,
    readText,
    writeFileAtomic,
} from '#copilot/infra/public/io';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { boundedWriteAnnotations, destructiveAnnotations } from '../control-plane/annotations.js';
import { appendMcpAuditEvent } from '../control-plane/audit.js';
import { resolveReadPath, resolveWritePath } from '../control-plane/paths.js';
import { errorResult, okResult } from '../control-plane/result.js';

const DEFAULT_DIFF_CONTEXT_LINES = 3;
const DEFAULT_MAX_DIFF_LINES = 160;

/**
 * @param {string} contentA
 * @param {string} contentB
 * @param {{ contextLines?: number; maxLines?: number }} [options]
 * @returns {{ diff: string; truncated: boolean; lines: number; contextLines: number }}
 */
function buildInlineDiffPreview(contentA, contentB, options = {}) {
    const aLines = contentA.split('\n');
    const bLines = contentB.split('\n');
    const max = Math.max(aLines.length, bLines.length);
    const contextLines = Math.max(0, options.contextLines ?? DEFAULT_DIFF_CONTEXT_LINES);
    /** @type {number[]} */
    const changeIndexes = [];
    for (let index = 0; index < max; index++) {
        if (aLines[index] !== bLines[index]) changeIndexes.push(index);
    }
    if (changeIndexes.length === 0) return { diff: '', truncated: false, lines: 0, contextLines };

    /** @type {{ start: number; end: number }[]} */
    const hunks = [];
    for (const index of changeIndexes) {
        const start = Math.max(0, index - contextLines);
        const end = Math.min(max, index + contextLines + 1);
        const last = hunks[hunks.length - 1];
        if (last && start <= last.end) {
            last.end = Math.max(last.end, end);
        } else {
            hunks.push({ start, end });
        }
    }

    /** @type {string[]} */
    const lines = [];
    for (const hunk of hunks) {
        lines.push(`@@ ${hunk.start + 1},${hunk.end - hunk.start} @@`);
        for (let index = hunk.start; index < hunk.end; index++) {
            if (aLines[index] === bLines[index]) {
                if (aLines[index] !== undefined) lines.push(` ${aLines[index]}`);
                continue;
            }
            if (aLines[index] !== undefined) lines.push(`-${aLines[index]}`);
            if (bLines[index] !== undefined) lines.push(`+${bLines[index]}`);
        }
    }

    const maxLines = Math.max(1, options.maxLines ?? DEFAULT_MAX_DIFF_LINES);
    const truncated = lines.length > maxLines;
    const visible = truncated ? lines.slice(0, maxLines) : lines;
    return { diff: visible.join('\n'), truncated, lines: visible.length, contextLines };
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function optionalInteger(value) {
    return Number.isInteger(value) ? /** @type {number} */ (value) : undefined;
}

/**
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function pathExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return false;
        throw error;
    }
}

/**
 * @type {import('../registry.js').McpToolDefinition[]}
 */
export const repoWriteTools = [
    {
        name: 'repo_write_file',
        title: 'Write repository file',
        description:
            'Replace the full content of an existing UTF-8 workspace file. Returns hashes and a unified diff preview.',
        inputSchema: {
            path: z.string().min(1).describe('Workspace-relative existing file path.'),
            content: z.string().describe('Full replacement content.'),
            expectedHash: z.string().optional().describe('Expected SHA-256 of current file content.'),
            dryRun: z.boolean().optional().describe('Return diff and hashes without writing. Default: false.'),
            diffContextLines: z.number().int().min(0).max(20).optional().describe('Context lines in diff preview.'),
            maxDiffLines: z.number().int().min(1).max(500).optional().describe('Maximum diff preview lines.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({ path, content, expectedHash, dryRun, diffContextLines, maxDiffLines }) => {
            const resolved = await resolveWritePath(path);
            if (!resolved.ok) return errorResult(resolved.reason, resolved);

            try {
                const previous = await readText(resolved.resolved);
                const diff = buildInlineDiffPreview(previous.content, content, {
                    contextLines: optionalInteger(diffContextLines) ?? DEFAULT_DIFF_CONTEXT_LINES,
                    maxLines: optionalInteger(maxDiffLines) ?? DEFAULT_MAX_DIFF_LINES,
                });
                if (dryRun === true) {
                    await appendMcpAuditEvent({
                        event: 'repo_write_file_dry_run',
                        tool: 'repo_write_file',
                        path: resolved.relative,
                        previousBytes: previous.bytesRead,
                    });
                    return okResult(
                        {
                            success: true,
                            path: resolved.relative,
                            dryRun: true,
                            bytesWritten: 0,
                            previousBytes: previous.bytesRead,
                            diffPreview: diff.diff,
                            diffPreviewTruncated: diff.truncated,
                            diffPreviewLines: diff.lines,
                            diffContextLines: diff.contextLines,
                        },
                        diff.diff,
                    );
                }

                const write = await writeFileAtomic(resolved.resolved, content, {
                    requireExists: true,
                    ...(typeof expectedHash === 'string' && expectedHash ? { expectedHash } : {}),
                    riskClass: 'high',
                    advisoryLimits: {
                        tool: 'repo_write_file',
                        contentChars: content.length,
                        expectedHash: expectedHash ?? null,
                    },
                });
                await appendMcpAuditEvent({
                    event: 'repo_write_file_applied',
                    tool: 'repo_write_file',
                    path: resolved.relative,
                    previousHash: write.previousHash,
                    contentHash: write.contentHash,
                    bytesWritten: write.bytesWritten,
                    traceId: write.io.traceId ?? null,
                });
                return okResult(
                    {
                        success: true,
                        path: resolved.relative,
                        dryRun: false,
                        bytesWritten: write.bytesWritten,
                        previousBytes: previous.bytesRead,
                        previousHash: write.previousHash,
                        contentHash: write.contentHash,
                        diffPreview: diff.diff,
                        diffPreviewTruncated: diff.truncated,
                        diffPreviewLines: diff.lines,
                        diffContextLines: diff.contextLines,
                        io: {
                            operation: write.io.operation,
                            targetKind: write.io.targetKind,
                            bytesWritten: write.io.bytesWritten,
                            durationMs: write.io.durationMs,
                            engine: write.io.engine,
                            traceId: write.io.traceId ?? null,
                        },
                    },
                    diff.diff,
                );
            } catch (error) {
                return errorResult(error instanceof Error ? error.message : String(error), {
                    path: resolved.relative,
                    code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
                });
            }
        },
    },
    {
        name: 'repo_create_file',
        title: 'Create repository file',
        description:
            'Create a new UTF-8 workspace file. It fails if the file already exists and returns a creation diff preview.',
        inputSchema: {
            path: z.string().min(1).describe('Workspace-relative file path to create.'),
            content: z.string().optional().describe('Initial UTF-8 content. Default: empty string.'),
            createParentDirs: z.boolean().optional().describe('Create parent directories. Default: true.'),
            dryRun: z.boolean().optional().describe('Validate and return diff without writing. Default: false.'),
            maxDiffLines: z.number().int().min(1).max(500).optional().describe('Maximum diff preview lines.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({ path, content, createParentDirs, dryRun, maxDiffLines }) => {
            const resolved = await resolveWritePath(path);
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const initialContent = typeof content === 'string' ? content : '';
            const diff = buildInlineDiffPreview('', initialContent, {
                contextLines: 0,
                maxLines: optionalInteger(maxDiffLines) ?? DEFAULT_MAX_DIFF_LINES,
            });

            try {
                if (dryRun === true) {
                    await appendMcpAuditEvent({
                        event: 'repo_create_file_dry_run',
                        tool: 'repo_create_file',
                        path: resolved.relative,
                    });
                    return okResult(
                        {
                            success: true,
                            path: resolved.relative,
                            dryRun: true,
                            bytesWritten: 0,
                            diffPreview: diff.diff,
                            diffPreviewTruncated: diff.truncated,
                            diffPreviewLines: diff.lines,
                            diffContextLines: diff.contextLines,
                        },
                        diff.diff,
                    );
                }

                const write = await createOrReplaceFileAtomic(resolved.resolved, initialContent, {
                    encoding: 'utf8',
                    createParentDirs: createParentDirs !== false,
                    failIfExists: true,
                    riskClass: 'medium',
                    advisoryLimits: {
                        tool: 'repo_create_file',
                        contentChars: initialContent.length,
                    },
                });
                await appendMcpAuditEvent({
                    event: 'repo_create_file_applied',
                    tool: 'repo_create_file',
                    path: resolved.relative,
                    contentHash: write.contentHash,
                    bytesWritten: write.bytesWritten,
                    traceId: write.io.traceId ?? null,
                });
                return okResult(
                    {
                        success: true,
                        path: resolved.relative,
                        dryRun: false,
                        bytesWritten: write.bytesWritten,
                        previousHash: write.previousHash,
                        contentHash: write.contentHash,
                        diffPreview: diff.diff,
                        diffPreviewTruncated: diff.truncated,
                        diffPreviewLines: diff.lines,
                        diffContextLines: diff.contextLines,
                        io: {
                            operation: write.io.operation,
                            targetKind: write.io.targetKind,
                            bytesWritten: write.io.bytesWritten,
                            durationMs: write.io.durationMs,
                            engine: write.io.engine,
                            traceId: write.io.traceId ?? null,
                        },
                    },
                    diff.diff,
                );
            } catch (error) {
                return errorResult(error instanceof Error ? error.message : String(error), {
                    path: resolved.relative,
                    code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
                });
            }
        },
    },
    {
        name: 'repo_apply_patch',
        title: 'Apply repository patch',
        description:
            'Apply a controlled exact-string patch to one workspace file. Returns hashes, line/byte deltas and a unified diff preview.',
        inputSchema: {
            path: z.string().min(1).describe('Workspace-relative file path.'),
            old_string: z.string().min(1).describe('Exact text to replace. It must match once by default.'),
            new_string: z.string().describe('Replacement text. Use an empty string to delete matched text.'),
            replace_all: z.boolean().optional().describe('Replace every occurrence of old_string. Default: false.'),
            expected_occurrences: z
                .number()
                .int()
                .min(1)
                .optional()
                .describe('Require an exact occurrence count before applying.'),
            occurrence_index: z
                .number()
                .int()
                .min(1)
                .optional()
                .describe('1-based occurrence index to replace when old_string appears more than once.'),
            expectedHash: z.string().optional().describe('Expected SHA-256 of current file content.'),
            dryRun: z.boolean().optional().describe('Validate and return diff without writing. Default: false.'),
            allowNoop: z.boolean().optional().describe('Allow old_string and new_string to be identical. Default: false.'),
            diffContextLines: z.number().int().min(0).max(20).optional().describe('Context lines in diff preview.'),
            maxDiffLines: z.number().int().min(1).max(500).optional().describe('Maximum diff preview lines.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({
            path,
            old_string,
            new_string,
            replace_all,
            expected_occurrences,
            occurrence_index,
            expectedHash,
            dryRun,
            allowNoop,
            diffContextLines,
            maxDiffLines,
        }) => {
            const resolved = await resolveWritePath(path);
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            if (replace_all === true && occurrence_index !== undefined) {
                return errorResult('Use replace_all ou occurrence_index, nao ambos na mesma chamada.', {
                    code: 'ERR_PATCH_CONFLICTING_MODE',
                });
            }

            try {
                const patch = await patchTextLocked(resolved.resolved, {
                    oldString: old_string,
                    newString: new_string,
                    replaceAll: replace_all === true,
                    ...(optionalInteger(expected_occurrences) !== undefined
                        ? { expectedOccurrences: /** @type {number} */ (optionalInteger(expected_occurrences)) }
                        : {}),
                    ...(optionalInteger(occurrence_index) !== undefined
                        ? { occurrenceIndex: /** @type {number} */ (optionalInteger(occurrence_index)) }
                        : {}),
                    ...(typeof expectedHash === 'string' && expectedHash ? { expectedHash } : {}),
                    dryRun: dryRun === true,
                    allowNoop: allowNoop === true,
                    diffContextLines: optionalInteger(diffContextLines) ?? 3,
                    maxDiffLines: optionalInteger(maxDiffLines) ?? 160,
                    advisoryLimits: {
                        tool: 'repo_apply_patch',
                        oldStringChars: old_string.length,
                        newStringChars: new_string.length,
                        replaceAll: replace_all === true,
                        occurrenceIndex: occurrence_index ?? null,
                        expectedHash: expectedHash ?? null,
                        dryRun: dryRun === true,
                    },
                });
                await appendMcpAuditEvent({
                    event: patch.dryRun ? 'repo_patch_dry_run' : 'repo_patch_applied',
                    tool: 'repo_apply_patch',
                    path: resolved.relative,
                    occurrences: patch.occurrences,
                    replacedOccurrences: patch.replacedOccurrences,
                    previousHash: patch.previousHash,
                    contentHash: patch.contentHash,
                    traceId: patch.io.traceId ?? null,
                });
                const structured = {
                    success: true,
                    path: resolved.relative,
                    dryRun: patch.dryRun,
                    occurrences: patch.occurrences,
                    replacedOccurrences: patch.replacedOccurrences,
                    previousBytes: patch.previousBytes,
                    projectedBytes: patch.projectedBytes,
                    bytesWritten: patch.bytesWritten,
                    byteDelta: patch.byteDelta,
                    firstMatchLine: patch.firstMatchLine,
                    lastMatchLine: patch.lastMatchLine,
                    lineDelta: patch.lineDelta,
                    occurrenceIndex: patch.occurrenceIndex,
                    noop: patch.noop,
                    previousHash: patch.previousHash,
                    contentHash: patch.contentHash,
                    diffPreview: patch.diffPreview,
                    diffPreviewTruncated: patch.diffPreviewTruncated,
                    diffPreviewLines: patch.diffPreviewLines,
                    diffPreviewBytes: patch.diffPreviewBytes,
                    diffContextLines: patch.diffContextLines,
                    io: {
                        operation: patch.io.operation,
                        targetKind: patch.io.targetKind,
                        bytesWritten: patch.io.bytesWritten,
                        durationMs: patch.io.durationMs,
                        engine: patch.io.engine,
                        traceId: patch.io.traceId ?? null,
                    },
                };
                return okResult(structured, patch.diffPreview);
            } catch (error) {
                return errorResult(error instanceof Error ? error.message : String(error), {
                    path: resolved.relative,
                    code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
                });
            }
        },
    },
    {
        name: 'repo_move_file',
        title: 'Move repository file',
        description:
            'Move or rename one workspace file. Destination overwrite is disabled unless overwrite and confirmOverwrite are both true.',
        inputSchema: {
            source: z.string().min(1).describe('Workspace-relative existing source file.'),
            destination: z.string().min(1).describe('Workspace-relative destination path.'),
            overwrite: z.boolean().optional().describe('Overwrite destination if it exists. Default: false.'),
            confirmOverwrite: z
                .boolean()
                .optional()
                .describe('Must be true when overwrite is true because destination replacement is destructive.'),
            dryRun: z.boolean().optional().describe('Validate without moving. Default: false.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({ source, destination, overwrite, confirmOverwrite, dryRun }) => {
            const src = await resolveReadPath(source);
            if (!src.ok) return errorResult(src.reason, { ...src, field: 'source' });
            const dst = await resolveWritePath(destination);
            if (!dst.ok) return errorResult(dst.reason, { ...dst, field: 'destination' });
            if (overwrite === true && confirmOverwrite !== true) {
                return errorResult('confirmOverwrite deve ser true quando overwrite=true.', {
                    code: 'ERR_MOVE_CONFIRM_OVERWRITE_REQUIRED',
                });
            }

            try {
                const sourceStats = await fs.stat(src.resolved);
                const destinationExists = await pathExists(dst.resolved);
                if (destinationExists && overwrite !== true) {
                    return errorResult(`Destino ja existe: ${dst.relative}`, { code: 'EEXIST' });
                }
                if (dryRun === true) {
                    await appendMcpAuditEvent({
                        event: 'repo_move_file_dry_run',
                        tool: 'repo_move_file',
                        source: src.relative,
                        destination: dst.relative,
                        overwrite: overwrite === true,
                    });
                    return okResult({
                        success: true,
                        dryRun: true,
                        source: src.relative,
                        destination: dst.relative,
                        sourceBytes: sourceStats.size,
                        destinationExists,
                        overwrite: overwrite === true,
                    });
                }

                const moved = await moveFileLocked(src.resolved, dst.resolved, { overwrite: overwrite === true });
                await appendMcpAuditEvent({
                    event: 'repo_move_file_applied',
                    tool: 'repo_move_file',
                    source: src.relative,
                    destination: dst.relative,
                    overwrite: overwrite === true,
                    sourceHash: moved.sourceHash,
                    destinationPreviousHash: moved.destinationPreviousHash,
                    traceId: moved.io.traceId ?? null,
                });
                return okResult({
                    success: true,
                    dryRun: false,
                    source: src.relative,
                    destination: dst.relative,
                    sourceBytes: moved.sourceBytes,
                    sourceHash: moved.sourceHash,
                    destinationPreviousHash: moved.destinationPreviousHash,
                    destinationPreviousBytes: moved.destinationPreviousBytes,
                    destinationPreviousSnapshotTruncated: moved.destinationPreviousSnapshotTruncated,
                    overwrite: overwrite === true,
                    io: {
                        operation: moved.io.operation,
                        targetKind: moved.io.targetKind,
                        bytesRead: moved.io.bytesRead,
                        durationMs: moved.io.durationMs,
                        engine: moved.io.engine,
                        traceId: moved.io.traceId ?? null,
                    },
                });
            } catch (error) {
                return errorResult(error instanceof Error ? error.message : String(error), {
                    source: src.relative,
                    destination: dst.relative,
                    code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
                });
            }
        },
    },
    {
        name: 'repo_remove_file',
        title: 'Remove repository file',
        description: 'Delete one workspace file. Requires confirm=true and returns rollback snapshot metadata.',
        inputSchema: {
            path: z.string().min(1).describe('Workspace-relative file path to delete.'),
            confirm: z.boolean().optional().describe('Must be true to delete.'),
            dryRun: z.boolean().optional().describe('Validate without deleting. Default: false.'),
        },
        annotations: destructiveAnnotations(),
        handler: async ({ path, confirm, dryRun }) => {
            const resolved = await resolveWritePath(path);
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            if (confirm !== true) {
                return errorResult('confirm deve ser true para remover arquivo.', {
                    code: 'ERR_REMOVE_CONFIRM_REQUIRED',
                });
            }

            try {
                const stats = await fs.stat(resolved.resolved);
                if (!stats.isFile()) {
                    return errorResult('repo_remove_file remove somente arquivos regulares.', {
                        path: resolved.relative,
                        code: 'ERR_REMOVE_NOT_FILE',
                    });
                }
                if (dryRun === true) {
                    await appendMcpAuditEvent({
                        event: 'repo_remove_file_dry_run',
                        tool: 'repo_remove_file',
                        path: resolved.relative,
                        previousBytes: stats.size,
                    });
                    return okResult({
                        success: true,
                        dryRun: true,
                        path: resolved.relative,
                        previousBytes: stats.size,
                    });
                }

                const removed = await deleteFileLocked(resolved.resolved);
                await appendMcpAuditEvent({
                    event: 'repo_remove_file_applied',
                    tool: 'repo_remove_file',
                    path: resolved.relative,
                    previousHash: removed.previousHash,
                    previousBytes: removed.previousBytes,
                    previousSnapshotTruncated: removed.previousSnapshotTruncated,
                    traceId: removed.io.traceId ?? null,
                });
                return okResult({
                    success: true,
                    dryRun: false,
                    path: resolved.relative,
                    deleted: removed.deleted,
                    previousHash: removed.previousHash,
                    previousBytes: removed.previousBytes,
                    rollbackSnapshotAvailable: typeof removed.previousSnapshotBase64 === 'string',
                    previousSnapshotTruncated: removed.previousSnapshotTruncated,
                    io: {
                        operation: removed.io.operation,
                        targetKind: removed.io.targetKind,
                        bytesRead: removed.io.bytesRead,
                        durationMs: removed.io.durationMs,
                        engine: removed.io.engine,
                        traceId: removed.io.traceId ?? null,
                    },
                });
            } catch (error) {
                return errorResult(error instanceof Error ? error.message : String(error), {
                    path: resolved.relative,
                    code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
                });
            }
        },
    },
];
