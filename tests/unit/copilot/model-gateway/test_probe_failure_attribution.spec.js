// @ts-check

import { describe, expect, it, vi } from 'vitest';

import {
    classifyConfiguredByokProbeFailureScope,
    didConfiguredByokProbeAttemptProvider,
    runConfiguredByokAgentProbe,
    runConfiguredByokChatProbe,
} from '../../../../src/copilot/model-gateway/probes/index.js';
import { executeModelGatewayProbe } from '../../../../src/copilot/model-gateway/control-plane/probe-execution.js';
import {
    executeModelGatewayRuntimeSelectorPlan,
    executeModelGatewayRuntimeSelectorPlanWithFallbacks,
    resolveModelGatewayRuntimeRetryDecision,
} from '../../../../src/copilot/model-gateway/routing/runtime-selector.js';

const TEST_MODEL = 'unit/model';

function readyProbeFixture() {
    const provider = { type: 'openai-compatible' };
    const summary = {
        profile: 'repo_agent',
        preset: 'openrouter',
        providerType: 'openai-compatible',
        model: TEST_MODEL,
        warnings: [],
    };
    return {
        state: {
            enabled: true,
            ready: true,
            provider,
            model: TEST_MODEL,
            summary,
            errors: [],
            warnings: [],
        },
        overrides: {
            provider,
            model: TEST_MODEL,
            modelCapabilities: null,
            summary,
        },
    };
}

function commonProbeDeps(overrides = {}) {
    const fixture = readyProbeFixture();
    return /** @type {any} */ ({
        readConfiguredByokState: () => fixture.state,
        resolveConfiguredByokSessionOverrides: () => fixture.overrides,
        evaluateAdmission: () => ({ shouldBlock: false, label: 'allowed' }),
        createPermissionHandler: () => async () => ({ kind: 'denied-by-rules' }),
        onSessionEvents: () => () => {},
        ...overrides,
    });
}

function selectorRoute(profileId, providerId, providerModel) {
    const selected = {
        id: `${providerId}:${providerModel}`,
        providerId,
        providerModel,
        routeProfile: profileId,
        score: 1,
        scoreBreakdown: {},
    };
    return /** @type {any} */ ({
        profileId,
        status: 'selected',
        source: 'unit-test',
        selected,
        selectedRouteKey: `${providerId}:${providerModel}`,
        candidateAlternatives: [],
        reasons: [],
        nextActions: [],
        decisionEvent: {
            mode: 'prefer_runtime_proved',
            source: 'unit-test',
            sessionId: 'unit-session',
        },
    });
}

function selectorPlan(routes) {
    return /** @type {any} */ ({
        schema: 'model-gateway-runtime-selector-plan',
        ok: true,
        ready: true,
        mode: 'prefer_runtime_proved',
        sourceSchema: 'unit-test',
        traceId: null,
        summary: {},
        routes,
        nextCommands: [],
    });
}

