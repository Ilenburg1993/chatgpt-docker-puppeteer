// @ts-check
/**
 * src/copilot/sdk/rpc-session.js
 *
 * RPC facade: model, mode, plan, workspace, sessionLog.
 *
 * @module copilot/sdk/rpc-session
 * @see EventBus
 */

import { toSdkOperationError } from '../errors.js';
import { log as appLog } from '../logger.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 *
 * @typedef {{ modelId?: string }} ModelCurrentResult
 *
 * @typedef {{ modelId?: string }} ModelSwitchResult
 *
 * @typedef {{ mode: 'interactive' | 'plan' | 'autopilot' }} ModeGetResult
 *
 * @typedef {{ mode: 'interactive' | 'plan' | 'autopilot' }} ModeSetResult
 *
 * @typedef {{ exists: boolean; content: string | null; path: string | null }} PlanReadResult
 *
 * @typedef {{ success?: boolean }} PlanMutationResult
 *
 * @typedef {{ files: string[] }} WorkspaceListResult
 *
 * @typedef {{ content: string }} WorkspaceReadResult
 *
 * @typedef {{ success?: boolean }} WorkspaceCreateResult
 *
 * @typedef {{ eventId: string }} LogResult
 */

/**
 * @param {unknown} session
 * @param {string} caller
 * @returns {asserts session is CopilotSession}
 */
function assertSession(session, caller) {
    if (!session || typeof session !== 'object' || !('rpc' in session)) {
        throw new TypeError('[sdk/rpc/' + caller + '] Sessao invalida ou sem RPC disponivel.');
    }
}

/**
 * Retorna o modelo atualmente ativo da sessão.
 *
 * @param {CopilotSession} session
 * @returns {Promise<ModelCurrentResult>}
 */
export async function modelGetCurrent(session) {
    assertSession(session, 'model.getCurrent');
    appLog('DEBUG', `[sdk/rpc] model.getCurrent: sessionId='${session.sessionId}'`);
    try {
        return /** @type {ModelCurrentResult} */ (await session.rpc.model.getCurrent());
    } catch (error) {
        throw toSdkOperationError('model.getCurrent', error);
    }
}

/**
 * Troca o modelo da sessão via RPC. Troca o modelo via RPC de baixo nível.
 *
 * **NOTA**: Prefira `session.setModel()` (via `sdk/session/wrapper.js`) para troca de modelo em código de negócio. Esta
 * função é uma alternativa de baixo nível que acessa `session.rpc.model.switchTo()` diretamente e pode não disparar
 * hooks/lifecycle internos do SDK.
 *
 * @param {CopilotSession} session
 * @param {string} modelId
 * @param {{ reasoningEffort?: string }} [options]
 * @returns {Promise<ModelSwitchResult>}
 */
