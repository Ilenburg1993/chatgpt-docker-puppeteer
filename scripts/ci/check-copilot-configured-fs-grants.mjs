#!/usr/bin/env node
// @ts-check
/**
 * Fail-closed ownership and authority-shape policy for ConfiguredFsGrant minting.
 *
 * A configured filesystem grant is privileged composition data, not an ordinary helper object. Production modules may
 * reach the configured-grant kernel only when this manifest names the owner, every grant id is statically resolvable,
 * and the authority shape matches the declared policy exactly. Path values themselves may be runtime configuration,
 * but widening exact paths into roots, adding operations, changing durability, or introducing new declaration fields
 * is visible as governance drift.
 */

import * as t from '@babel/types';
import { globSync } from 'glob';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { parseCopilotFsSource, walkAst } from './lib/copilot-fs-ast.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_ROOT = 'src/copilot';
const SOURCE_GLOB = `${SOURCE_ROOT}/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}`;
const CONFIGURED_FS_SPECIFIERS = new Set([
    '#copilot/infra/internal/filesystem/configured',
    '#copilot/infra/public/composition/filesystem/configured',
]);
const CONFIGURED_FS_TARGETS = new Set(
    [
        'src/copilot/infra/filesystem/configured/index.js',
        'src/copilot/infra/filesystem/configured/service.js',
        'src/copilot/infra/public/composition/filesystem/configured/index.js',
    ].map((entry) => path.resolve(ROOT, entry)),
);
const POLICY_PATH = path.join(ROOT, 'config', 'architecture', 'copilot-configured-fs-grants.json');
const FACTORIES = new Set(['createConfiguredFsGrant', 'createConfiguredFsIo']);
const CLASSIFICATIONS = new Set([
    'agent-state',
    'infra-owner',
    'mcp-owner',
    'model-gateway-state',
    'observability-state',
    'runtime-config',
    'sdk-state',
    'terminal-operator',
    'tool-state',
]);
const VALID_PATH_MODES = new Set(['roots', 'exact', 'mixed']);
const VALID_OPERATIONS = new Set([
    'read',
    'stat',
    'list',
    'write',
    'mkdir',
    'delete',
    'watch',
    'chmod',
    'append',
    'move',
]);
const VALID_DURABILITY = new Set(['file-and-directory', 'file', 'none']);
const GRANT_DECLARATION_FIELDS = new Set(['id', 'roots', 'exactPaths', 'operations', 'symlinkPolicy', 'durability']);

/** @typedef {'roots'|'exact'|'mixed'} ConfiguredFsPathMode */
/** @typedef {{ id:string; pathMode:ConfiguredFsPathMode; operations:string[]; symlinkPolicy:'deny'; durability:string[] }} ConfiguredFsAuthorityShape */
/** @typedef {{ file:string; grants:ConfiguredFsAuthorityShape[]; classification:string; reason:string }} ConfiguredFsPolicyEntry */
/** @typedef {{ file:string; grantIds:string[]; grants:ConfiguredFsAuthorityShape[]; bindings:string[]; calls:number; grantCalls:number; issues:string[] }} ConfiguredFsInventoryEntry */
/** @typedef {{ strings:Map<string,string>; arrays:Map<string,string[]> }} StaticConstants */

/** @param {t.Program} program @returns {StaticConstants} */
function readTopLevelStaticConstants(program) {
    /** @type {Map<string,string>} */
    const strings = new Map();
    /** @type {Map<string,string[]>} */
    const arrays = new Map();
    for (const statement of program.body) {
        if (!t.isVariableDeclaration(statement) || statement.kind !== 'const') continue;
        for (const declaration of statement.declarations) {
            if (!t.isIdentifier(declaration.id) || !declaration.init) continue;
            if (t.isStringLiteral(declaration.init)) {
                strings.set(declaration.id.name, declaration.init.value);
                continue;
            }
            const array = readLiteralStringArray(declaration.init);
            if (array) arrays.set(declaration.id.name, array);
        }
    }
    return { strings, arrays };
}

