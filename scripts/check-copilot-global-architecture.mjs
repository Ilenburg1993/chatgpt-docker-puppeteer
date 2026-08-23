#!/usr/bin/env node
// @ts-check
/**
 * scripts/check-copilot-global-architecture.mjs
 *
 * Gate global estrito para a topologia ideal de `src/copilot`.
 *
 * A diferença em relação a `check-layer-violations.mjs` é deliberada: este script modela `events/`, `event-handlers/`,
 * `presentation/`, `server/` e `terminal/` como áreas arquiteturais explícitas e reporta também acoplamentos sensíveis
 * que ainda são permitidos no curto prazo.
 *
 * Use `--strict` para sair com erro quando houver violações hard. Achados soft permanecem como inventário de dívida
 * arquitetural e devem ficar em zero por política, mas a decisão de bloqueio é reservada para regras canônicas.
 *
 * @module scripts/check-copilot-global-architecture
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import process from 'node:process';
import { listSourceFilesSync } from './lib/source-tree.mjs';

const COPILOT_ROOT = 'src/copilot';

/** @type {Record<string, number>} */
const LAYER_MAP = {
    core: 0,
    dialog: 0,
    types: 0,
    infra: 0,
    boot: 1,
    sdk: 1,
    config: 1,
    events: 2,
    'event-handlers': 2,
    hooks: 3,
    tools: 3,
    bridges: 3,
    plugins: 3,
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

/** @type {Set<string>} */
const SDK_ROUTE_COMPOSITION_MODULES = new Set([
    'agent',
    'audit',
    'bridges',
    'config',
    'hooks',
    'presentation',
    'sdk',
    'tools',
]);

/** @type {Set<string>} */
const REMOVED_COMPAT_ENTRYPOINTS = new Set([
    'agent.js',
    'agent/infra/task-executor.js',
    'agent/queue-processor.js',
    'boot-contract.js',
    'boot/compat-entrypoint.js',
    'config/system-prompt.js',
    'events/create-emitter.js',
    'events/legacy-events.js',
    'observability/bootstrap-legacy.js',
    'runtime-legacy-compat.js',
    'server/handler-bridge.js',
    'terminal/dialog.js',
    'terminal/file-context.js',
    'terminal/state.js',
]);

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
const importRegex = /^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]\s*;?/gm;
/** @type {RegExp} */
const exportFromRegex = /^\s*export\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]\s*;?/gm;
/** @type {RegExp} */
const dynamicImportRegex = /import\(\s*['"]([^'"]+)['"]\s*\)/gm;

/**
 * @typedef {{
 *     pattern: RegExp;
 *     fromModule?: string;
 *     filePrefix?: string;
 *     filePrefixNot?: string;
 *     severity: 'hard' | 'soft' | 'info';
 *     rule: string;
 *     message: string;
 * }} ContentRule
 */

