// @ts-check
/**
 * src/copilot/infra/io-parser.js
 *
 * Parser de alta performance para JS/TS/JSON/Markdown orientado à LLM-B.
 *
 * Motivação: A LLM-B precisa extrair símbolos (funções, classes, exports, imports) de arquivos JS/TS sem ter que ler o
 * arquivo inteiro em contexto. Este módulo provê extração simbólica rápida e tipada via @babel/parser, com fallback
 * gracioso para arquivos binários/grandes.
 *
 * Capacidades:
 *
 * - `parseFileSymbols(filePath, content)` — extrai exports, classes, funções, imports.
 * - `parseFileForContext(filePath, content)` — snapshot de contexto para LLM-B: symbols + outline + top-level comments.
 * - `extractJsonSchema(content)` — extrai shape (top-level keys) de JSON.
 * - `extractMarkdownOutline(content)` — extrai headings H1-H4 de Markdown.
 * - `parseAndCacheSymbols(filePath)` — lê por porta baixa acíclica + parseia + cacheia resultado.
 *
 * Design:
 *
 * - Usa @babel/parser para JS/TS (ESM e CommonJS).
 * - Cache L1 dedicado para resultados de parse (evita re-parse de arquivos imutáveis).
 * - Threshold de tamanho: arquivos > `IO_PARSER_MAX_BYTES` (padrão: 2MB) são chunked.
 * - Erros de parse retornam resultado parcial com `parseError` descritivo.
 *
 * @module copilot/infra/io-parser
 */

import { LRUCache } from 'lru-cache';
import * as nodePath from 'node:path';
import { registerInvalidationHook } from './io-cache.js';
import { readTextFileSnapshot } from './io/fs/read-text.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Tamanho máximo de arquivo para parse completo em bytes (padrão: 2 MiB). */
const MAX_PARSE_BYTES = Number(process.env['IO_PARSER_MAX_BYTES'] ?? 2 * 1024 * 1024);

/** Cache de símbolos parseados: max 500 entradas, TTL 5 min. */
const _symbolCache = new LRUCache(
    /** @type {any} */ ({
        max: 500,
        ttl: 5 * 60_000,
        updateAgeOnGet: true,
    }),
);

// Registra auto-invalidação do parser cache quando io-cache invalida um path (ex: após escrita).
registerInvalidationHook((filePath, event) => {
    const normalized = normalizeParserPath(filePath);
    _symbolCache.delete(normalized);
    if (event?.recursive === true) {
        const prefix = `${normalized}${nodePath.sep}`;
        for (const key of _symbolCache.keys()) {
            if (String(key).startsWith(prefix)) _symbolCache.delete(key);
        }
    }
});

// ---------------------------------------------------------------------------
// Typedefs
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SymbolEntry
 * @property {'function' | 'class' | 'variable' | 'type' | 'interface' | 'enum' | 'import' | 'export'} kind
 * @property {string} name - Nome do símbolo.
 * @property {boolean} exported - Se o símbolo é exportado.
 * @property {number} line - Linha de declaração (1-based).
 * @property {string | null} [docComment] - JSDoc/comentário precedente se presente.
 */

/**
 * @typedef {object} ImportEntry
 * @property {string} source - Módulo importado (e.g., 'node:fs', './io-cache.js').
 * @property {string[]} specifiers - Nomes importados ([] para side-effect imports).
 * @property {boolean} isDynamic - Se é import() dinâmico.
 * @property {number} line - Linha do import.
 */

/**
 * @typedef {object} FileSymbols
 * @property {string} filePath - Path do arquivo.
 * @property {string} ext - Extensão (ex.: '.js', '.ts', '.json').
 * @property {SymbolEntry[]} symbols - Símbolos declarados/exportados.
 * @property {ImportEntry[]} imports - Imports do arquivo.
 * @property {string[]} exports - Nomes exportados (para ES module exports).
 * @property {string | null} parseError - Mensagem de erro se parse falhou.
 * @property {boolean} truncated - Se o arquivo foi truncado por ser grande demais.
 * @property {number} lines - Total de linhas do arquivo.
 * @property {number} bytes - Tamanho em bytes.
 */

