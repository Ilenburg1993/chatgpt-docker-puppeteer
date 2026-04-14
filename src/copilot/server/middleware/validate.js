// @ts-check
/**
 * src/copilot/server/middleware/validate.js — Factory de middleware de validacao Zod.
 *
 * Onda 6.0: validacao estruturada de body, query e params para rotas POST/PUT.
 *
 * @module copilot/server/middleware/validate
 */

/** @typedef {import('zod').ZodType} ZodType */

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 *
 * @typedef {import('express').NextFunction} Next
 */

/**
 * Opcionalmente pode validar body, query ou params.
 *
 * @typedef {object} ValidationSchemas
 * @property {ZodType} [body] - Schema para req.body.
 * @property {ZodType} [query] - Schema para req.query.
 * @property {ZodType} [params] - Schema para req.params.
 */

/**
 * Cria um middleware Express que valida request contra schemas Zod.
 *
 * Em caso de erro de validacao, retorna 400 com erros estruturados.
 *
 * @example
 *     import { validate } from '../middleware/validate.js';
 *     router.post('/sessions', validate({ body: z.object({ title: z.string().optional() }) }), handler);
 *
 * @param {ValidationSchemas} schemas
 * @returns {(req: Req, res: Res, next: Next) => void}
 */
export function validate(schemas) {
    return (req, res, next) => {
        /** @type {{ location: string; issues: { path: string; message: string }[] }[]} */
        const errors = [];

        if (schemas.body) {
            const result = schemas.body.safeParse(req.body);
            if (!result.success) {
                errors.push({ location: 'body', issues: extractIssues(result) });
            }
        }

        if (schemas.query) {
            const result = schemas.query.safeParse(req.query);
            if (!result.success) {
                errors.push({ location: 'query', issues: extractIssues(result) });
            }
        }

        if (schemas.params) {
            const result = schemas.params.safeParse(req.params);
            if (!result.success) {
                errors.push({ location: 'params', issues: extractIssues(result) });
            }
        }

        if (errors.length > 0) {
            res.status(400).json({
                ok: false,
                error: 'Validation failed',
                validation: errors,
            });
            return;
        }

        next();
    };
}

/**
 * Extrai issues de um resultado de safeParse falho.
 *
 * @param {{ error?: unknown }} result
 * @returns {{ path: string; message: string }[]}
 */
function extractIssues(result) {
    const error = /** @type {{ issues?: { path?: (string | number)[]; message?: string }[] }} */ (result.error);
    if (!error?.issues || !Array.isArray(error.issues)) {
        return [{ path: '', message: String(error) }];
    }
    return error.issues.map((issue) => ({
        path: (issue.path ?? []).join('.'),
        message: issue.message ?? 'Invalid',
    }));
}
