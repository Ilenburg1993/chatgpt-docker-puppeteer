// @ts-check
/**
 * Disposable BYOK agent probe.
 *
 * This probe validates the operational path expected by the terminal agent: tool calling, synthetic file-read identity,
 * structured user input and streaming/final assistant events, all inside a temporary SDK session.
 *
 * @module copilot/model-gateway/probes/agent-probe
 */

import {
    createPermissionHandler,
    createStaticInputHandler,
    onSessionEvents,
    readConfiguredByokState,
    resolveConfiguredByokSessionOverrides,
    sendSessionAndWait,
    withEphemeralSession,
} from '#copilot/sdk/session';
import { createTool } from '#copilot/sdk/tools';
import { evaluateModelGatewayProbeAdmission } from './admission.js';

export const BYOK_AGENT_PROBE_TOOL = 'terminal_byok_probe_marker';
export const BYOK_AGENT_PROBE_READ_TOOL = 'read_file_content';
export const BYOK_AGENT_PROBE_READ_PATH = 'BYOK_AGENT_PROBE.md';
export const BYOK_AGENT_PROBE_QUESTION = 'BYOK_AGENT_PROBE_ASK: confirme com a resposta automatica do probe.';
export const BYOK_AGENT_PROBE_ANSWER = 'BYOK_AGENT_PROBE_USER_OK';

const DEFAULT_AGENT_PROBE_PROMPT =
    `Valide o runtime agente. Chame primeiro a tool ${BYOK_AGENT_PROBE_TOOL} com marker="BYOK_AGENT_PROBE_TOOL_OK". ` +
    `Depois chame a tool ${BYOK_AGENT_PROBE_READ_TOOL} com path="${BYOK_AGENT_PROBE_READ_PATH}", startLine=1 e endLine=3. ` +
    `Depois chame ask_user perguntando exatamente "${BYOK_AGENT_PROBE_QUESTION}". ` +
    'Quando receber a resposta, responda somente com BYOK_AGENT_PROBE_DONE.';

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeTimeoutMs(value) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(5_000, Math.min(120_000, Math.round(value)))
        : 60_000;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/**
 * @param {unknown} value
 * @returns {any}
 */
function defaultFailureClassifier(value) {
    void value;
    return null;
}

/**
 * @param {any} summary
 * @param {'chat' | 'agent'} mode
 * @param {string} prompt
 * @returns {{ shouldBlock: boolean; label: string }}
 */
function defaultAdmission(summary, mode, prompt) {
    return evaluateModelGatewayProbeAdmission(summary, mode, prompt);
}

/**
 * @param {{
 *     env?: Record<string, string | undefined>;
 *     model?: string | null;
 *     timeoutMs?: number;
 *     prompt?: string;
 *     deps?: {
 *         readConfiguredByokState?: typeof readConfiguredByokState;
 *         resolveConfiguredByokSessionOverrides?: typeof resolveConfiguredByokSessionOverrides;
 *         withEphemeralSession?: typeof withEphemeralSession;
 *         onSessionEvents?: typeof onSessionEvents;
 *         sendSessionAndWait?: typeof sendSessionAndWait;
 *         createPermissionHandler?: typeof createPermissionHandler;
 *         createStaticInputHandler?: typeof createStaticInputHandler;
 *         createTool?: typeof createTool;
 *         evaluateAdmission?: typeof defaultAdmission;
 *         classifyProviderFailure?: typeof defaultFailureClassifier;
 *     };
 * }} [options]
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
 *     providerFailure?: ReturnType<typeof defaultFailureClassifier>;
 * }>}
 */
export async function runConfiguredByokAgentProbe(options = {}) {
    const deps = options.deps ?? {};
    const readState = deps.readConfiguredByokState ?? readConfiguredByokState;
    const resolveOverrides = deps.resolveConfiguredByokSessionOverrides ?? resolveConfiguredByokSessionOverrides;
    const runEphemeral = deps.withEphemeralSession ?? withEphemeralSession;
    const subscribe = deps.onSessionEvents ?? onSessionEvents;
    const sendAndWait = deps.sendSessionAndWait ?? sendSessionAndWait;
    const makePermissionHandler = deps.createPermissionHandler ?? createPermissionHandler;
    const makeStaticInputHandler = deps.createStaticInputHandler ?? createStaticInputHandler;
    const makeTool = deps.createTool ?? createTool;
    const evaluateAdmission = deps.evaluateAdmission ?? defaultAdmission;
    const classifyFailure = deps.classifyProviderFailure ?? defaultFailureClassifier;
    const env = options.env ?? process.env;
    const startedAt = Date.now();
    const byokState = readState(env);
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

    const byok = resolveOverrides(env, options.model ?? undefined);
    const provider = byok.provider ?? byokState.provider;
    const model = byok.model ?? byokState.model;
    if (!provider || !model) {
        throw new Error('[model-gateway/agent-probe] Provider/modelo BYOK desapareceram durante a resolução do probe.');
    }

    const baseResult = {
        model: model ?? byok.summary.model ?? null,
        profile: byok.summary.profile ?? null,
        preset: byok.summary.preset ?? null,
        providerType: byok.summary.providerType ?? null,
        warnings: [...byok.summary.warnings],
    };
    const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
    const prompt = options.prompt ?? DEFAULT_AGENT_PROBE_PROMPT;
    const admission = evaluateAdmission(byok.summary, 'agent', prompt);
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
    /** @type {ReturnType<typeof defaultFailureClassifier>} */
    let providerFailure = null;
    const onUserInputRequest = makeStaticInputHandler(
        { [BYOK_AGENT_PROBE_QUESTION.toLowerCase()]: BYOK_AGENT_PROBE_ANSWER },
        BYOK_AGENT_PROBE_ANSWER,
    );
    const markerTool = makeTool({
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
    const readTool = makeTool({
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
        await runEphemeral(
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
                onPermissionRequest: makePermissionHandler({ allowAll: true }),
                onUserInputRequest: async (request, invocation) => {
                    userInputRequestCount += 1;
                    const response = await onUserInputRequest(request, invocation);
                    userInputAnswerCount += 1;
                    return response;
                },
            },
            async ({ session, sessionId: temporarySessionId }) => {
                sessionId = temporarySessionId;
                const unsubscribe = subscribe(session, {
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
                            providerFailure ??= classifyFailure(message);
                        }
                    },
                });
                try {
                    const reply = await sendAndWait(session, { prompt }, timeoutMs);
                    const content = typeof reply?.data?.content === 'string' ? reply.data.content : '';
                    if (content) finalContent = content;
                } finally {
                    unsubscribe();
                }
            },
        );
    } catch (error) {
        errors.push(errorMessage(error));
        providerFailure ??= classifyFailure(error);
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
