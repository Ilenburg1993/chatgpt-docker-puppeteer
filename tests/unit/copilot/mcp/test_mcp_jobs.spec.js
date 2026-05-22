// @ts-check
/**
 * Tests for MCP validator job command catalog.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { resolveValidatorCommand } from '../../../../src/copilot/mcp/control-plane/jobs.js';

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
        assert.equal(resolveValidatorCommand('unit-mcp').command, 'npx');
    });

    it('rejects unsupported validators', () => {
        assert.throws(() => resolveValidatorCommand(/** @type {any} */ ('admin-command')), /Unsupported validator/);
    });
});

