// @ts-check
/**
 * MCP maintenance batch tools.
 *
 * @module copilot/mcp/tools/maintenance
 */

import { runMcpWorkspaceSmoke } from '#copilot/mcp/public/diagnostics/workspace-smoke';
import { inspectRootDependencyUpdates, upgradeRootDependenciesToLatest } from '#copilot/mcp/public/maintenance';
import { readMcpMetricsSnapshot } from '#copilot/mcp/public/observability';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    okResult,
    requireMcpToolAiArtifactsCapability,
    requireMcpToolCloudflareConfig,
    requireMcpToolGitConfig,
    requireMcpToolWorkspace,
} from '#copilot/mcp/public/protocol/tools';
import { readRepositoryStatus } from '#copilot/mcp/public/workspace/repository/status';
import { z } from 'zod';
import { buildMcpCapabilitiesSummary } from './meta.js';

const maintenanceFixSchema = z.enum([
    'ai-artifacts-report',
    'refresh-index',
    'run-mcp-smoke',
    'summarize-tools',
    'workspace-status',
]);

const DEFAULT_FIXES = ['workspace-status', 'summarize-tools', 'ai-artifacts-report', 'run-mcp-smoke'];

/**
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability['indexRegistry']} indexRegistry
 * @param {ReturnType<typeof import('#copilot/mcp/public/maintenance').createAiArtifactsRuntime>} aiArtifacts
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function buildMaintenancePlanItems(indexRegistry, aiArtifacts) {
    const indexStats = indexRegistry.status();
    const metrics = readMcpMetricsSnapshot();
    const aiArtifactsReport = await aiArtifacts.buildReport();
    return [
        {
            fix: 'workspace-status',
            risk: 'read-only',
            defaultIncluded: true,
            effect: 'Refreshes dirty/workspace status without mutation.',
            recommendedWhen: 'Always at the beginning of a ChatGPT repo session.',
        },
        {
            fix: 'summarize-tools',
            risk: 'read-only',
            defaultIncluded: true,
            effect: 'Returns canonical tool categories and guidance.',
            recommendedWhen: 'Before broad task planning or after server refresh.',
        },
        {
            fix: 'run-mcp-smoke',
            risk: 'read-only',
            defaultIncluded: true,
            effect: 'Runs the read-only MCP workspace smoke suite.',
            recommendedWhen: 'After tunnel/server restart or tool registry changes.',
        },
        {
            fix: 'ai-artifacts-report',
            risk: 'read-only',
            defaultIncluded: true,
            effect: 'Reports src/copilot/.ai growth, job artifact retention candidates, and protected state categories without deleting anything.',
            recommendedWhen: 'After long ChatGPT/MCP sessions that run many validator jobs.',
            currentReport: aiArtifactsReport,
        },
        {
            fix: 'refresh-index',
            risk: 'bounded-write',
            defaultIncluded: false,
            effect: 'Refreshes the shared local Copilot IO index for src/copilot.',
            recommendedWhen: indexStats.available ? 'When code navigation feels stale.' : 'When index is unavailable.',
            currentIndexStats: indexStats,
        },
        {
            fix: 'metrics-snapshot',
            risk: 'read-only',
            defaultIncluded: false,
            effect: 'Included automatically in every maintenance result.',
            recommendedWhen: 'Useful for diagnosing tool latency and error count.',
            currentMetrics: metrics.totals,
        },
    ];
}

/**
 * @param {unknown} fixes
 * @returns {string[]}
 */
function normalizeFixes(fixes) {
    if (!Array.isArray(fixes) || fixes.length === 0) return [...DEFAULT_FIXES];
    return [...new Set(fixes.map(String))];
}

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]}
 */
