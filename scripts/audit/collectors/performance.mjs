// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { runCommand } from '../lib/exec.mjs';

/** @import { RawFinding } from '../normalize/findings.mjs' */

/**
 * @param {string} rootDir
 * @returns {Promise<{
 *   findings: RawFinding[],
 *   errors: Array<{source:string,message:string}>,
 *   warnings: Array<{source:string,message:string}>,
 *   telemetry: { score: number|null, categories: Record<string, number> }
 * }>}
 */
export async function collectPerformanceFindings(rootDir) {
    /** @type {RawFinding[]} */
    const findings = [];
    /** @type {Array<{source:string,message:string}>} */
    const errors = [];
    /** @type {Array<{source:string,message:string}>} */
    const warnings = [];

    try {
        // Análise de complexidade ciclomática
        const complexityResult = await analyzeComplexity(rootDir);
        findings.push(...complexityResult.findings);
        errors.push(...complexityResult.errors);
        warnings.push(...complexityResult.warnings);
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-collector',
            message: `Failed to analyze complexity: ${error.message}`,
        });
    }

    try {
        // Análise de vazamentos de memória potenciais
        const memoryResult = await analyzeMemoryLeaks(rootDir);
        findings.push(...memoryResult.findings);
        errors.push(...memoryResult.errors);
        warnings.push(...memoryResult.warnings);
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-collector',
            message: `Failed to analyze memory leaks: ${error.message}`,
        });
    }

    try {
        // Análise de performance de queries
        const queryResult = await analyzeQueryPerformance(rootDir);
        findings.push(...queryResult.findings);
        errors.push(...queryResult.errors);
        warnings.push(...queryResult.warnings);
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-collector',
            message: `Failed to analyze query performance: ${error.message}`,
        });
    }

    try {
        // Análise de vazamento por Promise.race com timeout sem cancelamento
        const timeoutRaceResult = await analyzePromiseRaceTimeoutLeaks(rootDir);
        findings.push(...timeoutRaceResult.findings);
        errors.push(...timeoutRaceResult.errors);
        warnings.push(...timeoutRaceResult.warnings);
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-collector',
            message: `Failed to analyze Promise.race timeout leaks: ${error.message}`,
        });
    }

    try {
        // Análise de ownership de dispatch (Kernel SSOT via QueueWorker)
        const ownershipResult = await analyzeKernelDispatchOwnership(rootDir);
        findings.push(...ownershipResult.findings);
        errors.push(...ownershipResult.errors);
        warnings.push(...ownershipResult.warnings);
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-collector',
            message: `Failed to analyze kernel dispatch ownership: ${error.message}`,
        });
    }

    try {
        // Análise de bypass no serviço de transição de missão
        const missionTransitionResult = await analyzeMissionTransitionBypass(rootDir);
        findings.push(...missionTransitionResult.findings);
        errors.push(...missionTransitionResult.errors);
        warnings.push(...missionTransitionResult.warnings);
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-collector',
            message: `Failed to analyze mission transition bypass: ${error.message}`,
        });
    }

    try {
        // Análise de causalidade lock->attempt no unlock de task
        const lockCausalityResult = await analyzeLockReleaseCausality(rootDir);
        findings.push(...lockCausalityResult.findings);
        errors.push(...lockCausalityResult.errors);
        warnings.push(...lockCausalityResult.warnings);
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-collector',
            message: `Failed to analyze lock release causality: ${error.message}`,
        });
    }

    try {
        // Hardening dashboard auth: credenciais hardcoded
        const dashboardAuthResult = await analyzeDashboardAuthInsecure(rootDir);
        findings.push(...dashboardAuthResult.findings);
        errors.push(...dashboardAuthResult.errors);
        warnings.push(...dashboardAuthResult.warnings);
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-collector',
            message: `Failed to analyze dashboard auth hardcoding: ${error.message}`,
        });
    }

    try {
        // Import-safety: evitar timer em top-level de controller
        const dashboardImportResult = await analyzeDashboardImportSideEffects(rootDir);
        findings.push(...dashboardImportResult.findings);
        errors.push(...dashboardImportResult.errors);
        warnings.push(...dashboardImportResult.warnings);
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-collector',
            message: `Failed to analyze dashboard import side effects: ${error.message}`,
        });
    }

    try {
        // Control Plane: mutação única via command service
        const controlSingleEntrypointResult = await analyzeControlSingleEntrypoint(rootDir);
        findings.push(...controlSingleEntrypointResult.findings);
        errors.push(...controlSingleEntrypointResult.errors);
        warnings.push(...controlSingleEntrypointResult.warnings);
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-collector',
            message: `Failed to analyze control single entrypoint: ${error.message}`,
        });
    }

    try {
        // Pause-to-edit guard obrigatório em serviços de controle
        const pauseToEditResult = await analyzeControlPauseToEdit(rootDir);
        findings.push(...pauseToEditResult.findings);
        errors.push(...pauseToEditResult.errors);
        warnings.push(...pauseToEditResult.warnings);
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-collector',
            message: `Failed to analyze control pause-to-edit guards: ${error.message}`,
        });
    }

    try {
        // Cutover vNext: sem mutações diretas /api/tasks nas rotas ativas
        const vnextCutoverResult = await analyzeDashboardVNextTaskMutationCutover(rootDir);
        findings.push(...vnextCutoverResult.findings);
        errors.push(...vnextCutoverResult.errors);
        warnings.push(...vnextCutoverResult.warnings);
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-collector',
            message: `Failed to analyze dashboard vNext task mutation cutover: ${error.message}`,
        });
    }

    try {
        // Contrato de reassign mission e contexto task↔mission
        const reassignResult = await analyzeTaskMissionReassignAndContext(rootDir);
        findings.push(...reassignResult.findings);
        errors.push(...reassignResult.errors);
        warnings.push(...reassignResult.warnings);
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-collector',
            message: `Failed to analyze task mission reassign/context contracts: ${error.message}`,
        });
    }

    try {
        const bootImportSafetyResult = await analyzeBootImportSafetyAndSignalOwnership(rootDir);
        findings.push(...bootImportSafetyResult.findings);
        errors.push(...bootImportSafetyResult.errors);
        warnings.push(...bootImportSafetyResult.warnings);
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-collector',
            message: `Failed to analyze boot import safety/signal ownership: ${error.message}`,
        });
    }

    try {
        const runtimeResourceShutdownResult = await analyzeRuntimeResourceShutdownContracts(rootDir);
        findings.push(...runtimeResourceShutdownResult.findings);
        errors.push(...runtimeResourceShutdownResult.errors);
        warnings.push(...runtimeResourceShutdownResult.warnings);
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-collector',
            message: `Failed to analyze runtime resource shutdown contracts: ${error.message}`,
        });
    }

    /** @type {Record<string, number>} */
    const categories = {
        cpu: 0,
        memory: 0,
        io: 0,
        cache: 0,
        'event-loop': 0,
        'test-cost': 0,
        generic: 0,
    };

    for (const finding of findings) {
        const tool = String(finding.source_tool || '');
        if (tool.includes('complexity')) {
            categories.cpu += 1;
        } else if (tool.includes('memory')) {
            categories.memory += 1;
        } else if (tool.includes('query')) {
            categories.io += 1;
        } else if (tool.includes('timeout') || tool.includes('race')) {
            categories['event-loop'] += 1;
        } else if (tool.includes('cache')) {
            categories.cache += 1;
        } else if (tool.includes('test')) {
            categories['test-cost'] += 1;
        } else {
            categories.generic += 1;
        }
    }

    const weightedIssues =
        findings.length + errors.length * 2 + Math.max(0, categories.memory - 1) + Math.max(0, categories.cpu - 1);
    const score = Math.max(0, 100 - weightedIssues * 5);

    return {
        findings,
        errors,
        warnings,
        telemetry: {
            score,
            categories,
        },
    };
}

