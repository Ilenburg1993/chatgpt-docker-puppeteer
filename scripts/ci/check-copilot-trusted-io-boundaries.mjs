#!/usr/bin/env node
// @ts-check
/**
 * Fail-closed structural policy for the privileged Copilot trusted-IO facade.
 *
 * A module may import trusted-io only when it is explicitly classified in the architecture manifest. Every direct
 * trusted-IO invocation must carry a statically resolvable `caller` identity; literal strings and top-level const
 * string bindings are supported. This prevents generic trusted access from silently spreading across application layers
 * while keeping legitimate boot/control-plane/state boundaries explicit and auditable.
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
const TRUSTED_IO_SPECIFIER = '#copilot/infra/public/trusted-io';
const POLICY_PATH = path.join(ROOT, 'config', 'architecture', 'copilot-trusted-io-boundaries.json');
const CLASSIFICATIONS = new Set([
    'agent-state',
    'runtime-config',
    'mcp-control-plane',
    'model-gateway-state',
    'sdk-state',
    'terminal-operator',
    'tool-state',
]);

/** @typedef {{ file: string; callers: string[]; classification: string; reason: string }} TrustedIoPolicyEntry */
/** @typedef {{ file: string; callers: string[]; bindings: string[]; calls: number; issues: string[] }} TrustedIoInventoryEntry */

/** @param {t.Program} program */
function readTopLevelStringConstants(program) {
    /** @type {Map<string, string>} */
    const values = new Map();
    for (const statement of program.body) {
        if (!t.isVariableDeclaration(statement) || statement.kind !== 'const') continue;
        for (const declaration of statement.declarations) {
            if (!t.isIdentifier(declaration.id) || !t.isStringLiteral(declaration.init)) continue;
            values.set(declaration.id.name, declaration.init.value);
        }
    }
    return values;
}

/** @param {t.Program} program */
function readTrustedIoBindings(program) {
    /** @type {Set<string>} */
    const direct = new Set();
    /** @type {Set<string>} */
    const namespaces = new Set();
    for (const statement of program.body) {
        if (!t.isImportDeclaration(statement) || statement.source.value !== TRUSTED_IO_SPECIFIER) continue;
        for (const specifier of statement.specifiers) {
            if (t.isImportSpecifier(specifier) || t.isImportDefaultSpecifier(specifier))
                direct.add(specifier.local.name);
            else if (t.isImportNamespaceSpecifier(specifier)) namespaces.add(specifier.local.name);
        }
    }
    return { direct, namespaces };
}

/** @param {t.ObjectExpression} object @param {Map<string, string>} constants */
function readCallerProperty(object, constants) {
    for (const property of object.properties) {
        if (!t.isObjectProperty(property) || property.computed) continue;
        const key = t.isIdentifier(property.key)
            ? property.key.name
            : t.isStringLiteral(property.key)
              ? property.key.value
              : null;
        if (key !== 'caller') continue;
        if (t.isStringLiteral(property.value)) return property.value.value;
        if (t.isIdentifier(property.value)) return constants.get(property.value.name) ?? null;
        return null;
    }
    return null;
}

/** @param {t.CallExpression} call @param {Set<string>} direct @param {Set<string>} namespaces */
function trustedCallBinding(call, direct, namespaces) {
    if (t.isIdentifier(call.callee) && direct.has(call.callee.name)) return call.callee.name;
    if (
        t.isMemberExpression(call.callee) &&
        !call.callee.computed &&
        t.isIdentifier(call.callee.object) &&
        namespaces.has(call.callee.object.name) &&
        t.isIdentifier(call.callee.property)
    ) {
        return `${call.callee.object.name}.${call.callee.property.name}`;
    }
    return null;
}

/**
 * @param {string} source
 * @param {string} file workspace-relative
 * @returns {TrustedIoInventoryEntry | null}
 */
