// @ts-check
/**
 * src/copilot/agent/ports/index.js
 *
 * Porta compatível entre o runtime do agent e `hooks/`.
 *
 * Esta porta traduz o estado mínimo do agent para hooks de sessão do SDK. Ela existe para que `session-setup` não
 * precise conhecer presets, audit trail, bus default ou factory concreta de hooks.
 *
 * @module copilot/agent/ports/hook-port
 * @internal
 */

import { defaultAuditLog } from '#copilot/audit';
import { getCopilotFallbackModel, readConfiguredByokSummary } from '#copilot/config';
import { recordBlockedToolCall } from '#copilot/observability';
import { classifySdkRateLimitScope } from '#copilot/sdk/errors';
import {
    attachBus,
    createQueuedElicitationHandler,
    defaultBus as defaultHookBus,
    normalizeElicitationCompletedEvent,
    normalizeElicitationPendingEvent,
} from '#copilot/sdk/session';
import { log } from './logging/index.js';
import { decideModelCallAutoFallback, decideModelCallErrorHandling } from './model-error-recovery.js';

export {
    createQueuedElicitationHandler,
    normalizeElicitationCompletedEvent,
    normalizeElicitationPendingEvent,
};

/**
 * Contexto mínimo de invocação exposto pelos hooks do SDK e extensões de runtime.
 *
 * @typedef {{
 *     sessionId?: string;
 *     agentName?: string;
 *     agent?: { name?: string };
 * }} HookInvocationContext
 */

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
            const serialized = JSON.stringify(raw);
            return serialized && serialized !== '{}' ? serialized : 'Erro do SDK sem mensagem estruturada.';
        } catch {
            return String(raw);
        }
    }
    return String(raw);
}

/**
 * Em BYOK há duas verdades úteis, mas distintas: o modelo configurado para o perfil e o modelo efetivo da sessão já
 * anexada ao SDK. Erros live precisam usar a sessão como fonte primária, porque `/byok use` pode preparar o próximo
 * perfil sem reiniciar imediatamente a sessão atual.
 *
 * @param {{ getModel: () => string | undefined }} input
 * @param {{ model?: string | null }} byokSummary
 * @returns {string | null}
 */
function resolveActiveByokModel(input, byokSummary) {
    const activeModel = input.getModel();
    if (typeof activeModel === 'string' && activeModel.trim()) return activeModel.trim();
    const configuredModel = byokSummary.model;
    if (typeof configuredModel === 'string' && configuredModel.trim()) return configuredModel.trim();
    return null;
}

/**
 * @param {AgentSessionHookInput} input
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
async function abortCurrentByokProviderTurn(input, sessionId) {
    if (typeof input.abortCurrentMessage !== 'function') return;
    try {
        await input.abortCurrentMessage();
        log('WARN', `[agent/hook-port] turno BYOK abortado após erro de provider (session=${sessionId || 'unknown'}).`);
    } catch (error) {
        log(
            'WARN',
            `[agent/hook-port] falha ao abortar turno BYOK após erro de provider: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
}

/**
 * @param {AgentSessionHookInput} input
 * @param {{ errorContext: string; recoverable?: boolean; normalizedMessage: string; sessionId: string }} event
 * @returns {boolean}
 */
function recoverModelCallIfNeeded(input, event) {
    const currentModel = input.getModel() ?? null;
    const fallbackModel = getCopilotFallbackModel();
    const byokEnabled = readConfiguredByokSummary().enabled === true;
    const decision = decideModelCallAutoFallback({
        errorContext: event.errorContext,
        recoverable: event.recoverable,
        currentModel,
        fallbackModel,
        byokEnabled,
    });
    if (!decision.shouldFallback || !decision.targetModel) return false;

    const applied = input.applyModelFallback?.(decision.targetModel, {
        previousModel: currentModel,
        reason: decision.reason,
        errorMessage: event.normalizedMessage,
        sessionId: event.sessionId,
    });
    if (applied === true) {
        log(
            'WARN',
            `[agent/hook-port] model_call recuperável em modelo explícito — fallback live aplicado: ${currentModel ?? 'unknown'} → ${decision.targetModel}`,
        );
        return true;
    }

    input.scheduleFallback(decision.targetModel);
    log(
        'WARN',
        `[agent/hook-port] model_call recuperável em modelo explícito — fallback agendado: ${currentModel ?? 'unknown'} → ${decision.targetModel}`,
    );
    return true;
}

