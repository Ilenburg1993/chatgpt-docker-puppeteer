import { parseJsonFromMixedOutput, runCommand } from '../lib/exec.mjs';
import { evaluateRuntimeSignals } from '../contracts/evaluate_runtime.mjs';
import fs from 'node:fs';
import path from 'node:path';

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

    const lockCausalityIssues = detectLockReleaseCausalityIssues(process.cwd());
    if (lockCausalityIssues.length > 0) {
        const evidence = lockCausalityIssues
            .map(item => `${item.file}:${item.line} ${item.evidence}`)
            .slice(0, 10)
            .join('\n');
        signals.push({
            signal: 'runtime.lock_release_causality.failed',
            evidence,
            source_tool: 'runtime-lock-causality',
            file: lockCausalityIssues[0]?.file || null,
            line: lockCausalityIssues[0]?.line || null,
        });
    }

    const dashboardSignals = detectDashboardRuntimePolicySignals(process.cwd());
    for (const dashboardSignal of dashboardSignals) {
        signals.push(dashboardSignal);
    }
    const missionTransitionSignals = detectMissionTransitionBypass(process.cwd());
    for (const missionSignal of missionTransitionSignals) {
        signals.push(missionSignal);
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

function detectLockReleaseCausalityIssues(rootDir) {
    const targets = [
        'src/agent/queue_worker.js',
        'src/agent/task_state_projector.js',
    ];
    const pattern = /releaseTaskLock\s*\(\s*\{\s*taskId\s*\}\s*\)/g;
    const issues = [];

    for (const rel of targets) {
        const fullPath = path.join(rootDir, rel);
        if (!fs.existsSync(fullPath)) continue;
        const content = fs.readFileSync(fullPath, 'utf8');
        const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
        let match;
        while ((match = regex.exec(content)) !== null) {
            const line = content.slice(0, Number(match.index || 0)).split('\n').length;
            const evidence = content.split('\n')[Math.max(0, line - 1)]?.trim() || String(match[0] || pattern.source);
            issues.push({ file: rel, line, evidence });
        }
    }

    return issues;
}

function detectDashboardRuntimePolicySignals(rootDir) {
    const results = [];
    const dashboardControllerPath = path.join(rootDir, 'src/server/api/controllers/dashboard.js');
    const socketPath = path.join(rootDir, 'src/server/engine/socket.js');
    const serverMainPath = path.join(rootDir, 'src/server/main.js');

    try {
        if (fs.existsSync(dashboardControllerPath)) {
            const content = fs.readFileSync(dashboardControllerPath, 'utf8');
            if (/admin123|user123|const\s+validUsers\s*=\s*\{/g.test(content)) {
                results.push({
                    signal: 'dashboard_auth_insecure',
                    evidence: 'Credenciais hardcoded detectadas em dashboard auth controller.',
                    source_tool: 'runtime-dashboard-auth',
                    file: 'src/server/api/controllers/dashboard.js',
                    line: null,
                });
            }
        }
    } catch {}

    try {
        if (fs.existsSync(socketPath)) {
            const content = fs.readFileSync(socketPath, 'utf8');
            const hasCommandEmit = /internalEmitter\.emit\(\s*['"]dashboard:command['"]/.test(content);
            const hasCommandGate = /DASHBOARD_COMMANDS_ENABLED|COMMAND_CHANNEL_DISABLED/.test(content);
            const hasRoleGate = /DASHBOARD_COMMAND_ROLE|COMMAND_FORBIDDEN/.test(content);
            const hasSocketAuthGate = /DASHBOARD_SOCKET_AUTH_REQUIRED|dashboard:auth:error/.test(content);

            if (hasCommandEmit && (!hasCommandGate || !hasRoleGate || !hasSocketAuthGate)) {
                results.push({
                    signal: 'dashboard_socket_command_unsafe',
                    evidence: 'Canal dashboard:command detectado sem gate completo de auth/authz.',
                    source_tool: 'runtime-dashboard-socket',
                    file: 'src/server/engine/socket.js',
                    line: null,
                });
            }
        }
    } catch {}

    try {
        if (fs.existsSync(serverMainPath)) {
            const content = fs.readFileSync(serverMainPath, 'utf8');
            const startsSsotFeed = /ssotEventFeed\.start\s*\(/.test(content);
            const hasLegacyBridgeInit = /taskSyncBridge\s*&&\s*typeof\s+taskSyncBridge\.initialize/.test(content);
            const hasLegacyModeGate = /dashboardTaskSyncMode\s*===\s*['"]legacy_bridge['"]/.test(content);
            const hasContingencyGate = /DASHBOARD_LEGACY_BRIDGE_CONTINGENCY/.test(content);
            const startsLegacyBridgeWithoutContingency = hasLegacyBridgeInit && hasLegacyModeGate && !hasContingencyGate;

            if (startsSsotFeed && startsLegacyBridgeWithoutContingency) {
                results.push({
                    signal: 'dashboard_dual_feed',
                    evidence: 'Inicialização potencial de feed SSOT e bridge legacy sem gate de modo.',
                    source_tool: 'runtime-dashboard-realtime',
                    file: 'src/server/main.js',
                    line: null,
                });
            }
        }
    } catch {}

    return results;
}

function detectMissionTransitionBypass(rootDir) {
    const results = [];
    const targets = [
        'src/server/api/controllers/missions.js',
        'src/agent/mission_runner.js',
    ];
    const statusMutationPattern = /updateMission\s*\([^)]*$/gm;

    for (const relPath of targets) {
        const fullPath = path.join(rootDir, relPath);
        if (!fs.existsSync(fullPath)) {
            continue;
        }

        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            if (!statusMutationPattern.test(line)) {
                statusMutationPattern.lastIndex = 0;
                continue;
            }
            statusMutationPattern.lastIndex = 0;

            const window = lines.slice(i, Math.min(lines.length, i + 12)).join('\n');
            if (!/status\s*:/.test(window)) {
                continue;
            }

            results.push({
                signal: 'runtime.mission_transition_bypass.detected',
                evidence: `${relPath}:${i + 1} updateMission com status detectado fora de mission_execution_service`,
                source_tool: 'runtime-mission-transition',
                file: relPath,
                line: i + 1,
            });
        }
    }

    return results;
}
