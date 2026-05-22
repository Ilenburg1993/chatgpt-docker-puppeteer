// @ts-check
/**
 * @file Gateway: sdk-session.
 *
 *   Wraps all SDK session operations (mode, plan, models, tools, quota, workspace files, compaction, elicitations and UI
 *   interactions). Isolates `presentation/runtime/index.js`.
 */

import {
    classifyPermissionDecision,
    classifyUserInputQuestionKind,
    createStaticInputHandler,
    getPendingStructuredUserInputCount,
    getPendingStructuredUserInputRequests,
    hasPendingStructuredUserInputRequests,
    normalizeElicitationCompletedEvent,
    normalizeElicitationPendingEvent,
    normalizePermissionCompletedEvent,
    normalizePermissionRequestedEvent,
    normalizeUserInputCompletedEvent,
    normalizeUserInputRequestedEvent,
    createPermissionHandler,
    onSessionEvents,
    readConfiguredByokState,
    resolveConfiguredByokSessionOverrides,
    sendSessionAndWait,
    withEphemeralSession,
} from '#copilot/sdk/session';
import { createTool } from '#copilot/sdk/tools';
import { evaluateTerminalByokProbeBudget } from '../../byok/admission.js';
import { classifyTerminalByokProviderFailure } from '../../byok/provider-failure.js';
import {
    compactAgentSdkSession,
    confirmAgentSdkSessionUi,
    createAgentSdkWorkspaceFile,
    deleteAgentSdkSession,
    deleteAgentSdkPlan,
    getAgentSdkPendingElicitation,
    getAgentSdkQuota,
    getAgentSdkSessionCapabilities,
    getAgentSdkSessionMode,
    getAgentSdkUsageMetrics,
    handleAgentSdkPendingPermission,
    inputAgentSdkSessionUi,
    isAgentSdkSessionUiElicitationAvailable,
    listAgentSdkModels,
    listAgentSdkPendingElicitations,
    listAgentSdkPendingPermissions,
    listAgentSdkSkills,
    listAgentSdkTools,
    listAgentSdkWorkspaceFiles,
    loginAgentSdkMcpOauth,
    readAgentSdkSessionBootSelection,
    readAgentSdkPlan,
    readAgentSdkSkillsGovernance,
    readAgentSdkSystemPromptProjection,
    readAgentSdkWorkspaceFile,
    requestAgentSdkElicitation,
    resetAgentSdkSessionApprovals,
    resolveAgentSdkPendingElicitation,
    selectAgentSdkSessionUi,
    setAgentSdkDisabledSkills,
    listAgentSdkSessionInventory,
    scheduleAgentSdkSessionBootSelection,
    setAgentSdkSessionMode,
    updateAgentSdkPlan,
} from '../../../presentation/runtime/index.js';

// ---------------------------------------------------------------------------
// Vanilla session helpers exposed as terminal-owned semantics
// ---------------------------------------------------------------------------

/**
 * @returns {number}
 */
export function getTerminalPendingStructuredUserInputCount() {
    return getPendingStructuredUserInputCount();
}

/**
 * @returns {ReturnType<typeof getPendingStructuredUserInputRequests>}
 */
export function listTerminalPendingStructuredUserInputs() {
    return getPendingStructuredUserInputRequests();
}

/**
 * @returns {boolean}
 */
export function hasTerminalPendingStructuredUserInputRequests() {
    return hasPendingStructuredUserInputRequests();
}

/**
 * @param {string | null | undefined} kind
 * @param {boolean | null | undefined} granted
 * @returns {ReturnType<typeof classifyPermissionDecision>}
 */
export function classifyTerminalPermissionDecision(kind, granted) {
    return classifyPermissionDecision(kind, granted);
}

/**
 * @param {unknown} evt
 * @returns {ReturnType<typeof normalizeElicitationPendingEvent>}
 */
export function normalizeTerminalElicitationPendingEvent(evt) {
    return normalizeElicitationPendingEvent(evt);
}

/**
 * @param {unknown} evt
 * @returns {ReturnType<typeof normalizeElicitationCompletedEvent>}
 */
export function normalizeTerminalElicitationCompletedEvent(evt) {
    return normalizeElicitationCompletedEvent(evt);
}

/**
 * @param {unknown} evt
 * @returns {ReturnType<typeof normalizePermissionRequestedEvent>}
 */
