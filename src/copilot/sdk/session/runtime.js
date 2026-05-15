// @ts-check
/**
 * src/copilot/sdk/session/runtime.js
 *
 * Lifecycle runtime canônico para CopilotSession. Centraliza abort, setModel, getMessages, workspacePath,
 * send/sendAndWait e asyncDispose com validação de sessão, logging e tratamento de erros padronizados.
 *
 * @module copilot/sdk/session-runtime
 * @see module:copilot/sdk/session
 */

import { toError } from '#copilot/core/error-handlers';
import { toSdkOperationError } from '../errors.js';
import { log } from '../logger.js';
import { modelGetCurrent, modelSwitchTo } from '../rpc/session.js';
import { emitSdkOperationMetric } from '../telemetry/operation-metrics.js';

import { verifyModelSwitchWithRetry } from './model-switch-verify-retry.js';
/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 *
 * @typedef {import('@github/copilot-sdk').SessionEvent} SessionEvent
 *
 * @typedef {import('@github/copilot-sdk').AssistantMessageEvent} AssistantMessageEvent
 *
 * @typedef {import('@github/copilot-sdk').MessageOptions} MessageOptions
 *
 * @typedef {'low' | 'medium' | 'high' | 'xhigh'} ReasoningEffort
 */

/**
 * @param {unknown} session
 * @param {string} caller
 * @returns {asserts session is CopilotSession}
 */
function assertSession(session, caller) {
    if (!session || typeof session !== 'object' || !('sessionId' in session)) {
        throw new TypeError(`[session-runtime/${caller}] Sessão inválida ou não fornecida.`);
    }
}

/**
 * @param {CopilotSession} session
 * @param {string} model
 * @param {{ reasoningEffort?: ReasoningEffort }} [options]
 * @returns {Promise<{
 *     requestedModel: string;
 *     effectiveModel: string | null;
 *     verifiedSwitch: boolean;
 *     usedRpcFallback: boolean;
 * }>}
 */
async function verifySessionModelSwitch(session, model, options) {
    /**
     * @type {{
     *     requestedModel: string;
     *     effectiveModel: string | null;
     *     verifiedSwitch: boolean;
     *     usedRpcFallback: boolean;
     * }}
     */
    const result = {
        requestedModel: model,
        effectiveModel: null,
        verifiedSwitch: false,
        usedRpcFallback: false,
    };

    const hasModelGetCurrent = Boolean(
        session.rpc &&
        typeof session.rpc === 'object' &&
        session.rpc.model &&
        typeof session.rpc.model === 'object' &&
        typeof session.rpc.model.getCurrent === 'function',
    );

    if (!hasModelGetCurrent) {
        return result;
    }

    try {
        const current = await modelGetCurrent(session);
        result.effectiveModel = current.modelId;
        result.verifiedSwitch = model === 'auto' ? Boolean(current.modelId) : current.modelId === model;
    } catch (error) {
        log('WARN', `[session-runtime] model.getCurrent falhou após setModel: ${toError(error).message}`);
        return result;
    }

    if (result.verifiedSwitch) {
        if (model === 'auto') {
            log(
                'INFO',
                `[session-runtime] model='auto' aceito; SDK resolveu modelo efetivo '${result.effectiveModel ?? '?'}'.`,
            );
        }
        return result;
    }

    const hasModelSwitchTo = Boolean(
        session.rpc &&
        typeof session.rpc === 'object' &&
        session.rpc.model &&
        typeof session.rpc.model === 'object' &&
        typeof session.rpc.model.switchTo === 'function',
    );

    if (!hasModelSwitchTo) {
        return result;
    }

    log(
        'WARN',
        `[session-runtime] setModel não convergiu para '${model}' (atual='${result.effectiveModel ?? '?'}') — tentando rpc.model.switchTo().`,
    );

    try {
        await modelSwitchTo(
            session,
            model,
            options?.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : undefined,
        );
        result.usedRpcFallback = true;

        // Fase 3.2 Optimization #1: Retry com timeout cap
        const verifyResult = await verifyModelSwitchWithRetry(
            async () => {
                const current = await modelGetCurrent(session);
                result.effectiveModel = current.modelId;
                return model === 'auto' ? Boolean(current.modelId) : current.modelId === model;
            },
            { maxRetries: 8, pollDelayMs: 250, totalTimeoutMs: 5_000 },
        );

        result.verifiedSwitch = verifyResult.ok;
        if (!result.verifiedSwitch) {
            const detail = verifyResult.timedOut
                ? `timeout após ${verifyResult.retries} retries`
                : `não convergiu após ${verifyResult.retries} retries`;
            log('WARN', `[session-runtime] Model switch verification falhou: ${detail}`);
        }
    } catch (error) {
        log('WARN', `[session-runtime] rpc.model.switchTo fallback falhou: ${toError(error).message}`);
    }

    return result;
}

