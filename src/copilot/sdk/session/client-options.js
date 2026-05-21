// @ts-check
/**
 * src/copilot/sdk/session/client-options.js
 *
 * Builder tipado para `CopilotClientOptions` do `@github/copilot-sdk` dentro da própria wrapper layer do SDK. Consumers
 * externos devem preferir `#copilot/sdk` ou `#copilot/config`, mas a implementação vive em L1 para evitar dependência
 * arquitetural `sdk → config`.
 *
 * @module copilot/sdk/session/client-options
 */

import { COPILOT_CANONICAL_OTEL_SOURCE_NAME } from '#copilot/boot/contract';
import { log } from '../logger.js';
import { BYOK_SECRET_ENV_KEYS, buildConfiguredByokModelListHandler } from './provider.js';
import { buildConfiguredClientSessionFsConfig, getConfiguredSessionIdleTimeoutSeconds } from './session-fs.js';

/**
 * @typedef {import('../types.js').CopilotClientOptions} CopilotClientOptions
 *
 * @typedef {import('../types.js').ModelInfo} ModelInfo
 */

/** @type {Readonly<Record<string, NonNullable<CopilotClientOptions['logLevel']>>>} */
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
            // fallback below
        }
    }
    return raw.split(/\s+/u).filter(Boolean);
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
 * @param {string | undefined} current
 * @param {string} flag
 * @returns {string}
 */
function appendNodeOption(current, flag) {
    const normalized = current?.trim() ?? '';
    if (normalized.includes(flag)) {
        return normalized;
    }
    return normalized.length > 0 ? `${normalized} ${flag}` : flag;
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string | undefined>}
 */
function normalizeCliSpawnEnv(env) {
    const next = { ...env };
    const shouldNormalizeColorEnv = parseBooleanEnv(process.env['COPILOT_CLI_NORMALIZE_COLOR_ENV']) ?? true;
    const shouldDisableExperimentalWarning =
        parseBooleanEnv(process.env['COPILOT_CLI_DISABLE_EXPERIMENTAL_WARNING']) ?? true;

    if (shouldNormalizeColorEnv && next['FORCE_COLOR'] && next['NO_COLOR']) {
        delete next['NO_COLOR'];
    }

    if (shouldDisableExperimentalWarning) {
        next['NODE_OPTIONS'] = appendNodeOption(next['NODE_OPTIONS'], '--disable-warning=ExperimentalWarning');
    }

    return next;
}

export class ClientOptionsBuilder {
    /** @type {Partial<CopilotClientOptions>} */
    #opts = {};

    /** @param {string} path @returns {this} */
    cliPath(path) {
        this.#opts.cliPath = path;
        return this;
    }

    /** @param {string[]} args @returns {this} */
    cliArgs(args) {
        this.#opts.cliArgs = args;
        return this;
    }

    /** @param {string} path @returns {this} */
    cwd(path) {
        this.#opts.cwd = path;
        return this;
    }

    /** @param {string} url @returns {this} */
    cliUrl(url) {
        this.#opts.cliUrl = url;
        return this;
    }

    /** @param {boolean} use @returns {this} */
    useStdio(use) {
        this.#opts.useStdio = use;
        return this;
    }

    /** @param {boolean} value @returns {this} */
    isChildProcess(value) {
        this.#opts.isChildProcess = value;
        return this;
    }

    /** @param {number} p @returns {this} */
    port(p) {
        this.#opts.port = p;
        return this;
    }

    /** @param {NonNullable<CopilotClientOptions['logLevel']>} level @returns {this} */
    logLevel(level) {
        this.#opts.logLevel = level;
        return this;
    }

    /** @returns {this} */
    logLevelFromEnv() {
        const envLevel = (process.env['LOG_LEVEL'] || '').toUpperCase();
        if (envLevel && LOG_LEVEL_MAP[envLevel]) {
            this.#opts.logLevel = LOG_LEVEL_MAP[envLevel];
            log('DEBUG', `[ClientOptionsBuilder] LOG_LEVEL='${envLevel}' → SDK logLevel='${this.#opts.logLevel}'`);
        }
        return this;
    }

