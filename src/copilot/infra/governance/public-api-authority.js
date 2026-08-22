// @ts-check
/**
 * Semantic public-API path-authority governance.
 *
 * The manifest remains the reviewed source of truth for capability semantics. This checker adds an AST-backed invariant:
 * privileged runtime/composition exports with direct path-like parameters cannot silently appear behind metadata that
 * claims no operational raw-path acceptance or no authority domain. Re-export chains are resolved to their defining
 * function where possible, so the check is about callable signatures rather than export names.
 *
 * @module copilot/infra/governance/public-api-authority
 */

import { parse } from '@babel/parser';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INFRA_PUBLIC_API_MANIFEST } from './public-api-manifest.js';

const DEFAULT_REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PATH_PARAMETER =
    /^(?:path|file|directory|root|filePath|dirPath|directoryPath|rootPath|workspaceRoot|sourcePath|destinationPath|targetPath)$/u;
const PATH_PARAMETER_SUFFIX = /(?:Path|Root)$/u;
const PATH_AUTHORITIES = new Set(['none', 'configured-bound', 'workspace-bound', 'diagnostic-only', 'test-only']);

/** @typedef {(typeof INFRA_PUBLIC_API_MANIFEST)[number]} PublicApiDescriptor */
/** @typedef {Omit<PublicApiDescriptor, 'pathAuthority'|'acceptsOperationalRawPath'|'issuer'> & {pathAuthority?:PublicApiDescriptor['pathAuthority'];acceptsOperationalRawPath?:boolean;issuer?:boolean}} PublicApiInspectionDescriptor */
/** @typedef {{exportName:string;filePath:string;parameterNames:readonly string[];pathParameters:readonly string[]}} ResolvedCallableFinding */
/** @typedef {{alias:string;exportName:string;pathParameters:readonly string[];pathAuthority:string;acceptsOperationalRawPath:boolean;issuer:boolean}} PublicAuthoritySignatureFinding */

/** @param {string} source */
function parseModule(source) {
    return parse(source, { sourceType: 'module' });
}

/** @param {import('@babel/types').Node | null | undefined} node @param {string[]} output */
function collectPatternNames(node, output) {
    if (!node) return;
    switch (node.type) {
        case 'Identifier':
            output.push(node.name);
            return;
        case 'AssignmentPattern':
            collectPatternNames(node.left, output);
            return;
        case 'RestElement':
            collectPatternNames(node.argument, output);
            return;
        case 'ObjectPattern':
            for (const property of node.properties) {
                if (property.type === 'ObjectProperty') collectPatternNames(property.value, output);
                else if (property.type === 'RestElement') collectPatternNames(property.argument, output);
            }
            return;
        case 'ArrayPattern':
            for (const element of node.elements) collectPatternNames(element, output);
            return;
        default:
            return;
    }
}

/** @param {readonly (import('@babel/types').Identifier | import('@babel/types').Pattern | import('@babel/types').RestElement | import('@babel/types').TSParameterProperty)[]} params */
function parameterNames(params) {
    /** @type {string[]} */
    const names = [];
    for (const parameter of params) {
        if (parameter.type === 'TSParameterProperty') collectPatternNames(parameter.parameter, names);
        else collectPatternNames(parameter, names);
    }
    return names;
}

/** @param {string} name */
function isPathParameter(name) {
    return PATH_PARAMETER.test(name) || PATH_PARAMETER_SUFFIX.test(name);
}

/** @param {import('@babel/types').FunctionDeclaration | import('@babel/types').FunctionExpression | import('@babel/types').ArrowFunctionExpression} callable */
function inspectCallable(callable) {
    const names = parameterNames(callable.params);
    return Object.freeze({
        parameterNames: Object.freeze(names),
        pathParameters: Object.freeze(names.filter(isPathParameter)),
    });
}

/** @param {import('@babel/types').Identifier | import('@babel/types').StringLiteral | import('@babel/types').PrivateName | import('@babel/types').Expression} node */
function exportedName(node) {
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'StringLiteral') return node.value;
    return null;
}

/** @param {string} fromFile @param {string} specifier */
function resolveRelativeModule(fromFile, specifier) {
    if (!specifier.startsWith('.')) return null;
    const base = path.resolve(path.dirname(fromFile), specifier);
    for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
        if (existsSync(candidate)) return candidate;
    }
    return null;
}

/**
 * Resolve one named export through relative ESM re-export/import chains to a concrete function declaration/expression.
 * Non-callable exports intentionally resolve to null; the semantic manifest still governs them.
 *
 * @param {string} filePath
 * @param {string} exportName
 * @param {Set<string>} [seen]
 * @returns {{filePath:string;callable:import('@babel/types').FunctionDeclaration|import('@babel/types').FunctionExpression|import('@babel/types').ArrowFunctionExpression}|null}
 */
