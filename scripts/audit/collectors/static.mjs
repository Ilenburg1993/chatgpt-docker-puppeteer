// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { commandExists, parseJsonFromMixedOutput, runCommand } from '../lib/exec.mjs';

/** @import {RawFinding} from "../normalize/findings.mjs" */

/**
 * @param {unknown} value
 * @returns {'off' | 'warn' | 'p1' | 'p0'}
 */
function normalizeEnforcementState(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    if (normalized === 'off') return 'off';
    if (normalized === 'p1') return 'p1';
    if (normalized === 'p0') return 'p0';
    return 'warn';
}

/**
 * @param {string | null | undefined} value
 */
function normalizePathLike(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '');
}

/**
 * @param {string | null | undefined} value
 */
function isDistArtifactPath(value) {
    const normalized = normalizePathLike(value);
    return normalized.includes('/dist/') || normalized.startsWith('dashboard-ui/dist/');
}

/**
 * @param {string} stdoutOrStderr
 * @returns {RawFinding[]}
 */
function parseForbiddenOutput(stdoutOrStderr) {
    const parsed = parseJsonFromMixedOutput(String(stdoutOrStderr || ''));
    if (parsed?.findings && Array.isArray(parsed.findings)) {
        return parsed.findings.map((/** @type {any} */ item) => ({
            source_tool: 'check:forbidden',
            contract_id: item.contract_id || null,
            domain: item.domain || null,
            owner: item.owner || null,
            enforcement_state: normalizeEnforcementState(item.enforcement),
            rule: item.contract_id || 'contract-static',
            file: item.file || null,
            line: Number.isInteger(item.line) ? item.line : null,
            evidence: item.evidence || 'n/a',
            severity_hint: item.severity || 'P1',
            type: item.type || 'falha de contrato',
            impact: item.message || 'Violação de contrato arquitetural detectada por política de padrões proibidos.',
            root_cause: 'Uso de padrão proibido sem exceção explícita no gate arquitetural.',
            suggested_patch:
                'Substituir o padrão proibido por alternativa canônica do projeto ou justificar em allowlist controlada.',
            test_strategy: 'Executar `npm run check:forbidden -- --json` e validar ausência de ocorrências.',
            regression_risk: 'Médio',
        }));
    }

    const findings = [];
    const lines = String(stdoutOrStderr || '').split(/\r?\n/);
    for (const line of lines) {
        const match = line.match(/^- \[([^\]]+)\] (.+)#L(\d+): (.+)$/);
        if (!match) continue;
        findings.push(
            /** @type {any} */ ({
                source_tool: 'check:forbidden',
                contract_id: match[1],
                domain: 'logic',
                rule: match[1],
                file: match[2],
                line: Number(match[3]),
                evidence: match[4],
                severity_hint: 'P1',
                type: 'falha de contrato',
                impact: 'Violação de contrato arquitetural detectada por política de padrões proibidos.',
                root_cause: 'Uso de padrão proibido sem exceção explícita no gate arquitetural.',
                suggested_patch:
                    'Substituir o padrão proibido por alternativa canônica do projeto ou justificar em allowlist controlada.',
                test_strategy: 'Executar `npm run check:forbidden` e validar ausência de ocorrências.',
                regression_risk: 'Médio',
            }),
        );
    }
    return findings;
}

/**
 * @param {string} output
 * @returns {RawFinding[]}
 */
function parseEslintOutput(output) {
    const findings = [];
    const lines = String(output || '').split(/\r?\n/);

    for (const line of lines) {
        const match = line.match(/^(.+):(\d+):(\d+)\s+(error|warning)\s+(.+)\s{2,}([\w-/@]+)$/);
        if (!match) {
            continue;
        }

        findings.push(
            /** @type {any} */ ({
                source_tool: 'lint:quiet',
                file: match[1],
                line: Number(match[2]),
                evidence: `${match[4]} ${match[5]} (${match[6]})`,
                rule: match[6],
                severity_hint: match[4] === 'error' ? 'P1' : 'P2',
                type: 'incompletude',
                impact: 'Qualidade de código degradada por violação de lint.',
                root_cause: 'Regra de lint violada no arquivo alvo.',
                suggested_patch: 'Corrigir a violação de lint de acordo com a regra indicada.',
                test_strategy: 'Executar `npm run lint:quiet` e confirmar saída limpa.',
                regression_risk: 'Baixo',
            }),
        );
    }

    return findings;
}

/**
 * @param {string} output
 * @returns {RawFinding[]}
 */
