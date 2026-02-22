import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildQualityExecutionPlan } from '../lib/impact_classifier.mjs';
import { parseJsonFromMixedOutput, runCommand } from '../lib/exec.mjs';

/** @typedef {import('../normalize/findings.mjs').RawFinding} RawFinding */

const QUALITY_CONTRACTS = Object.freeze({
    NODE_SYNTAX: 'CONTRACT-QUALITY-NODE-SYNTAX',
    ENTRYPOINT_IMPORT_SMOKE: 'CONTRACT-QUALITY-ENTRYPOINT-IMPORT-SMOKE',
    LINT_CLEAN: 'CONTRACT-QUALITY-LINT-CLEAN',
    TYPECHECK_NODE: 'CONTRACT-QUALITY-TYPECHECK-NODE',
    TYPECHECK_BROWSER: 'CONTRACT-QUALITY-TYPECHECK-BROWSER',
    PRETTIER_CHECK: 'CONTRACT-QUALITY-PRETTIER-CHECK',
    JSDOC_DELTA_EXPORT_DOCS: 'CONTRACT-QUALITY-JSDOC-DELTA-EXPORTS-DOCUMENTED',
    JSDOC_FULL_EXPORT_DOCS: 'CONTRACT-QUALITY-JSDOC-FULL-EXPORTS-DOCUMENTED',
    JSDOC_FULL_COVERAGE_THRESHOLD: 'CONTRACT-QUALITY-JSDOC-FULL-COVERAGE-THRESHOLD',
    TS_IGNORE_FORBIDDEN: 'CONTRACT-QUALITY-TS-IGNORE-FORBIDDEN',
});
const TS_IGNORE_TOKEN = '@ts-' + 'ignore';

