// @ts-check
/**
 * Pure runtime automation decisions for model-gateway routes.
 *
 * This module does not mutate env, does not call providers and does not touch the live SDK session. It only decides
 * what an automation adapter may do next.
 *
 * @module copilot/model-gateway/automation/decision
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function textList(value) {
    return Array.isArray(value) ? value.map(text).filter((item) => item !== null) : [];
}

/**
 * @param {Record<string, unknown> | null | undefined} route
 * @returns {Record<string, unknown> | null}
 */
function selectedRoute(route) {
    return record(route?.['selected']);
}

/**
 * @param {Record<string, unknown> | null | undefined} route
 * @returns {string | null}
 */
function routeKey(route) {
    return text(route?.['selectedRouteKey']) ?? text(route?.['selected'] && record(route['selected'])?.['id']);
}

/**
 * @param {Record<string, unknown> | null | undefined} route
 * @returns {{ profile: string | null; preset: string | null; providerType: string | null; baseUrl: string | null; model: string | null }}
 */
function targetBoundary(route) {
    const selected = selectedRoute(route);
    const runtimeEnv = record(route?.['runtimeEnv']);
    return {
        profile: text(route?.['profileId']) ?? text(selected?.['routeProfile']) ?? text(selected?.['taskProfile']),
        preset: text(runtimeEnv?.['providerPreset']) ?? text(selected?.['providerId']),
        providerType: text(selected?.['runtimeKind']) ?? text(selected?.['routeLayer']),
        baseUrl: text(selected?.['baseUrl']) ?? text(selected?.['openAICompatibleBaseUrl']),
        model: text(selected?.['selectorSyntax']) ?? text(selected?.['providerModel']) ?? text(selected?.['id']),
    };
}

/**
 * @param {Record<string, unknown> | null | undefined} binding
 * @returns {{ enabled: boolean; profile: string | null; preset: string | null; providerType: string | null; baseUrl: string | null; model: string | null }}
 */
function liveBoundary(binding) {
    return {
        enabled: binding?.['enabled'] === true,
        profile: text(binding?.['profile']),
        preset: text(binding?.['preset']),
        providerType: text(binding?.['providerType']),
        baseUrl: text(binding?.['baseUrl']),
        model: text(binding?.['model']),
    };
}

/**
 * @param {ReturnType<typeof targetBoundary>} target
 * @param {ReturnType<typeof liveBoundary>} live
 * @returns {boolean}
 */
function sameProviderBoundary(target, live) {
    if (!live.enabled) return false;
    if (target.profile !== live.profile) return false;
    if (target.preset !== live.preset) return false;
    if (target.baseUrl && live.baseUrl && target.baseUrl !== live.baseUrl) return false;
    return true;
}

/**
 * @param {Record<string, unknown> | null | undefined} route
 * @returns {string[]}
 */
function routeBlockers(route) {
    const reasons = textList(route?.['reasons']);
    const blockers = [];
    if (!route) blockers.push('runtime_selector_route_missing');
    if (route?.['status'] === 'blocked') blockers.push('runtime_selector_route_blocked');
    if (!selectedRoute(route)) blockers.push('selected_route_missing');
    for (const reason of reasons) {
        if (reason.startsWith('blocked:')) blockers.push(reason);
    }
    return [...new Set(blockers)];
}

/**
 * @param {Record<string, unknown> | null | undefined} route
 * @param {object} options
 * @param {boolean} [options.allowLocalPrivate]
 * @returns {string[]}
 */
function policyBlockers(route, options) {
    const selected = selectedRoute(route);
    if (selected?.['localPrivate'] === true && options.allowLocalPrivate !== true) {
        return ['local_private_requires_explicit_opt_in'];
    }
    return [];
}

/**
 * @param {string | null} routeProfile
 * @param {string[]} blockers
 * @param {boolean} wait
 * @returns {string[]}
 */
function blockedRouteNextCommands(routeProfile, blockers, wait) {
    if (wait) return ['npm run model-gateway:runtime-health:diff', 'npm run model-gateway:runtime-selector -- --fail'];
    const profile = routeProfile || 'repo_agent';
    const needsRuntimeProofPlan = blockers.some((blocker) =>
        /selected_route_missing|runtime_selector_route_blocked|runtime_health|runtime_probe|runtime_proof|provider_health_cooldown/iu.test(
            blocker,
        ),
    );
    return [
        ...(needsRuntimeProofPlan
            ? [
                  `npm run model-gateway:auto:proof-plan -- --profile=${profile} --limit=12`,
                  `/byok auto proof-plan profile:${profile} 12`,
              ]
            : []),
        'npm run model-gateway:selection:audit -- --strict',
    ];
}

