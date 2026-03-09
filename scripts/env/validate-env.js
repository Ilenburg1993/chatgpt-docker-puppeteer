#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';

if (process.env.FORCE_COLOR && process.env.NO_COLOR) {
    delete process.env.NO_COLOR;
}

// ============================================================================
// Configuração
// ============================================================================
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCHEMA_PATH = path.join(ROOT, '.env.schema.json');
const DEFAULT_ENV_FILES = ['.env.development', '.env.production', '.env.test'];

// Cores para output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
};

// ============================================================================
// Parser de .env
// ============================================================================
/**
 * Função exportada: parseEnvFile.
 *
 * @param {any} filePath
 * @returns {Record<string, string>}
 */
function parseEnvFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const env = /** @type {Record<string, string>} */ ({});

    content.split('\n').forEach((line, _) => {
        // Ignorar comentários e linhas vazias
        if (!line.trim() || line.trim().startsWith('#')) return;

        const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (match) {
            const [, key = '', value = ''] = match;
            env[key] = value.trim();
        }
    });

    return env;
}

// ============================================================================
// Validador
// ============================================================================
/** Classe exportada: EnvValidator. */
class EnvValidator {
    /**
     * @param {string} schemaPath - Caminho para o schema JSON
     */
    constructor(schemaPath) {
        this.schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
        /** @type {string[]} */
        this.errors = [];
        /** @type {string[]} */
        this.warnings = [];
        /** @type {string[]} */
        this.info = [];
    }

    /**
     * @param {Record<string, string>} envData
     * @param {string} [envName]
     * @returns {boolean}
     */
    validate(envData, envName = 'unknown') {
        this.errors = [];
        this.warnings = [];
        this.info = [];

        console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
        console.log(`${colors.cyan}Validando: ${envName}${colors.reset}`);
        console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);

        // Validar variáveis STRUCTURAL
        this.validateCategory('STRUCTURAL', envData);

        // Validar variáveis INFRASTRUCTURE (estratificado por NODE_ENV)
        this.validateCategory('INFRASTRUCTURE', envData);

        // Validar variáveis OPERATIONAL
        this.validateCategory('OPERATIONAL', envData);

        // Validar variáveis TUNING
        this.validateCategory('TUNING', envData);

        // Validar variáveis FEATURE_FLAGS
        this.validateCategory('FEATURE_FLAGS', envData);

        // Validar constraints
        this.validateConstraints(envData);

        // Report unrecognised keys (extras that exist in the file but are not defined in the schema).
        const schemaKeys = Object.values(this.schema.categories).flatMap((c) =>
            c.properties ? Object.keys(c.properties) : [],
        );
        const extras = Object.keys(envData).filter((k) => !schemaKeys.includes(k));
        if (extras.length) {
            const list = extras.join(', ');
            this.warnings.push(`Extras not in schema: ${list}`);
            console.log(`${colors.yellow}⚠${colors.reset} Extras não definidos no schema: ${list}`);
        }

        // Report
        this.report();

