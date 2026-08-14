#!/usr/bin/env node
import { execFile } from 'node:child_process';

import { MODEL_GATEWAY_SCRIPT_PATHS, REPO_ROOT } from '../index.mjs';

const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/commands/model-gateway-auto-scenarios.mjs [--json] [--fail] [--profile ID] [--include-gates]

Build the canonical operator/LLM scenario plan for model-gateway terminal auto mode. This command is read-only: it does
not call providers, run models, mutate policy or start the terminal.
`);
    process.exit(0);
}

function readArg(name, fallback = '') {
    const prefix = `${name}=`;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg.startsWith(prefix)) return arg.slice(prefix.length);
        if (arg === name) return args[index + 1] ?? fallback;
    }
    return fallback;
}

function optionalRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function optionalArray(value) {
    return Array.isArray(value) ? value : [];
}

function runJson(scriptId, scriptArgs = []) {
    return new Promise((resolve) => {
        execFile(
            process.execPath,
            [MODEL_GATEWAY_SCRIPT_PATHS[scriptId], ...scriptArgs],
            {
                cwd: REPO_ROOT,
                encoding: 'utf8',
                maxBuffer: 64 * 1024 * 1024,
            },
            (error, stdout, stderr) => {
                const status = typeof error?.code === 'number' ? error.code : 0;
                const output = stdout?.trim() ?? '';
                if (error) {
                    resolve({
                        ok: false,
                        status,
                        error: stderr || stdout || error.message || `command failed with status ${status}`,
                        json: null,
                    });
                    return;
                }
                try {
                    resolve({ ok: true, status, error: null, json: JSON.parse(output) });
                } catch (parseError) {
                    resolve({
                        ok: false,
                        status,
                        error: parseError instanceof Error ? parseError.message : String(parseError),
                        json: null,
                    });
                }
            },
        );
    });
}

function checkFromRun(id, run, detail) {
    return {
        id,
        pass: run.ok,
        severity: 'error',
        detail: run.ok ? detail(run.json) : String(run.error ?? 'failed'),
    };
}

function createScenario({
    id,
    order,
    phase,
    command,
    terminalCommand = null,
    purpose,
    mutatesPolicy = false,
    mutatesTerminalState = false,
    executesModelTurn = false,
    executesRuntimeProbes = false,
    consumesProviderQuota = false,
    requiresHumanConfirmation = false,
    gateIds = [],
}) {
    return {
        id,
        order,
        phase,
        command,
        terminalCommand,
        purpose,
        risk: consumesProviderQuota || executesModelTurn ? 'live-real' : mutatesPolicy || mutatesTerminalState ? 'stateful' : 'read-only',
        mutatesPolicy,
        mutatesTerminalState,
        executesModelTurn,
        executesRuntimeProbes,
        consumesProviderQuota,
        requiresHumanConfirmation,
        gateIds,
    };
}

function countArray(value) {
    return optionalArray(value).length;
}

function countRowsOrItems(value) {
    const record = optionalRecord(value);
    return countArray(record?.['rows']) || countArray(record?.['items']);
}

function summarizeGateSummaries({ operatorReady, ready, doctor, explain, handoffs, confirmations, recoveries, proofPlan, standby, standbyPersisted, livePlan }) {
    const operatorReadyJson = optionalRecord(operatorReady);
    const readyJson = optionalRecord(ready);
    const doctorJson = optionalRecord(doctor);
    const explainJson = optionalRecord(explain);
    const handoffsJson = optionalRecord(handoffs);
    const confirmationsJson = optionalRecord(confirmations);
    const recoveriesJson = optionalRecord(recoveries);
    const proofPlanJson = optionalRecord(proofPlan);
    const standbyJson = optionalRecord(standby);
    const standbyPersistedJson = optionalRecord(standbyPersisted);
    const livePlanJson = optionalRecord(livePlan);
    return {
        operatorReady: {
            ok: operatorReadyJson?.['ok'] === true,
            blockers: countArray(operatorReadyJson?.['blockers']),
            warnings: countArray(operatorReadyJson?.['warnings']),
            standbyRoutes: optionalRecord(operatorReadyJson?.['summary'])?.['standbyRoutes'] ?? 0,
            standbyPersistedRows: optionalRecord(operatorReadyJson?.['summary'])?.['standbyPersistedRows'] ?? 0,
            nextSafeCommands: optionalRecord(operatorReadyJson?.['summary'])?.['nextSafeCommands'] ?? 0,
        },
        ready: {
            ok: readyJson?.['ok'] === true,
            blockers: countArray(readyJson?.['blockers']),
            warnings: countArray(readyJson?.['warnings']),
            action: optionalRecord(optionalRecord(readyJson?.['ops'])?.['automation'])?.['action'] ?? null,
            selectedRouteKey: optionalRecord(optionalRecord(readyJson?.['ops'])?.['automation'])?.['selectedRouteKey'] ?? null,
        },
        doctor: {
            ok: doctorJson?.['ok'] === true,
            blockers: countArray(doctorJson?.['blockers']),
            warnings: countArray(doctorJson?.['warnings']),
            policyEnabled: optionalRecord(doctorJson?.['policy'])?.['enabled'] === true,
            allowLiveSetModel: optionalRecord(doctorJson?.['policy'])?.['allowLiveSetModel'] === true,
            allowNewSession: optionalRecord(doctorJson?.['policy'])?.['allowNewSession'] === true,
            action: optionalRecord(doctorJson?.['decision'])?.['action'] ?? null,
            selectedRouteKey: optionalRecord(doctorJson?.['decision'])?.['selectedRouteKey'] ?? null,
        },
        explain: {
            ok: explainJson?.['ok'] === true,
            failureKeys: Object.keys(optionalRecord(explainJson?.['failures']) ?? []),
        },
        handoffs: {
            ok: handoffsJson?.['ok'] === true,
            rows: countRowsOrItems(handoffsJson),
        },
        confirmations: {
            ok: confirmationsJson?.['ok'] === true,
            rows: countRowsOrItems(confirmationsJson),
        },
        recoveries: {
            ok: recoveriesJson?.['ok'] === true,
            rows: countRowsOrItems(recoveriesJson),
        },
        proofPlan: {
            ok: proofPlanJson?.['ok'] === true,
            commands: optionalRecord(proofPlanJson?.['summary'])?.['commandCount'] ?? 0,
            alternatives: `${optionalRecord(proofPlanJson?.['summary'])?.['usableAlternativeCount'] ?? 0}/${optionalRecord(proofPlanJson?.['summary'])?.['evaluatedAlternativeCount'] ?? 0}`,
        },
        standby: {
            ok: standbyJson?.['ok'] === true,
            routes: optionalRecord(standbyJson?.['summary'])?.['routeCount'] ?? 0,
            alternates: optionalRecord(standbyJson?.['summary'])?.['alternateCount'] ?? 0,
            runtimeProofs: optionalRecord(standbyJson?.['summary'])?.['runtimeProofCount'] ?? 0,
        },
        standbyPersisted: {
            ok: standbyPersistedJson?.['ok'] === true,
            plans: optionalRecord(standbyPersistedJson?.['summary'])?.['planCount'] ?? 0,
            latestRoutes: optionalRecord(standbyPersistedJson?.['summary'])?.['latestRouteCount'] ?? 0,
        },
        livePlan: {
            ok: livePlanJson?.['ok'] === true,
            prerequisites: countArray(livePlanJson?.['prerequisites']),
            phases: countArray(livePlanJson?.['phases']),
            postPhases: countArray(livePlanJson?.['postPhases']),
            nextCommand: livePlanJson?.['nextCommand'] ?? null,
        },
    };
}

function buildScenarios(profile) {
    return [
        createScenario({
            id: 'operator_ready_cockpit',
            order: 1,
            phase: 'read-only',
            command: `npm run model-gateway:operator-ready -- --profile=${profile}`,
            terminalCommand: `/byok gateway operator-ready profile:${profile}`,
            purpose: 'Open the unified operator/LLM cockpit before any lower-level inspection or live test.',
            gateIds: ['operator_ready'],
        }),
        createScenario({
            id: 'auto_readiness_gate',
            order: 2,
            phase: 'read-only',
            command:
                `npm run model-gateway:auto:ready -- --profile=${profile} && npm run model-gateway:auto:doctor -- --profile=${profile} && npm run model-gateway:auto:explain -- --profile=${profile}`,
            terminalCommand: `/byok auto doctor profile:${profile} && /byok auto explain profile:${profile}`,
            purpose: 'Confirm catalog, SQLite operational layers, automation policy, route decision and ledgers are visible before any mutation.',
            gateIds: ['auto_ready', 'auto_doctor', 'auto_explain'],
        }),
        createScenario({
            id: 'automation_ledger_inspection',
            order: 3,
            phase: 'read-only',
            command: 'npm run model-gateway:auto:handoffs && npm run model-gateway:auto:confirmations && npm run model-gateway:auto:recoveries',
            terminalCommand: '/byok auto handoffs 10 && /byok auto confirmations 10 && /byok auto recoveries 10',
            purpose: 'Inspect SDK handoff, model-change confirmation and post-turn recovery ledgers so the operator can correlate expected and observed model binding plus fallback behavior.',
            gateIds: ['auto_handoffs', 'auto_confirmations', 'auto_recoveries'],
        }),
        createScenario({
            id: 'terminal_auto_policy_preview',
            order: 4,
            phase: 'read-only',
            command: `npm run model-gateway:auto:status -- --profile=${profile}`,
            terminalCommand: `/byok auto status profile:${profile}`,
            purpose: 'Preview the next automation decision and policy gates without applying any terminal effect.',
            gateIds: ['auto_status'],
        }),
        createScenario({
            id: 'terminal_auto_runtime_proof_plan',
            order: 5,
            phase: 'read-only',
            command: `npm run model-gateway:auto:proof-plan -- --profile=${profile} --limit=12`,
            terminalCommand: `/byok auto plan profile:${profile} 12`,
            purpose: 'List explicit provider/model disposable probe commands that can promote blocked fallback candidates into verified runtime health.',
            gateIds: ['auto_proof_plan'],
        }),
        createScenario({
            id: 'terminal_auto_standby_routes',
            order: 6,
            phase: 'read-only',
            command: `npm run model-gateway:auto:standby -- --profile=${profile} --limit=12`,
            terminalCommand: `/byok auto standby profile:${profile} 12`,
            purpose: 'List selected and alternate standby routes with explicit proof, same-provider model, provider/persist and new-session commands.',
            gateIds: ['auto_standby'],
        }),
        createScenario({
            id: 'terminal_auto_standby_persisted_read',
            order: 7,
            phase: 'read-only',
            command: `npm run model-gateway:auto:standby -- --profile=${profile} --read-sqlite --json`,
            terminalCommand: `/byok auto standby persisted profile:${profile} 12`,
            purpose: 'Read the latest persisted standby plan without recalculating selector state or calling providers.',
            gateIds: ['auto_standby_persisted'],
        }),
        createScenario({
            id: 'terminal_auto_standby_persist_snapshot',
            order: 8,
            phase: 'stateful-ledger',
            command: `npm run model-gateway:auto:standby -- --profile=${profile} --limit=12 --write-sqlite`,
            terminalCommand: `npm run model-gateway:auto:standby -- --profile=${profile} --limit=12 --write-sqlite`,
            purpose: 'Persist the generated standby plan into SQLite operational history so later operator sessions can inspect it without replanning.',
            mutatesTerminalState: false,
            requiresHumanConfirmation: false,
            gateIds: ['auto_standby'],
        }),
        createScenario({
            id: 'terminal_auto_enable_live_set_model',
            order: 9,
            phase: 'stateful-policy',
            command: `Terminal: /byok auto on profile:${profile} allow-live-set-model`,
            terminalCommand: `/byok auto on profile:${profile} allow-live-set-model`,
            purpose: 'Enable automatic in-session SDK model updates while still blocking new session creation.',
            mutatesPolicy: true,
            requiresHumanConfirmation: true,
            gateIds: ['auto_doctor'],
        }),
        createScenario({
            id: 'terminal_auto_enable_full_handoff',
            order: 10,
            phase: 'stateful-policy',
            command: `Terminal: /byok auto on profile:${profile} allow-live-set-model allow-new-session`,
            terminalCommand: `/byok auto on profile:${profile} allow-live-set-model allow-new-session`,
            purpose: 'Enable the full terminal automation policy, including live set-model effects and new-session recovery handoff.',
            mutatesPolicy: true,
            requiresHumanConfirmation: true,
            gateIds: ['auto_doctor'],
        }),
        createScenario({
            id: 'terminal_auto_switch_now',
            order: 11,
            phase: 'stateful-terminal',
            command: `Terminal: /byok auto switch profile:${profile}`,
            terminalCommand: `/byok auto switch profile:${profile}`,
            purpose: 'Apply the selected route immediately through the terminal command path and persist the resulting handoff/effect ledger.',
            mutatesTerminalState: true,
            requiresHumanConfirmation: true,
            gateIds: ['auto_ready', 'auto_doctor'],
        }),
        createScenario({
            id: 'terminal_live_control_only',
            order: 12,
            phase: 'terminal-live-control',
            command: 'npm run model-gateway:live:llm-b -- --control-only --timeout-ms=180000',
            purpose: 'Boot the terminal live harness without an LLM turn to validate command surface, event stream and redaction.',
            gateIds: ['live_plan_command'],
        }),
        createScenario({
            id: 'terminal_live_byok_fixture',
            order: 13,
            phase: 'terminal-live-fixture',
            command: 'npm run model-gateway:live:llm-b -- --byok-probe --byok-fixture --control-only --timeout-ms=240000',
            purpose: 'Exercise BYOK control-plane commands against the local OpenAI-compatible fixture before any real provider call.',
            executesRuntimeProbes: true,
            gateIds: ['live_plan_command'],
        }),
        createScenario({
            id: 'terminal_live_real_control_only_probes',
            order: 14,
            phase: 'terminal-live-real-probes',
            command:
                `npm run model-gateway:live:llm-b -- --byok-real --byok-real-route-profile=${profile} --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-allow-probe --byok-real-route-temporary-failure-cooldown-ms=900000 --byok-real-route-max-attempts=8 --byok-real-route-max-attempts-per-provider=4 --byok-real-route-timeout-ms=20000 --control-only --timeout-ms=240000`,
            purpose: 'Run real BYOK probes only after read-only gates, stateful policy checks and fixture phases pass.',
            executesRuntimeProbes: true,
            consumesProviderQuota: true,
            requiresHumanConfirmation: true,
            gateIds: ['live_plan_ready', 'auto_doctor'],
        }),
        createScenario({
            id: 'terminal_live_real_full_turn',
            order: 15,
            phase: 'terminal-live-real-turn',
            command:
                `npm run model-gateway:live:llm-b -- --byok-real --byok-real-route-profile=${profile} --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-allow-probe --byok-real-route-temporary-failure-cooldown-ms=900000 --byok-real-route-max-attempts=8 --byok-real-route-max-attempts-per-provider=4 --byok-real-route-timeout-ms=20000 --timeout-ms=900000`,
            purpose: 'Run the full llm-b terminal scenario with real provider routing after every lower-risk phase has passed.',
            executesModelTurn: true,
            executesRuntimeProbes: true,
            consumesProviderQuota: true,
            requiresHumanConfirmation: true,
            gateIds: ['live_plan_ready', 'auto_doctor'],
        }),
    ];
}

const json = argSet.has('--json');
const fail = argSet.has('--fail');
const includeGates = argSet.has('--include-gates');
const profile = readArg('--profile', 'repo_agent');
const gateEntries = await Promise.all([
    ['operatorReady', runJson('operatorReady', ['--json', `--profile=${profile}`])],
    ['ready', runJson('autoReady', ['--json', `--profile=${profile}`])],
    ['doctor', runJson('autoDoctor', ['--json', `--profile=${profile}`])],
    ['explain', runJson('autoExplain', ['--json', `--profile=${profile}`])],
    ['handoffs', runJson('autoHandoffs', ['--json', '--limit=5'])],
    ['confirmations', runJson('autoConfirmations', ['--json', '--limit=5'])],
    ['recoveries', runJson('autoRecoveries', ['--json', '--limit=5'])],
    ['proofPlan', runJson('autoProofPlan', ['--json', `--profile=${profile}`, '--limit=12'])],
    ['standby', runJson('autoStandby', ['--json', `--profile=${profile}`, '--limit=12'])],
    ['standbyPersisted', runJson('autoStandby', ['--json', `--profile=${profile}`, '--read-sqlite'])],
    ['livePlan', runJson('livePlan', ['--json', '--no-write'])],
].map(async ([key, run]) => [key, await run]));
const gateRuns = Object.fromEntries(gateEntries);
const operatorReady = gateRuns.operatorReady;
const ready = gateRuns.ready;
const doctor = gateRuns.doctor;
const explain = gateRuns.explain;
const handoffs = gateRuns.handoffs;
const confirmations = gateRuns.confirmations;
const recoveries = gateRuns.recoveries;
const proofPlan = gateRuns.proofPlan;
const standby = gateRuns.standby;
const standbyPersisted = gateRuns.standbyPersisted;
const livePlan = gateRuns.livePlan;

const operatorReadyJson = optionalRecord(operatorReady.json);
const readyJson = optionalRecord(ready.json);
const doctorJson = optionalRecord(doctor.json);
const explainJson = optionalRecord(explain.json);
const livePlanJson = optionalRecord(livePlan.json);
const checks = [
    checkFromRun('operator_ready', operatorReady, (result) => `ok=${optionalRecord(result)?.['ok'] === true}`),
    checkFromRun('auto_ready', ready, (result) => `ok=${optionalRecord(result)?.['ok'] === true}`),
    checkFromRun(
        'auto_ready_gate',
        { ok: ready.ok && readyJson?.['ok'] === true, error: `blockers=${optionalArray(readyJson?.['blockers']).length}` },
        () => `blockers=${optionalArray(readyJson?.['blockers']).length}`,
    ),
    checkFromRun('auto_doctor', doctor, (result) => `ok=${optionalRecord(result)?.['ok'] === true}`),
    checkFromRun('auto_explain', explain, (result) => `ok=${optionalRecord(result)?.['ok'] === true}`),
    checkFromRun('auto_handoffs', handoffs, (result) => `rows=${countRowsOrItems(result)}`),
    checkFromRun('auto_confirmations', confirmations, (result) => `rows=${countRowsOrItems(result)}`),
    checkFromRun('auto_recoveries', recoveries, (result) => `rows=${countRowsOrItems(result)}`),
    checkFromRun('auto_proof_plan', proofPlan, (result) => `commands=${optionalRecord(optionalRecord(result)?.['summary'])?.['commandCount'] ?? 0}`),
    checkFromRun('auto_standby', standby, (result) => `routes=${optionalRecord(optionalRecord(result)?.['summary'])?.['routeCount'] ?? 0}`),
    {
        id: 'auto_standby_persisted',
        pass: standbyPersisted.ok,
        severity: 'warn',
        detail: standbyPersisted.ok
            ? `plans=${optionalRecord(optionalRecord(standbyPersisted.json)?.['summary'])?.['planCount'] ?? 0}`
            : String(standbyPersisted.error ?? 'failed'),
    },
    checkFromRun('live_plan_command', livePlan, (result) => `command=ok livePlanReady=${optionalRecord(result)?.['ok'] === true}`),
    {
        id: 'live_plan_ready',
        pass: livePlan.ok && livePlanJson?.['ok'] === true,
        severity: 'warn',
        detail: livePlan.ok
            ? `ok=${livePlanJson?.['ok'] === true} next=${String(livePlanJson?.['nextCommand'] ?? '-')}`
            : String(livePlan.error ?? 'failed'),
    },
];
const blockers = checks.filter((check) => !check.pass && check.severity === 'error');
const warnings = checks.filter((check) => !check.pass && check.severity === 'warn');
const scenarios = buildScenarios(profile);
const summary = {
    schema: 'model-gateway-auto-scenarios',
    ok: blockers.length === 0,
    generatedAt: new Date().toISOString(),
    profile,
    runtimeExecuted: false,
    providersCalled: false,
    terminalStarted: false,
    checks,
    blockers,
    warnings,
    scenarioCount: scenarios.length,
    scenarios,
    gateSummaries: summarizeGateSummaries({
        operatorReady: operatorReadyJson,
        ready: readyJson,
        doctor: doctorJson,
        explain: explainJson,
        handoffs: optionalRecord(handoffs.json),
        confirmations: optionalRecord(confirmations.json),
        recoveries: optionalRecord(recoveries.json),
        proofPlan: optionalRecord(proofPlan.json),
        standby: optionalRecord(standby.json),
        standbyPersisted: optionalRecord(standbyPersisted.json),
        livePlan: livePlanJson,
    }),
    rawGateSummaries: includeGates ? {
        operatorReady: operatorReadyJson,
        ready: readyJson,
        doctor: doctorJson,
        explain: explainJson,
        handoffs: optionalRecord(handoffs.json),
        confirmations: optionalRecord(confirmations.json),
        recoveries: optionalRecord(recoveries.json),
        proofPlan: optionalRecord(proofPlan.json),
        standby: optionalRecord(standby.json),
        standbyPersisted: optionalRecord(standbyPersisted.json),
        livePlan: livePlanJson,
    } : null,
    nextScenario: scenarios[0] ?? null,
};

if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    process.stdout.write(`model-gateway auto scenarios: ok=${summary.ok ? 'yes' : 'no'} profile=${profile} scenarios=${scenarios.length}\n`);
    for (const check of checks) {
        process.stdout.write(`  ${check.pass ? 'PASS' : 'FAIL'} ${check.id}: ${check.detail}\n`);
    }
    for (const scenario of scenarios) {
        process.stdout.write(
            `  ${scenario.order}. ${scenario.id} [${scenario.risk}] quota=${scenario.consumesProviderQuota ? 'yes' : 'no'} command="${scenario.command}"\n`,
        );
    }
}

if (fail && !summary.ok) process.exit(1);
