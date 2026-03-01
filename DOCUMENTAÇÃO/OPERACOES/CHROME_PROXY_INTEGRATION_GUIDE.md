# Guia de Integração do Chrome Proxy

**Propósito**: explicar como o runtime consome o Chrome Proxy hoje, com base no comportamento real do serviço e do ambiente PM2, sem depender de `config.json` antigo ou de um IP público fixo.  
**Status documental**: Canônico.  
**Público**: desenvolvimento, operação local, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel do proxy na integração

O `chrome-proxy` existe para estabilizar o acesso ao DevTools Protocol. Em vez de o runtime apontar
diretamente para o Chrome real em `9225`, ele consome o endpoint de proxy em `9224`.

Leitura correta da topologia:

- `9224`: porta de integração do runtime
- `9225`: porta do Chrome real
- `chrome-proxy`: camada intermediária que reescreve e encaminha tráfego

## O que é fonte de verdade hoje

Para esta trilha, as fontes primárias são:

- `ecosystem.config.cjs`
- `scripts/chrome-proxy-service.js`
- `.env.example`
- `src/core/config.js`
- `src/core/doctor.js`

Não trate `config.json` legado, `ConnectionOrchestrator.js` antigo ou IPs fixos em documentos
antigos como baseline atual.

## Fluxo operacional canônico

### 1. O processo PM2 sobe o proxy

`npm run daemon:start` usa `ecosystem.config.cjs`, que sobe:

- `agente-gpt`
- `dashboard-web`
- `chrome-proxy`

O processo `chrome-proxy` recebe, por padrão:

- `CHROME_HOST=host.docker.internal`
- `CHROME_PORT=9225`
- `CHROME_PROXY_PORT=9224`

### 2. O runtime valida a conectividade

O runtime e os checks de saúde usam o endpoint de proxy como fronteira operacional, e não a porta
do Chrome real.

Valide com:

```bash
curl http://localhost:9224/json/version
curl http://localhost:3008/api/health/chrome
```

### 3. O serviço resolve o host do Chrome

Se `CHROME_HOST` não vier explicitamente:

1. tenta `host.docker.internal`
2. em ambiente de container, tenta o gateway padrão
3. por fim, usa `127.0.0.1`

Isso elimina a necessidade de codificar endereços como `192.168.0.2`.

## Integração em desenvolvimento local

### Devcontainer / Docker Desktop

O caso mais comum é:

- container usa `chrome-proxy` como fronteira em `9224`;
- o proxy fala com o Chrome real via `host.docker.internal:9225`.

### Linux standalone

Em Linux fora de container, o script de referência
[../../scripts/start-chrome-proxy-linux.sh](../../scripts/start-chrome-proxy-linux.sh) pode ser
usado como apoio, mas ele não redefine o baseline do projeto.

### Windows

O wrapper [../../scripts/start-chrome-with-proxy.bat](../../scripts/start-chrome-with-proxy.bat)
apenas invoca o script Node. Ele não é um “launcher soberano” completo.

## Testes úteis de integração

### Verificar o endpoint do proxy

```bash
curl http://localhost:9224/json/version
```

### Verificar o backend

```bash
curl http://localhost:3008/api/health/chrome
curl http://localhost:3008/api/health
```

### Verificar PM2

```bash
npm run daemon:status
npx pm2 logs chrome-proxy
```

## Sinais de integração correta

- `chrome-proxy` aparece `online` no PM2;
- `curl http://localhost:9224/json/version` responde;
- `GET /api/health/chrome` não retorna indisponível;
- o runtime não tenta contornar o proxy para acessar `9225` diretamente como fluxo normal.

## Sinais de drift ou erro

- documentação dizendo que `9224` é a porta do Chrome real;
- instruções exigindo um IP fixo local;
- referência obrigatória a `config.json` como peça central desse fluxo;
- scripts antigos assumindo a mesma porta para proxy e Chrome.

## Diagnóstico rápido

### `curl /json/version` responde, mas o backend falha

O proxy está vivo, mas a camada de boot/integração do runtime pode estar desalinhada.  
Cheque:

```bash
npm run daemon:logs
curl http://localhost:3008/api/health/chrome
```

### O proxy não sobe

Cheque:

```bash
npx pm2 logs chrome-proxy
```

Pontos recorrentes:

- `CHROME_PORT` conflitando com `CHROME_PROXY_PORT`
- host do Chrome inacessível
- algum processo já ocupando `9224`

## O que não fazer

- não codifique IP público em documentação canônica;
- não trate wrappers de sistema operacional como se fossem o contrato principal;
- não reintroduza instruções centradas em `config.json` antigo;
- não descreva a integração como se o runtime devesse preferir acesso direto ao `9225`.

## Leituras relacionadas

- [./CHROME_PROXY_SETUP.md](./CHROME_PROXY_SETUP.md)
- [./NETWORKING.md](./NETWORKING.md)
- [./SECURITY.md](./SECURITY.md)
