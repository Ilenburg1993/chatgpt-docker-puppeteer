#!/usr/bin/env node
// @ts-check
/**
 * scripts/check-file-size.mjs
 *
 * Verifica que nenhum arquivo de src/copilot excede o limite de LoC definido em PARTE-20E (C5).
 *
 * Limites:
 *
 * - 300 LoC: warning
 * - 400 LoC: error (exceto types.js e barrels index.js)
 *
 * @module scripts/check-file-size
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const COPILOT_ROOT = 'src/copilot';
const WARN_LIMIT = 300;
const ERROR_LIMIT = 400;

/** Arquivos isentos do limite hard (tipos e barrels). */
const EXEMPT_NAMES = new Set(['types.js', 'index.js']);

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walkJs(dir) {
    /** @type {string[]} */
    const results = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            if (entry === 'node_modules' || entry === 'logs') continue;
            results.push(...walkJs(full));
        } else if (entry.endsWith('.js')) {
            results.push(full);
        }
    }
    return results;
}

/**
 * Conta linhas não-vazias e não-comentário de um arquivo.
 *
 * @param {string} filePath
 * @returns {number}
 */
function countLoC(filePath) {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    let count = 0;
    let inBlockComment = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (inBlockComment) {
            if (trimmed.includes('*/')) inBlockComment = false;
            continue;
        }
        if (trimmed.startsWith('/*')) {
            if (!trimmed.includes('*/')) inBlockComment = true;
            continue;
        }
        if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        count++;
    }
    return count;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/** @type {{ file: string; loc: number; severity: 'warn' | 'error' }[]} */
const issues = [];

const allFiles = walkJs(COPILOT_ROOT);

for (const file of allFiles) {
    const loc = countLoC(file);
    const name = basename(file);
    const isExempt = EXEMPT_NAMES.has(name);

    if (loc > ERROR_LIMIT && !isExempt) {
        issues.push({ file: relative('.', file), loc, severity: 'error' });
    } else if (loc > WARN_LIMIT) {
        issues.push({ file: relative('.', file), loc, severity: 'warn' });
    }
}

// Ordena por LoC descendente
issues.sort((a, b) => b.loc - a.loc);

// ─── Output ───────────────────────────────────────────────────────────────────

const errors = issues.filter((i) => i.severity === 'error');
const warnings = issues.filter((i) => i.severity === 'warn');

if (issues.length === 0) {
    console.log('✅ Todos os arquivos dentro dos limites de LoC.');
    process.exit(0);
}

if (errors.length > 0) {
    console.error(`❌ ${errors.length} arquivo(s) excedem ${ERROR_LIMIT} LoC (limit hard):\n`);
    for (const i of errors) {
        console.error(`  ${i.file}: ${i.loc} LoC`);
    }
    console.error('');
}

if (warnings.length > 0) {
    console.warn(`⚠️  ${warnings.length} arquivo(s) entre ${WARN_LIMIT}-${ERROR_LIMIT} LoC (warning):\n`);
    for (const i of warnings) {
        console.warn(`  ${i.file}: ${i.loc} LoC`);
    }
    console.warn('');
}

// Exit code: 1 se houver errors, 0 se só warnings
process.exit(errors.length > 0 ? 1 : 0);
