// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    buildRepositoryPatchNextAction,
    classifyRepositoryPatchFailure,
} from '#copilot/mcp/public/workspace/repository/patch';

describe('MCP repository patch failure semantics', () => {
    it.each([
        ['ERR_PATH_DENIED', 'integrity', 'manual-decision', false],
        ['ENOENT', 'target-missing', 'manual-decision', false],
        ['EISDIR', 'target-kind', 'manual-decision', false],
        ['ENOTDIR', 'target-kind', 'manual-decision', false],
        ['ERR_EMPTY_PATH', 'shape-config', 'manual-decision', false],
        ['ERR_NULL_BYTE_PATH', 'shape-config', 'manual-decision', false],
        ['ERR_INVALID_PATH', 'shape-config', 'manual-decision', false],
    ])(
        'classifies known pre-engine code %s without prescribing a stale-context reread',
        (code, failureClass, retryability, recoveryRequired) => {
            const classified = classifyRepositoryPatchFailure(code);
            assert.equal(classified.failureClass, failureClass);
            assert.equal(classified.retryability, retryability);
            assert.equal(classified.recoveryRequired, recoveryRequired);
            assert.doesNotMatch(buildRepositoryPatchNextAction(code), /refresh only this target hash|stale/u);
        },
    );

    it('keeps a truly unknown code unknown instead of hiding it behind a generic known class', () => {
        const classified = classifyRepositoryPatchFailure('ERR_FUTURE_UNDERSTOOD_BY_NOBODY');
        assert.equal(classified.failureClass, 'unknown');
        assert.equal(classified.retryability, 'caller-refresh');
        assert.equal(classified.recoveryRequired, true);
    });
});
