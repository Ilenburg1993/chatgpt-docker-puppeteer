// @ts-check
/**
 * Leitura bounded de respostas dos importers de catálogo.
 *
 * @module copilot/model-gateway/catalog/importers/response-body
 */

import {
    readBoundedResponseJson,
    readBoundedResponseText,
} from '#copilot/infra/public/http-response';

export const DEFAULT_CATALOG_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
export const MAX_CATALOG_RESPONSE_MAX_BYTES = 32 * 1024 * 1024;

/**
 * @param {Response} response
 * @param {{ maxBytes?: number; label?: string }} [options]
 * @returns {Promise<string>}
 */
export async function readCatalogResponseText(response, options = {}) {
    return readBoundedResponseText(response, {
        ...options,
        defaultMaxBytes: DEFAULT_CATALOG_RESPONSE_MAX_BYTES,
        hardMaxBytes: MAX_CATALOG_RESPONSE_MAX_BYTES,
        label: options.label ?? 'Catalog response',
    });
}

/**
 * @param {Response} response
 * @param {{ maxBytes?: number; label?: string }} [options]
 * @returns {Promise<unknown>}
 */
export async function readCatalogResponseJson(response, options = {}) {
    return readBoundedResponseJson(response, {
        ...options,
        defaultMaxBytes: DEFAULT_CATALOG_RESPONSE_MAX_BYTES,
        hardMaxBytes: MAX_CATALOG_RESPONSE_MAX_BYTES,
        label: options.label ?? 'Catalog response',
    });
}
