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
            message: `Failed to analyze complexity: ${error.message}`
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
            message: `Failed to analyze memory leaks: ${error.message}`
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
            message: `Failed to analyze query performance: ${error.message}`
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
        const eslintResult = await runCommand('npx', ['eslint', '--format', 'json', '--rule', 'complexity: [2, 10]', 'src/'], { cwd: rootDir });

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
            message: 'ESLint complexity analysis not available (optional)'
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
            message: `Failed to analyze memory leaks: ${error.message}`
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

        // Detectar queries N+1 potenciais
        const loops = content.match(/for\s*\([^}]*\)\s*{\s*[^}]*query|forEach\s*\([^}]*query/gi) || [];
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

            if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
                scan(fullPath);
            } else if (stat.isFile() && (item.endsWith('.js') || item.endsWith('.mjs'))) {
                files.push(fullPath);
            }
        }
    }

    scan(dir);
    return files;
}
