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
import { createRegistry, modelRegistry } from '#copilot/sdk';
import { log, METRICS_STORE } from '../ports/observability-port.js';

import { handleUserInputRequest } from '../dialog/user-input-handler.js';
import { buildAgentBusHooks } from '../ports/hook-port.js';
import { buildDefaultMcpConfig, buildDefaultMcpTools } from '../ports/mcp-port.js';
import { bindAgentSessionTools, bootstrapAgentTools } from '../ports/tool-port.js';

/**
 * @typedef {object} SessionSetupContext
 * @property {{ invalidate: () => void }} messagesCache
 * @property {import('#copilot/sdk/tools-registry').ToolRegistry | null} toolsRegistry
 * @property {() => {
 *     buildTools: () => Promise<import('#copilot/sdk/types').Tool[]>;
 *     buildConfig: () => Record<string, unknown> | null | undefined;
 * } | null} [getMcpBridgeSnapshot]
 * @property {{ emit: (event: string, payload: object) => Promise<void> }} webhooks
 * @property {() => string} getModelSnapshot
 * @property {{
 *     scheduleFallback: (model: string) => unknown;
 *     handleProtocolInput: (input: { question: string }) => unknown;
 * }} dialogLoop
 * @property {{ handler: import('#copilot/sdk/types').PermissionHandler }} permissions
 * @property {() => import('#copilot/sdk/types').ReasoningEffort | undefined} getReasoningEffortSnapshot
 * @property {(value: import('#copilot/sdk/types').ReasoningEffort | undefined) => void} setReasoningEffort
 * @property {() => boolean} isDialogLoopActive
 * @property {(status: import('../types.js').AgentStatus, host: LifecycleHost) => void} setStatus
 * @property {(question: import('../types.js').PendingQuestion | null) => void} setPendingQuestion
 * @property {(task: Promise<unknown>, meta?: { label?: string; description?: string }) => Promise<void>} trackBackgroundTask
 * @property {(session: import('#copilot/sdk/types').CopilotSession) => void} setSession
 * @property {(isResumed: boolean) => void} setIsResumed
 *
 * @typedef {import('../types.js').LifecycleHost} LifecycleHost
 *
 * @typedef {import('#copilot/sdk/types').MCPServerConfig} MCPServerConfig
 */

/**
 * Prepara tools para a sessão: MCP bridge + registry + bootstrap.
 *
 * @param {SessionSetupContext} ctx
 * @returns {Promise<{ tools: import('#copilot/sdk/types').Tool[] }>}
 */
export async function buildSessionTools(ctx) {
    ctx.messagesCache.invalidate();
    const mcpBridge = typeof ctx.getMcpBridgeSnapshot === 'function' ? ctx.getMcpBridgeSnapshot() : null;
    const mcpTools = mcpBridge ? await mcpBridge.buildTools() : await buildDefaultMcpTools();
    if (mcpTools.length > 0) {
        log('INFO', `[AlwaysAlive] ${mcpTools.length} MCP tools carregadas via bridge.`);
    }
    ctx.toolsRegistry = createRegistry();
    const tools = bootstrapAgentTools(ctx.toolsRegistry, mcpTools);
    log('INFO', `[AlwaysAlive] ${tools.length} tools registradas (registry + introspection).`);
    return { tools };
}

/**
 * Prepara hooks para a sessão: lifecycle hooks + bus attachment.
 *
 * @param {SessionSetupContext} ctx
 * @param {LifecycleHost} host
 * @returns {{ busHooks: NonNullable<import('@github/copilot-sdk').SessionConfig['hooks']> }}
 */
export function buildSessionHooks(ctx, host) {
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

    const busHooks = buildAgentBusHooks({
        emitWebhook: async (event, payload) => {
            await Promise.resolve(ctx.webhooks.emit(event, payload));
        },
        getModel: () => ctx.getModelSnapshot(),
        scheduleFallback: (model) => ctx.dialogLoop.scheduleFallback(model),
        emit: (event, payload) => host.emit(event, payload),
        metrics: metricsStore,
    });
    return { busHooks };
}

/**
 * Constrói as opções de sessão SDK incluindo onUserInputRequest wiring.
 *
 * @param {SessionSetupContext} ctx
 * @param {LifecycleHost} host
 * @param {{
 *     tools: import('#copilot/sdk/types').Tool[];
 *     busHooks: NonNullable<import('@github/copilot-sdk').SessionConfig['hooks']>;
 * }} prepared
 * @returns {Record<string, unknown>}
 */
export function buildSessionOptions(ctx, host, { tools, busHooks }) {
    const mcpBridge = typeof ctx.getMcpBridgeSnapshot === 'function' ? ctx.getMcpBridgeSnapshot() : null;
    const mcpConfig = /** @type {Record<string, MCPServerConfig> | null} */ (
        mcpBridge ? mcpBridge.buildConfig() : buildDefaultMcpConfig()
    );
    const builder = new SessionConfigBuilder()
        .model(ctx.getModelSnapshot())
        .clientName('chatgpt-docker-puppeteer')
        .workingDirectory(process.cwd())
        .onPermissionRequest(ctx.permissions.handler)
        .tools(tools);

    builder.hooks(busHooks);
    if (mcpConfig) {
        builder.mcpServers(mcpConfig);
    }

    const reasoningEffort = ctx.getReasoningEffortSnapshot();
    if (reasoningEffort) {
        const modelMeta = modelRegistry.get(ctx.getModelSnapshot());
        if (modelMeta?.supportsReasoning === false) {
            log(
                'INFO',
                `[session-setup] reasoningEffort omitido para '${ctx.getModelSnapshot()}' — modelo sem suporte explícito a reasoning.`,
            );
            ctx.setReasoningEffort(undefined);
        } else {
            builder.reasoningEffort(reasoningEffort);
        }
    }

    builder.onUserInputRequest((input) =>
        handleUserInputRequest(
            {
                question: input.question,
                ...(input.choices !== undefined && { choices: input.choices }),
                allowFreeform: input.allowFreeform !== false,
            },
            {
                isDialogLoopActive: () => ctx.isDialogLoopActive(),
                handleProtocolInput: (q) => ctx.dialogLoop.handleProtocolInput(q),
                setStatus: (s) => ctx.setStatus(s, host),
                setPendingQuestion: (pq) => ctx.setPendingQuestion(pq),
                trackBackgroundTask: (task, meta) => ctx.trackBackgroundTask(task, meta),
                emit: (event, payload) => host.emit(event, payload),
            },
        ),
    );

    const config = builder.build();

    // Campos consumidos por initOrResumeSession (não são SessionConfig SDK)
    return {
        ...config,
        injectHookContext: true,
    };
}

/**
 * Finaliza a sessão após criação: atualiza ctx e RPC.
 *
 * @param {SessionSetupContext} ctx
 * @param {import('#copilot/sdk/types').CopilotSession} session
 * @param {boolean} isResumed
 */
export function finalizeSessionInit(ctx, session, isResumed) {
    ctx.setSession(session);
    ctx.setIsResumed(isResumed);
    bindAgentSessionTools(session);
}