function parseTypecheckOutput(output) {
    /** @type {RawFinding[]} */
    const findings = [];
    const lines = String(output || '').split(/\r?\n/);
    for (const line of lines) {
        const match = line.match(/^(.+?)\((\d+),(\d+)\):\s+error\s+TS(\d+):\s+(.+)$/);
        if (!match) {
            continue;
        }

        findings.push(
            /** @type {any} */ ({
                source_tool: 'typecheck',
                contract_id: 'CONTRACT-SCHEMA-TYPECHECK',
                domain: 'schemas',
                owner: 'core-schema',
                enforcement_state: 'p1',
                file: match[1],
                line: Number(match[2]),
                evidence: `TS${match[4]}: ${match[5]}`,
                rule: `TS${match[4]}`,
                severity_hint: 'P1',
                type: 'falha de contrato',
                impact: 'Contrato de tipo inconsistente detectado em build time.',
                root_cause: 'Incompatibilidade de tipos no trecho apontado pelo TypeScript.',
                suggested_patch: 'Ajustar tipos/assinaturas para satisfazer o contrato apontado pelo compilador.',
                test_strategy: 'Executar `npm run typecheck` e validar zero erros.',
                regression_risk: 'Médio',
            }),
        );
    }

    return findings;
}

/**
 * @param {string} output
 * @returns {RawFinding[]}
 */
function parseMadgeOutput(output) {
    /** @type {RawFinding[]} */
    const findings = [];
    const parsed = parseJsonFromMixedOutput(output);
    /** @type {string[][]} */
    const cycles = [];

    if (Array.isArray(parsed)) {
        for (const item of parsed) {
            if (!Array.isArray(item) || item.length < 2) {
                continue;
            }
            const cycle = item.map((token) => normalizePathLike(String(token || ''))).filter(Boolean);
            if (cycle.length >= 2) {
                cycles.push(cycle);
            }
        }
    } else {
        const lines = String(output || '').split(/\r?\n/);
        for (const rawLine of lines) {
            const line = rawLine.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').trim();
            const cyclePrefix = line.match(/^\d+\)\s+(.+)$/);
            if (!cyclePrefix) {
                continue;
            }
            const parts = (cyclePrefix[1] ?? '')
                .split('>')
                .map((part) => normalizePathLike(part))
                .filter(Boolean);
            if (parts.length >= 2) {
                cycles.push(parts);
            }
        }
    }

    /** @type {Set<string>} */
    const dedup = new Set();
    for (const cycle of cycles) {
        if (cycle.every((entry) => isDistArtifactPath(entry))) {
            continue;
        }

        const key = cycle.join(' -> ');
        if (dedup.has(key)) {
            continue;
        }
        dedup.add(key);
        findings.push({
            source_tool: 'madge',
            file: cycle[0] || null,
            line: null,
            evidence: `Ciclo detectado: ${cycle.join(' -> ')}`,
            rule: 'circular-dependency',
            severity_hint: 'P2',
            type: 'gap',
            impact: 'Dependência circular pode introduzir inicialização parcial e comportamento não determinístico.',
            root_cause: 'Acoplamento cíclico entre módulos.',
            suggested_patch: 'Quebrar o ciclo com inversão de dependência, extração de interface ou split de módulos.',
            test_strategy: 'Executar `npm run analyze:deps` e confirmar ausência de ciclos no grafo de origem.',
            regression_risk: 'Médio',
        });
    }

    return findings;
}

/**
 * @typedef {any} ParseDepCruiseOutputDepcruiseJson
 */
/**
 * @param {ParseDepCruiseOutputDepcruiseJson} depcruiseJson
 * @returns {RawFinding[]}
 */
function parseDepCruiseOutput(depcruiseJson) {
    const findings = [];
    const violations = Array.isArray(depcruiseJson?.summary?.violations) ? depcruiseJson.summary.violations : [];

    for (const violation of violations) {
        const severity = String(violation?.severity || '').toLowerCase();
        const from = violation?.from || 'unknown';
        const to = violation?.to || 'unknown';
        findings.push({
            source_tool: 'dependency-cruiser',
            file: from,
            line: null,
            evidence: `${violation?.rule?.name || 'dependency-rule'} -> ${from} => ${to}`,
            rule: violation?.rule?.name || 'depcruise-rule',
            severity_hint: severity === 'error' ? 'P1' : 'P2',
            type: 'gap',
            impact: 'Relação de dependência fora do padrão arquitetural detectada.',
            root_cause: 'Regra de dependency-cruiser violada na estrutura de imports.',
            suggested_patch: 'Reorganizar importações e fronteiras de módulo para atender à regra.',
            test_strategy: 'Executar dependency-cruiser novamente e validar ausência de violações críticas.',
            regression_risk: 'Médio',
        });
    }

    return findings;
}

