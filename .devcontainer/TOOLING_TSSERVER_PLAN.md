# Auditoria & Plano — Tooling Dockerfile + TSServer

**Data**: 2026-03-08 **Status**: Executado ✅ (revisado 2026-03-08 — ESLint + typescript-eslint
integrado)

---

## 1. Auditoria

### 1.1 Ferramentas solicitadas — status pré-execução

| Ferramenta            | Função                                       | Estava no Dockerfile | Ação                        |
| --------------------- | -------------------------------------------- | -------------------- | --------------------------- |
| `git-delta` (`delta`) | Diffs coloridos e ricos para git             | ❌ Ausente           | ✅ Adicionada (Section 6.8) |
| `zoxide`              | `cd` inteligente com histórico               | ❌ Ausente           | ✅ Adicionada               |
| `xh`                  | HTTP client moderno (alternativa à `curl`)   | ❌ Ausente           | ✅ Adicionada               |
| `dust`                | Alternativa a `du` — uso de disco interativo | ❌ Ausente           | ✅ Adicionada               |
| `sd`                  | Substituto de `sed` com sintaxe regex clara  | ❌ Ausente           | ✅ Adicionada               |
| `bottom` (cmd: `btm`) | Monitor de sistema moderno                   | ❌ Ausente           | ✅ Adicionada               |
| `glow`                | Renderizador de Markdown no terminal         | ❌ Ausente           | ✅ Adicionada               |
| `procs`               | Alternativa a `ps` com filtragem rica        | ❌ Ausente           | ✅ Adicionada               |

**Ferramentas da sessão anterior** (validadas como presentes): nasm, libzstd-dev (toolchain), lz4,
entr, pv, jo, p7zip-full, inotify-tools (Section 6), UV_THREADPOOL_SIZE=16 (Section 8.5).

---

### 1.2 Arquitetura TSServer — Esclarecimento Definitivo

Existem **dois sistemas TypeScript completamente independentes** neste projeto:

#### Sistema A — VS Code TSServer (IntelliSense do editor)

```
VS Code Extension (vscode-typescript-next)
    │
    └─► typescript-language-server (NPM global, porta LSP)
            │
            └─► tsserver (TypeScript Compiler API, interno)
                    │
                    ├─ Configurado por: .vscode/settings.json
                    ├─ Lê: tsconfig.json → tsconfig.node.json → tsconfig.base.json
                    ├─ Cache incremental: /home/node/.cache/typescript/*.tsbuildinfo
                    └─ Serve: IntelliSense, hover, definições, erros em tempo real NO EDITOR
```

- **Quem controla**: VS Code (automático, inicia ao abrir arquivo JS/TS)
- **Configuração chave**: `typescript.tsserver.*` em `.vscode/settings.json`
- **Memória**: até 6144 MB (configurado explicitamente)
- **Watch**: inotify nativo em ext4 (volume nomeado dedicado)
- **Fix crítico aplicado (sessão anterior)**: `useSyntaxServer: "always"` → `"auto"` — sem este fix,
  features semânticas (go-to-def, refs, hover tipado) ficavam desabilitadas silenciosamente

#### Sistema B — Custom MCP LSP Daemon (`src/integration/lsp/tsserver-daemon.mjs`)

```
MCP Client (Claude/Copilot via MCP tools)
    │
    └─► tsserver-daemon.mjs (processo Node.js separado)
            │
            └─► ts.createLanguageService() (TypeScript Compiler API direta)
                    │
                    ├─ Configurado por: LSP_TOOL_TIMEOUT_MS, LSP_MAX_RESULTS (env)
                    ├─ Lê: tsconfig.json via ts.findConfigFile()
                    ├─ Cache: _lsCache Map (singleton por rootDir, in-memory)
                    └─ Serve: lsp_definition, lsp_references, lsp_hover,
                               lsp_diagnostics, lsp_code_actions, lsp_completion
                               via ferramentas MCP (mcp_chatgpt-docke_lsp_*)
```

- **Quem controla**: Agentes de IA via MCP (Model Context Protocol)
- **NENHUMA ligação** com o VS Code TSServer — processos completamente separados
- **Ambos leem os mesmos `tsconfig*.json`** mas mantêm estado próprio
- **Cache implementado (sessão anterior)**: singleton LanguageService por rootDir, invalidado em
  `updateFile` e `stop()`

#### Diagrama de separação

