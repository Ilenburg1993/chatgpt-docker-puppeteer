// @ts-check
/**
 * Wrappers de `session.capabilities` e `session.ui` do SDK.
 *
 * Este módulo fecha uma lacuna importante do wrapper layer: antes expúnhamos apenas `session.rpc.ui.elicitation()`;
 * agora cobrimos também a API pública de alto nível (`session.ui`) documentada pelo SDK.
 *
 * @module copilot/sdk/session/ui
 */

import { toSdkOperationError } from '../errors.js';
import { log as appLog } from '../logger.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 *
 * @typedef {import('../types.js').SessionCapabilities} SessionCapabilities
 *
 * @typedef {import('../types.js').ElicitationParams} ElicitationParams
 *
 * @typedef {import('../types.js').ElicitationResult} ElicitationResult
 *
 * @typedef {import('../types.js').InputOptions} InputOptions
 */

/**
 * @param {CopilotSession} session
 * @returns {{
 *     elicitation?: (params: ElicitationParams) => Promise<ElicitationResult>;
 *     confirm?: (message: string) => Promise<boolean>;
 *     select?: (message: string, options: string[]) => Promise<string | null>;
 *     input?: (message: string, options?: InputOptions) => Promise<string | null>;
 * } | null}
 */
function getSessionUiRef(session) {
    return session.ui && typeof session.ui === 'object'
        ? /**
           * @type {{
           *     elicitation?: (params: ElicitationParams) => Promise<ElicitationResult>;
           *     confirm?: (message: string) => Promise<boolean>;
           *     select?: (message: string, options: string[]) => Promise<string | null>;
           *     input?: (message: string, options?: InputOptions) => Promise<string | null>;
           * }}
           */ (session.ui)
        : null;
}

/**
 * @param {CopilotSession} session
 * @returns {boolean}
 */
function hasRpcUiElicitation(session) {
    return Boolean(session.rpc && typeof session.rpc === 'object' && session.rpc.ui?.elicitation);
}

/**
 * @param {CopilotSession} session
 * @param {ElicitationParams} params
 * @returns {Promise<ElicitationResult>}
 */
async function invokeGenericElicitation(session, params) {
    const ui = getSessionUiRef(session);
    if (typeof ui?.elicitation === 'function') {
        return /** @type {ElicitationResult} */ (await ui.elicitation(params));
    }
    if (hasRpcUiElicitation(session)) {
        return /** @type {ElicitationResult} */ (
            await session.rpc.ui.elicitation(
                /** @type {Parameters<typeof session.rpc.ui.elicitation>[0]} */ (/** @type {unknown} */ (params)),
            )
        );
    }
    throw new TypeError('[sdk/session/ui] sessão não expõe session.ui nem session.rpc.ui.elicitation.');
}

/**
 * @param {ElicitationResult} result
 * @param {string} key
 * @returns {string | null}
 */
function readStringField(result, key) {
    const value = result.content?.[key];
    return typeof value === 'string' ? value : null;
}

/**
 * @param {ElicitationResult} result
 * @param {string} key
 * @returns {boolean | null}
 */
function readBooleanField(result, key) {
    const value = result.content?.[key];
    return typeof value === 'boolean' ? value : null;
}

/**
 * @param {unknown} session
 * @param {string} caller
 * @returns {asserts session is CopilotSession}
 */
function assertSession(session, caller) {
    if (!session || typeof session !== 'object' || !('sessionId' in session)) {
        throw new TypeError(`[sdk/session/ui.${caller}] sessão inválida ou não fornecida.`);
    }
}

/**
 * @param {CopilotSession} session
 * @returns {SessionCapabilities}
 */
export function getSessionCapabilities(session) {
    assertSession(session, 'getSessionCapabilities');
    return /** @type {SessionCapabilities} */ (session.capabilities ?? {});
}

/**
 * @param {CopilotSession} session
 * @returns {boolean}
 */
export function isSessionUiElicitationAvailable(session) {
    assertSession(session, 'isSessionUiElicitationAvailable');
    return Boolean(
        getSessionCapabilities(session).ui?.elicitation ||
        getSessionUiRef(session)?.elicitation ||
        hasRpcUiElicitation(session),
    );
}

/**
 * @param {CopilotSession} session
 * @param {ElicitationParams} params
 * @returns {Promise<ElicitationResult>}
 */
