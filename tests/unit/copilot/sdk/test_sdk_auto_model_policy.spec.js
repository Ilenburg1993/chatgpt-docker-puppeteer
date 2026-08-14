// @ts-check

import { describe, expect, it } from 'vitest';

import {
    COPILOT_AUTO_MODEL_PUBLIC_CRITERIA,
    describeAutoModelPolicy,
    readAutoModelPreference,
} from '../../../../src/copilot/sdk/models/auto-policy.js';

describe('sdk/models/auto-policy', () => {
    it('documenta critérios públicos de Auto model selection sem prometer preferência forçável', () => {
        const policy = describeAutoModelPolicy({
            configuredModel: 'auto',
            observedModel: 'claude-haiku-4.5',
        });

        expect(policy.selectionAuthority).toBe('github-copilot');
        expect(policy.canForcePreference).toBe(false);
        expect(policy.preferredModel).toBe('gpt-5.4');
        expect(policy.preferredReasoningEffort).toBe('high');
        expect(policy.preferenceSatisfied).toBe(false);
        expect(policy.criteria).toEqual(COPILOT_AUTO_MODEL_PUBLIC_CRITERIA);
        expect(policy.criteria).toContain('real_time_system_health');
        expect(policy.criteria).toContain('task_complexity');
        expect(policy.criteria).toContain('usage_cost_efficiency');
        expect(policy.criteria).not.toContain('premium_multiplier_lte_1');
    });

    it('permite preferência advisory por env sem alterar autoridade do SDK', () => {
        const preference = readAutoModelPreference({
            COPILOT_AUTO_PREFERRED_MODEL: 'gpt-5.5',
            COPILOT_AUTO_PREFERRED_REASONING_EFFORT: 'xhigh',
        });

        expect(preference).toMatchObject({
            preferredModel: 'gpt-5.5',
            preferredReasoningEffort: 'xhigh',
            mode: 'advisory',
            source: 'env',
        });
    });
});
