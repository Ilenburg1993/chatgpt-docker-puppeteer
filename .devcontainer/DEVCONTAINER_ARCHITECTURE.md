# DevContainer Architecture — ChatGPT Docker Puppeteer

**Versão da imagem**: 1.0 **Data**: 2026-05-11 **Status**: Canônico — fonte única da verdade para
arquitetura do DevContainer **Gerado por**: Auditoria completa pré-rebuild (Copilot)

---

## Índice

1. [Visão Geral](#visão-geral)
2. [Stack e Versões](#stack-e-versões)
3. [Topologia do Build (Dockerfile)](#topologia-do-build-dockerfile)
4. [Configuração do DevContainer (devcontainer.json)](#configuração-do-devcontainer-devcontainerjson)
5. [Volumes e Cache Persistente](#volumes-e-cache-persistente)
6. [Topologia de Portas](#topologia-de-portas)
7. [Variáveis de Ambiente](#variáveis-de-ambiente)
8. [Lifecycle Scripts](#lifecycle-scripts)
9. [Contrato de Shell e NSS Gatekeeper](#contrato-de-shell-e-nss-gatekeeper)
10. [Arquitetura de Browser (Chrome / Puppeteer)](#arquitetura-de-browser-chrome--puppeteer)
11. [BuildKit e Cache de Build](#buildkit-e-cache-de-build)
12. [Watchdog de Arquivos (File Watching)](#watchdog-de-arquivos-file-watching)
13. [Gaps e Decisões Registradas](#gaps-e-decisões-registradas)

---

## Visão Geral

O DevContainer provisiona um ambiente Node.js 24 + Debian Bookworm (via imagem Microsoft
DevContainers) com:

- **Puppeteer em modo `connect`**: sem `puppeteer.launch()` no processo. O Chrome externo (Windows,
  porta 9225) é exposto ao container via proxy CDP na porta 9224.
- **PM2**: gerencia 3 processos — `agente-gpt`, `dashboard-web`, `chrome-proxy`.
- **14 volumes Docker nomeados** para persistência de cache, estado e identidade entre rebuilds.
- **NSS Wrapper Gatekeeper**: identidade dinâmica de usuário via `libnss_wrapper.so` + artefatos em
  `/tmp/devcontainer-nss/`.
- **dumb-init**: entrypoint semântico que garante reaping correto de processos filho.

---

## Stack e Versões

### Imagem Base

| Campo   | Valor                                                           |
| ------- | --------------------------------------------------------------- |
| Imagem  | `mcr.microsoft.com/devcontainers/javascript-node:24-bookworm`   |
| OS      | Debian 12 (Bookworm)                                            |
| Node.js | v24 LTS (tag `24-bookworm` atualiza automaticamente no rebuild) |

### Ferramentas Pinadas no Dockerfile

| Ferramenta                 | Versão Pinada | ARG                                  |
| -------------------------- | ------------- | ------------------------------------ |
| npm                        | 11.14.1       | `NPM_VERSION`                        |
| pnpm                       | 11.1.0        | `PNPM_VERSION`                       |
| @devcontainers/cli         | 0.86.1        | `DEVCONTAINER_CLI_VERSION`           |
| gh (GitHub CLI)            | 2.92.0        | `GH_VERSION`                         |
| actionlint                 | 1.7.12        | `ACTIONLINT_VERSION`                 |
| hadolint                   | 2.14.0        | `HADOLINT_VERSION`                   |
| typescript                 | 6.0.3         | `TYPESCRIPT_VERSION`                 |
| typescript-language-server | 5.2.0         | `TYPESCRIPT_LANGUAGE_SERVER_VERSION` |
| jsonc-parser               | 3.3.1         | (build-time, inline)                 |

**Como atualizar**: editar os ARGs no topo do Dockerfile e fazer rebuild completo.

### Ferramentas de Sistema (via apt)

Instaladas como pacotes Debian sem pin de versão (usam o que estiver em `stable bookworm`):

- git, vim, htop, bat, ripgrep, fd-find, fzf, sqlite3, redis-tools
- shellcheck, yamllint, actionlint, hadolint (curated upstream), gh (curated upstream)
- watchman, hyperfine, socat, mtr-tiny, cloc, ccache, graphviz, graphviz
- jq, yq, gdb, heaptrack, strace, ltrace
- Docker CE CLI + compose plugin + buildx plugin
- PowerShell (via repositório Microsoft)
- Chromium (fallback técnico para Puppeteer)

---

## Topologia do Build (Dockerfile)

O Dockerfile é organizado em 10 seções canônicas:

| Seção | Conteúdo                                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------- |
| 0     | Base image, shell global (`set -eo pipefail`), metadados OCI (LABEL)                                       |
| 1     | Identidade, caminhos (`APP_DIR`, `HOME_DIR`, `XDG_*`)                                                      |
| 2     | Locale (pt_BR.UTF-8), TZ (America/Sao_Paulo), libnss-wrapper, openssh-client                               |
| 3     | Toolchain Node.js (node-gyp, cmake, python3), npm global em `/usr/local/share/npm-global`                  |
| 4     | Chromium fallback + bibliotecas headless (GTK, X11, NSS, etc.), gdb, heaptrack                             |
| 5     | Fontes (Noto, DejaVu, Liberation, JetBrains Mono, CJK, emoji)                                              |
| 6     | CLIs dev (git, bat, ripgrep, fd-find, fzf, shellcheck, etc.) + binários curated (gh, actionlint, hadolint) |
| 6.5   | PowerShell (instrumental, não-canônico)                                                                    |
| 6.6   | Contrato PowerShell global (`/etc/powershell/PowerShell.Contract.ps1`)                                     |
| 7     | Docker CE CLI + compose + buildx; alinhamento de GID                                                       |
| 8     | Estrutura de filesystem do usuário (`node`); diretórios XDG, `.ssh`, `.gnupg`, etc.                        |
| 8.5   | ENV defaults (NODE_ENV, SERVER_PORT, BROWSER_POOL_SIZE, etc.)                                              |
| 9     | bash-completion, dumb-init; `/etc/profile.d/` (contratos de shell, NSS gatekeeper, UX baseline)            |
| 10    | `USER node`, `WORKDIR /workspaces/chatgpt-docker-puppeteer`, `ENTRYPOINT`, `CMD`                           |

### Entrypoint

```
ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/nss-gatekeeper"]
CMD ["sleep", "infinity"]
```

O `nss-gatekeeper` ativa o NSS wrapper antes de entregar o controle ao VS Code. O container fica
vivo com `sleep infinity`; o VS Code Server é iniciado pelo DevContainer runtime.

### BuildKit e Cache de Build

A partir da v5.4.0, o Dockerfile usa `# syntax=docker/dockerfile:1` para habilitar:

- `--mount=type=cache` em todos os blocos `apt-get` → pacotes apt cacheados entre rebuilds
- `--mount=type=cache` no `npm install -g` global → módulos npm cacheados entre rebuilds

Isso reduz significativamente o tempo de rebuild incremental (quando apenas camadas finais mudam).

---

## Configuração do DevContainer (devcontainer.json)

### Build Args Relevantes

| ARG           | Valor                      | Propósito                    |
| ------------- | -------------------------- | ---------------------------- |
| `VERSION`     | `1.0`                      | Versão do contrato da imagem |
| `REMOTE_USER` | `node`                     | Usuário do container         |
| `BUILD_ENV`   | `dev`                      | Ambiente de build            |
| `IMAGE_NAME`  | `chatgpt-docker-puppeteer` | Nome da imagem               |

### runArgs Importantes

```json
"--env-file", "${localWorkspaceFolder}/.env.development",
"--add-host=host.docker.internal:host-gateway",
"--shm-size=4g",
"--ulimit", "nofile=262144:262144",
"--group-add=docker"
```

- `--env-file .env.development`: injeta variáveis de processo do host (API keys, etc.)
- `--add-host=host.docker.internal:host-gateway`: permite acesso ao host Windows (`CHROME_HOST`)
- `--shm-size=4g`: essencial para Chrome/Chromium headless
- `--ulimit nofile=262144:262144`: previne falhas de file descriptor em workloads intensos

### containerEnv vs remoteEnv

- **`containerEnv`**: injetado no nível do daemon Docker (disponível para todos os processos)
- **`remoteEnv`**: injetado pelo VS Code Server (disponível para terminais e extensões VS Code)

Variáveis críticas estão em `containerEnv` para garantir disponibilidade antes do VS Code.

---

## Volumes e Cache Persistente

### 14 Volumes Nomeados (v5.3+)

| Volume                         | mountpoint                     | Propósito                                      |
| ------------------------------ | ------------------------------ | ---------------------------------------------- |
| `devcontainer-cache`           | `/home/node/.cache`            | Cache geral (overlay para todos os sub-caches) |
| `devcontainer-puppeteer-cache` | `/home/node/.cache/puppeteer`  | Cache Puppeteer (binários Chrome)              |
| `devcontainer-ts-cache`        | `/home/node/.cache/typescript` | Cache TypeScript / tsserver                    |
| `devcontainer-npm-cache`       | `/home/node/.npm`              | Cache npm (pacotes locais)                     |
| `devcontainer-npm-global`      | `/home/node/.npm-global`       | npm global do usuário (runtime)                |
| `devcontainer-pm2-state`       | `/home/node/.pm2`              | Estado PM2 (logs, pids, config)                |
| `devcontainer-user-config`     | `/home/node/.config`           | Config XDG (extensões, ferramentas)            |
| `devcontainer-local-share`     | `/home/node/.local/share`      | Dados compartilhados XDG (RAG DB, etc.)        |
| `devcontainer-local-state`     | `/home/node/.local/state`      | Estado XDG (histórico, etc.)                   |
| `devcontainer-claude-state`    | `/home/node/.claude`           | Estado do agente Claude                        |
| `devcontainer-gpg-cache`       | `/home/node/.gnupg`            | Chaves GPG                                     |
| `devcontainer-vscode-server`   | `/home/node/.vscode-server`    | VS Code Server (extensões, estado)             |
| `devcontainer-bash-history`    | `/home/node-history`           | Histórico de bash                              |
| _(bind mount)_                 | `/var/run/docker.sock`         | Docker socket do host                          |

### Hierarquia de Prioridade de Mount

O volume `devcontainer-cache` monta `/home/node/.cache`. Os volumes `devcontainer-puppeteer-cache` e
`devcontainer-ts-cache` montam subdiretórios específicos, **sobrepondo** o volume pai. Isso garante
que puppeteer e typescript caches sejam persistidos em volumes dedicados.

### Dados NOT Persistidos (sem volume dedicado)

- `~/.ssh`: chaves SSH (transitórias — SSH forwarding via VS Code nativo, não socket)
- `~/.npm` no nível raiz já está coberto por `devcontainer-npm-cache`

---

## Topologia de Portas

| Porta | Serviço                                 | Direção          | `onAutoForward` |
| ----- | --------------------------------------- | ---------------- | --------------- |
| 3008  | Dashboard (HTTP + Socket.io + API REST) | Container → Host | `notify`        |
| 5173  | Vite Dev Server (HMR)                   | Container → Host | `notify`        |
| 9224  | Chrome CDP Proxy (entrada do Puppeteer) | Container → Host | `ignore`        |
| 9225  | Chrome Real (Windows)                   | Host externo     | Não fordwardado |
| 9229  | Node.js Debug primário                  | Container → Host | `silent`        |
| 9230  | Node.js Debug fallback                  | Container → Host | `silent`        |

**Política**: `"*": { "onAutoForward": "ignore" }` — deny-by-default para portas não listadas.

### Fluxo de Conexão Chrome

```
Chrome.exe (Windows, porta 9225)
    ↓  TCP/WebSocket
chrome-proxy (PM2, porta 9224 container)
    ↓  CDP / WebSocket
Puppeteer (Node.js, container)
```

---

## Variáveis de Ambiente

### Taxonomia (v6.0)

Variáveis são classificadas em 4 categorias:

| Categoria      | Exemplos                                                         | Ausência                   |
| -------------- | ---------------------------------------------------------------- | -------------------------- |
| STRUCTURAL     | `NODE_ENV`, `SERVER_MODE`, `SERVER_AUTHORITY`, `BROWSER_MODE`    | FATAL (qualquer env)       |
| INFRASTRUCTURE | `SERVER_PORT`, `CHROME_HOST`, `CHROME_PORT`, `CHROME_PROXY_PORT` | FATAL em prod, WARN em dev |
| OPERATIONAL    | `BROWSER_POOL_SIZE`, `LOG_LEVEL`, `ALLOW_DEGRADED_MODE`          | WARN em prod, INFO em dev  |
| FEATURE FLAGS  | `MOCK_CHROME`, `PUPPETEER_LOCAL_LAUNCH_DISABLED`                 | INFO                       |

### Fontes de ENV (ordem de precedência)

1. `runArgs --env-file .env.development` (mais alta prioridade — segredos locais)
2. `remoteEnv` (VS Code Server — override por usuário/sessão)
3. `containerEnv` (daemon Docker — disponível para todos os processos)
4. `ENV` no Dockerfile (defaults da imagem)
5. Bootstrap da app (`.env` → `.env.${NODE_ENV}` → `.env.local`)

### Variáveis de Polling de File Watching (Decisão v5.4.0)

A partir da v5.4.0, as seguintes variáveis foram **removidas de `containerEnv`**:

| Variável              | Valor anterior | Motivo da remoção                                                                                                                                                         |
| --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHOKIDAR_USEPOLLING` | `"true"`       | Filesystem é ext4 (inotify nativo funciona). Vite já configurado via `vite.config.js` com `watch.usePolling: true` explícito. Sem outros usuários de chokidar no projeto. |
| `CHOKIDAR_INTERVAL`   | `"1000"`       | Removido junto com `CHOKIDAR_USEPOLLING`.                                                                                                                                 |
| `WATCHPACK_POLLING`   | `"true"`       | Projeto não usa webpack. Completamente não utilizado.                                                                                                                     |

**Nota**: `src/dashboard-ui/vite.config.js` mantém `watch: { usePolling: true, interval: 100 }`
hardcoded — isso é suficiente e apropriado para o servidor de desenvolvimento Vite em ambiente
Docker.

---

## Lifecycle Scripts

| Hook                | Script                   | Versão | Política de Falha                                   |
| ------------------- | ------------------------ | ------ | --------------------------------------------------- |
| `postCreateCommand` | `scripts/post-create.sh` | v1.0.1 | `set -Eeuo pipefail` — falha = container inoperante |
| `postStartCommand`  | `scripts/post-start.sh`  | v1.1   | `set +e` — nunca bloqueia o start                   |
| `postAttachCommand` | `scripts/post-attach.sh` | v5.3.1 | `set +e` — nunca bloqueia o attach                  |

### post-create.sh (v1.0.1)

- Bootstrap completo: identidade, ENV, mounts, NSS, npm install, dependências do projeto
- Transacional: marker `/tmp/post-create.in-progress` / `/tmp/post-create.done`
- Modo REPLAY: se marker `in-progress` existir, re-executa com `REEXECUTE_POST_CREATE=true`
- Logs: `/workspaces/chatgpt-docker-puppeteer/.devcontainer/logs/post-create.log`
- Error snapshots: `.devcontainer/logs/env_error_snapshot_*.txt` (criados por `_on_err`)

### post-start.sh (v1.1)

- Auditoria fail-safe: NSS artifacts, SSH, make info
- Escreve status em `.devcontainer/state/health.status` (`ok` / `degraded`)
- Executa `sync-local-auth.sh` se disponível

### post-attach.sh (v5.3.1)

- UX exclusivo: exibe diagnóstico do ambiente no terminal do dev
- Suporta flags: `--brief` (suprime detalhes), `--help`, `--version`
- Nunca falha, nunca bloqueia

### healthcheck.sh (v2.0)

- Instalado em `/usr/local/bin/devcontainer-healthcheck.sh`
- Declarado também como `HEALTHCHECK` nativo da imagem (Docker)
- Checks: Node.js (CRÍTICO), VS Code Server (informativo), CDP proxy (informativo), Chromium local
  (informativo)
- Exit 0 = healthy, Exit 1 = unhealthy (apenas se Node.js não disponível)

---

## Contrato de Shell e NSS Gatekeeper

### Shell Canônico: bash

```
SHELL_CANONICAL=bash
INSTRUMENTAL_SHELLS=pwsh
```

PowerShell é **instrumental** (para inspeção/diagnóstico) — não substitui bash para automação.

### NSS Gatekeeper — Fluxo

```
Container start
    ↓
nss-gatekeeper (ENTRYPOINT)
    → Cria seed mínimo em /tmp/devcontainer-nss/ (passwd + group)
    → Ativa LD_PRELOAD com libnss_wrapper.so
    → Executa CMD (sleep infinity)
    ↓
post-create.sh
    → Refina artefatos NSS com UID/GID reais
    → Valida coerência
    ↓
/etc/profile.d/10-gatekeeper-nss.sh
    → Ativa NSS em cada shell interativo (se artefatos presentes)
```

O NSS wrapper resolve a identidade do usuário (`id -un` retorna `node`) mesmo quando o UID mapeado
pelo host difere do UID na imagem.

### Paths do NSS Wrapper

| Path                                          | Conteúdo                             |
| --------------------------------------------- | ------------------------------------ |
| `/tmp/devcontainer-nss/passwd`                | Dados de usuário para libnss_wrapper |
| `/tmp/devcontainer-nss/group`                 | Dados de grupo para libnss_wrapper   |
| `/usr/lib/x86_64-linux-gnu/libnss_wrapper.so` | Biblioteca NSS (instalada via apt)   |

---

## Arquitetura de Browser (Chrome / Puppeteer)

### Topologia

```
[Windows Host]
    Chrome.exe → DevTools (porta 9225) → WSL2

[Container]
    chrome-proxy (PM2) → escuta 9224 → redireciona → host.docker.internal:9225
    Puppeteer → conecta em localhost:9224 via CDP/WebSocket
```

### Configuração

| Variável                          | Valor padrão           | Descrição                         |
| --------------------------------- | ---------------------- | --------------------------------- |
| `CHROME_HOST`                     | `host.docker.internal` | Endereço do Chrome real (Windows) |
| `CHROME_PORT`                     | `9225`                 | Porta do Chrome real              |
| `CHROME_PROXY_PORT`               | `9224`                 | Porta do proxy CDP no container   |
| `CHROME_PROXY_BIND`               | `0.0.0.0`              | Bind do proxy                     |
| `PUPPETEER_LOCAL_LAUNCH_DISABLED` | `true`                 | Proíbe `puppeteer.launch()`       |
| `BROWSER_MODE`                    | `wsEndpoint`           | Modo de conexão (CDP)             |

### Chromium Local (Fallback Técnico)

O Chromium instalado via apt (`/usr/bin/chromium`) é um **fallback técnico**, não a rota primária.
Ele existe para:

- Compatibilidade técnica com testes que precisam de um browser local
- Emergências onde o Chrome Windows não está disponível
- `MOCK_CHROME=0` mantém o comportamento real

---

## BuildKit e Cache de Build

### Diagnóstico de Build

Para visualizar layers e cache durante rebuild:

```bash
# Build com output detalhado
docker build --progress=plain --no-cache .devcontainer/

# Inspecionar layers da imagem atual
docker history <imagem>
```

### Cache Mounts (v5.4.0+)

Com `# syntax=docker/dockerfile:1` no topo do Dockerfile, cada bloco `apt-get` usa:

```dockerfile
RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt,sharing=locked --mount=type=cache,id=apt-lib,target=/var/lib/apt,sharing=locked apt-get update && apt-get install -y --no-install-recommends ...
```

O npm global também usa cache mount:

```dockerfile
RUN --mount=type=cache,id=npm-global-cache,target=/root/.npm,sharing=locked npm install -g ...
```

**Impacto**: rebuilds com apenas mudanças em camadas tardias (ex: scripts, ENV) se beneficiam do
cache apt do BuildKit, sem baixar pacotes novamente.

---

## Watchdog de Arquivos (File Watching)

### Filesystem Real do Workspace

O workspace (`/workspaces/chatgpt-docker-puppeteer`) é montado como **ext4** (inotify nativo
funciona):

```
/dev/sdf /workspaces/chatgpt-docker-puppeteer ext4 rw,relatime ...
```

### Watchers em Uso

| Componente           | Mecanismo                      | Configuração                                                |
| -------------------- | ------------------------------ | ----------------------------------------------------------- |
| Vite HMR             | chokidar (interno, via config) | `watch.usePolling: true, interval: 100` em `vite.config.js` |
| Server log watcher   | `fs.watch()` nativo Node.js    | Sem dependência de chokidar                                 |
| Server queue watcher | `fs.watch()` nativo Node.js    | Sem dependência de chokidar                                 |

**Nota**: `CHOKIDAR_USEPOLLING` env var foi removida (v5.4.0) pois `vite.config.js` já gerencia o
polling explicitamente e os demais watchers usam `fs.watch()` nativo.

---

## Gaps e Decisões Registradas

### [DEC-001] Remoção de CHOKIDAR_USEPOLLING (v5.4.0)

- **Decisão**: Removido de `containerEnv`
- **Racional**: ext4 nativa funciona com inotify; vite.config.js já configura polling
  explicitamente; sem outros usuários de chokidar
- **Risco**: Baixo — Vite mantém sua própria configuração de polling

### [DEC-002] Remoção de WATCHPACK_POLLING (v5.4.0)

- **Decisão**: Removido de `containerEnv`
- **Racional**: Projeto usa Vite (não webpack); variável não tem efeito detectável
- **Risco**: Nulo

### [DEC-003] BuildKit cache mounts (v5.4.0)

- **Decisão**: Adicionado `# syntax=docker/dockerfile:1` + cache mounts em todos os blocos apt/npm
- **Racional**: Reduz tempo de rebuild significativamente quando layers iniciais não mudam
- **Impacto**: Requer BuildKit ativo (Docker 23.0+ ou `DOCKER_BUILDKIT=1`). Docker Desktop 4.63.0
  habilita BuildKit por default.

### [DEC-004] SSH via VS Code nativo (v5.3)

- **Decisão**: SSH forwarding via VS Code (não socket bind)
- **Racional**: Mais seguro, zero configuração, funciona em Windows/WSL2/Linux
- **Referência**: `MIGRATION_SSH_V5.3.md` (histórico)

### [DEC-005] npm global split: `/usr/local/share/npm-global` vs `~/.npm-global`

- **Decisão**: Tooling canônico da imagem fica em `/usr/local/share/npm-global` (imagem). Tooling do
  usuário em runtime fica em `~/.npm-global` (volume).
- **Racional**: Volumes mascaram layers da imagem. Tooling de imagem não deve ficar em path
  volumado.

### [GAP-001] health.status pode estar vazio

- **Condição**: `post-start.sh` escreve `ok` ou `degraded` em `.devcontainer/state/health.status`.
  Se o container for reiniciado sem `post-start.sh` executar (ex: via `docker restart`), o arquivo
  pode estar vazio.
- **Impacto**: Apenas diagnóstico — sem impacto operacional.

### [GAP-002] Error snapshots acumulados em logs/

- **Condição**: Cada execução interrompida de `post-create.sh` gera `env_error_snapshot_*.txt` em
  `.devcontainer/logs/`.
- **Causa comum**: SIGTERM/SIGKILL externo (ex: rebuild de container com container anterior ainda
  running) — não indica bug no script.
- **Ação**: Limpar periodicamente com `rm -f .devcontainer/logs/env_error_snapshot_*.txt`.
