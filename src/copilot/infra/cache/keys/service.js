// @ts-check
/**
 * Chaves canônicas do cache L1 de I/O.
 *
 * @module copilot/infra/cache/keys/service
 */

import { normalizePathResourceKey } from '#copilot/infra/internal/policy';

/**
 * Normaliza um path para uso como chave de cache. NÃO faz I/O.
 *
 * @param {string} filePath
 * @returns {string}
 */
export function normalizeIoCacheKey(filePath) {
    return normalizePathResourceKey(filePath);
}

/**
 * @param {string} normalizedPath
 * @returns {string}
 */
export function makeBytesKey(normalizedPath) {
    return `${normalizedPath}::read:bytes`;
}

/**
 * @param {string} normalizedPath
 * @param {number | undefined} startLine
 * @param {number | undefined} endLine
 * @returns {string}
 */
export function makeTextKey(normalizedPath, startLine, endLine) {
    const start = startLine ?? 0;
    const end = endLine ?? 0;
    if (start === 0 && end === 0) return `${normalizedPath}::read:text`;
    return `${normalizedPath}::read:text:${start}:${end}`;
}
