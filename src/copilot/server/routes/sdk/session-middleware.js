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
import { toError } from '../../../core/error-handlers.js';
import {
    deleteSdkSessionRateLimitWindow,
    getSdkSessionRateLimitWindow,
    iterateSdkSessionRateLimitWindows,
    setSdkSessionRateLimitWindow,
} from '../../runtime-state/sdk-session-rate-limit.js';
import { resolveSdkRouteSharedDeps } from './deps.js';
import { buildSdkRuntimeErrorMeta, projectSdkHttpError } from './middleware.js';

export {
    CreateSessionBodySchema,
    ElicitationBodySchema,
    HandlePendingCommandBodySchema,
    HandlePendingToolCallBodySchema,
    LogMessageBodySchema,
    PermissionDecisionBodySchema,
    ResumeSessionBodySchema,
    SendMessageBodySchema,
    SetModelBodySchema,
    ShellExecBodySchema,
    ShellKillBodySchema,
    UiConfirmBodySchema,
    UiInputBodySchema,
    UiSelectBodySchema,
    WorkspaceCreateFileBodySchema,
    WorkspaceMaterializeBodySchema,
    WorkspaceMirrorBodySchema,
    WorkspacePromoteBodySchema,
} from './session-schemas.js';

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
    } catch (error) {
        return buildSdkRuntimeErrorMeta(req, error);
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
        const projection = projectSdkHttpError(req, e);
        const { status, body } = projection;
        const code = body.code;
        log('ERROR', `[sdk-api/sessions] ${req.method} ${req.path} → ${status} ${code}: ${toError(e).message}`);
        if (!res.headersSent) {
            if (status === 500) {
                res.status(500).json({ ...body, ...buildSessionRouteRuntimeMeta(req) });
                return;
            }
            res.status(status).json({ ...body, ...buildSessionRouteRuntimeMeta(req) });
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
