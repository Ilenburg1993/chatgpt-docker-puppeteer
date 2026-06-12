// @ts-check
/**
 * Leitura tolerante da cauda de arquivos JSONL.
 *
 * @module copilot/infra/io/jsonl-reader
 */

import { open } from 'node:fs/promises';

const DEFAULT_BLOCK_SIZE = 65_536;

/**
 * @param {string} filePath
 * @param {{ maxLines?: number; blockSize?: number }} [options]
 * @returns {Promise<{
 *     records: unknown[];
 *     invalidLines: number;
 *     trailingPartialIgnored: boolean;
 * }>}
 */
export async function readJsonlTail(filePath, options = {}) {
    const maxLines = Math.max(1, Math.trunc(options.maxLines ?? 50));
    const blockSize = Math.max(1_024, Math.trunc(options.blockSize ?? DEFAULT_BLOCK_SIZE));
    /** @type {import('node:fs/promises').FileHandle | null} */
    let handle = null;
    try {
        handle = await open(filePath, 'r');
        const { size } = await handle.stat();
        if (size === 0) return { records: [], invalidLines: 0, trailingPartialIgnored: false };

        const finalByte = Buffer.alloc(1);
        await handle.read(finalByte, 0, 1, size - 1);
        const hasTrailingNewline = finalByte[0] === 0x0a;
        let remaining = size;
        let newlineCount = 0;
        let collectedBytes = 0;
        /** @type {Buffer[]} */
        const chunks = [];
        while (remaining > 0 && newlineCount <= maxLines) {
            const readSize = Math.min(blockSize, remaining);
            remaining -= readSize;
            const buffer = Buffer.alloc(readSize);
            await handle.read(buffer, 0, readSize, remaining);
            chunks.unshift(buffer);
            collectedBytes += readSize;
            for (const byte of buffer) {
                if (byte === 0x0a) newlineCount += 1;
            }
        }
        const split = Buffer.concat(chunks, collectedBytes).toString('utf8').split('\n');
        if (remaining > 0) split.shift();
        const lines = split.filter((line) => line.trim()).slice(-maxLines);

        /** @type {unknown[]} */
        const records = [];
        let invalidLines = 0;
        let trailingPartialIgnored = false;
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            if (!line) continue;
            try {
                records.push(JSON.parse(line));
            } catch {
                invalidLines += 1;
                if (!hasTrailingNewline && index === lines.length - 1) trailingPartialIgnored = true;
            }
        }
        return { records, invalidLines, trailingPartialIgnored };
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT') return { records: [], invalidLines: 0, trailingPartialIgnored: false };
        throw error;
    } finally {
        await handle?.close();
    }
}
