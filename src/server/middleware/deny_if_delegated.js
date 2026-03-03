// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';

/**
 * Middleware que bloqueia operações de escrita/configuração
 * quando o servidor está rodando no modo 'delegated'.
  * @returns {any}
 */
function denyIfDelegated(req, res, next) {
    try {
        const authority = req.app?.locals?.authority || process.env.SERVER_AUTHORITY || 'standalone';
        if (String(authority).toLowerCase() === 'delegated') {
            log('WARN', '[MW] denyIfDelegated bloqueou operação de escrita', req.id);
            return res.status(403).json({
                success: false,
                error: 'Operation not permitted: server running in delegated mode',
                request_id: req.id,
            });
        }
    } catch (e) {
        log('ERROR', `[MW] Erro no denyIfDelegated: ${e.message}`, req.id);
    }
    return next();
}

export default denyIfDelegated;