/**
 * @param {AgentSessionHookInput} input
 * @returns {{
 *     onSessionStart: import('#copilot/sdk/types').SessionStartHandler;
 *     onSessionEnd: import('#copilot/sdk/types').SessionEndHandler;
 *     onErrorOccurred: import('#copilot/sdk/types').ErrorOccurredHandler;
 * }}
 */
function createAgentSessionLifecycleHooks(input) {
    /**
     * @param {import('#copilot/sdk/types').SessionStartHookInput} sessionInput
     * @param {HookInvocationContext} invocation
     */
    const onSessionStart = async (sessionInput, invocation) => {
        const sessionId = invocation?.sessionId ?? '';
        input.metrics.recordSessionStart();
        defaultAuditLog.record({ type: 'session.start', sessionId });
        await input.emitWebhook('session.start', { sessionId });
        const model = input.getModel();
        return {
            additionalContext: [
                `sessionId: ${sessionId}`,
                model ? `model: ${model}` : null,
                `source: ${sessionInput.source ?? 'unknown'}`,
                `node: ${process.version}`,
            ]
                .filter(Boolean)
                .join(' | '),
        };
    };

    /**
     * @param {import('#copilot/sdk/types').SessionEndHookInput} _sessionInput
     * @param {HookInvocationContext} invocation
     */
    const onSessionEnd = async (_sessionInput, invocation) => {
        const sessionId = invocation?.sessionId ?? '';
        input.metrics.recordSessionEnd();
        defaultAuditLog.record({ type: 'session.end', sessionId });
        await input.emitWebhook('session.end', { sessionId });
    };

    /**
     * @param {import('#copilot/sdk/types').ErrorOccurredHookInput} errorInput
     * @param {HookInvocationContext} invocation
     */
    const onErrorOccurred = async (errorInput, invocation) => {
        const sessionId = invocation?.sessionId ?? '';
        const errorContext = String(errorInput.errorContext ?? '');
        const normalizedMessage = normalizeHookErrorMessage(errorInput.error);
        const byokSummary = readConfiguredByokSummary();
        const byokModel = resolveActiveByokModel(input, byokSummary);
        log(
            'WARN',
            `[agent/hook-port] SDK errorOccurred [${errorContext}]: ${normalizedMessage} (recuperável: ${errorInput.recoverable})`,
        );

        defaultAuditLog.record({
            type: 'session.error',
            sessionId,
            data: {
                errorContext,
                recoverable: errorInput.recoverable,
            },
        });

        const modelRecoveryApplied = recoverModelCallIfNeeded(input, {
            errorContext,
            recoverable: errorInput.recoverable,
            normalizedMessage,
            sessionId,
        });

        if (errorContext === 'rate_limit' || errorContext === 'quota') {
            const rateLimitScope = classifySdkRateLimitScope(errorInput.error);
            if (rateLimitScope !== 'session') {
                const currentModel = input.getModel() ?? 'unknown';
                const fallbackModel = getCopilotFallbackModel();
                if (byokSummary.enabled === true) {
                    log(
                        'WARN',
                        '[agent/hook-port] rate_limit/quota em BYOK — não aplicando fallback para Copilot auto; operador deve trocar provider/modelo BYOK.',
                    );
                } else if (fallbackModel && fallbackModel !== currentModel) {
                    input.scheduleFallback(fallbackModel);
                }
            }
        }

        input.emit('error', {
            hookType: 'errorOccurred',
            errorMessage: normalizedMessage,
            errorContext,
            recoverable: errorInput.recoverable,
            sessionId,
            byokEnabled: byokSummary.enabled === true,
            byokProviderType: byokSummary.providerType ?? null,
            byokProfile: byokSummary.profile ?? null,
            byokModel,
        });

        if (errorContext === 'model_call' && byokSummary.enabled === true) {
            await abortCurrentByokProviderTurn(input, sessionId);
        }

        const handlingDecision = decideModelCallErrorHandling({
            errorContext,
            recoverable: errorInput.recoverable,
            byokEnabled: byokSummary.enabled === true,
            modelRecoveryApplied,
        });
        return { errorHandling: handlingDecision.errorHandling };
    };

    return {
        onSessionStart,
        onSessionEnd,
        onErrorOccurred,
    };
}

