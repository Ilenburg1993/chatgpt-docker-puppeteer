// @ts-check
/**
 * src/copilot/lib/session.js
 *
 * Lib pura para operacoes de sessao Copilot SDK. Abstrai createSession/resumeSession/listSessions/deleteSession com:
 *
 * - suporte a cliUrl (PM2 - conecta em processo CLI ja existente)
 * - configuracao de infiniteSessions
 * - injecao de systemMessage configuravel
 * - persistencia de estado (delegada ao session-manager.js)
 *
 * @module copilot/lib/session
 */

import { log } from '#core/logger';
import { CopilotClient, approveAll } from '@github/copilot-sdk';

/**
 * @typedef {InstanceType<typeof CopilotClient>} CopilotClientInstance
 *
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 *
 * @typedef {import('@github/copilot-sdk').SessionConfig} SessionConfig
 *
 * @typedef {import('@github/copilot-sdk').PermissionHandler} PermissionHandler
 *
 * @typedef {import('@github/copilot-sdk').Tool[]} ToolList
 */

/**
 * @typedef {Object} InfiniteSessionOptions
 * @property {boolean} [enabled] - Habilitar InfiniteSession
 * @property {number} [backgroundCompactionThreshold] - Fator 0..1 para compactacao em background
 * @property {number} [bufferExhaustionThreshold] - Fator 0..1 para exaustao de buffer
 */

/**
 * @typedef {Object} SystemMessageSection
 * @property {'append' | 'prepend' | 'override'} action - Acao sobre a secao
 * @property {string} content - Conteudo da secao
 */

/**
 * @typedef {Object} SessionCreateOptions
 * @property {string} [model] - Modelo LLM (ex: 'gpt-4.1', 'claude-sonnet-4-5')
 * @property {'low' | 'medium' | 'high'} [reasoningEffort] - Esforco de reasoning (modelos compatíveis)
 * @property {PermissionHandler} [onPermissionRequest] - Handler de permissoes (default: approveAll)
 * @property {Function} [onUserInputRequest] - Handler de input interativo do usuario
 * @property {object} [hooks] - SessionHooks: onPreToolUse, onPostToolUse, onSessionStart, etc.
 * @property {ToolList} [tools] - Custom Tools a registrar na sessao
 * @property {InfiniteSessionOptions} [infiniteSessions] - Configuracao de InfiniteSession
 * @property {boolean | object} [systemMessage] - false para desabilitar, objeto para customizar
 * @property {string} [systemMessageContent] - Conteudo a injetar em guidelines.append
 * @property {string} [workingDirectory] - Diretorio de trabalho da sessao
 * @property {object} [mcpServers] - MCP servers para a sessao
 * @property {object[]} [customAgents] - Agentes customizados
 * @property {boolean} [streaming] - Habilitar streaming (default: true)
 */

/**
 * @typedef {Object} SessionResumeOptions
 * @property {PermissionHandler} [onPermissionRequest]
 * @property {Function} [onUserInputRequest]
 * @property {object} [hooks]
 * @property {ToolList} [tools]
 * @property {boolean | object} [systemMessage]
 * @property {string} [systemMessageContent]
 * @property {boolean} [streaming]
 * @property {boolean} [disableResume] - RF-PR-06: se true, reconecta sem emitir session.resume (reconexão silenciosa)
 */

/**
 * @typedef {Object} SessionResult
 * @property {CopilotSession} session - Sessao criada ou retomada
 * @property {boolean} isResumed - true se foi retomada, false se criada
 * @property {string} sessionId - ID da sessao
 */

// ─── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Constroi o objeto systemMessage para injecao via SDK.
 *
 * @param {boolean | object | undefined} systemMessageOpt
 * @param {string | undefined} content
 * @returns {object | undefined}
 */
function buildSystemMessageConfig(systemMessageOpt, content) {
    if (systemMessageOpt === false) return undefined;
    if (systemMessageOpt && typeof systemMessageOpt === 'object') return systemMessageOpt;
    if (!content) return undefined;

    // SDK-03 (update): SDK 0.2.0 suporta mode:'customize' com sections e content.
    // Usando mode:'customize' com content equivale ao antigo mode:'append', mas permite
    // future section-level overrides sem quebrar compatibilidade.
    return {
        mode: 'customize',
        content,
    };
}

