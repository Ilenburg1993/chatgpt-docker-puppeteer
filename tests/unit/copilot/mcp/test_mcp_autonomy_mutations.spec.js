// @ts-check

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'vitest';

import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import { createMcpToolOperationContext } from '#copilot/mcp/public/protocol/tools';
import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';
import { reapCompletedDetachedLiveRuns } from '#copilot/testing/mcp/integrations/model-gateway/live-runs';
import { gitWriteTools, isAccidentalExecutableModeDrift } from '../../../../src/copilot/mcp/tools/git-write.js';
import { llmBLiveTools } from '../../../../src/copilot/mcp/tools/llm-b-live.js';
import { mcpReloadTools } from '../../../../src/copilot/mcp/tools/restart-control.js';

const AUTONOMY_PROCESS_HOST = createComposedMcpProcessHost({
    hostId: 'autonomy-mutations-test-host',
    backgroundServices: false,
});
const AUTONOMY_WORKSPACE = AUTONOMY_PROCESS_HOST.workspace;

function createAutonomyOperationContext() {
    return createMcpToolOperationContext(
        {
            mcpReq: {
                id: 'autonomy-mutation-test',
                method: 'tools/call',
                signal: new AbortController().signal,
                _meta: { caller: 'unit-test' },
            },
        },
        {
            workspace: AUTONOMY_WORKSPACE,
            principal: Object.freeze({
                version: 'mcp-principal-v1',
                key: 'test-autonomy-principal',
                mode: 'test',
                verified: true,
                resource: 'workspace:test',
                audience: 'workspace:test',
            }),
            config: AUTONOMY_PROCESS_HOST.processConfig.toolConfig,
            capabilities: AUTONOMY_PROCESS_HOST.toolCapabilities,
        },
    );
}

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

/**
 * @param {string} name
 */