describe('configured BYOK probe failure attribution', () => {
    it('distinguishes provider, controller-substrate and preflight scopes', () => {
        expect(didConfiguredByokProbeAttemptProvider({ status: 'failed', providerAttempted: false })).toBe(false);
        expect(classifyConfiguredByokProbeFailureScope({ status: 'failed', providerAttempted: false, ok: false })).toBe(
            'controller_substrate',
        );
        expect(didConfiguredByokProbeAttemptProvider({ status: 'failed', providerAttempted: true })).toBe(true);
        expect(classifyConfiguredByokProbeFailureScope({ status: 'failed', providerAttempted: true, ok: false })).toBe(
            'provider',
        );
        expect(classifyConfiguredByokProbeFailureScope({ status: 'unavailable', ok: false })).toBe('preflight');
        expect(classifyConfiguredByokProbeFailureScope({ status: 'admission-blocked', ok: false })).toBe('preflight');
        expect(didConfiguredByokProbeAttemptProvider({ status: 'failed' })).toBe(true);
    });

    it('does not classify an SDK/session bootstrap failure as a BYOK provider failure in chat probe', async () => {
        const classifyProviderFailure = vi.fn();
        const result = await runConfiguredByokChatProbe({
            deps: commonProbeDeps({
                withEphemeralSession: async () => {
                    throw new Error(
                        'Authentication failed: Failed to validate SDK token (503): No server is currently available',
                    );
                },
                classifyProviderFailure,
            }),
        });

        expect(result).toMatchObject({
            ok: false,
            status: 'failed',
            providerAttempted: false,
            providerFailure: null,
        });
        expect(classifyProviderFailure).not.toHaveBeenCalled();
        expect(classifyConfiguredByokProbeFailureScope(result)).toBe('controller_substrate');
    });

    it('attributes a failure after sendSessionAndWait to the BYOK provider boundary', async () => {
        const classifyProviderFailure = vi.fn((error) => ({
            kind: 'rate-limit',
            statusCode: 429,
            retryAfterSeconds: 2,
            resetAt: null,
            errorContext: 'unit_provider_send',
            message: error instanceof Error ? error.message : String(error),
        }));
        const session = { sessionId: 'unit-chat-session', abort: vi.fn(async () => {}) };
        const result = await runConfiguredByokChatProbe({
            deps: commonProbeDeps({
                withEphemeralSession: async (_options, callback) => callback({ session, sessionId: session.sessionId }),
                sendSessionAndWait: async () => {
                    throw Object.assign(new Error('provider rate limit'), { status: 429 });
                },
                classifyProviderFailure,
            }),
        });

        expect(result).toMatchObject({
            ok: false,
            status: 'failed',
            providerAttempted: true,
            providerFailure: { kind: 'rate-limit', statusCode: 429 },
        });
        expect(classifyProviderFailure).toHaveBeenCalledTimes(1);
        expect(classifyConfiguredByokProbeFailureScope(result)).toBe('provider');
    });

    it('does not poison provider attribution when agent probe cannot bootstrap the shared SDK session', async () => {
        const classifyProviderFailure = vi.fn();
        const result = await runConfiguredByokAgentProbe({
            deps: commonProbeDeps({
                createStaticInputHandler: () => async () => ({ answer: 'ack' }),
                createTool: (definition) => definition,
                withEphemeralSession: async () => {
                    throw new Error('SDK session bootstrap unavailable');
                },
                classifyProviderFailure,
            }),
        });

        expect(result).toMatchObject({
            ok: false,
            status: 'failed',
            providerAttempted: false,
            providerFailure: null,
        });
        expect(classifyProviderFailure).not.toHaveBeenCalled();
        expect(classifyConfiguredByokProbeFailureScope(result)).toBe('controller_substrate');
    });

    it('persists controller-substrate scope without fabricating a provider attempt and replays it faithfully', async () => {
        const writes = [];
        const records = new Map();
        const sqliteStore = {
            readRuntimeProbeRunRecord: async (runId) => records.get(runId) ?? null,
            writeRuntimeProbeRun: async (input) => {
                writes.push(input);
                const record = {
                    ...input,
                    successCount: input.results.filter((entry) => entry.ok === true).length,
                    failureCount: input.results.filter((entry) => entry.ok !== true).length,
                    skippedCount: 0,
                };
                records.set(input.runId, record);
                return {
                    runId: input.runId,
                    probeResults: input.results.length,
                    skippedResults: 0,
                    successCount: record.successCount,
                    failureCount: record.failureCount,
                };
            },
        };
        const idempotencyKey = 'unit-controller-substrate-persistence';
        const executed = await executeModelGatewayProbe({
            kind: 'agent',
            idempotencyKey,
            identity: {
                routeProfile: 'repo_agent',
                providerId: 'openrouter',
                providerModel: TEST_MODEL,
            },
            deps: /** @type {any} */ ({
                sqliteStore,
                runProbe: async () => ({
                    ok: false,
                    status: 'failed',
                    providerAttempted: false,
                    elapsedMs: 7,
                    model: TEST_MODEL,
                    profile: 'repo_agent',
                    preset: 'openrouter',
                    providerType: 'openai-compatible',
                    deltaCount: 0,
                    deltaChars: 0,
                    finalChars: 0,
                    observedFinalEvent: false,
                    toolCallCount: 0,
                    markerToolCallCount: 0,
                    readToolCallCount: 0,
                    userInputRequestCount: 0,
                    userInputAnswerCount: 0,
                    sessionId: null,
                    errors: ['shared SDK bootstrap unavailable'],
                    warnings: [],
                    providerFailure: null,
                }),
                recordHealth: async () => false,
            }),
        });

        expect(executed).toMatchObject({
            ok: false,
            providerAttempted: false,
            failureScope: 'controller_substrate',
            result: {
                providerAttempted: false,
                failureScope: 'controller_substrate',
            },
        });
        expect(writes).toHaveLength(1);
        expect(writes[0].payload).toMatchObject({
            providerAttempted: false,
            failureScope: 'controller_substrate',
            result: {
                providerAttempted: false,
                failureScope: 'controller_substrate',
            },
        });

        const replay = await executeModelGatewayProbe({
            kind: 'agent',
            idempotencyKey,
            deps: /** @type {any} */ ({ sqliteStore }),
        });
        expect(replay).toMatchObject({
            replayed: true,
            ok: false,
            providerAttempted: false,
            failureScope: 'controller_substrate',
            result: {
                providerAttempted: false,
                failureScope: 'controller_substrate',
            },
        });
        expect(writes).toHaveLength(1);
    });
});