/**
 * @param {string} jscpdJsonPath
 * @returns {RawFinding[]}
 */
function parseJscpdReport(jscpdJsonPath) {
    if (!fs.existsSync(jscpdJsonPath)) {
        return [];
    }

    try {
        const content = fs.readFileSync(jscpdJsonPath, 'utf8');
        const parsed = JSON.parse(content);
        const duplicates = Array.isArray(parsed?.duplicates) ? parsed.duplicates : [];
        /** @type {RawFinding[]} */
        const findings = [];
        for (const entry of duplicates) {
            const firstName = normalizePathLike(entry?.firstFile?.name || '');
            const secondName = normalizePathLike(entry?.secondFile?.name || '');
            if (!firstName || !secondName) {
                continue;
            }

            const bothTests = firstName.startsWith('tests/') && secondName.startsWith('tests/');
            if (bothTests) {
                continue;
            }
            if (isDistArtifactPath(firstName) || isDistArtifactPath(secondName)) {
                continue;
            }

            const lineCount = Number(entry?.lines || 0);
            const tokenCount = Number(entry?.tokens || 0);
            findings.push({
                source_tool: 'jscpd',
                file: firstName,
                line: Number(entry?.firstFile?.start) || null,
                evidence: `Duplicação (${lineCount} linhas/${tokenCount} tokens) entre ${firstName}:${entry?.firstFile?.start || '?'} e ${secondName}:${entry?.secondFile?.start || '?'}`,
                rule: 'code-duplication',
                severity_hint: 'P2',
                type: 'upgrade',
                impact: 'Duplicação amplia custo de manutenção e risco de divergência funcional.',
                root_cause: 'Trechos lógicos repetidos entre módulos.',
                suggested_patch: 'Extrair trecho duplicado para utilitário compartilhado ou função única no domínio.',
                test_strategy: 'Executar `npx jscpd src scripts --reporters json` e validar tendência de redução.',
                regression_risk: 'Baixo',
            });
        }

        return findings;
    } catch {
        return [];
    }
}

/**
 * @typedef {object} CollectStaticFindingsOptions
 * @property {'quick' | 'deep' | 'nightly'} profile
 * @property {string[]} changedFiles
 * @property {string} artifactsDir
 * @property {'legacy' | 'hybrid' | 'strict'} contractsMode
 * @property {boolean} skipQuickSyntax
 * @property {boolean} skipLintTypecheck
 * @property {(stepId: any, command: any, args: any, opts: any) => Promise<any>} exec
 * @property {Function} commandExistsFn
 */
/**
 * @param {CollectStaticFindingsOptions} options
 * @returns {Promise<{
 *     findings: RawFinding[];
 *     errors: { source: string; message: string }[];
 *     warnings: { source: string; message: string }[];
 *     telemetry: Record<string, any>;
 * }>}
 */
