// @ts-check
/**
 * src/copilot/sdk/rpc-ops.js
 *
 * RPC facade: compaction, shell, elicitation, commands, permissions, tools.
 *
 * @module copilot/sdk/rpc-ops
 * @see EventBus
 */

import { toSdkOperationError } from '../errors.js';
import { log as appLog } from '../logger.js';
import { emitSdkOperationMetric } from '../telemetry/operation-metrics.js';
import { assertRpcSession } from './guards.js';

/**
 * @typedef {import('./guards.js').RpcSessionPort} RpcSessionPort
 */

/**
 * @typedef {{ name: string; displayName: string; description: string }} AgentInfo
 *
 * @typedef {{ agents: AgentInfo[] }} AgentListResult
 *
 * @typedef {{ agent: AgentInfo | null }} AgentCurrentResult
 *
 * @typedef {{ agent: AgentInfo }} AgentSelectResult
 *
 * @typedef {{}} AgentDeselectResult
 *
 * @typedef {{ agents: AgentInfo[] }} AgentReloadResult
 *
 * @typedef {{ success: boolean; tokensRemoved: number; messagesRemoved: number }} CompactionCompactResult
 *
 * @typedef {{ processId: string; stdout?: string; stderr?: string; exitCode?: number }} ShellExecResult
 *
 * @typedef {{ killed: boolean }} ShellKillResult
 *
 * @typedef {{ action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }} ElicitationResult
 *
 * @typedef {{ success: boolean }} HandleResult
 *
 * @typedef {import('../types.js').PermissionRequestResult | ({ kind: string } & Record<string, unknown>)} PermissionRequestResolution
 *
 *
 * @typedef {import('../types.js').ToolResult} ToolResult
 *
 * @typedef {{ textResultForLlm: string; resultType?: string; error?: string }} ToolResultObjectLike
 */

/**
 * Resolve método de compaction compatível entre SDKs (`history.compact` no v0.3.0, `compaction.compact` legado).
 *
 * @param {RpcSessionPort} session
 * @returns {() => Promise<CompactionCompactResult>}
 */
function getCompactionMethod(session) {
    const rpc =
        /**
         * @type {{
         *     history?: { compact?: () => Promise<CompactionCompactResult> };
         *     compaction?: { compact?: () => Promise<CompactionCompactResult> };
         * }}
         */ (session.rpc);
    // Usar closure ao invés de bind para clareza de contexto e tipagem correta
    // Guardar referência para validação strict
    if (rpc.history && typeof rpc.history.compact === 'function') {
        const method = rpc.history.compact;
        const context = rpc.history;
        return () => method.call(context);
    }
    if (rpc.compaction && typeof rpc.compaction.compact === 'function') {
        const method = rpc.compaction.compact;
        const context = rpc.compaction;
        return () => method.call(context);
    }
    throw new TypeError('[sdk/rpc/compaction.compact] RPC de compaction indisponível (history/compaction).');
}

/**
 * @param {unknown} session
 * @returns {Promise<CompactionCompactResult>}
 */