/** @param {t.Node} node @returns {string[] | null} */
function readLiteralStringArray(node) {
    if (!t.isArrayExpression(node)) return null;
    /** @type {string[]} */
    const values = [];
    for (const element of node.elements) {
        if (!element || !t.isStringLiteral(element)) return null;
        values.push(element.value);
    }
    return values;
}

/** @param {t.Node | null | undefined} node @param {StaticConstants} constants */
function readStaticString(node, constants) {
    if (node && t.isStringLiteral(node)) return node.value;
    if (node && t.isIdentifier(node)) return constants.strings.get(node.name) ?? null;
    return null;
}

/** @param {t.Node | null | undefined} node @param {StaticConstants} constants */
function readStaticStringArray(node, constants) {
    if (!node) return null;
    const literal = readLiteralStringArray(node);
    if (literal) return literal;
    if (t.isIdentifier(node)) return constants.arrays.get(node.name) ?? null;
    return null;
}

/** @param {t.ObjectProperty} property */
function objectPropertyName(property) {
    if (property.computed) return null;
    if (t.isIdentifier(property.key)) return property.key.name;
    if (t.isStringLiteral(property.key)) return property.key.value;
    return null;
}

/**
 * @param {t.ObjectExpression} object
 * @param {string} file
 * @param {number} line
 * @param {string[]} issues
 */
function readGrantDeclarationProperties(object, file, line, issues) {
    /** @type {Map<string,t.Node>} */
    const properties = new Map();
    for (const property of object.properties) {
        if (!t.isObjectProperty(property)) {
            issues.push(`configured-fs-grant-nonstatic-property:${file}:${line}`);
            continue;
        }
        const key = objectPropertyName(property);
        if (!key) {
            issues.push(`configured-fs-grant-computed-property:${file}:${line}`);
            continue;
        }
        if (!GRANT_DECLARATION_FIELDS.has(key)) {
            issues.push(`configured-fs-grant-unknown-property:${file}:${line}:${key}`);
            continue;
        }
        if (properties.has(key)) {
            issues.push(`configured-fs-grant-duplicate-property:${file}:${line}:${key}`);
            continue;
        }
        properties.set(key, property.value);
    }
    return properties;
}

