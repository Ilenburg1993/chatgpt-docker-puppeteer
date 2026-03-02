# Networking e Gestão de Portas

**Propósito**: documentar o contrato atual de bind, forwarding, portas expostas e endpoints de saúde
do runtime.  
**Status documental**: Canônico.  
**Público**: engenharia, operação, troubleshooting e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Escopo

Este documento descreve o estado observado no código atual, principalmente em:

- [server.js](/workspaces/chatgpt-docker-puppeteer/src/server/engine/server.js)
- [router.js](/workspaces/chatgpt-docker-puppeteer/src/server/api/router.js)
- [devcontainer.json](/workspaces/chatgpt-docker-puppeteer/.devcontainer/devcontainer.json)
- [ecosystem.config.cjs](/workspaces/chatgpt-docker-puppeteer/ecosystem.config.cjs)

Quando houver divergência entre scripts legados e este documento, a fonte da verdade é o código
acima.

## Topologia canônica de rede

O runtime atual separa claramente três planos de rede:

- **Dashboard/API HTTP**: processo `dashboard-web`, porta canônica `3008`.
- **Chrome Proxy**: processo `chrome-proxy`, porta canônica `9224` dentro do container.
- **Chrome real / DevTools**: processo de browser fora do proxy, porta canônica `9225`.

Em desenvolvimento com DevContainer, o contrato observado é:

- `3008`: dashboard, API HTTP e Socket.IO.
- `5173`: Vite dev server do dashboard frontend.
- `9224`: proxy para o Chrome DevTools Protocol.
- `9229`: debug principal de Node.js.

## Portas canônicas

### 1. Porta 3008

**Função**:

- servidor HTTP principal;
- API REST sob `/api/*`;
- tráfego de dashboard;
- negociação de tempo real via Socket.IO.

**Fonte observada**:

- `ecosystem.config.cjs` define `PORT=3008` para `dashboard-web`;
- `server.js` faz bind na porta recebida pelo bootstrap;
- `.devcontainer/devcontainer.json` expõe `3008` em `forwardPorts`.

**Endpoints críticos**:

- `GET /api/health`
- `GET /api/health/chrome`
- `GET /api/health/pm2`
- `GET /api/health/kernel`
- `GET /api/health/disk`
- `GET /api/metrics`
- `POST/GET /api/mcp` quando `MCP_ENABLED=true`

### 2. Porta 5173

**Função**:

- Vite dev server do frontend do dashboard em ambiente de desenvolvimento.

**Observação importante**:

- esta porta não é o backend principal;
- ela serve o frontend em modo dev e pode depender de proxy para a API em `3008`.

**Fonte observada**:

- `.devcontainer/devcontainer.json` expõe `5173` em `forwardPorts`;
- vários scripts de verificação de dashboard usam `http://localhost:5173/dashboard/`.

### 3. Porta 9224

**Função**:

- endpoint canônico container-facing para o Chrome Proxy.

**Papel arquitetural**:

- Puppeteer e verificações de saúde devem falar com o proxy;
- o proxy conversa com o Chrome real em outra porta.

**Fonte observada**:

- `ecosystem.config.cjs` define `CHROME_PROXY_PORT=9224`;
- `.devcontainer/devcontainer.json` marca `9224` como porta forwardada;
- scripts de diagnóstico (`doctor.sh`, `check-chrome.js`, `setup.sh`) priorizam `CHROME_PROXY_PORT`.

### 4. Porta 9225

**Função**:

- porta real de remote debugging do Chrome por trás do proxy.

**Observação**:

- esta não é a porta recomendada para clientes internos do runtime;
- a conexão canônica do lado do container é via `9224`.

**Fonte observada**:

- `ecosystem.config.cjs` define `CHROME_PORT=9225` para o processo `chrome-proxy`;
- `.devcontainer/devcontainer.json` comenta explicitamente o fluxo `9224 -> 9225`.

### 5. Porta 9229

**Função**:

- debug principal de Node.js.

**Fonte observada**:

- `package.json` usa `--inspect=0.0.0.0:9229` em `npm run dev`;
- `.devcontainer/devcontainer.json` expõe `9229`.

## Bind e port hunting

O bind real do servidor é controlado por
[server.js](/workspaces/chatgpt-docker-puppeteer/src/server/engine/server.js).

### Host de bind

- padrão atual: `0.0.0.0`
- variável: `HOST`

Isso significa que, por padrão, o backend não fica preso a `127.0.0.1`.

### Escalonamento de portas

