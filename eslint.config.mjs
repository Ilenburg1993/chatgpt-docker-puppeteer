// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * eslint.config.mjs — Consolidado com typescript-eslint (ESLint 10 + tseslint 8)
 *
 * ─── Zonas ──────────────────────────────────────────────────────────────────── 0. global-ignores — pastas excluídas
 * globalmente
 *
 * 1. base — parser TS + recommended (sem type-info): todos os .js/.mjs
 * 2. src-type-checked — regras type-aware via TSServer (projectService)
 * 3. core — zonas críticas: regras estritas + type-checked
 * 4. backend — Node.js geral (mais permissivo que core)
 * 5. browser — contexto Puppeteer/page.evaluate (globals.browser)
 * 6. tests — node:test runner (relaxado, type-check desabilitado)
 * 7. scripts — automação / configs (warnings, type-check desabilitado)
 * 8. cjs — configs CommonJS (ex.: pm2/ecosystem)
 *
 * ─── typescript-eslint (projectService → TSServer) ─────────────────────────── A integração TSServer acontece via
 * `parserOptions.projectService: true` nas zonas type-checked. O ESLint instancia um Language Service interno que lê o
 * tsconfig.node.json (preferido) e usa a mesma infra de type-checking que o compilador TypeScript — sem cache
 * compartilhado com o VS Code TSServer nem com o tsserver-daemon.mjs (src/integration/lsp/tsserver-daemon.mjs).
 *
 * O trio de "sistemas TypeScript" no projeto: A) VS Code TSServer — editor, IntelliSense, hover (settings.json) B)
 * tsserver-daemon — MCP tools, lsp_definition/references/etc. via agentes C) ESLint + tseslint — análise estática com
 * type-info em CI e pre-commit
 *
 * ─── Convenções ───────────────────────────────────────────────────────────────
 *
 * - "_" sempre permitido como descarte (all zones)
 * - backend tolera nomes arquiteturais frequentes (e, err, log, path…)
 * - @typescript-eslint/no-unused-vars substitui no-unused-vars em arquivos JS (melhor suporte a destructuring, tipos
 *   JSDoc, parâmetros rest)
 * - no-undef desabilitado onde o parser TS já garante escopo
 * - Ignoramos dashboard-ui (Vue) — tem seu próprio vue-tsc
 */

/** @type {string[]} */
const GLOBAL_IGNORES = [
    'node_modules/**',
    'dist/**',
    'coverage/**',
    'backups/**',
    'old/**',
    'public/**',
    'src/dashboard-ui/**',
    'scripts/dist/**',
    // Artefatos gerados (declarations TypeScript, tipos compilados)
    'tmp/**',
    // Vendor/skills externas ao projeto (codex, agentes vendors)
    '.codex/**',
    // Código legado de exemplo — não é parte do runtime, apenas referência histórica
    'DOCUMENTAÇÃO/PLANOS/LEGADO_PLANO/**',
    // Ambiente virtual Python — nunca deve ser lintado
    '.venv/**',
];

// ─── Regras @typescript-eslint/no-unused-vars reutilizadas por zona ───────────
/** @type {import('eslint').Linter.RuleEntry} */
const UNUSED_VARS_BACKEND = [
    'error',
    {
        vars: 'all',
        args: 'after-used',
        caughtErrors: 'all',
        varsIgnorePattern: '^(_.*|path|log|now|agent|manager|observations|ActionCode|MessageType|ActorRole)$',
        argsIgnorePattern: '^(_|e|err|error|req|res|next)$',
        caughtErrorsIgnorePattern: '^(_.*|e|err|error)$',
        ignoreRestSiblings: true,
    },
];

/** @type {import('eslint').Linter.RuleEntry} */
const UNUSED_VARS_STRICT = [
    'error',
    {
        vars: 'all',
        args: 'after-used',
        caughtErrors: 'all',
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
    },
];

