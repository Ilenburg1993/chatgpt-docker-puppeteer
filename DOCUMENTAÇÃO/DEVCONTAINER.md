# DEVCONTAINER — .devcontainer/devcontainer.json

> **Build arguments**: the Dockerfile now supports `ARG INSTALL_ZSH` (default `0`). Set
> `--build-arg INSTALL_ZSH=1` when running `docker build` to include `zsh` in the image. This is
> useful for developers who prefer zsh as their interactive shell without polluting the default bash
> runtime.

Este documento explica a configuração presente em `.devcontainer/devcontainer.json` do projeto
`chatgpt-docker-puppeteer`, descreve riscos, recomendações e procedimentos de verificação.

## Visão Geral

Os **scripts de lifecycle** (`post-create.sh`, `post-start.sh`, `post-attach.sh`) passaram
recentemente por uma modularização profunda (fev‑mar‑2026). Em vez de embutir dezenas de checagens e
preparações num único arquivo de 1600 linhas, o `post-create.sh` agora age como um orquestrador que
chama utilitários menores em `scripts/devcontainer/` (identity-guard, context-helpers,
audit-structure, nss-setup, git-config, ssh-audit, deep-audit, etc.). Essa mudança melhora a
legibilidade, permite cobertura de testes unitários e facilita o reuso desses diagnósticos também em
`post-start.sh`/`post-attach.sh`. O `post-attach.sh` foi aprimorado para suportar as flags `--brief`
e `--json` (a primeira já disponível e reduz o ruído), além de `DEBUG`/`DRY_RUN` e documentação de
override via `DEVCONTAINER_PROJECT_ROOT`. Os demais hooks foram ajustados para reaproveitar
`validate-env.sh`, `ssh-audit.sh` e `deep-audit.sh` de maneira não bloqueante. Consulte o arquivo
`.devcontainer/POST_CREATE_MODULARIZATION_AUDIT.md` ou os scripts de `tests/unit/devcontainer` para
mais detalhes.

## Visão Geral

- **Arquivo**: `.devcontainer/devcontainer.json`
- **Propósito**: configurar um Dev Container para desenvolvimento local (Node.js 20 sobre Debian
  Bullseye) com caches para npm e Puppeteer, ferramentas úteis e hooks de lifecycle.
- **Imagem base**: `mcr.microsoft.com/devcontainers/javascript-node:1-20-bullseye`.

## Seções principais

- `name` — rótulo legível do dev container.
- `image` — define a imagem base (já possui Node 20).
- `features` — features instaladas automaticamente:
  - `common-utils`: utilitários (bash, git, curl, wget etc.).
  - `docker-in-docker`: permite testar containers dentro do devcontainer.
  - `git`: suporte avançado (LFS, PPA).
  - `github-cli`: `gh` instalado.
- `forwardPorts` / `portsAttributes` — portas mapeadas para o host:
  - `3008`: Socket.io + Express API (HTTP)
  - `9229`, `9230`: Node debug (PM2)

- **Novas dependências na imagem** (containers baseia-se em Node 24 + Debian): a partir de
  2026‑02‑23, o Dockerfile instala utilitários de desenvolvimento como `shellcheck`, `hadolint`,
  `yq`, `net-tools`, `postgresql-client`, `sqlite3` e `zsh`. Eles visam facilitar lint, análise e
  debug dentro do container.

- A imagem agora declara um `HEALTHCHECK` simples apontando para `http://localhost:3008`. Isso
  permite que plataformas CI/registro de imagens detectem contêineres inválidos.
- `mounts` — montagens configuradas:
  - Bind mount do `.git` com `consistency=delegated` (melhor I/O).
  - Volumes persistentes: `devcontainer-node_modules`, `devcontainer-profile`, `devcontainer-logs`,
    `devcontainer-npm-cache`, `devcontainer-puppeteer-cache`.
- `containerEnv` — variáveis de ambiente relevantes:
  - `NODE_ENV=development`, `FORCE_COLOR=1`, `LOG_LEVEL=debug`, `TZ=America/Sao_Paulo`,
    `LANG=pt_BR.UTF-8`.
  - Puppeteer: `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` e
    `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`.
- `customizations.vscode` — recomendações de extensões (17 extensões listadas) e configurações de
  workspace (`editor.formatOnSave`, `files.watcherExclude`, etc.). Recomenda-se incluir utilitários
  como `shellcheck.shellcheck`, `timonwong.shellcheck`, `vscode-yaml`, `esbenp.prettier-vscode`
  entre outros para facilitar lint dentro do container.

  Exemplo de snippet para `devcontainer.json`:

```jsonc
"customizations": {
  "vscode": {
    "extensions": [
      "shellcheck.shellcheck",
      "shardulm94.trailing-spaces",
      "eamodio.gitlens",
      "mhutchie.git-graph"
    ]
  }
},
"containerEnv": {
  "DEVCONTAINER_INSTALL_ZSH": "1" // opcional para usuários que preferem zsh (ativado também durante o build com ARG INSTALL_ZSH=1)
}
```

