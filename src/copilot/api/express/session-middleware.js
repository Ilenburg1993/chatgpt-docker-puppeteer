// @ts-check
/**
 * src/copilot/api/express/session-middleware.js
 *
 * Middlewares e helpers compartilhados pelas rotas de sessão SDK.
 *
 * @module copilot/api/express/session-middleware
 * @see EventBus
 */

import { log } from '#copilot/observability';
import { z } from 'zod';
import { toError } from '../../core/error-handlers.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 */

// SEC-N05/N06 (fix): validação de model — prevenir injeção e garantir formato kosher
const MODEL_SAFE_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,99})$/;

/** @type {Map<string, { count: number; bucketStart: number }>} */
const _rlWindowMap = new Map();

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
        for (const [k, e] of _rlWindowMap) {
            if (now - e.bucketStart > WINDOW_MS) _rlWindowMap.delete(k);
        }
        const entry = _rlWindowMap.get(key);
        if (!entry || now - entry.bucketStart > WINDOW_MS) {
            _rlWindowMap.set(key, { count: 1, bucketStart: now });
            return next();
        }
        entry.count += 1;
        if (entry.count > maxPerMinute) {
            return res.status(429).json({ ok: false, error: 'Too many requests. Tente novamente em 1 minuto.' });
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
            res.status(500).json({ ok: false, error: toError(e).message });
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
    model: z.string(),
    sessionId: z.string().optional(),
    systemMessage: z.unknown().optional(),
    infiniteSessions: z.unknown().optional(),
    workingDirectory: z.string().optional(),
    streaming: z.boolean().optional(),
    provider: z.unknown().optional(),
    reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
    availableTools: z.array(z.string()).optional(),
    excludedTools: z.array(z.string()).optional(),
    customAgents: z.array(z.unknown()).optional(),
    clientName: z.string().optional(),
});

/** Schema para POST /sessions/:id/send body */
export const SendMessageBodySchema = z.object({
    prompt: z.string().min(1),
    waitForResponse: z.boolean().optional(),
    timeoutMs: z.number().positive().finite().optional(),
    attachments: z.array(z.unknown()).optional(),
    mode: z.enum(['immediate', 'enqueue']).optional(),
});

/** Schema para POST /sessions/:id/model body */
export const SetModelBodySchema = z.object({
    model: z.string(),
});

/** Schema para POST /sessions/:id/resume body */
export const ResumeSessionBodySchema = z
    .object({
        model: z.string().optional(),
    })
    .optional();
