// @ts-check
/**
 * Helpers de consulta do index-store SQLite.
 *
 * @module copilot/infra/indexing/registry/sqlite/query
 */

import { readEnvPositiveInt } from '#copilot/infra/internal/platform';
import { normalizeMaxResults } from '#copilot/infra/internal/policy';

const DEFAULT_INDEX_SEARCH_MAX_RESULTS = readEnvPositiveInt('IO_INDEX_SEARCH_MAX_RESULTS', 50);
const MAX_INDEX_SEARCH_RESULTS = readEnvPositiveInt('IO_INDEX_SEARCH_HARD_MAX_RESULTS', 500);

/**
 * @param {number | undefined} value
 * @returns {number}
 */
export function normalizeIndexMaxResults(value) {
    return Math.min(normalizeMaxResults(value) ?? DEFAULT_INDEX_SEARCH_MAX_RESULTS, MAX_INDEX_SEARCH_RESULTS);
}

/**
 * @param {string} query
 * @returns {string}
 */
export function sanitizeFtsQuery(query) {
    const tokens = query
        .split(/\s+/u)
        .map((part) => part.replace(/[^\p{L}\p{N}_./:-]+/gu, '').trim())
        .filter((token) => token.length >= 1);
    return tokens.length > 0 ? tokens.map((token) => `"${token.replace(/"/gu, '""')}"`).join(' ') : '""';
}
