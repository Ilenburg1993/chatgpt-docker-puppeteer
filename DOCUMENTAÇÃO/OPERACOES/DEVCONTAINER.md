# DevContainer

**Propósito**: documentar o contrato atual do ambiente `.devcontainer`, com foco no que a
configuração realmente declara hoje e nos pontos de drift que ainda exigem revisão.  
**Status documental**: Canônico.  
**Público**: desenvolvimento local, manutenção, DX e agentes de IA.  
**Última atualização**: 1 de março de 2026.

## O que é fonte de verdade

Para esta trilha, a fonte primária é:

- [../../.devcontainer/devcontainer.json](../../.devcontainer/devcontainer.json)

Leitura correta:

- o projeto usa configuração de `build`, não uma imagem fixa simples;
- o container é um ambiente de desenvolvimento, não um runtime de produção;
- a semântica do arquivo é fortemente comentada e inclui decisões arquiteturais sobre portas,
  browser externo e observabilidade.

## Contrato atual do container

### Build

O DevContainer usa:

- `context: ..`
- `dockerfile: Dockerfile`
- build args explícitos, incluindo `REMOTE_USER=node`

Isso significa que a imagem final depende do `Dockerfile` do projeto e de argumentos de build
controlados, não de uma imagem pronta genérica.

Leitura importante:

- o arquivo não declara `features` do catálogo Dev Containers;
- isso é intencional: um bloco vazio de `features` força um Dockerfile intermediário inútil e pode
  gerar warning de `ARG BASE_IMAGE` sem default durante o rebuild;
- o tooling relevante é instalado diretamente no `Dockerfile`, sob controle explícito do projeto.

### Tooling de imagem já embutido

O `Dockerfile` agora entrega um baseline mais completo e determinístico para o próprio ciclo de
manutenção do DevContainer:

- `devcontainer` CLI (`@devcontainers/cli`) para `read-configuration`, build e troubleshooting
  dentro do container;
- `jsonc-parser` como biblioteca global e o wrapper `jsonc-validate` para validar `.jsonc` reais
  (`.devcontainer/devcontainer.json`, `settings.json`, templates do OpenCode);
- `typescript` (que já inclui `tsserver`) e `typescript-language-server`;
- `npm` e `pnpm` alinhados ao baseline do repositório no prefixo canônico da imagem;
- `gh`, `actionlint` e `hadolint` instalados a partir dos releases oficiais upstream, em vez dos
  pacotes atrasados (ou ausentes) do Debian.

Leitura importante:

- `tsserver` não exige pacote separado: ele já vem com `typescript`;
- `jsonc-parser` não expõe um binário de usuário por padrão, por isso o projeto instala o wrapper
  `jsonc-validate`;
- esse tooling canônico de imagem deve viver em `/usr/local/share/npm-global`, não em
  `~/.npm-global`, porque `~/.npm-global` é um volume nomeado e mascara conteúdo da imagem;
- os binários críticos também são espelhados em `/usr/local/bin` para evitar drift com ferramentas
  que chamem caminhos absolutos;
- `gh`, `actionlint` e `hadolint` são ferramentas curadas: ficam pinadas no `Dockerfile` por versão
  estável e devem ser atualizadas deliberadamente, não “por acaso” via `apt`;
- os downloads upstream dessas ferramentas passam por validação de checksum durante o build;
- o container continua não instalando `bun` como ferramenta base, porque o fluxo canônico segue em
  `npm` e `bun` hoje é apenas engine aceita, não dependência operacional do runtime.

### Ambiente

Variáveis relevantes hoje, por camada:

- Dockerfile `ENV`: `NODE_ENV=development`, `LOG_LEVEL=info`, `PUPPETEER_LOCAL_LAUNCH_DISABLED=true`
- `containerEnv`: `PM2_HOME=/home/node/.pm2`, `NPM_CONFIG_CACHE=/home/node/.npm`,
  `PUPPETEER_MODE=connect`, `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true`,
  `PUPPETEER_WS_ENDPOINT=http://localhost:9224`
- `remoteEnv`: bridge do host para credenciais e overrides visíveis a terminais/extensões, além de
  espelhar alguns valores fixos via `${containerEnv:*}` para evitar drift
- `runArgs --env-file`: `.env.development` injeta o baseline versionado de desenvolvimento,
  incluindo `LOG_LEVEL=debug`

Leitura importante:

- o contrato do container assume browser externo via proxy;
- o DevContainer não deve “decidir” topologia por conta própria;
- o endpoint canônico de Puppeteer dentro do container continua sendo `localhost:9224`.
- `FORCE_COLOR` não é mais exportado globalmente; cor forçada deve ser por processo.
- o NSS wrapper agora é híbrido: `nss-gatekeeper` semeia artefatos cedo, `containerEnv` e
  `remoteEnv` expõem uma baseline segura (`LD_PRELOAD` + `NSS_WRAPPER_*` apontando para `/etc`) e o
  fluxo de profile/hook pode promover isso para os artefatos dinâmicos em `/tmp`; isso cobre a
  lacuna que `profile.d` sozinho não cobre sem depender de arquivos efêmeros no bootstrap.
