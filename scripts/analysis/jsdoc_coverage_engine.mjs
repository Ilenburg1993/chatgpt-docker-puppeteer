// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Schema version for the JSON report emitted by the JSDoc coverage tooling. */
export const JSDOC_COVERAGE_SCHEMA_VERSION = '3.0.0';

/** @typedef {'none'|'minimal'|'complete'} JSDocQualityLevel */
/** @typedef {'function'|'class'|'const'|'typedef'|'reexport'|'unknown'} ExportKind */

/**
 * @typedef {{
 *   export_name: string,
 *   kind: ExportKind,
 *   has_jsdoc: boolean,
 *   tags_present: string[],
 *   missing_tags: string[],
 *   quality_level: JSDocQualityLevel,
 *   line: number|null,
 *   param_count: number,
 *   param_tags_count: number,
 *   has_complete_param_tags: boolean,
 *   has_options_param: boolean,
 *   has_options_typedef: boolean,
 *   unsafe_generic_tags_count: number,
 *   public_any_tags_count: number,
 *   public_unknown_tags_count: number,
 *   uses_import_types: boolean,
 *   uses_template_tags: boolean,
 * }} ExportJSDocAssessment
 */

/**
 * @typedef {{
 *   file: string,
 *   exported_symbols: ExportJSDocAssessment[],
 *   exports_total: number,
 *   exports_with_jsdoc: number,
 *   coverage_pct: number,
 *   functions_total: number,
 *   functions_with_returns_tag: number,
 *   functions_missing_returns_tag: number,
 *   function_returns_coverage_pct: number,
 *   functions_with_complete_param_tags: number,
 *   functions_missing_param_tags: number,
 *   functions_with_options_typedef: number,
 *   functions_missing_options_typedef: number,
 *   unsafe_generic_tags_total: number,
 *   public_symbols_using_import_types: number,
 *   public_symbols_using_template_tags: number,
 * }} FileJSDocReport
 */

/**
 * @typedef {{
 *   files: number,
 *   exports_total: number,
 *   exports_with_jsdoc: number,
 *   coverage_pct: number,
 *   functions_total: number,
 *   functions_with_returns_tag: number,
 *   functions_missing_returns_tag: number,
 *   function_returns_coverage_pct: number,
 *   functions_with_complete_param_tags: number,
 *   functions_missing_param_tags: number,
 *   functions_with_options_typedef: number,
 *   functions_missing_options_typedef: number,
 *   unsafe_generic_tags_total: number,
 *   public_symbols_using_import_types: number,
 *   public_symbols_using_template_tags: number
 * }} PathPrefixReport
 */

/**
 * @typedef {{
 *   schema_version: string,
 *   scope: 'changed'|'full',
 *   files_scanned: number,
 *   files_with_exports: number,
 *   exports_total: number,
 *   exports_with_jsdoc: number,
 *   coverage_pct: number,
 *   functions_total: number,
 *   functions_with_returns_tag: number,
 *   functions_missing_returns_tag: number,
 *   function_returns_coverage_pct: number,
 *   functions_with_complete_param_tags: number,
 *   functions_missing_param_tags: number,
 *   functions_with_options_typedef: number,
 *   functions_missing_options_typedef: number,
 *   unsafe_generic_tags_total: number,
 *   public_symbols_using_import_types: number,
 *   public_symbols_using_template_tags: number,
 *   by_path_prefix: Record<string, PathPrefixReport>,
 *   files: FileJSDocReport[],
 * }} JSDocCoverageReport
 */

/**
 * @typedef {{ node: ts.Node, kind: ExportKind }} LocalExportTarget
 */