export function normalizeTerminalPermissionRequestedEvent(evt) {
    return normalizePermissionRequestedEvent(evt);
}

/**
 * @param {unknown} evt
 * @returns {ReturnType<typeof normalizePermissionCompletedEvent>}
 */
export function normalizeTerminalPermissionCompletedEvent(evt) {
    return normalizePermissionCompletedEvent(evt);
}

/**
 * @param {unknown} evt
 * @returns {ReturnType<typeof normalizeUserInputRequestedEvent>}
 */
export function normalizeTerminalUserInputRequestedEvent(evt) {
    return normalizeUserInputRequestedEvent(evt);
}

/**
 * @param {unknown} evt
 * @returns {ReturnType<typeof normalizeUserInputCompletedEvent>}
 */
export function normalizeTerminalUserInputCompletedEvent(evt) {
    return normalizeUserInputCompletedEvent(evt);
}

/**
 * @param {string} question
 * @returns {ReturnType<typeof classifyUserInputQuestionKind>}
 */
export function classifyTerminalUserInputQuestionKind(question) {
    return classifyUserInputQuestionKind(question);
}

/**
 * Executa um chat canário em uma sessão SDK descartável com o provider/modelo BYOK resolvido.
 *
 * Esta sonda usa o mesmo `ProviderConfig` e o mesmo client SDK do runtime, mas não entra no dialog loop, não registra
 * transcript do operador e nega permissões. Serve para separar "modelo aparece no catálogo" de "chat real responde".
 *
 * @param {{ env?: Record<string, string | undefined>; model?: string | null; timeoutMs?: number; prompt?: string }} [options]
 * @returns {Promise<{
 *     ok: boolean;
 *     status: 'ok' | 'unavailable' | 'admission-blocked' | 'empty' | 'failed';
 *     elapsedMs: number;
 *     model: string | null;
 *     profile: string | null;
 *     preset: string | null;
 *     providerType: string | null;
 *     deltaCount: number;
 *     deltaChars: number;
 *     finalChars: number;
 *     observedFinalEvent: boolean;
 *     sessionId: string | null;
 *     errors: string[];
 *     warnings: string[];
 *     providerFailure?: import('../../byok/provider-failure.js').TerminalByokProviderFailure | null;
 * }>}
 */
