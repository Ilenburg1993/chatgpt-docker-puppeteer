#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MODEL_GATEWAY_SCRIPT_PATHS, REPO_ROOT } from './index.mjs';

const ROOT = REPO_ROOT;
const DEFAULT_OUT_DIR = path.join(ROOT, 'artifacts/model-gateway-live-plan');
const TERMINAL_LIVE_TEMPORARY_FAILURE_COOLDOWN_MS = 900_000;
const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/model-gateway-live-plan.mjs [--json] [--fail] [--no-write] [--allow-active-overlays] [--local-private-strict] [--out-dir DIR]

Create a no-runtime terminal llm-b live-test plan from model-gateway readiness. This does not start the terminal, fetch
providers, run models or execute probes.
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

function nowStamp() {
    return new Date().toISOString().replace(/[:.]/gu, '-');
}

/**
 * @param {string} stamp
 * @returns {string}
 */
function planRunId(stamp) {
    return stamp.replace(/[^a-zA-Z0-9._:-]+/gu, '-');
}

function runReadiness() {
    const result = spawnSync(process.execPath, [MODEL_GATEWAY_SCRIPT_PATHS.liveReadiness, '--json'], {
        cwd: ROOT,
        encoding: 'utf8',
    });
    if (result.status !== 0) {
        throw new Error(`model-gateway live readiness failed: ${result.stderr || result.stdout || result.status}`);
    }
    return JSON.parse(result.stdout);
}

function runLocalPrivateStrictSelection() {
    const result = spawnSync(
        process.execPath,
        [MODEL_GATEWAY_SCRIPT_PATHS.selectionAudit, '--profile=local_private_strict', '--fail-on-unselected'],
        {
            cwd: ROOT,
            encoding: 'utf8',
        },
    );
    return {
        ok: result.status === 0,
        status: result.status,
        detail: (result.stderr || result.stdout || `exit=${result.status}`).trim().split(/\r?\n/u).slice(0, 4).join(' | '),
    };
}

function readinessCheck(readiness, id) {
    return Array.isArray(readiness.checks) ? readiness.checks.find((check) => check.id === id) : null;
}

function effectiveOverlaySummary(readiness) {
    return readiness?.selection?.effectiveStrict?.runtimeAccountOverlaySummary ?? {
        total: 0,
        activeCount: 0,
        expiredCount: 0,
        byProvider: {},
        byFailureKind: {},
        items: [],
    };
}

function countMapText(counts) {
    return Object.entries(counts ?? {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, count]) => `${key}:${count}`)
        .join(',') || '-';
}

