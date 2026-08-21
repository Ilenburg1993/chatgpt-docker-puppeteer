// @ts-check
import * as nodePath from 'node:path';

const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx']);
const TS_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.tsx']);

/** @param {string} filePath */
export function normalizeParserPath(filePath) {
    return nodePath.normalize(nodePath.resolve(filePath));
}

/** @param {string} ext @returns {'js' | 'ts' | 'json' | 'markdown' | 'unknown'} */
export function classifyParserExtension(ext) {
    if (JS_EXTENSIONS.has(ext)) return 'js';
    if (TS_EXTENSIONS.has(ext)) return 'ts';
    if (ext === '.json' || ext === '.jsonl') return 'json';
    if (ext === '.md' || ext === '.mdx') return 'markdown';
    return 'unknown';
}