export async function modelSwitchTo(session, modelId, options) {
    assertSession(session, 'model.switchTo');
    if (typeof modelId !== 'string' || modelId.length === 0) {
        throw new TypeError('[sdk/rpc/model.switchTo] modelId deve ser string não-vazia.');
    }
    appLog('INFO', `[sdk/rpc] model.switchTo: modelId='${modelId}', sessionId='${session.sessionId}'`);
    const params = /** @type {{ modelId: string; reasoningEffort?: string }} */ ({ modelId });
    if (options?.reasoningEffort) {
        params.reasoningEffort = options.reasoningEffort;
    }
    try {
        return /** @type {ModelSwitchResult} */ (await session.rpc.model.switchTo(params));
    } catch (error) {
        throw toSdkOperationError('model.switchTo', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retorna o modo atual da sessão (interactive, plan, autopilot).
 *
 * @param {CopilotSession} session
 * @returns {Promise<ModeGetResult>}
 */
export async function modeGet(session) {
    assertSession(session, 'mode.get');
    appLog('DEBUG', `[sdk/rpc] mode.get: sessionId='${session.sessionId}'`);
    try {
        return /** @type {ModeGetResult} */ (await session.rpc.mode.get());
    } catch (error) {
        throw toSdkOperationError('mode.get', error);
    }
}

/**
 * Altera o modo da sessão.
 *
 * @param {CopilotSession} session
 * @param {'interactive' | 'plan' | 'autopilot'} mode
 * @returns {Promise<ModeSetResult>}
 */
export async function modeSet(session, mode) {
    assertSession(session, 'mode.set');
    const valid = ['interactive', 'plan', 'autopilot'];
    if (!valid.includes(mode)) {
        throw new TypeError(`[sdk/rpc/mode.set] mode deve ser um de: ${valid.join(', ')}.`);
    }
    appLog('INFO', `[sdk/rpc] mode.set: mode='${mode}', sessionId='${session.sessionId}'`);
    try {
        return /** @type {ModeSetResult} */ (await session.rpc.mode.set({ mode }));
    } catch (error) {
        throw toSdkOperationError('mode.set', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lê o plano da sessão (plan.md do workspace infinito).
 *
 * @param {CopilotSession} session
 * @returns {Promise<PlanReadResult>}
 */
export async function planRead(session) {
    assertSession(session, 'plan.read');
    appLog('DEBUG', `[sdk/rpc] plan.read: sessionId='${session.sessionId}'`);
    try {
        return /** @type {PlanReadResult} */ (await session.rpc.plan.read());
    } catch (error) {
        throw toSdkOperationError('plan.read', error);
    }
}

/**
 * Atualiza o conteúdo do plano.
 *
 * @param {CopilotSession} session
 * @param {string} content - Novo conteúdo do plan.md
 * @returns {Promise<PlanMutationResult>}
 */
export async function planUpdate(session, content) {
    assertSession(session, 'plan.update');
    if (typeof content !== 'string') {
        throw new TypeError('[sdk/rpc/plan.update] content deve ser string.');
    }
    appLog('INFO', `[sdk/rpc] plan.update: ${content.length} chars, sessionId='${session.sessionId}'`);
    try {
        return /** @type {PlanMutationResult} */ (await session.rpc.plan.update({ content }));
    } catch (error) {
        throw toSdkOperationError('plan.update', error);
    }
}

/**
 * Remove o plano da sessão.
 *
 * @param {CopilotSession} session
 * @returns {Promise<PlanMutationResult>}
 */
export async function planDelete(session) {
    assertSession(session, 'plan.delete');
    appLog('INFO', `[sdk/rpc] plan.delete: sessionId='${session.sessionId}'`);
    try {
        return /** @type {PlanMutationResult} */ (await session.rpc.plan.delete());
    } catch (error) {
        throw toSdkOperationError('plan.delete', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKSPACE subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lista arquivos no diretório workspace da sessão infinita.
 *
 * @param {CopilotSession} session
 * @returns {Promise<WorkspaceListResult>}
 */
export async function workspaceListFiles(session) {
    assertSession(session, 'workspace.listFiles');
    appLog('DEBUG', `[sdk/rpc] workspace.listFiles: sessionId='${session.sessionId}'`);
    try {
        return /** @type {WorkspaceListResult} */ (await session.rpc.workspace.listFiles());
    } catch (error) {
        throw toSdkOperationError('workspace.listFiles', error);
    }
}

/**
 * Lê um arquivo do workspace da sessão.
 *
 * @param {CopilotSession} session
 * @param {string} path - Caminho relativo dentro do diretório workspace
 * @returns {Promise<WorkspaceReadResult>}
 */
export async function workspaceReadFile(session, path) {
    assertSession(session, 'workspace.readFile');
    if (typeof path !== 'string' || path.length === 0) {
        throw new TypeError('[sdk/rpc/workspace.readFile] path deve ser string não-vazia.');
    }
    appLog('DEBUG', `[sdk/rpc] workspace.readFile: path='${path}', sessionId='${session.sessionId}'`);
    try {
        return /** @type {WorkspaceReadResult} */ (await session.rpc.workspace.readFile({ path }));
    } catch (error) {
        throw toSdkOperationError('workspace.readFile', error);
    }
}

/**
 * Cria/sobrescreve um arquivo no workspace da sessão.
 *
 * @param {CopilotSession} session
 * @param {string} path - Caminho relativo dentro do diretório workspace
 * @param {string} content - Conteúdo UTF-8 do arquivo
 * @returns {Promise<WorkspaceCreateResult>}
 */
export async function workspaceCreateFile(session, path, content) {
    assertSession(session, 'workspace.createFile');
    if (typeof path !== 'string' || path.length === 0) {
        throw new TypeError('[sdk/rpc/workspace.createFile] path deve ser string não-vazia.');
    }
    if (typeof content !== 'string') {
        throw new TypeError('[sdk/rpc/workspace.createFile] content deve ser string.');
    }
    appLog(
        'INFO',
        `[sdk/rpc] workspace.createFile: path='${path}', ${content.length} chars, sessionId='${session.sessionId}'`,
    );
    try {
        return /** @type {WorkspaceCreateResult} */ (await session.rpc.workspace.createFile({ path, content }));
    } catch (error) {
        throw toSdkOperationError('workspace.createFile', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOG subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Emite uma mensagem de log na timeline da sessão.
 *
 * @param {CopilotSession} session
 * @param {string} message - Texto legível
 * @param {{ level?: 'info' | 'warning' | 'error'; ephemeral?: boolean; url?: string }} [options]
 * @returns {Promise<LogResult>}
 */
export async function sessionLog(session, message, options) {
    assertSession(session, 'log');
    if (typeof message !== 'string' || message.length === 0) {
        throw new TypeError('[sdk/rpc/log] message deve ser string não-vazia.');
    }
    /** @type {Record<string, unknown>} */
    const params = { message };
    if (options?.level) params['level'] = options.level;
    if (options?.ephemeral !== undefined) params['ephemeral'] = options.ephemeral;
    if (options?.url) params['url'] = options.url;

    appLog('DEBUG', `[sdk/rpc] log: level='${options?.level ?? 'info'}', sessionId='${session.sessionId}'`);
    try {
        return /** @type {LogResult} */ (
            await session.rpc.log(
                /** @type {{
    message: string;
    level?: 'info' | 'warning' | 'error';
    ephemeral?: boolean;
    url?: string;
}} */ (params),
            )
        );
    } catch (error) {
        throw toSdkOperationError('log', error);
    }
}
