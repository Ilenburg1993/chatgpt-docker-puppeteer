#!/usr/bin/env node
// @ts-check
/**
 * scripts/check-copilot-global-architecture.mjs
 *
 * Gate global, inicialmente observacional, para a topologia ideal de `src/copilot`.
 *
 * A diferença em relação a `check-layer-violations.mjs` é deliberada: este script modela `events/`, `event-handlers/`,
 * `presentation/`, `server/` e `terminal/` como áreas arquiteturais explícitas e reporta também acoplamentos sensíveis
 * que ainda são permitidos no curto prazo.
 *
 * Use `--strict` para sair com erro quando houver violações hard.
 *
 * @module scripts/check-copilot-global-architecture
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import process from 'node:process';

const COPILOT_ROOT = 'src/copilot';

/** @type {Record<string, number>} */
const LAYER_MAP = {
    core: 0,
    types: 0,
    db: 0,
    config: 1,
    sdk: 2,
    events: 2,
    'event-handlers': 2,
    hooks: 3,
    tools: 3,
    bridges: 3,
    plugins: 3,
    infra: 3,
    agent: 4,
    channel: 4,
    'conversation-hub': 5,
    presentation: 6,
    server: 7,
    terminal: 7,
};

/** @type {Set<string>} */
const CROSS_CUTTING_MODULES = new Set(['observability', 'audit']);

/** @type {Set<string>} */
const RUNTIME_ARTIFACT_MODULES = new Set(['logs', '.github']);

/**
 * @typedef {{
 *     file: string;
 *     line: number;
 *     from: string;
 *     to: string;
 *     spec: string;
 *     severity: 'hard' | 'soft' | 'info';
 *     rule: string;
 *     message: string;
 * }} Finding
 */

/** @type {RegExp} */
const importRegex = /^\s*import\s.*from\s+['"]([^'"]+)['"]/gm;
/** @type {RegExp} */
const exportFromRegex = /^\s*export\s+(?:\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"]/gm;
/** @type {RegExp} */
const dynamicImportRegex = /import\(\s*['"]([^'"]+)['"]\s*\)/gm;

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walkJs(dir) {
    /** @type {string[]} */
    const results = [];
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'logs') continue;
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            results.push(...walkJs(full));
        } else if (entry.endsWith('.js') || entry.endsWith('.mjs') || entry.endsWith('.cjs')) {
            results.push(full);
        }
    }
    return results;
}

/**
 * @param {string} relPath
 * @returns {string | null}
 */
function extractModule(relPath) {
    const parts = relPath.split(sep);
    return parts[0] || null;
}

/**
 * @param {string} src
 * @param {number} matchIndex
 * @returns {boolean}
 */
function isInsideJsDoc(src, matchIndex) {
    const lineStart = src.lastIndexOf('\n', matchIndex) + 1;
    const lineEnd = src.indexOf('\n', matchIndex);
    const line = src.substring(lineStart, lineEnd === -1 ? src.length : lineEnd);
    return /^\s*\*/.test(line) || /^\s*\/\*\*/.test(line);
}

/**
 * @param {string} spec
 * @param {string} relFile
 * @param {string} fileModule
 * @returns {string | null}
 */