function resolveExportedCallable(filePath, exportName, seen = new Set()) {
    const visitKey = `${filePath}\u0000${exportName}`;
    if (seen.has(visitKey)) return null;
    seen.add(visitKey);
    const ast = parseModule(readFileSync(filePath, 'utf8'));
    const body = ast.program.body;

    /** @param {string} localName */
    function resolveLocal(localName) {
        for (const statement of body) {
            if (statement.type === 'FunctionDeclaration' && statement.id?.name === localName) {
                return { filePath, callable: statement };
            }
            if (statement.type === 'VariableDeclaration') {
                for (const declaration of statement.declarations) {
                    if (
                        declaration.id.type === 'Identifier' &&
                        declaration.id.name === localName &&
                        (declaration.init?.type === 'ArrowFunctionExpression' ||
                            declaration.init?.type === 'FunctionExpression')
                    ) {
                        return { filePath, callable: declaration.init };
                    }
                }
            }
            if (statement.type === 'ImportDeclaration') {
                for (const specifier of statement.specifiers) {
                    if (specifier.local.name !== localName) continue;
                    const target = resolveRelativeModule(filePath, statement.source.value);
                    if (!target) return null;
                    const imported =
                        specifier.type === 'ImportSpecifier'
                            ? exportedName(specifier.imported)
                            : specifier.type === 'ImportDefaultSpecifier'
                              ? 'default'
                              : null;
                    return imported ? resolveExportedCallable(target, imported, seen) : null;
                }
            }
        }
        return null;
    }

    for (const statement of body) {
        if (statement.type === 'ExportNamedDeclaration') {
            const declaration = statement.declaration;
            if (declaration?.type === 'FunctionDeclaration' && declaration.id?.name === exportName) {
                return { filePath, callable: declaration };
            }
            if (declaration?.type === 'VariableDeclaration') {
                for (const item of declaration.declarations) {
                    if (
                        item.id.type === 'Identifier' &&
                        item.id.name === exportName &&
                        (item.init?.type === 'ArrowFunctionExpression' || item.init?.type === 'FunctionExpression')
                    ) {
                        return { filePath, callable: item.init };
                    }
                }
            }
            for (const specifier of statement.specifiers) {
                if (specifier.type !== 'ExportSpecifier' || exportedName(specifier.exported) !== exportName) continue;
                const localName = exportedName(specifier.local);
                if (!localName) return null;
                if (!statement.source) return resolveLocal(localName);
                const target = resolveRelativeModule(filePath, statement.source.value);
                return target ? resolveExportedCallable(target, localName, seen) : null;
            }
        }
        if (statement.type === 'ExportAllDeclaration') {
            const target = resolveRelativeModule(filePath, statement.source.value);
            if (!target) continue;
            const resolved = resolveExportedCallable(target, exportName, seen);
            if (resolved) return resolved;
        }
        if (statement.type === 'ExportDefaultDeclaration' && exportName === 'default') {
            const declaration = statement.declaration;
            if (
                declaration.type === 'FunctionDeclaration' ||
                declaration.type === 'FunctionExpression' ||
                declaration.type === 'ArrowFunctionExpression'
            ) {
                return { filePath, callable: declaration };
            }
            if (declaration.type === 'Identifier') return resolveLocal(declaration.name);
        }
    }
    return resolveLocal(exportName);
}

/**
 * Pure causal checker for a direct source snippet. Useful for proving the semantic rule independently of current names.
 *
 * @param {string} source
 * @param {PublicApiInspectionDescriptor} descriptor
 */
export function inspectPublicApiAuthoritySource(source, descriptor) {
    const ast = parseModule(source);
    /** @type {{exportName:string;pathParameters:readonly string[]}[]} */
    const findings = [];
    for (const statement of ast.program.body) {
        if (statement.type !== 'ExportNamedDeclaration' || !statement.declaration) continue;
        const declaration = statement.declaration;
        if (declaration.type === 'FunctionDeclaration' && declaration.id) {
            const inspected = inspectCallable(declaration);
            if (inspected.pathParameters.length > 0) {
                findings.push({ exportName: declaration.id.name, pathParameters: inspected.pathParameters });
            }
        } else if (declaration.type === 'VariableDeclaration') {
            for (const item of declaration.declarations) {
                if (
                    item.id.type === 'Identifier' &&
                    (item.init?.type === 'ArrowFunctionExpression' || item.init?.type === 'FunctionExpression')
                ) {
                    const inspected = inspectCallable(item.init);
                    if (inspected.pathParameters.length > 0) {
                        findings.push({ exportName: item.id.name, pathParameters: inspected.pathParameters });
                    }
                }
            }
        }
    }
    return Object.freeze({
        findings: Object.freeze(findings),
        violations: Object.freeze([
            ...metadataViolationsFor(descriptor),
            ...findings.flatMap((finding) => signatureViolations(descriptor, finding)),
        ]),
    });
}

