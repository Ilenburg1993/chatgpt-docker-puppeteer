// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';

/**
 * Esquema de validação para variável de ambiente.
 * @typedef {object} EnvVariableSpec
 * @property {'FATAL'|'ERROR'|'WARN'} level - Nível de criticidade da variável.
 * @property {(val: string) => boolean} validator - Função validadora para o valor.
 * @property {string} default - Valor padrão se não definido.
 * @property {string} message - Mensagem de erro para validação falhada.
 */

/**
 * Resultado da validação de ambiente.
 * @typedef {object} ValidationResult
 * @property {boolean} valid - Se todas as validações passaram.
 * @property {Array<{key: string, level: string, message: string}>} errors - Lista de erros de validação.
 * @property {Array<{key: string, level: string, message: string}>} warnings - Lista de avisos de validação.
 * @property {Record<string, string>} env - Valores ENV resolvidos (com defaults aplicados).
 */

/**
 * Opções para validação de ambiente.
 * @typedef {object} ValidationOptions
 * @property {boolean} [throwOnError=true] - Lançar erro se validação FATAL/ERROR falhar.
 * @property {boolean} [applyDefaults=true] - Aplicar valores padrão para variáveis faltantes.
 * @property {boolean} [verbose=false] - Logar todos os resultados de validação.
 */

/**
 * Environment Variable Validator
 *
 * Validates required environment variables at startup to fail-fast
 * instead of failing silently during runtime.
 *
 * Usage:
 *   import { validateEnv } from '#core/env_validator';
 *   validateEnv(); // Throws if critical ENVs missing
 */

/**
 * ENV variable definitions with validation rules
 *
 * Criticality levels:
 * - FATAL: Process cannot start without this (hard requirement)
 * - ERROR: Feature will fail but process can start (soft requirement)
 * - WARN: Optional but recommended
 */
