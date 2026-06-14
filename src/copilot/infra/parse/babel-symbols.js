// @ts-check
/**
 * Extração canônica de símbolos/imports/exports do AST Babel.
 *
 * @module copilot/infra/parse/babel-symbols
 */

/**
 * @param {any} node
 * @returns {string[]}
 */
function extractBindingNames(node) {
    if (!node) return ['<unknown>'];
    if (node.type === 'Identifier') return [node.name];
    if (node.type === 'RestElement') return extractBindingNames(node.argument).map((name) => `...${name}`);
    if (node.type === 'AssignmentPattern') return extractBindingNames(node.left);
    if (node.type === 'ObjectPattern') {
        return (node.properties ?? []).flatMap((/** @type {any} */ property) =>
            property.type === 'RestElement' ? extractBindingNames(property) : extractBindingNames(property.value),
        );
    }
    if (node.type === 'ArrayPattern') {
        return (node.elements ?? []).flatMap((/** @type {any} */ element) => extractBindingNames(element));
    }
    return [`<${node.type}>`];
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
 */
function extractDeclSymbols(decl, exported, parentNode) {
    if (!decl) return [];
    const line = decl.loc?.start?.line ?? parentNode?.loc?.start?.line ?? 0;
    const docComment = extractLeadingComment(parentNode ?? decl);
    if (
        decl.type === 'FunctionDeclaration' ||
        decl.type === 'FunctionExpression' ||
        decl.type === 'TSDeclareFunction'
    ) {
        return [{ kind: 'function', name: decl.id?.name ?? '<anonymous>', exported, line, docComment }];
    }
    if (decl.type === 'ClassDeclaration' || decl.type === 'ClassExpression') {
        return [{ kind: 'class', name: decl.id?.name ?? '<anonymous class>', exported, line, docComment }];
    }
    if (decl.type === 'TSTypeAliasDeclaration') {
        return [{ kind: 'type', name: decl.id?.name ?? '<type>', exported, line, docComment }];
    }
    if (decl.type === 'TSInterfaceDeclaration') {
        return [{ kind: 'interface', name: decl.id?.name ?? '<interface>', exported, line, docComment }];
    }
    if (decl.type === 'TSEnumDeclaration') {
        return [{ kind: 'enum', name: decl.id?.name ?? '<enum>', exported, line, docComment }];
    }
    if (decl.type === 'TSModuleDeclaration') {
        return [{ kind: 'type', name: decl.id?.name ?? decl.id?.value ?? '<namespace>', exported, line, docComment }];
    }
    if (decl.type === 'VariableDeclaration') {
        return (decl.declarations ?? []).flatMap((/** @type {any} */ item) =>
            extractBindingNames(item.id).map((name) => ({
                kind: /** @type {'variable'} */ ('variable'),
                name,
                exported,
                line: item.loc?.start?.line ?? line,
                docComment,
            })),
        );
    }
    return [];
}

/**
 * @param {any} ast
 */
export function extractBabelFileSymbols(ast) {
    /** @type {import('../io-parser.js').SymbolEntry[]} */
    const symbols = [];
    /** @type {import('../io-parser.js').ImportEntry[]} */
    const imports = [];
    /** @type {string[]} */
    const exports = [];
    const body = ast?.program?.body;
    if (!Array.isArray(body)) return { symbols, imports, exports };

    for (const node of body) {
        const line = node.loc?.start?.line ?? 0;
        if (node.type === 'ImportDeclaration') {
            imports.push({
                source: String(node.source.value),
                specifiers: (node.specifiers ?? []).map(
                    (/** @type {any} */ specifier) =>
                        specifier.local?.name ?? specifier.imported?.name ?? specifier.imported?.value ?? '*',
                ),
                isDynamic: false,
                line,
            });
            continue;
        }
        if (node.type === 'TSImportEqualsDeclaration') {
            const source = node.moduleReference?.expression?.value;
            if (typeof source === 'string') {
                imports.push({ source, specifiers: [node.id?.name ?? '*'], isDynamic: false, line });
            }
            continue;
        }
        if (node.type === 'ExportNamedDeclaration') {
            const declared = extractDeclSymbols(node.declaration, true, node);
            symbols.push(...declared);
            exports.push(...declared.map((/** @type {import('../io-parser.js').SymbolEntry} */ symbol) => symbol.name));
            for (const specifier of node.specifiers ?? []) {
                exports.push(specifier.exported?.name ?? specifier.exported?.value ?? '<unknown>');
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
            symbols.push({ kind: 'export', name, exported: true, line, docComment: extractLeadingComment(node) });
            exports.push('default');
            continue;
        }
        if (node.type === 'ExportAllDeclaration') {
            exports.push(`* from ${node.source?.value ?? '?'}`);
            continue;
        }
        if (node.type === 'TSExportAssignment') {
            exports.push('export =');
            continue;
        }
        symbols.push(...extractDeclSymbols(node, false, node));
    }

    collectRuntimeImports(ast?.program, imports);
    return { symbols, imports, exports };
}

/**
 * @param {any} root
 * @param {import('../io-parser.js').ImportEntry[]} imports
 */
function collectRuntimeImports(root, imports) {
    const seen = new WeakSet();
    /** @type {any[]} */
    const stack = [root];
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);

        const line = node.loc?.start?.line ?? 0;
        if (node.type === 'ImportExpression' && typeof node.source?.value === 'string') {
            imports.push({ source: node.source.value, specifiers: [], isDynamic: true, line });
        } else if (
            node.type === 'CallExpression' &&
            node.callee?.type === 'Import' &&
            typeof node.arguments?.[0]?.value === 'string'
        ) {
            imports.push({ source: node.arguments[0].value, specifiers: [], isDynamic: true, line });
        } else if (
            node.type === 'CallExpression' &&
            node.callee?.type === 'Identifier' &&
            node.callee.name === 'require' &&
            typeof node.arguments?.[0]?.value === 'string'
        ) {
            imports.push({ source: node.arguments[0].value, specifiers: [], isDynamic: false, line });
        }

        for (const [key, value] of Object.entries(node)) {
            if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra' || key.endsWith('Comments')) continue;
            if (Array.isArray(value)) stack.push(...value);
            else if (value && typeof value === 'object') stack.push(value);
        }
    }
}
