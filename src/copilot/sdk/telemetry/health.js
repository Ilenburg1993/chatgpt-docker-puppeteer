// @ts-check
/**
 * src/copilot/sdk/health.js
 *
 * Health check probes para o Copilot SDK via server RPC. Combina ping, auth status e quota em uma verificação
 * unificada.
 *
 * @module copilot/sdk/health
 * @see EventBus
 * @see module:copilot/sdk/server-rpc
 */

import { log as appLog } from '../logger.js';
import { accountGetQuota, ping } from '../rpc/server.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotClient} CopilotClient
 *
 * @typedef {import('../rpc/server.js').PingResult} PingResult
 *
 * @typedef {import('../rpc/server.js').AccountQuotaResult} AccountQuotaResult
 *
 * @typedef {import('../rpc/server.js').QuotaSnapshot} QuotaSnapshot
 *
 * @typedef {'healthy' | 'degraded' | 'unhealthy'} HealthStatus
 *
 * @typedef {{
 *     ok: boolean;
 *     latencyMs: number;
 *     protocolVersion: number;
 *     message: string;
 * }} PingCheck
 *
 * @typedef {{
 *     ok: boolean;
 *     authenticated: boolean;
 *     error?: string;
 * }} AuthCheck
 *
 * @typedef {{
 *     ok: boolean;
 *     quotaSnapshots?: Record<string, QuotaSnapshot>;
 *     exhausted: boolean;
 *     error?: string;
 * }} QuotaCheck
 *
 *
 * @typedef {{
 *     status: HealthStatus;
 *     timestamp: string;
 *     checks: {
 *         ping: PingCheck;
 *         auth: AuthCheck;
 *         quota: QuotaCheck;
 *     };
 * }} FullHealthResult
 */

// ─── Validação ─────────────────────────────────────────────────────────────────

/**
 * @param {unknown} client
 * @param {string} caller
 * @returns {asserts client is CopilotClient}
 */
function assertClient(client, caller) {
    if (!client || typeof client !== 'object' || !('rpc' in client)) {
        throw new TypeError(`[sdk/health/${caller}] CopilotClient inválido ou não conectado.`);
    }
}

/**
 * Extrai mensagem de erro priorizando `error.cause.message` quando disponível (ex.: wrappers `SdkOperationError`).
 *
 * @param {unknown} err
 * @returns {string}
 */
function getErrorMessage(err) {
    if (err && typeof err === 'object') {
        const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (err));
        const cause = raw['cause'];
        if (cause && typeof cause === 'object') {
            const causeMessage = /** @type {{ message?: unknown }} */ (cause).message;
            if (typeof causeMessage === 'string' && causeMessage.length > 0) {
                return causeMessage;
            }
        }
        const message = raw['message'];
        if (typeof message === 'string' && message.length > 0) return message;
    }
    return String(err);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROBES INDIVIDUAIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Verifica conectividade via ping. Mede latência e verifica protocol version.
 *
 * @param {CopilotClient} client
 * @returns {Promise<PingCheck>}
 */
export async function pingCheck(client) {
    assertClient(client, 'pingCheck');
    const start = Date.now();
    try {
        const result = await ping(client, 'health-check');
        const latencyMs = Date.now() - start;
        appLog('DEBUG', `[sdk/health] ping: ${latencyMs}ms, protocol=${result.protocolVersion}`);
        return {
            ok: true,
            latencyMs,
            protocolVersion: result.protocolVersion ?? 0,
            message: result.message,
        };
    } catch (err) {
        const latencyMs = Date.now() - start;
        const message = getErrorMessage(err);
        appLog('WARN', `[sdk/health] ping FAILED: ${message}`);
        return {
            ok: false,
            latencyMs,
            protocolVersion: 0,
            message,
        };
    }
}

/**
 * Verifica autenticação executando uma chamada que exige auth válida. Usa `account.getQuota()` como proxy — se retorna
 * dados, auth está OK.
 *
 * @param {CopilotClient} client
 * @returns {Promise<AuthCheck>}
 */
export async function getAuthStatus(client) {
    assertClient(client, 'getAuthStatus');
    try {
        await accountGetQuota(client);
        appLog('DEBUG', '[sdk/health] auth: authenticated');
        return { ok: true, authenticated: true };
    } catch (err) {
        const msg = getErrorMessage(err);
        appLog('WARN', `[sdk/health] auth FAILED: ${msg}`);
        return { ok: false, authenticated: false, error: msg };
    }
}

/**
 * Verifica quota disponível. Retorna snapshots e flag de exaustão.
 *
 * @param {CopilotClient} client
 * @returns {Promise<QuotaCheck>}
 */
export async function getQuota(client) {
    assertClient(client, 'getQuota');
    try {
        const result = await accountGetQuota(client);
        const snapshots = result.quotaSnapshots;
        const exhausted = Object.values(snapshots).some(
            (s) => s.remainingPercentage <= 0 && !s.overageAllowedWithExhaustedQuota,
        );
        appLog('DEBUG', `[sdk/health] quota: exhausted=${exhausted}, types=${Object.keys(snapshots).length}`);
        return { ok: !exhausted, quotaSnapshots: snapshots, exhausted };
    } catch (err) {
        const msg = getErrorMessage(err);
        appLog('WARN', `[sdk/health] quota FAILED: ${msg}`);
        return { ok: false, exhausted: false, error: msg };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FULL HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Executa verificação completa: ping + auth + quota. Retorna status consolidado.
 *
 * - **healthy**: todos os checks OK
 * - **degraded**: ping OK mas auth ou quota com problemas
 * - **unhealthy**: ping falhou (servidor inacessível)
 *
 * @param {CopilotClient} client
 * @returns {Promise<FullHealthResult>}
 */
export async function fullHealthCheck(client) {
    assertClient(client, 'fullHealthCheck');

    const [pingResult, authResult, quotaResult] = await Promise.all([
        pingCheck(client),
        getAuthStatus(client),
        getQuota(client),
    ]);

    /** @type {HealthStatus} */
    let status;
    if (!pingResult.ok) {
        status = 'unhealthy';
    } else if (!authResult.ok || !quotaResult.ok) {
        status = 'degraded';
    } else {
        status = 'healthy';
    }

    appLog('INFO', `[sdk/health] fullHealthCheck: status=${status}`);

    return {
        status,
        timestamp: new Date().toISOString(),
        checks: {
            ping: pingResult,
            auth: authResult,
            quota: quotaResult,
        },
    };
}

/**
 * Sugar: retorna `true` se o server está acessível (ping OK).
 *
 * @param {CopilotClient} client
 * @returns {Promise<boolean>}
 */
export async function isServerReachable(client) {
    try {
        const result = await pingCheck(client);
        return result.ok;
    } catch {
        return false;
    }
}
