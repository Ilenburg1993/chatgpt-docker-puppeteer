import fs from 'node:fs';
import path from 'node:path';
import { runCommand } from '../lib/exec.mjs';

/**
 * @typedef {import('../normalize/findings.mjs').RawFinding} RawFinding
 */

/**
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
        errors.push({
            source: 'performance-collector',
            message: `Failed to analyze dashboard import side effects: ${error.message}`,
        });
    }

    return { findings, errors, warnings };
}

/**
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
async function analyzeComplexity(rootDir) {
    const findings = [];
    const errors = [];
    const warnings = [];

    try {
        // Usar eslint complexity plugin se disponível
        const eslintResult = await runCommand(
            'npx',
            ['eslint', '--format', 'json', '--rule', 'complexity: [2, 10]', 'src/'],
            { cwd: rootDir }
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
    const findings = [];
    const errors = [];
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
    } catch (error) {
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
    const findings = [];
    const errors = [];
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
    const findings = [];
    const errors = [];
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
    } catch (error) {
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
    const findings = [];
    const errors = [];
    const warnings = [];

    try {
        const srcDir = path.join(rootDir, 'src');
        const files = await findJsFiles(srcDir);
        const allowDirectDispatch = new Set([
            'src/agent/queue_worker.js',
            'src/missions/mission_manager.js',
        ]);
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
                    suggested_patch: 'Enfileirar via insertTask + QueueWorker, mantendo Kernel como executor único por fila.',
                    test_strategy: 'Executar lint de ownership + testes de integração de missão/fila.',
                    regression_risk: 'Alto',
                });
            }
        }
    } catch (error) {
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
    const findings = [];
    const errors = [];
    const warnings = [];

    const targets = [
        'src/agent/queue_worker.js',
        'src/agent/task_state_projector.js',
    ];

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
    } catch (error) {
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
    const findings = [];
    const errors = [];
    const warnings = [];
    const targets = [
        'src/server/api/controllers/missions.js',
        'src/agent/mission_runner.js',
    ];

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
                    suggested_patch: 'Encaminhar transição para mission_execution_service com precondições e evento padronizado.',
                    test_strategy: 'Executar regressão wave17 de serviço único de transição.',
                    regression_risk: 'Alto',
                });
            }
        }
    } catch (error) {
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
    const findings = [];
    const errors = [];
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
    } catch (error) {
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
    const findings = [];
    const errors = [];
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
    } catch (error) {
        errors.push({
            source: 'performance-dashboard-import',
            message: `Failed to analyze dashboard import side effects: ${error.message}`,
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
    const loopPattern =
        /\bfor\s*\([^)]*\)\s*{[\s\S]{0,1200}?}|\bforEach\s*\([^)]*\)\s*=>\s*{[\s\S]{0,1200}?}/g;

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
        if (hasOnlyDomSignals && !/\b(?:db|repo|repository|model|collection|client|prisma|sequelize|mongoose|knex)\b/i.test(loopBlock)) {
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
    const files = [];

    function scan(currentDir) {
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
