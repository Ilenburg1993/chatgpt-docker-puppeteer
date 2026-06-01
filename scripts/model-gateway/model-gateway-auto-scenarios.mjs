#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { MODEL_GATEWAY_SCRIPT_PATHS, REPO_ROOT } from './index.mjs';

const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/model-gateway-auto-scenarios.mjs [--json] [--fail] [--profile ID] [--include-gates]

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
    const result = spawnSync(process.execPath, [MODEL_GATEWAY_SCRIPT_PATHS[scriptId], ...scriptArgs], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    const output = result.stdout?.trim() ?? '';
    if (result.status !== 0) {
        return {
            ok: false,
            status: result.status,
            error: result.stderr || result.stdout || `command failed with status ${result.status}`,
            json: null,
        };
    }
    try {
        return { ok: true, status: result.status, error: null, json: JSON.parse(output) };
    } catch (error) {
        return {
            ok: false,
            status: result.status,
            error: error instanceof Error ? error.message : String(error),
            json: null,
        };
    }
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

function summarizeGateSummaries({ ready, doctor, explain, handoffs, confirmations, livePlan }) {
    const readyJson = optionalRecord(ready);
    const doctorJson = optionalRecord(doctor);
    const explainJson = optionalRecord(explain);
    const handoffsJson = optionalRecord(handoffs);
    const confirmationsJson = optionalRecord(confirmations);
    const livePlanJson = optionalRecord(livePlan);
    return {
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
            rows: countArray(handoffsJson?.['items']),
        },
        confirmations: {
            ok: confirmationsJson?.['ok'] === true,
            rows: countArray(confirmationsJson?.['items']),
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
            id: 'auto_readiness_gate',
            order: 1,
            phase: 'read-only',
            command:
                `npm run model-gateway:auto:ready -- --profile=${profile} && npm run model-gateway:auto:doctor -- --profile=${profile} && npm run model-gateway:auto:explain -- --profile=${profile}`,
            terminalCommand: `/byok auto doctor profile:${profile} && /byok auto explain profile:${profile}`,
            purpose: 'Confirm catalog, SQLite operational layers, automation policy, route decision and ledgers are visible before any mutation.',
            gateIds: ['auto_ready', 'auto_doctor', 'auto_explain'],
        }),
        createScenario({
            id: 'automation_ledger_inspection',
            order: 2,
            phase: 'read-only',
            command: 'npm run model-gateway:auto:handoffs && npm run model-gateway:auto:confirmations',
            terminalCommand: '/byok auto handoffs 10 && /byok auto confirmations 10',
            purpose: 'Inspect SDK handoff and model-change confirmation ledgers so the operator can correlate expected and observed model binding.',
            gateIds: ['auto_handoffs', 'auto_confirmations'],
        }),
        createScenario({
            id: 'terminal_auto_policy_preview',
            order: 3,
            phase: 'read-only',
            command: `npm run model-gateway:auto:status -- --profile=${profile}`,
            terminalCommand: `/byok auto status profile:${profile}`,
            purpose: 'Preview the next automation decision and policy gates without applying any terminal effect.',
            gateIds: ['auto_status'],
        }),
        createScenario({
            id: 'terminal_auto_enable_live_set_model',
            order: 4,
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
            order: 5,
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
            order: 6,
            phase: 'stateful-terminal',
            command: `Terminal: /byok auto switch profile:${profile}`,
            terminalCommand: `/byok auto switch profile:${profile}`,
            purpose: 'Apply the selected route immediately through the terminal command path and persist the resulting handoff/effect ledger.',
            mutatesTerminalState: true,
            requiresHumanConfirmation: true,
            gateIds: ['auto_ready', 'auto_doctor'],
        }),
        createScenario({
            id: 'terminal_live_control_no_pr',
            order: 7,
            phase: 'terminal-live-control',
            command: 'npm run model-gateway:live:llm-b -- --no-pr --timeout-ms=180000',
            purpose: 'Boot the terminal live harness without an LLM turn to validate command surface, event stream and redaction.',
            gateIds: ['live_plan'],
        }),
        createScenario({
            id: 'terminal_live_byok_fixture',
            order: 8,
            phase: 'terminal-live-fixture',
            command: 'npm run model-gateway:live:llm-b -- --byok-probe --byok-fixture --no-pr --timeout-ms=240000',
            purpose: 'Exercise BYOK control-plane commands against the local OpenAI-compatible fixture before any real provider call.',
            executesRuntimeProbes: true,
            gateIds: ['live_plan'],
        }),
        createScenario({
            id: 'terminal_live_real_no_pr_probes',
            order: 9,
            phase: 'terminal-live-real-probes',
            command:
                `npm run model-gateway:live:llm-b -- --byok-real --byok-real-route-profile=${profile} --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-allow-probe --byok-real-route-temporary-failure-cooldown-ms=900000 --byok-real-route-max-attempts=8 --byok-real-route-max-attempts-per-provider=4 --byok-real-route-timeout-ms=20000 --no-pr --timeout-ms=240000`,
            purpose: 'Run real BYOK probes only after read-only gates, stateful policy checks and fixture phases pass.',
            executesRuntimeProbes: true,
            consumesProviderQuota: true,
            requiresHumanConfirmation: true,
            gateIds: ['live_plan', 'auto_doctor'],
        }),
        createScenario({
            id: 'terminal_live_real_full_turn',
            order: 10,
            phase: 'terminal-live-real-turn',
            command:
                `npm run model-gateway:live:llm-b -- --byok-real --byok-real-route-profile=${profile} --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-allow-probe --byok-real-route-temporary-failure-cooldown-ms=900000 --byok-real-route-max-attempts=8 --byok-real-route-max-attempts-per-provider=4 --byok-real-route-timeout-ms=20000 --timeout-ms=900000`,
            purpose: 'Run the full llm-b terminal scenario with real provider routing after every lower-risk phase has passed.',
            executesModelTurn: true,
            executesRuntimeProbes: true,
            consumesProviderQuota: true,
            requiresHumanConfirmation: true,
            gateIds: ['live_plan', 'auto_doctor'],
        }),
    ];
}

