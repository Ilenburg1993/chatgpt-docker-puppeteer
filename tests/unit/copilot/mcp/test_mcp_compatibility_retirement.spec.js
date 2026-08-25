// @ts-check
/** Evidence-gated retirement policy for MCP 2025/DCR compatibility. */

import {
    DEFAULT_MCP_COMPATIBILITY_RETIREMENT_POLICY,
    MCP_COMPATIBILITY_RETIREMENT_POLICY_VERSION,
    evaluateMcpCompatibilityRetirementReadiness,
} from '#copilot/testing/mcp/observability';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

/**
 * @param {{
 *   windowMs?: number;
 *   protocolRequests?: number;
 *   modern2026?: number;
 *   legacy2025?: number;
 *   chatgptSuccesses?: number;
 *   claudeSuccesses?: number;
 *   dcrClients?: number;
 *   dcrGrants?: number;
 *   sourceOk?: boolean;
 * }} [input]
 */
function summary(input = {}) {
    return {
        source: { ok: input.sourceOk ?? true, truncatedByBytes: false },
        window: {
            firstObservedAt: '2026-08-18T00:00:00.000Z',
            lastObservedAt: '2026-08-25T00:00:00.000Z',
            durationMs: input.windowMs ?? DEFAULT_MCP_COMPATIBILITY_RETIREMENT_POLICY.minObservationWindowMs,
        },
        protocol: {
            totalRequests: input.protocolRequests ?? DEFAULT_MCP_COMPATIBILITY_RETIREMENT_POLICY.minProtocolRequests,
            byEra: { 2025: input.legacy2025 ?? 0, 2026: input.modern2026 ?? 100 },
        },
        oauth: {
            clientActivity: {
                bySource: { cimd: 2, dcr: input.dcrClients ?? 0, unknown: 0 },
                successfulByHostClass: {
                    chatgpt: input.chatgptSuccesses ?? 1,
                    claude: input.claudeSuccesses ?? 0,
                    unknown: 0,
                },
            },
            grants: { byClientSource: { cimd: 2, dcr: input.dcrGrants ?? 0, unknown: 0 } },
        },
    };
}

describe('MCP compatibility retirement readiness', () => {
    it('never treats an empty or short evidence window as zero-use proof', () => {
        const result = evaluateMcpCompatibilityRetirementReadiness(
            summary({ windowMs: 60_000, protocolRequests: 1, modern2026: 1, chatgptSuccesses: 0 }),
        );
        assert.equal(result.policyVersion, MCP_COMPATIBILITY_RETIREMENT_POLICY_VERSION);
        assert.equal(result.sharedEvidence.sufficient, false);
        assert.equal(result.retirement.protocol2025.status, 'insufficient-evidence');
        assert.equal(result.retirement.protocol2025.qualifiedZeroUse, false);
        assert.equal(result.retirement.dcr.status, 'insufficient-evidence');
        assert.ok(result.sharedEvidence.blockers.includes('observation-window-too-short'));
        assert.ok(result.sharedEvidence.blockers.includes('protocol-volume-too-low'));
        assert.ok(result.sharedEvidence.blockers.includes('required-host-not-observed:chatgpt'));
    });

    it('marks both surfaces candidate only after qualified zero-use evidence', () => {
        const result = evaluateMcpCompatibilityRetirementReadiness(summary());
        assert.equal(result.sharedEvidence.sufficient, true);
        assert.equal(result.retirement.protocol2025.status, 'candidate');
        assert.equal(result.retirement.protocol2025.qualifiedZeroUse, true);
        assert.equal(result.retirement.protocol2025.evidenceLabel, '2025-protocol-zero-use');
        assert.equal(result.retirement.dcr.status, 'candidate');
        assert.equal(result.retirement.dcr.qualifiedZeroUse, true);
        assert.equal(result.retirement.dcr.evidenceLabel, 'dcr-zero-use');
    });

    it('blocks only the compatibility surface for which use remains observed', () => {
        const protocolUse = evaluateMcpCompatibilityRetirementReadiness(summary({ legacy2025: 3 }));
        assert.equal(protocolUse.retirement.protocol2025.status, 'blocked-by-use');
        assert.equal(protocolUse.retirement.protocol2025.observedUseSignals, 3);
        assert.equal(protocolUse.retirement.dcr.status, 'candidate');

        const dcrUse = evaluateMcpCompatibilityRetirementReadiness(summary({ dcrClients: 1, dcrGrants: 2 }));
        assert.equal(dcrUse.retirement.protocol2025.status, 'candidate');
        assert.equal(dcrUse.retirement.dcr.status, 'blocked-by-use');
        assert.equal(dcrUse.retirement.dcr.observedUseSignals, 3);
    });

    it('can require Claude evidence explicitly without silently changing the default consumer policy', () => {
        const defaultPolicy = evaluateMcpCompatibilityRetirementReadiness(summary());
        assert.deepEqual(defaultPolicy.policy.requiredHostClasses, ['chatgpt']);

        const claudeRequired = evaluateMcpCompatibilityRetirementReadiness(summary(), {
            requiredHostClasses: ['chatgpt', 'claude'],
        });
        assert.equal(claudeRequired.sharedEvidence.sufficient, false);
        assert.ok(claudeRequired.sharedEvidence.blockers.includes('required-host-not-observed:claude'));

        const bothObserved = evaluateMcpCompatibilityRetirementReadiness(summary({ claudeSuccesses: 1 }), {
            requiredHostClasses: ['chatgpt', 'claude'],
        });
        assert.equal(bothObserved.sharedEvidence.sufficient, true);
    });
});