export async function compactionCompact(session) {
    assertRpcSession(session, 'compaction.compact');
    appLog('INFO', `[sdk/rpc] compaction.compact: sessionId='${session.sessionId}'`);
    const startedAt = Date.now();
    emitSdkOperationMetric({ operation: 'rpc.compaction.compact', status: 'started', sessionId: session.sessionId });
    try {
        const result = await getCompactionMethod(session)();
        emitSdkOperationMetric({
            operation: 'rpc.compaction.compact',
            status: 'succeeded',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { tokensRemoved: result.tokensRemoved, messagesRemoved: result.messagesRemoved },
        });
        return result;
    } catch (error) {
        const sdkError = toSdkOperationError('compaction.compact', error);
        emitSdkOperationMetric({
            operation: 'rpc.compaction.compact',
            status: 'failed',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { errorKind: sdkError.kind },
        });
        throw sdkError;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHELL subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Executa um comando shell na sessão.
 *
 * @param {unknown} session
 * @param {string} command - Comando shell a executar
 * @param {{ cwd?: string; timeout?: number }} [options]
 * @returns {Promise<ShellExecResult>}
 */
export async function shellExec(session, command, options) {
    assertRpcSession(session, 'shell.exec');
    if (typeof command !== 'string' || command.length === 0) {
        throw new TypeError('[sdk/rpc/shell.exec] command deve ser string não-vazia.');
    }
    const params = /** @type {{ command: string; cwd?: string; timeout?: number }} */ ({ command });
    if (options?.cwd) params.cwd = options.cwd;
    if (options?.timeout !== undefined) params.timeout = options.timeout;

    appLog('INFO', `[sdk/rpc] shell.exec: command='${command.slice(0, 80)}', sessionId='${session.sessionId}'`);
    const startedAt = Date.now();
    emitSdkOperationMetric({
        operation: 'rpc.shell.exec',
        status: 'started',
        sessionId: session.sessionId,
        attributes: { commandPreview: command.slice(0, 80), ...(options?.cwd ? { cwd: options.cwd } : {}) },
    });
    try {
        const result = /** @type {ShellExecResult} */ (await session.rpc.shell.exec(params));
        emitSdkOperationMetric({
            operation: 'rpc.shell.exec',
            status: 'succeeded',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { processId: result.processId },
        });
        return result;
    } catch (error) {
        const sdkError = toSdkOperationError('shell.exec', error);
        emitSdkOperationMetric({
            operation: 'rpc.shell.exec',
            status: 'failed',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { errorKind: sdkError.kind },
        });
        throw sdkError;
    }
}

/**
 * Envia sinal para um processo shell em execução.
 *
 * @param {unknown} session
 * @param {string} processId - ID do processo retornado por shellExec
 * @param {'SIGTERM' | 'SIGKILL' | 'SIGINT'} [signal='SIGTERM'] Default is `'SIGTERM'`
 * @returns {Promise<ShellKillResult>}
 */
export async function shellKill(session, processId, signal) {
    assertRpcSession(session, 'shell.kill');
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
    try {
        return /** @type {ShellKillResult} */ (
            await session.rpc.shell.kill(
                /** @type {{ processId: string; signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT' }} */ (params),
            )
        );
    } catch (error) {
        throw toSdkOperationError('shell.kill', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Apresenta um formulário de elicitação ao usuário e aguarda resposta.
 *
 * @param {unknown} session
 * @param {string} message - Mensagem descrevendo a informação necessária
 * @param {object} requestedSchema - JSON Schema do formulário
 * @returns {Promise<ElicitationResult>}
 */
export async function uiElicitation(session, message, requestedSchema) {
    assertRpcSession(session, 'ui.elicitation');
    if (typeof message !== 'string' || message.length === 0) {
        throw new TypeError('[sdk/rpc/ui.elicitation] message deve ser string não-vazia.');
    }
    if (!requestedSchema || typeof requestedSchema !== 'object') {
        throw new TypeError('[sdk/rpc/ui.elicitation] requestedSchema deve ser um objeto.');
    }
    appLog('INFO', `[sdk/rpc] ui.elicitation: sessionId='${session.sessionId}'`);
    const startedAt = Date.now();
    emitSdkOperationMetric({ operation: 'rpc.ui.elicitation', status: 'started', sessionId: session.sessionId });
    try {
        const result = /** @type {ElicitationResult} */ (
            await session.rpc.ui.elicitation(
                /** @type {Parameters<typeof session.rpc.ui.elicitation>[0]} */ (
                    /** @type {unknown} */ ({
                        message,
                        requestedSchema,
                    })
                ),
            )
        );
        emitSdkOperationMetric({
            operation: 'rpc.ui.elicitation',
            status: 'succeeded',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { action: result.action },
        });
        return result;
    } catch (error) {
        const sdkError = toSdkOperationError('ui.elicitation', error);
        emitSdkOperationMetric({
            operation: 'rpc.ui.elicitation',
            status: 'failed',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { errorKind: sdkError.kind },
        });
        throw sdkError;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMANDS subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve um comando pendente na sessão.
 *
 * @param {unknown} session
 * @param {string} requestId - ID da requisição do comando
 * @param {{ error?: string }} [options]
 * @returns {Promise<HandleResult>}
 */
export async function commandsHandlePending(session, requestId, options) {
    assertRpcSession(session, 'commands.handlePendingCommand');
    if (typeof requestId !== 'string' || requestId.length === 0) {
        throw new TypeError('[sdk/rpc/commands.handlePendingCommand] requestId deve ser string não-vazia.');
    }
    const params = /** @type {{ requestId: string; error?: string }} */ ({ requestId });
    if (options?.error) params.error = options.error;

    appLog(
        'DEBUG',
        `[sdk/rpc] commands.handlePendingCommand: requestId='${requestId}', sessionId='${session.sessionId}'`,
    );
    try {
        return /** @type {HandleResult} */ (await session.rpc.commands.handlePendingCommand(params));
    } catch (error) {
        throw toSdkOperationError('commands.handlePendingCommand', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERMISSIONS subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve uma requisição de permissão pendente.
 *
 * @param {unknown} session
 * @param {string} requestId
 * @param {PermissionRequestResolution} result - Resultado da permissão (`approve-once`, `reject`, etc.)
 * @returns {Promise<HandleResult>}
 */
export async function permissionsHandlePending(session, requestId, result) {
    assertRpcSession(session, 'permissions.handlePendingPermissionRequest');
    if (typeof requestId !== 'string' || requestId.length === 0) {
        throw new TypeError(
            '[sdk/rpc/permissions.handlePendingPermissionRequest] requestId deve ser string não-vazia.',
        );
    }
    if (!result || typeof result !== 'object' || !result.kind) {
        throw new TypeError('[sdk/rpc/permissions.handlePendingPermissionRequest] result deve ter propriedade kind.');
    }
    appLog('DEBUG', `[sdk/rpc] permissions.handlePending: kind='${result.kind}', sessionId='${session.sessionId}'`);
    try {
        return /** @type {HandleResult} */ (
            await session.rpc.permissions.handlePendingPermissionRequest(
                /** @type {Parameters<typeof session.rpc.permissions.handlePendingPermissionRequest>[0]} */ (
                    /** @type {unknown} */ ({
                        requestId,
                        result,
                    })
                ),
            )
        );
    } catch (error) {
        throw toSdkOperationError('permissions.handlePendingPermissionRequest', error);
    }
}

/**
 * Lista permissões pendentes da sessão quando o namespace RPC oferece um método de listagem.
 *
 * Mantém compatibilidade com múltiplas assinaturas do SDK e retorna um envelope estável para camadas superiores
 * (agent/presentation/terminal).
 *
 * @param {unknown} session
 * @returns {Promise<{ available: boolean; source: string | null; requests: unknown[] }>}
 */
export async function permissionsListPending(session) {
    assertRpcSession(session, 'permissions.listPendingPermissionRequests');
    const permissions = /** @type {Record<string, unknown>} */ (
        /** @type {unknown} */ (session.rpc?.permissions ?? {})
    );

    /** @type {((...args: unknown[]) => Promise<unknown>) | null} */
    let listFn = null;
    /** @type {string | null} */
    let source = null;

    if (typeof permissions['listPendingPermissionRequests'] === 'function') {
        listFn = /** @type {(...args: unknown[]) => Promise<unknown>} */ (permissions['listPendingPermissionRequests']);
        source = 'permissions.listPendingPermissionRequests';
    } else if (typeof permissions['listPendingRequests'] === 'function') {
        listFn = /** @type {(...args: unknown[]) => Promise<unknown>} */ (permissions['listPendingRequests']);
        source = 'permissions.listPendingRequests';
    }

    if (!listFn || !source) {
        return { available: false, source: null, requests: [] };
    }

    appLog('DEBUG', `[sdk/rpc] ${source}: sessionId='${session.sessionId}'`);
    try {
        const raw = await listFn.call(session.rpc.permissions);
        const requests = Array.isArray(raw)
            ? raw
            : Array.isArray(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (raw))['requests'])
              ? /** @type {unknown[]} */ (
                    /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (raw))['requests']
                )
              : [];
        return { available: true, source, requests };
    } catch (error) {
        throw toSdkOperationError(source, error);
    }
}

/**
 * Ativa/desativa approve-all nativo da sessão quando o host expõe esse RPC.
 *
 * @param {unknown} session
 * @param {boolean} enabled
 * @returns {Promise<HandleResult>}
 */
export async function permissionsSetApproveAll(session, enabled) {
    assertRpcSession(session, 'permissions.setApproveAll');
    if (typeof enabled !== 'boolean') {
        throw new TypeError('[sdk/rpc/permissions.setApproveAll] enabled deve ser boolean.');
    }
    const permissions = /** @type {{ setApproveAll?: (params: { enabled: boolean }) => Promise<HandleResult> }} */ (
        /** @type {unknown} */ (session.rpc.permissions)
    );
    if (typeof permissions.setApproveAll !== 'function') {
        throw new TypeError('[sdk/rpc/permissions.setApproveAll] RPC indisponível nesta sessão SDK.');
    }
    appLog('INFO', `[sdk/rpc] permissions.setApproveAll: enabled=${enabled}, sessionId='${session.sessionId}'`);
    try {
        return /** @type {HandleResult} */ (await permissions.setApproveAll({ enabled }));
    } catch (error) {
        throw toSdkOperationError('permissions.setApproveAll', error);
    }
}

/**
 * Remove aprovações session-scoped quando o host expõe esse RPC.
 *
 * @param {unknown} session
 * @returns {Promise<HandleResult>}
 */
export async function permissionsResetSessionApprovals(session) {
    assertRpcSession(session, 'permissions.resetSessionApprovals');
    const permissions = /** @type {{ resetSessionApprovals?: () => Promise<HandleResult> }} */ (
        /** @type {unknown} */ (session.rpc.permissions)
    );
    if (typeof permissions.resetSessionApprovals !== 'function') {
        throw new TypeError('[sdk/rpc/permissions.resetSessionApprovals] RPC indisponível nesta sessão SDK.');
    }
    appLog('INFO', `[sdk/rpc] permissions.resetSessionApprovals: sessionId='${session.sessionId}'`);
    try {
        return /** @type {HandleResult} */ (await permissions.resetSessionApprovals());
    } catch (error) {
        throw toSdkOperationError('permissions.resetSessionApprovals', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLS subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve uma chamada de tool pendente.
 *
 * @param {unknown} session
 * @param {string} requestId
 * @param {{ result?: ToolResult | ToolResultObjectLike; error?: string }} [options]
 * @returns {Promise<HandleResult>}
 */
export async function toolsHandlePendingCall(session, requestId, options) {
    assertRpcSession(session, 'tools.handlePendingToolCall');
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
    try {
        return /** @type {HandleResult} */ (
            await session.rpc.tools.handlePendingToolCall(
                /**
                 * @type {{
                 *     requestId: string;
                 *     result?: ToolResult | ToolResultObjectLike;
                 *     error?: string;
                 * }}
                 */ (params),
            )
        );
    } catch (error) {
        throw toSdkOperationError('tools.handlePendingToolCall', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT subsystem (@experimental)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lista os agentes customizados disponíveis na sessão.
 *
 * @param {unknown} session
 * @returns {Promise<AgentListResult>}
 */
export async function agentList(session) {
    assertRpcSession(session, 'agent.list');
    appLog('DEBUG', `[sdk/rpc] agent.list: sessionId='${session.sessionId}'`);
    try {
        return /** @type {AgentListResult} */ (await session.rpc.agent.list());
    } catch (error) {
        throw toSdkOperationError('agent.list', error);
    }
}

/**
 * Retorna o agente atualmente selecionado para a sessão.
 *
 * @param {unknown} session
 * @returns {Promise<AgentCurrentResult>}
 */
export async function agentGetCurrent(session) {
    assertRpcSession(session, 'agent.getCurrent');
    appLog('DEBUG', `[sdk/rpc] agent.getCurrent: sessionId='${session.sessionId}'`);
    try {
        return /** @type {AgentCurrentResult} */ (await session.rpc.agent.getCurrent());
    } catch (error) {
        throw toSdkOperationError('agent.getCurrent', error);
    }
}

/**
 * Seleciona um agente customizado para o turno atual.
 *
 * @param {unknown} session
 * @param {string} name - Nome do agente a selecionar
 * @returns {Promise<AgentSelectResult>}
 */
export async function agentSelect(session, name) {
    assertRpcSession(session, 'agent.select');
    if (typeof name !== 'string' || name.length === 0) {
        throw new TypeError('[sdk/rpc/agent.select] name deve ser string não-vazia.');
    }
    appLog('INFO', `[sdk/rpc] agent.select: name='${name}', sessionId='${session.sessionId}'`);
    try {
        return /** @type {AgentSelectResult} */ (await session.rpc.agent.select({ name }));
    } catch (error) {
        throw toSdkOperationError('agent.select', error);
    }
}

/**
 * Deseleciona o agente customizado atual, voltando ao agente padrão.
 *
 * @param {unknown} session
 * @returns {Promise<AgentDeselectResult>}
 */
export async function agentDeselect(session) {
    assertRpcSession(session, 'agent.deselect');
    appLog('INFO', `[sdk/rpc] agent.deselect: sessionId='${session.sessionId}'`);
    try {
        const result = await session.rpc.agent.deselect();
        // Não descartar resultado potencial do SDK; repassar com fallback
        return /** @type {AgentDeselectResult} */ (result ?? {});
    } catch (error) {
        throw toSdkOperationError('agent.deselect', error);
    }
}

/**
 * Recarrega a lista de agentes disponíveis na sessão.
 *
 * @param {unknown} session
 * @returns {Promise<AgentReloadResult>}
 */
export async function agentReload(session) {
    assertRpcSession(session, 'agent.reload');
    appLog('INFO', `[sdk/rpc] agent.reload: sessionId='${session.sessionId}'`);
    try {
        return /** @type {AgentReloadResult} */ (await session.rpc.agent.reload());
    } catch (error) {
        throw toSdkOperationError('agent.reload', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPACTION subsystem (@experimental)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Aciona compaction manual da sessão.
 *
 * @param {unknown} session
 * @returns {Promise<CompactionCompactResult>}
 */
export async function compactionCompactTyped(session) {
    return compactionCompact(session);
}
