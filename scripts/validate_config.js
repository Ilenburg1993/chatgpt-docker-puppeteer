#!/usr/bin/env node
/* ==========================================================================
   scripts/validate_config.js
   Configuration Validation Script

   Validates all configuration files and environment variables
   Exit code 0 = valid, 1 = invalid
========================================================================== */

const fs = require('fs');
const path = require('path');

const CONFIG_FILES = {
    'config.json': {
        required: true,
        schema: {
            BROWSER_MODE: ['launcher', 'remote'],
            CYCLE_DELAY: { type: 'number', min: 100 },
            allowedDomains: { type: 'array' }
        }
    },
    'dynamic_rules.json': {
        required: true,
        schema: {
            _meta: { type: 'object' },
            targets: { type: 'object' }
        }
    },
    '.env': {
        required: false,
        warning: 'Recommended for production'
    },
    'package.json': {
        required: true,
        schema: {
            name: { type: 'string' },
            version: { type: 'string' },
            main: { type: 'string' }
        }
    }
};

const REQUIRED_ENV_VARS = {
    production: ['NODE_ENV', 'PORT', 'CHROME_WS_ENDPOINT'],
    development: ['NODE_ENV']
};

class ConfigValidator {
    constructor() {
        this.errors = [];
        this.warnings = [];
    }

    log(level, message) {
        const prefix = {
            ERROR: '\x1b[31m[ERROR]\x1b[0m',
            WARN: '\x1b[33m[WARN]\x1b[0m',
            INFO: '\x1b[32m[INFO]\x1b[0m'
        };
        console.log(`${prefix[level]} ${message}`);
    }

    validateFileExists(filepath) {
        if (!fs.existsSync(filepath)) {
            this.errors.push(`Missing required file: ${filepath}`);
            return false;
        }
        return true;
    }

