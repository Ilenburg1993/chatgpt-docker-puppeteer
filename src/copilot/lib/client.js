// @ts-check
/**
 * src/copilot/lib/client.js
 *
 * Camada de lib pura para o CopilotClient — singleton com suporte a cliUrl (CLI como processo PM2 separado), registry
 * de sessões ativas, lifecycle handlers e utilitários de estado.
 *
 * **Regras arquiteturais:**
 *
 * - Sem side effects no import: nenhum singleton é iniciado automaticamente.
 * - Sem log() no nível do módulo.
 * - Todas as funções são exportadas como factory/utilities (sem classes públicas).
 * - Suporte a `COPILOT_CLI_URL` (env) para conectar a CLI já em execução (PM2 separado).
 *
 * @module copilot/lib/client
 * @see module:copilot/lib/session
 * @see module:copilot/always-alive
 */

import { log } from '#core/logger';
import { CopilotClient } from '@github/copilot-sdk';

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 *
 * @typedef {import('@github/copilot-sdk').SessionConfig} SessionConfig
 *
 * @typedef {import('@github/copilot-sdk').ResumeSessionConfig} ResumeSessionConfig
 *
 * @typedef {import('@github/copilot-sdk').SessionMetadata} SessionMetadata
 *
 * @typedef {import('@github/copilot-sdk').SessionListFilter} SessionListFilter
 *
 * @typedef {import('@github/copilot-sdk').ModelInfo} ModelInfo
 *
 * @typedef {import('@github/copilot-sdk').GetStatusResponse} GetStatusResponse
 *
 * @typedef {import('@github/copilot-sdk').GetAuthStatusResponse} GetAuthStatusResponse
 *
 * @typedef {import('@github/copilot-sdk').ConnectionState} ConnectionState
 *
 * @typedef {import('@github/copilot-sdk').CopilotClientOptions} CopilotClientOptions
 *
 * @typedef {import('@github/copilot-sdk').SessionLifecycleHandler} SessionLifecycleHandler
 */

/**
 * @typedef {Object} SessionEntry
 * @property {CopilotSession} session - Sessão ativa
 * @property {string} model - Modelo utilizado
 * @property {number} createdAt - Timestamp de criação local (ms)
 * @property {number} messagesCount - Total de mensagens enviadas
 */

/**
 * @typedef {Object} ClientState
 * @property {CopilotClient | null} client - Instância do client ou null
 * @property {boolean} starting - Se está em processo de inicialização
 * @property {Map<string, SessionEntry>} sessions - Registry de sessões ativas em memória
 */

// ─── Estado interno do módulo ─────────────────────────────────────────────────
// Cada "instância" de client é mantida em um objeto de estado, permitindo testes
// isolados sem poluição de singletons globais.

/** @type {CopilotClient | null} */
let _client = null;

/** @type {boolean} */
let _starting = false;

/** @type {Error | null} */
let _startError = null;

/** @type {Map<string, SessionEntry>} */
const _sessions = new Map();

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Constrói as opções do CopilotClient, respeitando a variável de ambiente `COPILOT_CLI_URL` para conectar a um CLI já
 * em execução (PM2 separado).
 *
 * Quando `COPILOT_CLI_URL` está definida:
 *
 * - O SDK conecta ao processo CLI existente em vez de fazer spawn de um novo.
 * - Reinicializações do processo SDK não consomem PRs adicionais.
 * - O CLI mantém a sessão viva entre reinicializações do Node.js.
 *
 * @param {Partial<CopilotClientOptions>} [overrides] - Opções adicionais para sobrescrever
 * @returns {Partial<CopilotClientOptions>}
 */
export function buildClientOptions(overrides = {}) {
    const cliUrl = process.env['COPILOT_CLI_URL'];
    /** @type {Partial<CopilotClientOptions>} */
    const options = {};

    if (cliUrl) {
        /** @type {Record<string, unknown>} */
        const anyOptions = options;
        anyOptions['cliUrl'] = cliUrl;
        log('INFO', `[lib/client] Modo cliUrl ativo: conectando ao CLI em ${cliUrl}`);
    }

    // F4.8 (UPG-02): ativa telemetria OTLP via SDK quando OTEL_EXPORTER_OTLP_ENDPOINT está definida
    const otlpEndpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
    if (otlpEndpoint) {
        /** @type {Record<string, unknown>} */
        const anyOptions = options;
        anyOptions['telemetry'] = { otlpEndpoint };
        log('INFO', `[lib/client] OTLP telemetria ativa: ${otlpEndpoint}`);
    }

    return { ...options, ...overrides };
}

