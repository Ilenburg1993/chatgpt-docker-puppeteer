// @ts-check
/**
 * Same-session route/provider switching facade.
 *
 * The lifecycle reattach callback is injected by the AlwaysAliveAgent root so this facade remains independent from
 * terminal and presentation layers.
 *
 * @module copilot/agent/facades/agent-route-config
 */

import {
    applyModelGatewayBindingStrategy,
    defaultModelGatewayIngressRouteRegistry,
    evaluateLiveRouteSwitchCapability,
    executeModelGatewayRuntimeRouteSwitch,
    readModelGatewayDirectRebindEvidence,
} from '#copilot/model-gateway';
import {
    persistAgentRuntimeStatePartial,
    readAgentRuntimePersistedStateSync,
} from './agent-runtime-state.js';

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}

/**
 * @param {unknown} value
 * @param {string} field
 */
function routeUrl(value, field) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string' || value.length > 2_048) throw new Error(`MODEL_GATEWAY_ROUTE_${field}_INVALID`);
    const trimmed = value.trim();
    if (!trimmed) return null;
    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error(`MODEL_GATEWAY_ROUTE_${field}_INVALID`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error(`MODEL_GATEWAY_ROUTE_${field}_UNSAFE`);
    }
    return trimmed;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} maxLength
 */
function routeText(value, field, maxLength) {
    if (value === null || value === undefined || value === '') return null;
    const hasControlCharacter =
        typeof value === 'string' && [...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127);
    if (typeof value !== 'string' || value.length > maxLength || hasControlCharacter) {
        throw new Error(`MODEL_GATEWAY_ROUTE_${field}_INVALID`);
    }
    return value.trim() || null;
}

/**
 * @param {unknown} value
 * @returns {'direct' | 'ingress' | 'blocked' | null}
 */
function routeBindingStrategy(value) {
    const strategy = routeText(value, 'BINDING_STRATEGY', 80);
    if (strategy === null || strategy === 'direct' || strategy === 'ingress' || strategy === 'blocked') {
        return strategy;
    }
    if (strategy === 'auto') return null;
    throw new Error('MODEL_GATEWAY_ROUTE_BINDING_STRATEGY_INVALID');
}

/**
 * @param {Record<string, unknown>} route
 */
function normalizedRoute(route) {
    const providerId = routeText(route['providerId'], 'PROVIDER_ID', 160);
    const providerModel =
        routeText(route['providerModel'], 'PROVIDER_MODEL', 300) ??
        routeText(route['selectorSyntax'], 'SELECTOR_SYNTAX', 300);
    if (!providerId || !/^[A-Za-z0-9._:-]+$/u.test(providerId)) {
        throw new Error('MODEL_GATEWAY_ROUTE_PROVIDER_ID_INVALID');
    }
    if (!providerModel) throw new Error('MODEL_GATEWAY_ROUTE_PROVIDER_MODEL_INVALID');
    return {
        providerId,
        providerModel,
        providerType: routeText(route['providerType'], 'PROVIDER_TYPE', 80),
        selectorSyntax: routeText(route['selectorSyntax'], 'SELECTOR_SYNTAX', 300),
        bindingStrategy: routeBindingStrategy(route['bindingStrategy']),
        sdkRouteKey: routeText(route['sdkRouteKey'], 'SDK_ROUTE_KEY', 240),
        sdkVisibleModel: routeText(route['sdkVisibleModel'], 'SDK_VISIBLE_MODEL', 300),
        useIngress: route['useIngress'] === true,
        requiresIngress: route['requiresIngress'] === true,
        modelGatewayIngress: route['modelGatewayIngress'] === true,
        baseUrl: routeUrl(route['baseUrl'], 'BASE_URL'),
        openAICompatibleBaseUrl: routeUrl(route['openAICompatibleBaseUrl'], 'OPENAI_BASE_URL'),
        openAICompatible: route['openAICompatible'] === true,
        wireApi: routeText(route['wireApi'], 'WIRE_API', 100),
        directRebindReliability: routeText(route['directRebindReliability'], 'DIRECT_REBIND_RELIABILITY', 80),
        directRebindSupported:
            typeof route['directRebindSupported'] === 'boolean' ? route['directRebindSupported'] : null,
        directRebindReliable:
            typeof route['directRebindReliable'] === 'boolean' ? route['directRebindReliable'] : null,
        directConfigRepresentability: routeText(
            route['directConfigRepresentability'],
            'DIRECT_CONFIG_REPRESENTABILITY',
            80,
        ),
        requiredDirectHeaders: Array.isArray(route['requiredDirectHeaders'])
            ? route['requiredDirectHeaders'].map(String)
            : [],
        bindingCapabilities:
            Object.keys(record(route['bindingCapabilities'])).length > 0 ? record(route['bindingCapabilities']) : null,
        bindingDecision:
            Object.keys(record(route['bindingDecision'])).length > 0 ? record(route['bindingDecision']) : null,
        runtimeEvidence:
            Object.keys(record(route['runtimeEvidence'])).length > 0 ? record(route['runtimeEvidence']) : null,
        providerProfile: routeText(route['providerProfile'], 'PROVIDER_PROFILE', 160),
        routeProfile: routeText(route['routeProfile'], 'ROUTE_PROFILE', 100),
        selectedRouteKey: routeText(route['selectedRouteKey'], 'SELECTED_ROUTE_KEY', 400),
    };
}