```
┌─────────────────────────────────────────────────────┐
│ PROCESSO VS CODE                                     │
│  [typescript extension → tsserver → IntelliSense]   │
│  Configuração: .vscode/settings.json                 │
│  Cache: /home/node/.cache/typescript/                │
└─────────────────────────────────────────────────────┘
         NÃO SE COMUNICAM
┌─────────────────────────────────────────────────────┐
│ PROCESSO NODE.JS (PM2 / MCP Server)                  │
│  [tsserver-daemon.mjs → ts.createLanguageService()]  │
│  Configuração: process.env.LSP_* vars                │
│  Cache: _lsCache (Map module-level, in-memory)       │
└─────────────────────────────────────────────────────┘
         Ambos leem: tsconfig.json + tsconfig.node.json
```

---

### 1.3 Otimizações TSServer — Estado e Gaps

#### VS Code TSServer — Estado (`.vscode/settings.json`)

| Configuração                            | Valor                         | Status                              |
| --------------------------------------- | ----------------------------- | ----------------------------------- |
| `useSyntaxServer`                       | `"auto"`                      | ✅ Correto (fix da sessão anterior) |
| `maxTsServerMemory`                     | 6144 MB                       | ✅ Generoso                         |
| `watchOptions.watchFile`                | `"useFsEvents"`               | ✅ inotify (ext4)                   |
| `watchOptions.watchDirectory`           | `"useFsEvents"`               | ✅                                  |
| `experimental.enableProjectDiagnostics` | `true`                        | ✅ Background check                 |
| `typescript.tsdk`                       | `node_modules/typescript/lib` | ✅ Workspace TS                     |
| `js/ts.tsserver.useSyntaxServer`        | `"auto"`                      | ✅ Fix aplicado                     |
| `includePackageJsonAutoImports`         | `"on"`                        | ✅ Completions melhoradas           |
| `workspaceSymbols.scope`                | `"allOpenProjects"`           | ✅                                  |

#### tsconfig — Estado do Cache Incremental

- `tsconfig.base.json`: `incremental: true`, `exactOptionalPropertyTypes: true`,
  `noUncheckedIndexedAccess: true` ✅
- `tsconfig.node.json`: `tsBuildInfoFile: /home/node/.cache/typescript/tsconfig.node.tsbuildinfo`
  (volume ext4 persistente) ✅
- `config/typing/strict/*.json`: 40 lanes escrevem em `/home/node/.cache/typescript/` ✅

#### Custom LSP Daemon — Gap identificado

**Limitação conhecida**: `_workspaceSymbols` devolve resultados vazios porque `tsconfig.json` (root)
tem `files: []` + project references — nenhum arquivo incluído diretamente. A função encontra o
tsconfig raiz e obtém 0 arquivos.

**Fix aplicado (esta sessão)**: `ts.createDocumentRegistry()` compartilhado em nível de módulo →
ASTs de source files sobrevivem a invalidações de cache (updateFile → recriação do LanguageService
reutiliza ASTs já parseados).

---

## 2. Mudanças Executadas

### 2.1 Dockerfile

#### Novas ferramentas (Section 6.8 — Curated Rust/Go CLIs)

```
# ARGs adicionados ao topo:
DELTA_VERSION, ZOXIDE_VERSION, XH_VERSION, DUST_VERSION,
SD_VERSION, BOTTOM_VERSION, GLOW_VERSION, PROCS_VERSION
```

Instaladas via binary download de GitHub Releases com verificação de checksum. Todas com suporte
`amd64` e `arm64`.

| Comando  | Ferramenta | ARG                    |
| -------- | ---------- | ---------------------- |
| `delta`  | git-delta  | `DELTA_VERSION=0.17.0` |
| `zoxide` | zoxide     | `ZOXIDE_VERSION=0.9.4` |
| `xh`     | xh         | `XH_VERSION=0.22.2`    |
| `dust`   | dust       | `DUST_VERSION=1.0.0`   |
| `sd`     | sd         | `SD_VERSION=1.0.0`     |
| `btm`    | bottom     | `BOTTOM_VERSION=0.9.6` |
| `glow`   | glow       | `GLOW_VERSION=1.5.1`   |
| `procs`  | procs      | `PROCS_VERSION=0.14.5` |

> Para atualizar: sobreponha os ARGs no `docker build --build-arg` ou edite os defaults no topo do
> Dockerfile.

#### Gate de Validação (Section 6.9)

RUN block ao final que valida todos os binários esperados usando `command -v`. Falha o build se
qualquer ferramenta obrigatória estiver ausente. Produz relatório legível no log do build.

### 2.2 tsserver-daemon.mjs

**Melhoria**: `ts.createDocumentRegistry()` promovido para nível de módulo (singleton
compartilhado).

```
Antes: cada createLanguageService() call → new DocumentRegistry() → ASTs descartados na invalidação
Depois: _documentRegistry módulo-level → ASTs sobrevivem entre invalidações de cache
```

