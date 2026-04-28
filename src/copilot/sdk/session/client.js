// @ts-check
/**
 * @module copilot/sdk/client
 * @file Wrapper do CopilotClient com circuit breaker para operações de conexão. Re-exporta CopilotClient do SDK para
 *   uso via barrel `#copilot/sdk`.
 *
 *   src/copilot/sdk/client.js
 * @see EventBus
 * @see module:copilot/lib/session
 * @see module:copilot/always-alive
 */

import { CopilotClient } from '@github/copilot-sdk';
import { CircuitBreaker } from '../../core/circuit-breaker.js';
import { logSwallowed, toError } from '../../core/error-handlers.js';
import {
    clearActiveSdkSessions,
    getActiveSdkSession,
    getActiveSdkSessionCount,
    incrementActiveSdkSessionMessageCount,
    listActiveSdkSessions,
    registerActiveSdkSession,
    removeActiveSdkSession,
} from '../../infra/sdk-session-registry.js';
import { getSdkRecoveryPolicy, toSdkOperationError } from '../errors.js';
import { log } from '../logger.js';
import { emitSdkOperationMetric } from '../telemetry/operation-metrics.js';
import { buildCopilotClientOptionsFromEnv } from './client-options.js';
import { createSession as createLifecycleSession, resumeSession as resumeLifecycleSession } from './lifecycle.js';

// Re-export para que consumidores usem `#copilot/sdk` em vez de `@github/copilot-sdk`
export { CopilotClient };

/**
 * Circuit breaker para operações de conexão ao SDK CLI. Protege contra retry storm em caso de CLI indisponível ou erro
 * de rede.
 *
 * @type {CircuitBreaker}
 */
export const sdkConnectionCircuitBreaker = new CircuitBreaker('sdk-connection', {
    failThreshold: 3,
    resetTimeoutMs: 60_000,
    halfOpenMax: 1,
});

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
 *
 * @typedef {Object} SessionEntry
 * @property {CopilotSession} session - Sessão ativa
 * @property {string} model - Modelo utilizado
 * @property {number} createdAt - Timestamp de criação local (ms)
 * @property {number} messagesCount - Total de mensagens enviadas
 *
 * @typedef {Object} ClientState
 * @property {CopilotClient | null} client - Instância do client ou null
 * @property {boolean} starting - Se está em processo de inicialização
 * @property {true} registryExternalized - Registry de sessões ativas externalizado para infra
 */
/** @type {CopilotClient | null} */
let _client = null;

// C13-01: Promise compartilhada entre waiters para evitar retry storm após falha
/** @type {Promise<import('@github/copilot-sdk').CopilotClient> | null} */
let _startPromise = null;

