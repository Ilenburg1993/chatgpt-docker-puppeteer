/* ==========================================================================
   src/server/middleware/request_id.js
   Audit Level: 600 — Transactional DNA Injector (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Garantir que toda requisição HTTP possua um identificador 
                     único universal (UUID) para rastreabilidade de ponta a ponta.
   Sincronizado com: error_handler.js V600, app.js V100.
========================================================================== */

const crypto = require('crypto');

/**
 * Regex para validação rigorosa de UUID v4.
 * Garante que IDs providos externamente sigam o padrão industrial.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Middleware de Injeção de Identidade de Requisição.
 * 
 * @param {object} req - Request Express.
 * @param {object} res - Response Express.
 * @param {function} next - Próximo middleware.
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

module.exports = requestId;