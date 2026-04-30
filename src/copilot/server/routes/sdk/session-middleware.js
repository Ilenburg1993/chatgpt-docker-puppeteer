// @ts-check
/**
 * src/copilot/server/routes/sdk/session-middleware.js
 *
 * Middlewares e helpers compartilhados pelas rotas de sessão SDK.
 *
 * @module copilot/server/routes/sdk/session-middleware
 * @see EventBus
 */

import { log } from '#copilot/observability';
import { z } from 'zod';
import { toError } from '../../../core/error-handlers.js';
import { sanitizeHttpErrorMessage } from '../../middleware/error-handler.js';
import {
    deleteSdkSessionRateLimitWindow,
    getSdkSessionRateLimitWindow,
    iterateSdkSessionRateLimitWindows,
    setSdkSessionRateLimitWindow,
} from '../../runtime-state/sdk-session-rate-limit.js';
import { resolveSdkRouteSharedDeps } from './deps.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 */

/**
 * @param {Req} req
 * @returns {{
 *     runtimeId?: string;
 *     requestedRuntimeId?: string | null;
 *     runtimeFound?: boolean;
 *     usedDefaultRuntimeFallback?: boolean;
 * }}
 */
function buildSessionRouteRuntimeMeta(req) {
    try {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        return routeDeps.sdkRuntimeProjection.buildRuntimeRouteMetaPayload(routeDeps);
    } catch {
        return {};
    }
}

// SEC-N05/N06 (fix): validação de model — prevenir injeção e garantir formato kosher
const MODEL_SAFE_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,99})$/;

/**
 * Middleware de rate limiting simples por IP (em memória, por processo).
 *
 * @param {number} maxPerMinute - Máximo de requisições por minuto
 * @param {string} label - Label para log
 * @returns {import('express').RequestHandler}
 */
export function rateLimitMiddleware(maxPerMinute, label) {
    const WINDOW_MS = 60_000;
    return (req, res, next) => {
        const ip = req.ip ?? 'unknown';
        const key = `${label}:${ip}`;
        const now = Date.now();
        // BUG-RF015 (fix): purgar entradas expiradas para evitar memory leak em uptime longo
        for (const [k, e] of iterateSdkSessionRateLimitWindows()) {
            if (now - e.bucketStart > WINDOW_MS) deleteSdkSessionRateLimitWindow(k);
        }
        const entry = getSdkSessionRateLimitWindow(key);
        if (!entry || now - entry.bucketStart > WINDOW_MS) {
            setSdkSessionRateLimitWindow(key, { count: 1, bucketStart: now });
            return next();
        }
        entry.count += 1;
        if (entry.count > maxPerMinute) {
            return res.status(429).json({
                ok: false,
                ...buildSessionRouteRuntimeMeta(req),
                error: 'Too many requests. Tente novamente em 1 minuto.',
            });
        }
        return next();
    };
}

/**
 * Valida e sanitiza o campo `model` recebido do body HTTP. Retorna o model normalizado (trim) ou null se inválido.
 *
 * @param {unknown} model
 * @returns {{ ok: true; model: string } | { ok: false; error: string }}
 */
export function validateModel(model) {
    if (!model || typeof model !== 'string') {
        return { ok: false, error: 'Campo "model" (string) é obrigatório.' };
    }
    const trimmed = model.trim();
    if (!MODEL_SAFE_RE.test(trimmed)) {
        return { ok: false, error: 'Campo "model" contém caracteres inválidos ou formato não permitido.' };
    }
    return { ok: true, model: trimmed };
}

/**
 * Wrapper que captura erros e retorna 500 padronizado.
 *
 * @param {Req} req
 * @param {Res} res
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<void>}
 */
export async function withErrorHandler(req, res, fn) {
    try {
        await fn();
    } catch (e) {
        log('ERROR', `[sdk-api/sessions] ${req.method} ${req.path} → ${toError(e).message}`);
        if (!res.headersSent) {
            res.status(500).json({
                ok: false,
                ...buildSessionRouteRuntimeMeta(req),
                error: sanitizeHttpErrorMessage(toError(e).message, 500),
            });
        }
    }
}

/**
 * F95: Middleware factory que valida req.body contra um schema Zod.
 *
 * Se a validação falhar, retorna 400 com detalhes. Se suceder, anexa o body validado a `req.body` (substituindo o
 * original) e prossegue para o handler.
 *
 * @param {import('zod').ZodType} schema - Schema Zod para validar req.body
 * @returns {import('express').RequestHandler}
 */
export function validateBody(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            const zodError = /** @type {{ issues?: { path: (string | number)[]; message: string }[] }} */ (
                /** @type {unknown} */ (result.error)
            );
            return res.status(400).json({
                ok: false,
                ...buildSessionRouteRuntimeMeta(req),
                error: 'Corpo da requisição inválido.',
                details:
                    zodError.issues?.map((i) => ({
                        path: i.path.join('.'),
                        message: i.message,
                    })) ?? [],
            });
        }
        req.body = result.data;
        return next();
    };
}

// ─── F95: Schemas para endpoints de sessão ────────────────────────────────────

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
