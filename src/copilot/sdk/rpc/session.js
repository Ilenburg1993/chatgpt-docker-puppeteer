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
import { emitSdkOperationMetric } from '../telemetry/operation-metrics.js';
import { assertRpcSession } from './guards.js';

/**
 * @typedef {import('./guards.js').RpcSessionPort} RpcSessionPort
 *
 * @typedef {{ modelId: string }} ModelCurrentResult
 *
 * @typedef {{ modelId?: string }} ModelSwitchResult
 *
 * @typedef {{ name?: string | null }} NameGetResult
 *
 * @typedef {{ name?: string | null; success: boolean }} NameSetResult
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
 * @typedef {{ eventId: string; [k: string]: unknown }} LogResult
 *
 * @typedef {unknown} InstructionSourcesResult
 */

/**
 * Resolve namespace de workspace compatível entre SDKs (`workspaces` no v0.3.0, `workspace` em versões anteriores).
 *
 * @param {RpcSessionPort} session
 * @returns {{
 *     listFiles: () => Promise<WorkspaceListResult>;
 *     readFile: (params: { path: string }) => Promise<WorkspaceReadResult>;
 *     createFile: (params: { path: string; content: string }) => Promise<unknown>;
 * }}
 */
function getWorkspaceRpc(session) {
    const rpc = /** @type {{ workspaces?: unknown; workspace?: unknown }} */ (session.rpc);
    const candidate =
        (rpc.workspaces && typeof rpc.workspaces === 'object' ? rpc.workspaces : undefined) ??
        (rpc.workspace && typeof rpc.workspace === 'object' ? rpc.workspace : undefined);

    if (!candidate) {
        throw new TypeError('[sdk/rpc/workspace] namespace indisponível (expected workspaces/workspace).');
    }

    // Validar que os métodos obrigatórios existem (duck-typing defensivo)
    const candidateObj = /** @type {Record<string, unknown>} */ (candidate);
    if (typeof candidateObj['listFiles'] !== 'function') {
        throw new TypeError('[sdk/rpc/workspace] namespace não expõe listFiles().');
    }
    if (typeof candidateObj['readFile'] !== 'function') {
        throw new TypeError('[sdk/rpc/workspace] namespace não expõe readFile().');
    }
    if (typeof candidateObj['createFile'] !== 'function') {
        throw new TypeError('[sdk/rpc/workspace] namespace não expõe createFile().');
    }

    const workspaceRpc = /**
     * @type {{
     *     listFiles: () => Promise<WorkspaceListResult>;
     *     readFile: (params: { path: string }) => Promise<WorkspaceReadResult>;
     *     createFile: (params: { path: string; content: string }) => Promise<unknown>;
     * }}
     */ (candidate);

    return workspaceRpc;
}

/**
 * Retorna o modelo atualmente ativo da sessão.
 *
 * @param {unknown} session
 * @returns {Promise<ModelCurrentResult>}
 */
export async function modelGetCurrent(session) {
    assertRpcSession(session, 'model.getCurrent');
    appLog('DEBUG', `[sdk/rpc] model.getCurrent: sessionId='${session.sessionId}'`);
    try {
        const result = /** @type {{ modelId?: unknown }} */ (await session.rpc.model.getCurrent());
        if (typeof result.modelId !== 'string' || result.modelId.length === 0) {
            throw new TypeError('[sdk/rpc/model.getCurrent] resposta sem modelId.');
        }
        return /** @type {ModelCurrentResult} */ (result);
    } catch (error) {
        throw toSdkOperationError('model.getCurrent', error);
    }
}

/**
 * Troca o modelo da sessão via RPC. Troca o modelo via RPC de baixo nível.
 *
 * **NOTA**: Prefira `session.setModel()` (via `sdk/session/runtime.js`) para troca de modelo em código de negócio. Esta
 * função é uma alternativa de baixo nível que acessa `session.rpc.model.switchTo()` diretamente e pode não disparar
 * hooks/lifecycle internos do SDK.
 *
 * @param {unknown} session
 * @param {string} modelId
 * @param {{
 *     reasoningEffort?: string;
 *     reasoningSummary?: import('@github/copilot-sdk').ReasoningSummary;
 *     contextTier?: import('@github/copilot-sdk').ContextTier;
 *     modelCapabilities?: import('@github/copilot-sdk').ModelCapabilitiesOverride;
 * }} [options]
 * @returns {Promise<ModelSwitchResult>}
 */
