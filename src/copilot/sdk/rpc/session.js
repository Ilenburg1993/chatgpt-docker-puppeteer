// @ts-check
/**
 * src/copilot/sdk/rpc-session.js
 *
 * RPC facade: model, mode, plan, workspace, sessionLog.
 *
 * @module copilot/sdk/rpc-session
 * @see EventBus
 */

import { log as appLog } from '../logger.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
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
 * @param {CopilotSession} session
 * @returns {Promise<unknown>}
 */
export async function modelGetCurrent(session) {
    assertSession(session, 'model.getCurrent');
    appLog('DEBUG', `[sdk/rpc] model.getCurrent: sessionId='${session.sessionId}'`);
    return session.rpc.model.getCurrent();
}

/**
 * Troca o modelo da sessão via RPC. Troca o modelo via RPC de baixo nível.
 *
 * **NOTA**: Prefira `session.setModel()` (via `sdk/session/wrapper.js`) para troca de modelo em código de negócio. Esta
 * função é uma alternativa de baixo nível que acessa `session.rpc.model.switchTo()` diretamente e pode não disparar
 * hooks/lifecycle internos do SDK.
 *
 * @param {CopilotSession} session
 * @param {{ reasoningEffort?: string }} [options]
 * @returns {Promise<unknown>}
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
    return session.rpc.model.switchTo(params);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retorna o modo atual da sessão (interactive, plan, autopilot).
 *
 * @param {CopilotSession} session
 * @returns {Promise<unknown>}
 */
export async function modeGet(session) {
    assertSession(session, 'mode.get');
    appLog('DEBUG', `[sdk/rpc] mode.get: sessionId='${session.sessionId}'`);
    return session.rpc.mode.get();
}

/**
 * Altera o modo da sessão.
 *
 * @param {CopilotSession} session
 * @param {'interactive' | 'plan' | 'autopilot'} mode
 * @returns {Promise<unknown>}
 */
export async function modeSet(session, mode) {
    assertSession(session, 'mode.set');
    const valid = ['interactive', 'plan', 'autopilot'];
    if (!valid.includes(mode)) {
        throw new TypeError(`[sdk/rpc/mode.set] mode deve ser um de: ${valid.join(', ')}.`);
    }
    appLog('INFO', `[sdk/rpc] mode.set: mode='${mode}', sessionId='${session.sessionId}'`);
    return session.rpc.mode.set({ mode });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lê o plano da sessão (plan.md do workspace infinito).
 *
 * @param {CopilotSession} session
 * @returns {Promise<unknown>}
 */
export async function planRead(session) {
    assertSession(session, 'plan.read');
    appLog('DEBUG', `[sdk/rpc] plan.read: sessionId='${session.sessionId}'`);
    return session.rpc.plan.read();
}

/**
 * Atualiza o conteúdo do plano.
 *
 * @param {CopilotSession} session
 * @param {string} content - Novo conteúdo do plan.md
 * @returns {Promise<object>}
 */
export async function planUpdate(session, content) {
    assertSession(session, 'plan.update');
    if (typeof content !== 'string') {
        throw new TypeError('[sdk/rpc/plan.update] content deve ser string.');
    }
    appLog('INFO', `[sdk/rpc] plan.update: ${content.length} chars, sessionId='${session.sessionId}'`);
    return session.rpc.plan.update({ content });
}

/**
 * Remove o plano da sessão.
 *
 * @param {CopilotSession} session
 * @returns {Promise<object>}
 */
export async function planDelete(session) {
    assertSession(session, 'plan.delete');
    appLog('INFO', `[sdk/rpc] plan.delete: sessionId='${session.sessionId}'`);
    return session.rpc.plan.delete();
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKSPACE subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lista arquivos no diretório workspace da sessão infinita.
 *
 * @param {CopilotSession} session
 * @returns {Promise<unknown>}
 */
export async function workspaceListFiles(session) {
    assertSession(session, 'workspace.listFiles');
    appLog('DEBUG', `[sdk/rpc] workspace.listFiles: sessionId='${session.sessionId}'`);
    return session.rpc.workspace.listFiles();
}

/**
 * Lê um arquivo do workspace da sessão.
 *
 * @param {CopilotSession} session
 * @param {string} path - Caminho relativo dentro do diretório workspace
 * @returns {Promise<unknown>}
 */
export async function workspaceReadFile(session, path) {
    assertSession(session, 'workspace.readFile');
    if (typeof path !== 'string' || path.length === 0) {
        throw new TypeError('[sdk/rpc/workspace.readFile] path deve ser string não-vazia.');
    }
    appLog('DEBUG', `[sdk/rpc] workspace.readFile: path='${path}', sessionId='${session.sessionId}'`);
    return session.rpc.workspace.readFile({ path });
}

/**
 * Cria/sobrescreve um arquivo no workspace da sessão.
 *
 * @param {CopilotSession} session
 * @param {string} path - Caminho relativo dentro do diretório workspace
 * @param {string} content - Conteúdo UTF-8 do arquivo
 * @returns {Promise<object>}
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
    return session.rpc.workspace.createFile({ path, content });
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
 * @returns {Promise<unknown>}
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
    return session.rpc.log(
        /** @type {{ message: string; level?: 'info' | 'warning' | 'error'; ephemeral?: boolean; url?: string }} */ (
            params
        ),
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Aggregate — createSessionRpcFacade
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cria um objeto façade com todos os RPCs core agrupados por subsistema. Permite uso ergonômico: `const rpc =
 * createSessionRpcFacade(session); await rpc.model.getCurrent();`
 *
 * @param {CopilotSession} session
 * @returns {{
 *     model: {
 *         getCurrent: () => Promise<ModelCurrentResult>;
 *         switchTo: (modelId: string, options?: { reasoningEffort?: string }) => Promise<ModelSwitchResult>;
 *     };
 *     mode: { get: () => Promise<any>; set: (mode: 'interactive' | 'plan' | 'autopilot') => Promise<any> };
 *     plan: {
 *         read: () => Promise<PlanReadResult>;
 *         update: (content: string) => Promise<object>;
 *         delete: () => Promise<object>;
 *     };
 *     workspace: {
 *         listFiles: () => Promise<WorkspaceListResult>;
 *         readFile: (path: string) => Promise<WorkspaceReadResult>;
 *         createFile: (path: string, content: string) => Promise<object>;
 *     };
 *     log: (
 *         message: string,
 *         options?: { level?: 'info' | 'warning' | 'error'; ephemeral?: boolean; url?: string },
 *     ) => Promise<LogResult>;
 * }}
 */