/**
 * @param {import('#copilot/sdk/types').PreToolUseHandler[]} handlers
 * @returns {import('#copilot/sdk/types').PreToolUseHandler}
 */
function composePreToolUseHandlers(...handlers) {
    return async (input, invocation) => {
        for (const handler of handlers) {
            const result = await handler(input, invocation);
            if (result?.permissionDecision) return result;
        }
        return undefined;
    };
}

/**
 * @param {(
 *     name: string,
 *     input?: import('#copilot/sdk/types').PreToolUseHookInput,
 *     invocation?: HookInvocationContext,
 * ) => boolean} isDisabledFn
 * @returns {import('#copilot/sdk/types').PreToolUseHandler}
 */
function createRuntimeDisableHook(isDisabledFn) {
    return async (input, invocation) => {
        if (isDisabledFn(input.toolName, input, invocation)) {
            log('WARN', `[agent/hook-port] tool desabilitada em runtime: ${input.toolName}`);
            return { permissionDecision: 'deny' };
        }
        return {};
    };
}

/**
 * Entradas mínimas exigidas pelos hooks de sessão do agent.
 *
 * A regra aqui é manter dados operacionais, não objetos de runtime: callbacks entram como funções pequenas para evitar
 * que `hooks/` receba `AgentContext` ou `AlwaysAliveAgent` completos.
 *
 * @typedef {{
 *     emitWebhook: (event: string, payload: object) => Promise<void>;
 *     getModel: () => string | undefined;
 *     scheduleFallback: (model: string) => void;
 *     applyModelFallback?: (model: string, event: {
 *         previousModel: string | null;
 *         reason: string;
 *         errorMessage: string;
 *         sessionId: string;
 *     }) => boolean;
 *     emit: (event: string, payload: object) => void;
 *     abortCurrentMessage?: (() => Promise<void>) | undefined;
 *     metrics: { recordSessionStart: () => void; recordSessionEnd: () => void };
 * }} AgentSessionHookInput
 */

/**
 * Monta os hooks finais enviados ao SDK.
 *
 * A ordem é relevante: primeiro cria lifecycle hooks do agent, depois aplica a factory de hooks do projeto e por fim
 * acopla o bus canônico.
 *
 * @param {AgentSessionHookInput} input
 * @returns {NonNullable<import('#copilot/sdk/types').SessionConfig['hooks']>}
 */
export function buildAgentBusHooks(input) {
    const lifecycleHooks = createAgentSessionLifecycleHooks(input);
    const hooks = {
        onSessionStart: lifecycleHooks.onSessionStart,
        onSessionEnd: lifecycleHooks.onSessionEnd,
        onErrorOccurred: lifecycleHooks.onErrorOccurred,
    };

    return attachBus(hooks);
}

/**
 * Aplica policy runtime de tools aos hooks de sessão do agent.
 *
 * `session-setup` conhece a denylist/allowlist efetiva, mas não deve conhecer a implementação concreta de hooks. Esta
 * função mantém a tradução `agent policy -> SDK preToolUse hook` dentro da porta.
 *
 * @param {NonNullable<import('#copilot/sdk/types').SessionConfig['hooks']>} busHooks
 * @param {(
 *     toolName: string,
 *     input?: import('#copilot/sdk/types').PreToolUseHookInput,
 *     invocation?: HookInvocationContext,
 * ) => boolean} isToolDisabled
 * @returns {NonNullable<import('#copilot/sdk/types').SessionConfig['hooks']>}
 */
export function withAgentRuntimeToolPolicy(busHooks, isToolDisabled) {
    const runtimeDisableHook = createRuntimeDisableHook(isToolDisabled);
    const preToolUse = busHooks.onPreToolUse
        ? composePreToolUseHandlers(runtimeDisableHook, busHooks.onPreToolUse)
        : runtimeDisableHook;

    return {
        ...busHooks,
        onPreToolUse: async (input, invocation) => {
            const result = await preToolUse(input, invocation);
            if (result?.permissionDecision === 'deny') {
                recordBlockedToolCall(input.toolName);
            }
            return result;
        },
    };
}

/**
 * Retorna o bus default dos hooks para diagnósticos e wiring legado.
 *
 * @returns {typeof defaultHookBus}
 */
export function getDefaultHookBus() {
    return defaultHookBus;
}
