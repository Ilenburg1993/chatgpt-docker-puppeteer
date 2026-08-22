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
    buildModelGatewayRuntimeAutomationControllerStep,
    buildModelGatewayRuntimeAutomationDecision,
    buildModelGatewayRuntimeSelectorPlan,
    compareModelGatewaySelectionAudits,
    createEnvSecretRegistry,
    flushAndMirrorByokProviderHealthToSqlite,
    JsonModelGatewayCatalogStore,
    listByokProviderModelHealth,
    readModelGatewayRuntimeAutomationEffectivePolicy,
    readModelGatewayRuntimeAutomationPolicy,
    recordByokProviderModelCallFailure,
    resolveModelGatewayRuntimeAutomationPolicyPreset,
    resolveModelGatewaySelectionPolicy,
    SqliteModelGatewayCatalogStore,
} from '#copilot/model-gateway';

import {
    listTerminalSdkSessionInventory,
    readTerminalConfiguredSessionFsState,
} from '../frontend/gateways/session/index.js';
import { requestTerminalLiveByokModelSwitch, requestTerminalLiveByokRouteSwitch } from './live-model-switch.js';

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
 * @param {unknown} value
 * @returns {number | null}
 */
function optionalFiniteNumber(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    return Number.isFinite(number) ? number : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalIsoTimestamp(value) {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(/** @type {string | number} */ (value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/**
 * @param {string | null} failureKind
 * @returns {number | null}
 */
function defaultFailureStatusCode(failureKind) {
    if (failureKind === 'rate-limit') return 429;
    if (failureKind === 'credits') return 402;
    if (failureKind === 'auth') return 401;
    return null;
}

/**
 * @param {string | null} failureKind
 * @returns {number | null}
 */
function defaultRetryAfterSeconds(failureKind) {
    return failureKind === 'rate-limit' ? 900 : null;
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function renderAutomationTokenLabel(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return '-';
    const key = normalized.toLowerCase().replace(/[\s-]+/gu, '_');
    const labels = /** @type {Record<string, string>} */ ({
        set_live_model: 'trocar modelo vivo',
        prepare_new_sdk_session: 'preparar novo boot SDK',
        replan_after_turn_failure: 'replanejamento pós-falha',
        effect_not_authorized: 'aguardando autorização',
        live_set_model_not_allowed: 'troca viva não autorizada',
        new_session_not_allowed: 'nova sessão não autorizada',
        policy_denied: 'política não autorizou',
        policy_disabled: 'política desativada',
        catalog: 'catálogo',
        authenticated_catalog: 'catálogo autenticado',
        static_seed: 'seed estático',
        probe_verified: 'probe verificado',
        rate_limit: 'limite de taxa',
        rate_limited: 'limitado por taxa',
        unknown_failure: 'falha desconhecida',
        unknown_effect: 'efeito desconhecido',
    });
    if (labels[normalized]) return labels[normalized];
    if (labels[key]) return labels[key];
    if (normalized.includes(':')) {
        return normalized
            .split(':')
            .map((part) => renderAutomationTokenLabel(part))
            .join(' · ');
    }
    return normalized.replace(/[_-]+/gu, ' ');
}

/**
 * @param {Awaited<ReturnType<typeof buildTerminalByokGatewayAutoStatus>>} status
 * @param {Record<string, unknown>} turnFailure
 * @returns {{
 *     routeProfile: string;
 *     providerId: string | null;
 *     providerModel: string | null;
 *     failureKind: string;
 *     message: string | null;
 *     errorContext: string | null;
 *     failureStatusCode: number | null;
 *     retryAfterSeconds: number | null;
 *     resetAt: string | null;
 * }}
 */
function resolvePostTurnHealthFailure(status, turnFailure) {
    const targetBoundary =
        status.decision.targetBoundary && typeof status.decision.targetBoundary === 'object'
            ? /** @type {Record<string, unknown>} */ (status.decision.targetBoundary)
            : {};
    const failureKind = optionalScalarString(turnFailure['failureKind']) ?? 'unknown_failure';
    return {
        routeProfile: status.decision.routeProfile ?? status.args.profileId,
        providerId:
            optionalScalarString(turnFailure['providerId']) ??
            optionalScalarString(turnFailure['provider']) ??
            optionalScalarString(targetBoundary['preset']),
        providerModel:
            optionalScalarString(turnFailure['providerModel']) ??
            optionalScalarString(turnFailure['model']) ??
            optionalScalarString(targetBoundary['model']),
        failureKind,
        message: optionalScalarString(turnFailure['message']) ?? `BYOK post-turn failure: ${failureKind}`,
        errorContext: optionalScalarString(turnFailure['errorContext']) ?? 'terminal.byok.post_turn_failure',
        failureStatusCode:
            optionalFiniteNumber(turnFailure['failureStatusCode']) ?? defaultFailureStatusCode(failureKind),
        retryAfterSeconds:
            optionalFiniteNumber(turnFailure['retryAfterSeconds']) ?? defaultRetryAfterSeconds(failureKind),
        resetAt: optionalIsoTimestamp(turnFailure['resetAt']),
    };
}

/**
 * @param {Record<string, unknown>} effect
 * @returns {string}
 */
export function describeTerminalByokGatewayAutoEffect(effect) {
    const kind = optionalScalarString(effect['kind']) ?? 'unknown_effect';
    const label = renderAutomationTokenLabel(kind);
    const model = optionalScalarString(effect['model']);
    const previousModel = optionalScalarString(effect['previousModel']);
    const currentModel = optionalScalarString(effect['currentModel']) ?? model;
    const confidence = optionalScalarString(effect['confidence']);
    const skippedReason = optionalScalarString(effect['skippedReason']);
    if (effect['applied'] === true && kind === 'set_live_model') {
        const confidenceSuffix = confidence ? ` · confiança ${renderAutomationTokenLabel(confidence)}` : '';
        if (previousModel && currentModel && previousModel !== currentModel) {
            return `modelo vivo solicitado ${previousModel} → ${currentModel}${confidenceSuffix}`;
        }
        return currentModel
            ? `modelo vivo solicitado ${currentModel}${confidenceSuffix}`
            : `modelo vivo solicitado${confidenceSuffix}`;
    }
    if (effect['applied'] === true && kind === 'prepare_new_sdk_session') {
        return model ? `novo boot SDK preparado para ${model}` : 'novo boot SDK preparado';
    }
    if (effect['applied'] === true && kind === 'replan_after_turn_failure') {
        const scope = optionalScalarString(effect['recoveryScope']) === 'account' ? 'conta/key' : 'modelo/rota';
        return `replanejamento pós-falha registrado (${renderAutomationTokenLabel(optionalScalarString(effect['failureKind']) ?? 'unknown_failure')}, escopo ${scope})`;
    }
    if (skippedReason === 'effect_not_authorized') {
        return `${label} aguardando autorização da policy`;
    }
    if (skippedReason) {
        return `${label} não aplicado (${renderAutomationTokenLabel(skippedReason)})`;
    }
    return label;
}

/**
 * @param {string[]} rest
 * @param {{ env?: NodeJS.ProcessEnv; policy?: ReturnType<typeof readModelGatewayRuntimeAutomationPolicy> }} [options]
 * @returns {{
 *     profileId: string;
 *     presetId: string;
 *     allowLiveSetModel: boolean;
 *     allowNewSession: boolean;
 *     allowLocalPrivate: boolean;
 * }}
 */
export function parseTerminalByokGatewayAutoArgs(rest, options = {}) {
    const envPolicy = options.policy ?? readModelGatewayRuntimeAutomationPolicy(options.env);
    const presetToken = rest.find((item) =>
        /^(?:preset|policyPreset|policy-preset|autoPreset|auto-preset)[:=]/iu.test(item),
    );
    const requestedPresetId = optionalScalarString(
        presetToken?.replace(/^(?:preset|policyPreset|policy-preset|autoPreset|auto-preset)[:=]/iu, ''),
    );
    const policy = requestedPresetId
        ? resolveModelGatewayRuntimeAutomationPolicyPreset(requestedPresetId, envPolicy)
        : envPolicy;
    const profileToken = rest.find((item) => /^(?:profile|perfil|routeProfile|route-profile)[:=]/iu.test(item));
    const profileId =
        optionalScalarString(profileToken?.replace(/^(?:profile|perfil|routeProfile|route-profile)[:=]/iu, '')) ??
        policy.profiles[0] ??
        optionalScalarString(
            rest.find(
                (item) =>
                    !/^(auto|status|plan|apply|on|off|history|policy|doctor|standby|record|preset|policyPreset|policy-preset|autoPreset|auto-preset|--|allow-|deny-|no-|live-|new-session|local)/iu.test(
                        item,
                    ),
            ),
        ) ??
        'repo_agent';
    const allowLiveSetModel = rest.some((item) =>
        /^(?:--)?allow-live-set-model|live-set-model|set-model$/iu.test(item),
    );
    const denyLiveSetModel = rest.some((item) => /^(?:--)?(?:deny|no)-live-set-model|no-set-model$/iu.test(item));
    const allowNewSession = rest.some((item) => /^(?:--)?allow-new-session|new-session$/iu.test(item));
    const denyNewSession = rest.some((item) => /^(?:--)?(?:deny|no)-new-session$/iu.test(item));
    const allowLocalPrivate = rest.some((item) => /^(?:--)?allow-local-private|local-private|ollama$/iu.test(item));
    const denyLocalPrivate = rest.some((item) => /^(?:--)?(?:deny|no)-local-private|no-local|no-ollama$/iu.test(item));
    return {
        profileId,
        presetId: policy.preset,
        allowLiveSetModel: denyLiveSetModel ? false : policy.allowLiveSetModel || allowLiveSetModel,
        allowNewSession: denyNewSession ? false : policy.allowNewSession || allowNewSession,
        allowLocalPrivate: denyLocalPrivate ? false : policy.allowLocalPrivate || allowLocalPrivate,
    };
}

/**
 * @param {unknown} error
 * @returns {Promise<
 *     Awaited<ReturnType<typeof listTerminalSdkSessionInventory>> & { unavailableReason?: string | null }
 * >}
 */
async function createUnavailableSdkSessionInventory(error) {
    const message = error instanceof Error ? error.message : String(error ?? 'SDK indisponível');
    return {
        currentSessionId: null,
        lastSessionId: null,
        foregroundSessionId: null,
        persistedByokBinding: null,
        lastBootDecision: null,
        sessionFs: await readTerminalConfiguredSessionFsState(null),
        sessions: [],
        unavailableReason: message,
    };
}

/**
 * @returns {Promise<
 *     Awaited<ReturnType<typeof listTerminalSdkSessionInventory>> & { unavailableReason?: string | null }
 * >}
 */
async function readTerminalSdkSessionInventoryForAutomation() {
    try {
        return await listTerminalSdkSessionInventory();
    } catch (error) {
        return await createUnavailableSdkSessionInventory(error);
    }
}

/**
 * @param {string[]} rest
 * @param {{
 *     allowEffects?: boolean;
 *     catalogStore?: JsonModelGatewayCatalogStore;
 *     env?: NodeJS.ProcessEnv;
 *     persistAutomationDecision?: boolean;
 *     turnFailure?: Record<string, unknown> | null;
 * }} [options]
 * @returns {Promise<{
 *     schema: 'terminal-byok-gateway-auto-status';
 *     args: ReturnType<typeof parseTerminalByokGatewayAutoArgs>;
 *     runtimeSelectorPlan: ReturnType<typeof buildModelGatewayRuntimeSelectorPlan>;
 *     inventory: Awaited<ReturnType<typeof listTerminalSdkSessionInventory>>;
 *     decision: ReturnType<typeof buildModelGatewayRuntimeAutomationDecision>;
 *     controllerStep: ReturnType<typeof buildModelGatewayRuntimeAutomationControllerStep>;
 *     automationDecisionRecord: Record<string, unknown>;
 *     persistence: { automationDecisions: number; automationPolicySnapshots?: number } | null;
 * }>}
 */
export async function buildTerminalByokGatewayAutoStatus(rest, options = {}) {
    const envOptions = options.env ? { env: options.env } : {};
    const policy = await readModelGatewayRuntimeAutomationEffectivePolicy(envOptions);
    const args = parseTerminalByokGatewayAutoArgs(rest, { ...envOptions, policy });
    const store = options.catalogStore ?? new JsonModelGatewayCatalogStore();
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
    const inventory = await readTerminalSdkSessionInventoryForAutomation();
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
        turnFailure: options.turnFailure,
    });
    const controllerStep = buildModelGatewayRuntimeAutomationControllerStep({
        phase: 'manual',
        decision,
        policy: {
            allowEffects: options.allowEffects === true,
            allowLiveSetModel: args.allowLiveSetModel,
            allowNewSession: args.allowNewSession,
            accountWideFailureKinds: policy.accountWideFailureKinds,
        },
    });
    const decisionTimestamp = new Date().toISOString();
    const automationDecisionRecord = {
        ...decision,
        decisionId: `terminal-auto:${Date.now()}:${process.pid}`,
        timestamp: decisionTimestamp,
        source: 'terminal-byok-auto-status',
    };
    let persistence = null;
    if (options.persistAutomationDecision === true) {
        const sqliteStore = new SqliteModelGatewayCatalogStore();
        const decisionPersistence = await sqliteStore.writeAutomationDecisionRecords([automationDecisionRecord]);
        const policyPersistence = await sqliteStore.writeAutomationPolicySnapshotRecords([
            {
                policySnapshotId: `${automationDecisionRecord.decisionId}:policy`,
                decisionId: automationDecisionRecord.decisionId,
                routeProfile: decision.routeProfile ?? args.profileId,
                enabled: policy.enabled,
                preset: policy.preset,
                policy: policy.policy,
                profiles: policy.profiles,
                allowLiveSetModel: args.allowLiveSetModel,
                allowNewSession: args.allowNewSession,
                allowProviderProbes: policy.allowProviderProbes,
                allowLocalPrivate: args.allowLocalPrivate,
                accountWideFailureKinds: policy.accountWideFailureKinds,
                timestamp: decisionTimestamp,
                source: 'terminal-byok-auto-status',
            },
        ]);
        persistence = { ...decisionPersistence, ...policyPersistence };
    }
    return {
        schema: 'terminal-byok-gateway-auto-status',
        args,
        runtimeSelectorPlan,
        inventory,
        decision,
        controllerStep,
        automationDecisionRecord,
        persistence,
    };
}

/**
 * @param {{ effects?: Record<string, unknown>[] }} controllerStep
 * @returns {Promise<{ applied: Record<string, unknown>[]; skipped: Record<string, unknown>[] }>}
 */
export async function applyTerminalByokGatewayAutoEffects(controllerStep) {
    const effects = Array.isArray(controllerStep.effects) ? controllerStep.effects : [];
    const applied = [];
    const skipped = [];
    for (const effect of effects) {
        if (effect['execute'] !== true) {
            skipped.push({
                ...effect,
                skippedReason: optionalScalarString(effect['blockedReason']) ?? 'effect_not_authorized',
            });
            continue;
        }
        if (effect['kind'] === 'replan_after_turn_failure') {
            applied.push({ ...effect, applied: true, terminalMutation: false });
            continue;
        }
        if (effect['kind'] === 'set_live_model' && typeof effect['model'] === 'string' && effect['model'].trim()) {
            const request = await requestTerminalLiveByokModelSwitch(effect['model'], {
                source: 'terminal.byok_auto',
                reason: optionalScalarString(effect['reason']) ?? 'automação model-gateway',
                confidence: optionalScalarString(effect['confidence']),
            });
            applied.push({
                ...effect,
                applied: true,
                previousModel: request.previousModel,
                currentModel: request.currentModel,
                reasoningAdjusted: request.reasoningAdjusted,
            });
            continue;
        }
        if (effect['kind'] === 'switch_live_route') {
            const route =
                effect['route'] && typeof effect['route'] === 'object'
                    ? /** @type {Record<string, unknown>} */ (effect['route'])
                    : null;
            if (!route) {
                skipped.push({ ...effect, skippedReason: 'live_route_target_missing' });
                continue;
            }
            const request = await requestTerminalLiveByokRouteSwitch(route, {
                source: 'terminal.byok_auto',
                reason: optionalScalarString(effect['reason']) ?? 'automação model-gateway',
            });
            applied.push({
                ...effect,
                applied: true,
                operationId: optionalScalarString(request.operation['operationId']),
                sameSession: request.operation['requiresNewSession'] === false,
            });
            continue;
        }
        if (effect['kind'] === 'prepare_new_sdk_session') {
            skipped.push({ ...effect, skippedReason: 'implicit_new_session_forbidden' });
            continue;
        }
        skipped.push({ ...effect, skippedReason: 'no_terminal_executor' });
    }
    return { applied, skipped };
}

/**
 * @param {Awaited<ReturnType<typeof buildTerminalByokGatewayAutoStatus>>} status
 * @param {Awaited<ReturnType<typeof applyTerminalByokGatewayAutoEffects>>} application
 * @param {{ source?: string; timestamp?: string }} [options]
 * @returns {Record<string, unknown>[]}
 */
export function createTerminalByokGatewayAutoEffectApplicationRecords(status, application, options = {}) {
    const timestamp = options.timestamp ?? new Date().toISOString();
    const decisionId = optionalScalarString(status.automationDecisionRecord['decisionId']);
    const routeProfile = status.decision.routeProfile ?? status.args.profileId;
    const selectedRouteKey = status.decision.selectedRouteKey;
    return [...application.applied, ...application.skipped].map((effect, index) => {
        const applied = effect['applied'] === true;
        const kind = optionalScalarString(effect['kind']) ?? 'unknown_effect';
        const skippedReason = optionalScalarString(effect['skippedReason']);
        return {
            ...effect,
            effectId: `${decisionId ?? 'terminal-auto'}:effect:${index}:${kind}`,
            decisionId,
            routeProfile,
            selectedRouteKey,
            effectKind: kind,
            status: applied ? 'applied' : (skippedReason ?? 'skipped'),
            applied,
            timestamp,
            source: options.source ?? 'terminal-byok-auto-effects',
        };
    });
}

/**
 * @param {Awaited<ReturnType<typeof buildTerminalByokGatewayAutoStatus>>} status
 * @param {Awaited<ReturnType<typeof applyTerminalByokGatewayAutoEffects>>} application
 * @param {{ source?: string; timestamp?: string }} [options]
 * @returns {Record<string, unknown>[]}
 */
export function createTerminalByokGatewaySdkSessionHandoffRecords(status, application, options = {}) {
    const timestamp = options.timestamp ?? new Date().toISOString();
    const decisionId = optionalScalarString(status.automationDecisionRecord['decisionId']);
    const routeProfile = status.decision.routeProfile ?? status.args.profileId;
    const selectedRouteKey = status.decision.selectedRouteKey;
    return [...application.applied, ...application.skipped]
        .filter((effect) => effect['kind'] === 'prepare_new_sdk_session')
        .map((effect, index) => {
            const applied = effect['applied'] === true;
            const skippedReason = optionalScalarString(effect['skippedReason']);
            return {
                handoffId: `${decisionId ?? 'terminal-auto'}:handoff:${index}`,
                decisionId,
                routeProfile,
                selectedRouteKey,
                status: applied ? 'boot_scheduled' : (skippedReason ?? 'skipped'),
                targetModel: optionalScalarString(effect['model']),
                requestedAt: timestamp,
                source: options.source ?? 'terminal-byok-auto-handoff',
                effect,
            };
        });
}

/**
 * @param {Awaited<ReturnType<typeof buildTerminalByokGatewayAutoStatus>>} status
 * @param {Awaited<ReturnType<typeof applyTerminalByokGatewayAutoEffects>>} application
 * @param {{ source?: string; timestamp?: string }} [options]
 * @returns {Record<string, unknown>[]}
 */
export function createTerminalByokGatewayRecoveryAttemptRecords(status, application, options = {}) {
    const timestamp = options.timestamp ?? new Date().toISOString();
    const decisionId = optionalScalarString(status.automationDecisionRecord['decisionId']);
    const routeProfile = status.decision.routeProfile ?? status.args.profileId;
    const selectedRouteKey = status.decision.selectedRouteKey;
    return [...application.applied, ...application.skipped]
        .map((effect, effectIndex) => ({ effect, effectIndex }))
        .filter(({ effect }) => effect['kind'] === 'replan_after_turn_failure')
        .map(({ effect, effectIndex }, index) => {
            const applied = effect['applied'] === true;
            const skippedReason = optionalScalarString(effect['skippedReason']);
            const failureKind = optionalScalarString(effect['failureKind']) ?? 'unknown_failure';
            const recoveryScope =
                optionalScalarString(effect['recoveryScope']) ??
                (effect['accountWideFailure'] === true ? 'account' : 'route');
            const effectId =
                optionalScalarString(effect['effectId']) ??
                `${decisionId ?? 'terminal-auto'}:effect:${effectIndex}:replan_after_turn_failure`;
            return {
                recoveryAttemptId: `${decisionId ?? 'terminal-auto'}:recovery:${index}:${failureKind}`,
                decisionId,
                effectId,
                routeProfile,
                selectedRouteKey,
                recoveryScope,
                failureKind,
                accountWideFailure: effect['accountWideFailure'] === true,
                status: applied ? 'applied' : (skippedReason ?? 'skipped'),
                applied,
                timestamp,
                source: options.source ?? 'terminal-byok-auto-recovery',
                effect,
            };
        });
}

/**
 * @param {Awaited<ReturnType<typeof buildTerminalByokGatewayAutoStatus>>} status
 * @param {Awaited<ReturnType<typeof applyTerminalByokGatewayAutoEffects>>} application
 * @param {{ source?: string; timestamp?: string }} [options]
 * @returns {Promise<{
 *     automationEffectApplications: number;
 *     recoveryAttempts: number;
 *     sdkSessionHandoffs: number;
 * } | null>}
 */
export async function persistTerminalByokGatewayAutoEffectApplications(status, application, options = {}) {
    const records = createTerminalByokGatewayAutoEffectApplicationRecords(status, application, options);
    const recoveryAttempts = createTerminalByokGatewayRecoveryAttemptRecords(status, application, options);
    const handoffs = createTerminalByokGatewaySdkSessionHandoffRecords(status, application, options);
    if (records.length === 0 && recoveryAttempts.length === 0 && handoffs.length === 0) return null;
    const store = new SqliteModelGatewayCatalogStore();
    const effectResult =
        records.length > 0
            ? await store.writeAutomationEffectApplicationRecords(records)
            : { automationEffectApplications: 0 };
    const recoveryResult =
        recoveryAttempts.length > 0
            ? await store.writeRecoveryAttemptRecords(recoveryAttempts)
            : { recoveryAttempts: 0 };
    const handoffResult =
        handoffs.length > 0 ? await store.writeSdkSessionHandoffRecords(handoffs) : { sdkSessionHandoffs: 0 };
    return {
        automationEffectApplications: effectResult.automationEffectApplications,
        recoveryAttempts: recoveryResult.recoveryAttempts,
        sdkSessionHandoffs: handoffResult.sdkSessionHandoffs,
    };
}

/**
 * @param {{ env?: NodeJS.ProcessEnv; catalogStore?: JsonModelGatewayCatalogStore }} [options]
 * @returns {Promise<{
 *     ran: boolean;
 *     policy: Awaited<ReturnType<typeof readModelGatewayRuntimeAutomationEffectivePolicy>>;
 *     status: Awaited<ReturnType<typeof buildTerminalByokGatewayAutoStatus>> | null;
 *     application: Awaited<ReturnType<typeof applyTerminalByokGatewayAutoEffects>> | null;
 *     effectPersistence: {
 *         automationEffectApplications: number;
 *         recoveryAttempts: number;
 *         sdkSessionHandoffs: number;
 *     } | null;
 * }>}
 */
export async function runTerminalByokGatewayPreTurnAutomation(options = {}) {
    const envOptions = options.env ? { env: options.env } : {};
    const catalogOptions = options.catalogStore ? { catalogStore: options.catalogStore } : {};
    const policy = await readModelGatewayRuntimeAutomationEffectivePolicy(envOptions);
    if (policy.enabled !== true) {
        return {
            ran: false,
            policy,
            status: null,
            application: null,
            effectPersistence: null,
        };
    }
    const profile = policy.profiles[0] ?? 'repo_agent';
    const status = await buildTerminalByokGatewayAutoStatus([`profile:${profile}`], {
        allowEffects: true,
        ...catalogOptions,
        ...envOptions,
        persistAutomationDecision: true,
    });
    const application = await applyTerminalByokGatewayAutoEffects(status.controllerStep);
    const effectPersistence = await persistTerminalByokGatewayAutoEffectApplications(status, application, {
        source: 'terminal-byok-pre-turn',
    });
    return {
        ran: true,
        policy,
        status,
        application,
        effectPersistence,
    };
}

/**
 * @param {{
 *     profile?: string | null;
 *     provider?: string | null;
 *     model?: string | null;
 *     failureKind?: string | null;
 *     message?: string | null;
 *     errorContext?: string | null;
 *     failureStatusCode?: number | string | null;
 *     retryAfterSeconds?: number | string | null;
 *     resetAt?: string | number | Date | null;
 * }} [turnFailure]
 * @param {{ env?: NodeJS.ProcessEnv; catalogStore?: JsonModelGatewayCatalogStore }} [options]
 * @returns {Promise<{
 *     ran: boolean;
 *     policy: Awaited<ReturnType<typeof readModelGatewayRuntimeAutomationEffectivePolicy>>;
 *     status: Awaited<ReturnType<typeof buildTerminalByokGatewayAutoStatus>> | null;
 *     controllerStep: ReturnType<typeof buildModelGatewayRuntimeAutomationControllerStep> | null;
 *     application: Awaited<ReturnType<typeof applyTerminalByokGatewayAutoEffects>> | null;
 *     effectPersistence: {
 *         automationEffectApplications: number;
 *         recoveryAttempts: number;
 *         sdkSessionHandoffs: number;
 *     } | null;
 *     healthPersistence: {
 *         recorded: boolean;
 *         providerId: string | null;
 *         providerModel: string | null;
 *         routeProfile: string | null;
 *         failureKind: string;
 *         sqlite: Awaited<ReturnType<typeof flushAndMirrorByokProviderHealthToSqlite>> | null;
 *     } | null;
 * }>}
 */
export async function runTerminalByokGatewayPostTurnAutomation(turnFailure = {}, options = {}) {
    const envOptions = options.env ? { env: options.env } : {};
    const catalogOptions = options.catalogStore ? { catalogStore: options.catalogStore } : {};
    const policy = await readModelGatewayRuntimeAutomationEffectivePolicy(envOptions);
    if (policy.enabled !== true) {
        return {
            ran: false,
            policy,
            status: null,
            controllerStep: null,
            application: null,
            effectPersistence: null,
            healthPersistence: null,
        };
    }
    const profile = optionalScalarString(turnFailure.profile) ?? policy.profiles[0] ?? 'repo_agent';
    const status = await buildTerminalByokGatewayAutoStatus([`profile:${profile}`], {
        allowEffects: true,
        ...catalogOptions,
        ...envOptions,
        persistAutomationDecision: true,
        turnFailure: {
            profile,
            provider: optionalScalarString(turnFailure.provider),
            model: optionalScalarString(turnFailure.model),
            failureKind: optionalScalarString(turnFailure.failureKind),
            message: optionalScalarString(turnFailure.message),
            errorContext: optionalScalarString(turnFailure.errorContext),
            failureStatusCode: optionalFiniteNumber(turnFailure.failureStatusCode),
            retryAfterSeconds: optionalFiniteNumber(turnFailure.retryAfterSeconds),
            resetAt: optionalIsoTimestamp(turnFailure.resetAt),
        },
    });
    const healthFailure = resolvePostTurnHealthFailure(status, /** @type {Record<string, unknown>} */ (turnFailure));
    let healthPersistence;
    if (healthFailure.providerId && healthFailure.providerModel) {
        recordByokProviderModelCallFailure({
            routeProfile: healthFailure.routeProfile,
            providerId: healthFailure.providerId,
            providerModel: healthFailure.providerModel,
            failureKind: healthFailure.failureKind,
            message: healthFailure.message,
            errorContext: healthFailure.errorContext,
            failureStatusCode: healthFailure.failureStatusCode,
            retryAfterSeconds: healthFailure.retryAfterSeconds,
            resetAt: healthFailure.resetAt,
        });
        const sqliteStore = new SqliteModelGatewayCatalogStore();
        const sqlite = await flushAndMirrorByokProviderHealthToSqlite({ sqliteStore });
        healthPersistence = {
            recorded: true,
            providerId: healthFailure.providerId,
            providerModel: healthFailure.providerModel,
            routeProfile: healthFailure.routeProfile,
            failureKind: healthFailure.failureKind,
            sqlite,
        };
    } else {
        healthPersistence = {
            recorded: false,
            providerId: healthFailure.providerId,
            providerModel: healthFailure.providerModel,
            routeProfile: healthFailure.routeProfile,
            failureKind: healthFailure.failureKind,
            sqlite: null,
        };
    }
    const controllerStep = buildModelGatewayRuntimeAutomationControllerStep({
        phase: 'post_turn',
        decision: status.decision,
        policy: {
            allowEffects: true,
            allowLiveSetModel: status.args.allowLiveSetModel,
            allowNewSession: status.args.allowNewSession,
            accountWideFailureKinds: policy.accountWideFailureKinds,
        },
        turnOutcome: {
            ok: false,
            failureKind: optionalScalarString(turnFailure.failureKind),
            errorMessage: optionalScalarString(turnFailure.message) ?? optionalScalarString(turnFailure.errorContext),
        },
    });
    const application = await applyTerminalByokGatewayAutoEffects(controllerStep);
    const effectPersistence = await persistTerminalByokGatewayAutoEffectApplications(
        { ...status, controllerStep },
        application,
        {
            source: 'terminal-byok-post-turn',
        },
    );
    return {
        ran: true,
        policy,
        status,
        controllerStep,
        application,
        effectPersistence,
        healthPersistence,
    };
}
