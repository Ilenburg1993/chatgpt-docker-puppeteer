// @ts-check
/**
 * Helpers de consulta do index-store SQLite.
 *
 * @module copilot/infra/index-store/sqlite/query
 */

import { normalizeMaxResults } from '../../policy/output-window.js';
import { readEnvPositiveInt } from '../../shared/env.js';

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
        .filter(Boolean);
    return tokens.length > 0 ? tokens.map((token) => `"${token.replace(/"/gu, '""')}"`).join(' ') : '""';
}
