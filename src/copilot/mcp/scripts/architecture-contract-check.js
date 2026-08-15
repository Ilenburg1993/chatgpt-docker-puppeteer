// @ts-check
/**
 * Gates estruturais leves para impedir regressões conhecidas enquanto hotspots são decompostos incrementalmente.
 *
 * Não tenta substituir ESLint nem uma análise completa de dependências: fixa apenas fronteiras arquiteturais canônicas
 * e ceilings explícitos para arquivos que já ultrapassaram muito o tamanho recomendado pelo projeto.
 *
 * @module copilot/mcp/scripts/architecture-contract-check
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const PRESENTATION_ROOT = 'src/copilot/presentation';
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts']);

const HOTSPOT_BUDGETS = Object.freeze([
    { path: 'src/copilot/terminal/commands/byok.js', maxBytes: 375_000, maxLines: 8_700 },
    { path: 'src/copilot/model-gateway/catalog/sqlite-catalog-store.js', maxBytes: 175_000 },
    { path: 'src/copilot/mcp/control-plane/dev-oauth.js', maxBytes: 165_000 },
    { path: 'src/copilot/terminal/commands/session.js', maxBytes: 135_000 },
    { path: 'src/copilot/terminal/commands/sdk.js', maxBytes: 120_000 },
    { path: 'src/copilot/terminal/events/sdk-session-events.js', maxBytes: 112_000 },
    { path: 'src/copilot/tools/model-gateway/model-gateway-tools.js', maxBytes: 108_000 },
    { path: 'src/copilot/mcp/tools/repo-write.js', maxBytes: 105_000 },
    { path: 'src/copilot/mcp/scripts/oauth-smoke.js', maxBytes: 100_000 },
    { path: 'src/copilot/model-gateway/routing/runtime-selector.js', maxBytes: 95_000 },
    { path: 'src/copilot/sdk/session/provider.js', maxBytes: 90_000 },
    { path: 'src/copilot/terminal/dialog/engine.js', maxBytes: 90_000 },
]);

/** @param {string} path */
async function readWorkspaceText(path) {
    return readFile(resolve(ROOT, path), 'utf8');
}

/** @param {string} path */
async function collectSourceFiles(path) {
    const absolute = resolve(ROOT, path);
    /** @type {string[]} */
    const files = [];
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
        const relative = `${path}/${entry.name}`;
        if (entry.isDirectory()) files.push(...(await collectSourceFiles(relative)));
        else if (entry.isFile() && SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) files.push(relative);
    }
    return files;
}

/**
 * @returns {Promise<{ success: boolean; checks: Array<{ name: string; passed: boolean; detail: string }> }>}
 */