/**
 * @typedef {object} FileContext
 * @property {FileSymbols} symbols - Resultado do parse de símbolos.
 * @property {string[]} outline - Outline simbólico resumido (strings legíveis por LLM).
 * @property {string[]} topComments - Primeiros comentários de bloco/JSDoc do arquivo.
 */

// ---------------------------------------------------------------------------
// Babel parser loader (lazy para não quebrar se não disponível)
// ---------------------------------------------------------------------------

/** @type {((code: string, opts: object) => any) | null} */
let _babelParse = null;

/** @returns {Promise<((code: string, opts: object) => any) | null>} */
async function getBabelParse() {
    if (_babelParse !== null) return _babelParse;
    try {
        const m = await import('@babel/parser');
        _babelParse = m.parse ?? m.default?.parse ?? null;
    } catch {
        _babelParse = null;
    }
    return _babelParse;
}

// ---------------------------------------------------------------------------
// Extension → language map
// ---------------------------------------------------------------------------

const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx']);
const TS_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.tsx']);

/**
 * @param {string} filePath
 * @returns {string}
 */
function normalizeParserPath(filePath) {
    return nodePath.normalize(nodePath.resolve(filePath));
}

/**
 * @param {string} ext
 * @returns {'js' | 'ts' | 'json' | 'markdown' | 'unknown'}
 */
function classifyExtension(ext) {
    if (JS_EXTENSIONS.has(ext)) return 'js';
    if (TS_EXTENSIONS.has(ext)) return 'ts';
    if (ext === '.json' || ext === '.jsonl') return 'json';
    if (ext === '.md' || ext === '.mdx') return 'markdown';
    return 'unknown';
}

// ---------------------------------------------------------------------------
// JS/TS parsing via @babel/parser
// ---------------------------------------------------------------------------

/**
 * @param {string} code
 * @param {'js' | 'ts'} lang
 * @returns {any | null} AST ou null se falhou
 */
function tryBabelParse(code, lang) {
    if (!_babelParse) return null;
    try {
        return _babelParse(code, {
            sourceType: 'unambiguous',
            allowImportExportEverywhere: true,
            allowReturnOutsideFunction: true,
            plugins: lang === 'ts' ? ['typescript', 'jsx', 'decorators-legacy'] : ['jsx', 'decorators-legacy'],
            errorRecovery: true,
        });
    } catch {
        return null;
    }
}

/**
 * Extrai o nome de um nó de binding (Identifier, ObjectPattern, etc.).
 *
 * @param {any} node
 * @returns {string}
 */
function extractName(node) {
    if (!node) return '<unknown>';
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'RestElement') return `...${extractName(node.argument)}`;
    return `<${node.type}>`;
}

/**
 * Tenta extrair o comentário JSDoc/bloco imediatamente antes de um nó.
 *
 * @param {any} node
 * @returns {string | null}
 */
function extractLeadingComment(node) {
    const comments = node.leadingComments;
    if (!Array.isArray(comments) || comments.length === 0) return null;
    const last = comments[comments.length - 1];
    if (last.type === 'CommentBlock') return `/*${last.value}*/`.trim();
    return null;
}

/**
 * Extrai símbolos de um AST Babel.
 *
 * @param {any} ast
 * @returns {{ symbols: SymbolEntry[]; imports: ImportEntry[]; exports: string[] }}
 */
