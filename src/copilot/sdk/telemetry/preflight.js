// @ts-check
/**
 * @module copilot/sdk/telemetry/preflight
 * @file Preflight canônico do SDK/CLI usado pelo boot antes de expor HTTP/REPL.
 */

import { toError } from '#copilot/core';

/**
 * @typedef {{
 *     ok: boolean;
 *     pingOk: boolean;
 *     authenticated: boolean | null;
 *     modelConfigured: string | null;
 *     modelValidated: boolean | null;
 *     warnings: string[];
 *     errors: string[];
 * }} CopilotSdkBootPreflightReport
 */

/**
 * @param {unknown} err
 * @returns {string}
 */
function errorMessage(err) {
    return toError(err).message;
}

/**
 * @param {number} timeoutMs
 * @param {string} [label='Operation'] Default is `'Operation'`
 * @returns {Promise<never>}
 */
function timeoutAfter(timeoutMs, label = 'Operation') {
    return new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${label} timeout (${timeoutMs}ms)`)), timeoutMs);
    });
}

/**
 * Executa preflight do SDK/CLI sem depender do domínio `agent/`.
 *
 * @param {{
 *     createClient: () => import('#copilot/sdk/types').CopilotClient;
 *     checkAuthStatus: (client: import('#copilot/sdk/types').CopilotClient) => Promise<{ authenticated: boolean }>;
 *     pingTimeoutMs: number;
 *     configuredModel?: string | null;
 *     log: (level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string) => void;
 * }} options
 * @returns {Promise<CopilotSdkBootPreflightReport>}
 */
export async function runCopilotSdkBootPreflight({
    createClient,
    checkAuthStatus,
    pingTimeoutMs,
    configuredModel = null,
    log,
}) {
    /** @type {CopilotSdkBootPreflightReport} */
    const report = {
        ok: false,
        pingOk: false,
        authenticated: null,
        modelConfigured: configuredModel ?? null,
        modelValidated: null,
        warnings: [],
        errors: [],
    };

    /** @type {import('#copilot/sdk/types').CopilotClient | null} */
    let client = null;
    try {
        client = createClient();
        if (typeof client.start === 'function') {
            await client.start();
        }

        await Promise.race([client.ping('boot-preflight'), timeoutAfter(pingTimeoutMs, 'Ping')]);
        report.pingOk = true;
        log('INFO', '[copilot/sdk/preflight] CLI conectado — ping OK.');

        try {
            const authStatus = await checkAuthStatus(client);
            report.authenticated = authStatus.authenticated;
            if (!authStatus.authenticated) {
                const warning = 'Usuário não autenticado no Copilot — sessão pode falhar.';
                report.warnings.push(warning);
                log('WARN', `[copilot/sdk/preflight] ${warning}`);
            } else {
                log('INFO', '[copilot/sdk/preflight] Autenticação Copilot OK.');
            }
        } catch (e) {
            const warning = `Verificação de auth ignorada: ${errorMessage(e)}`;
            report.warnings.push(warning);
            log('DEBUG', `[copilot/sdk/preflight] ${warning}`);
        }

        if (configuredModel) {
            if (configuredModel === 'auto') {
                report.modelValidated = true;
                log('INFO', '[copilot/sdk/preflight] Modelo "auto" será resolvido pelo SDK/GitHub Copilot.');
            } else {
                try {
                    const modelValidationTimeoutMs = Math.max(15_000, pingTimeoutMs);
                    const models = await Promise.race([
                        client.listModels(),
                        timeoutAfter(modelValidationTimeoutMs, 'Model validation'),
                    ]);
                    report.modelValidated = models.some((model) => model.id === configuredModel);
                    if (!report.modelValidated) {
                        const warning = `Modelo '${configuredModel}' não encontrado na lista de modelos disponíveis.`;
                        report.warnings.push(warning);
                        log('WARN', `[copilot/sdk/preflight] ${warning}`);
                    } else {
                        log('INFO', `[copilot/sdk/preflight] Modelo '${configuredModel}' validado.`);
                    }
                } catch (e) {
                    const warning = `Validação de modelo ignorada: ${errorMessage(e)}`;
                    report.warnings.push(warning);
                    log('DEBUG', `[copilot/sdk/preflight] ${warning}`);
                }
            }
        }

        report.ok = report.pingOk && report.errors.length === 0;
        return report;
    } catch (e) {
        const warning = `CLI não respondeu ao ping no boot: ${errorMessage(e)}`;
        report.warnings.push(warning);
        log('WARN', `[copilot/sdk/preflight] ${warning}`);
        return report;
    } finally {
        if (client && typeof client.stop === 'function') {
            await client.stop().catch((e) => {
                log('DEBUG', `[copilot/sdk/preflight] Falha ao encerrar cliente de preflight: ${errorMessage(e)}`);
            });
        }
    }
}
