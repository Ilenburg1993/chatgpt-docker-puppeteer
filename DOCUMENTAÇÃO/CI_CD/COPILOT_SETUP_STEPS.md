# COPILOT_SETUP_STEPS — Documentação do Bootstrap do Agente

**Arquivo**: `.github/workflows/copilot-setup-steps.yml` **Versão**: 3.1 **Atualizado**: 2026-03-02
**Status**: Canônico

---

## O que é este workflow?

O `copilot-setup-steps.yml` é executado automaticamente pelo **GitHub Copilot Coding Agent** antes
de iniciar qualquer sessão de trabalho autônoma. Ele **não é um CI comum**: é o bootstrap exclusivo
do agente, rodando em um runner efêmero que precisa de ambiente completo para operar com máxima
autonomia.

> Referência oficial:
> <https://docs.github.com/en/copilot/customizing-copilot/customizing-the-development-environment-for-copilot-coding-agent>

---

## Visão geral da arquitetura de cache (v3.1)

O workflow usa **cache multicamadas** para reduzir o tempo de setup de ~10 minutos (cold) para ~2–3
minutos (warm hit):

```
Camada 1: setup-node@v4 cache:npm
  └── ~/.npm (npm registry cache)
  └── Chave: hash de package-lock.json
  └── Ação: automática via actions/setup-node

Camada 2: actions/cache@v4 — dashboard-ui node_modules
  └── src/dashboard-ui/node_modules
  └── Chave: runner.os + hash de src/dashboard-ui/package-lock.json
  └── Miss: npm ci no dashboard-ui (~40s)

Camada 3: actions/cache@v4 — ferramentas globais npm
  └── ~/npm-global (prefixo isolado)
  └── Contém: pm2, tsc, pnpm, ts-lsp, devcontainer CLI, jsonc-parser
  └── Chave: runner.os + hash do próprio arquivo de workflow
  └── Miss: npm install -g (~90s)

Camada 4: actions/cache@v4 — packages Python
  └── ~/.cache/pip
  └── Chave: runner.os + hash de requirements*.txt e agents/**/*.py
  └── Miss: negligível (apenas se requirements.txt mudar)
```

---

## Mirror do DevContainer (sincronização de versões)

O workflow espelha **exatamente** as versões definidas como `ARG` no `.devcontainer/Dockerfile`. Ao
atualizar o Dockerfile, **atualize também as variáveis `env:` do workflow**.

| Variável                   | Versão atual | Equivalente no Dockerfile |
| -------------------------- | ------------ | ------------------------- |
| `NPM_VERSION`              | `12.0.2`     | `ARG NPM_VERSION`         |
| `GH_VERSION`               | `2.92.0`     | `ARG GH_VERSION`          |
| `ACTIONLINT_VERSION`       | `1.7.12`     | `ARG ACTIONLINT_VERSION`  |
| `HADOLINT_VERSION`         | `2.14.0`     | `ARG HADOLINT_VERSION`    |
| `YQ_VERSION`               | `4.53.2`     | `ARG YQ_VERSION`          |
| `TS_VERSION`               | `7.0.2`      | `ARG TYPESCRIPT_VERSION`  |
| `DEVCONTAINER_CLI_VERSION` | `0.86.1`     | @devcontainers/cli        |

---

## Estrutura dos steps (v3.0)

| #   | Step                                 | Crítico?   | Tempo (cold) | Tempo (warm) |
| --- | ------------------------------------ | ---------- | ------------ | ------------ |
| 0   | Checkout (`fetch-depth:0`)           | ✅ Sim     | ~5s          | ~5s          |
| 1   | Setup Node.js 24 + npm cache         | ✅ Sim     | ~10s         | ~3s          |
| –   | Verify Node.js runtime               | ✅ Sim     | ~1s          | ~1s          |
| 2   | Configure npm global prefix          | ✅ Sim     | ~1s          | ~1s          |
| 3   | Cache: ferramentas globais npm       | ✅ Sim     | ~1s          | ~1s          |
| 4   | Cache: dashboard-ui deps             | ✅ Sim     | ~1s          | ~1s          |
| 5   | Cache: Python pip                    | ✅ Sim     | ~1s          | ~1s          |
| 6a  | apt: ferramentas base                | ✅ Sim     | ~30s         | ~30s         |
| 6b  | apt: ferramentas especializadas      | 🟡 Parcial | ~20s         | ~20s         |
| 7   | Python 3 + build tools               | ✅ Sim     | ~20s         | ~20s         |
| 8   | Docker CLI [opcional]                | ❌ Não     | ~30s         | ~30s         |
| 9   | yq [opcional]                        | ❌ Não     | ~3s          | ~3s          |
| 10  | gh CLI (com checksum) [opcional]     | ❌ Não     | ~10s         | ~10s         |
| 11  | actionlint + hadolint (com checksum) | ❌ Não     | ~10s         | ~10s         |
| 12  | Ferramentas globais npm              | ✅ Sim     | ~90s         | **~2s**      |
| –   | Verificar ferramentas globais        | ✅ Sim     | ~2s          | ~2s          |
| 13  | npm ci (projeto raiz)                | ✅ Sim     | ~60s         | ~20s         |
| –   | Verificar módulos nativos [opcional] | ❌ Não     | ~5s          | ~5s          |
| 14a | dashboard-ui: npm ci                 | ✅ Sim     | ~40s         | **~2s**      |
| 14b | dashboard-ui: build [opcional]       | ❌ Não     | ~30s         | ~30s         |
| 15  | Git config                           | ✅ Sim     | ~1s          | ~1s          |
| 16a | Lint smoke check [opcional]          | ❌ Não     | ~15s         | ~15s         |
| 16b | Testes unitários baseline [opcional] | ❌ Não     | ~30s         | ~30s         |
| 17  | Environment summary                  | ✅ Sim     | ~5s          | ~5s          |

