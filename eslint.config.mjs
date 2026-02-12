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
 *  - cjs: configs CommonJS (ex.: pm2/ecosystem)
 *
 * Convenções:
 *  - "_" sempre permitido como descarte
 *  - backend tolera nomes arquiteturais frequentes (e, err, log, path…)
 *  - caught errors exigem caughtErrors: 'all' (ESLint ≥ 9)
 *
 * Notas de engenharia:
 *  - Ignoramos dashboard-ui (Vue) no lint do root.
 *  - Evitamos sobreposição: backend não aplica em core/kernel/logic/nerv.
 *  - Browser context mantém no-undef ligado; globals.browser cobre window/document.
 */

const GLOBAL_IGNORES = Object.freeze([
    'node_modules/**',
    'dist/**',
    'coverage/**',
    'backups/**',
    'old/**',
    'public/**',
    'src/dashboard-ui/**',
]);

export default [
    // ======================================================
    // 0. Global ignores (único ponto de verdade)
    // ======================================================
    {
        ignores: GLOBAL_IGNORES,
    },

    // ======================================================
    // 1. Backend Node.js (geral) — mais permissivo que core
    // ======================================================
    {
        files: ['src/**/*.{js,mjs}', '*.{js,mjs}'],
        ignores: [
            // Evita sobrepor o bloco "Core"
            'src/core/**',
            'src/kernel/**',
            'src/logic/**',
            'src/nerv/**',
        ],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
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

                    caughtErrorsIgnorePattern: '^(_|e|err|error)$',
                },
            ],
        },
    },

    // ======================================================
    // 2. Core (estrito) — partes críticas do sistema
    // ======================================================
    {
        files: ['src/{core,kernel,logic,nerv}/**/*.{js,mjs}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
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
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
        },
    },

    // ======================================================
    // 3. Browser context (Puppeteer / page.evaluate)
    // ======================================================
    {
        files: [
            'src/driver/**/*.{js,mjs}',
            'src/shared/page_stability/**/*.{js,mjs}',
            'src/shared/biomechanics/**/*.{js,mjs}',
            'src/shared/sadi/**/*.{js,mjs}',
            'src/infra/browser_pool/**/*.{js,mjs}',
            'test-proxy-final.{js,mjs}',
        ],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
            },
        },
        rules: {
            // Mantemos no-undef ligado: globals.browser cobre window/document e evita typos.
            ...js.configs.recommended.rules,

            'no-unused-vars': [
                'error',
                {
                    vars: 'all',
                    args: 'after-used',
                    caughtErrors: 'all',

                    varsIgnorePattern: '^_',
                    argsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
        },
    },

    // ======================================================
    // 4. Tests (node:test) — relaxado
    // ======================================================
    {
        files: ['tests/**/*.{js,mjs}', '**/*.spec.{js,mjs}', '**/*.test.{js,mjs}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'no-unused-vars': 'off',
            'no-undef': 'off',
            'no-unused-expressions': 'off',
            'no-console': 'off',
        },
    },

    // ======================================================
    // 5. Scripts / automação / configs (ESM)
    // ======================================================
    {
        files: ['scripts/**/*.{js,mjs}', '*.{config,conf}.{js,mjs}', 'ecosystem.config.{js,mjs}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
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
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
        },
    },

    // ======================================================
    // 6. Configs CommonJS explícitos (ex.: pm2/ecosystem)
    // ======================================================
    {
        files: ['**/*.cjs', 'ecosystem.config.cjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
            },
        },
    },
];
