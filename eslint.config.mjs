/* ==========================================================================
   eslint.config.mjs
   ESLint Flat Config v9 - Configuração Profissional

   Regras adaptadas para:
   - Node.js 20+ com CommonJS
   - Arquitetura domain-driven
   - Zero-coupling via NERV
   - Código auditável (Audit Levels)
========================================================================== */

import js from '@eslint/js';
import globals from 'globals';
import json from '@eslint/json';
import markdown from '@eslint/markdown';
import css from '@eslint/css';

export default [
    // ===== GLOBAL IGNORES =====
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/coverage/**',
            '**/logs/**',
            '**/fila/**',
            '**/respostas/**',
            '**/profile/**',
            '**/tmp/**',
            '**/.tmp.*/**',
            '**/crash_reports/**',
            '**/*.min.js',
            'public/js/libs/**',
            'tools/outputs/**'
        ]
    },

    // ===== JAVASCRIPT FILES (Node.js + Browser) =====
    {
        files: ['**/*.{js,mjs,cjs}'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.es2024,
                // Browser globals para testes Puppeteer
                ...globals.browser
            }
        },
        rules: {
            // ===== RECOMMENDED BASE =====
            ...js.configs.recommended.rules,

            // ===== ERROR PREVENTION =====
            'no-console': 'off', // Logger customizado usado
            'no-debugger': 'warn',
            'no-alert': 'error',
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            'no-proto': 'error',
            'no-script-url': 'error',
            'no-return-await': 'error',
            'no-await-in-loop': 'warn',
            'require-atomic-updates': 'warn',

            // ===== ASYNC/AWAIT BEST PRACTICES =====
            'no-async-promise-executor': 'error',
            'no-promise-executor-return': 'error',
            'prefer-promise-reject-errors': 'error',

            // ===== VARIÁVEIS E ESCOPO =====
            'no-unused-vars': ['warn', {
                'argsIgnorePattern': '^_',
                'varsIgnorePattern': '^_',
                'caughtErrorsIgnorePattern': '^_'
            }],
            'no-use-before-define': ['error', { 'functions': false, 'classes': true }],
            'no-shadow': ['warn', { 'builtinGlobals': false, 'hoist': 'functions' }],
            'no-undef': 'error',
            'no-undefined': 'off',
            'no-var': 'warn',
            'prefer-const': ['warn', { 'destructuring': 'all' }],

            // ===== CÓDIGO LIMPO =====
            'eqeqeq': ['error', 'always', { 'null': 'ignore' }],
            'curly': ['warn', 'all'],
            'no-else-return': 'warn',
            'no-lonely-if': 'warn',
            'no-unneeded-ternary': 'warn',
            'no-nested-ternary': 'warn',
            'prefer-template': 'warn',
            'prefer-arrow-callback': 'warn',

            // ===== COMPLEXIDADE (Arquitetura Domain-Driven) =====
            'complexity': ['warn', { 'max': 15 }],
            'max-depth': ['warn', { 'max': 4 }],
            'max-nested-callbacks': ['warn', { 'max': 4 }],
            'max-lines-per-function': ['warn', {
                'max': 150,
                'skipBlankLines': true,
                'skipComments': true
            }],
            'max-params': ['warn', { 'max': 5 }],

            // ===== ESTILO CONSISTENTE =====
            'semi': ['warn', 'always'],
            'quotes': ['warn', 'single', { 'avoidEscape': true, 'allowTemplateLiterals': true }],
            'comma-dangle': ['warn', {
                'arrays': 'never',
                'objects': 'never',
                'imports': 'never',
                'exports': 'never',
                'functions': 'never'
            }],
            'indent': ['warn', 4, { 'SwitchCase': 1 }],
            'linebreak-style': ['error', 'unix'],
            'no-trailing-spaces': 'warn',
            'no-multiple-empty-lines': ['warn', { 'max': 2, 'maxEOF': 1 }],
            'space-before-function-paren': ['warn', {
                'anonymous': 'always',
                'named': 'never',
                'asyncArrow': 'always'
            }],

            // ===== SEGURANÇA =====
            'no-buffer-constructor': 'error',
            'no-path-concat': 'warn',

            // ===== PERFORMANCE =====
            'no-constant-condition': ['error', { 'checkLoops': false }],

            // ===== DOCUMENTAÇÃO =====
            'spaced-comment': ['warn', 'always', {
                'line': { 'markers': ['/', '=', '!'] },
                'block': { 'balanced': true }
            }]
        }
    },

    // ===== SCRIPTS DE TESTES (Regras Relaxadas) =====
    {
        files: ['tests/**/*.js', 'scripts/**/*.js'],
        rules: {
            'no-console': 'off',
            'max-lines-per-function': 'off',
            'complexity': ['warn', { 'max': 20 }]
        }
    },

    // ===== CONFIG FILES (Módulos ES) =====
    {
        files: ['*.config.{js,mjs}', 'eslint.config.mjs'],
        languageOptions: {
            sourceType: 'module',
            globals: globals.node
        }
    },

    // ===== JSON FILES =====
    {
        files: ['**/*.json'],
        ignores: ['package-lock.json'],
        plugins: {
            json
        },
        language: 'json/json'
    },

    // ===== JSONC FILES (com comentários) =====
    {
        files: ['**/*.jsonc', 'jsconfig.json', 'tsconfig.json'],
        plugins: {
            json
        },
        language: 'json/jsonc'
    },

    // ===== MARKDOWN FILES =====
    {
        files: ['**/*.md'],
        plugins: {
            markdown
        },
        language: 'markdown/gfm'
    },

    // ===== CSS FILES =====
    {
        files: ['**/*.css'],
        plugins: {
            css
        },
        language: 'css/css'
    }
];