**Total estimado (cold)**: ~8–10 min **Total estimado (warm)**: ~3–4 min

---

## Ferramentas disponíveis para o agente

Após o setup, o agente tem acesso a:

### Runtime

- **Node.js 24 LTS** — runtime canônico do projeto
- **npm 12.0.2** — versão canônica e única do package manager
- **Python 3** — para scripts Python e agentes
- **PM2** — daemon de produção (global)

### TypeScript / Tipagem

- **tsc 7.0.2 nativo** — compilador TypeScript e servidor `--lsp --stdio`
- Nenhum `typescript-language-server` ou daemon LSP local é instalado/iniciado
- Permite: `npm run typecheck:*`, `npm run typecheck:watch:node`

### Linting / Qualidade

- **ESLint** (via `node_modules/.bin`) — `npm run lint`
- **Prettier** (via `node_modules/.bin`) — `npm run format`
- **shellcheck** — scripts shell
- **yamllint** — arquivos YAML
- **actionlint** — workflows GitHub Actions
- **hadolint** — Dockerfile

### DevOps / Git

- **gh CLI 2.87.3** — GitHub CLI para PRs, issues, releases
- **Docker CLI** (sem dockerd) — `docker`, `docker compose`
- **git** (com fetch-depth: 0) — histórico completo, diff, blame
- **git-lfs** — Large File Storage (disponível, não ativo)

### Navegação / Análise

- **ripgrep (rg)** — busca ultrarrápida de código
- **fd** — find moderno
- **fzf** — fuzzy finder
- **bat** — cat com syntax highlight
- **jq / yq** — processamento JSON/YAML
- **graphviz (dot)** — diagramas de dependências
- **cloc** — contagem de linhas de código
- **sqlite3** — banco de dados (usado por `better-sqlite3`)

### Diagnóstico / Rede

- **htop, lsof, procps** — monitoramento de processos
- **nmap, netcat, socat, mtr** — ferramentas de rede
- **strace, sysstat** — diagnóstico de sistema
- **redis-tools** — cli Redis
- **postgresql-client** — cli PostgreSQL

---

## Scripts npm disponíveis

O agente pode executar qualquer script do `package.json`. Os mais relevantes:

```bash
# Qualidade de código (obrigatório antes de commit)
npm run lint         # ESLint no projeto inteiro
npm run format:check # Prettier (verificação)
npm run format       # Prettier (auto-fix)

# Testes
npm run test:unit        # Testes unitários (node --test)
npm run test:fast        # Suite rápida
npm run test:integration # Testes de integração
npm run test:all         # Tudo

# TypeScript / Tipagem
npm run typecheck:node       # tsserver no src/
npm run typecheck:full       # Todos os tsconfigs
npm run typecheck:strict     # Modo strict
npm run typecheck:watch:node # Watch mode

# Build
npm run build           # Build do projeto
npm run dashboard:build # Build do frontend

# Validação de infraestrutura
npm run check:workflows       # Valida workflows
npm run check:workflows:lint  # actionlint
npm run check:dockerfile:lint # hadolint
npm run check:devcontainer    # devcontainer validate

# Auditoria
npm run audit:run    # Auditoria noturna completa
npm run audit:health # Health check rápido

# Daemon
npm run daemon:start   # PM2 start
npm run daemon:stop    # PM2 stop
npm run daemon:restart # PM2 restart
npm run daemon:status  # PM2 status

# Queue
npm run queue:status # Status da fila
npm run queue:add    # Adicionar tarefa

# Diagnóstico
npm run diagnose     # Diagnóstico completo
npm run analyze:deps # Dependências circulares
```

---

