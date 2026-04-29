// @ts-check
/**
 * src/copilot/agent/lifecycle/session-setup.js
 *
 * F63: Funções de configuração de sessão extraídas de agent-lifecycle.js.
 *
 * Encapsula a preparação de tools (MCP + registry), hooks (lifecycle + bus), permissões e `ask_user` necessárias para
 * criar/retomar uma sessão SDK.
 *
 * Regra arquitetural:
 *
 * - este módulo conhece o formato de configuração da sessão SDK;
 * - ele não deve conhecer implementações concretas de `tools/`, `hooks/` ou MCP bridge;
 * - esses acoplamentos entram por `agent/ports/*`, mantendo lifecycle/session legíveis durante a migração para runtime
 *   façade/capabilities.
 *
 * @module copilot/agent/lifecycle/session-setup
 * @internal
 * @see EventBus
 */

import { readCopilotBootConfig } from '#copilot/boot';
import { DEFAULT_EXCLUDED_TOOLS, SessionConfigBuilder } from '#copilot/config';
import { container } from '#copilot/core';
import { log } from '../ports/logging-port.js';
import { METRICS_STORE } from '../ports/metrics-port.js';

import { DialogProtocol } from '../../dialog/protocol.js';
import { handleUserInputRequest } from '../dialog/user-input-handler.js';
import {
    createAgentSdkToolsRegistry,
    getAgentSdkToolsConfig,
    readAgentSdkModelRegistryEntry,
} from '../facades/agent-sdk-access.js';
import { buildAgentBusHooks, withAgentRuntimeToolPolicy } from '../ports/hook-port.js';
import { buildDefaultMcpConfig, buildDefaultMcpTools } from '../ports/mcp-port.js';
import { bindAgentSessionTools, bootstrapAgentTools, isAgentToolDisabled } from '../ports/tool-port.js';

/**
 * Contrato mínimo do `AgentContext` exigido pelo setup de sessão.
 *
 * Este typedef é intencionalmente local e mais estreito que `AgentContext`: ele documenta quais partes do estado vivo
 * são necessárias para montar uma sessão SDK. Ao ampliar o boot, prefira adicionar um método semântico aqui em vez de
 * passar o contexto inteiro adiante.
 *
 * @typedef {object} SessionSetupContext
 * @property {() => void} invalidateMessagesCache - Invalida o cache de mensagens antes de rebuilar tools para evitar
 *   replay/estado obsoleto.
 * @property {() => import('#copilot/sdk/tools-registry').ToolRegistry} resetToolsRegistry - Recria o registry ativo de
 *   tools para o boot/resume atual.
 * @property {() => {
 *     buildTools: () => Promise<import('#copilot/sdk/types').Tool[]>;
 *     buildConfig: () => Record<string, unknown> | null | undefined;
 * } | null} [getMcpBridgeSnapshot]
 *   - Snapshot opcional do bridge MCP injetado. Quando ausente, a porta MCP default é usada.
 *
 * @property {(event: string, payload: object) => Promise<void>} emitWebhook - Porta semântica de webhooks usada pelos
 *   hooks de sessão.
 * @property {() => string} getModelSnapshot - Lê o modelo efetivo no momento de construir a sessão.
 * @property {(model: string) => unknown} scheduleDialogFallback - Agenda fallback de modelo no dialog loop.
 * @property {(input: { question: string }) => unknown} handleDialogProtocolInput - Encaminha protocolo `ask_user`.
 * @property {() => import('#copilot/sdk/types').PermissionHandler} getPermissionHandlerSnapshot - Policy efetiva de
 *   permissão para `onPermissionRequest`.
 * @property {() => import('#copilot/sdk/types').ReasoningEffort | undefined} getReasoningEffortSnapshot - Lê a opção de
 *   reasoning antes de aplicar compatibilidade por modelo.
 * @property {(value: import('#copilot/sdk/types').ReasoningEffort | undefined) => void} setReasoningEffort - Atualiza a
 *   opção de reasoning quando ela precisa ser omitida para um modelo sem suporte explícito.
 * @property {() => boolean} isDialogLoopActive - Distingue `ask_user` controlado pelo protocolo de input manual.
 * @property {() => boolean} [getDialogLoopAttachedSnapshot] - Indica se o wiring do DLM ainda está anexado ao host,
 *   mesmo quando `dialogLoopActive` ficou temporariamente defasado após timeout/recovery.
 * @property {(status: import('../types.js').AgentStatus, host: LifecycleHost) => void} setStatus - Atualiza status via
 *   host para preservar eventos/observabilidade do runtime.
 * @property {(question: import('../types.js').PendingQuestion | null) => void} setPendingQuestion - Registra ou limpa a
 *   pergunta pendente viva.
 * @property {(task: Promise<unknown>, meta?: { label?: string; description?: string }) => Promise<void>} trackBackgroundTask
 *   - Registra tarefas fire-and-forget originadas por respostas de input.
 *
 * @property {(session: import('#copilot/sdk/types').CopilotSession) => void} setSession - Persiste a sessão SDK ativa
 *   no contexto.
 * @property {(isResumed: boolean) => void} setIsResumed - Marca se a sessão veio de resume ou criação nova.
 *
 * @typedef {import('../types.js').LifecycleHost} LifecycleHost
 *
 * @typedef {import('#copilot/sdk/types').MCPServerConfig} MCPServerConfig
 *
 * @typedef {{
 *     tools: import('#copilot/sdk/types').Tool[];
 *     busHooks: NonNullable<import('#copilot/sdk/types').SessionConfig['hooks']>;
 * }} PreparedSessionDeps
 */