- `CODEX_HOME` e os paths do NSS não precisam mais ficar duplicados em `remoteEnv`: o arquivo usa
  `${containerEnv:*}` para reaproveitar a mesma fonte de verdade nesses valores fixos.

### Persistência de estado local

Os mounts atuais já cobrem a persistência do estado das principais ferramentas de operador e de
assistentes:

- `/home/node/.config` em volume dedicado: cobre `gh`, GitHub Copilot, OpenCode e demais configs
  XDG;
- `/home/node/.local/share` em volume dedicado: cobre caches e estado de extensões/ferramentas;
- `/home/node/.claude` em volume dedicado;
- `CODEX_HOME` permanece no workspace (`.codex`), por desenho.

Leitura correta:

- `~/.config/opencode` já sobrevive a rebuild do container atual; não é mais necessário criar um
  mount separado só para OpenCode;
- credenciais e settings desses diretórios persistem por volume, mas a instalação dos binários
  continua sendo responsabilidade do `Dockerfile` (ou do método oficial de cada fornecedor).

### Portas forwardadas

O `forwardPorts` atual declara:

- `3008`
- `5173`
- `9224`
- `9229`
- `9230`

Leitura correta:

- `3008`: backend/dashboard principal
- `5173`: Vite do dashboard UI em modo dev
- `9224`: Chrome Proxy
- `9229` e `9230`: debug Node

Isso já corrige a leitura antiga de que só `3008`, `9229` e `9230` importariam.

## Contrato de browser no DevContainer

O arquivo deixa explícito que:

- o Chrome real não roda como parte do container por padrão;
- o container consome o browser via proxy em `9224`;
- o Chrome real fica atrás dessa fronteira, tipicamente em `9225`.

Isso precisa permanecer alinhado com:

- [./CHROME_PROXY_SETUP.md](./CHROME_PROXY_SETUP.md)
- [./CHROME_PROXY_INTEGRATION_GUIDE.md](./CHROME_PROXY_INTEGRATION_GUIDE.md)

## Hooks e automação

O ecossistema de lifecycle do DevContainer foi expandido e modularizado, mas este documento só deve
afirmar o que é observável no arquivo e nos scripts realmente ativos.

O ponto seguro a registrar é:

- há hooks de lifecycle e automação acoplados ao ambiente;
- esse comportamento deve ser validado no próprio `.devcontainer/devcontainer.json` e nos scripts
  associados antes de qualquer alteração.

Se a análise precisar descer ao nível dos hooks, isso merece um documento especializado ou uma
rodada própria de auditoria, não um resumo especulativo aqui.

## Como validar o ambiente

### Verificação mínima

```bash
npm run check:env
make info
```

### Verificação do contrato do DevContainer

```bash
devcontainer --version
gh --version
actionlint -version
hadolint --version
jsonc-validate .devcontainer/devcontainer.json
bash scripts/check-devcontainer-sync.sh
```

O `check-devcontainer-sync.sh` agora observa também o `Dockerfile`, o `nss-gatekeeper` e os hooks de
`.devcontainer/scripts/`, para distinguir melhor quando basta reload, quando um restart resolve e
quando é rebuild obrigatório.

Se quiser validar a configuração materializada pelo próprio CLI:

```bash
devcontainer read-configuration --workspace-folder .
```

### Verificação de dashboard / port forwarding

```bash
bash scripts/check-dashboard-access.sh
```

### Verificação do backend

```bash
curl http://localhost:3008/api/health
```

## O que ainda é drift ou risco

Há riscos claros que precisam permanecer explícitos:

- a malha de comentários do `devcontainer.json` é extensa e carrega muito contexto histórico;
- esse arquivo mistura contrato atual com notas evolutivas de versões anteriores;
- qualquer documento que resuma o DevContainer sem reler o JSON real tende a ficar obsoleto rápido.

Além disso, a documentação antiga desta área já carregava afirmações hoje incorretas:

- Node 20 como baseline principal;
- imagem base simplificada como se ainda fosse o contrato central;
- lista incompleta de portas forwardadas;
- descrições de hooks e dependências não necessariamente derivadas do estado atual do arquivo.

## Guardrails para manutenção

- não documente o DevContainer a partir de memória ou de uma versão anterior do arquivo;
- não trate comentários históricos do JSON como sinônimo automático de comportamento atual;
- sempre valide `forwardPorts`, `containerEnv` e `build.args` antes de atualizar docs;
- sempre valide também a fronteira entre Dockerfile `ENV`, `containerEnv` e `remoteEnv`;
- sempre valide `.jsonc` reais com `jsonc-validate` quando o parser já estiver presente na imagem;
- use `devcontainer read-configuration` quando a dúvida for sobre a configuração materializada, não
  apenas sobre o JSON comentado;
- se um guia operacional contradizer o `devcontainer.json`, o JSON prevalece.

## Próxima leitura recomendada

- [./DASHBOARD_PORT_FORWARDING.md](./DASHBOARD_PORT_FORWARDING.md)
- [./CHROME_PROXY_SETUP.md](./CHROME_PROXY_SETUP.md)
- [../GUIAS/DEVELOPMENT.md](../GUIAS/DEVELOPMENT.md)
