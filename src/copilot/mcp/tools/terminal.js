// @ts-check
/**
 * High-power terminal/process tools for the workspace MCP.
 *
 * These tools intentionally expose arbitrary command execution within the operating-system boundary of the MCP process.
 * No command, executable, shell, cwd, explicit environment key or destination allowlist is applied here. Generic
 * execution inherits only a non-credential operational environment; credential-bearing variables require explicit
 * injection by the caller/owning operation.
 *
 * @module copilot/mcp/tools/terminal
 */

import { z } from 'zod';

import {
    controlTerminalSession,
    executeTerminalCommand,
    executeTerminalCommandBatch,
    openTerminalSession,
    readTerminalSessionWithWait,
} from '#copilot/mcp/public/process/terminal';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    errorResult,
    okResult,
    requireMcpToolPrincipal,
    requireMcpToolTerminalConfig,
    requireMcpToolWorkspace,
    withResultExecutionHint,
    withToolErrorResult,
} from '#copilot/mcp/public/protocol/tools';

const envSchema = z.record(z.string(), z.union([z.string(), z.null()]));

const commandSpecShape = {
    command: z
        .string()
        .min(1)
        .max(256 * 1024)
        .describe('Arbitrary shell command text or executable path/name.'),
    args: z
        .array(z.string().max(64 * 1024))
        .max(4096)
        .optional()
        .describe('Arguments when shell=false.'),
    shell: z.boolean().optional().describe('Execute command through shellPath using -lc. Default: true.'),
    shellPath: z
        .string()
        .min(1)
        .max(4096)
        .optional()
        .describe('Arbitrary shell executable. Default: $SHELL or /bin/bash.'),
    cwd: z
        .string()
        .max(32 * 1024)
        .optional()
        .describe('Arbitrary absolute cwd or path relative to the workspace root.'),
    env: envSchema.optional().describe('Environment overrides. null removes a variable.'),
    inheritEnv: z
        .boolean()
        .optional()
        .describe(
            'Inherit the safe operational environment projection. Default: true; ambient credentials are never inherited.',
        ),
    stdin: z
        .string()
        .max(16 * 1024 * 1024)
        .optional()
        .describe('Optional stdin payload for the process.'),
    timeoutMs: z
        .number()
        .int()
        .min(0)
        .max(60 * 60 * 1000)
        .optional()
        .describe('Timeout; 0 disables timeout. Default: 120000ms.'),
    maxOutputBytes: z
        .number()
        .int()
        .min(16 * 1024)
        .max(16 * 1024 * 1024)
        .optional()
        .describe('Retained tail bytes per stdout/stderr stream. Default: 1MiB.'),
};
const commandSpecSchema = z.object(commandSpecShape);

const terminalEnvironmentProjectionSchema = z.object({
    policyVersion: z.string(),
    inheritance: z.enum(['operational', 'none']),
    ambientCredentialInheritance: z.literal(false),
    inheritedKeyCount: z.number().int().min(0),
    explicitOverrideCount: z.number().int().min(0),
    removedOverrideCount: z.number().int().min(0),
});

const terminalCapabilitiesSchema = z.object({
    terminalControlVersion: z.number().int().min(1),
    arbitraryCommands: z.boolean(),
    arbitraryShell: z.boolean(),
    arbitraryExecutable: z.boolean(),
    arbitraryCwd: z.boolean(),
    arbitraryEnvironment: z.boolean(),
    ambientCredentialInheritance: z.literal(false),
    defaultEnvironmentInheritance: z.literal('operational-projection'),
    explicitEnvironmentOverrides: z.boolean(),
    stdin: z.boolean(),
    persistentSessions: z.boolean(),
    multipleSessions: z.boolean(),
    signals: z.boolean(),
    processGroups: z.boolean(),
    pty: z.boolean(),
    ptyModule: z.string().nullable(),
    defaultShell: z.string(),
    maxSessions: z.number().int().min(1),
    maxBatchCommands: z.number().int().min(1),
    maxBatchConcurrency: z.number().int().min(1),
    defaultBatchResultBudgetBytes: z.number().int().min(1),
    maxBatchResultBudgetBytes: z.number().int().min(1),
    maxExecOutputBytes: z.number().int().min(1),
    maxSessionBufferBytes: z.number().int().min(1),
    maxSessionWaitMs: z.number().int().min(1),
    maxSessionWaitersPerSession: z.number().int().min(1),
    sessionLifecycle: z.object({
        runningLifetime: z.literal('until-process-exit-or-explicit-close'),
        closedRetentionMs: z.number().int().min(1),
        processExitCleanup: z.literal('force-kill-running-session-process-trees'),
        retentionCleanup: z.literal('opportunistic-on-session-operations'),
    }),
    osBoundary: z.string(),
});

