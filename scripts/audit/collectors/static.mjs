import fs from 'node:fs';
import path from 'node:path';
import { commandExists, parseJsonFromMixedOutput, runCommand } from '../lib/exec.mjs';

/**
 * @typedef {import('../normalize/findings.mjs').RawFinding} RawFinding
 */

/**
 * @param {unknown} value
 * @returns {'off'|'warn'|'p1'|'p0'}
 */
function normalizeEnforcementState(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'off') return 'off';
    if (normalized === 'p1') return 'p1';
    if (normalized === 'p0') return 'p0';
    return 'warn';
}

/**
 * @param {string} stdoutOrStderr
 * @returns {RawFinding[]}
 */
function parseForbiddenOutput(stdoutOrStderr) {
    const parsed = parseJsonFromMixedOutput(String(stdoutOrStderr || ''));
    if (parsed?.findings && Array.isArray(parsed.findings)) {
        return parsed.findings.map(item => ({
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
            suggested_patch: 'Substituir o padrão proibido por alternativa canônica do projeto ou justificar em allowlist controlada.',
            test_strategy: 'Executar `npm run check:forbidden -- --json` e validar ausência de ocorrências.',
            regression_risk: 'Médio',
        }));
    }

    const findings = [];
    const lines = String(stdoutOrStderr || '').split(/\r?\n/);
    for (const line of lines) {
        const match = line.match(/^- \[([^\]]+)\] (.+)#L(\d+): (.+)$/);
        if (!match) continue;
        findings.push({
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
            suggested_patch: 'Substituir o padrão proibido por alternativa canônica do projeto ou justificar em allowlist controlada.',
            test_strategy: 'Executar `npm run check:forbidden` e validar ausência de ocorrências.',
            regression_risk: 'Médio',
        });
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

        findings.push({
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
        });
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

        findings.push({
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
        });
    }

    return findings;
}

/**
 * @param {string} output
 * @returns {RawFinding[]}
 */
function parseMadgeOutput(output) {
    const findings = [];
    const lines = String(output || '').split(/\r?\n/);
    for (const line of lines) {
        if (!line.includes('circular')) {
            continue;
        }

        findings.push({
            source_tool: 'madge',
            file: null,
            line: null,
            evidence: line.trim(),
            rule: 'circular-dependency',
            severity_hint: 'P2',
            type: 'gap',
            impact: 'Dependência circular pode introduzir inicialização parcial e comportamento não determinístico.',
            root_cause: 'Acoplamento cíclico entre módulos.',
            suggested_patch: 'Introduzir camada de abstração ou dividir responsabilidades para eliminar o ciclo.',
            test_strategy: 'Executar `npm run analyze:deps` e confirmar ausência de ciclos.',
            regression_risk: 'Médio',
        });
    }

    return findings;
}

/**
 * @param {any} depcruiseJson
 * @returns {RawFinding[]}
 */
function parseDepCruiseOutput(depcruiseJson) {
    const findings = [];
    const violations = Array.isArray(depcruiseJson?.summary?.violations)
        ? depcruiseJson.summary.violations
        : [];

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
        const duplicates = parsed?.duplicates || [];

        return duplicates.map(entry => ({
            source_tool: 'jscpd',
            file: entry?.firstFile?.name || null,
            line: Number(entry?.firstFile?.start) || null,
            evidence: `Duplicação detectada entre ${entry?.firstFile?.name} e ${entry?.secondFile?.name}`,
            rule: 'code-duplication',
            severity_hint: 'P2',
            type: 'upgrade',
            impact: 'Duplicação amplia custo de manutenção e risco de divergência funcional.',
            root_cause: 'Trechos lógicos repetidos entre arquivos.',
            suggested_patch: 'Extrair trecho duplicado para utilitário compartilhado.',
            test_strategy: 'Executar `jscpd` novamente e validar redução de duplicação.',
            regression_risk: 'Baixo',
        }));
    } catch {
        return [];
    }
}

/**
 * @param {{
 *   profile: 'quick'|'deep'|'nightly',
 *   changedFiles: string[],
 *   artifactsDir?: string,
 *   contractsMode?: 'legacy'|'hybrid'|'strict',
 *   exec?: (stepId: string, command: string, args: string[], options?: any) => Promise<any>,
 *   commandExistsFn?: (binary: string, stepId: string) => Promise<boolean>,
 * }} options
 * @returns {Promise<{ findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>, telemetry: Record<string,any>}>}
 */
