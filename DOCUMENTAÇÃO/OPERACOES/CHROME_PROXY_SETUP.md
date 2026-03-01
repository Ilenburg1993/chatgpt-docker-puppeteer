# Setup do Chrome Proxy

**Propósito**: documentar o setup operacional real do Chrome Proxy no estado atual do projeto, sem assumir launchers completos ou IPs fixos que já não representam o código canônico.  
**Status documental**: Canônico.  
**Público**: operação local, devcontainer, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## O que este componente faz

O `chrome-proxy` é o processo que expõe um endpoint HTTP/WebSocket estável para o runtime acessar o
Chrome DevTools Protocol sem depender de acesso direto ao browser real.

No fluxo canônico atual:

- o runtime consome `CHROME_PROXY_PORT=9224`;
- o Chrome real fica em `CHROME_PORT=9225`;
- o processo PM2 `chrome-proxy` executa `scripts/chrome-proxy-service.js`;
- o host real do Chrome é resolvido automaticamente, priorizando:
  1. `CHROME_HOST` explícito
  2. `host.docker.internal`
  3. gateway do container
  4. `127.0.0.1`

## Contrato operacional real

Os valores canônicos observáveis hoje são:

- `CHROME_PROXY_PORT=9224`
- `CHROME_PORT=9225`
- bind padrão do proxy: `0.0.0.0`
- processo PM2: `chrome-proxy`

Em `ecosystem.config.cjs`, o processo é configurado com:

- `CHROME_HOST=host.docker.internal`
- `CHROME_PORT=9225`
- `CHROME_PROXY_PORT=9224`

## Como subir no fluxo canônico

### Opção A: via PM2 (recomendada)

```bash
npm run daemon:start
```

Depois confirme:

```bash
npm run daemon:status
curl http://localhost:9224/json/version
```

Se `chrome-proxy` estiver online, o serviço foi iniciado junto com o resto do runtime.

### Opção B: rodar isoladamente

Para diagnóstico pontual:

```bash
CHROME_PROXY_PORT=9224 CHROME_PORT=9225 node scripts/chrome-proxy-service.js
```

O script lê a configuração prioritariamente por variáveis de ambiente. Ele não depende de um IP
fixo em linha de comando para o fluxo canônico.

## Variáveis relevantes

- `CHROME_HOST`: host do Chrome real
- `CHROME_PORT`: porta do Chrome real (padrão `9225`)
- `CHROME_PROXY_PORT`: porta exposta pelo proxy (padrão `9224`)
- `CHROME_PROXY_BIND`: bind do servidor proxy (padrão `0.0.0.0`)
- `PUBLIC_IP`: opcional; quando ausente, o serviço pode auto-detectar
- `LOG_LEVEL`: nível de logs

Guardrail importante:

- `CHROME_PORT` e `CHROME_PROXY_PORT` não podem ser iguais. O próprio script falha se ambos forem
  configurados com o mesmo valor.

## Scripts auxiliares existentes

- [../../scripts/chrome-proxy-service.js](../../scripts/chrome-proxy-service.js): wrapper canônico
  do serviço
- [../../scripts/start-chrome-proxy-linux.sh](../../scripts/start-chrome-proxy-linux.sh): script de
  referência para Linux standalone
- [../../scripts/start-chrome-with-proxy.bat](../../scripts/start-chrome-with-proxy.bat): wrapper
  simples para Windows

Leitura correta desses scripts:

- `start-chrome-proxy-linux.sh` é um helper de referência, não o fluxo principal do projeto;
- `start-chrome-with-proxy.bat` é intencionalmente simples e não implementa sozinho todo o setup de
  Chrome + Proxy + health checks;
- o baseline operacional continua sendo PM2 ou a execução explícita do script Node.

## Validação mínima

Health HTTP do proxy:

```bash
curl http://localhost:9224/json/version
```

O esperado é um JSON do DevTools Protocol com `webSocketDebuggerUrl`.

Validação complementar:

```bash
npm run daemon:status
curl http://localhost:3008/api/health/chrome
```

Se `/json/version` responde, mas o health do backend falha, o problema pode estar no runtime de
integração com o browser e não no processo do proxy em si.

## Diagnóstico rápido

### Porta `9224` não responde

Verifique:

```bash
npm run daemon:status
npm run daemon:logs
```

Se estiver rodando isolado:

```bash
CHROME_PROXY_PORT=9224 CHROME_PORT=9225 node scripts/chrome-proxy-service.js
```

### Porta conflitando

Se o proxy não sobe por conflito:

- confirme se outro processo já está usando `9224`;
- não mude para uma porta arbitrária sem alinhar `.env`, PM2 e o runtime.

### Host do Chrome não resolvido

O script já faz detecção progressiva. Se ainda falhar:

- confira `CHROME_HOST`;
- confira se `host.docker.internal` resolve no seu ambiente;
- em container Linux puro, confira o gateway do container;
- valide se o Chrome real está mesmo ouvindo em `9225`.

## O que não assumir

- não assuma `192.168.0.2` como IP canônico;
- não assuma que `start-chrome-with-proxy.bat` já inicia automaticamente todo o stack;
- não documente `9224` como porta do Chrome real;
- não trate scripts auxiliares antigos como contrato principal se divergirem de `ecosystem.config.cjs`
  e das variáveis atuais.

## Leituras relacionadas

- [./CHROME_PROXY_INTEGRATION_GUIDE.md](./CHROME_PROXY_INTEGRATION_GUIDE.md)
- [./NETWORKING.md](./NETWORKING.md)
- [./LAUNCHER.md](./LAUNCHER.md)
- [../ARQUITETURA/SUBSISTEMAS/NERV_TRANSPORT.md](../ARQUITETURA/SUBSISTEMAS/NERV_TRANSPORT.md)