/**
 * @param {CopilotSession} session
 * @returns {{
 *     operation: 'session.setModel' | 'session.switchModel';
 *     fn: (model: string, options?: { reasoningEffort?: ReasoningEffort }) => Promise<unknown> | unknown;
 * } | null}
 */
function resolveNativeModelSwitcher(session) {
    const maybeSetModel = Reflect.get(session, 'setModel');
    if (typeof maybeSetModel === 'function') {
        return {
            operation: 'session.setModel',
            fn: (model, options) => maybeSetModel.call(session, model, options),
        };
    }

    const maybeSwitchModel = Reflect.get(session, 'switchModel');
    if (typeof maybeSwitchModel === 'function') {
        return {
            operation: 'session.switchModel',
            fn: (model, options) => maybeSwitchModel.call(session, model, options),
        };
    }

    return null;
}

/** @param {CopilotSession} session */
export async function abortSession(session) {
    assertSession(session, 'abort');
    log('INFO', `[session-runtime] Abortando mensagem: sessionId='${session.sessionId}'`);
    try {
        await session.abort();
    } catch (error) {
        throw toSdkOperationError('session.abort', error);
    }
    log('INFO', `[session-runtime] Abort concluído: sessionId='${session.sessionId}'`);
}

/** @param {CopilotSession} session */
export async function disconnectSessionSafe(session) {
    assertSession(session, 'disconnect');
    log('INFO', `[session-runtime] Desconectando sessão: sessionId='${session.sessionId}'`);
    try {
        await session.disconnect();
    } catch (error) {
        throw toSdkOperationError('session.disconnect', error);
    }
    log('INFO', `[session-runtime] Sessão desconectada: sessionId='${session.sessionId}'`);
}

/**
 * @param {CopilotSession} session
 * @param {MessageOptions} messageOptions
 * @param {number} [timeoutMs]
 * @returns {Promise<AssistantMessageEvent | undefined>}
 */
export async function sendSessionAndWait(session, messageOptions, timeoutMs) {
    assertSession(session, 'sendAndWait');
    const hasTimeout = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0;
    log(
        'DEBUG',
        `[session-runtime] sendAndWait: sessionId='${session.sessionId}', timeout=${hasTimeout ? String(timeoutMs) : 'none'}`,
    );
    const startedAt = Date.now();
    emitSdkOperationMetric({ operation: 'session.sendAndWait', status: 'started', sessionId: session.sessionId });
    /** @type {AssistantMessageEvent | undefined} */
    let event;
    try {
        event = hasTimeout
            ? await session.sendAndWait(messageOptions, timeoutMs)
            : await session.sendAndWait(messageOptions);
    } catch (error) {
        const sdkError = toSdkOperationError('session.sendAndWait', error);
        emitSdkOperationMetric({
            operation: 'session.sendAndWait',
            status: 'failed',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { errorKind: sdkError.kind },
        });
        throw sdkError;
    }
    emitSdkOperationMetric({
        operation: 'session.sendAndWait',
        status: 'succeeded',
        sessionId: session.sessionId,
        durationMs: Date.now() - startedAt,
        attributes: { hasAssistantMessage: Boolean(event) },
    });
    log('DEBUG', `[session-runtime] sendAndWait concluído: sessionId='${session.sessionId}'`);
    return event;
}

/**
 * @param {CopilotSession} session
 * @param {MessageOptions} messageOptions
 * @returns {Promise<string | undefined>}
 */
export async function sendSession(session, messageOptions) {
    assertSession(session, 'send');
    log('DEBUG', `[session-runtime] send: sessionId='${session.sessionId}'`);
    let messageId;
    try {
        messageId = await session.send(messageOptions);
    } catch (error) {
        throw toSdkOperationError('session.send', error);
    }
    log(
        'DEBUG',
        `[session-runtime] send enfileirado: sessionId='${session.sessionId}', messageId=${messageId ?? 'n/a'}`,
    );
    return messageId;
}

/**
 * @param {CopilotSession} session
 * @param {string} model
 * @param {{ reasoningEffort?: ReasoningEffort }} [options]
 */