function extractSymbolsFromAst(ast) {
    /** @type {SymbolEntry[]} */
    const symbols = [];
    /** @type {ImportEntry[]} */
    const imports = [];
    /** @type {string[]} */
    const exports = [];

    if (!ast?.program?.body) return { symbols, imports, exports };

    for (const node of ast.program.body) {
        const line = node.loc?.start?.line ?? 0;

        // ── Import declarations ──────────────────────────────────────────
        if (node.type === 'ImportDeclaration') {
            imports.push({
                source: String(node.source.value),
                specifiers: (node.specifiers ?? []).map(
                    (/** @type {any} */ s) => s.local?.name ?? s.imported?.name ?? '*',
                ),
                isDynamic: false,
                line,
            });
            continue;
        }

        // ── Export named ─────────────────────────────────────────────────
        if (node.type === 'ExportNamedDeclaration') {
            const decl = node.declaration;
            if (decl) {
                _extractDeclSymbols(decl, true, node).forEach((s) => symbols.push(s));
            }
            for (const spec of node.specifiers ?? []) {
                const name = spec.exported?.name ?? spec.exported?.value ?? '<unknown>';
                exports.push(name);
            }
            continue;
        }

        // ── Export default ───────────────────────────────────────────────
        if (node.type === 'ExportDefaultDeclaration') {
            const decl = node.declaration;
            const name =
                decl?.id?.name ??
                (decl?.type === 'FunctionDeclaration'
                    ? '<default fn>'
                    : decl?.type === 'ClassDeclaration'
                      ? '<default class>'
                      : '<default>');
            symbols.push({
                kind: 'export',
                name,
                exported: true,
                line,
                docComment: extractLeadingComment(node),
            });
            exports.push('default');
            continue;
        }

        // ── Export all ───────────────────────────────────────────────────
        if (node.type === 'ExportAllDeclaration') {
            exports.push(`* from ${node.source?.value ?? '?'}`);
            continue;
        }

        // ── Top-level declarations (non-exported) ─────────────────────────
        _extractDeclSymbols(node, false, node).forEach((s) => symbols.push(s));
    }

    return { symbols, imports, exports };
}

/**
 * @param {any} decl - Declaration node
 * @param {boolean} exported
 * @param {any} parentNode - For leading comment lookup
 * @returns {SymbolEntry[]}
 */
