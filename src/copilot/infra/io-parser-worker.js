// @ts-check
/**
 * Worker de parsing JS/TS para reduzir bloqueio do event loop principal.
 *
 * @module copilot/infra/io-parser-worker
 */

import { parse as babelParse } from '@babel/parser';
import { performance } from 'node:perf_hooks';
import { parentPort } from 'node:worker_threads';

const errorCtor = /** @type {{ isError?: (value: unknown) => boolean }} */ (Error);
const isError =
    typeof errorCtor.isError === 'function'
        ? /** @type {(value: unknown) => boolean} */ (errorCtor.isError.bind(Error))
        : /** @type {(value: unknown) => boolean} */ ((value) => value instanceof Error);

/**
 * @typedef {object} SymbolEntry
 * @property {'function' | 'class' | 'variable' | 'type' | 'interface' | 'enum' | 'import' | 'export'} kind
 * @property {string} name
 * @property {boolean} exported
 * @property {number} line
 * @property {string | null} [docComment]
 */

/**
 * @typedef {object} ImportEntry
 * @property {string} source
 * @property {string[]} specifiers
 * @property {boolean} isDynamic
 * @property {number} line
 */

/**
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
 * @param {any} node
 * @returns {string | null}
 */
function extractLeadingComment(node) {
    const comments = node?.leadingComments;
    if (!Array.isArray(comments) || comments.length === 0) return null;
    const last = comments[comments.length - 1];
    if (last.type === 'CommentBlock') return `/*${last.value}*/`.trim();
    return null;
}

/**
 * @param {any} decl
 * @param {boolean} exported
 * @param {any} parentNode
 * @returns {SymbolEntry[]}
 */
function extractDeclSymbols(decl, exported, parentNode) {
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

/**
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

        if (node.type === 'ExportNamedDeclaration') {
            const decl = node.declaration;
            if (decl) extractDeclSymbols(decl, true, node).forEach((s) => symbols.push(s));
            for (const spec of node.specifiers ?? []) {
                const name = spec.exported?.name ?? spec.exported?.value ?? '<unknown>';
                exports.push(name);
            }
            continue;
        }

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

        if (node.type === 'ExportAllDeclaration') {
            exports.push(`* from ${node.source?.value ?? '?'}`);
            continue;
        }

        extractDeclSymbols(node, false, node).forEach((s) => symbols.push(s));
    }

    return { symbols, imports, exports };
}

/**
 * @param {{ source: string; lang: 'js' | 'ts'; maxParseDurationMs: number }} payload
 * @returns {{
 *     symbols: SymbolEntry[];
 *     imports: ImportEntry[];
 *     exports: string[];
 *     parseError: string | null;
 *     parseDurationMs: number;
 * }}
 */
function parseSymbols(payload) {
    const parseStart = performance.now();
    let ast;

    try {
        ast = babelParse(payload.source, {
            sourceType: 'unambiguous',
            allowImportExportEverywhere: true,
            allowReturnOutsideFunction: true,
            plugins: payload.lang === 'ts' ? ['typescript', 'jsx', 'decorators-legacy'] : ['jsx', 'decorators-legacy'],
            errorRecovery: true,
        });
    } catch {
        ast = null;
    }

    const parseDurationMs = Math.max(0, Math.round(performance.now() - parseStart));

    if (!ast) {
        return {
            symbols: [],
            imports: [],
            exports: [],
            parseError: 'babel parse returned null',
            parseDurationMs,
        };
    }

    if (parseDurationMs > payload.maxParseDurationMs) {
        return {
            symbols: [],
            imports: [],
            exports: [],
            parseError: `parser budget exceeded (${parseDurationMs}ms > ${payload.maxParseDurationMs}ms)`,
            parseDurationMs,
        };
    }

    const extracted = extractSymbolsFromAst(ast);
    const parseError =
        Array.isArray(ast.errors) && ast.errors.length > 0
            ? ast.errors.map((/** @type {any} */ e) => e.reasonCode ?? String(e)).join('; ')
            : null;

    return {
        symbols: extracted.symbols,
        imports: extracted.imports,
        exports: extracted.exports,
        parseError,
        parseDurationMs,
    };
}

const port = parentPort;

if (!port) {
    throw new Error('io-parser-worker requires parentPort');
}

port.on('message', (message) => {
    const id = Number(message?.id ?? 0);
    const payload = /** @type {{ source: string; lang: 'js' | 'ts'; maxParseDurationMs: number }} */ (message?.payload);

    try {
        const result = parseSymbols(payload);
        port.postMessage({ id, ok: true, result });
    } catch (error) {
        const msg = isError(error) ? /** @type {Error} */ (error).message : String(error ?? 'unknown-worker-error');
        port.postMessage({ id, ok: false, error: msg });
    }
});