function canonicalTool(name) {
    const definition = getCanonicalMcpTools().find((entry) => entry.name === name);
    assert.ok(definition, `missing canonical tool ${name}`);
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
        const stagePreview = tool(gitWriteTools, 'git_stage');
        const operationContext = createAutonomyOperationContext();
        const dot = await stagePreview.handler({ paths: ['.'], dryRun: true }, operationContext);
        const option = await stagePreview.handler({ paths: ['--all'], dryRun: true }, operationContext);
        const glob = await stagePreview.handler({ paths: ['src/copilot/**/*.js'], dryRun: true }, operationContext);

        assert.equal(dot.isError, true);
        assert.equal(option.isError, true);
        assert.equal(glob.isError, true);
        assert.deepEqual(Object.keys(stagePreview.inputSchema).sort(), [
            'confirmStage',
            'dryRun',
            'expectedHead',
            'paths',
        ]);

        const push = tool(gitWriteTools, 'git_push');
        assert.deepEqual(Object.keys(push.inputSchema).sort(), [
            'confirmPush',
            'dryRun',
            'expectedHead',
            'expectedUpstream',
            'pushDryRunFirst',
            'runDryRun',
        ]);
        assert.equal('remote' in push.inputSchema, false);
        assert.equal('refspec' in push.inputSchema, false);
        assert.equal('force' in push.inputSchema, false);
        const canonicalPush = canonicalTool('git_push');
        assert.equal(canonicalPush.annotations.destructiveHint, true);
        assert.equal(canonicalPush.annotations.openWorldHint, true);
        assert.equal(canonicalPush.contract.effects.mutation, 'destructive');
        assert.equal(canonicalPush.contract.authority.network, 'open-world');
    });

    it('plans reload through a fixed allowlisted runner without arbitrary command/path inputs', async () => {
        const scheduleTool = tool(mcpReloadTools, 'mcp_reload_schedule');
        const result = await scheduleTool.handler(
            { profile: 'current', delayMs: 2500, reason: 'unit-test', dryRun: true },
            createAutonomyOperationContext(),
        );
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
            'dryRun',
            'expectedSourceFingerprint',
            'profile',
            'reason',
            'sourceBarrierManifest',
        ]);
        assert.equal('command' in scheduleTool.inputSchema, false);
        assert.equal('path' in scheduleTool.inputSchema, false);
        assert.equal('env' in scheduleTool.inputSchema, false);

        const publish = tool(gitWriteTools, 'git_publish_changes');
        assert.ok('sourceBarrierManifest' in publish.inputSchema);
        assert.ok('expectedSourceFingerprint' in publish.inputSchema);
    });

    it('keeps granular Git previews side-effect-free and enforces cross-mode fields', async () => {
        const operationContext = createAutonomyOperationContext();
        const noAuditContext = /** @type {typeof operationContext} */ ({
            ...operationContext,
            capabilities: { ...operationContext.capabilities, audit: undefined },
        });
        const beforeHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
        const beforeIndex = execFileSync('git', ['diff', '--cached', '--name-only'], {
            cwd: process.cwd(),
            encoding: 'utf8',
        });

        const stage = tool(gitWriteTools, 'git_stage');
        const stageResult = await stage.handler(
            { paths: ['src/copilot/mcp/tools/git-write.js'], dryRun: true },
            noAuditContext,
        );
        assert.equal(stageResult.isError, undefined);
        assert.equal(stageResult.structuredContent?.['preview'], true);
        const stageConflict = await stage.handler(
            { paths: ['src/copilot/mcp/tools/git-write.js'], dryRun: true, confirmStage: true },
            noAuditContext,
        );
        assert.equal(stageConflict.isError, true);
        assert.equal(stageConflict.structuredContent?.['code'], 'ERR_GIT_STAGE_PREVIEW_FIELDS');

        const commit = tool(gitWriteTools, 'git_commit');
        const commitResult = await commit.handler({ message: 'preview-only', dryRun: true }, noAuditContext);
        assert.equal(commitResult.isError, undefined);
        assert.equal(commitResult.structuredContent?.['preview'], true);
        const commitConflict = await commit.handler(
            { message: 'preview-only', dryRun: true, confirmCommit: true },
            noAuditContext,
        );
        assert.equal(commitConflict.isError, true);
        assert.equal(commitConflict.structuredContent?.['code'], 'ERR_GIT_COMMIT_PREVIEW_FIELDS');

        const push = tool(gitWriteTools, 'git_push');
        const pushResult = await push.handler({ dryRun: true, runDryRun: false }, noAuditContext);
        assert.equal(pushResult.isError, undefined);
        assert.equal(pushResult.structuredContent?.['preview'], true);
        assert.equal(pushResult.structuredContent?.['dryRun'], null);

        const pushConflict = await push.handler({ dryRun: true, expectedUpstream: 'origin/main' }, operationContext);
        assert.equal(pushConflict.isError, true);
        assert.equal(pushConflict.structuredContent?.['code'], 'ERR_GIT_PUSH_PREVIEW_FIELDS');

        const pushMissingConfirm = await push.handler({}, operationContext);
        assert.equal(pushMissingConfirm.isError, true);
        assert.equal(pushMissingConfirm.structuredContent?.['code'], 'ERR_GIT_PUSH_CONFIRM_REQUIRED');

        assert.equal(
            execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim(),
            beforeHead,
        );
        assert.equal(
            execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: process.cwd(), encoding: 'utf8' }),
            beforeIndex,
        );
    });

    it('keeps reload preview before mutation-only fields and scheduling authority', async () => {
        const schedule = tool(mcpReloadTools, 'mcp_reload_schedule');
        const preview = await schedule.handler(
            { profile: 'current', delayMs: 1500, reason: 'preview-test', dryRun: true },
            createAutonomyOperationContext(),
        );
        assert.equal(preview.isError, undefined);
        assert.equal(preview.structuredContent?.['dryRun'], true);
        assert.equal(preview.structuredContent?.['scheduled'], false);

        const conflict = await schedule.handler(
            {
                profile: 'current',
                dryRun: true,
                sourceBarrierManifest: 'src/copilot/.ai/jobs/forbidden-preview.json',
            },
            createAutonomyOperationContext(),
        );
        assert.equal(conflict.isError, true);
        assert.equal(conflict.structuredContent?.['code'], 'ERR_MCP_RELOAD_PREVIEW_FIELDS');

        const missingConfirm = await schedule.handler({ profile: 'current' }, createAutonomyOperationContext());
        assert.equal(missingConfirm.isError, true);
        assert.equal(missingConfirm.structuredContent?.['code'], 'ERR_MCP_RELOAD_CONFIRM_REQUIRED');
    });

    it('blocks git_publish_changes on an invalid source barrier before staging or committing anything', async () => {
        const publish = tool(gitWriteTools, 'git_publish_changes');
        const beforeHead = execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: process.cwd(),
            encoding: 'utf8',
        }).trim();
        const beforeIndex = execFileSync('git', ['diff', '--cached', '--name-only'], {
            cwd: process.cwd(),
            encoding: 'utf8',
        });

        const result = await publish.handler(
            {
                paths: ['src/copilot/mcp/tools/git-write.js'],
                message: 'must-not-commit',
                sourceBarrierManifest: 'src/copilot/.ai/jobs/source-barrier-does-not-exist.json',
                expectedSourceFingerprint: 'a'.repeat(64),
                push: false,
                confirmPublish: true,
            },
            createAutonomyOperationContext(),
        );

        assert.equal(result.isError, true);
        assert.equal(
            execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim(),
            beforeHead,
        );
        assert.equal(
            execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: process.cwd(), encoding: 'utf8' }),
            beforeIndex,
        );
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
        const canonicalCancel = canonicalTool('llmb_live_test_cancel');
        assert.equal(canonicalCancel.annotations.destructiveHint, true);
        assert.equal(canonicalCancel.annotations.openWorldHint, false);
        assert.equal(canonicalCancel.contract.effects.mutation, 'destructive');
        assert.equal(canonicalCancel.contract.authority.network, 'local');
        const missing = await cancelTool.handler(
            { runId: 'mcp-00000000-0000-0000-0000-000000000000' },
            createAutonomyOperationContext(),
        );
        assert.equal(missing.isError, true);
        assert.equal(missing.structuredContent?.['code'], 'ERR_LLMB_LIVE_CANCEL_NOT_FOUND');
    });

    it('reaps only completed verified detached live runs after the cleanup grace period', async () => {
        /** @type {string[]} */
        const cancelled = [];
        const oldVerified = 'mcp-11111111-1111-4111-8111-111111111111';
        const failingVerified = 'mcp-22222222-2222-4222-8222-222222222222';
        const timedOutVerified = 'mcp-66666666-6666-4666-8666-666666666666';
        const result = await reapCompletedDetachedLiveRuns(AUTONOMY_WORKSPACE, {
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
                    {
                        runId: timedOutVerified,
                        status: 'running',
                        processIdentity: 'verified',
                        summaryAgeMs: null,
                        deadlineAtMs: 60_000,
                    },
                ],
                cancelRun: async (runId) => {
                    cancelled.push(runId);
                    if (runId === failingVerified) throw new Error('simulated reap failure');
                    return { cancelled: true };
                },
            },
        });

        assert.deepEqual(cancelled, [oldVerified, failingVerified, timedOutVerified]);
        assert.equal(result.scannedCount, 6);
        assert.equal(result.candidateCount, 3);
        assert.equal(result.reapedCount, 2);
        assert.deepEqual(result.reapedRunIds, [oldVerified, timedOutVerified]);
        assert.equal(result.timedOutCount, 1);
        assert.deepEqual(result.timedOutRunIds, [timedOutVerified]);
        assert.equal(result.failureCount, 1);
        assert.equal(result.failures[0]?.runId, failingVerified);
    });

    it('retains recent stopped detached runs and deletes only expired stopped state as a manifest-backed unit', async () => {
        const recent = 'mcp-77777777-7777-4777-8777-777777777777';
        const expired = 'mcp-88888888-8888-4888-8888-888888888888';
        /** @type {string[]} */
        const deleted = [];
        const rows = [
            {
                runId: recent,
                status: 'artifacts_ready',
                processIdentity: 'process-not-alive',
                pidPresent: false,
                lastActivityAtMs: 90_000,
                lastActivityAgeMs: 10_000,
            },
            {
                runId: expired,
                status: 'artifacts_ready',
                processIdentity: 'process-not-alive',
                pidPresent: false,
                lastActivityAtMs: 1_000,
                lastActivityAgeMs: 99_000,
            },
        ];
        const result = await reapCompletedDetachedLiveRuns(AUTONOMY_WORKSPACE, {
            nowMs: 100_000,
            retentionMs: 60_000,
            retainCompleted: 1,
            deps: {
                listRuns: async () => rows,
                cancelRun: async () => ({ cancelled: false, alreadyStopped: true }),
                deleteRunState: async (runId) => {
                    deleted.push(runId);
                    return { deleted: true };
                },
            },
        });

        assert.deepEqual(deleted, [expired]);
        assert.equal(result.retentionCandidateCount, 1);
        assert.equal(result.deletedCount, 1);
        assert.deepEqual(result.deletedRunIds, [expired]);
        assert.equal(result.retainedStoppedCount, 1);
    });
});