export const maintenanceTools = [
    defineMcpRawTool({
        name: 'mcp_dependency_outdated',
        title: 'Audit root dependency updates',
        description:
            'Compare the root package dependencies with npm registry latest versions using the fixed local npm-check-updates workflow. No arbitrary package, registry, command, cwd or environment input is accepted.',
        inputSchema: {
            timeoutMs: z
                .number()
                .int()
                .min(30_000)
                .max(1_800_000)
                .optional()
                ['describe']('Fixed audit timeout. Default: 180000ms.'),
        },

        handler: async ({ timeoutMs }, operationContext) =>
            okResult(
                await inspectRootDependencyUpdates({
                    workspace: requireMcpToolWorkspace(operationContext),
                    ...(timeoutMs === undefined ? {} : { timeoutMs }),
                    ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
                }),
            ),
    }),
    defineMcpRawTool({
        name: 'mcp_dependency_upgrade',
        title: 'Upgrade root dependencies to latest',
        description:
            'Upgrade every root dependency/devDependency reported by npm-check-updates to the npm registry latest tag using the packageManager-pinned npm version. Lock resolution disables lifecycle scripts; the final install enables them and runs fixed native-binding smoke checks. Requires explicit confirmation and never accepts arbitrary packages or commands.',
        inputSchema: {
            confirmUpgrade: z.literal(true)['describe']('Explicitly confirm the full root dependency upgrade.'),
            install: z
                .boolean()
                .optional()
                ['describe']('Install node_modules after resolving the lockfile. Default: true.'),
            timeoutMs: z
                .number()
                .int()
                .min(30_000)
                .max(1_800_000)
                .optional()
                ['describe']('Per-step timeout. Default: 900000ms.'),
        },

        handler: async ({ confirmUpgrade, install, timeoutMs }, operationContext) => {
            if (confirmUpgrade !== true) {
                return okResult({
                    success: false,
                    code: 'ERR_DEPENDENCY_UPGRADE_CONFIRM_REQUIRED',
                    hint: 'Pass confirmUpgrade=true only after reviewing mcp_dependency_outdated.',
                });
            }
            return okResult(
                await upgradeRootDependenciesToLatest({
                    workspace: requireMcpToolWorkspace(operationContext),
                    ...(install === undefined ? {} : { install }),
                    ...(timeoutMs === undefined ? {} : { timeoutMs }),
                    ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
                }),
            );
        },
    }),
    defineMcpRawTool({
        name: 'mcp_cleanup_ai_artifacts',
        title: 'Cleanup MCP AI artifacts',
        description:
            'Delete a bounded set of strict UUID-named validator artifacts beyond retention. Rollback sidecars can be purged only by explicit request while automatic rollback is disabled; OAuth, tunnel, pid and quarantine state stay unreachable.',
        inputSchema: {
            dryRun: z.boolean().optional()['describe']('Preview without deleting. Default: true.'),
            retainNewest: z
                .number()
                .int()
                .min(20)
                .max(10_000)
                .optional()
                ['describe']('Number of newest artifacts to retain. Default: 240.'),
            maxDeleteCount: z
                .number()
                .int()
                .min(1)
                .max(500)
                .optional()
                ['describe']('Maximum files deleted in one cleanup domain per call. Default: 100.'),
            purgeDisabledRollback: z
                .boolean()
                .optional()
                ['describe'](
                    'Purge strict rollback sidecars/pending files only when automatic rollback is disabled. Default: false.',
                ),
        },

        handler: async ({ dryRun, retainNewest, maxDeleteCount, purgeDisabledRollback }, operationContext) =>
            okResult(
                await requireMcpToolAiArtifactsCapability(operationContext).cleanup({
                    ...(dryRun === undefined ? {} : { dryRun }),
                    ...(retainNewest === undefined ? {} : { retainNewest }),
                    ...(maxDeleteCount === undefined ? {} : { maxDeleteCount }),
                    ...(purgeDisabledRollback === undefined ? {} : { purgeDisabledRollback }),
                }),
            ),
    }),
    defineMcpRawTool({
        name: 'mcp_maintenance_apply_safe_fixes',
        title: 'Apply safe MCP maintenance fixes',
        description:
            'Run a fixed allowlisted batch of MCP maintenance actions. Defaults to dryRun=true and never accepts arbitrary shell commands.',
        inputSchema: {
            fixes: z
                .array(maintenanceFixSchema)
                .optional()
                ['describe']('Allowlisted maintenance fixes. Default: safe reads.'),
            dryRun: z.boolean().optional()['describe']('Plan without mutation. Default: true.'),
        },

        handler: async ({ fixes, dryRun }, operationContext) => {
            const workspace = requireMcpToolWorkspace(operationContext);
            const readIoIndexStatus = workspace.indexRegistry.status;
            const buildIoIndexForDirectory = workspace.indexRegistry.buildDirectory;
            const selectedFixes = normalizeFixes(fixes);
            const isDryRun = dryRun !== false;
            const planItems = isDryRun
                ? await buildMaintenancePlanItems(
                      workspace.indexRegistry,
                      requireMcpToolAiArtifactsCapability(operationContext),
                  )
                : null;
            /** @type {Record<string, unknown>[]} */
            const results = [];

            for (const fix of selectedFixes) {
                if (fix === 'workspace-status') {
                    const status = await readRepositoryStatus({
                        workspaceRoot: workspace.workspaceRoot,
                        gitConfig: requireMcpToolGitConfig(operationContext),
                        ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
                    });
                    results.push({
                        fix,
                        dryRun: isDryRun,
                        success: status.success,
                        dirty: status.success ? status.dirty : null,
                        branch: status.success ? status.branch : null,
                    });
                    continue;
                }
                if (fix === 'summarize-tools') {
                    const summary = buildMcpCapabilitiesSummary();
                    results.push({
                        fix,
                        dryRun: isDryRun,
                        success: true,
                        advertisedToolCount: summary['advertisedToolCount'],
                        ioGuidance: summary['ioGuidance'],
                    });
                    continue;
                }
                if (fix === 'ai-artifacts-report') {
                    results.push({
                        fix,
                        dryRun: isDryRun,
                        success: true,
                        report:
                            planItems?.find((item) => item['fix'] === 'ai-artifacts-report')?.['currentReport'] ??
                            (await requireMcpToolAiArtifactsCapability(operationContext).buildReport()),
                    });
                    continue;
                }
                if (fix === 'run-mcp-smoke') {
                    if (isDryRun) {
                        results.push({
                            fix,
                            dryRun: true,
                            success: true,
                            plannedTool: 'mcp_smoke_workspace',
                        });
                    } else {
                        const smoke = await runMcpWorkspaceSmoke(
                            workspace,
                            requireMcpToolCloudflareConfig(operationContext),
                            {
                                gitConfig: requireMcpToolGitConfig(operationContext),
                                ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
                            },
                        );
                        results.push({
                            fix,
                            dryRun: false,
                            success: smoke.success,
                            status: smoke.status,
                            warnings: smoke.warnings,
                        });
                    }
                    continue;
                }
                if (fix === 'refresh-index') {
                    if (isDryRun) {
                        results.push({
                            fix,
                            dryRun: true,
                            success: true,
                            plannedPath: 'src/copilot',
                            plannedOptions: {
                                workspaceRoot: workspace.workspaceRoot,
                                recursive: true,
                                depth: 20,
                                respectGitignore: true,
                                concurrency: 8,
                                maxFiles: 25_000,
                                pruneMissing: true,
                            },
                            currentStats: readIoIndexStatus(),
                        });
                    } else {
                        const result = await buildIoIndexForDirectory('src/copilot', {
                            workspaceRoot: workspace.workspaceRoot,
                            recursive: true,
                            depth: 20,
                            respectGitignore: true,
                            concurrency: 8,
                            maxFiles: 25_000,
                            pruneMissing: true,
                        });
                        results.push({
                            fix,
                            dryRun: false,
                            success: result.available !== false,
                            result,
                            stats: readIoIndexStatus(),
                        });
                    }
                }
            }

            return okResult({
                success: results.every((result) => result['success'] === true),
                dryRun: isDryRun,
                fixes: selectedFixes,
                ...(isDryRun
                    ? {
                          defaultDryRun: true,
                          defaultFixes: [...DEFAULT_FIXES],
                          items: planItems ?? [],
                          note: 'This dry-run is the canonical maintenance preview; no separate maintenance plan tool is required.',
                      }
                    : {}),
                results,
                metrics: readMcpMetricsSnapshot().totals,
            });
        },
    }),
];