export async function modelSwitchTo(session, modelId, options) {
    assertRpcSession(session, 'model.switchTo');
    if (typeof modelId !== 'string' || modelId.length === 0) {
        throw new TypeError('[sdk/rpc/model.switchTo] modelId deve ser string não-vazia.');
    }
    appLog('INFO', `[sdk/rpc] model.switchTo: modelId='${modelId}', sessionId='${session.sessionId}'`);
    const params =
        /** @type {{
         *     modelId: string;
         *     reasoningEffort?: string;
         *     reasoningSummary?: import('@github/copilot-sdk').ReasoningSummary;
         *     contextTier?: import('@github/copilot-sdk').ContextTier;
         *     modelCapabilities?: import('@github/copilot-sdk').ModelCapabilitiesOverride;
         * }} */ ({
            modelId,
        });
    if (options?.reasoningEffort) {
        params.reasoningEffort = options.reasoningEffort;
    }
    if (options?.reasoningSummary) {
        params.reasoningSummary = options.reasoningSummary;
    }
    if (options?.contextTier) {
        params.contextTier = options.contextTier;
    }
    if (options?.modelCapabilities !== undefined) {
        params.modelCapabilities = options.modelCapabilities;
    }
    const startedAt = Date.now();
    emitSdkOperationMetric({
        operation: 'rpc.model.switchTo',
        status: 'started',
        sessionId: session.sessionId,
            attributes: {
                modelId,
                ...(options?.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
                ...(options?.reasoningSummary ? { reasoningSummary: options.reasoningSummary } : {}),
                ...(options?.contextTier ? { contextTier: options.contextTier } : {}),
                ...(options?.modelCapabilities ? { modelCapabilities: true } : {}),
            },
    });
    try {
        const result = /** @type {ModelSwitchResult} */ (await session.rpc.model.switchTo(params));
        emitSdkOperationMetric({
            operation: 'rpc.model.switchTo',
            status: 'succeeded',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { modelId },
        });
        return result;
    } catch (error) {
        const sdkError = toSdkOperationError('model.switchTo', error);
        emitSdkOperationMetric({
            operation: 'rpc.model.switchTo',
            status: 'failed',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { modelId, errorKind: sdkError.kind },
        });
        throw sdkError;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NAME subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retorna o nome/título atual da sessão quando suportado pelo host.
 *
 * @param {unknown} session
 * @returns {Promise<NameGetResult>}
 */
export async function nameGet(session) {
    assertRpcSession(session, 'name.get');
    const rpc = /** @type {{ name?: { get?: () => Promise<NameGetResult> } }} */ (session.rpc);
    if (typeof rpc.name?.get !== 'function') {
        throw new TypeError('[sdk/rpc/name.get] RPC indisponível nesta sessão SDK.');
    }
    appLog('DEBUG', `[sdk/rpc] name.get: sessionId='${session.sessionId}'`);
    try {
        return /** @type {NameGetResult} */ (await rpc.name.get());
    } catch (error) {
        throw toSdkOperationError('name.get', error);
    }
}

/**
 * Define o nome/título da sessão quando suportado pelo host.
 *
 * @param {unknown} session
 * @param {string} name
 * @returns {Promise<NameSetResult>}
 */
export async function nameSet(session, name) {
    assertRpcSession(session, 'name.set');
    if (typeof name !== 'string') {
        throw new TypeError('[sdk/rpc/name.set] name deve ser string.');
    }
    const rpc = /** @type {{ name?: { set?: (params: { name: string }) => Promise<void | NameSetResult> } }} */ (
        /** @type {unknown} */ (session.rpc)
    );
    if (typeof rpc.name?.set !== 'function') {
        throw new TypeError('[sdk/rpc/name.set] RPC indisponível nesta sessão SDK.');
    }
    appLog('INFO', `[sdk/rpc] name.set: sessionId='${session.sessionId}'`);
    try {
        const result = await rpc.name.set({ name });
        return result && typeof result === 'object' ? result : { name, success: true };
    } catch (error) {
        throw toSdkOperationError('name.set', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retorna o modo atual da sessão (interactive, plan, autopilot).
 *
 * @param {unknown} session
 * @returns {Promise<ModeGetResult>}
 */
export async function modeGet(session) {
    assertRpcSession(session, 'mode.get');
    appLog('DEBUG', `[sdk/rpc] mode.get: sessionId='${session.sessionId}'`);
    try {
        const rawMode = /** @type {unknown} */ (await session.rpc.mode.get());
        const mode =
            typeof rawMode === 'string'
                ? rawMode
                : /** @type {{ mode?: 'interactive' | 'plan' | 'autopilot' } | undefined} */ (rawMode)?.mode;
        return /** @type {ModeGetResult} */ ({ mode: /** @type {'interactive' | 'plan' | 'autopilot'} */ (mode) });
    } catch (error) {
        throw toSdkOperationError('mode.get', error);
    }
}

/**
 * Altera o modo da sessão.
 *
 * @param {unknown} session
 * @param {'interactive' | 'plan' | 'autopilot'} mode
 * @returns {Promise<ModeSetResult>}
 */
export async function modeSet(session, mode) {
    assertRpcSession(session, 'mode.set');
    const valid = ['interactive', 'plan', 'autopilot'];
    if (!valid.includes(mode)) {
        throw new TypeError(`[sdk/rpc/mode.set] mode deve ser um de: ${valid.join(', ')}.`);
    }
    appLog('INFO', `[sdk/rpc] mode.set: mode='${mode}', sessionId='${session.sessionId}'`);
    const startedAt = Date.now();
    emitSdkOperationMetric({
        operation: 'rpc.mode.set',
        status: 'started',
        sessionId: session.sessionId,
        attributes: { mode },
    });
    try {
        await session.rpc.mode.set({ mode });
        emitSdkOperationMetric({
            operation: 'rpc.mode.set',
            status: 'succeeded',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { mode },
        });
        return /** @type {ModeSetResult} */ ({ mode });
    } catch (error) {
        const sdkError = toSdkOperationError('mode.set', error);
        emitSdkOperationMetric({
            operation: 'rpc.mode.set',
            status: 'failed',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { mode, errorKind: sdkError.kind },
        });
        throw sdkError;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lê o plano da sessão (plan.md do workspace infinito).
 *
 * @param {unknown} session
 * @returns {Promise<PlanReadResult>}
 */
export async function planRead(session) {
    assertRpcSession(session, 'plan.read');
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
 * @param {unknown} session
 * @param {string} content - Novo conteúdo do plan.md
 * @returns {Promise<PlanMutationResult>}
 */
export async function planUpdate(session, content) {
    assertRpcSession(session, 'plan.update');
    if (typeof content !== 'string') {
        throw new TypeError('[sdk/rpc/plan.update] content deve ser string.');
    }
    appLog('INFO', `[sdk/rpc] plan.update: ${content.length} chars, sessionId='${session.sessionId}'`);
    const startedAt = Date.now();
    emitSdkOperationMetric({
        operation: 'rpc.plan.update',
        status: 'started',
        sessionId: session.sessionId,
        attributes: { contentLength: content.length },
    });
    try {
        await session.rpc.plan.update({ content });
        emitSdkOperationMetric({
            operation: 'rpc.plan.update',
            status: 'succeeded',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { contentLength: content.length },
        });
        return /** @type {PlanMutationResult} */ ({ success: true });
    } catch (error) {
        const sdkError = toSdkOperationError('plan.update', error);
        emitSdkOperationMetric({
            operation: 'rpc.plan.update',
            status: 'failed',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { contentLength: content.length, errorKind: sdkError.kind },
        });
        throw sdkError;
    }
}

/**
 * Remove o plano da sessão.
 *
 * @param {unknown} session
 * @returns {Promise<PlanMutationResult>}
 */
export async function planDelete(session) {
    assertRpcSession(session, 'plan.delete');
    appLog('INFO', `[sdk/rpc] plan.delete: sessionId='${session.sessionId}'`);
    const startedAt = Date.now();
    emitSdkOperationMetric({ operation: 'rpc.plan.delete', status: 'started', sessionId: session.sessionId });
    try {
        await session.rpc.plan.delete();
        emitSdkOperationMetric({
            operation: 'rpc.plan.delete',
            status: 'succeeded',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
        });
        return /** @type {PlanMutationResult} */ ({ success: true });
    } catch (error) {
        const sdkError = toSdkOperationError('plan.delete', error);
        emitSdkOperationMetric({
            operation: 'rpc.plan.delete',
            status: 'failed',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { errorKind: sdkError.kind },
        });
        throw sdkError;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INSTRUCTIONS subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lê as fontes de instrução/system prompt reportadas pela sessão SDK.
 *
 * @param {unknown} session
 * @returns {Promise<InstructionSourcesResult>}
 */
export async function instructionSourcesGet(session) {
    assertRpcSession(session, 'instructions.getSources');
    const rpc = /** @type {{ instructions?: { getSources?: () => Promise<InstructionSourcesResult> } }} */ (
        session.rpc
    );
    if (typeof rpc.instructions?.getSources !== 'function') {
        throw new TypeError('[sdk/rpc/instructions.getSources] RPC indisponível nesta sessão SDK.');
    }
    appLog('DEBUG', `[sdk/rpc] instructions.getSources: sessionId='${session.sessionId}'`);
    try {
        return await rpc.instructions.getSources();
    } catch (error) {
        throw toSdkOperationError('instructions.getSources', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKSPACE subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lista arquivos no diretório workspace da sessão infinita.
 *
 * @param {unknown} session
 * @returns {Promise<WorkspaceListResult>}
 */
export async function workspaceListFiles(session) {
    assertRpcSession(session, 'workspace.listFiles');
    appLog('DEBUG', `[sdk/rpc] workspace.listFiles: sessionId='${session.sessionId}'`);
    try {
        const workspaceRpc = getWorkspaceRpc(session);
        return /** @type {WorkspaceListResult} */ (await workspaceRpc.listFiles());
    } catch (error) {
        throw toSdkOperationError('workspace.listFiles', error);
    }
}

/**
 * Lê um arquivo do workspace da sessão.
 *
 * @param {unknown} session
 * @param {string} path - Caminho relativo dentro do diretório workspace
 * @returns {Promise<WorkspaceReadResult>}
 */
export async function workspaceReadFile(session, path) {
    assertRpcSession(session, 'workspace.readFile');
    if (typeof path !== 'string' || path.length === 0) {
        throw new TypeError('[sdk/rpc/workspace.readFile] path deve ser string não-vazia.');
    }
    appLog('DEBUG', `[sdk/rpc] workspace.readFile: path='${path}', sessionId='${session.sessionId}'`);
    try {
        const workspaceRpc = getWorkspaceRpc(session);
        return /** @type {WorkspaceReadResult} */ (await workspaceRpc.readFile({ path }));
    } catch (error) {
        throw toSdkOperationError('workspace.readFile', error);
    }
}

/**
 * Cria/sobrescreve um arquivo no workspace da sessão.
 *
 * @param {unknown} session
 * @param {string} path - Caminho relativo dentro do diretório workspace
 * @param {string} content - Conteúdo UTF-8 do arquivo
 * @returns {Promise<WorkspaceCreateResult>}
 */
export async function workspaceCreateFile(session, path, content) {
    assertRpcSession(session, 'workspace.createFile');
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
    const startedAt = Date.now();
    emitSdkOperationMetric({
        operation: 'rpc.workspace.createFile',
        status: 'started',
        sessionId: session.sessionId,
        attributes: { path, contentLength: content.length },
    });
    try {
        const workspaceRpc = getWorkspaceRpc(session);
        await workspaceRpc.createFile({ path, content });
        emitSdkOperationMetric({
            operation: 'rpc.workspace.createFile',
            status: 'succeeded',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { path, contentLength: content.length },
        });
        return /** @type {WorkspaceCreateResult} */ ({ success: true });
    } catch (error) {
        const sdkError = toSdkOperationError('workspace.createFile', error);
        emitSdkOperationMetric({
            operation: 'rpc.workspace.createFile',
            status: 'failed',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { path, contentLength: content.length, errorKind: sdkError.kind },
        });
        throw sdkError;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOG subsystem
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Emite uma mensagem de log na timeline da sessão.
 *
 * @param {unknown} session
 * @param {string} message - Texto legível
 * @param {{ level?: 'info' | 'warning' | 'error'; ephemeral?: boolean; url?: string }} [options]
 * @returns {Promise<LogResult>}
 */
export async function sessionLog(session, message, options) {
    assertRpcSession(session, 'log');
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
                /**
                 * @type {{
                 *     message: string;
                 *     level?: 'info' | 'warning' | 'error';
                 *     ephemeral?: boolean;
                 *     url?: string;
                 * }}
                 */ (params),
            )
        );
    } catch (error) {
        throw toSdkOperationError('log', error);
    }
}
