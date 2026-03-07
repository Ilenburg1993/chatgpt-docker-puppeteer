// @ts-check
import crypto from 'node:crypto';

/**
 * Regex para validação rigorosa de UUID v4.
 * Garante que IDs providos externamente sigam o padrão industrial.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @typedef {any} RequestIdReq */
/** @typedef {any} RequestIdRes */
/**
 * Middleware de Injeção de Identidade de Requisição.
 *
 * @param {RequestIdReq} req - Request Express.
 * @param {RequestIdRes} res - Response Express.
 * @param {function} next - Próximo middleware.
  * @returns {void}
 */
function requestId(req, res, next) {
    // 1. Tenta recuperar ID pré-existente (vido de Proxy, Load Balancer ou Dashboard)
    let id = req.headers['x-request-id'];

    // 2. Validação e Higiene
    // Se o ID não existir ou for malformado (não for um UUID válido), gera um novo DNA.
    if (!id || !UUID_REGEX.test(id)) {
        id = crypto.randomUUID();
    }

    // 3. Injeção no Objeto de Requisição
    // req.id torna-se a chave primária para logs e auditoria deste ciclo.
    req.id = id;

    // 4. Sinalização de Resposta
    // Devolve o ID no header para que o cliente possa rastrear a operação.
    res.setHeader('x-request-id', id);

    next();
}

export default requestId;