        return this.errors.length === 0;
    }

    /**
     * @param {string} categoryName
     * @param {Record<string, string>} envData
     * @returns {void}
     */
    validateCategory(categoryName, envData) {
        const category = this.schema.categories[categoryName];
        if (!category) return;

        console.log(`\n${colors.gray}[${categoryName}]${colors.reset}`);

        Object.entries(category.properties).forEach(([varName, spec]) => {
            const value = envData[varName];

            // Required check
            if (spec.required && !value) {
                if (category.criticality === 'FATAL') {
                    this.errors.push(`${categoryName}: ${varName} ausente (OBRIGATÓRIO)`);
                } else if (category.criticality === 'FATAL_IF_PRODUCTION') {
                    if (envData.NODE_ENV === 'production') {
                        this.errors.push(`${categoryName}: ${varName} ausente (OBRIGATÓRIO em production)`);
                    } else {
                        this.warnings.push(`${categoryName}: ${varName} ausente (WARNING em ${envData.NODE_ENV})`);
                    }
                } else {
                    this.warnings.push(`${categoryName}: ${varName} ausente`);
                }
                console.log(`  ${colors.red}✗${colors.reset} ${varName} = ${colors.gray}<UNSET>${colors.reset}`);
                return;
            }

            if (!value) {
                return;
            }

            // Type validation
            this.validateType(varName, value, spec, categoryName);

            console.log(`  ${colors.green}✓${colors.reset} ${varName} = ${value}`);
        });
    }

    /**
     * @param {string} varName
     * @param {string} value
     * @param {Record<string, unknown>} spec
     * @param {string} categoryName
     * @returns {void}
     */
    validateType(varName, value, spec, categoryName) {
        if (spec.type === 'integer') {
            const num = parseInt(value, 10);
            if (isNaN(num)) {
                this.errors.push(`${categoryName}: ${varName} deve ser inteiro (recebido: ${value})`);
                return;
            }

            if (spec.minimum !== undefined && num < /** @type {number} */ (spec.minimum)) {
                this.errors.push(`${categoryName}: ${varName} < ${spec.minimum} (recebido: ${num})`);
            }

            if (spec.maximum !== undefined && num > /** @type {number} */ (spec.maximum)) {
                this.errors.push(`${categoryName}: ${varName} > ${spec.maximum} (recebido: ${num})`);
            }

            if (spec.enum && !(/** @type {number[]} */ (spec.enum).includes(num))) {
                this.errors.push(
                    `${categoryName}: ${varName} deve ser um de [${/** @type {number[]} */ (spec.enum).join(', ')}] (recebido: ${num})`,
                );
            }
        }

        if (spec.type === 'number') {
            const num = Number(value);
            if (isNaN(num)) {
                this.errors.push(`${categoryName}: ${varName} deve ser número (recebido: ${value})`);
                return;
            }

            if (spec.minimum !== undefined && num < /** @type {number} */ (spec.minimum)) {
                this.errors.push(`${categoryName}: ${varName} < ${spec.minimum} (recebido: ${num})`);
            }

            if (spec.maximum !== undefined && num > /** @type {number} */ (spec.maximum)) {
                this.errors.push(`${categoryName}: ${varName} > ${spec.maximum} (recebido: ${num})`);
            }
        }

        if (spec.type === 'string') {
            if (spec.enum && !(/** @type {string[]} */ (spec.enum).includes(value))) {
                this.errors.push(
                    `${categoryName}: ${varName} deve ser um de [${/** @type {string[]} */ (spec.enum).join(', ')}] (recebido: ${value})`,
                );
            }

            if (spec.pattern) {
                const regex = new RegExp(/** @type {string} */ (spec.pattern));
                if (!regex.test(value)) {
                    this.errors.push(
                        `${categoryName}: ${varName} não corresponde ao padrão ${spec.pattern} (recebido: ${value})`,
                    );
                }
            }
        }

        if (spec.type === 'boolean') {
            const validBooleans = ['true', 'false', '1', '0', 'yes', 'no'];
            if (!validBooleans.includes(value.toLowerCase())) {
                this.errors.push(`${categoryName}: ${varName} deve ser boolean (recebido: ${value})`);
            }
        }
    }

    /**
     * @param {Record<string, string>} envData
     * @returns {void}
     */
    validateConstraints(envData) {
        console.log(`\n${colors.gray}[CONSTRAINTS]${colors.reset}`);

        // Unique ports
        const ports = ['SERVER_PORT', 'CHROME_PORT', 'CHROME_PROXY_PORT'].map((p) => envData[p]).filter((p) => p);

        const uniquePorts = new Set(ports);
        if (ports.length !== uniquePorts.size) {
            this.errors.push('CONSTRAINT: Portas devem ser únicas (SERVER_PORT, CHROME_PORT, CHROME_PROXY_PORT)');
            console.log(`  ${colors.red}✗${colors.reset} Portas únicas: FALHOU`);
        } else {
            console.log(`  ${colors.green}✓${colors.reset} Portas únicas: OK`);
        }

        // BROWSER_MODE=wsEndpoint → requires CHROME_*
        if (envData.BROWSER_MODE === 'wsEndpoint') {
            const required = ['CHROME_PROXY_PORT', 'CHROME_PORT', 'CHROME_HOST'];
            const missing = required.filter((v) => !envData[v]);

            if (missing.length > 0) {
                this.errors.push(`CONSTRAINT: BROWSER_MODE=wsEndpoint requer ${missing.join(', ')}`);
                console.log(
                    `  ${colors.red}✗${colors.reset} BROWSER_MODE dependencies: FALHOU (falta: ${missing.join(', ')})`,
                );
            } else {
                console.log(`  ${colors.green}✓${colors.reset} BROWSER_MODE dependencies: OK`);
            }
        }

        // NODE_ENV=production constraints
        if (envData.NODE_ENV === 'production') {
            if (envData.ALLOW_DEGRADED_MODE === 'true') {
                this.errors.push('CONSTRAINT: ALLOW_DEGRADED_MODE=true não permitido em production');
                console.log(`  ${colors.red}✗${colors.reset} Production constraints: ALLOW_DEGRADED_MODE inválido`);
            }

            if (envData.MOCK_CHROME === '1') {
                this.errors.push('CONSTRAINT: MOCK_CHROME=1 não permitido em production');
                console.log(`  ${colors.red}✗${colors.reset} Production constraints: MOCK_CHROME inválido`);
            }

            if (envData.LOG_LEVEL === 'debug') {
                this.warnings.push('CONSTRAINT: LOG_LEVEL=debug não recomendado em production');
                console.log(`  ${colors.yellow}!${colors.reset} Production constraints: LOG_LEVEL=debug (warning)`);
            }
        }

        // MCP_UPSTREAM_ENABLED=true → requires MCP_UPSTREAM_URL (legacy single-upstream mode only)
        // If MCP_UPSTREAMS_JSON is set, the legacy URL is not required.
        if (String(envData.MCP_UPSTREAM_ENABLED || '').toLowerCase() === 'true') {
            const upstreamsJson = String(envData.MCP_UPSTREAMS_JSON || '').trim();
            const legacyRequired = !upstreamsJson;

            if (legacyRequired && !String(envData.MCP_UPSTREAM_URL || '').trim()) {
                this.errors.push(
                    'CONSTRAINT: MCP_UPSTREAM_ENABLED=true requer MCP_UPSTREAM_URL (quando MCP_UPSTREAMS_JSON está vazio)',
                );
                console.log(`  ${colors.red}✗${colors.reset} MCP upstream (legacy): FALHOU (falta: MCP_UPSTREAM_URL)`);
            } else {
                console.log(`  ${colors.green}✓${colors.reset} MCP upstream: OK`);
            }
        }

        // MCP_GITHUB_PROXY_ENABLED=true → recommends/needs GITHUB_PERSONAL_ACCESS_TOKEN
        // This is a best-effort readiness requirement: missing token should not block process boot.
        if (String(envData.MCP_GITHUB_PROXY_ENABLED || '').toLowerCase() === 'true') {
            const token = String(envData.GITHUB_PERSONAL_ACCESS_TOKEN || '').trim();
            if (!token) {
                this.warnings.push(
                    'CONSTRAINT: MCP_GITHUB_PROXY_ENABLED=true mas GITHUB_PERSONAL_ACCESS_TOKEN está vazio (upstream GitHub ficará not-ready)',
                );
                console.log(`  ${colors.yellow}!${colors.reset} GitHub proxy: WARNING (token ausente)`);
            } else {
                console.log(`  ${colors.green}✓${colors.reset} GitHub proxy: OK`);
            }
        }
    }

    report() {
        console.log(`\n${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
        console.log(`${colors.cyan}RESULTADO${colors.reset}`);
        console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);

        if (this.errors.length > 0) {
            console.log(`\n${colors.red}ERROS (${this.errors.length}):${colors.reset}`);
            this.errors.forEach((err) => console.log(`  ${colors.red}✗${colors.reset} ${err}`));
        }

        if (this.warnings.length > 0) {
            console.log(`\n${colors.yellow}AVISOS (${this.warnings.length}):${colors.reset}`);
            this.warnings.forEach((warn) => console.log(`  ${colors.yellow}!${colors.reset} ${warn}`));
        }

        if (this.errors.length === 0) {
            console.log(`\n${colors.green}✓ Validação concluída com sucesso!${colors.reset}`);
        } else {
            console.log(`\n${colors.red}✗ Validação falhou (${this.errors.length} erro[s])${colors.reset}`);
        }

        console.log('');
    }
}

// ============================================================================
// Main
// ============================================================================
function main() {
    const args = process.argv.slice(2);
    let envFiles = [];

    if (args.includes('--all')) {
        envFiles = DEFAULT_ENV_FILES;
    } else {
        const fileIndex = args.indexOf('--file');
        if (fileIndex !== -1 && args[fileIndex + 1]) {
            envFiles = [args[fileIndex + 1] ?? ''];
        } else {
            envFiles = DEFAULT_ENV_FILES;
        }
    }

    // Verificar se schema existe
    if (!fs.existsSync(SCHEMA_PATH)) {
        console.error(`${colors.red}ERRO: Schema não encontrado: ${SCHEMA_PATH}${colors.reset}`);
        process.exit(1);
    }

    const validator = new EnvValidator(SCHEMA_PATH);
    let totalErrors = 0;

    envFiles.forEach((envFile) => {
        const filePath = path.join(ROOT, envFile);

        if (!fs.existsSync(filePath)) {
            console.warn(`${colors.yellow}AVISO: Arquivo não encontrado: ${envFile}${colors.reset}\n`);
            return;
        }

        try {
            const envData = parseEnvFile(filePath);
            const isValid = validator.validate(envData, envFile);

            if (!isValid) {
                totalErrors++;
            }
        } catch (error) {
            console.error(
                `${colors.red}ERRO ao processar ${envFile}: ${error instanceof Error ? error.message : String(error)}${colors.reset}\n`,
            );
            totalErrors++;
        }
    });

    // Exit code
    process.exit(totalErrors > 0 ? 1 : 0);
}

if (import.meta.filename === process.argv[1]) {
    main();
}

export { EnvValidator, parseEnvFile };