/**
 * Retorna (ou cria) a instância singleton de CopilotClient já conectada.
 *
 * Se `COPILOT_CLI_URL` estiver definida, conecta ao CLI externo em vez de fazer spawn.
 *
 * @param {Partial<CopilotClientOptions>} [overrides] - Opções adicionais (ex: cliPath, logLevel)
 * @returns {Promise<CopilotClient>}
 */
export async function getClient(overrides = {}) {
    if (_client && _client.getState() === 'connected') {
        return _client;
    }

    if (_starting) {
        // Aguarda até o cliente estar pronto (UPG-05: backoff exponencial para reduzir pressão)
        await new Promise((resolve) => {
            let pollDelay = 100;
            const poll = () => {
                if (!_starting) {
                    resolve(undefined);
                    return;
                }
                pollDelay = Math.min(pollDelay * 2, 2000);
                setTimeout(poll, pollDelay);
            };
            setTimeout(poll, pollDelay);
        });
        // NEW-02 (fix): propagar erro de inicialização para waiters
        if (_startError) {
            const err = _startError;
            _startError = null;
            throw err;
        }
        if (_client) return _client;
    }

    _starting = true;
    _startError = null;
    try {
        const options = buildClientOptions(overrides);
        log('INFO', '[lib/client] Iniciando CopilotClient...');
        const client = new CopilotClient(/** @type {CopilotClientOptions} */ (/** @type {unknown} */ (options)));
        await client.start();
        _client = client;
        log('INFO', `[lib/client] CopilotClient conectado. Estado: ${client.getState()}`);
        return client;
    } catch (/** @type {any} */ e) {
        _startError = e;
        throw e;
    } finally {
        _starting = false;
    }
}

/**
 * Para o cliente graciosamente e limpa todas as sessões do registry.
 *
 * @returns {Promise<Error[]>} Array de erros encontrados durante cleanup (vazio = sucesso total)
 */
export async function stopClient() {
    if (!_client) return [];
    log('INFO', '[lib/client] Parando CopilotClient...');
    _sessions.clear();
    const errors = await _client.stop();
    if (errors.length > 0) {
        log('WARN', `[lib/client] Erros ao parar: ${errors.map((e) => e.message).join(', ')}`);
    }
    _client = null;
    return errors;
}

/**
 * Para o cliente de forma forçada (sem cleanup gracioso). Use apenas em emergências.
 *
 * @returns {Promise<void>}
 */
export async function forceStopClient() {
    if (!_client) return;
    log('WARN', '[lib/client] Parando CopilotClient de forma forçada (sem cleanup)...');
    _sessions.clear();
    try {
        /** @type {{ forceStop?: () => Promise<void> }} */
        const anyClient = _client;
        if (typeof anyClient.forceStop === 'function') {
            await anyClient.forceStop();
        } else {
            await _client.stop();
        }
    } catch (/** @type {any} */ e) {
        log('WARN', `[lib/client] Erro no forceStop: ${e.message}`);
    }
    _client = null;
}

// ─── Estado e diagnóstico ─────────────────────────────────────────────────────

/**
 * Estado atual da conexão do client.
 *
 * @returns {ConnectionState | 'not_started'}
 */
export function getClientState() {
    return _client?.getState() ?? 'not_started';
}

/**
 * Executa ping no CLI para verificar conectividade.
 *
 * @returns {Promise<{ message: string; timestamp: number; protocolVersion?: number }>}
 */
export async function pingClient() {
    const client = await getClient();
    return client.ping();
}

/**
 * Retorna o status do CLI incluindo versão e informações de protocolo.
 *
 * @returns {Promise<GetStatusResponse>}
 */
export async function getClientStatus() {
    const client = await getClient();
    return client.getStatus();
}

/**
 * Retorna o status de autenticação GitHub do CLI.
 *
 * @returns {Promise<GetAuthStatusResponse>}
 */
export async function getAuthStatus() {
    const client = await getClient();
    return client.getAuthStatus();
}

/**
 * Lista todos os modelos disponíveis no CLI.
 *
 * @returns {Promise<ModelInfo[]>}
 */
export async function listAvailableModels() {
    const client = await getClient();
    return client.listModels();
}

// ─── Gerenciamento de sessões ─────────────────────────────────────────────────

/**
 * Cria uma nova sessão no CopilotClient e registra no registry em memória.
 *
 * @param {SessionConfig} config - Configuração completa da sessão
 * @returns {Promise<CopilotSession>}
 */
export async function createClientSession(config) {
    const client = await getClient();
    const session = await client.createSession(config);
    _sessions.set(session.sessionId, {
        session,
        model: config.model ?? 'unknown',
        createdAt: Date.now(),
        messagesCount: 0,
    });
    log('INFO', `[lib/client] Sessão criada: ${session.sessionId} (modelo: ${config.model ?? 'unknown'})`);
    return session;
}

