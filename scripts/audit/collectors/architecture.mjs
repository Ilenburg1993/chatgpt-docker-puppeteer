// @ts-check
import fs from 'node:fs';
import path from 'node:path';

import { buildDependencyGraph } from '../../analysis/dependency-graph.mjs';

/** @import {RawFinding} from '../normalize/findings.mjs' */

/**
 * @param {string} rootDir
 * @returns {Promise<{
 *     findings: RawFinding[];
 *     errors: { source: string; message: string }[];
 *     warnings: { source: string; message: string }[];
 *     telemetry: { findings_by_kind: Record<string, number> };
 * }>}
 */
export async function collectArchitectureFindings(rootDir) {
    /** @type {RawFinding[]} */
    const findings = [];
    /** @type {{ source: string; message: string }[]} */
    const errors = [];
    /** @type {{ source: string; message: string }[]} */
    const warnings = [];

    try {
        // Análise de acoplamento
        const couplingResult = await analyzeCoupling(rootDir);
        findings.push(...couplingResult.findings);
        errors.push(...couplingResult.errors);
        warnings.push(...couplingResult.warnings);
    } catch (error) {
        const _e = /** @type {any} */ (error);
        errors.push({
            source: 'architecture-collector',
            message: `Failed to analyze coupling: ${_e.message}`,
        });
    }

    try {
        // Análise de dependências circulares pelo grafo canônico Babel/Node.
        const circularResult = await analyzeCircularDependencies(rootDir);
        findings.push(...circularResult.findings);
        errors.push(...circularResult.errors);
        warnings.push(...circularResult.warnings);
    } catch (error) {
        const _e = /** @type {any} */ (error);
        errors.push({
            source: 'architecture-collector',
            message: `Failed to analyze circular dependencies: ${_e.message}`,
        });
    }

    /** @type {any} */
    const findingsByKind = {
        coupling: 0,
        circular: 0,
        generic: 0,
    };

    for (const finding of findings) {
        const tool = String(finding.source_tool || '');
        if (tool.includes('coupling')) {
            findingsByKind.coupling += 1;
        } else if (tool.includes('circular')) {
            findingsByKind.circular += 1;
        } else {
            findingsByKind.generic += 1;
        }
    }

    return {
        findings,
        errors,
        warnings,
        telemetry: {
            findings_by_kind: findingsByKind,
        },
    };
}

/**
 * @param {string} rootDir
 * @returns {Promise<{
 *     findings: RawFinding[];
 *     errors: { source: string; message: string }[];
 *     warnings: { source: string; message: string }[];
 * }>}
 */
async function analyzeCoupling(rootDir) {
    const findings = [];
    /** @type {{ source: string; message: string }[]} */
    const errors = [];
    /** @type {{ source: string; message: string }[]} */
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
 * @returns {Promise<{
 *     findings: RawFinding[];
 *     errors: { source: string; message: string }[];
 *     warnings: { source: string; message: string }[];
 * }>}
 */
async function analyzeCircularDependencies(rootDir) {
    const findings = [];
    /** @type {{ source: string; message: string }[]} */
    const errors = [];
    /** @type {{ source: string; message: string }[]} */
    const warnings = [];

    try {
        const dependencyReport = buildDependencyGraph('src', { workspaceRoot: rootDir });
        if (dependencyReport.parseErrors.length > 0) {
            errors.push({
                source: 'dependency-graph',
                message: `Grafo incompleto: ${dependencyReport.parseErrors.length} erro(s) de parse.`,
            });
        }
        for (const component of dependencyReport.cycles) {
            findings.push({
                source_tool: 'architecture-circular',
                contract_id: 'CONTRACT-ARCH-CIRCULAR-DEPENDENCY',
                domain: 'architecture',
                file: component[0] ?? null,
                evidence: `Componente circular: ${component.join(' <-> ')}`,
                severity_hint: 'P1',
                type: 'bug',
                impact: 'Dependências circulares dificultam manutenção e testing.',
                root_cause: 'Imports mutuamente alcançáveis entre módulos.',
                suggested_patch: 'Reestruturar módulos para eliminar dependências circulares.',
                test_strategy: 'Executar `npm run analyze:deps`.',
                regression_risk: 'Alto',
            });
        }
    } catch (error) {
        errors.push({
            source: 'dependency-graph',
            message: error instanceof Error ? error.message : String(error),
        });
    }

    return { findings, errors, warnings };
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function findJsFiles(dir) {
    /** @type {string[]} */
    const files = [];

    /** @param {string} currentDir */
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