/**
 * Constroi o objeto InfiniteSession defaults + opcoes do usuario.
 *
 * @param {InfiniteSessionOptions | undefined} opts
 * @returns {object}
 */
function buildInfiniteSessionConfig(opts) {
    return {
        enabled: opts?.enabled ?? true,
        backgroundCompactionThreshold: opts?.backgroundCompactionThreshold ?? 0.75,
        ...(opts?.bufferExhaustionThreshold !== undefined
            ? { bufferExhaustionThreshold: opts.bufferExhaustionThreshold }
            : {}),
    };
}

/**
 * Monta o SessionConfig minimo para createSession/resumeSession, usando apenas chaves presentes na SessionOptions para
 * evitar violacoes de exactOptionalPropertyTypes.
 *
 * @param {SessionCreateOptions | SessionResumeOptions} opts
 * @param {'create' | 'resume'} mode
 * @returns {any}
 */
function buildSessionConfig(opts, mode) {
    const cfg = /** @type {Record<string, unknown>} */ ({});

    cfg.streaming = /** @type {any} */ (opts).streaming ?? true;

    if (mode === 'create') {
        const co = /** @type {SessionCreateOptions} */ (opts);
        if (co.model !== undefined) cfg.model = co.model;
        if (co.reasoningEffort !== undefined) cfg.reasoningEffort = co.reasoningEffort;
        if (co.workingDirectory !== undefined) cfg.workingDirectory = co.workingDirectory;
        if (co.mcpServers !== undefined) cfg.mcpServers = co.mcpServers;
        if (co.customAgents !== undefined) cfg.customAgents = co.customAgents;
        // BUG-HIGH-06 (fix): só aplicar infiniteSessions quando explicitamente fornecido
        // Evita habilitar compaction automática em sessões que não solicitaram (ex: routes/sessions.js)
        if (co.infiniteSessions !== undefined) {
            cfg.infiniteSessions = buildInfiniteSessionConfig(co.infiniteSessions);
        }
    }

    if (opts.onPermissionRequest !== undefined) cfg.onPermissionRequest = opts.onPermissionRequest;
    else cfg.onPermissionRequest = approveAll; // SDK-01: obrigatório no v0.2.0 — default approveAll
    if (opts.onUserInputRequest !== undefined) cfg.onUserInputRequest = opts.onUserInputRequest;

    // RF-PR-01: compor hooks — onErrorOccurred com retry automático está em buildErrorOccurredHandler() (hooks.js)
    // e é o default de createHooks(). Preservamos hooks do usuário sem sobrescrever.
    {
        const userHooks = /** @type {Record<string, any>} */ (opts.hooks ?? {});
        cfg.hooks = { ...userHooks };
    }

    if (opts.tools !== undefined) cfg.tools = opts.tools;

    // RF-PR-06: disableResume — reconexão silenciosa sem emitir session.resume
    if (mode === 'resume') {
        const ro = /** @type {SessionResumeOptions} */ (opts);
        if (ro.disableResume !== undefined) cfg.disableResume = ro.disableResume;
    }

    const systemMsg = buildSystemMessageConfig(opts.systemMessage, /** @type {any} */ (opts).systemMessageContent);
    if (systemMsg !== undefined) cfg.systemMessage = systemMsg;

    return cfg;
}

// ─── API publica ──────────────────────────────────────────────────────────────

/**
 * Cria uma nova sessao com o cliente SDK.
 *
 * @example
 *     const { session } = await createSession(client, { model: 'gpt-4.1' });
 *
 * @param {any} client - CopilotClient instanciado
 * @param {SessionCreateOptions} [opts] - Opcoes de configuracao
 * @returns {Promise<SessionResult>}
 */