/** @param {string} p */
function normPath(p) {
    return String(p || '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '');
}

/** @param {unknown} value */
function toStringList(value) {
    return Array.isArray(value) ? value.map(v => String(v || '')).filter(Boolean) : [];
}

/** @param {unknown} value */
function stableJson(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(/** @type {Record<string, unknown>} */ (value))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`);
        return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value);
}

/** @param {string} text */
function sha256(text) {
    return crypto
        .createHash('sha256')
        .update(String(text || ''), 'utf8')
        .digest('hex');
}

/** @param {string} file */
function fileSig(file) {
    try {
        const st = fs.statSync(file);
        return { file: normPath(file), size: st.size, mtimeMs: Math.round(st.mtimeMs) };
    } catch {
        return { file: normPath(file), missing: true };
    }
}

/**
 * @param {string[]} files
 * @returns {Array<Record<string, unknown>>}
 */
function fileSigs(files) {
    return [...new Set((files || []).map(normPath).filter(Boolean))].map(fileSig);
}

/** @param {string} dir */
function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

/**
 * @param {string} cacheDir
 * @param {string} stepKey
 * @param {any} cacheInput
 */
function makeCachePath(cacheDir, stepKey, cacheInput) {
    const hash = sha256(
        stableJson({
            quality_cache_schema_version: '2',
            cacheInput,
        })
    );
    return path.join(cacheDir, `${stepKey.replace(/[^a-zA-Z0-9._-]/g, '_')}__${hash}.json`);
}

/**
 * @param {string} filePath
 */
function readCacheEntry(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * @param {string} filePath
 * @param {unknown} payload
 */
function writeCacheEntry(filePath, payload) {
    try {
        ensureDir(path.dirname(filePath));
        fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
    } catch {
        // non-fatal cache write failure
    }
}

/**
 * @param {string} sourceTool
 * @param {string|null} file
 * @param {number|null} line
 * @param {string} evidence
 * @param {string} rule
 * @param {'P0'|'P1'|'P2'|'P3'} severity
 * @param {'bug'|'gap'|'falha de contrato'|'incompletude'|'upgrade'} type
 * @param {string} impact
 * @param {string} rootCause
 * @param {string} suggestedPatch
 * @param {string} testStrategy
 * @param {{ contractId?: string|null, owner?: string, enforcement?: 'off'|'warn'|'p1'|'p0' }} [meta]
 * @returns {RawFinding}
 */
function finding(
    sourceTool,
    file,
    line,
    evidence,
    rule,
    severity,
    type,
    impact,
    rootCause,
    suggestedPatch,
    testStrategy,
    meta = {}
) {
    return {
        source_tool: sourceTool,
        contract_id: meta.contractId || null,
        domain: 'quality',
        owner: meta.owner || 'audit-quality',
        enforcement_state: meta.enforcement || 'warn',
        file,
        line,
        evidence,
        rule,
        severity_hint: severity,
        type,
        impact,
        root_cause: rootCause,
        suggested_patch: suggestedPatch,
        test_strategy: testStrategy,
        regression_risk: 'Baixo',
    };
}

/** @param {string} output */
export function parseTypecheckOutput(output) {
    /** @type {RawFinding[]} */
    const findings = [];
    for (const line of String(output || '').split(/\r?\n/)) {
        const m = line.match(/^(.+?)\((\d+),(\d+)\):\s+error\s+TS(\d+):\s+(.+)$/);
        if (!m) continue;
        findings.push(
            finding(
                'quality:typecheck',
                normPath(m[1]),
                Number(m[2]),
                `TS${m[4]}: ${m[5]}`,
                `TS${m[4]}`,
                'P1',
                'falha de contrato',
                'Contrato de tipos inconsistente detectado em build time.',
                'Incompatibilidade de tipos no trecho apontado pelo TypeScript.',
                'Ajustar tipos/assinaturas para satisfazer o contrato do compilador.',
                'Executar `npm run typecheck:full` e validar saída limpa.',
                { contractId: QUALITY_CONTRACTS.TYPECHECK_NODE }
            )
        );
    }
    return findings;
}

/** @param {string} output */
export function parsePrettierCheckOutput(output) {
    /** @type {RawFinding[]} */
    const findings = [];
    for (const line of String(output || '').split(/\r?\n/)) {
        const clean = line.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').trim();
        const m = clean.match(/^\[warn\]\s+(.+)$/i);
        if (!m) continue;
        if (/Code style issues found/i.test(clean)) continue;
        findings.push(
            finding(
                'quality:prettier',
                normPath(m[1]),
                null,
                clean,
                'prettier-check',
                'P2',
                'incompletude',
                'Arquivo fora do padrão de formatação do projeto.',
                'Formatação divergente do contrato canônico.',
                'Aplicar formatter Prettier no arquivo afetado.',
                'Executar `npm run format:check`.',
                { contractId: QUALITY_CONTRACTS.PRETTIER_CHECK }
            )
        );
    }
    return findings;
}

/** @param {string} output */
export function parseEslintJsonOutput(output) {
    const parsed = parseJsonFromMixedOutput(String(output || ''));
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.results) ? parsed.results : [];
    /** @type {RawFinding[]} */
    const findings = [];
    for (const fileResult of arr) {
        const file = normPath(fileResult?.filePath || '');
        for (const msg of fileResult?.messages || []) {
            const sev = Number(msg?.severity || 0) >= 2 ? 'P1' : 'P2';
            findings.push(
                finding(
                    'quality:eslint',
                    file || null,
                    Number.isFinite(msg?.line) ? Number(msg.line) : null,
                    `${sev === 'P1' ? 'error' : 'warning'} ${msg?.message || 'eslint issue'} (${msg?.ruleId || 'unknown'})`,
                    msg?.ruleId || 'eslint-rule',
                    sev,
                    'incompletude',
                    'Qualidade de código degradada por violação de lint.',
                    'Regra de lint violada no arquivo alvo.',
                    'Corrigir a violação de lint conforme a regra indicada.',
                    'Executar `npm run lint -- --quiet` ou ESLint no arquivo.',
                    { contractId: QUALITY_CONTRACTS.LINT_CLEAN }
                )
            );
        }
    }
    return findings;
}

/** @param {string} file @param {string} stderr */
function parseNodeCheckFailure(file, stderr) {
    return finding(
        'quality:node-check',
        normPath(file),
        null,
        String(stderr || '').trim() || `Syntax error in ${file}`,
        'node-syntax-check',
        'P1',
        'bug',
        'Arquivo com erro sintático compromete execução.',
        'Erro sintático detectado no parsing JavaScript.',
        'Corrigir sintaxe no arquivo indicado.',
        `Executar \`node --check ${file}\`.`,
        { contractId: QUALITY_CONTRACTS.NODE_SYNTAX }
    );
}

/**
 * @param {string} stdout
 */
export function parseJSDocCoverageReport(stdout) {
    return parseJsonFromMixedOutput(String(stdout || ''));
}

/**
 * @param {any} report
 * @param {string} contractId
 * @returns {RawFinding[]}
 */
