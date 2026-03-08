#!/usr/bin/env node
// @ts-check
/**
 * @fileoverview Catálogo de constantes do projeto.
 *
 * Escaneia todos os módulos de constantes em src/ e reporta:
 *   - Quais constantes são definidas por módulo
 *   - Em quantos arquivos cada constante é utilizada
 *   - Constantes nunca utilizadas (candidatas a remoção)
 *   - Módulos importados por arquivo
 *
 * Flags:
 *   --json            Saída JSON
 *   --unused-only     Mostra apenas constantes nunca usadas
 *   --module=NAME     Filtra por módulo (ex: --module=nerv)
 *   --min-usage=N     Filtra constantes com menos de N utilizações
 *
 * @example
 *   node scripts/analysis/catalog-constants.mjs
 *   node scripts/analysis/catalog-constants.mjs --json > constants-catalog.json
 *   node scripts/analysis/catalog-constants.mjs --unused-only
 *   node scripts/analysis/catalog-constants.mjs --module=nerv
 */

import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);

// ── Argumentos ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const JSON_OUTPUT = args.includes('--json');
const UNUSED_ONLY = args.includes('--unused-only');
const MODULE_FILTER = args.find((a) => a.startsWith('--module='))?.split('=')[1];
const MIN_USAGE = parseInt(args.find((a) => a.startsWith('--min-usage='))?.split('=')[1] ?? '0', 10);

const ROOT = path.join(import.meta.dirname, '..', '..');
const SRC_DIR = path.join(ROOT, 'src');

// ── Módulos de constantes catalogados ────────────────────────────────────────

/** @type {{ name: string; path: string; alias: string }[]} */
const CONSTANT_MODULES = [
    {
        name: 'nerv',
        path: path.join(SRC_DIR, 'shared', 'nerv', 'constants.js'),
        alias: '#shared/nerv/constants',
    },
    {
        name: 'core/browser',
        path: path.join(SRC_DIR, 'core', 'constants', 'browser.ts'),
        alias: '#core/constants/browser',
    },
    {
        name: 'core/logging',
        path: path.join(SRC_DIR, 'core', 'constants', 'logging.ts'),
        alias: '#core/constants/logging',
    },
    {
        name: 'core/shared',
        path: path.join(SRC_DIR, 'core', 'constants', 'shared.ts'),
        alias: '#core/constants/shared',
    },
    {
        name: 'core/tasks',
        path: path.join(SRC_DIR, 'core', 'constants', 'tasks.ts'),
        alias: '#core/constants/tasks',
    },
    {
        name: 'core/index',
        path: path.join(SRC_DIR, 'core', 'constants', 'index.ts'),
        alias: '#core/constants',
    },
];

// ── Funções auxiliares ────────────────────────────────────────────────────────

/**
 * Importa um módulo de constantes e retorna um mapa de nome do grupo → chaves.
 *
 * @param {string} modulePath
 * @returns {Promise<Record<string, string[]>>}
 */
async function loadConstantGroups(modulePath) {
    try {
        const mod = await import(pathToFileURL(path.resolve(modulePath)).href).then((m) => m.default ?? m);
        /** @type {Record<string, string[]>} */
        const groups = {};
        for (const [key, value] of Object.entries(mod)) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                // Objeto frozen — assume enum/group
                groups[key] = Object.keys(/** @type {object} */ (value)).sort();
            } else if (typeof value === 'string' || typeof value === 'number') {
                // Constante escalar — agrupa em _scalars
                if (!groups['_scalars']) groups['_scalars'] = [];
                groups['_scalars'].push(key);
            }
        }
        return groups;
    } catch {
        return {};
    }
}

/**
 * Usa `rg` para contar quantos arquivos de src/ usam um símbolo.
 *
 * @param {string} symbol - Nome do símbolo a buscar (ex: "ActionCode.DONE" ou "BROWSER_TIMEOUT")
 * @returns {Promise<string[]>} Lista de arquivos onde o símbolo aparece
 */
async function findSymbolUsage(symbol) {
    const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
        const { stdout } = await execFileAsync('rg', [
            '--glob', '*.js',
            '--glob', '*.mjs',
            '--glob', '*.ts',
            '-l',
            escapedSymbol,
            SRC_DIR,
        ]);
        return stdout.split('\n').filter(Boolean).map((f) => path.relative(ROOT, f));
    } catch {
        return [];
    }
}

/**
 * Retorna o número de arquivos .js/.mjs/.ts em src/ que importam um alias.
 *
 * @param {string} alias - Ex: "#shared/nerv/constants"
 * @returns {Promise<number>}
 */
async function countImporters(alias) {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
        const { stdout } = await execFileAsync('rg', [
            '--glob', '*.js',
            '--glob', '*.mjs',
            '--glob', '*.ts',
            '-l',
            escapedAlias,
            SRC_DIR,
        ]);
        return stdout.split('\n').filter(Boolean).length;
    } catch {
        return 0;
    }
}

// ── Execução principal ────────────────────────────────────────────────────────

