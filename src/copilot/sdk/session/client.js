// @ts-check
/**
 * @module copilot/sdk/client
 * @file Wrapper do CopilotClient com circuit breaker para operações de conexão.
 */

import { CopilotClient } from '@github/copilot-sdk';
import { CircuitBreaker } from '#copilot/core/circuit-breaker';
import { logSwallowed, toError } from '#copilot/core/error-handlers';
import { getSdkRecoveryPolicy, toSdkOperationError } from '../errors.js';
import { log } from '../logger.js';
import { setModelListClientProvider } from '../models/client-provider.js';
import { emitSdkOperationMetric } from '../telemetry/operation-metrics.js';
import { buildCopilotClientOptionsFromEnv } from './client-options.js';
import { createSession as createLifecycleSession, resumeSession as resumeLifecycleSession } from './lifecycle.js';
import { createSdkSessionRegistry, defaultSdkSessionRegistry } from './session-registry.js';

export { CopilotClient };

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
 * @typedef {import('./session-registry.js').SdkSessionRegistry} SdkSessionRegistry
 *
 * @typedef {Object} SessionEntry
 * @property {CopilotSession} session
 * @property {string} model
 * @property {number} createdAt
 * @property {number} messagesCount
 *
 * @typedef {Object} ClientState
 * @property {CopilotClient | null} client
 * @property {boolean} starting
 * @property {true} registryExternalized
 *
 * @typedef {Object} CopilotClientManagerOptions
 * @property {CircuitBreaker} [breaker]
 * @property {SdkSessionRegistry} [registry]
 * @property {(overrides?: Partial<CopilotClientOptions>) => CopilotClient} [createClient]
 * @property {() => Promise<void>} [clearModelsCache]
 */

