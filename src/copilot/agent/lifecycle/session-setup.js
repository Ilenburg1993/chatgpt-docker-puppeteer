// @ts-check
/**
 * src/copilot/agent/lifecycle/session-setup.js
 *
 * F63: Funções de configuração de sessão extraídas de agent-lifecycle.js.
 *
 * Encapsula a preparação de tools (MCP + registry) e hooks (lifecycle + bus) necessárias para criar/retomar uma sessão
 * SDK.
 *
 * @module copilot/agent/lifecycle/session-setup
 * @see EventBus
 * @internal
 */

import { log } from '#copilot/observability';
import { createRegistry } from '#copilot/sdk';
import { buildMcpTools } from '../../bridges/mcp-tool-bridge.js';
import { buildMcpConfig } from '../../config/mcp-servers.js';

import { attachBus, createHooks, createSessionHooks } from '#copilot/hooks';
import { handleUserInputRequest } from '../dialog/user-input-handler.js';
import { bootstrapTools, setSessionRpc } from '../infra/tools-bootstrap.js';

/**
 * @typedef {import('../agent-context.js').AgentContext} AgentContext
 *
 * @typedef {import('../types.js').LifecycleHost} LifecycleHost
 */

/**
 * Prepara tools para a sessão: MCP bridge + registry + bootstrap.
 *
 * @param {AgentContext} ctx
 * @returns {Promise<{ tools: any[] }>}
 */
export async function buildSessionTools(ctx) {
    ctx.messagesCache.invalidate();
    const mcpTools = ctx.mcpBridge ? await ctx.mcpBridge.buildTools() : await buildMcpTools();
    if (mcpTools.length > 0) {
        log('INFO', `[AlwaysAlive] ${mcpTools.length} MCP tools carregadas via bridge.`);
    }
    ctx.toolsRegistry = createRegistry();
    const tools = bootstrapTools(ctx.toolsRegistry, mcpTools);
    log('INFO', `[AlwaysAlive] ${tools.length} tools registradas (registry + introspection).`);
    return { tools };
}

/**
 * Prepara hooks para a sessão: lifecycle hooks + bus attachment.
 *
 * @param {AgentContext} ctx
 * @param {LifecycleHost} host
 * @returns {{ busHooks: ReturnType<typeof attachBus> }}
 */
export function buildSessionHooks(ctx, host) {
    const lifecycleHooks = createSessionHooks({
        emitWebhook: (event, payload) => ctx.webhooks.emit(event, payload),
        getModel: () => ctx.model,
        scheduleFallback: (model) => ctx.dialogLoop.scheduleFallback(model),
        emit: (event, payload) => host.emit(event, payload),
    });

    const hooks = createHooks({
        auditLog: true,
        onSessionStart: lifecycleHooks.onSessionStart,
        onSessionEnd: lifecycleHooks.onSessionEnd,
        onErrorOccurred: lifecycleHooks.onErrorOccurred,
    });

    return { busHooks: attachBus(hooks) };
}

/**
 * Constrói as opções de sessão SDK incluindo onUserInputRequest wiring.
 *
 * @param {AgentContext} ctx
 * @param {LifecycleHost} host
 * @param {{ tools: any[]; busHooks: ReturnType<typeof attachBus> }} prepared
 * @returns {Record<string, any>}
 */
export function buildSessionOptions(ctx, host, { tools, busHooks }) {
    return {
        model: ctx.model,
        onPermissionRequest: ctx.permissions.handler,
        onUserInputRequest: (/** @type {{ question: string; choices?: string[]; allowFreeform: boolean }} */ input) =>
            handleUserInputRequest(input, {
                isDialogLoopActive: () => ctx.dialogLoop.active,
                handleProtocolInput: (q) => ctx.dialogLoop.handleProtocolInput(q),
                setStatus: (s) =>
                    ctx.setStatus(s, /** @type {import('node:events').EventEmitter} */ (/** @type {unknown} */ (host))),
                setPendingQuestion: (pq) => {
                    ctx.pendingQuestion = pq;
                },
                emit: (event, payload) => host.emit(event, payload),
            }),
        hooks: busHooks,
        tools,
        mcpServers: ctx.mcpBridge ? ctx.mcpBridge.buildConfig() : buildMcpConfig(),
        reasoningEffort: ctx.reasoningEffort,
        injectHookContext: true,
    };
}

/**
 * Finaliza a sessão após criação: atualiza ctx e RPC.
 *
 * @param {AgentContext} ctx
 * @param {import('#copilot/sdk/types').CopilotSession} session
 * @param {boolean} isResumed
 */
export function finalizeSessionInit(ctx, session, isResumed) {
    ctx.session = session;
    ctx.isResumed = isResumed;
    setSessionRpc(session.rpc);
}