/**
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
async function analyzeComplexity(rootDir) {
    /** @type {any[]} */
    const findings = [];
    /** @type {any[]} */
    const errors = [];
    /** @type {any[]} */
    const warnings = [];

    try {
        // Usar eslint complexity plugin se disponível
        const eslintResult = await runCommand(
            'npx',
            ['eslint', '--format', 'json', '--rule', 'complexity: [2, 10]', 'src/'],
            /** @type {any} */ ({ cwd: rootDir })
        );

        if (eslintResult.ok && eslintResult.stdout) {
            const eslintData = JSON.parse(eslintResult.stdout);
            for (const file of eslintData) {
                for (const message of file.messages) {
                    if (message.ruleId === 'complexity') {
                        findings.push({
                            source_tool: 'performance-complexity',
                            contract_id: 'CONTRACT-PERFORMANCE-COMPLEXITY',
                            domain: 'performance',
                            file: file.filePath,
                            line: message.line,
                            evidence: `Complexidade ciclomática: ${message.message}`,
                            severity_hint: 'P2',
                            type: 'upgrade',
                            impact: 'Função com alta complexidade pode ser difícil de manter e testar.',
                            root_cause: 'Função com muitos caminhos de execução.',
                            suggested_patch: 'Refatorar função em funções menores e mais focadas.',
                            test_strategy: 'Executar eslint com regra complexity.',
                            regression_risk: 'Baixo',
                        });
                    }
                }
            }
        }
    } catch (_error) {
        // eslint não disponível ou erro
        warnings.push({
            source: 'performance-complexity',
            message: 'ESLint complexity analysis not available (optional)',
        });
    }

    return { findings, errors, warnings };
}

/**
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
async function analyzeMemoryLeaks(rootDir) {
    /** @type {any[]} */
    const findings = [];
    /** @type {any[]} */
    const errors = [];
    /** @type {any[]} */
    const warnings = [];

    try {
        // Procurar por event listeners sem cleanup
        const srcDir = path.join(rootDir, 'src');
        const files = await findJsFiles(srcDir);

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            const relativePath = path.relative(rootDir, file);

            // Detectar addEventListener sem removeEventListener correspondente
            const addListeners = (content.match(/addEventListener\s*\(/g) || []).length;
            const removeListeners = (content.match(/removeEventListener\s*\(/g) || []).length;

            if (addListeners > removeListeners && addListeners > 0) {
                findings.push({
                    source_tool: 'performance-memory',
                    contract_id: 'CONTRACT-PERFORMANCE-MEMORY-LEAK',
                    domain: 'performance',
                    file: relativePath,
                    evidence: `${addListeners} addEventListener vs ${removeListeners} removeEventListener`,
                    severity_hint: 'P1',
                    type: 'bug',
                    impact: 'Possível vazamento de memória por listeners não removidos.',
                    root_cause: 'Event listeners adicionados sem cleanup correspondente.',
                    suggested_patch: 'Implementar removeEventListener no cleanup apropriado.',
                    test_strategy: 'Análise estática de balanceamento de listeners.',
                    regression_risk: 'Médio',
                });
            }
        }
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-memory',
            message: `Failed to analyze memory leaks: ${error.message}`,
        });
    }

    return { findings, errors, warnings };
}