export async function probeTerminalConfiguredByokChat(options = {}) {
    const env = options.env ?? process.env;
    const startedAt = Date.now();
    const byokState = readConfiguredByokState(env);
    if (!byokState.enabled || !byokState.ready || !byokState.provider || !byokState.model) {
        return {
            ok: false,
            status: 'unavailable',
            elapsedMs: Date.now() - startedAt,
            model: byokState.model ?? byokState.summary.model ?? null,
            profile: byokState.summary.profile ?? null,
            preset: byokState.summary.preset ?? null,
            providerType: byokState.summary.providerType ?? null,
            deltaCount: 0,
            deltaChars: 0,
            finalChars: 0,
            observedFinalEvent: false,
            sessionId: null,
            errors:
                byokState.errors.length > 0
                    ? [...byokState.errors]
                    : ['BYOK não está ativo/pronto para probe.'],
            warnings: [...byokState.warnings],
            providerFailure: null,
        };
    }
    const byok = resolveConfiguredByokSessionOverrides(env, options.model ?? undefined);
    const provider = byok.provider ?? byokState.provider;
    const model = byok.model ?? byokState.model;
    if (!provider || !model) {
        throw new Error('[terminal/byok-probe] Provider/modelo BYOK desapareceram durante a resolução do probe.');
    }
    const baseResult = {
        model: model ?? byok.summary.model ?? null,
        profile: byok.summary.profile ?? null,
        preset: byok.summary.preset ?? null,
        providerType: byok.summary.providerType ?? null,
        warnings: [...byok.summary.warnings],
    };

    const timeoutMs =
        typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
            ? Math.max(5_000, Math.min(120_000, Math.round(options.timeoutMs)))
            : 45_000;
    const prompt =
        options.prompt ??
        'Responda somente com o texto BYOK_PROBE_OK. Nao use ferramentas, nao peca mais contexto e nao explique.';
    const admission = evaluateTerminalByokProbeBudget(byok.summary, 'chat', prompt);
    if (admission.shouldBlock) {
        return {
            ok: false,
            status: 'admission-blocked',
            elapsedMs: Date.now() - startedAt,
            ...baseResult,
            deltaCount: 0,
            deltaChars: 0,
            finalChars: 0,
            observedFinalEvent: false,
            sessionId: null,
            errors: [admission.label],
            providerFailure: null,
        };
    }
    let deltaCount = 0;
    let deltaChars = 0;
    let finalContent = '';
    let observedFinalEvent = false;
    let sessionId = null;
    /** @type {string[]} */
    const errors = [];
    /** @type {import('../../byok/provider-failure.js').TerminalByokProviderFailure | null} */
    let providerFailure = null;

    try {
        await withEphemeralSession(
            {
                model,
                provider,
                ...(byok.modelCapabilities ? { modelCapabilities: byok.modelCapabilities } : {}),
                streaming: true,
                enableConfigDiscovery: false,
                includeSubAgentStreamingEvents: false,
                systemMessage: false,
                availableTools: [],
                onPermissionRequest: createPermissionHandler({ defaultDecision: 'deny' }),
            },
            async ({ session, sessionId: temporarySessionId }) => {
                sessionId = temporarySessionId;
                const unsubscribe = onSessionEvents(session, {
                    'assistant.message_delta': (event) => {
                        const delta = typeof event?.data?.deltaContent === 'string' ? event.data.deltaContent : '';
                        if (!delta) return;
                        deltaCount += 1;
                        deltaChars += delta.length;
                    },
                    'assistant.message': (event) => {
                        const content = typeof event?.data?.content === 'string' ? event.data.content : '';
                        if (!content) return;
                        observedFinalEvent = true;
                        finalContent = content;
                    },
                    'session.error': (event) => {
                        const message =
                            typeof event?.data?.message === 'string'
                                ? event.data.message
                                : typeof event?.data?.error === 'string'
                                  ? event.data.error
                                  : null;
                        if (message) {
                            errors.push(message);
                            providerFailure ??= classifyTerminalByokProviderFailure(message);
                        }
                    },
                });
                try {
                    const reply = await sendSessionAndWait(session, { prompt }, timeoutMs);
                    const content = typeof reply?.data?.content === 'string' ? reply.data.content : '';
                    if (content) finalContent = content;
                } finally {
                    unsubscribe();
                }
            },
        );
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        providerFailure ??= classifyTerminalByokProviderFailure(error);
        return {
            ok: false,
            status: 'failed',
            elapsedMs: Date.now() - startedAt,
            ...baseResult,
            deltaCount,
            deltaChars,
            finalChars: finalContent.length,
            observedFinalEvent,
            sessionId,
            errors,
            providerFailure,
        };
    }

    const finalChars = finalContent.length;
    const ok = finalChars > 0 || deltaChars > 0;
    return {
        ok,
        status: ok ? 'ok' : 'empty',
        elapsedMs: Date.now() - startedAt,
        ...baseResult,
        deltaCount,
        deltaChars,
        finalChars,
        observedFinalEvent,
        sessionId,
        errors: ok ? errors : [...errors, 'Probe concluiu sem delta nem mensagem final.'],
        providerFailure,
    };
}

const BYOK_AGENT_PROBE_TOOL = 'terminal_byok_probe_marker';
const BYOK_AGENT_PROBE_READ_TOOL = 'read_file_content';
const BYOK_AGENT_PROBE_READ_PATH = 'BYOK_AGENT_PROBE.md';
const BYOK_AGENT_PROBE_QUESTION = 'BYOK_AGENT_PROBE_ASK: confirme com a resposta automatica do probe.';
const BYOK_AGENT_PROBE_ANSWER = 'BYOK_AGENT_PROBE_USER_OK';

/**
 * Executa uma sonda agente descartável para BYOK.
 *
 * Diferente do chat canário, esta sonda exige duas capacidades operacionais do runtime Copilot: tools com identidade
 * terminal representativa e `ask_user`. Ela não toca no dialog loop live; a resposta humana é sintética e confinada à
 * sessão temporária.
 *
 * @param {{ env?: Record<string, string | undefined>; model?: string | null; timeoutMs?: number; prompt?: string }} [options]
 * @returns {Promise<{
 *     ok: boolean;
 *     status: 'ok' | 'unavailable' | 'admission-blocked' | 'tool-missing' | 'ask-missing' | 'empty' | 'failed';
 *     elapsedMs: number;
 *     model: string | null;
 *     profile: string | null;
 *     preset: string | null;
 *     providerType: string | null;
 *     deltaCount: number;
 *     deltaChars: number;
 *     finalChars: number;
 *     observedFinalEvent: boolean;
 *     toolCallCount: number;
 *     markerToolCallCount: number;
 *     readToolCallCount: number;
 *     userInputRequestCount: number;
 *     userInputAnswerCount: number;
 *     sessionId: string | null;
 *     errors: string[];
 *     warnings: string[];
 *     providerFailure?: import('../../byok/provider-failure.js').TerminalByokProviderFailure | null;
 * }>}
 */