const terminalSessionSchema = z.object({
    id: z.string(),
    backend: z.enum(['pipe', 'pty']),
    command: z.string(),
    args: z.array(z.string()),
    cwd: z.string(),
    pid: z.number().int().nullable(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    status: z.enum(['running', 'exited', 'failed']),
    exitCode: z.number().int().nullable(),
    signal: z.union([z.string(), z.number()]).nullable(),
    environmentProjection: terminalEnvironmentProjectionSchema,
    bufferLimitBytes: z.number().int().min(0),
    bufferedBytes: z.number().int().min(0),
    droppedBytes: z.number().int().min(0),
    nextSeq: z.number().int().min(1),
    retentionExpiresAt: z.string().nullable(),
});

const terminalEventSchema = z.object({
    seq: z.number().int().min(1),
    stream: z.enum(['stdout', 'stderr', 'pty', 'system']),
    data: z.string(),
    bytes: z.number().int().min(0),
    at: z.string(),
});

const terminalOneShotResultSchema = z.object({
    success: z.boolean(),
    terminalControlVersion: z.number().int().min(1),
    mode: z.literal('one-shot'),
    shell: z.boolean(),
    executable: z.string(),
    args: z.array(z.string()),
    cwd: z.string(),
    pid: z.number().int().nullable(),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    timedOut: z.boolean(),
    cancelled: z.boolean().optional(),
    cancellationSource: z.enum(['caller', 'deadline', 'unknown']).nullable().optional(),
    durationMs: z.number().min(0),
    environmentProjection: terminalEnvironmentProjectionSchema,
    stdout: z.string(),
    stderr: z.string(),
    stdoutBytesObserved: z.number().int().min(0),
    stderrBytesObserved: z.number().int().min(0),
    stdoutTruncated: z.boolean(),
    stderrTruncated: z.boolean(),
    error: z.string().optional(),
});

const terminalBatchRowSchema = z.object({
    index: z.number().int().min(0),
    success: z.boolean(),
    skipped: z.boolean().optional(),
    reason: z.string().optional(),
    error: z.string().optional(),
    terminalControlVersion: z.number().int().min(1).optional(),
    mode: z.literal('one-shot').optional(),
    shell: z.boolean().optional(),
    executable: z.string().optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    pid: z.number().int().nullable().optional(),
    exitCode: z.number().int().nullable().optional(),
    signal: z.string().nullable().optional(),
    timedOut: z.boolean().optional(),
    cancelled: z.boolean().optional(),
    cancellationSource: z.enum(['caller', 'deadline', 'unknown']).nullable().optional(),
    durationMs: z.number().min(0).optional(),
    environmentProjection: terminalEnvironmentProjectionSchema.optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    stdoutBytesObserved: z.number().int().min(0).optional(),
    stderrBytesObserved: z.number().int().min(0).optional(),
    stdoutTruncated: z.boolean().optional(),
    stderrTruncated: z.boolean().optional(),
});

const terminalExecOutputSchema = z.union([
    terminalOneShotResultSchema,
    z.object({
        success: z.boolean(),
        batch: z.literal(true),
        requestCount: z.number().int().min(1),
        attemptedCount: z.number().int().min(0),
        succeededCount: z.number().int().min(0),
        failedCount: z.number().int().min(0),
        skippedCount: z.number().int().min(0),
        concurrency: z.number().int().min(1),
        failureMode: z.enum(['best-effort', 'fail-fast']),
        resultBudgetBytes: z.number().int().min(1),
        perStreamOutputBudgetBytes: z.number().int().min(1),
        results: z.array(terminalBatchRowSchema),
    }),
    z.object({
        success: z.literal(false),
        code: z.string(),
        hint: z.string().optional(),
    }),
]);

const terminalSessionControlOutputSchema = z.object({
    success: z.boolean(),
    code: z.string().optional(),
    hint: z.string().optional(),
    error: z.string().optional(),
    action: z.enum(['open', 'write', 'eof', 'resize', 'signal', 'close', 'forget']).nullable().optional(),
    sessionId: z.string().optional(),
    session: terminalSessionSchema.optional(),
    capabilities: terminalCapabilitiesSchema.optional(),
    forgotten: z.boolean().optional(),
    bytesWritten: z.number().int().min(0).optional(),
    cols: z.number().int().min(1).optional(),
    rows: z.number().int().min(1).optional(),
    signal: z.string().optional(),
    alreadyClosed: z.boolean().optional(),
    maxSessions: z.number().int().min(1).optional(),
    runningSessions: z.number().int().min(0).optional(),
    backend: z.enum(['pipe', 'pty']).optional(),
    command: z.string().optional(),
    cwd: z.string().optional(),
});

const terminalSessionReadOutputSchema = z.object({
    success: z.boolean(),
    code: z.string().optional(),
    sessionId: z.string().nullable().optional(),
    capabilities: terminalCapabilitiesSchema.optional(),
    total: z.number().int().min(0).optional(),
    running: z.number().int().min(0).optional(),
    sessions: z.array(terminalSessionSchema).optional(),
    session: terminalSessionSchema.optional(),
    afterSeq: z.number().int().min(0).optional(),
    nextSeq: z.number().int().min(0).optional(),
    earliestAvailableSeq: z.number().int().min(1).optional(),
    cursorBehindRetention: z.boolean().optional(),
    returnedBytes: z.number().int().min(0).optional(),
    hasMore: z.boolean().optional(),
    waitFor: z.literal('output-or-exit').optional(),
    waitMs: z.number().int().min(1).max(120_000).optional(),
    waitedMs: z.number().int().min(0).optional(),
    waitOutcome: z
        .enum(['immediate-output', 'immediate-exit', 'cursor-behind-retention', 'output', 'exit', 'timeout'])
        .optional(),
    events: z.array(terminalEventSchema).optional(),
});

const MAX_TERMINAL_BATCH_COMMANDS = 32;
const TERMINAL_EXEC_SINGLE_FIELDS = Object.freeze([
    'command',
    'args',
    'shell',
    'shellPath',
    'cwd',
    'env',
    'inheritEnv',
    'stdin',
    'timeoutMs',
    'maxOutputBytes',
]);
const TERMINAL_EXEC_BATCH_ONLY_FIELDS = Object.freeze([
    'batchConcurrency',
    'batchFailureMode',
    'batchResultBudgetBytes',
]);
const TERMINAL_SESSION_CONTROL_FIELDS = Object.freeze({
    open: Object.freeze([
        'action',
        'command',
        'args',
        'shell',
        'shellPath',
        'cwd',
        'env',
        'inheritEnv',
        'backend',
        'cols',
        'rows',
        'bufferBytes',
        'initialInput',
    ]),
    write: Object.freeze(['action', 'sessionId', 'data', 'appendNewline']),
    eof: Object.freeze(['action', 'sessionId']),
    resize: Object.freeze(['action', 'sessionId', 'cols', 'rows']),
    signal: Object.freeze(['action', 'sessionId', 'signal', 'processGroup']),
    close: Object.freeze(['action', 'sessionId', 'processGroup', 'graceMs']),
    forget: Object.freeze(['action', 'sessionId']),
});
const TERMINAL_SESSION_READ_FIELDS = Object.freeze({
    read: Object.freeze(['action', 'sessionId', 'afterSeq', 'maxBytes', 'waitFor', 'waitMs']),
    status: Object.freeze(['action', 'sessionId']),
    list: Object.freeze(['action', 'limit']),
    capabilities: Object.freeze(['action']),
});
const TERMINAL_EXEC_RESULT_LIMIT_BYTES = 40 * 1024 * 1024;
const TERMINAL_SESSION_READ_RESULT_LIMIT_BYTES = 12 * 1024 * 1024;
const TERMINAL_CONTROL_PLANE_TOOL_ERROR_CODES = Object.freeze(
    new Set([
        'ERR_TERMINAL_SESSION_LIMIT',
        'ERR_TERMINAL_PTY_UNAVAILABLE',
        'ERR_TERMINAL_SESSION_NOT_FOUND',
        'ERR_TERMINAL_SESSION_RUNNING',
        'ERR_TERMINAL_RESIZE_REQUIRES_PTY',
        'ERR_TERMINAL_SESSION_ACTION',
        'ERR_TERMINAL_SESSION_NOT_RUNNING',
        'ERR_TERMINAL_SESSION_OPEN',
        'MCP_TOOL_CANCELLED',
        'MCP_TOOL_TIMEOUT',
    ]),
);

/**
 * Reduce the wire OperationContext to the authority actually required by the process owner.
 * @param {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/process/terminal').TerminalExecutionRuntime}
 */
function terminalExecutionRuntime(operationContext) {
    const workspace = requireMcpToolWorkspace(operationContext);
    if (!operationContext) throw new TypeError('Terminal tool execution requires an OperationContext.');
    return Object.freeze({
        workspaceRoot: workspace.workspaceRoot,
        config: requireMcpToolTerminalConfig(operationContext),
        principalKey: requireMcpToolPrincipal(operationContext).key,
        signal: operationContext.signal,
        cancellationSource: operationContext.cancellationSource,
    });
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {Record<string, unknown>} payload */
function terminalResult(payload) {
    const session = isRecord(payload['session']) ? payload['session'] : null;
    const compact = {
        success: payload['success'] === true,
        ...(payload['code'] ? { code: payload['code'] } : {}),
        ...(payload['mode'] ? { mode: payload['mode'] } : {}),
        ...(payload['action'] ? { action: payload['action'] } : {}),
        ...(payload['batch'] === true ? { batch: true } : {}),
        ...(payload['requestCount'] !== undefined ? { requestCount: payload['requestCount'] } : {}),
        ...(payload['succeededCount'] !== undefined ? { succeededCount: payload['succeededCount'] } : {}),
        ...(payload['failedCount'] !== undefined ? { failedCount: payload['failedCount'] } : {}),
        ...(payload['stdoutBytesObserved'] !== undefined
            ? { stdoutBytesObserved: payload['stdoutBytesObserved'] }
            : {}),
        ...(payload['stderrBytesObserved'] !== undefined
            ? { stderrBytesObserved: payload['stderrBytesObserved'] }
            : {}),
        ...(payload['returnedBytes'] !== undefined ? { returnedBytes: payload['returnedBytes'] } : {}),
        ...(payload['hasMore'] !== undefined ? { hasMore: payload['hasMore'] } : {}),
        ...(payload['waitOutcome'] !== undefined ? { waitOutcome: payload['waitOutcome'] } : {}),
        ...(payload['waitedMs'] !== undefined ? { waitedMs: payload['waitedMs'] } : {}),
        ...(session && typeof session === 'object'
            ? {
                  session: {
                      id: session['id'],
                      backend: session['backend'],
                      status: session['status'],
                      pid: session['pid'],
                  },
              }
            : {}),
        detail: 'Full bounded terminal data is available in structuredContent.',
    };
    const result = okResult(payload, JSON.stringify(compact, null, 2));
    const code = typeof payload['code'] === 'string' ? payload['code'] : '';
    const framedResult =
        payload['success'] === false && TERMINAL_CONTROL_PLANE_TOOL_ERROR_CODES.has(code)
            ? withToolErrorResult(result)
            : result;
    if (payload['batch'] !== true || !Number.isSafeInteger(Number(payload['requestCount']))) return framedResult;
    const requestCount = Math.max(1, Math.floor(Number(payload['requestCount'])));
    const rows = Array.isArray(payload['results']) ? payload['results'] : [];
    const skippedOperations = rows.filter((row) => isRecord(row) && row['skipped'] === true).length;
    const failedOperations = rows.filter(
        (row) => isRecord(row) && row['success'] !== true && row['skipped'] !== true,
    ).length;
    const truncatedOperations = rows.filter(
        (row) => isRecord(row) && (row['stdoutTruncated'] === true || row['stderrTruncated'] === true),
    ).length;
    return withResultExecutionHint(framedResult, {
        logicalOperations: requestCount,
        failedOperations,
        skippedOperations,
        mode: `terminal-batch:${String(payload['failureMode'] ?? 'best-effort')}`,
        batchSize: requestCount,
        batchCapacity: MAX_TERMINAL_BATCH_COMMANDS,
        ...(Number.isSafeInteger(Number(payload['resultBudgetBytes']))
            ? { resultBudgetBytes: Math.max(0, Math.floor(Number(payload['resultBudgetBytes']))) }
            : {}),
        truncatedOperations,
    });
}

/** @param {Record<string, unknown>} value @param {readonly string[]} fields */
function presentTerminalFields(value, fields) {
    return fields.filter((field) => value[field] !== undefined);
}

/**
 * @param {Record<string, unknown>} value
 * @param {Readonly<Record<string, readonly string[]>>} fieldsByMode
 * @param {string} mode
 */
function invalidTerminalFieldsForMode(value, fieldsByMode, mode) {
    const allowed = fieldsByMode[mode];
    if (!allowed) return [];
    const allowedSet = new Set(allowed);
    return Object.keys(value).filter((field) => value[field] !== undefined && !allowedSet.has(field));
}

/** @param {Record<string, unknown>} value */
function invalidTerminalSessionActionFields(value) {
    return invalidTerminalFieldsForMode(
        value,
        /** @type {Readonly<Record<string, readonly string[]>>} */ (TERMINAL_SESSION_CONTROL_FIELDS),
        String(value['action'] ?? ''),
    );
}

/** @param {Record<string, unknown>} value */
function invalidTerminalSessionReadFields(value) {
    return invalidTerminalFieldsForMode(
        value,
        /** @type {Readonly<Record<string, readonly string[]>>} */ (TERMINAL_SESSION_READ_FIELDS),
        String(value['action'] ?? 'read'),
    );
}

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]} */
export const terminalTools = [
    defineMcpRawTool({
        name: 'terminal_exec',
        title: 'Execute arbitrary terminal commands',
        description:
            'Execute any shell command or executable permitted by the MCP process OS identity. Single-command fields and batch are mutually exclusive; batch tuning fields require batch mode. Supports arbitrary cwd/explicit env/stdin, optional no-timeout mode, bounded output tails, and process-group termination. Default ambient inheritance is operational-only and excludes parent credentials; no command allowlist is applied.',
        inputSchema: {
            command: commandSpecShape.command
                .optional()
                .describe('Single-mode command text or executable; do not combine with batch.'),
            args: commandSpecShape.args,
            shell: commandSpecShape.shell,
            shellPath: commandSpecShape.shellPath,
            cwd: commandSpecShape.cwd,
            env: commandSpecShape.env,
            inheritEnv: commandSpecShape.inheritEnv,
            stdin: commandSpecShape.stdin,
            timeoutMs: commandSpecShape.timeoutMs,
            maxOutputBytes: commandSpecShape.maxOutputBytes,
            batch: z
                .array(commandSpecSchema)
                .min(1)
                .max(MAX_TERMINAL_BATCH_COMMANDS)
                .optional()
                .describe(`Execute up to ${MAX_TERMINAL_BATCH_COMMANDS} arbitrary commands in one MCP call.`),
            batchConcurrency: z
                .number()
                .int()
                .min(1)
                .max(16)
                .optional()
                .describe('Concurrent batch commands. Default: 4.'),
            batchFailureMode: z
                .enum(['best-effort', 'fail-fast'])
                .optional()
                .describe('Batch failure policy. Default: best-effort.'),
            batchResultBudgetBytes: z
                .number()
                .int()
                .min(1024 * 1024)
                .max(32 * 1024 * 1024)
                .optional()
                .describe('Aggregate retained stdout/stderr budget across a batch. Default: 8MiB.'),
        },
        outputSchema: terminalExecOutputSchema,

        maxResultBytes: TERMINAL_EXEC_RESULT_LIMIT_BYTES,
        handler: async (input = {}, operationContext) => {
            const value = isRecord(input) ? input : {};
            if (Array.isArray(value['batch'])) {
                const conflictingFields = presentTerminalFields(value, TERMINAL_EXEC_SINGLE_FIELDS);
                if (conflictingFields.length > 0) {
                    return errorResult('terminal_exec batch mode received single-command fields.', {
                        code: 'ERR_TERMINAL_EXEC_SHAPE',
                        conflictingFields,
                        hint: 'Batch mode accepts batch plus batchConcurrency/batchFailureMode/batchResultBudgetBytes only.',
                    });
                }
                const runtime = terminalExecutionRuntime(operationContext);
                return terminalResult(
                    await executeTerminalCommandBatch(value['batch'], runtime, {
                        ...(typeof value['batchConcurrency'] === 'number'
                            ? { concurrency: value['batchConcurrency'] }
                            : {}),
                        ...(value['batchFailureMode'] === 'fail-fast' || value['batchFailureMode'] === 'best-effort'
                            ? { failureMode: value['batchFailureMode'] }
                            : {}),
                        ...(typeof value['batchResultBudgetBytes'] === 'number'
                            ? { resultBudgetBytes: value['batchResultBudgetBytes'] }
                            : {}),
                    }),
                );
            }
            const batchOnlyFields = presentTerminalFields(value, TERMINAL_EXEC_BATCH_ONLY_FIELDS);
            if (batchOnlyFields.length > 0) {
                return errorResult('terminal_exec single mode received batch-only fields.', {
                    code: 'ERR_TERMINAL_EXEC_SHAPE',
                    conflictingFields: batchOnlyFields,
                    hint: 'batchConcurrency/batchFailureMode/batchResultBudgetBytes require batch mode.',
                });
            }
            if (typeof value['command'] !== 'string' || value['command'].length === 0) {
                return errorResult('terminal_exec requires command outside batch mode.', {
                    code: 'ERR_TERMINAL_COMMAND_REQUIRED',
                    hint: 'command is required outside batch mode.',
                });
            }
            const runtime = terminalExecutionRuntime(operationContext);
            return terminalResult(
                await executeTerminalCommand(
                    /** @type {Parameters<typeof executeTerminalCommand>[0]} */ (value),
                    runtime,
                ),
            );
        },
    }),
    defineMcpRawTool({
        name: 'terminal_session_control',
        title: 'Control persistent terminal sessions',
        description:
            'Open and control arbitrary persistent shell/process sessions. Supports backend=auto|pipe|pty, stdin writes, EOF, resize for PTY, signals/process groups, graceful close and forgetting closed sessions. PTY is used automatically when node-pty is installed.',
        inputSchema: {
            action: z
                .enum(['open', 'write', 'eof', 'resize', 'signal', 'close', 'forget'])
                .describe('Session action; each action consumes only its documented action-scoped fields.'),
            sessionId: z
                .string()
                .min(1)
                .max(128)
                .optional()
                .describe('Persistent session id for write/eof/resize/signal/close/forget; omitted for open.'),
            command: z
                .string()
                .max(256 * 1024)
                .optional()
                .describe('Shell command text, executable, or omitted to open an interactive shell.'),
            args: z
                .array(z.string().max(64 * 1024))
                .max(4096)
                .optional()
                .describe('Executable arguments for action=open when shell=false.'),
            shell: z.boolean().optional().describe('Treat command as shell text. Default: true.'),
            shellPath: z.string().min(1).max(4096).optional().describe('Shell executable for action=open.'),
            cwd: z
                .string()
                .max(32 * 1024)
                .optional()
                .describe('Working directory for action=open.'),
            env: envSchema.optional().describe('Environment overrides for action=open; null removes a variable.'),
            inheritEnv: z
                .boolean()
                .optional()
                .describe(
                    'Inherit the safe operational environment projection. Default: true; ambient credentials are never inherited.',
                ),
            backend: z
                .enum(['auto', 'pipe', 'pty'])
                .optional()
                .describe('auto prefers node-pty and falls back to pipes.'),
            cols: z
                .number()
                .int()
                .min(1)
                .max(1000)
                .optional()
                .describe('PTY column count for action=open or action=resize.'),
            rows: z
                .number()
                .int()
                .min(1)
                .max(1000)
                .optional()
                .describe('PTY row count for action=open or action=resize.'),
            bufferBytes: z
                .number()
                .int()
                .min(64 * 1024)
                .max(64 * 1024 * 1024)
                .optional()
                .describe('Retained session event-buffer bytes for action=open.'),
            initialInput: z
                .string()
                .max(16 * 1024 * 1024)
                .optional()
                .describe('Initial stdin payload written during action=open.'),
            data: z
                .string()
                .max(16 * 1024 * 1024)
                .optional()
                .describe('Stdin payload for action=write.'),
            appendNewline: z
                .boolean()
                .optional()
                .describe('Append a newline after data for action=write. Default: false.'),
            signal: z
                .string()
                .min(3)
                .max(32)
                .optional()
                .describe('POSIX/Node signal such as SIGINT, SIGTERM or SIGKILL.'),
            processGroup: z.boolean().optional().describe('Signal the process group on POSIX. Default: true.'),
            graceMs: z
                .number()
                .int()
                .min(0)
                .max(30_000)
                .optional()
                .describe('Grace period before SIGKILL on close. Default: 1500ms.'),
        },
        outputSchema: terminalSessionControlOutputSchema,

        handler: async (input, operationContext) => {
            const value = input;
            const invalidOptions = invalidTerminalSessionActionFields(/** @type {Record<string, unknown>} */ (value));
            if (invalidOptions.length > 0) {
                return errorResult(`terminal_session_control received fields that do not apply to action=${value.action}.`, {
                    code: 'ERR_TERMINAL_SESSION_ACTION_OPTIONS',
                    action: value.action,
                    invalidOptions,
                    hint: `Remove options that do not apply to action=${value.action}.`,
                });
            }
            if (value.action === 'open') {
                const runtime = terminalExecutionRuntime(operationContext);
                return terminalResult(
                    await openTerminalSession(
                        /** @type {Parameters<typeof openTerminalSession>[0]} */ (value),
                        runtime,
                    ),
                );
            }
            if (!value.sessionId) {
                return errorResult(`terminal_session_control action=${value.action} requires sessionId.`, {
                    code: 'ERR_TERMINAL_SESSION_ID_REQUIRED',
                    action: value.action,
                });
            }
            return terminalResult(
                await controlTerminalSession(
                    /** @type {Parameters<typeof controlTerminalSession>[0]} */ (value),
                    terminalExecutionRuntime(operationContext),
                ),
            );
        },
    }),
    defineMcpRawTool({
        name: 'terminal_session_read',
        title: 'Read persistent terminal sessions',
        description:
            'Read/list/status persistent MCP terminal sessions and inspect terminal capabilities without mutating a process. Reads are cursor-based and bounded; optionally wait event-driven for new output or exit to avoid mechanical polling.',
        inputSchema: {
            action: z.enum(['read', 'status', 'list', 'capabilities']).optional().describe('Default: read.'),
            sessionId: z
                .string()
                .min(1)
                .max(128)
                .optional()
                .describe('Persistent session id for action=read or action=status.'),
            afterSeq: z.number().int().min(0).optional().describe('Return events after this sequence cursor.'),
            maxBytes: z
                .number()
                .int()
                .min(1024)
                .max(8 * 1024 * 1024)
                .optional()
                .describe('Maximum returned event bytes. Default: 512KiB.'),
            limit: z
                .number()
                .int()
                .min(1)
                .max(128)
                .optional()
                .describe('Maximum sessions returned by list. Default: 50.'),
            waitFor: z
                .literal('output-or-exit')
                .optional()
                .describe(
                    'For action=read only, wait event-driven until output arrives, the process exits, or waitMs expires.',
                ),
            waitMs: z
                .number()
                .int()
                .min(1)
                .max(120_000)
                .optional()
                .describe('Bounded wait for waitFor=output-or-exit. Default: 30000ms; hard max: 120000ms.'),
        },
        outputSchema: terminalSessionReadOutputSchema,

        maxResultBytes: TERMINAL_SESSION_READ_RESULT_LIMIT_BYTES,
        handler: async (input = {}, operationContext) => {
            const value = isRecord(input) ? input : {};
            const action = String(value['action'] ?? 'read');
            const invalidOptions = invalidTerminalSessionReadFields(value);
            if (invalidOptions.length > 0) {
                return errorResult(`terminal_session_read received fields that do not apply to action=${action}.`, {
                    code: 'ERR_TERMINAL_SESSION_READ_ACTION_OPTIONS',
                    action,
                    invalidOptions,
                    hint: `Remove options that do not apply to action=${action}.`,
                });
            }
            if (value['waitMs'] !== undefined && value['waitFor'] !== 'output-or-exit') {
                return errorResult('terminal_session_read waitMs requires waitFor="output-or-exit".', {
                    code: 'ERR_TERMINAL_SESSION_WAIT_REQUIRES_WAIT_FOR',
                    hint: 'Set waitFor="output-or-exit" when supplying waitMs.',
                });
            }
            if (value['waitFor'] !== undefined && (value['action'] ?? 'read') !== 'read') {
                return errorResult('terminal_session_read waitFor is supported only for action=read.', {
                    code: 'ERR_TERMINAL_SESSION_WAIT_REQUIRES_READ',
                    hint: 'waitFor is supported only for action=read.',
                });
            }
            return terminalResult(
                await readTerminalSessionWithWait(
                    /** @type {Parameters<typeof readTerminalSessionWithWait>[0]} */ (value),
                    terminalExecutionRuntime(operationContext),
                ),
            );
        },
    }),
];