/**
 * @param {Record<string, unknown> | null | undefined} route
 * @param {Record<string, unknown> | null | undefined} turnFailure
 * @returns {boolean}
 */
function routeMatchesTurnFailure(route, turnFailure) {
    if (!route || !turnFailure) return false;
    const selected = selectedRoute(route);
    const routeProfile = text(route?.['profileId']) ?? text(selected?.['routeProfile']) ?? text(selected?.['taskProfile']);
    const providerId = text(selected?.['providerId']);
    const providerModel = text(selected?.['providerModel']) ?? text(selected?.['selectorSyntax']) ?? text(selected?.['id']);
    const failedProfile = text(turnFailure?.['profile']) ?? text(turnFailure?.['routeProfile']);
    const failedProvider = text(turnFailure?.['provider']) ?? text(turnFailure?.['providerId']);
    const failedModel = text(turnFailure?.['model']) ?? text(turnFailure?.['providerModel']);
    const profileMatches = !failedProfile || !routeProfile || failedProfile === routeProfile;
    return profileMatches && providerId !== null && providerModel !== null && providerId === failedProvider && providerModel === failedModel;
}

/**
 * @param {Record<string, unknown> | null | undefined} route
 * @param {Record<string, unknown> | null | undefined} turnFailure
 * @returns {string[]}
 */
function turnFailureBlockers(route, turnFailure) {
    if (!routeMatchesTurnFailure(route, turnFailure)) return [];
    const failureKind = text(turnFailure?.['failureKind']) ?? text(record(turnFailure?.['failure'])?.['kind']) ?? 'unknown_failure';
    return [`same_route_failed_this_turn:${failureKind}`];
}

/**
 * @param {Record<string, unknown> | null | undefined} route
 * @returns {boolean}
 */
function shouldWaitForReset(route) {
    const reasons = textList(route?.['reasons']);
    const runtimeHealth = record(route?.['runtimeHealth']);
    const providerCooldown = record(route?.['providerCooldown']);
    return (
        reasons.some((reason) => reason.includes('rate-limit') || reason.includes('provider_health_cooldown')) ||
        text(runtimeHealth?.['reason']) === 'temporary_failure' ||
        providerCooldown?.['include'] === false
    );
}

/**
 * @param {Record<string, unknown> | null | undefined} route
 * @returns {{ active: boolean; reason: string | null; resetAt: string | null; retryAfterSeconds: number | null }}
 */
function routeCooldown(route) {
    const providerCooldown = record(route?.['providerCooldown']);
    const runtimeHealth = record(route?.['runtimeHealth']);
    const retryAfterSeconds =
        typeof providerCooldown?.['retryAfterSeconds'] === 'number' && Number.isFinite(providerCooldown['retryAfterSeconds'])
            ? providerCooldown['retryAfterSeconds']
            : null;
    return {
        active: providerCooldown?.['include'] === false || shouldWaitForReset(route),
        reason: text(providerCooldown?.['reason']) ?? text(runtimeHealth?.['reason']),
        resetAt: text(providerCooldown?.['resetAt']) ?? text(runtimeHealth?.['resetAt']),
        retryAfterSeconds,
    };
}

/**
 * @param {string[]} blockers
 * @returns {'none' | 'quota_hard' | 'rate_limit_resettable' | 'auth_invalid' | 'model_unavailable' | 'local_private_policy' | 'new_session_policy' | 'route_blocked'}
 */
function blockerClass(blockers) {
    const textValue = blockers.join(' ').toLowerCase();
    if (!textValue) return 'none';
    if (/local_private/iu.test(textValue)) return 'local_private_policy';
    if (/new_session/iu.test(textValue)) return 'new_session_policy';
    if (/rate[_ -]?limit|cooldown|retry/iu.test(textValue)) return 'rate_limit_resettable';
    if (/quota|credit|balance|spending/iu.test(textValue)) return 'quota_hard';
    if (/\bauth\b|unauthori[sz]ed|forbidden|key_disabled|invalid[_ -]?key/iu.test(textValue)) return 'auth_invalid';
    if (/model[_ -]?unavailable|model-or-route|selected_route_missing|route_missing|not[_ -]?found/iu.test(textValue)) {
        return 'model_unavailable';
    }
    return 'route_blocked';
}