const json = argSet.has('--json');
const fail = argSet.has('--fail');
const includeGates = argSet.has('--include-gates');
const profile = readArg('--profile', 'repo_agent');
const ready = runJson('autoReady', ['--json', `--profile=${profile}`]);
const doctor = runJson('autoDoctor', ['--json', `--profile=${profile}`]);
const explain = runJson('autoExplain', ['--json', `--profile=${profile}`]);
const handoffs = runJson('autoHandoffs', ['--json', '--limit=5']);
const confirmations = runJson('autoConfirmations', ['--json', '--limit=5']);
const livePlan = runJson('livePlan', ['--json', '--no-write']);

const readyJson = optionalRecord(ready.json);
const doctorJson = optionalRecord(doctor.json);
const explainJson = optionalRecord(explain.json);
const livePlanJson = optionalRecord(livePlan.json);
const checks = [
    checkFromRun('auto_ready', ready, (result) => `ok=${optionalRecord(result)?.['ok'] === true}`),
    checkFromRun(
        'auto_ready_gate',
        { ok: ready.ok && readyJson?.['ok'] === true, error: `blockers=${optionalArray(readyJson?.['blockers']).length}` },
        () => `blockers=${optionalArray(readyJson?.['blockers']).length}`,
    ),
    checkFromRun('auto_doctor', doctor, (result) => `ok=${optionalRecord(result)?.['ok'] === true}`),
    checkFromRun('auto_explain', explain, (result) => `ok=${optionalRecord(result)?.['ok'] === true}`),
    checkFromRun('auto_handoffs', handoffs, (result) => `items=${optionalArray(optionalRecord(result)?.['items']).length}`),
    checkFromRun('auto_confirmations', confirmations, (result) => `items=${optionalArray(optionalRecord(result)?.['items']).length}`),
    checkFromRun('live_plan', livePlan, (result) => `ok=${optionalRecord(result)?.['ok'] === true}`),
];
const blockers = checks.filter((check) => !check.pass && check.severity === 'error');
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
    scenarioCount: scenarios.length,
    scenarios,
    gateSummaries: summarizeGateSummaries({
        ready: readyJson,
        doctor: doctorJson,
        explain: explainJson,
        handoffs: optionalRecord(handoffs.json),
        confirmations: optionalRecord(confirmations.json),
        livePlan: livePlanJson,
    }),
    rawGateSummaries: includeGates ? {
        ready: readyJson,
        doctor: doctorJson,
        explain: explainJson,
        handoffs: optionalRecord(handoffs.json),
        confirmations: optionalRecord(confirmations.json),
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