/**
 * @param {Record<string, unknown>} route
 */
function persistentRoute(route) {
    return {
        ...normalizedRoute(route),
        updatedAt: Date.now(),
    };
}

/**
 * @param {Record<string, unknown>} left
 * @param {Record<string, unknown>} right
 * @returns {boolean}
 */
function sameRouteIdentity(left, right) {
    return (
        String(left['providerId'] ?? '') === String(right['providerId'] ?? '') &&
        String(left['providerModel'] ?? left['selectorSyntax'] ?? '') ===
            String(right['providerModel'] ?? right['selectorSyntax'] ?? '') &&
        String(left['sdkRouteKey'] ?? '') === String(right['sdkRouteKey'] ?? '')
    );
}

/**
 * @param {Record<string, unknown>} route
 */
function ingressRegistryEntryForRoute(route) {
    const sdkRouteKey = typeof route['sdkRouteKey'] === 'string' ? route['sdkRouteKey'] : null;
    return sdkRouteKey ? defaultModelGatewayIngressRouteRegistry.findBySdkRouteKey(sdkRouteKey) : null;
}

/**
 * @param {ReturnType<typeof ingressRegistryEntryForRoute>} entry
 * @param {Record<string, unknown>} route
 * @returns {boolean}
 */
function ingressRegistryEntryMatchesRoute(entry, route) {
    if (!entry) return false;
    return sameRouteIdentity(
        {
            providerId: entry.ingressRoute.providerId,
            providerModel: entry.ingressRoute.providerModel,
            sdkRouteKey: entry.ingressRoute.sdkRouteKey,
        },
        route,
    );
}

/**
 * @param {import('../agent-context.js').AgentContext} ctx
 * @param {Record<string, unknown>} targetRoute
 * @param {{
 *   idempotencyKey?: string;
 *   timeoutMs?: number;
 *   source?: string;
 *   reattach: (route: Record<string, unknown>) => Promise<import('#copilot/sdk/types').CopilotSession>;
 *   allowActiveDialogLoopReattach?: boolean;
 *   forceApplyDeferred?: boolean;
 * }} options
 */
