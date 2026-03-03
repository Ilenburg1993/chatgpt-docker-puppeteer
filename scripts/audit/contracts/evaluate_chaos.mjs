// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { evaluateRuntimeSignals } from './evaluate_runtime.mjs';

/**
 * @typedef {object} EvaluateChaosContractsOptions
 * @property {'quick'|'deep'|'nightly'} profile
 * @property {'off'|'light'|'full'} chaosProfile
 * @property {import('./load_registry.mjs').ContractDefinitionV1[]} contracts
 * @property {string} runDir
 * @property {(stepId: string} exec
 * @property {string} command
 * @property {string[]} args
 * @property {unknown) => Promise<void>} options
 */
/**
 * @param {EvaluateChaosContractsOptions} options
  * @returns {Promise<void>}
 */
export async function evaluateChaosContracts(options) {
    /** @type {Array<{ signal: string, evidence: string, source_tool: string, file?: string|null, line?: number|null }>} */
    const signals = [];
    /** @type {Array<{source:string,message:string}>} */
    const warnings = [];
    /** @type {Array<{source:string,message:string}>} */
    const errors = [];

    const eventsPath = path.join(options.runDir, 'chaos_events.jsonl');
    const summary = {
        enabled: false,
        profile: options.chaosProfile,
        scenarios_executed: 0,
        violations: 0,
    };

    const record = payload => fs.appendFileSync(eventsPath, `${JSON.stringify(payload)}\n`, 'utf8');

    if (options.profile !== 'nightly' || options.chaosProfile === 'off') {
        record({
            ts: new Date().toISOString(),
            event: 'chaos_skipped',
            reason: options.profile !== 'nightly' ? 'profile_not_nightly' : 'chaos_off',
        });
        return {
            findings: [],
            warnings,
            errors,
            summary,
            eventsPath,
        };
    }

    summary.enabled = true;
    const exec = options.exec;

    if (typeof exec !== 'function') {
        warnings.push({ source: 'chaos', message: 'Executor não fornecido; cenários chaos foram pulados.' });
        record({ ts: new Date().toISOString(), event: 'chaos_executor_missing' });
        return {
            findings: [],
            warnings,
            errors,
            summary,
            eventsPath,
        };
    }

    const scenarios = [
        {
            stepId: 'chaos.contract_nightly',
            command: 'node',
            args: ['--test', 'tests/nightly/audit/test_contract_chaos.spec.js'],
            timeoutMs: 300000,
            signalOnFailure: 'runtime.smoke.failed',
        },
    ];

    for (const scenario of scenarios) {
        summary.scenarios_executed += 1;
        const startedAt = Date.now();
        const result = await exec(scenario.stepId, scenario.command, scenario.args, { timeoutMs: scenario.timeoutMs });
        const durationMs = Date.now() - startedAt;
        record({
            ts: new Date().toISOString(),
            event: 'chaos_scenario_finished',
            scenario: scenario.stepId,
            ok: result.ok,
            duration_ms: durationMs,
            exit_code: result.exitCode,
        });

        if (!result.ok) {
            const evidence = result.stderr || result.stdout || `${scenario.stepId} failed`;
            signals.push({
                signal: scenario.signalOnFailure,
                evidence,
                source_tool: 'chaos-runtime',
            });
            errors.push({ source: scenario.stepId, message: evidence.slice(0, 5000) });
        }
    }

    const findings = evaluateRuntimeSignals({
        contracts: options.contracts,
        signals,
    });
    summary.violations = findings.length;

    return {
        findings,
        warnings,
        errors,
        summary,
        eventsPath,
    };
}
