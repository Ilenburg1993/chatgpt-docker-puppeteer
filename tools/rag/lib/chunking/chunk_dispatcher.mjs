// @ts-check
import path from 'node:path';
import {
    MAX_CHUNK_CHARS_CODE,
    MAX_CHUNK_CHARS_DOCS,
    RAG_CHUNK_MAX_CHARS,
    RAG_CHUNK_TARGET_CHARS,
} from '../contract.mjs';
import { chunkMarkdown } from './chunk_md.mjs';
import { chunkCode } from './chunk_code.mjs';
import { chunkPlain } from './chunk_plain.mjs';
import { chunkJsAst } from './chunk_js_ast.mjs';

function isDockerfile(/** @type {any} */ relPath) {
    const base = path.posix.basename(relPath);
    return base === 'Dockerfile' || base.toLowerCase().endsWith('.dockerfile');
}

export function detectLanguage(/** @type {any} */ relPath) {
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

export function buildTags(/** @type {any} */ relPath) {
    const tags = [];
    const language = detectLanguage(relPath);
    if (language) tags.push(language);
    const base = path.posix.basename(relPath);
    if (isDockerfile(relPath)) tags.push('container');
    if (base === 'Makefile') tags.push('build');
    if (base.endsWith('.env.example')) tags.push('env-example');
    if (language === 'markdown') tags.push('doc');
    const aliasTag = detectAliasTag(relPath);
    if (aliasTag) tags.push(aliasTag);
    return tags;
}

function detectAliasTag(/** @type {any} */ relPath) {
    const normalized = String(relPath || '').replace(/\\/g, '/');
    if (normalized.startsWith('src/core/')) return '#core/*';
    if (normalized.startsWith('src/nerv/')) return '#nerv/*';
    if (normalized.startsWith('src/infra/')) return '#infra/*';
    if (normalized.startsWith('src/server/')) return '#server/*';
    if (normalized.startsWith('src/integration/')) return '#integration/*';
    return null;
}

function isAstChunkingEnabled() {
    return String(process.env.RAG_AST_CHUNK_ENABLED || 'true') !== 'false';
}

function buildHeaderText(/** @type {any} */ {
    relPath,
    language,
    kind,
    symbol,
    exported,
    tags,
    imports,
    anchor,
    jsdoc,
    subchunkIndex,
    subchunkTotal,
}) {
    const lines = [];
    lines.push(`path: ${relPath}`);
    lines.push(`language: ${language || 'unknown'}`);
    lines.push(`kind: ${kind || 'module_fallback'}`);
    if (symbol) lines.push(`symbol: ${symbol}`);
    lines.push(`exported: ${exported ? 'true' : 'false'}`);
    if (tags?.length) lines.push(`tags: ${tags.join(', ')}`);
    if (imports?.length) lines.push(`imports: ${imports.slice(0, 5).join(', ')}`);
    if (anchor) lines.push(`anchor: ${anchor}`);
    if (jsdoc) lines.push(`jsdoc: ${String(jsdoc).slice(0, 280)}`);
    if (subchunkIndex && subchunkTotal) lines.push(`subchunk: ${subchunkIndex}/${subchunkTotal}`);
    return lines.join('\n');
}

function enrichRanges(/** @type {any} */ ranges, /** @type {any} */ defaults) {
    return ranges.map((/** @type {any} */ r) => {
        const kind = r.kind || defaults.kind;
        const symbol = r.symbol || null;
        const exported = typeof r.exported === 'boolean' ? r.exported : defaults.exported;
        const imports = Array.isArray(r.imports) ? r.imports : [];
        const jsdoc = r.jsdoc || null;
        const headerText =
            r.headerText ||
            buildHeaderText({
                relPath: defaults.relPath,
                language: defaults.language,
                kind,
                symbol,
                exported,
                tags: defaults.tags,
                imports,
                anchor: r.anchor || null,
                jsdoc,
                subchunkIndex: r.subchunk_index || null,
                subchunkTotal: r.subchunk_total || null,
            });
        return {
            ...r,
            kind,
            symbol,
            exported,
            jsdoc,
            headerText,
        };
    });
}

export function chunkByType(/** @type {any} */ { relPath, lines, maxChunkChars, minChunkChars = 200 }) {
    const language = detectLanguage(relPath);
    const tags = buildTags(relPath);

    // Optimize chunk size by file type
    // Docs need larger chunks for context, code needs smaller chunks for precision
    if (!maxChunkChars) {
        maxChunkChars =
            language === 'markdown'
                ? Math.min(RAG_CHUNK_MAX_CHARS, Math.max(MAX_CHUNK_CHARS_DOCS, RAG_CHUNK_TARGET_CHARS))
                : Math.min(RAG_CHUNK_MAX_CHARS, Math.max(MAX_CHUNK_CHARS_CODE, RAG_CHUNK_TARGET_CHARS));
    }

    if ((language === 'js' || language === 'ts') && isAstChunkingEnabled()) {
        try {
            const astRanges = chunkJsAst({
                relPath,
                lines,
                language,
                maxChunkChars: Math.min(maxChunkChars, RAG_CHUNK_MAX_CHARS),
            });
            if (astRanges.length > 0) {
                return enrichRanges(astRanges, {
                    relPath,
                    language,
                    kind: 'module_fallback',
                    exported: false,
                    tags,
                });
            }
        } catch (error) {
            const _ce = /** @type {any} */ (error);
            console.warn(`[RAG] AST chunking fallback for ${relPath}: ${_ce?.message || _ce}`);
        }
    }

    if (language === 'markdown') {
        return enrichRanges(chunkMarkdown({ lines, maxChunkChars, minChunkChars }), {
            relPath,
            language,
            kind: 'doc_section',
            exported: false,
            tags,
        });
    }
    if (language === 'js' || language === 'ts' || language === 'sh' || language === 'ps1') {
        return enrichRanges(chunkCode({ lines, maxChunkChars, minChunkChars }), {
            relPath,
            language,
            kind: 'module_fallback',
            exported: false,
            tags,
        });
    }
    return enrichRanges(chunkPlain({ lines, maxChunkChars, minChunkChars, linesPerBlock: 80 }), {
        relPath,
        language,
        kind: language === 'json' || language === 'yaml' ? 'config_section' : 'text_block',
        exported: false,
        tags,
    });
}
