// @ts-check
/**
 * src/copilot/config/client-options.js
 *
 * Builder tipado para `CopilotClientOptions` do `@github/copilot-sdk`. Centraliza a construção de opções do client com
 * suporte a logLevel mapping, env passthrough, BYOK onListModels, githubToken, telemetria e boot por env.
 *
 * @module copilot/config/client-options
 * @see EventBus
 */

import { log } from '../observability/logger.js';

/**
 * @typedef {import('#copilot/sdk/types').CopilotClientOptions} CopilotClientOptions
 *
 * @typedef {import('#copilot/sdk/types').ModelInfo} ModelInfo
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
 * @param {string | undefined} value
 * @returns {boolean | undefined}
 */
function parseBooleanEnv(value) {
    if (value === undefined || value === '') return undefined;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return undefined;
}

/**
 * @param {string | undefined} value
 * @returns {number | undefined}
 */
function parseIntegerEnv(value) {
    if (value === undefined || value.trim() === '') return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Aceita `COPILOT_CLI_ARGS='["--foo","bar"]'` ou `COPILOT_CLI_ARGS='--foo bar'`.
 *
 * @param {string | undefined} value
 * @returns {string[] | undefined}
 */
function parseCliArgsEnv(value) {
    if (!value || value.trim() === '') return undefined;
    const raw = value.trim();
    if (raw.startsWith('[')) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed;
        } catch {
            // Fallback abaixo: mantém boot resiliente mesmo se a env foi escrita manualmente.
        }
    }
    return raw.split(/\s+/).filter(Boolean);
}

/**
 * @param {string | undefined} raw
 * @returns {NonNullable<CopilotClientOptions['logLevel']> | undefined}
 */
