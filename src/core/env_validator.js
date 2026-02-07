// @ts-check - Type checking rigoroso habilitado (arquivo core)

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
        validator: (val) => ['development', 'production', 'test'].includes(val),
        default: 'development',
        message: 'Must be one of: development, production, test'
    },
    SERVER_MODE: {
        level: 'FATAL',
        validator: (val) => ['split', 'integrated'].includes(val),
        default: 'split',
        message: 'Must be one of: split, integrated'
    },
    SERVER_AUTHORITY: {
        level: 'FATAL',
        validator: (val) => ['standalone', 'delegated'].includes(val),
        default: 'standalone',
        message: 'Must be one of: standalone, delegated'
    },
    BROWSER_MODE: {
        level: 'FATAL',
        validator: (val) => ['wsEndpoint', 'connect', 'launcher', 'auto'].includes(val),
        default: 'wsEndpoint',
        message: 'Must be one of: wsEndpoint, connect, launcher, auto'
    },

    // [2] INFRASTRUCTURE VARIABLES (Connectivity)
    SERVER_PORT: {
        level: 'ERROR',
        validator: (val) => !isNaN(parseInt(val, 10)) && parseInt(val, 10) > 0 && parseInt(val, 10) < 65536,
        default: '3008',
        message: 'Must be a valid port number (1-65535)'
    },
    CHROME_PROXY_PORT: {
        level: 'ERROR',
        validator: (val) => !isNaN(parseInt(val, 10)) && parseInt(val, 10) > 0 && parseInt(val, 10) < 65536,
        default: '9224',
        message: 'Must be a valid port number (1-65535)'
    },
    CHROME_PORT: {
        level: 'ERROR',
        validator: (val) => !isNaN(parseInt(val, 10)) && parseInt(val, 10) > 0 && parseInt(val, 10) < 65536,
        default: '9225',
        message: 'Must be a valid port number (1-65535)'
    },
    CHROME_HOST: {
        level: 'ERROR',
        validator: (val) => val && val.length > 0,
        default: 'host.docker.internal',
        message: 'Cannot be empty'
    },

    // [3] TIMEOUTS (Cascade validation)
    OLLAMA_GENERATE_TIMEOUT: {
        level: 'WARN',
        validator: (val) => !isNaN(parseInt(val, 10)) && parseInt(val, 10) > 0,
        default: '60000',
        message: 'Must be a positive number (milliseconds)'
    },
    TOOL_EXECUTION_TIMEOUT: {
        level: 'WARN',
        validator: (val) => !isNaN(parseInt(val, 10)) && parseInt(val, 10) > 0,
        default: '75000',
        message: 'Must be a positive number (milliseconds)'
    },
    MCP_TOOL_TIMEOUT: {
        level: 'WARN',
        validator: (val) => !isNaN(parseInt(val, 10)) && parseInt(val, 10) > 0,
        default: '90000',
        message: 'Must be a positive number (milliseconds)'
    },
    SERVER_REQUEST_TIMEOUT: {
        level: 'WARN',
        validator: (val) => !isNaN(parseInt(val, 10)) && parseInt(val, 10) > 0,
        default: '120000',
        message: 'Must be a positive number (milliseconds)'
    }
};

/**
 * Validation result
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether all validations passed
 * @property {Array<{key: string, level: string, message: string}>} errors - List of validation errors
 * @property {Array<{key: string, level: string, message: string}>} warnings - List of validation warnings
 * @property {Object} env - Resolved ENV values (with defaults applied)
 */

/**
 * Validate environment variables against schema
 *
 * @param {Object} options - Validation options
 * @param {boolean} options.throwOnError - Throw error if FATAL or ERROR level validation fails (default: true)
 * @param {boolean} options.applyDefaults - Apply default values for missing vars (default: true)
 * @param {boolean} options.verbose - Log all validation results (default: false)
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
    const {
        throwOnError = true,
        applyDefaults = true,
        verbose = false
    } = options;

    const errors = [];
    const warnings = [];
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
                    console.log(`[ENV Validator] Applied default for ${key}: ${value}`);
                }
            } else {
                const error = {
                    key,
                    level: spec.level,
                    message: `Missing required ENV variable: ${key}`
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
                message: `Invalid value for ${key}: "${value}". ${spec.message}`
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
                    console.log(`[ENV Validator] Applied default after validation failure for ${key}: ${value}`);
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
            message: `TOOL_EXECUTION_TIMEOUT (${toolTimeout}ms) should be > OLLAMA_GENERATE_TIMEOUT (${ollamaTimeout}ms) for proper timeout cascade`
        });
    }

    if (mcpTimeout <= toolTimeout) {
        warnings.push({
            key: 'MCP_TOOL_TIMEOUT',
            level: 'WARN',
            message: `MCP_TOOL_TIMEOUT (${mcpTimeout}ms) should be > TOOL_EXECUTION_TIMEOUT (${toolTimeout}ms) for proper timeout cascade`
        });
    }

    if (serverTimeout <= mcpTimeout) {
        warnings.push({
            key: 'SERVER_REQUEST_TIMEOUT',
            level: 'WARN',
            message: `SERVER_REQUEST_TIMEOUT (${serverTimeout}ms) should be > MCP_TOOL_TIMEOUT (${mcpTimeout}ms) for proper timeout cascade`
        });
    }

    // Log results
    const hasErrors = errors.length > 0;
    const hasWarnings = warnings.length > 0;

    if (hasErrors) {
        console.error('\n❌ ENV Validation FAILED:\n');
        for (const error of errors) {
            console.error(`  [${error.level}] ${error.message}`);
        }
        console.error('');
    }

    if (hasWarnings) {
        console.warn('\n⚠️  ENV Validation WARNINGS:\n');
        for (const warning of warnings) {
            console.warn(`  [${warning.level}] ${warning.message}`);
        }
        console.warn('');
    }

    if (!hasErrors && !hasWarnings) {
        if (verbose) {
            console.log('✅ ENV Validation PASSED (all variables valid)\n');
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
        env: resolvedEnv
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
