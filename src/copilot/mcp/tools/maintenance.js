// @ts-check
/**
 * MCP maintenance batch tools.
 *
 * @module copilot/mcp/tools/maintenance
 */

import { buildIoIndexForDirectory, getIoIndexStats } from '#copilot/infra/public/indexing';
import { WORKSPACE_ROOT } from '#copilot/tools';
import { z } from 'zod';
import { boundedWriteAnnotations, okResult, readMcpMetricsSnapshot, readOnlyAnnotations } from '#copilot/mcp/control-plane';
import { buildMcpCapabilitiesSummary } from './meta.js';
import { repoStatusHandler } from './repo-status.js';
import { mcpSmokeWorkspaceTool } from './smoke-workspace.js';

const maintenanceFixSchema = z.enum(['refresh-index', 'run-mcp-smoke', 'summarize-tools', 'workspace-status']);

const DEFAULT_FIXES = ['workspace-status', 'summarize-tools', 'run-mcp-smoke'];

/**
 * @returns {Record<string, unknown>[]}
 */
function buildMaintenancePlanItems() {
    const indexStats = getIoIndexStats();
    const metrics = readMcpMetricsSnapshot();
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
                items: buildMaintenancePlanItems(),
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
                .describe('Allowlisted maintenance fixes. Default: safe reads.'),
            dryRun: z.boolean().optional().describe('Plan without mutation. Default: true.'),
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