function parseLogLevelEnv(raw) {
    if (!raw) return undefined;
    const upper = raw.toUpperCase();
    if (LOG_LEVEL_MAP[upper]) return LOG_LEVEL_MAP[upper];
    const lower = raw.toLowerCase();
    if (['none', 'error', 'warning', 'info', 'debug', 'all'].includes(lower)) {
        return /** @type {NonNullable<CopilotClientOptions['logLevel']>} */ (lower);
    }
    return undefined;
}

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
        const envLevel = (process.env['LOG_LEVEL'] || '').toUpperCase();
        if (envLevel && LOG_LEVEL_MAP[envLevel]) {
            this.#opts.logLevel = LOG_LEVEL_MAP[envLevel];
            log('DEBUG', `[ClientOptionsBuilder] LOG_LEVEL='${envLevel}' → SDK logLevel='${this.#opts.logLevel}'`);
        }
        return this;
    }

    // ─── Environment ──────────────────────────────────────────────────────

    /**
     * Passa variáveis de ambiente filtradas ao CLI process. Inclui apenas as chaves especificadas + variáveis COPILOT_*
     * e GITHUB_*.
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
        if (process.env['PATH']) filtered['PATH'] = process.env['PATH'];
        if (process.env['HOME']) filtered['HOME'] = process.env['HOME'];

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
        this.#opts.gitHubToken = token;
        return this;
    }

    /**
     * Lê o token de `process.env.GITHUB_TOKEN` se disponível.
     *
     * @returns {this}
     */
    githubTokenFromEnv() {
        const token = process.env['GITHUB_TOKEN'];
        if (token) {
            this.#opts.gitHubToken = token;
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
        const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
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

/**
 * Constrói as opções canônicas do `CopilotClient` a partir do ambiente do boot.
 *
 * Regras rígidas:
 *
 * - `COPILOT_CLI_URL` vence o transporte: quando definido, o SDK conecta a um CLI já existente e não configura `cliPath`,
 *   `cliArgs`, `port` nem `useStdio`, pois o contrato do SDK os marca como mutuamente exclusivos.
 * - `GITHUB_TOKEN`/`COPILOT_GITHUB_TOKEN` vencem autenticação interativa; se `COPILOT_USE_LOGGED_IN_USER` não foi
 *   definido, `useLoggedInUser` passa a `false`.
 * - `COPILOT_CLI_LOG_LEVEL`, `COPILOT_LOG_LEVEL` e `LOG_LEVEL` são aceitos nesta ordem.
 * - Telemetria aceita todos os campos documentados pelo SDK (`otlpEndpoint`, `filePath`, `exporterType`, `sourceName`,
 *   `captureContent`).
 *
 * @param {Partial<CopilotClientOptions>} [overrides]
 * @returns {Partial<CopilotClientOptions>}
 */
export function buildCopilotClientOptionsFromEnv(overrides = {}) {
    const builder = new ClientOptionsBuilder();
    const cliUrl = process.env['COPILOT_CLI_URL']?.trim();
    const githubToken = process.env['COPILOT_GITHUB_TOKEN'] || process.env['GITHUB_TOKEN'];
    const explicitUseLoggedInUser = parseBooleanEnv(process.env['COPILOT_USE_LOGGED_IN_USER']);
    const logLevel = parseLogLevelEnv(
        process.env['COPILOT_CLI_LOG_LEVEL'] || process.env['COPILOT_LOG_LEVEL'] || process.env['LOG_LEVEL'],
    );

    if (cliUrl) {
        builder.cliUrl(cliUrl);
        log('INFO', `[ClientOptionsBuilder] cliUrl ativo: conectando ao CLI em ${cliUrl}`);
    } else {
        const cliPath = process.env['COPILOT_CLI_PATH']?.trim();
        const cliArgs = parseCliArgsEnv(process.env['COPILOT_CLI_ARGS']);
        const cwd = process.env['COPILOT_CLI_CWD'] || process.env['COPILOT_WORKING_DIRECTORY'];
        const port = parseIntegerEnv(process.env['COPILOT_CLI_PORT']);
        const useStdio = parseBooleanEnv(process.env['COPILOT_USE_STDIO']);

        if (cliPath) builder.cliPath(cliPath);
        if (cliArgs) builder.cliArgs(cliArgs);
        if (cwd) builder.merge({ cwd });
        if (port !== undefined) builder.port(port);
        if (useStdio !== undefined) builder.useStdio(useStdio);
        builder.envPassthrough(['PATH', 'HOME', 'SHELL', 'USER', 'USERNAME', 'TMPDIR']);
    }

    if (logLevel) builder.logLevel(logLevel);

    const autoStart = parseBooleanEnv(process.env['COPILOT_AUTO_START']);
    if (autoStart !== undefined) builder.autoStart(autoStart);

    if (githubToken) {
        builder.githubToken(githubToken);
        if (explicitUseLoggedInUser === undefined) builder.useLoggedInUser(false);
    }
    if (explicitUseLoggedInUser !== undefined && !cliUrl) {
        builder.useLoggedInUser(explicitUseLoggedInUser);
    }

    /** @type {NonNullable<CopilotClientOptions['telemetry']>} */
    const telemetry = {};
    if (process.env['OTEL_EXPORTER_OTLP_ENDPOINT']) {
        telemetry.otlpEndpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
    }
    if (process.env['COPILOT_OTEL_FILE_EXPORTER_PATH']) {
        telemetry.filePath = process.env['COPILOT_OTEL_FILE_EXPORTER_PATH'];
    }
    if (process.env['COPILOT_OTEL_EXPORTER_TYPE']) {
        telemetry.exporterType = process.env['COPILOT_OTEL_EXPORTER_TYPE'];
    }
    if (process.env['COPILOT_OTEL_SOURCE_NAME']) {
        telemetry.sourceName = process.env['COPILOT_OTEL_SOURCE_NAME'];
    }
    const captureContent = parseBooleanEnv(process.env['OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT']);
    if (captureContent !== undefined) telemetry.captureContent = captureContent;
    if (Object.keys(telemetry).length > 0) builder.telemetry(telemetry);

    return builder.merge(overrides).build();
}
