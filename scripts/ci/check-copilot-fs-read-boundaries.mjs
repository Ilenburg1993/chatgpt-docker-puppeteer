#!/usr/bin/env node
// @ts-check
/**
 * Structural guard for direct filesystem reads inside src/copilot.
 *
 * The canonical direction is application code -> public IO facade -> IO engine -> low-level fs primitives. Existing
 * direct reads outside the low-level root are tracked by an exact debt baseline: no new file/operation/count may
 * appear, and deleting a direct read makes the baseline stale until it is reduced. `--strict-debt` is the
 * terminal-state gate.
 */

import * as t from '@babel/types';
import { globSync } from 'glob';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { fsOperationForCall, parseCopilotFsSource, walkAst } from './lib/copilot-fs-ast.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_ROOT = 'src/copilot';
const SOURCE_GLOB = `${SOURCE_ROOT}/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}`;
const BASELINE_PATH = path.join(ROOT, 'config', 'architecture', 'copilot-fs-read-boundaries.json');
const LOW_LEVEL_ROOT = 'src/copilot/infra/filesystem/';
const READ_OPERATIONS = new Set([
    'readFile',
    'readFileSync',
    'read',
    'readSync',
    'createReadStream',
    'readdir',
    'readdirSync',
    'opendir',
    'opendirSync',
    'stat',
    'statSync',
    'lstat',
    'lstatSync',
    'fstat',
    'fstatSync',
    'access',
    'accessSync',
    'existsSync',
    'readlink',
    'readlinkSync',
    'realpath',
    'realpathSync',
    'watch',
    'watchFile',
]);
const OPEN_FUNCTIONS = new Set(['open', 'openSync']);
const BASELINE_CLASSIFICATIONS = new Set([
    'transitional-debt',
    'system-probe',
    'bootstrap-boundary',
    'adapter-boundary',
    'low-level-exception',
]);

/** @typedef {{ file: string; operation: string; line: number; column: number; lowLevelAllowed: boolean }} FsReadSite */
/** @typedef {{ file: string; classification: string; operations: Record<string, number> }} FsReadBaselineEntry */

/** @param {t.CallExpression} call */
function openUsesReadOnlyFlags(call) {
    const flags = call.arguments[1];
    if (flags === undefined) return true;
    if (t.isStringLiteral(flags)) return !/[wa+]/u.test(flags.value);
    // Numeric/computed flags are treated as mutating by the mutation guard because they can carry write bits.
    return false;
}

/**
 * @param {string} source
 * @param {string} filePath workspace-relative path
 * @returns {{ sites: FsReadSite[]; parseErrors: string[] }}
 */
export function analyzeCopilotFsReadSource(source, filePath) {
    const { ast, normalizedFile, directBindings, namespaceBindings, parseErrors } = parseCopilotFsSource(
        source,
        filePath,
    );
    /** @type {FsReadSite[]} */
    const sites = [];
    walkAst(ast.program, (node) => {
        if (!t.isCallExpression(node)) return;
        const operation = fsOperationForCall(node, directBindings, namespaceBindings);
        if (!operation) return;
        let normalizedOperation = operation;
        if (OPEN_FUNCTIONS.has(operation)) {
            if (!openUsesReadOnlyFlags(node)) return;
            normalizedOperation = `${operation}:read`;
        } else if (!READ_OPERATIONS.has(operation)) {
            return;
        }
        sites.push({
            file: normalizedFile,
            operation: normalizedOperation,
            line: node.loc?.start.line ?? 0,
            column: node.loc?.start.column ?? 0,
            lowLevelAllowed: normalizedFile.startsWith(LOW_LEVEL_ROOT),
        });
    });
    return { sites, parseErrors };
}

/** @param {FsReadSite[]} sites */
function aggregateApplicationSites(sites) {
    /** @type {Map<string, Map<string, number>>} */
    const byFile = new Map();
    for (const site of sites) {
        if (site.lowLevelAllowed) continue;
        let operations = byFile.get(site.file);
        if (!operations) {
            operations = new Map();
            byFile.set(site.file, operations);
        }
        operations.set(site.operation, (operations.get(site.operation) ?? 0) + 1);
    }
    return new Map(
        [...byFile.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([file, operations]) => [
                file,
                Object.fromEntries([...operations.entries()].sort(([left], [right]) => left.localeCompare(right))),
            ]),
    );
}

/**
 * Reduce the baseline monotonically while preserving the explicit architectural classification of surviving entries. A
 * genuinely new direct-read file is emitted as transitional debt and therefore fails `--strict-debt` until a human
 * either removes the read or explicitly classifies the boundary.
 *
 * @param {Map<string, Record<string, number>>} aggregate
 * @param {{ entries: FsReadBaselineEntry[] } | null} [previousBaseline]
 */
function buildBaseline(aggregate, previousBaseline = readBaseline()) {
    const previousClassifications = new Map(
        (previousBaseline?.entries ?? []).map((entry) => [entry.file, entry.classification]),
    );
    return {
        schemaVersion: 1,
        policy: 'copilot-direct-fs-read-debt-exact-counts',
        generatedAt: new Date().toISOString(),
        lowLevelRoot: LOW_LEVEL_ROOT,
        entries: [...aggregate.entries()].map(([file, operations]) => ({
            file,
            classification: previousClassifications.get(file) ?? 'transitional-debt',
            operations,
        })),
        description:
            'Exact non-growth baseline for direct node:fs reads outside src/copilot/infra/filesystem. Transitional debt must monotonically shrink; classified exceptions require explicit architectural justification.',
    };
}