export async function sessionUiElicitation(session, params) {
    assertSession(session, 'sessionUiElicitation');
    if (!params || typeof params !== 'object') {
        throw new TypeError('[sdk/session/ui.elicitation] params deve ser um objeto.');
    }
    if (typeof params.message !== 'string' || params.message.length === 0) {
        throw new TypeError('[sdk/session/ui.elicitation] params.message deve ser string não-vazia.');
    }
    if (!params.requestedSchema || typeof params.requestedSchema !== 'object') {
        throw new TypeError('[sdk/session/ui.elicitation] params.requestedSchema deve ser um objeto.');
    }
    appLog('INFO', `[sdk/session/ui] elicitation: sessionId='${session.sessionId}'`);
    try {
        return await invokeGenericElicitation(session, params);
    } catch (error) {
        throw toSdkOperationError('session.ui.elicitation', error);
    }
}

/**
 * @param {CopilotSession} session
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export async function sessionUiConfirm(session, message) {
    assertSession(session, 'sessionUiConfirm');
    if (typeof message !== 'string' || message.length === 0) {
        throw new TypeError('[sdk/session/ui.confirm] message deve ser string não-vazia.');
    }
    try {
        const ui = getSessionUiRef(session);
        if (typeof ui?.confirm === 'function') {
            return await ui.confirm(message);
        }
        const result = await invokeGenericElicitation(session, {
            message,
            requestedSchema: {
                type: 'object',
                properties: {
                    confirmed: {
                        type: 'boolean',
                        title: 'Confirmar',
                        description: message,
                        default: true,
                    },
                },
                required: ['confirmed'],
            },
        });
        if (result.action !== 'accept') return false;
        return readBooleanField(result, 'confirmed') ?? true;
    } catch (error) {
        throw toSdkOperationError('session.ui.confirm', error);
    }
}

/**
 * @param {CopilotSession} session
 * @param {string} message
 * @param {string[]} options
 * @returns {Promise<string | null>}
 */
export async function sessionUiSelect(session, message, options) {
    assertSession(session, 'sessionUiSelect');
    if (typeof message !== 'string' || message.length === 0) {
        throw new TypeError('[sdk/session/ui.select] message deve ser string não-vazia.');
    }
    if (!Array.isArray(options) || options.length === 0 || options.some((item) => typeof item !== 'string')) {
        throw new TypeError('[sdk/session/ui.select] options deve ser um array não-vazio de strings.');
    }
    try {
        const ui = getSessionUiRef(session);
        if (typeof ui?.select === 'function') {
            return await ui.select(message, options);
        }
        const result = await invokeGenericElicitation(session, {
            message,
            requestedSchema: {
                type: 'object',
                properties: {
                    value: {
                        type: 'string',
                        title: 'Seleção',
                        description: message,
                        enum: options,
                    },
                },
                required: ['value'],
            },
        });
        if (result.action !== 'accept') return null;
        return readStringField(result, 'value');
    } catch (error) {
        throw toSdkOperationError('session.ui.select', error);
    }
}

/**
 * @param {CopilotSession} session
 * @param {string} message
 * @param {InputOptions} [options]
 * @returns {Promise<string | null>}
 */
export async function sessionUiInput(session, message, options) {
    assertSession(session, 'sessionUiInput');
    if (typeof message !== 'string' || message.length === 0) {
        throw new TypeError('[sdk/session/ui.input] message deve ser string não-vazia.');
    }
    try {
        const ui = getSessionUiRef(session);
        if (typeof ui?.input === 'function') {
            return options ? await ui.input(message, options) : await ui.input(message);
        }
        const result = await invokeGenericElicitation(session, {
            message,
            requestedSchema: {
                type: 'object',
                properties: {
                    value: {
                        type: 'string',
                        ...(options?.title !== undefined ? { title: options.title } : {}),
                        ...(options?.description !== undefined ? { description: options.description } : {}),
                        ...(options?.minLength !== undefined ? { minLength: options.minLength } : {}),
                        ...(options?.maxLength !== undefined ? { maxLength: options.maxLength } : {}),
                        ...(options?.format ? { format: options.format } : {}),
                        ...(options?.default !== undefined ? { default: options.default } : {}),
                    },
                },
                required: ['value'],
            },
        });
        if (result.action !== 'accept') return null;
        return readStringField(result, 'value');
    } catch (error) {
        throw toSdkOperationError('session.ui.input', error);
    }
}