export function parseJSDocCoverageFindingsFromReport(report, contractId) {
    /** @type {RawFinding[]} */
    const findings = [];
    const files = Array.isArray(report?.files) ? report.files : [];
    for (const fr of files) {
        const symbols = Array.isArray(fr?.exported_symbols) ? fr.exported_symbols : [];
        for (const sym of symbols) {
            if (sym?.has_jsdoc) continue;
            findings.push(
                finding(
                    'quality:jsdoc',
                    normPath(fr?.file || ''),
                    Number.isFinite(sym?.line) ? Number(sym.line) : null,
                    `Export \`${sym?.export_name || 'unknown'}\` (${sym?.kind || 'unknown'}) sem JSDoc`,
                    'jsdoc-missing-export-doc',
                    'P2',
                    'incompletude',
                    'Export público sem documentação JSDoc reduz legibilidade e contratos de manutenção.',
                    'Export nomeado sem JSDoc associado.',
                    'Adicionar JSDoc ao símbolo exportado com descrição e tags relevantes.',
                    'Executar `npm run analyze:jsdoc` / `audit:quick`.',
                    { contractId }
                )
            );
        }
    }
    return findings;
}

/**
 * @param {string} stdout
 * @param {string[]} scopeFiles
 * @returns {RawFinding[]}
 */
export function parseTsIgnoreFindings(stdout, scopeFiles) {
    const allowedScope = new Set((scopeFiles || []).map(normPath));
    /** @type {RawFinding[]} */
    const findings = [];
    for (const line of String(stdout || '').split(/\r?\n/)) {
        const m = line.match(/^(.+?):(\d+):(.*)$/);
        if (!m) continue;
        if (!String(m[3] || '').includes(TS_IGNORE_TOKEN)) continue;
        const file = normPath(m[1]);
        if (allowedScope.size > 0 && !allowedScope.has(file)) continue;
        findings.push(
            finding(
                'quality:ts-ignore-scan',
                file,
                Number(m[2]),
                m[3].trim(),
                'ts-ignore-forbidden',
                'P1',
                'falha de contrato',
                `Uso de \`${TS_IGNORE_TOKEN}\` mascara erros de tipagem e reduz robustez do código.`,
                'Suppressão de TypeScript proibida por padrão do projeto.',
                'Substituir por correção estrutural ou `@ts-expect-error` justificado e rastreável.',
                `Executar scan de \`${TS_IGNORE_TOKEN}\` e \`typecheck:full\`.`,
                { contractId: QUALITY_CONTRACTS.TS_IGNORE_FORBIDDEN }
            )
        );
    }
    return findings;
}

/**
 * @param {{
 *  profile: 'quick'|'deep'|'nightly',
 *  changedFiles: string[],
 *  qualityMode?: 'smart'|'full'|'changed'|'off',
 *  qualityJsdoc?: boolean,
 *  qualityPrettier?: boolean,
 *  qualityJsdocFullThresholdPct?: number,
 *  qualityCache?: boolean,
 *  qualityCacheDir?: string,
 *  qualityParallelism?: 'auto'|'serial',
 *  exec?: (stepId: string, command: string, args: string[], options?: any) => Promise<any>,
 * }} options
 */