/** @type {boolean} */
let _registryHasActiveSessions = false;

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
async function wait(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Constrói as opções canônicas do CopilotClient.
 *
 * A fonte de verdade mora em `config/client-options.js`: este wrapper existe para preservar a API pública histórica de
 * `#copilot/sdk` enquanto garante que boot, server, terminal e agent usem as mesmas regras SDK-first.
 *
 * @param {Partial<CopilotClientOptions>} [overrides] - Opções adicionais para sobrescrever
 * @returns {Partial<CopilotClientOptions>}
 */
export function buildClientOptions(overrides = {}) {
    return buildCopilotClientOptionsFromEnv(overrides);
}

/**
 * Cria uma instância NÃO-singleton de CopilotClient com as opções canônicas do projeto.
 *
 * Use esta factory para fluxos isolados (ex.: preflight/reconnect) em vez de `new CopilotClient(...)` direto em
 * consumers. Isso centraliza policy/env no mesmo builder usado por `getClient()`.
 *
 * @param {Partial<CopilotClientOptions>} [overrides] - Overrides opcionais (ex.: telemetry, cliUrl)
 * @returns {CopilotClient}
 */
export function createCopilotClient(overrides = {}) {
    const options = buildClientOptions(overrides);
    return new CopilotClient(/** @type {CopilotClientOptions} */ (/** @type {unknown} */ (options)));
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

    // C13-01: usar Promise compartilhada para evitar retry storm em concorrência
    if (_startPromise) {
        return _startPromise;
    }

    _startPromise = (async () => {
        const startedAt = Date.now();
        emitSdkOperationMetric({ operation: 'client.connect', status: 'started' });
        try {
            log('INFO', '[lib/sdk-client] Iniciando CopilotClient...');
            const maxAttempts = 2;
            /** @type {unknown} */
            let lastError = null;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    sdkConnectionCircuitBreaker.guard();
                    const client = createCopilotClient(overrides);
                    await client.start();
                    sdkConnectionCircuitBreaker.recordSuccess();
                    _client = client;
                    log('INFO', `[lib/sdk-client] CopilotClient conectado. Estado: ${client.getState()}`);
                    emitSdkOperationMetric({
                        operation: 'client.connect',
                        status: 'succeeded',
                        durationMs: Date.now() - startedAt,
                        attributes: {
                            attempt,
                            breakerState: sdkConnectionCircuitBreaker.getState(),
                        },
                    });
                    return client;
                } catch (error) {
                    lastError = error;
                    const policy = getSdkRecoveryPolicy(error, 'connection');

                    if (policy.tripCircuit) {
                        sdkConnectionCircuitBreaker.recordFailure();
                    } else if (policy.resetCircuit) {
                        sdkConnectionCircuitBreaker.reset();
                    }

                    const shouldRetry = policy.retryable && attempt < maxAttempts;
                    log(
                        shouldRetry ? 'WARN' : 'ERROR',
                        `[lib/sdk-client] conexão ao CopilotClient falhou (attempt=${attempt}/${maxAttempts}, kind=${policy.kind}, retryable=${policy.retryable}, tripCircuit=${policy.tripCircuit}): ${toError(error).message}`,
                    );

                    if (shouldRetry) {
                        await wait(policy.backoffMs);
                        continue;
                    }

                    break;
                }
            }

            const policy = getSdkRecoveryPolicy(lastError, 'connection');
            const finalSdkError = toSdkOperationError('client.connect', lastError);
            emitSdkOperationMetric({
                operation: 'client.connect',
                status: 'failed',
                durationMs: Date.now() - startedAt,
                attributes: {
                    errorKind: finalSdkError.kind,
                    breakerState: sdkConnectionCircuitBreaker.getState(),
                    retryable: policy.retryable,
                    tripCircuit: policy.tripCircuit,
                },
            });
            throw finalSdkError;
        } finally {
            _startPromise = null;
        }
    })();

    return _startPromise;
}
/**
 * Para o cliente graciosamente e limpa todas as sessões do registry.
 *
 * @returns {Promise<Error[]>} Array de erros encontrados durante cleanup (vazio = sucesso total)
 */
