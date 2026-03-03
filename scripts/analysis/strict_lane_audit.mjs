// @ts-check
/**
 * Auditoria de cobertura de lanes strict (tsconfig.strict.*.json).
 *
 * Emite `strict_uncovered_files_total` e `strict_uncovered_files[]` para todos
 * os arquivos `.js`/`.mjs`/`.ts`/`.vue` elegíveis que não estão cobertos por
 * nenhuma lane strict do repositório.
 *
 * Pode ser importado como módulo ESM ou executado diretamente via CLI.
 *
 * @module strict_lane_audit
 */

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = resolve('.');

/**
 * @typedef {object} LaneAuditResult
 * @property {number} strict_uncovered_files_total - Total de arquivos não cobertos por nenhuma lane strict.
 * @property {string[]} strict_uncovered_files - Lista de caminhos relativos não cobertos.
 * @property {number} lane_count - Número de lanes strict encontradas.
 * @property {string[]} lanes - Caminhos das lanes strict.
 */

/**
 * Lista todos os arquivos elegíveis de código no repositório, excluindo artefatos.
 *
 * @returns {string[]} Caminhos relativos à raiz do projeto.
 */
function listEligibleFiles() {
    try {
        const raw = execSync(
            'fd -e js -e mjs -e cjs -e ts -e tsx -e vue . src scripts tests agents tools' +
                ' --exclude node_modules --exclude dist --exclude coverage --exclude tmp' +
                ' --exclude backups',
            { encoding: 'utf8' }
        );
        return raw
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(f => relative(ROOT, resolve(f)));
    } catch {
        return [];
    }
}

/**
 * Lista todos os arquivos `tsconfig.strict.*.json` na raiz do projeto.
 *
 * @returns {string[]} Caminhos absolutos das lanes strict.
 */
function listStrictLanes() {
    try {
        const raw = execSync('fd -e json "^tsconfig\\.strict\\." . --max-depth 1', {
            encoding: 'utf8',
        });
        return raw.trim().split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

/**
 * Obtém o conjunto de arquivos explicitamente declarados em `files[]` de uma lane strict.
 * Padrões de `include` são resolvidos de forma simplificada (prefixo de diretório).
 *
 * @param {string} laneFile - Caminho para o arquivo tsconfig.strict.*.json.
 * @returns {Set<string>} Caminhos relativos à raiz cobertos pela lane.
 */
function getCoveredFiles(laneFile) {
    /** @type {Set<string>} */
    const covered = new Set();
    try {
        /** @type {Record<string, unknown>} */
        const config = JSON.parse(readFileSync(laneFile, 'utf8'));
        const files = /** @type {string[]} */ (config.files ?? []);
        const includes = /** @type {string[]} */ (config.include ?? []);

        for (const f of files) {
            covered.add(relative(ROOT, resolve(f)));
        }
        // Para `include` com globs, registra o prefixo do padrão como cobertura parcial
        for (const pattern of includes) {
            // Ex.: "src/kernel/**/*" → "src/kernel"
            const prefix = pattern.replace(/\/\*\*.*$/, '').replace(/\/\*.*$/, '');
            covered.add(prefix + '/');
        }
    } catch {
        /* skip configs ilegíveis */
    }
    return covered;
}

/**
 * Verifica se um arquivo relativo está coberto por alguma lane strict.
 *
 * @param {string} file - Caminho relativo do arquivo.
 * @param {Set<string>} coveredPrefixes - Conjunto de prefixos e arquivos cobertos.
 * @returns {boolean}
 */
function isCovered(file, coveredPrefixes) {
    if (coveredPrefixes.has(file)) return true;
    for (const prefix of coveredPrefixes) {
        if (prefix.endsWith('/') && file.startsWith(prefix)) return true;
    }
    return false;
}

/**
 * Executa a auditoria completa de cobertura de lanes strict.
 *
 * @returns {LaneAuditResult}
 */
export function runStrictLaneAudit() {
    const eligibleFiles = listEligibleFiles();
    const lanes = listStrictLanes();

    /** @type {Set<string>} */
    const allCovered = new Set();

    for (const lane of lanes) {
        for (const f of getCoveredFiles(lane)) {
            allCovered.add(f);
        }
    }

    const uncovered = eligibleFiles.filter(f => !isCovered(f, allCovered));

    return {
        strict_uncovered_files_total: uncovered.length,
        strict_uncovered_files: uncovered,
        lane_count: lanes.length,
        lanes: lanes.map(l => relative(ROOT, resolve(l))),
    };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.url.replace('file://', ''));

if (isMain) {
    const result = runStrictLaneAudit();
    const useJson = process.argv.includes('--format=json') || process.argv.includes('--json');

    if (useJson) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.log('\n📊 Strict Lane Audit');
        console.log(`   Lanes encontradas  : ${result.lane_count}`);
        console.log(`   Arquivos não cobertos: ${result.strict_uncovered_files_total}`);
        if (result.strict_uncovered_files_total > 0) {
            console.log('\n   Arquivos sem cobertura strict:');
            for (const f of result.strict_uncovered_files) {
                console.log(`   - ${f}`);
            }
        } else {
            console.log('   ✅ Todos os arquivos elegíveis estão cobertos por alguma lane strict.');
        }
    }

    if (process.argv.includes('--fail-on-uncovered') && result.strict_uncovered_files_total > 0) {
        process.exit(1);
    }
}
