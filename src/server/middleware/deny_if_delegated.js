// @ts-check
import { log } from '#core/logger';

/**
 * Middleware que bloqueia operações de escrita/configuração quando o servidor está rodando no modo 'delegated'.
 *
 * @param {any} req
 * @param {any} res
 * @param {any} next
 * @returns {void}
 */
function denyIfDelegated(req, res, next) {
    try {
        const authority = req.app?.locals?.authority || process.env['SERVER_AUTHORITY'] || 'standalone';
        if (String(authority).toLowerCase() === 'delegated') {
            log('WARN', '[MW] denyIfDelegated bloqueou operação de escrita', req.id);
            return res.status(403).json({
                success: false,
                error: 'Operation not permitted: server running in delegated mode',
                request_id: req.id,
            });
        }
    } catch (/** @type {any} */ e) {
        const _e = /** @type {any} */ (e);
        log('ERROR', `[MW] Erro no denyIfDelegated: ${_e.message}`, req.id);
    }
    return next();
}

export default denyIfDelegated;
