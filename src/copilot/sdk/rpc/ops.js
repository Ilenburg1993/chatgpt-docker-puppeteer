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

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
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
 * Resolve método de compaction compatível entre SDKs (`history.compact` no v0.3.0, `compaction.compact` legado).
 *
 * @param {CopilotSession} session
 * @returns {() => Promise<CompactionCompactResult>}
 */
function getCompactionMethod(session) {
    const rpc = /**
     * @type {{
     *     history?: { compact?: () => Promise<CompactionCompactResult> };
     *     compaction?: { compact?: () => Promise<CompactionCompactResult> };
     * }}
     */ (session.rpc);
    const fn = rpc.history?.compact ?? rpc.compaction?.compact;
    if (typeof fn !== 'function') {
        throw new TypeError('[sdk/rpc/compaction.compact] RPC de compaction indisponível (history/compaction).');
    }
    return fn.bind(rpc.history ?? rpc.compaction);
}

/**
 * @param {CopilotSession} session
 * @returns {Promise<CompactionCompactResult>}
 */
export async function compactionCompact(session) {
    assertSession(session, 'compaction.compact');
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
    try {
        return /** @type {ShellExecResult} */ (await session.rpc.shell.exec(params));
    } catch (error) {
        throw toSdkOperationError('shell.exec', error);
    }
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
 * @param {CopilotSession} session
 * @param {string} requestId
 * @param {PermissionRequestResolution} result - Resultado da permissão (approved, denied-*)
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

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLS subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve uma chamada de tool pendente.
 *
 * @param {CopilotSession} session
 * @param {string} requestId
 * @param {{ result?: ToolResult | ToolResultObjectLike; error?: string }} [options]
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
 * @param {CopilotSession} session
 * @returns {Promise<AgentListResult>}
 */
export async function agentList(session) {
    assertSession(session, 'agent.list');
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
 * @param {CopilotSession} session
 * @returns {Promise<AgentCurrentResult>}
 */
export async function agentGetCurrent(session) {
    assertSession(session, 'agent.getCurrent');
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
 * @param {CopilotSession} session
 * @param {string} name - Nome do agente a selecionar
 * @returns {Promise<AgentSelectResult>}
 */
export async function agentSelect(session, name) {
    assertSession(session, 'agent.select');
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
 * @param {CopilotSession} session
 * @returns {Promise<AgentDeselectResult>}
 */
export async function agentDeselect(session) {
    assertSession(session, 'agent.deselect');
    appLog('INFO', `[sdk/rpc] agent.deselect: sessionId='${session.sessionId}'`);
    try {
        await session.rpc.agent.deselect();
        return /** @type {AgentDeselectResult} */ ({});
    } catch (error) {
        throw toSdkOperationError('agent.deselect', error);
    }
}

/**
 * Recarrega a lista de agentes disponíveis na sessão.
 *
 * @param {CopilotSession} session
 * @returns {Promise<AgentReloadResult>}
 */
export async function agentReload(session) {
    assertSession(session, 'agent.reload');
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
 * @param {CopilotSession} session
 * @returns {Promise<CompactionCompactResult>}
 */
export async function compactionCompactTyped(session) {
    assertSession(session, 'compaction.compact');
    appLog('INFO', `[sdk/rpc] compaction.compact: sessionId='${session.sessionId}'`);
    try {
        return await getCompactionMethod(session)();
    } catch (error) {
        throw toSdkOperationError('compaction.compact', error);
    }
}