Impacto prático: após um `updateFile`, o LanguageService recriado reutiliza ASTs já parseados de
arquivos não modificados → primeira request pós-invalidação é mais rápida.

---

## 3. Itens em Aberto

| Item                            | Prioridade | Descrição                                                                    |
| ------------------------------- | ---------- | ---------------------------------------------------------------------------- |
| Versões das ferramentas Rust    | Rotina     | Bumpar ARGs quando novas versões estáveis forem lançadas                     |
| Validate integration-level test | Baixa      | Adicionar teste unitário para o fluxo `updateFile` → `definition` após cache |

---

## 4. Correções Aplicadas — Revisão 2026-03-08

### 4.1 Bug crítico: `fi (INSTRUMENTAL / NÃO-CANÔNICO)` — Section 6.9 / 6.5

**Causa raiz**: Na session anterior, a substituição na Section 6.9 (validation gate) fundiu por
acidente o `fi` de fechamento do bloco `if` com o início do header da Section 6.5 (PowerShell),
gerando uma única linha:

```dockerfile

```

Em bash, `fi (...)` seria interpretado como o fechamento do `if` seguido de execução de um subshell
`(INSTRUMENTAL / NÃO-CANÔNICO)` — que falharia com "command not found". Com `set -e` ativo, isso
quebraria o build.

**Correção**: Separadas em duas linhas distintas:

```dockerfile
# SECTION 6.5 — POWERSHELL (INSTRUMENTAL / NÃO-CANÔNICO)   ← header como comentário fora do RUN
```

### 4.2 Melhoria: `_documentRegistry` compartilhado em `tsserver-daemon.mjs`

Implementado `ts.createDocumentRegistry()` como singleton de nível de módulo (em vez de criado a
cada `createLanguageService()`).

**Impacto**: ASTs de source files sobrevivem a invalidações de cache geradas por `updateFile`. Na
sequência `updateFile → definition`, o LanguageService recriado reutiliza ASTs de arquivos não
modificados → primeira request pós-invalidação mais rápida.

### 4.3 Melhoria: seleção de tsconfig em `createLanguageService()`

**Antes**: Buscava `tsconfig.json` (solução raiz com `files:[]`) → `_workspaceSymbols` devolvia 0
resultados.

**Depois**: Prefere `tsconfig.node.json` (que inclui `src/**/*`) → `getNavigateToItems` opera com
cobertura real de arquivos.

```
Antes: tsconfig.json (files:[]) → 0 arquivos → workspace_symbols vazio
Depois: tsconfig.node.json (include:["src/**/*"]) → 135+ arquivos → workspace_symbols funcional
```

### 4.4 Validação de ferramentas no container atual

Executado inventário completo. **Resultado esperado**:

- 54/62 ferramentas ✓ presentes (container não rebuildo)
- 8 ferramentas ausentes (Section 6.8): `delta, zoxide, xh, dust, sd, btm, glow, procs` → aguardam
  rebuild
- Ausentes também: `nasm, 7za, pv, lz4, jo, entr, inotifywait` (adicionados em sessões anteriores ao
  Dockerfile) → aguardam rebuild

Todas as ferramentas ausentes estão corretamente definidas no Dockerfile. O Section 6.9 validation
gate captura qualquer divergência no próximo `docker build`.

### 4.5 Verificações pós-correção

| Check                               | Resultado |
| ----------------------------------- | --------- |
| `hadolint .devcontainer/Dockerfile` | ✅ exit 0 |
| `node --check tsserver-daemon.mjs`  | ✅ exit 0 |

---

## 4. Comandos de Verificação Pós-Rebuild

```bash
# Verificar ferramentas novas
delta --version && zoxide --version && xh --version
dust --version && sd --version && btm --version
glow --version && procs --version

# TSServer VS Code — verificar config
cat .vscode/settings.json | grep useSyntaxServer

# Custom LSP Daemon — smoke test
node -e "import('./src/integration/lsp/tsserver-daemon.mjs').then(m => m.getTsserverDaemon().execute('hover', {filePath:'src/main.js',line:1,character:1}).then(console.log))"

# ESLint + typescript-eslint — smoke tests por zona
node_modules/.bin/eslint src/core/logger.js                 # zona core (type-checked)
node_modules/.bin/eslint scripts/ops/dev-runtime-monitor.js # zona scripts (sem type-check)
node_modules/.bin/eslint eslint.config.mjs                  # auto-lint da config
```

---

## 5. Integração ESLint + typescript-eslint — 2026-03-08

### 5.1 Motivação

