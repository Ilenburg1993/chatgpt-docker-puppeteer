// @ts-check
import { resolveBabelParserOptions } from '#copilot/infra/public/code-analysis';
import { parse as babelParse } from '@babel/parser';
import fs from 'node:fs';
import path from 'node:path';

/** Schema version for the JSON report emitted by the JSDoc coverage tooling. */
export const JSDOC_COVERAGE_SCHEMA_VERSION = '3.1.0';

/** @typedef {'none' | 'minimal' | 'complete'} JSDocQualityLevel */
/** @typedef {'function' | 'class' | 'const' | 'typedef' | 'reexport' | 'unknown'} ExportKind */

/**
 * @typedef {{
 *     export_name: string;
 *     kind: ExportKind;
 *     has_jsdoc: boolean;
 *     tags_present: string[];
 *     missing_tags: string[];
 *     quality_level: JSDocQualityLevel;
 *     line: number | null;
 *     param_count: number;
 *     param_tags_count: number;
 *     has_complete_param_tags: boolean;
 *     has_options_param: boolean;
 *     has_options_typedef: boolean;
 *     unsafe_generic_tags_count: number;
 *     public_any_tags_count: number;
 *     public_unknown_tags_count: number;
 *     uses_import_types: boolean;
 *     uses_template_tags: boolean;
 * }} ExportJSDocAssessment
 */

/**
 * @typedef {{
 *     file: string;
 *     exported_symbols: ExportJSDocAssessment[];
 *     exports_total: number;
 *     exports_with_jsdoc: number;
 *     coverage_pct: number;
 *     functions_total: number;
 *     functions_with_returns_tag: number;
 *     functions_missing_returns_tag: number;
 *     function_returns_coverage_pct: number;
 *     functions_with_complete_param_tags: number;
 *     functions_missing_param_tags: number;
 *     functions_with_options_typedef: number;
 *     functions_missing_options_typedef: number;
 *     unsafe_generic_tags_total: number;
 *     public_symbols_using_import_types: number;
 *     public_symbols_using_template_tags: number;
 * }} FileJSDocReport
 */

/**
 * @typedef {{
 *     files: number;
 *     exports_total: number;
 *     exports_with_jsdoc: number;
 *     coverage_pct: number;
 *     functions_total: number;
 *     functions_with_returns_tag: number;
 *     functions_missing_returns_tag: number;
 *     function_returns_coverage_pct: number;
 *     functions_with_complete_param_tags: number;
 *     functions_missing_param_tags: number;
 *     functions_with_options_typedef: number;
 *     functions_missing_options_typedef: number;
 *     unsafe_generic_tags_total: number;
 *     public_symbols_using_import_types: number;
 *     public_symbols_using_template_tags: number;
 * }} PathPrefixReport
 */

/**
 * @typedef {{
 *     schema_version: string;
 *     scope: 'changed' | 'full';
 *     files_scanned: number;
 *     files_with_exports: number;
 *     exports_total: number;
 *     exports_with_jsdoc: number;
 *     coverage_pct: number;
 *     functions_total: number;
 *     functions_with_returns_tag: number;
 *     functions_missing_returns_tag: number;
 *     function_returns_coverage_pct: number;
 *     functions_with_complete_param_tags: number;
 *     functions_missing_param_tags: number;
 *     functions_with_options_typedef: number;
 *     functions_missing_options_typedef: number;
 *     unsafe_generic_tags_total: number;
 *     public_any_tags_total: number;
 *     public_unknown_tags_total: number;
 *     public_symbols_using_import_types: number;
 *     public_symbols_using_template_tags: number;
 *     by_path_prefix: Record<string, PathPrefixReport>;
 *     files: FileJSDocReport[];
 * }} JSDocCoverageReport
 */

/** @typedef {{ node: any; kind: ExportKind }} LocalExportTarget */

