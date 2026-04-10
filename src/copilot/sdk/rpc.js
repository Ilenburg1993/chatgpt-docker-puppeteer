// @ts-check
/**
 * src/copilot/sdk/rpc.js
 *
 * Façade tipada para os RPCs core da sessão SDK: model (getCurrent, switchTo), mode (get, set), plan (read, update,
 * delete), workspace (listFiles, readFile, createFile), log.
 *
 * Todos os métodos validam a sessão, logam a operação e propagam erros do SDK de forma transparente.
 *
 * @module copilot/sdk/rpc
 * @see module:copilot/sdk/session-lifecycle
 */

import { log as appLog } from '#copilot/observability/logger';

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 *
 * @typedef {'interactive' | 'plan' | 'autopilot'} SessionMode
 *
 * @typedef {{ modelId?: string }} ModelCurrentResult
 *
 * @typedef {{ modelId?: string }} ModelSwitchResult
 *
 * @typedef {{ mode: SessionMode }} ModeResult
 *
 * @typedef {{ exists: boolean; content: string | null; path: string | null }} PlanReadResult
 *
 * @typedef {{ files: string[] }} WorkspaceListResult
 *
 * @typedef {{ content: string }} WorkspaceReadResult
 *
 * @typedef {{ eventId: string }} LogResult
 *
 * @typedef {{ success: boolean; tokensRemoved: number; messagesRemoved: number }} CompactionResult
 *
 * @typedef {{ processId: string }} ShellExecResult
 *
 * @typedef {{ killed: boolean }} ShellKillResult
 *
 * @typedef {{
 *     action: 'accept' | 'decline' | 'cancel';
 *     content?: Record<string, string | number | boolean | string[]>;
 * }} ElicitationResult
 *
 *
 * @typedef {{ success: boolean }} HandleResult
 */

// ─── Validação interna ────────────────────────────────────────────────────────

/**
 * @param {unknown} session
 * @param {string} caller
 * @returns {asserts session is CopilotSession}
 */
