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
import i18next from 'eslint-plugin-i18next';
import prettier from 'eslint-config-prettier';

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
            '**/.vscode/**',
            '**/.devcontainer/**',
            '**/*.min.js',
            'public/js/libs/**',
            'tools/outputs/**'
        ]
    },

    // ===== JAVASCRIPT FILES (Node.js + Browser) =====
    {
        files: ['**/*.{js,mjs,cjs}'],
        plugins: {
            i18next
        },
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

            // ===== MAGIC STRINGS PREVENTION =====
            // Nota: 'off' por enquanto - será 'warn' após migração completa para constantes
            'i18next/no-literal-string': [
                'off',
                {
                    mode: 'all',
                    'should-validate-template': true,
                    ignore: [
                        // Ignore common patterns that are not magic strings
                        '^[A-Z_]+$', // Constants like STATUS_VALUES
                        '^\\s*$', // Empty/whitespace strings
                        '^[0-9]+$', // Numbers as strings
                        '^[.,;:!?\\-_/\\\\]+$' // Punctuation
                    ],
                    ignoreCallee: [
                        // Allow literals in specific function calls
                        'require',
                        'console.log',
                        'console.error',
                        'console.warn',
                        'console.info',
                        'logger.log',
                        'path.join',
                        'path.resolve',
                        'Object.freeze',
                        'Object.values',
                        'z.enum',
                        'z.literal'
                    ],
                    ignoreAttribute: ['className', 'styleName', 'type', 'id', 'name', 'data-testid']
                }
            ],

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
            // Sequential automation loops são comuns em Puppeteer - apenas warning em casos óbvios
            'no-await-in-loop': 'off',
            'require-atomic-updates': 'warn',

            // ===== ASYNC/AWAIT BEST PRACTICES =====
            'no-async-promise-executor': 'error',
            'no-promise-executor-return': 'error',
            'prefer-promise-reject-errors': 'error',

            // ===== VARIÁVEIS E ESCOPO =====
            'no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_'
                }
            ],
            'no-use-before-define': ['error', { functions: false, classes: true }],
            'no-shadow': ['warn', { builtinGlobals: false, hoist: 'functions' }],
            'no-undef': 'error',
            'no-undefined': 'off',
            'no-var': 'warn',
            'prefer-const': ['warn', { destructuring: 'all' }],

            // ===== CÓDIGO LIMPO =====
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            curly: ['warn', 'all'],
            'no-else-return': 'off', // Early returns são preferíveis, mas else-return não é problema
            'no-lonely-if': 'off', // Lonely if pode ser mais legível que else-if em alguns casos
            'no-unneeded-ternary': 'warn',
            'no-nested-ternary': 'off', // Nested ternary pode ser legível quando bem formatado
            'prefer-template': 'off', // Concatenação com + é aceitável
            'prefer-arrow-callback': 'off', // Function expressions são equivalentes

            // ===== COMPLEXIDADE (Arquitetura Domain-Driven) =====
            // Limites ajustados para arquitetura NERV event-driven (funções orquestradoras naturalmente complexas)
            complexity: ['warn', { max: 20 }],
            'max-depth': ['warn', { max: 5 }],
            'max-nested-callbacks': ['warn', { max: 5 }],
            'max-lines-per-function': [
                'warn',
                {
                    max: 200,
                    skipBlankLines: true,
                    skipComments: true
                }
            ],
            'max-params': ['warn', { max: 6 }],

            // ===== ESTILO CONSISTENTE =====
            semi: ['warn', 'always'],
            quotes: ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
            'comma-dangle': [
                'warn',
                {
                    arrays: 'never',
                    objects: 'never',
                    imports: 'never',
                    exports: 'never',
                    functions: 'never'
                }
            ],
            indent: ['warn', 4, { SwitchCase: 1 }],
            'linebreak-style': ['error', 'unix'],
            'no-trailing-spaces': 'warn',
            'no-multiple-empty-lines': ['warn', { max: 2, maxEOF: 1 }],
            'space-before-function-paren': [
                'warn',
                {
                    anonymous: 'always',
                    named: 'never',
                    asyncArrow: 'always'
                }
            ],

            // ===== SEGURANÇA =====
            'no-buffer-constructor': 'error',
            'no-path-concat': 'warn',

            // ===== PERFORMANCE =====
            'no-constant-condition': ['error', { checkLoops: false }],

            // ===== DOCUMENTAÇÃO =====
            'spaced-comment': [
                'warn',
                'always',
                {
                    line: { markers: ['/', '=', '!'] },
                    block: { balanced: true }
                }
            ]
        }
    },

    // ===== SCRIPTS DE TESTES (Regras Relaxadas) =====
    {
        files: ['tests/**/*.js', 'scripts/**/*.js'],
        rules: {
            'no-console': 'off',
            'max-lines-per-function': 'off',
            complexity: ['warn', { max: 20 }]
        }
    },

    // ===== CONFIG FILES (Módulos ES) =====
    {
        files: ['*.config.{js,mjs}', 'eslint.config.mjs', 'src/core/constants/**/*.js'],
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
    },

    // ===== PRETTIER INTEGRATION =====
    // Desabilita regras ESLint que conflitam com Prettier
    // DEVE SER O ÚLTIMO NO ARRAY
    prettier
];