export async function createSession(client, opts) {
    const options = opts ?? {};
    const model = options.model ?? 'gpt-4.1';
    const config = buildSessionConfig({ ...options, model }, 'create');

    log('INFO', `[lib/session] Criando nova sessao: model='${model}'`);
    const session = await client.createSession(config);
    log('INFO', `[lib/session] Sessao criada: ${session.sessionId}`);
    return { session, isResumed: false, sessionId: session.sessionId };
}

/**
 * Retoma uma sessao existente pelo ID.
 *
 * @example
 *     const { session } = await resumeSession(client, 'abc-123');
 *
 * @param {any} client - CopilotClient instanciado
 * @param {string} sessionId - ID da sessao a retomar
 * @param {SessionResumeOptions} [opts] - Opcoes de configuracao compatíveis com resume
 * @returns {Promise<SessionResult>}
 * @throws {Error} Se a sessao nao existir ou estiver expirada
 */
export async function resumeSession(client, sessionId, opts) {
    const options = opts ?? {};
    const config = buildSessionConfig(options, 'resume');

    log('INFO', `[lib/session] Retomando sessao: ${sessionId}`);
    const session = await client.resumeSession(sessionId, config);
    log('INFO', `[lib/session] Sessao retomada: ${session.sessionId}`);
    return { session, isResumed: true, sessionId: session.sessionId };
}

/**
 * Tenta retomar uma sessao; se falhar, cria uma nova. Padrao usado pelo session-manager para persistencia entre
 * reinicializacoes.
 *
 * @param {any} client - CopilotClient instanciado
 * @param {string | null | undefined} existingSessionId - ID da sessao persistida (ou null)
 * @param {SessionCreateOptions} [opts] - Opcoes usadas tanto para resume quanto para create
 * @returns {Promise<SessionResult>}
 */
export async function resumeOrCreate(client, existingSessionId, opts) {
    if (existingSessionId) {
        try {
            const result = await resumeSession(client, existingSessionId, opts);
            return result;
        } catch (/** @type {any} */ e) {
            log('WARN', `[lib/session] Falha ao retomar '${existingSessionId}': ${e.message}. Criando nova sessao.`);
        }
    }
    return createSession(client, opts);
}

/**
 * Lista todas as sessoes ativas no cliente.
 *
 * @param {any} client - CopilotClient instanciado
 * @param {object} [filter] - Filtro opcional
 * @returns {Promise<import('@github/copilot-sdk').SessionMetadata[]>}
 */
export async function listSessions(client, filter) {
    return client.listSessions(filter);
}

/**
 * Remove uma sessao pelo ID.
 *
 * @param {any} client - CopilotClient instanciado
 * @param {string} sessionId - ID da sessao a remover
 * @returns {Promise<void>}
 */
export async function deleteSession(client, sessionId) {
    log('INFO', `[lib/session] Removendo sessao: ${sessionId}`);
    await client.deleteSession(sessionId);
    log('INFO', `[lib/session] Sessao removida: ${sessionId}`);
}

/**
 * Desconecta uma sessao ativa (sem remover do servidor).
 *
 * @param {CopilotSession} session - Sessao a desconectar
 * @returns {Promise<void>}
 */
export async function disconnectSession(session) {
    log('INFO', `[lib/session] Desconectando sessao: ${session.sessionId}`);
    await session.disconnect();
    log('INFO', `[lib/session] Sessao desconectada: ${session.sessionId}`);
}

/**
 * Cria um CopilotClient conectado a um processo CLI externo (modo PM2 / cliUrl). Nao inicia um novo processo — conecta
 * no URL fornecido.
 *
 * @example
 *     // PM2 roda o CLI em background; aqui nos conectamos sem iniciar novo processo.
 *     const client = createClientFromCliUrl('http://localhost:3100');
 *
 * @param {string} cliUrl - URL do processo CLI ja em execucao (ex: 'http://localhost:3100')
 * @returns {CopilotClient}
 */
export function createClientFromCliUrl(cliUrl) {
    log('INFO', `[lib/session] Conectando ao CLI externo: ${cliUrl}`);
    return new CopilotClient({ cliUrl });
}
