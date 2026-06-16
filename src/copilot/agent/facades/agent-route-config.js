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
    evaluateLiveRouteSwitchCapability,
    executeModelGatewayRuntimeRouteSwitch,
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
        selectorSyntax: routeText(route['selectorSyntax'], 'SELECTOR_SYNTAX', 300),
        bindingStrategy: routeText(route['bindingStrategy'], 'BINDING_STRATEGY', 80),
        sdkRouteKey: routeText(route['sdkRouteKey'], 'SDK_ROUTE_KEY', 240),
        sdkVisibleModel: routeText(route['sdkVisibleModel'], 'SDK_VISIBLE_MODEL', 300),
        useIngress: route['useIngress'] === true,
        requiresIngress: route['requiresIngress'] === true,
        modelGatewayIngress: route['modelGatewayIngress'] === true,
        baseUrl: routeUrl(route['baseUrl'], 'BASE_URL'),
        openAICompatibleBaseUrl: routeUrl(route['openAICompatibleBaseUrl'], 'OPENAI_BASE_URL'),
        wireApi: routeText(route['wireApi'], 'WIRE_API', 100),
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
    const normalizedTargetRoute = normalizedRoute(targetRoute);
    const capability = evaluateLiveRouteSwitchCapability({
        currentProviderId: normalizedPreviousRoute.providerId,
        targetProviderId: normalizedTargetRoute.providerId,
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
            requiresNewSession: false,
        };
    }
    const activeDialogLoop = typeof ctx.isDialogLoopActive === 'function' ? ctx.isDialogLoopActive() : false;
    const deferDuringActiveDialogLoop = activeDialogLoop && options.allowActiveDialogLoopReattach !== true;
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
                      safeContinuation: 'retry_after_current_llm_turn_or_use_terminal_runtime_apply',
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
                liveModel === providerModel
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
    return { ...operation, capability };
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
