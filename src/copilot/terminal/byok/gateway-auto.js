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
    readModelGatewayRuntimeAutomationEffectivePolicy,
    readModelGatewayRuntimeAutomationPolicy,
    resolveModelGatewaySelectionPolicy,
    SqliteModelGatewayCatalogStore,
} from '#copilot/model-gateway';

import {
    listTerminalSdkSessionInventory,
    scheduleTerminalSdkSessionBootSelection,
    setTerminalModelProjection,
} from '../frontend/index.js';

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
 * @param {{ env?: NodeJS.ProcessEnv; policy?: ReturnType<typeof readModelGatewayRuntimeAutomationPolicy> }} [options]
 * @returns {{ profileId: string; allowLiveSetModel: boolean; allowNewSession: boolean; allowLocalPrivate: boolean }}
 */
export function parseTerminalByokGatewayAutoArgs(rest, options = {}) {
    const policy = options.policy ?? readModelGatewayRuntimeAutomationPolicy(options.env);
    const profileToken = rest.find((item) => /^(?:profile|perfil|routeProfile|route-profile)[:=]/iu.test(item));
    const profileId =
        optionalScalarString(profileToken?.replace(/^(?:profile|perfil|routeProfile|route-profile)[:=]/iu, '')) ??
        policy.profiles[0] ??
        optionalScalarString(rest.find((item) => !/^(auto|status|plan|apply|on|off|history|--|allow-|live-|new-session|local)/iu.test(item))) ??
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
 * @param {{ allowEffects?: boolean; catalogPath?: string; env?: NodeJS.ProcessEnv; persistAutomationDecision?: boolean }} [options]
 * @returns {Promise<{
 *     schema: 'terminal-byok-gateway-auto-status';
 *     args: ReturnType<typeof parseTerminalByokGatewayAutoArgs>;
 *     runtimeSelectorPlan: ReturnType<typeof buildModelGatewayRuntimeSelectorPlan>;
 *     inventory: Awaited<ReturnType<typeof listTerminalSdkSessionInventory>>;
 *     decision: ReturnType<typeof buildModelGatewayRuntimeAutomationDecision>;
 *     controllerStep: ReturnType<typeof buildModelGatewayRuntimeAutomationControllerStep>;
 *     automationDecisionRecord: Record<string, unknown>;
 *     persistence: { automationDecisions: number } | null;
 * }>}
 */
export async function buildTerminalByokGatewayAutoStatus(rest, options = {}) {
    const policy = await readModelGatewayRuntimeAutomationEffectivePolicy({ env: options.env });
    const args = parseTerminalByokGatewayAutoArgs(rest, { env: options.env, policy });
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
    const persistence =
        options.persistAutomationDecision === true
            ? await new SqliteModelGatewayCatalogStore().writeAutomationDecisionRecords([automationDecisionRecord])
            : null;
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
 * @param {{ effects?: Array<Record<string, unknown>> }} controllerStep
 * @returns {Promise<{ applied: Array<Record<string, unknown>>; skipped: Array<Record<string, unknown>> }>}
 */
export async function applyTerminalByokGatewayAutoEffects(controllerStep) {
    const effects = Array.isArray(controllerStep.effects) ? controllerStep.effects : [];
    const applied = [];
    const skipped = [];
    for (const effect of effects) {
        if (effect['execute'] !== true) {
            skipped.push({ ...effect, skippedReason: 'effect_not_authorized' });
            continue;
        }
        if (effect['kind'] === 'set_live_model' && typeof effect['model'] === 'string' && effect['model'].trim()) {
            setTerminalModelProjection(effect['model']);
            applied.push({ ...effect, applied: true });
            continue;
        }
        if (effect['kind'] === 'prepare_new_sdk_session') {
            const schedule = await scheduleTerminalSdkSessionBootSelection({ mode: 'new' });
            if (schedule?.ok === true) {
                applied.push({ ...effect, applied: true, sdkBootSelection: 'new' });
                continue;
            }
            skipped.push({
                ...effect,
                skippedReason: 'sdk_boot_selection_failed',
                error: schedule?.error instanceof Error ? schedule.error.message : 'unknown_error',
            });
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
 * @returns {Promise<{ automationEffectApplications: number; sdkSessionHandoffs: number } | null>}
 */
export async function persistTerminalByokGatewayAutoEffectApplications(status, application, options = {}) {
    const records = createTerminalByokGatewayAutoEffectApplicationRecords(status, application, options);
    const handoffs = createTerminalByokGatewaySdkSessionHandoffRecords(status, application, options);
    if (records.length === 0 && handoffs.length === 0) return null;
    const store = new SqliteModelGatewayCatalogStore();
    const effectResult =
        records.length > 0
            ? await store.writeAutomationEffectApplicationRecords(records)
            : { automationEffectApplications: 0 };
    const handoffResult =
        handoffs.length > 0 ? await store.writeSdkSessionHandoffRecords(handoffs) : { sdkSessionHandoffs: 0 };
    return {
        automationEffectApplications: effectResult.automationEffectApplications,
        sdkSessionHandoffs: handoffResult.sdkSessionHandoffs,
    };
}

/**
 * @param {{ env?: NodeJS.ProcessEnv; catalogPath?: string }} [options]
 * @returns {Promise<{
 *   ran: boolean;
 *   policy: Awaited<ReturnType<typeof readModelGatewayRuntimeAutomationEffectivePolicy>>;
 *   status: Awaited<ReturnType<typeof buildTerminalByokGatewayAutoStatus>> | null;
 *   application: Awaited<ReturnType<typeof applyTerminalByokGatewayAutoEffects>> | null;
 *   effectPersistence: { automationEffectApplications: number; sdkSessionHandoffs: number } | null;
 * }>}
 */
export async function runTerminalByokGatewayPreTurnAutomation(options = {}) {
    const policy = await readModelGatewayRuntimeAutomationEffectivePolicy({ env: options.env });
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
        catalogPath: options.catalogPath,
        env: options.env,
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