export default tseslint.config(
    // ======================================================
    // 0. Global ignores (único ponto de verdade)
    // ======================================================
    {
        ignores: GLOBAL_IGNORES,
    },

    // ======================================================
    // 1. Base: parser typescript-eslint + recommended sem type-info
    //    Aplica para TODOS os .js/.mjs/.ts do projeto.
    //    O parser TS substitui o espree padrão e entende JSDoc generics,
    //    decorators, optional chaining e demais extensões de sintaxe TS.
    // ======================================================
    {
        files: ['**/*.{js,mjs,ts,mts}'],
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            // O @typescript-eslint/no-unused-vars já entende tipos JSDoc e é
            // preferido sobre no-unused-vars nativo para arquivos com TS parser.
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': UNUSED_VARS_BACKEND,

            // Em arquivos JS com @ts-check o parser já valida escopo — no-undef
            // seria redundante e produz falsos positivos com globals dinâmicos.
            'no-undef': 'off',

            // Ajustes relevantes para projeto JS-first com JSDoc:
            // @typescript-eslint/no-explicit-any em JS-first é muito ruidoso.
            '@typescript-eslint/no-explicit-any': 'off',
            // Require-await em JS com async callback patterns pode ser impreciso.
            '@typescript-eslint/require-await': 'off',
            // Permite uso de `!` non-null assertion em cases onde o dev sabe mais.
            '@typescript-eslint/no-non-null-assertion': 'off',
        },
    },

    // ======================================================
    // 2. Type-checked (src/ geral) — via projectService → TSServer
    //    Regras que requerem informação de tipo ficam aqui.
    //    O ESLint instanciará um LanguageService próprio lendo tsconfig.node.json.
    //    NOTA: aumenta o tempo de lint; uso intencional apenas para src/.
    // ======================================================
    {
        files: ['src/**/*.{js,mjs}'],
        ignores: [
            // browser context: usa globals.browser, não precisa de type-check TSServer
            'src/driver/**',
            'src/shared/page_stability/**',
            'src/shared/biomechanics/**',
            'src/shared/sadi/**',
            'src/infra/browser_pool/**',
        ],
        extends: tseslint.configs.recommendedTypeChecked,
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // Type-checked rules: habilitamos apenas os de alto valor e baixo ruído
            // para uma base de código JS-first com JSDoc.

            // ─── Segurança de Promise ────────────────────────────────────────
            // Captura promises flutuantes (fire-and-forget não intencional).
            '@typescript-eslint/no-floating-promises': 'error',
            // Previne await em valores não-thenable.
            '@typescript-eslint/await-thenable': 'error',
            // Previne passar Promise onde callback é esperado.
            '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],

            // ─── Regras ruidosas em JS-first → desabilitadas ─────────────────
            // no-unsafe-* são muito verbosos em código JS com JSDoc parcial.
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            // Em base logging-heavy, objetos entram diretamente em template literals.
            '@typescript-eslint/no-base-to-string': 'off',
            '@typescript-eslint/restrict-template-expressions': 'off',
            // require-await: desabilitado — base JS-first tem muitas implementações de interface
            // async sem await (padrão legítimo: métodos async para compatibilidade com protocolo/contrato).
            '@typescript-eslint/require-await': 'off',
            // unbound-method é caro (24% do tempo) e muito ruidoso em JS-first com this-binding dinâmico.
            '@typescript-eslint/unbound-method': 'off',
        },
    },

    // ======================================================
    // Zone D. TypeScript Declaration Files (.d.ts)
    //    Regras que geram falsos positivos em arquivos de declaração:
    //    - triple-slash-reference: padrão legítimo em .d.ts bundled
    //    - no-empty-object-type: interfaces de eventos vazias são válidas
    //    - no-unsafe-declaration-merging: augmentation pattern esperado
    // ======================================================
    {
        files: ['**/*.d.ts'],
        rules: {
            '@typescript-eslint/triple-slash-reference': 'off',
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/no-unsafe-declaration-merging': 'off',
        },
    },

    // ======================================================
    // 3. Core (estrito) — partes críticas do sistema
    //    Sobreposição sobre as zonas 1+2: restringe ainda mais o descarte.
    // ======================================================
    {
        files: ['src/{core,kernel,logic,nerv}/**/*.{js,mjs}'],
        rules: {
            // Core: apenas "_" é descartável
            '@typescript-eslint/no-unused-vars': UNUSED_VARS_STRICT,
        },
    },

    // ======================================================
    // 4. Backend Node.js (geral) — mais permissivo que core
    // ======================================================
    {
        files: ['src/**/*.{js,mjs}', '*.{js,mjs}'],
        ignores: ['src/core/**', 'src/kernel/**', 'src/logic/**', 'src/nerv/**'],
        rules: {
            '@typescript-eslint/no-unused-vars': UNUSED_VARS_BACKEND,
        },
    },

    // ======================================================
    // 5. Browser context (Puppeteer / page.evaluate)
    //    globals.browser + no-undef ativo para cobrir window/document.
    //    type-checked desabilitado: código que roda no contexto da página
    //    não tem tsconfig próprio e usa APIs globais do browser.
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
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser,
            },
        },
        rules: {
            // Reativa no-undef para esta zona (globals.browser cobre window/document)
            'no-undef': 'error',
            '@typescript-eslint/no-unused-vars': UNUSED_VARS_STRICT,
        },
    },

    // ======================================================
    // 6. Tests (node:test) — relaxado, type-check desabilitado
    //    Testes usam padrões permissivos: any, assertions sem tipo, etc.
    // ======================================================
    {
        files: ['tests/**/*.{js,mjs}', '**/*.spec.{js,mjs}', '**/*.test.{js,mjs}'],
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-this-alias': 'off',
            'no-unused-expressions': 'off',
            'no-console': 'off',
            // Catches empty blocks legítimos em testes de integração (ex: timeouts esperados)
            'no-empty': ['error', { allowEmptyCatch: true }],
            // Padrão defensivo em testes: let x = null; try { x = await ... }
            'no-useless-assignment': 'off',
            // Testes de driver testam intencionalmente controle de caracteres (ex: \x00, \x1f)
            'no-control-regex': 'off',
        },
    },

    // ======================================================
    // 6b. Tests legacy — arquivos de teste históricos
    //    @ts-nocheck é padrão nesses arquivos, não deve ser erro.
    // ======================================================
    {
        files: ['tests/legacy/**/*.{js,mjs}'],
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            '@typescript-eslint/ban-ts-comment': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            'prefer-const': 'off',
            'prefer-rest-params': 'off',
            'no-empty': 'off',
        },
    },

    // ======================================================
    // 7. Scripts / automação / configs (ESM)
    //    type-check desabilitado: scripts não têm tsconfig dedicado
    //    e frequentemente usam APIs dinâmicas, process.exit, etc.
    // ======================================================
    {
        files: ['scripts/**/*.{js,mjs}', '*.{config,conf}.{js,mjs}', 'ecosystem.config.{js,mjs}', '*.mjs'],
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'no-console': 'off',
            // Scripts de automação frequentemente usam catch{} para operações opcionais
            'no-empty': ['error', { allowEmptyCatch: true }],
            // Scripts de automação frequentemente usam \x1b para stripping ANSI — intencional
            'no-control-regex': 'off',
            // Scripts de automação usam padrão defensivo: let x = default; try { x = ... }
            // Esse padrão é comum e intencional em tooling, não é um bug real.
            'no-useless-assignment': 'off',

            // warnings apenas — não bloquear tooling
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    vars: 'all',
                    args: 'after-used',
                    caughtErrors: 'all',
                    varsIgnorePattern: '^_',
                    argsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^(_.*|e|err|error|error2)$',
                    ignoreRestSiblings: true,
                },
            ],
        },
    },

    // ======================================================
    // 8. Configs CommonJS explícitos (ex.: pm2/ecosystem)
    // ======================================================
    {
        files: ['**/*.cjs', 'ecosystem.config.cjs', 'test-*.js', 'test_*.js', 'check_syntax.js', 'benchmark.js'],
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            // Arquivos CJS raiz usam require() legitimamente
            '@typescript-eslint/no-require-imports': 'off',
        },
    },

    // ======================================================
    // 9. tools/ — utilitários externos (RAG, LSP, generation etc.)
    //    Código de tooling auxiliar: regras relaxadas similar a scripts/.
    //    Inclui tanto ESM (.mjs) quanto CJS (.js) no mesmo diretório.
    // ======================================================
    {
        files: ['tools/**/*.{js,mjs}'],
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: {
            ecmaVersion: 'latest',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'no-console': 'off',
            // Ferramentas de tooling frequentemente relançam erros sem cause (padrão aceitável)
            'preserve-caught-error': 'off',
            // Arquivos CJS de tooling usam require() legitimamente
            '@typescript-eslint/no-require-imports': 'off',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    vars: 'all',
                    args: 'after-used',
                    caughtErrors: 'all',
                    varsIgnorePattern: '^_',
                    argsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^(_.*|e|err|error)$',
                    ignoreRestSiblings: true,
                },
            ],
        },
    },
);
