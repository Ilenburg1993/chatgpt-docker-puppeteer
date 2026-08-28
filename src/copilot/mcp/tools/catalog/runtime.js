// @ts-check
/**
 * Canonical composition of MCP wire-tool definitions.
 *
 * This module is deliberately not a barrel: callers receive the ordered catalog as one semantic value. Runtime
 * views of the normalized/surfaced registry are supplied later through OperationContext capabilities, never globals.
 *
 * @module copilot/mcp/tools/catalog/runtime
 */

import { mcpAppsSdkReadinessTool } from '../apps-sdk-readiness.js';
import { mcpClientLatencyEvidenceTool } from '../client-latency-evidence.js';
import { mcpCloudflareEdgePolicyApplyTool } from '../cloudflare-edge-apply.js';
import { mcpCloudflareEdgeBackupCreateTool, mcpCloudflareEdgeBackupsListTool } from '../cloudflare-edge-backup.js';
import { mcpCloudflareEdgeSnapshotTool } from '../cloudflare-edge-snapshot.js';
import { mcpCloudflareMetricsSnapshotTool } from '../cloudflare-metrics.js';
import { companyKnowledgeTools } from '../company-knowledge.js';
import { connectionTools } from '../connection.js';
import { copilotSessionTools } from '../copilot-session.js';
import { delegateToRepoAutonomyRunnerTool } from '../delegation-runner.js';
import {
    mcpDevcontainerNetworkControlPlaneRefreshTool,
    mcpDevcontainerNetworkPostureAuditTool,
} from '../devcontainer-network-posture.js';
import { gitReadTools } from '../git-read.js';
import { gitWriteTools } from '../git-write.js';
import { mcpHostBlockDiagnosticsTool } from '../host-blocks.js';
import { jobTools } from '../jobs.js';
import { mcpLatencyAttributionTool, mcpLatencyPulseTool } from '../latency-attribution.js';
import { mcpLatencyDashboardTool } from '../latency-dashboard.js';
import { llmBLiveTools } from '../llm-b-live.js';
import { maintenanceTools } from '../maintenance.js';
import { metaTools } from '../meta.js';
import { mcpOAuthFrictionAuditTool } from '../oauth-friction-audit.js';
import { mcpOpenAiEndpointLatencyTool } from '../openai-endpoint-latency.js';
import { projectDoctorTool } from '../project-doctor.js';
import { repoIndexTools } from '../repo-index.js';
import { repoReadTools } from '../repo-read.js';
import { repoWorkingSetTool } from '../repo-working-set.js';
import { repoWriteTools } from '../repo-write.js';
import { mcpReloadTools } from '../restart-control.js';
import { mcpRoundTripAnalyticsTool } from '../round-trip-analytics.js';
import { mcpRuntimeHealthTool } from '../runtime-health.js';
import { mcpSmokeWorkspaceTool } from '../smoke-workspace.js';
import { terminalTools } from '../terminal.js';
import { mcpToolPayloadAuditTool } from '../tool-payload-audit.js';
import { mcpConnectorSmokeRefreshTool, mcpPostRestartReadinessTool, mcpTunnelStatusTool } from '../tunnel-status.js';
import { assertMcpToolOptionContractParity } from './option-contracts.js';
import { attachMcpToolSemanticContracts } from './semantic-contracts.js';

/** @typedef {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} McpRawToolDefinition */
/** @typedef {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition} McpToolDefinition */

const devcontainerNetworkTools = [
    mcpDevcontainerNetworkPostureAuditTool,
    mcpDevcontainerNetworkControlPlaneRefreshTool,
];

/**
 * @returns {McpToolDefinition[]}
 */
export function buildMcpWireToolCatalog() {
    /** @type {McpRawToolDefinition[]} */
    const tools = [
        ...repoReadTools,
        ...repoIndexTools,
        repoWorkingSetTool,
        ...gitReadTools,
        ...gitWriteTools,
        projectDoctorTool,
        ...jobTools,
        ...llmBLiveTools,
        mcpClientLatencyEvidenceTool,
        mcpLatencyAttributionTool,
        mcpLatencyDashboardTool,
        mcpLatencyPulseTool,
        mcpOpenAiEndpointLatencyTool,
        mcpRoundTripAnalyticsTool,
        mcpToolPayloadAuditTool,
        ...maintenanceTools,
        ...terminalTools,
        delegateToRepoAutonomyRunnerTool,
        mcpAppsSdkReadinessTool,
        ...companyKnowledgeTools,
        ...devcontainerNetworkTools,
        mcpCloudflareEdgeBackupCreateTool,
        mcpCloudflareEdgeBackupsListTool,
        mcpCloudflareEdgePolicyApplyTool,
        mcpCloudflareEdgeSnapshotTool,
        mcpCloudflareMetricsSnapshotTool,
        mcpHostBlockDiagnosticsTool,
        ...connectionTools,
        ...repoWriteTools,
        ...copilotSessionTools,
        ...metaTools,
        mcpOAuthFrictionAuditTool,
        mcpSmokeWorkspaceTool,
        mcpTunnelStatusTool,
        mcpConnectorSmokeRefreshTool,
        mcpPostRestartReadinessTool,
        ...mcpReloadTools,
        mcpRuntimeHealthTool,
    ];
    assertMcpToolOptionContractParity(tools);
    return attachMcpToolSemanticContracts(tools);
}
