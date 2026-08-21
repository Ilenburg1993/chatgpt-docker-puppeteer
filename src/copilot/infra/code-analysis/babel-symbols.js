// @ts-check
/**
 * Canonical symbol/import/export extraction from the Babel AST.
 *
 * @module copilot/infra/code-analysis/babel-symbols
 */

/** @typedef {import('#copilot/types/io-analysis').SymbolEntry} SymbolEntry */
/** @typedef {import('#copilot/types/io-analysis').ImportEntry} ImportEntry */
/** @typedef {import('@babel/types').Node} BabelNode */

/**
 * Binding names are extracted only from syntactic binding forms. Other Babel nodes are represented explicitly rather
 * than being accepted through `any`, keeping the AST boundary honest under TS7/checkJs.
 * @param {BabelNode | null | undefined} node
 * @returns {string[]}
 */
function extractBindingNames(node) {
    if (!node) return ['<unknown>'];
    switch (node.type) {
        case 'Identifier':
            return [node.name];
        case 'RestElement':
            return extractBindingNames(node.argument).map((name) => `...${name}`);
        case 'AssignmentPattern':
            return extractBindingNames(node.left);
        case 'ObjectPattern':
            return node.properties.flatMap((property) =>
                property.type === 'RestElement'
                    ? extractBindingNames(property.argument)
                    : extractBindingNames(property.value),
            );
        case 'ArrayPattern':
            return node.elements.flatMap((element) => extractBindingNames(element));
        case 'VoidPattern':
            return ['<void>'];
        default:
            return [`<${node.type}>`];
    }
}

/** @param {BabelNode | null | undefined} node @returns {string | null} */
function extractLeadingComment(node) {
    const comments = node?.leadingComments;
    if (!Array.isArray(comments) || comments.length === 0) return null;
    const last = comments.at(-1);
    return last?.type === 'CommentBlock' ? `/*${last.value}*/`.trim() : null;
}

/**
 * @param {BabelNode | null | undefined} decl
 * @param {boolean} exported
 * @param {BabelNode | null | undefined} parentNode
 * @returns {SymbolEntry[]}
 */
function extractDeclSymbols(decl, exported, parentNode) {
    if (!decl) return [];
    const line = decl.loc?.start.line ?? parentNode?.loc?.start.line ?? 0;
    const docComment = extractLeadingComment(parentNode ?? decl);
    switch (decl.type) {
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'TSDeclareFunction':
            return [{ kind: 'function', name: decl.id?.name ?? '<anonymous>', exported, line, docComment }];
        case 'ClassDeclaration':
        case 'ClassExpression':
            return [{ kind: 'class', name: decl.id?.name ?? '<anonymous class>', exported, line, docComment }];
        case 'TSTypeAliasDeclaration':
            return [{ kind: 'type', name: decl.id.name, exported, line, docComment }];
        case 'TSInterfaceDeclaration':
            return [{ kind: 'interface', name: decl.id.name, exported, line, docComment }];
        case 'TSEnumDeclaration':
            return [{ kind: 'enum', name: decl.id.name, exported, line, docComment }];
        case 'TSModuleDeclaration': {
            const name =
                decl.id.type === 'Identifier'
                    ? decl.id.name
                    : decl.id.type === 'StringLiteral'
                      ? decl.id.value
                      : '<namespace>';
            return [{ kind: 'type', name, exported, line, docComment }];
        }
        case 'VariableDeclaration':
            return decl.declarations.flatMap((item) =>
                extractBindingNames(item.id).map((name) => ({
                    kind: /** @type {const} */ ('variable'),
                    name,
                    exported,
                    line: item.loc?.start.line ?? line,
                    docComment,
                })),
            );
        default:
            return [];
    }
}

/** @param {import('@babel/types').ExportDefaultDeclaration['declaration']} decl */
function defaultExportName(decl) {
    if (decl.type === 'FunctionDeclaration') return decl.id?.name ?? '<default fn>';
    if (decl.type === 'ClassDeclaration') return decl.id?.name ?? '<default class>';
    return '<default>';
}

/** @param {import('@babel/types').Node | null | undefined} node @returns {string | null} */
function stringLiteralValue(node) {
    return node?.type === 'StringLiteral' ? node.value : null;
}

/**
 * @param {unknown} value
 * @returns {value is BabelNode}
 */
function isBabelNode(value) {
    return Boolean(
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof (/** @type {Record<string, unknown>} */ (value)['type']) === 'string',
    );
}