    validateJSON(filepath) {
        try {
            const content = fs.readFileSync(filepath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            this.errors.push(`Invalid JSON in ${filepath}: ${error.message}`);
            return null;
        }
    }

    validateConfigFile(filename, spec) {
        const filepath = path.join(process.cwd(), filename);

        if (!this.validateFileExists(filepath)) {
            if (spec.required) {
                return false;
            }
            this.warnings.push(spec.warning || `Optional file missing: ${filename}`);
            return true;
        }

        // For .env files, just check existence
        if (filename === '.env') {
            this.log('INFO', `✓ ${filename} exists`);
            return true;
        }

        // Validate JSON files
        const data = this.validateJSON(filepath);
        if (!data) {
            return false;
        }

        // Validate schema if specified
        if (spec.schema) {
            for (const [key, constraint] of Object.entries(spec.schema)) {
                if (!(key in data)) {
                    this.errors.push(`Missing key "${key}" in ${filename}`);
                    continue;
                }

                if (Array.isArray(constraint)) {
                    // Enum validation
                    if (!constraint.includes(data[key])) {
                        this.errors.push(
                            `Invalid value for "${key}" in ${filename}. Expected one of: ${constraint.join(', ')}`
                        );
                    }
                } else if (typeof constraint === 'object') {
                    // Type validation
                    if (constraint.type === 'number') {
                        if (typeof data[key] !== 'number') {
                            this.errors.push(`"${key}" in ${filename} must be a number`);
                        } else if (constraint.min !== undefined && data[key] < constraint.min) {
                            this.errors.push(`"${key}" in ${filename} must be >= ${constraint.min}`);
                        }
                    } else if (constraint.type === 'array') {
                        if (!Array.isArray(data[key])) {
                            this.errors.push(`"${key}" in ${filename} must be an array`);
                        }
                    } else if (constraint.type === 'object') {
                        if (typeof data[key] !== 'object' || data[key] === null) {
                            this.errors.push(`"${key}" in ${filename} must be an object`);
                        }
                    } else if (constraint.type === 'string') {
                        if (typeof data[key] !== 'string') {
                            this.errors.push(`"${key}" in ${filename} must be a string`);
                        }
                    }
                }
            }
        }

        this.log('INFO', `✓ ${filename} is valid`);
        return true;
    }

    validateEnvironment() {
        const env = process.env.NODE_ENV || 'development';
        const required = REQUIRED_ENV_VARS[env] || [];

        this.log('INFO', `Validating environment variables for: ${env}`);

        for (const varName of required) {
            if (!process.env[varName]) {
                this.errors.push(`Missing required environment variable: ${varName}`);
            } else {
                this.log('INFO', `✓ ${varName} = ${process.env[varName]}`);
            }
        }

        // Validate PORT is a number
        if (process.env.PORT && isNaN(parseInt(process.env.PORT))) {
            this.errors.push('PORT must be a valid number');
        }

        // Validate CHROME_WS_ENDPOINT format
        if (process.env.CHROME_WS_ENDPOINT) {
            if (
                !process.env.CHROME_WS_ENDPOINT.startsWith('ws://') &&
                !process.env.CHROME_WS_ENDPOINT.startsWith('wss://')
            ) {
                this.errors.push('CHROME_WS_ENDPOINT must start with ws:// or wss://');
            }
        }
    }

    validateDirectories() {
        const dirs = ['fila', 'respostas', 'logs', 'profile'];

        for (const dir of dirs) {
            const dirPath = path.join(process.cwd(), dir);
            if (!fs.existsSync(dirPath)) {
                this.warnings.push(`Directory "${dir}" does not exist (will be created on startup)`);
            } else {
                // Check if writable
                try {
                    const testFile = path.join(dirPath, '.write-test');
                    fs.writeFileSync(testFile, 'test');
                    fs.unlinkSync(testFile);
                    this.log('INFO', `✓ ${dir}/ is writable`);
                } catch (error) {
                    this.errors.push(`Directory "${dir}" is not writable: ${error.message}`);
                }
            }
        }
    }

    validateEntryPoint() {
        const entryPoint = 'index.js';
        if (!this.validateFileExists(entryPoint)) {
            this.errors.push(`Entry point ${entryPoint} does not exist`);
            return;
        }

        // Check if it's a valid Node.js file
        try {
            const content = fs.readFileSync(entryPoint, 'utf8');
            if (!content.includes('require')) {
                this.warnings.push(`${entryPoint} may not be a valid Node.js script`);
            }
            this.log('INFO', `✓ ${entryPoint} exists and looks valid`);
        } catch (error) {
            this.errors.push(`Cannot read ${entryPoint}: ${error.message}`);
        }
    }

    async run() {
        console.log('\n🔍 Configuration Validation\n');
        console.log(`${'='.repeat(60)}\n`);

        // Validate config files
        for (const [filename, spec] of Object.entries(CONFIG_FILES)) {
            this.validateConfigFile(filename, spec);
        }

        // Validate environment variables
        this.validateEnvironment();

        // Validate directories
        this.validateDirectories();

        // Validate entry point
        this.validateEntryPoint();

        // Report results
        console.log(`\n${'='.repeat(60)}`);
        console.log('\n📊 Validation Results\n');

        if (this.warnings.length > 0) {
            console.log('⚠️  Warnings:');
            this.warnings.forEach(w => this.log('WARN', w));
            console.log('');
        }

        if (this.errors.length > 0) {
            console.log('❌ Errors:');
            this.errors.forEach(e => this.log('ERROR', e));
            console.log('');
            console.log(`\x1b[31m✗ Validation failed with ${this.errors.length} error(s)\x1b[0m\n`);
            process.exit(1);
        } else {
            console.log(`\x1b[32m✓ Configuration is valid!\x1b[0m\n`);

            if (this.warnings.length > 0) {
                console.log(`Note: ${this.warnings.length} warning(s) - review recommended but not critical\n`);
            }

            process.exit(0);
        }
    }
}

// Run validation
if (require.main === module) {
    const validator = new ConfigValidator();
    validator.run().catch(error => {
        console.error('Fatal error during validation:', error);
        process.exit(1);
    });
}

module.exports = ConfigValidator;