function readBaseline() {
    try {
        const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) return null;
        return /** @type {{ schemaVersion?: unknown; entries: FsReadBaselineEntry[] }} */ (parsed);
    } catch {
        return null;
    }
}

/** @param {Record<string, number>} left @param {Record<string, number>} right */
function sameOperationCounts(left, right) {
    const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
    const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

/** @param {Map<string, Record<string, number>>} actual @param {{ entries: FsReadBaselineEntry[] } | null} baseline */
function compareBaseline(actual, baseline) {
    const issues = [];
    if (!baseline) return { issues: ['read-boundary-baseline-missing-or-invalid'], debtSites: 0, classifiedFiles: 0 };
    /** @type {Map<string, FsReadBaselineEntry>} */
    const expected = new Map();
    let debtSites = 0;
    for (const entry of baseline.entries) {
        if (!entry || typeof entry.file !== 'string' || typeof entry.classification !== 'string' || !entry.operations) {
            issues.push('invalid-baseline-entry');
            continue;
        }
        if (expected.has(entry.file)) issues.push(`duplicate-baseline-file:${entry.file}`);
        expected.set(entry.file, entry);
        if (!BASELINE_CLASSIFICATIONS.has(entry.classification)) {
            issues.push(`invalid-baseline-classification:${entry.file}:${entry.classification}`);
        }
        if (entry.classification === 'transitional-debt') {
            debtSites += Object.values(entry.operations).reduce((sum, count) => sum + Number(count || 0), 0);
        }
    }
    for (const [file, operations] of actual) {
        const entry = expected.get(file);
        if (!entry) {
            issues.push(`unclassified-direct-read:${file}:${JSON.stringify(operations)}`);
            continue;
        }
        if (!sameOperationCounts(operations, entry.operations)) {
            issues.push(
                `direct-read-count-drift:${file}:expected=${JSON.stringify(entry.operations)}:actual=${JSON.stringify(operations)}`,
            );
        }
    }
    for (const [file, entry] of expected) {
        if (!actual.has(file)) issues.push(`stale-read-baseline-entry:${file}:${JSON.stringify(entry.operations)}`);
    }
    return { issues, debtSites, classifiedFiles: expected.size };
}

async function collectReadInventory() {
    const files = globSync(SOURCE_GLOB, {
        cwd: ROOT,
        nodir: true,
        absolute: false,
        ignore: ['**/.ai/**', '**/node_modules/**', '**/dist/**', '**/build/**'],
    }).sort((left, right) => left.localeCompare(right));
    /** @type {FsReadSite[]} */
    const sites = [];
    /** @type {{ file: string; error: string }[]} */
    const parseErrors = [];
    const { readFile } = await import('node:fs/promises');
    for (const file of files) {
        const source = await readFile(path.join(ROOT, file), 'utf8');
        const result = analyzeCopilotFsReadSource(source, file);
        sites.push(...result.sites);
        for (const error of result.parseErrors) parseErrors.push({ file, error });
    }
    return { files, sites, parseErrors, aggregate: aggregateApplicationSites(sites) };
}

/** @param {{ strictDebt?: boolean }} [options] */
export async function checkCopilotFsReadBoundaries(options = {}) {
    const inventory = await collectReadInventory();
    const baseline = readBaseline();
    const comparison = compareBaseline(inventory.aggregate, baseline);
    const lowLevelSites = inventory.sites.filter((site) => site.lowLevelAllowed).length;
    const applicationSites = inventory.sites.length - lowLevelSites;
    const issues = [
        ...inventory.parseErrors.map((item) => `parse:${item.file}:${item.error}`),
        ...comparison.issues,
        ...(options.strictDebt && comparison.debtSites > 0 ? [`transitional-read-debt:${comparison.debtSites}`] : []),
    ];
    return {
        schemaVersion: 1,
        ok: issues.length === 0,
        scannedFiles: inventory.files.length,
        totalDirectReadSites: inventory.sites.length,
        lowLevelSites,
        applicationSites,
        classifiedFiles: comparison.classifiedFiles,
        transitionalDebtSites: comparison.debtSites,
        issues,
    };
}

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) {
    const { values } = parseArgs({
        options: {
            json: { type: 'boolean', default: false },
            'emit-baseline': { type: 'boolean', default: false },
            'strict-debt': { type: 'boolean', default: false },
        },
    });
    if (values['emit-baseline']) {
        const inventory = await collectReadInventory();
        if (inventory.parseErrors.length > 0) {
            for (const item of inventory.parseErrors) console.error(`parse ${item.file}: ${item.error}`);
            process.exitCode = 2;
        } else {
            console.log(JSON.stringify(buildBaseline(inventory.aggregate), null, 2));
        }
    } else {
        const report = await checkCopilotFsReadBoundaries({ strictDebt: Boolean(values['strict-debt']) });
        if (values.json) console.log(JSON.stringify(report, null, 2));
        else {
            console.log(`Copilot filesystem read boundary: ${report.ok ? 'OK' : 'FAIL'}`);
            console.log(`- scanned source files: ${report.scannedFiles}`);
            console.log(
                `- direct read sites: total=${report.totalDirectReadSites}, low-level=${report.lowLevelSites}, application=${report.applicationSites}`,
            );
            console.log(`- classified application files: ${report.classifiedFiles}`);
            console.log(`- transitional debt sites: ${report.transitionalDebtSites}`);
            for (const issue of report.issues) console.log(`- issue: ${issue}`);
        }
        if (!report.ok) process.exitCode = 1;
    }
}
