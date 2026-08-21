// @ts-check
/**
 * Minimal HTTP port used by catalog importers.
 *
 * Native `fetch` is a valid adapter. Tests can provide a structural response containing only the bounded-readable body
 * capabilities they exercise, without pretending to implement the full Web `Response` surface.
 *
 * @module copilot/model-gateway/catalog/importers/http-port
 */

/**
 * @typedef {Parameters<typeof import('#copilot/infra/public/platform').readBoundedResponseText>[0] & {
 *     ok: boolean;
 *     status: number;
 * }} CatalogHttpResponse
 */

/**
 * @typedef {(input: string | URL, init?: RequestInit) => Promise<CatalogHttpResponse>} CatalogFetch
 */

/**
 * Reads a request header using the Web `Headers` normalization rules.
 *
 * @param {RequestInit | undefined} init
 * @param {string} name
 * @returns {string | null}
 */
export function catalogRequestHeader(init, name) {
    return new Headers(init?.headers).get(name);
}
