import path from 'node:path';
import { MAX_CHUNK_CHARS } from '../contract.mjs';
import { chunkMarkdown } from './chunk_md.mjs';
import { chunkCode } from './chunk_code.mjs';
import { chunkPlain } from './chunk_plain.mjs';

function isDockerfile(relPath) {
    const base = path.posix.basename(relPath);
    return base === 'Dockerfile' || base.toLowerCase().endsWith('.dockerfile');
}

export function detectLanguage(relPath) {
    const base = path.posix.basename(relPath);
    if (base === 'Dockerfile' || base.toLowerCase().endsWith('.dockerfile')) return 'dockerfile';
    if (base === 'Makefile') return 'makefile';
    const ext = path.posix.extname(relPath).toLowerCase();
    if (ext === '.md') return 'markdown';
    if (ext === '.ts') return 'ts';
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'js';
    if (ext === '.sh') return 'sh';
    if (ext === '.ps1') return 'ps1';
    if (ext === '.json') return 'json';
    if (ext === '.yml' || ext === '.yaml') return 'yaml';
    return undefined;
}

export function buildTags(relPath) {
    const tags = [];
    const language = detectLanguage(relPath);
    if (language) tags.push(language);
    const base = path.posix.basename(relPath);
    if (isDockerfile(relPath)) tags.push('container');
    if (base === 'Makefile') tags.push('build');
    if (base.endsWith('.env.example')) tags.push('env-example');
    if (language === 'markdown') tags.push('doc');
    return tags;
}

export function chunkByType({ relPath, lines, maxChunkChars = MAX_CHUNK_CHARS, minChunkChars = 200 }) {
    const language = detectLanguage(relPath);
    if (language === 'markdown') return chunkMarkdown({ lines, maxChunkChars, minChunkChars });
    if (language === 'js' || language === 'ts' || language === 'sh' || language === 'ps1') {
        return chunkCode({ lines, maxChunkChars, minChunkChars });
    }
    return chunkPlain({ lines, maxChunkChars, minChunkChars, linesPerBlock: 80 });
}