/**
 * @param {Record<string, unknown> | null | undefined} plan
 * @param {string | null | undefined} profileId
 * @returns {Record<string, unknown> | null}
 */
function chooseRoute(plan, profileId) {
    const routes = Array.isArray(plan?.['routes']) ? plan['routes'].map(record).filter((item) => item !== null) : [];
    const requested = text(profileId);
    return routes.find((route) => text(route['profileId']) === requested) ?? routes.find((route) => route['status'] === 'selected') ?? routes[0] ?? null;
}

/**
 * @param {Record<string, unknown> | null | undefined} runtimeSelectorPlan
 * @param {string | null | undefined} [profileId]
 * @returns {{
 *   schema: 'model-gateway-runtime-automation-route';
 *   route: Record<string, unknown> | null;
 *   routeProfile: string | null;
 *   selectedRouteKey: string | null;
 *   blockers: string[];
 *   waitForReset: boolean;
 * }}
 */
export function selectModelGatewayRuntimeAutomationRoute(runtimeSelectorPlan, profileId) {
    const route = chooseRoute(record(runtimeSelectorPlan), profileId);
    const target = targetBoundary(route);
    return {
        schema: 'model-gateway-runtime-automation-route',
        route,
        routeProfile: text(route?.['profileId']) ?? target.profile,
        selectedRouteKey: routeKey(route),
        blockers: routeBlockers(route),
        waitForReset: shouldWaitForReset(route),
    };
}

/**
 * @param {object} input
 * @param {Record<string, unknown> | null | undefined} input.runtimeSelectorPlan
 * @param {string | null | undefined} [input.profileId]
 * @param {Record<string, unknown> | null | undefined} [input.liveByokBinding]
 * @param {string | null | undefined} [input.currentSessionId]
 * @param {object} [input.policy]
 * @param {boolean} [input.policy.allowLiveSetModel]
 * @param {boolean} [input.policy.allowNewSession]
 * @param {boolean} [input.policy.allowLocalPrivate]
 * @param {Record<string, unknown> | null | undefined} [input.turnFailure]
 * @returns {{
 *   schema: 'model-gateway-runtime-automation-decision';
 *   ok: boolean;
 *   status: 'ready' | 'blocked';
 *   action: 'keep_current' | 'apply_live_model' | 'prepare_new_session' | 'wait_for_reset' | 'manual_intervention';
 *   selectedRouteKey: string | null;
 *   routeProfile: string | null;
 *   canApplyLiveModel: boolean;
 *   requiresNewSession: boolean;
 *   blockers: string[];
 *   currentBoundary: ReturnType<typeof liveBoundary>;
 *   targetBoundary: ReturnType<typeof targetBoundary>;
 *   cooldown: ReturnType<typeof routeCooldown>;
 *   blockerClass: ReturnType<typeof blockerClass>;
 *   nonActionReason: string | null;
 *   nextCommands: string[];
 *   operatorSummary: string;
 * }}
 */