export const sdkConnectionCircuitBreaker = new CircuitBreaker('sdk-connection', {
    failThreshold: 3,
    resetTimeoutMs: 60_000,
    halfOpenMax: 1,
});

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
async function wait(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @returns {Promise<void>}
 */
async function clearModelsCacheBestEffort() {
    try {
        const { clearModelsCacheAsync } = await import('../models/helpers.js');
        await clearModelsCacheAsync();
    } catch (error) {
        logSwallowed(error, 'sdk.client.clearModelsCache');
    }
}

/**
 * Constrói as opções canônicas do CopilotClient.
 *
 * @param {Partial<CopilotClientOptions>} [overrides]
 * @returns {Partial<CopilotClientOptions>}
 */
export function buildClientOptions(overrides = {}) {
    return buildCopilotClientOptionsFromEnv(overrides);
}

/**
 * Cria uma instância não-singleton de CopilotClient com as opções canônicas.
 *
 * @param {Partial<CopilotClientOptions>} [overrides]
 * @returns {CopilotClient}
 */
export function createCopilotClient(overrides = {}) {
    const options = buildClientOptions(overrides);
    return new CopilotClient(/** @type {CopilotClientOptions} */ (/** @type {unknown} */ (options)));
}

/**
 * Runtime stateful e isolável para CopilotClient. O módulo ainda expõe uma instância default para compatibilidade, mas
 * consumidores que precisam de isolamento podem criar seu próprio manager com registry e circuit breaker próprios.
 */
export class CopilotClientManager {
    /** @type {CopilotClient | null} */
    #client = null;

    /** @type {Promise<CopilotClient> | null} */
    #startPromise = null;

    /** @type {boolean} */
    #registryHasActiveSessions = false;

    /** @type {CircuitBreaker} */
    #breaker;

    /** @type {SdkSessionRegistry} */
    #registry;

    /** @type {(overrides?: Partial<CopilotClientOptions>) => CopilotClient} */
    #createClient;

    /** @type {() => Promise<void>} */
    #clearModelsCache;

    /**
     * @param {CopilotClientManagerOptions} [options]
     */
    constructor(options = {}) {
        this.#breaker =
            options.breaker ??
            new CircuitBreaker('sdk-connection', {
                failThreshold: 3,
                resetTimeoutMs: 60_000,
                halfOpenMax: 1,
            });
        this.#registry = options.registry ?? createSdkSessionRegistry();
        this.#createClient = options.createClient ?? createCopilotClient;
        this.#clearModelsCache = options.clearModelsCache ?? clearModelsCacheBestEffort;
    }

    /**
     * @returns {CircuitBreaker}
     */
    getCircuitBreaker() {
        return this.#breaker;
    }

    /**
     * @param {Partial<CopilotClientOptions>} [overrides]
     * @returns {Promise<CopilotClient>}
     */
    async getClient(overrides = {}) {
        if (this.#client && this.#client.getState() === 'connected') {
            return this.#client;
        }

        if (this.#startPromise) {
            return this.#startPromise;
        }

        this.#startPromise = this.#connect(overrides);
        return this.#startPromise;
    }

    /**
     * @param {Partial<CopilotClientOptions>} overrides
     * @returns {Promise<CopilotClient>}
     */
    async #connect(overrides) {
        const startedAt = Date.now();
        emitSdkOperationMetric({ operation: 'client.connect', status: 'started' });
        try {
            log('INFO', '[lib/sdk-client] Iniciando CopilotClient...');
            const maxAttempts = 2;
            /** @type {unknown} */
            let lastError = null;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    this.#breaker.guard();
                    const client = this.#createClient(overrides);
                    await client.start();
                    this.#breaker.recordSuccess();
                    this.#client = client;
                    log('INFO', `[lib/sdk-client] CopilotClient conectado. Estado: ${client.getState()}`);
                    emitSdkOperationMetric({
                        operation: 'client.connect',
                        status: 'succeeded',
                        durationMs: Date.now() - startedAt,
                        attributes: { attempt, breakerState: this.#breaker.getState() },
                    });
                    return client;
                } catch (error) {
                    lastError = error;
                    const policy = getSdkRecoveryPolicy(error, 'connection');

                    if (policy.tripCircuit) this.#breaker.recordFailure();
                    else if (policy.resetCircuit) this.#breaker.reset();

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
                    breakerState: this.#breaker.getState(),
                    retryable: policy.retryable,
                    tripCircuit: policy.tripCircuit,
                },
            });
            throw finalSdkError;
        } finally {
            this.#startPromise = null;
        }
    }

    /**
     * @returns {Promise<Error[]>}
     */
    async stopClient() {
        if (!this.#client) return [];
        log('INFO', '[lib/sdk-client] Parando CopilotClient...');
        const errors = await this.#client.stop();
        if (errors.length > 0) {
            log('WARN', `[lib/sdk-client] Erros ao parar: ${errors.map((e) => e.message).join(', ')}`);
        }
        this.#clearRegistryIfOwned();
        await this.#clearModelsCache();
        this.#client = null;
        return errors;
    }

    /**
     * @returns {Promise<void>}
     */
    async forceStopClient() {
        if (!this.#client) return;
        log('WARN', '[lib/sdk-client] Parando CopilotClient de forma forçada (sem cleanup)...');
        try {
            /** @type {{ forceStop?: () => Promise<void> }} */
            const anyClient = this.#client;
            if (typeof anyClient.forceStop === 'function') await anyClient.forceStop();
            else await this.#client.stop();
        } catch (e) {
            log('WARN', `[lib/sdk-client] Erro no forceStop: ${toError(e).message}`);
        }
        this.#clearRegistryIfOwned();
        await this.#clearModelsCache();
        this.#client = null;
    }

    /**
     * @returns {ConnectionState | 'not_started'}
     */
    getClientState() {
        return this.#client?.getState() ?? 'not_started';
    }

    /**
     * Retorna o client atual sem iniciar conexão. Útil para APIs síncronas que só podem operar sobre um client já
     * criado/injetado.
     *
     * @returns {CopilotClient | null}
     */
    getClientSnapshot() {
        return this.#client;
    }

    /**
     * @returns {Promise<{ message: string; timestamp: number; protocolVersion?: number }>}
     */
    async pingClient() {
        const client = await this.getClient();
        return client.ping();
    }

    /** @returns {Promise<GetStatusResponse>} */
    async getClientStatus() {
        const client = await this.getClient();
        return client.getStatus();
    }

    /** @returns {Promise<GetAuthStatusResponse>} */
    async getAuthStatus() {
        const client = await this.getClient();
        return client.getAuthStatus();
    }

    /** @returns {Promise<ModelInfo[]>} */
    async listAvailableModels() {
        const client = await this.getClient();
        return client.listModels();
    }

    /** @returns {Promise<string | undefined>} */
    async getLastClientSessionId() {
        const client = await this.getClient();
        return client.getLastSessionId();
    }

    /** @returns {Promise<string | undefined>} */
    async getForegroundClientSessionId() {
        const client = await this.getClient();
        return client.getForegroundSessionId();
    }

    /**
     * @param {string} sessionId
     * @returns {Promise<void>}
     */
    async setForegroundClientSessionId(sessionId) {
        const client = await this.getClient();
        await client.setForegroundSessionId(sessionId);
    }

    /** @returns {Promise<ReturnType<CopilotClient['rpc']>>} */
    async getServerRpc() {
        const client = await this.getClient();
        return client.rpc;
    }

    /**
     * @param {SessionConfig} config
     * @returns {Promise<CopilotSession>}
     */
    async createClientSession(config) {
        const client = await this.getClient();
        const { session } = await createLifecycleSession(
            client,
            /** @type {import('./lifecycle.js').SessionCreateOptions} */ (/** @type {unknown} */ (config)),
        );
        this.#registry.register(session, {
            model: config.model ?? 'unknown',
            createdAt: Date.now(),
            messagesCount: 0,
        });
        this.#registryHasActiveSessions = true;
        log('INFO', `[lib/sdk-client] Sessão criada: ${session.sessionId} (modelo: ${config.model ?? 'unknown'})`);
        return session;
    }

    /**
     * @param {string} sessionId
     * @param {ResumeSessionConfig} config
     * @returns {Promise<CopilotSession>}
     */
    async resumeClientSession(sessionId, config) {
        const existing = this.#registry.get(sessionId);
        if (existing) {
            log('INFO', `[lib/sdk-client] Sessão ${sessionId} já ativa no registry — retornando existente.`);
            return existing.session;
        }

        const client = await this.getClient();
        const { session } = await resumeLifecycleSession(
            client,
            sessionId,
            /** @type {import('./lifecycle.js').SessionResumeOptions} */ (/** @type {unknown} */ (config)),
        );
        this.#registry.register(session, {
            model: /** @type {string} */ (/** @type {Record<string, unknown>} */ (config)['model'] ?? 'unknown'),
            createdAt: Date.now(),
            messagesCount: 0,
        });
        this.#registryHasActiveSessions = true;
        log('INFO', `[lib/sdk-client] Sessão retomada: ${session.sessionId}`);
        return session;
    }

    /**
     * @param {string} sessionId
     * @returns {Promise<void>}
     */
    async disconnectClientSession(sessionId) {
        const entry = this.#registry.get(sessionId);
        if (!entry) {
            log('WARN', `[lib/sdk-client] disconnectClientSession: sessão ${sessionId} não encontrada no registry.`);
            return;
        }
        try {
            await entry.session.disconnect();
        } catch (e) {
            log('WARN', `[lib/sdk-client] Erro ao desconectar sessão ${sessionId}: ${toError(e).message}`);
        }
        this.#registry.remove(sessionId);
        if (this.#registry.count() === 0) this.#registryHasActiveSessions = false;
        log('INFO', `[lib/sdk-client] Sessão ${sessionId} desconectada e removida do registry.`);
    }

    /**
     * @param {string} sessionId
     * @returns {Promise<void>}
     */
    async deleteClientSession(sessionId) {
        const entry = this.#registry.get(sessionId);
        if (entry) {
            try {
                await entry.session.disconnect();
            } catch (e) {
                logSwallowed(e, 'sdk.client.disconnect');
            }
            this.#registry.remove(sessionId);
            if (this.#registry.count() === 0) this.#registryHasActiveSessions = false;
        }

        const client = await this.getClient();
        await client.deleteSession(sessionId);
        log('INFO', `[lib/sdk-client] Sessão ${sessionId} deletada do disco.`);
    }

    /**
     * @param {string} sessionId
     * @returns {SessionEntry | undefined}
     */
    getClientSession(sessionId) {
        return this.#registry.get(sessionId);
    }

    /** @returns {({ sessionId: string } & SessionEntry)[]} */
    listActiveClientSessions() {
        return this.#registry.list();
    }

    /**
     * @param {SessionListFilter} [filter]
     * @returns {Promise<SessionMetadata[]>}
     */
    async listAllClientSessions(filter) {
        const client = await this.getClient();
        return client.listSessions(filter);
    }

    /**
     * @param {string} sessionId
     * @returns {number}
     */
    incrementSessionMessageCount(sessionId) {
        return this.#registry.incrementMessageCount(sessionId);
    }

    /** @returns {number} */
    getActiveSessionCount() {
        return this.#registry.count();
    }

    /** @returns {void} */
    resetForTest() {
        this.#client = null;
        this.#startPromise = null;
        this.#breaker.reset();
        this.#registry.clear();
        this.#registryHasActiveSessions = false;
        void this.#clearModelsCache();
    }

    /**
     * @param {CopilotClient} mockClient
     * @returns {void}
     */
    injectClientForTest(mockClient) {
        this.#client = mockClient;
        this.#startPromise = null;
    }

    /** @returns {void} */
    #clearRegistryIfOwned() {
        if (!this.#registryHasActiveSessions) return;
        this.#registry.clear();
        this.#registryHasActiveSessions = false;
    }
}

/**
 * @param {CopilotClientManagerOptions} [options]
 * @returns {CopilotClientManager}
 */
export function createCopilotClientManager(options = {}) {
    return new CopilotClientManager(options);
}

export const defaultClientManager = new CopilotClientManager({
    breaker: sdkConnectionCircuitBreaker,
    registry: defaultSdkSessionRegistry,
});

export function getSdkConnectionCircuitBreaker() {
    return defaultClientManager.getCircuitBreaker();
}

export async function getClient(overrides = {}) {
    return defaultClientManager.getClient(overrides);
}

setModelListClientProvider(getClient);

export async function stopClient() {
    return defaultClientManager.stopClient();
}

export async function forceStopClient() {
    return defaultClientManager.forceStopClient();
}

export function getClientState() {
    return defaultClientManager.getClientState();
}

/**
 * @returns {CopilotClient | null}
 */
export function getClientSnapshot() {
    return defaultClientManager.getClientSnapshot();
}

export async function pingClient() {
    return defaultClientManager.pingClient();
}

export async function getClientStatus() {
    return defaultClientManager.getClientStatus();
}

export async function getAuthStatus() {
    return defaultClientManager.getAuthStatus();
}

export async function listAvailableModels() {
    return defaultClientManager.listAvailableModels();
}

export async function getLastClientSessionId() {
    return defaultClientManager.getLastClientSessionId();
}

export async function getForegroundClientSessionId() {
    return defaultClientManager.getForegroundClientSessionId();
}

/**
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function setForegroundClientSessionId(sessionId) {
    return defaultClientManager.setForegroundClientSessionId(sessionId);
}

export async function getServerRpc() {
    return defaultClientManager.getServerRpc();
}

/**
 * @param {SessionConfig} config
 * @returns {Promise<CopilotSession>}
 */
export async function createClientSession(config) {
    return defaultClientManager.createClientSession(config);
}

/**
 * @param {string} sessionId
 * @param {ResumeSessionConfig} config
 * @returns {Promise<CopilotSession>}
 */
export async function resumeClientSession(sessionId, config) {
    return defaultClientManager.resumeClientSession(sessionId, config);
}

/**
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function disconnectClientSession(sessionId) {
    return defaultClientManager.disconnectClientSession(sessionId);
}

/**
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function deleteClientSession(sessionId) {
    return defaultClientManager.deleteClientSession(sessionId);
}

/**
 * @param {string} sessionId
 * @returns {SessionEntry | undefined}
 */
export function getClientSession(sessionId) {
    return defaultClientManager.getClientSession(sessionId);
}

export function listActiveClientSessions() {
    return defaultClientManager.listActiveClientSessions();
}

/**
 * @param {SessionListFilter} [filter]
 * @returns {Promise<SessionMetadata[]>}
 */
export async function listAllClientSessions(filter) {
    return defaultClientManager.listAllClientSessions(filter);
}

/**
 * @param {string} sessionId
 * @returns {number}
 */
export function incrementSessionMessageCount(sessionId) {
    return defaultClientManager.incrementSessionMessageCount(sessionId);
}

export function getActiveSessionCount() {
    return defaultClientManager.getActiveSessionCount();
}

export function _resetClientState() {
    defaultClientManager.resetForTest();
}

/**
 * @param {CopilotClient} mockClient
 * @returns {void}
 */
export function _injectClientForTest(mockClient) {
    defaultClientManager.injectClientForTest(mockClient);
}