/** @param {string[]} values */
function canonicalStrings(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/** @param {ConfiguredFsAuthorityShape} shape */
export function configuredFsAuthorityShapeKey(shape) {
    return JSON.stringify({
        id: shape.id,
        pathMode: shape.pathMode,
        operations: canonicalStrings(shape.operations),
        symlinkPolicy: shape.symlinkPolicy,
        durability: canonicalStrings(shape.durability),
    });
}

/**
 * @param {t.ObjectExpression} declaration
 * @param {StaticConstants} constants
 * @param {string} file
 * @param {number} line
 * @param {string[]} issues
 * @returns {ConfiguredFsAuthorityShape | null}
 */
function readConfiguredGrantShape(declaration, constants, file, line, issues) {
    const properties = readGrantDeclarationProperties(declaration, file, line, issues);
    const id = readStaticString(properties.get('id'), constants);
    if (!id) issues.push(`configured-fs-grant-missing-static-id:${file}:${line}:createConfiguredFsGrant`);

    const hasRoots = properties.has('roots');
    const hasExactPaths = properties.has('exactPaths');
    /** @type {ConfiguredFsPathMode | null} */
    const pathMode = hasRoots && hasExactPaths ? 'mixed' : hasRoots ? 'roots' : hasExactPaths ? 'exact' : null;
    if (!pathMode) issues.push(`configured-fs-grant-missing-path-authority:${file}:${line}`);

    const operations = readStaticStringArray(properties.get('operations'), constants);
    if (!operations || operations.length === 0 || operations.some((operation) => !VALID_OPERATIONS.has(operation))) {
        issues.push(`configured-fs-grant-nonstatic-operations:${file}:${line}`);
    }

    const rawSymlinkPolicy = properties.has('symlinkPolicy')
        ? readStaticString(properties.get('symlinkPolicy'), constants)
        : 'deny';
    if (rawSymlinkPolicy !== 'deny') issues.push(`configured-fs-grant-symlink-policy-drift:${file}:${line}`);

    const durability = properties.has('durability')
        ? readStaticStringArray(properties.get('durability'), constants)
        : ['file-and-directory'];
    if (!durability || durability.length === 0 || durability.some((entry) => !VALID_DURABILITY.has(entry))) {
        issues.push(`configured-fs-grant-nonstatic-durability:${file}:${line}`);
    }

    if (!id || !pathMode || !operations || operations.length === 0 || rawSymlinkPolicy !== 'deny' || !durability) {
        return null;
    }
    return {
        id,
        pathMode,
        operations: canonicalStrings(operations),
        symlinkPolicy: 'deny',
        durability: canonicalStrings(durability),
    };
}

/** @param {string} file @param {string} source */
function isConfiguredFsImport(file, source) {
    if (CONFIGURED_FS_SPECIFIERS.has(source)) return true;
    if (!source.startsWith('.')) return false;
    const base = path.resolve(path.dirname(path.join(ROOT, file)), source);
    return [base, `${base}.js`, path.join(base, 'index.js')].some((candidate) => CONFIGURED_FS_TARGETS.has(candidate));
}

/** @param {t.Program} program @param {string} file */
function readConfiguredFsBindings(program, file) {
    /** @type {Map<string,string>} */
    const direct = new Map();
    /** @type {Set<string>} */
    const namespaces = new Set();
    /** @type {string[]} */
    const issues = [];
    for (const statement of program.body) {
        if (!t.isImportDeclaration(statement) || !isConfiguredFsImport(file, statement.source.value)) continue;
        for (const specifier of statement.specifiers) {
            if (t.isImportNamespaceSpecifier(specifier)) {
                namespaces.add(specifier.local.name);
                continue;
            }
            if (t.isImportSpecifier(specifier)) {
                const imported = t.isIdentifier(specifier.imported)
                    ? specifier.imported.name
                    : specifier.imported.value;
                if (!FACTORIES.has(imported)) {
                    issues.push(`configured-fs-unsupported-import:${file}:${imported}`);
                    continue;
                }
                direct.set(specifier.local.name, imported);
                continue;
            }
            issues.push(`configured-fs-unsupported-import:${file}:${specifier.local.name}`);
        }
    }
    return { direct, namespaces, issues };
}

/** @param {t.CallExpression} call @param {Map<string,string>} direct @param {Set<string>} namespaces */
function configuredFsCall(call, direct, namespaces) {
    if (t.isIdentifier(call.callee)) {
        const factory = direct.get(call.callee.name);
        return factory ? { binding: call.callee.name, factory } : null;
    }
    if (
        t.isMemberExpression(call.callee) &&
        !call.callee.computed &&
        t.isIdentifier(call.callee.object) &&
        namespaces.has(call.callee.object.name) &&
        t.isIdentifier(call.callee.property) &&
        FACTORIES.has(call.callee.property.name)
    ) {
        return {
            binding: `${call.callee.object.name}.${call.callee.property.name}`,
            factory: call.callee.property.name,
        };
    }
    return null;
}

/**
 * @param {string} source
 * @param {string} file workspace-relative
 * @returns {ConfiguredFsInventoryEntry | null}
 */
export function analyzeConfiguredFsGrantSource(source, file) {
    const parsed = parseCopilotFsSource(source, file);
    if (parsed.parseErrors.length > 0) {
        return {
            file,
            grantIds: [],
            grants: [],
            bindings: [],
            calls: 0,
            grantCalls: 0,
            issues: parsed.parseErrors.map((error) => `parse:${file}:${error}`),
        };
    }
    const bindings = readConfiguredFsBindings(parsed.ast.program, file);
    if (bindings.direct.size === 0 && bindings.namespaces.size === 0 && bindings.issues.length === 0) return null;
    const constants = readTopLevelStaticConstants(parsed.ast.program);
    /** @type {ConfiguredFsAuthorityShape[]} */
    const grants = [];
    /** @type {Set<string>} */
    const invokedBindings = new Set();
    const issues = [...bindings.issues];
    let calls = 0;
    let grantCalls = 0;

    walkAst(parsed.ast.program, (node) => {
        if (!t.isCallExpression(node)) return;
        const invocation = configuredFsCall(node, bindings.direct, bindings.namespaces);
        if (!invocation) return;
        calls += 1;
        invokedBindings.add(invocation.binding);
        if (invocation.factory !== 'createConfiguredFsGrant') return;
        grantCalls += 1;
        const declaration = node.arguments[0];
        const line = node.loc?.start.line ?? 0;
        if (!t.isObjectExpression(declaration)) {
            issues.push(`configured-fs-grant-nonstatic-declaration:${file}:${line}:${invocation.binding}`);
            return;
        }
        const shape = readConfiguredGrantShape(declaration, constants, file, line, issues);
        if (shape) grants.push(shape);
    });

    for (const binding of bindings.direct.keys()) {
        if (!invokedBindings.has(binding)) issues.push(`configured-fs-import-not-directly-invoked:${file}:${binding}`);
    }
    for (const namespace of bindings.namespaces) {
        if (![...invokedBindings].some((binding) => binding.startsWith(`${namespace}.`))) {
            issues.push(`configured-fs-import-not-directly-invoked:${file}:${namespace}`);
        }
    }
    if (grantCalls === 0) issues.push(`configured-fs-owner-does-not-mint-grant:${file}`);
    const grantIds = grants.map((grant) => grant.id);
    if (new Set(grantIds).size !== grantIds.length) issues.push(`configured-fs-duplicate-grant-id:${file}`);

    return {
        file,
        grantIds: canonicalStrings(grantIds),
        grants: [...grants].sort((left, right) => left.id.localeCompare(right.id)),
        bindings: [...invokedBindings].sort(),
        calls,
        grantCalls,
        issues,
    };
}

function readPolicy() {
    try {
        const parsed = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) return null;
        return /** @type {{schemaVersion?:unknown;configuredFsSpecifiers?:unknown;entries:ConfiguredFsPolicyEntry[]}} */ (
            parsed
        );
    } catch {
        return null;
    }
}