    /** @param {string[]} [extraKeys] @returns {this} */
    envPassthrough(extraKeys = []) {
        /** @type {Record<string, string | undefined>} */
        const filtered = {};
        const allowedPrefixes = ['COPILOT_', 'GITHUB_', 'OTEL_', 'NODE_'];
        const allowedKeys = new Set(['FORCE_COLOR', 'NO_COLOR']);
        const extraSet = new Set(extraKeys);

        for (const [key, value] of Object.entries(process.env)) {
            if (extraSet.has(key) || allowedKeys.has(key) || allowedPrefixes.some((p) => key.startsWith(p))) {
                filtered[key] = value;
            }
        }

        if (process.env['PATH']) filtered['PATH'] = process.env['PATH'];
        if (process.env['HOME']) filtered['HOME'] = process.env['HOME'];
        for (const secretKey of BYOK_SECRET_ENV_KEYS) {
            delete filtered[secretKey];
        }

        this.#opts.env = filtered;
        return this;
    }

    /** @param {Record<string, string | undefined>} env @returns {this} */
    env(env) {
        this.#opts.env = normalizeCliSpawnEnv(env);
        return this;
    }

    /** @param {string} token @returns {this} */
    githubToken(token) {
        this.#opts.gitHubToken = token;
        return this;
    }

    /** @returns {this} */
    githubTokenFromEnv() {
        const token = process.env['GITHUB_TOKEN'];
        if (token) this.#opts.gitHubToken = token;
        return this;
    }

    /** @param {boolean} use @returns {this} */
    useLoggedInUser(use) {
        this.#opts.useLoggedInUser = use;
        return this;
    }

    /** @param {NonNullable<CopilotClientOptions['sessionFs']>} sessionFs @returns {this} */
    sessionFs(sessionFs) {
        this.#opts.sessionFs = sessionFs;
        return this;
    }

    /** @param {number} seconds @returns {this} */
    sessionIdleTimeoutSeconds(seconds) {
        this.#opts.sessionIdleTimeoutSeconds = seconds;
        return this;
    }

    /** @param {() => Promise<ModelInfo[]> | ModelInfo[]} fn @returns {this} */
    onListModels(fn) {
        this.#opts.onListModels = fn;
        return this;
    }

    /** @param {NonNullable<CopilotClientOptions['telemetry']>} telemetry @returns {this} */
    telemetry(telemetry) {
        this.#opts.telemetry = telemetry;
        return this;
    }

    /** @returns {this} */
    telemetryFromEnv() {
        const endpoint = process.env['COPILOT_OTLP_ENDPOINT'] || process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
        if (endpoint) {
            this.#opts.telemetry = { otlpEndpoint: endpoint };
            log('DEBUG', `[ClientOptionsBuilder] OTLP telemetria: ${endpoint}`);
        }
        return this;
    }

    /** @param {NonNullable<CopilotClientOptions['onGetTraceContext']>} provider @returns {this} */
    onGetTraceContext(provider) {
        this.#opts.onGetTraceContext = provider;
        return this;
    }

    /** @param {boolean} value @returns {this} */
    autoStart(value) {
        this.#opts.autoStart = value;
        return this;
    }

    /** @param {boolean} value @returns {this} */
    autoRestart(value) {
        this.#opts.autoRestart = value;
        return this;
    }