/**
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
async function analyzeQueryPerformance(rootDir) {
    /** @type {any[]} */
    const findings = [];
    /** @type {any[]} */
    const errors = [];
    /** @type {any[]} */
    const warnings = [];

    const srcDir = path.join(rootDir, 'src');
    const files = await findJsFiles(srcDir);

    for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        const relativePath = path.relative(rootDir, file);

        // Detectar N+1 de dados/rede em loops (evita falso-positivo de DOM querySelector)
        const loops = findPotentialNPlusOneLoops(content);
        if (loops.length > 0) {
            findings.push({
                source_tool: 'performance-query',
                contract_id: 'CONTRACT-PERFORMANCE-NPLUSONE',
                domain: 'performance',
                file: relativePath,
                evidence: `${loops.length} possíveis queries em loop`,
                severity_hint: 'P2',
                type: 'upgrade',
                impact: 'Possível problema N+1 queries afetando performance.',
                root_cause: 'Queries executadas dentro de loops.',
                suggested_patch: 'Usar batch queries ou eager loading.',
                test_strategy: 'Análise estática de queries em loops.',
                regression_risk: 'Médio',
            });
        }
    }

    return { findings, errors, warnings };
}

/**
 * Detecta Promise.race com timeout baseado em setTimeout sem clearTimeout.
 *
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
async function analyzePromiseRaceTimeoutLeaks(rootDir) {
    /** @type {any[]} */
    const findings = [];
    /** @type {any[]} */
    const errors = [];
    /** @type {any[]} */
    const warnings = [];

    try {
        const srcDir = path.join(rootDir, 'src');
        const files = await findJsFiles(srcDir);

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            const relativePath = path.relative(rootDir, file);
            const races = findPromiseRaceTimeoutWithoutCleanup(content);

            for (const race of races) {
                findings.push({
                    source_tool: 'performance-timeout-race',
                    contract_id: 'CONTRACT-RUNTIME-PROMISE-RACE-TIMEOUT-CLEANUP',
                    domain: 'runtime',
                    file: relativePath,
                    line: race.line,
                    evidence: race.evidence,
                    severity_hint: 'P1',
                    type: 'bug',
                    impact: 'Timer pode permanecer pendente após Promise.race, gerando ruído e degradação sob carga.',
                    root_cause: 'Timeout criado sem clearTimeout no caminho de sucesso/falha.',
                    suggested_patch: 'Substituir por helper cancelável (_withTimeout) ou limpar timer explicitamente.',
                    test_strategy: 'Executar testes de burst e validar ausência de timers residuais.',
                    regression_risk: 'Médio',
                });
            }
        }
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-timeout-race',
            message: `Failed to detect Promise.race timeout leaks: ${error.message}`,
        });
    }

    return { findings, errors, warnings };
}

/**
 * Detecta dispatch direto de task no Kernel fora do QueueWorker (SSOT owner).
 *
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
async function analyzeKernelDispatchOwnership(rootDir) {
    /** @type {any[]} */
    const findings = [];
    /** @type {any[]} */
    const errors = [];
    /** @type {any[]} */
    const warnings = [];

    try {
        const srcDir = path.join(rootDir, 'src');
        const files = await findJsFiles(srcDir);
        const allowDirectDispatch = new Set(['src/agent/queue_worker.js', 'src/missions/mission_manager.js']);
        const pattern = /\b(?:this\.)?kernel\.executeTask\s*\(/g;

        for (const file of files) {
            const relativePath = path.relative(rootDir, file).split(path.sep).join('/');
            if (allowDirectDispatch.has(relativePath)) {
                continue;
            }

            const content = fs.readFileSync(file, 'utf8');
            for (const match of findRegexMatchesWithLine(content, pattern)) {
                findings.push({
                    source_tool: 'performance-kernel-ownership',
                    contract_id: 'CONTRACT-ARCH-SSOT-EXECUTION-OWNER',
                    domain: 'architecture',
                    file: relativePath,
                    line: match.line,
                    evidence: match.evidence,
                    severity_hint: 'P1',
                    type: 'bug',
                    impact: 'Dispatch direto fora do QueueWorker viola ownership SSOT e aumenta risco de execução paralela.',
                    root_cause: 'Chamada direta para kernel.executeTask em caminho não autorizado.',
                    suggested_patch:
                        'Enfileirar via insertTask + QueueWorker, mantendo Kernel como executor único por fila.',
                    test_strategy: 'Executar lint de ownership + testes de integração de missão/fila.',
                    regression_risk: 'Alto',
                });
            }
        }
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-kernel-ownership',
            message: `Failed to detect kernel dispatch ownership violations: ${error.message}`,
        });
    }

    return { findings, errors, warnings };
}

/**
 * Detecta unlock sem causalidade de attempt em pontos críticos (queue/projector).
 *
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
async function analyzeLockReleaseCausality(rootDir) {
    /** @type {any[]} */
    const findings = [];
    /** @type {any[]} */
    const errors = [];
    /** @type {any[]} */
    const warnings = [];

    const targets = ['src/agent/queue_worker.js', 'src/agent/task_state_projector.js'];

    const pattern = /releaseTaskLock\s*\(\s*\{\s*taskId\s*\}\s*\)/g;

    try {
        for (const relPath of targets) {
            const absolutePath = path.join(rootDir, relPath);
            if (!fs.existsSync(absolutePath)) {
                continue;
            }
            const content = fs.readFileSync(absolutePath, 'utf8');
            for (const match of findRegexMatchesWithLine(content, pattern)) {
                findings.push({
                    source_tool: 'performance-lock-causality',
                    contract_id: 'CONTRACT-RUNTIME-LOCK-RELEASE-ATTEMPT-CAUSALITY',
                    domain: 'runtime',
                    file: relPath,
                    line: match.line,
                    evidence: match.evidence,
                    severity_hint: 'P1',
                    type: 'bug',
                    impact: 'Unlock sem vínculo de attempt pode liberar lease de execução ativa por corrida.',
                    root_cause: 'releaseTaskLock chamado sem expectedAttemptId no caminho crítico.',
                    suggested_patch: 'Usar helper de unlock causal (releaseTaskLockForAttempt).',
                    test_strategy: 'Executar testes de stale-attempt/lock-causality e auditoria quick.',
                    regression_risk: 'Alto',
                });
            }
        }
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-lock-causality',
            message: `Failed to detect lock release causality violations: ${error.message}`,
        });
    }

    return { findings, errors, warnings };
}

