// @ts-check
/**
 * Tests for controlled MCP write tools.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'vitest';

import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import { createMcpToolOperationContext } from '#copilot/mcp/public/protocol/tools';
import { MCP_WORKSPACE_ROOT } from '#copilot/mcp/public/workspace';
import { createRepoWriteTools } from '#copilot/testing/mcp/tools/repo-write';

import {
    getValidatedMutableWorkspacePathStats,
    resetValidatedMutableWorkspacePathStatsForTest,
} from '#copilot/infra/public/testing';
const TEST_PROCESS_HOST = createComposedMcpProcessHost({
    hostId: 'mcp-repo-write-unit-process-host',
    backgroundServices: false,
});
const TEST_WORKSPACE = TEST_PROCESS_HOST.workspace;
const TEST_QUARANTINE_DIR = path.join(MCP_WORKSPACE_ROOT, 'src/copilot/.ai/quarantine/test-runs', randomUUID());

/** @param {NonNullable<Parameters<typeof createRepoWriteTools>[0]>} [options] */
function createTestRepoWriteTools(options = {}) {
    return createRepoWriteTools({ ...options, quarantineDir: TEST_QUARANTINE_DIR });
}

const TEST_REPO_WRITE_TOOLS = createTestRepoWriteTools();
const TOOL_OPERATION_CONTEXT = createMcpToolOperationContext(
    {
        mcpReq: {
            id: 'mcp-repo-write-unit',
            method: 'tools/call',
            signal: new AbortController().signal,
            _meta: { caller: 'test_mcp_repo_write' },
            envelope: { protocol: '2026' },
        },
    },
    { workspace: TEST_WORKSPACE, capabilities: TEST_PROCESS_HOST.toolCapabilities },
);

/** @param {AbortSignal} signal */
function createRepoWriteOperationContext(signal) {
    return createMcpToolOperationContext(
        {
            mcpReq: {
                id: `mcp-repo-write-unit-${Date.now()}`,
                method: 'tools/call',
                signal,
                _meta: { caller: 'test_mcp_repo_write' },
                envelope: { protocol: '2026' },
            },
        },
        { workspace: TEST_WORKSPACE, capabilities: TEST_PROCESS_HOST.toolCapabilities },
    );
}

/**
 * @param {string} name
 * @param {ReturnType<typeof createRepoWriteTools>} [definitions]
 * @param {typeof TOOL_OPERATION_CONTEXT} [operationContext]
 */
function findRepoWriteTool(name, definitions = TEST_REPO_WRITE_TOOLS, operationContext = TOOL_OPERATION_CONTEXT) {
    const definition = definitions.find((tool) => tool.name === name);
    assert.ok(definition, `missing repo write tool ${name}`);
    return {
        ...definition,
        handler: /** @type {typeof definition.handler} */ ((input) => definition.handler(input, operationContext)),
    };
}

const applyPatchTool = findRepoWriteTool('repo_apply_patch');
const applyPatchBatchTool = findRepoWriteTool('repo_apply_patch_batch');
const applyFileBatchPlanTool = findRepoWriteTool('repo_apply_file_batch_plan');
const applyFileBatchTool = findRepoWriteTool('repo_apply_file_batch');
const writeFileTool = findRepoWriteTool('repo_write_file');
const createFileTool = findRepoWriteTool('repo_create_file');
const moveFileTool = findRepoWriteTool('repo_move_file');
const listQuarantineTool = findRepoWriteTool('repo_list_quarantine');
const inspectQuarantinedFileTool = findRepoWriteTool('repo_inspect_quarantined_file');
const quarantineFileTool = findRepoWriteTool('repo_quarantine_file');
const restoreQuarantinedFileTool = findRepoWriteTool('repo_restore_quarantined_file');
const removeFileTool = findRepoWriteTool('repo_remove_file');