export async function runArchitectureContractCheck() {
    /** @type {Array<{ name: string; passed: boolean; detail: string }>} */
    const checks = [];

    const presentationFiles = await collectSourceFiles(PRESENTATION_ROOT);
    const forbiddenBoundaryPattern = /(?:from\s+|import\s*)['"][^'"]*(?:\/terminal\/|#copilot\/terminal(?:\/|['"]))/u;
    for (const path of presentationFiles) {
        const content = await readWorkspaceText(path);
        const passed = !forbiddenBoundaryPattern.test(content);
        checks.push({
            name: `presentation-does-not-import-terminal:${path}`,
            passed,
            detail: passed ? 'ok' : 'presentation -> terminal import violates the shared-boundary contract',
        });
    }

    for (const budget of HOTSPOT_BUDGETS) {
        const absolute = resolve(ROOT, budget.path);
        const stats = await stat(absolute);
        const content = budget.maxLines === undefined ? null : await readFile(absolute, 'utf8');
        const lines = content === null ? null : content.split(/\r?\n/u).length;
        const withinBytes = stats.size <= budget.maxBytes;
        const withinLines = budget.maxLines === undefined || (lines !== null && lines <= budget.maxLines);
        checks.push({
            name: `hotspot-budget:${budget.path}`,
            passed: withinBytes && withinLines,
            detail: `bytes=${stats.size}/${budget.maxBytes}${budget.maxLines === undefined ? '' : ` lines=${String(lines)}/${budget.maxLines}`}`,
        });
    }

    const permissionFallbackContracts = [
        {
            path: 'src/copilot/config/session-config.js',
            forbidden: ['?? approveAll', '= approveAll'],
            required: 'createConfiguredPermissionHandler',
        },
        {
            path: 'src/copilot/sdk/session/lifecycle.js',
            forbidden: ['?? approveAll', '= approveAll'],
            required: 'createConfiguredPermissionHandler',
        },
        {
            path: 'src/copilot/server/routes/sdk/session-crud.js',
            forbidden: ['sdkSession.approveAll'],
            required: 'createConfiguredPermissionHandler',
        },
    ];
    for (const contract of permissionFallbackContracts) {
        const content = await readWorkspaceText(contract.path);
        const forbiddenFound = contract.forbidden.filter((snippet) => content.includes(snippet));
        const requiredPresent = content.includes(contract.required);
        checks.push({
            name: `permission-fallback-contract:${contract.path}`,
            passed: forbiddenFound.length === 0 && requiredPresent,
            detail:
                forbiddenFound.length === 0 && requiredPresent
                    ? 'configured policy helper is the implicit fallback'
                    : `required=${requiredPresent} forbidden=${forbiddenFound.join(',') || 'none'}`,
        });
    }

    const alwaysAliveProfile = await readWorkspaceText('src/copilot/hooks/presets/profiles.js');
    checks.push({
        name: 'always-alive-permission-default-is-configurable',
        passed: alwaysAliveProfile.includes('onPermissionRequest = createConfiguredPermissionHandler()'),
        detail: 'approve_all remains the central policy default; AlwaysAlive does not hard-code a separate fallback',
    });

    const packageJson = JSON.parse(await readWorkspaceText('package.json'));
    const packageLock = JSON.parse(await readWorkspaceText('package-lock.json'));
    const declaredSdkVersion = packageJson?.dependencies?.['@github/copilot-sdk'];
    const installedSdkVersion = packageLock?.packages?.['node_modules/@github/copilot-sdk']?.version;
    const sdkVersionAligned =
        typeof declaredSdkVersion === 'string' &&
        typeof installedSdkVersion === 'string' &&
        (declaredSdkVersion === installedSdkVersion || declaredSdkVersion.endsWith(installedSdkVersion));
    checks.push({
        name: 'copilot-sdk-declared-installed-version-aligned',
        passed: sdkVersionAligned,
        detail: `declared=${String(declaredSdkVersion ?? 'missing')} installed=${String(installedSdkVersion ?? 'missing')}`,
    });

    const packageImports = packageJson?.imports && typeof packageJson.imports === 'object' ? packageJson.imports : {};
    for (const [key, target] of Object.entries(packageImports)) {
        if (!key.startsWith('#copilot/sdk') || key.includes('*') || typeof target !== 'string' || !target.startsWith('./')) {
            continue;
        }
        const exists = await stat(resolve(ROOT, target.slice(2)))
            .then((value) => value.isFile() || value.isDirectory())
            .catch(() => false);
        checks.push({
            name: `sdk-package-import-target:${key}`,
            passed: exists,
            detail: `${target} ${exists ? 'exists' : 'missing'}`,
        });
    }

    const usageHandler = await readWorkspaceText('src/copilot/event-handlers/usage.js');
    const usageClassifier = await readWorkspaceText('src/copilot/event-handlers/usage-classifier.js');
    const autoModelPolicy = await readWorkspaceText('src/copilot/sdk/models/auto-policy.js');
    const liveRunner = await readWorkspaceText(
        'scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs',
    );
    const liveReadiness = await readWorkspaceText('scripts/model-gateway/commands/model-gateway-live-readiness.mjs');
    checks.push({
        name: 'usage-domain-does-not-infer-premium-requests',
        passed:
            !usageHandler.includes("emit('pr.consumed'") &&
            !usageClassifier.includes("PREMIUM_REQUEST: 'premium_request'") &&
            usageClassifier.includes("USER_TURN: 'user_turn'"),
        detail: 'assistant.usage is attributed by origin; request-based billing is legacy-only',
    });
    checks.push({
        name: 'auto-model-policy-is-usage-based',
        passed:
            !autoModelPolicy.includes('premium_multiplier_lte_1') &&
            !autoModelPolicy.includes('models_with_premium_request_multiplier_gt_1') &&
            autoModelPolicy.includes('usage_cost_efficiency'),
        detail: 'Auto policy has no request-multiplier criterion in the current usage-based contract',
    });
    checks.push({
        name: 'llmb-live-control-only-is-canonical',
        passed:
            liveRunner.includes('--control-only') &&
            liveRunner.includes('--no-pr is deprecated') &&
            !liveReadiness.includes('--no-pr'),
        detail: '--control-only is canonical; --no-pr exists only as a deprecated parser alias',
    });
    for (const path of [
        'src/copilot/mcp/tools/git-write.js',
        'src/copilot/mcp/tools/llm-b-live.js',
        'src/copilot/mcp/tools/restart-control.js',
        'src/copilot/mcp/scripts/scheduled-restart-runner.js',
        'src/copilot/mcp/scripts/scheduled-transport-benchmark-runner.js',
        'src/copilot/mcp/scripts/io-cache-benchmark-worker.js',
        'src/copilot/mcp/scripts/scheduled-io-cache-benchmark-runner.js',
    ]) {
        const exists = await stat(resolve(ROOT, path))
            .then((value) => value.isFile())
            .catch(() => false);
        checks.push({
            name: `autonomy-control-plane-exists:${path}`,
            passed: exists,
            detail: exists ? 'ok' : 'missing',
        });
    }

    const byokLabels = await stat(resolve(ROOT, 'src/copilot/terminal/byok/rendering/labels.js'))
        .then((value) => value.isFile())
        .catch(() => false);
    checks.push({
        name: 'byok-presentation-labels-extracted',
        passed: byokLabels,
        detail: byokLabels ? 'terminal/byok/rendering/labels.js exists' : 'extracted BYOK labels module missing',
    });

    return { success: checks.every((check) => check.passed), checks };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const report = await runArchitectureContractCheck();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.success) process.exitCode = 1;
}