/**
 * Detecta mutação de status de missão fora do serviço de domínio único.
 *
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
async function analyzeMissionTransitionBypass(rootDir) {
    /** @type {any[]} */
    const findings = [];
    /** @type {any[]} */
    const errors = [];
    /** @type {any[]} */
    const warnings = [];
    const targets = ['src/server/api/controllers/missions.js', 'src/agent/mission_runner.js'];

    try {
        for (const relPath of targets) {
            const absolutePath = path.join(rootDir, relPath);
            if (!fs.existsSync(absolutePath)) continue;

            const content = fs.readFileSync(absolutePath, 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i += 1) {
                if (!/updateMission\s*\(/.test(lines[i])) {
                    continue;
                }
                const window = lines.slice(i, Math.min(i + 12, lines.length)).join('\n');
                if (!/status\s*:/.test(window)) {
                    continue;
                }
                findings.push({
                    source_tool: 'performance-mission-transition',
                    contract_id: 'CONTRACT-RUNTIME-MISSION-TRANSITION-SERVICE',
                    domain: 'runtime',
                    file: relPath,
                    line: i + 1,
                    evidence: lines[i].trim(),
                    severity_hint: 'P1',
                    type: 'bug',
                    impact: 'Mutação de status fora do serviço único pode causar drift de regras entre controller/runner.',
                    root_cause: 'updateMission(status=...) chamado diretamente sem mission_execution_service.',
                    suggested_patch:
                        'Encaminhar transição para mission_execution_service com precondições e evento padronizado.',
                    test_strategy: 'Executar regressão wave17 de serviço único de transição.',
                    regression_risk: 'Alto',
                });
            }
        }
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-mission-transition',
            message: `Failed to detect mission transition bypass: ${error.message}`,
        });
    }

    return { findings, errors, warnings };
}

/**
 * Detecta credenciais hardcoded na autenticação do dashboard.
 *
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
async function analyzeDashboardAuthInsecure(rootDir) {
    /** @type {any[]} */
    const findings = [];
    /** @type {any[]} */
    const errors = [];
    /** @type {any[]} */
    const warnings = [];

    const relPath = 'src/server/api/controllers/dashboard.js';
    const absolutePath = path.join(rootDir, relPath);

    try {
        if (!fs.existsSync(absolutePath)) {
            return { findings, errors, warnings };
        }

        const content = fs.readFileSync(absolutePath, 'utf8');
        const pattern = /admin123|user123|const\s+validUsers\s*=\s*\{/g;
        for (const match of findRegexMatchesWithLine(content, pattern)) {
            findings.push({
                source_tool: 'performance-dashboard-auth',
                contract_id: 'CONTRACT-ARCH-DASHBOARD-AUTH-NO-HARDCODED',
                domain: 'architecture',
                file: relPath,
                line: match.line,
                evidence: match.evidence,
                severity_hint: 'P1',
                type: 'bug',
                impact: 'Credenciais hardcoded expõem autenticação do dashboard.',
                root_cause: 'Auth com usuários/senhas embutidos em código.',
                suggested_patch: 'Mover autenticação para env obrigatória + validação de boot.',
                test_strategy: 'Executar regressão de auth hardcoded da wave16r.',
                regression_risk: 'Alto',
            });
        }
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-dashboard-auth',
            message: `Failed to analyze dashboard auth hardcoding: ${error.message}`,
        });
    }

    return { findings, errors, warnings };
}

/**
 * Detecta side-effect de timer em import de controller dashboard.
 *
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
async function analyzeDashboardImportSideEffects(rootDir) {
    /** @type {any[]} */
    const findings = [];
    /** @type {any[]} */
    const errors = [];
    /** @type {any[]} */
    const warnings = [];

    const relPath = 'src/server/api/controllers/dashboard.js';
    const absolutePath = path.join(rootDir, relPath);

    try {
        if (!fs.existsSync(absolutePath)) {
            return { findings, errors, warnings };
        }

        const content = fs.readFileSync(absolutePath, 'utf8');
        const pattern = /^\s*startPeriodicCleanup\s*\(/gm;
        for (const match of findRegexMatchesWithLine(content, pattern)) {
            findings.push({
                source_tool: 'performance-dashboard-import',
                contract_id: 'CONTRACT-ARCH-DASHBOARD-CONTROLLER-NO-TOPLEVEL-TIMER',
                domain: 'architecture',
                file: relPath,
                line: match.line,
                evidence: match.evidence,
                severity_hint: 'P1',
                type: 'bug',
                impact: 'Import do controller cria timer e quebra import-safety.',
                root_cause: 'startPeriodicCleanup executado no top-level do módulo.',
                suggested_patch: 'Iniciar cleanup no bootstrap e parar no lifecycle.',
                test_strategy: 'Executar regressão de import sem timer side-effect.',
                regression_risk: 'Médio',
            });
        }
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-dashboard-import',
            message: `Failed to analyze dashboard import side effects: ${error.message}`,
        });
    }

    return { findings, errors, warnings };
}

