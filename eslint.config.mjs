// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

/**
 * eslint.config.mjs — ESLint 10 para JS/ESM e regras arquiteturais; type-awareness TS7 vive no gate Oxlint/tsgolint.
 *
 * ─── Zonas ──────────────────────────────────────────────────────────────────── 0. global-ignores — pastas excluídas
 * globalmente
 *
 * 1. base — parser ECMAScript nativo + recommended: todos os .js/.mjs
 * 2. type-aware — delegado a Oxlint/tsgolint sobre TS7, fora desta config
 * 3. core — zonas críticas: regras estritas
 * 4. backend — Node.js geral (mais permissivo que core)
 * 5. browser — contexto Puppeteer/page.evaluate (globals.browser)
 * 6. tests — node:test runner (relaxado, type-check desabilitado)
 * 7. scripts — automação / configs (warnings, type-check desabilitado)
 * 8. cjs — configs CommonJS (ex.: pm2/ecosystem)
 *
 * ─── TypeScript 7 ───────────────────────────────────────────────────────────────────────────────────
 * ESLint não carrega uma segunda engine TypeScript. Arquivos TS e as três regras type-aware de segurança de Promises
 * são validados por `oxlint --type-aware`/`oxlint-tsgolint`, que usa typescript-go/TS7. `tsc`/strict continuam sendo a
 * autoridade de compilação. Assim lint sintático/arquitetural e semântica TS têm owners distintos, sem compatibility TS6.
 *
 * ─── Convenções ───────────────────────────────────────────────────────────────
 *
 * - "_" sempre permitido como descarte (all zones)
 * - backend tolera nomes arquiteturais frequentes (e, err, log, path…)
 * - no-unused-vars nativo é configurado por zona com os mesmos padrões de descarte já adotados pelo projeto
 * - no-undef permanece ativo via eslint:recommended; globals Node/browser são declarados por zona
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
    '**/*.{ts,mts,cts,tsx}',
    '.kilo/**',
    // Artefatos gerados (declarations TypeScript, tipos compilados)
    'tmp/**',
    // Vendor/skills externas ao projeto (codex, agentes vendors)
    '.codex/**',
    // Código legado de exemplo — não é parte do runtime, apenas referência histórica
    'DOCUMENTAÇÃO/PLANOS/LEGADO_PLANO/**',
    // Ambiente virtual Python — nunca deve ser lintado
    '.venv/**',
];

// ─── Regras no-unused-vars reutilizadas por zona ─────────────────────────────
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

const NODE_BUILTIN_MODULE_PATTERN =
    '^(?:assert|buffer|child_process|crypto|dgram|diagnostics_channel|dns|events|fs|http|http2|https|module|net|os|path|perf_hooks|process|readline|stream|string_decoder|timers|tls|url|util|worker_threads|zlib)(?:\\/|$)';

const NODE24_ESM_SYNTAX_RESTRICTIONS = [
    {
        selector: `ImportDeclaration[source.value=/${NODE_BUILTIN_MODULE_PATTERN}/]`,
        message:
            'Node 24+ ESM: importe built-ins com prefixo "node:" (ex.: "node:fs/promises"). ' +
            'Isso evita ambiguidade com pacotes npm e mantém compatibilidade com resolução NodeNext.',
    },
    {
        selector: `ExportNamedDeclaration[source.value=/${NODE_BUILTIN_MODULE_PATTERN}/]`,
        message: 'Node 24+ ESM: reexporte built-ins usando "node:" (ex.: "node:stream").',
    },
    {
        selector: `ExportAllDeclaration[source.value=/${NODE_BUILTIN_MODULE_PATTERN}/]`,
        message: 'Node 24+ ESM: reexporte built-ins usando "node:" (ex.: "node:stream").',
    },
    {
        selector: `ImportExpression[source.value=/${NODE_BUILTIN_MODULE_PATTERN}/]`,
        message:
            'Node 24+ ESM: dynamic import de built-ins também deve usar "node:" (ex.: import("node:fs/promises")).',
    },
];

const TOOLS_INDEX_BARREL_SYNTAX_RESTRICTIONS = [
    {
        selector: 'ImportDeclaration',
        message:
            'INDEX barrel-only: use apenas re-exports `export { ... } from ...` / `export * from ...`; evite imports diretos.',
    },
    {
        selector: 'ExportNamedDeclaration[declaration!=null]',
        message: 'INDEX barrel-only: não declare símbolos em index.js; somente re-exporte símbolos de outros módulos.',
    },
];

