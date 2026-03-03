// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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
 * }} FileJSDocReport
 */

/**
 * @typedef {{
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
 *   by_path_prefix: Record<string, {
 *     files: number,
 *     exports_total: number,
 *     exports_with_jsdoc: number,
 *     coverage_pct: number,
 *     functions_total: number,
 *     functions_with_returns_tag: number,
 *     functions_missing_returns_tag: number,
 *     function_returns_coverage_pct: number
 *   }>,
 *   files: FileJSDocReport[],
 * }} JSDocCoverageReport
 */

const JS_EXT_RE = /\.(js|mjs|cjs)$/i;

/** @param {string} p */
function norm(p) {
    return String(p || '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '');
}

/** @param {string} file */
function inferPrefix(file) {
    const p = norm(file);
    const parts = p.split('/');
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    return parts[0] || 'root';
}

/** @param {ts.Node} node */
function getLine(node, sf) {
    try {
        return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    } catch {
        return null;
    }
}

/** @param {ts.Node} node */
function getJSDocTags(node) {
    /** @type {string[]} */
    const tags = [];
    const docs = ts.getJSDocTags(node) || [];
    for (const tag of docs) {
        const tagName = String(tag.tagName?.escapedText || '').trim();
        if (tagName) tags.push(tagName);
    }
    return Array.from(new Set(tags));
}

/** @param {ts.Node} node */
function hasJsDoc(node) {
    const docs = ts.getJSDocCommentsAndTags(node) || [];
    return docs.length > 0;
}

/** @param {ExportKind} kind @param {string[]} tags */
function assessQuality(kind, tags) {
    const tagSet = new Set(tags);
    /** @type {string[]} */
    const missing = [];

    if (kind === 'function') {
        if (!tagSet.has('returns') && !tagSet.has('return')) missing.push('returns');
        // params are hard to infer precisely without full signature walk; require for named functions with params later.
    }

    if (kind === 'class') {
        // class description-only can be minimal; no mandatory tags here.
    }

    const quality = tags.length > 0 ? (missing.length === 0 ? 'complete' : 'minimal') : 'none';
    return { missing, quality: /** @type {JSDocQualityLevel} */ (quality) };
}

/**
 * @param {ts.Node} node
 * @param {ts.SourceFile} sf
 * @param {string} exportName
 * @param {ExportKind} kind
 * @returns {ExportJSDocAssessment}
 */
function buildAssessment(node, sf, exportName, kind) {
    const tags = getJSDocTags(node);
    const jsdoc = hasJsDoc(node);
    const assessed = assessQuality(kind, tags);
    /** @type {JSDocQualityLevel} */
    let quality = 'none';
    if (jsdoc) {
        if (kind === 'function') {
            quality = assessed.missing.length === 0 ? 'complete' : 'minimal';
        } else {
            quality = tags.length > 0 ? assessed.quality : 'complete';
        }
    }
    return {
        export_name: exportName,
        kind,
        has_jsdoc: jsdoc,
        tags_present: tags,
        missing_tags: jsdoc ? assessed.missing : kind === 'function' ? ['returns'] : [],
        quality_level: quality,
        line: getLine(node, sf),
    };
}

/** @param {ts.Statement} stmt */
function isExportedStatement(stmt) {
    const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined;
    return Boolean(mods?.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
}

/**
 * @param {ts.Node} node
 * @param {ts.SyntaxKind} kind
 */
function hasModifierKind(node, kind) {
    const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return Boolean(mods?.some(m => m.kind === kind));
}

/**
 * @typedef {{ node: ts.Node, kind: ExportKind }} LocalExportTarget
 */

/**
 * Builds a map of top-level locally declared symbols that can later be exported via `export { X }`.
 * JSDoc usually lives on the declaration node, not on the export specifier.
 * @param {ts.SourceFile} sf
 * @returns {Map<string, LocalExportTarget>}
 */
function collectLocalExportTargets(sf) {
    /** @type {Map<string, LocalExportTarget>} */
    const map = new Map();

    for (const stmt of sf.statements) {
        if (ts.isFunctionDeclaration(stmt) && stmt.name) {
            map.set(stmt.name.text, { node: stmt, kind: 'function' });
            continue;
        }

        if (ts.isClassDeclaration(stmt) && stmt.name) {
            map.set(stmt.name.text, { node: stmt, kind: 'class' });
            continue;
        }

        if (ts.isTypeAliasDeclaration(stmt)) {
            map.set(stmt.name.text, { node: stmt, kind: 'typedef' });
            continue;
        }

        if (ts.isVariableStatement(stmt)) {
            for (const decl of stmt.declarationList.declarations) {
                if (ts.isIdentifier(decl.name)) {
                    map.set(decl.name.text, { node: stmt, kind: 'const' });
                }
            }
            continue;
        }
    }

    return map;
}

/**
 * @param {ts.SourceFile} sf
 * @returns {ExportJSDocAssessment[]}
 */
function collectExportsFromSourceFile(sf) {
    /** @type {ExportJSDocAssessment[]} */
    const out = [];
    const localTargets = collectLocalExportTargets(sf);

    for (const stmt of sf.statements) {
        if (ts.isFunctionDeclaration(stmt) && isExportedStatement(stmt)) {
            const exportName =
                stmt.name?.text || (hasModifierKind(stmt, ts.SyntaxKind.DefaultKeyword) ? 'default' : null);
            if (!exportName) continue;
            out.push(buildAssessment(stmt, sf, exportName, 'function'));
            continue;
        }

        if (ts.isClassDeclaration(stmt) && isExportedStatement(stmt)) {
            const exportName =
                stmt.name?.text || (hasModifierKind(stmt, ts.SyntaxKind.DefaultKeyword) ? 'default' : null);
            if (!exportName) continue;
            out.push(buildAssessment(stmt, sf, exportName, 'class'));
            continue;
        }

        if (ts.isVariableStatement(stmt) && isExportedStatement(stmt)) {
            for (const decl of stmt.declarationList.declarations) {
                if (ts.isIdentifier(decl.name)) {
                    out.push(buildAssessment(stmt, sf, decl.name.text, 'const'));
                }
            }
            continue;
        }

        if (ts.isTypeAliasDeclaration(stmt) && isExportedStatement(stmt)) {
            out.push(buildAssessment(stmt, sf, stmt.name.text, 'typedef'));
            continue;
        }

        if (ts.isExportAssignment(stmt)) {
            if (ts.isIdentifier(stmt.expression)) {
                const local = localTargets.get(stmt.expression.text);
                if (local) {
                    out.push(buildAssessment(local.node, sf, 'default', local.kind));
                    continue;
                }
            }
            out.push(buildAssessment(stmt, sf, 'default', 'reexport'));
            continue;
        }

        if (ts.isExportDeclaration(stmt) && stmt.exportClause) {
            if (ts.isNamedExports(stmt.exportClause)) {
                for (const el of stmt.exportClause.elements) {
                    const isLocalExport = !stmt.moduleSpecifier;
                    const localName = el.propertyName?.text || el.name.text;
                    if (isLocalExport) {
                        const local = localTargets.get(localName);
                        if (local) {
                            out.push(buildAssessment(local.node, sf, el.name.text, local.kind));
                            continue;
                        }
                    }
                    out.push(buildAssessment(stmt, sf, el.name.text, 'reexport'));
                }
            }
        }
    }

    return out;
}

/** @param {string} file */
function parseFile(file) {
    const abs = path.resolve(file);
    const text = fs.readFileSync(abs, 'utf8');
    const kind = file.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.JS;
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, kind);
    const exported = collectExportsFromSourceFile(sf);
    const exportsTotal = exported.length;
    const exportsWithJsdoc = exported.filter(e => e.has_jsdoc).length;
    const coveragePct = exportsTotal > 0 ? Number(((exportsWithJsdoc / exportsTotal) * 100).toFixed(1)) : 100;
    const functionExports = exported.filter(e => e.kind === 'function');
    const functionsTotal = functionExports.length;
    const functionsMissingReturnsTag = functionExports.filter(e => e.missing_tags.includes('returns')).length;
    const functionsWithReturnsTag = functionsTotal - functionsMissingReturnsTag;
    const functionReturnsCoveragePct =
        functionsTotal > 0 ? Number(((functionsWithReturnsTag / functionsTotal) * 100).toFixed(1)) : 100;
    return /** @type {FileJSDocReport} */ ({
        file: norm(path.relative(process.cwd(), abs)),
        exported_symbols: exported,
        exports_total: exportsTotal,
        exports_with_jsdoc: exportsWithJsdoc,
        coverage_pct: coveragePct,
        functions_total: functionsTotal,
        functions_with_returns_tag: functionsWithReturnsTag,
        functions_missing_returns_tag: functionsMissingReturnsTag,
        function_returns_coverage_pct: functionReturnsCoveragePct,
    });
}

/**
 * @param {{ files: string[], scope?: 'changed'|'full' }} options
 * @returns {JSDocCoverageReport}
 */
export function analyzeJSDocCoverage(options) {
    const files = Array.from(new Set((options.files || []).map(norm)))
        .filter(Boolean)
        .filter(f => JS_EXT_RE.test(f))
        .filter(f => fs.existsSync(f));

    /** @type {FileJSDocReport[]} */
    const fileReports = [];
    for (const file of files) {
        try {
            const report = parseFile(file);
            if (report.exports_total > 0) fileReports.push(report);
        } catch {
            // caller can treat missing parse details as no-data; keep engine resilient
        }
    }

    const exportsTotal = fileReports.reduce((n, f) => n + f.exports_total, 0);
    const exportsWithJsdoc = fileReports.reduce((n, f) => n + f.exports_with_jsdoc, 0);
    const coveragePct = exportsTotal > 0 ? Number(((exportsWithJsdoc / exportsTotal) * 100).toFixed(1)) : 100;
    const functionsTotal = fileReports.reduce((n, f) => n + f.functions_total, 0);
    const functionsWithReturnsTag = fileReports.reduce((n, f) => n + f.functions_with_returns_tag, 0);
    const functionsMissingReturnsTag = fileReports.reduce((n, f) => n + f.functions_missing_returns_tag, 0);
    const functionReturnsCoveragePct =
        functionsTotal > 0 ? Number(((functionsWithReturnsTag / functionsTotal) * 100).toFixed(1)) : 100;

    /** @type {JSDocCoverageReport['by_path_prefix']} */
    const byPathPrefix = {};
    for (const fr of fileReports) {
        const prefix = inferPrefix(fr.file);
        if (!byPathPrefix[prefix]) {
            byPathPrefix[prefix] = {
                files: 0,
                exports_total: 0,
                exports_with_jsdoc: 0,
                coverage_pct: 100,
                functions_total: 0,
                functions_with_returns_tag: 0,
                functions_missing_returns_tag: 0,
                function_returns_coverage_pct: 100,
            };
        }
        byPathPrefix[prefix].files += 1;
        byPathPrefix[prefix].exports_total += fr.exports_total;
        byPathPrefix[prefix].exports_with_jsdoc += fr.exports_with_jsdoc;
        byPathPrefix[prefix].functions_total += fr.functions_total;
        byPathPrefix[prefix].functions_with_returns_tag += fr.functions_with_returns_tag;
        byPathPrefix[prefix].functions_missing_returns_tag += fr.functions_missing_returns_tag;
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
    const out = [];
    /** @param {string} dir */
    function walk(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
            if (ent.name === 'node_modules' || ent.name.startsWith('.git')) continue;
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                if (ent.name === 'dist') continue;
                walk(full);
            } else if (ent.isFile() && JS_EXT_RE.test(ent.name)) {
                out.push(norm(path.relative(process.cwd(), full)));
            }
        }
    }
    for (const root of roots) walk(root);
    return Array.from(new Set(out));
}