function _extractDeclSymbols(decl, exported, parentNode) {
    if (!decl) return [];
    const line = decl.loc?.start?.line ?? parentNode?.loc?.start?.line ?? 0;
    const comment = extractLeadingComment(parentNode ?? decl);

    if (decl.type === 'FunctionDeclaration' || decl.type === 'FunctionExpression') {
        const name = decl.id?.name ?? '<anonymous>';
        return [{ kind: 'function', name, exported, line, docComment: comment }];
    }
    if (decl.type === 'ClassDeclaration' || decl.type === 'ClassExpression') {
        const name = decl.id?.name ?? '<anonymous class>';
        return [{ kind: 'class', name, exported, line, docComment: comment }];
    }
    if (decl.type === 'TSTypeAliasDeclaration') {
        return [{ kind: 'type', name: decl.id?.name ?? '<type>', exported, line, docComment: comment }];
    }
    if (decl.type === 'TSInterfaceDeclaration') {
        return [{ kind: 'interface', name: decl.id?.name ?? '<interface>', exported, line, docComment: comment }];
    }
    if (decl.type === 'TSEnumDeclaration') {
        return [{ kind: 'enum', name: decl.id?.name ?? '<enum>', exported, line, docComment: comment }];
    }
    if (decl.type === 'VariableDeclaration') {
        return (decl.declarations ?? []).map((/** @type {any} */ d) => ({
            kind: /** @type {'variable'} */ ('variable'),
            name: extractName(d.id),
            exported,
            line: d.loc?.start?.line ?? line,
            docComment: comment,
        }));
    }
    return [];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parseia um arquivo JS/TS e extrai símbolos, imports e exports.
 *
 * @param {string} filePath - Path do arquivo.
 * @param {string} content - Conteúdo já lido (evita dupla leitura).
 * @returns {Promise<FileSymbols>}
 */
export async function parseFileSymbols(filePath, content) {
    const ext = nodePath.extname(filePath).toLowerCase();
    const lang = classifyExtension(ext);
    const bytes = Buffer.byteLength(content, 'utf8');
    const lines = content.split('\n').length;
    const truncated = bytes > MAX_PARSE_BYTES;

    /** @type {FileSymbols} */
    const base = {
        filePath,
        ext,
        symbols: [],
        imports: [],
        exports: [],
        parseError: null,
        truncated,
        lines,
        bytes,
    };

    const source = truncated ? content.slice(0, MAX_PARSE_BYTES) : content;

    if (lang === 'js' || lang === 'ts') {
        await getBabelParse();
        const ast = tryBabelParse(source, lang);
        if (!ast) {
            base.parseError = 'babel parse returned null';
            return base;
        }
        if (ast.errors?.length) {
            base.parseError = ast.errors.map((/** @type {any} */ e) => e.reasonCode ?? String(e)).join('; ');
        }
        const extracted = extractSymbolsFromAst(ast);
        base.symbols = extracted.symbols;
        base.imports = extracted.imports;
        base.exports = extracted.exports;
        return base;
    }

    if (lang === 'json') {
        return { ...base, ...extractJsonSchema(source) };
    }

    if (lang === 'markdown') {
        const outline = extractMarkdownOutlineWithLines(source);
        base.symbols = outline.map(({ heading, line }) => ({
            kind: /** @type {'variable'} */ ('variable'),
            name: heading,
            exported: false,
            line,
            docComment: null,
        }));
        return base;
    }

    return base;
}

/**
 * Lê o arquivo do disco (via io-engine + L1 cache) e parseia símbolos. Cacheia o resultado no `_symbolCache` por TTL de
 * 5 min.
 *
 * @param {string} filePath
 * @returns {Promise<FileSymbols>}
 */
export async function parseAndCacheSymbols(filePath) {
    const cacheKey = normalizeParserPath(filePath);
    const cached = /** @type {FileSymbols | undefined} */ (_symbolCache.get(cacheKey));
    if (cached) return cached;

    const snapshot = await readTextFileSnapshot(filePath);
    const symbols = await parseFileSymbols(filePath, snapshot.content);
    _symbolCache.set(cacheKey, symbols);
    return symbols;
}

/**
 * Invalida o cache de símbolos para um arquivo (chamar após escrita).
 *
 * @param {string} filePath
 * @returns {void}
 */
export function invalidateParserCache(filePath) {
    _symbolCache.delete(normalizeParserPath(filePath));
}

/**
 * Retorna snapshot de contexto para LLM-B: symbols + outline + top-level comments.
 *
 * @param {string} filePath
 * @param {string} content
 * @returns {Promise<FileContext>}
 */
export async function parseFileForContext(filePath, content) {
    const symbols = await parseFileSymbols(filePath, content);
    const outline = buildOutline(symbols);
    const topComments = extractTopComments(content);
    return { symbols, outline, topComments };
}

// ---------------------------------------------------------------------------
// JSON schema extraction
// ---------------------------------------------------------------------------

/**
 * Extrai top-level keys de um JSON (ou JSONL primeira linha).
 *
 * @param {string} content
 * @returns {{ symbols: SymbolEntry[]; parseError: string | null }}
 */
export function extractJsonSchema(content) {
    try {
        const first = parseJsonOrJsonlSample(content);
        const obj = Array.isArray(first) ? (first[0] ?? {}) : first;
        const symbols = Object.keys(obj ?? {}).map((k, i) => ({
            kind: /** @type {'variable'} */ ('variable'),
            name: k,
            exported: false,
            line: i + 1,
            docComment: null,
        }));
        return { symbols, parseError: null };
    } catch (e) {
        return { symbols: [], parseError: String(e) };
    }
}

/**
 * @param {string} content
 * @returns {unknown}
 */
function parseJsonOrJsonlSample(content) {
    try {
        return JSON.parse(content);
    } catch (error) {
        const firstLine = content
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .find((line) => line.length > 0);
        if (!firstLine) throw error;
        return JSON.parse(firstLine);
    }
}

// ---------------------------------------------------------------------------
// Markdown outline extraction
// ---------------------------------------------------------------------------

/**
 * Extrai headings H1-H4 de Markdown.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function extractMarkdownOutline(content) {
    return extractMarkdownOutlineWithLines(content).map((entry) => entry.heading);
}

/**
 * Extrai headings H1-H4 de Markdown preservando linha real.
 *
 * @param {string} content
 * @returns {{ heading: string; line: number; depth: number }[]}
 */
function extractMarkdownOutlineWithLines(content) {
    /** @type {{ heading: string; line: number; depth: number }[]} */
    const headings = [];
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index] ?? '';
        const m = /^(#{1,4})\s+(.+)$/.exec(line);
        if (m) {
            const marker = m[1] ?? '';
            headings.push({
                heading: `${marker} ${(m[2] ?? '').trim()}`,
                line: index + 1,
                depth: marker.length,
            });
        }
    }
    return headings;
}

