// @ts-check

import {
    buildMcpSessionWorkflowProjection,
    buildMcpWorkflowGuidance,
    MCP_WORKFLOW_POLICY_VERSION,
    readMcpWorkflowPolicy,
} from '#copilot/mcp/public/workflow-policy';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

describe('MCP workflow productivity policy', () => {
    it('uses connector smoke as the post-reload convergence point and forbids mechanical status polling', () => {
        const policy = readMcpWorkflowPolicy();
        const session = buildMcpSessionWorkflowProjection();
        const guidance = buildMcpWorkflowGuidance();

        assert.equal(MCP_WORKFLOW_POLICY_VERSION, '1.1.0');
        assert.deepEqual(session.taskRouting.reload, [
            policy.reload.scheduleTool,
            policy.reload.smokeTool,
            policy.reload.statusTool,
        ]);
        const reload = session.preferredWriteWorkflows.find((workflow) => workflow.task === 'reload');
        assert.ok(reload);
        assert.ok(reload.flow.some((entry) => entry.includes('mcp_connector_smoke_refresh')));
        assert.ok(reload.flow.some((entry) => entry.includes('never poll')));
        assert.ok(
            guidance.some(
                (entry) => entry.includes('mcp_reload_status') && entry.includes('never poll it mechanically'),
            ),
        );
        assert.equal(policy.reload.statusPolicy, 'only-on-failure-or-uncertain-transition');
        assert.equal(policy.reload.postRestartPolicy, 'connector-smoke-reconciles-reload-and-readiness');
    });
});