/**
 * Detecta mutações diretas em controllers sem delegação via control_command_service.
 *
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
async function analyzeControlSingleEntrypoint(rootDir) {
    /** @type {any[]} */
    const findings = [];
    /** @type {any[]} */
    const errors = [];
    /** @type {any[]} */
    const warnings = [];

    const targets = ['src/server/api/controllers/missions.js', 'src/server/api/controllers/tasks.js'];
    const directMutationPattern = /updateTask\s*\(|updateMission\s*\(|insertTask\s*\(/g;

    try {
        for (const relPath of targets) {
            const absolutePath = path.join(rootDir, relPath);
            if (!fs.existsSync(absolutePath)) continue;

            const content = fs.readFileSync(absolutePath, 'utf8');
            const usesCommandService = /executeCommand/.test(content);
            if (!usesCommandService) {
                findings.push({
                    source_tool: 'performance-control-plane',
                    contract_id: 'CONTRACT-ARCH-CONTROL-COMMAND-SINGLE-ENTRYPOINT',
                    domain: 'architecture',
                    file: relPath,
                    line: null,
                    evidence: 'Controller sem executeCommand detectado.',
                    severity_hint: 'P1',
                    type: 'bug',
                    impact: 'Mutações fora do command service aumentam drift de regra de negócio.',
                    root_cause: 'Controller ainda muta estado sem control plane.',
                    suggested_patch: 'Delegar mutações para /api/control/commands.',
                    test_strategy: 'Executar regressões wave18 + audit:quick.',
                    regression_risk: 'Alto',
                });
            }

            for (const match of findRegexMatchesWithLine(content, directMutationPattern)) {
                findings.push({
                    source_tool: 'performance-control-plane',
                    contract_id: 'CONTRACT-ARCH-CONTROL-COMMAND-SINGLE-ENTRYPOINT',
                    domain: 'architecture',
                    file: relPath,
                    line: match.line,
                    evidence: match.evidence,
                    severity_hint: 'P1',
                    type: 'bug',
                    impact: 'Mutação direta no controller pode burlar invariantes do control plane.',
                    root_cause: 'Uso direto de updateTask/updateMission/insertTask em camada de API.',
                    suggested_patch: 'Encapsular mutação em comando do control_command_service.',
                    test_strategy: 'Executar testes de comando único e auditoria quick.',
                    regression_risk: 'Alto',
                });
            }
        }
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-control-plane',
            message: `Failed to analyze control single entrypoint: ${error.message}`,
        });
    }

    return { findings, errors, warnings };
}

/**
 * Detecta ausência de guardas pause-to-edit nos serviços de controle.
 *
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
async function analyzeControlPauseToEdit(rootDir) {
    /** @type {any[]} */
    const findings = [];
    /** @type {any[]} */
    const errors = [];
    /** @type {any[]} */
    const warnings = [];

    const missionControlPath = path.join(rootDir, 'src/server/domain/mission_control_service.js');
    const taskControlPath = path.join(rootDir, 'src/server/domain/task_control_service.js');

    try {
        if (fs.existsSync(missionControlPath)) {
            const content = fs.readFileSync(missionControlPath, 'utf8');
            if (!/MISSION_EDIT_REQUIRES_PAUSED|EDITABLE_MISSION/.test(content)) {
                findings.push({
                    source_tool: 'performance-control-pause-edit',
                    contract_id: 'CONTRACT-RUNTIME-CONTROL-PAUSE-TO-EDIT',
                    domain: 'runtime',
                    file: 'src/server/domain/mission_control_service.js',
                    line: null,
                    evidence: 'Guard pause-to-edit de missão não detectado.',
                    severity_hint: 'P1',
                    type: 'bug',
                    impact: 'Missões podem ser editadas em execução.',
                    root_cause: 'Ausência de guarda READY/PAUSED em edição.',
                    suggested_patch: 'Exigir READY/PAUSED para mutações de missão.',
                    test_strategy: 'Executar testes wave18 de pause-to-edit.',
                    regression_risk: 'Alto',
                });
            }
        }

        if (fs.existsSync(taskControlPath)) {
            const content = fs.readFileSync(taskControlPath, 'utf8');
            if (!/TASK_EDIT_REQUIRES_PAUSED|_assertPauseToEditTask/.test(content)) {
                findings.push({
                    source_tool: 'performance-control-pause-edit',
                    contract_id: 'CONTRACT-RUNTIME-CONTROL-PAUSE-TO-EDIT',
                    domain: 'runtime',
                    file: 'src/server/domain/task_control_service.js',
                    line: null,
                    evidence: 'Guard pause-to-edit de task não detectado.',
                    severity_hint: 'P1',
                    type: 'bug',
                    impact: 'Tasks podem sofrer edição livre sem pausa.',
                    root_cause: 'Ausência de guarda de edição para task.',
                    suggested_patch: 'Validar status PAUSED/READY antes de patch.',
                    test_strategy: 'Executar testes wave18 de pause-to-edit.',
                    regression_risk: 'Alto',
                });
            }
        }
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-control-pause-edit',
            message: `Failed to analyze control pause-to-edit guards: ${error.message}`,
        });
    }

    return { findings, errors, warnings };
}