export async function collectQualityFindings(options) {
    /** @type {RawFinding[]} */
    const findings = [];
    /** @type {Array<{source:string,message:string}>} */
    const errors = [];
    /** @type {Array<{source:string,message:string}>} */
    const warnings = [];

    const exec = options.exec || (async (_stepId, command, args, runOpts) => runCommand(command, args, runOpts));
    const plan = buildQualityExecutionPlan({
        profile: options.profile,
        changedFiles: options.changedFiles || [],
        qualityMode: options.qualityMode,
        qualityJsdoc: options.qualityJsdoc,
        qualityPrettier: options.qualityPrettier,
    });

    const telemetry = {
        strategy: plan.strategy,
        risk: plan.risk,
        reasons: plan.reasons,
        fallbacks: plan.fallbacks,
        changed_files_count: plan.impact.changed.length,
        impact: {
            only_docs: plan.impact.onlyDocs,
            has_code: plan.impact.hasCode,
            has_high_risk_config: plan.impact.hasHighRiskConfig,
            has_node_type_impact: plan.impact.hasNodeTypeImpact,
            has_browser_type_impact: plan.impact.hasBrowserTypeImpact,
        },
        steps_executed: [],
        steps_skipped: /** @type {Array<{step:string,reason:string}>} */ ([]),
        duration_ms_by_step: /** @type {Record<string, number>} */ ({}),
        gates: {
            node_check_ok: null,
            entrypoint_import_smoke_ok: null,
            lint_ok: null,
            typecheck_node_ok: null,
            typecheck_browser_ok: null,
            prettier_ok: null,
            jsdoc_delta_ok: null,
            jsdoc_full_ok: null,
            ts_ignore_ok: null,
        },
        jsdoc: {
            delta_coverage_pct: null,
            full_coverage_pct: null,
            threshold_pct: Number.isFinite(options.qualityJsdocFullThresholdPct)
                ? Number(options.qualityJsdocFullThresholdPct)
                : 80,
        },
        cache: {
            enabled: options.qualityCache !== false,
            dir: normPath(options.qualityCacheDir || 'artifacts/audit/cache/quality'),
            hits: 0,
            misses: 0,
            writes: 0,
            steps_cached: /** @type {string[]} */ ([]),
            steps_uncached: /** @type {string[]} */ ([]),
        },
        parallelism: {
            mode: String(options.qualityParallelism || 'auto'),
            groups: /** @type {Array<{name:string,steps:string[]}>} */ ([]),
        },
        dedup: {
            before: 0,
            after: 0,
            removed: 0,
        },
    };

    const cacheEnabled = telemetry.cache.enabled;
    const cacheDir = String(options.qualityCacheDir || 'artifacts/audit/cache/quality');
    const qualityParallelism = String(options.qualityParallelism || 'auto').toLowerCase();

    if (cacheEnabled) {
        ensureDir(cacheDir);
    }

    /**
     * @template T
     * @param {string} stepId
     * @param {() => Promise<T>} markerExec
     * @param {any} cacheInput
     * @param {() => Promise<T>} producer
     * @returns {Promise<{ value: T, cacheHit: boolean }>}
     */
    async function runCached(stepId, markerExec, cacheInput, producer) {
        if (!cacheEnabled) {
            telemetry.cache.steps_uncached.push(stepId);
            return { value: await producer(), cacheHit: false };
        }
        const cachePath = makeCachePath(cacheDir, stepId, cacheInput);
        const cached = readCacheEntry(cachePath);
        if (cached && cached.version === 1 && Object.prototype.hasOwnProperty.call(cached, 'value')) {
            telemetry.cache.hits += 1;
            telemetry.cache.steps_cached.push(stepId);
            await markerExec();
            return { value: /** @type {T} */ (cached.value), cacheHit: true };
        }
        telemetry.cache.misses += 1;
        telemetry.cache.steps_uncached.push(stepId);
        const value = await producer();
        writeCacheEntry(cachePath, { version: 1, cached_at: new Date().toISOString(), value });
        telemetry.cache.writes += 1;
        return { value, cacheHit: false };
    }

    /**
     * @template T
     * @param {string} key
     * @param {'skip'|'changed-only'|'full'} mode
     * @param {() => Promise<T>} fn
     * @param {(result: T) => void} [onResult]
     */
    async function runPlanned(key, mode, fn, onResult) {
        if (mode === 'skip') {
            telemetry.steps_skipped.push({ step: key, reason: 'plan=skip' });
            return null;
        }
        const started = Date.now();
        telemetry.steps_executed.push(key);
        const result = await fn();
        telemetry.duration_ms_by_step[key] = Date.now() - started;
        if (onResult) onResult(result);
        return result;
    }

    /**
     * @param {RawFinding[]} list
     * @returns {RawFinding[]}
     */
    function dedupeRawFindings(list) {
        /** @type {Map<string, RawFinding>} */
        const map = new Map();
        for (const item of list) {
            const fp = [
                String(item.source_tool || ''),
                normPath(item.file || ''),
                Number.isInteger(item.line) ? String(item.line) : '',
                String(item.rule || ''),
                String(item.evidence || ''),
            ].join('|');
            if (!map.has(fp)) map.set(fp, item);
        }
        return [...map.values()];
    }

    const nodeCheckTask = runPlanned('quality.node_check', plan.steps.node_check.mode, async () => {
        await exec('quality.node_check', 'node', ['-e', 'process.stdout.write(\"quality-node-check\")'], {
            timeoutMs: 10000,
            acceptExitCodes: [0],
            env: { NO_COLOR: undefined },
        });
        const stepFindings = [];
        for (const file of plan.steps.node_check.files || []) {
            const check = await runCommand('node', ['--check', file], {
                timeoutMs: 30000,
                env: { NO_COLOR: undefined },
                acceptExitCodes: [0, 1],
            });
            if (!check.ok) stepFindings.push(parseNodeCheckFailure(file, check.stderr || check.stdout));
        }
        findings.push(...stepFindings);
        telemetry.gates.node_check_ok = stepFindings.length === 0;
        return stepFindings.length;
    });

    const entrypointSmokeTask = runPlanned(
        'quality.entrypoint_import_smoke',
        plan.steps.entrypoint_import_smoke.mode,
        async () => {
            await exec(
                'quality.entrypoint_import_smoke',
                'node',
                ['-e', 'process.stdout.write(\"quality-entrypoint-smoke\")'],
                {
                    timeoutMs: 10000,
                    acceptExitCodes: [0],
                    env: { NO_COLOR: undefined },
                }
            );
            const stepFindings = [];
            for (const target of plan.steps.entrypoint_import_smoke.targets || []) {
                const cmd = `import './${target}'; console.log('OK')`;
                const check = await runCommand('node', ['--input-type=module', '-e', cmd], {
                    timeoutMs: 45000,
                    env: { NO_COLOR: undefined, NODE_APP_INSTANCE: undefined, DAEMON_MODE: undefined },
                    acceptExitCodes: [0, 1],
                });
                const out = `${check.stdout}\n${check.stderr}`;
                const clean = out.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').trim();
                if (!check.ok || !clean.endsWith('OK')) {
                    stepFindings.push(
                        finding(
                            'quality:entrypoint-import-smoke',
                            target,
                            null,
                            clean || `Import smoke failed for ${target}`,
                            'entrypoint-import-smoke',
                            'P1',
                            'bug',
                            'Import de entrypoint falhou ou gerou side effects inesperados.',
                            'Quebra de import-safety em entrypoint impactado.',
                            'Garantir import puro do módulo e mover bootstrap para caminho explícito.',
                            `Executar \`node --input-type=module -e "import './${target}'; console.log('OK')"\`.`,
                            { contractId: QUALITY_CONTRACTS.ENTRYPOINT_IMPORT_SMOKE }
                        )
                    );
                }
            }
            findings.push(...stepFindings);
            telemetry.gates.entrypoint_import_smoke_ok = stepFindings.length === 0;
            return stepFindings.length;
        }
    );

    if (qualityParallelism !== 'serial') {
        telemetry.parallelism.groups.push({
            name: 'quick-smoke',
            steps: ['quality.node_check', 'quality.entrypoint_import_smoke'],
        });
        await Promise.all([nodeCheckTask, entrypointSmokeTask]);
    } else {
        await nodeCheckTask;
        await entrypointSmokeTask;
    }

    await runPlanned('quality.lint', plan.steps.lint.mode, async () => {
        const args =
            plan.steps.lint.mode === 'changed-only' && (plan.steps.lint.files || []).length > 0
                ? ['eslint', '-f', 'json', '--no-error-on-unmatched-pattern', ...plan.steps.lint.files]
                : ['eslint', '-f', 'json', '.'];
        const { value: res } = await runCached(
            'quality.lint',
            () =>
                exec('quality.lint', 'node', ['-e', 'process.stdout.write(\"quality-lint-cache-hit\")'], {
                    timeoutMs: 10000,
                    acceptExitCodes: [0],
                    env: { NO_COLOR: undefined },
                }),
            {
                profile: options.profile,
                step: 'quality.lint',
                mode: plan.steps.lint.mode,
                args,
                changed: fileSigs(plan.impact.changed),
                lintFiles: fileSigs(plan.steps.lint.files || []),
                configs: fileSigs([
                    'package.json',
                    'eslint.config.js',
                    'eslint.config.mjs',
                    '.eslintrc',
                    'tsconfig.json',
                    'tsconfig.browser.json',
                    'jsconfig.json',
                ]),
            },
            async () =>
                exec('quality.lint', 'npx', args, {
                    timeoutMs: 300000,
                    acceptExitCodes: [0, 1, 2],
                    env: { NO_COLOR: undefined },
                })
        );
        const lintFindings = parseEslintJsonOutput(`${res.stdout}\n${res.stderr}`);
        findings.push(...lintFindings);
        telemetry.gates.lint_ok = lintFindings.length === 0 && res.ok;
        if (!res.ok && lintFindings.length === 0) {
            warnings.push({
                source: 'quality:lint',
                message: (res.stderr || res.stdout || 'eslint failed sem parsing').slice(0, 4000),
            });
        }
        return lintFindings.length;
    });

    await runPlanned('quality.typecheck_node', plan.steps.typecheck_node.mode, async () => {
        const { value: res } = await runCached(
            'quality.typecheck_node',
            () =>
                exec(
                    'quality.typecheck_node',
                    'node',
                    ['-e', 'process.stdout.write(\"quality-typecheck-node-cache-hit\")'],
                    {
                        timeoutMs: 10000,
                        acceptExitCodes: [0],
                        env: { NO_COLOR: undefined },
                    }
                ),
            {
                profile: options.profile,
                step: 'quality.typecheck_node',
                mode: plan.steps.typecheck_node.mode,
                changed: fileSigs(plan.impact.changed),
                configs: fileSigs(['package.json', 'tsconfig.json', 'jsconfig.json']),
                types: fileSigs((plan.impact.changed || []).filter(f => String(f).startsWith('src/types/'))),
            },
            async () =>
                exec('quality.typecheck_node', 'npm', ['run', '-s', 'typecheck:node'], {
                    timeoutMs: 300000,
                    acceptExitCodes: [0, 1, 2],
                    env: { NO_COLOR: undefined },
                })
        );
        const typeFindings = parseTypecheckOutput(`${res.stdout}\n${res.stderr}`);
        findings.push(...typeFindings);
        telemetry.gates.typecheck_node_ok = typeFindings.length === 0 && res.ok;
        if (!res.ok && typeFindings.length === 0) {
            warnings.push({
                source: 'quality:typecheck_node',
                message: (res.stderr || res.stdout || 'typecheck:node failed sem parsing').slice(0, 4000),
            });
        }
        return typeFindings.length;
    });

    await runPlanned('quality.typecheck_browser', plan.steps.typecheck_browser.mode, async () => {
        const { value: res } = await runCached(
            'quality.typecheck_browser',
            () =>
                exec(
                    'quality.typecheck_browser',
                    'node',
                    ['-e', 'process.stdout.write(\"quality-typecheck-browser-cache-hit\")'],
                    {
                        timeoutMs: 10000,
                        acceptExitCodes: [0],
                        env: { NO_COLOR: undefined },
                    }
                ),
            {
                profile: options.profile,
                step: 'quality.typecheck_browser',
                mode: plan.steps.typecheck_browser.mode,
                changed: fileSigs(plan.impact.changed),
                configs: fileSigs(['package.json', 'tsconfig.browser.json']),
            },
            async () =>
                exec('quality.typecheck_browser', 'npm', ['run', '-s', 'typecheck:browser'], {
                    timeoutMs: 300000,
                    acceptExitCodes: [0, 1, 2],
                    env: { NO_COLOR: undefined },
                })
        );
        const typeFindings = parseTypecheckOutput(`${res.stdout}\n${res.stderr}`).map(item => ({
            ...item,
            source_tool: 'quality:typecheck_browser',
            contract_id: QUALITY_CONTRACTS.TYPECHECK_BROWSER,
        }));
        findings.push(...typeFindings);
        telemetry.gates.typecheck_browser_ok = typeFindings.length === 0 && res.ok;
        if (!res.ok && typeFindings.length === 0) {
            warnings.push({
                source: 'quality:typecheck_browser',
                message: (res.stderr || res.stdout || 'typecheck:browser failed sem parsing').slice(0, 4000),
            });
        }
        return typeFindings.length;
    });

    await runPlanned('quality.prettier_check', plan.steps.prettier_check.mode, async () => {
        const changedMode =
            plan.steps.prettier_check.mode === 'changed-only' && (plan.steps.prettier_check.files || []).length > 0;
        const prettierArgs = changedMode
            ? ['npx', 'prettier', '--check', ...(plan.steps.prettier_check.files || [])]
            : ['npm', 'run', '-s', 'format:check'];
        const { value: res } = await runCached(
            'quality.prettier_check',
            () =>
                exec('quality.prettier_check', 'node', ['-e', 'process.stdout.write(\"quality-prettier-cache-hit\")'], {
                    timeoutMs: 10000,
                    acceptExitCodes: [0],
                    env: { NO_COLOR: undefined },
                }),
            {
                profile: options.profile,
                step: 'quality.prettier_check',
                mode: plan.steps.prettier_check.mode,
                changed: fileSigs(plan.impact.changed),
                prettierFiles: fileSigs(plan.steps.prettier_check.files || []),
                configs: fileSigs([
                    'package.json',
                    '.prettierrc',
                    '.prettierrc.json',
                    'prettier.config.js',
                    'prettier.config.mjs',
                ]),
            },
            async () =>
                changedMode
                    ? exec('quality.prettier_check', prettierArgs[0], prettierArgs.slice(1), {
                          timeoutMs: 120000,
                          acceptExitCodes: [0, 1, 2],
                          env: { NO_COLOR: undefined },
                      })
                    : exec('quality.prettier_check', prettierArgs[0], prettierArgs.slice(1), {
                          timeoutMs: 120000,
                          acceptExitCodes: [0, 1, 2],
                          env: { NO_COLOR: undefined },
                      })
        );
        const prettierFindings = parsePrettierCheckOutput(`${res.stdout}\n${res.stderr}`);
        findings.push(...prettierFindings);
        telemetry.gates.prettier_ok = prettierFindings.length === 0 && res.ok;
        if (!res.ok && prettierFindings.length === 0) {
            warnings.push({
                source: 'quality:prettier',
                message: (res.stderr || res.stdout || 'prettier --check failed sem parsing').slice(0, 4000),
            });
        }
        return prettierFindings.length;
    });

    const jsdocDeltaTask = runPlanned('quality.jsdoc_delta', plan.steps.jsdoc_delta.mode, async () => {
        const files = toStringList(plan.steps.jsdoc_delta.files);
        const { value: res } = await runCached(
            'quality.jsdoc_delta',
            () =>
                exec('quality.jsdoc_delta', 'node', ['-e', 'process.stdout.write(\"quality-jsdoc-delta-cache-hit\")'], {
                    timeoutMs: 10000,
                    acceptExitCodes: [0],
                    env: { NO_COLOR: undefined },
                }),
            {
                profile: options.profile,
                step: 'quality.jsdoc_delta',
                mode: plan.steps.jsdoc_delta.mode,
                files: fileSigs(files),
                engine: fileSigs([
                    'scripts/analysis/jsdoc_coverage_engine.mjs',
                    'scripts/analysis/jsdoc_coverage_cli.mjs',
                ]),
            },
            async () =>
                exec(
                    'quality.jsdoc_delta',
                    'node',
                    [
                        'scripts/analysis/jsdoc_coverage_cli.mjs',
                        '--scope',
                        'changed',
                        '--format',
                        'json',
                        '--files',
                        files.join(','),
                        '--output-json',
                        '',
                    ],
                    {
                        timeoutMs: 120000,
                        acceptExitCodes: [0, 1, 2],
                        env: { NO_COLOR: undefined },
                    }
                )
        );
        const jsdocReport = parseJSDocCoverageReport(`${res.stdout}\n${res.stderr}`);
        if (Number.isFinite(jsdocReport?.coverage_pct)) {
            telemetry.jsdoc.delta_coverage_pct = Number(jsdocReport.coverage_pct);
        }
        const jsdocFindingsAll = parseJSDocCoverageFindingsFromReport(
            jsdocReport,
            QUALITY_CONTRACTS.JSDOC_DELTA_EXPORT_DOCS
        );
        const quickCap = options.profile === 'quick' ? 50 : 1000;
        const jsdocFindings =
            jsdocFindingsAll.length > quickCap ? jsdocFindingsAll.slice(0, quickCap) : jsdocFindingsAll;
        if (jsdocFindingsAll.length > jsdocFindings.length) {
            warnings.push({
                source: 'quality:jsdoc_delta',
                message: `jsdoc_delta findings capped in quick mode (${jsdocFindings.length}/${jsdocFindingsAll.length}) para evitar triagem excessiva`,
            });
        }
        findings.push(...jsdocFindings);
        telemetry.gates.jsdoc_delta_ok = jsdocFindingsAll.length === 0 && res.ok;
        return jsdocFindingsAll.length;
    });

    const tsIgnoreScanTask = runPlanned('quality.ts_ignore_scan', plan.steps.ts_ignore_scan.mode, async () => {
        const scopeFiles = plan.steps.ts_ignore_scan.mode === 'changed-only' ? plan.impact.changed : [];
        const { value: res } = await runCached(
            'quality.ts_ignore_scan',
            () =>
                exec(
                    'quality.ts_ignore_scan',
                    'node',
                    ['-e', 'process.stdout.write(\"quality-ts-ignore-cache-hit\")'],
                    {
                        timeoutMs: 10000,
                        acceptExitCodes: [0],
                        env: { NO_COLOR: undefined },
                    }
                ),
            {
                profile: options.profile,
                step: 'quality.ts_ignore_scan',
                mode: plan.steps.ts_ignore_scan.mode,
                scopeFiles: fileSigs(scopeFiles),
            },
            async () =>
                exec(
                    'quality.ts_ignore_scan',
                    'rg',
                    ['-n', TS_IGNORE_TOKEN, 'src', 'scripts', 'tests', '--glob', '!**/dist/**'],
                    {
                        timeoutMs: 30000,
                        acceptExitCodes: [0, 1],
                        env: { NO_COLOR: undefined },
                    }
                )
        );
        const scanFindings = parseTsIgnoreFindings(`${res.stdout}\n${res.stderr}`, scopeFiles);
        findings.push(...scanFindings);
        telemetry.gates.ts_ignore_ok = scanFindings.length === 0;
        return scanFindings.length;
    });

    if (qualityParallelism !== 'serial') {
        telemetry.parallelism.groups.push({
            name: 'delta-docs-scan',
            steps: ['quality.jsdoc_delta', 'quality.ts_ignore_scan'],
        });
        await Promise.all([jsdocDeltaTask, tsIgnoreScanTask]);
    } else {
        await jsdocDeltaTask;
        await tsIgnoreScanTask;
    }

    await runPlanned('quality.jsdoc_full', plan.steps.jsdoc_full.mode, async () => {
        const { value: res } = await runCached(
            'quality.jsdoc_full',
            () =>
                exec('quality.jsdoc_full', 'node', ['-e', 'process.stdout.write(\"quality-jsdoc-full-cache-hit\")'], {
                    timeoutMs: 10000,
                    acceptExitCodes: [0],
                    env: { NO_COLOR: undefined },
                }),
            {
                profile: options.profile,
                step: 'quality.jsdoc_full',
                mode: plan.steps.jsdoc_full.mode,
                roots: fileSigs(['src', 'scripts', 'tests'].filter(p => fs.existsSync(p))),
                engine: fileSigs([
                    'scripts/analysis/jsdoc_coverage_engine.mjs',
                    'scripts/analysis/jsdoc_coverage_cli.mjs',
                ]),
                thresholdPct: Number(telemetry.jsdoc.threshold_pct || 80),
            },
            async () =>
                exec(
                    'quality.jsdoc_full',
                    'node',
                    [
                        'scripts/analysis/jsdoc_coverage_cli.mjs',
                        '--scope',
                        'full',
                        '--format',
                        'json',
                        '--output-json',
                        '',
                    ],
                    {
                        timeoutMs: 300000,
                        acceptExitCodes: [0, 1, 2],
                        env: { NO_COLOR: undefined },
                    }
                )
        );
        const jsdocReport = parseJSDocCoverageReport(`${res.stdout}\n${res.stderr}`);
        if (Number.isFinite(jsdocReport?.coverage_pct)) {
            telemetry.jsdoc.full_coverage_pct = Number(jsdocReport.coverage_pct);
        }
        const jsdocFindings = parseJSDocCoverageFindingsFromReport(
            jsdocReport,
            QUALITY_CONTRACTS.JSDOC_FULL_EXPORT_DOCS
        );
        const thresholdPct = Number(telemetry.jsdoc.threshold_pct || 80);
        if (Number.isFinite(jsdocReport?.coverage_pct) && Number(jsdocReport.coverage_pct) < thresholdPct) {
            jsdocFindings.push(
                finding(
                    'quality:jsdoc',
                    null,
                    null,
                    `Cobertura global JSDoc ${Number(jsdocReport.coverage_pct)}% abaixo do threshold ${thresholdPct}%`,
                    'jsdoc-full-coverage-threshold',
                    'P2',
                    'incompletude',
                    'Cobertura global de JSDoc abaixo do baseline de qualidade definido para auditoria profunda.',
                    'Crescimento de exports sem documentação proporcional.',
                    'Adicionar JSDoc nos exports públicos de maior prioridade até atingir o threshold.',
                    'Executar `npm run analyze:jsdoc` e `npm run audit:deep`.',
                    { contractId: QUALITY_CONTRACTS.JSDOC_FULL_COVERAGE_THRESHOLD }
                )
            );
        }
        findings.push(...jsdocFindings);
        telemetry.gates.jsdoc_full_ok = jsdocFindings.length === 0 && res.ok;
        return jsdocFindings.length;
    });

    const dedupedFindings = dedupeRawFindings(findings);
    telemetry.dedup = {
        before: findings.length,
        after: dedupedFindings.length,
        removed: Math.max(0, findings.length - dedupedFindings.length),
    };

    return {
        findings: dedupedFindings,
        errors,
        warnings,
        telemetry,
    };
}
