// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { buildCloudflareMcpPassthroughApplyDecision } from '#copilot/testing/mcp/cloudflare/posture';

function diff(overrides = {}) {
    return {
        ok: true,
        endpoint: { publicHostname: 'mcp.aurelin.org' },
        critical: [],
        diff: { needsCreate: true, needsUpdate: false, alreadySatisfied: false },
        ...overrides,
    };
}

describe('Cloudflare passthrough apply decision', () => {
    it('keeps dry-run and unconfirmed preview strictly before the backup/mutation boundary', () => {
        const dryRun = buildCloudflareMcpPassthroughApplyDecision(diff(), { dryRun: true, confirmApply: true });
        assert.equal(dryRun.preflightOk, true);
        assert.equal(dryRun.backupRequired, false);
        assert.equal(dryRun.plan.action, 'create-rule');

        const unconfirmed = buildCloudflareMcpPassthroughApplyDecision(diff(), {
            dryRun: false,
            confirmApply: false,
        });
        assert.equal(unconfirmed.backupRequired, false);
    });

    it('requires backup only for a clean confirmed mutation and skips it when already satisfied', () => {
        const mutation = buildCloudflareMcpPassthroughApplyDecision(diff(), {
            dryRun: false,
            confirmApply: true,
        });
        assert.equal(mutation.backupRequired, true);

        const satisfied = buildCloudflareMcpPassthroughApplyDecision(
            diff({ diff: { needsCreate: false, needsUpdate: false, alreadySatisfied: true } }),
            { dryRun: false, confirmApply: true },
        );
        assert.equal(satisfied.backupRequired, false);
        assert.equal(satisfied.plan.action, 'none');
    });

    it('never crosses the backup boundary when policy preflight is not clean', () => {
        const blocked = buildCloudflareMcpPassthroughApplyDecision(diff({ critical: ['permission-gap'] }), {
            dryRun: false,
            confirmApply: true,
        });
        assert.equal(blocked.preflightOk, false);
        assert.equal(blocked.backupRequired, false);
    });
});