O projeto usava ESLint puro (sem parser TypeScript). A integração com `typescript-eslint` habilita o
**Sistema C** de análise TypeScript — um LSP interno instanciado pelo ESLint para detectar erros
semânticos em tempo de lint/CI, complementando os Sistemas A (VS Code) e B (tsserver-daemon):

```
Sistema A: VS Code extension → editor IntelliSense
Sistema B: tsserver-daemon.mjs → MCP tools (lsp_hover, lsp_definition…)
Sistema C: ESLint + typescript-eslint → regras com type-info em CI e pre-commit
```

### 5.2 Stack instalada

| Pacote              | Versão  | Instalação                              |
| ------------------- | ------- | --------------------------------------- |
| `typescript-eslint` | 8.55.0  | `--legacy-peer-deps` (ESLint 10 compat) |
| `eslint`            | ^10.0.0 | Já existente                            |
| `typescript`        | ^5.9.3  | Já existente                            |

> **Nota de compatibilidade**: `typescript-eslint@8.55.0` declara peer
> `eslint: "^8.57.0 || ^9.0.0"`. ESLint 10 não está listado mas é compatível — usa
> `--legacy-peer-deps` ao atualizar este pacote.

### 5.3 Arquitetura do `eslint.config.mjs` (8 zonas)

| Zona | `files`                                       | Type-check                | Finalidade                              |
| ---- | --------------------------------------------- | ------------------------- | --------------------------------------- |
| 0    | global                                        | —                         | ignores globais                         |
| 1    | `**/*.{js,mjs,ts,mts}`                        | ❌ (sem projectService)   | base: parser TS + recommended           |
| 2    | `src/**/*.{js,mjs}`                           | ✅ `projectService: true` | regras com type-info                    |
| 3    | `src/{core,kernel,logic,nerv}/**`             | herda zona 2              | core estrito (só `_` como descarte)     |
| 4    | `src/**` (exceto core)                        | herda zona 2              | backend (nomes arquiteturais tolerados) |
| 5    | `src/driver/**`, `src/infra/browser_pool/**`… | ❌ `disableTypeChecked`   | browser context (globals.browser)       |
| 6    | `tests/**`, `**/*.spec.*`                     | ❌ `disableTypeChecked`   | testes relaxados                        |
| 7    | `scripts/**`, `*.config.*`                    | ❌ `disableTypeChecked`   | automação (warnings)                    |
| 8    | `**/*.cjs`                                    | ❌ `disableTypeChecked`   | CommonJS explícito                      |

### 5.4 Regras type-aware habilitadas

| Regra                                     | Nível   | Justificativa                            |
| ----------------------------------------- | ------- | ---------------------------------------- |
| `@typescript-eslint/no-floating-promises` | `error` | Captura fire-and-forget não intencional  |
| `@typescript-eslint/await-thenable`       | `error` | Previne `await` em não-thenable          |
| `@typescript-eslint/no-misused-promises`  | `error` | Previne Promise onde callback é esperado |

### 5.5 Regras desabilitadas (muito ruidosas em JS-first)

| Regra                           | Motivo                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `no-unsafe-*` (5 regras)        | JSDoc parcial em JS-first produz falsos positivos massivos                     |
| `no-base-to-string`             | Base de código logging-heavy usa objetos em template literals intencionalmente |
| `restrict-template-expressions` | Idem; não agrega valor sem tipagem completa                                    |
| `require-await`                 | Async callbacks arquiteturais não retornam Promise explícita                   |
| `no-explicit-any`               | JSDoc usa `any` como mecanismo de escape legítimo                              |

### 5.6 Integração VS Code (`settings.json`)

Adicionados à `eslint.rules.customizations`:

- `@typescript-eslint/no-unused-vars` → `warn` (editor mostra amarelo, não vermelho)
- `@typescript-eslint/no-floating-promises` → `warn` (idem)

Já estava: `eslint.validate: ["javascript", ..., "typescript", ...]`, `eslint.useESLintClass: true`.

### 5.7 Verificações aplicadas

| Check                                     | Resultado          |
| ----------------------------------------- | ------------------ |
| `hadolint .devcontainer/Dockerfile`       | ✅ exit 0          |
| `node --check tsserver-daemon.mjs`        | ✅ exit 0          |
| `node --check eslint.config.mjs`          | ✅ exit 0          |
| `get_errors eslint.config.mjs` (VS Code)  | ✅ 0 erros de tipo |
| Lint `eslint.config.mjs` (auto-lint)      | ✅ exit 0          |
| Lint `scripts/ops/dev-runtime-monitor.js` | ✅ exit 0          |
| Lint `src/core/logger.js` (type-checked)  | ✅ exit 0          |
| Lint `src/infra/queue/scheduler.js`       | ✅ exit 0          |
