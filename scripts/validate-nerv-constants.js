#!/usr/bin/env node
// @ts-check
/**
 * @file Valida cobertura e uso de todos os enums exportados por src/shared/nerv/constants.js em relação ao código src/.
 *
 *   Flags: --enum=NAME Analisa apenas o enum informado --all Analisa todos os enums (comportamento padrão) --strict Falha
 *   se houver constantes não utilizadas --json Saída JSON
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const STRICT = process.argv.includes('--strict');
const JSON_OUTPUT = process.argv.includes('--json');
const targetEnum = process.argv.find((a) => a.startsWith('--enum='))?.split('=')[1];
const ROOT = path.join(import.meta.dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');

// Import constants module
const constantsPath = path.join(ROOT, 'src', 'shared', 'nerv', 'constants.js');
const constants = await import(pathToFileURL(path.resolve(constantsPath)).href).then((m) => m.default ?? m);

/** Nomes dos enums exportados pelo módulo de constantes NERV. */
const ALL_ENUMS = [
    'MessageType',
    'ActionCode',
    'ActorRole',
    'ChannelState',
    'TechnicalCode',
    'OrchestrationAction',
    'TaskControlCommand',
];

/**
 * @param {string} enumName
 * @returns {string[]}
 */
function getEnumKeys(enumName) {
    const obj = constants[enumName];
    if (!obj || typeof obj !== 'object') return [];
    return Object.keys(obj).sort();
}

/**
 * @param {string} enumName
 * @param {string[]} keys
 * @returns {Promise<{ key: string; files: string[] }[]>}
 */
async function findUsedKeys(enumName, keys) {
    const result = [];
    for (const key of keys) {
        const pattern = `${enumName}\\.${key}\\b`;
        try {
            const { stdout } = await execFileAsync('rg', [
                '--glob',
                '*.js',
                '--glob',
                '*.mjs',
                '--glob',
                '*.ts',
                '-l',
                pattern,
                SRC_DIR,
            ]);
            const files = stdout
                .split('\n')
                .filter(Boolean)
                .map((f) => path.relative(ROOT, f));
            result.push({ key, files });
        } catch {
            result.push({ key, files: [] });
        }
    }
    return result;
}

/**
 * @param {string} enumName
 * @returns {Promise<{
 *     enumName: string;
 *     error?: string;
 *     defined: string[];
 *     usedKeys: string[];
 *     unusedKeys: string[];
 *     coverage: number;
 *     usageDetail?: { key: string; files: string[] }[];
 * }>}
 */
async function analyzeEnum(enumName) {
    const defined = getEnumKeys(enumName);
    if (defined.length === 0) {
        return {
            enumName,
            error: `Enum "${enumName}" não encontrado.`,
            defined: [],
            usedKeys: [],
            unusedKeys: [],
            coverage: 0,
        };
    }
    const usageMap = await findUsedKeys(enumName, defined);
    const usedKeys = usageMap.filter((u) => u.files.length > 0).map((u) => u.key);
    const unusedKeys = defined.filter((k) => !usedKeys.includes(k));
    return {
        enumName,
        defined,
        usedKeys,
        unusedKeys,
        coverage: defined.length === 0 ? 100 : Math.round((usedKeys.length / defined.length) * 100),
        usageDetail: usageMap.filter((u) => u.files.length > 0),
    };
}

/**
 * @param {{
 *     enumName: string;
 *     error?: string;
 *     defined: string[];
 *     usedKeys: string[];
 *     unusedKeys: string[];
 *     coverage: number;
 * }} report
 * @returns {void}
 */
function printEnumReport(report) {
    if (report.error) {
        console.log(`  ⚠️  ${report.enumName}: ${report.error}`);
        return;
    }
    const { enumName, defined, usedKeys, unusedKeys, coverage } = report;
    const icon = coverage === 100 ? '✅' : coverage >= 60 ? '🟡' : '🔴';
    console.log(`\n${icon} ${enumName}: ${usedKeys.length}/${defined.length} usados (${coverage}% cobertura)`);
    if (unusedKeys.length > 0) {
        console.log(`   ⚠️  Não utilizados (${unusedKeys.length}):`);
        unusedKeys.forEach((k) => console.log(`      - ${k}`));
    }
}

const enumsToCheck = targetEnum ? [targetEnum] : ALL_ENUMS;
const reports = await Promise.all(enumsToCheck.map(analyzeEnum));

if (JSON_OUTPUT) {
    const summary = {
        timestamp: new Date().toISOString(),
        enums: reports.map(({ enumName, defined = [], usedKeys = [], unusedKeys = [], coverage = 0 }) => ({
            enumName,
            defined: defined.length,
            used: usedKeys.length,
            unused: unusedKeys.length,
            coverage: `${coverage}%`,
        })),
        detail: reports,
    };
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
}

console.log('\n=== ANÁLISE DE CONSTANTES NERV ===\n');
console.log(`📁 Escopo: src/`);
console.log(`🔎 Enums: ${enumsToCheck.join(', ')}\n`);
console.log('─'.repeat(60));

let hasProblems = false;
for (const report of reports) {
    printEnumReport(report);
    if (report.unusedKeys?.length > 0 && STRICT) hasProblems = true;
}

console.log('\n' + '─'.repeat(60));
const totalDefined = reports.reduce((s, r) => s + (r.defined?.length ?? 0), 0);
const totalUsed = reports.reduce((s, r) => s + (r.usedKeys?.length ?? 0), 0);
const totalUnused = reports.reduce((s, r) => s + (r.unusedKeys?.length ?? 0), 0);
const globalCoverage = totalDefined === 0 ? 100 : Math.round((totalUsed / totalDefined) * 100);

console.log(`\n📊 RESUMO GLOBAL:`);
console.log(`   Constantes definidas : ${totalDefined}`);
console.log(`   Constantes usadas    : ${totalUsed}`);
console.log(`   Não utilizadas       : ${totalUnused}`);
console.log(`   Cobertura global     : ${globalCoverage}%\n`);

if (totalUnused > 0) {
    console.log('💡 Constantes não utilizadas podem ser para uso futuro ou candidatas a remoção.');
    console.log('   Execute com --strict para falhar neste caso.\n');
}

if (hasProblems) {
    console.log('🔴 MODO STRICT: Constantes não utilizadas detectadas.\n');
    process.exit(1);
} else {
    console.log('🟢 Validação concluída sem bloqueadores.\n');
    process.exit(0);
}
