# PM2: Referência Rápida

**Propósito**: concentrar os comandos canônicos de PM2 e deixar explícitos os pontos de drift entre `npm scripts`, `Makefile` e scripts auxiliares legados.  
**Status documental**: Canônico.  
**Público**: operação local, manutenção, desenvolvimento e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Fonte de verdade

Para PM2, a ordem correta de confiança hoje é:

1. `package.json`
2. `ecosystem.config.cjs`
3. `Makefile`
4. scripts auxiliares (`scripts/setup/pm2-startup.sh`, `scripts/ops/pm2-check.sh`)

Os scripts auxiliares continuam úteis para diagnóstico, mas não são a referência primária do
contrato.

## Comandos canônicos

### Via npm

```bash
npm run daemon:start
npm run daemon:stop
npm run daemon:reload
npm run daemon:restart
npm run daemon:status
npm run daemon:logs
npm run daemon:monit
```

Esses comandos usam `npx pm2` e o arquivo canônico atual:

- `ecosystem.config.cjs`

### Via Makefile

Atalhos principais:

```bash
make start
make stop
make restart
make reload
make status
make logs
make monit
make health
make pm2-startup
```

Leitura correta:

- `make start/stop/reload/status/logs/monit` já delegam ao fluxo atual baseado em `npm run daemon:*`;
- `make health` usa `scripts/ops/pm2-check.sh`;
- alguns alvos auxiliares ainda carregam drift e não devem ser tratados como baseline cego.

## Processos esperados

No runtime padrão, os processos PM2 mais importantes são:

- `agente-gpt`
- `dashboard-web`
- `chrome-proxy`

Em cenários específicos, processos adicionais podem surgir:

- `inference-gateway`
- `audit-agent`

Mas esses não fazem parte do trio mínimo garantido em todo fluxo.

## Checagens rápidas

Status:

```bash
npm run daemon:status
```

Logs:

```bash
npm run daemon:logs
```

Health:

```bash
make health
curl http://localhost:3008/api/health/pm2
```

## Endpoints úteis

- `GET /api/health`
- `GET /api/health/pm2`

Exemplos:

```bash
curl http://localhost:3008/api/health
curl http://localhost:3008/api/health/pm2
```

## Correções recentes já aplicadas

Os drifts operacionais mais críticos desta trilha já foram corrigidos:

- `scripts/setup/pm2-startup.sh` agora usa `ecosystem.config.cjs`;
- `scripts/setup/pm2-startup.sh` agora valida `Node >=24`;
- `scripts/setup/pm2-startup.sh` agora opera via `npx pm2`;
- `make pm2-check` agora aponta para `scripts/ops/pm2-check.sh`;
- `scripts/ops/pm2-check.sh` agora usa `ecosystem.config.cjs` e o caminho correto nos comandos de
  auto-fix.

## Drift residual que ainda importa

Ainda existem referências históricas e auxiliares antigas em partes do repositório, mas elas já não
definem o caminho canônico de operação.

Leitura correta:

- o baseline operacional está alinhado entre `package.json`, `Makefile`, `ecosystem.config.cjs` e
  os scripts PM2 principais;
- referências antigas a `ecosystem.config.js` devem ser tratadas como históricas, especializadas ou
  ainda não consolidadas.

## Como operar com segurança

Para rotina diária, prefira:

```bash
npm run daemon:start
npm run daemon:status
npm run daemon:logs
```

Para boot via atalho:

```bash
make start
make status
make logs
```

Para validação HTTP:

```bash
curl http://localhost:3008/api/health
curl http://localhost:3008/api/health/pm2
```

## O que evitar

- não use `pm2 start ecosystem.config.js` como baseline documental;
- não trate documentos históricos ou scripts antigos como se substituíssem `package.json` e
  `ecosystem.config.cjs`;
- não esconda divergências entre docs, scripts e `package.json`.

## Próxima leitura recomendada

- [./LAUNCHER.md](./LAUNCHER.md)
- [./NETWORKING.md](./NETWORKING.md)
- [./DEVCONTAINER.md](./DEVCONTAINER.md)
