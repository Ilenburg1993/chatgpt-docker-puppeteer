// @ts-check
/**
 * Terminal adapter for model-gateway runtime automation.
 *
 * The model-gateway automation core is pure and terminal-agnostic. This adapter owns the terminal-specific bridge:
 * command arguments, live SDK session inventory and the JSON catalog snapshot used by the operator command.
 *
 * @module copilot/terminal/byok/gateway-auto
 */

import {
    auditModelGatewayPostRuntimeSelection,
    auditModelGatewayPreRuntimeSelection,
    buildModelGatewayRuntimeAutomationDecision,
    buildModelGatewayRuntimeAutomationControllerStep,
    buildModelGatewayRuntimeSelectorPlan,
    compareModelGatewaySelectionAudits,
    createEnvSecretRegistry,
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    listByokProviderModelHealth,
    readModelGatewayRuntimeAutomationPolicy,
    resolveModelGatewaySelectionPolicy,
} from '#copilot/model-gateway';

import { listTerminalSdkSessionInventory } from '../frontend/index.js';

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalScalarString(value) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return null;
}

/**
 * @param {string[]} rest
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {{ profileId: string; allowLiveSetModel: boolean; allowNewSession: boolean; allowLocalPrivate: boolean }}
 */
export function parseTerminalByokGatewayAutoArgs(rest, options = {}) {
    const policy = readModelGatewayRuntimeAutomationPolicy(options.env);
    const profileToken = rest.find((item) => /^(?:profile|perfil|routeProfile|route-profile)[:=]/iu.test(item));
    const profileId =
        optionalScalarString(profileToken?.replace(/^(?:profile|perfil|routeProfile|route-profile)[:=]/iu, '')) ??
        policy.profiles[0] ??
        optionalScalarString(rest.find((item) => !/^(auto|status|plan|apply|on|off|--|allow-|live-|new-session|local)/iu.test(item))) ??
        'repo_agent';
    return {
        profileId,
        allowLiveSetModel:
            policy.allowLiveSetModel || rest.some((item) => /^(?:--)?allow-live-set-model|live-set-model|set-model$/iu.test(item)),
        allowNewSession: policy.allowNewSession || rest.some((item) => /^(?:--)?allow-new-session|new-session$/iu.test(item)),
        allowLocalPrivate: policy.allowLocalPrivate || rest.some((item) => /^(?:--)?allow-local-private|local-private|ollama$/iu.test(item)),
    };
}

/**
 * @param {string[]} rest
 * @param {{ allowEffects?: boolean; catalogPath?: string; env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<{
 *     schema: 'terminal-byok-gateway-auto-status';
 *     args: ReturnType<typeof parseTerminalByokGatewayAutoArgs>;
 *     runtimeSelectorPlan: ReturnType<typeof buildModelGatewayRuntimeSelectorPlan>;
 *     inventory: Awaited<ReturnType<typeof listTerminalSdkSessionInventory>>;
 *     decision: ReturnType<typeof buildModelGatewayRuntimeAutomationDecision>;
 *     controllerStep: ReturnType<typeof buildModelGatewayRuntimeAutomationControllerStep>;
 * }>}
 */
export async function buildTerminalByokGatewayAutoStatus(rest, options = {}) {
    const args = parseTerminalByokGatewayAutoArgs(rest, { env: options.env });
    const store = new JsonModelGatewayCatalogStore({ filePath: options.catalogPath ?? DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const snapshot = await store.readSnapshot();
    const secretRegistry = createEnvSecretRegistry(options.env);
    const healthRecords = listByokProviderModelHealth();
    const selection = auditModelGatewayPreRuntimeSelection(snapshot, {
        profiles: [args.profileId],
        secretRegistry,
    });
    const postRuntimeSelection = auditModelGatewayPostRuntimeSelection(snapshot, {
        profiles: [args.profileId],
        secretRegistry,
        runtimeHealthRecords: healthRecords,
    });
    const comparison = compareModelGatewaySelectionAudits(selection, postRuntimeSelection);
    const policyResolution = resolveModelGatewaySelectionPolicy(comparison, { mode: 'prefer_runtime_proved' });
    const runtimeSelectorPlan = buildModelGatewayRuntimeSelectorPlan(policyResolution, {
        source: 'terminal-byok-auto-status',
        runtimeHealthRecords: healthRecords,
    });
    const inventory = await listTerminalSdkSessionInventory();
    const decision = buildModelGatewayRuntimeAutomationDecision({
        runtimeSelectorPlan,
        profileId: args.profileId,
        currentSessionId: inventory.currentSessionId,
        liveByokBinding: inventory.persistedByokBinding,
        policy: {
            allowLiveSetModel: args.allowLiveSetModel,
            allowNewSession: args.allowNewSession,
            allowLocalPrivate: args.allowLocalPrivate,
        },
    });
    const controllerStep = buildModelGatewayRuntimeAutomationControllerStep({
        phase: 'manual',
        decision,
        policy: {
            allowEffects: options.allowEffects === true,
            allowLiveSetModel: args.allowLiveSetModel,
            allowNewSession: args.allowNewSession,
        },
    });
    return {
        schema: 'terminal-byok-gateway-auto-status',
        args,
        runtimeSelectorPlan,
        inventory,
        decision,
        controllerStep,
    };
}
