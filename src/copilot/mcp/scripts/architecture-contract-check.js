// @ts-check
/**
 * Gates estruturais leves para impedir regressões conhecidas enquanto hotspots são decompostos incrementalmente.
 *
 * Não tenta substituir ESLint nem uma análise completa de dependências: fixa apenas fronteiras arquiteturais canônicas
 * e ceilings explícitos para arquivos que já ultrapassaram muito o tamanho recomendado pelo projeto.
 *
 * @module copilot/mcp/scripts/architecture-contract-check
 */

import { createWorkspaceReadIo } from '#copilot/infra/public/composition/workspace/read-io';
import { posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const architectureWorkspaceIo = createWorkspaceReadIo({ workspaceRoot: ROOT });
const PRESENTATION_ROOT = 'src/copilot/presentation';
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts']);

const HOTSPOT_BUDGETS = Object.freeze([
    { path: 'src/copilot/terminal/commands/byok.js', maxBytes: 375_000, maxLines: 8_700 },
    { path: 'src/copilot/model-gateway/catalog/sqlite-catalog-store.js', maxBytes: 175_000 },
    { path: 'src/copilot/mcp/auth/issuer/dev-oauth.js', maxBytes: 165_000 },
    { path: 'src/copilot/terminal/commands/session.js', maxBytes: 135_000 },
    { path: 'src/copilot/terminal/commands/sdk.js', maxBytes: 120_000 },
    { path: 'src/copilot/terminal/events/sdk-session-events.js', maxBytes: 112_000 },
    // Recalibrated 2026-08-21 to the main-branch baseline; keep ~2-4% drift headroom, not a size target.
    { path: 'src/copilot/tools/model-gateway/model-gateway-tools.js', maxBytes: 112_000 },
    { path: 'src/copilot/mcp/tools/repo-write.js', maxBytes: 180_000 },
    { path: 'src/copilot/mcp/diagnostics/oauth-smoke/runtime.js', maxBytes: 100_000 },
    { path: 'src/copilot/model-gateway/routing/runtime-selector.js', maxBytes: 98_000 },
    { path: 'src/copilot/sdk/session/provider.js', maxBytes: 90_000 },
    { path: 'src/copilot/terminal/dialog/engine.js', maxBytes: 90_000 },
]);

/** @param {string} path */
async function readWorkspaceText(path) {
    return (await architectureWorkspaceIo.readTextFresh(resolve(ROOT, path), { includeHash: false })).content;
}

/** @param {string} path */
async function collectSourceFiles(path) {
    const absolute = resolve(ROOT, path);
    /** @type {string[]} */
    const files = [];
    const entries = (await architectureWorkspaceIo.listDirectoryNamesFresh(absolute)).entries;
    for (const entryName of entries) {
        const relative = `${path}/${entryName}`;
        const info = (await architectureWorkspaceIo.lstatPath(resolve(ROOT, relative))).stats;
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) files.push(...(await collectSourceFiles(relative)));
        else if (info.isFile() && SOURCE_EXTENSIONS.has(entryName.slice(entryName.lastIndexOf('.'))))
            files.push(relative);
    }
    return files;
}

/**
 * @returns {Promise<{ success: boolean; checks: { name: string; passed: boolean; detail: string }[] }>}
 */
