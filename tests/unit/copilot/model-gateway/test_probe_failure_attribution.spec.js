// @ts-check

import { describe, expect, it, vi } from 'vitest';

import {
    classifyConfiguredByokProbeFailureScope,
    didConfiguredByokProbeAttemptProvider,
    runConfiguredByokAgentProbe,
    runConfiguredByokChatProbe,
} from '../../../../src/copilot/model-gateway/probes/index.js';
import { executeModelGatewayProbe } from '../../../../src/copilot/model-gateway/control-plane/probe-execution.js';
import { classifyByokProviderFailure } from '../../../../src/copilot/model-gateway/health/provider-failure.js';
import {
    executeModelGatewayRuntimeSelectorPlan,
    executeModelGatewayRuntimeSelectorPlanWithFallbacks,
    resolveModelGatewayRuntimeRetryDecision,
} from '../../../../src/copilot/model-gateway/routing/runtime-selector.js';
import {
    createProbeSessionRuntime,
    createReadyByokProbeFixture,
} from './helpers/probe-fixtures.js';

const TEST_MODEL = 'unit/model';

/** @typedef {NonNullable<NonNullable<Parameters<typeof runConfiguredByokAgentProbe>[0]>['deps']>} ConfiguredProbeDeps */
/** @typedef {NonNullable<NonNullable<Parameters<typeof executeModelGatewayProbe>[0]>['deps']>} ProbeExecutionDeps */
/** @typedef {Parameters<typeof executeModelGatewayRuntimeSelectorPlan>[0]} RuntimeSelectorPlan */
/** @typedef {RuntimeSelectorPlan['routes'][number]} RuntimeSelectorRoute */

function readyProbeFixture() {
    return createReadyByokProbeFixture({ model: TEST_MODEL, profile: 'repo_agent' });
}

/**
 * @param {Partial<ConfiguredProbeDeps>} [overrides]
 * @returns {ConfiguredProbeDeps}
 */
function commonProbeDeps(overrides = {}) {
    const fixture = readyProbeFixture();
    /** @type {ConfiguredProbeDeps} */
    const base = {
        readConfiguredByokState: () => fixture.state,
        resolveConfiguredByokSessionOverrides: () => fixture.overrides,
        evaluateAdmission: () => ({ shouldBlock: false, label: 'allowed' }),
        sessionRuntime: createProbeSessionRuntime(),
    };
    return { ...base, ...overrides };
}

function selectorRoute(/** @type {string} */ profileId, /** @type {string} */ providerId, /** @type {string} */ providerModel) {
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

function selectorPlan(/** @type {RuntimeSelectorRoute[]} */ routes) {
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
                sessionRuntime: createProbeSessionRuntime({
                    async withSession() {
                        throw new Error(
                            'Authentication failed: Failed to validate SDK token (503): No server is currently available',
                        );
                    },
                }),
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
        const classifyProviderFailure = vi.fn(classifyByokProviderFailure);
        const session = { sessionId: 'unit-chat-session' };
        const abort = vi.fn(async () => {});
        const result = await runConfiguredByokChatProbe({
            deps: commonProbeDeps({
                sessionRuntime: createProbeSessionRuntime({
                    async withSession(_options, callback) {
                        await callback({ session, sessionId: session.sessionId });
                    },
                    async sendAndWait() {
                        throw Object.assign(new Error('provider rate limit'), { status: 429 });
                    },
                    abort,
                }),
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
                sessionRuntime: createProbeSessionRuntime({
                    async withSession() {
                        throw new Error('SDK session bootstrap unavailable');
                    },
                }),
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
        /** @type {Parameters<NonNullable<ProbeExecutionDeps['sqliteStore']>['writeRuntimeProbeRun']>[0][]} */
        const writes = [];
        /** @type {Map<string, Record<string, unknown>>} */
        const records = new Map();
        /** @type {NonNullable<ProbeExecutionDeps['sqliteStore']>} */
        const sqliteStore = {
            readRuntimeProbeRunRecord: async (runId) => records.get(runId) ?? null,
            writeRuntimeProbeRun: async (input) => {
                writes.push(input);
                const runId = input.runId ?? `unit-probe-run-${writes.length}`;
                const results = input.results ?? [];
                const successCount = results.filter((entry) => entry['ok'] === true).length;
                const failureCount = results.filter((entry) => entry['ok'] !== true).length;
                records.set(runId, {
                    ...input,
                    runId,
                    successCount,
                    failureCount,
                    skippedCount: input.skippedCount ?? 0,
                    results,
                });
                return {
                    runId,
                    probeResults: results.length,
                    skippedResults: input.skippedCount ?? 0,
                    successCount,
                    failureCount,
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
            deps: {
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
            },
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
        const firstWrite = writes[0];
        expect(firstWrite).toBeDefined();
        if (!firstWrite) throw new Error('expected one persisted probe write');
        expect(firstWrite.payload).toMatchObject({
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
            deps: { sqliteStore },
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
        expect(executed.probe).not.toBeNull();
        expect(replay.probe).toMatchObject({
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
            sessionId: null,
            errors: ['shared SDK bootstrap unavailable'],
            warnings: [],
            providerFailure: null,
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
            deps: {
                runChatProbe: async () => {
                    throw new Error('shared SDK bootstrap failed');
                },
                recordFailure,
                flushHealth,
                recordRouteDecision,
            },
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
            deps: {
                runChatProbe,
                recordRouteDecision: (event) => event,
            },
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