/**
 * @param {SessionSetupContext} ctx
 * @returns {void}
 */
function invalidateMessagesCache(ctx) {
    if (typeof ctx.invalidateMessagesCache === 'function') {
        ctx.invalidateMessagesCache();
        return;
    }
    const compat = /** @type {{ messagesCache?: { invalidate?: () => void } }} */ (ctx);
    compat.messagesCache?.invalidate?.();
}

/**
 * @param {SessionSetupContext} ctx
 * @returns {import('#copilot/sdk/tools-registry').ToolRegistry}
 */
function resetToolsRegistry(ctx) {
    if (typeof ctx.resetToolsRegistry === 'function') {
        return ctx.resetToolsRegistry();
    }
    const compat = /** @type {{ toolsRegistry?: import('#copilot/sdk/tools-registry').ToolRegistry | null }} */ (ctx);
    compat.toolsRegistry = createAgentSdkToolsRegistry();
    return compat.toolsRegistry;
}

/**
 * @param {SessionSetupContext} ctx
 * @param {string} event
 * @param {object} payload
 * @returns {Promise<void>}
 */
async function emitWebhook(ctx, event, payload) {
    if (typeof ctx.emitWebhook === 'function') {
        await ctx.emitWebhook(event, payload);
        return;
    }
    const compat = /** @type {{ webhooks?: { emit?: (event: string, payload: object) => unknown } }} */ (ctx);
    await Promise.resolve(compat.webhooks?.emit?.(event, payload));
}

/**
 * @param {SessionSetupContext} ctx
 * @returns {import('#copilot/sdk/types').PermissionHandler}
 */
function getPermissionHandler(ctx) {
    if (typeof ctx.getPermissionHandlerSnapshot === 'function') {
        return ctx.getPermissionHandlerSnapshot();
    }
    const compat = /** @type {{ permissions?: { handler?: import('#copilot/sdk/types').PermissionHandler } }} */ (ctx);
    return compat.permissions?.handler ?? (() => ({ kind: 'approve-once' }));
}

/**
 * @param {SessionSetupContext} ctx
 * @returns {import('#copilot/sdk/types').ElicitationHandler | null}
 */
function getElicitationHandler(ctx) {
    if (
        typeof (
            /** @type {{ getSdkElicitationHandlerSnapshot?: unknown }} */ (ctx).getSdkElicitationHandlerSnapshot
        ) === 'function'
    ) {
        return /** @type {{ getSdkElicitationHandlerSnapshot: () => import('#copilot/sdk/types').ElicitationHandler }} */ (
            /** @type {unknown} */ (ctx)
        ).getSdkElicitationHandlerSnapshot();
    }
    const compat = /** @type {{ sdkElicitation?: { handler?: import('#copilot/sdk/types').ElicitationHandler } }} */ (
        ctx
    );
    return compat.sdkElicitation?.handler ?? null;
}

/**
 * @param {SessionSetupContext} ctx
 * @param {string} model
 * @returns {unknown}
 */
function scheduleDialogFallback(ctx, model) {
    if (typeof ctx.scheduleDialogFallback === 'function') {
        return ctx.scheduleDialogFallback(model);
    }
    const compat = /** @type {{ dialogLoop?: { scheduleFallback?: (model: string) => unknown } }} */ (ctx);
    return compat.dialogLoop?.scheduleFallback?.(model);
}

/**
 * @param {SessionSetupContext} ctx
 * @param {{ question: string }} input
 * @returns {unknown}
 */
function handleDialogProtocolInput(ctx, input) {
    if (typeof ctx.handleDialogProtocolInput === 'function') {
        return ctx.handleDialogProtocolInput(input);
    }
    const compat = /** @type {{ dialogLoop?: { handleProtocolInput?: (input: { question: string }) => unknown } }} */ (
        ctx
    );
    return compat.dialogLoop?.handleProtocolInput?.(input);
}

/**
 * Prepara tools para a sessão: MCP bridge + registry + bootstrap.
 *
 * @param {SessionSetupContext} ctx
 * @returns {Promise<{ tools: import('#copilot/sdk/types').Tool[] }>}
 */