export async function stopClient() {
    if (!_client) return [];
    log('INFO', '[lib/sdk-client] Parando CopilotClient...');
    const errors = await _client.stop();
    if (errors.length > 0) {
        log('WARN', `[lib/sdk-client] Erros ao parar: ${errors.map((e) => e.message).join(', ')}`);
    }
    if (_registryHasActiveSessions) {
        clearActiveSdkSessions();
        _registryHasActiveSessions = false;
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
    log('WARN', '[lib/sdk-client] Parando CopilotClient de forma forçada (sem cleanup)...');
    try {
        /** @type {{ forceStop?: () => Promise<void> }} */
        const anyClient = _client;
        if (typeof anyClient.forceStop === 'function') {
            await anyClient.forceStop();
        } else {
            await _client.stop();
        }
    } catch (e) {
        log('WARN', `[lib/sdk-client] Erro no forceStop: ${toError(e).message}`);
    }
    if (_registryHasActiveSessions) {
        clearActiveSdkSessions();
        _registryHasActiveSessions = false;
    }
    _client = null;
}
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

/**
 * Retorna o ID da sessão mais recentemente atualizada no servidor Copilot.
 *
 * @returns {Promise<string | undefined>}
 */
export async function getLastClientSessionId() {
    const client = await getClient();
    return client.getLastSessionId();
}

/**
 * Retorna o sessionId atualmente em foreground no modo TUI+server.
 *
 * @returns {Promise<string | undefined>}
 */
export async function getForegroundClientSessionId() {
    const client = await getClient();
    return client.getForegroundSessionId();
}

/**
 * Define qual sessão deve ficar em foreground no modo TUI+server.
 *
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function setForegroundClientSessionId(sessionId) {
    const client = await getClient();
    await client.setForegroundSessionId(sessionId);
}

/**
 * Retorna a facade de server RPC do SDK para o client atual.
 *
 * @returns {Promise<ReturnType<import('@github/copilot-sdk').CopilotClient['rpc']>>}
 */
export async function getServerRpc() {
    const client = await getClient();
    return client.rpc;
}
/**
 * Cria uma nova sessão no CopilotClient e registra no registry em memória.
 *
 * @param {SessionConfig} config - Configuração completa da sessão
 * @returns {Promise<CopilotSession>}
 */
export async function createClientSession(config) {
    const client = await getClient();
    const { session } = await createLifecycleSession(
        client,
        /** @type {import('./lifecycle.js').SessionCreateOptions} */ (/** @type {unknown} */ (config)),
    );
    registerActiveSdkSession(session, {
        model: config.model ?? 'unknown',
        createdAt: Date.now(),
        messagesCount: 0,
    });
    _registryHasActiveSessions = true;
    log('INFO', `[lib/sdk-client] Sessão criada: ${session.sessionId} (modelo: ${config.model ?? 'unknown'})`);
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
    const existing = getActiveSdkSession(sessionId);
    if (existing) {
        log('INFO', `[lib/sdk-client] Sessão ${sessionId} já ativa no registry — retornando existente.`);
        return existing.session;
    }

    const client = await getClient();
    const { session } = await resumeLifecycleSession(
        client,
        sessionId,
        /** @type {import('./lifecycle.js').SessionResumeOptions} */ (/** @type {unknown} */ (config)),
    );
    registerActiveSdkSession(session, {
        model: /** @type {string} */ (/** @type {Record<string, unknown>} */ (config)['model'] ?? 'unknown'),
        createdAt: Date.now(),
        messagesCount: 0,
    });
    _registryHasActiveSessions = true;
    log('INFO', `[lib/sdk-client] Sessão retomada: ${session.sessionId}`);
    return session;
}
/**
 * Desconecta uma sessão ativa e remove do registry.
 *
 * @param {string} sessionId - ID da sessão a desconectar
 * @returns {Promise<void>}
 */
export async function disconnectClientSession(sessionId) {
    const entry = getActiveSdkSession(sessionId);
    if (!entry) {
        log('WARN', `[lib/sdk-client] disconnectClientSession: sessão ${sessionId} não encontrada no registry.`);
        return;
    }
    try {
        await entry.session.disconnect();
    } catch (e) {
        log('WARN', `[lib/sdk-client] Erro ao desconectar sessão ${sessionId}: ${toError(e).message}`);
    }
    removeActiveSdkSession(sessionId);
    if (getActiveSdkSessionCount() === 0) {
        _registryHasActiveSessions = false;
    }
    log('INFO', `[lib/sdk-client] Sessão ${sessionId} desconectada e removida do registry.`);
}
/**
 * Deleta permanentemente uma sessão do disco do CLI (irreversível).
 *
 * @param {string} sessionId - ID da sessão a deletar
 * @returns {Promise<void>}
 */
export async function deleteClientSession(sessionId) {
    // Desconecta do registry se estiver ativa
    const entry = getActiveSdkSession(sessionId);
    if (entry) {
        try {
            await entry.session.disconnect();
        } catch (e) {
            logSwallowed(e, 'sdk.client.disconnect');
        }
        removeActiveSdkSession(sessionId);
        if (getActiveSdkSessionCount() === 0) {
            _registryHasActiveSessions = false;
        }
    }

    const client = await getClient();
    await client.deleteSession(sessionId);
    log('INFO', `[lib/sdk-client] Sessão ${sessionId} deletada do disco.`);
}
/**
 * Retorna a entrada de sessão ativa de um ID (somente registry em memória).
 *
 * @param {string} sessionId
 * @returns {SessionEntry | undefined}
 */
export function getClientSession(sessionId) {
    return getActiveSdkSession(sessionId);
}
/**
 * Retorna todas as entradas de sessão ativas no registry em memória.
 *
 * @returns {({ sessionId: string } & SessionEntry)[]}
 */
export function listActiveClientSessions() {
    return listActiveSdkSessions();
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
    return incrementActiveSdkSessionMessageCount(sessionId);
}
/**
 * Retorna o número de sessões ativas no registry em memória.
 *
 * @returns {number}
 */
export function getActiveSessionCount() {
    return getActiveSdkSessionCount();
}
/**
 * Reseta o estado interno do módulo. **Apenas para uso em testes**.
 *
 * @returns {void}
 */
export function _resetClientState() {
    _client = null;
    _startPromise = null;
    sdkConnectionCircuitBreaker.reset();
    clearActiveSdkSessions();
}
/**
 * Injeta um client mock para testes. **Apenas para uso em testes**.
 *
 * @param {CopilotClient} mockClient
 * @returns {void}
 */
export function _injectClientForTest(mockClient) {
    _client = mockClient;
    _startPromise = null;
}