function assertSession(session, caller) {
    if (!session || typeof session !== 'object' || !('rpc' in session)) {
        throw new TypeError(`[sdk/rpc/${caller}] Sessão inválida ou sem RPC disponível.`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODEL subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retorna o modelo ativo da sessão.
 *
 * @param {CopilotSession} session
 * @returns {Promise<ModelCurrentResult>}
 */
export async function modelGetCurrent(session) {
    assertSession(session, 'model.getCurrent');
    appLog('DEBUG', `[sdk/rpc] model.getCurrent: sessionId='${session.sessionId}'`);
    return session.rpc.model.getCurrent();
}

/**
 * Troca o modelo da sessão via RPC.
 *
 * @param {CopilotSession} session
 * @param {string} modelId - ID do modelo destino
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
    return session.rpc.model.switchTo(params);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retorna o modo atual da sessão (interactive, plan, autopilot).
 *
 * @param {CopilotSession} session
 * @returns {Promise<ModeResult>}
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
 * @param {SessionMode} mode
 * @returns {Promise<ModeResult>}
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
 * @returns {Promise<PlanReadResult>}
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
 * @returns {Promise<WorkspaceListResult>}
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
 * @returns {Promise<WorkspaceReadResult>}
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
    return session.rpc.log(/** @type {any} */ (params));
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
 *     mode: { get: () => Promise<ModeResult>; set: (mode: SessionMode) => Promise<ModeResult> };
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
export function createSessionRpcFacade(session) {
    assertSession(session, 'createSessionRpcFacade');
    return {
        model: {
            getCurrent: () => modelGetCurrent(session),
            switchTo: (modelId, options) => modelSwitchTo(session, modelId, options),
        },
        mode: {
            get: () => modeGet(session),
            set: (mode) => modeSet(session, mode),
        },
        plan: {
            read: () => planRead(session),
            update: (content) => planUpdate(session, content),
            delete: () => planDelete(session),
        },
        workspace: {
            listFiles: () => workspaceListFiles(session),
            readFile: (path) => workspaceReadFile(session, path),
            createFile: (path, content) => workspaceCreateFile(session, path, content),
        },
        log: (message, options) => sessionLog(session, message, options),
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPACTION subsystem (@experimental)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Aciona compactação manual da sessão. Remove mensagens antigas para liberar tokens.
 *
 * @param {CopilotSession} session
 * @returns {Promise<CompactionResult>}
 */
export async function compactionCompact(session) {
    assertSession(session, 'compaction.compact');
    appLog('INFO', `[sdk/rpc] compaction.compact: sessionId='${session.sessionId}'`);
    return session.rpc.compaction.compact();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHELL subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Executa um comando shell na sessão.
 *
 * @param {CopilotSession} session
 * @param {string} command - Comando shell a executar
 * @param {{ cwd?: string; timeout?: number }} [options]
 * @returns {Promise<ShellExecResult>}
 */
export async function shellExec(session, command, options) {
    assertSession(session, 'shell.exec');
    if (typeof command !== 'string' || command.length === 0) {
        throw new TypeError('[sdk/rpc/shell.exec] command deve ser string não-vazia.');
    }
    const params = /** @type {{ command: string; cwd?: string; timeout?: number }} */ ({ command });
    if (options?.cwd) params.cwd = options.cwd;
    if (options?.timeout !== undefined) params.timeout = options.timeout;

    appLog('INFO', `[sdk/rpc] shell.exec: command='${command.slice(0, 80)}', sessionId='${session.sessionId}'`);
    return session.rpc.shell.exec(params);
}

/**
 * Envia sinal para um processo shell em execução.
 *
 * @param {CopilotSession} session
 * @param {string} processId - ID do processo retornado por shellExec
 * @param {'SIGTERM' | 'SIGKILL' | 'SIGINT'} [signal='SIGTERM'] Default is `'SIGTERM'`
 * @returns {Promise<ShellKillResult>}
 */
export async function shellKill(session, processId, signal) {
    assertSession(session, 'shell.kill');
    if (typeof processId !== 'string' || processId.length === 0) {
        throw new TypeError('[sdk/rpc/shell.kill] processId deve ser string não-vazia.');
    }
    /** @type {Record<string, unknown>} */
    const params = { processId };
    if (signal) params['signal'] = signal;

    appLog(
        'INFO',
        `[sdk/rpc] shell.kill: processId='${processId}', signal='${signal ?? 'SIGTERM'}', sessionId='${session.sessionId}'`,
    );
    return session.rpc.shell.kill(/** @type {any} */ (params));
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Apresenta um formulário de elicitação ao usuário e aguarda resposta.
 *
 * @param {CopilotSession} session
 * @param {string} message - Mensagem descrevendo a informação necessária
 * @param {object} requestedSchema - JSON Schema do formulário
 * @returns {Promise<ElicitationResult>}
 */
export async function uiElicitation(session, message, requestedSchema) {
    assertSession(session, 'ui.elicitation');
    if (typeof message !== 'string' || message.length === 0) {
        throw new TypeError('[sdk/rpc/ui.elicitation] message deve ser string não-vazia.');
    }
    if (!requestedSchema || typeof requestedSchema !== 'object') {
        throw new TypeError('[sdk/rpc/ui.elicitation] requestedSchema deve ser um objeto.');
    }
    appLog('INFO', `[sdk/rpc] ui.elicitation: sessionId='${session.sessionId}'`);
    return session.rpc.ui.elicitation(/** @type {any} */ ({ message, requestedSchema }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMANDS subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve um comando pendente na sessão.
 *
 * @param {CopilotSession} session
 * @param {string} requestId - ID da requisição do comando
 * @param {{ error?: string }} [options]
 * @returns {Promise<HandleResult>}
 */
export async function commandsHandlePending(session, requestId, options) {
    assertSession(session, 'commands.handlePendingCommand');
    if (typeof requestId !== 'string' || requestId.length === 0) {
        throw new TypeError('[sdk/rpc/commands.handlePendingCommand] requestId deve ser string não-vazia.');
    }
    const params = /** @type {{ requestId: string; error?: string }} */ ({ requestId });
    if (options?.error) params.error = options.error;

    appLog(
        'DEBUG',
        `[sdk/rpc] commands.handlePendingCommand: requestId='${requestId}', sessionId='${session.sessionId}'`,
    );
    return session.rpc.commands.handlePendingCommand(params);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERMISSIONS subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve uma requisição de permissão pendente.
 *
 * @param {CopilotSession} session
 * @param {string} requestId
 * @param {{ kind: string } & Record<string, unknown>} result - Resultado da permissão (approved, denied-*)
 * @returns {Promise<HandleResult>}
 */
export async function permissionsHandlePending(session, requestId, result) {
    assertSession(session, 'permissions.handlePendingPermissionRequest');
    if (typeof requestId !== 'string' || requestId.length === 0) {
        throw new TypeError(
            '[sdk/rpc/permissions.handlePendingPermissionRequest] requestId deve ser string não-vazia.',
        );
    }
    if (!result || typeof result !== 'object' || !result.kind) {
        throw new TypeError('[sdk/rpc/permissions.handlePendingPermissionRequest] result deve ter propriedade kind.');
    }
    appLog('DEBUG', `[sdk/rpc] permissions.handlePending: kind='${result.kind}', sessionId='${session.sessionId}'`);
    return session.rpc.permissions.handlePendingPermissionRequest(/** @type {any} */ ({ requestId, result }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLS subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve uma chamada de tool pendente.
 *
 * @param {CopilotSession} session
 * @param {string} requestId
 * @param {{ result?: string | { textResultForLlm: string; resultType?: string; error?: string }; error?: string }} [options]
 * @returns {Promise<HandleResult>}
 */
export async function toolsHandlePendingCall(session, requestId, options) {
    assertSession(session, 'tools.handlePendingToolCall');
    if (typeof requestId !== 'string' || requestId.length === 0) {
        throw new TypeError('[sdk/rpc/tools.handlePendingToolCall] requestId deve ser string não-vazia.');
    }
    /** @type {Record<string, unknown>} */
    const params = { requestId };
    if (options?.result !== undefined) params['result'] = options.result;
    if (options?.error) params['error'] = options.error;

    appLog(
        'DEBUG',
        `[sdk/rpc] tools.handlePendingToolCall: requestId='${requestId}', sessionId='${session.sessionId}'`,
    );
    return session.rpc.tools.handlePendingToolCall(/** @type {any} */ (params));
}