/**
 * Detecta chamadas diretas de mutação /api/tasks e /api/missions em views/stores vNext.
 *
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
async function analyzeDashboardVNextTaskMutationCutover(rootDir) {
    /** @type {any[]} */
    const findings = [];
    /** @type {any[]} */
    const errors = [];
    /** @type {any[]} */
    const warnings = [];
    const targets = [
        'src/dashboard-ui/src/views/TasksView.vue',
        'src/dashboard-ui/src/views/TaskDetail.vue',
        'src/dashboard-ui/src/views/MissionDetail.vue',
        'src/dashboard-ui/src/stores/tasks_vnext.js',
        'src/dashboard-ui/src/stores/missions_vnext.js',
    ];
    const directTasksMutationPattern = /http\.(post|patch|put)\(\s*['"`]\/api\/tasks/g;
    const directMissionsMutationPattern = /http\.(post|patch|put|delete)\(\s*['"`]\/api\/missions/g;

    try {
        for (const relPath of targets) {
            const absolutePath = path.join(rootDir, relPath);
            if (!fs.existsSync(absolutePath)) continue;
            const content = fs.readFileSync(absolutePath, 'utf8');
            for (const match of findRegexMatchesWithLine(content, directTasksMutationPattern)) {
                findings.push({
                    source_tool: 'performance-dashboard-vnext-cutover',
                    contract_id: 'CONTRACT-ARCH-DASHBOARD-VNEXT-NO-DIRECT-TASKS-MUTATION',
                    domain: 'architecture',
                    file: relPath,
                    line: match.line,
                    evidence: match.evidence,
                    severity_hint: 'P1',
                    type: 'bug',
                    impact: 'Bypass do command flow em rota ativa pode causar drift de regra de domínio.',
                    root_cause: 'Mutação direta de task fora do control plane.',
                    suggested_patch: 'Substituir por actions em stores vNext que chamam /api/control/commands.',
                    test_strategy: 'Executar testes wave18t de cutover + audit:quick.',
                    regression_risk: 'Alto',
                });
            }

            for (const match of findRegexMatchesWithLine(content, directMissionsMutationPattern)) {
                findings.push({
                    source_tool: 'performance-dashboard-vnext-cutover',
                    contract_id: 'CONTRACT-ARCH-DASHBOARD-VNEXT-NO-DIRECT-MISSIONS-MUTATION',
                    domain: 'architecture',
                    file: relPath,
                    line: match.line,
                    evidence: match.evidence,
                    severity_hint: 'P1',
                    type: 'bug',
                    impact: 'Bypass do command flow em rota ativa pode causar drift de regra de domínio de missão.',
                    root_cause: 'Mutação direta de missão fora do control plane.',
                    suggested_patch: 'Substituir por actions vNext com /api/control/commands.',
                    test_strategy: 'Executar testes wave19 de hard cutover + audit:quick.',
                    regression_risk: 'Alto',
                });
            }
        }
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-dashboard-vnext-cutover',
            message: `Failed to detect direct /api/tasks or /api/missions mutation in vNext: ${error.message}`,
        });
    }

    return { findings, errors, warnings };
}

/**
 * Detecta ausência de contratos mínimos para reassign mission e contexto task↔mission.
 *
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
async function analyzeTaskMissionReassignAndContext(rootDir) {
    /** @type {any[]} */
    const findings = [];
    /** @type {any[]} */
    const errors = [];
    /** @type {any[]} */
    const warnings = [];

    const taskControlPath = path.join(rootDir, 'src/server/domain/task_control_service.js');
    const controlServicePath = path.join(rootDir, 'src/server/domain/control_command_service.js');
    const dashboardTasksPath = path.join(rootDir, 'src/server/api/controllers/dashboard_tasks.js');
    const taskViewsPath = path.join(rootDir, 'src/server/api/utils/task_views.js');

    try {
        const taskControlContent = fs.existsSync(taskControlPath) ? fs.readFileSync(taskControlPath, 'utf8') : '';
        const controlServiceContent = fs.existsSync(controlServicePath)
            ? fs.readFileSync(controlServicePath, 'utf8')
            : '';

        const hasStateGuard = /TASK_REASSIGN_REQUIRES_PAUSED_OR_READY_NOT_STARTED/.test(taskControlContent);
        const hasPatchGuard = /TASK_MISSION_REASSIGN_USE_COMMAND/.test(taskControlContent);
        const hasCommand = /TASK_REASSIGN_MISSION/.test(controlServiceContent);

        if (!hasStateGuard || !hasPatchGuard || !hasCommand) {
            findings.push({
                source_tool: 'performance-task-reassign',
                contract_id: 'CONTRACT-RUNTIME-TASK-REASSIGN-STATE-GUARD',
                domain: 'runtime',
                file: !hasCommand
                    ? 'src/server/domain/control_command_service.js'
                    : 'src/server/domain/task_control_service.js',
                line: null,
                evidence: 'Guardas/command de TASK_REASSIGN_MISSION incompletos.',
                severity_hint: 'P1',
                type: 'bug',
                impact: 'Reassign de missão pode ocorrer fora das invariantes de estado da task.',
                root_cause: 'Contrato de reassign incompleto no domínio/control plane.',
                suggested_patch: 'Exigir comando dedicado + guardas de estado e patch guard.',
                test_strategy: 'Executar testes wave18t de reassign.',
                regression_risk: 'Alto',
            });
        }
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-task-reassign',
            message: `Failed to analyze TASK_REASSIGN_MISSION contract: ${error.message}`,
        });
    }

    try {
        const dashboardTasksContent = fs.existsSync(dashboardTasksPath)
            ? fs.readFileSync(dashboardTasksPath, 'utf8')
            : '';
        const taskViewsContent = fs.existsSync(taskViewsPath) ? fs.readFileSync(taskViewsPath, 'utf8') : '';
        const hasJoin = /LEFT JOIN missions/.test(dashboardTasksContent);
        const hasMissionContext = /include\.has\('mission_context'\)/.test(dashboardTasksContent);
        const hasMissionRef = /mission_ref/.test(taskViewsContent);
        const hasCommandCaps = /command_caps/.test(taskViewsContent);

        if (!hasJoin || !hasMissionContext || !hasMissionRef || !hasCommandCaps) {
            findings.push({
                source_tool: 'performance-task-mission-context',
                contract_id: 'CONTRACT-RUNTIME-TASK-MISSION-CONTEXT-DRIFT',
                domain: 'runtime',
                file:
                    !hasJoin || !hasMissionContext
                        ? 'src/server/api/controllers/dashboard_tasks.js'
                        : 'src/server/api/utils/task_views.js',
                line: null,
                evidence: 'Enriquecimento de contexto task↔mission incompleto.',
                severity_hint: 'P2',
                type: 'gap',
                impact: 'Dashboard pode exibir vínculo task/missão inconsistente e exigir chamadas paralelas.',
                root_cause: 'Ausência de mission_ref/command_caps/mission_context no contrato da API.',
                suggested_patch: 'Unificar shape enriquecido em dashboard_tasks/dashboard_missions + task_views.',
                test_strategy: 'Executar integração wave18t de mission context.',
                regression_risk: 'Médio',
            });
        }
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-task-mission-context',
            message: `Failed to analyze task mission context contract: ${error.message}`,
        });
    }

    return { findings, errors, warnings };
}