// ---------------------------------------------------------------------------
// Outline builder
// ---------------------------------------------------------------------------

/**
 * Constrói outline textual legível (para contexto LLM-B).
 *
 * @param {FileSymbols} symbols
 * @returns {string[]}
 */
export function buildOutline(symbols) {
    const lines = [];
    const exported = symbols.symbols.filter((s) => s.exported);
    const unexported = symbols.symbols.filter((s) => !s.exported);

    if (exported.length) {
        lines.push(`── Exports (${exported.length})`);
        for (const s of exported) {
            lines.push(`   [${s.kind}] ${s.name} (L${s.line})`);
        }
    }
    if (unexported.length > 0 && unexported.length <= 20) {
        lines.push(`── Internal (${unexported.length})`);
        for (const s of unexported) {
            lines.push(`   [${s.kind}] ${s.name} (L${s.line})`);
        }
    }
    if (symbols.imports.length) {
        lines.push(`── Imports (${symbols.imports.length})`);
        for (const imp of symbols.imports) {
            const specs = imp.specifiers.length
                ? `{ ${imp.specifiers.slice(0, 4).join(', ')}${imp.specifiers.length > 4 ? ', ...' : ''} }`
                : '*';
            lines.push(`   ${specs} from '${imp.source}'`);
        }
    }
    if (symbols.parseError) lines.push(`⚠️ Parse error: ${symbols.parseError}`);
    return lines;
}

// ---------------------------------------------------------------------------
// Top-level comment extractor
// ---------------------------------------------------------------------------

/**
 * Extrai os primeiros comentários de bloco (JSDoc/module docs) do arquivo.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function extractTopComments(content) {
    /** @type {string[]} */
    const comments = [];
    const lines = content.split('\n');
    let inBlock = false;
    let blockLines = /** @type {string[]} */ ([]);

    for (const line of lines.slice(0, 50)) {
        const trimmed = line.trim();
        if (!inBlock && trimmed.startsWith('/*')) {
            inBlock = true;
            blockLines = [line];
            if (trimmed.endsWith('*/')) {
                comments.push(blockLines.join('\n'));
                inBlock = false;
                blockLines = [];
            }
            continue;
        }
        if (inBlock) {
            blockLines.push(line);
            if (trimmed.endsWith('*/')) {
                comments.push(blockLines.join('\n'));
                inBlock = false;
                blockLines = [];
            }
            continue;
        }
        if (trimmed.startsWith('//')) {
            comments.push(line);
        }
    }

    return comments.slice(0, 10);
}

/**
 * Retorna estatísticas do cache de símbolos.
 *
 * @returns {{ size: number; maxSize: number }}
 */
export function getParserCacheStats() {
    return { size: _symbolCache.size, maxSize: 500 };
}
