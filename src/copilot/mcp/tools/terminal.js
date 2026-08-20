// @ts-check
/**
 * High-power terminal/process tools for the workspace MCP.
 *
 * These tools intentionally expose arbitrary command execution within the operating-system boundary of the MCP process.
 * No command, executable, shell, cwd, environment key or destination allowlist is applied here.
 *
 * @module copilot/mcp/tools/terminal
 */

import { z } from 'zod';

import {
    controlTerminalSession,
    executeTerminalCommand,
    executeTerminalCommandBatch,
    openTerminalSession,
    openWorldDestructiveAnnotations,
    readOnlyAnnotations,
    readTerminalSession,
    okResult,
} from '#copilot/mcp/control-plane';

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
    inheritEnv: z.boolean().optional().describe('Inherit the MCP process environment. Default: true.'),
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
const TERMINAL_EXEC_RESULT_LIMIT_BYTES = 40 * 1024 * 1024;
const TERMINAL_SESSION_READ_RESULT_LIMIT_BYTES = 12 * 1024 * 1024;

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
    return okResult(payload, JSON.stringify(compact, null, 2));
}

/** @type {import('../registry.js').McpToolDefinition[]} */
export const terminalTools = [
    {
        name: 'terminal_exec',
        title: 'Execute arbitrary terminal commands',
        description:
            'Execute any shell command or executable permitted by the MCP process OS identity. Supports one-shot or batched execution, arbitrary cwd/env/stdin, optional no-timeout mode, bounded output tails, and process-group termination. No command allowlist is applied.',
        inputSchema: {
            command: commandSpecShape.command.optional(),
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
                .max(32)
                .optional()
                .describe('Execute up to 32 arbitrary commands in one MCP call.'),
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
        annotations: openWorldDestructiveAnnotations(),
        maxResultBytes: TERMINAL_EXEC_RESULT_LIMIT_BYTES,
        handler: async (input = {}) => {
            const value = isRecord(input) ? input : {};
            if (Array.isArray(value['batch'])) {
                if (value['command'] !== undefined) {
                    return okResult({
                        success: false,
                        code: 'ERR_TERMINAL_EXEC_SHAPE',
                        hint: 'Use either single command fields or batch, not both.',
                    });
                }
                return terminalResult(
                    await executeTerminalCommandBatch(value['batch'], {
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
            if (typeof value['command'] !== 'string' || value['command'].length === 0) {
                return okResult({
                    success: false,
                    code: 'ERR_TERMINAL_COMMAND_REQUIRED',
                    hint: 'command is required outside batch mode.',
                });
            }
            return terminalResult(
                await executeTerminalCommand(/** @type {Parameters<typeof executeTerminalCommand>[0]} */ (value)),
            );
        },
    },
    {
        name: 'terminal_session_control',
        title: 'Control persistent terminal sessions',
        description:
            'Open and control arbitrary persistent shell/process sessions. Supports backend=auto|pipe|pty, stdin writes, EOF, resize for PTY, signals/process groups, graceful close and forgetting closed sessions. PTY is used automatically when node-pty is installed.',
        inputSchema: {
            action: z.enum(['open', 'write', 'eof', 'resize', 'signal', 'close', 'forget']),
            sessionId: z.string().min(1).max(128).optional(),
            command: z
                .string()
                .max(256 * 1024)
                .optional()
                .describe('Shell command text, executable, or omitted to open an interactive shell.'),
            args: z
                .array(z.string().max(64 * 1024))
                .max(4096)
                .optional(),
            shell: z.boolean().optional().describe('Treat command as shell text. Default: true.'),
            shellPath: z.string().min(1).max(4096).optional(),
            cwd: z
                .string()
                .max(32 * 1024)
                .optional(),
            env: envSchema.optional(),
            inheritEnv: z.boolean().optional(),
            backend: z
                .enum(['auto', 'pipe', 'pty'])
                .optional()
                .describe('auto prefers node-pty and falls back to pipes.'),
            cols: z.number().int().min(1).max(1000).optional(),
            rows: z.number().int().min(1).max(1000).optional(),
            bufferBytes: z
                .number()
                .int()
                .min(64 * 1024)
                .max(64 * 1024 * 1024)
                .optional(),
            initialInput: z
                .string()
                .max(16 * 1024 * 1024)
                .optional(),
            data: z
                .string()
                .max(16 * 1024 * 1024)
                .optional(),
            appendNewline: z.boolean().optional(),
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
        annotations: openWorldDestructiveAnnotations(),
        handler: async (input = {}) => {
            const value = isRecord(input) ? input : {};
            if (value['action'] === 'open') {
                return terminalResult(
                    await openTerminalSession(/** @type {Parameters<typeof openTerminalSession>[0]} */ (value)),
                );
            }
            if (!value['sessionId']) {
                return okResult({
                    success: false,
                    code: 'ERR_TERMINAL_SESSION_ID_REQUIRED',
                    action: value['action'] ?? null,
                });
            }
            return terminalResult(
                await controlTerminalSession(/** @type {Parameters<typeof controlTerminalSession>[0]} */ (value)),
            );
        },
    },
    {
        name: 'terminal_session_read',
        title: 'Read persistent terminal sessions',
        description:
            'Read/list/status persistent MCP terminal sessions and inspect terminal capabilities without mutating a process. Output reads are cursor-based and bounded so long-running terminals do not require repeated full-log transfers.',
        inputSchema: {
            action: z.enum(['read', 'status', 'list', 'capabilities']).optional().describe('Default: read.'),
            sessionId: z.string().min(1).max(128).optional(),
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
        },
        annotations: readOnlyAnnotations(),
        maxResultBytes: TERMINAL_SESSION_READ_RESULT_LIMIT_BYTES,
        handler: async (input = {}) =>
            terminalResult(
                readTerminalSession(
                    /** @type {Parameters<typeof readTerminalSession>[0]} */ (isRecord(input) ? input : {}),
                ),
            ),
    },
];