/**
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
async function analyzeBootImportSafetyAndSignalOwnership(rootDir) {
    /** @type {any[]} */
    const findings = [];
    /** @type {any[]} */
    const errors = [];
    /** @type {any[]} */
    const warnings = [];

    try {
        const mainPath = path.join(rootDir, 'src/main.js');
        const serverMainPath = path.join(rootDir, 'src/server/main.js');
        const proxyScriptPath = path.join(rootDir, 'scripts/chrome-proxy-service.js');
        const mainContent = fs.existsSync(mainPath) ? fs.readFileSync(mainPath, 'utf8') : '';
        const serverMainContent = fs.existsSync(serverMainPath) ? fs.readFileSync(serverMainPath, 'utf8') : '';
        const proxyScriptContent = fs.existsSync(proxyScriptPath) ? fs.readFileSync(proxyScriptPath, 'utf8') : '';

        if (
            /process\.env\.DAEMON_MODE\s*===\s*['"]true['"]/.test(mainContent) ||
            /NODE_APP_INSTANCE|PM2_JSON_PROCESSING/.test(serverMainContent)
        ) {
            findings.push({
                source_tool: 'performance-runtime-bootstrap',
                contract_id: 'CONTRACT-RUNTIME-BOOT-IMPORT-SIDE-EFFECT',
                domain: 'runtime',
                file: /process\.env\.DAEMON_MODE/.test(mainContent) ? 'src/main.js' : 'src/server/main.js',
                line: null,
                evidence: 'Entrypoint com heurística de env para auto-bootstrap em import.',
                severity_hint: 'P1',
                type: 'bug',
                impact: 'Import puro pode disparar boot indevido e quebrar testabilidade.',
                root_cause: 'Acoplamento de bootstrap ao ambiente em vez de execução direta.',
                suggested_patch: 'Usar guard de entrypoint determinístico (execução direta/pm_exec_path).',
                test_strategy: 'Executar testes wave20b de import-safety com env PM2/daemon simulada.',
                regression_risk: 'Médio',
            });
        }

        if (
            /removeAllListeners\s*\(/.test(proxyScriptContent) ||
            /AUTO_HANDLE_SIGNALS\s*:\s*true/.test(proxyScriptContent)
        ) {
            findings.push({
                source_tool: 'performance-signal-ownership',
                contract_id: 'CONTRACT-RUNTIME-SIGNAL-OWNERSHIP-CONFLICT',
                domain: 'runtime',
                file: 'scripts/chrome-proxy-service.js',
                line: null,
                evidence: 'Wrapper PM2 do chrome-proxy com indício de ownership concorrente de sinais.',
                severity_hint: 'P1',
                type: 'bug',
                impact: 'Shutdown pode ocorrer por caminhos duplicados e gerar comportamento não determinístico.',
                root_cause: 'Concorrência entre handlers do wrapper e handlers internos.',
                suggested_patch: 'Fixar owner de sinais no wrapper e desabilitar auto-handle interno.',
                test_strategy: 'Executar regressão wave5 + wave20b de ownership de sinais.',
                regression_risk: 'Médio',
            });
        }
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-runtime-bootstrap',
            message: `Failed to analyze boot import safety/signal ownership: ${error.message}`,
        });
    }

    return { findings, errors, warnings };
}

