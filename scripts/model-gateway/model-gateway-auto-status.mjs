#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { buildModelGatewayRuntimeAutomationDecision } from '../../src/copilot/model-gateway/index.js';
import { MODEL_GATEWAY_SCRIPT_PATHS, REPO_ROOT } from './index.mjs';

const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/model-gateway-auto-status.mjs [--json] [--profile ID] [--allow-live-set-model] [--allow-new-session] [--allow-local-private] [--live-profile ID] [--live-preset ID] [--live-model ID] [--live-base-url URL]

Build a pure model-gateway runtime automation decision. This command does not execute providers and does not mutate the
terminal session.
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

function optional(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function runtimeSelectorArgs() {
    const forwarded = ['--json', `--profile=${readArg('--profile', 'repo_agent')}`];
    for (const flag of [
        '--fallback-profiles',
        '--selection-policy',
        '--preferred-probes',
        '--block-failed-probes',
        '--temporary-failure-cooldown-ms',
    ]) {
        const value = readArg(flag);
        if (value) forwarded.push(`${flag}=${value}`);
    }
    return forwarded;
}

function readRuntimeSelectorPlan() {
    const result = spawnSync(process.execPath, [MODEL_GATEWAY_SCRIPT_PATHS.runtimeSelector, ...runtimeSelectorArgs()], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0) {
        throw new Error(`runtime selector failed: ${result.stderr || result.stdout || result.status}`);
    }
    return JSON.parse(result.stdout);
}

function liveBindingFromArgs() {
    const profile = optional(readArg('--live-profile'));
    const preset = optional(readArg('--live-preset'));
    const model = optional(readArg('--live-model'));
    const baseUrl = optional(readArg('--live-base-url'));
    const providerType = optional(readArg('--live-provider-type'));
    if (!profile && !preset && !model && !baseUrl && !providerType) return null;
    return {
        enabled: true,
        profile,
        preset,
        model,
        baseUrl,
        providerType,
    };
}

const selector = readRuntimeSelectorPlan();
const decision = buildModelGatewayRuntimeAutomationDecision({
    runtimeSelectorPlan: selector.runtimeSelectorPlan,
    profileId: readArg('--profile', 'repo_agent'),
    currentSessionId: optional(readArg('--live-session-id')) ?? (liveBindingFromArgs() ? 'cli-live-session' : null),
    liveByokBinding: liveBindingFromArgs(),
    policy: {
        allowLiveSetModel: argSet.has('--allow-live-set-model'),
        allowNewSession: argSet.has('--allow-new-session'),
        allowLocalPrivate: argSet.has('--allow-local-private'),
    },
});

const summary = {
    schema: 'model-gateway-auto-status',
    ok: decision.ok,
    runtimeSelectorOk: selector.ok === true,
    decision,
};

if (argSet.has('--json')) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    process.stdout.write(`model-gateway auto status: ok=${summary.ok ? 'yes' : 'no'} action=${decision.action} route=${decision.selectedRouteKey ?? '-'}\n`);
    process.stdout.write(`  ${decision.operatorSummary}\n`);
    if (decision.blockers.length > 0) process.stdout.write(`  blockers=${decision.blockers.join(',')}\n`);
    process.stdout.write(`  next=${decision.nextCommands.join(' && ')}\n`);
}

if (!summary.ok && argSet.has('--fail')) process.exit(1);
