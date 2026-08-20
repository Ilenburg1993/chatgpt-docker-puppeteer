// @ts-check

import { execFile } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
    MODEL_GATEWAY_CONTROLLER_SELECTION_STATUS,
    MODEL_GATEWAY_CONTROLLER_SUBSTRATES,
    buildModelGatewayControllerSelectionPlan,
    resolveModelGatewayNativeControllerSelection,
} from '../../../../src/copilot/model-gateway/controller/index.js';

/**
 * @param {string} id
 * @param {{ contextWindow?: number; reasoning?: boolean; vision?: boolean; multiplier?: number }} [options]
 */
function sdkModel(id, { contextWindow = 128_000, reasoning = true, vision = false, multiplier = 1 } = {}) {
    return {
        id,
        name: id,
        capabilities: {
            supports: { reasoningEffort: reasoning, vision },
            limits: { max_context_window_tokens: contextWindow },
        },
        policy: { state: 'enabled', terms: '' },
        billing: { multiplier },
        supportedReasoningEfforts: reasoning ? ['low', 'medium', 'high'] : [],
    };
}

/**
 * @param {number} remainingPercentage
 * @param {Partial<{ remainingPercentage: number; isUnlimitedEntitlement: boolean; usageAllowedWithExhaustedQuota: boolean; overageAllowedWithExhaustedQuota: boolean }>} [overrides]
 */
function sdkQuota(remainingPercentage, overrides = {}) {
    return {
        quotaSnapshots: {
            premium: {
                remainingPercentage,
                isUnlimitedEntitlement: false,
                usageAllowedWithExhaustedQuota: false,
                overageAllowedWithExhaustedQuota: false,
                ...overrides,
            },
        },
    };
}

function byokRoute({ providerId = 'zai', providerModel = 'glm-controller', successAt = 900, score = 100 } = {}) {
    return {
        providerId,
        providerModel,
        routeProfile: 'repo_agent',
        score,
        runtimeHealth: {
            agentProbeStatus: 'ok',
            lastAgentProbeSuccessAt: successAt,
            probes: {
                agent: { kind: 'agent', status: 'ok', ok: true, providerAttempted: true, lastAt: successAt },
            },
        },
    };
}

describe('Model Gateway controller selection plane', () => {
    it('selects among live native models instead of pinning gpt-5-mini', () => {
        const plan = buildModelGatewayControllerSelectionPlan({
            sdkModels: [
                sdkModel('gpt-5-mini', { contextWindow: 128_000, multiplier: 1 }),
                sdkModel('quality-native', { contextWindow: 400_000, multiplier: 1.5 }),
            ],
            sdkQuota: sdkQuota(0.8),
        });

        expect(plan.status).toBe(MODEL_GATEWAY_CONTROLLER_SELECTION_STATUS.NATIVE_READY);
        expect(plan.selected).toMatchObject({
            substrate: MODEL_GATEWAY_CONTROLLER_SUBSTRATES.COPILOT,
            modelId: 'quality-native',
        });
        expect(plan.ready).toBe(true);
    });

    it('increases cost pressure under critical native quota without hard-blocking the substrate', () => {
        const plan = buildModelGatewayControllerSelectionPlan({
            sdkModels: [
                sdkModel('premium-native', { contextWindow: 400_000, multiplier: 3 }),
                sdkModel('efficient-native', { contextWindow: 256_000, multiplier: 0 }),
            ],
            sdkQuota: sdkQuota(0.04),
        });

        expect(plan.status).toBe(MODEL_GATEWAY_CONTROLLER_SELECTION_STATUS.NATIVE_READY);
        expect(plan.nativeBlockedByQuota).toBe(false);
        expect(plan.selected).not.toBeNull();
        expect(plan.selected?.substrate).toBe(MODEL_GATEWAY_CONTROLLER_SUBSTRATES.COPILOT);
        expect(plan.selected && 'modelId' in plan.selected ? plan.selected.modelId : null).toBe('efficient-native');
        expect(plan.reasons).toContain('quota_pressure_cost_weight_increased');
    });

    it('blocks the Copilot substrate on hard quota exhaustion and falls back only to fresh BYOK agent proof', () => {
        const plan = buildModelGatewayControllerSelectionPlan({
            sdkModels: [sdkModel('gpt-5-mini')],
            sdkQuota: sdkQuota(0),
            byokRoutes: [byokRoute({ successAt: 900 })],
            now: 1_000,
            maxAgentProofAgeMs: 500,
        });

        expect(plan.nativeBlockedByQuota).toBe(true);
        expect(plan.status).toBe(MODEL_GATEWAY_CONTROLLER_SELECTION_STATUS.BYOK_FALLBACK_READY);
        expect(plan.selected).toMatchObject({
            substrate: MODEL_GATEWAY_CONTROLLER_SUBSTRATES.BYOK,
            providerId: 'zai',
            providerModel: 'glm-controller',
            eligible: true,
        });
        expect(plan.requiresNewSession).toBe(true);
    });

    it('refuses stale BYOK proof when native quota is exhausted', () => {
        const plan = buildModelGatewayControllerSelectionPlan({
            sdkModels: [sdkModel('gpt-5-mini')],
            sdkQuota: sdkQuota(0),
            byokRoutes: [byokRoute({ successAt: 100 })],
            now: 1_000,
            maxAgentProofAgeMs: 200,
            allowOpaqueSdkAutoFallback: true,
        });

        expect(plan.status).toBe(MODEL_GATEWAY_CONTROLLER_SELECTION_STATUS.BLOCKED);
        expect(plan.ready).toBe(false);
        expect(plan.selected).toBeNull();
        expect(plan.byokCandidates[0]).toMatchObject({ eligible: false });
        expect(plan.reasons).toContain('native_copilot_quota_blocked');
    });

    it('uses opaque SDK auto only as an explicit compatibility fallback', () => {
        const denied = buildModelGatewayControllerSelectionPlan({ sdkModels: [], sdkQuota: {} });
        expect(denied.status).toBe(MODEL_GATEWAY_CONTROLLER_SELECTION_STATUS.BLOCKED);

        const allowed = buildModelGatewayControllerSelectionPlan({
            sdkModels: [],
            sdkQuota: {},
            allowOpaqueSdkAutoFallback: true,
        });
        expect(allowed.status).toBe(MODEL_GATEWAY_CONTROLLER_SELECTION_STATUS.COMPATIBILITY_AUTO);
        expect(allowed.selected).toEqual({
            substrate: MODEL_GATEWAY_CONTROLLER_SUBSTRATES.COPILOT,
            modelId: 'auto',
            opaque: true,
        });
    });

    it('respects SDK policy-disabled native models', () => {
        const disabled = sdkModel('disabled-native');
        disabled.policy.state = 'disabled';
        const plan = buildModelGatewayControllerSelectionPlan({
            sdkModels: [disabled],
            sdkQuota: sdkQuota(0.9),
        });

        expect(plan.status).toBe(MODEL_GATEWAY_CONTROLLER_SELECTION_STATUS.BLOCKED);
        expect(plan.nativeCandidates[0]).toMatchObject({
            modelId: 'disabled-native',
            eligible: false,
            rejectedReasons: ['policy:disabled'],
        });
    });
});