export function analyzeTrustedIoSource(source, file) {
    const parsed = parseCopilotFsSource(source, file);
    if (parsed.parseErrors.length > 0) {
        return {
            file,
            callers: [],
            bindings: [],
            calls: 0,
            issues: parsed.parseErrors.map((error) => `parse:${file}:${error}`),
        };
    }
    const { direct, namespaces } = readTrustedIoBindings(parsed.ast.program);
    if (direct.size === 0 && namespaces.size === 0) return null;
    const constants = readTopLevelStringConstants(parsed.ast.program);
    /** @type {Set<string>} */
    const callers = new Set();
    /** @type {Set<string>} */
    const invokedBindings = new Set();
    /** @type {string[]} */
    const issues = [];
    let calls = 0;

    walkAst(parsed.ast.program, (node) => {
        if (!t.isCallExpression(node)) return;
        const binding = trustedCallBinding(node, direct, namespaces);
        if (!binding) return;
        calls += 1;
        invokedBindings.add(binding);
        let caller = null;
        for (const argument of node.arguments) {
            if (!t.isObjectExpression(argument)) continue;
            caller = readCallerProperty(argument, constants);
            if (caller !== null) break;
        }
        if (caller === null) {
            issues.push(`trusted-call-missing-static-caller:${file}:${node.loc?.start.line ?? 0}:${binding}`);
        } else {
            callers.add(caller);
        }
    });

    for (const binding of [...direct, ...namespaces]) {
        if (!invokedBindings.has(binding) && ![...invokedBindings].some((value) => value.startsWith(`${binding}.`))) {
            issues.push(`trusted-import-not-directly-invoked:${file}:${binding}`);
        }
    }
    return {
        file,
        callers: [...callers].sort(),
        bindings: [...invokedBindings].sort(),
        calls,
        issues,
    };
}

function readPolicy() {
    try {
        const parsed = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) return null;
        return /** @type {{ schemaVersion?: unknown; entries: TrustedIoPolicyEntry[] }} */ (parsed);
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
    /** @type {TrustedIoInventoryEntry[]} */
    const entries = [];
    const { readFile } = await import('node:fs/promises');
    for (const file of files) {
        const source = await readFile(path.join(ROOT, file), 'utf8');
        const entry = analyzeTrustedIoSource(source, file);
        if (entry) entries.push(entry);
    }
    return { scannedFiles: files.length, entries };
}

/** @param {string[]} left @param {string[]} right */
function sameStrings(left, right) {
    return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export async function checkCopilotTrustedIoBoundaries() {
    const inventory = await collectInventory();
    const policy = readPolicy();
    /** @type {string[]} */
    const issues = inventory.entries.flatMap((entry) => entry.issues);
    if (!policy) {
        issues.push('trusted-io-policy-missing-or-invalid');
        return {
            ok: false,
            scannedFiles: inventory.scannedFiles,
            importerCount: inventory.entries.length,
            policyEntries: 0,
            callCount: 0,
            issues,
        };
    }

    /** @type {Map<string, TrustedIoPolicyEntry>} */
    const expected = new Map();
    for (const entry of policy.entries) {
        if (
            !entry ||
            typeof entry.file !== 'string' ||
            !Array.isArray(entry.callers) ||
            typeof entry.classification !== 'string' ||
            typeof entry.reason !== 'string' ||
            entry.reason.trim().length < 8
        ) {
            issues.push('invalid-trusted-io-policy-entry');
            continue;
        }
        if (!CLASSIFICATIONS.has(entry.classification)) {
            issues.push(`invalid-trusted-io-classification:${entry.file}:${entry.classification}`);
        }
        if (expected.has(entry.file)) issues.push(`duplicate-trusted-io-policy-file:${entry.file}`);
        if (
            new Set(entry.callers).size !== entry.callers.length ||
            entry.callers.some((caller) => typeof caller !== 'string' || caller.length === 0)
        ) {
            issues.push(`invalid-trusted-io-callers:${entry.file}`);
        }
        expected.set(entry.file, entry);
    }

    for (const actual of inventory.entries) {
        const policyEntry = expected.get(actual.file);
        if (!policyEntry) {
            issues.push(`unclassified-trusted-io-import:${actual.file}`);
            continue;
        }
        if (!sameStrings(actual.callers, policyEntry.callers)) {
            issues.push(
                `trusted-io-caller-drift:${actual.file}:expected=${JSON.stringify(policyEntry.callers)}:actual=${JSON.stringify(actual.callers)}`,
            );
        }
    }
    for (const file of expected.keys()) {
        if (!inventory.entries.some((entry) => entry.file === file))
            issues.push(`stale-trusted-io-policy-entry:${file}`);
    }

    return {
        schemaVersion: 1,
        ok: issues.length === 0,
        scannedFiles: inventory.scannedFiles,
        importerCount: inventory.entries.length,
        policyEntries: expected.size,
        callCount: inventory.entries.reduce((sum, entry) => sum + entry.calls, 0),
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
        const report = await checkCopilotTrustedIoBoundaries();
        if (values.json) console.log(JSON.stringify(report, null, 2));
        else {
            console.log(`Copilot trusted IO boundary: ${report.ok ? 'OK' : 'FAIL'}`);
            console.log(`- scanned source files: ${report.scannedFiles}`);
            console.log(`- trusted importers: ${report.importerCount}`);
            console.log(`- policy entries: ${report.policyEntries}`);
            console.log(`- trusted calls: ${report.callCount}`);
            for (const issue of report.issues) console.log(`- issue: ${issue}`);
        }
        if (!report.ok) process.exitCode = 1;
    }
}
