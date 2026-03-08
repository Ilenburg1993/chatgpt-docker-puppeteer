// @ts-check
import { audit, log } from '#core/logger';

/**
 * Middleware para tratamento de rotas não localizadas (404). Atua como o último recurso antes do processador de erros
 * global.
 *
 * @param {any} req
 * @param {any} res
 * @param {any} next
 * @returns {void}
 */
function notFound(req, res, next) {
    const error = new Error(`Recurso não localizado: ${req.method} ${req.originalUrl}`);
    res.status(404);
    next(error);
}

/** @typedef {any} ErrorHandlerReq */
/** @typedef {any} ErrorHandlerRes */
/**
 * Middleware Global de Erros (500). Captura qualquer exceção lançada nos controllers ou middlewares anteriores.
 *
 * @param {Error} err - Objeto de erro capturado.
 * @param {ErrorHandlerReq} req - Request Express.
 * @param {ErrorHandlerRes} res - Response Express.
 * @param {function} next - Próximo middleware.
 * @returns {void}
 */
function errorHandler(err, req, res, next) {
    // 1. Determinação do Status Code
    // Se o status já foi definido (ex: 404), mantém. Caso contrário, assume falha interna (500).
    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;

    // 2. Extração de Metadados de Rastreabilidade
    const requestId = req.id || 'no-request-id';

    const errorDetails = {
        message: err.message,
        request_id: requestId,
        path: req.originalUrl,
        method: req.method,
        // Em produção, ocultamos o stack trace para evitar vazamento de infraestrutura
        stack: process.env.NODE_ENV === 'production' ? '🥞 (Details hidden in production)' : err.stack,
    };

    // 3. Registro no Log Operacional (Para Diagnóstico Técnico)
    // O log leva o requestId como terceiro parâmetro para correlação total
    log('ERROR', `[API_FAILURE] ${err.message}`, requestId);

    // 4. Registro na Auditoria (Para Governança)
    // Apenas erros críticos (>= 500) são auditados para evitar ruído com 404s
    if (statusCode >= 500) {
        audit('SERVER_ERROR', {
            msg: err.message,
            path: req.originalUrl,
            status: statusCode,
            request_id: requestId,
        });
    }

    // 5. Resposta Padronizada ao Dashboard
    const isProduction = process.env.NODE_ENV === 'production';
    res.status(statusCode).json({
        success: false,
        error: statusCode === 404 ? 'Recurso não encontrado' : 'Erro interno do servidor',
        request_id: requestId,
        // Só incluir detalhes em desenvolvimento
        ...(isProduction ? {} : { details: errorDetails }),
    });
}

export { errorHandler, notFound };
