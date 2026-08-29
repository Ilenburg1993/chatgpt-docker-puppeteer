// @ts-check

import assert from 'node:assert/strict';
import { hash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterAll, afterEach, describe, it } from 'vitest';

import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import { createMcpToolOperationContext } from '#copilot/mcp/public/protocol/tools';
import { buildMcpToolWireDescriptorSnapshot, getCanonicalMcpTools } from '#copilot/mcp/public/registry';

/** @type {string[]} */
const tempDirs = [];
const TEST_PROCESS_HOST = createComposedMcpProcessHost({
    hostId: 'mcp-patch-target-groups-v3-wire-unit-process-host',
    backgroundServices: false,
});
/** @type {import('#copilot/mcp/public/auth').McpPrincipalIdentity} */
const TEST_PRINCIPAL = Object.freeze({
    version: 'mcp-principal-v1',
    key: 'test-patch-target-groups-v3-wire-principal',
    mode: 'test',
    verified: true,
    resource: 'workspace:test',
    audience: 'workspace:test',
});
const TOOL_OPERATION_CONTEXT = createMcpToolOperationContext(
    {
        mcpReq: {
            id: 'mcp-patch-target-groups-v3-wire-unit',
            method: 'tools/call',
            signal: new AbortController().signal,
            _meta: { caller: 'test_mcp_patch_target_groups_v3_wire' },
            envelope: { protocol: '2026' },
        },
    },
    {
        workspace: TEST_PROCESS_HOST.workspace,
        principal: TEST_PRINCIPAL,
        config: TEST_PROCESS_HOST.processConfig.toolConfig,
        capabilities: TEST_PROCESS_HOST.toolCapabilities,
    },
);

/** @param {string} value */
function sha256(value) {
    return hash('sha256', value, 'hex');
}

/** @param {string} name */
function findTool(name) {
    const tool = getCanonicalMcpTools().find((candidate) => candidate.name === name);
    assert.ok(tool, `missing tool ${name}`);
    return {
        ...tool,
        handler: /** @type {typeof tool.handler} */ ((input) => tool.handler(input, TOOL_OPERATION_CONTEXT)),
    };
}