const ENV_SCHEMA = {
    // [1] STRUCTURAL VARIABLES (Identity)
    NODE_ENV: {
        level: 'FATAL',
        validator: val => ['development', 'production', 'test'].includes(val),
        default: 'development',
        message: 'Must be one of: development, production, test',
    },
    SERVER_MODE: {
        level: 'FATAL',
        validator: val => ['split', 'integrated', 'disabled'].includes(val),
        default: 'split',
        message: 'Must be one of: split, integrated, disabled',
    },
    SERVER_AUTHORITY: {
        level: 'FATAL',
        validator: val => ['standalone', 'delegated'].includes(val),
        default: 'standalone',
        message: 'Must be one of: standalone, delegated',
    },
    BROWSER_MODE: {
        level: 'FATAL',
        validator: val => ['wsEndpoint', 'connect', 'launcher', 'auto'].includes(val),
        default: 'wsEndpoint',
        message: 'Must be one of: wsEndpoint, connect, launcher, auto',
    },

    // [2] INFRASTRUCTURE VARIABLES (Connectivity)
    SERVER_PORT: {
        level: 'ERROR',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) > 0 && parseInt(val, 10) < 65536,
        default: '3008',
        message: 'Must be a valid port number (1-65535)',
    },
    CHROME_PROXY_PORT: {
        level: 'ERROR',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) > 0 && parseInt(val, 10) < 65536,
        default: '9224',
        message: 'Must be a valid port number (1-65535)',
    },
    CHROME_PORT: {
        level: 'ERROR',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) > 0 && parseInt(val, 10) < 65536,
        default: '9225',
        message: 'Must be a valid port number (1-65535)',
    },
    CHROME_HOST: {
        level: 'ERROR',
        validator: val => val && val.length > 0,
        default: 'host.docker.internal',
        message: 'Cannot be empty',
    },

    // [3] TIMEOUTS (Cascade validation)
    OLLAMA_CLOUD_ENABLED: {
        level: 'WARN',
        validator: val => ['true', 'false'].includes(String(val)),
        default: 'true',
        message: 'Must be true or false',
    },
    OLLAMA_GENERATE_TIMEOUT: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) > 0,
        default: '60000',
        message: 'Must be a positive number (milliseconds)',
    },
    TOOL_EXECUTION_TIMEOUT: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) > 0,
        default: '75000',
        message: 'Must be a positive number (milliseconds)',
    },
    MCP_TOOL_TIMEOUT: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) > 0,
        default: '90000',
        message: 'Must be a positive number (milliseconds)',
    },
    SERVER_REQUEST_TIMEOUT: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) > 0,
        default: '120000',
        message: 'Must be a positive number (milliseconds)',
    },
    OLLAMA_NON_EMBEDDING_RUNTIME: {
        level: 'WARN',
        validator: val => ['auto', 'cloud', 'local'].includes(String(val)),
        default: 'auto',
        message: 'Must be one of: auto, cloud, local',
    },
    OLLAMA_NON_EMBEDDING_LOCAL_FALLBACK: {
        level: 'WARN',
        validator: val => ['true', 'false'].includes(String(val)),
        default: 'true',
        message: 'Must be true or false',
    },
    OLLAMA_LOCAL_MODEL_PROFILE: {
        level: 'WARN',
        validator: val => ['light', 'custom'].includes(String(val)),
        default: 'light',
        message: 'Must be one of: light, custom',
    },
    OLLAMA_LOCAL_ALLOWED_MODELS: {
        level: 'WARN',
        validator: val => typeof val === 'string',
        default: '',
        message: 'Must be a comma-separated string (or empty)',
    },
    RAG_PROFILE_DEFAULT: {
        level: 'WARN',
        validator: val => ['core', 'dev', 'full'].includes(String(val)),
        default: 'core',
        message: 'Must be one of: core, dev, full',
    },
    RAG_DOCS_MODE: {
        level: 'WARN',
        validator: val => ['include', 'exclude', 'only'].includes(String(val)),
        default: 'include',
        message: 'Must be one of: include, exclude, only',
    },
    RAG_INCLUDE_GLOBS: {
        level: 'WARN',
        validator: val => typeof val === 'string',
        default: '',
        message: 'Must be a comma-separated glob string (or empty)',
    },
    RAG_EXCLUDE_GLOBS: {
        level: 'WARN',
        validator: val => typeof val === 'string',
        default: '',
        message: 'Must be a comma-separated glob string (or empty)',
    },
    RAG_INDEX_MAX_FILE_BYTES: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 1000,
        default: '2000000',
        message: 'Must be an integer >= 1000',
    },
    RAG_DEGRADED_MODE_ENABLED: {
        level: 'WARN',
        validator: val => ['true', 'false'].includes(String(val)),
        default: 'true',
        message: 'Must be true or false',
    },
    RAG_AST_CHUNK_ENABLED: {
        level: 'WARN',
        validator: val => ['true', 'false'].includes(String(val)),
        default: 'true',
        message: 'Must be true or false',
    },
    RAG_CHUNK_TARGET_CHARS: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 800,
        default: '1800',
        message: 'Must be an integer >= 800',
    },
    RAG_CHUNK_MAX_CHARS: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 1200,
        default: '2800',
        message: 'Must be an integer >= 1200',
    },
    RAG_THROTTLE_ENABLED: {
        level: 'WARN',
        validator: val => ['true', 'false'].includes(String(val)),
        default: 'true',
        message: 'Must be true or false',
    },
    RAG_THROTTLE_METRIC: {
        level: 'WARN',
        validator: val => ['auto', 'system', 'process'].includes(String(val)),
        default: 'auto',
        message: 'Must be one of: auto, system, process',
    },
    RAG_THROTTLE_TARGET_CPU: {
        level: 'WARN',
        validator: val => !isNaN(parseFloat(val)) && parseFloat(val) >= 20 && parseFloat(val) <= 95,
        default: '72',
        message: 'Must be a number between 20 and 95',
    },
    RAG_THROTTLE_MIN_DELAY_MS: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 0,
        default: '60',
        message: 'Must be an integer >= 0',
    },
    RAG_THROTTLE_MAX_DELAY_MS: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 100,
        default: '5000',
        message: 'Must be an integer >= 100',
    },
    RAG_THROTTLE_INITIAL_DELAY_MS: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 0,
        default: '260',
        message: 'Must be an integer >= 0',
    },
    RAG_THROTTLE_SAMPLE_INTERVAL_MS: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 100,
        default: '1000',
        message: 'Must be an integer >= 100 (milliseconds)',
    },
    RAG_THROTTLE_SAMPLE_SIZE: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 3,
        default: '8',
        message: 'Must be an integer >= 3',
    },
    RAG_THROTTLE_SLOWDOWN_FACTOR: {
        level: 'WARN',
        validator: val => !isNaN(parseFloat(val)) && parseFloat(val) > 1 && parseFloat(val) <= 3,
        default: '1.28',
        message: 'Must be a number > 1 and <= 3',
    },
    RAG_THROTTLE_SPEEDUP_FACTOR: {
        level: 'WARN',
        validator: val => !isNaN(parseFloat(val)) && parseFloat(val) > 0 && parseFloat(val) < 1,
        default: '0.92',
        message: 'Must be a number > 0 and < 1',
    },
    RAG_THROTTLE_HIGH_WATERMARK_PCT: {
        level: 'WARN',
        validator: val => !isNaN(parseFloat(val)) && parseFloat(val) >= 1 && parseFloat(val) <= 40,
        default: '8',
        message: 'Must be a number between 1 and 40',
    },
    RAG_THROTTLE_LOW_WATERMARK_PCT: {
        level: 'WARN',
        validator: val => !isNaN(parseFloat(val)) && parseFloat(val) >= 1 && parseFloat(val) <= 40,
        default: '15',
        message: 'Must be a number between 1 and 40',
    },
    RAG_THROTTLE_LOG_COOLDOWN_MS: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 500,
        default: '4000',
        message: 'Must be an integer >= 500 (milliseconds)',
    },
    OLLAMA_EMBED_MAX_CHARS: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 1000,
        default: '8000',
        message: 'Must be an integer >= 1000',
    },
    OLLAMA_EMBED_CONTEXT_FAST_SHRINK: {
        level: 'WARN',
        validator: val => ['true', 'false'].includes(String(val)),
        default: 'true',
        message: 'Must be true or false',
    },
    RAG_EXPAND_DEFAULT_LINES: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 1,
        default: '40',
        message: 'Must be an integer >= 1',
    },
    RAG_EXPAND_MAX_LINES: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 40,
        default: '240',
        message: 'Must be an integer >= 40',
    },
    RAG_WATCH_ENABLED: {
        level: 'WARN',
        validator: val => ['true', 'false'].includes(String(val)),
        default: 'true',
        message: 'Must be true or false',
    },
    RAG_WATCH_DEBOUNCE_MS: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 250,
        default: '3000',
        message: 'Must be an integer >= 250 (milliseconds)',
    },
    RAG_WATCH_BATCH_MAX: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 1,
        default: '64',
        message: 'Must be an integer >= 1',
    },
    LSP_ENABLED: {
        level: 'WARN',
        validator: val => ['true', 'false'].includes(String(val)),
        default: 'true',
        message: 'Must be true or false',
    },
    LSP_TOOL_TIMEOUT_MS: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) > 0,
        default: '15000',
        message: 'Must be a positive integer (milliseconds)',
    },
    LSP_MUTATIONS_ENABLED: {
        level: 'WARN',
        validator: val => ['true', 'false'].includes(String(val)),
        default: 'false',
        message: 'Must be true or false',
    },
    LSP_MAX_RESULTS: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) > 0,
        default: '200',
        message: 'Must be a positive integer',
    },

    // [4] MCP (Interop)
    MCP_ENABLED: {
        level: 'WARN',
        validator: val => ['true', 'false'].includes(String(val)),
        default: 'true',
        message: 'Must be true or false',
    },
    MCP_UPSTREAM_ENABLED: {
        level: 'WARN',
        validator: val => ['true', 'false'].includes(String(val)),
        default: 'false',
        message: 'Must be true or false',
    },
    MCP_UPSTREAM_URL: {
        level: 'WARN',
        validator: val => typeof val === 'string',
        default: '',
        message: 'Must be a string URL (required when MCP_UPSTREAM_ENABLED=true)',
    },
    MCP_UPSTREAM_ALIAS: {
        level: 'WARN',
        validator: val => typeof val === 'string',
        default: 'upstream',
        message: 'Must be a string',
    },
    MCP_UPSTREAM_TOOL_PREFIX: {
        level: 'WARN',
        validator: val => typeof val === 'string',
        default: '',
        message: 'Must be a string',
    },
    MCP_UPSTREAM_HEADERS_JSON: {
        level: 'WARN',
        validator: val => typeof val === 'string',
        default: '',
        message: 'Must be a JSON string (object) or empty',
    },

    // [5] GitHub MCP (Optional)
    // NOTE: This token is typically consumed by the GitHub MCP server process
    // (stdio) configured in the client. We keep it here for validation and
    // future upstream/bridge modes.
    GITHUB_PERSONAL_ACCESS_TOKEN: {
        level: 'WARN',
        validator: val => {
            const token = String(val || '').trim();
            return token.length === 0 || token.length >= 20;
        },
        default: '',
        message: 'Must be empty or look like a real token (>= 20 chars)',
    },

    // [6] MCP - Advanced Upstreams / GitHub Proxy Preset
    MCP_UPSTREAMS_JSON: {
        level: 'WARN',
        validator: val => {
            const raw = String(val || '').trim();
            if (!raw) return true;
            try {
                return Array.isArray(JSON.parse(raw));
            } catch {
                return false;
            }
        },
        default: '',
        message: 'Must be empty or a valid JSON array string',
    },
    MCP_UPSTREAM_REFRESH: {
        level: 'WARN',
        validator: val => ['true', 'false'].includes(String(val)),
        default: 'false',
        message: 'Must be true or false',
    },
    MCP_UPSTREAM_INIT_TIMEOUT_MS: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 1000,
        default: '30000',
        message: 'Must be an integer >= 1000 (milliseconds)',
    },
    MCP_GITHUB_PROXY_ENABLED: {
        level: 'WARN',
        validator: val => ['true', 'false'].includes(String(val)),
        default: 'false',
        message: 'Must be true or false',
    },
    MCP_GITHUB_TOOL_PREFIX: {
        level: 'WARN',
        validator: val => typeof val === 'string',
        default: 'mcp_github__',
        message: 'Must be a string',
    },
    MCP_GITHUB_COMMAND: {
        level: 'WARN',
        validator: val => typeof val === 'string' && String(val).trim().length > 0,
        default: 'npx',
        message: 'Must be a non-empty string',
    },
    MCP_GITHUB_ARGS_JSON: {
        level: 'WARN',
        validator: val => {
            const raw = String(val || '').trim();
            if (!raw) return true;
            try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) && parsed.every(x => typeof x === 'string');
            } catch {
                return false;
            }
        },
        default: '["-y","@modelcontextprotocol/server-github"]',
        message: 'Must be empty or a valid JSON array of strings',
    },

    // [7] MCP - Upstream restart / retry (best-effort)
    MCP_UPSTREAM_RESTART_ENABLED: {
        level: 'WARN',
        validator: val => ['true', 'false'].includes(String(val)),
        default: 'false',
        message: 'Must be true or false',
    },
    MCP_UPSTREAM_RESTART_BACKOFF_MS: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 100,
        default: '5000',
        message: 'Must be an integer >= 100 (milliseconds)',
    },
    MCP_UPSTREAM_RESTART_MAX: {
        level: 'WARN',
        validator: val => !isNaN(parseInt(val, 10)) && parseInt(val, 10) >= 0,
        default: '10',
        message: 'Must be an integer >= 0 (0 = unlimited retries)',
    },
};

