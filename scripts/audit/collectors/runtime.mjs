// @ts-check
import { parseJsonFromMixedOutput, runCommand } from '../lib/exec.mjs';
import { evaluateRuntimeSignals } from '../contracts/evaluate_runtime.mjs';
import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {import('../normalize/findings.mjs').RawFinding} RawFinding
 */

/**
 * @typedef {object} CollectRuntimeFindingsOptions
 * @property {'quick'|'deep'|'nightly'} profile
 * @property {import('../contracts/load_registry.mjs').ContractDefinitionV1[]} contracts
 * @property {(stepId: string} exec
 * @property {string} command
 * @property {string[]} args
 * @property {unknown) => Promise<void>} options
 */
/**
 * @param {CollectRuntimeFindingsOptions} options
 * @returns {Promise<{ findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>, telemetry: { mcp: { ok: boolean, details?: string }, rag: { ok: boolean, available?: boolean|null, degraded?: boolean|null }, lsp: { ok: boolean, details?: string } } }>}
 */
export async function collectRuntimeFindings(options) {
    /** @type {RawFinding[]} */
    const findings = [];
    /** @type {Array<{source:string,message:string}>} */
    const errors = [];
    /** @type {Array<{source:string,message:string}>} */
    const warnings = [];

    const exec = options.exec || (async (_stepId, command, args, runOpts) => runCommand(command, args, runOpts));

    const telemetry = {
        mcp: { ok: false, details: '' },
        rag: { ok: false, available: null, degraded: null },
        lsp: { ok: false, details: '' },
    };
    /** @type {Array<{ signal: string, evidence: string, source_tool: string, file?: string|null, line?: number|null }>} */
    const signals = [];

    const mcpDiag = await exec('runtime.mcp_diagnose', 'npm', ['run', 'mcp:diagnose', '--', '--json'], {
        timeoutMs: 180000,
    });
    const mcpJson =
        parseJsonFromMixedOutput(mcpDiag.stdout) || parseJsonFromMixedOutput(`${mcpDiag.stdout}\n${mcpDiag.stderr}`);
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

    const ragHealth = await exec('runtime.rag_health', 'npm', ['run', 'rag:health', '--', '--json'], {
        timeoutMs: 180000,
    });
    const ragJson =
        parseJsonFromMixedOutput(ragHealth.stdout) ||
        parseJsonFromMixedOutput(`${ragHealth.stdout}\n${ragHealth.stderr}`);
    const ragOkFromText = /"ok"\s*:\s*true/.test(String(ragHealth.stdout || ''));
    const ragAvailableFromText = /"available"\s*:\s*true/.test(String(ragHealth.stdout || ''));

    telemetry.rag.ok = Boolean(ragHealth.ok && (ragJson?.ok === true || ragOkFromText));
    telemetry.rag.available =
        ragJson && Object.prototype.hasOwnProperty.call(ragJson, 'available')
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

    const lspHealth = await exec('runtime.lsp_health', 'npm', ['run', 'lsp:health', '--', '--json'], {
        timeoutMs: 180000,
    });
    const lspJson =
        parseJsonFromMixedOutput(lspHealth.stdout) ||
        parseJsonFromMixedOutput(`${lspHealth.stdout}\n${lspHealth.stderr}`);
    const hasLspTools = Boolean(
        lspJson && Object.prototype.hasOwnProperty.call(lspJson, 'lsp_tools_present')
            ? lspJson.lsp_tools_present
            : mcpJson?.lsp_tools_present
    );
    const lspFunctionalOk = Boolean(
        lspJson && Object.prototype.hasOwnProperty.call(lspJson, 'lsp_functional_ok')
            ? lspJson.lsp_functional_ok
            : mcpJson?.lsp_functional_ok
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
    const controlPlaneSignals = detectControlPlaneSignals(process.cwd());
    for (const controlSignal of controlPlaneSignals) {
        signals.push(controlSignal);
    }
    const bootAndLifecycleSignals = await detectBootAndLifecycleSignals(process.cwd(), exec);
    for (const signal of bootAndLifecycleSignals) {
        signals.push(signal);
    }

    if (options.profile !== 'quick') {
        const smoke = await exec(
            'runtime.smoke',
            'node',
            [
                '--test',
                'tests/regression/test_wave10_lifecycle_signal_matrix.spec.js',
                'tests/regression/test_wave11_main_server_bootstrap_unification.spec.js',
            ],
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

    const runtimeFindings = /** @type {RawFinding[]} */ (
        evaluateRuntimeSignals({
            contracts: options.contracts || [],
            signals,
        })
    );
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
    const targets = ['src/agent/queue_worker.js', 'src/agent/task_state_projector.js'];
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
            const startsLegacyBridgeWithoutContingency =
                hasLegacyBridgeInit && hasLegacyModeGate && !hasContingencyGate;

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
    const targets = ['src/server/api/controllers/missions.js', 'src/agent/mission_runner.js'];
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

function detectControlPlaneSignals(rootDir) {
    const results = [];
    const controlServicePath = path.join(rootDir, 'src/server/domain/control_command_service.js');
    const missionControllerPath = path.join(rootDir, 'src/server/api/controllers/missions.js');
    const taskControllerPath = path.join(rootDir, 'src/server/api/controllers/tasks.js');
    const missionControlPath = path.join(rootDir, 'src/server/domain/mission_control_service.js');
    const taskControlPath = path.join(rootDir, 'src/server/domain/task_control_service.js');
    const authPath = path.join(rootDir, 'src/server/middleware/authorize.js');
    const dashboardTasksControllerPath = path.join(rootDir, 'src/server/api/controllers/dashboard_tasks.js');
    const taskViewsPath = path.join(rootDir, 'src/server/api/utils/task_views.js');
    const ssotRealtimePath = path.join(rootDir, 'src/dashboard-ui/src/composables/useSsotRealtime.js');
    const dashboardVnextTargets = [
        'src/dashboard-ui/src/views/TasksView.vue',
        'src/dashboard-ui/src/views/TaskDetail.vue',
        'src/dashboard-ui/src/views/MissionDetail.vue',
        'src/dashboard-ui/src/views/Missions.vue',
        'src/dashboard-ui/src/stores/tasks_vnext.js',
        'src/dashboard-ui/src/stores/missions_vnext.js',
    ];

    try {
        if (!fs.existsSync(controlServicePath)) {
            results.push({
                signal: 'runtime.control.single_entrypoint.failed',
                evidence: 'control_command_service ausente.',
                source_tool: 'runtime-control-plane',
                file: 'src/server/domain/control_command_service.js',
                line: null,
            });
        } else {
            const controlContent = fs.readFileSync(controlServicePath, 'utf8');
            if (!/COMMANDS/.test(controlContent) || !/executeCommand/.test(controlContent)) {
                results.push({
                    signal: 'runtime.control.single_entrypoint.failed',
                    evidence: 'control_command_service sem contrato mínimo (COMMANDS/executeCommand).',
                    source_tool: 'runtime-control-plane',
                    file: 'src/server/domain/control_command_service.js',
                    line: null,
                });
            }
            if (
                !/CONTROL_REQUIRE_REASON/.test(controlContent) ||
                !/CONTROL_REQUIRE_IDEMPOTENCY_KEY/.test(controlContent)
            ) {
                results.push({
                    signal: 'runtime.control.reason_idempotency.failed',
                    evidence: 'Guarda de reason/idempotency não detectada no control_command_service.',
                    source_tool: 'runtime-control-plane',
                    file: 'src/server/domain/control_command_service.js',
                    line: null,
                });
            }
        }
    } catch {}

    try {
        const missionControllerContent = fs.existsSync(missionControllerPath)
            ? fs.readFileSync(missionControllerPath, 'utf8')
            : '';
        const taskControllerContent = fs.existsSync(taskControllerPath)
            ? fs.readFileSync(taskControllerPath, 'utf8')
            : '';
        const missionUsesControl = /executeCommand/.test(missionControllerContent);
        const taskUsesControl = /executeCommand/.test(taskControllerContent);
        if (!missionUsesControl || !taskUsesControl) {
            results.push({
                signal: 'runtime.control.single_entrypoint.failed',
                evidence: 'Controllers de missão/task não delegam integralmente ao control_command_service.',
                source_tool: 'runtime-control-plane',
                file: !missionUsesControl
                    ? 'src/server/api/controllers/missions.js'
                    : 'src/server/api/controllers/tasks.js',
                line: null,
            });
        }
    } catch {}

    try {
        const missionControlContent = fs.existsSync(missionControlPath)
            ? fs.readFileSync(missionControlPath, 'utf8')
            : '';
        const taskControlContent = fs.existsSync(taskControlPath) ? fs.readFileSync(taskControlPath, 'utf8') : '';
        const hasMissionPauseGuard = /MISSION_EDIT_REQUIRES_PAUSED|EDITABLE_MISSION/.test(missionControlContent);
        const hasTaskPauseGuard = /TASK_EDIT_REQUIRES_PAUSED|_assertPauseToEditTask/.test(taskControlContent);
        if (!hasMissionPauseGuard || !hasTaskPauseGuard) {
            results.push({
                signal: 'runtime.control.pause_to_edit.failed',
                evidence: 'Guardas pause-to-edit não detectadas em mission/task control service.',
                source_tool: 'runtime-control-plane',
                file: !hasMissionPauseGuard
                    ? 'src/server/domain/mission_control_service.js'
                    : 'src/server/domain/task_control_service.js',
                line: null,
            });
        }

        const hasTaskReassignStateGuard =
            /TASK_REASSIGN_REQUIRES_PAUSED_OR_READY_NOT_STARTED/.test(taskControlContent) &&
            /reassignTaskMissionCommand/.test(taskControlContent);
        const hasTaskReassignPatchGuard = /TASK_MISSION_REASSIGN_USE_COMMAND/.test(taskControlContent);
        if (!hasTaskReassignStateGuard || !hasTaskReassignPatchGuard) {
            results.push({
                signal: 'runtime.task_reassign.state_guard.failed',
                evidence: 'Guardas de reassign mission (estado elegível + patch guard) não detectadas.',
                source_tool: 'runtime-task-control',
                file: 'src/server/domain/task_control_service.js',
                line: null,
            });
        }
    } catch {}

    try {
        const authContent = fs.existsSync(authPath) ? fs.readFileSync(authPath, 'utf8') : '';
        if (!/hasPermission/.test(authContent) && !/Permissão insuficiente/.test(authContent)) {
            results.push({
                signal: 'runtime.control.rbac_deny_default.failed',
                evidence: 'Middleware de autorização sem deny-by-default detectado.',
                source_tool: 'runtime-rbac',
                file: 'src/server/middleware/authorize.js',
                line: null,
            });
        }
    } catch {}

    try {
        const directMutationPattern = /http\.(post|patch|put)\(\s*['"`]\/api\/tasks/g;
        const directMissionMutationPattern = /http\.(post|patch|put|delete)\(\s*['"`]\/api\/missions/g;
        for (const relPath of dashboardVnextTargets) {
            const absPath = path.join(rootDir, relPath);
            if (!fs.existsSync(absPath)) continue;
            const content = fs.readFileSync(absPath, 'utf8');
            const match = directMutationPattern.exec(content);
            directMutationPattern.lastIndex = 0;
            if (match) {
                const line = content.slice(0, Number(match.index || 0)).split('\n').length;
                results.push({
                    signal: 'runtime.dashboard_vnext.direct_tasks_mutation.failed',
                    evidence: `${relPath}:${line} mutação direta /api/tasks detectada em rota ativa vNext.`,
                    source_tool: 'runtime-dashboard-vnext-cutover',
                    file: relPath,
                    line,
                });
                break;
            }

            const missionMatch = directMissionMutationPattern.exec(content);
            directMissionMutationPattern.lastIndex = 0;
            if (missionMatch) {
                const line = content.slice(0, Number(missionMatch.index || 0)).split('\n').length;
                results.push({
                    signal: 'runtime.dashboard_vnext.direct_missions_mutation.failed',
                    evidence: `${relPath}:${line} mutação direta /api/missions detectada em rota ativa vNext.`,
                    source_tool: 'runtime-dashboard-vnext-cutover',
                    file: relPath,
                    line,
                });
                break;
            }
        }
    } catch {}

    try {
        const dashboardTasksContent = fs.existsSync(dashboardTasksControllerPath)
            ? fs.readFileSync(dashboardTasksControllerPath, 'utf8')
            : '';
        const taskViewsContent = fs.existsSync(taskViewsPath) ? fs.readFileSync(taskViewsPath, 'utf8') : '';
        const hasMissionJoin = /LEFT JOIN missions/.test(dashboardTasksContent);
        const hasMissionContext = /include\.has\('mission_context'\)/.test(dashboardTasksContent);
        const hasMissionRefAndCaps = /mission_ref/.test(taskViewsContent) && /command_caps/.test(taskViewsContent);
        if (!hasMissionJoin || !hasMissionContext || !hasMissionRefAndCaps) {
            results.push({
                signal: 'runtime.task_mission_drift.failed',
                evidence: 'Contrato de contexto enriquecido task↔mission não detectado por completo.',
                source_tool: 'runtime-dashboard-task-mission-context',
                file:
                    !hasMissionJoin || !hasMissionContext
                        ? 'src/server/api/controllers/dashboard_tasks.js'
                        : 'src/server/api/utils/task_views.js',
                line: null,
            });
        }
    } catch {}

    try {
        const ssotRealtimeContent = fs.existsSync(ssotRealtimePath) ? fs.readFileSync(ssotRealtimePath, 'utf8') : '';
        const hasBatchBuffer = /pendingTaskBatches|scheduleFlush|REALTIME_FLUSH_MS/.test(ssotRealtimeContent);
        const hasCursorGuard = /_coerceEventCursor|incomingCursor\s*<\s*lastCursor/.test(ssotRealtimeContent);
        const hasEventDedup = /seenEventIds|_compactEvents/.test(ssotRealtimeContent);
        if (!hasBatchBuffer || !hasCursorGuard || !hasEventDedup) {
            results.push({
                signal: 'runtime.realtime.cursor_dedup.failed',
                evidence: 'useSsotRealtime sem dedupe/reconciliação por cursor/event_id completo.',
                source_tool: 'runtime-dashboard-realtime',
                file: 'src/dashboard-ui/src/composables/useSsotRealtime.js',
                line: null,
            });
        }
    } catch {}

    return results;
}

/**
 * @param {string} rootDir
 * @param {(stepId: string, command: string, args: string[], options?: unknown) => Promise<void>} exec
 */
async function detectBootAndLifecycleSignals(rootDir, exec) {
    const results = [];

    try {
        const mainImport = await exec(
            'runtime.wave20b_main_import_daemon_env',
            'node',
            ['--input-type=module', '-e', "import './src/main.js'; console.log('OK')"],
            {
                cwd: rootDir,
                timeoutMs: 4000,
                env: {
                    DAEMON_MODE: 'true',
                    MAESTRO_ENTRY_AUTOSTART: 'false',
                },
            }
        );

        const mainOutput = `${mainImport.stdout || ''}\n${mainImport.stderr || ''}`;
        const mainHasBootNoise = /\[BOOT\]|Iniciando boot sequence|MISSION CONTROL PRIME ONLINE/i.test(mainOutput);
        if (!mainImport.ok || mainImport.timedOut || mainHasBootNoise) {
            results.push({
                signal: 'boot_import_side_effect',
                evidence: `main import com DAEMON_MODE=true apresentou side effects (ok=${mainImport.ok}, timedOut=${mainImport.timedOut})`,
                source_tool: 'runtime-wave20b-import-safety',
                file: 'src/main.js',
                line: null,
            });
        }
    } catch {}

    try {
        const serverImport = await exec(
            'runtime.wave20b_server_import_pm2_env',
            'node',
            ['--input-type=module', '-e', "import './src/server/main.js'; console.log('OK')"],
            {
                cwd: rootDir,
                timeoutMs: 4000,
                env: {
                    NODE_APP_INSTANCE: '0',
                    PM2_JSON_PROCESSING: 'true',
                    PM2_HOME: '/tmp/pm2',
                    pm_exec_path: '/tmp/not-server-main.js',
                    MAESTRO_ENTRY_AUTOSTART: 'false',
                },
            }
        );

        const serverOutput = `${serverImport.stdout || ''}\n${serverImport.stderr || ''}`;
        const serverHasBootNoise = /\[BOOT\]|Canonical Bootstrap|MISSION CONTROL PRIME ONLINE/i.test(serverOutput);
        if (!serverImport.ok || serverImport.timedOut || serverHasBootNoise) {
            results.push({
                signal: 'boot_import_side_effect',
                evidence: `server import com env PM2 simulada apresentou side effects (ok=${serverImport.ok}, timedOut=${serverImport.timedOut})`,
                source_tool: 'runtime-wave20b-import-safety',
                file: 'src/server/main.js',
                line: null,
            });
        }
    } catch {}

    try {
        const wrapperPath = path.join(rootDir, 'scripts/chrome-proxy-service.js');
        const wrapperContent = fs.existsSync(wrapperPath) ? fs.readFileSync(wrapperPath, 'utf8') : '';
        const hasBroadListenerCleanup = /removeAllListeners\s*\(/.test(wrapperContent);
        const hasAutoHandleSignalsFalse = /AUTO_HANDLE_SIGNALS\s*:\s*false/.test(wrapperContent);
        if (hasBroadListenerCleanup || !hasAutoHandleSignalsFalse) {
            results.push({
                signal: 'signal_ownership_conflict',
                evidence: 'chrome-proxy wrapper sem ownership exclusivo de sinais ou com cleanup global amplo.',
                source_tool: 'runtime-wave20b-signal-ownership',
                file: 'scripts/chrome-proxy-service.js',
                line: null,
            });
        }
    } catch {}

    try {
        const lifecyclePath = path.join(rootDir, 'src/server/engine/lifecycle.js');
        const registryPath = path.join(rootDir, 'src/core/runtime_resource_registry.js');
        const lifecycleContent = fs.existsSync(lifecyclePath) ? fs.readFileSync(lifecyclePath, 'utf8') : '';
        const registryContent = fs.existsSync(registryPath) ? fs.readFileSync(registryPath, 'utf8') : '';

        const hasRegistryStop = /stopRuntimeResources\s*\(/.test(lifecycleContent);
        const hasTimeoutSignal = /RESOURCE_SHUTDOWN_TIMEOUT/.test(lifecycleContent);
        const hasTimeoutRacePattern =
            /Promise\.race\s*\(\s*\[/.test(registryContent) &&
            /setTimeout\s*\(/.test(registryContent) &&
            /clearTimeout\s*\(/.test(registryContent);
        const hasTimeoutHelperPattern =
            /function\s+runWithTimeout\s*\(/.test(registryContent) &&
            /setTimeout\s*\(/.test(registryContent) &&
            /clearTimeout\s*\(/.test(registryContent);
        const hasTimeoutContract = hasTimeoutRacePattern || hasTimeoutHelperPattern;

        if (!hasRegistryStop || !hasTimeoutSignal || !hasTimeoutContract) {
            results.push({
                signal: 'resource_shutdown_timeout',
                evidence: 'Contrato de shutdown por recurso com timeout/telemetria não detectado integralmente.',
                source_tool: 'runtime-wave20b-resource-shutdown',
                file:
                    !hasRegistryStop || !hasTimeoutSignal
                        ? 'src/server/engine/lifecycle.js'
                        : 'src/core/runtime_resource_registry.js',
                line: null,
            });
        }
    } catch {}

    return results;
}
