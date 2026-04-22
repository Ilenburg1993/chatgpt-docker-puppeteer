#!/usr/bin/env node
// @ts-check
/**
 * scripts/audit-event-strings.mjs — FAIXA-L12
 *
 * Detecta e classifica event strings hardcoded (fora do SSOT) no codebase.
 *
 * Fluxo:
 *
 * 1. Importa todas as constantes de `src/copilot/events/*.js`
 * 2. Percorre `src/copilot/` buscando `.emit(`, `bus.emit(`, `.on(` com string literal
 * 3. Classifica strings que NÃO estão no SSOT
 * 4. Reporta como violação apenas eventos de domínio/legacy que devem migrar para constantes
 *
 * Uso: node scripts/audit-event-strings.mjs [--json] [--strict]
 *
 * Flags: --json → saída JSON (para CI) --strict → exit code 1 se encontrar violações reais
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EVENTS_DIR = path.join(ROOT, 'src', 'copilot', 'events');
const SRC_DIR = path.join(ROOT, 'src', 'copilot');

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const strict = args.includes('--strict');

// ── Step 1: Coletar todas as strings SSOT dos arquivos de constantes ──

/**
 * @param {string} dir
 * @returns {Promise<Set<string>>}
 */
async function collectSSOTConstants(dir) {
    /** @type {Set<string>} */
    const values = new Set();
    const files = await readdir(dir);

    // Regex para capturar: export const NOME = 'valor';
    const constRegex = /export\s+const\s+\w+\s*=\s*['"]([^'"]+)['"]/g;

    for (const file of files) {
        if (!file.endsWith('-events.js')) continue;
        const content = await readFile(path.join(dir, file), 'utf-8');
        let match;
        while ((match = constRegex.exec(content)) !== null) {
            values.add(match[1]);
        }
    }
    return values;
}

// ── Step 2: Percorrer codebase buscando emits/on com string literal ──

/**
 * @typedef {'domain' | 'legacy-emitter' | 'node-process' | 'ui-local' | 'infra-local'} EventFindingCategory
 *
 * @typedef {{
 *     file: string;
 *     line: number;
 *     col: number;
 *     raw: string;
 *     eventString: string;
 *     category: EventFindingCategory;
 *     violation: boolean;
 *     reason: string;
 * }} EventFinding
 */

/**
 * Busca recursivamente arquivos .js em um diretório.
 *
 * @param {string} dir
 * @param {string[]} [results]
 * @returns {Promise<string[]>}
 */
async function walkJS(dir, results = []) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === 'events') continue;
            await walkJS(full, results);
        } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.spec.js')) {
            results.push(full);
        }
    }
    return results;
}

/**
 * Regex patterns para capturar event strings hardcoded em chamadas de emit/on.
 *
 * Captura padrões como: .emit('string', ...) .on('string', ...) bus.emit({ type: 'string' })
 */