export async function setSessionModel(session, model, options) {
    assertSession(session, 'setModel');
    if (typeof model !== 'string' || model.length === 0) {
        throw new TypeError('[session-runtime/setModel] model deve ser string não-vazia.');
    }
    log('INFO', `[session-runtime] setModel: sessionId='${session.sessionId}', model='${model}'`);
    const startedAt = Date.now();
    const nativeSwitcher = resolveNativeModelSwitcher(session);
    const operation = nativeSwitcher?.operation ?? 'rpc.model.switchTo';
    emitSdkOperationMetric({ operation, status: 'started', sessionId: session.sessionId, attributes: { model } });
    Reflect.set(session, '__copilotConfiguredModel', model);
    if (options?.reasoningEffort) {
        Reflect.set(session, '__copilotConfiguredReasoningEffort', options.reasoningEffort);
    }
    try {
        if (nativeSwitcher) {
            await nativeSwitcher.fn(model, options);
        } else {
            await modelSwitchTo(
                session,
                model,
                options?.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : undefined,
            );
        }
    } catch (error) {
        const sdkError = toSdkOperationError(operation, error);
        emitSdkOperationMetric({
            operation,
            status: 'failed',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { model, errorKind: sdkError.kind },
        });
        throw sdkError;
    }

    const verification = await verifySessionModelSwitch(session, model, options);
    if (!nativeSwitcher) {
        verification.usedRpcFallback = true;
        if (!verification.effectiveModel) verification.effectiveModel = model;
        verification.verifiedSwitch = verification.verifiedSwitch || verification.effectiveModel === model;
    }
    if (verification.effectiveModel) {
        Reflect.set(session, '__copilotEffectiveModel', verification.effectiveModel);
    }
    Reflect.set(session, '__copilotModelVerified', verification.verifiedSwitch);
    emitSdkOperationMetric({
        operation,
        status: 'succeeded',
        sessionId: session.sessionId,
        durationMs: Date.now() - startedAt,
        attributes: {
            model,
            verifiedSwitch: verification.verifiedSwitch,
            ...(verification.effectiveModel ? { effectiveModel: verification.effectiveModel } : {}),
            ...(verification.usedRpcFallback ? { usedRpcFallback: true } : {}),
        },
    });
    return verification;
}

/** @param {CopilotSession} session @returns {Promise<SessionEvent[]>} */
export async function getSessionMessages(session) {
    assertSession(session, 'getMessages');
    log('DEBUG', `[session-runtime] getMessages: sessionId='${session.sessionId}'`);
    let messages;
    try {
        messages = await session.getMessages();
    } catch (error) {
        throw toSdkOperationError('session.getMessages', error);
    }
    log('DEBUG', `[session-runtime] getMessages retornou ${messages.length} eventos: sessionId='${session.sessionId}'`);
    return messages;
}

/** @param {CopilotSession} session */
export function getSessionWorkspacePath(session) {
    assertSession(session, 'workspacePath');
    return session.workspacePath;
}

/** @param {CopilotSession} session */
export async function disposeSession(session) {
    assertSession(session, 'dispose');
    log('INFO', `[session-runtime] Disposing sessão: sessionId='${session.sessionId}'`);
    try {
        await session[Symbol.asyncDispose]();
    } catch (error) {
        throw toSdkOperationError('session.dispose', error);
    }
    log('INFO', `[session-runtime] Sessão disposed: sessionId='${session.sessionId}'`);
}

/**
 * @param {object} params
 * @param {() => Promise<CopilotSession>} params.create
 * @param {(session: CopilotSession) => Promise<void>} params.use
 * @param {{ abortOnError?: boolean; forceDispose?: boolean }} [params.options]
 * @returns {Promise<{ session: CopilotSession; aborted: boolean; error: Error | undefined }>}
 */
export async function runSessionLifecycle({ create, use, options }) {
    const opts = options ?? {};
    const session = await create();
    let aborted = false;
    /** @type {Error | undefined} */
    let error;

    try {
        await use(session);
    } catch (e) {
        error = toError(e);
        if (opts.abortOnError !== false) {
            try {
                await abortSession(session);
                aborted = true;
            } catch (abortErr) {
                log('WARN', `[session-runtime] abort após erro falhou: ${toError(abortErr).message}`);
            }
        }
    } finally {
        try {
            if (opts.forceDispose) {
                await disposeSession(session);
            } else {
                await disconnectSessionSafe(session);
            }
        } catch (cleanupErr) {
            log('WARN', `[session-runtime] cleanup falhou: ${toError(cleanupErr).message}`);
        }
    }

    return { session, aborted, error };
}
