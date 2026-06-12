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
import { utf8ByteLength } from '#copilot/infra/public/buffer';
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
    /** @type {Promise<void>} */
    let _flushChain = Promise.resolve();

    /** @returns {Promise<void>} */
    function flushQueued() {
        const batch = _queue.splice(0);
        if (!batch.length) return _flushChain;
        _flushChain = _flushChain
            .catch(() => undefined)
            .then(async () => {
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
                const dataBytes = utf8ByteLength(data, 'jsonl audit batch');
                if (_sizeBytes + dataBytes >= maxBytes) {
                    await rename(filePath, rotatedPath);
                    _sizeBytes = 0;
                }
                await appendFile(filePath, data, 'utf8');
                _sizeBytes += dataBytes;
            })
            .catch((e) => {
                logSwallowed(e, 'audit.jsonlWriter.write');
            })
            .finally(() => {
                if (_queue.length > 0) scheduleFlush();
            });
        return _flushChain;
    }

    /** @returns {void} */
    function scheduleFlush() {
        if (_flushScheduled) return;
        _flushScheduled = true;
        setImmediate(() => {
            _flushScheduled = false;
            void flushQueued();
        });
    }

    /** @returns {Promise<void>} */
    async function flush() {
        while (_flushScheduled || _queue.length > 0) {
            _flushScheduled = false;
            await flushQueued();
        }
        await _flushChain;
        if (_queue.length > 0) {
            try {
                await flush();
            } catch {
                // Errors are observed by flushQueued.
            }
        }
    }

    return {
        /**
         * Enfileira uma linha para escrita assíncrona.
         *
         * @param {object} record
         * @returns {void}
         */
        write(record) {
            _queue.push(JSON.stringify(redactSecretRecord(/** @type {Record<string, unknown>} */ (record))) + '\n');
            scheduleFlush();
        },
        flush,
    };
}
