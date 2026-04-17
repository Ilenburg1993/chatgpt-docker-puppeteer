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
 * @internal
 * @see EventBus
 */

import { SessionConfigBuilder } from '#copilot/config';
import { container } from '#copilot/core';
import { log, METRICS_STORE } from '#copilot/observability';
import { createRegistry } from '#copilot/sdk';
import { buildMcpTools } from '../../bridges/mcp-tool-bridge.js';
import { buildMcpConfig } from '../../config/mcp-servers.js';

import { attachBus, createHooks, createSessionHooks } from '#copilot/hooks';
import * as bootstrapRuntime from '../../tools/bootstrap.js';
import { handleUserInputRequest } from '../dialog/user-input-handler.js';

/**
 * @typedef {import('../agent-context.js').AgentContext} AgentContext
 *
 * @typedef {import('../types.js').LifecycleHost} LifecycleHost
 */

/**
 * Prepara tools para a sessão: MCP bridge + registry + bootstrap.
 *
 * @param {AgentContext} ctx
 * @returns {Promise<{ tools: import('#copilot/sdk/types').Tool[] }>}
 */
export async function buildSessionTools(ctx) {
    const configState = ctx.configState ?? ctx;
    ctx.messagesCache.invalidate();
    const mcpTools = configState.mcpBridge ? await configState.mcpBridge.buildTools() : await buildMcpTools();
    if (mcpTools.length > 0) {
        log('INFO', `[AlwaysAlive] ${mcpTools.length} MCP tools carregadas via bridge.`);
    }
    ctx.toolsRegistry = createRegistry();
    const tools = bootstrapRuntime.bootstrapTools(ctx.toolsRegistry, mcpTools);
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
    const configState = ctx.configState ?? ctx;
    /** @type {{ recordSessionStart: () => void; recordSessionEnd: () => void }} */
    let metricsStore = {
        recordSessionStart: () => {},
        recordSessionEnd: () => {},
    };
    try {
        metricsStore = container.resolve(METRICS_STORE);
    } catch {
        // fallback no-op para testes unitários que não registram o token no container
    }

    const lifecycleHooks = createSessionHooks({
        emitWebhook: (event, payload) => ctx.webhooks.emit(event, payload),
        getModel: () => configState.model,
        scheduleFallback: (model) => ctx.dialogLoop.scheduleFallback(model),
        emit: (event, payload) => host.emit(event, payload),
        metrics: metricsStore,
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
 * @param {{ tools: import('#copilot/sdk/types').Tool[]; busHooks: ReturnType<typeof attachBus> }} prepared
 * @returns {Record<string, unknown>}
 */
export function buildSessionOptions(ctx, host, { tools, busHooks }) {
    const configState = ctx.configState ?? ctx;
    const dialogState = ctx.dialogState ?? ctx;
    const builder = new SessionConfigBuilder()
        .model(configState.model)
        .clientName('chatgpt-docker-puppeteer')
        .workingDirectory(process.cwd())
        .onPermissionRequest(ctx.permissions.handler)
        .tools(tools);

    // hooks e mcpServers usam tipos locais que divergem dos tipos SDK — via merge para bypass de strictness
    builder.merge(
        /** @type {Partial<import('@github/copilot-sdk').SessionConfig>} */ (
            /** @type {unknown} */ ({
                hooks: busHooks,
                mcpServers: configState.mcpBridge ? configState.mcpBridge.buildConfig() : buildMcpConfig(),
            })
        ),
    );

    if (configState.reasoningEffort) {
        try {
            builder.reasoningEffort(configState.reasoningEffort);
        } catch {
            builder.merge(
                /** @type {Partial<import('@github/copilot-sdk').SessionConfig>} */ (
                    /** @type {unknown} */ ({ reasoningEffort: configState.reasoningEffort })
                ),
            );
        }
    }

    const config = builder.build();

    // Campos consumidos por initOrResumeSession (não são SessionConfig SDK)
    return {
        ...config,
        onUserInputRequest: (/** @type {{ question: string; choices?: string[]; allowFreeform: boolean }} */ input) =>
            handleUserInputRequest(input, {
                isDialogLoopActive: () => ctx.dialogLoop.active,
                handleProtocolInput: (q) => ctx.dialogLoop.handleProtocolInput(q),
                setStatus: (s) =>
                    ctx.setStatus(s, /** @type {import('node:events').EventEmitter} */ (/** @type {unknown} */ (host))),
                setPendingQuestion: (pq) => {
                    dialogState.pendingQuestion = pq;
                },
                trackBackgroundTask: (task, meta) => ctx.backgroundTasks.track(task, meta),
                emit: (event, payload) => host.emit(event, payload),
            }),
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
    const sessionState = ctx.sessionState ?? ctx;
    sessionState.session = session;
    sessionState.isResumed = isResumed;
    bootstrapRuntime.setSessionRpc(session.rpc);
    try {
        const maybeSetExperimentalSession = bootstrapRuntime.setExperimentalSession;
        if (typeof maybeSetExperimentalSession === 'function') {
            maybeSetExperimentalSession(session);
        }
    } catch {
        // mock parcial em testes pode omitir este export; runtime real continua cobrindo o caminho completo
    }
}
