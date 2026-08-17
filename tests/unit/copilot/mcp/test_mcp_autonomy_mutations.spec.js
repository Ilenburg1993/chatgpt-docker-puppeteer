// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { gitWriteTools } from '../../../../src/copilot/mcp/tools/git-write.js';
import { llmBLiveTools } from '../../../../src/copilot/mcp/tools/llm-b-live.js';
import { mcpReloadTools } from '../../../../src/copilot/mcp/tools/restart-control.js';

function tool(definitions, name) {
    const definition = definitions.find((entry) => entry.name === name);
    assert.ok(definition, `missing tool ${name}`);
    return definition;
}

describe('MCP governed autonomy mutations', () => {
    it('rejects implicit/pathspec Git staging and exposes no arbitrary Git command surface', async () => {
        const stagePlan = tool(gitWriteTools, 'git_stage_plan');
        const dot = await stagePlan.handler({ paths: ['.'] });
        const option = await stagePlan.handler({ paths: ['--all'] });
        const glob = await stagePlan.handler({ paths: ['src/copilot/**/*.js'] });

        assert.equal(dot.isError, true);
        assert.equal(option.isError, true);
        assert.equal(glob.isError, true);
        assert.deepEqual(Object.keys(stagePlan.inputSchema).sort(), ['paths']);

        const push = tool(gitWriteTools, 'git_push');
        assert.deepEqual(Object.keys(push.inputSchema).sort(), ['confirmPush', 'expectedHead', 'expectedUpstream']);
        assert.equal('remote' in push.inputSchema, false);
        assert.equal('refspec' in push.inputSchema, false);
        assert.equal('force' in push.inputSchema, false);
        assert.equal(push.annotations?.destructiveHint, true);
        assert.equal(push.annotations?.openWorldHint, true);
    });

    it('plans reload through a fixed allowlisted runner without arbitrary command/path inputs', async () => {
        const planTool = tool(mcpReloadTools, 'mcp_reload_plan');
        const scheduleTool = tool(mcpReloadTools, 'mcp_reload_schedule');
        const result = await planTool.handler({ profile: 'current', delayMs: 2500, reason: 'unit-test' });
        const plan = result.structuredContent;

        assert.equal(result.isError, undefined);
        assert.equal(plan?.['executable'], true);
        assert.equal(plan?.['resolvedProfile'], 'quic');
        assert.deepEqual(plan?.['safety'], {
            arbitraryShell: false,
            arbitraryCommand: false,
            arbitraryPath: false,
            allowedProfiles: ['quic', 'h2', 'auto'],
            responseBeforeRestart: true,
        });
        assert.deepEqual(Object.keys(scheduleTool.inputSchema).sort(), ['confirmRestart', 'delayMs', 'profile', 'reason']);
        assert.equal('command' in scheduleTool.inputSchema, false);
        assert.equal('path' in scheduleTool.inputSchema, false);
        assert.equal('env' in scheduleTool.inputSchema, false);
    });

    it('defaults LLM-B live testing to control-only and requires usage confirmation for real turns', async () => {
        const planTool = tool(llmBLiveTools, 'llmb_live_test_plan');
        const runTool = tool(llmBLiveTools, 'llmb_live_test_run');

        const control = await planTool.handler({});
        assert.equal(control.structuredContent?.['mode'], 'control-only');
        assert.equal(control.structuredContent?.['invokesModel'], false);
        assert.equal(control.structuredContent?.['invokesRealProvider'], false);
        assert.equal(control.structuredContent?.['requiresUsageConfirmation'], false);
        const controlArgs = /** @type {string[]} */ (control.structuredContent?.['args'] ?? []);
        assert.ok(controlArgs.includes('--control-only'));

        const realTurn = await planTool.handler({ mode: 'canonical-turn' });
        assert.equal(realTurn.structuredContent?.['invokesModel'], true);
        assert.equal(realTurn.structuredContent?.['requiresUsageConfirmation'], true);

        const blocked = await runTool.handler({ mode: 'canonical-turn', confirmModelUsage: false });
        assert.equal(blocked.isError, true);
        assert.equal(blocked.structuredContent?.['code'], 'ERR_LLMB_MODEL_USAGE_CONFIRMATION_REQUIRED');
        assert.equal('command' in runTool.inputSchema, false);
        assert.equal('script' in runTool.inputSchema, false);

        const cancelTool = tool(llmBLiveTools, 'llmb_live_test_cancel');
        assert.deepEqual(Object.keys(cancelTool.inputSchema).sort(), ['runId']);
        assert.equal('pid' in cancelTool.inputSchema, false);
        assert.equal('signal' in cancelTool.inputSchema, false);
        assert.equal(cancelTool.annotations?.destructiveHint, true);
        assert.equal(cancelTool.annotations?.openWorldHint, false);
        const missing = await cancelTool.handler({ runId: 'mcp-00000000-0000-0000-0000-000000000000' });
        assert.equal(missing.isError, true);
        assert.equal(missing.structuredContent?.['code'], 'ERR_LLMB_LIVE_CANCEL_NOT_FOUND');
    });
});
