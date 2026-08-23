// @ts-check
/**
 * src/copilot/hooks/session-lifecycle.js
 *
 * Factory de session lifecycle hooks para o AlwaysAliveAgent. Migrado de src/copilot/agent/session-hooks.js — esse
 * arquivo é mantido como re-export.
 *
 * Responsabilidade: onSessionStart, onSessionEnd, onErrorOccurred com injeção de dependências. Enriquece onSessionStart
 * com additionalContext (Gap 4 do roadmap).
 *
 * ISOLAMENTO: este módulo NÃO importa de '.github/hooks/' ou paths do sistema operacional. Todo estado operacional é
 * recebido via ctx (injeção de dependências).
 *
 * @module copilot/hooks/session-lifecycle
 * @see EventBus
 * @see module:copilot/hooks/types
 */

import { defaultAuditLog } from '#copilot/audit';
import { getCopilotFallbackModel, readConfiguredByokSummary } from '#copilot/config';
import { toError } from '#copilot/infra/public/platform/error';
import { classifySdkRateLimitScope, decideModelCallErrorHandling } from '#copilot/sdk/errors';
import { hostname } from 'node:os';
import { createErrorHandler } from './error-handler.js';
import { log } from './logger.js';

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeHookErrorMessage(raw) {
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object') {
        const rec = /** @type {Record<string, unknown>} */ (raw);
        if (typeof rec['message'] === 'string' && rec['message']) return rec['message'];
        const nestedError = rec['error'];
        if (nestedError && typeof nestedError === 'object') {
            const errRec = /** @type {Record<string, unknown>} */ (nestedError);
            if (typeof errRec['message'] === 'string' && errRec['message']) return errRec['message'];
        }
        try {
            return JSON.stringify(raw);
        } catch {
            return String(raw);
        }
    }
    return String(raw);
}

/**
 * @param {() => string | undefined} getModel
 * @param {{ model?: string | null }} byokSummary
 * @returns {string | null}
 */
function resolveActiveByokModel(getModel, byokSummary) {
    const activeModel = getModel();
    if (typeof activeModel === 'string' && activeModel.trim()) return activeModel.trim();
    const configuredModel = byokSummary.model;
    if (typeof configuredModel === 'string' && configuredModel.trim()) return configuredModel.trim();
    return null;
}

/**
 * @typedef {import('./types.js').SessionLifecycleContext} SessionLifecycleContext
 */

/**
 * Cria os três session lifecycle hooks: `onSessionStart`, `onSessionEnd` e `onErrorOccurred`.
 *
 * Os hooks são funções vinculadas ao contexto fornecido via injeção de dependências, sem acesso direto a `this`.
 * Dependências mutáveis são recebidas como getters.
 *
 * Novidade em relação ao session-hooks.js original: `onSessionStart` retorna `additionalContext` rico com snapshot do
 * ambiente (Gap 4 do roadmap de hooks).
 *
 * @param {SessionLifecycleContext} ctx
 * @returns {{
 *     onSessionStart: (
 *         input: import('./types.js').SessionStartHookInput,
 *         invocation: import('./types.js').InvocationContext,
 *     ) => Promise<import('./types.js').SessionStartHookOutput>;
 *     onSessionEnd: (
 *         input: import('./types.js').SessionEndHookInput,
 *         invocation: import('./types.js').InvocationContext,
 *     ) => Promise<void>;
 *     onErrorOccurred: import('./types.js').ErrorOccurredHandler;
 * }}
 */