O servidor implementa **port hunting controlado**:

- porta base: a recebida no bootstrap (na prática, `3008` em PM2);
- limite: `PORT_HUNT_LIMIT`, com default `5`;
- comportamento: tenta `porta`, depois `porta+1`, até `porta+5`;
- falha determinística quando a faixa se esgota.

Leitura prática:

- com default atual, a faixa efetiva é `3008-3013` quando `3008` é a base;
- isso ajuda em desenvolvimento local;
- isso pode quebrar a previsibilidade em ambientes com forwarding fixo.

### Risco operacional

Se o serviço subir em `3009+` mas o ambiente estiver esperando `3008`, scripts ou proxies podem
falhar silenciosamente.

Em ambiente controlado, o ideal é:

- manter `3008` livre para o backend principal;
- tratar conflitos de porta como problema de ambiente, não como estado normal.

## Contrato real de health

### `GET /api/health`

No código atual, este endpoint é definido diretamente em
[router.js](/workspaces/chatgpt-docker-puppeteer/src/server/api/router.js), não pelo controller
genérico.

Retorno observado:

- `success`
- `ts`
- `chrome`
- `request_id`

Importante:

- o campo principal é `success`, não `status`;
- vários scripts legados ainda assumem um formato antigo com `status`.

### Endpoints especializados

Os controllers atuais também expõem:

- `/api/health/chrome`
- `/api/health/pm2`
- `/api/health/kernel`
- `/api/health/disk`

Esses endpoints vivem em
[health.js](/workspaces/chatgpt-docker-puppeteer/src/server/api/controllers/health.js).

## Forwarding no DevContainer

O contrato atual do DevContainer expõe:

- `3008`
- `5173`
- `9224`
- `9229`

Esse é o conjunto normativo para o fluxo de desenvolvimento observado.

Qualquer documentação ou script que trate outra combinação como baseline deve ser considerado legado
até revisão.

## Divergências legadas identificadas

Durante a revisão, ficaram explícitas algumas divergências entre helpers antigos e o runtime atual.

### Helpers com health apontando para 2998

Os seguintes artefatos ainda consultam `http://localhost:2998/api/health`:

- [LAUNCHER.bat](/workspaces/chatgpt-docker-puppeteer/LAUNCHER.bat)
- [quick-ops.sh](/workspaces/chatgpt-docker-puppeteer/scripts/ops/quick-ops.sh)
- [quick-ops.bat](/workspaces/chatgpt-docker-puppeteer/scripts/quick-ops.bat)

Isso está desalinhado com o contrato canônico atual de `3008`.

### Scripts que ainda usam nomes antigos

Existem conveniências legadas que ainda referenciam `ecosystem.config.js` ou caminhos antigos.

Exemplo:

- [pm2-startup.sh](/workspaces/chatgpt-docker-puppeteer/scripts/setup/pm2-startup.sh)
- [pm2-check.sh](/workspaces/chatgpt-docker-puppeteer/scripts/ops/pm2-check.sh)

O caminho canônico atual do ecossistema é:

- [ecosystem.config.cjs](/workspaces/chatgpt-docker-puppeteer/ecosystem.config.cjs)

## Procedimento recomendado de verificação

### Backend e API

```bash
curl -sf http://localhost:3008/api/health
curl -sf http://localhost:3008/api/health/chrome
curl -sf http://localhost:3008/api/health/pm2
```

### Chrome Proxy

```bash
curl -sf http://localhost:9224/json/version
curl -sf http://localhost:9224/json/list
```

### Frontend em dev

```bash
curl -I http://localhost:5173/dashboard/
```

## Regras de manutenção

- Não documentar `2998` como porta principal enquanto o backend canônico estiver em `3008`.
- Não documentar `9225` como endpoint padrão para clientes internos; o padrão é `9224`.
- Se um helper legar conflito com o contrato atual, o documento deve explicitar a divergência em vez
  de escondê-la.
- Sempre validar portas e endpoints contra `ecosystem.config.cjs`, `server.js` e
  `.devcontainer/devcontainer.json`.

## Links relacionados

- Deploy: [DEPLOYMENT.md](./DEPLOYMENT.md)
- DevContainer: [DEVCONTAINER.md](./DEVCONTAINER.md)
- Chrome Proxy: [CHROME_PROXY_SETUP.md](./CHROME_PROXY_SETUP.md)
- Guia rápido: [../GUIAS/QUICK_START.md](../GUIAS/QUICK_START.md)
