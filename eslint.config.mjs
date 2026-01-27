import js from '@eslint/js';
import globals from 'globals';

/**
 * eslint.config.mjs — Versão consolidada (ESLint 9.x compliant)
 *
 * Zonas:
 *  - core: regras estritas (núcleo do sistema)
 *  - backend: código Node geral (mais permissivo que core)
 *  - browser: scripts executados no contexto da página (Puppeteer)
 *  - tests: node:test runner (relaxado)
 *  - scripts: ferramentas / utilitários / tarefas (warnings)
 *
 * Convenções:
 *  - "_" sempre permitido como descarte
 *  - backend tolera nomes arquiteturais frequentes (e, err, log, path…)
 *  - caught errors exigem caughtErrors: 'all' (ESLint ≥ 9)
 */

export default [
    // ======================================================
    // 1. Core (estrito) — partes críticas do sistema
    // ======================================================
    {
        files: ['src/core/**', 'src/kernel/**', 'src/logic/**', 'src/nerv/**'],
        ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'backups/**', 'old/**', 'public/**'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                ...globals.node
            }
        },
        rules: {
            ...js.configs.recommended.rules,

            // Core: apenas "_" é descartável
            'no-unused-vars': [
                'error',
                {
                    vars: 'all',
                    args: 'after-used',
                    caughtErrors: 'all',

                    varsIgnorePattern: '^_',
                    argsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_'
                }
            ]
        }
    },

    // ======================================================
    // 2. Backend Node.js (geral)
    // ======================================================
    {
        files: ['src/**/*.js', '*.js'],
        ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'backups/**', 'old/**', 'public/**'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                ...globals.node
            }
        },
        rules: {
            ...js.configs.recommended.rules,

            // Backend: tolera padrões arquiteturais comuns
            'no-unused-vars': [
                'error',
                {
                    vars: 'all',
                    args: 'after-used',
                    caughtErrors: 'all',

                    varsIgnorePattern: '^(_|path|log|now|agent|manager|observations|ActionCode|MessageType|ActorRole)$',

                    argsIgnorePattern: '^(_|e|err|error|req|res|next)$',

                    caughtErrorsIgnorePattern: '^(_|e|err|error)$'
                }
            ]
        }
    },

    // ======================================================
    // 3. Browser context (Puppeteer / page.evaluate)
    // ======================================================
    {
        files: ['src/driver/**/*.js', 'src/driver/modules/**/*.js', 'src/driver/targets/**/*.js'],
        ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'backups/**', 'old/**'],
        languageOptions: {
            globals: {
                ...globals.browser
            }
        },
        rules: {
            // document, window, MutationObserver etc. são válidos
            'no-undef': 'off',

            'no-unused-vars': [
                'error',
                {
                    vars: 'all',
                    args: 'after-used',
                    caughtErrors: 'all',

                    varsIgnorePattern: '^_',
                    argsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_'
                }
            ]
        }
    },

    // ======================================================
    // 4. Tests (node:test) — relaxado
    // ======================================================
    {
        files: ['tests/**/*.js', '**/*.spec.js', '**/*.test.js'],
        ignores: ['node_modules/**'],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.nodeTest
            }
        },
        rules: {
            'no-unused-vars': 'off',
            'no-undef': 'off',
            'no-unused-expressions': 'off',
            'no-console': 'off'
        }
    },

    // ======================================================
    // 5. Scripts / automação / configs
    // ======================================================
    {
        files: ['scripts/**/*.js', '*.config.js', 'ecosystem.config.js'],
        ignores: ['node_modules/**', 'backups/**', 'old/**'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                ...globals.node
            }
        },
        rules: {
            'no-console': 'off',

            // warnings apenas — não bloquear tooling
            'no-unused-vars': [
                'warn',
                {
                    vars: 'all',
                    args: 'after-used',
                    caughtErrors: 'all',

                    varsIgnorePattern: '^_',
                    argsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_'
                }
            ]
        }
    }
];
