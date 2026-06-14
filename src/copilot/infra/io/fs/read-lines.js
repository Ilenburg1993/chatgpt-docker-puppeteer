// @ts-check
/**
 * Leitura textual baixa em linhas.
 *
 * @module copilot/infra/io/fs/read-lines
 */

import { readTextFileSnapshot } from './read-text.js';
import { splitPhysicalTextLines } from '../../shared/text-lines.js';

/**
 * @param {string} filePath
 * @returns {Promise<{ path: string; lines: string[]; bytesRead: number; totalLines: number }>}
 */
export async function readTextLinesSnapshot(filePath) {
    const snapshot = await readTextFileSnapshot(filePath);
    const lines = splitPhysicalTextLines(snapshot.content, { emptyAsNoLines: true });
    return {
        path: filePath,
        lines,
        bytesRead: snapshot.bytesRead,
        totalLines: lines.length,
    };
}