const EMIT_ON_REGEX = /\.(?:emit|on|once|addListener)\(\s*['"]([^'"]+)['"]/g;
const BUS_EMIT_TYPE_REGEX = /\.emit\(\s*\{\s*type:\s*['"]([^'"]+)['"]/g;

/**
 * @param {string} filePath
 * @param {Set<string>} ssot Eventos de processo/Node.js que não pertencem ao SSOT de domínio do Copilot.
 * @readonly
 */
const NODE_PROCESS_EVENTS = new Set([
    'SIGINT',
    'SIGHUP',
    'SIGTERM',
    'uncaughtException',
    'unhandledRejection',
    'warning',
    'beforeExit',
    'exit',
]);

/**
 * Eventos locais de UI/projection. Devem ser observados, mas não entram como violação de domínio.
 *
 * @readonly
 */
const UI_LOCAL_EVENTS = new Set(['activity:changed', 'phase:changed']);

/**
 * Eventos de infra, stream ou APIs Node/EventEmitter locais.
 *
 * @readonly
 */
const INFRA_LOCAL_EVENTS = new Set([
    'close',
    'connection',
    'data',
    'disconnect',
    'drain',
    'end',
    'error',
    'finish',
    'line',
    'listening',
    'message',
    'open',
    'pipe',
    'readable',
    'request',
    'response',
    'timeout',
    'unpipe',
    'upgrade',
]);

/**
 * Prefixos de eventos legados do emitter do agent/SDK. Eles ainda importam arquiteturalmente, mas são uma classe
 * diferente de violação: devem migrar para constantes ou para projections, não para o EventBus imediatamente.
 *
 * @readonly
 */
const LEGACY_EMITTER_PREFIXES = [
    'agent.',
    'assistant.',
    'compaction.',
    'dialog.',
    'exit_plan_mode.',
    'handoff.',
    'mcp.',
    'permission.',
    'question.',
    'quota.',
    'sdk.',
    'session.',
    'stopped',
    'subagent.',
    'task.',
    'tool.',
    'turn_',
];

/**
 * @param {string} eventString
 * @returns {EventFindingCategory}
 */
function classifyEventString(eventString) {
    if (NODE_PROCESS_EVENTS.has(eventString)) return 'node-process';
    if (UI_LOCAL_EVENTS.has(eventString)) return 'ui-local';
    if (INFRA_LOCAL_EVENTS.has(eventString)) return 'infra-local';
    if (LEGACY_EMITTER_PREFIXES.some((prefix) => eventString.startsWith(prefix))) return 'legacy-emitter';
    return 'domain';
}

/**
 * @param {EventFindingCategory} category
 * @returns {boolean}
 */
function isViolationCategory(category) {
    return category === 'domain' || category === 'legacy-emitter';
}

/**
 * @param {EventFindingCategory} category
 * @returns {string}
 */
function describeCategory(category) {
    switch (category) {
        case 'domain':
            return 'Evento de domínio fora do SSOT de `src/copilot/events`.';
        case 'legacy-emitter':
            return 'Evento legado/local de EventEmitter sem constante importada; manter visível para drenagem.';
        case 'node-process':
            return 'Evento de processo Node.js; classificado fora do domínio Copilot.';
        case 'ui-local':
            return 'Evento local de UI/projection; não precisa entrar no catálogo global por padrão.';
        case 'infra-local':
            return 'Evento local de infraestrutura/stream/socket; não pertence ao SSOT de domínio.';
        default:
            return 'Evento não classificado.';
    }
}

/**
 * @param {EventFinding[]} findings
 * @returns {Record<EventFindingCategory, number>}
 */
function countByCategory(findings) {
    return findings.reduce(
        (acc, finding) => {
            acc[finding.category] += 1;
            return acc;
        },
        /** @type {Record<EventFindingCategory, number>} */ ({
            domain: 0,
            'legacy-emitter': 0,
            'node-process': 0,
            'ui-local': 0,
            'infra-local': 0,
        }),
    );
}

/**
 * @param {string} filePath
 * @param {Set<string>} ssot
 * @returns {Promise<EventFinding[]>}
 */
async function scanFile(filePath, ssot) {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    /** @type {EventFinding[]} */
    const findings = [];
    const relative = path.relative(ROOT, filePath);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip imports, comments, JSDoc
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('import ')) continue;

        for (const regex of [EMIT_ON_REGEX, BUS_EMIT_TYPE_REGEX]) {
            regex.lastIndex = 0;
            let match;
            while ((match = regex.exec(line)) !== null) {
                const eventStr = match[1];
                if (eventStr === '*') continue;

                if (!ssot.has(eventStr)) {
                    const category = classifyEventString(eventStr);
                    findings.push({
                        file: relative,
                        line: i + 1,
                        col: match.index + 1,
                        raw: line.trim(),
                        eventString: eventStr,
                        category,
                        violation: isViolationCategory(category),
                        reason: describeCategory(category),
                    });
                }
            }
        }
    }
    return findings;
}

// ── Step 3: Executar e reportar ──

async function main() {
    const ssot = await collectSSOTConstants(EVENTS_DIR);

    if (!jsonMode) {
        console.log(`\n🔍 FAIXA-L12 — SSOT Event String Audit`);
        console.log(`   SSOT constants: ${ssot.size}`);
        console.log(`   Scanning: ${SRC_DIR}\n`);
    }

    const files = await walkJS(SRC_DIR);
    /** @type {EventFinding[]} */
    const allFindings = [];

    for (const file of files) {
        const findings = await scanFile(file, ssot);
        allFindings.push(...findings);
    }

    const allViolations = allFindings.filter((finding) => finding.violation);
    const categoryCounts = countByCategory(allFindings);

    if (jsonMode) {
        console.log(
            JSON.stringify(
                {
                    ssotCount: ssot.size,
                    filesScanned: files.length,
                    findings: allFindings,
                    findingCount: allFindings.length,
                    categoryCounts,
                    violations: allViolations,
                    violationCount: allViolations.length,
                },
                null,
                2,
            ),
        );
    } else {
        if (allViolations.length === 0) {
            console.log('✅ Nenhuma string hardcoded de evento encontrada fora do SSOT.\n');
        } else {
            console.log(`⚠️  ${allViolations.length} string(s) hardcoded acionável(eis):\n`);
            /** @type {Map<string, EventFinding[]>} */
            const byFile = new Map();
            for (const v of allViolations) {
                if (!byFile.has(v.file)) byFile.set(v.file, []);
                /** @type {EventFinding[]} */ (byFile.get(v.file)).push(v);
            }
            for (const [file, vs] of byFile) {
                console.log(`  📄 ${file}`);
                for (const v of vs) {
                    console.log(`     L${v.line}:${v.col}  '${v.eventString}'  [${v.category}]`);
                }
                console.log('');
            }
        }
        console.log(
            `📊 Resumo: ${ssot.size} SSOT | ${files.length} arquivos | ` +
                `${allViolations.length} violações | ${allFindings.length} achados classificados`,
        );
        console.log(
            `🏷️  Categorias: domain=${categoryCounts.domain} | legacy-emitter=${categoryCounts['legacy-emitter']} | ` +
                `node-process=${categoryCounts['node-process']} | ui-local=${categoryCounts['ui-local']} | ` +
                `infra-local=${categoryCounts['infra-local']}`,
        );
    }

    if (strict && allViolations.length > 0) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('Erro fatal:', err);
    process.exit(2);
});
