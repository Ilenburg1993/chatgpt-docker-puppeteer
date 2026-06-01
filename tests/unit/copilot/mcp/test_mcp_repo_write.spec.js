// @ts-check
/**
 * Tests for controlled MCP write tools.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';

import { repoWriteTools } from '#copilot/mcp/tools';

const applyPatchTool = repoWriteTools.find((tool) => tool.name === 'repo_apply_patch');
const applyFileBatchPlanTool = repoWriteTools.find((tool) => tool.name === 'repo_apply_file_batch_plan');
const applyFileBatchTool = repoWriteTools.find((tool) => tool.name === 'repo_apply_file_batch');
const writeFileTool = repoWriteTools.find((tool) => tool.name === 'repo_write_file');
const createFileTool = repoWriteTools.find((tool) => tool.name === 'repo_create_file');
const moveFileTool = repoWriteTools.find((tool) => tool.name === 'repo_move_file');
const listQuarantineTool = repoWriteTools.find((tool) => tool.name === 'repo_list_quarantine');
const inspectQuarantinedFileTool = repoWriteTools.find((tool) => tool.name === 'repo_inspect_quarantined_file');
const quarantineFileTool = repoWriteTools.find((tool) => tool.name === 'repo_quarantine_file');
const restoreQuarantinedFileTool = repoWriteTools.find((tool) => tool.name === 'repo_restore_quarantined_file');
const removeFileTool = repoWriteTools.find((tool) => tool.name === 'repo_remove_file');

describe('copilot MCP repo write tools', () => {
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
        assert.equal(result.structuredContent.success, true);
        assert.equal(result.structuredContent.bytesWritten, 6);
        assert.match(String(result.structuredContent.diffPreview), /-before/);
        assert.match(String(result.structuredContent.diffPreview), /\+after/);
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
        assert.equal(created.structuredContent.success, true);
        assert.match(String(created.structuredContent.diffPreview), /\+new file/);
        assert.equal(await fs.readFile(filePath, 'utf8'), 'new file\n');

        const duplicate = await createFileTool.handler({
            path: filePath,
            content: 'again\n',
        });
        assert.equal(duplicate.isError, true);
        assert.equal(duplicate.structuredContent.success, false);
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
        assert.equal(result.structuredContent.success, true);
        assert.equal(result.structuredContent.replacedOccurrences, 1);
        assert.match(String(result.structuredContent.diffPreview), /-beta/);
        assert.match(String(result.structuredContent.diffPreview), /\+BETA/);
        assert.equal(await fs.readFile(filePath, 'utf8'), 'alpha\nBETA\ngamma\n');
    });

    it('moves files without overwriting by default', async () => {
        assert.ok(moveFileTool);
        const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/mcp-write-test-'));
        const source = path.join(dir, 'source.txt');
        const destination = path.join(dir, 'destination.txt');
        await fs.writeFile(source, 'move me\n', 'utf8');

        const result = await moveFileTool.handler({
            source,
            destination,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent.success, true);
        assert.equal(await fs.readFile(destination, 'utf8'), 'move me\n');
        await assert.rejects(() => fs.access(source));
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
        assert.equal(removed.structuredContent.success, true);
        assert.equal(removed.structuredContent.deleted, true);
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
        assert.equal(plan.structuredContent.success, true);
        assert.equal(plan.structuredContent.plannedTool, 'repo_apply_file_batch');
        assert.equal(plan.structuredContent.dryRun, true);
        assert.equal(plan.structuredContent.operationCount, 1);
        assert.equal(plan.structuredContent.nextCall.tool, 'repo_apply_file_batch');
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
        assert.equal(dryRun.structuredContent.success, true);
        assert.equal(dryRun.structuredContent.dryRun, true);
        await assert.rejects(() => fs.access(created));

        const missingConfirm = await applyFileBatchTool.handler({
            operations: [{ type: 'create_file', path: created, content: 'batched\n' }],
            dryRun: false,
        });
        assert.equal(missingConfirm.isError, true);
        assert.equal(missingConfirm.structuredContent.code, 'ERR_BATCH_CONFIRM_REQUIRED');

        const applied = await applyFileBatchTool.handler({
            operations: [
                { type: 'create_file', path: created, content: 'batched\n' },
                { type: 'move_file', source, destination: moved },
            ],
            dryRun: false,
            confirmBatch: true,
        });
        assert.equal(applied.isError, undefined);
        assert.equal(applied.structuredContent.success, true);
        assert.equal(applied.structuredContent.operationCount, 2);
        assert.equal(await fs.readFile(created, 'utf8'), 'batched\n');
        assert.equal(await fs.readFile(moved, 'utf8'), 'move in batch\n');
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
        assert.equal(quarantined.structuredContent.success, true);
        assert.equal(quarantined.structuredContent.status, 'quarantined');
        assert.equal(await pathExists(filePath), false);

        const quarantineId = String(quarantined.structuredContent.quarantineId);
        const listed = await listQuarantineTool.handler({ status: 'quarantined', limit: 20 });
        assert.equal(listed.isError, undefined);
        const listedItems = /** @type {{ quarantineId?: string }[]} */ (listed.structuredContent.items);
        assert.ok(listedItems.some((item) => item.quarantineId === quarantineId));

        const inspected = await inspectQuarantinedFileTool.handler({ quarantineId });
        assert.equal(inspected.isError, undefined);
        assert.equal(inspected.structuredContent.restorable, true);
        assert.equal(typeof inspected.structuredContent.dataSha256, 'string');

        const restored = await restoreQuarantinedFileTool.handler({ quarantineId });
        assert.equal(restored.isError, undefined);
        assert.equal(restored.structuredContent.success, true);
        assert.equal(restored.structuredContent.destination.endsWith('quarantine.txt'), true);
        assert.equal(await fs.readFile(filePath, 'utf8'), 'recover me\n');

        const secondRestore = await restoreQuarantinedFileTool.handler({ quarantineId });
        assert.equal(secondRestore.isError, true);
        assert.equal(secondRestore.structuredContent.code, 'ERR_QUARANTINE_NOT_RESTORABLE');
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
        const quarantineId = String(quarantined.structuredContent.quarantineId);

        const blocked = await restoreQuarantinedFileTool.handler({ quarantineId, destinationPath: destination });
        assert.equal(blocked.isError, true);
        assert.equal(blocked.structuredContent.code, 'EEXIST');
        assert.equal(await fs.readFile(destination, 'utf8'), 'existing\n');

        const missingConfirm = await restoreQuarantinedFileTool.handler({
            quarantineId,
            destinationPath: destination,
            overwrite: true,
        });
        assert.equal(missingConfirm.isError, true);
        assert.equal(missingConfirm.structuredContent.code, 'ERR_RESTORE_CONFIRM_OVERWRITE_REQUIRED');

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
        assert.equal(result.structuredContent.success, true);
        assert.equal(result.structuredContent.dryRun, true);
        assert.equal(result.structuredContent.bytesWritten, 0);
        assert.equal(await fs.readFile(filePath, 'utf8'), 'one\ntwo\n');
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
        assert.equal(result.structuredContent.success, false);
        assert.match(String(result.structuredContent.error), /Acesso negado|outside/i);
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
