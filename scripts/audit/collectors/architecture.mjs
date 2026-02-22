import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {import('../normalize/findings.mjs').RawFinding} RawFinding
 */

/**
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
export async function collectArchitectureFindings(rootDir) {
    /** @type {RawFinding[]} */
    const findings = [];
    /** @type {Array<{source:string,message:string}>} */
    const errors = [];
    /** @type {Array<{source:string,message:string}>} */
    const warnings = [];

    try {
        // Análise de acoplamento
        const couplingResult = await analyzeCoupling(rootDir);
        findings.push(...couplingResult.findings);
        errors.push(...couplingResult.errors);
        warnings.push(...couplingResult.warnings);
    } catch (error) {
        errors.push({
            source: 'architecture-collector',
            message: `Failed to analyze coupling: ${error.message}`,
        });
    }

    try {
        // Análise de dependências circulares (usando madge se disponível)
        const circularResult = await analyzeCircularDependencies(rootDir);
        findings.push(...circularResult.findings);
        errors.push(...circularResult.errors);
        warnings.push(...circularResult.warnings);
    } catch (error) {
        errors.push({
            source: 'architecture-collector',
            message: `Failed to analyze circular dependencies: ${error.message}`,
        });
    }

    return { findings, errors, warnings };
}

/**
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
async function analyzeCoupling(rootDir) {
    const findings = [];
    const errors = [];
    const warnings = [];
    const srcDir = path.join(rootDir, 'src');
    const files = await findJsFiles(srcDir);

    for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        const relativePath = path.relative(rootDir, file);

        // Contar imports
        const importMatches = content.match(/import\s+.*from\s+['"][^'"]+['"]/g) || [];
        const requireMatches = content.match(/require\s*\(\s*['"][^'"]+['"]\s*\)/g) || [];

        const totalImports = importMatches.length + requireMatches.length;

        if (totalImports > 20) {
            findings.push({
                source_tool: 'architecture-coupling',
                contract_id: 'CONTRACT-ARCH-TIGHT-COUPLING',
                domain: 'architecture',
                file: relativePath,
                evidence: `${totalImports} imports/requires`,
                severity_hint: 'P2',
                type: 'upgrade',
                impact: 'Módulo com alto acoplamento, difícil de manter e testar.',
                root_cause: 'Muitos imports indicam responsabilidade excessiva.',
                suggested_patch: 'Refatorar em módulos menores e mais focados.',
                test_strategy: 'Análise estática de contagem de imports.',
                regression_risk: 'Médio',
            });
        }
    }

    return { findings, errors, warnings };
}

/**
 * @param {string} rootDir
 * @returns {Promise<RawFinding[]>}
 */
/**
 * @param {string} rootDir
 * @returns {Promise<{findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>}>}
 */
async function analyzeCircularDependencies(rootDir) {
    const findings = [];
    const errors = [];
    const warnings = [];

    try {
        // Tentar usar madge se disponível
        const { execSync } = await import('node:child_process');

        const madgeOutput = execSync('npx madge --circular --format json src/ --exclude "^dashboard-ui/dist/"', {
            cwd: rootDir,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        const circularDeps = JSON.parse(madgeOutput);

        for (const [file, deps] of Object.entries(circularDeps)) {
            if (deps.length > 0) {
                findings.push({
                    source_tool: 'architecture-circular',
                    contract_id: 'CONTRACT-ARCH-CIRCULAR-DEPENDENCY',
                    domain: 'architecture',
                    file: file,
                    evidence: `Dependências circulares: ${deps.join(' -> ')}`,
                    severity_hint: 'P1',
                    type: 'bug',
                    impact: 'Dependências circulares dificultam manutenção e testing.',
                    root_cause: 'Imports mútuos entre módulos.',
                    suggested_patch: 'Reestruturar módulos para eliminar dependências circulares.',
                    test_strategy: 'Executar madge --circular.',
                    regression_risk: 'Alto',
                });
            }
        }
    } catch (_error) {
        // madge não disponível, skip silencioso (dependência opcional)
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

            // skip build artifacts (dist) when scanning source files
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