/**
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
async function analyzeRuntimeResourceShutdownContracts(rootDir) {
    /** @type {any[]} */
    const findings = [];
    /** @type {any[]} */
    const errors = [];
    /** @type {any[]} */
    const warnings = [];

    try {
        const lifecyclePath = path.join(rootDir, 'src/server/engine/lifecycle.js');
        const registryPath = path.join(rootDir, 'src/core/runtime_resource_registry.js');

        const lifecycleContent = fs.existsSync(lifecyclePath) ? fs.readFileSync(lifecyclePath, 'utf8') : '';
        const registryContent = fs.existsSync(registryPath) ? fs.readFileSync(registryPath, 'utf8') : '';

        const hasRegistryShutdown = /stopRuntimeResources\s*\(/.test(lifecycleContent);
        const hasTimeoutSignalization = /RESOURCE_SHUTDOWN_TIMEOUT/.test(lifecycleContent);
        const hasPromiseRaceTimeout =
            /Promise\.race\s*\(\s*\[/.test(registryContent) &&
            /setTimeout\s*\(/.test(registryContent) &&
            /clearTimeout\s*\(/.test(registryContent);
        const hasCancelableTimeoutHelper =
            /function\s+runWithTimeout\s*\(/.test(registryContent) &&
            /setTimeout\s*\(/.test(registryContent) &&
            /clearTimeout\s*\(/.test(registryContent);
        const hasTimeoutContract = hasPromiseRaceTimeout || hasCancelableTimeoutHelper;

        if (!hasRegistryShutdown || !hasTimeoutSignalization || !hasTimeoutContract) {
            findings.push({
                source_tool: 'performance-runtime-resource-registry',
                contract_id: 'CONTRACT-RUNTIME-RESOURCE-SHUTDOWN-TIMEOUT',
                domain: 'runtime',
                file:
                    !hasRegistryShutdown || !hasTimeoutSignalization
                        ? 'src/server/engine/lifecycle.js'
                        : 'src/core/runtime_resource_registry.js',
                line: null,
                evidence: 'Contrato de shutdown por recurso com timeout/telemetria está incompleto.',
                severity_hint: 'P1',
                type: 'gap',
                impact: 'Recursos podem permanecer ativos após shutdown ou falhar sem observabilidade.',
                root_cause: 'Ausência de orquestração unificada com timeout por recurso.',
                suggested_patch: 'Centralizar stop em runtime registry com timeout e reason codes.',
                test_strategy: 'Executar testes wave20b de ready/degraded e lifecycle.',
                regression_risk: 'Médio',
            });
        }
    } catch (_rawE) {

        const error = /** @type {any} */ (_rawE);
        errors.push({
            source: 'performance-runtime-resource-registry',
            message: `Failed to analyze runtime resource shutdown contracts: ${error.message}`,
        });
    }

    return { findings, errors, warnings };
}

/**
 * @param {string} content
 * @param {RegExp} pattern
 */
function findRegexMatchesWithLine(content, pattern) {
    const matches = [];
    const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    let m;
    while ((m = regex.exec(content)) !== null) {
        const index = Number(m.index || 0);
        const line = content.slice(0, index).split('\n').length;
        const evidence = content.split('\n')[Math.max(0, line - 1)]?.trim() || String(m[0] || pattern.source);
        matches.push({ line, evidence });
    }
    return matches;
}

/**
 * @param {string} content
 * @returns {Array<{line:number,evidence:string}>}
 */
function findPromiseRaceTimeoutWithoutCleanup(content) {
    /** @type {any[]} */
    const findings = [];
    const racePattern = /Promise\.race\s*\(\s*\[([\s\S]{0,3000}?)\]\s*\)/g;

    let match;
    while ((match = racePattern.exec(content)) !== null) {
        const block = match[1] || '';
        const hasTimeoutPromise =
            /new\s+Promise\s*\(\s*\(\s*_,\s*reject\s*\)\s*=>[\s\S]{0,600}?setTimeout\s*\(/.test(block) ||
            /setTimeout\s*\(\s*\(\)\s*=>[\s\S]{0,400}?reject\s*\(/.test(block);

        if (!hasTimeoutPromise) {
            continue;
        }

        if (/clearTimeout\s*\(/.test(block)) {
            continue;
        }

        const before = content.slice(0, match.index);
        const line = before.split('\n').length;
        const compactEvidence = block.replace(/\s+/g, ' ').trim().slice(0, 220);
        findings.push({
            line,
            evidence: `Promise.race com timeout sem clearTimeout: ${compactEvidence}`,
        });
    }

    return findings;
}

/**
 * Retorna blocos de loop que parecem executar queries de dados/rede.
 * Ignora explicitamente padrões de DOM (`querySelector`, `document.*`, `window.*`).
 *
 * @param {string} content
 * @returns {string[]}
 */
function findPotentialNPlusOneLoops(content) {
    const loopBlocks = [];
    const loopPattern = /\bfor\s*\([^)]*\)\s*{[\s\S]{0,1200}?}|\bforEach\s*\([^)]*\)\s*=>\s*{[\s\S]{0,1200}?}/g;

    const dataQueryPatterns = [
        /\b(?:db|repo|repository|model|collection|client|prisma|sequelize|mongoose|knex)\b[\w$.[\]'"]{0,120}\.\s*(?:query|find(?:One|Many|All)?|select|aggregate|count|execute|get)\s*\(/i,
        /\b(?:fetch|request|axios\.(?:get|post|put|patch|delete|request)|http(?:Client)?\.(?:get|post|put|patch|delete|request))\s*\(/i,
    ];

    const domQueryPatterns = [
        /\bquerySelector(All)?\s*\(/i,
        /\bdocument\./i,
        /\bwindow\./i,
        /\belementFromPoint\s*\(/i,
        /\bcreateTreeWalker\s*\(/i,
    ];

    const matches = content.match(loopPattern) || [];
    for (const loopBlock of matches) {
        const hasDataQuery = dataQueryPatterns.some(re => re.test(loopBlock));
        if (!hasDataQuery) {
            continue;
        }

        const hasOnlyDomSignals = domQueryPatterns.some(re => re.test(loopBlock));
        if (
            hasOnlyDomSignals &&
            !/\b(?:db|repo|repository|model|collection|client|prisma|sequelize|mongoose|knex)\b/i.test(loopBlock)
        ) {
            continue;
        }

        loopBlocks.push(loopBlock);
    }

    return loopBlocks;
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function findJsFiles(dir) {
    /** @type {any[]} */
    const files = [];

    function scan(/** @type {string} */ currentDir) {
        const items = fs.readdirSync(currentDir);

        for (const item of items) {
            const fullPath = path.join(currentDir, item);
            const stat = fs.statSync(fullPath);

            // Skip build artifacts
            if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules' && item !== 'dist') {
                scan(fullPath);
            } else if (stat.isFile() && (item.endsWith('.js') || item.endsWith('.mjs'))) {
                files.push(fullPath);
            }
        }
    }

    scan(dir);
    return files;
}