const JS_EXT_RE = /\.(js|mjs|cjs)$/i;
const OPTIONS_PARAM_RE = /(?:options|opts|params|config)$/i;
const TYPEDEF_OBJECT_RE = /@typedef\s+\{(?:object|Object)\}\s+([A-Za-z_$][\w$]*)/g;
const PARAM_TYPE_RE = /@param\s+\{([^}]+)\}\s+(?:\[)?([A-Za-z_$][\w$]*)/g;
const ANY_TAG_RE = /\bany\b/g;
const UNKNOWN_TAG_RE = /\bunknown\b/g;
const UNSAFE_GENERIC_RE = /\b(?:Object|Array|Function)\b|Promise<\s*any\s*>|\bany\b/g;
const IMPORT_TYPE_RE = /\bimport\s*\(/;

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

/**
 * @param {ts.Node} node
 * @param {ts.SourceFile} sourceFile
 * @returns {number|null}
 */
function getLine(node, sourceFile) {
    try {
        return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    } catch {
        return null;
    }
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

/**
 * @param {ts.Node} node
 * @returns {ts.JSDoc[]}
 */
function getJSDocBlocks(node) {
    const nodeWithDocs = /** @type {ts.Node & { jsDoc?: ts.JSDoc[] }} */ (node);
    return Array.isArray(nodeWithDocs.jsDoc) ? nodeWithDocs.jsDoc : [];
}

/**
 * @param {ts.Node} node
 * @returns {string[]}
 */
function getJSDocTags(node) {
    const tags = ts.getJSDocTags(node) || [];
    return Array.from(
        new Set(
            tags
                .map(tag => String(tag.tagName?.escapedText || '').trim())
                .filter(Boolean)
        )
    );
}

/**
 * @param {ts.Node} node
 * @param {ts.SourceFile} sourceFile
 * @returns {string}
 */
function getJSDocText(node, sourceFile) {
    const blocks = getJSDocBlocks(node);
    if (blocks.length === 0) return '';
    return blocks.map(block => block.getFullText(sourceFile)).join('\n');
}

/**
 * @param {ts.Node} node
 * @returns {boolean}
 */
function hasJsDoc(node) {
    return getJSDocBlocks(node).length > 0;
}

/**
 * @param {ts.Node} node
 * @returns {number}
 */
function getFunctionParamCount(node) {
    if (!ts.isFunctionDeclaration(node) && !ts.isFunctionExpression(node) && !ts.isArrowFunction(node)) {
        return 0;
    }
    return node.parameters.length;
}

/**
 * @param {ts.Node} node
 * @returns {number}
 */
function getParamTagCount(node) {
    return (ts.getJSDocTags(node) || []).filter(tag => {
        const tagName = String(tag.tagName?.escapedText || '').trim();
        return tagName === 'param';
    }).length;
}

/**
 * @param {ts.SourceFile} sourceFile
 * @returns {Set<string>}
 */
function collectDeclaredTypedefs(sourceFile) {
    const typedefs = new Set();
    const text = sourceFile.getFullText(sourceFile);
    for (const match of text.matchAll(TYPEDEF_OBJECT_RE)) {
        if (match[1]) typedefs.add(match[1]);
    }
    return typedefs;
}

/**
 * @param {ts.Node} node
 * @returns {string[]}
 */
function collectOptionParamNames(node) {
    if (!ts.isFunctionDeclaration(node) && !ts.isFunctionExpression(node) && !ts.isArrowFunction(node)) {
        return [];
    }
    /** @type {string[]} */
    const names = [];
    for (const param of node.parameters) {
        if (ts.isIdentifier(param.name) && OPTIONS_PARAM_RE.test(param.name.text)) {
            names.push(param.name.text);
            continue;
        }
        if (ts.isIdentifier(param.name) && param.initializer && ts.isObjectLiteralExpression(param.initializer)) {
            names.push(param.name.text);
            continue;
        }
        if (ts.isObjectBindingPattern(param.name)) {
            names.push('destructured');
        }
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
    for (const match of jsdocText.matchAll(PARAM_TYPE_RE)) {
        const rawType = String(match[1] || '').trim();
        const rawName = String(match[2] || '').trim();
        if (!optionParamNames.includes(rawName) && !(rawName === 'destructured' && optionParamNames.includes('destructured'))) {
            continue;
        }
        const typeName = rawType.replace(/[\[\]\(\)\|?]/g, '').trim();
        if (!typeName || typeName === 'object' || typeName === 'Object') continue;
        if (typeName.includes('<') || typeName.includes(',') || typeName.includes(' ')) continue;
        if (declaredTypedefs.has(typeName)) return true;
    }
    return false;
}

/**
 * @param {ts.Node} node
 * @param {ExportKind} kind
 * @returns {boolean}
 */
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
 * @returns {{ missing: string[], quality: JSDocQualityLevel }}
 */
function assessQuality(kind, hasReturnsTag, hasCompleteParamTags, hasOptionsParam, hasOptionsTypedef, unsafeGenericTagsCount) {
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

/**
 * @param {ts.Node} node
 * @param {ts.SyntaxKind} kind
 * @returns {boolean}
 */
function hasModifierKind(node, kind) {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return Boolean(modifiers?.some(modifier => modifier.kind === kind));
}

/**
 * @param {ts.Statement} statement
 * @returns {boolean}
 */
function isExportedStatement(statement) {
    return hasModifierKind(statement, ts.SyntaxKind.ExportKeyword);
}

/**
 * @param {ts.SourceFile} sourceFile
 * @returns {Map<string, LocalExportTarget>}
 */
function collectLocalExportTargets(sourceFile) {
    /** @type {Map<string, LocalExportTarget>} */
    const targets = new Map();

    for (const statement of sourceFile.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name) {
            targets.set(statement.name.text, { node: statement, kind: 'function' });
            continue;
        }
        if (ts.isClassDeclaration(statement) && statement.name) {
            targets.set(statement.name.text, { node: statement, kind: 'class' });
            continue;
        }
        if (ts.isTypeAliasDeclaration(statement)) {
            targets.set(statement.name.text, { node: statement, kind: 'typedef' });
            continue;
        }
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name)) {
                    targets.set(declaration.name.text, { node: statement, kind: 'const' });
                }
            }
        }
    }

    return targets;
}