const JS_EXT_RE = /\.(js|mjs|cjs)$/i;
const OPTIONS_PARAM_RE = /(?:options|opts|params|config)$/i;
const TYPEDEF_OBJECT_RE = /@typedef\s+\{(?:object|Object)\}\s+([A-Za-z_$][\w$]*)/g;
const PARAM_TYPE_RE = /@param\s+\{([^}]+)\}\s+(?:\[)?([A-Za-z_$][\w$]*)/g;
const ANY_TAG_RE = /\bany\b/g;
const UNKNOWN_TAG_RE = /\bunknown\b/g;
/**
 * Matches unsafe generic types ONLY within JSDoc type annotation positions ({...}).
 *
 * - Object: bare (not Object.<T> or Object<T>) — use Record<K,V> or object instead.
 * - Array: bare without type argument — Array<string> is fine, bare Array is not.
 * - Function: bare (any casing) — prefer typed function signatures.
 * - any: as a type (not in description text — enforced by extractTypeAnnotations). Avoids false positives from
 *   natural-language uses of "any" in descriptions.
 */
const UNSAFE_GENERIC_IN_TYPE_RE = /\bObject\b(?!\s*[.<])|Promise<\s*any\s*>|\bArray\b(?!\s*<)|\bFunction\b|\bany\b/g;
const IMPORT_TYPE_RE = /\bimport\s*\(/;

/**
 * Extracts the concatenated content of all `{...}` type annotations from a JSDoc block. Used to scope
 * `UNSAFE_GENERIC_IN_TYPE_RE` checks to type-position text only.
 *
 * @param {string} jsdocText
 * @returns {string}
 */
function extractTypeAnnotations(jsdocText) {
    const parts = [];
    const re = /\{([^}]+)\}/g;
    let m;
    while ((m = re.exec(jsdocText)) !== null) {
        parts.push(m[1]);
    }
    return parts.join(' ');
}

/** @param {string} input */
function norm(input) {
    return String(input || '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '');
}

/** @param {string} file */
function inferPrefix(file) {
    const parts = norm(file).split('/');
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    return parts[0] || 'root';
}

/** @param {any} node @returns {number | null} */
function getLine(node) {
    const line = Number(node?.loc?.start?.line);
    return Number.isInteger(line) && line > 0 ? line : null;
}

/**
 * @param {string} text
 * @param {RegExp} expression
 * @returns {number}
 */
function countMatches(text, expression) {
    const matches = text.match(expression);
    return matches ? matches.length : 0;
}

/** @param {any} node */
function getJSDocBlocks(node) {
    const comments = Array.isArray(node?.leadingComments) ? node.leadingComments : [];
    return comments.filter(
        (/** @type {any} */ comment) => comment?.type === 'CommentBlock' && String(comment.value ?? '').startsWith('*'),
    );
}

/** @param {any} node @returns {string} */
function getJSDocText(node) {
    return getJSDocBlocks(node)
        .map((/** @type {any} */ comment) => `/*${String(comment.value ?? '')}*/`)
        .join('\n');
}

/** @param {any} comment @returns {string} */
function jsDocCommentText(comment) {
    return `/*${String(comment?.value ?? '')}*/`;
}

/**
 * Extrai o nome documentado de um `@param` sem tentar interpretar o tipo inteiro. O scanner de chaves é necessário
 * porque object-shapes JSDoc podem conter chaves aninhadas; regex até o primeiro `}` classificaria propriedades como
 * parâmetros raiz de forma incorreta.
 *
 * @param {string} rawTagTail
 * @returns {string | null}
 */
function extractDocumentedParamName(rawTagTail) {
    let rest = rawTagTail.trim();
    if (rest.startsWith('{')) {
        let depth = 0;
        let closedAt = -1;
        for (let index = 0; index < rest.length; index += 1) {
            const char = rest[index];
            if (char === '{') depth += 1;
            else if (char === '}') {
                depth -= 1;
                if (depth === 0) {
                    closedAt = index;
                    break;
                }
            }
        }
        if (closedAt >= 0) rest = rest.slice(closedAt + 1).trim();
        else return null;
    }
    const token = rest.match(/^(?:\.\.\.)?(\[[^\]]*\]|[^\s-]+)/u)?.[1] ?? null;
    if (!token) return null;
    return token.replace(/^\[/u, '').replace(/\]$/u, '').split('=')[0]?.trim() || null;
}

/**
 * @typedef {{ name: string; nestedParam: boolean }} ParsedJSDocTag
 */

/**
 * Parser estrutural mínimo para a semântica pública usada por este relatório. Diferentemente de um regex global, ele
 * preserva a hierarquia que o parser TypeScript expunha: `@property` após `@typedef` pertence ao typedef, e `@param
 * options.foo` pertence ao parâmetro raiz `options`.
 *
 * @param {string} text
 * @returns {ParsedJSDocTag[]}
 */
function parseTopLevelJSDocTags(text) {
    /** @type {ParsedJSDocTag[]} */
    const tags = [];
    const matches = [...text.matchAll(/(?:^|\s)@([A-Za-z][\w-]*)\b/gmu)];
    let insideTypedefProperties = false;
    for (let index = 0; index < matches.length; index += 1) {
        const match = matches[index];
        const name = match?.[1];
        if (!name || match.index === undefined) continue;
        const markerOffset = match[0].lastIndexOf('@');
        const tagStart = match.index + markerOffset;
        const tailStart = tagStart + name.length + 1;
        const nextMatch = matches[index + 1];
        const tailEnd = nextMatch?.index ?? text.length;
        const tail = text
            .slice(tailStart, tailEnd)
            .replace(/\r?\n\s*\*\s?/gu, ' ')
            .replace(/\*\/$/u, '')
            .trim();
        if ((name === 'property' || name === 'prop') && insideTypedefProperties) continue;
        if (name === 'typedef') insideTypedefProperties = true;
        else if (name !== 'property' && name !== 'prop') insideTypedefProperties = false;
        const paramName = name === 'param' ? extractDocumentedParamName(tail) : null;
        const nestedParam = Boolean(paramName && /[.[]/u.test(paramName));
        tags.push({ name, nestedParam });
    }
    return tags;
}

/**
 * Replica a semântica estrutural de `TypeScript#getJSDocTags`: tags de typedef/callback soltas que Babel anexa ao
 * próximo declaration não viram tags da implementação. Blocos `@overload` anteriores contribuem antes das tags do bloco
 * primário, reproduzindo também a ordem observável do parser TypeScript.
 *
 * @param {any} node
 * @returns {string[]}
 */
function getJSDocTags(node) {
    const blocks = getJSDocBlocks(node);
    if (blocks.length === 0) return [];
    const tags = [];
    for (const block of blocks.slice(0, -1)) {
        if (/(?:^|\s)@overload\b/mu.test(jsDocCommentText(block))) tags.push('overload');
    }
    for (const tag of parseTopLevelJSDocTags(jsDocCommentText(blocks.at(-1)))) {
        if (!tag.nestedParam) tags.push(tag.name);
    }
    return [...new Set(tags)];
}

/** @param {any} node @returns {boolean} */
function hasJsDoc(node) {
    return getJSDocBlocks(node).length > 0;
}

/** @param {any} node @returns {boolean} */
function isFunctionNode(node) {
    return ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node?.type);
}

/** @param {any} node @returns {number} */
function getFunctionParamCount(node) {
    return isFunctionNode(node) ? (node.params?.length ?? 0) : 0;
}

/** @param {any} node @returns {number} */
function getParamTagCount(node) {
    const primary = getJSDocBlocks(node).at(-1);
    if (!primary) return 0;
    return parseTopLevelJSDocTags(jsDocCommentText(primary)).filter((tag) => tag.name === 'param' && !tag.nestedParam)
        .length;
}

/** @param {any} sourceFile @param {string} sourceText @returns {Set<string>} */
function collectDeclaredTypedefs(sourceFile, sourceText) {
    void sourceFile;
    const typedefs = new Set();
    const text = sourceText;
    for (const match of text.matchAll(TYPEDEF_OBJECT_RE)) {
        if (match[1]) typedefs.add(match[1]);
    }
    return typedefs;
}

/** @param {any} node @returns {string[]} */
function collectOptionParamNames(node) {
    if (!isFunctionNode(node)) return [];
    /** @type {string[]} */
    const names = [];
    for (const param of node.params ?? []) {
        if (param?.type === 'Identifier' && OPTIONS_PARAM_RE.test(param.name)) {
            names.push(param.name);
            continue;
        }
        if (param?.type === 'AssignmentPattern' && param.left?.type === 'Identifier') {
            const isDirectObjectLiteralDefault =
                param.right?.type === 'ObjectExpression' && !param.right?.extra?.parenthesized;
            if (OPTIONS_PARAM_RE.test(param.left.name) || isDirectObjectLiteralDefault) names.push(param.left.name);
            continue;
        }
        if (param?.type === 'ObjectPattern') names.push('destructured');
        if (param?.type === 'AssignmentPattern' && param.left?.type === 'ObjectPattern') names.push('destructured');
    }
    return names;
}

/**
 * @param {string} jsdocText
 * @param {string[]} optionParamNames
 * @param {Set<string>} declaredTypedefs
 * @returns {boolean}
 */
function hasOptionsTypedef(jsdocText, optionParamNames, declaredTypedefs) {
    if (optionParamNames.length === 0) return false;
    const hasDestructured = optionParamNames.includes('destructured');
    for (const match of jsdocText.matchAll(PARAM_TYPE_RE)) {
        const rawType = String(match[1] || '').trim();
        const rawName = String(match[2] || '').trim();
        // For destructured params, accept any @param {TypeName} where TypeName is a typedef,
        // regardless of the documented param name (options, opts, config, payload, etc.).
        if (!optionParamNames.includes(rawName) && !hasDestructured) {
            continue;
        }
        const typeName = rawType.replace(/[[\]()|?]/g, '').trim();
        if (!typeName || typeName === 'object' || typeName === 'Object') continue;
        if (typeName.includes('<') || typeName.includes(',') || typeName.includes(' ')) continue;
        if (declaredTypedefs.has(typeName)) return true;
    }
    return false;
}

/** @param {any} node @param {ExportKind} kind @returns {boolean} */
function isFunctionExport(node, kind) {
    return kind === 'function' && getFunctionParamCount(node) >= 0;
}

/**
 * @param {ExportKind} kind
 * @param {boolean} hasReturnsTag
 * @param {boolean} hasCompleteParamTags
 * @param {boolean} hasOptionsParam
 * @param {boolean} hasOptionsTypedef
 * @param {number} unsafeGenericTagsCount
 * @returns {{ missing: string[]; quality: JSDocQualityLevel }}
 */
function assessQuality(
    kind,
    hasReturnsTag,
    hasCompleteParamTags,
    hasOptionsParam,
    hasOptionsTypedef,
    unsafeGenericTagsCount,
) {
    /** @type {string[]} */
    const missing = [];
    if (kind === 'function') {
        if (!hasReturnsTag) missing.push('returns');
        if (!hasCompleteParamTags) missing.push('param');
        if (hasOptionsParam && !hasOptionsTypedef) missing.push('typedef');
    }
    if (unsafeGenericTagsCount > 0) {
        missing.push('unsafe-generic');
    }
    const quality = missing.length === 0 ? 'complete' : 'minimal';
    return { missing, quality };
}

/** @param {any} target @param {any} owner @returns {any} */
function inheritJSDocComments(target, owner) {
    if (!target || !owner) return target;
    if (getJSDocBlocks(target).length === 0 && getJSDocBlocks(owner).length > 0) {
        target.leadingComments = owner.leadingComments;
    }
    return target;
}

/** @param {any} identifier @returns {string | null} */
function identifierName(identifier) {
    if (!identifier) return null;
    if (identifier.type === 'Identifier') return identifier.name;
    if (identifier.type === 'StringLiteral') return identifier.value;
    return null;
}

/** @param {any} sourceFile @returns {Map<string, LocalExportTarget>} */
function collectLocalExportTargets(sourceFile) {
    /** @type {Map<string, LocalExportTarget>} */
    const targets = new Map();
    for (const rawStatement of sourceFile.body ?? []) {
        const statement =
            rawStatement?.type === 'ExportNamedDeclaration' && rawStatement.declaration
                ? inheritJSDocComments(rawStatement.declaration, rawStatement)
                : rawStatement;
        if (statement?.type === 'FunctionDeclaration' && statement.id?.name) {
            targets.set(statement.id.name, { node: statement, kind: 'function' });
            continue;
        }
        if (statement?.type === 'ClassDeclaration' && statement.id?.name) {
            targets.set(statement.id.name, { node: statement, kind: 'class' });
            continue;
        }
        if (statement?.type === 'TSTypeAliasDeclaration' && statement.id?.name) {
            targets.set(statement.id.name, { node: statement, kind: 'typedef' });
            continue;
        }
        if (statement?.type === 'VariableDeclaration') {
            for (const declaration of statement.declarations ?? []) {
                const name = identifierName(declaration.id);
                if (name) targets.set(name, { node: statement, kind: 'const' });
            }
        }
    }
    return targets;
}

/**
 * @param {any} node
 * @param {string} exportName
 * @param {ExportKind} kind
 * @param {Set<string>} declaredTypedefs
 * @returns {ExportJSDocAssessment}
 */
function buildAssessment(node, exportName, kind, declaredTypedefs) {
    const tags = getJSDocTags(node);
    const jsdocText = getJSDocText(node);
    const hasJsdoc = hasJsDoc(node);
    const hasReturnsTag = tags.includes('returns') || tags.includes('return');
    const paramCount = getFunctionParamCount(node);
    const paramTagsCount = getParamTagCount(node);
    const hasCompleteParamTags = !isFunctionExport(node, kind) || paramCount === 0 || paramTagsCount >= paramCount;
    const optionParamNames = collectOptionParamNames(node);
    const hasOptionsParam = optionParamNames.length > 0;
    const hasOptionsTypedefValue = hasOptionsTypedef(jsdocText, optionParamNames, declaredTypedefs);
    const typeAnnotationsText = extractTypeAnnotations(jsdocText);
    const unsafeGenericTagsCount = countMatches(typeAnnotationsText, UNSAFE_GENERIC_IN_TYPE_RE);
    const publicAnyTagsCount = countMatches(jsdocText, ANY_TAG_RE);
    const publicUnknownTagsCount = countMatches(jsdocText, UNKNOWN_TAG_RE);
    const usesImportTypes = IMPORT_TYPE_RE.test(jsdocText);
    const usesTemplateTags = tags.includes('template');
    const assessed = assessQuality(
        kind,
        hasReturnsTag,
        hasCompleteParamTags,
        hasOptionsParam,
        hasOptionsTypedefValue,
        unsafeGenericTagsCount,
    );
    /** @type {JSDocQualityLevel} */
    const qualityLevel = hasJsdoc ? assessed.quality : 'none';

    return {
        export_name: exportName,
        kind,
        has_jsdoc: hasJsdoc,
        tags_present: tags,
        missing_tags: hasJsdoc ? assessed.missing : kind === 'function' ? ['returns', 'param'] : [],
        quality_level: qualityLevel,
        line: getLine(node),
        param_count: paramCount,
        param_tags_count: paramTagsCount,
        has_complete_param_tags: hasCompleteParamTags,
        has_options_param: hasOptionsParam,
        has_options_typedef: hasOptionsTypedefValue,
        unsafe_generic_tags_count: unsafeGenericTagsCount,
        public_any_tags_count: publicAnyTagsCount,
        public_unknown_tags_count: publicUnknownTagsCount,
        uses_import_types: usesImportTypes,
        uses_template_tags: usesTemplateTags,
    };
}

/** @param {any} sourceFile @param {string} sourceText @returns {ExportJSDocAssessment[]} */
function collectExportsFromSourceFile(sourceFile, sourceText) {
    /** @type {ExportJSDocAssessment[]} */
    const exportedSymbols = [];
    const localTargets = collectLocalExportTargets(sourceFile);
    const declaredTypedefs = collectDeclaredTypedefs(sourceFile, sourceText);

    for (const statement of sourceFile.body ?? []) {
        if (statement?.type === 'ExportNamedDeclaration') {
            const declaration = statement.declaration ? inheritJSDocComments(statement.declaration, statement) : null;
            if (declaration?.type === 'FunctionDeclaration') {
                const exportName = declaration.id?.name ?? null;
                if (exportName)
                    exportedSymbols.push(buildAssessment(declaration, exportName, 'function', declaredTypedefs));
                continue;
            }
            if (declaration?.type === 'ClassDeclaration') {
                const exportName = declaration.id?.name ?? null;
                if (exportName)
                    exportedSymbols.push(buildAssessment(declaration, exportName, 'class', declaredTypedefs));
                continue;
            }
            if (declaration?.type === 'VariableDeclaration') {
                for (const item of declaration.declarations ?? []) {
                    const exportName = identifierName(item.id);
                    if (exportName)
                        exportedSymbols.push(buildAssessment(statement, exportName, 'const', declaredTypedefs));
                }
                continue;
            }
            if (declaration?.type === 'TSTypeAliasDeclaration' && declaration.id?.name) {
                exportedSymbols.push(buildAssessment(declaration, declaration.id.name, 'typedef', declaredTypedefs));
                continue;
            }
            for (const element of statement.specifiers ?? []) {
                if (element?.type !== 'ExportSpecifier') continue;
                const exportName = identifierName(element.exported);
                const localName = identifierName(element.local);
                if (!exportName) continue;
                if (!statement.source && localName) {
                    const local = localTargets.get(localName);
                    if (local) {
                        exportedSymbols.push(buildAssessment(local.node, exportName, local.kind, declaredTypedefs));
                        continue;
                    }
                }
                exportedSymbols.push(buildAssessment(statement, exportName, 'reexport', declaredTypedefs));
            }
            continue;
        }

        if (statement?.type === 'ExportDefaultDeclaration') {
            const declaration = inheritJSDocComments(statement.declaration, statement);
            if (declaration?.type === 'FunctionDeclaration') {
                exportedSymbols.push(
                    buildAssessment(declaration, declaration.id?.name ?? 'default', 'function', declaredTypedefs),
                );
                continue;
            }
            if (declaration?.type === 'ClassDeclaration') {
                exportedSymbols.push(
                    buildAssessment(declaration, declaration.id?.name ?? 'default', 'class', declaredTypedefs),
                );
                continue;
            }
            if (declaration?.type === 'Identifier') {
                const local = localTargets.get(declaration.name);
                if (local) {
                    exportedSymbols.push(buildAssessment(local.node, 'default', local.kind, declaredTypedefs));
                    continue;
                }
            }
            exportedSymbols.push(buildAssessment(statement, 'default', 'reexport', declaredTypedefs));
        }
    }

    return exportedSymbols;
}

/**
 * @param {string} file
 * @returns {FileJSDocReport}
 */
function parseFile(file) {
    const absoluteFile = path.resolve(file);
    const sourceText = fs.readFileSync(absoluteFile, 'utf8');
    const sourceFile = babelParse(
        sourceText,
        /** @type {any} */ (resolveBabelParserOptions(absoluteFile, 'js', { profile: 'documentation' })),
    ).program;
    const exportedSymbols = collectExportsFromSourceFile(sourceFile, sourceText);
    const exportsTotal = exportedSymbols.length;
    const exportsWithJsdoc = exportedSymbols.filter((symbol) => symbol.has_jsdoc).length;
    const coveragePct = exportsTotal > 0 ? Number(((exportsWithJsdoc / exportsTotal) * 100).toFixed(1)) : 100;
    const functionExports = exportedSymbols.filter((symbol) => symbol.kind === 'function');
    const functionsTotal = functionExports.length;
    const functionsMissingReturnsTag = functionExports.filter((symbol) =>
        symbol.missing_tags.includes('returns'),
    ).length;
    const functionsWithReturnsTag = functionsTotal - functionsMissingReturnsTag;
    const functionReturnsCoveragePct =
        functionsTotal > 0 ? Number(((functionsWithReturnsTag / functionsTotal) * 100).toFixed(1)) : 100;
    const functionsMissingParamTags = functionExports.filter((symbol) => !symbol.has_complete_param_tags).length;
    const functionsWithCompleteParamTags = functionsTotal - functionsMissingParamTags;
    const functionsWithOptionsTypedef = functionExports.filter(
        (symbol) => !symbol.has_options_param || symbol.has_options_typedef,
    ).length;
    const functionsMissingOptionsTypedef = functionExports.filter(
        (symbol) => symbol.has_options_param && !symbol.has_options_typedef,
    ).length;
    const unsafeGenericTagsTotal = exportedSymbols.reduce(
        (total, symbol) => total + symbol.unsafe_generic_tags_count,
        0,
    );
    const publicSymbolsUsingImportTypes = exportedSymbols.filter((symbol) => symbol.uses_import_types).length;
    const publicSymbolsUsingTemplateTags = exportedSymbols.filter((symbol) => symbol.uses_template_tags).length;

    return {
        file: norm(path.relative(process.cwd(), absoluteFile)),
        exported_symbols: exportedSymbols,
        exports_total: exportsTotal,
        exports_with_jsdoc: exportsWithJsdoc,
        coverage_pct: coveragePct,
        functions_total: functionsTotal,
        functions_with_returns_tag: functionsWithReturnsTag,
        functions_missing_returns_tag: functionsMissingReturnsTag,
        function_returns_coverage_pct: functionReturnsCoveragePct,
        functions_with_complete_param_tags: functionsWithCompleteParamTags,
        functions_missing_param_tags: functionsMissingParamTags,
        functions_with_options_typedef: functionsWithOptionsTypedef,
        functions_missing_options_typedef: functionsMissingOptionsTypedef,
        unsafe_generic_tags_total: unsafeGenericTagsTotal,
        public_symbols_using_import_types: publicSymbolsUsingImportTypes,
        public_symbols_using_template_tags: publicSymbolsUsingTemplateTags,
    };
}

/**
 * @typedef {object} AnalyzeJSDocCoverageOptions
 * @property {string[]} files
 * @property {'changed' | 'full'} scope
 */
/**
 * @param {AnalyzeJSDocCoverageOptions} options
 * @returns {JSDocCoverageReport}
 */
export function analyzeJSDocCoverage(options) {
    const files = Array.from(new Set((options.files || []).map(norm)))
        .filter(Boolean)
        .filter((file) => JS_EXT_RE.test(file))
        .filter((file) => fs.existsSync(file));

    /** @type {FileJSDocReport[]} */
    const fileReports = [];
    for (const file of files) {
        try {
            const report = parseFile(file);
            if (report.exports_total > 0) {
                fileReports.push(report);
            }
        } catch {
            // Keep the report resilient. Parse failures are simply omitted.
        }
    }

    const exportsTotal = fileReports.reduce((total, item) => total + item.exports_total, 0);
    const exportsWithJsdoc = fileReports.reduce((total, item) => total + item.exports_with_jsdoc, 0);
    const coveragePct = exportsTotal > 0 ? Number(((exportsWithJsdoc / exportsTotal) * 100).toFixed(1)) : 100;
    const functionsTotal = fileReports.reduce((total, item) => total + item.functions_total, 0);
    const functionsWithReturnsTag = fileReports.reduce((total, item) => total + item.functions_with_returns_tag, 0);
    const functionsMissingReturnsTag = fileReports.reduce(
        (total, item) => total + item.functions_missing_returns_tag,
        0,
    );
    const functionReturnsCoveragePct =
        functionsTotal > 0 ? Number(((functionsWithReturnsTag / functionsTotal) * 100).toFixed(1)) : 100;
    const functionsWithCompleteParamTags = fileReports.reduce(
        (total, item) => total + item.functions_with_complete_param_tags,
        0,
    );
    const functionsMissingParamTags = fileReports.reduce((total, item) => total + item.functions_missing_param_tags, 0);
    const functionsWithOptionsTypedef = fileReports.reduce(
        (total, item) => total + item.functions_with_options_typedef,
        0,
    );
    const functionsMissingOptionsTypedef = fileReports.reduce(
        (total, item) => total + item.functions_missing_options_typedef,
        0,
    );
    const unsafeGenericTagsTotal = fileReports.reduce((total, item) => total + item.unsafe_generic_tags_total, 0);
    const publicSymbolsUsingImportTypes = fileReports.reduce(
        (total, item) => total + item.public_symbols_using_import_types,
        0,
    );
    const publicSymbolsUsingTemplateTags = fileReports.reduce(
        (total, item) => total + item.public_symbols_using_template_tags,
        0,
    );
    const publicAnyTagsTotal = fileReports.reduce(
        (total, fileReport) =>
            total +
            fileReport.exported_symbols.reduce((fileTotal, symbol) => fileTotal + symbol.public_any_tags_count, 0),
        0,
    );
    const publicUnknownTagsTotal = fileReports.reduce(
        (total, fileReport) =>
            total +
            fileReport.exported_symbols.reduce((fileTotal, symbol) => fileTotal + symbol.public_unknown_tags_count, 0),
        0,
    );

    /** @type {Record<string, PathPrefixReport>} */
    const byPathPrefix = {};
    for (const report of fileReports) {
        const prefix = inferPrefix(report.file);
        const item =
            byPathPrefix[prefix] ||
            (byPathPrefix[prefix] = {
                files: 0,
                exports_total: 0,
                exports_with_jsdoc: 0,
                coverage_pct: 100,
                functions_total: 0,
                functions_with_returns_tag: 0,
                functions_missing_returns_tag: 0,
                function_returns_coverage_pct: 100,
                functions_with_complete_param_tags: 0,
                functions_missing_param_tags: 0,
                functions_with_options_typedef: 0,
                functions_missing_options_typedef: 0,
                unsafe_generic_tags_total: 0,
                public_symbols_using_import_types: 0,
                public_symbols_using_template_tags: 0,
            });

        item.files += 1;
        item.exports_total += report.exports_total;
        item.exports_with_jsdoc += report.exports_with_jsdoc;
        item.functions_total += report.functions_total;
        item.functions_with_returns_tag += report.functions_with_returns_tag;
        item.functions_missing_returns_tag += report.functions_missing_returns_tag;
        item.functions_with_complete_param_tags += report.functions_with_complete_param_tags;
        item.functions_missing_param_tags += report.functions_missing_param_tags;
        item.functions_with_options_typedef += report.functions_with_options_typedef;
        item.functions_missing_options_typedef += report.functions_missing_options_typedef;
        item.unsafe_generic_tags_total += report.unsafe_generic_tags_total;
        item.public_symbols_using_import_types += report.public_symbols_using_import_types;
        item.public_symbols_using_template_tags += report.public_symbols_using_template_tags;
    }

    for (const item of Object.values(byPathPrefix)) {
        item.coverage_pct =
            item.exports_total > 0 ? Number(((item.exports_with_jsdoc / item.exports_total) * 100).toFixed(1)) : 100;
        item.function_returns_coverage_pct =
            item.functions_total > 0
                ? Number(((item.functions_with_returns_tag / item.functions_total) * 100).toFixed(1))
                : 100;
    }

    return {
        schema_version: JSDOC_COVERAGE_SCHEMA_VERSION,
        scope: options.scope || 'full',
        files_scanned: files.length,
        files_with_exports: fileReports.length,
        exports_total: exportsTotal,
        exports_with_jsdoc: exportsWithJsdoc,
        coverage_pct: coveragePct,
        functions_total: functionsTotal,
        functions_with_returns_tag: functionsWithReturnsTag,
        functions_missing_returns_tag: functionsMissingReturnsTag,
        function_returns_coverage_pct: functionReturnsCoveragePct,
        functions_with_complete_param_tags: functionsWithCompleteParamTags,
        functions_missing_param_tags: functionsMissingParamTags,
        functions_with_options_typedef: functionsWithOptionsTypedef,
        functions_missing_options_typedef: functionsMissingOptionsTypedef,
        unsafe_generic_tags_total: unsafeGenericTagsTotal,
        public_any_tags_total: publicAnyTagsTotal,
        public_unknown_tags_total: publicUnknownTagsTotal,
        public_symbols_using_import_types: publicSymbolsUsingImportTypes,
        public_symbols_using_template_tags: publicSymbolsUsingTemplateTags,
        by_path_prefix: byPathPrefix,
        files: fileReports,
    };
}

/**
 * @param {string[]} roots
 * @returns {string[]}
 */
export function collectJsSourceFiles(roots) {
    /** @type {string[]} */
    const output = [];

    /** @param {string} dir */
    function walk(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'dist') continue;
                walk(fullPath);
                continue;
            }
            if (entry.isFile() && JS_EXT_RE.test(entry.name)) {
                output.push(norm(path.relative(process.cwd(), fullPath)));
            }
        }
    }

    for (const root of roots) {
        walk(root);
    }

    return Array.from(new Set(output));
}
