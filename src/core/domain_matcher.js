// @ts-check

function normalizeDomain(/** @type {any} */ value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\.$/, '');
}

function extractHostname(/** @type {any} */ value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }

    try {
        return normalizeDomain(new URL(raw).hostname);
    } catch (_err) {
        // Fallback para hostnames sem protocolo (ex: chatgpt.com)
        return normalizeDomain(raw);
    }
}

/**
 * Verifica correspondência exata de domínio ou subdomínio.
 *
 * @param {string} currentUrlOrHostname - URL/hostname atual
 * @param {string} expectedDomain - Domínio base esperado
 * @returns {boolean}
 */
function isDomainMatch(currentUrlOrHostname, expectedDomain) {
    const host = extractHostname(currentUrlOrHostname);
    const expected = normalizeDomain(expectedDomain);

    if (!host || !expected) {
        return false;
    }

    return host === expected || host.endsWith(`.${expected}`);
}

export { isDomainMatch };
