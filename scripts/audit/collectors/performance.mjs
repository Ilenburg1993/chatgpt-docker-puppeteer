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
