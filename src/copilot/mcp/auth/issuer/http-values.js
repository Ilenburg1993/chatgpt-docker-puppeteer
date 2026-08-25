// @ts-check
/** Side-effect-free HTTP value normalization shared by issuer facets. */

/**
 * Return the first HTTP header value as one trimmed string.
 *
 * @param {string | string[] | undefined} value
 * @returns {string}
 */
export function firstHeaderValue(value) {
    const raw = Array.isArray(value) ? value[0] : value;
    return String(raw ?? '').trim();
}

/**
 * Normalize a hostname/socket-address spelling without deciding whether it is trusted.
 *
 * @param {string} hostname
 * @returns {string}
 */
export function normalizeHostname(hostname) {
    return String(hostname).toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '').replace(/\.$/u, '');
}