/**
 * Validate environment variables against schema
 *
 * @param {ValidationOptions} options - Validation options
 * @returns {ValidationResult}
 *
 * @example
 * // At process startup
 * validateEnv({ throwOnError: true });
 *
 * // For testing
 * const result = validateEnv({ throwOnError: false });
 * console.log(result.errors);
 */
export function validateEnv(options = {}) {
    const { throwOnError = true, applyDefaults = true, verbose = false } = options;

    const errors = [];
    const warnings = [];
    /** @type {Record<string, string>} */
    const resolvedEnv = {};

    // Validate each ENV variable
    for (const [key, spec] of Object.entries(ENV_SCHEMA)) {
        let value = process.env[key];

        // Check if missing
        if (!value || value.trim() === '') {
            if (applyDefaults && spec.default) {
                value = spec.default;
                process.env[key] = value;

                if (verbose) {
                    log.info(`[ENV Validator] Applied default for ${key}: ${value}`);
                }
            } else {
                const error = {
                    key,
                    level: spec.level,
                    message: `Missing required ENV variable: ${key}`,
                };

                if (spec.level === 'WARN') {
                    warnings.push(error);
                } else {
                    errors.push(error);
                }

                continue;
            }
        }

        // Validate value
        if (spec.validator && !spec.validator(value)) {
            const error = {
                key,
                level: spec.level,
                message: `Invalid value for ${key}: "${value}". ${spec.message}`,
            };

            if (spec.level === 'WARN') {
                warnings.push(error);
            } else {
                errors.push(error);
            }

            // Apply default if validation fails and defaults enabled
            if (applyDefaults && spec.default) {
                value = spec.default;
                process.env[key] = value;

                if (verbose) {
                    log.info(`[ENV Validator] Applied default after validation failure for ${key}: ${value}`);
                }
            }
        }

        resolvedEnv[key] = value;
    }

    // Additional cross-variable validations (timeout cascade)
    const ollamaTimeout = parseInt(resolvedEnv.OLLAMA_GENERATE_TIMEOUT || '60000', 10);
    const toolTimeout = parseInt(resolvedEnv.TOOL_EXECUTION_TIMEOUT || '75000', 10);
    const mcpTimeout = parseInt(resolvedEnv.MCP_TOOL_TIMEOUT || '90000', 10);
    const serverTimeout = parseInt(resolvedEnv.SERVER_REQUEST_TIMEOUT || '120000', 10);

    if (toolTimeout <= ollamaTimeout) {
        warnings.push({
            key: 'TOOL_EXECUTION_TIMEOUT',
            level: 'WARN',
            message: `TOOL_EXECUTION_TIMEOUT (${toolTimeout}ms) should be > OLLAMA_GENERATE_TIMEOUT (${ollamaTimeout}ms) for proper timeout cascade`,
        });
    }

    if (mcpTimeout <= toolTimeout) {
        warnings.push({
            key: 'MCP_TOOL_TIMEOUT',
            level: 'WARN',
            message: `MCP_TOOL_TIMEOUT (${mcpTimeout}ms) should be > TOOL_EXECUTION_TIMEOUT (${toolTimeout}ms) for proper timeout cascade`,
        });
    }

    if (serverTimeout <= mcpTimeout) {
        warnings.push({
            key: 'SERVER_REQUEST_TIMEOUT',
            level: 'WARN',
            message: `SERVER_REQUEST_TIMEOUT (${serverTimeout}ms) should be > MCP_TOOL_TIMEOUT (${mcpTimeout}ms) for proper timeout cascade`,
        });
    }

    // Ollama non-embedding routing policy validation
    const cloudEnabled = String(resolvedEnv.OLLAMA_CLOUD_ENABLED || 'true') === 'true';
    const nonEmbeddingRuntime = String(resolvedEnv.OLLAMA_NON_EMBEDDING_RUNTIME || 'auto');
    const localFallbackEnabled = String(resolvedEnv.OLLAMA_NON_EMBEDDING_LOCAL_FALLBACK || 'true') === 'true';
    const localModelProfile = String(resolvedEnv.OLLAMA_LOCAL_MODEL_PROFILE || 'light');
    const localAllowedModelsRaw = String(resolvedEnv.OLLAMA_LOCAL_ALLOWED_MODELS || '').trim();

    if (nonEmbeddingRuntime === 'cloud' && !cloudEnabled && !localFallbackEnabled) {
        errors.push({
            key: 'OLLAMA_NON_EMBEDDING_RUNTIME',
            level: 'ERROR',
            message:
                'OLLAMA_NON_EMBEDDING_RUNTIME=cloud is invalid when OLLAMA_CLOUD_ENABLED=false and ' +
                'OLLAMA_NON_EMBEDDING_LOCAL_FALLBACK=false',
        });
    }

    if (nonEmbeddingRuntime === 'auto' && !cloudEnabled && !localFallbackEnabled) {
        errors.push({
            key: 'OLLAMA_NON_EMBEDDING_LOCAL_FALLBACK',
            level: 'ERROR',
            message:
                'Cloud-first auto mode requires at least one backend: enable OLLAMA_CLOUD_ENABLED ' +
                'or OLLAMA_NON_EMBEDDING_LOCAL_FALLBACK',
        });
    }

    if (localModelProfile === 'custom' && !localAllowedModelsRaw) {
        warnings.push({
            key: 'OLLAMA_LOCAL_ALLOWED_MODELS',
            level: 'WARN',
            message: 'OLLAMA_LOCAL_MODEL_PROFILE=custom without OLLAMA_LOCAL_ALLOWED_MODELS will allow any local model',
        });
    }

    // LSP policy validation
    const lspEnabled = String(resolvedEnv.LSP_ENABLED || 'true') === 'true';
    const lspMutationsEnabled = String(resolvedEnv.LSP_MUTATIONS_ENABLED || 'false') === 'true';
    if (!lspEnabled && lspMutationsEnabled) {
        warnings.push({
            key: 'LSP_MUTATIONS_ENABLED',
            level: 'WARN',
            message: 'LSP_MUTATIONS_ENABLED=true has no effect when LSP_ENABLED=false',
        });
    }

    // Upstream MCP dependency validation
    const upstreamsJson = String(resolvedEnv.MCP_UPSTREAMS_JSON || '').trim();

    if (!upstreamsJson && resolvedEnv.MCP_UPSTREAM_ENABLED === 'true') {
        const url = String(resolvedEnv.MCP_UPSTREAM_URL || '').trim();
        if (!url) {
            errors.push({
                key: 'MCP_UPSTREAM_URL',
                level: 'ERROR',
                message: 'MCP_UPSTREAM_ENABLED=true but MCP_UPSTREAM_URL is missing',
            });
        }
    }

    // GitHub proxy preset validation
    if (resolvedEnv.MCP_GITHUB_PROXY_ENABLED === 'true') {
        const token = String(resolvedEnv.GITHUB_PERSONAL_ACCESS_TOKEN || '').trim();
        if (!token) {
            warnings.push({
                key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
                level: 'WARN',
                message:
                    'MCP_GITHUB_PROXY_ENABLED=true but GITHUB_PERSONAL_ACCESS_TOKEN is missing (GitHub upstream will be not-ready)',
            });
        }
    }

    // Log results
    const hasErrors = errors.length > 0;
    const hasWarnings = warnings.length > 0;

    if (hasErrors) {
        log.error('\n❌ ENV Validation FAILED:\n');
        for (const error of errors) {
            log.error(`  [${error.level}] ${error.message}`);
        }
        log.error('');
    }

    if (hasWarnings) {
        log.warn('\n⚠️  ENV Validation WARNINGS:\n');
        for (const warning of warnings) {
            log.warn(`  [${warning.level}] ${warning.message}`);
        }
        log.warn('');
    }

    if (!hasErrors && !hasWarnings) {
        if (verbose) {
            log.info('✅ ENV Validation PASSED (all variables valid)\n');
        }
    }

    // Throw if configured and has fatal/error level issues
    if (throwOnError && hasErrors) {
        const fatalErrors = errors.filter(e => e.level === 'FATAL' || e.level === 'ERROR');
        if (fatalErrors.length > 0) {
            throw new Error(
                `ENV validation failed with ${fatalErrors.length} critical error(s). ` +
                    `Fix the issues above and restart the process.`
            );
        }
    }

    return {
        valid: !hasErrors,
        errors,
        warnings,
        env: resolvedEnv,
    };
}

/**
 * Get ENV variable with validation and default
 *
 * @param {string} key - ENV variable name
 * @returns {string|undefined} - ENV value or undefined if not in schema
 *
 * @example
 * const port = getEnv('SERVER_PORT'); // Returns validated value or default
 */
export function getEnv(key) {
    const spec = ENV_SCHEMA[key];
    if (!spec) {
        return process.env[key];
    }

    let value = process.env[key];

    if (!value && spec.default) {
        value = spec.default;
    }

    return value;
}

/**
 * Check if ENV variable is set and valid
 *
 * @param {string} key - ENV variable name
 * @returns {boolean}
 *
 * @example
 * if (hasEnv('DASHBOARD_PASSWORD')) {
 *   // Password-protect dashboard
 * }
 */
export function hasEnv(key) {
    const value = process.env[key];
    if (!value || value.trim() === '') {
        return false;
    }

    const spec = ENV_SCHEMA[key];
    if (spec && spec.validator) {
        return spec.validator(value);
    }

    return true;
}

export { ENV_SCHEMA };
