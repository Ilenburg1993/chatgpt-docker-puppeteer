// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    auditModelGatewayPostRuntimeSelection,
    auditModelGatewayPreRuntimeSelection,
    auditPreparedModelGatewayPostRuntimeSelection,
    auditPreparedModelGatewayPreRuntimeSelection,
    createCanonicalModelProjection,
    createModelRouteOption,
    createProviderAccountOverlay,
    prepareModelGatewayCatalogRoutingSnapshot,
} from '#copilot/model-gateway';

function fixtureSnapshot() {
    return {
        projections: [
            createCanonicalModelProjection({
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                capabilities: { streaming: true, tools: true, reasoningEffort: true },
                limits: { contextWindowTokens: 131_072 },
                pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
                routingHints: { tier: 'free' },
            }),
        ],
        routeOptions: [
            createModelRouteOption({
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                selectorKind: 'provider_explicit',
                selectorSyntax: 'openai/gpt-oss-120b:groq',
                normalizedPolicy: {
                    routeLayer: 'openai_compatible_aggregator',
                    wireApi: 'openai_chat_completions',
                },
                providerSpecific: { upstreamProvider: 'groq' },
            }),
        ],
        accountOverlays: [
            createProviderAccountOverlay({
                providerId: 'openrouter',
                secretRef: 'OPENROUTER_API_KEY',
                enabledModels: ['openai/gpt-oss-120b'],
            }),
        ],
    };
}

const SECRET_REGISTRY = Object.freeze({ has: () => true });
const RUNTIME_HEALTH = Object.freeze([
    Object.freeze({
        routeProfile: 'repo_agent',
        providerId: 'openrouter',
        providerModel: 'openai/gpt-oss-120b',
        lastStatus: 'ok',
        lastSuccessAt: 100,
        agentProbeStatus: 'ok',
        lastAgentProbeSuccessAt: 110,
        probes: Object.freeze({
            agent: Object.freeze({ status: 'ok', ok: true, providerAttempted: true, lastAt: 110 }),
        }),
    }),
]);

describe('Model Gateway prepared selection audits', () => {
    it('is byte-for-byte equivalent to snapshot preparation for pre-runtime selection', () => {
        const snapshot = fixtureSnapshot();
        const options = {
            profiles: ['repo_agent', 'tool_agent'],
            secretRegistry: SECRET_REGISTRY,
        };
        const expected = auditModelGatewayPreRuntimeSelection(snapshot, options);
        const prepared = prepareModelGatewayCatalogRoutingSnapshot(snapshot);
        const actual = auditPreparedModelGatewayPreRuntimeSelection(prepared, options);
        assert.deepEqual(actual, expected);
    });

    it('is byte-for-byte equivalent with runtime-health overlays', () => {
        const snapshot = fixtureSnapshot();
        const options = {
            profiles: ['repo_agent'],
            secretRegistry: SECRET_REGISTRY,
            runtimeHealthRecords: [...RUNTIME_HEALTH],
            now: 120,
        };
        const expected = auditModelGatewayPostRuntimeSelection(snapshot, options);
        const prepared = prepareModelGatewayCatalogRoutingSnapshot(snapshot);
        const actual = auditPreparedModelGatewayPostRuntimeSelection(prepared, options);
        assert.deepEqual(actual, expected);
        assert.equal(actual.summary.runtimeHealthProofCount, 1);
    });
});
