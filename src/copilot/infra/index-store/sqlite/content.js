// @ts-check
/**
 * Helpers puros de conteúdo para o index-store SQLite.
 *
 * @module copilot/infra/index-store/sqlite/content
 */

import { extname } from 'node:path';
import { sha256 as hashSha256 } from '../../shared/hash.js';
import { countPhysicalTextLines, iterateTextLines } from '../../shared/text-lines.js';

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
 * Conta linhas físicas indexáveis para persistência no index-store.
 *
 * Contrato: string vazia retorna 0 (arquivo vazio não possui linhas materializadas no índice). Para deltas de patch com
 * baseline mínima de 1 linha, usar utilitário específico do domínio de patch.
 *
 * @param {string} content
 * @returns {number}
 */
export function countLines(content) {
    return content.length === 0 ? 0 : countPhysicalTextLines(content);
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
    return [...iterateLineChunks(content, chunkLines)];
}

/**
 * Produz chunks com memória intermediária limitada a `chunkLines`.
 *
 * @param {string} content
 * @param {number} [chunkLines]
 * @returns {Generator<{ index: number; startLine: number; endLine: number; content: string; hash: string }>}
 */
export function* iterateLineChunks(content, chunkLines = DEFAULT_CHUNK_LINES) {
    if (content.length === 0) return;
    const safeChunkLines = Number.isFinite(chunkLines) && chunkLines > 0 ? Math.floor(chunkLines) : DEFAULT_CHUNK_LINES;
    /** @type {string[]} */
    let lines = [];
    let chunkIndex = 0;
    let startLine = 1;

    for (const entry of iterateTextLines(content)) {
        lines.push(entry.text);
        if (lines.length < safeChunkLines) continue;
        const chunkContent = lines.join('\n');
        yield {
            index: chunkIndex,
            startLine,
            endLine: entry.line,
            content: chunkContent,
            hash: sha256(chunkContent),
        };
        chunkIndex += 1;
        startLine = entry.line + 1;
        lines = [];
    }

    if (lines.length > 0) {
        const chunkContent = lines.join('\n');
        yield {
            index: chunkIndex,
            startLine,
            endLine: startLine + lines.length - 1,
            content: chunkContent,
            hash: sha256(chunkContent),
        };
    }
}
