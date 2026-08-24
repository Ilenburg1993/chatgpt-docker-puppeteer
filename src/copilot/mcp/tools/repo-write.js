// @ts-check
/**
 * Controlled workspace write MCP tools.
 *
 * @module copilot/mcp/tools/repo-write
 */

import { appendMcpAuditEvent } from '#copilot/mcp/public/observability';
import {
    boundedWriteAnnotations,
    destructiveAnnotations,
    errorResult,
    estimateStructuredTextResultBytes,
    MCP_TOOL_EXECUTION_LIMITS,
    okResult,
    readOnlyAnnotations,
    requireMcpToolWorkspace,
    withResultExecutionHint,
    withResultSizeHint,
} from '#copilot/mcp/public/protocol/tools';
import {
    canRunCopilotValidatorInline,
    normalizeFocusedUnitTestFiles,
    runCopilotValidatorInline,
} from '#copilot/mcp/public/validation';
import {
    buildRepositoryPatchNextAction,
    classifyRepositoryPatchFailure,
    compactRepositoryPatchFailureRows,
    createRepositoryPatchResultValidationOption,
    readRepositoryPatchErrorDetails,
    runRepositoryPatchTargetGroups,
    summarizeRepositoryPatchFailures,
} from '#copilot/mcp/public/workspace/repository/patch';

import { clearRepoReadFileResultCacheForResolvedPath } from '#copilot/mcp/public/workspace/repository/read-cache';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';

/** @typedef {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} RepoWriteWorkspaceCapability */
/** @typedef {RepoWriteWorkspaceCapability['io']} RepoWriteIo */
/** @typedef {Readonly<{ workspace: RepoWriteWorkspaceCapability; io: RepoWriteIo; workspaceRoot: string; quarantineDir: string }>} RepoWriteRuntime */

/** @param {RepoWriteWorkspaceCapability} workspace @returns {RepoWriteRuntime} */
function createRepoWriteRuntime(workspace) {
    return Object.freeze({
        workspace,
        io: workspace.io,
        workspaceRoot: workspace.workspaceRoot,
        quarantineDir: path.join(workspace.workspaceRoot, 'src/copilot/.ai/quarantine'),
    });
}

const DEFAULT_DIFF_CONTEXT_LINES = 3;
const DEFAULT_MAX_DIFF_LINES = 2000;

const { maxOperations: MAX_BATCH_FILE_OPERATIONS } = MCP_TOOL_EXECUTION_LIMITS.repoFileBatch;
const {
    maxBatchOperations: MAX_PATCH_BATCH_OPERATIONS,
    maxBatchTargets: MAX_PATCH_BATCH_TARGETS,
    maxBatchInputBytes: MAX_PATCH_BATCH_INPUT_BYTES,
    defaultPlanConcurrency: DEFAULT_PATCH_PLAN_CONCURRENCY,
    defaultFastConcurrency: DEFAULT_PATCH_FAST_CONCURRENCY,
    maxTargetConcurrency: MAX_PATCH_TARGET_CONCURRENCY,
} = MCP_TOOL_EXECUTION_LIMITS.repoPatch;

/**
 * Use the opaque validated mutable capability when the upstream path adapter supplied one; keep the canonical string
 * method as a compatibility fallback for internal mocks/legacy callers.
 *
 * @param {{ resolved: string; validatedWritePath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedMutableWorkspacePath }} resolved
 * @param {Parameters<RepoWriteIo['patchTextLocked']>[1]} options
 */
function patchResolvedTarget(/** @type {RepoWriteRuntime} */ runtime, resolved, options) {
    return resolved.validatedWritePath
        ? runtime.io.patchTextLockedValidated(resolved.validatedWritePath, options)
        : runtime.io.patchTextLocked(resolved.resolved, options);
}

/**
 * @param {{ resolved: string; validatedWritePath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedMutableWorkspacePath }} resolved
 * @param {Parameters<RepoWriteIo['createOrReplaceFileAtomic']>[1]} content
 * @param {Parameters<RepoWriteIo['createOrReplaceFileAtomic']>[2]} options
 */
function createResolvedTarget(/** @type {RepoWriteRuntime} */ runtime, resolved, content, options) {
    return resolved.validatedWritePath
        ? runtime.io.createOrReplaceFileAtomicValidated(resolved.validatedWritePath, content, options)
        : runtime.io.createOrReplaceFileAtomic(resolved.resolved, content, options);
}

/**
 * @param {{ resolved: string; validatedWritePath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedMutableWorkspacePath }} resolved
 * @param {Parameters<RepoWriteIo['writeFileAtomic']>[1]} content
 * @param {Parameters<RepoWriteIo['writeFileAtomic']>[2]} options
 */
function writeResolvedTarget(/** @type {RepoWriteRuntime} */ runtime, resolved, content, options) {
    return resolved.validatedWritePath
        ? runtime.io.writeFileAtomicValidated(resolved.validatedWritePath, content, options)
        : runtime.io.writeFileAtomic(resolved.resolved, content, options);
}

/**
 * Move through the pair-capability path only when both sides were independently authorized by canonical write policy.
 * Legacy/mocked callers without capabilities keep the string facade and therefore retain full policy validation.
 *
 * @param {{ resolved: string; validatedWritePath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedMutableWorkspacePath }} source
 * @param {{ resolved: string; validatedWritePath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedMutableWorkspacePath }} destination
 * @param {Parameters<RepoWriteIo['moveFileLocked']>[2]} options
 */
function moveResolvedTargets(/** @type {RepoWriteRuntime} */ runtime, source, destination, options) {
    return source.validatedWritePath && destination.validatedWritePath
        ? runtime.io.moveFileLockedValidated(source.validatedWritePath, destination.validatedWritePath, options)
        : runtime.io.moveFileLocked(source.resolved, destination.resolved, options);
}

/**
 * Resolve batch write intent defensively. Some connector/host adapters may omit an optional boolean when its value is
 * false; confirmBatch=true is itself an explicit write acknowledgement, while dryRun=true always wins.
 *
 * @param {boolean | undefined} dryRun
 * @param {boolean | undefined} confirmBatch
 */
function resolveBatchDryRun(dryRun, confirmBatch) {
    if (dryRun === true) return true;
    if (dryRun === false) return false;
    return confirmBatch !== true;
}

const MAX_QUARANTINE_ID_LENGTH = 192;
const quarantineIdSchema = z
    .string()
    .min(1)
    .max(MAX_QUARANTINE_ID_LENGTH)
    ['regex'](/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, 'quarantineId must be a safe basename');
const durabilitySchema = z
    .enum(['file-and-directory', 'file', 'none'])
    .optional()
    ['describe'](
        'Crash-durability profile. Default file-and-directory. file skips parent-directory fsync; none also skips file flush. Atomic publish, locks, path policy and hash preconditions remain enforced.',
    );

/** @param {unknown} value @returns {{ durability: import('#copilot/infra/public/policy').IoDurabilityMode } | {}} */
function durabilityOption(value) {
    return value === 'file-and-directory' || value === 'file' || value === 'none' ? { durability: value } : {};
}

const quarantineTransactionSchema = z.object({
    kind: z.enum(['quarantine', 'restore']),
    destinationPath: z.string().min(1).max(4096).nullable(),
    backupPath: z.string().min(1).max(4096).nullable(),
    destinationExisted: z.boolean(),
});
const quarantineMetadataSchema = z.object({
    quarantineId: quarantineIdSchema,
    originalPath: z.string().min(1).max(4096),
    quarantinePath: z.string().min(1).max(4096),
    metadataPath: z.string().min(1).max(4096),
    createdAt: z.string()['datetime'](),
    status: z.enum(['quarantining', 'quarantined', 'restoring', 'restored']),
    restoredAt: z.string()['datetime']().nullable(),
    restoredPath: z.string().min(1).max(4096).nullable(),
    sourceBytes: z.number().int().nonnegative(),
    sourceHash: z
        .string()
        ['regex'](/^[a-f0-9]{64}$/)
        .nullable(),
    transaction: quarantineTransactionSchema.nullable().optional(),
});

const POST_PATCH_VALIDATOR_NAMES = /** @type {const} */ ([
    'typecheck',
    'lint',
    'unit-focused',
    'devcontainer-shell',
    'network-contracts',
]);
const MAX_POST_PATCH_VALIDATORS = 4;
const postPatchValidationRequestSchema = z.object({
    validator: z.enum(POST_PATCH_VALIDATOR_NAMES),
    testFile: z.string().min(1).max(1024).optional(),
    timeoutMs: z.number().int().min(1_000).max(3_600_000).optional(),
    waitMs: z.number().int().min(0).max(120_000).optional(),
    failureTailBytes: z.number().int().min(1_000).max(12_000).optional(),
});

const patchBatchOperationSchema = z.object({
    path: z.string().min(1)['describe']('Workspace-relative file path.'),
    old_string: z.string().min(1)['describe']('Exact text to replace.'),
    new_string: z.string()['describe']('Replacement text. Use an empty string to delete matched text.'),
    replace_all: z.boolean().optional()['describe']('Replace every occurrence of old_string. Default: false.'),
    expected_occurrences: z
        .number()
        .int()
        .min(1)
        .optional()
        ['describe']('Require an exact occurrence count before applying.'),
    occurrence_index: z
        .number()
        .int()
        .min(1)
        .optional()
        ['describe']('1-based occurrence index to replace when old_string appears more than once.'),
    expectedHash: z
        .string()
        .optional()
        ['describe'](
            'Expected SHA-256. For repeated same-file operations, repeat the initial file hash to use one group-baseline precondition; distinct hashes keep per-operation virtual-state checks.',
        ),
    allowNoop: z.boolean().optional()['describe']('Allow old_string and new_string to be identical. Default: false.'),
    diffContextLines: z.number().int().min(0).max(20).optional()['describe']('Context lines in diff preview.'),
    maxDiffLines: z.number().int().min(1).max(2000).optional()['describe']('Maximum diff preview lines.'),
    includeDiffPreview: z
        .boolean()
        .optional()
        ['describe']('Include textual diffPreview in each operation result. Default: false.'),
});

/**
 * Validate post-patch validator configuration before any file is modified.
 *
 * @param {{
 *     validator: string;
 *     testFile?: string;
 *     timeoutMs?: number;
 *     waitMs?: number;
 *     failureTailBytes?: number;
 * }[]} requests
 */
function normalizePostPatchValidationRequests(requests) {
    return requests.map((request) => {
        if (request.validator === 'unit-focused') {
            if (!request.testFile) throw new Error('postValidate unit-focused requires testFile.');
            normalizeFocusedUnitTestFiles([request.testFile]);
        } else if (request.testFile) {
            throw new Error('postValidate testFile is valid only with unit-focused.');
        }
        return {
            validator: /** @type {import('#copilot/mcp/public/validation').CopilotValidatorName} */ (request.validator),
            ...(request.testFile ? { testFile: request.testFile } : {}),
            ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
            ...(request.waitMs === undefined ? {} : { waitMs: request.waitMs }),
            ...(request.failureTailBytes === undefined ? {} : { failureTailBytes: request.failureTailBytes }),
        };
    });
}