/**
 * @param {ts.Node} node
 * @param {ts.SourceFile} sourceFile
 * @param {string} exportName
 * @param {ExportKind} kind
 * @param {Set<string>} declaredTypedefs
 * @returns {ExportJSDocAssessment}
 */
function buildAssessment(node, sourceFile, exportName, kind, declaredTypedefs) {
    const tags = getJSDocTags(node);
    const jsdocText = getJSDocText(node, sourceFile);
    const hasJsdoc = hasJsDoc(node);
    const hasReturnsTag = tags.includes('returns') || tags.includes('return');
    const paramCount = getFunctionParamCount(node);
    const paramTagsCount = getParamTagCount(node);
    const hasCompleteParamTags = !isFunctionExport(node, kind) || paramCount === 0 || paramTagsCount >= paramCount;
    const optionParamNames = collectOptionParamNames(node);
    const hasOptionsParam = optionParamNames.length > 0;
    const hasOptionsTypedefValue = hasOptionsTypedef(jsdocText, optionParamNames, declaredTypedefs);
    const unsafeGenericTagsCount = countMatches(jsdocText, UNSAFE_GENERIC_RE);
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
        unsafeGenericTagsCount
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
        line: getLine(node, sourceFile),
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

/**
 * @param {ts.SourceFile} sourceFile
 * @returns {ExportJSDocAssessment[]}
 */
function collectExportsFromSourceFile(sourceFile) {
    /** @type {ExportJSDocAssessment[]} */
    const exportedSymbols = [];
    const localTargets = collectLocalExportTargets(sourceFile);
    const declaredTypedefs = collectDeclaredTypedefs(sourceFile);

    for (const statement of sourceFile.statements) {
        if (ts.isFunctionDeclaration(statement) && isExportedStatement(statement)) {
            const exportName =
                statement.name?.text || (hasModifierKind(statement, ts.SyntaxKind.DefaultKeyword) ? 'default' : null);
            if (!exportName) continue;
            exportedSymbols.push(buildAssessment(statement, sourceFile, exportName, 'function', declaredTypedefs));
            continue;
        }

        if (ts.isClassDeclaration(statement) && isExportedStatement(statement)) {
            const exportName =
                statement.name?.text || (hasModifierKind(statement, ts.SyntaxKind.DefaultKeyword) ? 'default' : null);
            if (!exportName) continue;
            exportedSymbols.push(buildAssessment(statement, sourceFile, exportName, 'class', declaredTypedefs));
            continue;
        }

        if (ts.isVariableStatement(statement) && isExportedStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name)) {
                    exportedSymbols.push(
                        buildAssessment(statement, sourceFile, declaration.name.text, 'const', declaredTypedefs)
                    );
                }
            }
            continue;
        }

        if (ts.isTypeAliasDeclaration(statement) && isExportedStatement(statement)) {
            exportedSymbols.push(buildAssessment(statement, sourceFile, statement.name.text, 'typedef', declaredTypedefs));
            continue;
        }

        if (ts.isExportAssignment(statement)) {
            if (ts.isIdentifier(statement.expression)) {
                const local = localTargets.get(statement.expression.text);
                if (local) {
                    exportedSymbols.push(buildAssessment(local.node, sourceFile, 'default', local.kind, declaredTypedefs));
                    continue;
                }
            }
            exportedSymbols.push(buildAssessment(statement, sourceFile, 'default', 'reexport', declaredTypedefs));
            continue;
        }

        if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            for (const element of statement.exportClause.elements) {
                const isLocalExport = !statement.moduleSpecifier;
                const localName = element.propertyName?.text || element.name.text;
                if (isLocalExport) {
                    const local = localTargets.get(localName);
                    if (local) {
                        exportedSymbols.push(
                            buildAssessment(local.node, sourceFile, element.name.text, local.kind, declaredTypedefs)
                        );
                        continue;
                    }
                }
                exportedSymbols.push(buildAssessment(statement, sourceFile, element.name.text, 'reexport', declaredTypedefs));
            }
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
    const sourceFile = ts.createSourceFile(absoluteFile, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const exportedSymbols = collectExportsFromSourceFile(sourceFile);
    const exportsTotal = exportedSymbols.length;
    const exportsWithJsdoc = exportedSymbols.filter(symbol => symbol.has_jsdoc).length;
    const coveragePct = exportsTotal > 0 ? Number(((exportsWithJsdoc / exportsTotal) * 100).toFixed(1)) : 100;
    const functionExports = exportedSymbols.filter(symbol => symbol.kind === 'function');
    const functionsTotal = functionExports.length;
    const functionsMissingReturnsTag = functionExports.filter(symbol => symbol.missing_tags.includes('returns')).length;
    const functionsWithReturnsTag = functionsTotal - functionsMissingReturnsTag;
    const functionReturnsCoveragePct =
        functionsTotal > 0 ? Number(((functionsWithReturnsTag / functionsTotal) * 100).toFixed(1)) : 100;
    const functionsMissingParamTags = functionExports.filter(symbol => !symbol.has_complete_param_tags).length;
    const functionsWithCompleteParamTags = functionsTotal - functionsMissingParamTags;
    const functionsWithOptionsTypedef = functionExports.filter(
        symbol => !symbol.has_options_param || symbol.has_options_typedef
    ).length;
    const functionsMissingOptionsTypedef = functionExports.filter(
        symbol => symbol.has_options_param && !symbol.has_options_typedef
    ).length;
    const unsafeGenericTagsTotal = exportedSymbols.reduce((total, symbol) => total + symbol.unsafe_generic_tags_count, 0);
    const publicSymbolsUsingImportTypes = exportedSymbols.filter(symbol => symbol.uses_import_types).length;
    const publicSymbolsUsingTemplateTags = exportedSymbols.filter(symbol => symbol.uses_template_tags).length;

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
 * @param {{ files: string[], scope?: 'changed'|'full' }} options
 * @returns {JSDocCoverageReport}
 */
export function analyzeJSDocCoverage(options) {
    const files = Array.from(new Set((options.files || []).map(norm)))
        .filter(Boolean)
        .filter(file => JS_EXT_RE.test(file))
        .filter(file => fs.existsSync(file));

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
        0
    );
    const functionReturnsCoveragePct =
        functionsTotal > 0 ? Number(((functionsWithReturnsTag / functionsTotal) * 100).toFixed(1)) : 100;
    const functionsWithCompleteParamTags = fileReports.reduce(
        (total, item) => total + item.functions_with_complete_param_tags,
        0
    );
    const functionsMissingParamTags = fileReports.reduce((total, item) => total + item.functions_missing_param_tags, 0);
    const functionsWithOptionsTypedef = fileReports.reduce(
        (total, item) => total + item.functions_with_options_typedef,
        0
    );
    const functionsMissingOptionsTypedef = fileReports.reduce(
        (total, item) => total + item.functions_missing_options_typedef,
        0
    );
    const unsafeGenericTagsTotal = fileReports.reduce((total, item) => total + item.unsafe_generic_tags_total, 0);
    const publicSymbolsUsingImportTypes = fileReports.reduce(
        (total, item) => total + item.public_symbols_using_import_types,
        0
    );
    const publicSymbolsUsingTemplateTags = fileReports.reduce(
        (total, item) => total + item.public_symbols_using_template_tags,
        0
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
