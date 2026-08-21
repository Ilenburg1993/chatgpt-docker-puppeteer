// @ts-check
/**
 * Read-only plan tools for sensitive repo operations.
 *
 * @module copilot/mcp/tools/repo-plan
 */

import {
    errorResult,
    getMcpWorkspaceIndexRegistry,
    getMcpWorkspaceIo,
    getMcpWorkspaceRoot,
    okResult,
    readOnlyAnnotations,
    resolveFocusedUnitTestCommand,
    resolveReadPath,
    resolveValidatedReadPath,
    resolveValidatorCommand,
    resolveWritePath,
} from '#copilot/mcp/control-plane';
import { WORKSPACE_ROOT } from '#copilot/tools';
import { z } from 'zod';

const INDEX_REGISTRY = getMcpWorkspaceIndexRegistry();
const readIoIndexStatus = INDEX_REGISTRY.status;

const { readTextValidated, statPath } = getMcpWorkspaceIo();

const DEFAULT_DIFF_CONTEXT_LINES = 3;
const DEFAULT_MAX_DIFF_LINES = 160;

/**
 * @param {string} contentA
 * @param {string} contentB
 * @param {{ contextLines?: number; maxLines?: number }} [options]
 * @returns {{ diff: string; truncated: boolean; lines: number; contextLines: number }}
 */
