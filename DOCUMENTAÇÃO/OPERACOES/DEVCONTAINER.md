# DevContainer

**Propósito**: documentar o contrato atual do ambiente `.devcontainer`, com foco no que a configuração realmente declara hoje e nos pontos de drift que ainda exigem revisão.  
**Status documental**: Canônico.  
**Público**: desenvolvimento local, manutenção, DX e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

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

### Ambiente

Variáveis relevantes hoje:

- `NODE_ENV=development`
- `LOG_LEVEL=debug`
- `PM2_HOME=/home/node/.pm2`
- `NPM_CONFIG_CACHE=/home/node/.npm`
- `PUPPETEER_MODE=connect`
- `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true`
- `PUPPETEER_WS_ENDPOINT=http://localhost:9224`

Leitura importante:

- o contrato do container assume browser externo via proxy;
- o DevContainer não deve “decidir” topologia por conta própria;
- o endpoint canônico de Puppeteer dentro do container continua sendo `localhost:9224`.

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
- se um guia operacional contradizer o `devcontainer.json`, o JSON prevalece.

## Próxima leitura recomendada

- [./DASHBOARD_PORT_FORWARDING.md](./DASHBOARD_PORT_FORWARDING.md)
- [./CHROME_PROXY_SETUP.md](./CHROME_PROXY_SETUP.md)
- [../GUIAS/DEVELOPMENT.md](../GUIAS/DEVELOPMENT.md)
