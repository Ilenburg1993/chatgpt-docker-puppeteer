// @ts-check
import { parse } from '@babel/parser';
// @ts-ignore
import traverseModule from '@babel/traverse';
import { chunkPlain } from './chunk_plain.mjs';
import { estimateCharsForLines } from '../text.mjs';
import { RAG_CHUNK_MAX_CHARS, RAG_CHUNK_TARGET_CHARS } from '../contract.mjs';

const traverse = typeof traverseModule === 'function' ? traverseModule : traverseModule.default;

function buildCodeFromLines(/** @type {any} */ lines) {
    return lines.join('\n');
}

function parserPlugins(/** @type {any} */ language) {
    const plugins = [
        'jsx',
        'classProperties',
        'classPrivateProperties',
        'classPrivateMethods',
        'dynamicImport',
        'importMeta',
        'topLevelAwait',
    ];
    if (language === 'ts') {
        plugins.push('typescript');
    }
    return plugins;
}

function buildSymbolFromNode(/** @type {any} */ node) {
    if (!node) return null;
    if (node.id?.name) return String(node.id.name);
    if (node.key?.name) return String(node.key.name);
    if (node.key?.value) return String(node.key.value);
    return null;
}

function readJsDocMeta(/** @type {any} */ node) {
    const comments = Array.isArray(node?.leadingComments) ? node.leadingComments : [];
    for (let i = comments.length - 1; i >= 0; i--) {
        const c = comments[i];
        if (c?.type !== 'CommentBlock') continue;
        const raw = String(c.value || '').trim();
        if (!raw.startsWith('*')) continue;
        const cleaned = raw
            .split('\n')
            .map((/** @type {any} */ line) => line.replace(/^\s*\*\s?/, '').trimEnd())
            .join('\n')
            .trim();
        if (!cleaned) continue;
        return {
            text: `/** ${cleaned.replace(/\s+/g, ' ').trim()} */`,
            startLine: c?.loc?.start?.line || null,
        };
    }
    return null;
}

function readJsDoc(/** @type {any} */ node) {
    return readJsDocMeta(node)?.text || null;
}

function jsDocStartLine(/** @type {any} */ node, /** @type {any} */ fallbackStartLine) {
    const startLine = readJsDocMeta(node)?.startLine;
    if (typeof startLine === 'number' && startLine > 0) {
        return startLine;
    }
    return fallbackStartLine;
}

function firstNonEmptyLine(/** @type {any} */ lines, /** @type {any} */ startLine, /** @type {any} */ endLine, /** @type {any} */ maxLookahead = 6) {
    const startIdx = Math.max(0, startLine - 1);
    const endIdx = Math.min(lines.length - 1, endLine - 1, startIdx + maxLookahead);
    for (let i = startIdx; i <= endIdx; i++) {
        const trimmed = String(lines[i] || '').trim();
        if (trimmed) return trimmed;
    }
    return null;
}

function splitLargeUnit(/** @type {any} */ unit, /** @type {any} */ lines, /** @type {any} */ maxChunkChars, /** @type {any} */ minChunkChars) {
    const startIdx = unit.startLine - 1;
    const endIdx = unit.endLine - 1;
    const subLines = lines.slice(startIdx, endIdx + 1);
    const subRanges = chunkPlain({
        lines: subLines,
        maxChunkChars,
        minChunkChars,
        linesPerBlock: 50,
    });

    return subRanges.map(/** @type {any} */ (r, idx) => ({
        startLine: startIdx + r.startLine,
        endLine: startIdx + r.endLine,
        kind: `${unit.kind}_block`,
        symbol: unit.symbol,
        exported: unit.exported,
        jsdoc: unit.jsdoc,
        anchor: unit.anchor,
        imports: unit.imports,
        subchunkIndex: idx + 1,
        subchunkTotal: subRanges.length,
    }));
}

function normalizeAndSplitUnits(/** @type {any} */ units, /** @type {any} */ lines, /** @type {any} */ maxChunkChars) {
    const minChunkChars = Math.max(200, Math.floor(RAG_CHUNK_TARGET_CHARS / 6));
    const normalized = [];

    for (const unit of units) {
        const len = estimateCharsForLines(lines, unit.startLine - 1, unit.endLine - 1);
        if (len <= maxChunkChars) {
            normalized.push(unit);
            continue;
        }
        normalized.push(...splitLargeUnit(unit, lines, maxChunkChars, minChunkChars));
    }

    normalized.sort(/** @type {any} */ (a, b) =>
            a.startLine - b.startLine ||
            a.endLine - b.endLine ||
            String(a.symbol || '').localeCompare(String(b.symbol || ''))
    );

    // Remove overlap conservatively.
    const deduped = [];
    for (const unit of normalized) {
        if (!deduped.length) {
            deduped.push(unit);
            continue;
        }
        const prev = deduped[deduped.length - 1];
        if (unit.startLine <= prev.endLine) {
            if (unit.endLine - unit.startLine > prev.endLine - prev.startLine) {
                deduped[deduped.length - 1] = unit;
            }
            continue;
        }
        deduped.push(unit);
    }

    return deduped;
}

function collectImports(/** @type {any} */ ast) {
    const imports = [];
    const body = Array.isArray(ast?.program?.body) ? ast.program.body : [];
    for (const node of body) {
        if (node?.type === 'ImportDeclaration' && node.source?.value) {
            imports.push(String(node.source.value));
        }
    }
    return [...new Set(imports)].slice(0, 5);
}