function resolveTargetModule(spec, relFile, fileModule) {
    const aliasMatch = spec.match(/^#copilot\/([^/]+)/);
    if (aliasMatch) return aliasMatch[1] ?? null;

    if (!spec.startsWith('.')) return null;

    const relDirParts = relFile.split(sep);
    relDirParts.pop();

    const specParts = spec.split('/').filter(Boolean);
    /** @type {string[]} */
    const resolvedParts = [...relDirParts];

    for (const part of specParts) {
        if (part === '.') continue;
        if (part === '..') {
            resolvedParts.pop();
            continue;
        }
        resolvedParts.push(part);
    }

    return resolvedParts[0] ?? fileModule;
}

/**
 * @param {string} relFile
 * @param {string} to
 * @param {string} spec
 * @returns {boolean}
 */
function isDocumentedCompositionImport(relFile, to, spec) {
    if (relFile.startsWith('agent/ports/')) {
        return ['bridges', 'conversation-hub', 'hooks', 'observability', 'tools'].includes(to);
    }

    if (relFile === 'observability/bootstrap.js') {
        return to === 'hooks' || to === 'tools';
    }

    if (relFile === 'types/index.js') {
        return ['audit', 'bridges', 'conversation-hub', 'events', 'sdk'].includes(to);
    }

    if (relFile === 'config/sdk-config-port.js') {
        return to === 'sdk';
    }

    if (relFile === 'terminal/di-wiring.js') {
        return to === 'agent' || to === 'conversation-hub' || to === 'channel';
    }

    return spec.startsWith('#copilot/types') && to === 'types';
}

/**
 * @param {string} from
 * @param {string} to
 * @param {string} relFile
 * @param {string} spec
 * @returns {Omit<Finding, 'file' | 'line' | 'from' | 'to' | 'spec'> | null}
 */
function classifyImport(from, to, relFile, spec) {
    if (from === to) return null;
    if (RUNTIME_ARTIFACT_MODULES.has(from) || RUNTIME_ARTIFACT_MODULES.has(to)) return null;

    if (isDocumentedCompositionImport(relFile, to, spec)) {
        return {
            severity: 'info',
            rule: 'documented-composition',
            message: 'Import permitido como ponto explícito de composição ou compatibilidade.',
        };
    }

    if (from === 'sdk' && ['agent', 'presentation', 'server', 'terminal'].includes(to)) {
        return {
            severity: 'hard',
            rule: 'sdk-must-not-import-runtime-or-edge',
            message: '`sdk/` não deve depender de runtime, presentation ou bordas.',
        };
    }

    if (from === 'events' && ['agent', 'presentation', 'server', 'terminal', 'conversation-hub'].includes(to)) {
        return {
            severity: 'hard',
            rule: 'events-must-not-import-runtime',
            message: '`events/` deve permanecer catálogo/contrato, sem runtime concreto.',
        };
    }

    if (from === 'event-handlers' && ['presentation', 'server', 'terminal'].includes(to)) {
        return {
            severity: 'hard',
            rule: 'event-handlers-must-not-render-edge',
            message: '`event-handlers/` traduz payloads; não deve renderizar HTTP, terminal ou projections de borda.',
        };
    }

    if (from === 'server' && to === 'terminal') {
        return {
            severity: 'hard',
            rule: 'server-must-not-import-terminal',
            message: '`server/` não deve depender de terminal.',
        };
    }

    if (from === 'terminal' && to === 'server') {
        return {
            severity: 'hard',
            rule: 'terminal-must-not-import-server',
            message: '`terminal/` não deve depender de server routes/middleware.',
        };
    }

    if (from === 'core' && to !== 'types') {
        return {
            severity: 'hard',
            rule: 'core-must-not-import-runtime',
            message: '`core/` deve permanecer fundação sem dependência de módulos superiores.',
        };
    }

    if (from === 'agent' && ['tools', 'hooks', 'bridges', 'conversation-hub'].includes(to)) {
        return {
            severity: 'soft',
            rule: 'agent-sensitive-boundary-import',
            message: '`agent/` ainda pode usar este módulo por compatibilidade, mas o alvo ideal é um port/adaptor.',
        };
    }

    if (from === 'agent' && to === 'observability') {
        return {
            severity: 'soft',
            rule: 'agent-observability-boundary-import',
            message: '`agent/` deve preferir port/projection para snapshots e sinais de observabilidade.',
        };
    }

    if ((from === 'server' || from === 'terminal') && to === 'agent') {
        return {
            severity: 'soft',
            rule: 'edge-should-use-presentation',
            message: 'Bordas devem preferir `presentation/` ao acessar runtime do agent.',
        };
    }

    if (from === 'presentation' && ['server', 'terminal'].includes(to)) {
        return {
            severity: 'hard',
            rule: 'presentation-must-not-import-edge',
            message: '`presentation/` é compartilhada por bordas e não pode depender delas.',
        };
    }

    if (CROSS_CUTTING_MODULES.has(to)) {
        return {
            severity: 'info',
            rule: 'cross-cutting-import',
            message: 'Import transversal para observability/audit; deve permanecer sem decisão de domínio.',
        };
    }

    const fromLayer = LAYER_MAP[from];
    const toLayer = LAYER_MAP[to];
    if (fromLayer !== undefined && toLayer !== undefined && toLayer > fromLayer) {
        return {
            severity: 'soft',
            rule: 'upward-layer-import',
            message: 'Import ascendente pela topologia global; revisar se é composição legítima.',
        };
    }

    return null;
}

/**
 * @returns {Finding[]}
 */
export function checkGlobalArchitecture() {
    /** @type {Finding[]} */
    const findings = [];
    const allFiles = walkJs(COPILOT_ROOT);

    for (const file of allFiles) {
        const relFile = relative(COPILOT_ROOT, file);
        const from = extractModule(relFile);
        if (!from) continue;

        const content = readFileSync(file, 'utf8');
        /** @type {RegExp[]} */
        const regexes = [importRegex, exportFromRegex, dynamicImportRegex];

        for (const regex of regexes) {
            regex.lastIndex = 0;
            let match;
            while ((match = regex.exec(content)) !== null) {
                if (isInsideJsDoc(content, match.index)) continue;
                const spec = match[1];
                if (!spec) continue;

                const to = resolveTargetModule(spec, relFile, from);
                if (!to || to === from) continue;
                if (LAYER_MAP[to] === undefined && !CROSS_CUTTING_MODULES.has(to)) continue;

                const classification = classifyImport(from, to, relFile, spec);
                if (!classification) continue;

                const beforeMatch = content.substring(0, match.index);
                const line = (beforeMatch.match(/\n/g) || []).length + 1;
                findings.push({
                    file: relFile,
                    line,
                    from,
                    to,
                    spec,
                    ...classification,
                });
            }
        }
    }

    return findings;
}

/**
 * @param {Finding[]} findings
 */
function printReport(findings) {
    const counts = findings.reduce(
        (acc, finding) => {
            acc[finding.severity] += 1;
            return acc;
        },
        { hard: 0, soft: 0, info: 0 },
    );

    console.log('Copilot global architecture report');
    console.log(`hard=${counts.hard} soft=${counts.soft} info=${counts.info} total=${findings.length}`);

    for (const severity of /** @type {const} */ (['hard', 'soft', 'info'])) {
        const scoped = findings.filter((finding) => finding.severity === severity);
        if (scoped.length === 0) continue;

        console.log(`\n[${severity}]`);
        for (const finding of scoped) {
            console.log(
                `${COPILOT_ROOT}/${finding.file}:${finding.line} ${finding.from} -> ${finding.to} ` +
                    `(${finding.rule}) ${finding.spec}`,
            );
            console.log(`  ${finding.message}`);
        }
    }
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun) {
    const strict = process.argv.includes('--strict');
    const findings = checkGlobalArchitecture();
    printReport(findings);

    const hardCount = findings.filter((finding) => finding.severity === 'hard').length;
    if (strict && hardCount > 0) {
        process.exit(1);
    }
}
