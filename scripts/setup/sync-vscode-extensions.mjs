#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import { applyEdits, modify, parse, printParseErrorCode } from 'jsonc-parser';
import {
    VSCODE_DEVCONTAINER_EXTENSIONS,
    VSCODE_RECOMMENDED_EXTENSIONS,
    VSCODE_UNWANTED_EXTENSIONS,
} from '../../config/vscode/extensions.mjs';

const DEVCONTAINER_PATH = '.devcontainer/devcontainer.json';
const RECOMMENDATIONS_PATH = '.vscode/extensions.json';
const write = process.argv.includes('--write');

/** @param {string} text @param {string} file */
function assertJsonc(text, file) {
    /** @type {import('jsonc-parser').ParseError[]} */
    const errors = [];
    parse(text, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length === 0) return;
    const detail = errors.map((entry) => `${printParseErrorCode(entry.error)}@${entry.offset}`).join(', ');
    throw new Error(`${file}: JSONC inválido (${detail})`);
}

function buildRecommendationsJsonc() {
    const body = {
        recommendations: VSCODE_RECOMMENDED_EXTENSIONS,
        unwantedRecommendations: VSCODE_UNWANTED_EXTENSIONS,
    };
    return [
        '// Gerado por scripts/setup/sync-vscode-extensions.mjs.',
        '// Fonte canônica: config/vscode/extensions.mjs. Não edite as listas manualmente.',
        `${JSON.stringify(body, null, 4)}\n`,
    ].join('\n');
}

const originalDevcontainer = fs.readFileSync(DEVCONTAINER_PATH, 'utf8');
assertJsonc(originalDevcontainer, DEVCONTAINER_PATH);
const edits = modify(
    originalDevcontainer,
    ['customizations', 'vscode', 'extensions'],
    VSCODE_DEVCONTAINER_EXTENSIONS,
    { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } },
);
const nextDevcontainer = applyEdits(originalDevcontainer, edits);
assertJsonc(nextDevcontainer, DEVCONTAINER_PATH);

const nextRecommendations = buildRecommendationsJsonc();
assertJsonc(nextRecommendations, RECOMMENDATIONS_PATH);
const currentRecommendations = fs.existsSync(RECOMMENDATIONS_PATH) ? fs.readFileSync(RECOMMENDATIONS_PATH, 'utf8') : '';

const changes = [
    [DEVCONTAINER_PATH, originalDevcontainer !== nextDevcontainer],
    [RECOMMENDATIONS_PATH, currentRecommendations !== nextRecommendations],
].filter(([, changed]) => changed);

if (!write) {
    if (changes.length === 0) {
        console.log('VS Code extension projections are synchronized.');
        process.exit(0);
    }
    console.error(`VS Code extension projection drift: ${changes.map(([file]) => file).join(', ')}`);
    console.error('Run: npm run vscode:sync');
    process.exit(1);
}

if (originalDevcontainer !== nextDevcontainer) fs.writeFileSync(DEVCONTAINER_PATH, nextDevcontainer);
if (currentRecommendations !== nextRecommendations) fs.writeFileSync(RECOMMENDATIONS_PATH, nextRecommendations);
console.log(`VS Code extension projections synchronized (${VSCODE_DEVCONTAINER_EXTENSIONS.length} auto-install extensions).`);