function collectUnits(/** @type {any} */ ast, /** @type {any} */ lines, /** @type {any} */ maxChunkChars) {
    /** @type {any[]} */ const units = [];
    const imported = collectImports(ast);
    const exportTypes = new Set(['ExportNamedDeclaration', 'ExportDefaultDeclaration']);

    traverse(ast, {
        FunctionDeclaration(/** @type {any} */ path) {
            if (!path.node?.loc) return;
            const exported =
                path.parentPath?.isExportNamedDeclaration() || path.parentPath?.isExportDefaultDeclaration();
            const jsDocNode = exportTypes.has(path.parentPath?.node?.type) ? path.parentPath.node : path.node;
            const symbol = buildSymbolFromNode(path.node);
            const startLine = jsDocStartLine(jsDocNode, path.node.loc.start.line);
            units.push({
                startLine,
                endLine: path.node.loc.end.line,
                kind: 'function',
                symbol,
                exported: Boolean(exported),
                jsdoc: readJsDoc(jsDocNode) || readJsDoc(path.node),
                anchor: firstNonEmptyLine(lines, path.node.loc.start.line, path.node.loc.end.line),
                imports: imported,
            });
        },
        ClassDeclaration(/** @type {any} */ path) {
            if (!path.node?.loc) return;
            const exported =
                path.parentPath?.isExportNamedDeclaration() || path.parentPath?.isExportDefaultDeclaration();
            const jsDocNode = exportTypes.has(path.parentPath?.node?.type) ? path.parentPath.node : path.node;
            const className = buildSymbolFromNode(path.node) || 'AnonymousClass';
            const classStartLine = jsDocStartLine(jsDocNode, path.node.loc.start.line);
            const classUnit = {
                startLine: classStartLine,
                endLine: path.node.loc.end.line,
                kind: 'class',
                symbol: className,
                exported: Boolean(exported),
                jsdoc: readJsDoc(jsDocNode) || readJsDoc(path.node),
                anchor: firstNonEmptyLine(lines, path.node.loc.start.line, path.node.loc.end.line),
                imports: imported,
            };

            const classLen = estimateCharsForLines(lines, classUnit.startLine - 1, classUnit.endLine - 1);
            const methods = Array.isArray(path.node.body?.body) ? path.node.body.body : [];
            if (classLen <= maxChunkChars || methods.length === 0) {
                units.push(classUnit);
                return;
            }

            for (const method of methods) {
                if (!method?.loc) continue;
                if (method.type !== 'ClassMethod' && method.type !== 'ClassPrivateMethod') continue;
                if (
                    method.kind === 'constructor' ||
                    method.kind === 'method' ||
                    method.kind === 'get' ||
                    method.kind === 'set'
                ) {
                    const methodName = buildSymbolFromNode(method) || 'anonymous';
                    const methodStartLine = jsDocStartLine(method, method.loc.start.line);
                    units.push({
                        startLine: methodStartLine,
                        endLine: method.loc.end.line,
                        kind: 'class_method',
                        symbol: `${className}.${methodName}`,
                        exported: Boolean(exported),
                        jsdoc: readJsDoc(method) || classUnit.jsdoc,
                        anchor: firstNonEmptyLine(lines, method.loc.start.line, method.loc.end.line),
                        imports: imported,
                    });
                }
            }
        },
        VariableDeclaration(/** @type {any} */ path) {
            if (!path.node?.loc) return;
            const exported =
                path.parentPath?.isExportNamedDeclaration() || path.parentPath?.isExportDefaultDeclaration();
            const jsDocNode = exportTypes.has(path.parentPath?.node?.type) ? path.parentPath.node : path.node;
            const declarations = Array.isArray(path.node.declarations) ? path.node.declarations : [];
            for (const decl of declarations) {
                if (!decl?.loc) continue;
                const initType = decl.init?.type;
                const functionLike = initType === 'ArrowFunctionExpression' || initType === 'FunctionExpression';
                if (!functionLike || !decl.id?.name) continue;
                const startLine = jsDocStartLine(jsDocNode, decl.loc.start.line);
                units.push({
                    startLine,
                    endLine: decl.loc.end.line,
                    kind: 'function_expression',
                    symbol: String(decl.id.name),
                    exported: Boolean(exported),
                    jsdoc: readJsDoc(jsDocNode) || readJsDoc(path.node),
                    anchor: firstNonEmptyLine(lines, decl.loc.start.line, decl.loc.end.line),
                    imports: imported,
                });
            }
        },
    });

    return units;
}

export function chunkJsAst(/** @type {any} */ { relPath, lines, language = 'js', maxChunkChars = RAG_CHUNK_MAX_CHARS }) {
    const source = buildCodeFromLines(lines);
    const ast = parse(source, {
        sourceType: 'module',
        errorRecovery: true,
        plugins: /** @type {any} */ (parserPlugins(language)),
        attachComment: true,
    });

    if (Array.isArray(ast.errors) && ast.errors.length > 0) {
        throw new Error(`AST_PARSE_ERRORS: ${relPath} (${ast.errors.length})`);
    }

    const units = collectUnits(ast, lines, maxChunkChars);
    if (!units.length) return [];

    const normalized = normalizeAndSplitUnits(units, lines, maxChunkChars);
    return normalized.map((/** @type {any} */ unit) => (/** @type {any} */ {
        startLine: unit.startLine,
        endLine: unit.endLine,
        kind: unit.kind,
        symbol: unit.symbol || null,
        exported: Boolean(unit.exported),
        jsdoc: unit.jsdoc || null,
        anchor: unit.anchor || null,
        imports: unit.imports || [],
        subchunk_index: unit.subchunkIndex || null,
        subchunk_total: unit.subchunkTotal || null,
    }));
}
