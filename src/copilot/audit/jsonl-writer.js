// @ts-check
/**
 * src/copilot/audit/jsonl-writer.js
 *
 * Escrita assíncrona de JSONL com rotação automática e batch I/O via setImmediate.
 *
 * @module copilot/audit/jsonl-writer
 */

import { logSwallowed } from '#copilot/core';
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

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
    const filePath = opts.filePath;
    const rotatedPath = filePath + '.1';
    const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;

    /** @type {string[]} */
    const _queue = [];
    let _flushScheduled = false;
    let _sizeBytes = -1;

    /** @returns {void} */
    function scheduleFlush() {
        if (_flushScheduled) return;
        _flushScheduled = true;
        setImmediate(async () => {
            _flushScheduled = false;
            const batch = _queue.splice(0);
            if (!batch.length) return;
            try {
                await mkdir(dirname(filePath), { recursive: true });
                if (_sizeBytes < 0) {
                    try {
                        const { size } = await stat(filePath);
                        _sizeBytes = size;
                    } catch {
                        _sizeBytes = 0;
                    }
                }
                const data = batch.join('');
                const dataBytes = Buffer.byteLength(data, 'utf8');
                if (_sizeBytes + dataBytes >= maxBytes) {
                    await rename(filePath, rotatedPath);
                    _sizeBytes = 0;
                }
                await appendFile(filePath, data, 'utf8');
                _sizeBytes += dataBytes;
            } catch (/** @type {any} */ e) {
                logSwallowed(e, 'audit.jsonlWriter.write');
            }
        });
    }

    return {
        /**
         * Enfileira uma linha para escrita assíncrona.
         *
         * @param {object} record
         * @returns {void}
         */
        write(record) {
            _queue.push(JSON.stringify(record) + '\n');
            scheduleFlush();
        },
    };
}