/**
 * @typedef {{ key: string; group: string; files: string[]; usageCount: number }} ConstantEntry
 * @typedef {{ module: string; alias: string; importers: number; groups: Record<string, ConstantEntry[]>; totalDefined: number; totalUsed: number; totalUnused: number }} ModuleReport
 */

const modulesToProcess = MODULE_FILTER
    ? CONSTANT_MODULES.filter((m) => m.name.includes(MODULE_FILTER))
    : CONSTANT_MODULES;

if (!JSON_OUTPUT) {
    console.log('\n🗂️  CATÁLOGO DE CONSTANTES DO PROJETO\n');
    console.log('═'.repeat(70));
    console.log(`📁 Escopo: ${SRC_DIR}`);
    console.log(`📦 Módulos: ${modulesToProcess.map((m) => m.name).join(', ')}\n`);
}

/** @type {ModuleReport[]} */
const allReports = [];

for (const mod of modulesToProcess) {
    const groups = await loadConstantGroups(mod.path);
    const importers = await countImporters(mod.alias);

    /** @type {Record<string, ConstantEntry[]>} */
    const groupReports = {};
    let totalDefined = 0;
    let totalUsed = 0;

    for (const [groupName, keys] of Object.entries(groups)) {
        /** @type {ConstantEntry[]} */
        const entries = [];

        for (const key of keys) {
            // Build search pattern — for enum members: "GroupName.KEY"
            const searchSymbol = groupName === '_scalars' ? key : `${groupName}.${key}`;
            const files = await findSymbolUsage(searchSymbol);
            const entry = { key, group: groupName, files, usageCount: files.length };

            if (!UNUSED_ONLY || files.length === 0) {
                if (files.length >= MIN_USAGE) {
                    entries.push(entry);
                }
            }

            totalDefined++;
            if (files.length > 0) totalUsed++;
        }

        if (entries.length > 0) {
            groupReports[groupName] = entries.sort((a, b) => b.usageCount - a.usageCount);
        }
    }

    const totalUnused = totalDefined - totalUsed;
    const report = { module: mod.name, alias: mod.alias, importers, groups: groupReports, totalDefined, totalUsed, totalUnused };
    allReports.push(report);
}

if (JSON_OUTPUT) {
    const output = {
        timestamp: new Date().toISOString(),
        totalModules: allReports.length,
        summary: allReports.map(({ module, alias, importers, totalDefined, totalUsed, totalUnused }) => ({
            module, alias, importers, totalDefined, totalUsed, totalUnused,
            coverage: totalDefined === 0 ? '100%' : `${Math.round((totalUsed / totalDefined) * 100)}%`,
        })),
        modules: allReports,
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(0);
}

// ── Saída legível ─────────────────────────────────────────────────────────────

for (const report of allReports) {
    const { module, alias, importers, groups, totalDefined, totalUsed, totalUnused } = report;
    const coverage = totalDefined === 0 ? 100 : Math.round((totalUsed / totalDefined) * 100);
    const icon = coverage === 100 ? '✅' : coverage >= 60 ? '🟡' : '🔴';

    console.log(`\n${icon} ${module} (${alias})`);
    console.log(`   Importado por: ${importers} arquivo(s) | ${totalUsed}/${totalDefined} usados (${coverage}% cobertura)`);

    for (const [groupName, entries] of Object.entries(groups)) {
        if (groupName === '_scalars') {
            console.log(`\n   📌 Constantes escalares:`);
        } else {
            const groupUsed = entries.filter((e) => e.usageCount > 0).length;
            const groupTotal = entries.length;
            console.log(`\n   📋 ${groupName} (${groupUsed}/${groupTotal}):`);
        }

        for (const entry of entries) {
            const usageLabel = entry.usageCount === 0
                ? '⚠️  UNUSED'
                : `${entry.usageCount} arquivo(s)`;
            console.log(`      ${entry.key.padEnd(30)} ${usageLabel}`);
        }
    }

    if (totalUnused > 0) {
        console.log(`\n   💡 ${totalUnused} constante(s) não utilizadas em src/`);
    }
}

// ── Resumo global ─────────────────────────────────────────────────────────────

const globalDefined = allReports.reduce((s, r) => s + r.totalDefined, 0);
const globalUsed = allReports.reduce((s, r) => s + r.totalUsed, 0);
const globalUnused = allReports.reduce((s, r) => s + r.totalUnused, 0);
const globalCoverage = globalDefined === 0 ? 100 : Math.round((globalUsed / globalDefined) * 100);

console.log('\n' + '═'.repeat(70));
console.log('\n📊 RESUMO GLOBAL:');
console.log(`   Módulos catalogados  : ${allReports.length}`);
console.log(`   Constantes definidas : ${globalDefined}`);
console.log(`   Constantes usadas    : ${globalUsed}`);
console.log(`   Não utilizadas       : ${globalUnused}`);
console.log(`   Cobertura global     : ${globalCoverage}%`);

if (globalUnused > 0) {
    console.log(`\n💡 Use --unused-only para ver apenas as não utilizadas.`);
    console.log(`   Use --json para exportar o catálogo completo em JSON.\n`);
}

process.exit(0);