async function collectInventory() {
    const files = globSync(SOURCE_GLOB, {
        cwd: ROOT,
        nodir: true,
        absolute: false,
        ignore: ['**/.ai/**', '**/node_modules/**', '**/dist/**', '**/build/**'],
    }).sort((left, right) => left.localeCompare(right));
    /** @type {ConfiguredFsInventoryEntry[]} */
    const entries = [];
    const { readFile } = await import('node:fs/promises');
    for (const file of files) {
        const source = await readFile(path.join(ROOT, file), 'utf8');
        const entry = analyzeConfiguredFsGrantSource(source, file);
        if (entry) entries.push(entry);
    }
    return { scannedFiles: files.length, entries };
}

/** @param {ConfiguredFsAuthorityShape[]} grants */
function normalizedGrantShapeKeys(grants) {
    return grants.map(configuredFsAuthorityShapeKey).sort((left, right) => left.localeCompare(right));
}

/** @param {unknown} grant */
function isValidPolicyGrant(grant) {
    if (!grant || typeof grant !== 'object') return false;
    const candidate = /** @type {Record<string,unknown>} */ (grant);
    return (
        typeof candidate['id'] === 'string' &&
        candidate['id'].trim().length > 0 &&
        typeof candidate['pathMode'] === 'string' &&
        VALID_PATH_MODES.has(candidate['pathMode']) &&
        Array.isArray(candidate['operations']) &&
        candidate['operations'].length > 0 &&
        candidate['operations'].every((entry) => typeof entry === 'string' && VALID_OPERATIONS.has(entry)) &&
        new Set(candidate['operations']).size === candidate['operations'].length &&
        candidate['symlinkPolicy'] === 'deny' &&
        Array.isArray(candidate['durability']) &&
        candidate['durability'].length > 0 &&
        candidate['durability'].every((entry) => typeof entry === 'string' && VALID_DURABILITY.has(entry)) &&
        new Set(candidate['durability']).size === candidate['durability'].length
    );
}

