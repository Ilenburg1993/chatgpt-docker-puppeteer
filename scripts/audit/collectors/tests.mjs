// @ts-check
import { runCommand } from '../lib/exec.mjs';

/**
 * @typedef {import('../normalize/findings.mjs').RawFinding} RawFinding
 */

/**
 * @param {string} sourceTool
 * @param {string} evidence
 * @param {string|null} contractId
 * @returns {RawFinding}
 */
function testFailureFinding(sourceTool, evidence, contractId) {
    return {
        source_tool: sourceTool,
        contract_id: contractId || null,
        domain: contractId?.includes('NETWORK') ? 'network' : 'runtime',
        owner: 'qa-regression',
        enforcement_state: contractId ? 'p1' : 'warn',
        file: null,
        line: null,
        evidence,
        rule: 'test-failure',
        severity_hint: 'P1',
        type: 'bug',
        impact: 'Falha de testes indica regressão comportamental ou contrato quebrado.',
        root_cause: 'Uma ou mais suites automatizadas falharam.',
        suggested_patch: 'Corrigir comportamento e atualizar cobertura para impedir reintrodução.',
        test_strategy: 'Reexecutar suite de testes específica e matriz consolidada.',
        regression_risk: 'Alto',
    };
}

/**
 * @typedef {object} CollectTestFindingsOptions
 * @property {'quick'|'deep'|'nightly'} profile
 * @property {(stepId: any, command: any, args: any, opts: any) => Promise<any>} exec
 */
/**
 * @param {CollectTestFindingsOptions} options
 * @returns {Promise<{ findings: RawFinding[], errors: Array<{source:string,message:string}>, warnings: Array<{source:string,message:string}>, telemetry: Record<string,any>}>}
 */
export async function collectTestFindings(options) {
    /** @type {RawFinding[]} */
    const findings = [];
    /** @type {Array<{source:string,message:string}>} */
    const errors = [];
    /** @type {Array<{source:string,message:string}>} */
    const warnings = [];

    const exec = options.exec || (async (_stepId, command, args, runOpts) => runCommand(command, args, runOpts));

    /** @type {Array<{stepId:string,name:string,command:'node'|'npm',args:string[],timeoutMs:number,contractId:string|null}>} */
    const plan = [];

    if (options.profile === 'quick') {
        plan.push({
            stepId: 'tests.smoke',
            name: 'test:smoke-runtime',
            command: 'node',
            args: ['--test', 'tests/regression/test_wave11_main_server_bootstrap_unification.spec.js'],
            timeoutMs: 180000,
            contractId: 'CONTRACT-PROTOCOL-RUNTIME-SMOKE',
        });
    }

    if (options.profile === 'deep') {
        plan.push({
            stepId: 'tests.unit',
            name: 'test:unit',
            command: 'npm',
            args: ['run', 'test:unit'],
            timeoutMs: 600000,
            contractId: null,
        });
    }

    if (options.profile === 'nightly') {
        plan.push({
            stepId: 'tests.unit',
            name: 'test:unit',
            command: 'npm',
            args: ['run', 'test:unit'],
            timeoutMs: 600000,
            contractId: null,
        });
        plan.push({
            stepId: 'tests.integration',
            name: 'test:integration',
            command: 'npm',
            args: ['run', 'test:integration'],
            timeoutMs: 900000,
            contractId: 'CONTRACT-NETWORK-SPLIT-HANDSHAKE',
        });
        plan.push({
            stepId: 'tests.regression',
            name: 'test:regression',
            command: 'npm',
            args: ['run', 'test:regression'],
            timeoutMs: 900000,
            contractId: null,
        });
    }

    for (const task of plan) {
        const result = await exec(task.stepId, task.command, task.args, { timeoutMs: task.timeoutMs });

        if (!result.ok) {
            const evidence = result.stderr || result.stdout || `${task.name} failed`;
            findings.push(testFailureFinding(task.name, evidence, task.contractId));
            errors.push({ source: task.name, message: evidence.slice(0, 5000) });
        }
    }

    return {
        findings,
        errors,
        warnings,
        telemetry: {
            profile: options.profile,
            executed: plan.map(step => step.name),
            tests_ok: errors.length === 0,
        },
    };
}