export async function collectStaticFindings(options) {
    /** @type {RawFinding[]} */
    const findings = [];
    /** @type {{ source: string; message: string }[]} */
    const errors = [];
    /** @type {{ source: string; message: string }[]} */
    const warnings = [];

    const exec = options.exec || (async (_stepId, command, args, runOpts) => runCommand(command, args, runOpts));
    const exists = options.commandExistsFn || (async (/** @type {string} */ binary) => commandExists(binary));

    const telemetry = /** @type {any} */ ({
        profile: options.profile,
        changed_files_count: options.changedFiles.length,
        gates: {
            forbidden_ok: null,
            lint_ok: null,
            typecheck_ok: null,
            depgraph_ok: null,
        },
    });

    const changedJsFiles = options.changedFiles
        .filter((file) => /\.(js|mjs|cjs)$/.test(file))
        .filter((file) => fs.existsSync(file));

    if (!options.skipQuickSyntax && options.profile === 'quick' && changedJsFiles.length > 0) {
        for (const file of changedJsFiles) {
            const check = await runCommand('node', ['--check', file], { timeoutMs: 30000 });
            if (!check.ok) {
                findings.push({
                    source_tool: 'node --check',
                    file,
                    line: null,
                    evidence: check.stderr.trim() || `Syntax error in ${file}`,
                    rule: 'syntax-check',
                    severity_hint: 'P1',
                    type: 'bug',
                    impact: 'Arquivo com erro sintático compromete execução.',
                    root_cause: 'Erro sintático detectado no parsing JavaScript.',
                    suggested_patch: 'Corrigir sintaxe no arquivo indicado.',
                    test_strategy: `Executar \`node --check ${file}\`.`,
                    regression_risk: 'Baixo',
                });
            }
        }
    }

    const contractsMode = ['legacy', 'hybrid', 'strict'].includes(options.contractsMode || '')
        ? options.contractsMode
        : 'hybrid';
    const forbidden = await exec(
        'static.forbidden',
        'npm',
        ['run', 'check:forbidden', '--', '--json', '--contracts-mode', contractsMode, '--parity-mode'],
        { timeoutMs: 90000, acceptExitCodes: [0, 2] },
    );
    const forbiddenOutput = `${forbidden.stdout}\n${forbidden.stderr}`;
    const forbiddenPayload = parseJsonFromMixedOutput(forbiddenOutput);
    const forbiddenFindings = parseForbiddenOutput(forbiddenOutput);
    telemetry.gates.forbidden_ok = forbiddenFindings.length === 0;
    if (forbiddenFindings.length > 0) {
        findings.push(...forbiddenFindings);
    } else if (!forbidden.ok) {
        errors.push({ source: 'check:forbidden', message: forbidden.stderr || forbidden.stdout || 'unknown failure' });
    }
    if (Array.isArray(forbiddenPayload?.parity?.mismatches) && forbiddenPayload.parity.mismatches.length > 0) {
        warnings.push({
            source: 'check:forbidden',
            message: `parity DSL/legado com divergências: ${forbiddenPayload.parity.mismatches.length}`,
        });
    }

    if (options.profile !== 'quick' && !options.skipLintTypecheck) {
        const lint = await exec('static.lint', 'npm', ['run', 'lint:quiet'], {
            timeoutMs: 300000,
            acceptExitCodes: [0, 1, 2],
        });
        const lintFindings = parseEslintOutput(`${lint.stdout}\n${lint.stderr}`);
        telemetry.gates.lint_ok = lintFindings.length === 0 && lint.ok;
        if (lintFindings.length > 0) {
            findings.push(...lintFindings);
        }
        if (!lint.ok && lintFindings.length === 0) {
            if ((lint.stderr || lint.stdout).trim()) {
                findings.push({
                    source_tool: 'lint:quiet',
                    file: null,
                    line: null,
                    evidence: (lint.stderr || lint.stdout).split(/\r?\n/).slice(0, 8).join('\n'),
                    rule: 'lint-unparsed-output',
                    severity_hint: 'P2',
                    type: 'incompletude',
                    impact: 'Lint retornou saída não parseável; possível violação de qualidade pendente.',
                    root_cause: 'Formato de output do lint divergente do parser atual.',
                    suggested_patch:
                        'Ajustar parser de lint ou executar lint com formatter JSON para extração confiável.',
                    test_strategy: 'Executar `npm run lint:quiet` e validar parser com saída estável.',
                    regression_risk: 'Baixo',
                });
            } else {
                errors.push({ source: 'lint:quiet', message: 'lint failed sem diagnóstico parseável' });
            }
        }

        const typecheck = await exec('static.typecheck', 'npm', ['run', 'typecheck'], {
            timeoutMs: 300000,
            acceptExitCodes: [0, 1, 2],
        });
        const typecheckFindings = parseTypecheckOutput(`${typecheck.stdout}\n${typecheck.stderr}`);
        telemetry.gates.typecheck_ok = typecheckFindings.length === 0 && typecheck.ok;
        if (typecheckFindings.length > 0) {
            findings.push(...typecheckFindings);
        }
        if (!typecheck.ok && typecheckFindings.length === 0) {
            if ((typecheck.stderr || typecheck.stdout).trim()) {
                findings.push({
                    source_tool: 'typecheck',
                    contract_id: 'CONTRACT-SCHEMA-TYPECHECK',
                    domain: 'schemas',
                    owner: 'core-schema',
                    enforcement_state: 'p1',
                    file: null,
                    line: null,
                    evidence: (typecheck.stderr || typecheck.stdout).split(/\r?\n/).slice(0, 8).join('\n'),
                    rule: 'typecheck-unparsed-output',
                    severity_hint: 'P1',
                    type: 'falha de contrato',
                    impact: 'Typecheck falhou sem diagnóstico parseável no formato esperado.',
                    root_cause: 'Formato de saída do TypeScript divergiu do parser.',
                    suggested_patch:
                        'Padronizar formatter/flags do tsc para extração estruturada e corrigir os erros reportados.',
                    test_strategy: 'Executar `npm run typecheck` e validar parsing consistente.',
                    regression_risk: 'Médio',
                });
            } else {
                errors.push({ source: 'typecheck', message: 'typecheck failed sem diagnóstico parseável' });
            }
        }

        const madge = await exec(
            'static.madge',
            'npx',
            ['madge', '--circular', '--extensions', 'js,mjs,cjs', '--json', '--exclude', '^dashboard-ui/dist/', 'src/'],
            { timeoutMs: 300000, acceptExitCodes: [0, 1] },
        );
        const madgeFindings = parseMadgeOutput(`${madge.stdout}\n${madge.stderr}`);
        telemetry.gates.depgraph_ok = madgeFindings.length === 0 && madge.ok;
        if (madgeFindings.length > 0) {
            findings.push(...madgeFindings);
        }
        if (!madge.ok && madgeFindings.length === 0) {
            errors.push({
                source: 'madge',
                message: madge.stderr || madge.stdout || 'madge failed sem saída parseável',
            });
        }

        const depCruiserAvailable = await exists('depcruise');
        if (depCruiserAvailable) {
            const depcruise = await exec(
                'static.depcruise',
                'depcruise',
                ['--config', '.dependency-cruiser.mjs', 'src', '--output-type', 'json'],
                { timeoutMs: 300000, acceptExitCodes: [0, 2] },
            );
            if (!depcruise.ok) {
                warnings.push({
                    source: 'dependency-cruiser',
                    message: depcruise.stderr || depcruise.stdout || 'depcruise execution failed',
                });
            }
            if (!depcruise.stdout && !depcruise.stderr) {
                warnings.push({ source: 'dependency-cruiser', message: 'depcruise did not return JSON output' });
            }
            try {
                const depJson = JSON.parse(depcruise.stdout || '{}');
                findings.push(...parseDepCruiseOutput(depJson));
            } catch {
                warnings.push({ source: 'dependency-cruiser', message: 'Unable to parse depcruise JSON output' });
            }
        } else {
            warnings.push({
                source: 'dependency-cruiser',
                message: 'depcruise not installed (optional collector skipped)',
            });
        }

        const jscpdOutputDir = path.join(options.artifactsDir || path.join('artifacts', 'audit'), 'jscpd');
        const jscpdJsonPath = path.join(jscpdOutputDir, 'jscpd-report.json');
        const jscpd = await exec(
            'static.jscpd',
            'npx',
            [
                'jscpd',
                'src',
                'scripts',
                '--reporters',
                'json',
                '--output',
                jscpdOutputDir,
                '--min-lines',
                '12',
                '--min-tokens',
                '80',
                '--ignore',
                '**/dist/**,**/*.min.js,**/*.spec.js,tests/**',
            ],
            { timeoutMs: 300000, acceptExitCodes: [0, 1] },
        );
        if (!jscpd.ok) {
            warnings.push({
                source: 'jscpd',
                message: jscpd.stderr || jscpd.stdout || 'jscpd reported duplicates/errors',
            });
        }
        findings.push(...parseJscpdReport(jscpdJsonPath));

        const semgrepAvailable = await exists('semgrep');
        if (semgrepAvailable) {
            const semgrep = await exec('static.semgrep', 'semgrep', ['--config', 'auto', 'src', '--json'], {
                timeoutMs: 300000,
                acceptExitCodes: [0, 1],
            });
            if (!semgrep.ok) {
                warnings.push({ source: 'semgrep', message: semgrep.stderr || 'semgrep execution failed' });
            }

            try {
                const parsed = JSON.parse(semgrep.stdout || '{}');
                for (const result of parsed?.results || []) {
                    findings.push({
                        source_tool: 'semgrep',
                        file: result?.path || null,
                        line: Number(result?.start?.line) || null,
                        evidence: result?.extra?.message || result?.check_id || 'Semgrep finding',
                        rule: result?.check_id || 'semgrep-rule',
                        severity_hint: 'P1',
                        type: 'bug',
                        impact: 'Padrão de risco detectado por análise semântica.',
                        root_cause: 'Regra Semgrep acionada no trecho analisado.',
                        suggested_patch: 'Aplicar correção sugerida pela regra Semgrep correspondente.',
                        test_strategy: 'Reexecutar Semgrep e validar remoção do finding.',
                        regression_risk: 'Médio',
                    });
                }
            } catch {
                warnings.push({ source: 'semgrep', message: 'Unable to parse semgrep JSON output' });
            }
        } else {
            warnings.push({ source: 'semgrep', message: 'semgrep not installed (optional collector skipped)' });
        }
    }

    return { findings, errors, warnings, telemetry };
}