describe('Model Gateway native controller runtime adapter', () => {
    it('inspects account-visible SDK models/quota with a short-lived client and always stops it', async () => {
        let stopCalls = 0;
        const client = {
            listModels: async () => [
                sdkModel('native-efficient', { contextWindow: 256_000, multiplier: 0 }),
                sdkModel('native-quality', { contextWindow: 400_000, multiplier: 1 }),
            ],
        };
        const result = await resolveModelGatewayNativeControllerSelection({
            deps: {
                createInspectionSession: () => ({
                    connect: async () => {},
                    listModels: client.listModels,
                    readQuota: async () => sdkQuota(0.8),
                    close: async () => {
                        stopCalls += 1;
                        return 0;
                    },
                }),
            },
        });

        expect(stopCalls).toBe(1);
        expect(result.status).toBe(MODEL_GATEWAY_CONTROLLER_SELECTION_STATUS.NATIVE_READY);
        expect(result.selected).toMatchObject({
            substrate: MODEL_GATEWAY_CONTROLLER_SUBSTRATES.COPILOT,
            modelId: 'native-quality',
        });
        expect(result.inspection).toMatchObject({
            clientConnected: true,
            modelCount: 2,
            quotaRead: true,
            connectionError: null,
            modelListError: null,
            quotaError: null,
            cleanupErrorCount: 0,
        });
    });

    it('never authorizes opaque auto when the SDK client itself cannot connect', async () => {
        let stopCalls = 0;
        const result = await resolveModelGatewayNativeControllerSelection({
            allowOpaqueSdkAutoFallback: true,
            deps: {
                createInspectionSession: () => ({
                    connect: async () => {
                        throw new Error('sdk upstream unavailable');
                    },
                    listModels: async () => [],
                    readQuota: async () => sdkQuota(0.9),
                    close: async () => {
                        stopCalls += 1;
                        return 0;
                    },
                }),
            },
        });

        expect(stopCalls).toBe(1);
        expect(result.status).toBe(MODEL_GATEWAY_CONTROLLER_SELECTION_STATUS.BLOCKED);
        expect(result.selected).toBeNull();
        expect(result.inspection).toMatchObject({
            clientConnected: false,
            modelCount: 0,
            quotaRead: false,
            connectionError: 'sdk upstream unavailable',
            cleanupErrorCount: 0,
        });
    });

    it('permits explicit opaque auto only after SDK connection succeeds but model catalog is unavailable', async () => {
        const result = await resolveModelGatewayNativeControllerSelection({
            allowOpaqueSdkAutoFallback: true,
            deps: {
                createInspectionSession: () => ({
                    connect: async () => {},
                    listModels: async () => {
                        throw new Error('catalog unavailable');
                    },
                    readQuota: async () => sdkQuota(0.75),
                    close: async () => 1,
                }),
            },
        });

        expect(result.status).toBe(MODEL_GATEWAY_CONTROLLER_SELECTION_STATUS.COMPATIBILITY_AUTO);
        expect(result.selected).toEqual({
            substrate: MODEL_GATEWAY_CONTROLLER_SUBSTRATES.COPILOT,
            modelId: 'auto',
            opaque: true,
        });
        expect(result.inspection).toMatchObject({
            clientConnected: true,
            modelCount: 0,
            quotaRead: true,
            modelListError: 'catalog unavailable',
            cleanupErrorCount: 1,
        });
    });

    it('keeps the top-level Model Gateway barrel import process-exitable without eagerly booting the Copilot SDK client', async () => {
        const result = await new Promise((resolve, reject) => {
            execFile(
                process.execPath,
                [
                    '--input-type=module',
                    '--eval',
                    "await import('./src/copilot/model-gateway/index.js'); process.stdout.write('MODEL_GATEWAY_IMPORT_OK\\n');",
                ],
                { cwd: process.cwd(), timeout: 8_000, maxBuffer: 1024 * 1024 },
                (error, stdout, stderr) => {
                    if (error) {
                        reject(Object.assign(error, { stdout, stderr }));
                        return;
                    }
                    resolve({ stdout, stderr });
                },
            );
        });

        expect(result).toMatchObject({ stdout: 'MODEL_GATEWAY_IMPORT_OK\n' });
        expect(result.stderr).toBe('');
    }, 10_000);
});