function buildPlanDiffPreview(contentA, contentB, options = {}) {
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
        if (last && start <= last.end) last.end = Math.max(last.end, end);
        else hunks.push({ start, end });
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
 * @param {boolean | undefined} include
 * @param {{ diff: string; truncated: boolean; lines: number; contextLines: number }} diff
 * @returns {Record<string, unknown>}
 */
function maybePlanDiffPreview(include, diff) {
    return include === true
        ? {
              diffPreview: diff.diff,
              diffPreviewTruncated: diff.truncated,
              diffPreviewLines: diff.lines,
              diffContextLines: diff.contextLines,
          }
        : {
              diffPreviewSuppressed: true,
              diffPreviewAvailable: diff.lines > 0,
              diffPreviewLines: diff.lines,
              diffContextLines: diff.contextLines,
          };
}

/**
 * @param {string} haystack
 * @param {string} needle
 * @returns {number}
 */
function countOccurrences(haystack, needle) {
    if (!needle) return 0;
    let count = 0;
    let offset = 0;
    while (true) {
        const found = haystack.indexOf(needle, offset);
        if (found === -1) return count;
        count += 1;
        offset = found + needle.length;
    }
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function optionalInteger(value) {
    return Number.isInteger(value) ? /** @type {number} */ (value) : undefined;
}

/**
 * @param {string} absolutePath
 * @returns {Promise<boolean>}
 */
async function pathExists(absolutePath) {
    try {
        await statPath(absolutePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * @type {import('../registry.js').McpToolDefinition[]}
 */
export const repoPlanTools = [
    {
        name: 'repo_create_file_plan',
        title: 'Plan repository file creation',
        description: 'Read-only plan for creating a UTF-8 workspace file. Does not create or modify files.',
        inputSchema: {
            path: z.string().min(1)['describe']('Workspace-relative file path to plan.'),
            content: z.string().optional()['describe']('Planned initial content. Default: empty string.'),
            maxDiffLines: z.number().int().min(1).max(2000).optional()['describe']('Maximum diff preview lines.'),
            includeDiffPreview: z
                .boolean()
                .optional()
                ['describe']('Include textual diffPreview in the tool result. Default: false.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ path, content, maxDiffLines, includeDiffPreview }) => {
            const resolved = await resolveWritePath(path);
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const initialContent = typeof content === 'string' ? content : '';
            const diff = buildPlanDiffPreview('', initialContent, {
                contextLines: 0,
                maxLines: optionalInteger(maxDiffLines) ?? DEFAULT_MAX_DIFF_LINES,
            });
            const destinationExists = await pathExists(resolved.resolved);
            return okResult(
                {
                    success: true,
                    plannedTool: 'repo_create_file',
                    path: resolved.relative,
                    destinationExists,
                    contentChars: initialContent.length,
                    ...maybePlanDiffPreview(includeDiffPreview, diff),
                    nextCall: {
                        tool: 'repo_create_file',
                        args: { path: resolved.relative, content: initialContent },
                    },
                },
                includeDiffPreview === true ? diff.diff : 'Create file plan ready; diff preview suppressed.',
            );
        },
    },
    {
        name: 'repo_patch_plan',
        title: 'Plan repository patch',
        description: 'Read-only exact-string patch plan for one workspace file. Does not modify files.',
        inputSchema: {
            path: z.string().min(1)['describe']('Workspace-relative file path.'),
            old_string: z.string().min(1)['describe']('Exact text to replace.'),
            new_string: z.string()['describe']('Replacement text.'),
            replace_all: z.boolean().optional()['describe']('Plan replacing every occurrence. Default: false.'),
            diffContextLines: z.number().int().min(0).max(20).optional()['describe']('Context lines in diff preview.'),
            maxDiffLines: z.number().int().min(1).max(2000).optional()['describe']('Maximum diff preview lines.'),
            includeDiffPreview: z
                .boolean()
                .optional()
                ['describe']('Include textual diffPreview in the tool result. Default: false.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({
            path,
            old_string,
            new_string,
            replace_all,
            diffContextLines,
            maxDiffLines,
            includeDiffPreview,
        }) => {
            const resolved = await resolveValidatedReadPath(path);
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const snapshot = await readTextValidated(resolved.validatedReadPath);
            const occurrences = countOccurrences(snapshot.content, old_string);
            if (occurrences === 0) {
                return errorResult('old_string not found.', {
                    code: 'ERR_PATCH_TEXT_NOT_FOUND',
                    path: resolved.relative,
                });
            }
            const plannedContent =
                replace_all === true
                    ? snapshot.content.replaceAll(old_string, new_string)
                    : snapshot.content.replace(old_string, new_string);
            const diff = buildPlanDiffPreview(snapshot.content, plannedContent, {
                contextLines: optionalInteger(diffContextLines) ?? DEFAULT_DIFF_CONTEXT_LINES,
                maxLines: optionalInteger(maxDiffLines) ?? DEFAULT_MAX_DIFF_LINES,
            });
            return okResult(
                {
                    success: true,
                    plannedTool: 'repo_apply_patch',
                    path: resolved.relative,
                    occurrences,
                    plannedReplacements: replace_all === true ? occurrences : 1,
                    previousBytes: snapshot.bytesRead,
                    projectedBytes: Buffer.byteLength(plannedContent, 'utf8'),
                    sha256: snapshot.contentHash,
                    ...maybePlanDiffPreview(includeDiffPreview, diff),
                    nextCall: {
                        tool: 'repo_apply_patch',
                        args: {
                            path: resolved.relative,
                            old_string,
                            new_string,
                            replace_all: replace_all === true,
                            expectedHash: snapshot.contentHash,
                        },
                    },
                },
                includeDiffPreview === true ? diff.diff : 'Patch plan ready; diff preview suppressed.',
            );
        },
    },
    {
        name: 'repo_quarantine_file_plan',
        title: 'Plan repository file quarantine',
        description:
            'Read-only plan for moving one workspace file into reversible MCP quarantine. Does not move files.',
        inputSchema: {
            path: z.string().min(1)['describe']('Workspace-relative file path to plan for quarantine.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ path }) => {
            const resolved = await resolveWritePath(path);
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const stats = await statPath(resolved.resolved);
            return okResult({
                success: true,
                plannedTool: 'repo_quarantine_file',
                path: resolved.relative,
                type: stats.stats.isFile() ? 'file' : stats.stats.isDirectory() ? 'directory' : 'other',
                sizeBytes: stats.stats.size,
                restorable: stats.stats.isFile(),
                nextCall: {
                    tool: 'repo_quarantine_file',
                    args: { path: resolved.relative },
                },
            });
        },
    },
    {
        name: 'repo_move_file_plan',
        title: 'Plan repository file move',
        description: 'Read-only plan for moving or renaming one workspace file. Does not move files.',
        inputSchema: {
            source: z.string().min(1)['describe']('Workspace-relative existing source file.'),
            destination: z.string().min(1)['describe']('Workspace-relative destination path.'),
            overwrite: z.boolean().optional()['describe']('Plan overwrite. Default: false.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ source, destination, overwrite }) => {
            // A move mutates its source; the plan must use the same write-policy class as the eventual apply.
            const src = await resolveWritePath(source);
            if (!src.ok) return errorResult(src.reason, { ...src, field: 'source' });
            const dst = await resolveWritePath(destination);
            if (!dst.ok) return errorResult(dst.reason, { ...dst, field: 'destination' });
            const sourceStats = await statPath(src.resolved);
            const destinationExists = await pathExists(dst.resolved);
            return okResult({
                success: true,
                plannedTool: 'repo_move_file',
                source: src.relative,
                destination: dst.relative,
                sourceBytes: sourceStats.stats.size,
                destinationExists,
                overwrite: overwrite === true,
                requiresConfirmOverwrite: destinationExists && overwrite === true,
                nextCall: {
                    tool: 'repo_move_file',
                    args: {
                        source: src.relative,
                        destination: dst.relative,
                        overwrite: overwrite === true,
                        ...(destinationExists && overwrite === true ? { confirmOverwrite: true } : {}),
                    },
                },
            });
        },
    },
    {
        name: 'repo_index_refresh_plan',
        title: 'Plan repository index refresh',
        description: 'Read-only plan for refreshing the shared Copilot IO index. Does not build or mutate the index.',
        inputSchema: {
            path: z.string().optional()['describe']('Workspace-relative directory path. Default: src/copilot.'),
            maxFiles: z.number().int().positive().max(25_000).optional()['describe']('Planned max files.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ path, maxFiles }) => {
            const resolved = await resolveReadPath(typeof path === 'string' && path.trim() ? path : 'src/copilot');
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            return okResult({
                success: true,
                plannedTool: 'repo_index_build',
                path: resolved.relative,
                workspaceRoot: getMcpWorkspaceRoot(),
                currentStats: readIoIndexStatus(),
                plannedOptions: {
                    workspaceRoot: WORKSPACE_ROOT,
                    recursive: true,
                    depth: 20,
                    respectGitignore: true,
                    concurrency: 8,
                    maxFiles: maxFiles ?? 25_000,
                    pruneMissing: true,
                },
                nextCall: {
                    tool: 'repo_index_build',
                    args: { path: resolved.relative, maxFiles: maxFiles ?? 25_000, pruneMissing: true },
                },
            });
        },
    },
    {
        name: 'mcp_validation_plan',
        title: 'Plan MCP validation',
        description: 'Plan validation escalation; defaults to inspect-first and no validator.',
        inputSchema: {
            suite: z
                .enum(['mcp-fast', 'mcp-full', 'copilot-fast'])
                .optional()
                ['describe']('Explicit broad escalation.'),
            testFile: z
                .string()
                .min(1)
                .max(1024)
                .optional()
                ['describe']('Explicit tests/unit/copilot/**/*.spec.js path.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ suite, testFile }) => {
            if (suite && testFile) {
                return errorResult('Choose testFile or suite, not both.', {
                    code: 'ERR_VALIDATION_PLAN_AMBIGUOUS',
                    hint: 'Prefer testFile for localized changes; suite is escalation-only.',
                });
            }
            const escalationPolicy = [
                'inspect-static-evidence',
                'run-one-focused-test-if-needed',
                'run-typecheck-if-contracts-changed',
                'run-broad-suite-only-for-cross-cutting-risk-or-release-gate',
            ];
            if (testFile) {
                try {
                    const command = resolveFocusedUnitTestCommand([testFile]);
                    return okResult({
                        success: true,
                        strategy: 'focused-first',
                        recommendation: 'run-focused-test',
                        breadth: 'file-scoped',
                        plannedTool: 'run_copilot_validator',
                        validator: 'unit-focused',
                        testFile,
                        command: command.command,
                        args: command.args,
                        escalationPolicy,
                        nextCall: {
                            tool: 'run_copilot_validator',
                            args: { validator: 'unit-focused', testFile },
                        },
                    });
                } catch (error) {
                    return errorResult('Focused validation plan rejected testFile.', {
                        code: 'ERR_INVALID_FOCUSED_TEST_FILE',
                        error: error instanceof Error ? error.message : String(error),
                        testFile,
                    });
                }
            }
            if (!suite) {
                return okResult({
                    success: true,
                    strategy: 'inspect-first',
                    recommendation: 'no-validator-yet',
                    breadth: 'none',
                    plannedTool: null,
                    escalationPolicy,
                    nextCall: null,
                    hint: 'Inspect the causal diff first; add testFile only when execution adds material evidence.',
                });
            }
            const validator =
                suite === 'mcp-full'
                    ? 'suite-mcp-full'
                    : suite === 'copilot-fast'
                      ? 'suite-copilot-fast'
                      : 'suite-mcp-fast';
            const command = resolveValidatorCommand(validator);
            return okResult({
                success: true,
                strategy: 'explicit-broad-escalation',
                recommendation: 'broad-suite-requested',
                breadth: 'broad',
                broadValidation: true,
                plannedTool: 'mcp_run_safe_validation_suite',
                suite,
                validator,
                command: command.command,
                args: command.args,
                escalationPolicy,
                nextCall: { tool: 'mcp_run_safe_validation_suite', args: { suite } },
                warning: 'Broad suites are not the default; use only when focused evidence is insufficient.',
            });
        },
    },
];
