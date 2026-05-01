// @ts-check
/**
 * Schemas HTTP das rotas de sessão SDK.
 *
 * Mantido separado de `session-middleware.js` para que validação estrutural não se misture com rate-limit, error
 * handling e runtime metadata.
 */

import { z } from 'zod';

/** Schema para POST /sessions body */
export const CreateSessionBodySchema = z.object({
    model: z.string().optional(),
    sessionId: z.string().optional(),
    clientName: z.string().optional(),
    reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
    configDir: z.string().optional(),
    systemMessage: z.unknown().optional(),
    availableTools: z.array(z.string()).optional(),
    excludedTools: z.array(z.string()).optional(),
    provider: z.unknown().optional(),
    workingDirectory: z.string().optional(),
    streaming: z.boolean().optional(),
    mcpServers: z.record(z.string(), z.unknown()).optional(),
    customAgents: z.array(z.unknown()).optional(),
    agent: z.string().optional(),
    skillDirectories: z.array(z.string()).optional(),
    disabledSkills: z.array(z.string()).optional(),
    infiniteSessions: z.unknown().optional(),
});

/** Schema para POST /sessions/:id/send body */
export const SendMessageBodySchema = z.object({
    prompt: z.string().min(1),
    waitForResponse: z.boolean().optional(),
    timeoutMs: z.number().nonnegative().finite().optional(),
    attachments: z.array(z.unknown()).optional(),
    mode: z.enum(['immediate', 'enqueue']).optional(),
});

/** Schema para POST /sessions/:id/model body */
export const SetModelBodySchema = z.object({
    model: z.string(),
    reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
});

/** Schema para POST /sessions/:id/resume body */
export const ResumeSessionBodySchema = z
    .object({
        clientName: z.string().optional(),
        model: z.string().optional(),
        reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
        configDir: z.string().optional(),
        systemMessage: z.unknown().optional(),
        availableTools: z.array(z.string()).optional(),
        excludedTools: z.array(z.string()).optional(),
        provider: z.unknown().optional(),
        workingDirectory: z.string().optional(),
        streaming: z.boolean().optional(),
        mcpServers: z.record(z.string(), z.unknown()).optional(),
        customAgents: z.array(z.unknown()).optional(),
        agent: z.string().optional(),
        skillDirectories: z.array(z.string()).optional(),
        disabledSkills: z.array(z.string()).optional(),
        infiniteSessions: z.unknown().optional(),
        disableResume: z.boolean().optional(),
    })
    .optional();

/** Schema para POST /sessions/:id/log body */
export const LogMessageBodySchema = z.object({
    message: z.string().min(1),
    level: z.enum(['info', 'warning', 'error']).optional(),
    ephemeral: z.boolean().optional(),
});

/** Schema para POST /sessions/:id/ui/elicitation body */
export const ElicitationBodySchema = z.object({
    message: z.string().min(1),
    requestedSchema: z.record(z.string(), z.unknown()),
});

/** Schema para POST /sessions/:id/ui/confirm body */
export const UiConfirmBodySchema = z.object({
    message: z.string().min(1),
});

/** Schema para POST /sessions/:id/ui/select body */
export const UiSelectBodySchema = z.object({
    message: z.string().min(1),
    options: z.array(z.string().min(1)).min(1),
});

/** Schema para POST /sessions/:id/ui/input body */
export const UiInputBodySchema = z.object({
    message: z.string().min(1),
    options: z
        .object({
            title: z.string().optional(),
            description: z.string().optional(),
            minLength: z.number().int().nonnegative().optional(),
            maxLength: z.number().int().nonnegative().optional(),
            format: z.enum(['email', 'uri', 'date', 'date-time']).optional(),
            default: z.string().optional(),
        })
        .optional(),
});

/** Schema para POST /sessions/:id/permissions/:requestId body */
export const PermissionDecisionBodySchema = z.object({
    result: z.union([
        z.object({ kind: z.literal('approve-once') }),
        z.object({ kind: z.literal('approve-for-session'), approval: z.record(z.string(), z.unknown()) }),
        z.object({
            kind: z.literal('approve-for-location'),
            approval: z.record(z.string(), z.unknown()),
            locationKey: z.string().min(1),
        }),
        z.object({ kind: z.literal('reject'), feedback: z.string().optional() }),
        z.object({ kind: z.literal('user-not-available') }),
        z.object({ kind: z.literal('no-result') }),
    ]),
});

/** Schema para POST /sessions/:id/tools/:requestId body */
export const HandlePendingToolCallBodySchema = z.object({
    result: z
        .union([
            z.string(),
            z.object({
                textResultForLlm: z.string(),
                resultType: z.string().optional(),
                error: z.string().optional(),
                toolTelemetry: z.record(z.string(), z.unknown()).optional(),
            }),
        ])
        .optional(),
    error: z.string().optional(),
});

/** Schema para POST /sessions/:id/commands/:requestId body */
export const HandlePendingCommandBodySchema = z.object({
    error: z.string().optional(),
});

/** Schema para POST /sessions/:id/shell/exec body */
export const ShellExecBodySchema = z.object({
    command: z.string().min(1),
    cwd: z.string().optional(),
    timeout: z.number().positive().finite().optional(),
});

/** Schema para POST /sessions/:id/shell/:processId/kill body */
export const ShellKillBodySchema = z
    .object({
        signal: z.enum(['SIGTERM', 'SIGKILL', 'SIGINT']).optional(),
    })
    .optional();

/** Schema para POST /sessions/:id/workspace/file body */
export const WorkspaceCreateFileBodySchema = z.object({
    path: z.string().min(1),
    content: z.string(),
});