export async function probeTerminalConfiguredByokAgent(options = {}) {
    const env = options.env ?? process.env;
    const startedAt = Date.now();
    const byokState = readConfiguredByokState(env);
    if (!byokState.enabled || !byokState.ready || !byokState.provider || !byokState.model) {
        return {
            ok: false,
            status: 'unavailable',
            elapsedMs: Date.now() - startedAt,
            model: byokState.model ?? byokState.summary.model ?? null,
            profile: byokState.summary.profile ?? null,
            preset: byokState.summary.preset ?? null,
            providerType: byokState.summary.providerType ?? null,
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
            errors:
                byokState.errors.length > 0
                    ? [...byokState.errors]
                    : ['BYOK não está ativo/pronto para probe agente.'],
            warnings: [...byokState.warnings],
            providerFailure: null,
        };
    }

    const byok = resolveConfiguredByokSessionOverrides(env, options.model ?? undefined);
    const provider = byok.provider ?? byokState.provider;
    const model = byok.model ?? byokState.model;
    if (!provider || !model) {
        throw new Error('[terminal/byok-agent-probe] Provider/modelo BYOK desapareceram durante a resolução do probe.');
    }

    const baseResult = {
        model: model ?? byok.summary.model ?? null,
        profile: byok.summary.profile ?? null,
        preset: byok.summary.preset ?? null,
        providerType: byok.summary.providerType ?? null,
        warnings: [...byok.summary.warnings],
    };
    const timeoutMs =
        typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
            ? Math.max(5_000, Math.min(120_000, Math.round(options.timeoutMs)))
            : 60_000;
    const prompt =
        options.prompt ??
        `Valide o runtime agente. Chame primeiro a tool ${BYOK_AGENT_PROBE_TOOL} com marker="BYOK_AGENT_PROBE_TOOL_OK". ` +
            `Depois chame a tool ${BYOK_AGENT_PROBE_READ_TOOL} com path="${BYOK_AGENT_PROBE_READ_PATH}", startLine=1 e endLine=3. ` +
            `Depois chame ask_user perguntando exatamente "${BYOK_AGENT_PROBE_QUESTION}". ` +
            'Quando receber a resposta, responda somente com BYOK_AGENT_PROBE_DONE.';
    const admission = evaluateTerminalByokProbeBudget(byok.summary, 'agent', prompt);
    if (admission.shouldBlock) {
        return {
            ok: false,
            status: 'admission-blocked',
            elapsedMs: Date.now() - startedAt,
            ...baseResult,
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
            errors: [admission.label],
            providerFailure: null,
        };
    }

    let deltaCount = 0;
    let deltaChars = 0;
    let finalContent = '';
    let observedFinalEvent = false;
    let markerToolCallCount = 0;
    let readToolCallCount = 0;
    let userInputRequestCount = 0;
    let userInputAnswerCount = 0;
    let sessionId = null;
    /** @type {string[]} */
    const errors = [];
    /** @type {import('../../byok/provider-failure.js').TerminalByokProviderFailure | null} */
    let providerFailure = null;
    const onUserInputRequest = createStaticInputHandler(
        { [BYOK_AGENT_PROBE_QUESTION.toLowerCase()]: BYOK_AGENT_PROBE_ANSWER },
        BYOK_AGENT_PROBE_ANSWER,
    );
    const markerTool = createTool({
        name: BYOK_AGENT_PROBE_TOOL,
        description: 'Sonda interna read-only para confirmar tool calling BYOK em sessão descartável.',
        parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
                marker: { type: 'string', description: 'Marcador BYOK_AGENT_PROBE_TOOL_OK do probe.' },
            },
            required: ['marker'],
        },
        skipPermission: true,
        handler: async (/** @type {unknown} */ args) => {
            markerToolCallCount += 1;
            const marker =
                args && typeof args === 'object' && typeof /** @type {{ marker?: unknown }} */ (args).marker === 'string'
                    ? /** @type {{ marker: string }} */ (args).marker
                    : '';
            return marker.includes('BYOK_AGENT_PROBE_TOOL_OK')
                ? 'BYOK_AGENT_PROBE_TOOL_OK'
                : `BYOK_AGENT_PROBE_TOOL_MARKER=${marker || 'missing'}`;
        },
    });
    const readTool = createTool({
        name: BYOK_AGENT_PROBE_READ_TOOL,
        description:
            'Sonda interna read-only com o nome canônico da leitura de arquivo usada pelo terminal. Retorna somente conteúdo sintético.',
        parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
                path: { type: 'string', description: `Use ${BYOK_AGENT_PROBE_READ_PATH} neste probe.` },
                startLine: { type: 'number', description: 'Primeira linha sintética solicitada.' },
                endLine: { type: 'number', description: 'Última linha sintética solicitada.' },
            },
            required: ['path'],
        },
        skipPermission: true,
        handler: async (/** @type {unknown} */ args) => {
            readToolCallCount += 1;
            const path =
                args && typeof args === 'object' && typeof /** @type {{ path?: unknown }} */ (args).path === 'string'
                    ? /** @type {{ path: string }} */ (args).path
                    : '';
            return path === BYOK_AGENT_PROBE_READ_PATH
                ? 'BYOK_AGENT_PROBE_READ_OK\nlinha 2\nlinha 3'
                : `BYOK_AGENT_PROBE_READ_PATH=${path || 'missing'}`;
        },
    });

    try {
        await withEphemeralSession(
            {
                model,
                provider,
                ...(byok.modelCapabilities ? { modelCapabilities: byok.modelCapabilities } : {}),
                streaming: true,
                enableConfigDiscovery: false,
                includeSubAgentStreamingEvents: false,
                systemMessage: false,
                tools: [markerTool, readTool],
                availableTools: [BYOK_AGENT_PROBE_TOOL, BYOK_AGENT_PROBE_READ_TOOL, 'ask_user'],
                onPermissionRequest: createPermissionHandler({ allowAll: true }),
                onUserInputRequest: async (request, invocation) => {
                    userInputRequestCount += 1;
                    const response = await onUserInputRequest(request, invocation);
                    userInputAnswerCount += 1;
                    return response;
                },
            },
            async ({ session, sessionId: temporarySessionId }) => {
                sessionId = temporarySessionId;
                const unsubscribe = onSessionEvents(session, {
                    'assistant.message_delta': (event) => {
                        const delta = typeof event?.data?.deltaContent === 'string' ? event.data.deltaContent : '';
                        if (!delta) return;
                        deltaCount += 1;
                        deltaChars += delta.length;
                    },
                    'assistant.message': (event) => {
                        const content = typeof event?.data?.content === 'string' ? event.data.content : '';
                        if (!content) return;
                        observedFinalEvent = true;
                        finalContent = content;
                    },
                    'session.error': (event) => {
                        const message =
                            typeof event?.data?.message === 'string'
                                ? event.data.message
                                : typeof event?.data?.error === 'string'
                                  ? event.data.error
                                  : null;
                        if (message) {
                            errors.push(message);
                            providerFailure ??= classifyTerminalByokProviderFailure(message);
                        }
                    },
                });
                try {
                    const reply = await sendSessionAndWait(session, { prompt }, timeoutMs);
                    const content = typeof reply?.data?.content === 'string' ? reply.data.content : '';
                    if (content) finalContent = content;
                } finally {
                    unsubscribe();
                }
            },
        );
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        providerFailure ??= classifyTerminalByokProviderFailure(error);
        return {
            ok: false,
            status: 'failed',
            elapsedMs: Date.now() - startedAt,
            ...baseResult,
            deltaCount,
            deltaChars,
            finalChars: finalContent.length,
            observedFinalEvent,
            toolCallCount: markerToolCallCount + readToolCallCount,
            markerToolCallCount,
            readToolCallCount,
            userInputRequestCount,
            userInputAnswerCount,
            sessionId,
            errors,
            providerFailure,
        };
    }

    const finalChars = finalContent.length;
    const status =
        markerToolCallCount === 0 || readToolCallCount === 0
            ? 'tool-missing'
            : userInputRequestCount === 0 || userInputAnswerCount === 0
              ? 'ask-missing'
              : finalChars > 0 || deltaChars > 0
                ? 'ok'
                : 'empty';
    return {
        ok: status === 'ok',
        status,
        elapsedMs: Date.now() - startedAt,
        ...baseResult,
        deltaCount,
        deltaChars,
        finalChars,
        observedFinalEvent,
        toolCallCount: markerToolCallCount + readToolCallCount,
        markerToolCallCount,
        readToolCallCount,
        userInputRequestCount,
        userInputAnswerCount,
        sessionId,
        errors,
        providerFailure,
    };
}

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<import('../../../presentation/contracts/index.js').RuntimeSdkModeResult>}
 */