export async function switchAgentRouteTransactional(ctx, targetRoute, options) {
    const session = ctx.getSessionSnapshot();
    if (!session?.sessionId) {
        return {
            schemaVersion: 'model-gateway.same-session-route-switch.v1',
            state: 'failed',
            error: 'LIVE_SESSION_UNAVAILABLE',
            requiresNewSession: false,
        };
    }
    const persisted = readAgentRuntimePersistedStateSync();
    const previousRoute = record(persisted?.modelGatewayActiveRoute);
    const previousBinding = record(persisted?.byokSessionBinding);
    const fallbackRoute =
        Object.keys(previousRoute).length > 0
            ? previousRoute
            : {
                  providerId: String(
                      Reflect.get(session, '__copilotModelGatewayProviderId') ??
                          Reflect.get(session, '__copilotByokPreset') ??
                          'github-copilot-sdk',
                  ),
                  providerModel: ctx.getModelSnapshot(),
                  providerProfile:
                      typeof previousBinding['profile'] === 'string' ? previousBinding['profile'] : null,
                  baseUrl: typeof previousBinding['baseUrl'] === 'string' ? previousBinding['baseUrl'] : null,
              };
    const normalizedPreviousRoute = normalizedRoute(fallbackRoute);
    const normalizedTargetInput = normalizedRoute(targetRoute);
    const declaredRuntimeEvidence = record(normalizedTargetInput['runtimeEvidence']);
    /** @type {Record<string, unknown> | null} */
    let ledgerEvidence = null;
    let bindingEvidenceReadFailed = false;
    try {
        const observedEvidence = await readModelGatewayDirectRebindEvidence({
            previousProviderId: normalizedPreviousRoute.providerId,
            providerId: normalizedTargetInput.providerId,
            wireApi: normalizedTargetInput.wireApi,
        });
        if (typeof observedEvidence['sampleSize'] === 'number' && observedEvidence['sampleSize'] > 0) {
            ledgerEvidence = observedEvidence;
        }
    } catch {
        bindingEvidenceReadFailed = true;
    }
    const runtimeEvidence = {
        ...declaredRuntimeEvidence,
        ...(ledgerEvidence ?? {}),
    };
    const normalizedTargetRoute = applyModelGatewayBindingStrategy(
        {
            ...normalizedTargetInput,
            ...(Object.keys(runtimeEvidence).length > 0 ? { runtimeEvidence } : {}),
        },
        {
            currentRoute: normalizedPreviousRoute,
            sessionId: session.sessionId,
        },
    );
    const bindingDecision = record(normalizedTargetRoute['bindingDecision']);
    const bindingEvidenceWarnings = bindingEvidenceReadFailed ? ['direct_rebind_evidence_unavailable'] : [];
    if (normalizedTargetRoute['bindingStrategy'] === 'blocked') {
        return {
            schemaVersion: 'model-gateway.same-session-route-switch.v1',
            state: 'failed',
            sessionId: session.sessionId,
            error: 'MODEL_GATEWAY_BINDING_STRATEGY_BLOCKED',
            bindingDecision,
            warnings: bindingEvidenceWarnings,
            requiresNewSession: false,
            nextActions: Array.isArray(bindingDecision['nextActions'])
                ? bindingDecision['nextActions'].map(String)
                : ['review_binding_strategy'],
        };
    }
    const capability = evaluateLiveRouteSwitchCapability({
        currentProviderId: normalizedPreviousRoute.providerId,
        targetProviderId: String(normalizedTargetRoute['providerId']),
        sessionAvailable: true,
        modelSwitchAvailable:
            typeof Reflect.get(session, 'setModel') === 'function' ||
            typeof Reflect.get(session, 'switchModel') === 'function',
        providerRebindAvailable: false,
        sameSessionReattachAvailable: typeof options.reattach === 'function',
    });
    if (!capability.supported) {
        return {
            schemaVersion: 'model-gateway.same-session-route-switch.v1',
            state: 'failed',
            sessionId: session.sessionId,
            error: capability.reason,
            capability,
            warnings: bindingEvidenceWarnings,
            requiresNewSession: false,
        };
    }
    const activeDialogLoop = typeof ctx.isDialogLoopActive === 'function' ? ctx.isDialogLoopActive() : false;
    const deferDuringActiveDialogLoop = activeDialogLoop && options.allowActiveDialogLoopReattach !== true;
    const previousUsesIngress = normalizedPreviousRoute.bindingStrategy === 'ingress';
    const targetUsesIngress = normalizedTargetRoute['bindingStrategy'] === 'ingress';
    const previousIngressRegistryEntryBefore = previousUsesIngress
        ? ingressRegistryEntryForRoute(normalizedPreviousRoute)
        : null;
    const operation = await executeModelGatewayRuntimeRouteSwitch({
        sessionId: session.sessionId,
        previousRoute: normalizedPreviousRoute,
        targetRoute: normalizedTargetRoute,
        ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.source ? { source: options.source } : {}),
        ...(options.forceApplyDeferred ? { forceApplyDeferred: true } : {}),
        ...(deferDuringActiveDialogLoop
            ? {
                  deferReason: 'ACTIVE_DIALOG_LOOP_ROUTE_REATTACH_DEFERRED',
                  deferDetails: {
                      dialogLoopActive: true,
                      sameSessionRequired: true,
                      requiresNewSession: false,
                      safeContinuation: 'finish_current_turn_then_agent_restarts_transport_and_reattaches_same_session_id',
                      promotionAuthorization: {
                          authorized: options.source === 'llm-b.model_gateway_route_switch',
                          policy:
                              options.source === 'llm-b.model_gateway_route_switch'
                                  ? 'authorized_after_turn_boundary'
                                  : 'manual_review',
                          source:
                              options.source === 'llm-b.model_gateway_route_switch'
                                  ? 'confirmed_model_gateway_route_switch_apply'
                                  : 'unconfirmed_or_unknown_route_switch_source',
                          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
                      },
                      rationale:
                          'Provider reattach during the active SDK tool turn can orphan the tool response; no route mutation was attempted.',
                  },
              }
            : {}),
        reattach: async (route) => {
            const routeState = persistentRoute(route);
            const persistedRoute = await persistAgentRuntimeStatePartial(
                { modelGatewayActiveRoute: routeState },
                { label: 'runtime.model-gateway.route.prepare' },
            );
            if (!persistedRoute.ok) throw persistedRoute.error;
            return options.reattach(route);
        },
        verify: async (candidate, route) => {
            const live = /** @type {import('#copilot/sdk/types').CopilotSession} */ (candidate);
            const providerId = String(route['providerId'] ?? '');
            const providerModel = String(route['providerModel'] ?? route['selectorSyntax'] ?? '');
            const expectedSdkModel =
                route['bindingStrategy'] === 'ingress'
                    ? String(route['sdkVisibleModel'] ?? providerModel)
                    : providerModel;
            const nativeSdkRoute = providerId === 'github-copilot-sdk';
            const liveProvider = String(
                Reflect.get(live, '__copilotModelGatewayProviderId') ??
                    Reflect.get(live, '__copilotByokPreset') ??
                    '',
            );
            const liveModel = String(
                Reflect.get(live, '__copilotConfiguredModel') ??
                    Reflect.get(live, '__copilotEffectiveModel') ??
                    ctx.getModelSnapshot(),
            );
            return (
                live.sessionId === session.sessionId &&
                (nativeSdkRoute ? Reflect.get(live, '__copilotByokEnabled') !== true : liveProvider === providerId) &&
                liveModel === expectedSdkModel
            );
        },
        commit: async (candidate, route) => {
            const live = /** @type {import('#copilot/sdk/types').CopilotSession} */ (candidate);
            ctx.setSession(live);
            ctx.setModel(String(route['providerModel'] ?? route['selectorSyntax'] ?? ctx.getModelSnapshot()));
            const committed = await persistAgentRuntimeStatePartial(
                {
                    model: ctx.getModelSnapshot(),
                    modelGatewayActiveRoute: persistentRoute(route),
                },
                { label: 'runtime.model-gateway.route.commit' },
            );
            if (!committed.ok) throw committed.error;
        },
    });
    const operationRecord = record(operation);
    const targetIngressRegistryEntryAfter = targetUsesIngress
        ? ingressRegistryEntryForRoute(normalizedTargetRoute)
        : null;
    const rollbackIngressRegistryEntryAfter = previousUsesIngress
        ? ingressRegistryEntryForRoute(normalizedPreviousRoute)
        : null;
    const operationState = String(operationRecord['state'] ?? 'unknown');
    const operationWarnings = Array.isArray(operationRecord['warnings'])
        ? operationRecord['warnings'].map(String)
        : [];
    const registryWarnings = [];
    let registryReconciliationRequired = operationRecord['reconciliationRequired'] === true;

    if (operationState === 'committed') {
        if (targetUsesIngress) {
            const committedEntry = ingressRegistryEntryForRoute(normalizedTargetRoute);
            if (!ingressRegistryEntryMatchesRoute(committedEntry, normalizedTargetRoute)) {
                registryWarnings.push('committed_ingress_registry_target_not_verified');
                registryReconciliationRequired = true;
            }
        } else if (previousUsesIngress && previousIngressRegistryEntryBefore) {
            try {
                defaultModelGatewayIngressRouteRegistry.delete(
                    previousIngressRegistryEntryBefore.ingressRoute.routeId,
                    { expectedRevision: previousIngressRegistryEntryBefore.revision },
                );
            } catch {
                registryWarnings.push('previous_ingress_registry_cleanup_revision_conflict');
                registryReconciliationRequired = true;
            }
        }
    } else if (operationState === 'rolled_back') {
        if (previousUsesIngress) {
            const restoredEntry = rollbackIngressRegistryEntryAfter;
            if (!ingressRegistryEntryMatchesRoute(restoredEntry, normalizedPreviousRoute)) {
                registryWarnings.push('rolled_back_ingress_registry_target_not_verified');
                registryReconciliationRequired = true;
            }
        } else if (targetUsesIngress && targetIngressRegistryEntryAfter) {
            try {
                defaultModelGatewayIngressRouteRegistry.delete(
                    targetIngressRegistryEntryAfter.ingressRoute.routeId,
                    { expectedRevision: targetIngressRegistryEntryAfter.revision },
                );
            } catch {
                registryWarnings.push('rolled_back_ingress_registry_cleanup_revision_conflict');
                registryReconciliationRequired = true;
            }
        }
    } else if (operationState === 'failed' && targetIngressRegistryEntryAfter) {
        const rollback = record(operationRecord['rollback']);
        if (rollback['reason'] !== 'target_route_not_applied') {
            registryWarnings.push('failed_route_switch_left_ingress_target_state_uncertain');
            registryReconciliationRequired = true;
        }
    }

    return {
        ...operation,
        capability,
        reconciliationRequired: registryReconciliationRequired,
        registryReconciliation: {
            previousUsesIngress,
            targetUsesIngress,
            targetRevision: targetIngressRegistryEntryAfter?.revision ?? null,
            rollbackRevision: rollbackIngressRegistryEntryAfter?.revision ?? null,
            previousRevision: previousIngressRegistryEntryBefore?.revision ?? null,
            verified: !registryReconciliationRequired,
        },
        warnings: [
            ...new Set([
                ...operationWarnings,
                ...bindingEvidenceWarnings,
                ...registryWarnings,
            ]),
        ],
    };
}

/**
 * @param {{ switchRoute?: (route: Record<string, unknown>, options?: { idempotencyKey?: string; timeoutMs?: number; source?: string; allowActiveDialogLoopReattach?: boolean; forceApplyDeferred?: boolean }) => Promise<Record<string, unknown>> }} runtime
 * @param {Record<string, unknown>} route
 * @param {{ idempotencyKey?: string; timeoutMs?: number; source?: string; allowActiveDialogLoopReattach?: boolean; forceApplyDeferred?: boolean }} [options]
 */
export function switchRuntimeRouteTransactional(runtime, route, options = {}) {
    if (typeof runtime.switchRoute !== 'function') throw new Error('AGENT_RUNTIME_ROUTE_SWITCH_UNAVAILABLE');
    return runtime.switchRoute(route, options);
}
