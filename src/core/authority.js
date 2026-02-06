/* ==========================================================================
   src/core/authority.js
   Módulo auxiliar para resolução e validação de autoridade do processo
   (standalone | delegated)
========================================================================== */

const SERVER_AUTHORITIES = Object.freeze({
    STANDALONE: 'standalone',
    DELEGATED: 'delegated'
});

function resolveAuthority(explicitAuthority = null) {
    const raw = explicitAuthority ?? process.env.SERVER_AUTHORITY ?? SERVER_AUTHORITIES.STANDALONE;
    const authority = String(raw).toLowerCase().trim();

    if (!Object.values(SERVER_AUTHORITIES).includes(authority)) {
        throw new Error(`Invalid SERVER_AUTHORITY: ${raw}`);
    }

    return authority;
}

function isDelegated(authority) {
    return String(authority).toLowerCase() === SERVER_AUTHORITIES.DELEGATED;
}

function isStandalone(authority) {
    return String(authority).toLowerCase() === SERVER_AUTHORITIES.STANDALONE;
}

export { SERVER_AUTHORITIES, resolveAuthority, isDelegated, isStandalone };