/** @param {string} name @param {string} content */
async function createRepoFile(name, content) {
    const root = join(process.cwd(), 'src/copilot/.ai/jobs');
    await mkdir(root, { recursive: true });
    const dir = await mkdtemp(join(root, 'patch-target-groups-v3-'));
    tempDirs.push(dir);
    const absolutePath = join(dir, name);
    await writeFile(absolutePath, content, 'utf8');
    return { absolutePath, repoPath: relative(process.cwd(), absolutePath).replaceAll('\\', '/') };
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

afterAll(async () => {
    await TEST_PROCESS_HOST.dispose();
});

describe('Patch Target Groups V3 wire', () => {
    it('applies several same-target edits with one explicit target baseline', async () => {
        const initial = 'alpha beta gamma';
        const { absolutePath, repoPath } = await createRepoFile('same-target.txt', initial);
        const result = await findTool('repo_apply_patch_batch').handler({
            targets: [
                {
                    path: repoPath,
                    expectedHash: sha256(initial),
                    durability: 'file',
                    operations: [
                        { old_string: 'alpha', new_string: 'ALPHA' },
                        { old_string: 'beta', new_string: 'BETA' },
                        { old_string: 'gamma', new_string: 'GAMMA' },
                    ],
                },
            ],
            dryRun: false,
            confirmBatch: true,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['operationCount'], 3);
        assert.equal(result.structuredContent?.['targetCount'], 1);
        const rows = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['applied']);
        assert.deepEqual(
            rows.map((row) => row['expectedHashMode']),
            ['target-baseline', 'target-baseline', 'target-baseline'],
        );
        assert.equal(await readFile(absolutePath, 'utf8'), 'ALPHA BETA GAMMA');
    });

    it('fails closed when a single-operation target baseline is stale', async () => {
        const initial = 'alpha';
        const { absolutePath, repoPath } = await createRepoFile('single-stale-baseline.txt', initial);
        const result = await findTool('repo_apply_patch').handler({
            path: repoPath,
            old_string: 'alpha',
            new_string: 'ALPHA',
            expectedHash: sha256('different-baseline'),
        });

        assert.equal(result.isError, true);
        assert.equal(result.structuredContent?.['code'], 'EEXPECTEDHASH');
        assert.equal(result.structuredContent?.['details']?.['mutationState'], 'none');
        assert.equal(await readFile(absolutePath, 'utf8'), initial);
    });

    it('preserves independent target progress with target-native input', async () => {
        const first = await createRepoFile('first.txt', 'alpha');
        const second = await createRepoFile('second.txt', 'beta');
        const result = await findTool('repo_apply_patch_batch').handler({
            targets: [
                { path: first.repoPath, operations: [{ old_string: 'alpha', new_string: 'ALPHA' }] },
                { path: second.repoPath, operations: [{ old_string: 'missing', new_string: 'BETA' }] },
            ],
            dryRun: false,
            confirmBatch: true,
        });

        assert.equal(result.isError, true);
        assert.equal(result.structuredContent?.['success'], false);
        assert.equal(result.structuredContent?.['partial'], true);
        assert.equal(result.structuredContent?.['appliedCount'], 1);
        assert.equal(result.structuredContent?.['reportedFailureCount'], 1);
        assert.equal(await readFile(first.absolutePath, 'utf8'), 'ALPHA');
        assert.equal(await readFile(second.absolutePath, 'utf8'), 'beta');
    });

    it('keeps dry-run preview target-native on the canonical V3 owner', async () => {
        const { repoPath } = await createRepoFile('plan.txt', 'alpha beta');
        const targets = [
            {
                path: repoPath,
                operations: [
                    { old_string: 'alpha', new_string: 'ALPHA' },
                    { old_string: 'beta', new_string: 'BETA' },
                ],
            },
        ];
        const result = await findTool('repo_apply_patch_batch').handler({ targets, dryRun: true });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['dryRun'], true);
        assert.equal(result.structuredContent?.['targetCount'], 1);
        assert.equal(result.structuredContent?.['operationCount'], 2);
        const targetSummaries = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['targetSummaries']);
        assert.equal(targetSummaries[0]?.['path'], repoPath);
    });

    it('forces detailed result mode from nested V3 includeDiffPreview', async () => {
        const { repoPath } = await createRepoFile('diff.txt', 'alpha');
        const result = await findTool('repo_apply_patch_batch').handler({
            targets: [
                {
                    path: repoPath,
                    operations: [{ old_string: 'alpha', new_string: 'ALPHA', includeDiffPreview: true }],
                },
            ],
            resultMode: 'compact',
        });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['resultMode'], 'detailed');
        assert.equal(result.structuredContent?.['resultModeForcedByDiffPreview'], true);
    });

    it('publishes a V3-only descriptor and rejects duplicate target identities', async () => {
        const snapshot = buildMcpToolWireDescriptorSnapshot(getCanonicalMcpTools());
        const descriptor = snapshot.descriptors.find((candidate) => candidate.name === 'repo_apply_patch_batch');
        assert.ok(descriptor, 'missing descriptor repo_apply_patch_batch');
        const schema = /** @type {Record<string, unknown>} */ (descriptor.inputSchema);
        const properties = /** @type {Record<string, unknown>} */ (schema['properties']);
        assert.ok('targets' in properties);
        assert.equal('operations' in properties, false);
        assert.equal('durability' in properties, false);
        assert.deepEqual(schema['required'], ['targets']);
        assert.equal(snapshot.descriptors.some((candidate) => candidate.name === 'repo_patch_batch_plan'), false);

        const { repoPath } = await createRepoFile('invalid.txt', 'alpha');
        const tool = findTool('repo_apply_patch_batch');
        const target = { path: repoPath, operations: [{ old_string: 'alpha', new_string: 'ALPHA' }] };
        const duplicate = await tool.handler({ targets: [target, target] });
        assert.equal(duplicate.isError, true);
        assert.equal(duplicate.structuredContent?.['code'], 'ERR_PATCH_BATCH_DUPLICATE_TARGET');
    });
});