export async function getTerminalSdkSessionMode(runtimeId) {
    return getAgentSdkSessionMode(runtimeId);
}

/**
 * @param {'interactive' | 'plan' | 'autopilot'} mode
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<import('../../../presentation/contracts/index.js').RuntimeSdkModeResult>}
 */
export async function setTerminalSdkSessionMode(mode, runtimeId) {
    return setAgentSdkSessionMode(mode, runtimeId);
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<import('../../../presentation/contracts/index.js').RuntimeSdkPlanReadResult>}
 */
export async function readTerminalSdkPlan(runtimeId) {
    return readAgentSdkPlan(runtimeId);
}

/**
 * @param {string} content
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<object>}
 */
export async function updateTerminalSdkPlan(content, runtimeId) {
    return updateAgentSdkPlan(content, runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<object>}
 */
export async function deleteTerminalSdkPlan(runtimeId) {
    return deleteAgentSdkPlan(runtimeId);
}

// ---------------------------------------------------------------------------
// Models, tools, quota
// ---------------------------------------------------------------------------

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function listTerminalSdkModels(runtimeId) {
    return listAgentSdkModels(runtimeId);
}

/**
 * @param {{ projectPaths?: string[]; skillDirectories?: string[] }} [options]
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function listTerminalSdkSkills(options, runtimeId) {
    return listAgentSdkSkills(options, runtimeId);
}

/**
 * @param {{ projectPaths?: string[]; skillDirectories?: string[] }} [options]
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function readTerminalSdkSkillsGovernance(options, runtimeId) {
    return readAgentSdkSkillsGovernance(options, runtimeId);
}

/**
 * @param {string[]} disabledSkills
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function setTerminalSdkDisabledSkills(disabledSkills, runtimeId) {
    return setAgentSdkDisabledSkills(disabledSkills, runtimeId);
}

/**
 * @param {{ model?: string }} [options]
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function listTerminalSdkTools(options, runtimeId) {
    return listAgentSdkTools(options, runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function getTerminalSdkQuota(runtimeId) {
    return getAgentSdkQuota(runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function getTerminalSdkUsageMetrics(runtimeId) {
    return getAgentSdkUsageMetrics(runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @param {import('#copilot/sdk/types').SessionListFilter} [filter]
 * @param {{ enrichOffset?: number; enrichLimit?: number }} [options]
 * @returns {ReturnType<typeof listAgentSdkSessionInventory>}
 */
export async function listTerminalSdkSessionInventory(runtimeId, filter, options) {
    return listAgentSdkSessionInventory(runtimeId, filter, options);
}

/**
 * @param {string} sessionId
 * @param {string | null | undefined} [runtimeId]
 * @returns {ReturnType<typeof deleteAgentSdkSession>}
 */
export async function deleteTerminalSdkSession(sessionId, runtimeId) {
    return deleteAgentSdkSession(sessionId, runtimeId);
}

/**
 * @returns {ReturnType<typeof readAgentSdkSessionBootSelection>}
 */
export async function readTerminalSdkSessionBootSelection() {
    return readAgentSdkSessionBootSelection();
}

/**
 * @param {{ mode: 'new' } | { mode: 'resume'; sessionId: string } | null} selection
 * @returns {ReturnType<typeof scheduleAgentSdkSessionBootSelection>}
 */
export async function scheduleTerminalSdkSessionBootSelection(selection) {
    return scheduleAgentSdkSessionBootSelection(selection);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<Awaited<ReturnType<typeof readAgentSdkSystemPromptProjection>>>}
 */
export async function readTerminalSdkSystemPromptProjection(runtimeId) {
    return readAgentSdkSystemPromptProjection(runtimeId);
}

// ---------------------------------------------------------------------------
// Workspace files
// ---------------------------------------------------------------------------

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function listTerminalSdkWorkspaceFiles(runtimeId) {
    return listAgentSdkWorkspaceFiles(runtimeId);
}

/**
 * @param {string} path
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function readTerminalSdkWorkspaceFile(path, runtimeId) {
    return readAgentSdkWorkspaceFile(path, runtimeId);
}

/**
 * @param {string} path
 * @param {string} content
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function createTerminalSdkWorkspaceFile(path, content, runtimeId) {
    return createAgentSdkWorkspaceFile(path, content, runtimeId);
}

// ---------------------------------------------------------------------------
// Compaction & elicitation
// ---------------------------------------------------------------------------

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function compactTerminalSdkSession(runtimeId) {
    return compactAgentSdkSession(runtimeId);
}

/**
 * @param {string} message
 * @param {object} requestedSchema
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function requestTerminalSdkElicitation(message, requestedSchema, runtimeId) {
    return requestAgentSdkElicitation(message, requestedSchema, runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {import('../../../presentation/contracts/index.js').RuntimeSessionCapabilities}
 */
export function getTerminalSdkSessionCapabilities(runtimeId) {
    return getAgentSdkSessionCapabilities(runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {boolean}
 */
export function isTerminalSdkSessionUiElicitationAvailable(runtimeId) {
    return isAgentSdkSessionUiElicitationAvailable(runtimeId);
}

// ---------------------------------------------------------------------------
// UI interactions
// ---------------------------------------------------------------------------

/**
 * @param {string} message
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<boolean>}
 */
export async function confirmTerminalSdkSessionUi(message, runtimeId) {
    return confirmAgentSdkSessionUi(message, runtimeId);
}

/**
 * @param {string} message
 * @param {string[]} options
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<string | null>}
 */
export async function selectTerminalSdkSessionUi(message, options, runtimeId) {
    return selectAgentSdkSessionUi(message, options, runtimeId);
}

/**
 * @param {string} message
 * @param {import('../../../presentation/contracts/index.js').RuntimeInputOptions | undefined} [options]
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<string | null>}
 */
export async function inputTerminalSdkSessionUi(message, options, runtimeId) {
    return inputAgentSdkSessionUi(message, options, runtimeId);
}

// ---------------------------------------------------------------------------
// Pending elicitations
// ---------------------------------------------------------------------------

/**
 * @param {string | null | undefined} [runtimeId]
 * @param {{ sessionId?: string }} [options]
 * @returns {ReturnType<typeof listAgentSdkPendingElicitations>}
 */
export function listTerminalSdkPendingElicitations(runtimeId, options = {}) {
    return listAgentSdkPendingElicitations(runtimeId, options);
}

/**
 * @param {string} id
 * @param {string | null | undefined} [runtimeId]
 * @returns {ReturnType<typeof getAgentSdkPendingElicitation>}
 */
export function getTerminalSdkPendingElicitation(id, runtimeId) {
    return getAgentSdkPendingElicitation(id, runtimeId);
}

/**
 * @param {string} id
 * @param {import('../../../presentation/contracts/index.js').RuntimeElicitationResult} result
 * @param {string | null | undefined} [runtimeId]
 * @returns {boolean}
 */
export function resolveTerminalSdkPendingElicitation(id, result, runtimeId) {
    return resolveAgentSdkPendingElicitation(id, result, runtimeId);
}

/**
 * @param {string} requestId
 * @param {{ kind: string } & Record<string, unknown>} result
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function handleTerminalSdkPendingPermission(requestId, result, runtimeId) {
    return handleAgentSdkPendingPermission(requestId, result, runtimeId);
}

/**
 * Lista permissões pendentes via RPC quando disponível na sessão SDK.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<{ available: boolean; source: string | null; requests: unknown[] }>}
 */
export async function listTerminalSdkPendingPermissions(runtimeId) {
    return listAgentSdkPendingPermissions(runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function resetTerminalSdkSessionApprovals(runtimeId) {
    return resetAgentSdkSessionApprovals(runtimeId);
}

/**
 * @param {string} serverName
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<unknown>}
 */
export async function loginTerminalSdkMcpOauth(serverName, runtimeId) {
    return loginAgentSdkMcpOauth(serverName, runtimeId);
}
