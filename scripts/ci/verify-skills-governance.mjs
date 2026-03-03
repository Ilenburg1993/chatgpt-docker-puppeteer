#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';

const strict = process.argv.includes('--strict');

const requiredCanonicalSkills = [
    '.github/skills/jsdoc-authoring',
    '.github/skills/typescript-typing',
    '.github/skills/typing-node24-esm-tsserver',
    '.github/skills/lsp-ops',
    '.github/skills/schema-contract-governance',
];

const requiredReferenceSkills = new Set([
    '.github/skills/typing-node24-esm-tsserver',
    '.github/skills/schema-contract-governance',
]);

const requiredCodexStubs = [
    '.codex/skills/jsdoc-authoring/SKILL.md',
    '.codex/skills/typescript-typing/SKILL.md',
    '.codex/skills/typescript-strict-hardening/SKILL.md',
    '.codex/skills/schema-contract-governance/SKILL.md',
];

/**
 * @param {string} filePath
 * @returns {string[]}
 */
function extractMarkdownLinks(filePath) {
    const text = fs.readFileSync(filePath, 'utf8');
    return Array.from(text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g))
        .map(match => String(match[1] || '').trim())
        .filter(link => link && !link.startsWith('http://') && !link.startsWith('https://') && !link.startsWith('#'));
}

/**
 * @param {string} filePath
 * @param {string[]} issues
 */
function validateLocalLinks(filePath, issues) {
    const dir = path.dirname(filePath);
    for (const link of extractMarkdownLinks(filePath)) {
        const normalized = link.split('#')[0];
        if (!normalized) continue;
        const targetPath = path.resolve(dir, normalized);
        if (!fs.existsSync(targetPath)) {
            issues.push(`Broken local link in ${filePath}: ${link}`);
        }
    }
}

/** @type {string[]} */
const issues = [];

for (const skillDir of requiredCanonicalSkills) {
    const readmePath = path.resolve(skillDir, 'README.md');
    const skillPath = path.resolve(skillDir, 'SKILL.md');
    if (!fs.existsSync(readmePath)) {
        issues.push(`Missing canonical README: ${readmePath}`);
    }
    if (!fs.existsSync(skillPath)) {
        issues.push(`Missing canonical SKILL: ${skillPath}`);
    }
    if (requiredReferenceSkills.has(skillDir) && !fs.existsSync(path.resolve(skillDir, 'references'))) {
        issues.push(`Missing references directory for canonical skill: ${skillDir}`);
    }
    if (fs.existsSync(readmePath)) validateLocalLinks(readmePath, issues);
    if (fs.existsSync(skillPath)) validateLocalLinks(skillPath, issues);
}

for (const stubPath of requiredCodexStubs) {
    const absolutePath = path.resolve(stubPath);
    if (!fs.existsSync(absolutePath)) {
        issues.push(`Missing .codex compatibility stub: ${absolutePath}`);
        continue;
    }
    const text = fs.readFileSync(absolutePath, 'utf8');
    const lineCount = text.split('\n').length;
    if (lineCount > 25) {
        issues.push(`Compatibility stub is too long and should stay minimal: ${stubPath}`);
    }
    if (!text.includes('.github/skills/')) {
        issues.push(`Compatibility stub must redirect to a canonical .github skill: ${stubPath}`);
    }
    validateLocalLinks(absolutePath, issues);
}

if (issues.length > 0) {
    for (const issue of issues) {
        console.error(`[skills] ${issue}`);
    }
    if (strict) {
        process.exit(1);
    }
} else {
    console.log('[skills] governance OK');
}
