// @ts-check - Type checking rigoroso habilitado (arquivo core)
/* ==========================================================================
   src/core/authority.js
   Módulo auxiliar para resolução e validação de autoridade do processo
   (standalone | delegated)
========================================================================== */

const SERVER_AUTHORITIES = Object.freeze({
    STANDALONE: 'standalone',
    DELEGATED: 'delegated'
});

/**
 * @typedef {(typeof SERVER_AUTHORITIES)[keyof typeof SERVER_AUTHORITIES]} AuthorityMode
 */

/**
 * @param {unknown} [explicitAuthority]
 * @returns {AuthorityMode}
 */
function resolveAuthority(explicitAuthority = null) {
    const raw = explicitAuthority ?? process.env.SERVER_AUTHORITY ?? SERVER_AUTHORITIES.STANDALONE;
    const authority = String(raw).toLowerCase().trim();

    const known = /** @type {string[]} */ (Object.values(SERVER_AUTHORITIES));
    if (!known.includes(authority)) {
        throw new Error(`Invalid SERVER_AUTHORITY: ${raw}`);
    }

    return /** @type {AuthorityMode} */ (authority);
}

function isDelegated(authority) {
    return String(authority).toLowerCase() === SERVER_AUTHORITIES.DELEGATED;
}

function isStandalone(authority) {
    return String(authority).toLowerCase() === SERVER_AUTHORITIES.STANDALONE;
}

export { SERVER_AUTHORITIES, resolveAuthority, isDelegated, isStandalone };
