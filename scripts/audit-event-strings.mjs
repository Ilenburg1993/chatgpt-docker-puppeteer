#!/usr/bin/env node
// @ts-check
/**
 * scripts/audit-event-strings.mjs — FAIXA-L12
 *
 * Detecta event strings hardcoded (fora do SSOT) no codebase.
 *
 * Fluxo:
 *
 * 1. Importa todas as constantes de `src/copilot/events/*.js`
 * 2. Percorre `src/copilot/` buscando `.emit(`, `bus.emit(`, `.on(` com string literal
 * 3. Reporta strings que NÃO estão no SSOT
 *
 * Uso: node scripts/audit-event-strings.mjs [--json] [--strict]
 *
 * Flags: --json → saída JSON (para CI) --strict → exit code 1 se encontrar violações
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
 * @typedef {{ file: string; line: number; col: number; raw: string; eventString: string }} Violation
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
 * @param {Set<string>} ssot
 * @returns {Promise<Violation[]>}
 */
async function scanFile(filePath, ssot) {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    /** @type {Violation[]} */
    const violations = [];
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
                // Skip wildcards e event names que são variáveis (não strings literais de event)
                if (eventStr === '*' || eventStr === 'error' || eventStr === 'close' || eventStr === 'data') continue;
                // Skip Node.js built-in events
                if (
                    [
                        'message',
                        'exit',
                        'disconnect',
                        'end',
                        'drain',
                        'finish',
                        'pipe',
                        'unpipe',
                        'readable',
                        'open',
                        'listening',
                        'connection',
                        'request',
                        'response',
                        'upgrade',
                    ].includes(eventStr)
                )
                    continue;

                if (!ssot.has(eventStr)) {
                    violations.push({
                        file: relative,
                        line: i + 1,
                        col: match.index + 1,
                        raw: line.trim(),
                        eventString: eventStr,
                    });
                }
            }
        }
    }
    return violations;
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
    /** @type {Violation[]} */
    const allViolations = [];

    for (const file of files) {
        const v = await scanFile(file, ssot);
        allViolations.push(...v);
    }

    if (jsonMode) {
        console.log(
            JSON.stringify(
                {
                    ssotCount: ssot.size,
                    filesScanned: files.length,
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
            console.log(`⚠️  ${allViolations.length} string(s) hardcoded encontrada(s):\n`);
            /** @type {Map<string, Violation[]>} */
            const byFile = new Map();
            for (const v of allViolations) {
                if (!byFile.has(v.file)) byFile.set(v.file, []);
                /** @type {Violation[]} */ (byFile.get(v.file)).push(v);
            }
            for (const [file, vs] of byFile) {
                console.log(`  📄 ${file}`);
                for (const v of vs) {
                    console.log(`     L${v.line}:${v.col}  '${v.eventString}'`);
                }
                console.log('');
            }
        }
        console.log(`📊 Resumo: ${ssot.size} SSOT | ${files.length} arquivos | ${allViolations.length} violações`);
    }

    if (strict && allViolations.length > 0) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('Erro fatal:', err);
    process.exit(2);
});