## Feature: `snapshot: true`

O workflow habilita `snapshot: true` no job. Isso permite ao Copilot Coding Agent **restaurar o
ambiente a partir de um snapshot** após o primeiro setup (prime), evitando re-executar todos os
steps em iterações subsequentes da mesma sessão.

> Esta feature está disponível na plataforma GitHub Copilot desde 2025. Consulte a documentação
> oficial para detalhes sobre suporte de runner e versionamento de snapshots.

---

## Segredos e variáveis sensíveis

O workflow **não expõe segredos diretamente** no arquivo. Para configurar tokens e chaves para o
agente:

1. Vá em **Settings → Environments → New environment → `copilot`**
2. Adicione secrets como `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc.
3. O Copilot Coding Agent recebe seu próprio token para operações Git; este workflow usa apenas
   `contents: read`

---

## Como atualizar as versões das ferramentas

Ao atualizar o `.devcontainer/Dockerfile` com novas versões de ferramentas:

1. Localize os `ARG` no Dockerfile (seção "ARGs de versão"):

   ```dockerfile
   ARG NPM_VERSION=11.11.0
   ARG PNPM_VERSION=10.30.3
   ARG GH_VERSION=2.87.3
   # etc.
   ```

2. Atualize as variáveis correspondentes no `env:` do workflow:

   ```yaml
   env:
     NPM_VERSION: '11.11.0'
     PNPM_VERSION: '10.30.3'
     GH_VERSION: '2.87.3'
   ```

3. Incremente a versão do `restore-keys` das caches que usam essas ferramentas:

   ```yaml
   key: ${{ runner.os }}-npm-global-v3-${{ hashFiles(...) }}
   #                               ^^^
   #                     incrementar para v4, v5, etc.
   ```

   Isso força um cache miss na próxima execução para instalar as novas versões.

4. Atualize a tabela de versões nesta documentação.

---

## Troubleshooting

### Setup demorou mais que 15 minutos (cold)

- Esperado na primeira execução — aguarde o cache ser populado
- Nas execuções seguintes será ~3–4 min

### Erro em `better-sqlite3` (node-gyp)

- Garanta que `build-essential` e `python3` foram instalados antes de `npm ci`
- O step 7 (Python + build tools) precisa rodar antes do step 13 (npm ci)
- Verifique se a versão do Node.js é >= 24 (`node --version`)

### `cache-hit != 'true'` sempre falso (cache miss constante)

- Verifique se o hash file existe: `src/dashboard-ui/package-lock.json`
- Para ferramentas globais: qualquer mudança no workflow invalida o cache (por design)

### `snapshot: true` não funciona

- Feature progressiva; se não for suportada no runner atual, o job roda normalmente sem snapshot
- Não afeta o funcionamento do agente

### gh CLI: checksum falhou

- A versão `GH_VERSION` pode ter sido removida do GitHub; atualize para a versão mais recente
- O step tem `continue-on-error: true`, então não bloqueia o agente

---

## Histórico de versões

| Versão | Data       | Mudanças principais                                         |
| ------ | ---------- | ----------------------------------------------------------- |
| 1.0    | 2025-xx-xx | Bootstrap inicial                                           |
| 2.0    | 2026-02-28 | Full autonomy bootstrap, divisão crítico/opcional           |
| 3.0    | 2026-03-01 | Cache multicamadas, mirror Dockerfile, Docker CLI, snapshot |

---

## Changelog

### v3.1 (2026-03-02) — Correção de bugs críticos

| Bug                           | Descrição                                                  | Correção                                 |
| ----------------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| `actions/checkout@v4`         | Versão desatualizada inconsistente com os demais workflows | Atualizado para `@v6`                    |
| `actions/setup-node@v4`       | Versão desatualizada                                       | Atualizado para `@v6`                    |
| `actions/cache@v5`            | Tag `@v5` não existe — causa falha silenciosa              | Corrigido para `@v4`                     |
| `NPM_GLOBAL_PREFIX` em `env:` | Variável `$HOME` não expande em blocos YAML `env:`         | Movido para step shell via `$GITHUB_ENV` |
| Nomes de steps com `${VAR}`   | `${{ env.VAR }}` não expande em campo `name:` do YAML      | Nomes limpos, sem interpolação           |
| `snapshot: true`              | Causa falso positivo no actionlint                         | Comentado com explicação inline          |

### v3.0 (2026-03-01) — Release inicial

- Setup multicamada de cache (4 camadas)
- Mirror completo do DevContainer Dockerfile
- Ferramentas globais npm via npm install -g
- gh CLI + actionlint + hadolint com verificação de checksum SHA-256
- PM2, TypeScript, pnpm, ts-language-server, devcontainer CLI
- snapshot: true habilitado (suporte da plataforma Copilot)