const TOOLS_IO_SYNTAX_RESTRICTIONS = [
    {
        selector: 'ImportDeclaration[source.value=/^#copilot\\/infra\\/(?!public\\/)/]',
        message:
            'Boundary tools→infra: consuma exclusivamente entrypoints #copilot/infra/public/*. ' +
            'Aliases internal, legados e deep imports não são API externa.',
    },
    {
        selector: 'ImportDeclaration[source.value=/^#copilot\\/db(?:$|\\/)/]',
        message:
            'Boundary tools→db: tools não devem acessar db diretamente. ' +
            'Use repository/domain adapters ou uma facade pública explicitamente governada.',
    },
    {
        selector: 'ImportDeclaration[source.value=/^(?:\\.\\.\\/){3,}(?:infra|db)(?:\\/|$)/]',
        message:
            'Boundary tools→infra/db: não use import relativo para escapar da camada tools. ' +
            'Use "#copilot/infra/public/*" ou contratos locais de domínio.',
    },
    {
        selector:
            'ImportDeclaration[source.value="#copilot/sdk"] ImportSpecifier[imported.name=/^(createTool|createToolSync)$/]',
        message:
            'Tool factory: em src/copilot/tools/** use buildTool (tools/infra/tool-factory.js). ' +
            'Evite createTool/createToolSync direto para manter schema, feedback e telemetria unificados.',
    },
    {
        selector:
            'ImportDeclaration[source.value="node:fs/promises"] ImportSpecifier[imported.name=/^(readFile|writeFile|appendFile|copyFile|cp|rename|rm|unlink|mkdir|open)$/]',
        message:
            'IO governance: tools não devem chamar fs/promises para leitura/escrita/mutação. ' +
            'Use capabilities sob #copilot/infra/public/filesystem/*, public/cache, public/indexing ou public/policy.',
    },
    {
        selector:
            'ImportDeclaration[source.value="node:fs"] ImportSpecifier[imported.name=/^(readFile|readFileSync|writeFile|writeFileSync|appendFile|appendFileSync|copyFile|copyFileSync|cp|rename|rm|unlink|mkdir|open)$/]',
        message:
            'IO governance: tools não devem chamar node:fs diretamente para leitura/escrita/mutação. ' +
            'Use uma capability explícita de #copilot/infra/public/*; acesso direto a node:fs permanece proibido em tools.',
    },
];