export async function collectStaticFindings(options) {
    /** @type {RawFinding[]} */
    const findings = [];
    /** @type {Array<{source:string,message:string}>} */
    const errors = [];
    /** @type {Array<{source:string,message:string}>} */
    const warnings = [];

    const exec =
        options.exec ||
        (async (_stepId, command, args, runOpts) => runCommand(command, args, runOpts));
    const exists =
        options.commandExistsFn ||
        (async (binary, stepId) => commandExists(binary, (cmd, args, runOpts) => exec(stepId, cmd, args, runOpts)));

    const telemetry = {
        profile: options.profile,
        changed_files_count: options.changedFiles.length,
        gates: {
            forbidden_ok: null,
            lint_ok: null,
            typecheck_ok: null,
            depgraph_ok: null,
        },
    };

    const changedJsFiles = options.changedFiles
        .filter(file => /\.(js|mjs|cjs)$/.test(file))
        .filter(file => fs.existsSync(file));

    if (options.profile === 'quick' && changedJsFiles.length > 0) {
        for (const file of changedJsFiles) {
            const fileToken = file.replace(/[^a-zA-Z0-9_.-]/g, '_');
            const check = await exec(`static.syntax.node_check.${fileToken}`, 'node', ['--check', file], { timeoutMs: 30000 });
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
        { timeoutMs: 90000 }
    );
    telemetry.gates.forbidden_ok = forbidden.ok;
    if (!forbidden.ok) {
        const parsed = parseForbiddenOutput(`${forbidden.stdout}\n${forbidden.stderr}`);
        if (parsed.length > 0) {
            findings.push(...parsed);
        } else {
            errors.push({ source: 'check:forbidden', message: forbidden.stderr || forbidden.stdout || 'unknown failure' });
        }
    }

    if (options.profile !== 'quick') {
        const lint = await exec('static.lint', 'npm', ['run', 'lint:quiet'], { timeoutMs: 300000 });
        telemetry.gates.lint_ok = lint.ok;
        if (!lint.ok) {
            findings.push(...parseEslintOutput(`${lint.stdout}\n${lint.stderr}`));
            if (!lint.stdout && !lint.stderr) {
                errors.push({ source: 'lint:quiet', message: 'lint failed without output' });
            }
        }

        const typecheck = await exec('static.typecheck', 'npm', ['run', 'typecheck'], { timeoutMs: 300000 });
        telemetry.gates.typecheck_ok = typecheck.ok;
        if (!typecheck.ok) {
            findings.push(...parseTypecheckOutput(`${typecheck.stdout}\n${typecheck.stderr}`));
            if (!typecheck.stdout && !typecheck.stderr) {
                errors.push({ source: 'typecheck', message: 'typecheck failed without output' });
            }
        }

        const madge = await exec('static.madge', 'npm', ['run', 'analyze:deps'], { timeoutMs: 300000 });
        telemetry.gates.depgraph_ok = madge.ok;
        if (!madge.ok || /circular/i.test(madge.stdout) || /circular/i.test(madge.stderr)) {
            findings.push(...parseMadgeOutput(`${madge.stdout}\n${madge.stderr}`));
        }

        const depCruiserAvailable = await exists('depcruise', 'static.depcruise.which');
        if (depCruiserAvailable) {
            const depcruise = await exec('static.depcruise.run', 'depcruise', ['--config', '.dependency-cruiser.mjs', 'src', '--output-type', 'json'], { timeoutMs: 300000 });
            if (!depcruise.ok) {
                warnings.push({ source: 'dependency-cruiser', message: depcruise.stderr || depcruise.stdout || 'depcruise execution failed' });
            }
            try {
                const depJson = JSON.parse(depcruise.stdout || '{}');
                findings.push(...parseDepCruiseOutput(depJson));
            } catch {
                warnings.push({ source: 'dependency-cruiser', message: 'Unable to parse depcruise JSON output' });
            }
        } else {
            warnings.push({ source: 'dependency-cruiser', message: 'depcruise not installed (optional collector skipped)' });
        }

        const jscpdOutputDir = path.join(options.artifactsDir || path.join('artifacts', 'audit'), 'jscpd');
        const jscpdJsonPath = path.join(jscpdOutputDir, 'jscpd-report.json');
        const jscpd = await exec('static.jscpd', 'npx', ['jscpd', 'src', 'tests', '--reporters', 'json', '--output', jscpdOutputDir], { timeoutMs: 300000 });
        if (!jscpd.ok) {
            warnings.push({ source: 'jscpd', message: jscpd.stderr || jscpd.stdout || 'jscpd reported duplicates/errors' });
        }
        findings.push(...parseJscpdReport(jscpdJsonPath));

        const semgrepAvailable = await exists('semgrep', 'static.semgrep.which');
        if (semgrepAvailable) {
            const semgrep = await exec('static.semgrep.run', 'semgrep', ['--config', 'auto', 'src', '--json'], { timeoutMs: 300000 });
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
