// @ts-check
/**
 * Leitura textual baixa, acíclica e sem cache.
 *
 * Esta porta existe para módulos internos como parser e index-store que precisam ler um snapshot textual sem depender
 * da facade `io-engine`, que por sua vez consulta índice/cache e participa de orquestração superior.
 *
 * @module copilot/infra/filesystem/read/snapshot/text
 */

import { decodeUtf8Buffer } from '#copilot/infra/internal/platform';
import { readBytesFileSnapshot } from './bytes.js';

/**
 * @typedef {object} TextFileSnapshot
 * @property {string} path
 * @property {string} content
 * @property {number} bytesRead
 * @property {number} sizeBytes
 * @property {number} mtimeMs
 * @property {number} ctimeMs
 * @property {number} dev
 * @property {number} ino
 * @property {number} attempts
 * @property {true} consistent
 */

/**
 * Lê um arquivo como UTF-8 validado e retorna metadados do mesmo snapshot operacional.
 *
 * @param {string} filePath
 * @param {{ signal?: AbortSignal; maxRetries?: number }} [options]
 * @returns {Promise<TextFileSnapshot>}
 */
export async function readTextFileSnapshot(filePath, options = {}) {
    const snapshot = await readBytesFileSnapshot(filePath, options);
    const text = decodeUtf8Buffer(snapshot.content);
    return {
        path: filePath,
        content: text,
        bytesRead: snapshot.content.byteLength,
        sizeBytes: snapshot.sizeBytes,
        mtimeMs: snapshot.mtimeMs,
        ctimeMs: snapshot.ctimeMs,
        dev: snapshot.dev,
        ino: snapshot.ino,
        attempts: snapshot.attempts,
        consistent: true,
    };
}
