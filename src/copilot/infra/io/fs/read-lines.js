// @ts-check
/**
 * Leitura textual baixa em linhas.
 *
 * @module copilot/infra/io/fs/read-lines
 */

import { readTextFileSnapshot } from './read-text.js';

/**
 * @param {string} filePath
 * @returns {Promise<{ path: string; lines: string[]; bytesRead: number; totalLines: number }>}
 */
export async function readTextLinesSnapshot(filePath) {
    const snapshot = await readTextFileSnapshot(filePath);
    const lines = snapshot.content.length === 0 ? [] : snapshot.content.split(/\r\n|\r|\n/u);
    return {
        path: filePath,
        lines,
        bytesRead: snapshot.bytesRead,
        totalLines: lines.length,
    };
}
