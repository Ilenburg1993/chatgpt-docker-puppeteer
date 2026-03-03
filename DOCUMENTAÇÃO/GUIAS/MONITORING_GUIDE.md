# Guia de Monitoramento

**Propósito**: documentar a malha canônica de monitoramento e verificação do runtime atual,
priorizando fontes observáveis reais em vez de descrições antigas ou excessivamente idealizadas.  
**Status documental**: Canônico.  
**Público**: operação local, manutenção, desenvolvimento e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Fontes de verdade para monitoramento

No estado atual do projeto, a ordem correta de confiança é:

1. PM2 (`status`, `logs`, `monit`)
2. endpoints HTTP de health
3. métricas HTTP
4. dashboard em tempo real
5. scripts auxiliares de health

Os scripts auxiliares continuam úteis, mas alguns ainda carregam defaults legados e não devem ser
tratados como fonte primária sem validação.

## Camada 1: PM2

Comandos canônicos:

```bash
npm run daemon:status
npm run daemon:logs
npm run daemon:monit
```

Atalhos equivalentes:

```bash
make status
make logs
make monit
```

O fluxo PM2 atual gira em torno de `ecosystem.config.cjs`.

Processos que normalmente aparecem no runtime padrão:

- `agente-gpt`
- `dashboard-web`
- `chrome-proxy`

Em cenários específicos, processos auxiliares adicionais podem aparecer, como `inference-gateway` ou
`audit-agent`, dependendo do modo de execução.

## Camada 2: Health HTTP

Endpoints confirmados no código atual:

- `GET /api/health`
- `GET /api/health/chrome`
- `GET /api/health/pm2`
- `GET /api/health/kernel`
- `GET /api/health/disk`

Exemplos:

```bash
curl http://localhost:3008/api/health
curl http://localhost:3008/api/health/chrome
curl http://localhost:3008/api/health/pm2
curl http://localhost:3008/api/health/kernel
curl http://localhost:3008/api/health/disk
```

Leitura correta:

- `/api/health` confirma que o processo HTTP está respondendo e que o probe básico de Chrome foi
  executado;
- `/api/health/chrome` valida a conectividade do endpoint de browser configurado;
- `/api/health/pm2` reflete snapshot dos processos;
- `/api/health/kernel` pode retornar `not_applicable` quando o kernel não estiver injetado nesse
  processo específico;
- `/api/health/disk` valida os alvos críticos de armazenamento (DB e artifacts).

## Camada 3: Métricas HTTP

Endpoint confirmado:

- `GET /api/metrics`

Exemplo:

```bash
curl http://localhost:3008/api/metrics
```

Esse endpoint é mais apropriado para inspeção de estado agregado do que para “is alive / is not
alive”. Para disponibilidade, prefira os endpoints de health.

## Camada 4: Dashboard e realtime

O dashboard em `http://localhost:3008` é útil para observação contínua, mas não substitui:

- PM2
- endpoints de health
- logs

Use o dashboard como superfície operacional e de telemetria, não como única confirmação de saúde.

## Scripts auxiliares de health

Existem utilitários úteis, mas eles não são a primeira fonte de verdade:

```bash
make health
make pm2-check
```

Script POSIX:

```bash
bash scripts/health/health-posix.sh 3008
```

Importante: `scripts/health/health-posix.sh` ainda usa `2998` como default legado. Passe `3008`
explicitamente até esse drift ser eliminado.

## Logs

Leitura rápida:

```bash
npm run daemon:logs
```

Para inspeção orientada a processo:

```bash
npx pm2 logs agente-gpt
npx pm2 logs dashboard-web
npx pm2 logs chrome-proxy
```

Se estiver em modo `npm run dev`, acompanhe diretamente o processo de terminal e combine com o
inspector em `9229` quando necessário.

## Roteiro de verificação mínima

Quando precisar decidir se o sistema está saudável:

```bash
npm run daemon:status
curl http://localhost:3008/api/health
curl http://localhost:3008/api/health/chrome
curl http://localhost:3008/api/health/pm2
curl http://localhost:3008/api/metrics
```

Se o backend responder, mas algum helper antigo falhar, priorize o contrato HTTP e o PM2.

## Sinais de drift que ainda existem

- helpers antigos assumindo `2998`;
- scripts auxiliares legados que ainda carregam nomenclatura antiga de config;
- documentação histórica que descreve monitoramento como se todos os processos existissem em todos
  os modos.

## Próxima leitura recomendada

- [./TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- [../OPERACOES/NETWORKING.md](../OPERACOES/NETWORKING.md)
- [../OPERACOES/SECURITY.md](../OPERACOES/SECURITY.md)
- [../REFERENCIA/HEALTH_ENDPOINT.md](../REFERENCIA/HEALTH_ENDPOINT.md)
