// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { gitWriteTools, isAccidentalExecutableModeDrift } from '../../../../src/copilot/mcp/tools/git-write.js';
import { llmBLiveTools, reapCompletedDetachedLiveRuns } from '../../../../src/copilot/mcp/tools/llm-b-live.js';
import { mcpReloadTools } from '../../../../src/copilot/mcp/tools/restart-control.js';

/**
 * @template {{ name: string }} T
 * @param {readonly T[]} definitions
 * @param {string} name
 * @returns {T}
 */
function tool(definitions, name) {
    const definition = definitions.find((entry) => entry.name === name);
    assert.ok(definition, `missing tool ${name}`);
    return definition;
}

describe('MCP governed autonomy mutations', () => {
    it('repairs only the narrow HEAD-executable + shebang + missing-x-bit regression class', () => {
        assert.equal(
            isAccidentalExecutableModeDrift({ headMode: '100755', currentMode: 0o644, hasShebang: true }),
            true,
        );
        assert.equal(
            isAccidentalExecutableModeDrift({ headMode: '100755', currentMode: 0o755, hasShebang: true }),
            false,
        );
        assert.equal(
            isAccidentalExecutableModeDrift({ headMode: '100644', currentMode: 0o644, hasShebang: true }),
            false,
        );
        assert.equal(
            isAccidentalExecutableModeDrift({ headMode: '100755', currentMode: 0o644, hasShebang: false }),
            false,
        );
    });

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
        assert.deepEqual(Object.keys(push.inputSchema).sort(), [
            'confirmPush',
            'expectedHead',
            'expectedUpstream',
            'pushDryRunFirst',
        ]);
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
        assert.deepEqual(Object.keys(scheduleTool.inputSchema).sort(), [
            'confirmRestart',
            'delayMs',
            'profile',
            'reason',
        ]);
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

    it('reaps only completed verified detached live runs after the cleanup grace period', async () => {
        /** @type {string[]} */
        const cancelled = [];
        const oldVerified = 'mcp-11111111-1111-4111-8111-111111111111';
        const failingVerified = 'mcp-22222222-2222-4222-8222-222222222222';
        const result = await reapCompletedDetachedLiveRuns({
            nowMs: 100_000,
            graceMs: 30_000,
            deps: {
                listRuns: async () => [
                    {
                        runId: oldVerified,
                        status: 'artifacts_ready_process_alive',
                        processIdentity: 'verified',
                        summaryAgeMs: 60_000,
                    },
                    {
                        runId: failingVerified,
                        status: 'artifacts_ready_process_alive',
                        processIdentity: 'verified',
                        summaryAgeMs: 50_000,
                    },
                    {
                        runId: 'mcp-33333333-3333-4333-8333-333333333333',
                        status: 'artifacts_ready_process_alive',
                        processIdentity: 'verified',
                        summaryAgeMs: 5_000,
                    },
                    {
                        runId: 'mcp-44444444-4444-4444-8444-444444444444',
                        status: 'artifacts_ready_process_alive',
                        processIdentity: 'command-line-mismatch',
                        summaryAgeMs: 80_000,
                    },
                    {
                        runId: 'mcp-55555555-5555-4555-8555-555555555555',
                        status: 'running',
                        processIdentity: 'verified',
                        summaryAgeMs: null,
                    },
                ],
                cancelRun: async (runId) => {
                    cancelled.push(runId);
                    if (runId === failingVerified) throw new Error('simulated reap failure');
                    return { cancelled: true };
                },
            },
        });

        assert.deepEqual(cancelled, [oldVerified, failingVerified]);
        assert.equal(result.scannedCount, 5);
        assert.equal(result.candidateCount, 2);
        assert.equal(result.reapedCount, 1);
        assert.deepEqual(result.reapedRunIds, [oldVerified]);
        assert.equal(result.failureCount, 1);
        assert.equal(result.failures[0]?.runId, failingVerified);
    });
});
