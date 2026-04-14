// @ts-check
/**
 * src/copilot/config/client-options.js
 *
 * Builder tipado para `CopilotClientOptions` do `@github/copilot-sdk`. Centraliza a construção de opções do client
 * com suporte a logLevel mapping, env passthrough, BYOK onListModels e githubToken.
 *
 * @module copilot/config/client-options
 * @see EventBus
 */

import { log } from '#copilot/observability';

/**
 * @typedef {import('@github/copilot-sdk').CopilotClientOptions} CopilotClientOptions
 * @typedef {import('@github/copilot-sdk').ModelInfo} ModelInfo
 */

/**
 * Mapeamento de LOG_LEVEL do projeto → logLevel do SDK.
 *
 * @type {Readonly<Record<string, NonNullable<CopilotClientOptions['logLevel']>>>}
 */
const LOG_LEVEL_MAP = /** @type {const} */ ({
    ERROR: 'error',
    WARN: 'warning',
    WARNING: 'warning',
    INFO: 'info',
    DEBUG: 'debug',
    TRACE: 'all',
    ALL: 'all',
    NONE: 'none',
    SILENT: 'none',
});

/**
 * Builder fluent para `CopilotClientOptions`.
 *
 * @example
 *     const opts = new ClientOptionsBuilder()
 *         .logLevelFromEnv()
 *         .envPassthrough(['COPILOT_CLI_URL', 'CUSTOM_VAR'])
 *         .githubToken(process.env.GITHUB_TOKEN)
 *         .build();
 */
export class ClientOptionsBuilder {
    /** @type {Partial<CopilotClientOptions>} */
    #opts = {};

    // ─── CLI Path & Args ──────────────────────────────────────────────────

    /**
     * @param {string} path
     * @returns {this}
     */
    cliPath(path) {
        this.#opts.cliPath = path;
        return this;
    }

    /**
     * @param {string[]} args
     * @returns {this}
     */
    cliArgs(args) {
        this.#opts.cliArgs = args;
        return this;
    }

    /**
     * @param {string} url
     * @returns {this}
     */
    cliUrl(url) {
        this.#opts.cliUrl = url;
        return this;
    }

    // ─── Transport ────────────────────────────────────────────────────────

    /**
     * @param {boolean} use
     * @returns {this}
     */
    useStdio(use) {
        this.#opts.useStdio = use;
        return this;
    }

    /**
     * @param {number} p
     * @returns {this}
     */
    port(p) {
        this.#opts.port = p;
        return this;
    }

    // ─── Log Level ────────────────────────────────────────────────────────

    /**
     * Define o logLevel do SDK diretamente.
     *
     * @param {NonNullable<CopilotClientOptions['logLevel']>} level
     * @returns {this}
     */
    logLevel(level) {
        this.#opts.logLevel = level;
        return this;
    }

    /**
     * Mapeia `process.env.LOG_LEVEL` (formato do projeto) para o logLevel do SDK.
     *
     * @returns {this}
     */
    logLevelFromEnv() {
        const envLevel = (process.env.LOG_LEVEL || '').toUpperCase();
        if (envLevel && LOG_LEVEL_MAP[envLevel]) {
            this.#opts.logLevel = LOG_LEVEL_MAP[envLevel];
            log('DEBUG', `[ClientOptionsBuilder] LOG_LEVEL='${envLevel}' → SDK logLevel='${this.#opts.logLevel}'`);
        }
        return this;
    }

    // ─── Environment ──────────────────────────────────────────────────────

    /**
     * Passa variáveis de ambiente filtradas ao CLI process.
     * Inclui apenas as chaves especificadas + variáveis COPILOT_* e GITHUB_*.
     *
     * @param {string[]} [extraKeys] - Chaves adicionais a incluir além de COPILOT_* e GITHUB_*
     * @returns {this}
     */
    envPassthrough(extraKeys = []) {
        /** @type {Record<string, string | undefined>} */
        const filtered = {};
        const allowedPrefixes = ['COPILOT_', 'GITHUB_', 'OTEL_', 'NODE_'];
        const extraSet = new Set(extraKeys);

        for (const [key, value] of Object.entries(process.env)) {
            if (extraSet.has(key) || allowedPrefixes.some((p) => key.startsWith(p))) {
                filtered[key] = value;
            }
        }

        // Sempre incluir PATH e HOME para o CLI funcionar
        if (process.env.PATH) filtered.PATH = process.env.PATH;
        if (process.env.HOME) filtered.HOME = process.env.HOME;

        this.#opts.env = filtered;
        return this;
    }

    /**
     * Define as variáveis de ambiente diretamente.
     *
     * @param {Record<string, string | undefined>} env
     * @returns {this}
     */
    env(env) {
        this.#opts.env = env;
        return this;
    }

    // ─── Authentication ───────────────────────────────────────────────────

    /**
     * Define o GitHub token para autenticação.
     *
     * @param {string} token
     * @returns {this}
     */
    githubToken(token) {
        this.#opts.githubToken = token;
        return this;
    }

    /**
     * Lê o token de `process.env.GITHUB_TOKEN` se disponível.
     *
     * @returns {this}
     */
    githubTokenFromEnv() {
        const token = process.env.GITHUB_TOKEN;
        if (token) {
            this.#opts.githubToken = token;
        }
        return this;
    }

    /**
     * @param {boolean} use
     * @returns {this}
     */
    useLoggedInUser(use) {
        this.#opts.useLoggedInUser = use;
        return this;
    }

    // ─── BYOK (onListModels) ─────────────────────────────────────────────

    /**
     * Define um handler customizado para listar modelos (BYOK).
     *
     * @param {() => Promise<ModelInfo[]> | ModelInfo[]} handler
     * @returns {this}
     */
    onListModels(handler) {
        this.#opts.onListModels = handler;
        return this;
    }

    // ─── Telemetry ────────────────────────────────────────────────────────

    /**
     * Define a configuração de telemetria OTel.
     *
     * @param {NonNullable<CopilotClientOptions['telemetry']>} config
     * @returns {this}
     */
    telemetry(config) {
        this.#opts.telemetry = config;
        return this;
    }

    /**
     * Configura telemetria a partir de `OTEL_EXPORTER_OTLP_ENDPOINT`.
     *
     * @returns {this}
     */
    telemetryFromEnv() {
        const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        if (endpoint) {
            this.#opts.telemetry = /** @type {NonNullable<CopilotClientOptions['telemetry']>} */ (
                /** @type {unknown} */ ({ otlpEndpoint: endpoint })
            );
            log('DEBUG', `[ClientOptionsBuilder] OTLP telemetria: ${endpoint}`);
        }
        return this;
    }

    // ─── Auto ─────────────────────────────────────────────────────────────

    /**
     * @param {boolean} auto
     * @returns {this}
     */
    autoStart(auto) {
        this.#opts.autoStart = auto;
        return this;
    }

    // ─── Merge ────────────────────────────────────────────────────────────

    /**
     * Aplica overrides parciais sobre a configuração corrente.
     *
     * @param {Partial<CopilotClientOptions>} partial
     * @returns {this}
     */
    merge(partial) {
        Object.assign(this.#opts, partial);
        return this;
    }

    // ─── Build ────────────────────────────────────────────────────────────

    /**
     * Constrói o `CopilotClientOptions` final.
     *
     * @returns {CopilotClientOptions}
     */
    build() {
        return /** @type {CopilotClientOptions} */ (/** @type {unknown} */ ({ ...this.#opts }));
    }
}