- `postCreateCommand` — comando executado após criar o container. Atualmente:
  `sudo chown -R node:node /workspaces/chatgpt-docker-puppeteer/node_modules && npm ci --prefer-offline --no-audit --progress=false && bash scripts/setup-devcontainer.sh`
- `postStartCommand` — comando executado a cada start do container:
  `make info && make health || true`.
- `postAttachCommand` — executado ao anexar ao container (mensagem de prontidão).

## Pontos fortes

- Volumes de cache (`devcontainer-npm-cache`, `devcontainer-puppeteer-cache`) reduzem rebuilds e
  downloads.
- `npm ci` com flags melhora performance e reprodutibilidade.
- `remoteUser: node` e `privileged: false` seguem boas práticas de segurança.
- Configurações de VS Code e lista de extensões bem alinhadas ao fluxo Node/Puppeteer.

## Riscos e pontos de atenção

- A presença de utilitários adicionais (`shellcheck`, `hadolint`, etc.) aumenta levemente o tamanho
  da imagem (~XX MB); porém, são apenas para desenvolvimento e não são carregados em produção.

1. **Uso de `sudo` no `postCreateCommand`**
   - O comando atual utiliza `sudo chown -R node:node ...`. Dependendo de como o hook é executado
     (root vs non-root) e de políticas de sudo, isso pode falhar ou exigir senha, quebrando a
     automação.

2. **Puppeteer — skip download + path explícito**
   - `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` junto com `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`
     exige que o binário exista no container. Se não existir, Puppeteer não conseguirá iniciar o
     browser.

3. **`containerUser` redundante**
   - O schema oficial usa `remoteUser`. A presença de `containerUser` pode ser irrelevante/duplicada
     e causar confusão.

4. **`postStartCommand` pode aumentar latência**
   - Executar `make health` a cada start é útil para validação, mas pode atrasar startups.

5. **Bind `.git` com `consistency=delegated`**
   - Melhora I/O, mas altera a expectativa de sincronização imediata entre host e container —
     documentar para colaboradores.

## Recomendações (não aplicadas automaticamente)

- Tornar `postCreateCommand` idempotente e tolerante à falta de `sudo` — preferir que
  `scripts/setup-devcontainer.sh` faça `chown` quando necessário, ou usar uma forma tolerante direta
  no `postCreateCommand`:

```jsonc
"postCreateCommand": "mkdir -p node_modules && chown -R node:node node_modules 2>/dev/null || true && npm ci --prefer-offline --no-audit --progress=false && bash scripts/setup-devcontainer.sh"
```

- Garantir que Chromium esteja disponível quando `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` — adicionar
  verificação/instalação em `scripts/setup-devcontainer.sh` (ex.: `apt-get install -y chromium` em
  Debian/Ubuntu) ou remover a flag e permitir download controlado pelo Puppeteer.

- Remover `containerUser` se não for necessário; manter `remoteUser`.

- Documentar no `README`/`DOCUMENTAÇÃO/` o uso dos volumes de cache e como limpá-los (comandos
  Docker para remover volumes).

- Se `postStartCommand` estiver causando lentidão, considerar torná-lo mais leve
  (`make info || true`) e deixar `make health` como execução manual.

## Procedimentos de verificação rápida

### Limpeza de volumes

O DevContainer usa diversos volumes para caches (`devcontainer-npm-cache`,
`devcontainer-puppeteer-cache`, `devcontainer-node_modules`). Para recuperar espaço ou forçar
limpeza, execute:

```bash
docker volume rm devcontainer-npm-cache devcontainer-puppeteer-cache \
  devcontainer-node_modules || true
```

Para remover imagens antigas:

```bash
docker rmi chatgpt-docker-puppeteer-dev || true
```

> **Checklist de rebuild**: um checklist detalhado das tarefas de rebuild está disponível em
> [DEVCONTAINER_CHECKLIST.md](../DEVCONTAINER_CHECKLIST.md).

1. Rebuild do Dev Container (VS Code: Rebuild and Reopen in Container) ou via CLI:

```bash
devcontainer build --workspace-folder .
```

2. Conferir logs do `postCreateCommand` no painel "Dev Containers" do VS Code.
3. Confirmar propriedade de `node_modules`:

```bash
ls -ld node_modules
```

4. Teste rápido do Puppeteer (ex.: `node test-puppeteer.js`) para validar que o Chromium/Chromium
   path funciona.

## Checklist sugerido antes de compartilhar imagem/ambiente

- [ ] Validar que `scripts/setup-devcontainer.sh` é idempotente e não interativo.
- [ ] Confirmar existência/instalação de Chromium ou permitir download.
- [ ] Remover `containerUser` se redundante.
- [ ] Documentar comportamento do `.git` mount e caches no README.

---

_Este documento foi gerado automaticamente como resumo e orientação — se quiser, adapto o texto para
outro arquivo/idioma, ou aplico as mudanças sugeridas diretamente no repositório._
