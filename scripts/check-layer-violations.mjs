#!/usr/bin/env node
// @ts-check
/**
 * scripts/check-layer-violations.mjs
 *
 * Verifica se os imports de src/copilot respeitam a hierarquia de camadas (PARTE-20E, critério C2).
 *
 * Hierarquia canônica (de baixo para cima): L0: core, db L1: sdk, audit L2: config, observability L3: hooks, tools,
 * bridges L4: agent, conversation-hub, channel L5: api L6: terminal
 *
 * Regra: L(n) nunca importa de L(n+k) para k >= 1.
 *
 * @module scripts/check-layer-violations
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const COPILOT_ROOT = 'src/copilot';

/** @type {Record<string, number>} */
const LAYER_MAP = {
    core: 0,
    db: 0,
    sdk: 1,
    audit: 1,
    config: 2,
    observability: 2,
    hooks: 3,
    tools: 3,
    bridges: 3,
    agent: 4,
    'conversation-hub': 4,
    channel: 4,
    api: 5,
    terminal: 6,
};

/**
 * Recursivamente lista todos os .js no diretório.
 *
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
 * Extrai módulo de primeiro nível de um path relativo a src/copilot.
 *
 * @param {string} relPath - ex: "core/error-handlers.js"
 * @returns {string | null} - ex: "core"
 */
function extractModule(relPath) {
    const parts = relPath.split(sep);
    return parts[0] || null;
}

/**
 * Resolve um import specifier para módulo copilot (se aplicável).
 *
 * @param {string} spec - Import specifier, ex: "#copilot/agent" ou "./foo.js" ou "../bar/baz.js"
 * @param {string} fileModule - Módulo do arquivo que faz o import
 * @returns {string | null} - Nome do módulo target, ou null se externo
 */
function resolveTarget(spec, fileModule) {
    // Alias #copilot/xxx
    const aliasMatch = spec.match(/^#copilot\/([^/]+)/);
    if (aliasMatch) return aliasMatch[1];

    // Relative imports que saem do módulo
    if (spec.startsWith('../')) {
        // Conta quantos níveis sobe
        const _ups = spec.split('/').filter((s) => s === '..').length;
        // Se sobe 1+ vezes a partir do módulo, pode estar entrando em outro módulo
        // Heurística: se o relative import contém referência a outro módulo de primeiro nível
        const afterUps = spec.replace(/^(\.\.\/)+/, '');
        const targetModule = afterUps.split('/')[0];
        if (targetModule && LAYER_MAP[targetModule] !== undefined && targetModule !== fileModule) {
            return targetModule;
        }
    }

    return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const importRegex = /^\s*import\s.*from\s+['"]([^'"]+)['"]/gm;
const dynamicImportRegex = /import\(\s*['"]([^'"]+)['"]\s*\)/gm;

/**
 * Verifica se um match de import está dentro de um bloco JSDoc (type-only import). Imports via `@typedef {import(...)}`
 * ou `@type {import(...)}` são compile-time apenas.
 *
 * @param {string} src - Conteúdo completo do arquivo
 * @param {number} matchIndex - Posição no source do match
 * @returns {boolean}
 */
function isInsideJsDoc(src, matchIndex) {
    // Encontra a linha onde o match aparece
    const lineStart = src.lastIndexOf('\n', matchIndex) + 1;
    const line = src.substring(lineStart, src.indexOf('\n', matchIndex));
    // Se a linha começa com * (dentro de JSDoc block) ou contém @typedef/@type/@param/@returns
    return /^\s*\*/.test(line) || /^\s*\/\*\*/.test(line);
}

/** @type {{
    file: string;
    line: number;
    from: string;
    to: string;
    fromLayer: number;
    toLayer: number;
    spec: string;
}[]} */
const violations = [];

const allFiles = walkJs(COPILOT_ROOT);

for (const file of allFiles) {
    const relFile = relative(COPILOT_ROOT, file);
    const fileModule = extractModule(relFile);
    if (!fileModule || LAYER_MAP[fileModule] === undefined) continue;

    const content = readFileSync(file, 'utf-8');
    const fromLayer = LAYER_MAP[fileModule];

    // Combina static e dynamic imports
    /** @type {[RegExp, string][]} */
    const regexes = [
        [importRegex, content],
        [dynamicImportRegex, content],
    ];

    for (const [regex, src] of regexes) {
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(src)) !== null) {
            // Ignorar type-only imports dentro de JSDoc
            if (isInsideJsDoc(src, match.index)) continue;

            const spec = match[1];
            const targetModule = resolveTarget(spec, fileModule);
            if (!targetModule || LAYER_MAP[targetModule] === undefined) continue;

            const toLayer = LAYER_MAP[targetModule];
            if (toLayer > fromLayer) {
                // Encontrar número da linha
                const beforeMatch = src.substring(0, match.index);
                const lineNum = (beforeMatch.match(/\n/g) || []).length + 1;

                violations.push({
                    file: relFile,
                    line: lineNum,
                    from: fileModule,
                    to: targetModule,
                    fromLayer,
                    toLayer,
                    spec,
                });
            }
        }
    }
}

// ─── Output ───────────────────────────────────────────────────────────────────

if (violations.length === 0) {
    console.log('✅ Nenhuma violação de camada encontrada.');
    process.exit(0);
} else {
    console.error(`❌ ${violations.length} violação(ões) de camada encontrada(s):\n`);
    for (const v of violations) {
        console.error(`  ${COPILOT_ROOT}/${v.file}:${v.line}`);
        console.error(`    L${v.fromLayer} (${v.from}) → L${v.toLayer} (${v.to})  import '${v.spec}'`);
        console.error('');
    }
    process.exit(1);
}