export default defineConfig(
    // ======================================================
    // 0. Global ignores (único ponto de verdade)
    // ======================================================
    {
        ignores: GLOBAL_IGNORES,
    },

    // ======================================================
    // 1. Base: parser ECMAScript nativo + eslint:recommended.
    //    Aplica a JS/ESM. TypeScript é intencionalmente excluído desta engine e validado pelo lane TS7/Oxlint.
    // ======================================================
    {
        files: ['**/*.{js,mjs}'],
        extends: [js.configs.recommended],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'no-unused-vars': UNUSED_VARS_BACKEND,
        },
    },

    // Type-aware Promise safety is enforced by the separate TS7 Oxlint/tsgolint lane.

    // ======================================================
    // 3. Core (estrito) — partes críticas do sistema
    //    Sobreposição sobre as zonas 1+2: restringe ainda mais o descarte.
    // ======================================================
    {
        files: ['src/{core,kernel,logic,nerv}/**/*.{js,mjs}'],
        rules: {
            // Core: apenas "_" é descartável
            'no-unused-vars': UNUSED_VARS_STRICT,
        },
    },

    // ======================================================
    // 4. Backend Node.js (geral) — mais permissivo que core
    // ======================================================
    {
        files: ['src/**/*.{js,mjs}', '*.{js,mjs}'],
        ignores: ['src/core/**', 'src/kernel/**', 'src/logic/**', 'src/nerv/**'],
        rules: {
            'no-unused-vars': UNUSED_VARS_BACKEND,
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
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser,
            },
        },
        rules: {
            // Reativa no-undef para esta zona (globals.browser cobre window/document)
            'no-undef': 'error',
            'no-unused-vars': UNUSED_VARS_STRICT,
        },
    },

    // ======================================================
    // 6. Tests (node:test) — relaxado, type-check desabilitado
    //    Testes usam padrões permissivos: any, assertions sem tipo, etc.
    // ======================================================
    {
        files: ['tests/**/*.{js,mjs}', '**/*.spec.{js,mjs}', '**/*.test.{js,mjs}'],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'no-unused-vars': 'off',
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
    // 6b. Tests legacy — historical runtime fixtures; TypeScript remains fully enabled.
    // ======================================================
    {
        files: ['tests/legacy/**/*.{js,mjs}'],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'no-unused-vars': 'off',
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
            'no-unused-vars': [
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
        files: [
            '**/*.cjs',
            'ecosystem.config.cjs',
            'test-proxy-final.js',
            'test-proxy-simple.js',
            'test-puppeteer.js',
            'check_syntax.js',
        ],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
            },
        },
        rules: {
        },
    },

    // ======================================================
    // 9. tools/ — utilitários externos (RAG, LSP, generation etc.)
    //    Código de tooling auxiliar: regras relaxadas similar a scripts/.
    //    Inclui tanto ESM (.mjs) quanto CJS (.js) no mesmo diretório.
    // ======================================================
    {
        files: ['tools/**/*.{js,mjs}'],
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
            'no-unused-vars': [
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

    // ── F20: Proíbe imports diretos de @github/copilot-sdk fora de sdk/ ──
    {
        files: ['src/copilot/**/*.js'],
        ignores: ['src/copilot/sdk/**'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: '@github/copilot-sdk',
                            message:
                                'Importe de uma surface local do SDK, como "#copilot/sdk/session", "#copilot/sdk/rpc", ' +
                                '"#copilot/sdk/tools", "#copilot/sdk/telemetry" ou "#copilot/sdk/types". ' +
                                'Apenas os wrappers em src/copilot/sdk/ podem importar diretamente de @github/copilot-sdk.',
                        },
                    ],
                },
            ],
        },
    },

    // ── F21: Proíbe deep imports de módulos #copilot — use o barrel ──────
    {
        files: ['src/copilot/**/*.js'],
        // Exceções de arquivo: aliases intencionais definidos no package.json
        //   - #copilot/config/custom-tools-registry → sdk/custom-tools.js (alias de compatibilidade)
        //   - sdk/models/helpers.js usa #copilot/sdk/client (import interno ao módulo sdk)
        ignores: ['src/copilot/agent/infra/tools-bootstrap.js', 'src/copilot/sdk/models/helpers.js'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            // Proíbe deep imports de #copilot/, EXCETO:
                            //   - #copilot/sdk/* surfaces públicas governadas por sdk/module-map.js
                            //   - #copilot/observability/logger (allow-listed por DX/performance)
                            regex: '^#copilot/(core|config|observability|hooks|audit|conversation-hub|bridges|tools|channel|db|api|agent|terminal)/(?!types$|logger$).+',
                            message:
                                'Use o barrel do módulo (ex.: "#copilot/core") em vez do deep import. ' +
                                'Exceções permitidas: surfaces #copilot/sdk/* e #copilot/observability/logger.',
                        },
                        {
                            regex: '^#copilot/sdk/(tools-registry|tools-state|custom-tools|server-rpc|rpc-session|rpc-ops|rpc-facade|health|tracing|quota-monitor|agent-contract|bridge-contract|channel-contract|client|client-facade|client-events|session-lifecycle|events|provider|permissions|system-message)$',
                            message:
                                'Alias SDK folha removido. Use a surface canônica: #copilot/sdk/session, ' +
                                '#copilot/sdk/rpc, #copilot/sdk/tools, #copilot/sdk/telemetry ou #copilot/sdk/types.',
                        },
                    ],
                },
            ],
        },
    },

    // ── F21B: agent/** fora de facades/ports só pode usar #copilot/sdk barrel ─
    {
        files: ['src/copilot/agent/**/*.js'],
        ignores: ['src/copilot/agent/facades/**', 'src/copilot/agent/ports/**'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            regex: '^#copilot/sdk/.+',
                            message:
                                'Fora de agent/facades e agent/ports, use apenas o barrel "#copilot/sdk" ' +
                                'ou uma façade local do agent; não importe subpaths internos do SDK.',
                        },
                        {
                            regex: '^\\.{1,2}/.*sdk/.+',
                            message:
                                'Fora de agent/facades e agent/ports, módulos do agent não podem fazer deep-import ' +
                                'relativo para sdk/*; use "#copilot/sdk" ou uma façade local do agent.',
                        },
                    ],
                },
            ],
        },
    },

    // ── F22: Boundary progressivo tools → infra/db (modo warn) ─────────
    {
        files: ['src/copilot/tools/**/*.js'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            regex: '^#copilot/infra(?:$|/(?!public/))',
                            message:
                                'Em tools/, infra só pode ser consumida por #copilot/infra/public/*; internal e aliases legados são proibidos.',
                        },
                        {
                            regex: '^#copilot/db(?:$|/)',
                            message:
                                'Evite importar #copilot/db diretamente em tools/. Prefira repository/domain adapters.',
                        },
                    ],
                },
            ],
        },
    },

    // ── F23: Fábrica única de tools (buildTool) ─────────────────────────
    {
        files: ['src/copilot/tools/**/*.js'],
        ignores: ['src/copilot/tools/infra/tool-factory.js'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['../../infra/*', '../infra/*', '#copilot/infra/internal/*'],
                            message:
                                'Boundary target: não atravesse para internals de infra. Use #copilot/infra/public/* ou adapters do domínio tools.',
                        },
                        {
                            group: ['../../db/*', '../db/*', '#copilot/db/*'],
                            message:
                                'Boundary target: evitar dependência direta tools → db. Passe por contratos/repository do domínio.',
                        },
                    ],
                    paths: [
                        {
                            name: '#copilot/sdk',
                            importNames: ['createTool', 'createToolSync'],
                            message:
                                'Em src/copilot/tools/** use buildTool (tool-factory) como fluxo único. ' +
                                'Evite createTool/createToolSync direto para não criar arquiteturas paralelas.',
                        },
                    ],
                },
            ],
        },
    },

    // ── F24: Hooks como camada final (somente hooks/** pode importar hooks/**) ─
    // ── F25: index.js em tools/** deve ser barrel-only (re-exports) ───────────
    {
        files: ['src/copilot/tools/**/index.js'],
        rules: {
            'no-restricted-syntax': [
                'error',
                ...NODE24_ESM_SYNTAX_RESTRICTIONS,
                ...TOOLS_INDEX_BARREL_SYNTAX_RESTRICTIONS,
            ],
        },
    },

    // ── F24: Hooks como camada final (somente hooks/** pode importar hooks/**) ─
    {
        files: ['src/copilot/**/*.js'],
        ignores: ['src/copilot/hooks/**'],
        rules: {
            'no-restricted-imports': [
                'warn',
                {
                    patterns: [
                        {
                            regex: '^#copilot/hooks(?:$|/)',
                            message:
                                'Boundary target: hooks/ é camada final. Módulos fora de src/copilot/hooks/** não devem depender de #copilot/hooks.',
                        },
                        {
                            regex: '^(?:\\.{1,2}/)+.*hooks(?:/|\\.js$)',
                            message:
                                'Boundary target: hooks/ é camada final. Evite import relativo para hooks/** fora da própria camada de hooks.',
                        },
                    ],
                },
            ],
        },
    },

    // ── F26: Imports externos de tools DEVEM usar o barrel #copilot/tools ──────
    // Módulos fora de src/copilot/tools/** não devem importar submodules internos
    // de tools diretamente. O único ponto de contato externo é #copilot/tools.
    {
        files: ['src/copilot/**/*.js'],
        ignores: ['src/copilot/tools/**'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            regex: '^(?:\\.\\./)+tools/',
                            message:
                                'F26: Importe de "#copilot/tools" (barrel canônico). Não use deep imports de submodulos de tools (tools/bootstrap, tools/infra/*, tools/**/index.js, etc.).',
                        },
                    ],
                },
            ],
        },
    },

    // ── Node 24+ ESM / aliases — enforcement executável ─────────────────────
    {
        files: ['src/copilot/**/*.js'],
        rules: {
            'no-restricted-syntax': ['error', ...NODE24_ESM_SYNTAX_RESTRICTIONS],
        },
    },

    // ── Tools → IO/infra — somente facades públicas e sem bypass de escrita/leitura ──
    {
        files: ['src/copilot/tools/**/*.js'],
        ignores: ['src/copilot/tools/todo/store.js'],
        rules: {
            'no-restricted-syntax': ['error', ...NODE24_ESM_SYNTAX_RESTRICTIONS, ...TOOLS_IO_SYNTAX_RESTRICTIONS],
        },
    },

    {
        files: ['src/copilot/tools/**/*.js'],
        ignores: ['src/copilot/tools/index.js'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: '#copilot/tools',
                            message:
                                'Boundary tools→tools: módulos internos de src/copilot/tools/** não devem importar o barrel raiz #copilot/tools. Use tool-factory/logger locais ou barrels internos do domínio.',
                        },
                        {
                            name: '#copilot/tools/index',
                            message:
                                'Boundary tools→tools: módulos internos de src/copilot/tools/** não devem importar o barrel raiz #copilot/tools/index. Use dependências internas locais.',
                        },
                        {
                            name: '#copilot/tools/index.js',
                            message:
                                'Boundary tools→tools: módulos internos de src/copilot/tools/** não devem importar o barrel raiz #copilot/tools/index.js. Use dependências internas locais.',
                        },
                    ],
                },
            ],
        },
    },

    {
        files: ['src/copilot/tools/**/index.js'],
        rules: {
            'no-restricted-syntax': [
                'error',
                ...NODE24_ESM_SYNTAX_RESTRICTIONS,
                ...TOOLS_INDEX_BARREL_SYNTAX_RESTRICTIONS,
                ...TOOLS_IO_SYNTAX_RESTRICTIONS,
            ],
        },
    },

    // ── F99: Fronteiras efetivas após merge do Flat Config ───────────────────
    // Blocos finais de no-restricted-imports para zonas que precisam de uma
    // mensagem executável específica. Mantê-los no fim evita sobrescrita por
    // regras gerais de imports em blocos anteriores do Flat Config.
    {
        files: ['src/copilot/config/**/*.js'],
        ignores: ['src/copilot/config/sdk-config-port.js'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            regex: '^(?:#copilot/sdk(?:/|$)|(?:\\.\\./)+sdk(?:/|$))',
                            message:
                                'Boundary config→sdk: use "../sdk-config-port.js". ' +
                                'Apenas src/copilot/config/sdk-config-port.js pode compor diretamente surfaces do SDK.',
                        },
                    ],
                },
            ],
        },
    },

    {
        files: ['src/copilot/terminal/**/*.js'],
        ignores: [
            'src/copilot/terminal/frontend/gateways/sdk-session.js',
            'src/copilot/terminal/frontend/gateways/tools.js',
        ],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            regex: '^(?:#copilot/(?:sdk|tools)(?:/|$)|(?:\\.\\./)+(?:sdk|tools)(?:/|$))',
                            message:
                                'Boundary terminal→runtime: use gateways em terminal/frontend/gateways/*.js. ' +
                                'SDK direto pertence a gateways/sdk-session.js; tools diretas pertencem a gateways/tools.js.',
                        },
                    ],
                },
            ],
        },
    },

    {
        files: ['src/copilot/server/routes/sdk/**/*.js'],
        ignores: ['src/copilot/server/routes/sdk/deps.js'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            regex: '^(?:#copilot/(?:sdk|tools|presentation)(?:/|$)|(?:\\.\\./)+presentation(?:/|$))',
                            message:
                                'Boundary server/routes/sdk: componha SDK, tools e presentation exclusivamente em deps.js. ' +
                                'Handlers devem receber capabilities por routeDeps para preservar testabilidade e hierarquia.',
                        },
                    ],
                },
            ],
        },
    },

    // ── Timers recorrentes canônicos — ProcessInfra scheduler / pure resilience ──
    {
        files: [
            'src/copilot/sdk/telemetry/quota-monitor.js',
            'src/copilot/agent/session/lifecycle/keepalive.js',
            'src/copilot/terminal/events/agent-runtime-events.js',
            'src/copilot/conversation-hub/store.js',
            'src/copilot/observability/metrics.js',
            'src/copilot/observability/error-alerting.js',
            'src/copilot/terminal/repl/live-status-line.js',
            'src/copilot/infra/cache/l2/runtime.js',
            'src/copilot/terminal/dialog/engine.js',
            'src/copilot/terminal/wiring/terminal-agent-wiring.js',
            'src/copilot/presentation/realtime/sse/utils.js',
            'src/copilot/agent/session/boot/boot-runtime-bind.js',
            'src/copilot/agent/dialog/watchdogs/watchdog.js',
            'src/copilot/tools/todo/store.js',
            'src/copilot/presentation/agent/control/handlers.js',
        ],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector: "CallExpression[callee.name='setInterval']",
                    message:
                        'Use registerApplicationInterval from #copilot/boot/process-runtime for process-scoped recurring timers. ' +
                        'Resources with narrower ownership should own and dispose their timer explicitly.',
                },
                {
                    selector: "AwaitExpression CallExpression[callee.name='setTimeout']",
                    message:
                        'Use sleep from #copilot/infra/public/concurrency/resilience for pure asynchronous waits. ' +
                        'Do not recreate a global timer registry for finite delays.',
                },
            ],
        },
    },

    // Prettier owns formatting. Keep this last so stylistic rules that conflict
    // with canonical Prettier output cannot make `format` and `lint` disagree.
    // Architecture, security and type-aware rules above are unaffected.
    prettierConfig,
);