export async function runArchitectureContractCheck() {
    /** @type {{ name: string; passed: boolean; detail: string }[]} */
    const checks = [];

    const mcpToolFiles = await collectSourceFiles('src/copilot/mcp/tools');
    const wireProcessAuthorityPattern =
        /(?:from\s+['"]node:child_process['"]|from\s+['"]child_process['"]|\b(?:spawn|execFile|execFileSync|fork)\s*\(|\bprocess\.kill\s*\(|\bchild\.kill\s*\()/u;
    const wireLauncherLiteralPattern = /(?:src\/copilot\/mcp\/scripts\/|scripts\/model-gateway\/)/u;
    const wireProcessAuthorityViolations = [];
    const wireLauncherViolations = [];
    for (const path of mcpToolFiles) {
        const content = await readWorkspaceText(path);
        if (wireProcessAuthorityPattern.test(content)) wireProcessAuthorityViolations.push(path);
        if (wireLauncherLiteralPattern.test(content)) wireLauncherViolations.push(path);
    }
    checks.push({
        name: 'mcp-wire-tools-own-no-child-process-authority',
        passed: wireProcessAuthorityViolations.length === 0,
        detail:
            wireProcessAuthorityViolations.length === 0
                ? 'wire tools delegate subprocess ownership to semantic runtime owners'
                : `violations=${wireProcessAuthorityViolations.join(',')}`,
    });
    checks.push({
        name: 'mcp-wire-tools-reference-no-physical-launchers',
        passed: wireLauncherViolations.length === 0,
        detail:
            wireLauncherViolations.length === 0
                ? 'wire tools depend on semantic owner APIs rather than launcher paths'
                : `violations=${wireLauncherViolations.join(',')}`,
    });

    const mcpSourceFiles = await collectSourceFiles('src/copilot/mcp');
    const broadChildEnvironmentPattern = /(?:\.\.\.\s*process\.env|\benv\s*:\s*process\.env\b)/u;
    const broadChildEnvironmentViolations = [];
    for (const path of mcpSourceFiles) {
        if (broadChildEnvironmentPattern.test(await readWorkspaceText(path))) {
            broadChildEnvironmentViolations.push(path);
        }
    }
    checks.push({
        name: 'mcp-child-processes-never-inherit-broad-ambient-environment',
        passed: broadChildEnvironmentViolations.length === 0,
        detail:
            broadChildEnvironmentViolations.length === 0
                ? 'child environments are projected/explicit rather than broad ambient inheritance'
                : `violations=${broadChildEnvironmentViolations.join(',')}`,
    });

    const importSpecifierPattern = /(?:\bfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/gu;
    const protectedMcpOwnerRoots = [
        'src/copilot/mcp/adapters',
        'src/copilot/mcp/cloudflare',
        'src/copilot/mcp/composition/process-host',
        'src/copilot/mcp/connection',
        'src/copilot/mcp/diagnostics/http-smoke',
        'src/copilot/mcp/diagnostics/latency/attribution',
        'src/copilot/mcp/diagnostics/latency/benchmark',
        'src/copilot/mcp/diagnostics/runtime-health',
        'src/copilot/mcp/diagnostics/oauth-smoke',
        'src/copilot/mcp/diagnostics/tool-payload',
        'src/copilot/mcp/indexing/repository',
        'src/copilot/mcp/integrations/model-gateway/sqlite-fingerprint',
        'src/copilot/mcp/maintenance/dependencies/native-smoke',
        'src/copilot/mcp/openai',
        'src/copilot/mcp/protocol/apps-sdk',
        'src/copilot/mcp/registry',
        'src/copilot/mcp/server',
        'src/copilot/mcp/tools',
        'src/copilot/mcp/workspace/git',
        'src/copilot/mcp/workspace/repository/status',
        'src/copilot/mcp/workspace/repository/read',
        'src/copilot/mcp/workspace/repository/read-cache',
        'src/copilot/mcp/workspace/repository/patch',
    ];
    const privateOwnerImportViolations = [];
    const crossTopRelativeImportViolations = [];
    const bootAuthorityViolations = [];
    const controlPlaneReferenceViolations = [];
    for (const path of mcpSourceFiles) {
        const content = await readWorkspaceText(path);
        importSpecifierPattern.lastIndex = 0;
        for (const match of content.matchAll(importSpecifierPattern)) {
            const specifier = match[1];
            if (!specifier) continue;
            if (
                (specifier === '#copilot/boot' || specifier.startsWith('#copilot/boot/')) &&
                !path.startsWith('src/copilot/mcp/composition/')
            ) {
                bootAuthorityViolations.push(`${path} -> ${specifier}`);
            }
            if (specifier.includes('/control-plane/') || specifier.startsWith('#copilot/mcp/control-plane')) {
                controlPlaneReferenceViolations.push(`${path} -> ${specifier}`);
            }
            if (!specifier.startsWith('.')) continue;
            const resolvedImport = posix.normalize(posix.join(posix.dirname(path), specifier));
            const mcpRootPrefix = 'src/copilot/mcp/';
            if (path.startsWith(mcpRootPrefix) && resolvedImport.startsWith(mcpRootPrefix)) {
                const sourceTop = path.slice(mcpRootPrefix.length).split('/')[0];
                const targetTop = resolvedImport.slice(mcpRootPrefix.length).split('/')[0];
                if (sourceTop && targetTop && sourceTop !== targetTop) {
                    crossTopRelativeImportViolations.push(`${path} -> ${specifier}`);
                }
            }
            for (const ownerRoot of protectedMcpOwnerRoots) {
                if (!resolvedImport.startsWith(`${ownerRoot}/`)) continue;
                if (path.startsWith(`${ownerRoot}/`)) continue;
                if (resolvedImport.includes('/public/') || resolvedImport.includes('/testing/')) continue;
                privateOwnerImportViolations.push(`${path} -> ${specifier}`);
            }
        }
    }
    checks.push({
        name: 'mcp-relative-cross-top-import-graph-is-zero',
        passed: crossTopRelativeImportViolations.length === 0,
        detail:
            crossTopRelativeImportViolations.length === 0
                ? 'static/dynamic/type relative imports do not cross MCP top-level domains'
                : `violations=${crossTopRelativeImportViolations.join(',')}`,
    });
    checks.push({
        name: 'mcp-boot-authority-confined-to-composition',
        passed: bootAuthorityViolations.length === 0,
        detail:
            bootAuthorityViolations.length === 0
                ? 'only MCP composition roots may depend on application boot authority'
                : `violations=${bootAuthorityViolations.join(',')}`,
    });
    const controlPlaneDirectoryExists = await architectureWorkspaceIo
        .statPath(resolve(ROOT, 'src/copilot/mcp/control-plane'))
        .then((value) => value.stats.isDirectory())
        .catch(() => false);
    checks.push({
        name: 'mcp-control-plane-owner-is-extinct',
        passed: controlPlaneReferenceViolations.length === 0 && !controlPlaneDirectoryExists,
        detail:
            controlPlaneReferenceViolations.length === 0 && !controlPlaneDirectoryExists
                ? 'retired control-plane topology is absent physically and from imports'
                : `directoryExists=${controlPlaneDirectoryExists} violations=${controlPlaneReferenceViolations.join(',') || 'none'}`,
    });
    checks.push({
        name: 'mcp-protected-owner-imports-cross-public-membranes',
        passed: privateOwnerImportViolations.length === 0,
        detail:
            privateOwnerImportViolations.length === 0
                ? 'protected MCP owners are crossed only through public/testing membranes'
                : `violations=${privateOwnerImportViolations.join(',')}`,
    });

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
        const stats = (await architectureWorkspaceIo.statPath(absolute)).stats;
        const content =
            budget.maxLines === undefined
                ? null
                : (await architectureWorkspaceIo.readTextFresh(absolute, { includeHash: false })).content;
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
    const retiredMcpAggregateAliases = [
        '#copilot/mcp',
        '#copilot/mcp/adapters',
        '#copilot/mcp/cloudflare',
        '#copilot/mcp/connection',
        '#copilot/mcp/scripts',
        '#copilot/mcp/tools',
        '#copilot/mcp/openai',
    ];
    const presentRetiredAliases = retiredMcpAggregateAliases.filter((key) => key in packageImports);
    const retiredMcpAggregateFiles = [
        'src/copilot/mcp/index.js',
        'src/copilot/mcp/cloudflare/public/index.js',
        'src/copilot/mcp/connection/index.js',
        'src/copilot/mcp/tool-surface.js',
        'src/copilot/mcp/scripts/tool-payload-audit.js',
        'src/copilot/mcp/server.js',
        'src/copilot/mcp/tools/apps-sdk-resources.js',
        'src/copilot/mcp/composition/process-host.js',
        'src/copilot/mcp/integrations/model-gateway/sqlite-fingerprint.js',
        'src/copilot/mcp/adapters/index.js',
        'src/copilot/mcp/scripts/oauth-smoke.js',
        'src/copilot/mcp/scripts/index.js',
        'src/copilot/mcp/tools/index.js',
        'src/copilot/mcp/openai/index.js',
        'src/copilot/mcp/tools/testing/latency-attribution.js',
    ];
    const presentRetiredFiles = [];
    for (const path of retiredMcpAggregateFiles) {
        const exists = await architectureWorkspaceIo
            .statPath(resolve(ROOT, path))
            .then((value) => value.stats.isFile() || value.stats.isDirectory())
            .catch(() => false);
        if (exists) presentRetiredFiles.push(path);
    }
    checks.push({
        name: 'mcp-retired-aggregate-surfaces-remain-absent',
        passed: presentRetiredAliases.length === 0 && presentRetiredFiles.length === 0,
        detail:
            presentRetiredAliases.length === 0 && presentRetiredFiles.length === 0
                ? 'retired MCP aggregate aliases/barrels and misplaced owner files remain absent'
                : `aliases=${presentRetiredAliases.join(',') || 'none'} files=${presentRetiredFiles.join(',') || 'none'}`,
    });
    for (const [key, target] of Object.entries(packageImports)) {
        const checkedSurface =
            key.startsWith('#copilot/sdk') ||
            key.startsWith('#copilot/mcp/public/') ||
            key.startsWith('#copilot/testing/mcp/');
        if (!checkedSurface || key.includes('*') || typeof target !== 'string' || !target.startsWith('./')) continue;
        const exists = await architectureWorkspaceIo
            .statPath(resolve(ROOT, target.slice(2)))
            .then((value) => value.stats.isFile() || value.stats.isDirectory())
            .catch(() => false);
        checks.push({
            name: `public-package-import-target:${key}`,
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
        'src/copilot/mcp/runtime/reload/runner.js',
        'src/copilot/mcp/scripts/scheduled-transport-benchmark-runner.js',
        'src/copilot/mcp/cloudflare/transport-benchmark/runtime.js',
        'src/copilot/mcp/cloudflare/transport-benchmark/state.js',
        'src/copilot/mcp/diagnostics/io-cache/worker.js',
        'src/copilot/mcp/scripts/scheduled-io-cache-benchmark-runner.js',
        'src/copilot/mcp/validation/suites/runtime.js',
        'src/copilot/mcp/scripts/run-safe-validation-suite.js',
        'src/copilot/mcp/validation/devcontainer-shell/runtime.js',
        'src/copilot/mcp/scripts/validate-devcontainer-shell.js',
        'src/copilot/mcp/transport/http/stateful/bootstrap/runtime.js',
        'src/copilot/mcp/scripts/stateful-env.js',
    ]) {
        const exists = await architectureWorkspaceIo
            .statPath(resolve(ROOT, path))
            .then((value) => value.stats.isFile())
            .catch(() => false);
        checks.push({
            name: `autonomy-runtime-entry-exists:${path}`,
            passed: exists,
            detail: exists ? 'ok' : 'missing',
        });
    }

    const byokLabels = await architectureWorkspaceIo
        .statPath(resolve(ROOT, 'src/copilot/terminal/byok/rendering/labels.js'))
        .then((value) => value.stats.isFile())
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
