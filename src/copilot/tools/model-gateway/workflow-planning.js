// @ts-check
/**
 * Pure planning helpers shared by the Model Gateway LLM-B workflow tool.
 *
 * This module deliberately contains no tool registration and no mutable runtime control. It converts catalog/read-plane
 * evidence into stable candidate chains, proof-aware selection decisions and idempotent workflow steps.
 *
 * @module copilot/tools/model-gateway/workflow-planning
 */

import { DEFAULT_MODEL_GATEWAY_RUNTIME_PROOF_WEIGHTS } from '#copilot/model-gateway';

/** @typedef {'probe_required' | 'use_current' | 'switch_recommended' | 'blocked'} WorkflowSelectionStatus */
/** @typedef {Record<string, any> & { status: WorkflowSelectionStatus }} WorkflowSelectionDecision */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function optionalWorkflowString(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    const sentinel = text.toLowerCase();
    if (
        !text ||
        sentinel === '__unset__' ||
        sentinel === '__none__' ||
        sentinel === '__null__' ||
        sentinel === 'null' ||
        sentinel === 'undefined' ||
        sentinel === 'none' ||
        sentinel === 'n/a' ||
        sentinel === 'na'
    ) {
        return null;
    }
    return text;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function cleanWorkflowKeyPart(value) {
    const cleaned = String(value ?? 'none')
        .replace(/[^A-Za-z0-9._:-]+/gu, '-')
        .replace(/-+/gu, '-')
        .replace(/^-|-$/gu, '');
    return cleaned || 'none';
}

/**
 * @param {string} prefix
 * @param {string} suffix
 * @returns {string}
 */
export function workflowIdempotencyKey(prefix, suffix) {
    return `${prefix}:${cleanWorkflowKeyPart(suffix)}`.slice(0, 200);
}

/**
 * @param {Record<string, unknown>} result
 * @returns {Record<string, unknown>}
 */
export function operationData(result) {
    return asRecord(result['data']);
}

/**
 * @param {Record<string, unknown>} result
 * @returns {string[]}
 */
export function resultWarnings(result) {
    return Array.isArray(result['warnings']) ? result['warnings'].map(String) : [];
}

/**
 * @param {unknown} goal
 * @returns {Record<string, unknown>}
 */
export function selectionGoalRouteOptions(goal) {
    switch (goal) {
        case 'quality_first':
            return {
                pricePenaltyWeight: 0,
                latencyPenaltyWeight: 0.2,
                runtimeProofWeights: {
                    ...DEFAULT_MODEL_GATEWAY_RUNTIME_PROOF_WEIGHTS,
                    chatHealthOk: 0,
                    agentProbeVerified: 0,
                    genericProbeVerified: 0,
                    preferredProbeVerified: 0,
                    preferredLiveProtocolProbeVerified: 0,
                    exactRouteProfileProof: 0,
                    runtimeProvedPreference: 0,
                },
            };
        case 'reliability_first':
            return { pricePenaltyWeight: 0.25, latencyPenaltyWeight: 0.35 };
        case 'latency_first':
            return { pricePenaltyWeight: 0.5, latencyPenaltyWeight: 2 };
        case 'cost_first':
            return { pricePenaltyWeight: 2, latencyPenaltyWeight: 0.5 };
        default:
            return { pricePenaltyWeight: 1, latencyPenaltyWeight: 1 };
    }
}

/**
 * @param {unknown} policy
 * @returns {Record<string, boolean>}
 */
export function routeProofPolicyOptions(policy) {
    if (policy === 'metadata_only') return { requireAgentProbeOk: false, requireRuntimeProof: false };
    if (policy === 'fresh_runtime_required') return { requireRuntimeProof: true };
    return {};
}

/**
 * @param {Record<string, unknown>} selectedRoute
 * @returns {Record<string, unknown> | null}
 */
export function normalizeWorkflowRoute(selectedRoute) {
    const providerId = optionalWorkflowString(selectedRoute['providerId']);
    const providerModel = optionalWorkflowString(selectedRoute['providerModel']);
    if (!providerId || !providerModel) return null;
    return {
        providerId,
        providerModel,
        providerType: optionalWorkflowString(selectedRoute['providerType']),
        selectorSyntax: optionalWorkflowString(selectedRoute['selectorSyntax']),
        baseUrl: optionalWorkflowString(selectedRoute['baseUrl']),
        openAICompatibleBaseUrl: optionalWorkflowString(selectedRoute['openAICompatibleBaseUrl']),
        openAICompatible: selectedRoute['openAICompatible'] === true,
        wireApi: optionalWorkflowString(selectedRoute['wireApi']),
        providerProfile: optionalWorkflowString(selectedRoute['providerProfile']),
        routeProfile: optionalWorkflowString(selectedRoute['routeProfile']),
        selectedRouteKey: optionalWorkflowString(selectedRoute['selectedRouteKey']),
        bindingStrategy: optionalWorkflowString(selectedRoute['bindingStrategy']),
        sdkRouteKey: optionalWorkflowString(selectedRoute['sdkRouteKey']),
        sdkVisibleModel: optionalWorkflowString(selectedRoute['sdkVisibleModel']),
        directRebindReliability: optionalWorkflowString(selectedRoute['directRebindReliability']),
        directRebindSupported:
            typeof selectedRoute['directRebindSupported'] === 'boolean' ? selectedRoute['directRebindSupported'] : null,
        directRebindReliable:
            typeof selectedRoute['directRebindReliable'] === 'boolean' ? selectedRoute['directRebindReliable'] : null,
        bindingDecision:
            Object.keys(asRecord(selectedRoute['bindingDecision'])).length > 0
                ? asRecord(selectedRoute['bindingDecision'])
                : null,
    };
}

/**
 * @param {number} order
 * @param {string} id
 * @param {string} tool
 * @param {string} mode
 * @param {string} purpose
 * @param {Record<string, unknown>} args
 * @param {string[]} [requires]
 * @returns {Record<string, unknown>}
 */
export function workflowStep(order, id, tool, mode, purpose, args, requires = []) {
    return {
        order,
        id,
        tool,
        mode,
        purpose,
        args,
        requires,
        confirmationRequired: mode === 'apply',
    };
}

/**
 * @param {Record<string, any>} candidate
 * @param {number} rank
 * @returns {Record<string, any> | null}
 */
function normalizeWorkflowCandidate(candidate, rank) {
    const providerId = optionalWorkflowString(candidate['providerId']);
    const providerModel = optionalWorkflowString(candidate['providerModel']) ?? optionalWorkflowString(candidate['id']);
    if (!providerId || !providerModel) return null;
    const probes = asRecord(candidate['probes']);
    const freshProof = probes['freshProof'] === true;
    const historicalProof = probes['historicalProof'] === true;
    const stale = probes['stale'] === true;
    const failedProbes = Array.isArray(probes['failedProbes']) ? probes['failedProbes'].map(String) : [];
    return {
        rank,
        id: optionalWorkflowString(candidate['id']) ?? `${providerId}:${providerModel}`,
        providerId,
        providerModel,
        score: typeof candidate['score'] === 'number' ? candidate['score'] : null,
        proofState: freshProof ? 'fresh_proved' : stale ? 'historical_stale' : 'unproved',
        freshProof,
        historicalProof,
        stale,
        proofAgeMs: typeof probes['proofAgeMs'] === 'number' ? probes['proofAgeMs'] : null,
        failedProbes,
        positiveReasons: Array.isArray(candidate['positiveReasons']) ? candidate['positiveReasons'].map(String) : [],
        rejectedReasons: Array.isArray(candidate['rejectedReasons']) ? candidate['rejectedReasons'].map(String) : [],
    };
}

/**
 * @param {Record<string, any>} routeData
 * @param {{ candidateModelIds?: string[]; providerId?: string | null; maxCandidates: number; probeStrategy?: string }} input
 * @returns {Record<string, any>[]}
 */
export function buildWorkflowProbeCandidateChain(routeData, input) {
    const routeCandidates = Array.isArray(routeData['candidates'])
        ? routeData['candidates']
              .map((candidate, index) => normalizeWorkflowCandidate(asRecord(candidate), index + 1))
              .filter((candidate) => candidate !== null)
        : [];
    const explicitIds = Array.isArray(input.candidateModelIds) ? input.candidateModelIds.map(String) : [];
    /** @type {Record<string, any>[]} */
    let candidates = routeCandidates;
    if (explicitIds.length > 0) {
        const byId = new Map();
        for (const candidate of routeCandidates) {
            byId.set(String(candidate['id']), candidate);
            byId.set(String(candidate['providerModel']), candidate);
        }
        candidates = explicitIds
            .map((id, index) => {
                const matched = byId.get(id);
                if (matched) return { ...matched, rank: index + 1 };
                const providerId = optionalWorkflowString(input.providerId);
                return providerId
                    ? {
                          rank: index + 1,
                          id: `${providerId}:${id}`,
                          providerId,
                          providerModel: id,
                          score: null,
                          proofState: 'unproved',
                          freshProof: false,
                          historicalProof: false,
                          stale: false,
                          proofAgeMs: null,
                          failedProbes: [],
                          positiveReasons: ['explicit_candidate'],
                          rejectedReasons: [],
                      }
                    : null;
            })
            .filter((candidate) => candidate !== null);
    }
    const unique = [];
    const seen = new Set();
    for (const candidate of candidates) {
        const key = `${candidate['providerId']}:${candidate['providerModel']}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(candidate);
    }
    const strategyLimit = input.probeStrategy === 'minimal' ? 1 : input.probeStrategy === 'aggressive' ? 5 : 3;
    return unique.slice(0, Math.min(input.maxCandidates, strategyLimit));
}

/**
 * @param {{
 *   runtimeId?: string | null;
 *   taskProfile: string;
 *   selectionGoal: string;
 *   requireRuntimeProof: boolean;
 *   maxRuntimeProofAgeHours: number;
 *   currentModel: string | null;
 *   discoveryRoute: Record<string, any> | null;
 *   provedRoute: Record<string, any> | null;
 *   candidates: Record<string, any>[];
 * }} input
 * @returns {WorkflowSelectionDecision}
 */
export function buildWorkflowSelectionDecision(input) {
    const discoveryCandidate = input.candidates[0] ?? null;
    const discoveryProvider = optionalWorkflowString(discoveryCandidate?.['providerId']);
    const discoveryModel = optionalWorkflowString(discoveryCandidate?.['providerModel']);
    const provedProvider = optionalWorkflowString(input.provedRoute?.['providerId']);
    const provedModel = optionalWorkflowString(input.provedRoute?.['providerModel']);
    const discoveryMatchesProved =
        discoveryProvider !== null &&
        discoveryModel !== null &&
        discoveryProvider === provedProvider &&
        discoveryModel === provedModel;
    const currentMatchesProved = provedModel !== null && input.currentModel === provedModel;
    const betterDiscoveryNeedsProof =
        input.requireRuntimeProof && discoveryCandidate !== null && !discoveryMatchesProved;
    const status = betterDiscoveryNeedsProof
        ? 'probe_required'
        : input.provedRoute
          ? currentMatchesProved
              ? 'use_current'
              : 'switch_recommended'
          : discoveryCandidate
            ? 'probe_required'
            : 'blocked';
    const confidence =
        status === 'use_current' || status === 'switch_recommended' ? 'high' : discoveryCandidate ? 'medium' : 'low';
    const nextAction =
        status === 'use_current'
            ? 'continue_with_current_route'
            : status === 'switch_recommended'
              ? 'plan_same_session_switch'
              : status === 'probe_required'
                ? 'probe_current_top_candidate_then_rerun_workflow'
                : 'refresh_catalog_or_relax_hard_constraints';
    const provedCandidate =
        input.candidates.find(
            (candidate) =>
                optionalWorkflowString(candidate?.['providerId']) === provedProvider &&
                optionalWorkflowString(candidate?.['providerModel']) === provedModel,
        ) ?? null;
    /** @param {Record<string, any> | null | undefined} candidate */
    const proofAgeHours = (candidate) => {
        const proofAgeMs = typeof candidate?.['proofAgeMs'] === 'number' ? candidate['proofAgeMs'] : null;
        return proofAgeMs === null ? null : Math.round((proofAgeMs / (60 * 60 * 1000)) * 10) / 10;
    };
    /** @param {Record<string, any> | null | undefined} candidate */
    const explainCandidate = (candidate) =>
        candidate
            ? {
                  rank: typeof candidate['rank'] === 'number' ? candidate['rank'] : null,
                  providerId: optionalWorkflowString(candidate['providerId']),
                  model: optionalWorkflowString(candidate['providerModel']),
                  score: typeof candidate['score'] === 'number' ? candidate['score'] : null,
                  proofState: optionalWorkflowString(candidate['proofState']) ?? 'unproved',
                  proofAgeHours: proofAgeHours(candidate),
                  recentFailedProbes: Array.isArray(candidate['failedProbes'])
                      ? candidate['failedProbes'].map(String)
                      : [],
              }
            : null;
    const headline =
        status === 'use_current'
            ? 'A rota atual já é a melhor opção com prova funcional fresca para esta tarefa.'
            : status === 'switch_recommended'
              ? 'Há uma rota melhor já comprovada; a próxima etapa é promover essa rota preservando a mesma sessão.'
              : status === 'probe_required'
                ? 'A melhor candidata por qualidade ainda precisa de prova funcional fresca antes de qualquer troca.'
                : 'Nenhuma rota elegível está pronta para uso; é necessário resolver o bloqueio antes de selecionar.';
    const why =
        status === 'probe_required'
            ? `O ranking ${input.selectionGoal} prefere ${discoveryProvider ?? 'provider desconhecido'}/${discoveryModel ?? 'modelo desconhecido'}, mas ela ainda não satisfaz o contrato de prova fresca de ${input.maxRuntimeProofAgeHours}h.`
            : status === 'switch_recommended'
              ? `${provedProvider ?? 'O provider vencedor'}/${provedModel ?? 'o modelo vencedor'} já satisfaz o contrato runtime e supera a rota atual para o perfil ${input.taskProfile}.`
              : status === 'use_current'
                ? `A rota atual ${provedProvider ?? 'provider atual'}/${provedModel ?? input.currentModel ?? 'modelo atual'} satisfaz o contrato runtime e continua no topo do ranking ${input.selectionGoal}.`
                : `O discovery ranking não encontrou candidata elegível para o perfil ${input.taskProfile} sob as restrições atuais.`;
    const operatorExplanation = {
        language: 'pt-BR',
        headline,
        current: {
            model: input.currentModel,
            alreadyBestFreshlyProved: currentMatchesProved,
        },
        discoveryBest: explainCandidate(discoveryCandidate),
        freshlyProvedBest: provedModel
            ? {
                  providerId: provedProvider,
                  model: provedModel,
                  proofState: optionalWorkflowString(provedCandidate?.['proofState']) ?? 'fresh_proved',
                  proofAgeHours: proofAgeHours(provedCandidate),
              }
            : null,
        why,
        next:
            status === 'use_current'
                ? 'Continue na rota atual; não há mutação a fazer.'
                : status === 'switch_recommended'
                  ? 'Planeje e aplique a troca same-session usando exatamente a rota retornada pelo workflow.'
                  : status === 'probe_required'
                    ? 'Sonde somente a candidata #1 atual; depois descarte este ranking e execute o workflow novamente, independentemente de sucesso ou falha.'
                    : 'Inspecione blockers, catálogo e credenciais; não enfraqueça restrições silenciosamente.',
        alternatives: input.candidates.slice(0, 4).map(explainCandidate).filter((candidate) => candidate !== null),
    };
    return {
        status,
        confidence,
        taskProfile: input.taskProfile,
        selectionGoal: input.selectionGoal,
        currentModel: input.currentModel,
        selectedRoute: input.provedRoute,
        discoveryBestRoute: input.discoveryRoute,
        nextCandidate: status === 'probe_required' ? discoveryCandidate : null,
        runtimeProofRequired: input.requireRuntimeProof,
        runtimeProofMaxAgeHours: input.maxRuntimeProofAgeHours,
        candidateChain: input.candidates,
        operatorExplanation,
        rationale: [
            input.selectionGoal === 'quality_first'
                ? 'quality_first:price_penalty_disabled'
                : `selection_goal:${input.selectionGoal}`,
            betterDiscoveryNeedsProof
                ? 'higher_ranked_discovery_candidate_requires_fresh_functional_proof'
                : input.provedRoute
                  ? 'best_discovery_candidate_has_fresh_functional_proof'
                  : discoveryCandidate
                    ? 'best_metadata_candidate_requires_fresh_functional_proof'
                    : 'no_eligible_discovery_candidate',
            currentMatchesProved ? 'current_route_already_best_proved' : 'same_session_continuity_required',
        ],
        nextAction,
    };
}

/**
 * @param {unknown} objective
 * @returns {string | null}
 */
export function guideObjectivePhase(objective) {
    switch (objective) {
        case 'overview':
            return 'readiness';
        case 'catalog':
            return 'catalog';
        case 'route':
            return 'route';
        case 'probe':
            return 'runtime-proof';
        case 'same_session_switch':
        case 'runtime_reconcile':
            return 'same-session-runtime';
        case 'profile':
            return 'byok-profile';
        case 'live_validation':
            return 'operations';
        default:
            return null;
    }
}