    /** @returns {this} */
    fromEnv() {
        const cliPath = process.env['COPILOT_CLI_PATH'];
        const cliUrl = process.env['COPILOT_CLI_URL'];
        const cliArgs = parseCliArgsEnv(process.env['COPILOT_CLI_ARGS']);
        const cwd = process.env['COPILOT_CLI_CWD'] || process.env['COPILOT_WORKING_DIRECTORY'];
        const port = parseIntegerEnv(process.env['COPILOT_CLI_PORT']);
        const useStdio = parseBooleanEnv(process.env['COPILOT_USE_STDIO']);
        const isChildProcess = parseBooleanEnv(process.env['COPILOT_CLI_IS_CHILD_PROCESS']);
        const autoStart = parseBooleanEnv(process.env['COPILOT_AUTO_START']);
        const autoRestart = parseBooleanEnv(process.env['COPILOT_AUTO_RESTART']);
        const useLoggedInUser = parseBooleanEnv(process.env['COPILOT_USE_LOGGED_IN_USER']);
        const githubToken = process.env['COPILOT_GITHUB_TOKEN'] || process.env['GITHUB_TOKEN'];
        const logLevel =
            parseLogLevelEnv(process.env['COPILOT_CLI_LOG_LEVEL']) ??
            parseLogLevelEnv(process.env['COPILOT_LOG_LEVEL']) ??
            parseLogLevelEnv(process.env['LOG_LEVEL']);

        if (cliPath) this.#opts.cliPath = cliPath;
        if (cliUrl) this.#opts.cliUrl = cliUrl;
        if (cliArgs) this.#opts.cliArgs = cliArgs;
        if (cwd) this.#opts.cwd = cwd;
        if (port !== undefined) this.#opts.port = port;
        if (useStdio !== undefined) this.#opts.useStdio = useStdio;
        if (isChildProcess !== undefined) this.#opts.isChildProcess = isChildProcess;
        if (autoStart !== undefined) this.#opts.autoStart = autoStart;
        if (autoRestart !== undefined) this.#opts.autoRestart = autoRestart;
        if (useLoggedInUser !== undefined) this.#opts.useLoggedInUser = useLoggedInUser;
        if (githubToken) this.#opts.gitHubToken = githubToken;
        if (logLevel) this.#opts.logLevel = logLevel;

        return this.telemetryFromEnv();
    }

    /** @param {Partial<CopilotClientOptions>} overrides @returns {this} */
    merge(overrides) {
        this.#opts = { ...this.#opts, ...overrides };
        return this;
    }

    /** @returns {Partial<CopilotClientOptions>} */
    build() {
        return {
            ...this.#opts,
            ...(this.#opts.env ? { env: normalizeCliSpawnEnv(this.#opts.env) } : {}),
        };
    }
}

/**
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
        const isChildProcess = parseBooleanEnv(process.env['COPILOT_CLI_IS_CHILD_PROCESS']);

        if (cliPath) builder.cliPath(cliPath);
        if (cliArgs) builder.cliArgs(cliArgs);
        if (cwd) builder.cwd(cwd);
        if (port !== undefined) builder.port(port);
        if (useStdio !== undefined) builder.useStdio(useStdio);
        if (isChildProcess !== undefined) builder.isChildProcess(isChildProcess);
        builder.envPassthrough(['PATH', 'HOME', 'SHELL', 'USER', 'USERNAME', 'TMPDIR']);
    }

    if (logLevel) builder.logLevel(logLevel);

    const autoStart = parseBooleanEnv(process.env['COPILOT_AUTO_START']);
    if (autoStart !== undefined) builder.autoStart(autoStart);

    const autoRestart = parseBooleanEnv(process.env['COPILOT_AUTO_RESTART']);
    if (autoRestart !== undefined) builder.autoRestart(autoRestart);

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
    const telemetrySourceName = process.env['COPILOT_OTEL_SOURCE_NAME'] || COPILOT_CANONICAL_OTEL_SOURCE_NAME;
    if (telemetrySourceName) {
        telemetry.sourceName = telemetrySourceName;
    }
    const captureContent = parseBooleanEnv(process.env['OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT']);
    if (captureContent !== undefined) telemetry.captureContent = captureContent;
    if (Object.keys(telemetry).length > 0) builder.telemetry(telemetry);

    const sessionFs = buildConfiguredClientSessionFsConfig();
    if (sessionFs) builder.sessionFs(sessionFs);

    const sessionIdleTimeoutSeconds = getConfiguredSessionIdleTimeoutSeconds();
    if (sessionIdleTimeoutSeconds !== undefined) {
        builder.sessionIdleTimeoutSeconds(sessionIdleTimeoutSeconds);
    }

    const byokListModels = buildConfiguredByokModelListHandler(process.env);
    if (byokListModels) {
        builder.onListModels(byokListModels);
    }

    return builder.merge(overrides).build();
}