export function createSessionHooks(ctx) {
    const { emitWebhook, getModel, scheduleFallback, emit, getContextSnapshot } = ctx;
    const metrics = ctx.metrics ?? null;

    const onErrorOccurred = createErrorHandler({
        maxRetries: 3,
        strategy: (input) =>
            decideModelCallErrorHandling({
                errorContext: input.errorContext,
                recoverable: input.recoverable,
                byokEnabled: readConfiguredByokSummary().enabled === true,
            }).errorHandling,
        onError: (input, invocation) => {
            const sessionId = invocation?.sessionId ?? '';
            const normalizedMessage = normalizeHookErrorMessage(input.error);
            const byokSummary = readConfiguredByokSummary();
            const byokModel = resolveActiveByokModel(getModel, byokSummary);
            log(
                'WARN',
                `[hooks/session-lifecycle] SDK errorOccurred [${input.errorContext}]: ${normalizedMessage} (recuperável: ${input.recoverable})`,
            );

            defaultAuditLog.record({
                type: 'session.error',
                sessionId,
                data: {
                    errorContext: input.errorContext,
                    recoverable: input.recoverable,
                },
            });

            const isRateOrQuotaError = input.errorContext === 'rate_limit' || input.errorContext === 'quota';
            if (isRateOrQuotaError) {
                const rateLimitScope = classifySdkRateLimitScope(input.error);
                if (rateLimitScope === 'session') {
                    log(
                        'WARN',
                        '[hooks/session-lifecycle] rate_limit de sessão — fallback de modelo não será agendado; aguardando reset do SDK.',
                    );
                } else {
                    const currentModel = getModel() ?? 'unknown';
                    const fallbackModel = getCopilotFallbackModel();
                    if (byokSummary.enabled === true) {
                        log(
                            'WARN',
                            '[hooks/session-lifecycle] rate_limit/quota em BYOK — fallback Copilot auto bloqueado; troque provider/modelo BYOK.',
                        );
                    } else if (fallbackModel && fallbackModel !== currentModel) {
                        log(
                            'WARN',
                            `[hooks/session-lifecycle] rate_limit/quota — próxima reconexão delegará seleção ao SDK via model fallback: ${fallbackModel}`,
                        );
                        scheduleFallback(fallbackModel);
                    } else {
                        log(
                            'WARN',
                            '[hooks/session-lifecycle] rate_limit/quota com model já em auto; aguardando reset do SDK.',
                        );
                    }
                }
            }

            emit('error', {
                hookType: 'errorOccurred',
                errorMessage: normalizedMessage,
                errorContext: input.errorContext,
                recoverable: input.recoverable,
                sessionId,
                byokEnabled: byokSummary.enabled === true,
                byokProviderType: byokSummary.providerType ?? null,
                byokProfile: byokSummary.profile ?? null,
                byokModel,
            });
        },
    });

    /**
     * @param {import('./types.js').SessionStartHookInput} input
     * @param {import('./types.js').InvocationContext} invocation
     * @returns {Promise<import('./types.js').SessionStartHookOutput>}
     */
    async function onSessionStart(input, invocation) {
        const sessionId = invocation?.sessionId ?? '';
        log('INFO', `[hooks/session-lifecycle] SessionStart: ${sessionId}`);
        metrics?.recordSessionStart();
        // CT-02: registrar no audit ring buffer
        defaultAuditLog.record({ type: 'session.start', sessionId });
        await emitWebhook('session.start', { sessionId });

        // Gap 4: retornar additionalContext com snapshot de ambiente
        const snapshot = getContextSnapshot ? getContextSnapshot() : {};
        const model = getModel();
        const additionalContext = [
            `sessionId: ${sessionId}`,
            model ? `model: ${model}` : null,
            `source: ${input.source ?? 'unknown'}`,
            `host: ${hostname()}`,
            `node: ${process.version}`,
            ...Object.entries(snapshot).map(([k, v]) => `${k}: ${v}`),
        ]
            .filter(Boolean)
            .join(' | ');

        return { additionalContext };
    }

    /**
     * @param {import('./types.js').SessionEndHookInput} _input
     * @param {import('./types.js').InvocationContext} invocation
     * @returns {Promise<void>}
     */
    async function onSessionEnd(_input, invocation) {
        const sessionId = invocation?.sessionId ?? '';
        log('INFO', `[hooks/session-lifecycle] SessionEnd: ${sessionId}`);
        metrics?.recordSessionEnd();
        // CT-02: registrar no audit ring buffer
        defaultAuditLog.record({ type: 'session.end', sessionId });
        await emitWebhook('session.end', { sessionId });
    }

    return { onSessionStart, onSessionEnd, onErrorOccurred };
}

/**
 * E2.2 — Cria um handler `onSessionEnd` que executa callbacks de cleanup em sequência. Erros em um cleanup não impedem
 * a execução dos demais (fail-safe).
 *
 * @example
 *     const cleanup = createCleanupHandler([
 *         async (sessionId) => {
 *             await db.close(sessionId);
 *         },
 *         async (sessionId) => {
 *             cache.purge(sessionId);
 *         },
 *     ]);
 *     const hooks = createHooks({ onSessionEnd: cleanup });
 *
 * @param {((sessionId: string, reason: string) => void | Promise<void>)[]} cleanupFns
 * @param {{ label?: string }} [opts]
 * @returns {import('./types.js').SessionEndHandler}
 */
export function createCleanupHandler(cleanupFns, opts) {
    const label = opts?.label ?? 'cleanup';
    return async (input, invocation) => {
        const sessionId = invocation?.sessionId ?? '';
        const reason = input?.reason ?? 'unknown';
        log('DEBUG', `[hooks/session-lifecycle] ${label}: ${cleanupFns.length} handlers para sessionId=${sessionId}`);

        for (const fn of cleanupFns) {
            try {
                await fn(sessionId, reason);
            } catch (e) {
                const msg = toError(e).message;
                log('WARN', `[hooks/session-lifecycle] ${label} erro (continuando): ${msg}`);
            }
        }
    };
}
