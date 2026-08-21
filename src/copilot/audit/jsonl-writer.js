// @ts-check
/**
 * src/copilot/audit/jsonl-writer.js
 *
 * Escrita assíncrona de JSONL com rotação automática e batch I/O via setImmediate.
 *
 * @module copilot/audit/jsonl-writer
 * @see EventBus
 */

import { logSwallowed, redactSecretRecord } from '#copilot/core';
import { createJsonlFileWriter } from '#copilot/infra/public/persistence/jsonl';

/**
 * @typedef {object} JsonlWriterOptions
 * @property {string} filePath - Caminho do arquivo JSONL.
 * @property {number} [maxBytes] - Tamanho máximo antes de rotação (default: 10 MB).
 */

/**
 * Cria um writer JSONL assíncrono com rotação automática.
 *
 * @param {JsonlWriterOptions} opts
 */
export function createJsonlWriter(opts) {
    const writer = createJsonlFileWriter({
        filePath: opts.filePath,
        maxBytes: opts.maxBytes ?? 10 * 1024 * 1024,
        onError: (error) => logSwallowed(error, 'audit.jsonlWriter.write'),
    });

    return {
        /**
         * Enfileira uma linha para escrita assíncrona.
         *
         * @param {object} record
         * @returns {void}
         */
        write(record) {
            writer.enqueueLine(JSON.stringify(redactSecretRecord(/** @type {Record<string, unknown>} */ (record))));
        },
        flush: writer.flush,
        getState: writer.getState,
    };
}