/** @param {PublicApiInspectionDescriptor} descriptor @param {{exportName:string;pathParameters:readonly string[]}} finding */
function signatureViolations(descriptor, finding) {
    if (descriptor.audience === 'diagnostic' || descriptor.audience === 'test' || descriptor.privilege === 'pure')
        return [];
    if (descriptor.pathAuthority !== 'none' && descriptor.acceptsOperationalRawPath) return [];
    return [
        `${descriptor.alias}:${finding.exportName} accepts raw path parameter(s) ${finding.pathParameters.join(',')} without an operational path-authority classification`,
    ];
}

/** @param {PublicApiInspectionDescriptor} descriptor */
function metadataViolationsFor(descriptor) {
    /** @type {string[]} */
    const violations = [];
    const pathAuthority = descriptor.pathAuthority;
    const acceptsOperationalRawPath = descriptor.acceptsOperationalRawPath;
    const issuer = descriptor.issuer;
    if (typeof pathAuthority !== 'string' || !PATH_AUTHORITIES.has(pathAuthority)) {
        violations.push(`${descriptor.alias}: pathAuthority must be explicitly classified`);
    }
    if (typeof acceptsOperationalRawPath !== 'boolean') {
        violations.push(`${descriptor.alias}: acceptsOperationalRawPath must be boolean`);
    }
    if (typeof issuer !== 'boolean') {
        violations.push(`${descriptor.alias}: issuer must be boolean`);
    }
    if (violations.length > 0) return violations;
    if (acceptsOperationalRawPath && pathAuthority === 'none') {
        violations.push(`${descriptor.alias}: acceptsOperationalRawPath requires pathAuthority`);
    }
    if (issuer && pathAuthority === 'none') {
        violations.push(`${descriptor.alias}: issuer requires pathAuthority`);
    }
    if (pathAuthority === 'diagnostic-only' && descriptor.audience !== 'diagnostic') {
        violations.push(`${descriptor.alias}: diagnostic-only authority requires diagnostic audience`);
    }
    if (descriptor.audience === 'diagnostic' && acceptsOperationalRawPath && pathAuthority !== 'diagnostic-only') {
        violations.push(`${descriptor.alias}: diagnostic raw-path API must be diagnostic-only`);
    }
    if (pathAuthority === 'test-only' && descriptor.audience !== 'test') {
        violations.push(`${descriptor.alias}: test-only authority requires test audience`);
    }
    if (descriptor.audience === 'test' && acceptsOperationalRawPath && pathAuthority !== 'test-only') {
        violations.push(`${descriptor.alias}: test raw-path API must be test-only`);
    }
    if (descriptor.privilege === 'pure' && (acceptsOperationalRawPath || issuer)) {
        violations.push(`${descriptor.alias}: pure API cannot accept operational raw paths or issue path authority`);
    }
    return violations;
}

/** @param {{repoRoot?:string}} [options] */
export function buildInfraPublicAuthorityReport(options = {}) {
    const repoRoot = path.resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
    /** @type {string[]} */
    const metadataViolations = [];
    /** @type {string[]} */
    const signatureViolationsFound = [];
    /** @type {PublicAuthoritySignatureFinding[]} */
    const signatureFindings = [];
    /** @type {{alias:string;exportName:string}[]} */
    const unresolvedExports = [];

    for (const descriptor of INFRA_PUBLIC_API_MANIFEST) {
        metadataViolations.push(...metadataViolationsFor(descriptor));
        const targetPath = path.resolve(repoRoot, descriptor.target.replace(/^\.\//u, ''));
        for (const exportName of descriptor.exports) {
            const resolved = resolveExportedCallable(targetPath, exportName);
            if (!resolved) {
                unresolvedExports.push({ alias: descriptor.alias, exportName });
                continue;
            }
            const inspected = inspectCallable(resolved.callable);
            if (inspected.pathParameters.length === 0) continue;
            signatureFindings.push({
                alias: descriptor.alias,
                exportName,
                pathParameters: inspected.pathParameters,
                pathAuthority: descriptor.pathAuthority,
                acceptsOperationalRawPath: descriptor.acceptsOperationalRawPath,
                issuer: descriptor.issuer,
            });
            signatureViolationsFound.push(
                ...signatureViolations(descriptor, { exportName, pathParameters: inspected.pathParameters }),
            );
        }
    }

    return Object.freeze({
        success: metadataViolations.length === 0 && signatureViolationsFound.length === 0,
        metadataViolations: Object.freeze(metadataViolations),
        signatureViolations: Object.freeze(signatureViolationsFound),
        signatureFindings: Object.freeze(signatureFindings),
        unresolvedExports: Object.freeze(unresolvedExports),
    });
}
