// @ts-check
/**
 * Pure pre/post-turn controller for model-gateway runtime automation.
 *
 * This module intentionally does not mutate terminal state, env, provider health or SDK sessions. It converts the
 * runtime automation decision into explicit effect intents that adapters may execute only when their policy allows it.
 *
 * @module copilot/model-gateway/automation/controller
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function textList(value) {
    return Array.isArray(value) ? value.map(text).filter((item) => item !== null) : [];
}

/**
 * @param {Record<string, unknown>} decision
 * @returns {string | null}
 */
function targetModel(decision) {
    return text(record(decision['targetBoundary'])['model']);
}

/**
 * @param {Record<string, unknown>} decision
 * @returns {string | null}
 */
function selectedRouteKey(decision) {
    return text(decision['selectedRouteKey']);
}

/**
 * @param {object} input
 * @param {boolean} input.allowEffects
 * @param {boolean} input.allowedByPolicy
 * @param {string} input.policyGate
 * @param {string} input.policyDeniedReason
 * @returns {{ execute: boolean; authorization: 'authorized' | 'dry_run' | 'policy_denied'; policyGate: string; blockedReason: string | null }}
 */
function effectAuthorization(input) {
    if (!input.allowEffects) {
        return {
            execute: false,
            authorization: 'dry_run',
            policyGate: input.policyGate,
            blockedReason: 'effects_not_enabled',
        };
    }
    if (!input.allowedByPolicy) {
        return {
            execute: false,
            authorization: 'policy_denied',
            policyGate: input.policyGate,
            blockedReason: input.policyDeniedReason,
        };
    }
    return {
        execute: true,
        authorization: 'authorized',
        policyGate: input.policyGate,
        blockedReason: null,
    };
}

/**
 * @param {object} input
 * @param {'pre_turn' | 'post_turn' | 'manual'} [input.phase]
 * @param {Record<string, unknown>} input.decision
 * @param {{ allowEffects?: boolean; allowLiveSetModel?: boolean; allowNewSession?: boolean; accountWideFailureKinds?: string[] }} [input.policy]
 * @param {{ ok?: boolean; failureKind?: string | null; errorMessage?: string | null }} [input.turnOutcome]
 * @returns {{
 *   schema: 'model-gateway-runtime-automation-controller-step';
 *   ok: boolean;
 *   phase: 'pre_turn' | 'post_turn' | 'manual';
 *   action: string;
 *   effectMode: 'dry_run' | 'allowed';
 *   effects: Array<Record<string, unknown>>;
 *   blockers: string[];
 *   selectedRouteKey: string | null;
 *   operatorSummary: string;
 * }}
 */
export function buildModelGatewayRuntimeAutomationControllerStep(input) {
    const phase = input.phase ?? 'manual';
    const decision = record(input.decision);
    const policy = input.policy ?? {};
    const action = text(decision['action']) ?? 'manual_intervention';
    const blockers = Array.isArray(decision['blockers'])
        ? decision['blockers'].map(text).filter((item) => item !== null)
        : [];
    const allowEffects = policy.allowEffects === true;
    const accountWideFailureKinds = new Set(textList(policy.accountWideFailureKinds));
    const effects = [];
    const model = targetModel(decision);
    const routeKey = selectedRouteKey(decision);

    if (phase === 'post_turn' && input.turnOutcome?.ok === false) {
        const accountWideFailure = accountWideFailureKinds.has(input.turnOutcome.failureKind ?? '');
        effects.push({
            kind: 'replan_after_turn_failure',
            routeKey,
            failureKind: input.turnOutcome.failureKind ?? 'unknown_failure',
            errorMessage: input.turnOutcome.errorMessage ?? null,
            accountWideFailure,
            recoveryScope: accountWideFailure ? 'account' : 'route',
            ...effectAuthorization({
                allowEffects,
                allowedByPolicy: true,
                policyGate: 'allowEffects',
                policyDeniedReason: 'effects_not_enabled',
            }),
        });
    }

    if (action === 'apply_live_model' && decision['canApplyLiveModel'] === true) {
        effects.push({
            kind: 'set_live_model',
            model,
            routeKey,
            ...effectAuthorization({
                allowEffects,
                allowedByPolicy: policy.allowLiveSetModel === true,
                policyGate: 'allowLiveSetModel',
                policyDeniedReason: 'live_set_model_not_allowed',
            }),
        });
    } else if (action === 'prepare_new_session' || decision['requiresNewSession'] === true) {
        effects.push({
            kind: 'prepare_new_sdk_session',
            model,
            routeKey,
            ...effectAuthorization({
                allowEffects,
                allowedByPolicy: policy.allowNewSession === true,
                policyGate: 'allowNewSession',
                policyDeniedReason: 'new_session_not_allowed',
            }),
        });
    } else if (action === 'wait_for_reset') {
        effects.push({
            kind: 'wait_for_provider_reset',
            routeKey,
            execute: false,
            authorization: 'policy_denied',
            policyGate: 'providerReset',
            blockedReason: 'wait_for_reset_not_executable',
        });
    }

    const runnableEffects = effects.filter((effect) => effect['execute'] === true);
    return {
        schema: 'model-gateway-runtime-automation-controller-step',
        ok: decision['ok'] === true && blockers.length === 0,
        phase,
        action,
        effectMode: allowEffects ? 'allowed' : 'dry_run',
        effects,
        blockers,
        selectedRouteKey: routeKey,
        operatorSummary:
            runnableEffects.length > 0
                ? `${runnableEffects.length} efeito(s) autorizado(s) para ${action}.`
                : text(decision['operatorSummary']) ?? 'Nenhum efeito automatico autorizado.',
    };
}