export async function buildSessionTools(ctx) {
    invalidateMessagesCache(ctx);
    const mcpBridge = typeof ctx.getMcpBridgeSnapshot === 'function' ? ctx.getMcpBridgeSnapshot() : null;
    const mcpTools = mcpBridge ? await mcpBridge.buildTools() : await buildDefaultMcpTools();
    if (mcpTools.length > 0) {
        log('INFO', `[AlwaysAlive] ${mcpTools.length} MCP tools carregadas via bridge.`);
    }
    const toolsRegistry = resetToolsRegistry(ctx);
    const tools = bootstrapAgentTools(toolsRegistry, mcpTools);
    log('INFO', `[AlwaysAlive] ${tools.length} tools registradas (registry + introspection).`);
    return { tools };
}

/**
 * Prepara hooks para a sessão: lifecycle hooks + bus attachment.
 *
 * @param {SessionSetupContext} ctx
 * @param {LifecycleHost} host
 * @returns {{ busHooks: NonNullable<import('#copilot/sdk/types').SessionConfig['hooks']> }}
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
            await emitWebhook(ctx, event, payload);
        },
        getModel: () => ctx.getModelSnapshot(),
        scheduleFallback: (model) => scheduleDialogFallback(ctx, model),
        emit: (event, payload) => host.emit(event, payload),
        metrics: metricsStore,
    });

    const toolsConfig = getAgentSdkToolsConfig();
    const defaultRuntimeDenylist = [...DEFAULT_EXCLUDED_TOOLS, ...toolsConfig.denylist];
    const hasRuntimeToolPolicy = defaultRuntimeDenylist.length > 0 || toolsConfig.allowlist !== null;

    if (!hasRuntimeToolPolicy) {
        return { busHooks };
    }

    return {
        busHooks: withAgentRuntimeToolPolicy(busHooks, (toolName) => {
            if (isAgentToolDisabled(toolName)) {
                return true;
            }
            if (defaultRuntimeDenylist.includes(toolName)) {
                return true;
            }
            if (toolsConfig.allowlist !== null) {
                return !toolsConfig.allowlist.includes(toolName);
            }
            return false;
        }),
    };
}

/**
 * Constrói as opções de sessão SDK incluindo onUserInputRequest wiring.
 *
 * @param {SessionSetupContext} ctx
 * @param {LifecycleHost} host
 * @param {PreparedSessionDeps} prepared
 * @returns {Record<string, unknown>}
 */
export function buildSessionOptions(ctx, host, { tools, busHooks }) {
    const mcpBridge = typeof ctx.getMcpBridgeSnapshot === 'function' ? ctx.getMcpBridgeSnapshot() : null;
    const mcpConfig = /** @type {Record<string, MCPServerConfig> | null} */ (
        mcpBridge ? mcpBridge.buildConfig() : buildDefaultMcpConfig()
    );
    const bootConfig = readCopilotBootConfig();
    const builder = new SessionConfigBuilder()
        .model(ctx.getModelSnapshot())
        .clientName('chatgpt-docker-puppeteer')
        .workingDirectory(bootConfig.workspace.root)
        .skillDirectories(bootConfig.skills.skillDirectories)
        .onPermissionRequest(getPermissionHandler(ctx))
        .tools(tools);

    builder.hooks(busHooks);
    if (mcpConfig) {
        builder.mcpServers(mcpConfig);
    }

    const reasoningEffort = ctx.getReasoningEffortSnapshot();
    if (reasoningEffort) {
        const modelMeta = readAgentSdkModelRegistryEntry(ctx.getModelSnapshot());
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
                shouldHandleProtocolInput: (question) => {
                    if (ctx.isDialogLoopActive()) {
                        return true;
                    }
                    const dialogLoopAttached =
                        typeof ctx.getDialogLoopAttachedSnapshot === 'function'
                            ? ctx.getDialogLoopAttachedSnapshot()
                            : Boolean(/** @type {{ dialogLoop?: { host?: unknown } }} */ (ctx).dialogLoop?.host);
                    return dialogLoopAttached && inputLooksLikeDialogProtocol(question);
                },
                handleProtocolInput: (q) => handleDialogProtocolInput(ctx, q),
                setStatus: (s) => ctx.setStatus(s, host),
                setPendingQuestion: (pq) => ctx.setPendingQuestion(pq),
                trackBackgroundTask: (task, meta) => ctx.trackBackgroundTask(task, meta),
                emit: (event, payload) => host.emit(event, payload),
            },
        ),
    );

    const elicitationHandler = getElicitationHandler(ctx);
    if (elicitationHandler) {
        builder.onElicitationRequest(elicitationHandler);
    }

    const config = builder.build();

    // Campos consumidos por initOrResumeSession (não são SessionConfig SDK)
    return {
        ...config,
        injectHookContext: true,
    };
}

/**
 * Detecta se a pergunta recebida pertence ao protocolo do dialog loop.
 *
 * O critério aqui precisa ser semântico e independente do estado `active`, porque o SDK pode entregar um `READY:` já
 * válido após um timeout transitório de boot.
 *
 * @param {string} question
 * @returns {boolean}
 */
function inputLooksLikeDialogProtocol(question) {
    return DialogProtocol.isProtocolMessage(question);
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
