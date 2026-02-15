import { parseJsonFromMixedOutput, runCommand } from '../lib/exec.mjs';
import { evaluateRuntimeSignals } from '../contracts/evaluate_runtime.mjs';

/**
 * @typedef {import('../normalize/findings.mjs').RawFinding} RawFinding
 */

/**
 * @param {{
 *   profile: 'quick'|'deep'|'nightly',
 *   contracts?: import('../contracts/load_registry.mjs').ContractDefinitionV1[],
 *   exec?: (stepId: string, command: string, args: string[], options?: any) => Promise<any>,
 * }} options
 * @returns {Promise<{ findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>, telemetry: { mcp: { ok: boolean, details?: string }, rag: { ok: boolean, available?: boolean|null, degraded?: boolean|null }, lsp: { ok: boolean, details?: string } } }>}
 */
export async function collectRuntimeFindings(options) {
    /** @type {RawFinding[]} */
    const findings = [];
    /** @type {Array<{source:string,message:string}>} */
    const errors = [];
    /** @type {Array<{source:string,message:string}>} */
    const warnings = [];

    const exec =
        options.exec ||
        (async (_stepId, command, args, runOpts) => runCommand(command, args, runOpts));

    const telemetry = {
        mcp: { ok: false, details: '' },
        rag: { ok: false, available: null, degraded: null },
        lsp: { ok: false, details: '' },
    };
    /** @type {Array<{ signal: string, evidence: string, source_tool: string, file?: string|null, line?: number|null }>} */
    const signals = [];

    const mcpDiag = await exec('runtime.mcp_diagnose', 'npm', ['run', 'mcp:diagnose', '--', '--json'], { timeoutMs: 180000 });
    const mcpJson = parseJsonFromMixedOutput(mcpDiag.stdout) || parseJsonFromMixedOutput(`${mcpDiag.stdout}\n${mcpDiag.stderr}`);
    telemetry.mcp.ok = Boolean(mcpDiag.ok && mcpJson?.ok !== false);
    telemetry.mcp.details = telemetry.mcp.ok ? 'diagnose-ok' : 'diagnose-failed';

    if (!telemetry.mcp.ok) {
        signals.push({
            signal: 'runtime.mcp_diagnose.failed',
            evidence: (mcpDiag.stderr || mcpDiag.stdout || 'mcp:diagnose failed')
                .split(/\r?\n/)
                .filter(line => !line.includes('NO_COLOR'))
                .join('\n')
                .trim(),
            source_tool: 'mcp:diagnose',
        });
    }

    const ragHealth = await exec('runtime.rag_health', 'npm', ['run', 'rag:health', '--', '--json'], { timeoutMs: 180000 });
    const ragJson = parseJsonFromMixedOutput(ragHealth.stdout) || parseJsonFromMixedOutput(`${ragHealth.stdout}\n${ragHealth.stderr}`);
    const ragOkFromText = /"ok"\s*:\s*true/.test(String(ragHealth.stdout || ''));
    const ragAvailableFromText = /"available"\s*:\s*true/.test(String(ragHealth.stdout || ''));

    telemetry.rag.ok = Boolean(ragHealth.ok && (ragJson?.ok === true || ragOkFromText));
    telemetry.rag.available = ragJson && Object.prototype.hasOwnProperty.call(ragJson, 'available')
        ? Boolean(ragJson.available)
        : ragAvailableFromText
            ? true
            : null;
    telemetry.rag.degraded = ragJson && ragJson.ok === false ? true : null;

    if (!telemetry.rag.ok) {
        signals.push({
            signal: 'runtime.rag_health.failed',
            evidence: (ragHealth.stderr || ragHealth.stdout || 'rag:health returned unhealthy state')
                .split(/\r?\n/)
                .filter(line => !line.includes('NO_COLOR'))
                .join('\n')
                .trim(),
            source_tool: 'rag:health',
        });
    }

    const lspHealth = await exec('runtime.lsp_health', 'npm', ['run', 'lsp:health', '--', '--json'], { timeoutMs: 180000 });
    const lspJson = parseJsonFromMixedOutput(lspHealth.stdout) || parseJsonFromMixedOutput(`${lspHealth.stdout}\n${lspHealth.stderr}`);
    const hasLspTools = Boolean(
        (lspJson && Object.prototype.hasOwnProperty.call(lspJson, 'lsp_tools_present')) ? lspJson.lsp_tools_present : mcpJson?.lsp_tools_present
    );
    const lspFunctionalOk = Boolean(
        (lspJson && Object.prototype.hasOwnProperty.call(lspJson, 'lsp_functional_ok')) ? lspJson.lsp_functional_ok : mcpJson?.lsp_functional_ok
    );

    telemetry.lsp.ok = Boolean(hasLspTools && lspFunctionalOk);
    telemetry.lsp.details = telemetry.lsp.ok
        ? 'lsp-functional-ok'
        : !hasLspTools
            ? 'lsp-tools-missing'
            : 'lsp-functional-failed';

    if (!hasLspTools) {
        signals.push({
            signal: 'runtime.lsp_tools.missing',
            evidence: (mcpDiag.stdout || mcpDiag.stderr || 'LSP tools not confirmed by MCP diagnose output')
                .split(/\r?\n/)
                .filter(line => !line.includes('NO_COLOR'))
                .join('\n')
                .trim(),
            source_tool: 'mcp:diagnose',
        });
    }
    if (hasLspTools && !lspFunctionalOk) {
        signals.push({
            signal: 'runtime.lsp_functional.failed',
            evidence: (lspHealth.stderr || lspHealth.stdout || 'LSP functional checks failed')
                .split(/\r?\n/)
                .filter(line => !line.includes('NO_COLOR'))
                .join('\n')
                .trim(),
            source_tool: 'lsp:health',
        });
    }

    if (options.profile !== 'quick') {
        const smoke = await exec(
            'runtime.smoke',
            'node',
            ['--test', 'tests/regression/test_wave10_lifecycle_signal_matrix.spec.js', 'tests/regression/test_wave11_main_server_bootstrap_unification.spec.js'],
            { timeoutMs: 300000 }
        );

        if (!smoke.ok) {
            signals.push({
                signal: 'runtime.smoke.failed',
                evidence: smoke.stderr || smoke.stdout || 'runtime smoke tests failed',
                source_tool: 'runtime-smoke',
                file: 'tests/regression/test_wave10_lifecycle_signal_matrix.spec.js',
            });
        }
    }

    const runtimeFindings = /** @type {RawFinding[]} */ (evaluateRuntimeSignals({
        contracts: options.contracts || [],
        signals,
    }));
    if (runtimeFindings.length > 0) {
        findings.push(...runtimeFindings);
    }
    if (runtimeFindings.length < signals.length) {
        const coveredSignals = new Set(runtimeFindings.map(item => item.rule));
        for (const signal of signals) {
            if (coveredSignals.has(signal.signal)) {
                continue;
            }
            findings.push({
                source_tool: signal.source_tool || 'runtime-signal',
                contract_id: null,
                domain: 'runtime',
                owner: 'runtime-lifecycle',
                enforcement_state: /** @type {'warn'} */ ('warn'),
                file: signal.file || null,
                line: signal.line || null,
                evidence: signal.evidence || signal.signal,
                rule: signal.signal,
                severity_hint: 'P1',
                type: 'falha de contrato',
                impact: `Sinal de falha runtime detectado (${signal.signal}) sem mapeamento de contrato ativo.`,
                root_cause: 'Falha operacional detectada em runtime.',
                suggested_patch: 'Mapear sinal para contrato no registry e corrigir condição de falha.',
                test_strategy: 'Executar novamente a validação runtime correspondente.',
                regression_risk: 'Alto',
            });
        }
    }

    if (!hasLspTools || !lspFunctionalOk) {
        warnings.push({
            source: 'lsp',
            message: !hasLspTools
                ? 'LSP tools missing in MCP toolset'
                : 'LSP tools present but functional checks failed',
        });
    }

    if (!telemetry.mcp.ok) {
        errors.push({ source: 'mcp:diagnose', message: mcpDiag.stderr || mcpDiag.stdout || 'failed' });
    }
    if (!telemetry.rag.ok) {
        errors.push({ source: 'rag:health', message: ragHealth.stderr || ragHealth.stdout || 'failed' });
    }
    if (!lspHealth.ok || !lspFunctionalOk) {
        errors.push({ source: 'lsp:health', message: lspHealth.stderr || lspHealth.stdout || 'failed' });
    }

    return { findings, errors, warnings, telemetry };
}
