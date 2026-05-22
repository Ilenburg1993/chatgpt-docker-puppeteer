// @ts-check
/**
 * Tests for MCP validator job command catalog.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { resolveJobTimeoutMs, resolveValidatorCommand } from '../../../../src/copilot/mcp/control-plane/jobs.js';
import { jobTools } from '../../../../src/copilot/mcp/tools/jobs.js';

describe('copilot MCP jobs', () => {
    it('resolves only allowlisted validator commands', () => {
        assert.deepEqual(resolveValidatorCommand('typecheck'), {
            command: 'npm',
            args: ['run', 'typecheck:strict:src.copilot'],
        });
        assert.deepEqual(resolveValidatorCommand('lint'), {
            command: 'npm',
            args: ['run', 'lint:copilot'],
        });
        assert.deepEqual(resolveValidatorCommand('unit-copilot'), {
            command: 'npm',
            args: ['run', 'test:copilot:unit'],
        });
        assert.deepEqual(resolveValidatorCommand('unit-mcp'), {
            command: 'npx',
            args: ['vitest', '--config', 'vitest.copilot.config.js', 'run', 'tests/unit/copilot/mcp'],
        });
    });

    it('rejects unsupported validators', () => {
        assert.throws(() => resolveValidatorCommand(/** @type {any} */ ('admin-command')), /Unsupported validator/);
    });

    it('normalizes job timeouts inside supported bounds', () => {
        assert.equal(resolveJobTimeoutMs(undefined), 1_200_000);
        assert.equal(resolveJobTimeoutMs(10), 1_000);
        assert.equal(resolveJobTimeoutMs(2_500), 2_500);
        assert.equal(resolveJobTimeoutMs(9_999_999), 3_600_000);
    });

    it('exposes canonical validator alias tools', () => {
        const names = jobTools.map((tool) => tool.name);
        assert.ok(names.includes('run_typecheck_copilot'));
        assert.ok(names.includes('run_lint_copilot'));
        assert.ok(names.includes('run_unit_copilot'));
        assert.ok(names.includes('run_project_doctor'));
        assert.ok(names.includes('job_list'));
    });

    it('job_list returns a structured job array', async () => {
        const tool = jobTools.find((candidate) => candidate.name === 'job_list');
        assert.ok(tool);
        const result = await tool.handler({ limit: 5 });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.ok(Array.isArray(result.structuredContent?.['jobs']));
    });
});