describe('copilot MCP repo write tools', () => {
    afterEach(async () => {
        resetValidatedMutableWorkspacePathStatsForTest();
        await fs.rm(TEST_QUARANTINE_DIR, { recursive: true, force: true });
    });

    it('reuses the write-policy capability in MCP patch instead of revalidating inside workspace IO', async () => {
        assert.ok(applyPatchTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const filePath = path.join(dir, 'validated-patch.txt');
        await fs.writeFile(filePath, 'stable\n', 'utf8');
        resetValidatedMutableWorkspacePathStatsForTest();

        const result = await applyPatchTool.handler({
            path: filePath,
            old_string: 'stable',
            new_string: 'stable',
            allowNoop: true,
            dryRun: true,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent['success'], true);
        assert.deepEqual(getValidatedMutableWorkspacePathStats(), {
            issued: 1,
            accepted: 1,
            rejectedUnbranded: 0,
            rejectedAuthority: 0,
            rejectedWorkspace: 0,
            rejectedMode: 0,
            compatibleModes: ['write', 'patch', 'metadata'],
            policyVersion: getValidatedMutableWorkspacePathStats().policyVersion,
        });
    });

    it('does not mint mutable capabilities for destructive paths that cannot consume them', async () => {
        assert.ok(removeFileTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const filePath = path.join(dir, 'no-capability-remove.txt');
        await fs.writeFile(filePath, 'keep me\n', 'utf8');
        resetValidatedMutableWorkspacePathStatsForTest();

        const result = await removeFileTool.handler({ path: filePath });

        assert.equal(result.isError, true);
        const stats = getValidatedMutableWorkspacePathStats();
        assert.equal(stats.issued, 0);
        assert.equal(stats.accepted, 0);
        assert.equal(await fs.readFile(filePath, 'utf8'), 'keep me\n');
    });

    it('writes existing files with diff previews', async () => {
        assert.ok(writeFileTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const filePath = path.join(dir, 'write.txt');
        await fs.writeFile(filePath, 'before\n', 'utf8');

        const result = await writeFileTool.handler({
            path: filePath,
            content: 'after\n',
            includeDiffPreview: true,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent['success'], true);
        assert.equal(result.structuredContent['bytesWritten'], 6);
        assert.match(String(result.structuredContent['diffPreview']), /-before/);
        assert.match(String(result.structuredContent['diffPreview']), /\+after/);
        assert.equal(await fs.readFile(filePath, 'utf8'), 'after\n');
    });

    it('creates new files and rejects existing paths', async () => {
        assert.ok(createFileTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const filePath = path.join(dir, 'created.txt');

        const created = await createFileTool.handler({
            path: filePath,
            content: 'new file\n',
            includeDiffPreview: true,
        });
        assert.equal(created.isError, undefined);
        assert.equal(created.structuredContent['success'], true);
        assert.match(String(created.structuredContent['diffPreview']), /\+new file/);
        assert.equal(await fs.readFile(filePath, 'utf8'), 'new file\n');

        const duplicate = await createFileTool.handler({
            path: filePath,
            content: 'again\n',
        });
        assert.equal(duplicate.isError, true);
        assert.equal(duplicate.structuredContent['success'], false);
    });

    it('accepts explicit durability profiles while keeping strict as the implicit default', async () => {
        assert.ok(createFileTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const strictPath = path.join(dir, 'strict.txt');
        const fastPath = path.join(dir, 'none.txt');

        const strict = await createFileTool.handler({ path: strictPath, content: 'strict\n' });
        const none = await createFileTool.handler({ path: fastPath, content: 'none\n', durability: 'none' });

        assert.equal(strict.isError, undefined);
        assert.equal(none.isError, undefined);
        assert.equal(await fs.readFile(strictPath, 'utf8'), 'strict\n');
        assert.equal(await fs.readFile(fastPath, 'utf8'), 'none\n');
    });

    it('applies exact-string patches with diff previews', async () => {
        assert.ok(applyPatchTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const filePath = path.join(dir, 'sample.txt');
        await fs.writeFile(filePath, 'alpha\nbeta\ngamma\n', 'utf8');

        const result = await applyPatchTool.handler({
            path: filePath,
            old_string: 'beta',
            new_string: 'BETA',
            dryRun: false,
            includeDiffPreview: true,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent['success'], true);
        assert.equal(result.structuredContent['replacedOccurrences'], 1);
        assert.match(String(result.structuredContent['diffPreview']), /-beta/);
        assert.match(String(result.structuredContent['diffPreview']), /\+BETA/);
        assert.equal(await fs.readFile(filePath, 'utf8'), 'alpha\nBETA\ngamma\n');
    });

    it('moves files without overwriting by default', async () => {
        assert.ok(moveFileTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const source = path.join(dir, 'source.txt');
        const destination = path.join(dir, 'destination.txt');
        await fs.writeFile(source, 'move me\n', 'utf8');
        resetValidatedMutableWorkspacePathStatsForTest();

        const result = await moveFileTool.handler({
            source,
            destination,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent['success'], true);
        assert.equal(await fs.readFile(destination, 'utf8'), 'move me\n');
        await assert.rejects(() => fs.access(source));
        assert.deepEqual(getValidatedMutableWorkspacePathStats(), {
            issued: 2,
            accepted: 2,
            rejectedUnbranded: 0,
            rejectedAuthority: 0,
            rejectedWorkspace: 0,
            rejectedMode: 0,
            compatibleModes: ['write', 'patch', 'metadata'],
            policyVersion: getValidatedMutableWorkspacePathStats().policyVersion,
        });
    });

    it('uses write policy for move source even during dry-run', async () => {
        assert.ok(moveFileTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const source = path.join(dir, 'blocked-source.exe');
        const destination = path.join(dir, 'destination.txt');
        await fs.writeFile(source, 'opaque native-extension fixture\n', 'utf8');
        resetValidatedMutableWorkspacePathStatsForTest();

        const result = await moveFileTool.handler({ source, destination, dryRun: true });

        assert.equal(result.isError, true);
        assert.match(
            String(result.structuredContent?.['error'] ?? result.content?.[0]?.text ?? ''),
            /blocked|denied|negado/i,
        );
        assert.equal(await fs.readFile(source, 'utf8'), 'opaque native-extension fixture\n');
        await assert.rejects(() => fs.access(destination));
        const stats = getValidatedMutableWorkspacePathStats();
        assert.equal(stats.issued, 0);
        assert.equal(stats.accepted, 0);
    });

    it('requires confirmation for remove file', async () => {
        assert.ok(removeFileTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const filePath = path.join(dir, 'remove.txt');
        await fs.writeFile(filePath, 'delete me\n', 'utf8');

        const blocked = await removeFileTool.handler({ path: filePath });
        assert.equal(blocked.isError, true);
        assert.equal(await fs.readFile(filePath, 'utf8'), 'delete me\n');

        const removed = await removeFileTool.handler({ path: filePath, confirm: true });
        assert.equal(removed.isError, undefined);
        assert.equal(removed.structuredContent['success'], true);
        assert.equal(removed.structuredContent['deleted'], true);
        await assert.rejects(() => fs.access(filePath));
    });

    it('plans bounded file batches without mutating files', async () => {
        assert.ok(applyFileBatchPlanTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const created = path.join(dir, 'batch-plan-created.txt');

        const plan = await applyFileBatchPlanTool.handler({
            operations: [{ type: 'create_file', path: created, content: 'planned batch\\n' }],
        });

        assert.equal(plan.isError, undefined);
        assert.equal(plan.structuredContent['success'], true);
        assert.equal(plan.structuredContent['plannedTool'], 'repo_apply_file_batch');
        assert.equal(plan.structuredContent['dryRun'], true);
        assert.equal(plan.structuredContent['operationCount'], 1);
        assert.equal(plan.structuredContent['nextCall'].tool, 'repo_apply_file_batch');
        await assert.rejects(() => fs.access(created));
    });

    it('applies bounded file batches after a dry-run preview and confirmation', async () => {
        assert.ok(applyFileBatchTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const created = path.join(dir, 'batch-created.txt');
        const source = path.join(dir, 'batch-source.txt');
        const moved = path.join(dir, 'batch-moved.txt');
        await fs.writeFile(source, 'move in batch\n', 'utf8');

        const dryRun = await applyFileBatchTool.handler({
            operations: [
                { type: 'create_file', path: created, content: 'batched\n' },
                { type: 'move_file', source, destination: moved },
            ],
        });
        assert.equal(dryRun.isError, undefined);
        assert.equal(dryRun.structuredContent['success'], true);
        assert.equal(dryRun.structuredContent['dryRun'], true);
        await assert.rejects(() => fs.access(created));

        const missingConfirm = await applyFileBatchTool.handler({
            operations: [{ type: 'create_file', path: created, content: 'batched\n' }],
            dryRun: false,
        });
        assert.equal(missingConfirm.isError, true);
        assert.equal(missingConfirm.structuredContent['code'], 'ERR_BATCH_CONFIRM_REQUIRED');

        const applied = await applyFileBatchTool.handler({
            operations: [
                { type: 'create_file', path: created, content: 'batched\n' },
                { type: 'move_file', source, destination: moved },
            ],
            dryRun: false,
            confirmBatch: true,
        });
        assert.equal(applied.isError, undefined);
        assert.equal(applied.structuredContent['success'], true);
        assert.equal(applied.structuredContent['operationCount'], 2);
        assert.equal(applied.structuredContent['applyMode'], 'sequential-fast');
        assert.equal(applied.structuredContent['applyModeReason'], 'adaptive-safe-sequential');
        assert.equal(applied.structuredContent['preflightSummary'].ran, false);
        assert.equal(applied.structuredContent['preflightSummary'].plannedCount, 0);
        assert.deepEqual(applied.structuredContent['planned'], []);
        assert.equal(await fs.readFile(created, 'utf8'), 'batched\n');
        assert.equal(await fs.readFile(moved, 'utf8'), 'move in batch\n');
    });

    it.skipIf(process.platform === 'win32')(
        'previews and applies executable-bit repair as a bounded metadata-only batch operation',
        async () => {
            assert.ok(applyFileBatchTool);
            const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
            const script = path.join(dir, 'repair-mode.sh');
            await fs.writeFile(script, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
            await fs.chmod(script, 0o644);
            const operations = [{ type: 'set_executable', path: script, executable: true }];

            const dryRun = await applyFileBatchTool.handler({ operations });
            assert.equal(dryRun.isError, undefined);
            assert.equal(dryRun.structuredContent['operations'][0].currentMode, '0644');
            assert.equal(dryRun.structuredContent['operations'][0].targetMode, '0755');
            assert.equal((await fs.stat(script)).mode & 0o777, 0o644);

            const applied = await applyFileBatchTool.handler({
                operations,
                dryRun: false,
                confirmBatch: true,
                applyMode: 'global-preflight',
            });
            assert.equal(applied.isError, undefined);
            assert.equal(applied.structuredContent['applied'][0].metadataOnly, true);
            assert.equal(applied.structuredContent['applied'][0].previousMode, '0644');
            assert.equal(applied.structuredContent['applied'][0].mode, '0755');
            assert.equal((await fs.stat(script)).mode & 0o777, 0o755);
        },
    );

    it('keeps global file-batch preflight zero-write and allows explicit sequential partial apply', async () => {
        assert.ok(applyFileBatchTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const conservativeCreated = path.join(dir, 'conservative-created.txt');
        const fastCreated = path.join(dir, 'fast-created.txt');
        const missingSource = path.join(dir, 'missing-source.txt');
        const destination = path.join(dir, 'never-moved.txt');

        const conservative = await applyFileBatchTool.handler({
            operations: [
                { type: 'create_file', path: conservativeCreated, content: 'conservative\n' },
                { type: 'move_file', source: missingSource, destination },
            ],
            confirmBatch: true,
            applyMode: 'global-preflight',
        });
        assert.equal(conservative.isError, true);
        const conservativeDetails = conservative.structuredContent['details'];
        assert.equal(conservativeDetails.phase, 'preflight');
        assert.equal(conservativeDetails.partial, false);
        assert.equal(conservativeDetails.failureIndex, 1);
        assert.equal(await pathExists(conservativeCreated), false);

        const fast = await applyFileBatchTool.handler({
            operations: [
                { type: 'create_file', path: fastCreated, content: 'fast\n' },
                { type: 'move_file', source: missingSource, destination },
            ],
            confirmBatch: true,
        });
        assert.equal(fast.isError, true);
        const fastDetails = fast.structuredContent['details'];
        assert.equal(fastDetails.phase, 'apply');
        assert.equal(fastDetails.applyMode, 'sequential-fast');
        assert.equal(fastDetails.applyModeReason, 'adaptive-safe-sequential');
        assert.equal(fastDetails.partial, true);
        assert.equal(fastDetails.appliedCount, 1);
        assert.equal(fastDetails.failureIndex, 1);
        assert.equal(fastDetails.preflightSummary.ran, false);
        assert.equal(await fs.readFile(fastCreated, 'utf8'), 'fast\n');
    });

    it('keeps destructive file-batch operations behind adaptive global preflight by default', async () => {
        assert.ok(applyFileBatchTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const removable = path.join(dir, 'adaptive-remove.txt');
        await fs.writeFile(removable, 'remove me\n', 'utf8');

        const result = await applyFileBatchTool.handler({
            operations: [{ type: 'remove_file', path: removable, confirm: true }],
            confirmBatch: true,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent['success'], true);
        assert.equal(result.structuredContent['applyMode'], 'global-preflight');
        assert.equal(result.structuredContent['applyModeReason'], 'adaptive-destructive-gate');
        assert.deepEqual(result.structuredContent['conservativeOperationIndices'], [0]);
        assert.equal(result.structuredContent['preflightSummary'].ran, true);
        assert.equal(await pathExists(removable), false);
    });

    it('supports dependent create then move operations in one file batch', async () => {
        assert.ok(applyFileBatchPlanTool);
        assert.ok(applyFileBatchTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const created = path.join(dir, 'batch-created-then-moved.txt');
        const moved = path.join(dir, 'batch-created-then-moved.final.txt');

        const operations = [
            { type: 'create_file', path: created, content: 'created then moved\\n' },
            { type: 'move_file', source: created, destination: moved },
        ];
        const plan = await applyFileBatchPlanTool.handler({ operations });
        assert.equal(plan.isError, undefined);
        assert.equal(plan.structuredContent['success'], true);
        assert.equal(plan.structuredContent['operations'][1].virtualSource, true);

        const dryRun = await applyFileBatchTool.handler({ operations });
        assert.equal(dryRun.isError, undefined);
        assert.equal(dryRun.structuredContent['success'], true);
        assert.equal(dryRun.structuredContent['operations'][1].virtualSource, true);
        await assert.rejects(() => fs.access(created));
        await assert.rejects(() => fs.access(moved));

        const applied = await applyFileBatchTool.handler({ operations, dryRun: false, confirmBatch: true });
        assert.equal(applied.isError, undefined);
        assert.equal(applied.structuredContent['success'], true);
        assert.equal(await pathExists(created), false);
        assert.equal(await fs.readFile(moved, 'utf8'), 'created then moved\\n');
    });

    it('quarantines and restores files through a reversible workspace flow', async () => {
        assert.ok(listQuarantineTool);
        assert.ok(inspectQuarantinedFileTool);
        assert.ok(quarantineFileTool);
        assert.ok(restoreQuarantinedFileTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const filePath = path.join(dir, 'quarantine.txt');
        await fs.writeFile(filePath, 'recover me\n', 'utf8');

        const quarantined = await quarantineFileTool.handler({ path: filePath });
        assert.equal(quarantined.isError, undefined);
        assert.equal(quarantined.structuredContent['success'], true);
        assert.equal(quarantined.structuredContent['status'], 'quarantined');
        assert.equal(await pathExists(filePath), false);
        const metadataPath = path.resolve(String(quarantined.structuredContent['metadataPath']));
        assert.equal((await fs.stat(metadataPath)).mode & 0o777, 0o600);

        const quarantineId = String(quarantined.structuredContent['quarantineId']);
        const listed = await listQuarantineTool.handler({ status: 'quarantined', limit: 20 });
        assert.equal(listed.isError, undefined);
        const listedItems = /** @type {{ quarantineId?: string }[]} */ (listed.structuredContent['items']);
        assert.ok(listedItems.some((item) => item.quarantineId === quarantineId));

        const inspected = await inspectQuarantinedFileTool.handler({ quarantineId });
        assert.equal(inspected.isError, undefined);
        assert.equal(inspected.structuredContent['restorable'], true);
        assert.equal(typeof inspected.structuredContent['dataSha256'], 'string');

        const restored = await restoreQuarantinedFileTool.handler({ quarantineId });
        assert.equal(restored.isError, undefined);
        assert.equal(restored.structuredContent['success'], true);
        assert.equal(restored.structuredContent['destination'].endsWith('quarantine.txt'), true);
        assert.equal(await fs.readFile(filePath, 'utf8'), 'recover me\n');

        const secondRestore = await restoreQuarantinedFileTool.handler({ quarantineId });
        assert.equal(secondRestore.isError, true);
        assert.equal(secondRestore.structuredContent['code'], 'ERR_QUARANTINE_NOT_RESTORABLE');
    });

    it('rolls a quarantine move back when the final metadata commit fails', async () => {
        assert.ok(quarantineFileTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const filePath = path.join(dir, 'quarantine-commit-rollback.txt');
        await fs.writeFile(filePath, 'still here\n', 'utf8');

        let writeCount = 0;
        /** @type {string | null} */
        let observedQuarantineId = null;
        const isolatedTools = createTestRepoWriteTools({
            quarantineMetadataWriter: async (io, metadata, metadataPath, writeDefault) => {
                observedQuarantineId = metadata.quarantineId;
                writeCount += 1;
                if (writeCount === 2) {
                    const error = /** @type {Error & { code?: string }} */ (new Error('simulated metadata failure'));
                    error.code = 'EIO';
                    throw error;
                }
                await writeDefault(io, metadata, metadataPath);
            },
        });
        const isolatedQuarantineFileTool = findRepoWriteTool('repo_quarantine_file', isolatedTools);

        const result = await isolatedQuarantineFileTool.handler({ path: filePath });
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent['code'], 'EIO');
        assert.equal(await fs.readFile(filePath, 'utf8'), 'still here\n');
        assert.ok(observedQuarantineId);
        const quarantineDir = TEST_QUARANTINE_DIR;
        await assert.rejects(fs.access(path.join(quarantineDir, `${observedQuarantineId}.data`)), { code: 'ENOENT' });
        await assert.rejects(fs.access(path.join(quarantineDir, `${observedQuarantineId}.json`)), { code: 'ENOENT' });
    });

    it('rolls a quarantine move back even when caller cancellation aborts the final metadata commit', async () => {
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const filePath = path.join(dir, 'quarantine-cancel-rollback.txt');
        await fs.writeFile(filePath, 'must return to source\n', 'utf8');
        const controller = new AbortController();
        let writeCount = 0;
        /** @type {string | null} */
        let observedQuarantineId = null;
        const isolatedTools = createTestRepoWriteTools({
            quarantineMetadataWriter: async (io, metadata, metadataPath, writeDefault) => {
                observedQuarantineId = metadata.quarantineId;
                writeCount += 1;
                if (writeCount === 2) controller.abort(new Error('cancel-quarantine-final-metadata'));
                await writeDefault(io, metadata, metadataPath);
            },
        });
        const tool = findRepoWriteTool(
            'repo_quarantine_file',
            isolatedTools,
            createRepoWriteOperationContext(controller.signal),
        );

        const result = await tool.handler({ path: filePath });

        assert.equal(result.isError, true);
        assert.equal(writeCount, 2);
        assert.equal(controller.signal.aborted, true);
        assert.equal(await fs.readFile(filePath, 'utf8'), 'must return to source\n');
        assert.ok(observedQuarantineId);
        const quarantineDir = TEST_QUARANTINE_DIR;
        await assert.rejects(fs.access(path.join(quarantineDir, `${observedQuarantineId}.data`)), { code: 'ENOENT' });
        await assert.rejects(fs.access(path.join(quarantineDir, `${observedQuarantineId}.json`)), { code: 'ENOENT' });
    });

    it('restores the previous destination when restore metadata commit fails', async () => {
        assert.ok(inspectQuarantinedFileTool);
        assert.ok(quarantineFileTool);
        assert.ok(restoreQuarantinedFileTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const source = path.join(dir, 'restore-commit-source.txt');
        const destination = path.join(dir, 'restore-commit-destination.txt');
        await fs.writeFile(source, 'quarantined content\n', 'utf8');
        await fs.writeFile(destination, 'previous destination\n', 'utf8');

        const quarantined = await quarantineFileTool.handler({ path: source });
        assert.equal(quarantined.isError, undefined);
        const quarantineId = String(quarantined.structuredContent['quarantineId']);

        let writeCount = 0;
        const isolatedTools = createTestRepoWriteTools({
            quarantineMetadataWriter: async (io, metadata, metadataPath, writeDefault) => {
                writeCount += 1;
                if (writeCount === 2) {
                    const error = /** @type {Error & { code?: string }} */ (
                        new Error('simulated restore commit failure')
                    );
                    error.code = 'EIO';
                    throw error;
                }
                await writeDefault(io, metadata, metadataPath);
            },
        });
        const isolatedRestoreQuarantinedFileTool = findRepoWriteTool('repo_restore_quarantined_file', isolatedTools);

        const result = await isolatedRestoreQuarantinedFileTool.handler({
            quarantineId,
            destinationPath: destination,
            overwrite: true,
            confirmOverwrite: true,
        });
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent['code'], 'EIO');
        assert.equal(await fs.readFile(destination, 'utf8'), 'previous destination\n');

        const inspected = await inspectQuarantinedFileTool.handler({ quarantineId });
        assert.equal(inspected.isError, undefined);
        assert.equal(inspected.structuredContent['restorable'], true);
        assert.equal(inspected.structuredContent['metadata'].status, 'quarantined');
        const quarantineEntries = await fs.readdir(TEST_QUARANTINE_DIR);
        assert.equal(
            quarantineEntries.some((entry) => entry.includes(`${quarantineId}.restore-backup-`)),
            false,
        );
    });

    it('restores quarantine and destination invariants when cancellation aborts the restore commit', async () => {
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const source = path.join(dir, 'restore-cancel-source.txt');
        const destination = path.join(dir, 'restore-cancel-destination.txt');
        await fs.writeFile(source, 'quarantined after cancel\n', 'utf8');
        await fs.writeFile(destination, 'destination survives cancel\n', 'utf8');
        const quarantined = await quarantineFileTool.handler({ path: source });
        assert.equal(quarantined.isError, undefined);
        const quarantineId = String(quarantined.structuredContent['quarantineId']);

        const controller = new AbortController();
        let writeCount = 0;
        const isolatedTools = createTestRepoWriteTools({
            quarantineMetadataWriter: async (io, metadata, metadataPath, writeDefault) => {
                writeCount += 1;
                if (writeCount === 2) controller.abort(new Error('cancel-restore-final-metadata'));
                await writeDefault(io, metadata, metadataPath);
            },
        });
        const tool = findRepoWriteTool(
            'repo_restore_quarantined_file',
            isolatedTools,
            createRepoWriteOperationContext(controller.signal),
        );

        const result = await tool.handler({
            quarantineId,
            destinationPath: destination,
            overwrite: true,
            confirmOverwrite: true,
        });

        assert.equal(result.isError, true);
        assert.equal(controller.signal.aborted, true);
        assert.ok(writeCount >= 3, 'rollback must publish cancellation-shielded metadata repair');
        assert.equal(await fs.readFile(destination, 'utf8'), 'destination survives cancel\n');
        const inspected = await inspectQuarantinedFileTool.handler({ quarantineId });
        assert.equal(inspected.isError, undefined);
        assert.equal(inspected.structuredContent['restorable'], true);
        assert.equal(inspected.structuredContent['metadata'].status, 'quarantined');
        const quarantineEntries = await fs.readdir(TEST_QUARANTINE_DIR);
        assert.equal(
            quarantineEntries.some((entry) => entry.includes(`${quarantineId}.restore-backup-`)),
            false,
        );
    });

    it('serializes concurrent restores for the same quarantine item', async () => {
        assert.ok(quarantineFileTool);
        assert.ok(restoreQuarantinedFileTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const source = path.join(dir, 'concurrent-restore.txt');
        await fs.writeFile(source, 'restore once\n', 'utf8');

        const quarantined = await quarantineFileTool.handler({ path: source });
        const quarantineId = String(quarantined.structuredContent['quarantineId']);
        const results = await Promise.all([
            restoreQuarantinedFileTool.handler({ quarantineId }),
            restoreQuarantinedFileTool.handler({ quarantineId }),
        ]);

        assert.equal(results.filter((result) => result.isError !== true).length, 1);
        const failed = results.find((result) => result.isError === true);
        assert.equal(failed?.structuredContent['code'], 'ERR_QUARANTINE_NOT_RESTORABLE');
        assert.equal(await fs.readFile(source, 'utf8'), 'restore once\n');
    });

    it('rejects non-canonical quarantine identifiers before resolving paths', async () => {
        assert.ok(inspectQuarantinedFileTool);
        const result = await inspectQuarantinedFileTool.handler({ quarantineId: '../quarantine-item' });
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent['code'], 'ERR_QUARANTINE_NOT_FOUND');
    });

    it('rejects forged quarantine backup paths without deleting their target', async () => {
        assert.ok(inspectQuarantinedFileTool);
        assert.ok(quarantineFileTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const source = path.join(dir, 'forged-backup-source.txt');
        const protectedFile = path.join(dir, 'must-survive.txt');
        await fs.writeFile(source, 'quarantine me\n', 'utf8');
        await fs.writeFile(protectedFile, 'protected\n', 'utf8');

        const quarantined = await quarantineFileTool.handler({ path: source });
        const quarantineId = String(quarantined.structuredContent['quarantineId']);
        const metadataPath = path.resolve(String(quarantined.structuredContent['metadataPath']));
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        metadata.status = 'restored';
        metadata.restoredAt = new Date().toISOString();
        metadata.restoredPath = path.relative(process.cwd(), source);
        metadata.transaction = {
            kind: 'restore',
            destinationPath: metadata.restoredPath,
            backupPath: path.relative(process.cwd(), protectedFile),
            destinationExisted: true,
        };
        await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

        const inspected = await inspectQuarantinedFileTool.handler({ quarantineId });
        assert.equal(inspected.isError, true);
        assert.equal(inspected.structuredContent['code'], 'ERR_QUARANTINE_NOT_FOUND');
        assert.equal(await fs.readFile(protectedFile, 'utf8'), 'protected\n');
    });

    it('does not inspect or restore a quarantined data symlink', async () => {
        assert.ok(inspectQuarantinedFileTool);
        assert.ok(quarantineFileTool);
        assert.ok(restoreQuarantinedFileTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const source = path.join(dir, 'symlink-quarantine-source.txt');
        const target = path.join(dir, 'symlink-target.txt');
        await fs.writeFile(source, 'original\n', 'utf8');
        await fs.writeFile(target, 'target\n', 'utf8');

        const quarantined = await quarantineFileTool.handler({ path: source });
        const quarantineId = String(quarantined.structuredContent['quarantineId']);
        const quarantinePath = path.resolve(String(quarantined.structuredContent['quarantinePath']));
        await fs.rm(quarantinePath);
        await fs.symlink(target, quarantinePath);

        const inspected = await inspectQuarantinedFileTool.handler({ quarantineId });
        assert.equal(inspected.isError, undefined);
        assert.equal(inspected.structuredContent['dataExists'], false);
        assert.equal(inspected.structuredContent['restorable'], false);

        const restored = await restoreQuarantinedFileTool.handler({ quarantineId });
        assert.equal(restored.isError, true);
        assert.equal(restored.structuredContent['code'], 'ERR_QUARANTINE_DATA_INVALID');
        assert.equal(await fs.readFile(target, 'utf8'), 'target\n');
    });

    it('rejects quarantined data that no longer matches its manifest', async () => {
        assert.ok(quarantineFileTool);
        assert.ok(restoreQuarantinedFileTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const source = path.join(dir, 'tampered-quarantine-source.txt');
        await fs.writeFile(source, 'original\n', 'utf8');

        const quarantined = await quarantineFileTool.handler({ path: source });
        const quarantineId = String(quarantined.structuredContent['quarantineId']);
        const quarantinePath = path.resolve(String(quarantined.structuredContent['quarantinePath']));
        await fs.writeFile(quarantinePath, 'tampered\n', 'utf8');

        const restored = await restoreQuarantinedFileTool.handler({ quarantineId });
        assert.equal(restored.isError, true);
        assert.equal(restored.structuredContent['code'], 'ERR_QUARANTINE_DATA_INVALID');
        assert.equal(await pathExists(source), false);
    });

    it('reconciles a restore journal after the data move completed', async () => {
        assert.ok(inspectQuarantinedFileTool);
        assert.ok(quarantineFileTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const source = path.join(dir, 'journal-source.txt');
        const destination = path.join(dir, 'journal-destination.txt');
        await fs.writeFile(source, 'journal content\n', 'utf8');

        const quarantined = await quarantineFileTool.handler({ path: source });
        const quarantineId = String(quarantined.structuredContent['quarantineId']);
        const quarantinePath = path.resolve(String(quarantined.structuredContent['quarantinePath']));
        const metadataPath = path.resolve(String(quarantined.structuredContent['metadataPath']));
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        metadata.status = 'restoring';
        metadata.restoredAt = new Date().toISOString();
        metadata.restoredPath = path.relative(process.cwd(), destination);
        metadata.transaction = {
            kind: 'restore',
            destinationPath: metadata.restoredPath,
            backupPath: null,
            destinationExisted: false,
        };
        await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
        await fs.rename(quarantinePath, destination);

        const inspected = await inspectQuarantinedFileTool.handler({ quarantineId });
        assert.equal(inspected.isError, undefined);
        assert.equal(inspected.structuredContent['metadata'].status, 'restored');
        assert.equal(inspected.structuredContent['metadata'].transaction, null);
        assert.equal(inspected.structuredContent['dataExists'], false);
        assert.equal(await fs.readFile(destination, 'utf8'), 'journal content\n');
    });

    it('requires explicit overwrite confirmation when restoring quarantine over an existing file', async () => {
        assert.ok(quarantineFileTool);
        assert.ok(restoreQuarantinedFileTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const source = path.join(dir, 'source.txt');
        const destination = path.join(dir, 'destination.txt');
        await fs.writeFile(source, 'from quarantine\n', 'utf8');
        await fs.writeFile(destination, 'existing\n', 'utf8');

        const quarantined = await quarantineFileTool.handler({ path: source });
        assert.equal(quarantined.isError, undefined);
        const quarantineId = String(quarantined.structuredContent['quarantineId']);

        const blocked = await restoreQuarantinedFileTool.handler({ quarantineId, destinationPath: destination });
        assert.equal(blocked.isError, true);
        assert.equal(blocked.structuredContent['code'], 'EEXIST');
        assert.equal(await fs.readFile(destination, 'utf8'), 'existing\n');

        const missingConfirm = await restoreQuarantinedFileTool.handler({
            quarantineId,
            destinationPath: destination,
            overwrite: true,
        });
        assert.equal(missingConfirm.isError, true);
        assert.equal(missingConfirm.structuredContent['code'], 'ERR_RESTORE_CONFIRM_OVERWRITE_REQUIRED');

        const restored = await restoreQuarantinedFileTool.handler({
            quarantineId,
            destinationPath: destination,
            overwrite: true,
            confirmOverwrite: true,
        });
        assert.equal(restored.isError, undefined);
        assert.equal(await fs.readFile(destination, 'utf8'), 'from quarantine\n');
    });

    it('supports dry-run patches without mutating the file', async () => {
        assert.ok(applyPatchTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const filePath = path.join(dir, 'sample.txt');
        await fs.writeFile(filePath, 'one\ntwo\n', 'utf8');

        const result = await applyPatchTool.handler({
            path: filePath,
            old_string: 'two',
            new_string: 'TWO',
            dryRun: true,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent['success'], true);
        assert.equal(result.structuredContent['dryRun'], true);
        assert.equal(result.structuredContent['bytesWritten'], 0);
        assert.equal(await fs.readFile(filePath, 'utf8'), 'one\ntwo\n');
    });

    it('rejects an invalid JSON patch before atomic publish and preserves the original bytes', async () => {
        assert.ok(applyPatchTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const filePath = path.join(dir, 'guarded.json');
        const initial = '{\n  "value": 1\n}\n';
        await fs.writeFile(filePath, initial, 'utf8');

        const result = await applyPatchTool.handler({
            path: filePath,
            old_string: '"value": 1',
            new_string: '"value":',
        });

        assert.equal(result.isError, true);
        assert.equal(result.structuredContent['code'], 'ERR_PATCH_INVALID_JSON_RESULT');
        const failure = /** @type {Record<string, unknown>} */ (result.structuredContent['details']);
        assert.equal(failure['failureClass'], 'result-validation');
        assert.equal(failure['mutationState'], 'none');
        assert.equal(failure['recoveryRequired'], false);
        assert.equal(await fs.readFile(filePath, 'utf8'), initial);
    });

    it('validates the final JSON state of an atomic same-file patch batch, not transient virtual states', async () => {
        assert.ok(applyPatchBatchTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const filePath = path.join(dir, 'atomic-guarded.json');
        await fs.writeFile(filePath, '{\n  "a": 1,\n  "b": 2\n}\n', 'utf8');

        const result = await applyPatchBatchTool.handler({
            operations: [
                { path: filePath, old_string: '"a": 1,', new_string: '"a":,' },
                { path: filePath, old_string: '"a":,', new_string: '"a": 3,' },
            ],
            dryRun: false,
            confirmBatch: true,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent['success'], true);
        assert.equal(await fs.readFile(filePath, 'utf8'), '{\n  "a": 3,\n  "b": 2\n}\n');
    });

    it('rejects paths outside the workspace', async () => {
        assert.ok(applyPatchTool);
        const filePath = path.join(os.tmpdir(), `copilot-mcp-outside-${Date.now()}.txt`);
        await fs.writeFile(filePath, 'outside\n', 'utf8');

        const result = await applyPatchTool.handler({
            path: filePath,
            old_string: 'outside',
            new_string: 'blocked',
        });

        assert.equal(result.isError, true);
        assert.equal(result.structuredContent['success'], false);
        assert.match(String(result.structuredContent['error']), /Acesso negado|outside/i);
    });
});

/**
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function pathExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}