export async function checkCopilotConfiguredFsGrants() {
    const inventory = await collectInventory();
    const policy = readPolicy();
    /** @type {string[]} */
    const issues = inventory.entries.flatMap((entry) => entry.issues);
    if (!policy) {
        issues.push('configured-fs-policy-missing-or-invalid');
        return {
            ok: false,
            scannedFiles: inventory.scannedFiles,
            importerCount: inventory.entries.length,
            policyEntries: 0,
            grantCount: 0,
            issues,
        };
    }
    if (policy.schemaVersion !== 2) issues.push(`configured-fs-policy-schema-version:${String(policy.schemaVersion)}`);
    if (
        !Array.isArray(policy.configuredFsSpecifiers) ||
        JSON.stringify([...policy.configuredFsSpecifiers].sort()) !==
            JSON.stringify([...CONFIGURED_FS_SPECIFIERS].sort())
    ) {
        issues.push('configured-fs-policy-specifier-drift');
    }

    /** @type {Map<string,ConfiguredFsPolicyEntry>} */
    const expected = new Map();
    for (const entry of policy.entries) {
        if (
            !entry ||
            typeof entry.file !== 'string' ||
            !Array.isArray(entry.grants) ||
            entry.grants.length === 0 ||
            typeof entry.classification !== 'string' ||
            typeof entry.reason !== 'string' ||
            entry.reason.trim().length < 8
        ) {
            issues.push('invalid-configured-fs-policy-entry');
            continue;
        }
        if (!CLASSIFICATIONS.has(entry.classification)) {
            issues.push(`invalid-configured-fs-classification:${entry.file}:${entry.classification}`);
        }
        if (expected.has(entry.file)) issues.push(`duplicate-configured-fs-policy-file:${entry.file}`);
        if (!entry.grants.every(isValidPolicyGrant)) issues.push(`invalid-configured-fs-policy-grant:${entry.file}`);
        const grantIds = entry.grants.map((grant) => grant.id);
        if (new Set(grantIds).size !== grantIds.length)
            issues.push(`duplicate-configured-fs-policy-grant-id:${entry.file}`);
        expected.set(entry.file, entry);
    }

    for (const actual of inventory.entries) {
        const policyEntry = expected.get(actual.file);
        if (!policyEntry) {
            issues.push(`unclassified-configured-fs-owner:${actual.file}`);
            continue;
        }
        const expectedShapes = normalizedGrantShapeKeys(policyEntry.grants);
        const actualShapes = normalizedGrantShapeKeys(actual.grants);
        if (JSON.stringify(actualShapes) !== JSON.stringify(expectedShapes)) {
            issues.push(
                `configured-fs-authority-shape-drift:${actual.file}:expected=${JSON.stringify(expectedShapes)}:actual=${JSON.stringify(actualShapes)}`,
            );
        }
    }
    for (const file of expected.keys()) {
        if (!inventory.entries.some((entry) => entry.file === file))
            issues.push(`stale-configured-fs-policy-entry:${file}`);
    }

    return {
        schemaVersion: 2,
        ok: issues.length === 0,
        scannedFiles: inventory.scannedFiles,
        importerCount: inventory.entries.length,
        policyEntries: expected.size,
        grantCount: inventory.entries.reduce((sum, entry) => sum + entry.grantCalls, 0),
        classifications: Object.fromEntries(
            [...CLASSIFICATIONS]
                .sort()
                .map((classification) => [
                    classification,
                    policy.entries.filter((entry) => entry.classification === classification).length,
                ]),
        ),
        issues,
    };
}

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) {
    const { values } = parseArgs({
        options: {
            json: { type: 'boolean', default: false },
            inventory: { type: 'boolean', default: false },
        },
    });
    if (values.inventory) {
        console.log(JSON.stringify(await collectInventory(), null, 2));
    } else {
        const report = await checkCopilotConfiguredFsGrants();
        if (values.json) console.log(JSON.stringify(report, null, 2));
        else {
            console.log(`Copilot configured FS grants: ${report.ok ? 'OK' : 'FAIL'}`);
            console.log(`- scanned source files: ${report.scannedFiles}`);
            console.log(`- configured grant owners: ${report.importerCount}`);
            console.log(`- policy entries: ${report.policyEntries}`);
            console.log(`- grant calls: ${report.grantCount}`);
            for (const issue of report.issues) console.log(`- issue: ${issue}`);
        }
        if (!report.ok) process.exitCode = 1;
    }
}
