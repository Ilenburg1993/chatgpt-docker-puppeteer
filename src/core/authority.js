// @ts-check - Type checking rigoroso habilitado (arquivo core)
/* ==========================================================================
   src/core/authority.js
   Módulo auxiliar para resolução e validação de autoridade do processo
   (standalone | delegated)
========================================================================== */

/**
 * Modos de autoridade suportados pelo servidor.
 *
 * @enum {string}
 */
const SERVER_AUTHORITIES = Object.freeze({
    STANDALONE: 'standalone',
    DELEGATED: 'delegated',
});

/**
 * Tipo union dos modos de autoridade válidos.
 *
 * @typedef {(typeof SERVER_AUTHORITIES)[keyof typeof SERVER_AUTHORITIES]} AuthorityMode
 */

/**
 * Resolve o modo de autoridade do servidor. Ordem de precedência: parâmetro explícito > env SERVER_AUTHORITY > default
 * STANDALONE.
 *
 * @param {unknown} [explicitAuthority] - Modo de autoridade explícito (opcional).
 * @returns {AuthorityMode} Modo de autoridade resolvido.
 * @throws {Error} Se o modo de autoridade for inválido.
 */
function resolveAuthority(explicitAuthority = null) {
    const raw = explicitAuthority ?? process.env['SERVER_AUTHORITY'] ?? SERVER_AUTHORITIES.STANDALONE;
    const authority = String(raw).toLowerCase().trim();

    const known = /** @type {string[]} */ (Object.values(SERVER_AUTHORITIES));
    if (!known.includes(authority)) {
        throw new Error(`Invalid SERVER_AUTHORITY: ${raw}`);
    }

    return /** @type {AuthorityMode} */ (authority);
}

/**
 * Verifica se o modo de autoridade é 'delegated'.
 *
 * @param {string | AuthorityMode} authority - Modo de autoridade a verificar.
 * @returns {boolean} True se for delegated, false caso contrário.
 */
function isDelegated(authority) {
    return String(authority).toLowerCase() === SERVER_AUTHORITIES.DELEGATED;
}

/**
 * Verifica se o modo de autoridade é 'standalone'.
 *
 * @param {string | AuthorityMode} authority - Modo de autoridade a verificar.
 * @returns {boolean} True se for standalone, false caso contrário.
 */
function isStandalone(authority) {
    return String(authority).toLowerCase() === SERVER_AUTHORITIES.STANDALONE;
}

export { SERVER_AUTHORITIES, isDelegated, isStandalone, resolveAuthority };
