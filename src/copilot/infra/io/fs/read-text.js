// @ts-check
/**
 * Leitura textual baixa, acíclica e sem cache.
 *
 * Esta porta existe para módulos internos como parser e index-store que precisam ler um snapshot textual sem depender
 * da facade `io-engine`, que por sua vez consulta índice/cache e participa de orquestração superior.
 *
 * @module copilot/infra/io/fs/read-text
 */

import * as fs from 'node:fs/promises';
import { decodeUtf8Buffer } from '../../shared/buffer.js';

/**
 * @typedef {object} TextFileSnapshot
 * @property {string} path
 * @property {string} content
 * @property {number} bytesRead
 * @property {number} sizeBytes
 * @property {number} mtimeMs
 * @property {number} ctimeMs
 */

/**
 * Lê um arquivo como UTF-8 validado e retorna metadados do mesmo snapshot operacional.
 *
 * @param {string} filePath
 * @returns {Promise<TextFileSnapshot>}
 */
export async function readTextFileSnapshot(filePath) {
    const [content, stats] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)]);
    const text = decodeUtf8Buffer(content);
    return {
        path: filePath,
        content: text,
        bytesRead: content.byteLength,
        sizeBytes: stats.size,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
    };
}
