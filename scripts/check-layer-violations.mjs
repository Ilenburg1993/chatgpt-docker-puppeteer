#!/usr/bin/env node
// @ts-check
/**
 * scripts/check-layer-violations.mjs
 *
 * Verifica se os imports de src/copilot respeitam a hierarquia coarse-grained de camadas.
 *
 * Este script é um gate legado de compatibilidade. O contrato canônico e semântico vive em
 * `check-copilot-global-architecture.mjs`; este arquivo permanece como smoke test simples para imports ascendentes.
 *
 * Regra: L(n) nunca importa de L(n+k) para k >= 1.
 *
 * @module scripts/check-layer-violations
 */

import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { listSourceFilesSync } from './lib/source-tree.mjs';

const COPILOT_ROOT = 'src/copilot';

/** @type {Record<string, number>} */
const LAYER_MAP = {
    core: 0,
    dialog: 0,
    types: 0,
    infra: 0,
    boot: 0,
    sdk: 1,
    audit: 1,
    config: 2,
    events: 2,
    'event-handlers': 2,
    observability: 2,
    hooks: 3,
    tools: 3,
    bridges: 3,
    plugins: 3,
    agent: 4,
    channel: 4,
    services: 4,
    'conversation-hub': 4,
    presentation: 6,
    api: 7,
    server: 7,
    terminal: 7,
};

/**
 * Deliberate, documented boundary imports that are allowed to cross layers.
 *
 * - `observability/bootstrap.js` is the canonical bootstrap seam that wires lower-layer singletons to higher-layer
 *   logging/hooks/tools dependencies during app startup.
 * - `types/index.js` is a public aggregation barrel for shared tokens/contracts across modules.
 *
 * These are not accidental layer leaks; they are explicit composition boundaries.
 *
 * @param {string} relFile
 * @param {string} targetModule
 * @param {string} spec
 * @returns {boolean}
 */
function isAllowedBoundaryImport(relFile, targetModule, spec) {
    if (relFile === 'observability/bootstrap.js') {
        return (
            targetModule === 'hooks' ||
            targetModule === 'tools' ||
            spec.startsWith('#copilot/hooks') ||
            spec.startsWith('#copilot/tools') ||
            spec.startsWith('../hooks/') ||
            spec.startsWith('../tools/')
        );
    }

    if (relFile === 'boot/application-events.js' && targetModule === 'events') {
        return true;
    }

    if (relFile.startsWith('boot/')) {
        return ['agent', 'audit', 'config', 'observability', 'sdk', 'server', 'terminal', 'tools'].includes(
            targetModule,
        );
    }

    if (relFile.startsWith('audit/') && targetModule === 'events') {
        return true;
    }

    if (relFile.startsWith('infra/') && targetModule === 'observability') {
        return true;
    }

    if (relFile === 'types/index.js') {
        return ['audit', 'bridges', 'conversation-hub', 'events', 'sdk'].includes(targetModule);
    }

    if (relFile.startsWith('infra/') && targetModule === 'config') {
        return true;
    }

    if (relFile === 'sdk/session/hook-bus.js') {
        return targetModule === 'events';
    }

    if (relFile === 'config/sdk-config-port.js') {
        return targetModule === 'sdk';
    }

    if (relFile === 'terminal/frontend/gateways/sdk-session.js') {
        return targetModule === 'sdk';
    }

    if (relFile === 'terminal/frontend/gateways/tools.js') {
        return targetModule === 'tools';
    }

    return false;
}

/** @param {string} dir */
function walkJs(dir) {
    return listSourceFilesSync(dir, { extensions: ['.js'] });
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
    if (aliasMatch) return aliasMatch[1] ?? null;

    // Relative imports que saem do módulo
    if (spec.startsWith('../')) {
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

// ─── Exports para testes ──────────────────────────────────────────────────────

export { extractModule, isInsideJsDoc, LAYER_MAP, resolveTarget };

// ─── Main ─────────────────────────────────────────────────────────────────────

/** @type {RegExp} */
export const importRegex = /^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]\s*;?/gm;
/** @type {RegExp} */
export const exportFromRegex = /^\s*export\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]\s*;?/gm;
/** @type {RegExp} */
export const dynamicImportRegex = /import\(\s*['"]([^'"]+)['"]\s*\)/gm;

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

/**
 * Executa a verificação completa de violações de layer e retorna os resultados.
 *
 * @returns {{
 *     file: string;
 *     line: number;
 *     from: string;
 *     to: string;
 *     fromLayer: number;
 *     toLayer: number;
 *     spec: string;
 * }[]}
 */
export function checkViolations() {
    /**
     * @type {{
     *     file: string;
     *     line: number;
     *     from: string;
     *     to: string;
     *     fromLayer: number;
     *     toLayer: number;
     *     spec: string;
     * }[]}
     */
    const violations = [];

    const allFiles = walkJs(COPILOT_ROOT);

    for (const file of allFiles) {
        const relFile = relative(COPILOT_ROOT, file);
        const fileModule = extractModule(relFile);
        if (!fileModule || LAYER_MAP[fileModule] === undefined) continue;

        const content = readFileSync(file, 'utf-8');
        const fromLayer = LAYER_MAP[fileModule];

        // Combina static imports, re-exports e dynamic imports
        /** @type {[RegExp, string][]} */
        const regexes = [
            [importRegex, content],
            [exportFromRegex, content],
            [dynamicImportRegex, content],
        ];

        for (const [regex, src] of regexes) {
            regex.lastIndex = 0;
            let match;
            while ((match = regex.exec(src)) !== null) {
                // Ignorar type-only imports dentro de JSDoc
                if (isInsideJsDoc(src, match.index)) continue;

                const spec = match[1];
                if (!spec) continue;
                const targetModule = resolveTarget(spec, fileModule);
                if (!targetModule || LAYER_MAP[targetModule] === undefined) continue;

                const toLayer = LAYER_MAP[targetModule];
                if (toLayer > fromLayer) {
                    if (isAllowedBoundaryImport(relFile, targetModule, spec)) {
                        continue;
                    }
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

    return violations;
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun) {
    const violations = checkViolations();

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
}
