// @ts-check
/**
 * Tests for controlled MCP write tools.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';

import { repoWriteTools } from '../../../../src/copilot/mcp/tools/repo-write.js';

const applyPatchTool = repoWriteTools.find((tool) => tool.name === 'repo_apply_patch');
const writeFileTool = repoWriteTools.find((tool) => tool.name === 'repo_write_file');
const createFileTool = repoWriteTools.find((tool) => tool.name === 'repo_create_file');
const moveFileTool = repoWriteTools.find((tool) => tool.name === 'repo_move_file');
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
