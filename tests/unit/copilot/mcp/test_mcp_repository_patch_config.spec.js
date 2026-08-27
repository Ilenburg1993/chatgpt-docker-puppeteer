// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createMcpProcessConfig } from '#copilot/mcp/public/composition/process-config';
import { createMcpToolOperationContext, requireMcpToolRepositoryPatchConfig } from '#copilot/mcp/public/protocol/tools';
import { readMcpRepositoryPatchConfig } from '#copilot/mcp/public/workspace/repository/patch/config';

function createServerContext() {
    return {
        mcpReq: {
            id: 'patch-config-test',
            method: 'tools/call',
            signal: new AbortController().signal,
        },
    };
}

function createWorkspaceCapability() {
    return /** @type {any} */ ({ workspaceRoot: '/workspace', io: {} });
}

describe('MCP repository patch process config', () => {
    it('defaults exact self-repair on with a hard single-attempt ceiling', () => {
        const config = readMcpRepositoryPatchConfig({});
        assert.equal(config.exactSelfRepairEnabled, true);
        assert.equal(config.exactSelfRepairMaxAttempts, 1);
        assert.equal(config.policyKey, 'v1:exact-self-repair:enabled:max-1');
        assert.equal(Object.isFrozen(config), true);
    });

    it('supports a process-scoped kill switch without an allow-wire override', () => {
        for (const value of ['1', 'true', 'yes', 'on']) {
            const config = readMcpRepositoryPatchConfig({ COPILOT_MCP_PATCH_EXACT_SELF_REPAIR_DISABLED: value });
            assert.equal(config.exactSelfRepairEnabled, false);
            assert.equal(config.exactSelfRepairMaxAttempts, 1);
        }
        for (const value of ['0', 'false', 'no', 'off']) {
            const config = readMcpRepositoryPatchConfig({ COPILOT_MCP_PATCH_EXACT_SELF_REPAIR_DISABLED: value });
            assert.equal(config.exactSelfRepairEnabled, true);
        }
    });

    it('captures one immutable generation and projects the same policy into each operation context', () => {
        const env = /** @type {NodeJS.ProcessEnv} */ ({
            PATH: '/usr/bin',
            COPILOT_MCP_PATCH_EXACT_SELF_REPAIR_DISABLED: 'true',
        });
        const processConfig = createMcpProcessConfig(env);
        const captured = processConfig.repositoryPatch;
        env.COPILOT_MCP_PATCH_EXACT_SELF_REPAIR_DISABLED = 'false';

        assert.equal(captured.exactSelfRepairEnabled, false);
        assert.strictEqual(processConfig.toolConfig.repositoryPatch, captured);

        const operationContext = createMcpToolOperationContext(createServerContext(), {
            workspace: createWorkspaceCapability(),
            config: processConfig.toolConfig,
        });
        assert.strictEqual(requireMcpToolRepositoryPatchConfig(operationContext), captured);
        assert.equal(operationContext.config.repositoryPatch?.exactSelfRepairEnabled, false);
    });
});