/**
 * Retoma uma sessão existente e registra no registry em memória. Se a sessão já está ativa no registry, retorna a
 * existente sem nova conexão.
 *
 * @param {string} sessionId - ID da sessão a retomar
 * @param {ResumeSessionConfig} config - Configuração de retomada
 * @returns {Promise<CopilotSession>}
 */
export async function resumeClientSession(sessionId, config) {
    const existing = _sessions.get(sessionId);
    if (existing) {
        log('INFO', `[lib/client] Sessão ${sessionId} já ativa no registry — retornando existente.`);
        return existing.session;
    }

    const client = await getClient();
    const session = await client.resumeSession(sessionId, config);
    _sessions.set(session.sessionId, {
        session,
        model: /** @type {string} */ (/** @type {Record<string, unknown>} */ (config)['model'] ?? 'unknown'),
        createdAt: Date.now(),
        messagesCount: 0,
    });
    log('INFO', `[lib/client] Sessão retomada: ${session.sessionId}`);
    return session;
}

/**
 * Desconecta uma sessão ativa e remove do registry.
 *
 * @param {string} sessionId - ID da sessão a desconectar
 * @returns {Promise<void>}
 */
export async function disconnectClientSession(sessionId) {
    const entry = _sessions.get(sessionId);
    if (!entry) {
        log('WARN', `[lib/client] disconnectClientSession: sessão ${sessionId} não encontrada no registry.`);
        return;
    }
    try {
        await entry.session.disconnect();
    } catch (/** @type {any} */ e) {
        log('WARN', `[lib/client] Erro ao desconectar sessão ${sessionId}: ${e.message}`);
    }
    _sessions.delete(sessionId);
    log('INFO', `[lib/client] Sessão ${sessionId} desconectada e removida do registry.`);
}

/**
 * Deleta permanentemente uma sessão do disco do CLI (irreversível).
 *
 * @param {string} sessionId - ID da sessão a deletar
 * @returns {Promise<void>}
 */
export async function deleteClientSession(sessionId) {
    // Desconecta do registry se estiver ativa
    const entry = _sessions.get(sessionId);
    if (entry) {
        try {
            await entry.session.disconnect();
        } catch {
            // Ignora erro de desconexão — prosseguimos com a deleção de disco
        }
        _sessions.delete(sessionId);
    }

    const client = await getClient();
    await client.deleteSession(sessionId);
    log('INFO', `[lib/client] Sessão ${sessionId} deletada do disco.`);
}

/**
 * Retorna a entrada de sessão ativa de um ID (somente registry em memória).
 *
 * @param {string} sessionId
 * @returns {SessionEntry | undefined}
 */
export function getClientSession(sessionId) {
    return _sessions.get(sessionId);
}

/**
 * Retorna todas as entradas de sessão ativas no registry em memória.
 *
 * @returns {({ sessionId: string } & SessionEntry)[]}
 */
export function listActiveClientSessions() {
    return Array.from(_sessions.entries()).map(([sessionId, entry]) => ({
        sessionId,
        ...entry,
    }));
}

/**
 * Lista todas as sessões salvas no disco do CLI (pode incluir sessões inativas).
 *
 * @param {SessionListFilter} [filter] - Filtro opcional por repositório, etc.
 * @returns {Promise<SessionMetadata[]>}
 */
export async function listAllClientSessions(filter) {
    const client = await getClient();
    return client.listSessions(filter);
}

/**
 * Incrementa o contador de mensagens enviadas de uma sessão no registry.
 *
 * @param {string} sessionId
 * @returns {number} O novo total de mensagens (ou 0 se sessao nao encontrada)
 */
export function incrementSessionMessageCount(sessionId) {
    const entry = _sessions.get(sessionId);
    if (entry) {
        entry.messagesCount += 1;
        return entry.messagesCount;
    }
    return 0;
}

/**
 * Retorna o número de sessões ativas no registry em memória.
 *
 * @returns {number}
 */
export function getActiveSessionCount() {
    return _sessions.size;
}

// ─── Funções de reset (para testes) ──────────────────────────────────────────

/**
 * Reseta o estado interno do módulo. **Apenas para uso em testes**.
 *
 * @returns {void}
 */
export function _resetClientState() {
    _client = null;
    _starting = false;
    _startError = null;
    _sessions.clear();
}

/**
 * Injeta um client mock para testes. **Apenas para uso em testes**.
 *
 * @param {CopilotClient} mockClient
 * @returns {void}
 */
export function _injectClientForTest(mockClient) {
    _client = mockClient;
    _starting = false;
    _startError = null;
}
