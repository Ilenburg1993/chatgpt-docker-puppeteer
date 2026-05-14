// @ts-check
/**
 * Helpers puros de conteúdo para o index-store SQLite.
 *
 * @module copilot/infra/index-store/sqlite/content
 */

import { extname } from 'node:path';
import { sha256 as hashSha256 } from '../../shared/hash.js';

export const DEFAULT_INDEX_EXTENSIONS = Object.freeze([
    '.js',
    '.mjs',
    '.cjs',
    '.jsx',
    '.ts',
    '.mts',
    '.cts',
    '.tsx',
    '.json',
    '.jsonc',
    '.md',
    '.mdx',
    '.txt',
    '.yaml',
    '.yml',
    '.css',
    '.html',
]);

export const SYMBOL_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx']);

export const DEFAULT_CHUNK_LINES = 200;

/**
 * @param {string} content
 * @returns {string}
 */
export function sha256(content) {
    return hashSha256(content);
}

/**
 * @param {string} content
 * @returns {number}
 */
export function countLines(content) {
    if (content.length === 0) return 0;
    return content.split(/\r\n|\r|\n/u).length;
}

/**
 * @param {string} filePath
 * @returns {string}
 */
export function classifyContentKind(filePath) {
    const ext = extname(filePath).toLowerCase();
    if (SYMBOL_EXTENSIONS.has(ext)) return ext.endsWith('ts') || ext === '.tsx' ? 'typescript' : 'javascript';
    if (ext === '.json' || ext === '.jsonc') return 'json';
    if (ext === '.md' || ext === '.mdx') return 'markdown';
    if (ext === '.yaml' || ext === '.yml') return 'yaml';
    if (ext === '.html') return 'html';
    if (ext === '.css') return 'css';
    return 'text';
}

/**
 * @param {string} content
 * @param {number} [chunkLines]
 * @returns {{ index: number; startLine: number; endLine: number; content: string; hash: string }[]}
 */
export function makeLineChunks(content, chunkLines = DEFAULT_CHUNK_LINES) {
    if (content.length === 0) return [];
    const safeChunkLines = Number.isFinite(chunkLines) && chunkLines > 0 ? Math.floor(chunkLines) : DEFAULT_CHUNK_LINES;
    const lines = content.split(/\r\n|\r|\n/u);
    const chunks = [];
    for (let i = 0; i < lines.length; i += safeChunkLines) {
        const slice = lines.slice(i, i + safeChunkLines);
        const chunkContent = slice.join('\n');
        chunks.push({
            index: chunks.length,
            startLine: i + 1,
            endLine: i + slice.length,
            content: chunkContent,
            hash: sha256(chunkContent),
        });
    }
    return chunks;
}
