#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
    options: {
        format: { type: 'string', default: 'console' },
    },
});

const schemaPath = path.resolve('schemas/typing/tsserver-tool-contract.schema.json');
const daemonPath = path.resolve('src/integration/lsp/tsserver-daemon.mjs');
const skillPath = path.resolve('.github/skills/lsp-ops/SKILL.md');
const typescriptDtsPath = path.resolve('node_modules/typescript/lib/typescript.d.ts');

/**
 * @param {string[]} valuesToSort
 * @returns {string[]}
 */
function sorted(valuesToSort) {
    return [...valuesToSort].sort((left, right) => left.localeCompare(right));
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractOperationsFromDaemon(text) {
    return sorted(
        Array.from(
            new Set(
                Array.from(text.matchAll(/case '([A-Za-z_]+)':/g))
                    .map(match => match[1] ?? '')
                    .filter(Boolean)
            )
        )
    );
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractOperationsFromSkill(text) {
    return sorted(
        Array.from(
            new Set(
                Array.from(text.matchAll(/^- `([A-Za-z_]+)`:/gm))
                    .map(match => match[1] ?? '')
                    .filter(Boolean)
            )
        )
    );
}

/**
 * @param {string[]} left
 * @param {string[]} right
 * @returns {string[]}
 */
function diff(left, right) {
    const rightSet = new Set(right);
    return left.filter(item => !rightSet.has(item));
}

const issues = [];

if (!fs.existsSync(schemaPath)) issues.push(`Missing schema: ${schemaPath}`);
if (!fs.existsSync(daemonPath)) issues.push(`Missing daemon: ${daemonPath}`);
if (!fs.existsSync(skillPath)) issues.push(`Missing skill: ${skillPath}`);
if (!fs.existsSync(typescriptDtsPath)) issues.push(`Missing TypeScript declarations: ${typescriptDtsPath}`);

/** @type {string[]} */
let schemaOperations = [];
/** @type {string[]} */
let daemonOperations = [];
/** @type {string[]} */
let skillOperations = [];

if (issues.length === 0) {
    const schema = /** @type {unknown} */ (JSON.parse(fs.readFileSync(schemaPath, 'utf8')));
    const daemonText = fs.readFileSync(daemonPath, 'utf8');
    const skillText = fs.readFileSync(skillPath, 'utf8');
    const typescriptDts = fs.readFileSync(typescriptDtsPath, 'utf8');

    if (!typescriptDts.includes('namespace protocol') || !typescriptDts.includes('CommandTypes')) {
        issues.push('Local TypeScript declaration bundle does not expose ts.server.protocol / CommandTypes.');
    }

    if (!isRecord(schema)) {
        issues.push('tsserver schema must be a JSON object.');
    } else {
        if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
            issues.push('tsserver schema must use JSON Schema Draft 2020-12.');
        }
        const properties = isRecord(schema.properties) ? schema.properties : null;
        const xToolContract = isRecord(schema['x-tool-contract']) ? schema['x-tool-contract'] : null;
        const operations = xToolContract && isRecord(xToolContract.operations) ? xToolContract.operations : null;
        if (!properties || !operations) {
            issues.push('tsserver schema must expose properties and x-tool-contract.operations.');
        } else {
            schemaOperations = sorted(Object.keys(operations));
            const operationProperty = isRecord(properties.operation) ? properties.operation : null;
            const enumValues = Array.isArray(operationProperty?.enum)
                ? operationProperty.enum.filter(item => typeof item === 'string')
                : [];
            const sortedEnumValues = sorted(/** @type {string[]} */ (enumValues));
            if (JSON.stringify(schemaOperations) !== JSON.stringify(sortedEnumValues)) {
                issues.push('tsserver schema operation enum must match x-tool-contract.operations.');
            }
        }
    }

    daemonOperations = extractOperationsFromDaemon(daemonText);
    skillOperations = extractOperationsFromSkill(skillText);

    const missingFromSchema = diff(daemonOperations, schemaOperations);
    const missingFromDaemon = diff(schemaOperations, daemonOperations);
    const missingFromSkill = diff(daemonOperations, skillOperations);
    const staleInSkill = diff(skillOperations, daemonOperations);

    if (missingFromSchema.length > 0) {
        issues.push(`Operations missing from schema: ${missingFromSchema.join(', ')}`);
    }
    if (missingFromDaemon.length > 0) {
        issues.push(`Schema declares operations not found in daemon: ${missingFromDaemon.join(', ')}`);
    }
    if (missingFromSkill.length > 0) {
        issues.push(`Operations missing from .github/skills/lsp-ops/SKILL.md: ${missingFromSkill.join(', ')}`);
    }
    if (staleInSkill.length > 0) {
        issues.push(`Skill documents stale operations: ${staleInSkill.join(', ')}`);
    }
}

const report = {
    schema_path: path.relative(process.cwd(), schemaPath).replace(/\\/g, '/'),
    daemon_path: path.relative(process.cwd(), daemonPath).replace(/\\/g, '/'),
    skill_path: path.relative(process.cwd(), skillPath).replace(/\\/g, '/'),
    schema_operations: schemaOperations,
    daemon_operations: daemonOperations,
    skill_operations: skillOperations,
    passes: issues.length === 0,
    issues,
};

if (String(values.format || 'console').toLowerCase() === 'json') {
    console.log(JSON.stringify(report, null, 2));
} else {
    console.log('='.repeat(80));
    console.log('TSSERVER CONTRACT AUDIT');
    console.log('='.repeat(80));
    console.log(`schema operations: ${schemaOperations.join(', ')}`);
    console.log(`daemon operations: ${daemonOperations.join(', ')}`);
    console.log(`skill operations: ${skillOperations.join(', ')}`);
    if (issues.length > 0) {
        console.log('');
        for (const issue of issues) {
            console.error(`- ${issue}`);
        }
    }
}

if (issues.length > 0) {
    process.exit(1);
}
