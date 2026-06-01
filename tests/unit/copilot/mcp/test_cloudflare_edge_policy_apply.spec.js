import { describe, expect, it } from 'vitest';
import {
    buildCloudflareEdgeApplyPlan,
    buildCloudflareEdgeDesiredApiRules,
} from '../../../../src/copilot/mcp/cloudflare/edge-policy-apply.js';

describe('mcp/cloudflare/edge-policy-apply', () => {
    it('builds idempotent desired API rules for MCP edge policy', () => {
        const rules = buildCloudflareEdgeDesiredApiRules('mcp.aurelin.org');

        expect(rules.map((rule) => rule.ref)).toEqual([
            'copilot-mcp-cache-bypass-v1',
            'copilot-mcp-oauth-token-rate-limit-v1',
            'copilot-mcp-anonymous-rate-limit-v1',
        ]);
        expect(rules[0]?.rule).toMatchObject({
            action: 'set_cache_settings',
            action_parameters: { cache: false },
        });
        expect(rules[1]?.rule.ratelimit).toMatchObject({
            characteristics: ['cf.colo.id', 'ip.src'],
            period: 10,
            requests_per_period: 20,
            mitigation_timeout: 10,
        });
    });

    it('plans create/append/present actions without losing existing rules', () => {
        const desired = buildCloudflareEdgeDesiredApiRules('mcp.aurelin.org');
        const plan = buildCloudflareEdgeApplyPlan(
            [
                {
                    id: 'cache-ruleset-id',
                    phase: 'http_request_cache_settings',
                    rules: [{ ref: 'existing-cache-rule' }],
                },
                {
                    id: 'rate-ruleset-id',
                    phase: 'http_ratelimit',
                    rules: [{ ref: 'copilot-mcp-oauth-token-rate-limit-v1' }],
                },
            ],
            desired,
        );

        expect(plan.summary).toMatchObject({
            actionCount: 3,
            createEntrypointRulesets: 0,
            appendRules: 2,
            alreadyPresent: 1,
        });
        expect(plan.actions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    ref: 'copilot-mcp-cache-bypass-v1',
                    status: 'append-rule',
                    preservesExistingRules: true,
                }),
                expect.objectContaining({
                    ref: 'copilot-mcp-oauth-token-rate-limit-v1',
                    status: 'present',
                }),
                expect.objectContaining({
                    ref: 'copilot-mcp-anonymous-rate-limit-v1',
                    status: 'append-rule',
                    rateLimitRuleMustRemainLast: true,
                }),
            ]),
        );
    });

    it('filters planned actions by explicit rule refs', () => {
        const desired = buildCloudflareEdgeDesiredApiRules('mcp.aurelin.org');
        const plan = buildCloudflareEdgeApplyPlan([], desired, {
            phases: ['http_ratelimit'],
            ruleRefs: ['copilot-mcp-oauth-token-rate-limit-v1'],
        });

        expect(plan.summary).toMatchObject({
            actionCount: 1,
            createEntrypointRulesets: 1,
            appendRules: 0,
            alreadyPresent: 0,
        });
        expect(plan.actions).toEqual([
            expect.objectContaining({
                ref: 'copilot-mcp-oauth-token-rate-limit-v1',
                status: 'create-entrypoint-ruleset',
            }),
        ]);
    });

    it('groups multiple rules in a missing phase under one entrypoint creation', () => {
        const desired = buildCloudflareEdgeDesiredApiRules('mcp.aurelin.org');
        const plan = buildCloudflareEdgeApplyPlan([], desired);

        expect(plan.summary).toMatchObject({
            actionCount: 3,
            createEntrypointRulesets: 2,
            appendRules: 1,
            alreadyPresent: 0,
        });
        expect(plan.actions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    ref: 'copilot-mcp-oauth-token-rate-limit-v1',
                    status: 'create-entrypoint-ruleset',
                }),
                expect.objectContaining({
                    ref: 'copilot-mcp-anonymous-rate-limit-v1',
                    status: 'append-rule-after-entrypoint-create',
                }),
            ]),
        );
    });
});