function countMapValue(counts, key) {
    const value = counts && typeof counts === 'object' ? counts[key] : null;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function terminalLiveRouteMatrix(readiness) {
    const routes =
        readiness?.terminalLiveRuntimeSelectorPlan?.selectedRoutes ??
        readiness?.selection?.terminalLiveRuntimeSelectorPlan?.selectedRoutes;
    return Array.isArray(routes) ? routes : [];
}

function buildPlan(readiness, { allowActiveOverlays = false, localPrivateStrict = false } = {}) {
    const generatedAt = new Date().toISOString();
    const runId = planRunId(generatedAt.replace(/[:.]/gu, '-'));
    const baselineOutDir = `artifacts/model-gateway-runtime-health-baselines/${runId}`;
    const baselinePath = `${baselineOutDir}/latest.json`;
    const baselineDiffPath = `${baselineOutDir}/latest-diff.json`;
    const postLiveOutDir = `artifacts/model-gateway-runtime-health-post-live/${runId}`;
    const postLiveDiffPath = `${postLiveOutDir}/latest-diff.json`;
    const overlaySummary = effectiveOverlaySummary(readiness);
    const localPrivateStrictSelection = localPrivateStrict ? runLocalPrivateStrictSelection() : null;
    const liveRunner = readinessCheck(readiness, 'live_runner_present');
    const effective = readinessCheck(readiness, 'selection_effective_observed_health');
    const runtimeSelector = readinessCheck(readiness, 'runtime_selector_plan_ready');
    const terminalLiveRuntimeSelector = readinessCheck(readiness, 'terminal_live_runtime_selector_plan_ready');
    const runtimeNotPromoted = readinessCheck(readiness, 'runtime_not_promoted');
    const syntheticFixtureActiveCount = countMapValue(overlaySummary.activeByProvider, 'model-gateway-fixture');
    const blockingActiveOverlayCount = Math.max(0, overlaySummary.activeCount - syntheticFixtureActiveCount);
    const prerequisites = [
        {
            id: 'readiness_ok',
            ok: readiness.ok === true,
            detail: 'model-gateway live readiness returned ok=true',
        },
        {
            id: 'effective_selection_ok',
            ok: effective?.ok === true,
            detail: effective?.detail ?? 'effective observed-health selection is unavailable',
        },
        {
            id: 'runtime_not_promoted',
            ok: runtimeNotPromoted?.ok === true,
            detail: runtimeNotPromoted?.detail ?? 'runtime proof status is unavailable',
        },
        {
            id: 'runtime_selector_plan_ready',
            ok: runtimeSelector?.ok === true,
            detail: runtimeSelector?.detail ?? 'runtime selector plan is unavailable',
        },
        {
            id: 'terminal_live_runtime_selector_plan_ready',
            ok: terminalLiveRuntimeSelector?.ok === true,
            detail: terminalLiveRuntimeSelector?.detail ?? 'terminal-live runtime selector plan is unavailable',
        },
        {
            id: 'live_runner_present',
            ok: liveRunner?.ok === true,
            detail: liveRunner?.detail ?? 'terminal live runner path is unavailable',
        },
        {
            id: 'active_runtime_overlays',
            ok: allowActiveOverlays || blockingActiveOverlayCount === 0,
            detail:
                `blockingActive=${blockingActiveOverlayCount}, active=${overlaySummary.activeCount}, syntheticFixtureActive=${syntheticFixtureActiveCount}, expired=${overlaySummary.expiredCount}, activeProviders=${countMapText(overlaySummary.activeByProvider)}, providers=${countMapText(overlaySummary.byProvider)}, failures=${countMapText(overlaySummary.byFailureKind)}`,
        },
        {
            id: 'local_private_strict_selection',
            ok: !localPrivateStrict || localPrivateStrictSelection?.ok === true,
            detail: localPrivateStrict
                ? (localPrivateStrictSelection?.detail ?? 'local/private strict selection unavailable')
                : 'not requested',
        },
    ];
    const phases = [
        {
            id: 'runtime_selector_dry_run',
            order: 1,
            command: 'npm run model-gateway:runtime-selector -- --fail',
            executesModelTurn: false,
            executesRuntimeProbes: false,
            consumesProviderQuota: false,
            purpose: 'Validate final route-aware runtime selector readiness before any terminal live-test phase.',
        },
        {
            id: 'runtime_health_baseline',
            order: 2,
            command: `npm run model-gateway:runtime-health:diff -- --write-snapshot --out-dir ${baselineOutDir}`,
            executesModelTurn: false,
            executesRuntimeProbes: false,
            consumesProviderQuota: false,
            purpose: 'Persist a fixed baseline of already-observed runtime health so every later live phase can be diffed against the same pre-live file.',
        },
        {
            id: 'control_no_pr',
            order: 3,
            command: 'npm run model-gateway:live:llm-b -- --no-pr --timeout-ms=180000',
            executesModelTurn: false,
            executesRuntimeProbes: false,
            consumesProviderQuota: false,
            purpose: 'Validate terminal boot, session cockpit, command output, event stream and redaction without an LLM turn.',
        },
        {
            id: 'byok_fixture_control_plane',
            order: 4,
            command: 'npm run model-gateway:live:llm-b -- --byok-probe --byok-fixture --no-pr --timeout-ms=240000',
            executesModelTurn: false,
            executesRuntimeProbes: false,
            consumesProviderQuota: false,
            purpose: 'Exercise BYOK control-plane commands against a local OpenAI-compatible fixture.',
        },
        {
            id: 'byok_real_no_pr_probes',
            order: 5,
            command:
                `npm run model-gateway:live:llm-b -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-allow-probe --byok-real-route-temporary-failure-cooldown-ms=${TERMINAL_LIVE_TEMPORARY_FAILURE_COOLDOWN_MS} --byok-real-route-max-attempts=8 --byok-real-route-max-attempts-per-provider=4 --byok-real-route-timeout-ms=20000 --no-pr --timeout-ms=240000`,
            executesModelTurn: false,
            executesRuntimeProbes: true,
            consumesProviderQuota: true,
            purpose:
                'Run real BYOK probe commands only after readiness and fixture phases pass, applying the route chosen by the model-gateway runtime selector.',
        },
        {
            id: 'byok_real_full_turn',
            order: 6,
            command:
                `npm run model-gateway:live:llm-b -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-allow-probe --byok-real-route-temporary-failure-cooldown-ms=${TERMINAL_LIVE_TEMPORARY_FAILURE_COOLDOWN_MS} --byok-real-route-max-attempts=8 --byok-real-route-max-attempts-per-provider=4 --byok-real-route-timeout-ms=20000 --timeout-ms=900000`,
            executesModelTurn: true,
            executesRuntimeProbes: true,
            consumesProviderQuota: true,
            purpose:
                'Run the full terminal llm-b scenario with a real assistant turn after all lower-risk phases pass, preserving the same runtime-selector route handoff.',
        },
    ];
    const postPhases = [
        {
            id: 'runtime_health_after_live_diff',
            order: 1,
            command:
                `npm run model-gateway:runtime-health:diff -- --baseline ${baselinePath} --write-snapshot --out-dir ${postLiveOutDir} --fail-on-regression`,
            executesModelTurn: false,
            executesRuntimeProbes: false,
            consumesProviderQuota: false,
            purpose: `Diff runtime health after any live phase against the fixed pre-live baseline and fail on ok-to-failed regressions. Comparative report: ${postLiveDiffPath}.`,
        },
        {
            id: 'runtime_health_sqlite_mirror',
            order: 2,
            command: 'npm run model-gateway:runtime-health:mirror',
            executesModelTurn: false,
            executesRuntimeProbes: false,
            consumesProviderQuota: false,
            purpose: 'Ensure already-observed BYOK health is materialized into SQLite after live phases.',
        },
        {
            id: 'runtime_selector_after_live',
            order: 3,
            command: 'npm run model-gateway:runtime-selector -- --fail',
            executesModelTurn: false,
            executesRuntimeProbes: false,
            consumesProviderQuota: false,
            purpose: 'Recompute route-aware runtime selector readiness using the newly observed health facts.',
        },
        {
            id: 'live_readiness_after_live',
            order: 4,
            command: 'npm run model-gateway:live:readiness -- --fail',
            executesModelTurn: false,
            executesRuntimeProbes: false,
            consumesProviderQuota: false,
            purpose: 'Verify catalog, SQLite, selection and runtime selector gates still pass after the live phase.',
        },
    ];
    return {
        schema: 'model-gateway-live-plan',
        ok: prerequisites.every((item) => item.ok),
        generatedAt,
        runId,
        runtimeExecuted: false,
        healthBaseline: {
            outDir: baselineOutDir,
            latestPath: baselinePath,
            latestDiffPath: baselineDiffPath,
            postLiveOutDir,
            postLiveLatestDiffPath: postLiveDiffPath,
        },
        readiness: {
            ok: readiness.ok === true,
            snapshotId: readiness.snapshotId ?? null,
            generatedAt: readiness.generatedAt ?? null,
            checks: readiness.checks ?? [],
            terminalLiveRuntimeSelectorPlan: readiness.selection?.terminalLiveRuntimeSelectorPlan ?? null,
        },
        overlaySummary,
        localPrivateStrict: {
            requested: localPrivateStrict,
            ok: localPrivateStrictSelection?.ok ?? null,
            status: localPrivateStrictSelection?.status ?? null,
        },
        prerequisites,
        phases,
        postPhases,
        nextCommand: phases[0].command,
    };
}

function renderTerminalLiveRoute(route) {
    const runtimeHealth = route.runtimeHealth ?? {};
    const probes = Object.entries(runtimeHealth.probeStatuses ?? {})
        .map(([kind, status]) => `${kind}:${status}`)
        .join(',') || '-';
    const preferred = Object.entries(runtimeHealth.preferredProbeProofs ?? {})
        .map(([kind, ok]) => `${kind}:${ok ? 'ok' : 'missing'}`)
        .join(',') || '-';
    const blocking = Object.entries(runtimeHealth.blockingProbeFailures ?? {})
        .filter(([, failed]) => failed)
        .map(([kind]) => kind)
        .join(',') || '-';
    return [
        `- ${route.profileId}: ${route.providerId ?? '-'} / ${route.providerModel ?? '-'} · routeProfile=${route.routeProfile ?? '-'} · healthProfile=${runtimeHealth.healthRouteProfile ?? '-'} · exact=${runtimeHealth.exactRouteProfileMatch ? 'true' : 'false'} · profileless=${runtimeHealth.profilelessHealth ? 'true' : 'false'}`,
        `  - probes: ${probes}`,
        `  - preferred: ${preferred}`,
        `  - blockingFailures: ${blocking}`,
    ];
}

function renderMarkdown(plan) {
    const terminalLiveRoutes = terminalLiveRouteMatrix(plan.readiness);
    const lines = [
        '# Model Gateway Live Plan',
        '',
        `- ok: ${plan.ok ? 'true' : 'false'}`,
        `- generatedAt: ${plan.generatedAt}`,
        `- runId: ${plan.runId}`,
        `- runtimeExecuted: ${plan.runtimeExecuted ? 'true' : 'false'}`,
        `- snapshotId: ${plan.readiness.snapshotId ?? '-'}`,
        `- healthBaseline: ${plan.healthBaseline.latestPath}`,
        `- postLiveHealthDir: ${plan.healthBaseline.postLiveOutDir}`,
        `- overlays: total=${plan.overlaySummary.total} active=${plan.overlaySummary.activeCount} expired=${plan.overlaySummary.expiredCount}`,
        `- providers: ${countMapText(plan.overlaySummary.byProvider)}`,
        `- failures: ${countMapText(plan.overlaySummary.byFailureKind)}`,
        `- localPrivateStrict: requested=${plan.localPrivateStrict.requested ? 'true' : 'false'} ok=${plan.localPrivateStrict.ok ?? '-'}`,
        '',
        '## Prerequisites',
        '',
        ...plan.prerequisites.map((item) => `- [${item.ok ? 'x' : ' '}] ${item.id}: ${item.detail}`),
        '',
        '## Terminal Live Route Matrix',
        '',
        ...(terminalLiveRoutes.length > 0 ? terminalLiveRoutes.flatMap(renderTerminalLiveRoute) : ['- none']),
        '',
        '## Phases',
        '',
        ...plan.phases.flatMap((phase) => [
            `### ${phase.order}. ${phase.id}`,
            '',
            `- command: \`${phase.command}\``,
            `- executesModelTurn: ${phase.executesModelTurn ? 'true' : 'false'}`,
            `- executesRuntimeProbes: ${phase.executesRuntimeProbes ? 'true' : 'false'}`,
            `- consumesProviderQuota: ${phase.consumesProviderQuota ? 'true' : 'false'}`,
            `- purpose: ${phase.purpose}`,
            '',
        ]),
        '## Post Phases',
        '',
        ...plan.postPhases.flatMap((phase) => [
            `### ${phase.order}. ${phase.id}`,
            '',
            `- command: \`${phase.command}\``,
            `- executesModelTurn: ${phase.executesModelTurn ? 'true' : 'false'}`,
            `- executesRuntimeProbes: ${phase.executesRuntimeProbes ? 'true' : 'false'}`,
            `- consumesProviderQuota: ${phase.consumesProviderQuota ? 'true' : 'false'}`,
            `- purpose: ${phase.purpose}`,
            '',
        ]),
    ];
    return `${lines.join('\n')}\n`;
}

async function writePlanArtifacts(plan, outDir) {
    const stamp = nowStamp();
    await mkdir(outDir, { recursive: true });
    const jsonPath = path.join(outDir, `${stamp}.json`);
    const markdownPath = path.join(outDir, `${stamp}.md`);
    const latestJsonPath = path.join(outDir, 'latest.json');
    const latestMarkdownPath = path.join(outDir, 'latest.md');
    const json = `${JSON.stringify(plan, null, 2)}\n`;
    const markdown = renderMarkdown(plan);
    await writeFile(jsonPath, json, 'utf8');
    await writeFile(markdownPath, markdown, 'utf8');
    await writeFile(latestJsonPath, json, 'utf8');
    await writeFile(latestMarkdownPath, markdown, 'utf8');
    return { jsonPath, markdownPath, latestJsonPath, latestMarkdownPath };
}

const json = argSet.has('--json');
const fail = argSet.has('--fail');
const write = !argSet.has('--no-write');
const allowActiveOverlays = argSet.has('--allow-active-overlays');
const localPrivateStrict = argSet.has('--local-private-strict') || argSet.has('--require-local-private');
const outDir = path.resolve(ROOT, readArg('--out-dir', DEFAULT_OUT_DIR));
const readiness = runReadiness();
const plan = buildPlan(readiness, { allowActiveOverlays, localPrivateStrict });
const artifacts = write ? await writePlanArtifacts(plan, outDir) : null;
const summary = {
    ...plan,
    artifacts,
};

if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    process.stdout.write(
        `model-gateway live plan: ok=${summary.ok ? 'yes' : 'no'} next="${summary.nextCommand}" runtime=no artifacts=${artifacts?.latestMarkdownPath ?? 'not-written'}\n`,
    );
    for (const prerequisite of summary.prerequisites) {
        process.stdout.write(`  ${prerequisite.ok ? 'OK' : 'FAIL'} ${prerequisite.id}: ${prerequisite.detail}\n`);
    }
}

if (fail && !summary.ok) process.exit(1);
