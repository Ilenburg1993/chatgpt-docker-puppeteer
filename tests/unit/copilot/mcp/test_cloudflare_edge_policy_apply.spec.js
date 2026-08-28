import { buildCloudflareEdgeApplyPlan, buildCloudflareEdgeDesiredApiRules } from '#copilot/mcp/public/cloudflare/edge';
import { describe, expect, it } from 'vitest';
import { buildCloudflareEdgeApplyDecision } from '../../../../src/copilot/mcp/cloudflare/edge/edge-policy-apply.js';

describe('mcp/cloudflare/edge-policy-apply', () => {
    it('builds idempotent desired API rules for MCP edge policy', () => {
        const rules = buildCloudflareEdgeDesiredApiRules('mcp.aurelin.org');

        expect(rules.map((rule) => rule.ref)).toEqual([
            'copilot-mcp-cache-bypass-v1',
            'copilot-mcp-oauth-token-rate-limit-v1',
        ]);
        expect(rules[0]?.rule).toMatchObject({
            action: 'set_cache_settings',
            action_parameters: { cache: false },
        });
        expect(rules[1]?.rule['ratelimit']).toMatchObject({
            characteristics: ['cf.colo.id', 'ip.src'],
            period: 10,
            requests_per_period: 20,
            mitigation_timeout: 10,
        });
    });

    it('plans create/append/update actions without losing existing rules', () => {
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
            actionCount: 2,
            createEntrypointRulesets: 0,
            appendRules: 1,
            updateRules: 1,
            alreadyPresent: 0,
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
                    status: 'update-rule',
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
            actionCount: 2,
            createEntrypointRulesets: 2,
            appendRules: 0,
            alreadyPresent: 0,
        });
        expect(plan.actions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    ref: 'copilot-mcp-oauth-token-rate-limit-v1',
                    status: 'create-entrypoint-ruleset',
                }),
            ]),
        );
    });

    it('keeps preview and unconfirmed paths before the backup boundary', () => {
        const actual = { ok: true };
        const diff = { ok: true, mutationReady: true };
        const plan = { actions: [{ status: 'append-rule' }] };

        expect(
            buildCloudflareEdgeApplyDecision(actual, diff, plan, {
                phases: ['http_request_cache_settings'],
            }),
        ).toMatchObject({
            dryRun: true,
            confirmApply: false,
            preflightOk: true,
            mutationNeeded: true,
            backupRequired: false,
        });
        expect(
            buildCloudflareEdgeApplyDecision(actual, diff, plan, {
                dryRun: false,
                confirmApply: false,
                phases: ['http_request_cache_settings'],
            }),
        ).toMatchObject({
            dryRun: false,
            confirmApply: false,
            preflightOk: true,
            mutationNeeded: true,
            backupRequired: false,
        });
    });

    it('requires backup only for a clean confirmed mutation that still has work', () => {
        const actual = { ok: true };
        const diff = { ok: true, mutationReady: true };
        const mutation = buildCloudflareEdgeApplyDecision(
            actual,
            diff,
            { actions: [{ status: 'append-rule' }] },
            {
                dryRun: false,
                confirmApply: true,
                phases: ['http_request_cache_settings'],
            },
        );
        expect(mutation).toMatchObject({
            preflightOk: true,
            mutationNeeded: true,
            backupRequired: true,
        });

        const satisfied = buildCloudflareEdgeApplyDecision(
            actual,
            diff,
            { actions: [{ status: 'present' }] },
            {
                dryRun: false,
                confirmApply: true,
                phases: ['http_request_cache_settings'],
            },
        );
        expect(satisfied).toMatchObject({
            preflightOk: true,
            mutationNeeded: false,
            backupRequired: false,
        });
    });

    it('blocks rate-limit or empty selections before backup', () => {
        const actual = { ok: true };
        const diff = { ok: true, mutationReady: true };
        expect(
            buildCloudflareEdgeApplyDecision(
                actual,
                diff,
                { actions: [{ status: 'append-rule' }] },
                {
                    dryRun: false,
                    confirmApply: true,
                    phases: ['http_ratelimit'],
                },
            ),
        ).toMatchObject({
            preflightOk: false,
            rateLimitApplyNeedsRefs: true,
            backupRequired: false,
        });
        expect(
            buildCloudflareEdgeApplyDecision(
                actual,
                diff,
                { actions: [] },
                {
                    dryRun: false,
                    confirmApply: true,
                    phases: ['http_request_cache_settings'],
                    ruleRefs: ['missing-ref'],
                },
            ),
        ).toMatchObject({
            preflightOk: false,
            selectionEmpty: true,
            backupRequired: false,
        });
    });
});