/**
 * @param {ReturnType<typeof normalizePostPatchValidationRequests>} requests
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 */
async function runPostPatchValidations(requests, workspace) {
    const startedAt = Date.now();
    const results = [];
    for (const [index, request] of requests.entries()) {
        try {
            const result = await runCopilotValidatorInline(request.validator, {
                workspace,
                ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
                ...(request.waitMs === undefined ? {} : { waitMs: request.waitMs }),
                ...(request.failureTailBytes === undefined ? {} : { failureTailBytes: request.failureTailBytes }),
                ...(request.testFile ? { testFiles: [request.testFile] } : {}),
            });
            const job = result.job;
            results.push({
                index,
                validator: request.validator,
                ...(request.testFile ? { testFile: request.testFile } : {}),
                passed: result.passed,
                completedWithinWait: result.completedWithinWait,
                waitMs: result.waitMs,
                job: {
                    id: job.id,
                    status: job.status,
                    exitCode: job.exitCode,
                    timedOut: job.timedOut,
                    startedAt: new Date(job.startedAt).toISOString(),
                    endedAt: job.endedAt === null ? null : new Date(job.endedAt).toISOString(),
                    durationMs: (job.endedAt ?? Date.now()) - job.startedAt,
                    logFile: job.logFile,
                },
                ...(result.failureOutputTail ? { failureOutputTail: result.failureOutputTail } : {}),
            });
        } catch (error) {
            results.push({
                index,
                validator: request.validator,
                ...(request.testFile ? { testFile: request.testFile } : {}),
                passed: false,
                completedWithinWait: true,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    const failedCount = results.filter((result) => result.passed !== true).length;
    return {
        requestedCount: requests.length,
        ran: true,
        skipped: false,
        skippedReason: null,
        allPassed: failedCount === 0,
        failedCount,
        durationMs: Date.now() - startedAt,
        results,
    };
}

const batchOperationSchema = z['discriminatedUnion']('type', [
    z.object({
        type: z.literal('create_file'),
        path: z.string().min(1)['describe']('Workspace-relative file path to create.'),
        content: z.string().optional()['describe']('Initial UTF-8 content. Default: empty string.'),
        createParentDirs: z.boolean().optional()['describe']('Create parent directories. Default: true.'),
        durability: durabilitySchema,
    }),
    z.object({
        type: z.literal('move_file'),
        source: z.string().min(1)['describe']('Workspace-relative existing source file.'),
        destination: z.string().min(1)['describe']('Workspace-relative destination path.'),
        overwrite: z.boolean().optional()['describe']('Overwrite destination if it exists. Default: false.'),
        confirmOverwrite: z.boolean().optional()['describe']('Must be true when overwrite=true.'),
    }),
    z.object({
        type: z.literal('quarantine_file'),
        path: z.string().min(1)['describe']('Workspace-relative file path to move into reversible quarantine.'),
    }),
    z.object({
        type: z.literal('set_executable'),
        path: z.string().min(1)['describe']('Workspace-relative regular file whose executable bits should be toggled.'),
        executable: z
            .boolean()
            ['describe']('When true, add POSIX executable bits; when false, remove only executable bits.'),
    }),
    z.object({
        type: z.literal('remove_file'),
        path: z
            .string()
            .min(1)
            ['describe']('Workspace-relative file path to delete. Prefer quarantine_file when possible.'),
        confirm: z.boolean().optional()['describe']('Must be true for remove_file when dryRun=false.'),
    }),
]);

/**
 * File batches preserve order because later operations may depend on earlier ones. The adaptive default skips the
 * duplicate whole-batch preview for operations whose failure cannot overwrite/delete existing data. Irreversible delete
 * and overwrite stay behind the conservative preview gate unless the caller explicitly selects sequential-fast.
 *
 * @param {Record<string, unknown>[]} operations
 * @param {'global-preflight' | 'sequential-fast' | undefined} requested
 */
function resolveFileBatchApplyMode(operations, requested) {
    if (requested) return { mode: requested, reason: 'explicit', conservativeOperationIndices: [] };
    const conservativeOperationIndices = [];
    for (const [index, operation] of operations.entries()) {
        const type = String(operation['type'] ?? '');
        if (type === 'remove_file' || (type === 'move_file' && operation['overwrite'] === true)) {
            conservativeOperationIndices.push(index);
        }
    }
    return conservativeOperationIndices.length > 0
        ? {
              mode: /** @type {const} */ ('global-preflight'),
              reason: 'adaptive-destructive-gate',
              conservativeOperationIndices,
          }
        : {
              mode: /** @type {const} */ ('sequential-fast'),
              reason: 'adaptive-safe-sequential',
              conservativeOperationIndices,
          };
}

/**
 * @typedef {object} QuarantineMetadata
 * @property {string} quarantineId
 * @property {string} originalPath
 * @property {string} quarantinePath
 * @property {string} metadataPath
 * @property {string} createdAt
 * @property {'quarantining' | 'quarantined' | 'restoring' | 'restored'} status
 * @property {string | null} restoredAt
 * @property {string | null} restoredPath
 * @property {number} sourceBytes
 * @property {string | null} sourceHash
 * @property {{
 *     kind: 'quarantine' | 'restore';
 *     destinationPath: string | null;
 *     backupPath: string | null;
 *     destinationExisted: boolean;
 * } | null} transaction
 */

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
 * @param {boolean | undefined} include
 * @param {{ diff: string; truncated: boolean; lines: number; contextLines: number; bytes?: number }} diff
 * @returns {Record<string, unknown>}
 */
function maybeDiffPreview(include, diff) {
    return include === true
        ? {
              diffPreview: diff.diff,
              diffPreviewTruncated: diff.truncated,
              diffPreviewLines: diff.lines,
              ...(typeof diff.bytes === 'number' ? { diffPreviewBytes: diff.bytes } : {}),
              diffContextLines: diff.contextLines,
          }
        : {
              diffPreviewSuppressed: true,
              diffPreviewAvailable: diff.lines > 0,
              diffPreviewLines: diff.lines,
              ...(typeof diff.bytes === 'number' ? { diffPreviewBytes: diff.bytes } : {}),
              diffContextLines: diff.contextLines,
          };
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function optionalInteger(value) {
    return Number.isInteger(value) ? /** @type {number} */ (value) : undefined;
}

const MAX_QUARANTINE_METADATA_BYTES = 128 * 1024;

/** @param {RepoWriteRuntime} runtime @param {string} filePath */
async function repoWriteStat(runtime, filePath) {
    return (await runtime.io.statPath(filePath)).stats;
}

/** @param {RepoWriteRuntime} runtime @param {string} filePath */
async function repoWriteLstat(runtime, filePath) {
    return (await runtime.io.lstatPath(filePath)).stats;
}

/** @param {RepoWriteRuntime} runtime @param {string} dirPath */
async function repoWriteListDirectoryNames(runtime, dirPath) {
    return (await runtime.io.listDirectoryNamesFresh(dirPath)).entries;
}

/**
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function pathExists(/** @type {RepoWriteRuntime} */ runtime, filePath) {
    try {
        await repoWriteStat(runtime, filePath);
        return true;
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return false;
        throw error;
    }
}

/**
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function regularFileExists(/** @type {RepoWriteRuntime} */ runtime, filePath) {
    try {
        const stats = await repoWriteLstat(runtime, filePath);
        return stats.isFile() && !stats.isSymbolicLink();
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return false;
        throw error;
    }
}

/**
 * @param {string} candidate
 * @returns {boolean}
 */
function isCanonicalWorkspaceRelativePath(/** @type {RepoWriteRuntime} */ runtime, candidate) {
    if (path.isAbsolute(candidate) || candidate !== path.normalize(candidate)) return false;
    const root = path.resolve(runtime.workspaceRoot);
    const resolved = path.resolve(root, candidate);
    const relative = path.relative(root, resolved);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * @param {string} quarantineId
 * @param {string | null} backupPath
 * @returns {boolean}
 */
function isCanonicalQuarantineBackupPath(/** @type {RepoWriteRuntime} */ runtime, quarantineId, backupPath) {
    if (backupPath === null) return true;
    if (!isCanonicalWorkspaceRelativePath(runtime, backupPath)) return false;
    const resolved = path.resolve(runtime.workspaceRoot, backupPath);
    if (path.dirname(resolved) !== path.resolve(runtime.quarantineDir)) return false;
    return new RegExp(
        `^${quarantineId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.restore-backup-[a-f0-9-]{36}\\.data$`,
    ).test(path.basename(resolved));
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function buildQuarantineId(filePath) {
    const basename = (path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_') || 'file').slice(0, 96);
    return `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}-${basename}`;
}

/**
 * @param {string} quarantineId
 * @returns {{ dataPath: string; metadataPath: string }}
 */
function resolveQuarantinePaths(/** @type {RepoWriteRuntime} */ runtime, quarantineId) {
    const normalized = quarantineIdSchema.parse(quarantineId);
    return {
        dataPath: path.join(runtime.quarantineDir, `${normalized}.data`),
        metadataPath: path.join(runtime.quarantineDir, `${normalized}.json`),
    };
}

/**
 * @param {QuarantineMetadata} metadata
 * @param {string} metadataPath
 * @returns {Promise<void>}
 */
async function writeQuarantineMetadataDefault(/** @type {RepoWriteRuntime} */ runtime, metadata, metadataPath) {
    await runtime.io.createOrReplaceFileAtomic(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
        createParentDirs: true,
        mode: 0o600,
        riskClass: 'high',
        advisoryLimits: {
            operation: 'quarantineMetadata',
            quarantineId: metadata.quarantineId,
            status: metadata.status,
        },
    });
}

/** @type {(runtime: RepoWriteRuntime, metadata: QuarantineMetadata, metadataPath: string) => Promise<void>} */
let quarantineMetadataWriter = writeQuarantineMetadataDefault;

export const repoWriteTestHarness = Object.freeze({
    /**
     * @param {(runtime: RepoWriteRuntime, metadata: QuarantineMetadata, metadataPath: string) => Promise<void>} writer
     */
    setQuarantineMetadataWriter(writer) {
        quarantineMetadataWriter = writer;
    },
    resetQuarantineMetadataWriter() {
        quarantineMetadataWriter = writeQuarantineMetadataDefault;
    },
    writeQuarantineMetadataDefault,
});

/**
 * @param {QuarantineMetadata} metadata
 * @param {string} metadataPath
 * @returns {Promise<void>}
 */
async function writeQuarantineMetadata(/** @type {RepoWriteRuntime} */ runtime, metadata, metadataPath) {
    await quarantineMetadataWriter(runtime, metadata, metadataPath);
}

/**
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function removeFileIfPresent(/** @type {RepoWriteRuntime} */ runtime, filePath) {
    try {
        await runtime.io.deleteFileLocked(filePath, { captureRollback: false });
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
    }
}

/**
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function removeRegularFileIfPresent(/** @type {RepoWriteRuntime} */ runtime, filePath) {
    if (!(await pathExists(runtime, filePath))) return;
    if (!(await regularFileExists(runtime, filePath))) {
        const error = /** @type {Error & { code?: string }} */ (
            new Error(`Refusing to remove non-regular quarantine artifact: ${filePath}`)
        );
        error.code = 'ERR_QUARANTINE_ARTIFACT_INVALID';
        throw error;
    }
    await runtime.io.deleteFileLocked(filePath, { captureRollback: false });
}

/**
 * @param {unknown} primaryError
 * @param {unknown} rollbackError
 * @param {string} operation
 * @returns {Error & { code?: string }}
 */
function createQuarantineRollbackError(primaryError, rollbackError, operation) {
    const error = /** @type {Error & { code?: string }} */ (
        new Error(
            `${operation} failed and rollback also failed: ${
                primaryError instanceof Error ? primaryError.message : String(primaryError)
            }; rollback: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
            { cause: primaryError },
        )
    );
    error.code = 'ERR_QUARANTINE_ROLLBACK_FAILED';
    return error;
}

/**
 * @param {string} metadataPath
 * @returns {Promise<QuarantineMetadata | null>}
 */
async function readQuarantineMetadataFile(/** @type {RepoWriteRuntime} */ runtime, metadataPath) {
    try {
        const snapshot = await runtime.io.readBytesRangeFresh(metadataPath, {
            maxBytes: MAX_QUARANTINE_METADATA_BYTES,
            rejectSymlink: true,
        });
        if (!snapshot.isFile || snapshot.truncatedAfter) return null;
        const parsed = JSON.parse(snapshot.content.toString('utf8'));
        const validation = quarantineMetadataSchema.safeParse(parsed);
        if (!validation.success) return null;
        const metadata = /** @type {QuarantineMetadata} */ ({
            ...validation.data,
            transaction: validation.data.transaction ?? null,
        });
        const expectedPaths = resolveQuarantinePaths(runtime, metadata.quarantineId);
        if (path.resolve(metadataPath) !== path.resolve(expectedPaths.metadataPath)) return null;
        if (metadata.metadataPath !== runtime.workspace.toRelativePath(expectedPaths.metadataPath)) return null;
        if (metadata.quarantinePath !== runtime.workspace.toRelativePath(expectedPaths.dataPath)) return null;
        if (!isCanonicalWorkspaceRelativePath(runtime, metadata.originalPath)) return null;
        if (metadata.restoredPath !== null && !isCanonicalWorkspaceRelativePath(runtime, metadata.restoredPath))
            return null;
        if (metadata.transaction?.kind === 'quarantine') {
            if (
                metadata.transaction.destinationPath !== null ||
                metadata.transaction.backupPath !== null ||
                metadata.transaction.destinationExisted
            ) {
                return null;
            }
        } else if (metadata.transaction?.kind === 'restore') {
            if (
                metadata.transaction.destinationPath === null ||
                !isCanonicalWorkspaceRelativePath(runtime, metadata.transaction.destinationPath)
            ) {
                return null;
            }
        }
        if (
            !isCanonicalQuarantineBackupPath(runtime, metadata.quarantineId, metadata.transaction?.backupPath ?? null)
        ) {
            return null;
        }
        if (metadata.status === 'quarantining' && metadata.transaction?.kind !== 'quarantine') return null;
        if (metadata.status === 'quarantined' && metadata.transaction !== null) return null;
        if (metadata.status === 'restoring' && metadata.transaction?.kind !== 'restore') return null;
        if (metadata.status === 'restored' && metadata.transaction?.kind === 'quarantine') return null;
        return metadata;
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR' || error instanceof SyntaxError) return null;
        throw error;
    }
}

/**
 * @param {string} quarantineId
 * @returns {Promise<QuarantineMetadata | null>}
 */
async function readQuarantineMetadata(/** @type {RepoWriteRuntime} */ runtime, quarantineId) {
    const parsedId = quarantineIdSchema.safeParse(quarantineId);
    if (!parsedId.success) return null;
    const paths = resolveQuarantinePaths(runtime, parsedId.data);
    const { value } = await runtime.io.withIoResourceLock(
        paths.metadataPath,
        async () => {
            const metadata = await readQuarantineMetadataFile(runtime, paths.metadataPath);
            if (!metadata || metadata.quarantineId !== parsedId.data) return null;
            return reconcileQuarantineMetadata(runtime, metadata, paths);
        },
        {
            operation: 'quarantine-reconcile',
            target: paths.metadataPath,
            riskClass: 'high',
        },
    );
    return value;
}

/**
 * @returns {Promise<QuarantineMetadata[]>}
 */
async function listQuarantineMetadata(/** @type {RepoWriteRuntime} */ runtime) {
    const entries = await repoWriteListDirectoryNames(runtime, runtime.quarantineDir).catch((error) => {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return [];
        throw error;
    });
    /** @type {QuarantineMetadata[]} */
    const items = [];
    const metadataEntries = entries.filter((entry) => entry.endsWith('.json'));
    const batchSize = 32;
    for (let index = 0; index < metadataEntries.length; index += batchSize) {
        const batch = metadataEntries.slice(index, index + batchSize);
        const metadataBatch = await Promise.all(
            batch.map((entry) => readQuarantineMetadata(runtime, entry.slice(0, -'.json'.length))),
        );
        for (const metadata of metadataBatch) {
            if (metadata) items.push(metadata);
        }
    }
    return items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function sha256File(/** @type {RepoWriteRuntime} */ runtime, filePath) {
    const snapshot = await runtime.io.readBytesFresh(filePath, { includeHash: true });
    return snapshot.contentHash ?? createHash('sha256').update(snapshot.content).digest('hex');
}

/**
 * @param {string} filePath
 * @param {QuarantineMetadata} metadata
 * @returns {Promise<boolean>}
 */
async function fileMatchesQuarantineMetadata(/** @type {RepoWriteRuntime} */ runtime, filePath, metadata) {
    if (!(await regularFileExists(runtime, filePath))) return false;
    const stats = await repoWriteStat(runtime, filePath);
    if (metadata.sourceBytes > 0 && stats.size !== metadata.sourceBytes) return false;
    if (metadata.sourceHash !== null && (await sha256File(runtime, filePath)) !== metadata.sourceHash) return false;
    return true;
}

/**
 * Reconciles a journal left by a process interruption. The caller must hold the metadata-path lock.
 *
 * @param {QuarantineMetadata} metadata
 * @param {{ dataPath: string; metadataPath: string }} quarantinePaths
 * @returns {Promise<QuarantineMetadata | null>}
 */
async function reconcileQuarantineMetadata(/** @type {RepoWriteRuntime} */ runtime, metadata, quarantinePaths) {
    if (metadata.status === 'quarantining') {
        const original = await runtime.workspace.resolveWritePath(metadata.originalPath);
        if (!original.ok) return metadata;
        const [dataExists, originalExists] = await Promise.all([
            regularFileExists(runtime, quarantinePaths.dataPath),
            pathExists(runtime, original.resolved),
        ]);
        if (dataExists && !originalExists) {
            const dataStats = await repoWriteStat(runtime, quarantinePaths.dataPath);
            const reconciled = /** @type {QuarantineMetadata} */ ({
                ...metadata,
                status: 'quarantined',
                sourceBytes: dataStats.size,
                sourceHash: await sha256File(runtime, quarantinePaths.dataPath),
                transaction: null,
            });
            await writeQuarantineMetadata(runtime, reconciled, quarantinePaths.metadataPath);
            return reconciled;
        }
        if (!dataExists && originalExists) {
            await removeFileIfPresent(runtime, quarantinePaths.metadataPath);
            return null;
        }
        return metadata;
    }

    if (metadata.status === 'restored' && metadata.transaction?.kind === 'restore') {
        const backupPath = metadata.transaction.backupPath;
        if (backupPath) {
            const backup = await runtime.workspace.resolveWritePath(backupPath);
            if (!backup.ok) return metadata;
            await removeRegularFileIfPresent(runtime, backup.resolved);
        }
        const reconciled = /** @type {QuarantineMetadata} */ ({ ...metadata, transaction: null });
        await writeQuarantineMetadata(runtime, reconciled, quarantinePaths.metadataPath);
        return reconciled;
    }

    if (metadata.status !== 'restoring' || metadata.transaction?.kind !== 'restore') {
        return metadata;
    }

    const destinationPath = metadata.transaction.destinationPath;
    if (!destinationPath) return metadata;
    const destination = await runtime.workspace.resolveWritePath(destinationPath);
    if (!destination.ok) return metadata;
    const backup = metadata.transaction.backupPath
        ? await runtime.workspace.resolveWritePath(metadata.transaction.backupPath)
        : null;
    if (backup && !backup.ok) return metadata;

    const [dataPresent, destinationExists, backupPresent] = await Promise.all([
        pathExists(runtime, quarantinePaths.dataPath),
        pathExists(runtime, destination.resolved),
        backup?.ok ? pathExists(runtime, backup.resolved) : Promise.resolve(false),
    ]);
    const dataExists = dataPresent ? await regularFileExists(runtime, quarantinePaths.dataPath) : false;
    if (dataPresent && !dataExists) return metadata;
    const backupExists = backup?.ok && backupPresent ? await regularFileExists(runtime, backup.resolved) : false;
    if (backupPresent && !backupExists) return metadata;
    if (dataExists && !(await fileMatchesQuarantineMetadata(runtime, quarantinePaths.dataPath, metadata))) {
        return metadata;
    }

    if (
        !dataExists &&
        destinationExists &&
        (await fileMatchesQuarantineMetadata(runtime, destination.resolved, metadata))
    ) {
        const committed = /** @type {QuarantineMetadata} */ ({
            ...metadata,
            status: 'restored',
            restoredAt: metadata.restoredAt ?? new Date().toISOString(),
        });
        await writeQuarantineMetadata(runtime, committed, quarantinePaths.metadataPath);
        if (backup?.ok && backupExists) await removeRegularFileIfPresent(runtime, backup.resolved);
        const reconciled = /** @type {QuarantineMetadata} */ ({ ...committed, transaction: null });
        await writeQuarantineMetadata(runtime, reconciled, quarantinePaths.metadataPath);
        return reconciled;
    }

    if (dataExists) {
        if (backup?.ok && backupExists && !destinationExists) {
            await runtime.io.moveFileLocked(backup.resolved, destination.resolved, { overwrite: false });
        } else if (backupExists || (!metadata.transaction.destinationExisted && destinationExists)) {
            return metadata;
        }
        const rolledBack = /** @type {QuarantineMetadata} */ ({
            ...metadata,
            status: 'quarantined',
            restoredAt: null,
            restoredPath: null,
            transaction: null,
        });
        await writeQuarantineMetadata(runtime, rolledBack, quarantinePaths.metadataPath);
        return rolledBack;
    }

    return metadata;
}

/**
 * @param {{ resolved: string; relative: string }} source
 * @returns {Promise<{ metadata: QuarantineMetadata; moved: Awaited<ReturnType<RepoWriteIo['moveFileLocked']>> }>}
 */
async function quarantineResolvedFile(/** @type {RepoWriteRuntime} */ runtime, source) {
    const quarantineId = buildQuarantineId(source.relative);
    const quarantinePaths = resolveQuarantinePaths(runtime, quarantineId);
    /** @type {QuarantineMetadata} */
    const journal = {
        quarantineId,
        originalPath: source.relative,
        quarantinePath: runtime.workspace.toRelativePath(quarantinePaths.dataPath),
        metadataPath: runtime.workspace.toRelativePath(quarantinePaths.metadataPath),
        createdAt: new Date().toISOString(),
        status: 'quarantining',
        restoredAt: null,
        restoredPath: null,
        sourceBytes: 0,
        sourceHash: null,
        transaction: {
            kind: 'quarantine',
            destinationPath: null,
            backupPath: null,
            destinationExisted: false,
        },
    };

    const { value } = await runtime.io.withIoResourceLock(
        quarantinePaths.metadataPath,
        async () => {
            await writeQuarantineMetadata(runtime, journal, quarantinePaths.metadataPath);
            let moved;
            try {
                moved = await runtime.io.moveFileLocked(source.resolved, quarantinePaths.dataPath, {
                    overwrite: false,
                });
            } catch (error) {
                await removeFileIfPresent(runtime, quarantinePaths.metadataPath).catch(() => undefined);
                throw error;
            }

            const metadata = /** @type {QuarantineMetadata} */ ({
                ...journal,
                status: 'quarantined',
                sourceBytes: moved.sourceBytes,
                sourceHash: moved.sourceHash,
                transaction: null,
            });
            try {
                await writeQuarantineMetadata(runtime, metadata, quarantinePaths.metadataPath);
            } catch (error) {
                try {
                    await runtime.io.moveFileLocked(quarantinePaths.dataPath, source.resolved, { overwrite: false });
                    await removeFileIfPresent(runtime, quarantinePaths.metadataPath);
                } catch (rollbackError) {
                    throw createQuarantineRollbackError(error, rollbackError, 'Quarantine metadata commit');
                }
                throw error;
            }
            return { metadata, moved };
        },
        {
            operation: 'quarantine-commit',
            target: quarantinePaths.metadataPath,
            riskClass: 'high',
        },
    );
    return value;
}

/**
 * @param {string} quarantineId
 * @param {{ resolved: string; relative: string }} destination
 * @param {boolean} overwrite
 * @returns {Promise<{
 *     metadata: QuarantineMetadata;
 *     restored: Awaited<ReturnType<RepoWriteIo['moveFileLocked']>>;
 *     destinationPreviousHash: string | null;
 *     destinationPreviousBytes: number | null;
 *     cleanupPending: boolean;
 * }>}
 */
async function restoreQuarantinedFile(/** @type {RepoWriteRuntime} */ runtime, quarantineId, destination, overwrite) {
    const quarantinePaths = resolveQuarantinePaths(runtime, quarantineId);
    const { value } = await runtime.io.withIoResourceLock(
        quarantinePaths.metadataPath,
        async () => {
            const stored = await readQuarantineMetadataFile(runtime, quarantinePaths.metadataPath);
            const metadata = stored ? await reconcileQuarantineMetadata(runtime, stored, quarantinePaths) : null;
            if (!metadata) {
                const error = /** @type {Error & { code?: string }} */ (new Error('Quarantine metadata not found.'));
                error.code = 'ERR_QUARANTINE_NOT_FOUND';
                throw error;
            }
            if (metadata.status !== 'quarantined') {
                const error = /** @type {Error & { code?: string }} */ (
                    new Error('Quarantine item is not restorable.')
                );
                error.code = 'ERR_QUARANTINE_NOT_RESTORABLE';
                throw error;
            }
            if (!(await fileMatchesQuarantineMetadata(runtime, quarantinePaths.dataPath, metadata))) {
                const error = /** @type {Error & { code?: string }} */ (
                    new Error('Quarantine data is missing, unsafe or does not match its manifest.')
                );
                error.code = 'ERR_QUARANTINE_DATA_INVALID';
                throw error;
            }

            const destinationExists = await pathExists(runtime, destination.resolved);
            if (destinationExists && !overwrite) {
                const error = /** @type {Error & { code?: string }} */ (
                    new Error(`Destino ja existe: ${destination.relative}`)
                );
                error.code = 'EEXIST';
                throw error;
            }
            const backupPath = destinationExists
                ? path.join(runtime.quarantineDir, `${quarantineId}.restore-backup-${randomUUID()}.data`)
                : null;
            /** @type {QuarantineMetadata} */
            const journal = {
                ...metadata,
                status: 'restoring',
                restoredAt: new Date().toISOString(),
                restoredPath: destination.relative,
                transaction: {
                    kind: 'restore',
                    destinationPath: destination.relative,
                    backupPath: backupPath ? runtime.workspace.toRelativePath(backupPath) : null,
                    destinationExisted: destinationExists,
                },
            };
            await writeQuarantineMetadata(runtime, journal, quarantinePaths.metadataPath);

            let backupMoved = false;
            let dataMoved = false;
            /** @type {Awaited<ReturnType<RepoWriteIo['moveFileLocked']>> | null} */
            let backupMove = null;
            try {
                if (backupPath) {
                    backupMove = await runtime.io.moveFileLocked(destination.resolved, backupPath, {
                        overwrite: false,
                    });
                    backupMoved = true;
                }
                const restored = await runtime.io.moveFileLocked(quarantinePaths.dataPath, destination.resolved, {
                    overwrite: false,
                });
                dataMoved = true;
                const committed = /** @type {QuarantineMetadata} */ ({ ...journal, status: 'restored' });
                await writeQuarantineMetadata(runtime, committed, quarantinePaths.metadataPath);

                let cleanupPending = false;
                try {
                    if (backupPath) await removeRegularFileIfPresent(runtime, backupPath);
                    await writeQuarantineMetadata(
                        runtime,
                        /** @type {QuarantineMetadata} */ ({ ...committed, transaction: null }),
                        quarantinePaths.metadataPath,
                    );
                } catch {
                    cleanupPending = true;
                }
                return {
                    metadata: /** @type {QuarantineMetadata} */ ({
                        ...committed,
                        transaction: cleanupPending ? committed.transaction : null,
                    }),
                    restored,
                    destinationPreviousHash: backupMove?.sourceHash ?? null,
                    destinationPreviousBytes: backupMove?.sourceBytes ?? null,
                    cleanupPending,
                };
            } catch (error) {
                try {
                    if (dataMoved) {
                        await runtime.io.moveFileLocked(destination.resolved, quarantinePaths.dataPath, {
                            overwrite: false,
                        });
                    }
                    if (backupMoved && backupPath) {
                        await runtime.io.moveFileLocked(backupPath, destination.resolved, { overwrite: false });
                    }
                    await writeQuarantineMetadata(runtime, metadata, quarantinePaths.metadataPath);
                } catch (rollbackError) {
                    throw createQuarantineRollbackError(error, rollbackError, 'Quarantine restore');
                }
                throw error;
            }
        },
        {
            operation: 'quarantine-restore',
            target: quarantinePaths.metadataPath,
            riskClass: 'high',
        },
    );
    return value;
}

/**
 * @param {Record<string, unknown>} args
 * @param {Record<string, unknown>[]} operations
 */
function resolvePatchBatchResultMode(args, operations) {
    const requestedResultMode = args['resultMode'] === 'detailed' ? 'detailed' : 'compact';
    const forcedByDiffPreview = operations.some((operation) => operation['includeDiffPreview'] === true);
    return {
        requestedResultMode,
        resultMode: forcedByDiffPreview ? 'detailed' : requestedResultMode,
        forcedByDiffPreview,
    };
}

/** @param {Record<string, unknown>} row */
function compactPatchBatchSuccessRow(row) {
    return {
        index: row['index'],
        success: true,
        path: row['path'],
        noop: row['noop'] === true,
        replacedOccurrences: row['replacedOccurrences'],
        ...(typeof row['expectedHashMode'] === 'string' ? { expectedHashMode: row['expectedHashMode'] } : {}),
    };
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {boolean} dryRun
 */
function summarizePatchBatchTargets(rows, dryRun) {
    /** @type {Map<string, Record<string, unknown>[]>} */
    const groups = new Map();
    for (const row of rows) {
        if (row['success'] !== true || typeof row['path'] !== 'string') continue;
        const group = groups.get(row['path']) ?? [];
        group.push(row);
        groups.set(row['path'], group);
    }
    return [...groups.entries()].map(([path, group]) => {
        const ordered = [...group].sort((left, right) => Number(left['index'] ?? 0) - Number(right['index'] ?? 0));
        const first = /** @type {Record<string, unknown>} */ (ordered[0] ?? {});
        const last = /** @type {Record<string, unknown>} */ (ordered.at(-1) ?? {});
        const traceId = ordered.find((row) => typeof row['traceId'] === 'string')?.['traceId'];
        const replacedOccurrences = ordered.reduce((sum, row) => sum + Number(row['replacedOccurrences'] ?? 0), 0);
        return {
            path,
            operationIndices: ordered.map((row) => Number(row['index'] ?? 0)),
            operationCount: ordered.length,
            noopCount: ordered.filter((row) => row['noop'] === true).length,
            replacedOccurrences,
            ...(typeof first['expectedHashMode'] === 'string' ? { expectedHashMode: first['expectedHashMode'] } : {}),
            ...(typeof first['previousHash'] === 'string' ? { initialHash: first['previousHash'] } : {}),
            ...(typeof (dryRun ? last['projectedHash'] : last['contentHash']) === 'string'
                ? { finalHash: dryRun ? last['projectedHash'] : last['contentHash'] }
                : {}),
            ...(Number.isFinite(Number(last['projectedBytes']))
                ? { projectedBytes: Number(last['projectedBytes']) }
                : {}),
            ...(!dryRun && Number.isFinite(Number(first['batchBytesWritten'] ?? last['bytesWritten']))
                ? { bytesWritten: Number(first['batchBytesWritten'] ?? last['bytesWritten']) }
                : {}),
            ...(typeof traceId === 'string' ? { traceId } : {}),
        };
    });
}

/** @param {Record<string, unknown>[]} operations */
function inspectPatchBatchEnvelope(operations) {
    /** @type {number} */
    let inputBytes;
    try {
        inputBytes = Buffer.byteLength(JSON.stringify(operations), 'utf8');
    } catch {
        return { ok: false, code: 'ERR_PATCH_BATCH_INPUT_SERIALIZATION', inputBytes: null, targetCount: 0 };
    }
    const targetCount = new Set(operations.map((operation) => String(operation['path'] ?? ''))).size;
    if (operations.length > MAX_PATCH_BATCH_OPERATIONS) {
        return { ok: false, code: 'ERR_PATCH_BATCH_OPERATION_LIMIT', inputBytes, targetCount };
    }
    if (targetCount > MAX_PATCH_BATCH_TARGETS) {
        return { ok: false, code: 'ERR_PATCH_BATCH_TARGET_LIMIT', inputBytes, targetCount };
    }
    if (inputBytes > MAX_PATCH_BATCH_INPUT_BYTES) {
        return { ok: false, code: 'ERR_PATCH_BATCH_INPUT_BYTES_LIMIT', inputBytes, targetCount };
    }
    return { ok: true, code: null, inputBytes, targetCount };
}

/**
 * @param {unknown} operation
 * @param {number} index
 * @param {{ virtualFiles: Map<string, { relative: string; bytes: number }> }} [context]
 * @returns {Promise<Record<string, unknown>>}
 */
async function previewBatchFileOperation(
    /** @type {RepoWriteRuntime} */ runtime,
    operation,
    index,
    context = { virtualFiles: new Map() },
) {
    const item = /** @type {Record<string, unknown>} */ (operation);
    const type = String(item['type'] ?? '');
    if (type === 'create_file') {
        const resolved = await runtime.workspace.resolveWritePath(String(item['path'] ?? ''));
        if (!resolved.ok) throw new Error(`operation ${index}: ${resolved.reason}`);
        const exists = await pathExists(runtime, resolved.resolved);
        const bytes = Buffer.byteLength(String(item['content'] ?? ''), 'utf8');
        if (!exists) context.virtualFiles.set(resolved.resolved, { relative: resolved.relative, bytes });
        return {
            index,
            type,
            path: resolved.relative,
            wouldCreate: !exists,
            destinationExists: exists,
            bytes,
        };
    }
    if (type === 'move_file') {
        // A move mutates the source as well as the destination. Preflight must therefore use write policy on both sides,
        // matching the actual move facade instead of producing a read-only false green for the source.
        const source = await runtime.workspace.resolveWritePath(String(item['source'] ?? ''));
        if (!source.ok) throw new Error(`operation ${index}: ${source.reason}`);
        const destination = await runtime.workspace.resolveWritePath(String(item['destination'] ?? ''));
        if (!destination.ok) throw new Error(`operation ${index}: ${destination.reason}`);
        const virtualSource = context.virtualFiles.get(source.resolved);
        const stats = virtualSource ? null : await repoWriteStat(runtime, source.resolved);
        const destinationExists = await pathExists(runtime, destination.resolved);
        const virtualDestinationExists = context.virtualFiles.has(destination.resolved);
        if ((destinationExists || virtualDestinationExists) && item['overwrite'] !== true) {
            throw new Error(`operation ${index}: destination already exists: ${destination.relative}`);
        }
        if (item['overwrite'] === true && item['confirmOverwrite'] !== true) {
            throw new Error(`operation ${index}: confirmOverwrite must be true when overwrite=true`);
        }
        if (virtualSource) {
            context.virtualFiles.delete(source.resolved);
            context.virtualFiles.set(destination.resolved, {
                relative: destination.relative,
                bytes: virtualSource.bytes,
            });
        }
        return {
            index,
            type,
            source: source.relative,
            destination: destination.relative,
            sourceBytes: virtualSource?.bytes ?? stats?.size ?? 0,
            destinationExists: destinationExists || virtualDestinationExists,
            overwrite: item['overwrite'] === true,
            virtualSource: Boolean(virtualSource),
        };
    }
    if (type === 'set_executable') {
        const resolved = await runtime.workspace.resolveWritePath(String(item['path'] ?? ''));
        if (!resolved.ok) throw new Error(`operation ${index}: ${resolved.reason}`);
        const stats = await repoWriteStat(runtime, resolved.resolved);
        if (!stats.isFile()) throw new Error(`operation ${index}: only regular files are supported`);
        const currentMode = stats.mode & 0o777;
        const targetMode = item['executable'] === true ? currentMode | 0o111 : currentMode & ~0o111;
        return {
            index,
            type,
            path: resolved.relative,
            executable: item['executable'] === true,
            currentMode: `0${currentMode.toString(8).padStart(3, '0')}`,
            targetMode: `0${targetMode.toString(8).padStart(3, '0')}`,
            wouldChange: targetMode !== currentMode,
            metadataOnly: true,
        };
    }
    if (type === 'quarantine_file' || type === 'remove_file') {
        const resolved = await runtime.workspace.resolveWritePath(String(item['path'] ?? ''));
        if (!resolved.ok) throw new Error(`operation ${index}: ${resolved.reason}`);
        const stats = await repoWriteStat(runtime, resolved.resolved);
        if (!stats.isFile()) throw new Error(`operation ${index}: only regular files are supported`);
        return {
            index,
            type,
            path: resolved.relative,
            bytes: stats.size,
            destructive: type === 'remove_file',
            reversible: type === 'quarantine_file',
        };
    }
    throw new Error(`operation ${index}: unsupported batch operation type`);
}

/**
 * Run the global file-batch preview without discarding already-computed evidence when a later operation fails.
 *
 * @param {unknown[]} operations
 * @returns {Promise<{
 *     success: boolean;
 *     previews: Record<string, unknown>[];
 *     failureIndex: number;
 *     error: string | null;
 *     durationMs: number;
 * }>}
 */
async function runFileBatchPreflight(/** @type {RepoWriteRuntime} */ runtime, operations) {
    const startedAt = performance.now();
    /** @type {Record<string, unknown>[]} */
    const previews = [];
    const previewContext = { virtualFiles: new Map() };
    for (const [index, operation] of operations.entries()) {
        try {
            previews.push(await previewBatchFileOperation(runtime, operation, index, previewContext));
        } catch (error) {
            return {
                success: false,
                previews,
                failureIndex: index,
                error: error instanceof Error ? error.message : String(error),
                durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
            };
        }
    }
    return {
        success: true,
        previews,
        failureIndex: -1,
        error: null,
        durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
    };
}

/**
 * @param {unknown} operation
 * @param {number} index
 * @returns {Promise<Record<string, unknown>>}
 */
async function applyBatchFileOperation(/** @type {RepoWriteRuntime} */ runtime, operation, index) {
    const item = /** @type {Record<string, unknown>} */ (operation);
    const type = String(item['type'] ?? '');
    if (type === 'create_file') {
        const resolved = await runtime.workspace.resolveWritePath(String(item['path'] ?? ''), {
            issueMutableCapability: true,
        });
        if (!resolved.ok) throw new Error(`operation ${index}: ${resolved.reason}`);
        const content = String(item['content'] ?? '');
        const write = await createResolvedTarget(runtime, resolved, content, {
            encoding: 'utf8',
            createParentDirs: item['createParentDirs'] !== false,
            failIfExists: true,
            ...durabilityOption(item['durability']),
            riskClass: 'medium',
            advisoryLimits: { tool: 'repo_apply_file_batch', operation: type, contentChars: content.length },
        });
        return {
            index,
            type,
            path: resolved.relative,
            bytesWritten: write.bytesWritten,
            contentHash: write.contentHash,
            traceId: write.io.traceId ?? null,
        };
    }
    if (type === 'move_file') {
        const source = await runtime.workspace.resolveWritePath(String(item['source'] ?? ''), {
            issueMutableCapability: true,
        });
        if (!source.ok) throw new Error(`operation ${index}: ${source.reason}`);
        const destination = await runtime.workspace.resolveWritePath(String(item['destination'] ?? ''), {
            issueMutableCapability: true,
        });
        if (!destination.ok) throw new Error(`operation ${index}: ${destination.reason}`);
        if (item['overwrite'] === true && item['confirmOverwrite'] !== true) {
            throw new Error(`operation ${index}: confirmOverwrite must be true when overwrite=true`);
        }
        const moved = await moveResolvedTargets(runtime, source, destination, {
            overwrite: item['overwrite'] === true,
        });
        return {
            index,
            type,
            source: source.relative,
            destination: destination.relative,
            sourceBytes: moved.sourceBytes,
            sourceHash: moved.sourceHash,
            destinationPreviousHash: moved.destinationPreviousHash,
            traceId: moved.io.traceId ?? null,
        };
    }
    if (type === 'set_executable') {
        const resolved = await runtime.workspace.resolveWritePath(String(item['path'] ?? ''), {
            issueMutableCapability: true,
        });
        if (!resolved.ok) throw new Error(`operation ${index}: ${resolved.reason}`);
        const stats = await repoWriteStat(runtime, resolved.resolved);
        if (!stats.isFile()) throw new Error(`operation ${index}: only regular files are supported`);
        const currentMode = stats.mode & 0o777;
        const targetMode = item['executable'] === true ? currentMode | 0o111 : currentMode & ~0o111;
        const changed = resolved.validatedWritePath
            ? await runtime.io.chmodFileLockedValidated(resolved.validatedWritePath, targetMode, {
                  riskClass: 'medium',
                  advisoryLimits: { tool: 'repo_apply_file_batch', operation: type },
              })
            : await runtime.io.chmodFileLocked(resolved.resolved, targetMode, {
                  riskClass: 'medium',
                  advisoryLimits: { tool: 'repo_apply_file_batch', operation: type },
              });
        return {
            index,
            type,
            path: resolved.relative,
            executable: item['executable'] === true,
            previousMode: `0${changed.previousMode.toString(8).padStart(3, '0')}`,
            mode: `0${changed.mode.toString(8).padStart(3, '0')}`,
            changed: changed.changed,
            metadataOnly: true,
            lockWaitMs: changed.lockWaitMs,
            traceId: changed.io.traceId ?? null,
        };
    }
    if (type === 'quarantine_file') {
        const resolved = await runtime.workspace.resolveWritePath(String(item['path'] ?? ''));
        if (!resolved.ok) throw new Error(`operation ${index}: ${resolved.reason}`);
        const stats = await repoWriteStat(runtime, resolved.resolved);
        if (!stats.isFile()) throw new Error(`operation ${index}: only regular files are supported`);
        const { metadata, moved } = await quarantineResolvedFile(runtime, resolved);
        return { index, type, path: resolved.relative, ...metadata, traceId: moved.io.traceId ?? null };
    }
    if (type === 'remove_file') {
        if (item['confirm'] !== true) throw new Error(`operation ${index}: confirm must be true for remove_file`);
        const resolved = await runtime.workspace.resolveWritePath(String(item['path'] ?? ''));
        if (!resolved.ok) throw new Error(`operation ${index}: ${resolved.reason}`);
        const stats = await repoWriteStat(runtime, resolved.resolved);
        if (!stats.isFile()) throw new Error(`operation ${index}: only regular files are supported`);
        const removed = await runtime.io.deleteFileLocked(resolved.resolved);
        return {
            index,
            type,
            path: resolved.relative,
            deleted: removed.deleted,
            previousHash: removed.previousHash,
            previousBytes: removed.previousBytes,
            rollbackCaptureEnabled: removed.rollbackCaptureEnabled,
            rollbackSnapshotAvailable:
                typeof removed.previousSnapshotBase64 === 'string' || removed.previousRollbackSidecar != null,
            previousSnapshotTruncated: removed.previousSnapshotTruncated,
            rollbackSidecarExpiresAtMs: removed.previousRollbackSidecar?.expiresAtMs ?? null,
            traceId: removed.io.traceId ?? null,
        };
    }
    throw new Error(`operation ${index}: unsupported batch operation type`);
}

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition[]}
 */
export const repoWriteTools = [
    {
        name: 'repo_patch_batch_plan',
        title: 'Plan repository patch batch',
        description:
            'Plan a bounded batch of exact-string repository patches without modifying files. Repeated paths are evaluated sequentially against one virtual file state.',
        inputSchema: {
            operations: z
                .array(patchBatchOperationSchema)
                .min(1)
                .max(MAX_PATCH_BATCH_OPERATIONS)
                ['describe'](
                    'Patch operations to validate in order. This tool never writes; max 128 operations / 64 targets.',
                ),
            targetConcurrency: z
                .number()
                .int()
                .min(1)
                .max(MAX_PATCH_TARGET_CONCURRENCY)
                .optional()
                ['describe'](
                    'Parallel target groups during planning. Default: 4; same-file operations remain sequential.',
                ),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ operations, targetConcurrency }, operationContext) => {
            const runtime = createRepoWriteRuntime(requireMcpToolWorkspace(operationContext));
            const normalizedOperations = /** @type {Record<string, unknown>[]} */ (operations);
            const envelope = inspectPatchBatchEnvelope(normalizedOperations);
            if (!envelope.ok) {
                return errorResult('Patch batch exceeds its bounded execution envelope.', {
                    code: envelope.code,
                    operationCount: normalizedOperations.length,
                    targetCount: envelope.targetCount,
                    inputBytes: envelope.inputBytes,
                    limits: {
                        operations: MAX_PATCH_BATCH_OPERATIONS,
                        targets: MAX_PATCH_BATCH_TARGETS,
                        inputBytes: MAX_PATCH_BATCH_INPUT_BYTES,
                    },
                });
            }
            const run = await runRepositoryPatchTargetGroups(runtime.workspace, normalizedOperations, true, {
                failureMode: 'best-effort',
                concurrency: targetConcurrency ?? DEFAULT_PATCH_PLAN_CONCURRENCY,
            });
            const planned = run.operations;
            const failed = planned.filter((operation) => operation['success'] !== true);
            const failureSummary = summarizeRepositoryPatchFailures(failed);
            await appendMcpAuditEvent({
                event: 'repo_patch_batch_plan',
                tool: 'repo_patch_batch_plan',
                operationCount: planned.length,
                targetCount: envelope.targetCount,
                failedCount: failed.length,
                executionId: run.execution.executionId,
            });
            const structured = {
                success: failed.length === 0,
                plannedTool: 'repo_apply_patch_batch',
                dryRun: true,
                executionId: run.execution.executionId,
                operationCount: planned.length,
                targetCount: envelope.targetCount,
                inputBytes: envelope.inputBytes,
                failedCount: failed.length,
                concurrency: run.execution.concurrency,
                maxInFlight: run.execution.maxInFlight,
                durationMs: run.execution.durationMs,
                operations: planned,
                nextCall:
                    failed.length === 0
                        ? {
                              tool: 'repo_apply_patch_batch',
                              args: {
                                  operations,
                                  dryRun: false,
                                  confirmBatch: true,
                                  applyMode: 'per-target-fast',
                                  failureMode: 'best-effort',
                              },
                          }
                        : null,
            };
            const text =
                failed.length === 0
                    ? `Planned ${planned.length} patch operation(s) across ${envelope.targetCount} target(s); no files modified.`
                    : `Planned ${planned.length} patch operation(s) with ${failed.length} failure(s); no files modified.`;
            const result = withResultSizeHint(okResult(structured, text), {
                bytes: estimateStructuredTextResultBytes(structured, text),
                strategy: 'conservative-estimate',
                source: 'repo_patch_batch_plan',
            });
            return withResultExecutionHint(result, {
                logicalOperations: normalizedOperations.length,
                failedOperations: failureSummary.causalFailureCount,
                skippedOperations: failureSummary.abortedOperationCount,
                mode: 'patch-plan:best-effort',
            });
        },
    },
    {
        name: 'repo_apply_patch_batch',
        title: 'Apply repository patch batch',
        description:
            'Dry-run or apply a bounded exact-string patch batch. Real writes require confirmBatch=true; repeated paths are sequential and atomic per file. Direct apply defaults to independent per-target atomic progress without a duplicate global preview; global-preflight remains opt-in when all-target preview gating is desired.',
        inputSchema: {
            operations: z
                .array(patchBatchOperationSchema)
                .min(1)
                .max(MAX_PATCH_BATCH_OPERATIONS)
                ['describe']('Patch operations to validate or apply; max 128 operations / 64 targets / 3 MiB input.'),
            dryRun: z.boolean().optional()['describe']('Validate all operations without writing. Default: true.'),
            confirmBatch: z
                .boolean()
                .optional()
                ['describe']('Must be true when dryRun=false because this applies multiple patches.'),
            applyMode: z
                .enum(['global-preflight', 'per-target-fast'])
                .optional()
                ['describe'](
                    'Apply policy. Default per-target-fast applies independent target groups directly with atomic compute-before-write per file. global-preflight is opt-in and blocks all writes when any preview target already fails.',
                ),
            failureMode: z
                .enum(['best-effort', 'fail-fast'])
                .optional()
                ['describe'](
                    'Target failure policy during apply. Defaults best-effort for the default per-target-fast mode; global-preflight defaults fail-fast after its preview gate.',
                ),
            targetConcurrency: z
                .number()
                .int()
                .min(1)
                .max(MAX_PATCH_TARGET_CONCURRENCY)
                .optional()
                ['describe'](
                    'Parallel independent targets. Defaults 4 in per-target-fast; global-preflight apply uses 1 unless explicitly raised.',
                ),
            resultMode: z
                .enum(['compact', 'detailed'])
                .optional()
                ['describe'](
                    'Successful operation result detail. Default compact; detailed preserves full per-operation hashes/line/byte metadata. includeDiffPreview forces detailed.',
                ),
            includePreflightDetails: z
                .boolean()
                .optional()
                ['describe'](
                    'Echo full successful preflight rows in real apply output. Default false to avoid payload duplication.',
                ),
            postValidate: z
                .array(postPatchValidationRequestSchema)
                .min(1)
                .max(MAX_POST_PATCH_VALIDATORS)
                .optional()
                ['describe'](
                    'Optional allowlisted post-write validators executed in this same tool call; max 4. Dry-run only validates this plan and never starts jobs.',
                ),
            postValidateOnPartial: z
                .boolean()
                .optional()
                ['describe'](
                    'Run postValidate even after partial patch application. Default false; otherwise validation is skipped on partial apply.',
                ),
            durability: durabilitySchema,
        },
        annotations: boundedWriteAnnotations(),
        handler: async (
            {
                operations,
                dryRun,
                confirmBatch,
                applyMode,
                failureMode,
                targetConcurrency,
                resultMode,
                includePreflightDetails,
                postValidate,
                postValidateOnPartial,
                durability,
            },
            operationContext,
        ) => {
            const runtime = createRepoWriteRuntime(requireMcpToolWorkspace(operationContext));
            const isDryRun = resolveBatchDryRun(dryRun, confirmBatch);
            let postValidationRequests;
            try {
                postValidationRequests = normalizePostPatchValidationRequests(postValidate ?? []);
            } catch (error) {
                return errorResult('Invalid postValidate configuration; no files were modified.', {
                    code: 'ERR_POST_PATCH_VALIDATION_CONFIG',
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            if (postValidationRequests.length > 0 && !canRunCopilotValidatorInline()) {
                return errorResult('postValidate is disabled inside test runners; no files were modified.', {
                    code: 'ERR_POST_PATCH_VALIDATION_RECURSION_GUARD',
                    requestedCount: postValidationRequests.length,
                });
            }
            const normalizedOperations = /** @type {Record<string, unknown>[]} */ (
                operations.map((/** @type {Record<string, unknown>} */ operation) => ({
                    ...operation,
                    ...(durability ? { durability } : {}),
                }))
            );
            const resultSurface = resolvePatchBatchResultMode({ resultMode }, normalizedOperations);
            const envelope = inspectPatchBatchEnvelope(normalizedOperations);
            if (!envelope.ok) {
                return errorResult('Patch batch exceeds its bounded execution envelope.', {
                    code: envelope.code,
                    operationCount: normalizedOperations.length,
                    targetCount: envelope.targetCount,
                    inputBytes: envelope.inputBytes,
                    limits: {
                        operations: MAX_PATCH_BATCH_OPERATIONS,
                        targets: MAX_PATCH_BATCH_TARGETS,
                        inputBytes: MAX_PATCH_BATCH_INPUT_BYTES,
                    },
                });
            }
            const effectiveApplyMode = applyMode ?? 'per-target-fast';
            const effectiveFailureMode =
                failureMode ?? (effectiveApplyMode === 'per-target-fast' ? 'best-effort' : 'fail-fast');
            const effectiveConcurrency =
                targetConcurrency ?? (effectiveApplyMode === 'per-target-fast' ? DEFAULT_PATCH_FAST_CONCURRENCY : 1);

            if (isDryRun) {
                const dryRunResult = await runRepositoryPatchTargetGroups(
                    runtime.workspace,
                    normalizedOperations,
                    true,
                    {
                        failureMode: 'best-effort',
                        concurrency: targetConcurrency ?? DEFAULT_PATCH_PLAN_CONCURRENCY,
                    },
                );
                const failed = dryRunResult.operations.filter((operation) => operation['success'] !== true);
                const failureSummary = summarizeRepositoryPatchFailures(failed);
                const outputFailures =
                    resultSurface.resultMode === 'detailed' ? failed : compactRepositoryPatchFailureRows(failed);
                const outputOperations =
                    resultSurface.resultMode === 'detailed'
                        ? dryRunResult.operations
                        : dryRunResult.operations
                              .filter((operation) => operation['success'] === true)
                              .map((operation) => compactPatchBatchSuccessRow(operation));
                const targetSummaries = summarizePatchBatchTargets(dryRunResult.operations, true);
                const structured = {
                    success: failed.length === 0,
                    dryRun: true,
                    applyMode: effectiveApplyMode,
                    executionId: dryRunResult.execution.executionId,
                    operationCount: normalizedOperations.length,
                    targetCount: envelope.targetCount,
                    inputBytes: envelope.inputBytes,
                    failedCount: failed.length,
                    reportedFailureCount: outputFailures.length,
                    ...(failed.length > 0 ? { failureSummary } : {}),
                    skippedCount: dryRunResult.execution.skippedCount,
                    concurrency: dryRunResult.execution.concurrency,
                    durationMs: dryRunResult.execution.durationMs,
                    requestedResultMode: resultSurface.requestedResultMode,
                    resultMode: resultSurface.resultMode,
                    resultModeForcedByDiffPreview: resultSurface.forcedByDiffPreview,
                    detailsAvailable: true,
                    targetSummaries,
                    postValidation: {
                        requestedCount: postValidationRequests.length,
                        ran: false,
                        skipped: postValidationRequests.length > 0,
                        skippedReason:
                            postValidationRequests.length > 0 ? 'dry-run-does-not-start-validator-jobs' : null,
                        validators: postValidationRequests.map((request) => request.validator),
                    },
                    operations: outputOperations,
                    failures: outputFailures,
                    applied: [],
                };
                const text =
                    failed.length === 0
                        ? `Patch batch dry-run succeeded for ${normalizedOperations.length} operation(s); no files modified.`
                        : `Patch batch dry-run found ${failureSummary.causalFailureCount} causal target failure(s) affecting ${failureSummary.failedOperationCount} operation(s); no files modified.`;
                const result = withResultSizeHint(okResult(structured, text), {
                    bytes: estimateStructuredTextResultBytes(structured, text),
                    strategy: 'conservative-estimate',
                    source: 'repo_apply_patch_batch',
                });
                return withResultExecutionHint(result, {
                    logicalOperations: normalizedOperations.length,
                    failedOperations: failureSummary.causalFailureCount,
                    skippedOperations: dryRunResult.execution.skippedCount + failureSummary.abortedOperationCount,
                    mode: 'patch-dry-run:best-effort',
                });
            }

            if (confirmBatch !== true) {
                return errorResult('confirmBatch must be true when dryRun=false.', {
                    code: 'ERR_PATCH_BATCH_CONFIRM_REQUIRED',
                    operationCount: normalizedOperations.length,
                    applyMode: effectiveApplyMode,
                });
            }

            const singleTargetAtomicPreflightElision =
                effectiveApplyMode === 'global-preflight' && envelope.targetCount === 1;
            const directFastPreflightElision = effectiveApplyMode === 'per-target-fast';
            const preflightElided = singleTargetAtomicPreflightElision || directFastPreflightElision;
            const preflightElisionReason = directFastPreflightElision
                ? 'per-target-fast-direct-atomic-apply'
                : singleTargetAtomicPreflightElision
                  ? 'single-target-atomic-compute-before-write'
                  : null;
            let preflight = null;
            if (effectiveApplyMode === 'global-preflight' && !singleTargetAtomicPreflightElision) {
                preflight = await runRepositoryPatchTargetGroups(runtime.workspace, normalizedOperations, true, {
                    failureMode: 'best-effort',
                    concurrency: targetConcurrency ?? DEFAULT_PATCH_PLAN_CONCURRENCY,
                });
                const failedPreflight = preflight.operations.filter((operation) => operation['success'] !== true);
                if (failedPreflight.length > 0) {
                    const failureSummary = summarizeRepositoryPatchFailures(failedPreflight);
                    const outputFailures =
                        resultSurface.resultMode === 'detailed'
                            ? failedPreflight
                            : compactRepositoryPatchFailureRows(failedPreflight);
                    const structured = {
                        success: false,
                        dryRun: false,
                        applyMode: effectiveApplyMode,
                        preflightBlockedApply: true,
                        operationCount: normalizedOperations.length,
                        targetCount: envelope.targetCount,
                        inputBytes: envelope.inputBytes,
                        requestedResultMode: resultSurface.requestedResultMode,
                        resultMode: resultSurface.resultMode,
                        resultModeForcedByDiffPreview: resultSurface.forcedByDiffPreview,
                        detailsAvailable: true,
                        failedCount: failedPreflight.length,
                        reportedFailureCount: outputFailures.length,
                        failureSummary,
                        skippedCount: 0,
                        preflightSummary: {
                            ran: true,
                            success: false,
                            executionId: preflight.execution.executionId,
                            failedCount: failedPreflight.length,
                            durationMs: preflight.execution.durationMs,
                        },
                        preflight: includePreflightDetails === true ? preflight.operations : [],
                        applied: [],
                        failures: outputFailures,
                    };
                    await appendMcpAuditEvent({
                        event: 'repo_apply_patch_batch_preflight_blocked',
                        tool: 'repo_apply_patch_batch',
                        applyMode: effectiveApplyMode,
                        operationCount: normalizedOperations.length,
                        targetCount: envelope.targetCount,
                        causalFailureCount: failureSummary.causalFailureCount,
                        failedTargetCount: failureSummary.failedTargetCount,
                        abortedOperationCount: failureSummary.abortedOperationCount,
                        recoveryRequiredTargetCount: failureSummary.recoveryRequiredTargetCount,
                        convergenceCandidateCount: failureSummary.convergenceCandidateCount,
                        causalByCode: failureSummary.causalByCode,
                        failureClassCounts: failureSummary.failureClassCounts,
                        retryabilityCounts: failureSummary.retryabilityCounts,
                    });
                    const text = `Global preflight found ${failureSummary.causalFailureCount} causal target failure(s) affecting ${failureSummary.failedOperationCount} operation(s); no files modified.`;
                    const result = withResultSizeHint(okResult(structured, text), {
                        bytes: estimateStructuredTextResultBytes(structured, text),
                        strategy: 'conservative-estimate',
                        source: 'repo_apply_patch_batch',
                    });
                    return withResultExecutionHint(result, {
                        logicalOperations: normalizedOperations.length,
                        failedOperations: failureSummary.causalFailureCount,
                        skippedOperations: failureSummary.abortedOperationCount,
                        mode: 'patch-apply:global-preflight-blocked',
                    });
                }
            }

            const applyRun = await runRepositoryPatchTargetGroups(runtime.workspace, normalizedOperations, false, {
                failureMode: effectiveFailureMode,
                concurrency: effectiveConcurrency,
            });
            const applied = applyRun.operations;
            const succeeded = applied.filter((operation) => operation['success'] === true);
            const skipped = applied.filter((operation) => operation['skipped'] === true);
            const failedApply = applied.filter(
                (operation) => operation['success'] !== true && operation['skipped'] !== true,
            );
            const partial = succeeded.length > 0 && (failedApply.length > 0 || skipped.length > 0);
            const failureSummary = summarizeRepositoryPatchFailures(failedApply);
            const outputFailures =
                resultSurface.resultMode === 'detailed' ? failedApply : compactRepositoryPatchFailureRows(failedApply);
            const targetSummaries = summarizePatchBatchTargets(succeeded, false);
            const outputApplied =
                resultSurface.resultMode === 'detailed'
                    ? applied
                    : succeeded.map((operation) => compactPatchBatchSuccessRow(operation));
            const patchFullyApplied = failedApply.length === 0 && skipped.length === 0;
            await appendMcpAuditEvent({
                event: patchFullyApplied ? 'repo_apply_patch_batch_applied' : 'repo_apply_patch_batch_partial_failure',
                tool: 'repo_apply_patch_batch',
                executionId: applyRun.execution.executionId,
                applyMode: effectiveApplyMode,
                failureMode: effectiveFailureMode,
                operationCount: normalizedOperations.length,
                targetCount: envelope.targetCount,
                resultMode: resultSurface.resultMode,
                preflightElided,
                appliedCount: succeeded.length,
                failedCount: failedApply.length,
                skippedCount: skipped.length,
                partial,
                workflowSuccess: patchFullyApplied,
                causalFailureCount: failureSummary.causalFailureCount,
                failedTargetCount: failureSummary.failedTargetCount,
                abortedOperationCount: failureSummary.abortedOperationCount,
                recoveryRequiredTargetCount: failureSummary.recoveryRequiredTargetCount,
                convergenceCandidateCount: failureSummary.convergenceCandidateCount,
                causalByCode: failureSummary.causalByCode,
                failureClassCounts: failureSummary.failureClassCounts,
                retryabilityCounts: failureSummary.retryabilityCounts,
            });
            let postValidation = {
                requestedCount: postValidationRequests.length,
                ran: false,
                skipped: false,
                skippedReason: /** @type {string | null} */ (null),
                allPassed: /** @type {boolean | null} */ (null),
                failedCount: 0,
                durationMs: 0,
                results: /** @type {Record<string, unknown>[]} */ ([]),
            };
            if (postValidationRequests.length > 0) {
                if (!patchFullyApplied && postValidateOnPartial !== true) {
                    postValidation = {
                        ...postValidation,
                        skipped: true,
                        skippedReason: 'partial-patch-apply',
                    };
                } else {
                    postValidation = await runPostPatchValidations(postValidationRequests, runtime.workspace);
                }
                await appendMcpAuditEvent({
                    event: 'repo_apply_patch_batch_post_validation',
                    tool: 'repo_apply_patch_batch',
                    executionId: applyRun.execution.executionId,
                    patchFullyApplied,
                    requestedCount: postValidation.requestedCount,
                    ran: postValidation.ran,
                    skipped: postValidation.skipped,
                    skippedReason: postValidation.skippedReason ?? null,
                    allPassed: postValidation.allPassed,
                    failedCount: postValidation.failedCount,
                    durationMs: postValidation.durationMs,
                });
            }
            const structured = {
                success: patchFullyApplied,
                workflowSuccess: patchFullyApplied && postValidation.allPassed !== false,
                partial,
                dryRun: false,
                applyMode: effectiveApplyMode,
                failureMode: effectiveFailureMode,
                executionId: applyRun.execution.executionId,
                operationCount: normalizedOperations.length,
                targetCount: envelope.targetCount,
                inputBytes: envelope.inputBytes,
                appliedCount: succeeded.length,
                failedCount: failedApply.length,
                reportedFailureCount: outputFailures.length,
                ...(failedApply.length > 0 ? { failureSummary } : {}),
                skippedCount: skipped.length,
                concurrency: applyRun.execution.concurrency,
                maxInFlight: applyRun.execution.maxInFlight,
                durationMs: applyRun.execution.durationMs,
                workflowDurationMs: applyRun.execution.durationMs + postValidation.durationMs,
                requestedResultMode: resultSurface.requestedResultMode,
                resultMode: resultSurface.resultMode,
                resultModeForcedByDiffPreview: resultSurface.forcedByDiffPreview,
                detailsAvailable: true,
                targetSummaries,
                preflightElided,
                preflightElisionReason,
                preflightSummary: preflight
                    ? {
                          ran: true,
                          success: true,
                          executionId: preflight.execution.executionId,
                          failedCount: 0,
                          durationMs: preflight.execution.durationMs,
                      }
                    : { ran: false, success: null, executionId: null, failedCount: 0, durationMs: 0 },
                preflight: includePreflightDetails === true ? (preflight?.operations ?? []) : [],
                postValidation,
                applied: outputApplied,
                failures: outputFailures,
                skipped,
            };
            const patchText = structured.success
                ? `Applied ${succeeded.length} patch operation(s) across ${envelope.targetCount} target(s).`
                : `Patch batch completed partially: ${succeeded.length} applied, ${failureSummary.causalFailureCount} causal target failure(s) affecting ${failureSummary.failedOperationCount} operation(s), ${skipped.length} skipped.`;
            const validationText =
                postValidation.requestedCount === 0
                    ? ''
                    : postValidation.skipped
                      ? ` Post-validation skipped (${postValidation.skippedReason}); patch results above are unchanged.`
                      : postValidation.allPassed
                        ? ` Post-validation passed ${postValidation.requestedCount}/${postValidation.requestedCount} requested validator(s) in the same call.`
                        : ` Post-validation reported ${postValidation.failedCount} non-passing validator(s); patches remain applied and must not be retried blindly.`;
            const text = `${patchText}${validationText}`;
            const result = withResultSizeHint(okResult(structured, text), {
                bytes: estimateStructuredTextResultBytes(structured, text),
                strategy: 'conservative-estimate',
                source: 'repo_apply_patch_batch',
            });
            return withResultExecutionHint(result, {
                logicalOperations:
                    normalizedOperations.length + (postValidation.ran ? postValidation.requestedCount : 0),
                failedOperations:
                    failureSummary.causalFailureCount + (postValidation.ran ? postValidation.failedCount : 0),
                skippedOperations:
                    skipped.length +
                    failureSummary.abortedOperationCount +
                    (postValidation.skipped ? postValidation.requestedCount : 0),
                mode: `patch-apply:${effectiveApplyMode}:${effectiveFailureMode}${postValidation.ran ? ':post-validated' : ''}`,
            });
        },
    },
    {
        name: 'repo_apply_file_batch_plan',
        title: 'Plan repository file batch',
        description:
            'Read-only plan for a bounded batch of workspace file operations. Does not modify files; use before repo_apply_file_batch to reduce high-risk prompts.',
        inputSchema: {
            operations: z
                .array(batchOperationSchema)
                .min(1)
                .max(MAX_BATCH_FILE_OPERATIONS)
                ['describe']('Ordered file operations to validate and preview.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ operations }, operationContext) => {
            const runtime = createRepoWriteRuntime(requireMcpToolWorkspace(operationContext));
            const preflight = await runFileBatchPreflight(runtime, operations);
            if (!preflight.success) {
                return errorResult(preflight.error ?? 'File-batch preflight failed.', {
                    code: 'ERR_BATCH_FILE_PLAN_FAILED',
                    operationCount: operations.length,
                    planned: preflight.previews,
                    plannedCount: preflight.previews.length,
                    failureIndex: preflight.failureIndex,
                    durationMs: preflight.durationMs,
                });
            }
            const previews = preflight.previews;
            await appendMcpAuditEvent({
                event: 'repo_apply_file_batch_plan',
                tool: 'repo_apply_file_batch_plan',
                operations: previews.map((preview) => preview['type']),
                operationCount: previews.length,
            });
            return okResult({
                success: true,
                plannedTool: 'repo_apply_file_batch',
                dryRun: true,
                operationCount: previews.length,
                durationMs: preflight.durationMs,
                operations: previews,
                applied: [],
                nextCall: {
                    tool: 'repo_apply_file_batch',
                    args: {
                        operations,
                        confirmBatch: true,
                    },
                },
            });
        },
    },
    {
        name: 'repo_apply_file_batch',
        title: 'Apply repository file batch',
        description:
            'Apply a bounded ordered batch of workspace file operations in one tool call. Supports create, move, quarantine, metadata-only executable-bit repair and explicit removal. Safe non-destructive sequences default to direct sequential apply; remove_file and overwrite moves retain a conservative whole-batch preflight unless applyMode is explicitly chosen.',
        inputSchema: {
            operations: z
                .array(batchOperationSchema)
                .min(1)
                .max(MAX_BATCH_FILE_OPERATIONS)
                ['describe']('Ordered file operations. Later operations can depend on earlier ones.'),
            dryRun: z
                .boolean()
                .optional()
                ['describe']('Validate and preview all operations without writing. Default: true.'),
            confirmBatch: z
                .boolean()
                .optional()
                ['describe'](
                    'Must be true when applying file operations; confirmBatch=true also survives adapters that omit dryRun=false.',
                ),
            applyMode: z
                .enum(['global-preflight', 'sequential-fast'])
                .optional()
                ['describe'](
                    'Adaptive default: sequential-fast for create/move-without-overwrite/quarantine sequences; global-preflight when remove_file or overwrite move is present. Explicit value overrides the adaptive choice.',
                ),
            includePreflightDetails: z
                .boolean()
                .optional()
                ['describe']('Include full successful preflight rows in a real apply response. Default: false.'),
        },
        annotations: destructiveAnnotations(),
        handler: async ({ operations, dryRun, confirmBatch, applyMode, includePreflightDetails }, operationContext) => {
            const runtime = createRepoWriteRuntime(requireMcpToolWorkspace(operationContext));
            const startedAt = performance.now();
            const isDryRun = resolveBatchDryRun(dryRun, confirmBatch);
            const applyModeDecision = resolveFileBatchApplyMode(
                /** @type {Record<string, unknown>[]} */ (operations),
                applyMode,
            );
            const effectiveApplyMode = applyModeDecision.mode;
            if (!isDryRun && confirmBatch !== true) {
                return errorResult('confirmBatch deve ser true quando aplicando operações de arquivo.', {
                    code: 'ERR_BATCH_CONFIRM_REQUIRED',
                    applyMode: effectiveApplyMode,
                    applyModeReason: applyModeDecision.reason,
                });
            }

            let preflight = null;
            if (isDryRun || effectiveApplyMode === 'global-preflight') {
                preflight = await runFileBatchPreflight(runtime, operations);
                if (!preflight.success) {
                    const skippedCount = Math.max(0, operations.length - preflight.previews.length - 1);
                    const result = errorResult(preflight.error ?? 'File-batch preflight failed.', {
                        code: 'ERR_BATCH_FILE_OPERATION_FAILED',
                        phase: 'preflight',
                        partial: false,
                        dryRun: isDryRun,
                        applyMode: effectiveApplyMode,
                        applyModeReason: applyModeDecision.reason,
                        conservativeOperationIndices: applyModeDecision.conservativeOperationIndices,
                        operationCount: operations.length,
                        planned: preflight.previews,
                        plannedCount: preflight.previews.length,
                        applied: [],
                        appliedCount: 0,
                        failedCount: 1,
                        failureIndex: preflight.failureIndex,
                        skippedCount,
                        timings: {
                            totalMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
                            preflightMs: preflight.durationMs,
                            applyMs: 0,
                        },
                        nextAction: 'No operation was applied; fix failureIndex and retry the batch.',
                    });
                    return withResultExecutionHint(result, {
                        logicalOperations: operations.length,
                        failedOperations: 1,
                        skippedOperations: skippedCount,
                        mode: 'file-batch:preflight-failure',
                    });
                }
            }

            if (isDryRun) {
                const previews = preflight?.previews ?? [];
                await appendMcpAuditEvent({
                    event: 'repo_apply_file_batch_dry_run',
                    tool: 'repo_apply_file_batch',
                    operations: previews.map((preview) => preview['type']),
                    operationCount: previews.length,
                });
                const result = okResult({
                    success: true,
                    dryRun: true,
                    applyMode: effectiveApplyMode,
                    applyModeReason: applyModeDecision.reason,
                    conservativeOperationIndices: applyModeDecision.conservativeOperationIndices,
                    operationCount: previews.length,
                    durationMs: preflight?.durationMs ?? 0,
                    operations: previews,
                    applied: [],
                });
                return withResultExecutionHint(result, {
                    logicalOperations: operations.length,
                    mode: 'file-batch:dry-run',
                });
            }

            const preflightSummary = {
                ran: Boolean(preflight),
                success: preflight?.success ?? null,
                plannedCount: preflight?.previews.length ?? 0,
                durationMs: preflight?.durationMs ?? 0,
            };
            const applyStartedAt = performance.now();
            /** @type {Record<string, unknown>[]} */
            const applied = [];
            let failureIndex = -1;
            try {
                for (const [index, operation] of operations.entries()) {
                    failureIndex = index;
                    applied.push(await applyBatchFileOperation(runtime, operation, index));
                }
            } catch (error) {
                const skippedCount = Math.max(0, operations.length - applied.length - 1);
                const partial = applied.length > 0;
                const result = errorResult(error instanceof Error ? error.message : String(error), {
                    code: 'ERR_BATCH_FILE_OPERATION_FAILED',
                    phase: 'apply',
                    partial,
                    dryRun: false,
                    applyMode: effectiveApplyMode,
                    applyModeReason: applyModeDecision.reason,
                    conservativeOperationIndices: applyModeDecision.conservativeOperationIndices,
                    operationCount: operations.length,
                    preflightSummary,
                    planned: includePreflightDetails === true ? (preflight?.previews ?? []) : [],
                    applied,
                    appliedCount: applied.length,
                    failedCount: 1,
                    failureIndex,
                    skippedCount,
                    timings: {
                        totalMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
                        preflightMs: preflightSummary.durationMs,
                        applyMs: Math.round((performance.now() - applyStartedAt) * 1000) / 1000,
                    },
                    nextAction: partial
                        ? 'Do not repeat already-applied operations; inspect failureIndex and retry only the failed/skipped suffix after reconciling current state.'
                        : 'No operation was applied; fix failureIndex and retry the batch.',
                });
                return withResultExecutionHint(result, {
                    logicalOperations: operations.length,
                    failedOperations: 1,
                    skippedOperations: skippedCount,
                    mode: `file-batch:${effectiveApplyMode}:apply-failure`,
                });
            }

            await appendMcpAuditEvent({
                event: 'repo_apply_file_batch_applied',
                tool: 'repo_apply_file_batch',
                applyMode: effectiveApplyMode,
                applyModeReason: applyModeDecision.reason,
                operations: applied.map((operation) => operation['type']),
                operationCount: applied.length,
            });
            const result = okResult({
                success: true,
                dryRun: false,
                applyMode: effectiveApplyMode,
                applyModeReason: applyModeDecision.reason,
                conservativeOperationIndices: applyModeDecision.conservativeOperationIndices,
                operationCount: applied.length,
                preflightSummary,
                planned: includePreflightDetails === true ? (preflight?.previews ?? []) : [],
                applied,
                appliedCount: applied.length,
                failedCount: 0,
                skippedCount: 0,
                timings: {
                    totalMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
                    preflightMs: preflightSummary.durationMs,
                    applyMs: Math.round((performance.now() - applyStartedAt) * 1000) / 1000,
                },
            });
            return withResultExecutionHint(result, {
                logicalOperations: operations.length,
                mode: `file-batch:${effectiveApplyMode}:apply`,
            });
        },
    },
    {
        name: 'repo_write_file',
        title: 'Write repository file',
        description:
            'Replace the full content of an existing UTF-8 workspace file. Returns hashes and a unified diff preview.',
        inputSchema: {
            path: z.string().min(1)['describe']('Workspace-relative existing file path.'),
            content: z.string()['describe']('Full replacement content.'),
            expectedHash: z.string().optional()['describe']('Expected SHA-256 of current file content.'),
            dryRun: z.boolean().optional()['describe']('Return diff and hashes without writing. Default: false.'),
            diffContextLines: z.number().int().min(0).max(20).optional()['describe']('Context lines in diff preview.'),
            maxDiffLines: z.number().int().min(1).max(2000).optional()['describe']('Maximum diff preview lines.'),
            includeDiffPreview: z
                .boolean()
                .optional()
                ['describe']('Include textual diffPreview in the tool result. Default: false.'),
            durability: durabilitySchema,
        },
        annotations: boundedWriteAnnotations(),
        handler: async (
            { path, content, expectedHash, dryRun, diffContextLines, maxDiffLines, includeDiffPreview, durability },
            operationContext,
        ) => {
            const runtime = createRepoWriteRuntime(requireMcpToolWorkspace(operationContext));
            const resolved = await runtime.workspace.resolveWritePath(path, {
                issueMutableCapability: dryRun !== true,
            });
            if (!resolved.ok) return errorResult(resolved.reason, resolved);

            try {
                const previous = await runtime.io.readText(resolved.resolved);
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
                            ...maybeDiffPreview(includeDiffPreview, diff),
                        },
                        includeDiffPreview === true ? diff.diff : 'Write dry run complete; diff preview suppressed.',
                    );
                }

                const write = await writeResolvedTarget(runtime, resolved, content, {
                    requireExists: true,
                    ...(typeof expectedHash === 'string' && expectedHash ? { expectedHash } : {}),
                    ...(durability ? { durability } : {}),
                    riskClass: 'high',
                    advisoryLimits: {
                        tool: 'repo_write_file',
                        contentChars: content.length,
                        expectedHash: expectedHash ?? null,
                    },
                });
                clearRepoReadFileResultCacheForResolvedPath(resolved.resolved);
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
                        ...maybeDiffPreview(includeDiffPreview, diff),
                        io: {
                            operation: write.io.operation,
                            targetKind: write.io.targetKind,
                            bytesWritten: write.io.bytesWritten,
                            durationMs: write.io.durationMs,
                            engine: write.io.engine,
                            traceId: write.io.traceId ?? null,
                        },
                    },
                    includeDiffPreview === true ? diff.diff : 'Write applied; diff preview suppressed.',
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
            path: z.string().min(1)['describe']('Workspace-relative file path to create.'),
            content: z.string().optional()['describe']('Initial UTF-8 content. Default: empty string.'),
            createParentDirs: z.boolean().optional()['describe']('Create parent directories. Default: true.'),
            dryRun: z.boolean().optional()['describe']('Validate and return diff without writing. Default: false.'),
            maxDiffLines: z.number().int().min(1).max(2000).optional()['describe']('Maximum diff preview lines.'),
            includeDiffPreview: z
                .boolean()
                .optional()
                ['describe']('Include textual diffPreview in the tool result. Default: false.'),
            durability: durabilitySchema,
        },
        annotations: boundedWriteAnnotations(),
        handler: async (
            { path, content, createParentDirs, dryRun, maxDiffLines, includeDiffPreview, durability },
            operationContext,
        ) => {
            const runtime = createRepoWriteRuntime(requireMcpToolWorkspace(operationContext));
            const resolved = await runtime.workspace.resolveWritePath(path, {
                issueMutableCapability: dryRun !== true,
            });
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
                            ...maybeDiffPreview(includeDiffPreview, diff),
                        },
                        includeDiffPreview === true
                            ? diff.diff
                            : 'Create file dry run complete; diff preview suppressed.',
                    );
                }

                const write = await createResolvedTarget(runtime, resolved, initialContent, {
                    encoding: 'utf8',
                    createParentDirs: createParentDirs !== false,
                    failIfExists: true,
                    ...(durability ? { durability } : {}),
                    riskClass: 'medium',
                    advisoryLimits: {
                        tool: 'repo_create_file',
                        contentChars: initialContent.length,
                    },
                });
                clearRepoReadFileResultCacheForResolvedPath(resolved.resolved);
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
                        ...maybeDiffPreview(includeDiffPreview, diff),
                        io: {
                            operation: write.io.operation,
                            targetKind: write.io.targetKind,
                            bytesWritten: write.io.bytesWritten,
                            durationMs: write.io.durationMs,
                            engine: write.io.engine,
                            traceId: write.io.traceId ?? null,
                        },
                    },
                    includeDiffPreview === true ? diff.diff : 'Create file applied; diff preview suppressed.',
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
            path: z.string().min(1)['describe']('Workspace-relative file path.'),
            old_string: z.string().min(1)['describe']('Exact text to replace. It must match once by default.'),
            new_string: z.string()['describe']('Replacement text. Use an empty string to delete matched text.'),
            replace_all: z.boolean().optional()['describe']('Replace every occurrence of old_string. Default: false.'),
            expected_occurrences: z
                .number()
                .int()
                .min(1)
                .optional()
                ['describe']('Require an exact occurrence count before applying.'),
            occurrence_index: z
                .number()
                .int()
                .min(1)
                .optional()
                ['describe']('1-based occurrence index to replace when old_string appears more than once.'),
            expectedHash: z.string().optional()['describe']('Expected SHA-256 of current file content.'),
            dryRun: z.boolean().optional()['describe']('Validate and return diff without writing. Default: false.'),
            allowNoop: z
                .boolean()
                .optional()
                ['describe']('Allow old_string and new_string to be identical. Default: false.'),
            diffContextLines: z.number().int().min(0).max(20).optional()['describe']('Context lines in diff preview.'),
            maxDiffLines: z.number().int().min(1).max(2000).optional()['describe']('Maximum diff preview lines.'),
            includeDiffPreview: z
                .boolean()
                .optional()
                ['describe']('Include textual diffPreview in the tool result. Default: false.'),
            durability: durabilitySchema,
        },
        annotations: boundedWriteAnnotations(),
        handler: async (
            {
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
                includeDiffPreview,
                durability,
            },
            operationContext,
        ) => {
            const runtime = createRepoWriteRuntime(requireMcpToolWorkspace(operationContext));
            const resolved = await runtime.workspace.resolveWritePath(path, { issueMutableCapability: true });
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            if (replace_all === true && occurrence_index !== undefined) {
                return errorResult('Use replace_all ou occurrence_index, nao ambos na mesma chamada.', {
                    code: 'ERR_PATCH_CONFLICTING_MODE',
                });
            }

            try {
                const patch = await patchResolvedTarget(runtime, resolved, {
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
                    captureRollback: false,
                    allowNoop: allowNoop === true,
                    diffContextLines: optionalInteger(diffContextLines) ?? 3,
                    maxDiffLines: optionalInteger(maxDiffLines) ?? 160,
                    computeDiff: includeDiffPreview === true,
                    ...createRepositoryPatchResultValidationOption(resolved.relative),
                    ...(durability ? { durability } : {}),
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
                if (!patch.dryRun) clearRepoReadFileResultCacheForResolvedPath(resolved.resolved);
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
                    workflowSuccess: true,
                    mutationState: patch.noop ? 'already-converged' : 'fully-applied',
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
                    ...maybeDiffPreview(includeDiffPreview, {
                        diff: patch.diffPreview,
                        truncated: patch.diffPreviewTruncated,
                        lines: patch.diffPreviewLines,
                        bytes: patch.diffPreviewBytes,
                        contextLines: patch.diffContextLines,
                    }),
                    io: {
                        operation: patch.io.operation,
                        targetKind: patch.io.targetKind,
                        bytesWritten: patch.io.bytesWritten,
                        durationMs: patch.io.durationMs,
                        engine: patch.io.engine,
                        traceId: patch.io.traceId ?? null,
                    },
                };
                const text =
                    includeDiffPreview === true
                        ? patch.diffPreview
                        : `Patch ${patch.dryRun ? 'planned' : 'applied'}: ${patch.replacedOccurrences} replacement(s), diff preview suppressed.`;
                return withResultSizeHint(okResult(structured, text), {
                    bytes: estimateStructuredTextResultBytes(structured, text),
                    strategy: 'conservative-estimate',
                    source: 'repo_apply_patch',
                });
            } catch (error) {
                const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
                const details = readRepositoryPatchErrorDetails(error);
                const semantics = classifyRepositoryPatchFailure(code, details, 'target');
                await appendMcpAuditEvent({
                    event: 'repo_apply_patch_failed',
                    tool: 'repo_apply_patch',
                    path: resolved.relative,
                    code: typeof code === 'string' ? code : 'ERR_PATCH_UNKNOWN',
                    failureClass: semantics.failureClass,
                    retryability: semantics.retryability,
                    mutationState: semantics.mutationState,
                    recoveryRequired: semantics.recoveryRequired,
                    convergenceCandidate: semantics.convergenceCandidate === true,
                });
                return errorResult(error instanceof Error ? error.message : String(error), {
                    path: resolved.relative,
                    code,
                    ...semantics,
                    ...(Object.keys(details).length > 0 ? { details } : {}),
                    nextAction: buildRepositoryPatchNextAction(code, details),
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
            source: z.string().min(1)['describe']('Workspace-relative existing source file.'),
            destination: z.string().min(1)['describe']('Workspace-relative destination path.'),
            overwrite: z.boolean().optional()['describe']('Overwrite destination if it exists. Default: false.'),
            confirmOverwrite: z
                .boolean()
                .optional()
                ['describe']('Must be true when overwrite is true because destination replacement is destructive.'),
            dryRun: z.boolean().optional()['describe']('Validate without moving. Default: false.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({ source, destination, overwrite, confirmOverwrite, dryRun }, operationContext) => {
            const runtime = createRepoWriteRuntime(requireMcpToolWorkspace(operationContext));
            const issueMutableCapability = dryRun !== true;
            const src = await runtime.workspace.resolveWritePath(source, { issueMutableCapability });
            if (!src.ok) return errorResult(src.reason, { ...src, field: 'source' });
            const dst = await runtime.workspace.resolveWritePath(destination, { issueMutableCapability });
            if (!dst.ok) return errorResult(dst.reason, { ...dst, field: 'destination' });
            if (overwrite === true && confirmOverwrite !== true) {
                return errorResult('confirmOverwrite deve ser true quando overwrite=true.', {
                    code: 'ERR_MOVE_CONFIRM_OVERWRITE_REQUIRED',
                });
            }

            try {
                const sourceStats = await repoWriteStat(runtime, src.resolved);
                const destinationExists = await pathExists(runtime, dst.resolved);
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

                const moved = await moveResolvedTargets(runtime, src, dst, { overwrite: overwrite === true });
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
        name: 'repo_list_quarantine',
        title: 'List quarantined repository files',
        description: 'List files currently known to the MCP quarantine area, including restored and restorable items.',
        inputSchema: {
            status: z
                .enum(['quarantined', 'restored', 'all'])
                .optional()
                ['describe']('Filter by status. Default: all.'),
            limit: z.number().int().min(1).max(200).optional()['describe']('Maximum items returned. Default: 50.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ status, limit }, operationContext) => {
            const runtime = createRepoWriteRuntime(requireMcpToolWorkspace(operationContext));
            const filter = status === 'quarantined' || status === 'restored' ? status : 'all';
            const max = Math.max(1, Math.min(200, Number(limit ?? 50)));
            const items = (await listQuarantineMetadata(runtime))
                .filter((item) => (filter === 'all' ? true : item.status === filter))
                .slice(0, max);
            return okResult({
                success: true,
                status: filter,
                count: items.length,
                items,
            });
        },
    },
    {
        name: 'repo_inspect_quarantined_file',
        title: 'Inspect quarantined repository file',
        description: 'Inspect metadata and current stored-object state for one item created by repo_quarantine_file.',
        inputSchema: {
            quarantineId: quarantineIdSchema.describe('quarantineId returned by repo_quarantine_file.'),
            includeHash: z
                .boolean()
                .optional()
                ['describe']('Compute SHA-256 for stored data if present. Default: true.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ quarantineId, includeHash }, operationContext) => {
            const runtime = createRepoWriteRuntime(requireMcpToolWorkspace(operationContext));
            const metadata = await readQuarantineMetadata(runtime, String(quarantineId));
            if (!metadata) {
                return errorResult('Quarantine metadata not found.', {
                    code: 'ERR_QUARANTINE_NOT_FOUND',
                    hint: 'Use repo_list_quarantine to discover available quarantineId values.',
                    quarantineId,
                });
            }
            const quarantinePaths = resolveQuarantinePaths(runtime, metadata.quarantineId);
            const dataExists = await regularFileExists(runtime, quarantinePaths.dataPath);
            const dataStats = dataExists ? await repoWriteStat(runtime, quarantinePaths.dataPath) : null;
            const dataHash =
                dataExists && includeHash !== false ? await sha256File(runtime, quarantinePaths.dataPath) : null;
            return okResult({
                success: true,
                quarantineId: metadata.quarantineId,
                metadata,
                dataExists,
                dataBytes: dataStats?.size ?? null,
                dataSha256: dataHash,
                restorable: metadata.status === 'quarantined' && dataExists,
            });
        },
    },
    {
        name: 'repo_quarantine_file',
        title: 'Quarantine repository file',
        description:
            'Move one workspace file to a reversible MCP quarantine area instead of deleting it. Returns a quarantineId for restore.',
        inputSchema: {
            path: z.string().min(1)['describe']('Workspace-relative file path to quarantine.'),
            dryRun: z.boolean().optional()['describe']('Validate without moving. Default: false.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({ path: inputPath, dryRun }, operationContext) => {
            const runtime = createRepoWriteRuntime(requireMcpToolWorkspace(operationContext));
            const resolved = await runtime.workspace.resolveWritePath(inputPath);
            if (!resolved.ok) return errorResult(resolved.reason, resolved);

            try {
                const stats = await repoWriteStat(runtime, resolved.resolved);
                if (!stats.isFile()) {
                    return errorResult('repo_quarantine_file move somente arquivos regulares.', {
                        path: resolved.relative,
                        code: 'ERR_QUARANTINE_NOT_FILE',
                    });
                }
                const quarantineId = buildQuarantineId(resolved.relative);
                const quarantinePaths = resolveQuarantinePaths(runtime, quarantineId);
                if (dryRun === true) {
                    await appendMcpAuditEvent({
                        event: 'repo_quarantine_file_dry_run',
                        tool: 'repo_quarantine_file',
                        path: resolved.relative,
                        quarantineId,
                        previousBytes: stats.size,
                    });
                    return okResult({
                        success: true,
                        dryRun: true,
                        path: resolved.relative,
                        quarantineId,
                        quarantinePath: runtime.workspace.toRelativePath(quarantinePaths.dataPath),
                        metadataPath: runtime.workspace.toRelativePath(quarantinePaths.metadataPath),
                        previousBytes: stats.size,
                    });
                }

                const { metadata, moved } = await quarantineResolvedFile(runtime, resolved);
                await appendMcpAuditEvent({
                    event: 'repo_quarantine_file_applied',
                    tool: 'repo_quarantine_file',
                    path: resolved.relative,
                    quarantineId: metadata.quarantineId,
                    quarantinePath: metadata.quarantinePath,
                    sourceHash: moved.sourceHash,
                    traceId: moved.io.traceId ?? null,
                });
                return okResult({
                    success: true,
                    dryRun: false,
                    ...metadata,
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
                    path: resolved.relative,
                    code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
                });
            }
        },
    },
    {
        name: 'repo_restore_quarantined_file',
        title: 'Restore quarantined repository file',
        description:
            'Restore a file previously moved by repo_quarantine_file. Destination defaults to the original path and overwrite requires explicit confirmation.',
        inputSchema: {
            quarantineId: quarantineIdSchema.describe('quarantineId returned by repo_quarantine_file.'),
            destinationPath: z.string().optional()['describe']('Optional workspace-relative restore path.'),
            overwrite: z.boolean().optional()['describe']('Overwrite destination if it exists. Default: false.'),
            confirmOverwrite: z
                .boolean()
                .optional()
                ['describe']('Must be true when overwrite is true because destination replacement is destructive.'),
            dryRun: z.boolean().optional()['describe']('Validate without restoring. Default: false.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({ quarantineId, destinationPath, overwrite, confirmOverwrite, dryRun }, operationContext) => {
            const runtime = createRepoWriteRuntime(requireMcpToolWorkspace(operationContext));
            const metadata = await readQuarantineMetadata(runtime, String(quarantineId));
            if (!metadata) {
                return errorResult('Quarantine metadata not found.', {
                    code: 'ERR_QUARANTINE_NOT_FOUND',
                    hint: 'Use the quarantineId returned by repo_quarantine_file.',
                    quarantineId,
                });
            }
            if (metadata.status !== 'quarantined') {
                return errorResult('Quarantine item is not restorable.', {
                    code: 'ERR_QUARANTINE_NOT_RESTORABLE',
                    quarantineId,
                    status: metadata.status,
                    restoredPath: metadata.restoredPath,
                });
            }
            if (overwrite === true && confirmOverwrite !== true) {
                return errorResult('confirmOverwrite deve ser true quando overwrite=true.', {
                    code: 'ERR_RESTORE_CONFIRM_OVERWRITE_REQUIRED',
                });
            }
            const destination = await runtime.workspace.resolveWritePath(
                typeof destinationPath === 'string' && destinationPath ? destinationPath : metadata.originalPath,
            );
            if (!destination.ok) return errorResult(destination.reason, destination);

            try {
                if (dryRun === true) {
                    const quarantinePaths = resolveQuarantinePaths(runtime, metadata.quarantineId);
                    const quarantineStats = await repoWriteStat(runtime, quarantinePaths.dataPath);
                    const destinationExists = await pathExists(runtime, destination.resolved);
                    if (destinationExists && overwrite !== true) {
                        return errorResult(`Destino ja existe: ${destination.relative}`, { code: 'EEXIST' });
                    }
                    await appendMcpAuditEvent({
                        event: 'repo_restore_quarantined_file_dry_run',
                        tool: 'repo_restore_quarantined_file',
                        quarantineId: metadata.quarantineId,
                        destination: destination.relative,
                        overwrite: overwrite === true,
                    });
                    return okResult({
                        success: true,
                        dryRun: true,
                        quarantineId: metadata.quarantineId,
                        sourcePath: metadata.quarantinePath,
                        destination: destination.relative,
                        sourceBytes: quarantineStats.size,
                        destinationExists,
                        overwrite: overwrite === true,
                    });
                }

                const {
                    metadata: updatedMetadata,
                    restored,
                    destinationPreviousHash,
                    destinationPreviousBytes,
                    cleanupPending,
                } = await restoreQuarantinedFile(runtime, metadata.quarantineId, destination, overwrite === true);
                await appendMcpAuditEvent({
                    event: 'repo_restore_quarantined_file_applied',
                    tool: 'repo_restore_quarantined_file',
                    quarantineId: metadata.quarantineId,
                    destination: destination.relative,
                    overwrite: overwrite === true,
                    sourceHash: restored.sourceHash,
                    traceId: restored.io.traceId ?? null,
                });
                return okResult({
                    success: true,
                    dryRun: false,
                    quarantineId: metadata.quarantineId,
                    sourcePath: metadata.quarantinePath,
                    destination: destination.relative,
                    sourceBytes: restored.sourceBytes,
                    sourceHash: restored.sourceHash,
                    destinationPreviousHash,
                    destinationPreviousBytes,
                    overwrite: overwrite === true,
                    restoredAt: updatedMetadata.restoredAt,
                    cleanupPending,
                    io: {
                        operation: restored.io.operation,
                        targetKind: restored.io.targetKind,
                        bytesRead: restored.io.bytesRead,
                        durationMs: restored.io.durationMs,
                        engine: restored.io.engine,
                        traceId: restored.io.traceId ?? null,
                    },
                });
            } catch (error) {
                return errorResult(error instanceof Error ? error.message : String(error), {
                    quarantineId,
                    code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
                });
            }
        },
    },
    {
        name: 'repo_remove_file',
        title: 'Remove repository file',
        description:
            'Delete one workspace file. Requires confirm=true and always returns prior hash/size; rollback snapshot metadata is available only when automatic I/O rollback is explicitly enabled.',
        inputSchema: {
            path: z.string().min(1)['describe']('Workspace-relative file path to delete.'),
            confirm: z.boolean().optional()['describe']('Must be true to delete.'),
            dryRun: z.boolean().optional()['describe']('Validate without deleting. Default: false.'),
        },
        annotations: destructiveAnnotations(),
        handler: async ({ path, confirm, dryRun }, operationContext) => {
            const runtime = createRepoWriteRuntime(requireMcpToolWorkspace(operationContext));
            const resolved = await runtime.workspace.resolveWritePath(path);
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            if (confirm !== true) {
                return errorResult('confirm deve ser true para remover arquivo.', {
                    code: 'ERR_REMOVE_CONFIRM_REQUIRED',
                });
            }

            try {
                const stats = await repoWriteStat(runtime, resolved.resolved);
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

                const removed = await runtime.io.deleteFileLocked(resolved.resolved);
                await appendMcpAuditEvent({
                    event: 'repo_remove_file_applied',
                    tool: 'repo_remove_file',
                    path: resolved.relative,
                    previousHash: removed.previousHash,
                    previousBytes: removed.previousBytes,
                    rollbackCaptureEnabled: removed.rollbackCaptureEnabled,
                    previousSnapshotTruncated: removed.previousSnapshotTruncated,
                    rollbackSidecarAvailable: removed.previousRollbackSidecar != null,
                    rollbackSidecarExpiresAtMs: removed.previousRollbackSidecar?.expiresAtMs ?? null,
                    traceId: removed.io.traceId ?? null,
                });
                return okResult({
                    success: true,
                    dryRun: false,
                    path: resolved.relative,
                    deleted: removed.deleted,
                    previousHash: removed.previousHash,
                    previousBytes: removed.previousBytes,
                    rollbackCaptureEnabled: removed.rollbackCaptureEnabled,
                    rollbackSnapshotAvailable:
                        typeof removed.previousSnapshotBase64 === 'string' || removed.previousRollbackSidecar != null,
                    previousSnapshotTruncated: removed.previousSnapshotTruncated,
                    rollbackSidecarExpiresAtMs: removed.previousRollbackSidecar?.expiresAtMs ?? null,
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