/** @type {ContentRule[]} */
const CONTENT_RULES = [
    {
        pattern:
            /(?:import\(\s*|from\s+)['"][^'"]*(?:terminal\/(?:state|file-context|dialog)|agent\/(?:infra\/task-executor|queue-processor)|events\/(?:legacy-events|create-emitter))(?:\.js)?['"]/g,
        severity: 'hard',
        rule: 'internal-code-must-not-import-removed-entrypoints',
        message:
            'Código interno deve importar o módulo canônico; entrypoints antigos removidos não voltam como compatibilidade.',
    },
    {
        fromModule: 'terminal',
        pattern: /import\(['"]#copilot\/(?:agent|sdk|tools)(?:\/[^'"]*)?['"]\)/g,
        severity: 'hard',
        rule: 'terminal-jsdoc-must-use-presentation-types',
        message:
            '`terminal/` não deve referenciar tipos internos de agent/sdk/tools; use contratos de `presentation/`.',
    },
    {
        fromModule: 'presentation',
        pattern: /import\(['"]#copilot\/sdk(?:\/[^'"]*)?['"]\)/g,
        severity: 'hard',
        rule: 'presentation-jsdoc-must-use-presentation-types',
        message: '`presentation/` deve expor contratos próprios de borda, sem typedefs do SDK wrapper.',
    },
    {
        fromModule: 'presentation',
        pattern:
            /\b(?:agent|runtime|selection\.runtime)\.(?:status|model|sessionId|dialogLoopActive|dialogPaused|queueSize|reasoningEffort|lastPrInfo|dialogPrMetrics|pendingQuestion(?:Kind|Shadow|ShadowKind|ShadowState|ShadowExpired|ShadowAgeMs|ShadowExpiresAt|ShadowRemainingMs)?)(?![A-Za-z0-9_$])/g,
        severity: 'hard',
        rule: 'presentation-must-use-agent-facade-state',
        message:
            '`presentation/` deve ler estado vivo do agent por façades semânticas, não por propriedades cruas da instância.',
    },
    {
        filePrefix: 'server/routes/copilot-api/',
        pattern:
            /import\(['"][^'"]*(?:#copilot\/agent|agent\/types|#copilot\/sdk\/types)[^'"]*['"]\)|\b(?:AlwaysAliveAgentLike|IAlwaysAliveAgent)\b/g,
        severity: 'hard',
        rule: 'copilot-api-routes-must-use-route-deps-contract',
        message:
            '`server/routes/copilot-api/*` deve usar o contrato de route deps de `presentation/`, sem agent/sdk types locais.',
    },
    {
        fromModule: 'config',
        filePrefixNot: 'config/sdk-config-port.js',
        pattern: /import\(['"]#copilot\/sdk(?:\/[^'"]*)?['"]\)/g,
        severity: 'hard',
        rule: 'config-jsdoc-sdk-access-must-use-port',
        message: '`config/` só pode referenciar SDK pelo port `config/sdk-config-port.js`.',
    },
];

/** @param {string} dir */
function walkJs(dir) {
    return listSourceFilesSync(dir, { extensions: ['.js', '.mjs', '.cjs'] });
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
 * @param {string} src
 * @param {number} matchIndex
 * @returns {number}
 */
function lineForIndex(src, matchIndex) {
    const beforeMatch = src.substring(0, matchIndex);
    return (beforeMatch.match(/\n/g) || []).length + 1;
}

/**
 * @param {string} relFile
 * @param {string} to
 * @param {string} spec
 * @returns {boolean}
 */
function isDocumentedCompositionImport(relFile, to, spec) {
    if (relFile === 'boot/runtime-bootstrap.js') {
        return ['agent', 'config', 'sdk', 'server', 'terminal', 'tools'].includes(to);
    }

    if (relFile === 'boot/application-events.js') {
        return to === 'events';
    }

    if (relFile.startsWith('infra/') && to === 'config') {
        return true;
    }

    if (relFile === 'sdk/session/hook-bus.js') {
        return to === 'events';
    }

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

    if (relFile === 'terminal/frontend/gateways/tools.js') {
        return to === 'tools';
    }

    if (relFile === 'terminal/frontend/gateways/sdk-session.js') {
        return to === 'sdk';
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

    if (
        relFile.startsWith('server/routes/sdk/') &&
        relFile !== 'server/routes/sdk/deps.js' &&
        SDK_ROUTE_COMPOSITION_MODULES.has(to)
    ) {
        return {
            severity: 'hard',
            rule: 'sdk-routes-must-compose-through-deps',
            message:
                '`server/routes/sdk/*` deve receber SDK/agent/presentation/domínios por `server/routes/sdk/deps.js`.',
        };
    }

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

    if (from === 'config' && to === 'sdk' && relFile !== 'config/sdk-config-port.js') {
        return {
            severity: 'hard',
            rule: 'config-sdk-access-must-use-port',
            message: '`config/` só pode acessar SDK por `config/sdk-config-port.js`.',
        };
    }

    if (from === 'presentation' && to === 'sdk') {
        return {
            severity: 'hard',
            rule: 'presentation-must-not-import-sdk',
            message: '`presentation/` deve falar com SDK vivo por façades do `agent/` ou ports de `config/`.',
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

    if (from === 'terminal' && ['agent', 'sdk', 'tools'].includes(to)) {
        return {
            severity: 'hard',
            rule: 'terminal-must-use-presentation-contracts',
            message: '`terminal/` é borda local e deve consumir projections/comandos, não runtime SDK/agent/tools.',
        };
    }

    if (from === 'server' && to === 'agent') {
        return {
            severity: 'hard',
            rule: 'server-must-use-presentation-contracts',
            message: '`server/` deve acessar runtime do agent por projections/route deps, não por import direto.',
        };
    }

    if (from === 'server' && ['sdk', 'tools'].includes(to) && !relFile.startsWith('server/routes/sdk/')) {
        return {
            severity: 'hard',
            rule: 'server-sdk-access-must-stay-in-sdk-routes',
            message: '`server/` só pode acessar SDK/tools crus dentro do adapter `server/routes/sdk/*`.',
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
    for (const relFile of REMOVED_COMPAT_ENTRYPOINTS) {
        if (existsSync(join(COPILOT_ROOT, relFile))) {
            findings.push({
                file: relFile,
                line: 1,
                from: extractModule(relFile) ?? 'unknown',
                to: 'removed-entrypoint',
                spec: relFile,
                severity: 'hard',
                rule: 'removed-compat-entrypoints-must-stay-deleted',
                message: 'Entrypoints antigos removidos não podem ser reintroduzidos; use o módulo canônico.',
            });
        }
    }
    const allFiles = walkJs(COPILOT_ROOT);

    for (const file of allFiles) {
        const relFile = relative(COPILOT_ROOT, file);
        const from = extractModule(relFile);
        if (!from) continue;

        const content = readFileSync(file, 'utf8');
        for (const rule of CONTENT_RULES) {
            if (rule.fromModule && rule.fromModule !== from) continue;
            if (rule.filePrefix && !relFile.startsWith(rule.filePrefix)) continue;
            if (rule.filePrefixNot && relFile.startsWith(rule.filePrefixNot)) continue;

            rule.pattern.lastIndex = 0;
            let match;
            while ((match = rule.pattern.exec(content)) !== null) {
                findings.push({
                    file: relFile,
                    line: lineForIndex(content, match.index),
                    from,
                    to: 'content',
                    spec: match[0],
                    severity: rule.severity,
                    rule: rule.rule,
                    message: rule.message,
                });
            }
        }

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

                findings.push({
                    file: relFile,
                    line: lineForIndex(content, match.index),
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

    const strictViolationCount = findings.filter((finding) => finding.severity === 'hard').length;
    if (strict && strictViolationCount > 0) {
        process.exit(1);
    }
}