describe('runtime selector substrate isolation', () => {
    it('does not record provider health when the probe runner throws before returning provider-boundary evidence', async () => {
        const recordFailure = vi.fn();
        const flushHealth = vi.fn(async () => {});
        const recordRouteDecision = vi.fn();
        const plan = selectorPlan([selectorRoute('repo_agent', 'openrouter', 'unit/a')]);
        const execution = await executeModelGatewayRuntimeSelectorPlan(plan, {
            profileId: 'repo_agent',
            deps: /** @type {any} */ ({
                runChatProbe: async () => {
                    throw new Error('shared SDK bootstrap failed');
                },
                recordFailure,
                flushHealth,
                recordRouteDecision,
            }),
        });

        expect(execution).toMatchObject({
            ok: false,
            status: 'failed',
            providerFailure: null,
            failureScope: 'controller_substrate',
            healthRecorded: false,
            error: 'shared SDK bootstrap failed',
        });
        expect(recordFailure).not.toHaveBeenCalled();
        expect(flushHealth).not.toHaveBeenCalled();
        expect(recordRouteDecision).toHaveBeenCalled();
        expect(resolveModelGatewayRuntimeRetryDecision(execution)).toMatchObject({
            retryRoute: false,
            fallbackRoute: false,
            reason: 'controller_substrate_failure',
        });
    });

    it('stops the fallback chain after one controller-substrate failure instead of cycling providers', async () => {
        const runChatProbe = vi.fn(async () => {
            throw new Error('shared SDK bootstrap failed');
        });
        const plan = selectorPlan([
            selectorRoute('repo_agent', 'openrouter', 'unit/a'),
            selectorRoute('tool_agent', 'groq', 'unit/b'),
        ]);
        const execution = await executeModelGatewayRuntimeSelectorPlanWithFallbacks(plan, {
            profileId: 'repo_agent',
            fallbackProfileIds: ['tool_agent'],
            maxAttempts: 8,
            deps: /** @type {any} */ ({
                runChatProbe,
                recordRouteDecision: () => {},
            }),
        });

        expect(execution.ok).toBe(false);
        expect(execution.attemptedCount).toBe(1);
        expect(execution.retryDecisions).toHaveLength(1);
        expect(execution.retryDecisions[0]).toMatchObject({
            retryRoute: false,
            fallbackRoute: false,
            reason: 'controller_substrate_failure',
        });
        expect(runChatProbe).toHaveBeenCalledTimes(1);
    });
});