export function buildModelGatewayRuntimeAutomationDecision(input) {
    const automationRoute = selectModelGatewayRuntimeAutomationRoute(input.runtimeSelectorPlan, input.profileId);
    const route = automationRoute.route;
    const target = targetBoundary(route);
    const current = liveBoundary(input.liveByokBinding);
    const cooldown = routeCooldown(route);
    const blockers = [
        ...automationRoute.blockers,
        ...policyBlockers(route, input.policy ?? {}),
        ...turnFailureBlockers(route, input.turnFailure),
    ];
    const currentBlockerClass = blockerClass(blockers);
    const selectedKey = automationRoute.selectedRouteKey;
    const routeProfile = automationRoute.routeProfile;
    if (blockers.length > 0) {
        const sameRouteFailure = blockers.find((blocker) => blocker.startsWith('same_route_failed_this_turn:')) ?? null;
        const wait =
            automationRoute.waitForReset ||
            (sameRouteFailure !== null && /rate|timeout|temporary|transient|retry/iu.test(sameRouteFailure));
        return {
            schema: 'model-gateway-runtime-automation-decision',
            ok: false,
            status: 'blocked',
            action: wait ? 'wait_for_reset' : 'manual_intervention',
            selectedRouteKey: selectedKey,
            routeProfile,
            canApplyLiveModel: false,
            requiresNewSession: false,
            blockers,
            currentBoundary: current,
            targetBoundary: target,
            cooldown,
            blockerClass: currentBlockerClass,
            nonActionReason: sameRouteFailure !== null ? 'same_route_failed_this_turn' : wait ? 'route_wait_for_reset' : 'route_blocked',
            nextCommands: blockedRouteNextCommands(routeProfile, blockers, wait),
            operatorSummary: wait
                ? 'Rota bloqueada por health/cooldown ou falha recente; aguarde reset ou escolha outra rota.'
                : sameRouteFailure !== null
                  ? 'Rota recem-falhou neste turno; automacao bloqueou repeticao imediata do mesmo provider/modelo.'
                  : `Automacao bloqueada: ${blockers.join(', ')}`,
        };
    }
    const sameBoundary = sameProviderBoundary(target, current);
    const modelAlreadyCurrent = sameBoundary && current.model === target.model;
    if (!text(input.currentSessionId)) {
        return {
            schema: 'model-gateway-runtime-automation-decision',
            ok: true,
            status: 'ready',
            action: 'prepare_new_session',
            selectedRouteKey: selectedKey,
            routeProfile,
            canApplyLiveModel: false,
            requiresNewSession: true,
            blockers: [],
            currentBoundary: current,
            targetBoundary: target,
            cooldown,
            blockerClass: 'none',
            nonActionReason: null,
            nextCommands: ['/session sdk next new', target.model ? `/byok model ${target.model}` : '/byok auto apply'],
            operatorSummary: 'Sem sessao viva; a rota selecionada pode ser preparada para o proximo boot.',
        };
    }
    if (modelAlreadyCurrent) {
        return {
            schema: 'model-gateway-runtime-automation-decision',
            ok: true,
            status: 'ready',
            action: 'keep_current',
            selectedRouteKey: selectedKey,
            routeProfile,
            canApplyLiveModel: false,
            requiresNewSession: false,
            blockers: [],
            currentBoundary: current,
            targetBoundary: target,
            cooldown,
            blockerClass: 'none',
            nonActionReason: 'already_aligned',
            nextCommands: ['continue_terminal_turn'],
            operatorSummary: 'Sessao viva ja esta alinhada com a rota selecionada.',
        };
    }
    if (sameBoundary && input.policy?.allowLiveSetModel === true) {
        return {
            schema: 'model-gateway-runtime-automation-decision',
            ok: true,
            status: 'ready',
            action: 'apply_live_model',
            selectedRouteKey: selectedKey,
            routeProfile,
            canApplyLiveModel: true,
            requiresNewSession: false,
            blockers: [],
            currentBoundary: current,
            targetBoundary: target,
            cooldown,
            blockerClass: 'none',
            nonActionReason: null,
            nextCommands: target.model ? [`/byok model ${target.model}`] : ['/byok auto apply'],
            operatorSummary: 'Mesmo provider BYOK; o modelo pode ser aplicado na sessao viva.',
        };
    }
    const requiresNewSession = !sameBoundary;
    return {
        schema: 'model-gateway-runtime-automation-decision',
        ok: input.policy?.allowNewSession === true || !requiresNewSession,
        status: input.policy?.allowNewSession === true || !requiresNewSession ? 'ready' : 'blocked',
        action: requiresNewSession ? (input.policy?.allowNewSession === true ? 'prepare_new_session' : 'manual_intervention') : 'manual_intervention',
        selectedRouteKey: selectedKey,
        routeProfile,
        canApplyLiveModel: false,
        requiresNewSession,
        blockers: requiresNewSession && input.policy?.allowNewSession !== true ? ['new_session_requires_explicit_policy'] : [],
        currentBoundary: current,
        targetBoundary: target,
        cooldown,
        blockerClass: requiresNewSession && input.policy?.allowNewSession !== true ? 'new_session_policy' : 'none',
        nonActionReason: requiresNewSession ? 'new_session_policy_required' : 'live_set_model_policy_disabled',
        nextCommands: requiresNewSession
            ? ['/session sdk next new', target.model ? `/byok model ${target.model}` : '/byok auto apply']
            : ['/byok auto status'],
        operatorSummary: requiresNewSession
            ? 'A rota selecionada cruza provider/perfil; e necessario preparar nova sessao SDK.'
            : 'Mesmo provider BYOK, mas troca live esta desabilitada pela policy.',
    };
}
