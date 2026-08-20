#!/usr/bin/env node
// @ts-check
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { parse, printParseErrorCode } from 'jsonc-parser';
import {
    VSCODE_DEVCONTAINER_EXTENSIONS,
    VSCODE_HOST_ONLY_EXTENSIONS,
    VSCODE_OPTIONAL_EXTENSIONS,
    VSCODE_UNWANTED_EXTENSIONS,
} from '../config/vscode/extensions.mjs';

const strictRuntime = process.argv.includes('--strict-runtime');

/** @param {string} file */
function readJsonc(file) {
    const text = fs.readFileSync(file, 'utf8');
    /** @type {import('jsonc-parser').ParseError[]} */
    const errors = [];
    const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length) {
        throw new Error(
            `${file}: JSONC inválido (${errors.map((entry) => `${printParseErrorCode(entry.error)}@${entry.offset}`).join(', ')})`,
        );
    }
    return value;
}

/** @param {string[]} actual @param {readonly string[]} expected */
function setDiff(actual, expected) {
    const expectedSet = new Set(expected.map((value) => value.toLowerCase()));
    const actualSet = new Set(actual.map((value) => value.toLowerCase()));
    return {
        missing: expected.filter((value) => !actualSet.has(value.toLowerCase())),
        extra: actual.filter((value) => !expectedSet.has(value.toLowerCase())),
    };
}

/** @returns {string[] | null} */
function readInstalledExtensions() {
    try {
        const output = execFileSync('code', ['--list-extensions'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    } catch {
        return null;
    }
}

const devcontainer = readJsonc('.devcontainer/devcontainer.json');
const recommendations = readJsonc('.vscode/extensions.json');
const configured = /** @type {string[]} */ (devcontainer?.customizations?.vscode?.extensions ?? []);
const recommended = /** @type {string[]} */ (recommendations?.recommendations ?? []);
const unwanted = /** @type {string[]} */ (recommendations?.unwantedRecommendations ?? []);

const projectionChecks = [
    ['DevContainer auto-install', setDiff(configured, VSCODE_DEVCONTAINER_EXTENSIONS)],
    ['Workspace recommendations', setDiff(recommended, VSCODE_DEVCONTAINER_EXTENSIONS)],
    ['Workspace unwanted', setDiff(unwanted, VSCODE_UNWANTED_EXTENSIONS)],
];
let failed = false;
for (const [label, diff] of projectionChecks) {
    const typedDiff = /** @type {{missing: string[]; extra: string[]}} */ (diff);
    if (!typedDiff.missing.length && !typedDiff.extra.length) continue;
    failed = true;
    console.error(`✗ ${label} divergiu do catálogo canônico`);
    if (typedDiff.missing.length) console.error(`  missing: ${typedDiff.missing.join(', ')}`);
    if (typedDiff.extra.length) console.error(`  extra: ${typedDiff.extra.join(', ')}`);
}
if (!failed) console.log(`✓ Configuração sincronizada: ${configured.length} extensões no auto-install.`);

const installed = readInstalledExtensions();
if (installed) {
    const installedLower = new Set(installed.map((value) => value.toLowerCase()));
    const missingCore = VSCODE_DEVCONTAINER_EXTENSIONS.filter((value) => !installedLower.has(value.toLowerCase()));
    const installedUnwanted = VSCODE_UNWANTED_EXTENSIONS.filter((value) => installedLower.has(value.toLowerCase()));
    const installedHostOnly = VSCODE_HOST_ONLY_EXTENSIONS.filter((value) => installedLower.has(value.toLowerCase()));
    console.log(
        `Runtime: ${installed.length} instaladas; ${missingCore.length} core ausentes; ${installedUnwanted.length} unwanted ainda presentes; ${installedHostOnly.length} host-only no remoto.`,
    );
    if (missingCore.length) console.warn(`  core ausentes: ${missingCore.join(', ')}`);
    if (installedUnwanted.length) console.warn(`  unwanted presentes: ${installedUnwanted.join(', ')}`);
    if (installedHostOnly.length) console.warn(`  host-only presentes no remoto: ${installedHostOnly.join(', ')}`);
    if (strictRuntime && (missingCore.length || installedUnwanted.length || installedHostOnly.length)) failed = true;
} else {
    console.warn('Runtime: VS Code CLI indisponível; verificação de instalação foi omitida.');
}

console.log(`Optional on-demand: ${VSCODE_OPTIONAL_EXTENSIONS.length}.`);
process.exit(failed ? 1 : 0);
