// @ts-check

import * as assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { fingerprintMatches } from '../../../../src/copilot/infra/platform/fingerprint.js';

describe('infra/shared/fingerprint-match', () => {
    it('retorna true para mtime dentro da tolerância com size idêntico', () => {
        assert.equal(
            fingerprintMatches(
                { mtimeMs: 1000, sizeBytes: 42 },
                { mtimeMs: 1001, sizeBytes: 42 },
                { mtimeToleranceMs: 2 },
            ),
            true,
        );
    });

    it('retorna false para size divergente', () => {
        assert.equal(
            fingerprintMatches(
                { mtimeMs: 1000, sizeBytes: 42 },
                { mtimeMs: 1000, sizeBytes: 43 },
                { mtimeToleranceMs: 2 },
            ),
            false,
        );
    });

    it('retorna false para mtime acima da tolerância', () => {
        assert.equal(
            fingerprintMatches(
                { mtimeMs: 1000, sizeBytes: 42 },
                { mtimeMs: 1005, sizeBytes: 42 },
                { mtimeToleranceMs: 2 },
            ),
            false,
        );
    });
});
