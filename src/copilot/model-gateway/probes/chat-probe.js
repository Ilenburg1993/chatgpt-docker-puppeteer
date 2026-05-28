// @ts-check
/**
 * Disposable BYOK chat probe.
 *
 * The terminal still renders and records the result, but the probe contract now lives in model-gateway so future
 * routing/health code can reuse the same semantics without depending on terminal commands.
 *
 * @module copilot/model-gateway/probes/chat-probe
 */

import {
    createPermissionHandler,
    abortSession,
    onSessionEvents,
    readConfiguredByokState,
    resolveConfiguredByokSessionOverrides,
    sendSessionAndWait,
    withEphemeralSession,
} from '#copilot/sdk/session';

const DEFAULT_CHAT_PROBE_PROMPT =
    'Responda somente com o texto BYOK_PROBE_OK. Nao use ferramentas, nao peca mais contexto e nao explique.';

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeTimeoutMs(value) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(5_000, Math.min(120_000, Math.round(value)))
        : 45_000;
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
    void summary;
    void mode;
    void prompt;
    return { shouldBlock: false, label: '' };
}

/**
 * @param {{
 *     env?: Record<string, string | undefined>;
 *     model?: string | null;
 *     timeoutMs?: number;
 *     prompt?: string;
 *     attachments?: NonNullable<import('@github/copilot-sdk').MessageOptions['attachments']>;
 *     deps?: {
 *         readConfiguredByokState?: typeof readConfiguredByokState;
 *         resolveConfiguredByokSessionOverrides?: typeof resolveConfiguredByokSessionOverrides;
 *         withEphemeralSession?: typeof withEphemeralSession;
 *         onSessionEvents?: typeof onSessionEvents;
 *         sendSessionAndWait?: typeof sendSessionAndWait;
 *         createPermissionHandler?: typeof createPermissionHandler;
 *         evaluateAdmission?: typeof defaultAdmission;
 *         classifyProviderFailure?: typeof defaultFailureClassifier;
 *     };
 * }} [options]
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
 *     finalContent: string;
 *     observedFinalEvent: boolean;
 *     sessionId: string | null;
 *     errors: string[];
 *     warnings: string[];
 *     providerFailure?: ReturnType<typeof defaultFailureClassifier>;
 * }>}
 */
export async function runConfiguredByokChatProbe(options = {}) {
    const deps = options.deps ?? {};
    const readState = deps.readConfiguredByokState ?? readConfiguredByokState;
    const resolveOverrides = deps.resolveConfiguredByokSessionOverrides ?? resolveConfiguredByokSessionOverrides;
    const runEphemeral = deps.withEphemeralSession ?? withEphemeralSession;
    const subscribe = deps.onSessionEvents ?? onSessionEvents;
    const sendAndWait = deps.sendSessionAndWait ?? sendSessionAndWait;
    const makePermissionHandler = deps.createPermissionHandler ?? createPermissionHandler;
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
            finalContent: '',
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
    const byok = resolveOverrides(env, options.model ?? undefined);
    const provider = byok.provider ?? byokState.provider;
    const model = byok.model ?? byokState.model;
    if (!provider || !model) {
        throw new Error('[model-gateway/chat-probe] Provider/modelo BYOK desapareceram durante a resolução do probe.');
    }

    const baseResult = {
        model: model ?? byok.summary.model ?? null,
        profile: byok.summary.profile ?? null,
        preset: byok.summary.preset ?? null,
        providerType: byok.summary.providerType ?? null,
        warnings: [...byok.summary.warnings],
    };
    const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
    const prompt = options.prompt ?? DEFAULT_CHAT_PROBE_PROMPT;
    const admission = evaluateAdmission(byok.summary, 'chat', prompt);
    if (admission.shouldBlock) {
        return {
            ok: false,
            status: 'admission-blocked',
            elapsedMs: Date.now() - startedAt,
            ...baseResult,
            deltaCount: 0,
            deltaChars: 0,
            finalChars: 0,
            finalContent: '',
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
    /** @type {ReturnType<typeof defaultFailureClassifier>} */
    let providerFailure = null;

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
                availableTools: [],
                onPermissionRequest: makePermissionHandler({ defaultDecision: 'deny' }),
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
                    const payload = {
                        prompt,
                        ...(options.attachments ? { attachments: options.attachments } : {}),
                    };
                    let reply;
                    try {
                        reply = await sendAndWait(session, payload, timeoutMs);
                    } catch (error) {
                        try {
                            await abortSession(session);
                        } catch {
                            // Best-effort abort: the original provider/SDK failure remains the probe result.
                        }
                        throw error;
                    }
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
            finalContent,
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
        finalContent,
        observedFinalEvent,
        sessionId,
        errors: ok ? errors : [...errors, 'Probe concluiu sem delta nem mensagem final.'],
        providerFailure,
    };
}
