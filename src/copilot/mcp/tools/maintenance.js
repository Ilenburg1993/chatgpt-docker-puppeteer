// @ts-check
/**
 * MCP maintenance batch tools.
 *
 * @module copilot/mcp/tools/maintenance
 */

import { buildIoIndexForDirectory, getIoIndexStats } from '#copilot/infra/public/indexing';
import {
    boundedWriteAnnotations,
    buildAiArtifactsReport,
    cleanupAiArtifacts,
    destructiveAnnotations,
    inspectRootDependencyUpdates,
    okResult,
    openWorldBoundedWriteAnnotations,
    openWorldReadOnlyAnnotations,
    readMcpMetricsSnapshot,
    readOnlyAnnotations,
    upgradeRootDependenciesToLatest,
} from '#copilot/mcp/control-plane';
import { WORKSPACE_ROOT } from '#copilot/tools';
import { z } from 'zod';
import { buildMcpCapabilitiesSummary } from './meta.js';
import { repoStatusHandler } from './repo-status.js';
import { mcpSmokeWorkspaceTool } from './smoke-workspace.js';

const maintenanceFixSchema = z.enum([
    'ai-artifacts-report',
    'refresh-index',
    'run-mcp-smoke',
    'summarize-tools',
    'workspace-status',
]);

const DEFAULT_FIXES = ['workspace-status', 'summarize-tools', 'ai-artifacts-report', 'run-mcp-smoke'];

/**
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function buildMaintenancePlanItems() {
    const indexStats = getIoIndexStats();
    const metrics = readMcpMetricsSnapshot();
    const aiArtifactsReport = await buildAiArtifactsReport();
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
 * @type {import('../registry.js').McpToolDefinition[]}
 */
export const maintenanceTools = [
    {
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
        annotations: openWorldReadOnlyAnnotations(),
        handler: async ({ timeoutMs } = {}) => okResult(await inspectRootDependencyUpdates({ timeoutMs })),
    },
    {
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
        annotations: openWorldBoundedWriteAnnotations(),
        handler: async ({ confirmUpgrade, install, timeoutMs }) => {
            if (confirmUpgrade !== true) {
                return okResult({
                    success: false,
                    code: 'ERR_DEPENDENCY_UPGRADE_CONFIRM_REQUIRED',
                    hint: 'Pass confirmUpgrade=true only after reviewing mcp_dependency_outdated.',
                });
            }
            return okResult(await upgradeRootDependenciesToLatest({ install, timeoutMs }));
        },
    },
    {
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
        annotations: destructiveAnnotations(),
        handler: async ({ dryRun, retainNewest, maxDeleteCount, purgeDisabledRollback } = {}) =>
            okResult(
                await cleanupAiArtifacts({
                    dryRun,
                    retainNewest,
                    maxDeleteCount,
                    purgeDisabledRollback,
                }),
            ),
    },
    {
        name: 'mcp_maintenance_plan',
        title: 'MCP maintenance plan',
        description:
            'Return the safe batched maintenance actions available for this MCP server, with risk and default behavior.',
        inputSchema: {},
        annotations: readOnlyAnnotations(),
        handler: async () =>
            okResult({
                success: true,
                defaultDryRun: true,
                defaultFixes: [...DEFAULT_FIXES],
                items: await buildMaintenancePlanItems(),
                note: 'Use mcp_maintenance_apply_safe_fixes with dryRun=true first. No arbitrary shell or arbitrary paths are accepted.',
            }),
    },
    {
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
        annotations: boundedWriteAnnotations(),
        handler: async ({ fixes, dryRun }) => {
            const selectedFixes = normalizeFixes(fixes);
            const isDryRun = dryRun !== false;
            /** @type {Record<string, unknown>[]} */
            const results = [];

            for (const fix of selectedFixes) {
                if (fix === 'workspace-status') {
                    const status = await repoStatusHandler();
                    results.push({
                        fix,
                        dryRun: isDryRun,
                        success: status.structuredContent?.['success'] === true,
                        dirty: status.structuredContent?.['dirty'] === true,
                        branch: status.structuredContent?.['branch'] ?? null,
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
                        report: await buildAiArtifactsReport(),
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
                        const smoke = await mcpSmokeWorkspaceTool.handler({});
                        results.push({
                            fix,
                            dryRun: false,
                            success: smoke.structuredContent?.['success'] === true,
                            status: smoke.structuredContent?.['status'] ?? null,
                            warnings: smoke.structuredContent?.['warnings'] ?? [],
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
                                workspaceRoot: WORKSPACE_ROOT,
                                recursive: true,
                                depth: 20,
                                respectGitignore: true,
                                concurrency: 8,
                                maxFiles: 25_000,
                                pruneMissing: true,
                            },
                            currentStats: getIoIndexStats(),
                        });
                    } else {
                        const result = await buildIoIndexForDirectory('src/copilot', {
                            workspaceRoot: WORKSPACE_ROOT,
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
                            stats: getIoIndexStats(),
                        });
                    }
                }
            }

            return okResult({
                success: results.every((result) => result['success'] === true),
                dryRun: isDryRun,
                fixes: selectedFixes,
                results,
                metrics: readMcpMetricsSnapshot().totals,
            });
        },
    },
];