/** @param {import('@babel/types').File} ast */
export function extractBabelFileSymbols(ast) {
    /** @type {SymbolEntry[]} */
    const symbols = [];
    /** @type {ImportEntry[]} */
    const imports = [];
    /** @type {string[]} */
    const exports = [];

    for (const node of ast.program.body) {
        const line = node.loc?.start.line ?? 0;
        if (node.type === 'ImportDeclaration') {
            imports.push({
                source: node.source.value,
                specifiers: node.specifiers.map((specifier) =>
                    specifier.type === 'ImportSpecifier'
                        ? specifier.imported.type === 'Identifier'
                            ? specifier.imported.name
                            : specifier.imported.value
                        : specifier.local.name,
                ),
                isDynamic: false,
                line,
            });
            continue;
        }
        if (node.type === 'TSImportEqualsDeclaration') {
            if (node.moduleReference.type === 'TSExternalModuleReference') {
                imports.push({
                    source: node.moduleReference.expression.value,
                    specifiers: [node.id.name],
                    isDynamic: false,
                    line,
                });
            }
            continue;
        }
        if (node.type === 'ExportNamedDeclaration') {
            const declared = extractDeclSymbols(node.declaration, true, node);
            symbols.push(...declared);
            exports.push(...declared.map((symbol) => symbol.name));
            for (const specifier of node.specifiers) {
                if (specifier.type === 'ExportSpecifier') {
                    exports.push(
                        specifier.exported.type === 'Identifier' ? specifier.exported.name : specifier.exported.value,
                    );
                } else if (specifier.type === 'ExportNamespaceSpecifier') {
                    exports.push(
                        specifier.exported.type === 'Identifier' ? specifier.exported.name : specifier.exported.value,
                    );
                } else {
                    exports.push('default');
                }
            }
            if (node.source) {
                imports.push({
                    source: node.source.value,
                    specifiers: node.specifiers.map((specifier) => {
                        if (specifier.type === 'ExportSpecifier') {
                            return specifier.local.name;
                        }
                        if (specifier.type === 'ExportNamespaceSpecifier') {
                            return specifier.exported.type === 'Identifier'
                                ? specifier.exported.name
                                : specifier.exported.value;
                        }
                        return specifier.exported.name;
                    }),
                    isDynamic: false,
                    line,
                });
            }
            continue;
        }
        if (node.type === 'ExportDefaultDeclaration') {
            symbols.push({
                kind: 'export',
                name: defaultExportName(node.declaration),
                exported: true,
                line,
                docComment: extractLeadingComment(node),
            });
            exports.push('default');
            continue;
        }
        if (node.type === 'ExportAllDeclaration') {
            exports.push(`* from ${node.source.value}`);
            imports.push({ source: node.source.value, specifiers: ['*'], isDynamic: false, line });
            continue;
        }
        if (node.type === 'TSExportAssignment') {
            exports.push('export =');
            continue;
        }
        symbols.push(...extractDeclSymbols(node, false, node));
    }

    collectRuntimeImports(ast.program, imports);
    return { symbols, imports, exports };
}

/**
 * @param {BabelNode} root
 * @param {ImportEntry[]} imports
 */
function collectRuntimeImports(root, imports) {
    const seen = new WeakSet();
    /** @type {BabelNode[]} */
    const stack = [root];
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node || seen.has(node)) continue;
        seen.add(node);

        const line = node.loc?.start.line ?? 0;
        if (node.type === 'ImportExpression') {
            const source = stringLiteralValue(node.source);
            if (source !== null) imports.push({ source, specifiers: [], isDynamic: true, line });
        } else if (node.type === 'CallExpression' && node.callee.type === 'Import') {
            const source = stringLiteralValue(isBabelNode(node.arguments[0]) ? node.arguments[0] : null);
            if (source !== null) imports.push({ source, specifiers: [], isDynamic: true, line });
        } else if (
            node.type === 'CallExpression' &&
            node.callee.type === 'Identifier' &&
            node.callee.name === 'require'
        ) {
            const source = stringLiteralValue(isBabelNode(node.arguments[0]) ? node.arguments[0] : null);
            if (source !== null) imports.push({ source, specifiers: [], isDynamic: false, line });
        }

        const record = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (node));
        for (const [key, value] of Object.entries(record)) {
            if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra' || key.endsWith('Comments'))
                continue;
            if (Array.isArray(value)) {
                for (const child of value) if (isBabelNode(child)) stack.push(child);
            } else if (isBabelNode(value)) {
                stack.push(value);
            }
        }
    }
}
